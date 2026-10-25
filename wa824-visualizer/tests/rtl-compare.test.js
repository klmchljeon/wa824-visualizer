import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {Wa824Assembler} from '../src/adapters/wa824-assembler.js';
import {ReferenceCpu} from '../src/adapters/reference-cpu.js';

const available = spawnSync('iverilog',['-V'],{encoding:'utf8',timeout:3000}).status===0 &&
                  spawnSync('vvp',['-V'],{encoding:'utf8',timeout:3000}).status===0;
const pythonCommand = process.env.WA824_PYTHON ?? (process.platform==='win32'?'py':'python3');
const pythonArgs=process.platform==='win32' && !process.env.WA824_PYTHON ? ['-3'] : [];
const asm = new Wa824Assembler();

async function compare(source, origin=0) {
  const image=asm.assemble(source).bytes;
  const args=[...pythonArgs,'backend/verilog/runner.py'];
  const result=spawnSync(pythonCommand,args,{
    cwd:new URL('..',import.meta.url),
    input:JSON.stringify({origin,bytes:image}),encoding:'utf8',timeout:60000,
    maxBuffer:25*1024*1024,
  });
  assert.equal(result.status,0,`RTL runner failed: ${result.stderr || result.error}`);
  const {snapshots,programSha256}=JSON.parse(result.stdout);
  assert.match(programSha256,/^[0-9a-f]{64}$/);
  const cpu=new ReferenceCpu();
  let ref=await cpu.load(image,{origin});
  assert.equal(snapshots[0].phase,'READY');
  assert.deepEqual(snapshots[0].registers,ref.registers);
  assert.equal(snapshots[0].pc,origin);
  for(let i=1;i<snapshots.length;i++) {
    ref=await cpu.step();
    const rtl=snapshots[i];
    assert.equal(rtl.phase,ref.phase,`phase mismatch at RTL cycle ${i}`);
    assert.equal(rtl.pc,ref.pc,`PC mismatch at RTL cycle ${i}`);
    assert.deepEqual(rtl.registers,ref.registers,`registers mismatch at RTL cycle ${i}`);
    assert.equal(rtl.halted,ref.halted,`halt mismatch at RTL cycle ${i}`);
    if (rtl.phase==='COMMIT') {
      assert.deepEqual(rtl.memoryChange,ref.memoryChange,
        `memory writes mismatch at RTL cycle ${i}`);
    }
  }
  assert.equal(ref.halted,true,'test program must terminate');
  assert.equal(snapshots.at(-1).halted,true,'RTL must terminate');
  return snapshots.at(-1);
}

test('RTL v. JS: compiler demo, ALU, zero reg', {skip:!available && 'Requires Icarus Verilog (iverilog/vvp)'}, async()=>{
  const last=await compare(`ADDI x1l,x0l,3
ADDI x1h,x0l,5
ADD x2l,x1l,x1h
XOR x2h,x2l,x1h
ADDI x0l,x1l,99
EBRAKE`);
  assert.equal(last.registers[1],0x0503);
  assert.equal(last.registers[2],0x0d08);
  assert.equal(last.registers[0],0);
});

test('RTL v. JS: load/store and taken branch', {skip:!available && 'Requires Icarus Verilog'}, async()=>{
  const last=await compare(`ADDI x1l, x0l, 66
S x1l, Wx0, 200
L x1h, Wx0, 200
BEQ x1l, x1h, done
ADDI x2l, x0l, 99
done: EBRAKE`);
  assert.equal(last.registers[1],0x4242);
  assert.equal(last.registers[2],0);
});

test('RTL v. JS: repeated backward branch', {skip:!available && 'Requires Icarus Verilog'}, async()=>{
  const last=await compare(`ADDI x1l,x0l,3
loop: ADDI x1l,x1l,-1
BNE x1l,x0l,loop
EBRAKE`);
  assert.equal(last.registers[1],0);
});

test('RTL v. JS: signed arithmetic, signed/unsigned compare and nonzero origin', {skip:!available && 'Requires Icarus Verilog'}, async()=>{
  const last=await compare(`ADDI x1l,x0l,-1
ADDI x1h,x0l,1
SRA x2l,x1l,x1h
SLT x2h,x1l,x1h
SLTU x3l,x1l,x1h
EBRAKE`,300);
  assert.equal(last.registers[2],0x01ff);
  assert.equal(last.registers[3],0);
});

test('RTL v. JS: JA/JR/JRP and word-register link', {skip:!available && 'Requires Icarus Verilog'}, async()=>{
  const ja=await compare(`JA Wx2, target
ADDI x1l,x0l,99
target: EBRAKE`);
  assert.equal(ja.registers[2],3);
  assert.equal(ja.registers[1],0);
  const jr=await compare(`JR Wx2, 6
ADDI x1l,x0l,99
EBRAKE`);
  assert.equal(jr.registers[2],3);
  const jrp=await compare(`ADDI x1l,x0l,12
JRP Wx3, Wx1, 0
ADDI x2l,x0l,99
NOP
EBRAKE`);
  assert.equal(jrp.registers[3],6);
  assert.equal(jrp.registers[2],0);
});

test('RTL v. JS: load/store address negative offset', {skip:!available && 'Requires Icarus Verilog'}, async()=>{
  const last=await compare(`ADDI x1l,x0l,-16
ADDI x2l,x0l,42
S x2l,Wx1,-1
L x2h,Wx1,-1
EBRAKE`);
  assert.equal(last.registers[2],0x2a2a);
});

test('RTL v. JS: Python C subset compiler → JS assembler → Verilog CPU',
  {skip:!available && 'Requires Icarus Verilog'},async()=>{
    const source=`unsigned char a = 3;
unsigned char b = 5;
unsigned char c = a + b;
unsigned char d = c ^ b;`;
    const pythonCode='import sys; from backend.python.compiler import compile_source; print(compile_source(sys.stdin.read())["assembly"])';
    const compiled=spawnSync(pythonCommand,[...pythonArgs,'-c',pythonCode],{
      cwd:new URL('..',import.meta.url),input:source,encoding:'utf8',timeout:3000
    });
    assert.equal(compiled.status,0,compiled.stderr);
    const last=await compare(compiled.stdout);
    assert.equal(last.registers[1],0x0503);
    assert.equal(last.registers[2],0x0d08);
  });
