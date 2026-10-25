import { CompilerPort } from '../ports/compiler-port.js';
/** HTTP adapter: Python code runs in local server, never in the browser. */
export class PythonCompiler extends CompilerPort {
  async compile(source) {
    let response;
    try {
      response = await fetch('/api/compiler/compile', {
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source})
      });
    } catch (e) { throw new Error('Python server not reachable. Start with start.bat / start.sh.'); }
    let payload;
    try { payload = await response.json(); } catch { throw new Error(`Compiler HTTP ${response.status}: non-JSON response. Use the included Python server.`); }
    if (!response.ok) throw new Error(`Compiler: ${payload.error ?? 'Unknown Python error'}`);
    if (typeof payload.assembly !== 'string') throw new Error('Python compiler must return {assembly: string}');
    return payload;
  }
}
