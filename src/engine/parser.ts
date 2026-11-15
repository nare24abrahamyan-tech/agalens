import { lex, Token } from './lexer';
import { CompileError, DeclItem, Expr, FuncDecl, Param, Program, Stmt, Type } from './types';

const TYPE_WORDS = new Set([
  'int', 'long', 'short', 'unsigned', 'signed', 'char', 'bool', 'float', 'double', 'void',
  'string', 'vector', 'auto', 'const', 'static', 'size_t', 'int64_t', 'uint64_t', 'int32_t',
  'uint32_t', 'int8_t', 'uint8_t', 'int16_t', 'uint16_t', 'll', 'ull',
]);

const BIN_PREC: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5,
  '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7,
  '<<': 8, '>>': 8,
  '+': 9, '-': 9,
  '*': 10, '/': 10, '%': 10,
};

const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

const T = (name: Type['name'], elem?: Type): Type => (elem ? { name, elem } : { name });

class Parser {
  private p = 0;
  private aliases = new Map<string, Type>();

  constructor(private toks: Token[]) {
    // `ll` / `ull` are such common competitive-programming aliases that we do not require a typedef
    // for them; a user typedef simply overrides these.
    this.aliases.set('ll', T('long'));
    this.aliases.set('ull', T('long'));
  }

  // ───── token helpers ─────
  private peek(o = 0): Token {
    return this.toks[Math.min(this.p + o, this.toks.length - 1)];
  }
  private next(): Token {
    const t = this.toks[this.p];
    if (this.p < this.toks.length - 1) this.p++;
    return t;
  }
  private isOp(text: string, o = 0): boolean {
    const t = this.peek(o);
    return t.kind === 'op' && t.text === text;
  }
  private isId(text: string, o = 0): boolean {
    const t = this.peek(o);
    return t.kind === 'id' && t.text === text;
  }
  private acceptOp(text: string): boolean {
    if (this.isOp(text)) { this.next(); return true; }
    return false;
  }
  private err(msg: string, tok: Token = this.peek()): never {
    throw new CompileError(msg, tok.line);
  }
  private expectOp(text: string, ctx = ''): Token {
    if (!this.isOp(text)) {
      const t = this.peek();
      this.err(`expected '${text}'${ctx ? ' ' + ctx : ''} but found '${t.kind === 'eof' ? 'end of file' : t.text}'`, t);
    }
    return this.next();
  }
  private expectId(ctx = 'identifier'): Token {
    const t = this.peek();
    if (t.kind !== 'id') this.err(`expected ${ctx} but found '${t.kind === 'eof' ? 'end of file' : t.text}'`, t);
    return this.next();
  }
  private skipTo(op: string): void {
    while (!this.isOp(op) && this.peek().kind !== 'eof') this.next();
    this.acceptOp(op);
  }

  // ───── types ─────
  private isTypeStart(t: Token = this.peek()): boolean {
    return t.kind === 'id' && (TYPE_WORDS.has(t.text) || this.aliases.has(t.text));
  }

  private closeAngle(): void {
    const t = this.peek();
    if (t.kind === 'op' && t.text === '>') { this.next(); return; }
    if (t.kind === 'op' && t.text === '>>') {
      // split `>>` into two `>` tokens (vector<vector<int>>)
      this.toks[this.p] = { ...t, text: '>' };
      return;
    }
    this.err(`expected '>' but found '${t.text}'`, t);
  }

