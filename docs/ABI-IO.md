# WA824-FREESTANDING-1 — ABI, memory and ECALL contract

**Project extension** to the original WA824 ISA (not redistributed here) and [`ISA-DECISIONS.md`](ISA-DECISIONS.md). The original ISA does not define an ABI or I/O services. This file is the agreement between the bundled C compiler, assembler, JS reference CPU, Python bridge, and proposed Verilog CPU simulation. It is **not** a hardware/OS standard.

## Data model

* Little-endian bytes, 24-bit fixed instructions, PC normally advances by 3.
* `char`, `signed char`, `unsigned char`, `uint8_t`, `int8_t`: 8 bits.
* `short`, `int`, `unsigned short`, `unsigned int`, `int16_t`, `uint16_t`, pointers: **16 bits**. No 32-bit integer backend or floating point.
* Machine integer arithmetic wraps modulo 2^16; C signed-overflow UB and other language corner cases are not fully modeled.
* `x0l`, `x0h`, `Wx0`: hardware zero register, never modified.
* Byte register encoding `xNl=2N`, `xNh=2N+1`. `WxN` is the word holding both bytes.
* All words in memory use little-endian order. `int[ ]` uses 2 bytes/element; `char[ ]` uses 1.
* 16-bit address space `0x0000..0xFFFF`. No MMU, heap, code/data protection, stack bounds hardware, or interrupts.

## Register roles (function-call convention)

| Word | Role | Lifetime |
|---|---|---|
| `Wx0` | constant zero | immutable |
| `Wx1` | 16-bit expression accumulator, function return | caller-clobbered |
| `Wx2` | second expression operand / syscall argument/result | caller-clobbered |
| `Wx3` | compiler carry/borrow scratch | caller-clobbered |
| `Wx4` | address calculation scratch | caller-clobbered |
| `Wx5` | return address link (`JA Wx5,callee`) | overwritten on every call, callee saves it |
| `Wx6` | frame pointer (`FP`) | callee restores |
| `Wx7` | downward-growing stack pointer (`SP`) | balanced by all calls |

## Call frame and stack

The entry stub sets `Wx7=0xFFFE`, calls `main` via `JA Wx5,__fn_main`, then takes `Wx1` as the 16-bit exit code in `Wx2` and executes ECALL service 5. The stack grows **down**. The compiler uses 2 bytes per argument, pushed left-to-right, including 8-bit values widened to 16 bits.

On entry to each function, the callee pushes the old `Wx6` and then the incoming `Wx5`, copies SP to FP, and subtracts its local-frame byte count. Therefore FP offsets are:

```
FP+0..1   saved caller link (Wx5)
FP+2..3   saved caller frame pointer (Wx6)
FP+4..5   final argument
FP+6..7   penultimate argument
...
FP-2..-1  first 16-bit local; later locals lower down
```

The result is always returned in `Wx1`. Return restores SP, saved Wx5, saved Wx6, then jumps to the saved Wx5 with `JRP Wx0,Wx5,0`. Caller removes arguments after return. All temporary expressions are spilled onto the stack, so nested functions and recursion work. Register roles apply to **generated program code**; direct assembly is free to use all regs as long as it honors the external ECALL contract.

The 8-bit machine ALU is used to synthesize 16-bit addition, subtraction and comparisons. Multiplication, signed/unsigned division and remainder are software subroutines. These routines may be slow. A divide-by-zero result is **not defined**, and min-signed overflow cases are not guaranteed by the C subset.

### Memory map

* `0x0000` upwards: code loaded as consecutive 3-byte instructions, origin 0. No built-in separate `.data` section.
* Local arrays/values, parameters and return addresses: stack from `0xFFFE` downwards.
* The byte at `0xFFFF` is used by the stack only if SP reaches it (initial SP is `0xFFFE`).
* No automatic stack-overflow protection. Programs must stay well below 64KiB total footprint; practical upper bounds depend on code size and recursion depth.
* Initial RAM is zero for educational determinism; uninitialized C local variables are not given ISO-C semantics guarantees.

## Simulator ECALL ABI

`ECALL` remains opcode `0x8`, funct `0`; no new opcodes or encodings are added. It is dispatched in the **emulator/testbench**, not by real operating-system firmware.

| `x1l` service | Input | Output | Effect |
|---|---|---|---|
| 1 (`putchar`) | `x2l` byte | none | append byte to stdout |
| 2 (`getchar`) | none | **`Wx2`**, 0..255 or `0xFFFF` at EOF | consume one stdin byte |
| 5 (`exit`) | `Wx2` 16-bit code | halt | end simulation and expose exit code |

All other service numbers currently fault. `EBRAKE` still halts as the earlier demo convention, **without an exit code**. `MRET` is unsupported. These are **semihosting-like simulation services**, not actual UART or keyboard circuits; physical FPGA I/O would require a peripheral or host bridge. I/O operates on UTF-8 input bytes; stdout bytes display as individual code points, so non-ASCII Unicode is not yet decoded as UTF-8 output.

The UI sends stdin at **Build & Load** time. The JS CPU consumes it during execution; the Icarus backend receives it in the testbench's input file. The Verilog bridge eagerly computes a complete clock trace on `/api/cpu/load` and `Step`/`Run` replay this trace. `Run to End` jumps to its last snapshot; it does **not** drive a new live simulation.

## C library and format I/O

`backend/python/runtime.c` defines compiled C functions `print_int`, `read_int`, and `puts_wa`. Other functions are compiler builtins that expand to ECALL or runtime calls:

* `putchar(int)`, `getchar()`, `exit(int)` — inline ECALL lowering.
* `print_int(int)` — decimal signed-16 print using C code and software division.
* `read_int()` — parse signed decimal from stdin using C code.
* `printf("literal %d %c %%\\n", ...)` — **literal** format string, only `%d`, `%c`, `%%`, emitted as byte puts and `print_int` calls. Return value is a placeholder, not fully standards-compliant.
* `scanf("%d %d", &a, &b)` — literal pattern of whitespace-separated `%d` specifiers only. Return value is a placeholder; EOF/error conversion counts are not modeled.
* `puts("literal")` — string literal only.

`#include <stdio.h>` and `#include <stdint.h>` directives are ignored as a convenience; no real headers are processed. This is not a hosted C implementation.

## Deliberate C subset restrictions

Supports local scalar and fixed-length array variables, scalar pointers and `a[i]`, array initialization lists, `char s[N]="..."`, functions (fixed arguments) and recursion, statements `if/else`, `while`, `for`, `break`, `continue`, `return`, `++/--`, assignments including `+=`, expressions including 16-bit `+ - * / % & | ^ << >>`, comparisons, `&& || !`, ternary operator, casts, address/deref. Standard signed and unsigned division are implemented in software for the tested operand range.

**Unsupported / not guaranteed**: global and static variables; structs/unions/enums; floating point; variadic user functions; dynamic memory (`malloc/free`); function pointers; general C string literals as pointer values (only supported via char-array initializers and the limited `printf/puts` lowering); block shadowing (local names must be unique within a function); general macros/preprocessing; advanced casts; pointer arithmetic scaling outside array indexing; full C promotion rules and unspecified evaluation-order semantics; proper `printf` and `scanf` complete format/error behavior; code/stack collision handling, integer overflow corner cases. Do not use this as a safety-critical or fully conforming C toolchain.
