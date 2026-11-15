import { parseExpression } from './parser';
import {
  AccessKind,
  ArrayCell,
  CompileError,
  DeclItem,
  Expr,
  FuncDecl,
  Highlight,
  LimitError,
  Program,
  RunOptions,
  RuntimeError,
  Step,
  StepStatus,
  Stmt,
  TraceResult,
  Type,
  Variable,
  typeToString,
} from './types';

// ───────────────────────── Runtime values ─────────────────────────
class Dbl {
  constructor(public v: number) {}
}
class Chr {
  constructor(public c: number) {}
}
class Arr {
  constructor(
    public data: Value[],
    public elemType: Type,
    public leaf: Type,
    public isVector: boolean,
    public dims?: number[],
  ) {}
}
class Stream {
  fail = false;
  constructor(public kind: 'cin' | 'cout') {}
}
class Iter {
  constructor(public arr: Arr, public idx: number) {}
}
class Manip {
  constructor(public name: string, public arg = 0) {}
}
type Value = number | boolean | string | Dbl | Chr | Arr | Stream | Iter | Manip | undefined;

interface Cell {
  type: Type;
  value: Value;
}
interface LV {
  type: Type;
  get(): Value;
  set(v: Value): void;
}
interface Frame {
  fn: string;
  scopes: Map<string, Cell>[];
}
type Signal = { t: 'break' } | { t: 'continue' } | { t: 'return'; v: Value };
interface Access {
  arr: Arr;
  idx: number;
  kind: AccessKind;
}

const MAX_DEPTH = 200;
const MAX_ARRAY = 200_000;
const MAX_STDOUT = 200_000;
const SNAP_ROWS = 40;
const SNAP_COLS = 100;

const CONSTS: Record<string, number> = {
  INT_MAX: 2147483647,
  INT_MIN: -2147483648,
  UINT_MAX: 4294967295,
  LLONG_MAX: Number.MAX_SAFE_INTEGER,
  LLONG_MIN: Number.MIN_SAFE_INTEGER,
  LONG_MAX: Number.MAX_SAFE_INTEGER,
  LONG_MIN: Number.MIN_SAFE_INTEGER,
  'string::npos': -1,
};

const MATH1: Record<string, (x: number) => number> = {
  sqrt: Math.sqrt, floor: Math.floor, ceil: Math.ceil, round: (x) => (x < 0 ? -Math.round(-x) : Math.round(x)),
  log: Math.log, log2: Math.log2, log10: Math.log10, exp: Math.exp, sin: Math.sin, cos: Math.cos,
  tan: Math.tan, atan: Math.atan, fabs: Math.abs, trunc: Math.trunc, cbrt: Math.cbrt,
};

// ───────────────────────── helpers ─────────────────────────
function toNum(v: Value, line?: number): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Dbl) return v.v;
  if (v instanceof Chr) return v.c;
  throw new RuntimeError('a numeric value was expected here', line);
}

function toBool(v: Value, line?: number): boolean {
  if (typeof v === 'boolean') return v;
  if (v instanceof Stream) return !v.fail;
  if (typeof v === 'string') throw new RuntimeError('a string cannot be used as a condition', line);
  return toNum(v, line) !== 0;
}

function fmtG(x: number, p = 6): string {
  if (!isFinite(x)) return Number.isNaN(x) ? 'nan' : x < 0 ? '-inf' : 'inf';
  if (x === 0) return '0';
  const prec = Math.max(1, p);
  const exp = Math.floor(Math.log10(Math.abs(x)));
  const strip = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  if (exp < -5 || exp >= prec) {
    const [m, e] = x.toExponential(prec - 1).split('e');
    const digits = e.replace(/^[+-]/, '').padStart(2, '0');
    return `${strip(m)}e${e[0] === '-' ? '-' : '+'}${digits}`;
  }
  const s = x.toPrecision(prec);
  if (s.includes('e')) return fmtG(Number(s), prec);
  return strip(s);
}

function leafOf(t: Type): Type {
  while ((t.name === 'vector' || t.name === 'array') && t.elem) t = t.elem;
  return t;
}

function sizeOfType(t: Type): number {
  switch (t.name) {
    case 'char': case 'bool': return 1;
    case 'int': case 'unsigned': case 'float': return 4;
    case 'long': case 'double': return 8;
    case 'string': return 32;
    case 'vector': return 24;
    default: return 4;
  }
}

function inferType(v: Value): Type {
  if (v instanceof Dbl) return { name: 'double' };
  if (v instanceof Chr) return { name: 'char' };
  if (typeof v === 'boolean') return { name: 'bool' };
  if (typeof v === 'string') return { name: 'string' };
  if (v instanceof Arr) return { name: 'vector', elem: v.elemType };
  return { name: 'int' };
}

function valueToLabel(v: Value): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'string') return v;
  if (v instanceof Dbl) return fmtG(v.v, 6);
  if (v instanceof Chr) return v.c >= 32 && v.c < 127 ? String.fromCharCode(v.c) : `\\${v.c}`;
  return '?';
}

function valueToDisplay(v: Value): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (v instanceof Chr) {
    const ch = v.c >= 32 && v.c < 127 ? `'${String.fromCharCode(v.c)}'` : `'\\${v.c}'`;
    return `${ch} (${v.c})`;
  }
  return valueToLabel(v);
}

function numOfCell(v: Value): number {
  if (typeof v === 'string') return v.length;
  if (v instanceof Arr) return v.data.length;
  try {
    return toNum(v);
  } catch {
    return 0;
  }
}

// ───────────────────────── Interpreter ─────────────────────────
export class Interpreter {
  private funcs: Map<string, FuncDecl[]>;
  private globals = new Map<string, Cell>();
  private frames: Frame[] = [];
  private steps: Step[] = [];
  private stdout = '';
  private pending: Access[] = [];
  private curLine = 1;
  private silent = true;
  private startTime = 0;
  private inPos = 0;
  private fixed = false;
  private precision = 6;
  private cout = new Stream('cout');
  private cin = new Stream('cin');
  private returnValue: string | undefined;

  constructor(private prog: Program, private opts: RunOptions) {
    this.funcs = prog.funcs;
  }

