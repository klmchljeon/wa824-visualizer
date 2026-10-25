import { CpuPort } from '../ports/cpu-port.js';
/** Generic CPU-specific trace bridge for an implementation/runner.py. */
export class TraceCpu extends CpuPort {
  constructor(id) { super(); if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Bad CPU ID'); this.id=id; }
  async request(command, body={}) {
    let response;
    try {response=await fetch(`/api/cpus/${this.id}/${command}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
    catch {throw new Error(`CPU bridge unavailable for ${this.id}. Start bundled Python server.`);}
    let data;try{data=await response.json();}catch{throw new Error(`CPU bridge HTTP ${response.status}: invalid JSON`);}
    if (!response.ok) throw new Error(`CPU ${this.id}: ${data.error||'unknown error'}`);
    return data.snapshot;
  }
  async load(bytes,metadata={}) {return this.request('load',{bytes,origin:metadata.origin??0,input:metadata.input??''});}
  async reset(){return this.request('reset');}
  async step(){return this.request('step');}
  async snapshot(){return this.request('snapshot');}
  async runToEnd(){return this.request('run');}
}
