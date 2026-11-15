// ───────────────────────── Language types ─────────────────────────
export type TypeName =
  | 'int'
  | 'long'
  | 'unsigned'
  | 'char'
  | 'bool'
  | 'float'
  | 'double'
  | 'void'
  | 'string'
  | 'auto'
  | 'vector'
  | 'array';

export interface Type {
  name: TypeName;
  elem?: Type;
}

export function typeToString(t: Type): string {
  switch (t.name) {
    case 'long':
      return 'long long';
    case 'unsigned':
      return 'unsigned';
    case 'vector':
      return `vector<${t.elem ? typeToString(t.elem) : '?'}>`;
    case 'array':
      return t.elem ? typeToString(t.elem) : '?';
    default:
      return t.name;
  }
}

// ───────────────────────── Errors ─────────────────────────
export class CompileError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = 'CompileError';
    this.line = line;
  }
}

export class RuntimeError extends Error {
  line?: number;
  constructor(message: string, line?: number) {
    super(message);
    this.name = 'RuntimeError';
    this.line = line;
  }
}

export class LimitError extends Error {
  line?: number;
  reason: 'steps' | 'time';
  constructor(message: string, reason: 'steps' | 'time', line?: number) {
    super(message);
    this.name = 'LimitError';
    this.reason = reason;
    this.line = line;
  }
}

// ───────────────────────── AST ─────────────────────────
export type Expr =
  | { k: 'num'; v: number; float: boolean; line: number }
  | { k: 'str'; v: string; line: number }
  | { k: 'chr'; v: number; line: number }
  | { k: 'bool'; v: boolean; line: number }
  | { k: 'id'; name: string; line: number }
  | { k: 'bin'; op: string; l: Expr; r: Expr; line: number }
  | { k: 'un'; op: string; e: Expr; line: number }
  | { k: 'inc'; op: '++' | '--'; prefix: boolean; e: Expr; line: number }
  | { k: 'assign'; op: string; l: Expr; r: Expr; line: number }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr; line: number }
  | { k: 'call'; name: string; args: Expr[]; line: number }
  | { k: 'index'; base: Expr; idx: Expr; line: number }
  | { k: 'member'; obj: Expr; name: string; args: Expr[]; line: number }
  | { k: 'cast'; type: Type; e: Expr; line: number }
  | { k: 'construct'; type: Type; args: Expr[]; init?: Expr[]; line: number }
  | { k: 'initlist'; items: Expr[]; line: number }
  | { k: 'sizeof'; type?: Type; e?: Expr; line: number };

export interface DeclItem {
  name: string;
  dims: (Expr | null)[];
  init?: Expr;
  ctor?: Expr[];
}

export type Stmt =
  | { k: 'decl'; type: Type; items: DeclItem[]; line: number }
  | { k: 'expr'; e: Expr; line: number }
  | { k: 'if'; c: Expr; t: Stmt; f?: Stmt; line: number }
  | { k: 'while'; c: Expr; body: Stmt; line: number }
  | { k: 'dowhile'; c: Expr; body: Stmt; line: number; condLine: number }
  | { k: 'for'; init?: Stmt; c?: Expr; upd?: Expr; body: Stmt; line: number }
  | { k: 'rfor'; type: Type; ref: boolean; name: string; e: Expr; body: Stmt; line: number }
  | { k: 'return'; e?: Expr; line: number }
  | { k: 'break'; line: number }
  | { k: 'continue'; line: number }
  | { k: 'block'; body: Stmt[]; line: number }
  | { k: 'empty'; line: number };

export interface Param {
  name: string;
  type: Type;
  ref: boolean;
  isArray: boolean;
}

export interface FuncDecl {
  name: string;
  ret: Type;
  params: Param[];
  body: Stmt;
  line: number;
  endLine: number;
}

export interface Program {
  funcs: Map<string, FuncDecl[]>;
  globals: Stmt[];
}

// ───────────────────────── Trace model ─────────────────────────
export interface ArrayCell {
  /** numeric value (used for bar heights) */
  n: number;
  /** display label */
  s: string;
  /** true when this cell changed since the previous step */
  changed?: boolean;
}

export interface ScalarVar {
  kind: 'scalar';
  name: string;
  type: string;
  value: string;
  scope: 'local' | 'global';
  changed?: boolean;
}

export interface ArrayVar {
  kind: 'array';
  name: string;
  type: string;
  /** rows × cols. 1-D arrays have exactly one row. */
  rows: ArrayCell[][];
  length: number;
  truncated: boolean;
  scope: 'local' | 'global';
  changed?: boolean;
}

export type Variable = ScalarVar | ArrayVar;

export type AccessKind = 'read' | 'write' | 'swap';

export interface Highlight {
  name: string;
  row: number;
  col: number;
  kind: AccessKind;
}

export type StepStatus = 'running' | 'finished' | 'error' | 'limit';

export interface Step {
  /** 1-based step number */
  step: number;
  line: number;
  func: string;
  depth: number;
  stack: string[];
  variables: Variable[];
  stdout: string;
  status: StepStatus;
  highlights: Highlight[];
  message?: string;
}

export interface TraceError {
  kind: 'compile' | 'runtime' | 'limit';
  message: string;
  line?: number;
}

export interface TraceResult {
  steps: Step[];
  /** value returned by the entry function when the program has no main() */
  returnValue?: string;
  status: 'finished' | 'error' | 'limit';
  error?: TraceError;
  elapsedMs: number;
}

export interface RunOptions {
  /** e.g. `maxSubarraySum({1, -2, 3})`; used when the code has no main() */
  entryCall?: string;
  stdin: string;
  maxSteps: number;
  maxMillis: number;
}

export const DEFAULT_MAX_STEPS = 10_000;
export const DEFAULT_MAX_MILLIS = 5_000;

export interface FunctionInfo {
  name: string;
  ret: string;
  params: { name: string; type: Type }[];
}

export interface ProgramInfo {
  hasMain: boolean;
  /** user functions except main, in definition order */
  functions: FunctionInfo[];
}