  // ───── driver ─────
  run(): TraceResult {
    this.startTime = Date.now();
    const finish = (status: TraceResult['status'], error?: TraceResult['error']): TraceResult => ({
      steps: this.steps,
      returnValue: this.returnValue,
      status,
      error,
      elapsedMs: Date.now() - this.startTime,
    });

    try {
      for (const g of this.prog.globals) this.execStmt(g);
      const mains = this.funcs.get('main');
      if (mains) {
        const main = mains[0];
        this.silent = false;
        this.curLine = main.line;
        this.emitStep(main.line, 'running', 'Program start');
        this.callFunction(main, [], main.line);
        return finish('finished');
      }

      // No main(): run the function call the user typed (LeetCode / GfG style).
      const callText = (this.opts.entryCall ?? '').trim();
      if (!callText) {
        throw new CompileError('No main() found. Enter the function call to run, e.g. myFunction({1, 2, 3}, 5)', 0);
      }
      let expr: Expr;
      try {
        expr = parseExpression(callText);
      } catch (e) {
        if (e instanceof CompileError) throw new CompileError(`Function call: ${e.message}`, 0);
        throw e;
      }
      const target = expr.k === 'call' ? this.funcs.get(expr.name) : undefined;
      if (expr.k !== 'call' || !target) {
        const names = [...this.funcs.keys()].join(', ');
        throw new CompileError(`The function call must call one of your functions (${names || 'none defined'}).`, 0);
      }
      this.silent = false;
      this.curLine = target[0].line;
      this.emitStep(target[0].line, 'running', `Calling ${callText}`);
      this.ev(expr);
      return finish('finished');
    } catch (e) {
      if (e instanceof LimitError) {
        const last = this.steps[this.steps.length - 1];
        if (last) {
          last.status = 'limit';
          last.message = e.message;
        }
        return finish('limit', { kind: 'limit', message: e.message, line: e.line ?? last?.line });
      }
      if (e instanceof CompileError) {
        return finish('error', { kind: 'compile', message: e.message, line: e.line });
      }
      const message = e instanceof RuntimeError ? e.message : `internal error: ${(e as Error)?.message ?? String(e)}`;
      const line = e instanceof RuntimeError && e.line ? e.line : this.curLine;
      if (!this.silent) {
        this.silent = false;
        this.steps.push(this.snapshot(line, 'error', message));
      }
      return finish('error', { kind: 'runtime', message, line });
    }
  }

  // ───── step recording ─────
  private access(arr: Arr, idx: number, kind: AccessKind): void {
    if (this.silent) return;
    this.pending.push({ arr, idx, kind });
  }

  private emitStep(line: number, status: StepStatus = 'running', message?: string): void {
    if (this.silent) {
      this.pending = [];
      return;
    }
    if (this.steps.length >= this.opts.maxSteps) {
      throw new LimitError(
        `Execution stopped after ${this.opts.maxSteps.toLocaleString('en-US')} steps (possible infinite loop). Raise the step limit to trace longer programs.`,
        'steps',
        line,
      );
    }
    if ((this.steps.length & 63) === 0 && Date.now() - this.startTime > this.opts.maxMillis) {
      throw new LimitError(
        `Execution stopped after ${(this.opts.maxMillis / 1000).toFixed(0)} seconds (possible infinite loop).`,
        'time',
        line,
      );
    }
    this.steps.push(this.snapshot(line, status, message));
    this.pending = [];
  }

  private snapshot(line: number, status: StepStatus, message?: string): Step {
    const arrMap = new Map<Arr, { name: string; row: number }>();
    const vars: Variable[] = [];
    const seen = new Map<string, { cell: Cell; scope: 'local' | 'global' }>();
    const top = this.frames[this.frames.length - 1];
    if (top) {
      for (const sc of top.scopes) for (const [name, cell] of sc) seen.set(name, { cell, scope: 'local' });
    }
    for (const [name, cell] of this.globals) if (!seen.has(name)) seen.set(name, { cell, scope: 'global' });
    for (const [name, { cell, scope }] of seen) vars.push(this.describe(name, cell, scope, arrMap));

    const hl = new Map<string, Highlight>();
    const rank: Record<AccessKind, number> = { read: 0, write: 1, swap: 2 };
    for (const a of this.pending) {
      const info = arrMap.get(a.arr);
      if (!info) continue;
      const key = `${info.name}:${info.row}:${a.idx}`;
      const prev = hl.get(key);
      if (!prev || rank[a.kind] > rank[prev.kind]) hl.set(key, { name: info.name, row: info.row, col: a.idx, kind: a.kind });
    }

    return {
      step: this.steps.length + 1,
      line,
      func: top ? top.fn : 'global',
      depth: this.frames.length,
      stack: this.frames.map((f) => f.fn),
      variables: vars,
      stdout: this.stdout,
      status,
      highlights: [...hl.values()],
      message,
    };
  }

  private describe(name: string, cell: Cell, scope: 'local' | 'global', arrMap: Map<Arr, { name: string; row: number }>): Variable {
    const v = cell.value;
    if (v instanceof Arr) {
      const nested = v.data.length > 0 && v.data[0] instanceof Arr;
      const mk = (a: Arr): ArrayCell[] => a.data.slice(0, SNAP_COLS).map((x) => ({ n: numOfCell(x), s: valueToLabel(x) }));
      let rows: ArrayCell[][];
      let truncated = v.data.length > (nested ? SNAP_ROWS : SNAP_COLS);
      let length = v.data.length;
      if (nested) {
        const inner = v.data.slice(0, SNAP_ROWS) as Arr[];
        rows = inner.map((r, i) => {
          arrMap.set(r, { name, row: i });
          if (r.data.length > SNAP_COLS) truncated = true;
          return mk(r);
        });
        length = v.data.length * Math.max(...v.data.map((r) => (r instanceof Arr ? r.data.length : 0)), 0);
      } else {
        arrMap.set(v, { name, row: 0 });
        rows = [mk(v)];
      }
      const type = v.isVector ? `vector<${typeToString(v.elemType)}>` : `${typeToString(v.leaf)}${(v.dims ?? [v.data.length]).map((d) => `[${d}]`).join('')}`;
      return { kind: 'array', name, type, rows, length, truncated, scope };
    }
    const type = typeToString(cell.type.name === 'array' ? inferType(v) : cell.type);
    return { kind: 'scalar', name, type, value: valueToDisplay(v), scope };
  }

