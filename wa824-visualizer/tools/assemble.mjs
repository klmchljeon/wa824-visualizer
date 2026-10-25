#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Wa824Assembler } from '../src/adapters/wa824-assembler.js';

function usage() {
  console.log('Usage: node tools/assemble.mjs examples/demo.asm [output-prefix]');
  console.log('Outputs: <prefix>.bin (raw bytes), <prefix>.mem (one byte/line for $readmemh).');
}
if (process.argv.length < 3 || process.argv.includes('--help')) { usage();process.exit(process.argv.includes('--help')?0:1); }
const input=process.argv[2];
const prefix=process.argv[3] ?? input.replace(/\.[^.]+$/, '');
try {
  const result=new Wa824Assembler().assemble(fs.readFileSync(input,'utf8'));
  fs.mkdirSync(path.dirname(prefix),{recursive:true});
  fs.writeFileSync(prefix+'.bin',Buffer.from(result.bytes));
  fs.writeFileSync(prefix+'.mem',result.bytes.map(b=>b.toString(16).toUpperCase().padStart(2,'0')).join('\n')+'\n');
  for(const item of result.instructions)console.log(`${item.pc.toString(16).padStart(4,'0')}: ${item.hex}  ${item.display}`);
  console.log(`Wrote ${result.bytes.length} bytes to ${prefix}.bin/.mem`);
} catch(error) {console.error(error.message);process.exitCode=1;}
