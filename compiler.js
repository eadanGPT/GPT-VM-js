/*
  compiler.js
  - Pratt parser with unary & for relative addressing
  - Emits debug logs via debug.debugLog
*/
const debug = {};
debug.debug = false;
debug.debugLog = function (msg) {
if (debug.debug) console.log('[COMPILER] ' + msg);
};
export function compileHL(src, seed = 0x13572468) {
debug.debugLog('Compiler starting');
const tokens = lex(src);
let pos = 0;
const peek = (o = 0) => tokens[pos + o] || null;
const consume = () => tokens[pos++] || null;
const expect = (k, v) => {
const t = consume();
if (!t || t.k !== k || (v !== undefined && t.v !== v))
throw new Error(`Expected ${k} ${v || ''} but got ${t ? `${t.k} ${t.v}` : 'EOF'}`);
return t;
};
const strings = [];
const code = [];
let progLen = 0;
const OP = {
STOP: 0x00, PUSH_U8: 0x01, PUSH_I32: 0x10, ADD: 0x02, SUB: 0x03, DIV: 0x04, MOD: 0x05, MUL: 0x06, XOR: 0x07, NEG: 0x08,
AND: 0x1d, OR: 0x1e, SHL: 0x20, SHR: 0x21, USHR: 0x22, EQ: 0x24, NEQ: 0x25, GT: 0x26, LT: 0x27, GTE: 0x28, LTE: 0x29, NOT: 0x14,
JMP: 0x30, JZ: 0x31, JNZ: 0x32, PUSH_STR: 0x34, GET_IDX: 0x36, SET_IDX: 0x37, NEW_OBJ: 0x40, OBJ_SET: 0x41, NEW_ARR: 0x42, ARR_PUSH: 0x43,
DECL: 0x50, LOAD: 0x51, STORE: 0x52, LOAD_HOST: 0x53, MAKE_FN: 0x60, RET: 0x61, PUSH_SCOPE: 0x62, POP_SCOPE: 0x63, CALL_ANY: 0x73, CAST: 0x81, CUSTOM: 0xe0,
GEN_NEW: 0xa8, YIELD: 0xa9, GEN_RESUME: 0xaa,
MEM_SET_BASE: 0x90, MEM_GET_BASE: 0x91, MEM_READ: 0x92, MEM_WRITE: 0x93,
};
const emit = (op, ...args) => {
code.push(op, ...args);
progLen += 1 + args.length;
};
const strIdx = (s) => {
let i = strings.indexOf(s);
if (i < 0) {
strings.push(s);
i = strings.length - 1;
}
return i;
};
const jmpRel8 = () => {
const at = code.length;
emit(OP.JMP, 0);
return at;
};
const patchRel8 = (at, toPC) => {
const delta = toPC - (at + 1);
code[at + 1] = delta & 255;
};
// Pratt parser
const prec = {
'||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '<em>': 6, '/': 6, '%': 6, '^': 6, '<<': 7, '>>': 7, '>>>': 7
};
const binMap = {
'+': OP.ADD, '-': OP.SUB, '</em>': OP.MUL, '/': OP.DIV, '%': OP.MOD, '^': OP.XOR, '<<': OP.SHL, '>>': OP.SHR, '>>>': OP.USHR,
'<': OP.LT, '>': OP.GT, '<=': OP.LTE, '>=': OP.GTE, '==': OP.EQ, '!=': OP.NEQ
};
function emitI32(n) {
emit(
OP.PUSH_I32,
(n >>> 24) & 255,
(n >>> 16) & 255,
(n >>> 8) & 255,
(n >>> 0) & 255
);
}
function parsePrimary() {
const t = peek();
if (!t) throw new Error('EOF');
// Unary &: create ['&', offset]
if (t.k === 'sym' && t.v === '&') {
consume();
parseExpression(8); // bind tighter than shifts
emit(OP.PUSH_STR, strIdx('&'));
// stack: [..., offset, '&']
emit(OP.NEW_ARR, 2); // -> ['&', offset]
return;
}
if (t.k === 'bang4') {
consume();
const id = expect('id');
const name = id.v;
if (peek() && peek().k === 'sym' && peek().v === '(') {
consume(); // (
let argc = 0;
if (!(peek().k === 'sym' && peek().v === ')')) {
while (true) {
parseExpression(0);
argc++;
if (peek() && peek().k === 'sym' && peek().v === ',') {
consume();
continue;
}
break;
}
}
expect('sym', ')');
emit(OP.LOAD_HOST, strIdx(name));
emit(OP.CALL_ANY, argc & 255);
} else {
emit(OP.LOAD_HOST, strIdx(name));
}
return;
}
if (t.k === 'num') {
consume();
emitI32(t.v | 0);
return;
}
if (t.k === 'str') {
consume();
emit(OP.PUSH_STR, strIdx(t.v));
return;
}
if (t.k === 'id') {
consume();
if (peek() && peek().k === 'sym' && peek().v === '(') {
// call: id(args)
consume();
let argc = 0;
if (!(peek().k === 'sym' && peek().v === ')')) {
while (true) {
parseExpression(0);
argc++;
if (peek() && peek().k === 'sym' && peek().v === ',') {
consume();
continue;
}
break;
}
}
expect('sym', ')');
emit(OP.LOAD, strIdx(t.v));
emit(OP.CALL_ANY, argc & 255);
return;
}
// property or plain load
emit(OP.LOAD, strIdx(t.v));
return;
}
if (t.k === 'sym' && t.v === '(') {
consume();
parseExpression(0);
expect('sym', ')');
return;
}
if (t.k === 'sym' && t.v === '[') {
// Array literal [a,b,c]
consume();
let n = 0;
if (!(peek().k === 'sym' && peek().v === ']')) {
while (true) {
parseExpression(0);
n++;
if (peek() && peek().k === 'sym' && peek().v === ',') {
consume();
continue;
}
break;
}
}
expect('sym', ']');
emit(OP.NEW_ARR, n & 255);
return;
}
if (t.k === 'sym' && t.v === '{') {
// Object literal {a:1, b:2}
consume();
const keys = [];
const vals = [];
if (!(peek().k === 'sym' && peek().v === '}')) {
while (true) {
const keyTok = expect(peek().k === 'str' ? 'str' : 'id');
const key = keyTok.v;
expect('sym', ':');
parseExpression(0);
keys.push(key);
if (peek() && peek().k === 'sym' && peek().v === ',') {
consume();
continue;
}
break;
}
}
expect('sym', '}');
emit(OP.NEW_OBJ);
for (const k of keys) {
emit(OP.PUSH_STR, strIdx(k));
emit(OP.OBJ_SET);
}
return;
}
if (t.k === 'kw' && (t.v === 'function' || t.v === 'fn')) {
// Anonymous/local function: function name?(params){body}
consume();
let fname = '_<em>anon</em>' + code.length;
if (peek() && peek().k === 'id') {
fname = consume().v;
}
expect('sym', '(');
const params = [];
if (!(peek().k === 'sym' && peek().v === ')')) {
while (true) {
const id = expect('id');
params.push(id.v);
if (peek() && peek().k === 'sym' && peek().v === ',') {
consume();
continue;
}
break;
}
}
expect('sym', ')');
expect('sym', '{');
emit(OP.PUSH_SCOPE);
for (let i = 0; i < params.length; i++) {
emit(OP.DECL, strIdx('arg' + i), 0);
emit(OP.STORE, strIdx('arg' + i));
}
parseBlock();
emit(OP.POP_SCOPE);
expect('sym', '}');
emit(OP.MAKE_FN, strIdx(fname), params.length & 255, 0);
return;
}
throw new Error(`Unexpected token ${JSON.stringify(t)}`);
}
function parseMemberOrCall() {
parsePrimary();
while (true) {
const t = peek();
if (!t) break;
if (t.k === 'sym' && t.v === '[') {
consume();
parseExpression(0);
expect('sym', ']');
emit(OP.GET_IDX);
} else if (t.k === 'sym' && t.v === '.') {
consume();
const prop = expect('id');
emit(OP.PUSH_STR, strIdx(prop.v));
emit(OP.GET_IDX);
} else {
break;
}
}
}
function parseUnary() {
const t = peek();
if (t.k === 'sym' && (t.v === '-' || t.v === '!')) {
consume();
parseUnary();
emit(t.v === '-' ? OP.NEG : OP.NOT);
return;
}
parseMemberOrCall();
}
function parseExpression(pre = 0) {
parseUnary();
while (true) {
const t = peek();
if (!t || t.k !== 'sym') break;
const p = prec[t.v];
if (p === undefined || p < pre) break;
consume();
if (t.v === '||' || t.v === '&&') {
emit(t.v === '||' ? OP.OR : OP.AND);
} else {
parseExpression(p + 1);
emit(binMap[t.v]);
}
}
}
function parseAssignmentOrExpr() {
parseExpression();
const t = peek();
if (t && t.k === 'sym' && t.v === '=') {
consume();
parseAssignmentOrExpr();
emit(OP.STORE);
}
}
function parseStatement() {
const t = peek();
if (!t) return;
if (t.k === 'kw' && (t.v === 'let' || t.v === 'const' || t.v === 'var')) {
consume();
const id = expect('id');
const isConst = t.v === 'const' ? 1 : 0;
emit(OP.DECL, strIdx(id.v), isConst);
if (peek() && peek().k === 'sym' && peek().v === '=') {
consume();
parseExpression(0);
emit(OP.STORE, strIdx(id.v));
}
expect('sym', ';');
return;
}
if (t.k === 'kw' && t.v === 'return') {
consume();
if (!(peek().k === 'sym' && peek().v === ';')) parseExpression(0);
else emit(OP.PUSH_U8, 0);
emit(OP.RET);
expect('sym', ';');
return;
}
if (t.k === 'kw' && t.v === 'if') {
consume();
expect('sym', '(');
parseExpression(0);
expect('sym', ')');
const jzAt = code.length;
emit(OP.JZ, 0);
parseStatement();
if (peek() && peek().k === 'kw' && peek().v === 'else') {
consume();
const jmpEnd = code.length;
emit(OP.JMP, 0);
patchRel8(jzAt, code.length);
parseStatement();
patchRel8(jmpEnd, code.length);
} else {
patchRel8(jzAt, code.length);
}
return;
}
if (t.k === 'kw' && (t.v === 'while' || t.v === 'do' || t.v === 'for')) {
if (t.v === 'while') {
consume();
const loopStart = code.length;
expect('sym', '(');
parseExpression(0);
expect('sym', ')');
const jzAt = code.length;
emit(OP.JZ, 0);
parseStatement();
emit(OP.JMP, (loopStart - (code.length + 1)) & 255);
patchRel8(jzAt, code.length);
return;
}
if (t.v === 'do') {
consume();
const loopStart = code.length;
parseStatement();
expect('kw', 'while');
expect('sym', '(');
parseExpression(0);
expect('sym', ')');
if (peek() && peek().k === 'sym' && peek().v === ';') consume();
emit(OP.JNZ, (loopStart - (code.length + 1)) & 255);
return;
}
if (t.v === 'for') {
consume();
expect('sym', '(');
if (!(peek().k === 'sym' && peek().v === ';')) parseStatement();
else consume();
const condPC = code.length;
if (!(peek().k === 'sym' && peek().v === ';')) parseExpression(0);
else emit(OP.PUSH_U8, 1);
expect('sym', ';');
const jzAt = code.length;
emit(OP.JZ, 0);
const postPCJmpAt = code.length;
emit(OP.JMP, 0);
const postPC = code.length;
if (!(peek().k === 'sym' && peek().v === ')')) parseExpression(0);
expect('sym', ')');
const backToCondAt = code.length;
emit(OP.JMP, (condPC - (code.length + 1)) & 255);
patchRel8(postPCJmpAt, code.length);
parseStatement();
emit(OP.JMP, (postPC - (code.length + 1)) & 255);
patchRel8(jzAt, code.length);
return;
}
}
if (t.k === 'kw' && (t.v === 'function' || t.v === 'fn')) {
consume();
const id = expect('id').v;
expect('sym', '(');
const params = [];
if (!(peek().k === 'sym' && peek().v === ')')) {
while (true) {
const p = expect('id');
params.push(p.v);
if (peek() && peek().k === 'sym' && peek().v === ',') {
consume();
continue;
}
break;
}
}
expect('sym', ')');
expect('sym', '{');
emit(OP.PUSH_SCOPE);
for (let i = 0; i < params.length; i++) {
emit(OP.DECL, strIdx('arg' + i), 0);
emit(OP.STORE, strIdx('arg' + i));
}
parseBlock();
emit(OP.POP_SCOPE);
expect('sym', '}');
emit(OP.MAKE_FN, strIdx(id), params.length & 255, 0);
emit(OP.STORE, strIdx(id));
return;
}
parseAssignmentOrExpr();
if (peek() && peek().k === 'sym' && peek().v === ';') consume();
}
function parseBlock() {
while (peek() && !(peek().k === 'sym' && peek().v === '}')) parseStatement();
}
function parseProgram() {
while (peek()) parseStatement();
emit(OP.STOP);
}
// --- Lexer ---
function lex(s) {
const out = [];
let i = 0;
const isIdStart = (c) => /[A-Za-z_$]/.test(c);
const isId = (c) => /[A-Za-z0-9_$]/.test(c);
while (i < s.length) {
const c = s[i];
if (/\s/.test(c)) {
i++;
continue;
}
if (c === '/' && s[i + 1] === '/') {
while (i < s.length && s[i] !== '\n') {
i++;
}
continue;
}
if (c === '"' || c === "'") {
const q = c;
i++;
let str = '';
while (i < s.length && s[i] !== q) {
const ch = s[i];
if (ch === '\\') {
str += s[i + 1];
i += 2;
} else {
str += ch;
i++;
}
}
if (s[i] === q) i++;
out.push({ k: 'str', v: str });
continue;
}
if (/[0-9]/.test(c)) {
let n = '';
while (i < s.length && /[0-9]/.test(s[i])) {
n += s[i++];
}
out.push({ k: 'num', v: parseInt(n, 10) });
continue;
}
if (isIdStart(c)) {
let id = '';
while (i < s.length && isId(s[i])) id += s[i++];
const kw = new Set(['let', 'const', 'var', 'if', 'else', 'while', 'do', 'for', 'return', 'function', 'fn']);
out.push(kw.has(id) ? { k: 'kw', v: id } : { k: 'id', v: id });
continue;
}
const two = s.slice(i, i + 2);
const three = s.slice(i, i + 3);
if (['==', '!=', '<=', '>=', '<<', '>>', '&&', '||'].includes(two)) {
out.push({ k: 'sym', v: two });
i += 2;
continue;
}
if (['>>>'].includes(three)) {
out.push({ k: 'sym', v: three });
i += 3;
continue;
}
if ('<a href=""></a>{};:.,+-*/%^<>=&'.includes(c)) {
out.push({ k: 'sym', v: c });
i++;
continue;
}
if (s.slice(i, i + 4) === '!!!!') {
out.push({ k: 'bang4', v: '!!!!' });
i += 4;
continue;
}
i++;
}
return out;
}
parseProgram();
// Encode
const _PRNG = (seed) => {
let x = seed | 0;
return {
raw() {
x = (x * 1664525 + 1013904223) | 0;
return x >>> 0;
},
};
};
const Bytes = { u8(a, i) { return a[i] & 255; }, wr(a, i, v) { a[i] = v & 255; return i + 1; } };
const R = _PRNG(seed | 0);
const blinded = code.map((v) => (v ^ (R.raw() & 0xff)) & 0xff);
const final = [];
let q = 0;
q = Bytes.wr(final, q, 0xc3);
q = Bytes.wr(final, q, 0x04);
q = Bytes.wr(final, q, (seed >>> 24) & 255);
q = Bytes.wr(final, q, (seed >>> 16) & 255);
q = Bytes.wr(final, q, (seed >>> 8) & 255);
q = Bytes.wr(final, q, (seed >>> 0) & 255);
q = Bytes.wr(final, q, (blinded.length >>> 8) & 255);
q = Bytes.wr(final, q, (blinded.length >>> 0) & 255);
for (const b of blinded) q = Bytes.wr(final, q, b);
const metaWS = new Array(256).fill(0);
return { bytecode: Uint8Array.from(final), strings, metaWS };
}

