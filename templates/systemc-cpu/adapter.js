import { TraceCpu } from '../../src/adapters/trace-cpu.js';
// When copying this directory into cpus/my-cpu/, the relative import stays valid.
export function createCpu({ id }) { return new TraceCpu(id); }
