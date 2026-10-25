/** End-to-end parity of actual RTL trace and JS CPU. Requires Icarus Verilog. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {runC} from '../tools/execute-c.mjs';
import {ReferenceCpu} from '../src/adapters/reference-cpu.js';
const iverilog=process.env.WA824_IVERILOG??'iverilog';
const vvp=process.env.WA824_VVP??'vvp';
const available=spawnSync(iverilog,['-V'],{timeout:3000}).status===0 &&
                spawnSync(vvp,['-V'],{timeout:3000}).status===0;
const python=process.env.WA824_PYTHON??(process.platform==='win32'?'py':'python3');
const pyArgs=process.platform==='win32'&&!process.env.WA824_PYTHON?['-3']:[];
async function parity(source,input,expectedOut,expectedExit) {
  const compiled=await runC(source,input,100000);
  const result=spawnSync(python,[...pyArgs,'backend/verilog/runner.py'],{
    cwd:new URL('..',import.meta.url),
    input:JSON.stringify({bytes:compiled.binary.bytes,origin:0,input}),
    encoding:'utf8',timeout:120000,maxBuffer:80*1024*1024,
    env:{...process.env,WA824_MAX_RTL_CYCLES:'160000'},
  });
  assert.equal(result.status,0,`RTL runner error: ${result.stderr||result.error}`);
  const rtl=JSON.parse(result.stdout).snapshots;
  const cpu=new ReferenceCpu();
  await cpu.load(compiled.binary.bytes,{input});
  assert.equal(rtl[0].phase,'READY');
  assert.equal(rtl[0].stdout,'');
  for (let i=1;i<rtl.length;i++) {
    const js=await cpu.step();
    assert.equal(rtl[i].phase,js.phase,`phase at cycle ${i}`);
    assert.equal(rtl[i].pc,js.pc,`PC at cycle ${i}`);
    assert.deepEqual(rtl[i].registers,js.registers,`registers at cycle ${i}`);
    assert.equal(rtl[i].stdout,js.stdout,`stdout at cycle ${i}`);
    assert.equal(rtl[i].exitCode,js.exitCode,`exitCode at cycle ${i}`);
    assert.equal(rtl[i].halted,js.halted,`halted at cycle ${i}`);
  }
  const last=rtl.at(-1);
  assert.equal(last.stdout,expectedOut);
  assert.equal(last.exitCode,expectedExit);
  assert.equal(last.halted,true);
}
const skip=!available && 'Requires an installed Icarus Verilog (iverilog, vvp)';
test('C ABI + RTL: function, stack, return', {skip},()=>parity(
  'int add(int a,int b){return a+b;}int main(){return add(17,25);}', '', '', 42));
test('C ABI + RTL: putchar and exit', {skip},()=>parity(
  'int main(){putchar(65);putchar(66);return 9;}', '', 'AB', 9));
test('C ABI + RTL: getchar and stdout', {skip},()=>parity(
  'int main(){int c=getchar();putchar(c);return 0;}', 'Z', 'Z', 0));
test('C ABI + RTL: signed arithmetic loop and condition', {skip},()=>parity(
  'int main(){int i=0;int sum=0;while(i<6){sum+=i;i++;}return sum;}', '', '', 15));