  // ───── scopes ─────
  private lookupCell(name: string): Cell | undefined {
    const top = this.frames[this.frames.length - 1];
    if (top) {
      for (let i = top.scopes.length - 1; i >= 0; i--) {
        const c = top.scopes[i].get(name);
        if (c) return c;
      }
    }
    return this.globals.get(name);
  }

  private declare(name: string, cell: Cell, line: number): void {
    const top = this.frames[this.frames.length - 1];
    const scope = top ? top.scopes[top.scopes.length - 1] : this.globals;
    if (scope.has(name)) throw new RuntimeError(`redeclaration of '${name}'`, line);
    scope.set(name, cell);
  }

  private pushScope(): void {
    this.frames[this.frames.length - 1].scopes.push(new Map());
  }
  private popScope(): void {
    this.frames[this.frames.length - 1].scopes.pop();
  }

  // ───── value utilities ─────
  private defaultValue(t: Type): Value {
    switch (t.name) {
      case 'char': return new Chr(0);
      case 'bool': return false;
      case 'float': case 'double': return new Dbl(0);
      case 'string': return '';
      case 'vector': return new Arr([], t.elem!, leafOf(t), true);
      case 'void': return undefined;
      default: return 0;
    }
  }

  private copyArr(a: Arr): Arr {
    return new Arr(a.data.map((x) => (x instanceof Arr ? this.copyArr(x) : x)), a.elemType, a.leaf, a.isVector, a.dims);
  }

  private coerce(t: Type, v: Value, line?: number): Value {
    switch (t.name) {
      case 'auto':
        return v instanceof Arr ? this.copyArr(v) : v;
      case 'int': {
        const n = toNum(v, line);
        return Number.isFinite(n) ? Math.trunc(n) | 0 : 0;
      }
      case 'long': {
        const n = toNum(v, line);
        return Number.isFinite(n) ? Math.trunc(n) : 0;
      }
      case 'unsigned': {
        const n = toNum(v, line);
        return Number.isFinite(n) ? Math.trunc(n) >>> 0 : 0;
      }
      case 'char':
        return new Chr((((Math.trunc(toNum(v, line)) || 0) & 255) << 24) >> 24);
      case 'bool':
        return toBool(v, line);
      case 'float':
        return new Dbl(Math.fround(toNum(v, line)));
      case 'double':
        return new Dbl(toNum(v, line));
      case 'string':
        if (typeof v === 'string') return v;
        throw new RuntimeError('cannot convert this value to string', line);
      case 'vector':
        if (v instanceof Arr) return this.copyArr(v);
        throw new RuntimeError('cannot convert this value to a vector', line);
      case 'array':
        return v;
      default:
        return undefined;
    }
  }

  private str(v: Value, line?: number): string {
    if (typeof v === 'string') return v;
    if (v instanceof Chr) return String.fromCharCode(v.c);
    throw new RuntimeError('cannot concatenate a string with a non-character value (use to_string)', line);
  }

  // ───── statements ─────
  private execStmt(s: Stmt): Signal | undefined {
    this.curLine = s.line;
    switch (s.k) {
      case 'decl':
        this.execDecl(s.type, s.items, s.line);
        this.emitStep(s.line);
        return undefined;
      case 'expr':
        this.ev(s.e);
        this.emitStep(s.line);
        return undefined;
      case 'empty':
        return undefined;
      case 'block': {
        this.pushScope();
        for (const st of s.body) {
          const sig = this.execStmt(st);
          if (sig) { this.popScope(); return sig; }
        }
        this.popScope();
        return undefined;
      }
      case 'if': {
        const c = toBool(this.ev(s.c), s.line);
        this.emitStep(s.line);
        if (c) return this.execStmt(s.t);
        if (s.f) return this.execStmt(s.f);
        return undefined;
      }
      case 'while': {
        for (;;) {
          this.curLine = s.line;
          const c = toBool(this.ev(s.c), s.line);
          this.emitStep(s.line);
          if (!c) break;
          const sig = this.execStmt(s.body);
          if (sig) {
            if (sig.t === 'break') break;
            if (sig.t === 'return') return sig;
          }
        }
        return undefined;
      }
      case 'dowhile': {
        for (;;) {
          const sig = this.execStmt(s.body);
          if (sig) {
            if (sig.t === 'break') break;
            if (sig.t === 'return') return sig;
          }
          this.curLine = s.condLine;
          const c = toBool(this.ev(s.c), s.condLine);
          this.emitStep(s.condLine);
          if (!c) break;
        }
        return undefined;
      }
      case 'for': {
        this.pushScope();
        let result: Signal | undefined;
        if (s.init) {
          if (s.init.k === 'decl') this.execDecl(s.init.type, s.init.items, s.line);
          else if (s.init.k === 'expr') this.ev(s.init.e);
          this.emitStep(s.line);
        }
        for (let first = true; ; first = false) {
          this.curLine = s.line;
          if (!first && s.upd) this.ev(s.upd);
          const c = s.c ? toBool(this.ev(s.c), s.line) : true;
          this.emitStep(s.line);
          if (!c) break;
          const sig = this.execStmt(s.body);
          if (sig) {
            if (sig.t === 'break') break;
            if (sig.t === 'return') { result = sig; break; }
          }
        }
        this.popScope();
        return result;
      }
      case 'rfor': {
        const coll = this.ev(s.e);
        if (!(coll instanceof Arr) && typeof coll !== 'string') {
          throw new RuntimeError('range-based for needs an array, vector or string', s.line);
        }
        const len = coll instanceof Arr ? coll.data.length : coll.length;
        let result: Signal | undefined;
        for (let i = 0; i < len; i++) {
          this.pushScope();
          this.curLine = s.line;
          let el: Value;
          if (coll instanceof Arr) {
            el = coll.data[i];
            if (!(el instanceof Arr)) this.access(coll, i, 'read');
          } else {
            el = new Chr(coll.charCodeAt(i));
          }
          const type = s.type.name === 'auto' ? inferType(el) : s.type;
          const cell: Cell = { type, value: el instanceof Arr && !s.ref ? this.copyArr(el) : this.coerce(type, el, s.line) };
          if (el instanceof Arr && s.ref) cell.value = el;
          this.declare(s.name, cell, s.line);
          this.emitStep(s.line);
          const sig = this.execStmt(s.body);
          if (s.ref && coll instanceof Arr && !(el instanceof Arr)) {
            coll.data[i] = cell.value;
            this.access(coll, i, 'write');
          }
          this.popScope();
          if (sig) {
            if (sig.t === 'break') break;
            if (sig.t === 'return') { result = sig; break; }
          }
        }
        return result;
      }
      case 'return': {
        const v = s.e ? this.ev(s.e) : undefined;
        this.emitStep(s.line);
        return { t: 'return', v };
      }
      case 'break':
        this.emitStep(s.line);
        return { t: 'break' };
      case 'continue':
        this.emitStep(s.line);
        return { t: 'continue' };
    }
  }

