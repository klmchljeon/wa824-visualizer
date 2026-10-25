import test from 'node:test';
import assert from 'node:assert/strict';
import {Wa824Assembler} from '../src/adapters/wa824-assembler.js';
import {ReferenceCpu} from '../src/adapters/reference-cpu.js';
const asm=new Wa824Assembler();

test('ECALL getchar/putchar/exit via real machine bytes',async()=>{
  const binary=asm.assemble(`ADDI x1l, x0l, 2
ECALL
ADDI x1l, x0l, 1
ECALL
ADDI x1l, x0l, 5
ECALL`);
  const cpu=new ReferenceCpu();
  await cpu.load(binary.bytes,{input:'Z'});
  const done=await cpu.runToEnd();
  assert.equal(done.stdout,'Z');
  assert.equal(done.exitCode,90);
  assert.equal(done.halted,true);
  assert.equal(done.registers[0],0);
  const reset=await cpu.reset();
  assert.equal(reset.stdout,'');
  assert.equal(reset.exitCode,null);
  const replay=await cpu.runToEnd();
  assert.equal(replay.stdout,'Z');
  assert.equal(replay.exitCode,90);
});

test('ECALL getchar EOF returns full word 0xffff',async()=>{
  const binary=asm.assemble(`ADDI x1l,x0l,2
ECALL
ADDI x1l,x0l,5
ECALL`);
  const cpu=new ReferenceCpu();
  await cpu.load(binary.bytes,{input:''});
  const done=await cpu.runToEnd();
  assert.equal(done.registers[2],65535);
  assert.equal(done.exitCode,65535);
});
