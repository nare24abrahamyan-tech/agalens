import { Interpreter } from './interpreter';
import { parse } from './parser';
import {
  ArrayVar,
  CompileError,
  DEFAULT_MAX_MILLIS,
  DEFAULT_MAX_STEPS,
  FunctionInfo,
  ProgramInfo,
  RunOptions,
  Step,
  TraceResult,
  Type,
  typeToString,
} from './types';

/** Marks which scalars / array cells changed compared with the previous step (same call frame). */
function markChanges(steps: Step[]): void {
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1];
    const cur = steps[i];
    if (prev.depth !== cur.depth || prev.func !== cur.func) continue;
    const before = new Map(prev.variables.map((v) => [v.name, v]));
    for (const v of cur.variables) {
      const p = before.get(v.name);
      if (!p || p.kind !== v.kind) continue;
      if (v.kind === 'scalar' && p.kind === 'scalar') {
        v.changed = v.value !== p.value;
      } else if (v.kind === 'array' && p.kind === 'array') {
        let any = v.length !== (p as ArrayVar).length;
        v.rows.forEach((row, r) => {
          const prow = (p as ArrayVar).rows[r];
          row.forEach((cell, c) => {
            const changed = !prow || !prow[c] || prow[c].s !== cell.s;
            if (changed) { cell.changed = true; any = true; }
          });
        });
        v.changed = any;
      }
    }
  }
}

/**
 * Parse and execute a C++ program, returning the full step-by-step trace.
 * Never throws: compile errors, runtime errors and limit hits are reported in the result.
 */
export function generateTrace(source: string, options: Partial<RunOptions> = {}): TraceResult {
  const opts: RunOptions = {
    stdin: options.stdin ?? '',
    entryCall: options.entryCall,
    maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
    maxMillis: options.maxMillis ?? DEFAULT_MAX_MILLIS,
  };
  const t0 = Date.now();
  try {
    const program = parse(source);
    const result = new Interpreter(program, opts).run();
    markChanges(result.steps);
    return result;
  } catch (e) {
    if (e instanceof CompileError) {
      return { steps: [], status: 'error', error: { kind: 'compile', message: e.message, line: e.line }, elapsedMs: Date.now() - t0 };
    }
    return {
      steps: [],
      status: 'error',
      error: { kind: 'runtime', message: `internal error: ${(e as Error)?.message ?? String(e)}` },
      elapsedMs: Date.now() - t0,
    };
  }
}

/** Lightweight static look at the code: does it have main(), and which functions does it define? */
export function analyzeProgram(source: string): ProgramInfo | null {
  try {
    const prog = parse(source);
    const functions: FunctionInfo[] = [...prog.funcs.values()]
      .flat()
      .filter((f) => f.name !== 'main')
      .map((f) => ({ name: f.name, ret: typeToString(f.ret), params: f.params.map((p) => ({ name: p.name, type: p.type })) }));
    return { hasMain: prog.funcs.has('main'), functions };
  } catch {
    return null;
  }
}

function sampleArg(t: Type): string {
  switch (t.name) {
    case 'int': case 'long': case 'unsigned': return '5';
    case 'float': case 'double': return '2.5';
    case 'char': return "'a'";
    case 'bool': return 'true';
    case 'string': return '"hello"';
    case 'vector': case 'array': {
      const e = t.elem;
      if (e && (e.name === 'vector' || e.name === 'array')) return '{{1, 2, 3}, {4, 5, 6}}';
      if (e && e.name === 'string') return '{"a", "bc", "def"}';
      return '{-2, 1, -3, 4, -1, 2, 1, -5, 4}';
    }
    default: return '0';
  }
}

/** A runnable example call for a function, e.g. `maxSubarraySum({-2, 1, -3, 4, -1, 2, 1, -5, 4})`. */
export function suggestCall(fn: FunctionInfo): string {
  return `${fn.name}(${fn.params.map((p) => sampleArg(p.type)).join(', ')})`;
}
