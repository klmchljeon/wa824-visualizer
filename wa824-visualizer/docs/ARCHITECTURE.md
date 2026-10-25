> Public-tool note: student-owned draw.io source diagrams are intentionally not bundled. The JSON diagram is an illustrative implementation, not an authoritative reproduction of a student circuit.

# Visualizer architecture

## 목표

시연 UI를 먼저 만들되, 나중에 실제 컴파일러/어셈블러/SystemC CPU가 완성되었을 때 **시각화 코드를 갈아엎지 않는 것**이 목표다.

## Adapter boundary

```text
┌───────────────┐
│ C Source UI   │
└───────┬───────┘
        │
        ▼
┌───────────────┐   current: MockCompiler
│ CompilerPort  │   future : WA824 compiler
└───────┬───────┘
        ▼
┌───────────────┐   current: MockAssembler
│ AssemblerPort │   future : WA824 assembler
└───────┬───────┘
        ▼
┌───────────────┐   current: MockCpu
│ CpuPort       │   future : emulator / SystemC bridge / trace replay
└───────┬───────┘
        ▼
┌────────────────────────────┐
│ Snapshot                   │
│ PC / registers / signals   │
│ active nodes / active edge │
└───────┬────────────────────┘
        ▼
┌────────────────────────────┐
│ Visualizer                 │
└────────────────────────────┘
```

## WA824 assumptions used in the mock CPU

These are taken from the supplied ISA / improved architecture rather than invented as final ISA rules:

- instruction width: 24 bits
- external memory data path: 8 bits
- architectural PC increment for sequential instruction: 3 bytes
- 8 physical registers × 16 bits
- normal arithmetic accesses h/l byte halves
- R-Type has RS1 + RS2 + RD and can benefit from parallel byte read A/B
- improved design keeps architectural PC stable during three IFU byte fetches, then commits the next PC

## Deliberately unresolved

- byte register numeric encoding (`xNh/xNl` ↔ 4-bit field ID)
- constant materialization convention
- ECALL/EBRAKE trap target and exact EPC capture policy
- exact SystemC bridge protocol
