import { TraceCpu } from '../../src/adapters/trace-cpu.js';
export function createCpu({ id }) { return new TraceCpu(id); }