  private parseType(): Type {
    while (this.peek().kind === 'id' && ['const', 'static', 'volatile', 'register'].includes(this.peek().text)) this.next();
    const t = this.next();
    if (t.kind !== 'id') this.err(`expected a type but found '${t.text}'`, t);
    let result: Type;
    switch (t.text) {
      case 'unsigned': {
        result = T('unsigned');
        if (this.isId('long')) { this.next(); if (this.isId('long')) this.next(); result = T('long'); }
        else if (this.isId('char')) { this.next(); result = T('char'); }
        else if (this.isId('int') || this.isId('short')) this.next();
        break;
      }
      case 'signed': {
        result = T('int');
        if (this.isId('long')) { this.next(); if (this.isId('long')) this.next(); result = T('long'); }
        else if (this.isId('char')) { this.next(); result = T('char'); }
        else if (this.isId('int') || this.isId('short')) this.next();
        break;
      }
      case 'long': {
        if (this.isId('long')) this.next();
        if (this.isId('double')) { this.next(); result = T('double'); break; }
        if (this.isId('int')) this.next();
        result = T('long');
        break;
      }
      case 'short':
        if (this.isId('int')) this.next();
        result = T('int');
        break;
      case 'int': case 'int32_t': case 'int16_t': result = T('int'); break;
      case 'uint32_t': case 'uint16_t': result = T('unsigned'); break;
      case 'int64_t': case 'uint64_t': case 'size_t': result = T('long'); break;
      case 'int8_t': case 'uint8_t': case 'char': result = T('char'); break;
      case 'bool': result = T('bool'); break;
      case 'float': result = T('float'); break;
      case 'double': result = T('double'); break;
      case 'void': result = T('void'); break;
      case 'string': result = T('string'); break;
      case 'auto': result = T('auto'); break;
      case 'vector': {
        this.expectOp('<', "after 'vector'");
        const elem = this.parseType();
        if (this.isOp('&') || this.isOp('*')) this.err('pointers and references inside templates are not supported');
        this.closeAngle();
        result = T('vector', elem);
        break;
      }
      default: {
        const alias = this.aliases.get(t.text);
        if (!alias) this.err(`unknown type name '${t.text}'`, t);
        result = alias;
      }
    }
    while (this.isId('const')) this.next();
    return result;
  }

  // ───── program ─────
  parseEntryExpression(): Expr {
    const e = this.parseExpr();
    if (this.peek().kind !== 'eof') this.err(`unexpected '${this.peek().text}' after the function call`);
    return e;
  }

  parseProgram(): Program {
    const funcs = new Map<string, FuncDecl[]>();
    const globals: Stmt[] = [];

    while (this.peek().kind !== 'eof') {
      const t = this.peek();

      if (this.isId('using')) {
        this.next();
        if (this.isId('namespace')) { this.skipTo(';'); continue; }
        const name = this.expectId('alias name').text;
        this.expectOp('=');
        const type = this.parseType();
        this.expectOp(';');
        this.aliases.set(name, type);
        continue;
      }
      if (this.isId('typedef')) {
        this.next();
        const type = this.parseType();
        const name = this.expectId('alias name').text;
        this.expectOp(';');
        this.aliases.set(name, type);
        continue;
      }
      if (['struct', 'class', 'enum', 'union', 'template', 'namespace'].includes(t.text) && t.kind === 'id') {
        this.err(`'${t.text}' is not supported by this interpreter yet (supported: functions, scalars, arrays, vector, string)`, t);
      }
      if (this.isOp(';')) { this.next(); continue; }

      if (!this.isTypeStart(t)) {
        this.err(`expected a declaration but found '${t.text}'`, t);
      }

      const typeTok = this.peek();
      const type = this.parseType();
      let isRef = false;
      if (this.acceptOp('&')) isRef = true;
      if (this.isOp('*')) this.err('pointers are not supported by this interpreter yet', this.peek());
      const nameTok = this.peek();
      if (nameTok.kind !== 'id') this.err(`expected a name but found '${nameTok.text}'`, nameTok);

      if (this.isOp('(', 1)) {
        this.next(); // name
        funcs.set(nameTok.text, [...(funcs.get(nameTok.text) ?? []), this.parseFunction(type, nameTok)]);
      } else {
        if (isRef) this.err('global references are not supported', typeTok);
        const items = this.parseDeclarators();
        this.expectOp(';', 'after declaration');
        globals.push({ k: 'decl', type, items, line: typeTok.line });
      }
    }
    return { funcs, globals };
  }

