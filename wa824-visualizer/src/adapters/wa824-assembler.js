import { AssemblerPort } from '../ports/assembler-port.js';

// WA824 instruction words are 24-bit, packed as 3 little-endian bytes.
// Byte-register convention (project extension): xNl = 2*N, xNh = 2*N+1.
const R_FUNCT = Object.freeze({ ADD:0, SUB:1, AND:2, OR:3, XOR:4, SLL:5, SL:6, SRA:7, SLT:8, SLTU:9 });
const I_FUNCT = Object.freeze({ ADDI:0, ANDI:2, ORI:3, XORI:4, SLLI:5, SLI:6, SRAI:7, SLTI:8, SLTUI:9 });
const B_FUNCT = Object.freeze({ BEQ:0, BNE:1, BLT:2, BLTU:3 });
const SYS_FUNCT = Object.freeze({ ECALL:0, EBRAKE:1, MRET:14 });
const ALIASES = Object.freeze({ NOP:'ADDI x0l, x0l, 0' }); // The only supported pseudo instruction for now.

function fail(line, message) { throw new Error(`Assembly line ${line}: ${message}`); }
function register(text, line, word = false) {
  const m = (word ? /^wx([0-7])$/i : /^x([0-7])([hl])$/i).exec(text?.trim() ?? '');
  if (!m) fail(line, `expected ${word ? 'Wx0..Wx7' : 'x0l/x0h..x7l/x7h'}, got '${text ?? ''}'`);
  return word ? Number(m[1]) : (Number(m[1]) * 2 + (m[2].toLowerCase() === 'h' ? 1 : 0));
}
function splitOperands(rest) { return rest ? rest.split(',').map(x => x.trim()) : []; }
function countOperands(ops, n, line) { if (ops.length !== n || ops.some(x => !x)) fail(line, `expected ${n} operand(s), got ${ops.length}`); }
function numberOrLabel(text, labels, line) {
  const t = text.trim();
  if (/^[a-z_]\w*$/i.test(t)) {
    if (!Object.hasOwn(labels, t)) fail(line, `undefined label '${t}'`);
    return labels[t];
  }
  if (!/^[+-]?(?:0x[\da-f]+|0b[01]+|\d+)$/i.test(t)) fail(line, `invalid integer/label '${t}'`);
  const sign = t.startsWith('-') ? -1 : 1;
  const absolute = t.replace(/^[+-]/, '');
  const n = sign * Number(absolute);
  if (!Number.isSafeInteger(n)) fail(line, `integer overflow '${t}'`);
  return n;
}
function imm(text, labels, line, bits, { signed = true, relative = false, pc = 0 } = {}) {
  const label = /^[a-z_]\w*$/i.test(text.trim());
  let n = numberOrLabel(text, labels, line);
  if (relative && label) n -= pc; // numeric operands already mean explicit byte offsets
  const min = signed ? -(2 ** (bits - 1)) : 0;
  const max = signed ? 2 ** (bits - 1) - 1 : 2 ** bits - 1;
  if (n < min || n > max) fail(line, `immediate ${n} out of range [${min},${max}] (${bits}-bit ${signed ? 'signed' : 'unsigned'})`);
  return n & (2 ** bits - 1);
}
function encode(mnemonic, ops, line, pc, labels) {
  if (Object.hasOwn(R_FUNCT, mnemonic)) {
    countOperands(ops,3,line);
    const [rd,rs1,rs2] = ops.map(x => register(x,line));
    return (R_FUNCT[mnemonic] << 16) | (rs1 << 12) | (rs2 << 8) | rd;
  }
  if (Object.hasOwn(I_FUNCT, mnemonic)) {
    countOperands(ops,3,line);
    const rd = register(ops[0],line), rs = register(ops[1],line);
    const v = imm(ops[2],labels,line,8);
    return ((v >>> 4) << 20) | (I_FUNCT[mnemonic] << 16) | (rs << 12) | ((v & 15) << 8) | 0x10 | rd;
  }
  if (mnemonic === 'L' || mnemonic === 'S') {
    countOperands(ops,3,line);
    const dataReg = register(ops[0],line);
    const base = register(ops[1],line,true);
    const v = imm(ops[2],labels,line,12);
    return ((v >>> 4) << 16) | (base << 13) | ((v & 15) << 8) | ((mnemonic === 'L' ? 2 : 3) << 4) | dataReg;
  }
  if (Object.hasOwn(B_FUNCT,mnemonic)) {
    countOperands(ops,3,line);
    const rs1 = register(ops[0],line), rs2 = register(ops[1],line);
    const v = imm(ops[2],labels,line,8,{relative:true,pc});
    return ((v >>> 4) << 20) | (B_FUNCT[mnemonic] << 16) | (rs1 << 12) | ((v & 15) << 8) | 0x40 | rs2;
  }
  if (mnemonic === 'JA' || mnemonic === 'JR') {
    countOperands(ops,2,line);
    const wrd = register(ops[0],line,true);
    const v = imm(ops[1],labels,line,16,{signed:mnemonic === 'JR',relative:mnemonic === 'JR',pc});
    return ((v >>> 8) << 16) | ((v & 255) << 8) | ((mnemonic === 'JA' ? 5 : 6) << 4) | (wrd << 1);
  }
  if (mnemonic === 'JRP') {
    countOperands(ops,3,line);
    const wrd = register(ops[0],line,true), wrs = register(ops[1],line,true);
    const v = imm(ops[2],labels,line,12);
    return ((v >>> 8) << 20) | (wrs << 17) | ((v & 255) << 8) | 0x70 | (wrd << 1);
  }
  if (Object.hasOwn(SYS_FUNCT,mnemonic)) {
    countOperands(ops,0,line);
    return (SYS_FUNCT[mnemonic] << 16) | 0x80;
  }
  fail(line, `unknown instruction '${mnemonic}'`);
}