  // ───── declarations ─────
  private execDecl(base: Type, items: DeclItem[], line: number): void {
    for (const item of items) {
      let type = base;
      let value: Value;

      if (item.dims.length > 0) {
        const dims = item.dims.map((d) => (d ? Math.trunc(toNum(this.ev(d), line)) : -1));
        value = this.makeArray(base, dims, item.init, line);
        type = { name: 'array', elem: base };
      } else if (base.name === 'vector') {
        value = this.initVector(base, item, line);
      } else if (base.name === 'string') {
        if (item.init) value = this.coerce(base, this.ev(item.init), line);
        else if (item.ctor && item.ctor.length === 2) {
          value = this.str(this.ev(item.ctor[1]), line).repeat(Math.max(0, toNum(this.ev(item.ctor[0]), line)));
        } else if (item.ctor && item.ctor.length === 1) value = this.coerce(base, this.ev(item.ctor[0]), line);
        else value = '';
      } else {
        let init: Expr | undefined = item.init ?? (item.ctor ? item.ctor[0] : undefined);
        if (init && init.k === 'initlist') init = init.items[0];
        if (base.name === 'auto') {
          if (!init) throw new RuntimeError(`declaration of 'auto ${item.name}' has no initializer`, line);
          const v = this.ev(init);
          type = inferType(v);
          value = this.coerce(type, v, line);
        } else {
          value = init ? this.coerce(base, this.ev(init), line) : this.defaultValue(base);
        }
      }
      this.declare(item.name, { type, value }, line);
    }
  }

  private checkSize(n: number, line: number): void {
    if (!Number.isFinite(n) || n < 0) throw new RuntimeError(`invalid array/vector size ${n}`, line);
    if (n > MAX_ARRAY) throw new RuntimeError(`size ${n} is too large for the visualizer (limit ${MAX_ARRAY.toLocaleString('en-US')})`, line);
  }

  private makeArray(base: Type, dims: number[], init: Expr | undefined, line: number): Arr {
    if (dims[0] === -1) {
      if (init && init.k === 'initlist') dims[0] = init.items.length;
      else if (init && init.k === 'str' && base.name === 'char') dims[0] = init.v.length + 1;
      else throw new RuntimeError('array size missing and cannot be deduced from an initializer', line);
    }
    if (dims.some((d) => d === -1)) throw new RuntimeError('only the first array dimension may be omitted', line);
    let total = 1;
    for (const d of dims) {
      this.checkSize(d, line);
      total *= d;
      this.checkSize(total, line);
    }
    const last = dims.length - 1;
    const build = (depth: number, ini: Expr | undefined): Arr => {
      const n = dims[depth];
      const data: Value[] = [];
      if (ini && ini.k === 'initlist' && ini.items.length > n) throw new RuntimeError('too many initializers for array', line);
      for (let i = 0; i < n; i++) {
        if (depth === last) {
          if (ini && ini.k === 'initlist' && i < ini.items.length) data.push(this.coerce(base, this.ev(ini.items[i]), line));
          else if (ini && ini.k === 'str' && base.name === 'char') data.push(new Chr(i < ini.v.length ? ini.v.charCodeAt(i) : 0));
          else data.push(this.defaultValue(base));
        } else {
          data.push(build(depth + 1, ini && ini.k === 'initlist' ? ini.items[i] : undefined));
        }
      }
      return new Arr(data, depth < last ? { name: 'array', elem: base } : base, base, false, dims.slice(depth));
    };
    return build(0, init);
  }

  private buildVec(type: Type, items: Expr[], line: number): Arr {
    const elem = type.elem!;
    const data: Value[] = items.map((it) => {
      if (elem.name === 'vector') {
        return it.k === 'initlist' ? this.buildVec(elem, it.items, line) : this.coerce(elem, this.ev(it), line);
      }
      return this.coerce(elem, this.ev(it), line);
    });
    this.checkSize(data.length, line);
    return new Arr(data, elem, leafOf(type), true);
  }

  private ctorVector(type: Type, args: Value[], line: number): Arr {
    const elem = type.elem!;
    const mk = (data: Value[]) => new Arr(data, elem, leafOf(type), true);
    if (args.length === 0) return mk([]);
    if (args.length === 1 && args[0] instanceof Arr) return this.copyArr(args[0]);
    const n = Math.trunc(toNum(args[0], line));
    this.checkSize(n, line);
    const data: Value[] = [];
    for (let i = 0; i < n; i++) {
      if (args.length >= 2) {
        data.push(args[1] instanceof Arr ? this.copyArr(args[1]) : this.coerce(elem, args[1], line));
      } else data.push(this.defaultValue(elem));
    }
    return mk(data);
  }

  private initVector(type: Type, item: DeclItem, line: number): Arr {
    if (item.ctor) return this.ctorVector(type, item.ctor.map((a) => this.ev(a)), line);
    if (item.init) {
      if (item.init.k === 'initlist') return this.buildVec(type, item.init.items, line);
      const v = this.ev(item.init);
      if (v instanceof Arr) return this.copyArr(v);
      throw new RuntimeError('cannot initialize a vector from this value', line);
    }
    return new Arr([], type.elem!, leafOf(type), true);
  }

