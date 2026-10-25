import { readFileSync } from 'node:fs';
import { Wa824Assembler } from '../src/adapters/wa824-assembler.js';
import { ReferenceCpu } from '../cpus/reference/implementation/reference-cpu.js';
const src=readFileSync(0,'utf-8');
const asm=new Wa824Assembler().assemble(src);
const cpu=new ReferenceCpu();await cpu.load(asm.bytes,{input:process.env.WA824_TEST_STDIN || ''});
try {await cpu.runToEnd(70000);console.log(JSON.stringify({bytes:asm.bytes,final:await cpu.snapshot()}));}
catch(e){console.log(JSON.stringify({bytes:asm.bytes,referenceError:e.message}));}