  private parseFunction(ret: Type, nameTok: Token): FuncDecl {
    this.expectOp('(');
    const params: Param[] = [];
    if (nameTok.text === 'main') {
      // ignore argc/argv
      let depth = 1;
      while (depth > 0 && this.peek().kind !== 'eof') {
        const t = this.next();
        if (t.text === '(') depth++;
        if (t.text === ')') depth--;
      }
    } else {
      if (this.isId('void') && this.isOp(')', 1)) this.next();
      while (!this.isOp(')')) {
        if (params.length > 0) this.expectOp(',', 'between parameters');
        const type = this.parseType();
        let ref = false;
        if (this.acceptOp('&')) ref = true;
        if (this.isOp('*')) this.err('pointer parameters are not supported by this interpreter yet');
        const pname = this.expectId('parameter name').text;
        let isArray = false;
        while (this.isOp('[')) {
          this.next();
          if (!this.isOp(']')) this.parseAssign();
          this.expectOp(']');
          isArray = true;
        }
        params.push({ name: pname, type: isArray ? T('array', type) : type, ref, isArray });
        if (this.peek().kind === 'eof') this.err("expected ')'");
      }
      this.expectOp(')');
    }
    if (this.isOp(';')) this.err(`function '${nameTok.text}' is declared but not defined (forward declarations are not needed here; define it before use)`, nameTok);
    const open = this.expectOp('{', 'to start the function body');
    const body = this.parseBlockBody(open.line);
    const endLine = this.toks[this.p - 1].line;
    return { name: nameTok.text, ret, params, body, line: nameTok.line, endLine };
  }

  // ───── statements ─────
  private parseBlockBody(line: number): Stmt {
    const body: Stmt[] = [];
    while (!this.isOp('}')) {
      if (this.peek().kind === 'eof') this.err("expected '}' before end of file");
      body.push(this.parseStatement());
    }
    this.expectOp('}');
    return { k: 'block', body, line };
  }

  private parseDeclarators(): DeclItem[] {
    const items: DeclItem[] = [];
    do {
      if (this.isOp('*')) this.err('pointers are not supported by this interpreter yet');
      if (this.isOp('&')) this.err('local references are not supported by this interpreter yet');
      const name = this.expectId('variable name').text;
      const dims: (Expr | null)[] = [];
      while (this.isOp('[')) {
        this.next();
        dims.push(this.isOp(']') ? null : this.parseAssign());
        this.expectOp(']');
      }
      const item: DeclItem = { name, dims };
      if (this.acceptOp('=')) {
        item.init = this.parseInitializer();
      } else if (this.isOp('(')) {
        this.next();
        item.ctor = this.parseArgs();
      } else if (this.isOp('{')) {
        item.init = this.parseInitializer();
      }
      items.push(item);
    } while (this.acceptOp(','));
    return items;
  }

  private parseInitializer(): Expr {
    if (this.isOp('{')) {
      const open = this.next();
      const items: Expr[] = [];
      while (!this.isOp('}')) {
        items.push(this.parseInitializer());
        if (!this.acceptOp(',')) break;
      }
      this.expectOp('}', 'to close the initializer list');
      return { k: 'initlist', items, line: open.line };
    }
    return this.parseAssign();
  }

  private parseArgs(): Expr[] {
    // assumes '(' already consumed
    const args: Expr[] = [];
    while (!this.isOp(')')) {
      if (args.length > 0) this.expectOp(',', 'between arguments');
      args.push(this.parseInitializer());
      if (this.peek().kind === 'eof') this.err("expected ')'");
    }
    this.expectOp(')');
    return args;
  }

  private parseStatement(): Stmt {
    const t = this.peek();
    const line = t.line;

    if (this.isOp('{')) {
      this.next();
      return this.parseBlockBody(line);
    }
    if (this.isOp(';')) { this.next(); return { k: 'empty', line }; }

    if (t.kind === 'id') {
      // iostream tuning lines that have no visual meaning
      if (t.text === 'ios' || t.text === 'ios_base' ||
          ((t.text === 'cin' || t.text === 'cout') && this.isOp('.', 1) && this.isId('tie', 2))) {
        this.skipTo(';');
        return { k: 'empty', line };
      }
      switch (t.text) {
        case 'if': return this.parseIf();
        case 'while': return this.parseWhile();
        case 'do': return this.parseDoWhile();
        case 'for': return this.parseFor();
        case 'return': {
          this.next();
          const e = this.isOp(';') ? undefined : this.parseExpr();
          this.expectOp(';', "after 'return'");
          return { k: 'return', e, line };
        }
        case 'break': this.next(); this.expectOp(';'); return { k: 'break', line };
        case 'continue': this.next(); this.expectOp(';'); return { k: 'continue', line };
        case 'switch': case 'goto': case 'try': case 'throw': case 'struct': case 'class': case 'enum': case 'new': case 'delete':
          this.err(`'${t.text}' is not supported by this interpreter yet`, t);
      }
      if (this.isTypeStart(t) && !this.isOp('(', 1)) {
        const type = this.parseType();
        const items = this.parseDeclarators();
        this.expectOp(';', 'after declaration');
        return { k: 'decl', type, items, line };
      }
    }

    const e = this.parseExpr();
    this.expectOp(';', 'after expression');
    return { k: 'expr', e, line };
  }

