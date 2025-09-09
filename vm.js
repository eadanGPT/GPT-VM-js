
/*
  vm.js
  - Unified debug logger
  - Helper memory opcodes with absolute and relative (&) addressing
  - Instruction-level logging at every operation
  - Safer stack/state logging and improved error context
*/
import Memory2D from './memory.js';
export function makeVM(hostAPI = {}) {
// Host shims
if (!hostAPI.print) hostAPI.print = (...a) => console.log(...a);
if (!hostAPI.exit)
	hostAPI.exit = (code = 1, msg = 'VM exit') => {
		const e = Object.assign(new Error(msg), { code });
	throw e;
};
if (!hostAPI.req) hostAPI.req = (name) => hostAPI[name];
if (!hostAPI.serialize)
hostAPI.serialize = (v) => {
if (v === null || v === undefined) return 0;
if (typeof v === 'number') return v | 0;
if (typeof v === 'boolean') return v ? 1 : 0;
if (typeof v === 'string') {
const n = +v;
return Number.isFinite(n) ? n | 0 : v.length | 0;
}
if (Array.isArray(v)) return v.length | 0;
if (v && typeof v === 'object') return Object.keys(v).length | 0;
if (typeof v === 'function') return 0;
return 0;
};
// Unified debug

hostAPI.debugLog = function (...msg) {
//if (!hostAPI.debug) return;
let level = msg.length > 1 ? msg.splice(msg.length-1)[0] : "ERR";
msg = msg.join("|");
const ts = new Date().toISOString();
console.log(`[${level.toUpperCase()} ${ts}] ${msg}`);
}

//hostAPI.debugLog('Registers initialized on global vm');
// Optional Memory2D
const memory =
hostAPI.memory ||
(typeof Memory2D !== 'undefined' ? new Memory2D(hostAPI) : null);
hostAPI.debugLog("initialized", "Memory");
const strings = hostAPI.__strings || [];
const makeEnv = (parent = null) => ({
parent,
map: Object.create(null),
consts: Object.create(null),
});
const state = {
IP: 0,
SP: 0,
halt: false,
stack: new Array(1 << 14).fill(null),
frames: [], // { ret, env }
env: makeEnv(null),
strings,
seed: hostAPI.seed || 0x13572468,
steps: 0,
memBase: 0 >>> 0, // base for relative (&) addressing
toJS(x) {
return x;
},
fromJS(x) {
return x;
},
};
// Helpers
const bin =
(f) =>
(st) => {
const b = st.stack[--st.SP];
const a = st.stack[--st.SP];
st.stack[st.SP++] = f(a, b);
};
const cmp =
(f) =>
(st) => {
const b = st.stack[--st.SP];
const a = st.stack[--st.SP];
st.stack[st.SP++] = f(a, b) ? 1 : 0;
};
const logic =
(f) =>
(st) => {
const b = !!st.stack[--st.SP];
const a = !!st.stack[--st.SP];
st.stack[st.SP++] = f(a, b) ? 1 : 0;
};
// Env ops
function decl(st, name, isConst) {
const e = st.env;
if (Object.prototype.hasOwnProperty.call(e.map, name))
hostAPI.exit(300, `Redeclare ${name} @IP=${st.IP}`);
e.map[name] = undefined;
if (isConst) e.consts[name] = true;
}
function load(st, name) {
for (let e = st.env; e; e = e.parent) {
if (Object.prototype.hasOwnProperty.call(e.map, name)) return e.map[name];
}
return undefined;
}
function store(st, name, v) {
for (let e = st.env; e; e = e.parent) {
if (Object.prototype.hasOwnProperty.call(e.map, name)) {
if (e.consts[name]) hostAPI.exit(301, `Assign to const ${name} @IP=${st.IP}`);
e.map[name] = v;
return v;
}
}
st.env.map[name] = v;
return v;
}
// Type ops
function typeAssert(val, type) {
if (!type || type === 'any' || type === 'unknown') return true;
if (type === 'number' && typeof val !== 'number') hostAPI.exit(100, 'Type number expected');
if (type === 'string' && typeof val !== 'string') hostAPI.exit(101, 'Type string expected');
if (type === 'boolean' && typeof val !== 'boolean') hostAPI.exit(102, 'Type boolean expected');
if (type === 'object' && (typeof val !== 'object' || val === null)) hostAPI.exit(103, 'Type object expected');
if (type === 'function' && typeof val !== 'function') hostAPI.exit(104, 'Type function expected');
return true;
}
function cast(val, toType) {
switch (toType) {
case 'number':
return typeof val === 'number'
? val
: typeof val === 'string'
? +val | 0
: hostAPI.serialize(val) | 0;
case 'string':
return String(val);
case 'boolean':
return !!val;
default:
return val;
}
}
// Address helper: supports absolute number, or relative ['&', offset]
function resolveAddress(addrOrRel) {
if (Array.isArray(addrOrRel) && addrOrRel.length === 2 && addrOrRel[0] === '&') {
const off = addrOrRel[1] | 0;
const resolved = (state.memBase + off) >>> 0;
hostAPI.debugLog(`ADDR resolve &${off} (base=${state.memBase}) -> ${resolved}`);
return resolved;
}
if (typeof addrOrRel === 'number') return addrOrRel >>> 0;
hostAPI.exit(605, `Invalid address type: ${typeof addrOrRel}`);
}
// === Opcodes ===
const D = new Array(256).fill((st) => {
st.halt = false;
});
// Core/immediates
D[0x00] = (st) => {
st.halt = true;
}; // STOP
D[0x01] = (st, fetch) => {
st.stack[st.SP++] = fetch();
}; // PUSH_U8
D[0x10] = (st, fetch) => {
let v = (fetch() << 24) | (fetch() << 16) | (fetch() << 8) | fetch();
v = v | 0;
st.stack[st.SP++] = v;
}; // PUSH_I32
D[0x34] = (st, fetch) => {
const i = fetch();
st.stack[st.SP++] = st.strings[i];
}; // PUSH_STR
// Math
D[0x02] = bin((a, b) => (a | 0) + (b | 0)); // ADD
D[0x03] = bin((a, b) => (a | 0) - (b | 0)); // SUB
D[0x06] = bin((a, b) => (a | 0) * (b | 0)); // MUL
D[0x04] = bin((a, b) => (b === 0 ? 0 : Math.floor(a / b)) | 0); // DIV
D[0x05] = bin((a, b) => (b === 0 ? 0 : a % b) | 0); // MOD
D[0x07] = bin((a, b) => (a | 0) ^ (b | 0)); // XOR
D[0x1d] = bin((a, b) => (a | 0) & (b | 0)); // AND
D[0x1e] = bin((a, b) => (a | 0) | (b | 0)); // OR
D[0x20] = bin((a, b) => (a | 0) << (b & 31)); // SHL
D[0x21] = bin((a, b) => (a | 0) >> (b & 31)); // SHR
D[0x22] = bin((a, b) => (a >>> 0) >>> (b & 31)); // USHR
D[0x08] = (st) => {
st.stack[st.SP - 1] = -st.stack[st.SP - 1] | 0;
}; // NEG
D[0x14] = (st) => {
st.stack[st.SP - 1] = st.stack[st.SP - 1] ? 0 : 1;
}; // NOT
// Comparisons
D[0x24] = cmp((a, b) => a === b); // EQ
D[0x25] = cmp((a, b) => a !== b); // NEQ
D[0x26] = cmp((a, b) => a > b); // GT
D[0x27] = cmp((a, b) => a < b); // LT
D[0x28] = cmp((a, b) => a >= b); // GTE
D[0x29] = cmp((a, b) => a <= b); // LTE
// Branches
D[0x30] = (st, fetch) => {
const rel = (fetch() << 24) >> 24;
st.IP += rel;
}; // JMP
D[0x31] = (st, fetch) => {
const rel = (fetch() << 24) >> 24;
const c = st.stack[--st.SP];
if (!c) st.IP += rel;
}; // JZ
D[0x32] = (st, fetch) => {
const rel = (fetch() << 24) >> 24;
const c = st.stack[--st.SP];
if (c) st.IP += rel;
}; // JNZ
// Objects/arrays
D[0x40] = (st) => {
st.stack[st.SP++] = {};
}; // NEW_OBJ
D[0x41] = (st) => {
const key = st.stack[--st.SP];
const val = st.stack[--st.SP];
const obj = st.stack[st.SP - 1];
if (obj && typeof obj === 'object') obj[key] = val;
}; // OBJ_SET
D[0x42] = (st, fetch) => {
const n = fetch();
const arr = new Array(n);
for (let i = n - 1; i >= 0; i--) arr[i] = st.stack[--st.SP];
st.stack[st.SP++] = arr;
}; // NEW_ARR
D[0x43] = (st) => {
const val = st.stack[--st.SP];
const arr = st.stack[st.SP - 1];
if (Array.isArray(arr)) arr.push(val);
}; // ARR_PUSH
D[0x36] = (st) => {
const key = st.stack[--st.SP];
const obj = st.stack[--st.SP];
st.stack[st.SP++] = obj ? obj[key] : undefined;
}; // GET_IDX
D[0x37] = (st) => {
const val = st.stack[--st.SP];
const key = st.stack[--st.SP];
const obj = st.stack[--st.SP];
if (obj) obj[key] = val;
st.stack[st.SP++] = val;
}; // SET_IDX
// Variables
D[0x50] = (st, fetch) => {
const i = fetch();
const flags = fetch();
decl(st, st.strings[i], flags & 1);
}; // DECL
D[0x51] = (st, fetch) => {
const i = fetch();
st.stack[st.SP++] = load(st, st.strings[i]);
}; // LOAD
D[0x52] = (st, fetch) => {
const i = fetch();
const v = st.stack[--st.SP];
store(st, st.strings[i], v);
}; // STORE
D[0x53] = (st, fetch) => {
const i = fetch();
const name = st.strings[i];
const v = hostAPI.req(name);
st.stack[st.SP++] = v;
}; // LOAD_HOST
// Scopes
D[0x62] = (st) => {
st.env = makeEnv(st.env);
}; // PUSH_SCOPE
D[0x63] = (st) => {
st.env = st.env.parent || makeEnv(null);
}; // POP_SCOPE
// Functions
D[0x60] = (st, fetch) => {
const nameIdx = fetch();
const name = st.strings[nameIdx];
const nparams = fetch();
const codeOfs = fetch();
const fn = function (...args) {
const saved = { IP: st.IP, env: st.env };
st.frames.push(saved);
st.env = makeEnv(fn.env);
for (let i = 0; i < nparams; i++) store(st, `arg${i}`, args[i]);
st.IP = codeOfs;
while (!st.halt) {
	hostAPI.debugLog(`CALL/STEP INTRO op=0x${op.toString(16)} IP=${st.IP}`, 'trace');
const op = fetchByte();
const handler = D[op];
if (!handler) throw new Error(`Invalid opcode: ${op}`);
hostAPI.debugLog(`CALL/STEP op=0x${op.toString(16)} IP=${st.IP}`, 'trace');
handler(st, fetchByte);
if (st._ret_flag) {
const rv = st._ret_val;
st._ret_flag = false;
const top = st.frames.pop();
st.env = top.env;
st.IP = top.IP;
return rv;
}
}
const top = st.frames.pop();
st.env = top.env;
st.IP = top.IP;
return undefined;
};
fn.env = st.env;
store(st, name, fn);
st.stack[st.SP++] = fn;
};
D[0x61] = (st) => {
const v = st.stack[--st.SP];
st._ret_val = v;
st._ret_flag = true;
}; // RET value
D[0x73] = (st, fetch) => {
const argc = fetch();
const fn = st.stack[st.SP - 1 - argc];
const args = new Array(argc);
for (let i = argc - 1; i >= 0; i--) args[i] = st.stack[--st.SP];
st.SP--;
const rv = typeof fn === 'function' ? fn(...args) : undefined;
st.stack[st.SP++] = rv;
}; // CALL_ANY
// Cast
D[0x81] = (st, fetch) => {
const t = st.strings[fetch()];
const v = st.stack[--st.SP];
st.stack[st.SP++] = cast(v, t);
};
// Custom host op via !!!!NAME tokens
D[0xe0] = (st, fetch) => {
const name = st.strings[fetch()];
const fn = hostAPI.ops && hostAPI.ops[name];
if (!fn) console.log("NOBANG!");
const out = fn(st, fetch, hostAPI);
if (out !== undefined) st.stack[st.SP++] = out;
};
// Minimal generator stubs (no TRY/FINALLY integration)
D[0xa8] = (st) => {
const fn = st.stack[--st.SP];
const gen = (function* () {
const rv = fn();
return rv;
})();
st.stack[st.SP++] = gen;
};
D[0xa9] = (st) => {
const v = st.stack[--st.SP];
st.stack[st.SP++] = v;
}; // YIELD no-op placeholder
D[0xaa] = (st) => {
const gen = st.stack[--st.SP];
const send = st.stack[--st.SP];
const r = gen.next(send);
st.stack[st.SP++] = r.value;
};
// Memory helper opcodes
const OP = {
STOP: 0x00,
PUSH_U8: 0x01,
PUSH_I32: 0x10,
ADD: 0x02,
SUB: 0x03,
DIV: 0x04,
MOD: 0x05,
MUL: 0x06,
XOR: 0x07,
NEG: 0x08,
AND: 0x1d,
OR: 0x1e,
SHL: 0x20,
SHR: 0x21,
USHR: 0x22,
EQ: 0x24,
NEQ: 0x25,
GT: 0x26,
LT: 0x27,
GTE: 0x28,
LTE: 0x29,
NOT: 0x14,
JMP: 0x30,
JZ: 0x31,
JNZ: 0x32,
PUSH_STR: 0x34,
GET_IDX: 0x36,
SET_IDX: 0x37,
NEW_OBJ: 0x40,
OBJ_SET: 0x41,
NEW_ARR: 0x42,
ARR_PUSH: 0x43,
DECL: 0x50,
LOAD: 0x51,
STORE: 0x52,
LOAD_HOST: 0x53,
MAKE_FN: 0x60,
RET: 0x61,
PUSH_SCOPE: 0x62,
POP_SCOPE: 0x63,
CALL_ANY: 0x73,
CAST: 0x81,
CUSTOM: 0xe0,
GEN_NEW: 0xa8,
YIELD: 0xa9,
GEN_RESUME: 0xaa,
MEM_SET_BASE: 0x90,
MEM_GET_BASE: 0x91,
MEM_READ: 0x92,
MEM_WRITE: 0x93,
};
D[OP.MEM_SET_BASE] = (st) => {
const base = st.stack[--st.SP] >>> 0;
st.memBase = base;
st.stack[st.SP++] = base;
};
D[OP.MEM_GET_BASE] = (st) => {
st.stack[st.SP++] = st.memBase >>> 0;
};
D[OP.MEM_READ] = (st) => {
const addrOrRel = st.stack[--st.SP];
const addr = resolveAddress(addrOrRel);
if (!memory) hostAPI.exit(600, 'No memory backend');
const val = memory.read(addr);
st.stack[st.SP++] = val | 0;
};
D[OP.MEM_WRITE] = (st) => {
const value = st.stack[--st.SP] | 0;
const addrOrRel = st.stack[--st.SP];
const addr = resolveAddress(addrOrRel);
if (!memory) hostAPI.exit(600, 'No memory backend');
memory.write(addr, value);
st.stack[st.SP++] = value | 0;
};
// Interpreter
const metas = new Array(256).fill(0);
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
let bytecode = null,
rand = null;
const fetchByte = () => {
const r = rand.raw();
const val = Bytes.u8(bytecode, state.IP++);
return (val ^ (r & 0xff)) & 0xff;
};
async function interpret(bc, metaWS) {
	//vm = require('./vm.js'); let c = require('./compiler.js');  let prog = c.compileHL("print('nigger.')"); let tvm = vm.makeVM(); tvm.interpret( prog);
hostAPI.debugLog('INTERPRETER STARTED', 'hostAPI');
bytecode = bc;
for (let i = 0; i < 256; i++) metas[i] = metaWS ? metaWS[i] || 0 : 0;
state.IP = 0;
rand = _PRNG(state.seed);
hostAPI.debugLog(state.halt + state.IP < bytecode.length, " STATE ");
while (!state.halt && state.IP < bytecode.length) {
const ipBefore = state.IP;
hostAPI.debugLog('ipBefore',ipBefore);
const op = fetchByte();
hostAPI.debugLog("op",op);
const fn = D[op];
if (!fn) {
const err = `Invalid opcode: 0x${op.toString(16)} at IP=${ipBefore}`;
hostAPI.debugLog(err, 'error');
throw new Error(err);
}
// Pre-op log
hostAPI.debugLog(
`OP 0x${op.toString(16)} @IP=${ipBefore} SP=${state.SP} ` +
`stackTop=${JSON.stringify(state.stack.slice(Math.max(0, state.SP - 8), state.SP))}`,
'trace'
);
const ret = fn(state, fetchByte, op);
state.steps++;
if (ret && ret.then) await ret;
// Post-op log
hostAPI.debugLog(
`POST 0x${op.toString(16)} -> IP=${state.IP} SP=${state.SP} ` +
`stackTop=${JSON.stringify(state.stack.slice(Math.max(0, state.SP - 8), state.SP))}`,
'trace'
);
}
return state;
}
return { interpret, state, OP, memory };
}
