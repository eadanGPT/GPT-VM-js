#!/usr/bin/env node
import readline from 'node:readline';
import { compileHL } from '../src/compiler.js';
import { makeVM } from '../src/vm.js';
import { disassemble } from '../src/disassembler.js';
import Memory2D from '../src/memory.js';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'vm> ' });

const hostAPI = {
  debug: true,
  debugLog: (msg) => console.log(msg),
  ops: {
    PRINT(st) {
      const v = st.stack[--st.SP];
      console.log('[PRINT]', v);
    },
  },
};

const vm = makeVM({ ...hostAPI, memory: new Memory2D(hostAPI) });

console.log('REPL ready. Commands:');
console.log('- :dis <code>   (compile + disassemble)');
console.log('- :run <code>   (compile + run)');
console.log('- :mem base n   (set mem base)');
console.log('- :quit');

rl.prompt();
rl.on('line', async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return rl.prompt();
  if (trimmed === ':quit') {
    rl.close();
    return;
  }

  try {
    if (trimmed.startsWith(':mem')) {
      const [, baseStr] = trimmed.split(/\s+/);
      const base = parseInt(baseStr, 10) >>> 0;
      vm.state.memBase = base;
      console.log('memBase =', vm.state.memBase);
    } else if (trimmed.startsWith(':dis')) {
      const code = trimmed.replace(/^:dis\s*/, '');
      const { bytecode, strings, metaWS } = compileHL(code);
      const out = disassemble(bytecode, strings, 0x13572468, { debug: false, includeCFG: true });
      console.log(out);
    } else if (trimmed.startsWith(':run')) {
      const code = trimmed.replace(/^:run\s*/, '');
      const { bytecode, strings, metaWS } = compileHL(code);
      await vm.interpret(bytecode, metaWS);
      console.log('VM done. SP=', vm.state.SP, 'steps=', vm.state.steps);
    } else {
      const { bytecode, strings, metaWS } = compileHL(trimmed);
      await vm.interpret(bytecode, metaWS);
    }
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    rl.prompt();
  }
}).on('close', () => {
  console.log('bye');
  process.exit(0);
});
