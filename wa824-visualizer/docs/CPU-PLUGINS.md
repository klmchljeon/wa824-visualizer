# WA824 CPU plugins — dynamic architecture & runtime (modular v4)

## Result

The **ISA, compiler and assembler stay fixed at WA824**. The Python server
scans `cpus/<folder-name>/` whenever the browser fetches `/api/cpus`.
A complete CPU folder is offered in the **CPU** selector on page load:

```text
cpus/
  reference/
    architecture.json
    adapter.js
    implementation/  (actual JavaScript reference emulator)
    cpu.json         (optional friendly name/description)
  verilog/
    architecture.json
    adapter.js
    implementation/  (real Verilog sources and Icarus runner.py)
    cpu.json         (optional)
  my-systemc-cpu/    (future)
    architecture.json
    adapter.js
    implementation/  (SystemC implementation + runner.py)
```

The browser must **refresh** to discover an added/removed folder. No rebuild or
manual registry edits are required when launched via `start.bat` / `start.sh`.
The browser cannot enumerate local directories on its own; the *local Python
server* supplies discovery. Directory name is the stable CPU identifier.

`architecture.json` specifies diagram geometry, nodes, edges, phases and
optional stage lanes. `adapter.js` exports `createCpu({id, manifest,
architecture})` returning `load`, `reset`, `step`, `snapshot`, `runToEnd`.
`implementation/` contains the CPU code or integration program. `cpu.json` is
optional. Do **not** simply copy a draw.io file into this folder: its elements
need mapping to architecture IDs and real CPU signal names.

## Architecture JSON schema v1

See `cpus/reference/architecture.json` for the original v4 visual layout,
and `templates/systemc-cpu/architecture.json` for a **non-executable** 5-stage
pipeline diagram example.

```json
{
  "schemaVersion": 1,
  "isa": "WA824",
  "name": "Your CPU diagram",
  "description": "Description shown above diagram",
  "viewBox": [0, 0, 1200, 600],
  "phases": [{"id":"IF", "label":"Fetch"}, {"id":"EX", "label":"Execute"}],
  "nodes": [{"id":"alu", "x":100, "y":100, "width":140, "height":100,
             "label":"ALU", "details":["8-bit result"]}],
  "edges": [{"id":"alu-to-next", "from":"alu", "to":"next"}]
}
```

Edges can use a SVG `path` for accurate hand-placed routing (as with the
original v4), or `from`/`to` node IDs for straight automatic paths. `lanes`
can describe stage regions via `{label,x,y,width,height}`; dynamic renderer
uses their positions. Node ids / edge ids are **the exact keys** expected in
runtime snapshots. Optional `nodeValues: {alu:"result=42"}` adds a hover
value. Arbitrary architecture complexity requires appropriate explicit layout;
this project is **not an automatic SystemC/netlist/draw.io parser**.

## SystemC / Verilog runner protocol

For native CPU plugins, use the generic adapter:

```js
import { TraceCpu } from '../../src/adapters/trace-cpu.js';
export function createCpu({ id }) { return new TraceCpu(id); }
```

Provide `implementation/runner.py` to run the real CPU in a separate process.
The server calls it with stdin JSON containing `bytes`, `origin`, `input`,
expects stdout JSON with matching `programSha256` and ordered `snapshots`. One
snapshot should represent the initial state; others represent **real** clock
or execution events. Each snapshot needs:

```json
{
  "pc":0, "registers":[0,0,0,0,0,0,0,0],
  "phase":"IF", "activePhases":["IF","ID","EX"],
  "halted":false, "signals":{"stall":false},
  "activeNodes":["ifu","decoder","alu"], "activeEdges":["if-id","id-ex"],
  "nodeValues":{"alu":"result=0x2A"}, "stdout":"", "exitCode":null
}
```

`activePhases` is optional; a pipeline should supply simultaneous stages.
Stage identities and signals must come from actual CPU execution. CPU register
order remains `Wx0..Wx7` (16 bits each), matching fixed WA824 ISA. For
compatibility, keep `instructionIndex`, `instructionCount`, `instruction`,
`alu`, `changedRegister`, `stdout`, `exitCode`, `memoryChange` when available.
The trace runner must always produce a final `halted:true` state to allow
Run to End to terminate correctly. Hard limit: 200,000 snapshots and a 30s
runner timeout per load (configurable in code for larger programs).

The server provides `/api/cpus/<id>/load|step|reset|run|snapshot`, with independent
replay sessions per CPU. Existing `/api/cpu/*` routes remain available for
old v4 integrations. The included JS reference CPU uses the browser adapter
and requires no runner. **The Verilog plugin requires Icarus (`iverilog`, `vvp`).**

## Scope & expectations

- Current `reference` and `verilog` plugins share the **original v4 architecture**;
  one is a pedagogical JS model and the other executes the real RTL. They are
  **not two different student microarchitectures**. A later SystemC pipeline
  plugin can provide a different diagram without changing the common UI.
- Switching CPUs clears the prior trace and switches diagrams immediately;
  click **Build & Load** to execute the same WA824 source under the new CPU.
- A CPU folder with `architecture.json`/`adapter.js` but **without a working
  implementation** cannot execute. A SystemC bridge requires wiring real
  debug signals and inspecting its testbench; it is not automatic.
- Pipeline instruction presentation in the existing assembly panel is still
  single-index oriented. The generic stage strip can show multiple stages,
  but richer per-inflight-instruction visualization can be added when a real
  pipeline trace format has been determined.
- Local development server runs plugin code and trace runner with the user's
  permissions. Only install trusted local CPU plugins. This is not a secure
  multi-user code hosting/sandboxing service.

## Verify

```sh
node --test tests/*.test.js
python -m unittest discover -s backend/verilog -p 'test_*.py'
python -m unittest discover -s backend -p 'test_cpu_plugins.py'
python backend/python/test_compiler.py
```

Copy `templates/systemc-cpu/` to `cpus/my-systemc-cpu/`, implement its real
`implementation/runner.py`, customize the architecture, then refresh the web UI.