  private parseCondition(): Expr {
    this.expectOp('(', 'before condition');
    const c = this.parseExpr();
    this.expectOp(')', 'after condition');
    return c;
  }

  private parseIf(): Stmt {
    const line = this.next().line;
    const c = this.parseCondition();
    const t = this.parseStatement();
    let f: Stmt | undefined;
    if (this.isId('else')) { this.next(); f = this.parseStatement(); }
    return { k: 'if', c, t, f, line };
  }

  private parseWhile(): Stmt {
    const line = this.next().line;
    const c = this.parseCondition();
    const body = this.parseStatement();
    return { k: 'while', c, body, line };
  }

  private parseDoWhile(): Stmt {
    const line = this.next().line;
    const body = this.parseStatement();
    if (!this.isId('while')) this.err("expected 'while' after do-body");
    const condLine = this.next().line;
    const c = this.parseCondition();
    this.expectOp(';', 'after do-while');
    return { k: 'dowhile', c, body, line, condLine };
  }

  private parseFor(): Stmt {
    const line = this.next().line;
    this.expectOp('(', "after 'for'");

    // range-based for:  for (auto& x : v)
    if (this.isTypeStart()) {
      const save = this.p;
      try {
        const type = this.parseType();
        const ref = this.acceptOp('&');
        const nameTok = this.peek();
        if (nameTok.kind === 'id' && this.isOp(':', 1)) {
          this.next();
          this.next();
          const e = this.parseExpr();
          this.expectOp(')');
          const body = this.parseStatement();
          return { k: 'rfor', type, ref, name: nameTok.text, e, body, line };
        }
      } catch (err) {
        if (!(err instanceof CompileError)) throw err;
      }
      this.p = save;
    }

    let init: Stmt | undefined;
    if (!this.isOp(';')) {
      if (this.isTypeStart()) {
        const dl = this.peek().line;
        const type = this.parseType();
        init = { k: 'decl', type, items: this.parseDeclarators(), line: dl };
      } else {
        const e = this.parseExpr();
        init = { k: 'expr', e, line: e.line };
      }
    }
    this.expectOp(';', 'in for-loop header');
    const c = this.isOp(';') ? undefined : this.parseExpr();
    this.expectOp(';', 'in for-loop header');
    const upd = this.isOp(')') ? undefined : this.parseExpr();
    this.expectOp(')', 'to close the for-loop header');
    const body = this.parseStatement();
    return { k: 'for', init, c, upd, body, line };
  }

  // ───── expressions ─────
  parseExpr(): Expr {
    let e = this.parseAssign();
    while (this.isOp(',')) {
      const line = this.next().line;
      e = { k: 'bin', op: ',', l: e, r: this.parseAssign(), line };
    }
    return e;
  }

  private parseAssign(): Expr {
    const l = this.parseCond();
    const t = this.peek();
    if (t.kind === 'op' && ASSIGN_OPS.has(t.text)) {
      this.next();
      const r = this.parseAssign();
      return { k: 'assign', op: t.text, l, r, line: t.line };
    }
    return l;
  }

  private parseCond(): Expr {
    const c = this.parseBinary(1);
    if (this.isOp('?')) {
      const line = this.next().line;
      const a = this.parseAssign();
      this.expectOp(':', 'in conditional expression');
      const b = this.parseAssign();
      return { k: 'cond', c, a, b, line };
    }
    return c;
  }

