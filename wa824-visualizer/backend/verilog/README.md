# WA824 Verilog CPU (educational multicycle core)

## Files

- `rtl/wa824_core.v`: top-level control FSM, 24-bit 3-byte instruction register, 16-bit PC, sign-extended immediate/address/branch/jump logic, commit pipeline, debug signals.
- `rtl/wa824_alu.v`: 8-bit ALU.
- `rtl/wa824_register_file.v`: eight 16-bit physical registers, 2×8-bit and 1×16-bit asynchronous read ports; `Wx0`/`x0l`/`x0h` hardwired zero.
- `rtl/wa824_ram.v`: byte-addressed 64 KiB read-combinational write-clocked simulation RAM (not a production memory macro).
- `rtl/tb_wa824.v`: Icarus Verilog simulation harness, reads 64K initialized bytes, applies reset and clock, emits a `TRACE` line for every edge.
- `runner.py`: Python JSON stdin/stdout adapter; invokes `iverilog -g2012` and `vvp` in a fresh temporary folder and converts *actual RTL probe values* to visualizer snapshots.

## Actual hardware clocking model

| RTL state | Clock-edge behavior |
|---|---|
| FETCH0 | Store memory byte `[PC]` into `IR[7:0]` |
| FETCH1 | Store memory byte `[PC+1]` into `IR[15:8]` |
| FETCH2 | Store memory byte `[PC+2]` into `IR[23:16]` |
| DECODE | Control-state advancement; the opcode fields are decoded combinationally |
| EXECUTE | Compute ALU/branch/effective address, read byte for load, save pending updates |
| COMMIT | Write register / data memory, advance PC, optionally halt |

One browser **Step = one completed rising-edge transition** (initial READY snapshot before first edge). `Run` replays these snapshots at UI speed. The simulator is run to termination when clicking `Build & Load`, *not* restarted per Step.

Normal PC increments by three; branch offsets are relative to current PC; jumps save `PC+3` into their `WRD` unless `WRD==Wx0`.

The design is not pipelined. Memory reads are assumed combinational; a target FPGA block RAM might require retiming/handshake. `EBRAKE` stops as a teaching convention; `SL`, `SLI`, `ECALL`, `MRET`, reserved codes fault rather than pretending they have stable architectural semantics. Full ISA trap protocol, ABI, MMIO and toolchain are future work.

## Standalone execution

```bash
# From project root, with iverilog and vvp on PATH:
node tools/assemble.mjs examples/demo.asm /tmp/demo
python backend/verilog/runner.py <<EOF_INPUT > /tmp/trace.json
{"origin":0,"bytes":[18,3,0,19,5,0,4,35,0,5,67,4,128,0,1]}
EOF_INPUT
```

The runner prints one object with `programSha256` and `snapshots[]`. Every register/PC/IR/ALU data value comes from the actual Icarus simulation; text disassembly and highlight annotations are added by Python for the UI only. No JS CPU is involved in the Verilog execution path.

A terminating program is currently required; an endless loop produces a timeout error instead of a fabricated halt. Adjust `WA824_MAX_RTL_CYCLES` (default 12000) for longer terminating programs. The enclosing server has a separate 30-second trace-runner timeout.

## Validation

`node --test tests/*.test.js` includes seven cases comparing **all six RTL clock stages** against `ReferenceCpu`, including signed arithmetic, zero-register writes, data memory, branch loop, jumps/link, and nonzero code origin. These tests are automatically *skipped* if Icarus Verilog is unavailable. Python's `test_runner.py`, `test_server.py`, and `test_http.py` verify parsing and bridge transport but **do not replace the RTL-vs-JS execution comparison**.

## v4 addition — ECALL semihosting (supersedes earlier ECALL-unsupported note)

The v4 core has additional simulation I/O pins (`io_input_byte`, `io_input_valid`, `io_read_strobe`, `io_write_strobe`, `io_write_data`, `io_exit_strobe`, `io_exit_code`). Only ECALL services 1 (putchar), 2 (getchar, returning `Wx2` or `0xFFFF` EOF), and 5 (exit with `Wx2`) are defined. The testbench reads `+STDINFILE`/`+STDINLEN` and emits `IO_PUT` / `IO_EXIT` events. `runner.py` attaches cumulative stdout and exitCode to snapshots. `SL/SLI` and `MRET` remain invalid/unsupported. See `docs/ABI-IO.md` for the v4 contract. The I/O pins and testbench are for **simulation**, not a synthesizable UART implementation.
