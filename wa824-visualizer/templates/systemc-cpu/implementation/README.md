# SystemC CPU implementation goes here

Create a real SystemC CPU and a local `runner.py` in this directory.
The runner is a CPU-specific bridge, not a replacement for the CPU itself.

Input (stdin JSON): `{"bytes":[...],"origin":0,"input":""}`
Output (stdout JSON): `{"programSha256":"...","snapshots":[...]}`

Each snapshot must include: `pc` (0..65535), `registers` (8 word integers),
`phase` (any string), `halted` (bool), `signals` (object), `activeNodes` and
`activeEdges` (ID arrays). Include `stdout`, `exitCode`, `instruction`, `alu`,
`changedRegister`, and `activePhases` if appropriate. `activePhases` supports
multiple pipeline stages being active in one clock. `nodeValues` provides
hover values for datapath nodes.

The runner must build/use the real SystemC CPU, clock it, and obtain the real
states. It must not synthesize pretend CPU execution from the ISA. The server
rejects a trace if its SHA-256 is missing or does not match the input bytes.

Do not register this template in cpus/ as a working CPU until the actual
implementation and runner have been provided and tested.