  private parseBinary(minPrec: number): Expr {
    let l = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.kind !== 'op') break;
      const prec = BIN_PREC[t.text];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const r = this.parseBinary(prec + 1);
      l = { k: 'bin', op: t.text, l, r, line: t.line };
    }
    return l;
  }

  private parseUnary(): Expr {
    const t = this.peek();
    if (t.kind === 'op') {
      if (t.text === '-' || t.text === '+' || t.text === '!' || t.text === '~') {
        this.next();
        return { k: 'un', op: t.text, e: this.parseUnary(), line: t.line };
      }
      if (t.text === '++' || t.text === '--') {
        this.next();
        return { k: 'inc', op: t.text, prefix: true, e: this.parseUnary(), line: t.line };
      }
      if (t.text === '*' || t.text === '&') {
        this.err('pointers / address-of are not supported by this interpreter yet', t);
      }
      if (t.text === '(' && this.isTypeStart(this.peek(1))) {
        const save = this.p;
        this.next();
        try {
          const type = this.parseType();
          if (this.isOp(')')) {
            this.next();
            return { k: 'cast', type, e: this.parseUnary(), line: t.line };
          }
        } catch (err) {
          if (!(err instanceof CompileError)) throw err;
        }
        this.p = save;
      }
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.kind !== 'op') break;
      if (t.text === '[') {
        this.next();
        const idx = this.parseExpr();
        this.expectOp(']', 'after index');
        e = { k: 'index', base: e, idx, line: t.line };
      } else if (t.text === '.') {
        this.next();
        const name = this.expectId('member name').text;
        let args: Expr[] = [];
        if (this.isOp('(')) { this.next(); args = this.parseArgs(); }
        else this.err(`data member '.${name}' is not supported; only method calls such as .size() are`, t);
        e = { k: 'member', obj: e, name, args, line: t.line };
      } else if (t.text === '++' || t.text === '--') {
        this.next();
        e = { k: 'inc', op: t.text, prefix: false, e, line: t.line };
      } else if (t.text === '->') {
        this.err('pointers are not supported by this interpreter yet', t);
      } else break;
    }
    return e;
  }

  private parsePrimary(): Expr {
    const t = this.next();
    switch (t.kind) {
      case 'num': return { k: 'num', v: t.num!, float: !!t.float, line: t.line };
      case 'str': return { k: 'str', v: t.str!, line: t.line };
      case 'chr': return { k: 'chr', v: t.num!, line: t.line };
      case 'op':
        if (t.text === '(') {
          const e = this.parseExpr();
          this.expectOp(')', 'to close the parenthesis');
          return e;
        }
        break;
      case 'id': {
        if (t.text === 'true') return { k: 'bool', v: true, line: t.line };
        if (t.text === 'false') return { k: 'bool', v: false, line: t.line };

        if (t.text === 'sizeof') {
          this.expectOp('(', "after 'sizeof'");
          if (this.isTypeStart()) {
            const type = this.parseType();
            this.expectOp(')');
            return { k: 'sizeof', type, line: t.line };
          }
          const e = this.parseExpr();
          this.expectOp(')');
          return { k: 'sizeof', e, line: t.line };
        }

        if (t.text === 'static_cast' || t.text === 'reinterpret_cast' || t.text === 'const_cast') {
          this.expectOp('<');
          const type = this.parseType();
          this.closeAngle();
          this.expectOp('(');
          const e = this.parseExpr();
          this.expectOp(')');
          return { k: 'cast', type, e, line: t.line };
        }

        // temporary construction:  vector<int>(n, 0)   string(3, 'x')
        if ((t.text === 'vector' && this.isOp('<')) || (t.text === 'string' && this.isOp('('))) {
          this.p--; // re-read type
          const type = this.parseType();
          if (this.isOp('(')) {
            this.next();
            return { k: 'construct', type, args: this.parseArgs(), line: t.line };
          }
          if (this.isOp('{')) {
            const init = this.parseInitializer();
            return { k: 'construct', type, args: [], init: init.k === 'initlist' ? init.items : [], line: t.line };
          }
          this.err("expected '(' or '{' after type in expression", this.peek());
        }

        // scope resolution such as string::npos
        if (this.isOp('::') && this.peek(1).kind === 'id') {
          this.next();
          const member = this.next().text;
          return { k: 'id', name: `${t.text}::${member}`, line: t.line };
        }

        if (this.isOp('(')) {
          this.next();
          return { k: 'call', name: t.text, args: this.parseArgs(), line: t.line };
        }
        return { k: 'id', name: t.text, line: t.line };
      }
    }
    return this.err(`expected an expression but found '${t.kind === 'eof' ? 'end of file' : t.text}'`, t);
  }
}

export function parse(source: string): Program {
  const toks = lex(source);
  const parser = new Parser(toks);
  return parser.parseProgram();
}

/** Parses a single expression such as `solve({1, 2, 3}, 5)` (used for the entry call when there is no main). */
export function parseExpression(source: string): Expr {
  return new Parser(lex(source)).parseEntryExpression();
}
