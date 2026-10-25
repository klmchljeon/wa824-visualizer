import { CpuPort } from '../ports/cpu-port.js';
/** Verilog adapter: bridge executes an external RTL trace runner and exposes step snapshots. */
export class VerilogCpu extends CpuPort {
  async request(path, body) {
    let response;
    try { response = await fetch(`/api/cpu/${path}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body ?? {})}); }
    catch { throw new Error('Verilog bridge unavailable: start the bundled Python server'); }
    let data;
    try { data = await response.json(); } catch { throw new Error(`CPU bridge returned HTTP ${response.status} (not JSON)`); }
    if (!response.ok) throw new Error(`Verilog bridge: ${data.error || 'unknown error'}`);
    return data.snapshot;
  }
  async load(bytes, metadata={}) { return this.request('load',{bytes,origin:metadata.origin ?? 0,input:metadata.input ?? ''}); }
  async reset() { return this.request('reset'); }
  async step() { return this.request('step'); }
  async snapshot() { return this.request('snapshot'); }
  async runToEnd() { return this.request('run'); }
}
