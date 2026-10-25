# WA824 assembly / encoding decisions (project additions)

This document adds conventions made **after** the original `ISA.ko-KR.MD`. The original student-authored ISA document is not redistributed in this public tool bundle; see `WA824-ISA-COMPAT.md` for a compatibility summary. Rules described below are project decisions, not implicit facts in the source ISA.

## Confirmed / adopted

- **Physical registers:** `x0..x7`, each 16-bit. `x0` is read-only architectural zero; *all* reads of `x0l`, `x0h`, and `Wx0` return 0, and all writes are ignored.
- **Byte register encodings:** for word register index N, `xNl = 2*N`, `xNh = 2*N+1`, giving the 4-bit range 0..15. Word register `WxN` is the 3-bit index N.
- **I-Type immediate:** signed 8-bit two's complement, range -128..127. For the 8-bit ALU, the encoded bit pattern is fed as a byte operand (e.g., -1 is 0xFF). Shift counts are masked to the low 3 bits by **both the JS reference CPU and this educational RTL CPU**; this remains an implementation policy pending final ISA ratification.
- **L / S / JRP immediate:** signed 12-bit two's complement, range -2048..2047.
- **B-Type immediate:** signed 8-bit byte offset relative to address of current instruction, range -128..127. Labels are resolved using `target - current_pc`, not `target - (pc+3)`.
- **JA-Type:** unsigned 16-bit absolute byte address, range 0..65535.
- **JR-Type:** signed 16-bit offset relative to current PC, range -32768..32767. A label is converted to `target - current_pc`.
- **JRP-Type:** signed 12-bit offset added to the 16-bit contents of `WRS`.
- **Byte order:** 24-bit instruction is stored at `[PC] = bits[7:0]`, `[PC+1] = bits[15:8]`, `[PC+2] = bits[23:16]` (little endian). For example machine word `0x002304` is memory bytes `04 23 00`.
- **Normal PC:** advances 3 bytes per instruction, except control flow. Program default origin 0.
- **Assembly syntax:** uppercase/lowercase mnemonics accepted; canonical `OP destination, source, source` for R/I. L/S: `L xNl, WxN, signed_offset`, `S xNl, WxN, signed_offset`; branch: `BEQ xNl, xNh, target`; jump: `JA WxN, target`, `JR WxN, signed_offset`, `JRP WxD, WxS, signed_offset`.
- **Assembler reserved fields:** 0. Unknown instructions, invalid regs, unresolved labels, duplicate labels, and out-of-range immediates are errors.
- **Labels:** `name:` on a line or before instruction; two passes. Integer offsets typed directly are literal offsets (never converted again). Comments `;`, `//`, `#`. One instruction = three bytes. Pseudo-instruction `NOP` expands to `ADDI x0l, x0l, 0`.
- **I-Type mnemonics:** `ADDI ANDI ORI XORI SLLI SLI SRAI SLTI SLTUI`; `SUBI` rejected because original ISA explicitly excludes it. Funct values match their R-type counterparts.
- **R-Type mnemonics:** `ADD SUB AND OR XOR SLL SL SRA SLT SLTU`.
- **System mnemonics:** `ECALL EBRAKE MRET`, encoded with reserved bits zero.

## Not yet settled by the source ISA (do not mistake demo behavior for ISA)

1. Original ISA lists `SL` (funct 6) without defining its semantics. The assembler **encodes** `SL` / `SLI`, but the JS reference CPU deliberately throws if executed. The RTL raises a fault for this function rather than silently implementing an unspecified operation.
2. `ECALL`, `EBRAKE`, and `MRET` trap/return semantics and EPC handling are not specified in detail. Both the JS reference CPU and the prototype RTL treat `EBRAKE` as a demo halt; `ECALL/MRET` report unsupported. This is **not** a final trap or EPC contract.
3. Very large constants and C language features such as stack, function calling convention, ABI, pointers, memory layout, signed-vs-unsigned type behavior, or storage beyond 14 writable byte halves are not implemented by the tiny Python demo compiler.
4. The 8-bit shift-count truncation is an explicit demo policy. In the bundled 6-state RTL core, FETCH0/1/2, DECODE, EXECUTE, COMMIT are real clocked states; this is one possible microarchitectural implementation, not a fixed ISA timing requirement.
5. This prototype assumes separate **8-bit data operations** and **16-bit memory addresses** as indicated by the ISA. If the eventual microarchitecture requires different memory-mapped IO, add contracts explicitly.

## Field positions (LSB 0)

```
R   [23:20]reserved [19:16]funct [15:12]rs1 [11:8]rs2 [7:4]opcode=0 [3:0]rd
I   [23:20]imm7:4   [19:16]funct [15:12]rs  [11:8]imm3:0 [7:4]opcode=1 [3:0]rd
L/S [23:16]imm11:4  [15:13]wrs [12]0    [11:8]imm3:0 [7:4]opcode=2/3 [3:0]rd/rs
B   [23:20]imm7:4   [19:16]funct [15:12]rs1 [11:8]imm3:0 [7:4]opcode=4 [3:0]rs2
JA/R[23:16]imm15:8  [15:8]imm7:0 [7:4]opcode=5/6 [3:1]wrd [0]0
JRP [23:20]imm11:8  [19:17]wrs [16]0 [15:8]imm7:0 [7:4]opcode=7 [3:1]wrd [0]0
SYS [23:20]0 [19:16]funct [15:8]0 [7:4]opcode=8 [3:0]0
```

## v4 clarification (2026-10-11)

The `ECALL`-unsupported statements above describe **the historical v3 prototype**, not the v4 toolchain. In v4, the original `ECALL` *encoding* is unchanged, but a **simulator semihosting ABI** is introduced: service 1 putchar, service 2 getchar, service 5 exit. Details are specified in `ABI-IO.md`. `MRET` and `SL/SLI` remain undefined and unsupported. The original ISA is not being edited or implicitly interpreted as already defining these I/O services.
