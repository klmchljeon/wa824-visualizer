import { CpuPort } from '../../../src/ports/cpu-port.js';
// Instruction-level reference emulator: reads *actual* 24-bit machine code, not mock IR.
// Six UI phases are a pedagogical visualization, NOT RTL cycle-accurate timing.
const PHASES = ['FETCH0','FETCH1','FETCH2','DECODE','EXECUTE','COMMIT'];
const OPS_R = ['ADD','SUB','AND','OR','XOR','SLL','SL','SRA','SLT','SLTU'];
const OPS_I = ['ADDI',null,'ANDI','ORI','XORI','SLLI','SLI','SRAI','SLTI','SLTUI'];
const BRANCH = ['BEQ','BNE','BLT','BLTU'];
const u8 = n => n & 255, u16 = n => n & 65535;
const signed = (n,bits) => (n & (1 << (bits-1))) ? n - (1 << bits) : n;
const hex = (n,size) => '0x'+(n>>>0).toString(16).toUpperCase().padStart(size,'0');
function labelByte(index) { return `x${index >>> 1}${index % 2 ? 'h' : 'l'}`; }
function readByte(regs, i) { const x = regs[i >>> 1]; return i&1 ? (x >>> 8)&255 : x&255; }
function writeByte(regs,i,v) { const j = i >>> 1;if(j===0)return null;regs[j] = i&1 ? ((regs[j]&0x00ff)|(u8(v)<<8)) : ((regs[j]&0xff00)|u8(v)); return j; }
function writeWord(regs,i,v) { if(i===0)return null;regs[i]=u16(v);return i; }
function operation(op,a,b) {
  const shift = b & 7;
  switch(op) {
    case 'ADD':case 'ADDI':return u8(a+b);
    case 'SUB':return u8(a-b);
    case 'AND':case 'ANDI':return a&b;
    case 'OR':case 'ORI':return a|b;
    case 'XOR':case 'XORI':return a^b;
    case 'SLL':case 'SLLI':return u8(a<<shift);
    case 'SRA':case 'SRAI':return u8(signed(a,8)>>shift);
    case 'SLT':case 'SLTI':return +(signed(a,8)<signed(b,8));
    case 'SLTU':case 'SLTUI':return +(a<b);
    default:throw new Error(`ALU '${op}' behavior not specified in ISA (SL/SLI are intentionally unsupported in reference CPU)`);
  }
}
function decode(word,pc) {
  const opcode=(word>>>4)&15,rd=word&15,funct=(word>>>16)&15, rs1=(word>>>12)&15, rs2=(word>>>8)&15;
  const i8 = signed(((word>>>20)<<4)|((word>>>8)&15),8);
  const i12 = signed(((word>>>16)<<4)|((word>>>8)&15),12);
  const i16 = (word>>>8)&0xffff;
  if(opcode===0) {
    if ((word>>>20)!==0) throw new Error(`Invalid R reserved bits at ${hex(pc,4)}`);
    if (!OPS_R[funct]) throw new Error(`Unknown R funct ${funct}`);
    return {kind:'R',op:OPS_R[funct],rd,rs1,rs2,display:`${OPS_R[funct]} ${labelByte(rd)}, ${labelByte(rs1)}, ${labelByte(rs2)}`};
  }
  if(opcode===1) {
    if (!OPS_I[funct]) throw new Error(`Unknown/forbidden I funct ${funct}`);
    return {kind:'I',op:OPS_I[funct],rd,rs1,imm:i8,display:`${OPS_I[funct]} ${labelByte(rd)}, ${labelByte(rs1)}, ${i8}`};
  }
  if(opcode===2||opcode===3) {
    const wrs=(word>>>13)&7;
    if ((word>>>12)&1) throw new Error('Load/store reserved bit nonzero');
    return {kind:opcode===2?'L':'S',op:opcode===2?'L':'S',rd,rs1:wrs,imm:i12,display:`${opcode===2?'L':'S'} ${labelByte(rd)}, Wx${wrs}, ${i12}`};
  }
  if(opcode===4) {
    if(!BRANCH[funct])throw new Error(`Unknown branch funct ${funct}`);
    return {kind:'B',op:BRANCH[funct],rs1,rs2:rd,imm:i8,display:`${BRANCH[funct]} ${labelByte(rs1)}, ${labelByte(rd)}, ${i8}`};
  }
  if(opcode===5||opcode===6) {
    if(word&1)throw new Error('Jump reserved bit nonzero');
    return {kind:'J',op:opcode===5?'JA':'JR',rd:(word>>>1)&7,imm:opcode===6?signed(i16,16):i16,display:`${opcode===5?'JA':'JR'} Wx${(word>>>1)&7}, ${opcode===6?signed(i16,16):i16}`};
  }
  if(opcode===7) {
    if ((word&1)||((word>>>16)&1))throw new Error('JRP reserved bit nonzero');
    const wrd=(word>>>1)&7,wrs=(word>>>17)&7;
    const imm=signed(((word>>>20)<<8)|((word>>>8)&255),12);
    return {kind:'JRP',op:'JRP',rd:wrd,rs1:wrs,imm,display:`JRP Wx${wrd}, Wx${wrs}, ${imm}`};
  }
  if(opcode===8) {
    if ((word & ~(0xf0000|0xf0))!==0) throw new Error('System reserved bits nonzero');
    const op=({0:'ECALL',1:'EBRAKE',14:'MRET'})[funct];
    if(!op)throw new Error(`Unknown SYSTEM funct ${funct}`);
    return {kind:'SYS',op,display:op};
  }
  throw new Error(`Unknown opcode ${opcode} at ${hex(pc,4)}`);
}
export class ReferenceCpu extends CpuPort {
  constructor() { super(); this.memory = new Uint8Array(65536); this.programBytes=[]; this.reset(); }
  async load(bytes, metadata={}) {
    const origin=metadata.origin ?? 0;
    if (!Array.isArray(bytes) || bytes.some(v=>!Number.isInteger(v)||v<0||v>255)) throw new Error('CPU load requires byte array');
    if(origin<0 || origin+bytes.length>65536)throw new Error('CPU program outside 16-bit memory');
    this.origin=origin;this.programBytes=[...bytes];this.inputText=metadata.input ?? '';this.memory.fill(0);this.memory.set(bytes,origin); return this.reset();
  }
  async reset() {
    this.memory.fill(0);
    if(this.programBytes?.length) this.memory.set(this.programBytes,this.origin??0);
    this.registers=Array(8).fill(0);this.pc=this.origin??0;this.phaseIndex=0;this.halted=!this.programBytes?.length;this.error=null;
    this.lastSignals={};this.lastAlu={op:null,a:null,b:null,result:null};this.changedRegister=null;this.lastMemory=null;
    this.pending=null;this.lastInstruction=null;this.lastPhase='READY';this.lastVisuals={nodes:[],edges:[]};
    this.stdinBytes = new TextEncoder().encode(this.inputText ?? ''); this.inputCursor=0;this.stdout='';this.exitCode=null;
    return this.snapshot();
  }
  fetchWord() {
    if(this.pc<this.origin || this.pc+2>=this.origin+this.programBytes.length) throw new Error(`PC ${hex(this.pc,4)} outside loaded code`);
    return this.memory[this.pc] | (this.memory[this.pc+1]<<8) | (this.memory[this.pc+2]<<16);
  }
  current() { if(this.halted)return null;return decode(this.fetchWord(),this.pc); }
  evaluate(ins) {
    const result={nextPC:u16(this.pc+3),register:null,memory:null,alu:{op:null,a:null,b:null,result:null},signals:{}};
    const a = ins.rs1===undefined ? null : (ins.kind==='L'||ins.kind==='S'||ins.kind==='JRP'?this.registers[ins.rs1]:readByte(this.registers,ins.rs1));
    if(ins.kind==='R'||ins.kind==='I') {
      const b=ins.kind==='R'?readByte(this.registers,ins.rs2):u8(ins.imm);
      const v=operation(ins.op,a,b);
      result.register={kind:'byte',index:ins.rd,value:v};result.alu={op:ins.op,a,b,result:v};
      result.signals={byteReadA:`${labelByte(ins.rs1)} = ${hex(a,2)}`,byteReadB:ins.kind==='R'?`${labelByte(ins.rs2)} = ${hex(b,2)}`:'immediate',writeDest:labelByte(ins.rd),aluOp:ins.op};
    } else if(ins.kind==='L'||ins.kind==='S') {
      const addr=u16(a+ins.imm);
      if(ins.kind==='L')result.register={kind:'byte',index:ins.rd,value:this.memory[addr]};
      else result.memory={address:addr,value:readByte(this.registers,ins.rd)};
      result.signals={base:`Wx${ins.rs1}=${hex(a,4)}`,effectiveAddress:hex(addr,4),memOp:ins.op};
    } else if(ins.kind==='B') {
      const left=readByte(this.registers,ins.rs1),right=readByte(this.registers,ins.rs2);
      const take=ins.op==='BEQ'?left===right:ins.op==='BNE'?left!==right:ins.op==='BLT'?signed(left,8)<signed(right,8):left<right;
      if(take)result.nextPC=u16(this.pc+ins.imm);
      result.signals={compare:`${hex(left,2)} vs ${hex(right,2)}`,taken:take,offset:ins.imm};
    } else if(ins.kind==='J'||ins.kind==='JRP') {
      const v=ins.op==='JA'?ins.imm:ins.op==='JR'?this.pc+ins.imm:this.registers[ins.rs1]+ins.imm;
      result.nextPC=u16(v);result.register={kind:'word',index:ins.rd,value:u16(this.pc+3)};
      result.signals={link:`Wx${ins.rd} = ${hex(this.pc+3,4)}`,target:hex(result.nextPC,4)};
    } else if(ins.kind==='SYS') {
      if(ins.op==='EBRAKE')result.halt=true; // Demo policy: stop on EBRAKE, final trap semantics TBD.
      else if(ins.op==='ECALL') {
        const service=readByte(this.registers,2);
        if(service===1)result.io={kind:'putchar',value:readByte(this.registers,4)};
        else if(service===2)result.io={kind:'getchar'};
        else if(service===5){result.io={kind:'exit',code:this.registers[2]};result.halt=true;}
        else throw new Error(`Unsupported WA824 ECALL service ${service}`);
      } else throw new Error(`${ins.op} trap behavior not yet specified in ISA`);
    }
    return result;
  }
  visuals(phase,ins) {
    const nodes=['pc'],edges=[];
    if(phase.startsWith('FETCH')){nodes.push('ifu','mem');edges.push('pc-ifu','mem-ifu');}
    else if(phase==='DECODE'){nodes.push('ifu','ir','decoder','controller');edges.push('ifu-ir','ir-decoder');}
    else if(phase==='EXECUTE'){
      nodes.push('decoder','rf');edges.push('decoder-rf');
      if(ins?.kind==='R'||ins?.kind==='I'){nodes.push('alu');edges.push('rf-alu-a','decoder-alu');if(ins.kind==='R')edges.push('rf-alu-b');}
      if(['L','S','JRP'].includes(ins?.kind)){nodes.push('agu');edges.push('rf-agu','decoder-agu');}
      if(ins?.kind==='B'){nodes.push('branch');edges.push('rf-branch');}
      if(['L','S'].includes(ins?.kind)){nodes.push('lsu','mem');edges.push('agu-lsu','lsu-mem');}
    } else if(phase==='COMMIT') {
      nodes.push('pc');
      if(['R','I','L','J','JRP'].includes(ins?.kind)){nodes.push('wb','rf');edges.push('wb-rf');}
      if(ins?.kind==='B'){nodes.push('branch');edges.push('branch-pc');}
      if(ins?.kind==='J'||ins?.kind==='JRP')edges.push('branch-pc');
    }
    return {nodes,edges};
  }
  async step() {
    if(this.halted)return this.snapshot();
    const phase=PHASES[this.phaseIndex];
    const ins=this.current();
    this.changedRegister=null;this.lastPhase=phase;this.lastInstruction=ins;
    this.lastVisuals=this.visuals(phase,ins);
    this.lastSignals={phase,pc:hex(this.pc,4),instructionClass:ins.kind};
    if(phase.startsWith('FETCH'))this.lastSignals.fetchAddress=hex(u16(this.pc+Number(phase.slice(-1))),4);
    if(phase==='EXECUTE') {
      this.pending=this.evaluate(ins);this.lastAlu=this.pending.alu;Object.assign(this.lastSignals,this.pending.signals);
    }
    if(phase==='COMMIT') {
      if(!this.pending)throw new Error('CPU commit without evaluated instruction');
      const p=this.pending;
      if(p.register){this.changedRegister=p.register.kind==='word'?writeWord(this.registers,p.register.index,p.register.value):writeByte(this.registers,p.register.index,p.register.value);}
      if(p.memory){this.memory[p.memory.address]=u8(p.memory.value);this.lastMemory={...p.memory};}
      if(p.io?.kind==='putchar')this.stdout+=String.fromCharCode(p.io.value);
      if(p.io?.kind==='getchar'){
        const ch=this.inputCursor<this.stdinBytes.length?this.stdinBytes[this.inputCursor++]:-1;
        writeWord(this.registers,2,ch<0?65535:ch);
        this.changedRegister=2;
      }
      if(p.io?.kind==='exit')this.exitCode=p.io.code;
      this.pc=p.nextPC;
      Object.assign(this.lastSignals,p.signals,{pcAction:p.halt?'HALT':hex(this.pc,4)});
      this.pending=null;
      if(p.halt || this.pc<this.origin || this.pc+2>=this.origin+this.programBytes.length)this.halted=true;
    }
    const snap=this.snapshot();
    this.phaseIndex=(this.phaseIndex+1)%PHASES.length;
    return snap;
  }
  async runToEnd(maxPhases=300000) {
    let i=0;
    while(!this.halted && i<maxPhases) {
      await this.step();i++;
      // Allow the browser to paint and service inputs during long programs.
      if(i%512===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    if(!this.halted)throw new Error(`Program exceeded ${maxPhases} CPU phases`);
    return this.snapshot();
  }
  async snapshot() {
    const ins=this.lastInstruction ?? (this.halted?null:this.current());
    const idx=Math.floor((this.pc-(this.origin??0))/3);
    return {halted:this.halted,pc:this.pc,pcHex:hex(this.pc,4),phase:this.lastPhase,
      instructionIndex:Math.max(0,Math.min(Math.floor((this.programBytes?.length??0)/3)-1,idx)),
      instructionCount:Math.floor((this.programBytes?.length??0)/3),instruction:ins?{display:ins.display}:null,
      registers:[...this.registers],changedRegister:this.changedRegister,alu:{...this.lastAlu},
      signals:{...this.lastSignals},activeNodes:this.lastVisuals.nodes,activeEdges:this.lastVisuals.edges, memoryChange:this.lastMemory, stdout:this.stdout, exitCode:this.exitCode, stdinRemaining:this.stdinBytes.length-this.inputCursor};
  }
}
