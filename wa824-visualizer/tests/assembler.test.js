import test from 'node:test';
import assert from 'node:assert/strict';
import {Wa824Assembler} from '../src/adapters/wa824-assembler.js';
import {ReferenceCpu} from '../src/adapters/reference-cpu.js';
const asm=new Wa824Assembler();
const assemble = s => asm.assemble(s);

test('R / I / SYSTEM exact encoding and little endian',()=>{
  const out=assemble('ADDI x1l, x0l, 3\nADDI x1h, x0l, 5\nADD x2l, x1l, x1h\nXOR x2h, x2l, x1h\nEBRAKE');
  assert.deepEqual(out.bytes,[0x12,0x03,0x00,0x13,0x05,0x00,0x04,0x23,0x00,0x05,0x43,0x04,0x80,0x00,0x01]);
});
test('L and S field boundaries',()=>{
  const out=assemble('L x7h, Wx3, -1\nS x2h, Wx7, 0');
  assert.equal(out.instructions[0].word, (0xff<<16)|(3<<13)|(15<<8)|0x2f);
  assert.equal(out.instructions[1].word, (7<<13)|0x35);
});
test('relative labels use current PC rather than PC+3; JA absolute',()=>{
  const out=assemble('loop: ADDI x1l, x1l, 1\nBNE x1l, x0l, loop\nJA Wx0, loop');
  assert.equal(out.labels.loop,0);
  assert.equal(out.instructions[1].pc,3);
  assert.equal(out.instructions[1].word,(0xf<<20)|(1<<16)|(2<<12)|(13<<8)|0x40);
  assert.equal(out.instructions[2].word,0x50);
});
test('JR signed offset, JRP signed offset, reserved fields are zero',()=>{
  const out=assemble('JR Wx4, -3\nJRP Wx3, Wx2, -8\nECALL\nMRET');
  assert.equal(out.instructions[0].word,0xfffd68);
  assert.equal(out.instructions[1].word, (0xf<<20)|(2<<17)|(0xf8<<8)|0x76);
  assert.equal(out.instructions[2].word,0x80);
  assert.equal(out.instructions[3].word,0xe0080);
});
test('numeric immediate versus label offset, errors, NOP',()=>{
  assert.equal(assemble('NOP').instructions[0].word,0x10);
  assert.equal(assemble('BEQ x0l, x0h, -3').instructions[0].word, (0xf<<20)|(0xd<<8)|0x41);
  for(const expr of [
    'ADDI x1l, x0l, 128','ADDI x1l, x0l, -129','ANDI x1l, x0l, 255',
    'SUBI x1l, x1l, 1','ADD x8l, x0l, x1l', 'JA Wx8, 0',
    'BEQ x1l, x0l, missing','here: NOP\nhere: NOP','JA Wx0, 65536',
  ])assert.throws(()=>assemble(expr));
  const over='target: NOP\n'+Array(43).fill('NOP').join('\n')+'\nBEQ x1l, x0l, target';
  assert.throws(()=>assemble(over),/out of range/);
});
test('reference CPU executes real generated machine bytes and respects hardwired x0',async()=>{
  const src='ADDI x1l, x0l, 3\nADDI x1h, x0l, 5\nADD x2l, x1l, x1h\nXOR x2h, x2l, x1h\nADDI x0l, x0l, 99\nEBRAKE';
  const out=assemble(src),cpu=new ReferenceCpu();
  await cpu.load(out.bytes,{origin:0});
  let steps=0,snap;
  do{snap=await cpu.step();steps++;assert.ok(steps<=100);}while(!snap.halted);
  assert.equal(snap.registers[0],0);
  assert.equal(snap.registers[1],0x0503);
  assert.equal(snap.registers[2],0x0d08);
  assert.equal(snap.pc,18);
  assert.equal(steps,36);
});
test('reference CPU store/load, branch, jump, and restart',async()=>{
  const out=assemble('ADDI x1l, x0l, 66\nS x1l, Wx0, 200\nL x1h, Wx0, 200\nBEQ x1h, x1l, done\nADDI x2l, x0l, 99\ndone: JA Wx0, halt\nADDI x3l, x0l, 70\nhalt: EBRAKE');
  const cpu=new ReferenceCpu();await cpu.load(out.bytes);
  let snap;for(let i=0;i<80;i++){snap=await cpu.step();if(snap.halted)break;}
  assert.equal(snap.registers[1],0x4242);
  assert.equal(snap.registers[2],0);
  assert.equal(snap.registers[3],0);
  assert.equal(cpu.memory[200],66);
  assert.equal(snap.registers[0],0);
  snap=await cpu.reset();assert.equal(snap.pc,0);assert.deepEqual(snap.registers,Array(8).fill(0));
});
test('ISA field coverage and unsigned/signed byte semantics',async()=>{
  const out=assemble('ADDI x1l, x0l, -1\nADDI x1h, x0l, 1\nSLT x2l, x1l, x1h\nSLTU x2h, x1l, x1h\nEBRAKE');
  const cpu=new ReferenceCpu();await cpu.load(out.bytes);
  let snap;for(let i=0;i<40;i++){snap=await cpu.step();if(snap.halted)break;}
  assert.equal(snap.registers[2],1);
  assert.deepEqual(out.instructions.map(x=>x.bytes.length),[3,3,3,3,3]);
});
