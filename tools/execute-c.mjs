/** CLI for end-to-end compiler -> assembler -> JS CPU testing. */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Wa824Assembler } from '../src/adapters/wa824-assembler.js';
import { ReferenceCpu } from '../src/adapters/reference-cpu.js';
const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function runC(source, input='', maxSteps=300000) {
  const python=process.env.WA824_PYTHON||(process.platform==='win32'?'py':'python3');
  const pythonArgs=process.platform==='win32'&&!process.env.WA824_PYTHON?['-3']:[];
  const p=spawnSync(python,[...pythonArgs,'-c','import json,sys; from backend.python.compiler import compile_source;print(json.dumps(compile_source(sys.stdin.read())))'],{cwd:ROOT,input:source,encoding:'utf8'});
  if(p.status!==0) throw new Error(p.stderr||p.stdout||`python exited ${p.status}`);
  const compiled=JSON.parse(p.stdout);
  const binary=new Wa824Assembler().assemble(compiled.assembly);
  const cpu=new ReferenceCpu();
  await cpu.load(binary.bytes,{origin:binary.origin,input});
  let steps=0;
  while(!cpu.halted && steps<maxSteps){await cpu.step();steps++;}
  if(!cpu.halted)throw new Error(`JS CPU execution limit (${maxSteps} phases)`);
  return {stdout:cpu.stdout,exitCode:cpu.exitCode,steps,registers:cpu.registers,compiled,binary,memory:cpu.memory};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const src=readFileSync(process.argv[2],'utf8');
  const stdin=process.argv[3]||'';
  try{
    const result=await runC(src,stdin);
    console.log(JSON.stringify({stdout:result.stdout,exitCode:result.exitCode,steps:result.steps,bytes:result.binary.bytes.length},null,2));
  }catch(e){console.error(e.stack);process.exitCode=1;}
}
