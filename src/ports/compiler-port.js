/** CompilerPort: compile(source: string) -> Promise<{assembly: string, lineMap?: number[]}>. */
export class CompilerPort {
  async compile(_source) { throw new Error('CompilerPort.compile is not implemented'); }
}
