/** CPU backend has the same interface whether JS emulator or Verilog trace bridge. */
export class CpuPort {
  async load(_bytes, _metadata) { throw new Error('CpuPort.load is not implemented'); }
  async reset() { throw new Error('CpuPort.reset is not implemented'); }
  async step() { throw new Error('CpuPort.step is not implemented'); }
  async snapshot() { throw new Error('CpuPort.snapshot is not implemented'); }
}