  // ───── expressions ─────
  private lookupValue(name: string, line: number): Value {
    const cell = this.lookupCell(name);
    if (cell) return cell.value;
    switch (name) {
      case 'cout': return this.cout;
      case 'cin': return this.cin;
      case 'endl': return new Manip('endl');
      case 'fixed': return new Manip('fixed');
      case 'boolalpha': case 'noboolalpha': case 'flush': return new Manip('noop');
    }
    if (name in CONSTS) return CONSTS[name];
    if (name === 'M_PI') return new Dbl(Math.PI);
    if (name === 'M_E') return new Dbl(Math.E);
    throw new RuntimeError(`'${name}' was not declared in this scope`, line);
  }

  private ev(e: Expr): Value {
    switch (e.k) {
      case 'num': return e.float ? new Dbl(e.v) : e.v;
      case 'str': return e.v;
      case 'chr': return new Chr(e.v);
      case 'bool': return e.v;
      case 'id': return this.lookupValue(e.name, e.line);
      case 'bin': return this.evBin(e);
      case 'un': {
        const v = this.ev(e.e);
        switch (e.op) {
          case '-': return v instanceof Dbl ? new Dbl(-v.v) : 0 - toNum(v, e.line);
          case '+': return v instanceof Dbl ? v : toNum(v, e.line);
          case '!': return !toBool(v, e.line);
          default: return ~toNum(v, e.line);
        }
      }
      case 'inc': {
        const lv = this.lvalue(e.e);
        const old = lv.get();
        const d = e.op === '++' ? 1 : -1;
        let nv: Value;
        if (old instanceof Dbl) nv = new Dbl(old.v + d);
        else nv = toNum(old, e.line) + d;
        const stored = this.coerce(lv.type, nv, e.line);
        lv.set(stored);
        return e.prefix ? stored : old;
      }
      case 'assign': {
        const rv = this.ev(e.r);
        const lv = this.lvalue(e.l);
        let nv = rv;
        if (e.op !== '=') nv = this.binop(e.op.slice(0, -1), lv.get(), rv, e.line);
        const stored = this.coerce(lv.type, nv, e.line);
        lv.set(stored);
        return stored;
      }
      case 'cond': return toBool(this.ev(e.c), e.line) ? this.ev(e.a) : this.ev(e.b);
      case 'call': return this.evCall(e);
      case 'index': return this.lvIndex(e).get();
      case 'member': return this.evMember(e);
      case 'cast': return this.coerce(e.type, this.ev(e.e), e.line);
      case 'construct': {
        if (e.type.name === 'string') {
          const a = e.args.map((x) => this.ev(x));
          if (a.length === 2) return this.str(a[1], e.line).repeat(Math.max(0, toNum(a[0], e.line)));
          return a.length === 1 ? this.coerce(e.type, a[0], e.line) : '';
        }
        if (e.init) return this.buildVec(e.type, e.init, e.line);
        return this.ctorVector(e.type, e.args.map((x) => this.ev(x)), e.line);
      }
      case 'initlist':
        throw new RuntimeError('unexpected initializer list', e.line);
      case 'sizeof': {
        if (e.type) return sizeOfType(e.type);
        const x = e.e!;
        if (x.k === 'index') {
          const b = this.ev(x.base);
          if (b instanceof Arr) {
            return b.elemType.name === 'array' ? this.sizeOfArr(b.data[0] as Arr) : sizeOfType(b.elemType);
          }
        }
        const v = this.ev(x);
        if (v instanceof Arr) return v.isVector ? 24 : this.sizeOfArr(v);
        if (v instanceof Dbl) return 8;
        if (v instanceof Chr || typeof v === 'boolean') return 1;
        if (typeof v === 'string') return 32;
        if (x.k === 'id') {
          const c = this.lookupCell(x.name);
          if (c) return sizeOfType(c.type);
        }
        return 4;
      }
    }
  }

  private sizeOfArr(a: Arr): number {
    if (a.data.length > 0 && a.data[0] instanceof Arr) return a.data.length * this.sizeOfArr(a.data[0] as Arr);
    return a.data.length * sizeOfType(a.leaf);
  }

  private evBin(e: Extract<Expr, { k: 'bin' }>): Value {
    const op = e.op;
    if (op === '&&') return toBool(this.ev(e.l), e.line) && toBool(this.ev(e.r), e.line);
    if (op === '||') return toBool(this.ev(e.l), e.line) || toBool(this.ev(e.r), e.line);
    if (op === ',') { this.ev(e.l); return this.ev(e.r); }
    const l = this.ev(e.l);
    if (l instanceof Stream) {
      if (op === '<<' && l.kind === 'cout') {
        this.write(this.ev(e.r), e.line);
        return l;
      }
      if (op === '>>' && l.kind === 'cin') {
        this.readInto(this.lvalue(e.r), l, e.line);
        return l;
      }
      throw new RuntimeError(`invalid use of '${op}' with ${l.kind}`, e.line);
    }
    return this.binop(op, l, this.ev(e.r), e.line);
  }

  private binop(op: string, l: Value, r: Value, line: number): Value {
    if ((l instanceof Arr || l instanceof Iter) && (op === '+' || op === '-')) {
      const base = l instanceof Arr ? new Iter(l, 0) : l;
      return new Iter(base.arr, base.idx + (op === '+' ? 1 : -1) * toNum(r, line));
    }
    if (typeof l === 'string' || typeof r === 'string') {
      if (op === '+') return this.str(l, line) + this.str(r, line);
      if (typeof l === 'string' && typeof r === 'string') {
        switch (op) {
          case '==': return l === r;
          case '!=': return l !== r;
          case '<': return l < r;
          case '>': return l > r;
          case '<=': return l <= r;
          case '>=': return l >= r;
        }
      }
      throw new RuntimeError(`invalid operands to binary '${op}' (string and non-string)`, line);
    }
    const a = toNum(l, line);
    const b = toNum(r, line);
    const f = l instanceof Dbl || r instanceof Dbl;
    switch (op) {
      case '+': return f ? new Dbl(a + b) : a + b;
      case '-': return f ? new Dbl(a - b) : a - b;
      case '*': return f ? new Dbl(a * b) : a * b;
      case '/':
        if (f) return new Dbl(a / b);
        if (b === 0) throw new RuntimeError('division by zero', line);
        return Math.trunc(a / b);
      case '%':
        if (f) throw new RuntimeError("invalid operands to binary '%' (floating-point)", line);
        if (b === 0) throw new RuntimeError('modulo by zero', line);
        return a % b;
      case '<': return a < b;
      case '>': return a > b;
      case '<=': return a <= b;
      case '>=': return a >= b;
      case '==': return a === b;
      case '!=': return a !== b;
      case '&': return a & b;
      case '|': return a | b;
      case '^': return a ^ b;
      case '<<': return a << b;
      case '>>': return a >> b;
    }
    throw new RuntimeError(`unsupported operator '${op}'`, line);
  }

