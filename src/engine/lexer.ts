import { CompileError } from './types';

export type TokKind = 'num' | 'str' | 'chr' | 'id' | 'op' | 'eof';

export interface Token {
  kind: TokKind;
  text: string;
  line: number;
  num?: number;
  float?: boolean;
  str?: string;
}

const OPS3 = ['<<=', '>>='];
const OPS2 = [
  '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '++', '--',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '->', '::',
];
const OPS1 = '+-*/%=<>!&|^~?:;,.(){}[]';

const ESCAPES: Record<string, number> = {
  n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39, '"': 34, a: 7, b: 8, f: 12, v: 11,
};

const NUM_RE = /0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

function lexInner(src: string, defines: Map<string, string>, startLine: number, directives: boolean): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = startLine;
  let lineStart = true;
  const n = src.length;

  while (i < n) {
    const ch = src[i];

    if (ch === '\n') { line++; i++; lineStart = true; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { i++; continue; }

    // comments
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const startL = line;
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      if (i >= n) throw new CompileError('unterminated /* comment', startL);
      i += 2;
      continue;
    }

    // preprocessor directives
    if (ch === '#' && directives && lineStart) {
      let j = i;
      let text = '';
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\' && src[j + 1] === '\n') { j += 2; line++; continue; }
        text += src[j];
        j++;
      }
      i = j;
      const m = /^#\s*define\s+([A-Za-z_]\w*)(\(?)\s*(.*)$/.exec(text.trim());
      if (m) {
        if (m[2] === '(') {
          throw new CompileError('function-like macros (#define NAME(x) ...) are not supported', line);
        }
        defines.set(m[1], m[3].replace(/\/\/.*$/, '').trim());
      }
      continue;
    }
    lineStart = false;

    // identifiers / keywords
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < n && /\w/.test(src[j])) j++;
      const text = src.slice(i, j);
      i = j;
      if (defines.has(text)) {
        out.push(...lexInner(defines.get(text)!, new Map(), line, false));
      } else {
        out.push({ kind: 'id', text, line });
      }
      continue;
    }

    // numbers
    if (/\d/.test(ch) || (ch === '.' && /\d/.test(src[i + 1] ?? ''))) {
      NUM_RE.lastIndex = i;
      const m = NUM_RE.exec(src);
      if (!m) throw new CompileError('invalid number literal', line);
      let text = m[0];
      i += text.length;
      const isHex = /^0[xX]/.test(text);
      let float = !isHex && /[.eE]/.test(text);
      const suffix = /^[uUlLfF]*/.exec(src.slice(i))![0];
      i += suffix.length;
      if (!isHex && /[fF]/.test(suffix)) float = true;
      out.push({ kind: 'num', text: text + suffix, line, num: isHex ? parseInt(text, 16) : parseFloat(text), float });
      continue;
    }

    // char literal
    if (ch === "'") {
      let j = i + 1;
      let code: number;
      if (src[j] === '\\') {
        const e = src[j + 1];
        if (!(e in ESCAPES)) throw new CompileError(`unknown escape sequence '\\${e}'`, line);
        code = ESCAPES[e];
        j += 2;
      } else if (j < n && src[j] !== "'" && src[j] !== '\n') {
        code = src.charCodeAt(j);
        j++;
      } else {
        throw new CompileError('empty or malformed character constant', line);
      }
      if (src[j] !== "'") throw new CompileError('multi-character or unterminated character constant', line);
      i = j + 1;
      out.push({ kind: 'chr', text: src.slice(j, j), line, num: code });
      continue;
    }

    // string literal
    if (ch === '"') {
      let j = i + 1;
      let s = '';
      while (j < n && src[j] !== '"') {
        if (src[j] === '\n') throw new CompileError('missing terminating " character', line);
        if (src[j] === '\\') {
          const e = src[j + 1];
          if (!(e in ESCAPES)) throw new CompileError(`unknown escape sequence '\\${e}'`, line);
          s += String.fromCharCode(ESCAPES[e]);
          j += 2;
        } else {
          s += src[j];
          j++;
        }
      }
      if (j >= n) throw new CompileError('missing terminating " character', line);
      i = j + 1;
      out.push({ kind: 'str', text: s, line, str: s });
      continue;
    }

    // operators
    const t3 = src.slice(i, i + 3);
    if (OPS3.includes(t3)) { out.push({ kind: 'op', text: t3, line }); i += 3; continue; }
    const t2 = src.slice(i, i + 2);
    if (OPS2.includes(t2)) { out.push({ kind: 'op', text: t2, line }); i += 2; continue; }
    if (OPS1.includes(ch)) { out.push({ kind: 'op', text: ch, line }); i++; continue; }

    throw new CompileError(`stray '${ch}' in program`, line);
  }
  return out;
}

export function lex(src: string): Token[] {
  const raw = lexInner(src, new Map(), 1, true);
  const toks: Token[] = [];
  // drop `std ::` qualifiers so that std::cout behaves like cout
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (t.kind === 'id' && t.text === 'std' && raw[i + 1]?.text === '::') {
      i++;
      continue;
    }
    toks.push(t);
  }
  const lastLine = toks.length ? toks[toks.length - 1].line : 1;
  toks.push({ kind: 'eof', text: '<end of file>', line: lastLine });
  return toks;
}
