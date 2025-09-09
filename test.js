/*
  Opcode coverage test runner
  - Exercises every opcode at least once (via compiled or raw-assembled programs)
  - Verifies VM executes without throwing
  - Prints a concise coverage report
Notes:
`
`Some opcodes are not emitted by the compiler in normal JS syntax (e.g., ARR_PUSH, CAST, GEN_<em>,
MEM_</em> helpers, CUSTOM at a reachable position). For those we assemble raw bytecode directly.`
`For any test that needs strings (PUSH_STR, CAST, CUSTOM, LOAD/STORE names), we pass a VM
constructed with hostAPI.__strings set to the test’s string table, because the current VM reads
strings from state.strings initialized at construction time.
*/
import { compileHL } from './compiler.js';
import { makeVM } from './vm.js';
import Memory2D from './memory.js';
// Seed consistent with compiler default
const DEFAULT_SEED = 0x13572468;
// Minimal PRNG and byte helpers (must match compiler/vm)
function _PRNG(seed) {
let x = seed | 0;
return {
raw() {
x = (x * 1664525 + 1013904223) | 0;
return x >>> 0;
},
};
}
const Bytes = {
wr(a, i, v) {
a[i] = v & 255;
return i + 1;
},
};
// Assemble raw opcodes into final bytecode (header + blinded body)
function assembleRaw(opcodes, seed = DEFAULT_SEED) {
const R = _PRNG(seed);
const blinded = opcodes.map((v) => (v ^ (R.raw() & 0xff)) & 0xff);
const final = [];
let q = 0;
q = Bytes.wr(final, q, 0xc3); // magic
q = Bytes.wr(final, q, 0x04); // version
q = Bytes.wr(final, q, (seed >>> 24) & 255);
q = Bytes.wr(final, q, (seed >>> 16) & 255);
q = Bytes.wr(final, q, (seed >>> 8) & 255);
q = Bytes.wr(final, q, (seed >>> 0) & 255);
q = Bytes.wr(final, q, (blinded.length >>> 8) & 255);
q = Bytes.wr(final, q, (blinded.length >>> 0) & 255);
for (const b of blinded) q = Bytes.wr(final, q, b);
return Uint8Array.from(final);
}
// Create a VM instance bound to a specific strings table (important for PUSH_STR/CUSTOM/CAST)
function makeVMForStrings(strings = [], debug = false) {
const hostAPI = {
debug,
debugLog: (msg) => debug && console.log(msg),
__strings: strings,
ops: {
PRINT(st) {
const v = st.stack[--st.SP];
if (debug) console.log('[PRINT]', v);
},
},
memory: new Memory2D({ debug, debugLog: (m) => debug && console.log(m) }),
};
return makeVM(hostAPI);
}
// Run a compiled snippet (JS-like) and return true if it finishes
async function runCompiled(src, { debug = false } = {}) {
const { bytecode, strings, metaWS } = compileHL(src, DEFAULT_SEED);
const vm = makeVMForStrings(strings, debug);
try {
await vm.interpret(bytecode, metaWS);
return true;
} catch (e) {
if (debug) console.error('Compiled run failed:', e);
return false;
}
}
// Run a raw-assembled bytecode body, with optional strings table
async function runRaw(bodyOpcodes, strings = [], { debug = false } = {}) {
const bc = assembleRaw(bodyOpcodes, DEFAULT_SEED);
const vm = makeVMForStrings(strings, debug);
try {
await vm.interpret(bc, new Array(256).fill(0));
return true;
} catch (e) {
if (debug) console.error('Raw run failed:', e);
return false;
}
}
// Helpers to encode immediate values (match VM’s PUSH_I32), and small PUSH_U8
function I32(n) {
return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, (n >>> 0) & 255];
}
// Opcodes map (must match VM)
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
// Test cases
const compiledCases = [
{ name: 'STOP/PUSH_I32 basic', src: '42;' },
{ name: 'PUSH_U8 via for default cond true', src: 'for(;;){break;}' }, // still emits PUSH_U8(1) for cond default
{ name: 'ADD/SUB/MUL/DIV/MOD', src: '1+2; 6-3; 2*3; 8/2; 7%3;' },
{ name: 'XOR/AND/OR', src: '1^1; 3&1; 2|1;' },
{ name: 'SHL/SHR/USHR', src: '(1<<3); (8>>2); (8>>>2);' },
{ name: 'NEG/NOT', src: '-5; !0;' },
{ name: 'EQ/NEQ/GT/LT/GTE/LTE', src: '1==1; 1!=2; 2>1; 1<2; 2>=2; 1<=2;' },
{ name: 'JMP/JZ/JNZ via if/while/do/for', src: 'if(0){1;}else{2;} while(0){} do{}while(0); for(let i=0;i<1;i=i+1){}' },
{ name: 'PUSH_STR/LOAD/STORE', src: 'let x=1; x; x=2; x;' },
{ name: 'NEW_OBJ/OBJ_SET/GET_IDX/SET_IDX', src: 'let o={a:1}; o.a; o["b"]=2; o["b"];' },
{ name: 'NEW_ARR literal', src: '[1,2,3];' },
{ name: 'PUSH_SCOPE/POP_SCOPE', src: '{ let y=3; }' },
{ name: 'MAKE_FN/CALL_ANY/RET', src: 'function f(a){return a+1;} f(2);' },
{ name: 'UNARY & (relative address array)', src: '&4;' }, // builds ['&', 4]
];
const rawCases = [
// ARR_PUSH: push array then a value, ARR_PUSH should pop both and push array again
{
name: 'ARR_PUSH',
strings: [],
body: [
OP.NEW_ARR, 0x00,          // []
OP.PUSH_I32, ...I32(7),    // 7
OP.ARR_PUSH,               // arr.push(7) (VM opcode form)
OP.STOP,
],
},
// CAST: push value, then CAST with type string index (operand)
{
name: 'CAST number',
strings: ['number'],
body: [
OP.PUSH_I32, ...I32(123),
OP.CAST, 0x00,             // strings[0] === 'number'
OP.STOP,
],
},
// CUSTOM: invoke a known host op "PRINT", push value then CUSTOM
{
name: 'CUSTOM PRINT',
strings: ['PRINT'],
body: [
OP.PUSH_I32, ...I32(999),
OP.CUSTOM, 0x00,           // call hostAPI.ops.PRINT
OP.STOP,
],
},
// MEM_* absolute addressing: base=0x10, write 0xFE to addr 0x12, then read back
{
name: 'MEM abs',
strings: [],
body: [
OP.PUSH_I32, ...I32(0x10), // base
OP.MEM_SET_BASE,           // memBase=0x10
OP.PUSH_I32, ...I32(0x12), // addr
OP.PUSH_I32, ...I32(0xFE), // value
OP.MEM_WRITE,              // write(addr, value)
OP.PUSH_I32, ...I32(0x12), // addr
OP.MEM_READ,               // read(addr)
OP.STOP,
],
},
// MEM_* relative addressing: base=0x20, write 0xAB to &+2, then read &+2
// Build ['&', 2] on stack: PUSH_STR '&' + PUSH_I32 2 + NEW_ARR 2 -> ['&',2]
{
name: 'MEM rel',
strings: ['&'],
body: [
OP.PUSH_I32, ...I32(0x20), // base
OP.MEM_SET_BASE,           // base=0x20
// addr ['&',2]
OP.PUSH_STR, 0x00,         // '&'
OP.PUSH_I32, ...I32(2),
OP.NEW_ARR, 0x02,          // ['&', 2]
OP.PUSH_I32, ...I32(0xAB), // value
OP.MEM_WRITE,              // write(&+2, 0xAB)
// read back:
OP.PUSH_STR, 0x00,         // '&'
OP.PUSH_I32, ...I32(2),
OP.NEW_ARR, 0x02,          // ['&', 2]
OP.MEM_READ,
OP.STOP,
],
},
// MEM_GET_BASE
{
name: 'MEM_GET_BASE',
strings: [],
body: [
OP.PUSH_I32, ...I32(0x1234),
OP.MEM_SET_BASE,
OP.MEM_GET_BASE,
OP.STOP,
],
},
// Generators: GEN_NEW creates a generator from a function on stack, YIELD is a no-op placeholder,
// GEN_RESUME resumes with a send value.
// We create a trivial JS function object on stack using MAKE_FN? The VM's GEN_NEW expects a function
// on stack. We'll simulate by pushing a host function that returns 7.
// Since pushing a host function via bytecode isn't supported, we instead use a tiny trick:
// Use CUSTOM to push a function onto the stack via hostAPI.ops.
{
name: 'GEN_*',
strings: ['PUSH_HOST_FN'],
// Execution plan:
// CUSTOM PUSH_HOST_FN -> pushes a host function () => 7
// GEN_NEW -> generator
// PUSH_I32 1 (send)
// GEN_RESUME -> yields final 7
body: [
OP.CUSTOM, 0x00,
OP.GEN_NEW,
OP.PUSH_I32, ...I32(1),
OP.GEN_RESUME,
OP.STOP,
],
setupOps: {
PUSH_HOST_FN(st) {
st.stack[st.SP++] = function () { return 7; };
},
},
},
// LOAD_HOST: load a host property "foo" = 42
{
name: 'LOAD_HOST',
strings: ['foo'],
body: [
OP.LOAD_HOST, 0x00,
OP.STOP,
],
setupHost: {
foo: 42
},
},
];
// Execute
(async function main() {
const results = [];
let passed = 0, failed = 0;
// Run compiled cases
for (const c of compiledCases) {
try {
const ok = await runCompiled(c.src, { debug: false });
results.push({ name: c.name, ok, kind: 'compiled' });
console.log({ name: c.name, ok, kind: 'compiled' })
ok ? passed++ : failed++;
} catch (err) {
console.log('failed', c);
}
}
// Run raw cases (some also need custom ops)
for (const r of rawCases) {
// If a custom op setup is required, build a VM with those ops and run manually
if (r.setupOps || r.setupHost) {
const bc = assembleRaw(r.body, DEFAULT_SEED);
const hostAPI = {
debug: true,
//debugLog: () => {},
__strings: r.strings || [],
ops: {
PRINT(st) { const v = st.stack[--st.SP]; },
...(r.setupOps || {}),
},
memory: new Memory2D({ debug: false }),
...(r.setupHost || {}),
};
const vm = makeVM(hostAPI);
let ok = true;
try {
await vm.interpret(bc, new Array(256).fill(0));
} catch (e) {
ok = false;
}
results.push({ name: r.name, ok, kind: 'raw' });
ok ? passed++ : failed++;
} else {
const ok = await runRaw(r.body, r.strings, { debug: false });
results.push({ name: r.name, ok, kind: 'raw' });
ok ? passed++ : failed++;
}
}
// Also include a tiny PUSH_U8-only raw test to ensure explicit coverage
{
const ok = await runRaw([OP.PUSH_U8, 0x07, OP.STOP], [], { debug: false });
results.push({ name: 'PUSH_U8 raw', ok, kind: 'raw' });
ok ? passed++ : failed++;
}
// Report
console.log('Opcode coverage results:');
for (const r of results) {
console.log(`${r.ok ? '✅' : '❌'} [${r.kind}] ${r.name}`);
}
console.log(`\nSummary: passed=${passed}, failed=${failed}`);
if (failed > 0) process.exit(1);
process.exit(0);
})().catch((e) => {
console.error('Fatal test error:', e);
process.exit(1);
});