  // ───── lvalues ─────
  private lvalue(e: Expr): LV {
    if (e.k === 'id') {
      const cell = this.lookupCell(e.name);
      if (!cell) throw new RuntimeError(`'${e.name}' was not declared in this scope`, e.line);
      return { type: cell.type, get: () => cell.value, set: (v) => { cell.value = v; } };
    }
    if (e.k === 'index') return this.lvIndex(e);
    throw new RuntimeError('expression is not assignable', e.line);
  }

  private lvIndex(e: Extract<Expr, { k: 'index' }>): LV {
    const base = this.ev(e.base);
    const idx = toNum(this.ev(e.idx), e.line);
    if (!Number.isInteger(idx)) throw new RuntimeError('array index must be an integer', e.line);
    if (typeof base === 'string') {
      if (idx < 0 || idx >= base.length) throw new RuntimeError(`string index ${idx} is out of range (length ${base.length})`, e.line);
      return {
        type: { name: 'char' },
        get: () => new Chr(base.charCodeAt(idx)),
        set: (v) => {
          const bl = this.lvalue(e.base);
          const s = bl.get() as string;
          bl.set(s.slice(0, idx) + String.fromCharCode(toNum(v, e.line) & 255) + s.slice(idx + 1));
        },
      };
    }
    if (!(base instanceof Arr)) throw new RuntimeError('subscripted value is not an array, vector or string', e.line);
    if (idx < 0 || idx >= base.data.length) {
      throw new RuntimeError(`index ${idx} is out of range for an array of size ${base.data.length}`, e.line);
    }
    return {
      type: base.elemType,
      get: () => {
        const x = base.data[idx];
        if (!(x instanceof Arr)) this.access(base, idx, 'read');
        return x;
      },
      set: (v) => {
        base.data[idx] = v;
        if (!(v instanceof Arr)) this.access(base, idx, 'write');
      },
    };
  }

  // ───── I/O ─────
  private format(v: Value, line: number): string {
    if (v instanceof Manip) {
      if (v.name === 'endl') return '\n';
      if (v.name === 'fixed') this.fixed = true;
      if (v.name === 'setprecision') this.precision = v.arg;
      return '';
    }
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (v instanceof Chr) return String.fromCharCode(v.c);
    if (v instanceof Dbl) return this.fixed ? v.v.toFixed(this.precision) : fmtG(v.v, this.precision);
    throw new RuntimeError('this value cannot be printed with cout', line);
  }

  private write(v: Value, line: number): void {
    this.stdout += this.format(v, line);
    if (this.stdout.length > MAX_STDOUT) throw new RuntimeError('program output is too large', line);
  }

  private readInto(lv: LV, stream: Stream, line: number): void {
    const inp = this.opts.stdin;
    while (this.inPos < inp.length && /\s/.test(inp[this.inPos])) this.inPos++;
    const t = lv.type.name;
    if (this.inPos >= inp.length || stream.fail) {
      stream.fail = true;
      if (t !== 'string' && t !== 'char') lv.set(this.coerce(lv.type, 0, line));
      return;
    }
    if (t === 'char') {
      lv.set(new Chr(inp.charCodeAt(this.inPos++)));
      return;
    }
    let j = this.inPos;
    while (j < inp.length && !/\s/.test(inp[j])) j++;
    const tok = inp.slice(this.inPos, j);
    this.inPos = j;
    if (t === 'string') { lv.set(tok); return; }
    if (t === 'float' || t === 'double') {
      const x = Number(tok);
      if (tok === '' || Number.isNaN(x)) { stream.fail = true; lv.set(new Dbl(0)); } else lv.set(this.coerce(lv.type, new Dbl(x), line));
      return;
    }
    if (t === 'int' || t === 'long' || t === 'unsigned' || t === 'bool') {
      if (!/^[+-]?\d+$/.test(tok)) { stream.fail = true; lv.set(this.coerce(lv.type, 0, line)); return; }
      lv.set(this.coerce(lv.type, Number(tok), line));
      return;
    }
    throw new RuntimeError(`cannot read into a variable of type ${typeToString(lv.type)}`, line);
  }

  // ───── function calls ─────
  private callFunction(fn: FuncDecl, args: Expr[], line: number): Value {
    if (this.frames.length >= MAX_DEPTH) {
      throw new RuntimeError(`stack overflow: recursion deeper than ${MAX_DEPTH} calls`, line);
    }
    const isEntry = this.frames.length === 0;
    const cells: Cell[] = fn.params.map((p, i) => {
      const a = args[i];
      if (a.k === 'initlist') {
        if (p.type.name === 'vector') return { type: p.type, value: this.buildVec(p.type, a.items, line) };
        if (p.type.name === 'array') return { type: p.type, value: this.makeArray(p.type.elem!, [a.items.length], a, line) };
        throw new RuntimeError('an initializer list cannot be passed to this parameter', line);
      }
      if (p.ref && !p.isArray) {
        const lv = this.lvalue(a);
        return { type: p.type, get value() { return lv.get(); }, set value(v: Value) { lv.set(v); } } as Cell;
      }
      const v = this.ev(a);
      if (v instanceof Arr) {
        return { type: p.type, value: p.type.name === 'vector' && !p.ref ? this.copyArr(v) : v };
      }
      return { type: p.type, value: this.coerce(p.type, v, line) };
    });
    const scope = new Map<string, Cell>();
    fn.params.forEach((p, i) => scope.set(p.name, cells[i]));
    this.frames.push({ fn: fn.name, scopes: [scope] });
    // The body runs directly in the parameter scope (like C++), so locals are still alive below.
    let sig: Signal | undefined;
    if (fn.body.k === 'block') {
      for (const st of fn.body.body) {
        sig = this.execStmt(st);
        if (sig) break;
      }
    } else {
      sig = this.execStmt(fn.body);
    }
    let result: Value;
    if (fn.ret.name === 'void') result = undefined;
    else if (sig && sig.t === 'return' && sig.v !== undefined) result = this.coerce(fn.ret, sig.v, line);
    else result = fn.name === 'main' ? 0 : this.defaultValue(fn.ret);
    // The final step is recorded while the entry function's variables are still alive.
    if (isEntry) {
      if (fn.name === 'main') {
        this.emitStep(fn.endLine, 'finished', 'Program finished');
      } else {
        this.returnValue = result === undefined ? undefined : valueToDisplay(result);
        this.emitStep(fn.endLine, 'finished', this.returnValue !== undefined ? `Returned ${this.returnValue}` : 'Function finished');
      }
    }
    this.frames.pop();
    this.curLine = line;
    return result;
  }

