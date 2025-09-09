/*
  disassembler.js
  - Decodes operands (I32, strings, rel8 jumps)
  - Annotates jump targets
  - Optionally shows raw bytes, symbol names, and a simple CFG
  - Logs via hostAPI.debugLog with register snapshot (if available)
*/
export function disassemble(bytecode, strings = [], seed = 0x13572468, options = {}) {
const {
showBytes = true,
annotateJumps = true,
showStrings = true,
includeCFG = false,
debug = false,
} = options;
const hostAPI = { debug, debugLog: (msg) => debug && console.log('[DISASM] ' + msg) };
const OPnames = new Map(Object.entries({
0x00: 'STOP', 0x01: 'PUSH_U8', 0x10: 'PUSH_I32', 0x02: 'ADD', 0x03: 'SUB', 0x04: 'DIV', 0x05: 'MOD', 0x06: 'MUL', 0x07: 'XOR', 0x08: 'NEG',
0x1d: 'AND', 0x1e: 'OR', 0x20: 'SHL', 0x21: 'SHR', 0x22: 'USHR', 0x24: 'EQ', 0x25: 'NEQ', 0x26: 'GT', 0x27: 'LT', 0x28: 'GTE', 0x29: 'LTE', 0x14: 'NOT',
0x30: 'JMP', 0x31: 'JZ', 0x32: 'JNZ', 0x34: 'PUSH_STR', 0x36: 'GET_IDX', 0x37: 'SET_IDX', 0x40: 'NEW_OBJ', 0x41: 'OBJ_SET', 0x42: 'NEW_ARR', 0x43: 'ARR_PUSH',
0x50: 'DECL', 0x51: 'LOAD', 0x52: 'STORE', 0x53: 'LOAD_HOST', 0x60: 'MAKE_FN', 0x61: 'RET', 0x62: 'PUSH_SCOPE', 0x63: 'POP_SCOPE', 0x73: 'CALL_ANY', 0x81: 'CAST', 0xe0: 'CUSTOM',
0xa8: 'GEN_NEW', 0xa9: 'YIELD', 0xaa: 'GEN_RESUME', 0x90: 'MEM_SET_BASE', 0x91: 'MEM_GET_BASE', 0x92: 'MEM_READ', 0x93: 'MEM_WRITE'
}));
function disasmLog(msg) {
if (!debug) return;
let regSnapshot = '';
if (typeof globalThis.vm !== 'undefined' && globalThis.vm.registers) {
regSnapshot = ' | regs: ' + JSON.stringify(globalThis.vm.registers);
}
hostAPI.debugLog(msg + regSnapshot);
}
let IP = 8;
const _PRNG = (seed) => { let x = seed | 0; return { raw() { x = (x * 1664525 + 1013904223) | 0; return x >>> 0; } }; };
const Bytes = { u8(a, i) { return a[i] & 255; } };
const R = _PRNG(seed);
const fetch = () => {
const r = R.raw();
const v = Bytes.u8(bytecode, IP++);
return (v ^ (r & 0xff)) & 0xff;
};
const lines = [];
const edges = [];
function readI32() {
const b1 = fetch(), b2 = fetch(), b3 = fetch(), b4 = fetch();
const v = (b1 << 24) | (b2 << 16) | (b3 << 8) | b4;
return v | 0;
}
while (IP < bytecode.length) {
const at = IP;
const op = fetch();
const name = OPnames.get(op) || `OP_${op.toString(16)}`;
let operands = '';
let target = null;
switch (op) {
case 0x01: {
const v = fetch();
operands = `${v}`;
break;
}
case 0x10: {
const i32 = readI32();
operands = `${i32}`;
break;
}
case 0x34: // PUSH_STR
case 0x50: // DECL name, flags (1=const)
case 0x51: // LOAD
case 0x52: // STORE
case 0x53: // LOAD_HOST
case 0x81: // CAST (type name in strings)
case 0x60: // MAKE_FN name nparams codeOfs
case 0xe0: { // CUSTOM
if (op === 0x60) {
const nameIdx = fetch();
const nparams = fetch();
const codeOfs = fetch();
const label = showStrings ? strings[nameIdx] : `str#${nameIdx}`;
operands = `${label}, nparams=${nparams}, codeOfs=${codeOfs}`;
} else if (op === 0x50) {
const nameIdx = fetch();
const flags = fetch();
const label = showStrings ? strings[nameIdx] : `str#${nameIdx}`;
operands = `${label}, flags=${flags}`;
} else if (op === 0x81) {
const typeIdx = fetch();
const label = showStrings ? strings[typeIdx] : `str#${typeIdx}`;
operands = `${label}`;
} else if (op === 0xe0) {
const nameIdx = fetch();
const label = showStrings ? strings[nameIdx] : `str#${nameIdx}`;
operands = `${label}`;
} else {
const nameIdx = fetch();
const label = showStrings ? strings[nameIdx] : `str#${nameIdx}`;
operands = `${label}`;
}
break;
}
case 0x73: { // CALL_ANY
const argc = fetch();
operands = `argc=${argc}`;
break;
}
case 0x30: // JMP
case 0x31: // JZ
case 0x32: { // JNZ
const rel8 = (fetch() << 24) >> 24;
target = (IP + rel8) | 0;
operands = annotateJumps ? `rel=${rel8} -> ${target}` : `rel=${rel8}`;
if (annotateJumps) edges.push([at, target]);
break;
}
case 0x90: // MEM_SET_BASE
case 0x91: // MEM_GET_BASE
case 0x92: // MEM_READ
case 0x93: // MEM_WRITE
default: {
// no explicit operands
break;
}
}
const rawBytes = showBytes ? `@${String(at).padStart(6)}  ` : '';
const line = `${rawBytes}${name}${operands ? ' ' + operands : ''}`;
lines.push(line);
disasmLog(line);
}
if (!includeCFG) return lines.join('\n');
// trivial CFG
const cfgLines = ['\nCFG edges:'];
for (const [from, to] of edges) cfgLines.push(`  ${from} -> ${to}`);
return lines.join('\n') + '\n' + cfgLines.join('\n');
}