export class Wa824Assembler extends AssemblerPort {
  assemble(assembly, options = {}) {
    if (typeof assembly !== 'string') throw new TypeError('assemble requires an Assembly string');
    const origin = options.origin ?? 0;
    if (!Number.isInteger(origin) || origin < 0 || origin > 0xffff) throw new Error('origin must be a 16-bit address');
    const lines = assembly.replace(/\r/g,'').split('\n');
    const parsed = [], labels = Object.create(null);
    let pc = origin;
    lines.forEach((raw, i) => {
      let t = raw.replace(/(?:;|\/\/|#).*$/, '').trim();
      if (!t) return;
      while (true) {
        const match = /^([a-z_]\w*):\s*/i.exec(t);
        if (!match) break;
        const label = match[1];
        if (Object.hasOwn(labels,label)) fail(i+1,`duplicate label '${label}'`);
        labels[label] = pc;
        t = t.slice(match[0].length).trim();
      }
      if (!t) return;
      if (pc + 3 > 0x10000) fail(i+1,'program exceeds address space');
      if (/^NOP\s*$/i.test(t)) t = ALIASES.NOP;
      const match = /^([a-z][a-z0-9]*)\b\s*(.*?)\s*$/i.exec(t);
      if (!match) fail(i+1,`invalid instruction syntax '${t}'`);
      parsed.push({ mnemonic:match[1].toUpperCase(),ops:splitOperands(match[2]), sourceLine:i+1, text:t, pc });
      pc += 3;
    });
    if (!parsed.length) throw new Error('Assembly contains no instructions');
    const bytes = [], instructions = [];
    for (const entry of parsed) {
      const word = encode(entry.mnemonic,entry.ops,entry.sourceLine,entry.pc,labels) >>> 0;
      const insBytes = [word&255, (word>>>8)&255,(word>>>16)&255];
      bytes.push(...insBytes);
      instructions.push({ ...entry,word,bytes:insBytes, hex:word.toString(16).toUpperCase().padStart(6,'0'),display:entry.text });
    }
    return {origin, bytes, instructions, labels:{...labels},assemblyLines:instructions.map(x => ({text:x.display,sourceLine:x.sourceLine,pc:x.pc})),encodings:instructions.map(x => ({text:`0x${x.hex}  [${x.bytes.map(b=>b.toString(16).padStart(2,'0').toUpperCase()).join(' ')}]`,exact:true,note:`Memory bytes (little endian); address 0x${x.pc.toString(16).padStart(4,'0')}`}))};
  }
}