  private evCall(e: Extract<Expr, { k: 'call' }>): Value {
    const user = this.funcs.get(e.name);
    if (user) {
      const fn = user.find((f) => f.params.length === e.args.length);
      if (!fn) throw new RuntimeError(`no matching function for call to '${e.name}' with ${e.args.length} argument(s)`, e.line);
      return this.callFunction(fn, e.args, e.line);
    }
    const line = e.line;
    const a = e.args;
    const need = (n: number) => {
      if (a.length !== n) throw new RuntimeError(`'${e.name}' expects ${n} argument(s)`, line);
    };

    switch (e.name) {
      case 'swap': {
        need(2);
        const x = this.lvalue(a[0]);
        const y = this.lvalue(a[1]);
        const from = this.pending.length;
        const t = x.get();
        x.set(y.get());
        y.set(t);
        for (let i = from; i < this.pending.length; i++) this.pending[i].kind = 'swap';
        return undefined;
      }
      case 'min': case 'max': {
        need(2);
        const x = this.ev(a[0]);
        const y = this.ev(a[1]);
        if (typeof x === 'string' && typeof y === 'string') return (e.name === 'min') === (x <= y) ? x : y;
        const nx = toNum(x, line);
        const ny = toNum(y, line);
        const r = e.name === 'min' ? Math.min(nx, ny) : Math.max(nx, ny);
        return x instanceof Dbl || y instanceof Dbl ? new Dbl(r) : r;
      }
      case 'abs': {
        need(1);
        const x = this.ev(a[0]);
        return x instanceof Dbl ? new Dbl(Math.abs(x.v)) : Math.abs(toNum(x, line));
      }
      case 'pow': {
        need(2);
        return new Dbl(Math.pow(toNum(this.ev(a[0]), line), toNum(this.ev(a[1]), line)));
      }
      case 'atan2': {
        need(2);
        return new Dbl(Math.atan2(toNum(this.ev(a[0]), line), toNum(this.ev(a[1]), line)));
      }
      case '__gcd': case 'gcd': {
        need(2);
        let x = Math.abs(toNum(this.ev(a[0]), line));
        let y = Math.abs(toNum(this.ev(a[1]), line));
        while (y) [x, y] = [y, x % y];
        return x;
      }
      case 'to_string': {
        need(1);
        const x = this.ev(a[0]);
        return x instanceof Dbl ? x.v.toFixed(6) : String(toNum(x, line));
      }
      case 'stoi': case 'stol': case 'stoll': {
        need(1);
        const s = this.ev(a[0]);
        const n = parseInt(String(s), 10);
        if (Number.isNaN(n)) throw new RuntimeError(`stoi: no conversion for "${String(s)}"`, line);
        return n;
      }
      case 'stod': {
        need(1);
        return new Dbl(parseFloat(String(this.ev(a[0]))));
      }
      case 'setprecision': {
        need(1);
        return new Manip('setprecision', Math.trunc(toNum(this.ev(a[0]), line)));
      }
      case 'getline': {
        need(2);
        const s = this.ev(a[0]);
        const lv = this.lvalue(a[1]);
        if (!(s instanceof Stream)) throw new RuntimeError('getline expects cin as the first argument', line);
        const inp = this.opts.stdin;
        if (this.inPos >= inp.length) { s.fail = true; lv.set(''); return s; }
        let j = inp.indexOf('\n', this.inPos);
        if (j === -1) j = inp.length;
        lv.set(inp.slice(this.inPos, j).replace(/\r$/, ''));
        this.inPos = Math.min(inp.length, j + 1);
        return s;
      }
      case 'sort': case 'reverse': {
        need(2);
        const f = this.ev(a[0]);
        const l = this.ev(a[1]);
        const first = f instanceof Arr ? new Iter(f, 0) : f;
        const last = l instanceof Arr ? new Iter(l, 0) : l;
        if (!(first instanceof Iter) || !(last instanceof Iter) || first.arr !== last.arr) {
          throw new RuntimeError(`${e.name}() expects a valid iterator range such as ${e.name}(v.begin(), v.end())`, line);
        }
        const arr = first.arr;
        if (first.idx < 0 || last.idx > arr.data.length || first.idx > last.idx) throw new RuntimeError(`${e.name}(): iterator range is out of bounds`, line);
        const part = arr.data.slice(first.idx, last.idx);
        if (e.name === 'reverse') part.reverse();
        else if (part.every((x) => typeof x === 'string')) part.sort((x, y) => ((x as string) < (y as string) ? -1 : (x as string) > (y as string) ? 1 : 0));
        else part.sort((x, y) => toNum(x, line) - toNum(y, line));
        part.forEach((x, i) => {
          arr.data[first.idx + i] = x;
          this.access(arr, first.idx + i, 'write');
        });
        return undefined;
      }
      case 'printf': {
        if (a.length < 1) throw new RuntimeError('printf expects a format string', line);
        const fmt = this.ev(a[0]);
        if (typeof fmt !== 'string') throw new RuntimeError('printf expects a format string', line);
        const vals = a.slice(1).map((x) => this.ev(x));
        let k = 0;
        const out = fmt.replace(/%([-+ 0#]*)(\d+)?(?:\.(\d+))?(?:hh|h|ll|l|z)?([diuscfeEgGxXo%])/g, (_m, flags: string, w: string, p: string, c: string) => {
          if (c === '%') return '%';
          if (k >= vals.length) throw new RuntimeError('printf: too few arguments for the format string', line);
          const v = vals[k++];
          let s: string;
          switch (c) {
            case 'd': case 'i': case 'u': s = String(Math.trunc(toNum(v, line))); break;
            case 's': s = typeof v === 'string' ? v : this.str(v, line); break;
            case 'c': s = v instanceof Chr ? String.fromCharCode(v.c) : String.fromCharCode(toNum(v, line)); break;
            case 'f': s = toNum(v, line).toFixed(p !== undefined ? Number(p) : 6); break;
            case 'e': case 'E': s = toNum(v, line).toExponential(p !== undefined ? Number(p) : 6); break;
            case 'g': case 'G': s = fmtG(toNum(v, line), p !== undefined ? Number(p) : 6); break;
            case 'x': s = (Math.trunc(toNum(v, line)) >>> 0).toString(16); break;
            case 'X': s = (Math.trunc(toNum(v, line)) >>> 0).toString(16).toUpperCase(); break;
            default: s = (Math.trunc(toNum(v, line)) >>> 0).toString(8);
          }
          if ('diufeEgG'.includes(c) && flags.includes('+') && !s.startsWith('-')) s = '+' + s;
          const width = w ? Number(w) : 0;
          if (s.length < width) {
            if (flags.includes('-')) s = s.padEnd(width);
            else if (flags.includes('0') && c !== 's' && c !== 'c') s = (s.startsWith('-') ? '-' : '') + s.replace(/^-/, '').padStart(width - (s.startsWith('-') ? 1 : 0), '0');
            else s = s.padStart(width);
          }
          return s;
        });
        this.stdout += out;
        if (this.stdout.length > MAX_STDOUT) throw new RuntimeError('program output is too large', line);
        return out.length;
      }
      case 'puts': {
        need(1);
        this.stdout += this.str(this.ev(a[0]), line) + '\n';
        return 0;
      }
      default: {
        if (e.name in MATH1) {
          need(1);
          return new Dbl(MATH1[e.name](toNum(this.ev(a[0]), line)));
        }
        throw new RuntimeError(`'${e.name}' was not declared in this scope (unknown or unsupported function)`, line);
      }
    }
  }

  private evMember(e: Extract<Expr, { k: 'member' }>): Value {
    const obj = this.ev(e.obj);
    const args = e.args.map((x) => this.ev(x));
    const line = e.line;
    const n = (i: number) => {
      if (i >= args.length) throw new RuntimeError(`.${e.name}() is missing an argument`, line);
      return toNum(args[i], line);
    };

    if (obj instanceof Arr) {
      const d = obj.data;
      switch (e.name) {
        case 'size': case 'length': return d.length;
        case 'empty': return d.length === 0;
        case 'push_back': case 'emplace_back': {
          if (!obj.isVector) break;
          if (args.length < 1) throw new RuntimeError('.push_back() is missing an argument', line);
          this.checkSize(d.length + 1, line);
          const v = this.coerce(obj.elemType, args[0], line);
          d.push(v);
          if (!(v instanceof Arr)) this.access(obj, d.length - 1, 'write');
          return undefined;
        }
        case 'pop_back':
          if (d.length === 0) throw new RuntimeError('pop_back() called on an empty vector', line);
          d.pop();
          return undefined;
        case 'back': case 'front': {
          if (d.length === 0) throw new RuntimeError(`${e.name}() called on an empty vector`, line);
          const i = e.name === 'back' ? d.length - 1 : 0;
          if (!(d[i] instanceof Arr)) this.access(obj, i, 'read');
          return d[i];
        }
        case 'at': {
          const i = n(0);
          if (!Number.isInteger(i) || i < 0 || i >= d.length) throw new RuntimeError(`vector::at: index ${i} is out of range (size ${d.length})`, line);
          if (!(d[i] instanceof Arr)) this.access(obj, i, 'read');
          return d[i];
        }
        case 'clear':
          d.length = 0;
          return undefined;
        case 'resize': {
          const sz = Math.trunc(n(0));
          this.checkSize(sz, line);
          while (d.length > sz) d.pop();
          while (d.length < sz) d.push(args.length > 1 ? this.coerce(obj.elemType, args[1], line) : this.defaultValue(obj.elemType));
          return undefined;
        }
        case 'begin': return new Iter(obj, 0);
        case 'end': return new Iter(obj, d.length);
        case 'insert': {
          const it = args[0];
          if (!(it instanceof Iter) || args.length < 2) break;
          if (it.idx < 0 || it.idx > d.length) throw new RuntimeError('insert(): iterator out of range', line);
          d.splice(it.idx, 0, this.coerce(obj.elemType, args[1], line));
          return undefined;
        }
        case 'erase': {
          const it = args[0];
          if (!(it instanceof Iter)) break;
          if (it.idx < 0 || it.idx >= d.length) throw new RuntimeError('erase(): iterator out of range', line);
          d.splice(it.idx, 1);
          return undefined;
        }
      }
      throw new RuntimeError(`unsupported member function '.${e.name}()' on a vector/array`, line);
    }

    if (typeof obj === 'string') {
      switch (e.name) {
        case 'size': case 'length': return obj.length;
        case 'empty': return obj.length === 0;
        case 'push_back': this.lvalue(e.obj).set(obj + this.str(args[0], line)); return undefined;
        case 'pop_back': this.lvalue(e.obj).set(obj.slice(0, -1)); return undefined;
        case 'clear': this.lvalue(e.obj).set(''); return undefined;
        case 'back': case 'front': {
          if (obj.length === 0) throw new RuntimeError(`${e.name}() called on an empty string`, line);
          return new Chr(obj.charCodeAt(e.name === 'back' ? obj.length - 1 : 0));
        }
        case 'substr': {
          const pos = n(0);
          if (pos < 0 || pos > obj.length) throw new RuntimeError('substr: position out of range', line);
          return args.length > 1 ? obj.substr(pos, n(1)) : obj.slice(pos);
        }
        case 'find': {
          const needle = this.str(args[0], line);
          return obj.indexOf(needle, args.length > 1 ? n(1) : 0);
        }
        case 'append': this.lvalue(e.obj).set(obj + this.str(args[0], line)); return undefined;
      }
      throw new RuntimeError(`unsupported member function '.${e.name}()' on a string`, line);
    }
    throw new RuntimeError(`'.${e.name}()' cannot be called on this value`, line);
  }
}
