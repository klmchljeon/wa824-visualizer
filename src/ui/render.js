import { highlightArchitecture } from './architecture.js';
function escapeHtml(value) {
  return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
}
function hex(value,width) { return `0x${(value>>>0).toString(16).toUpperCase().padStart(width,'0')}`; }
export function updateGutter(textarea,gutter) {
  const count=textarea.value.replace(/\r/g,'').split('\n').length;
  gutter.textContent=Array.from({length:count},(_,i)=>i+1).join('\n');
}
export function renderAssembly(assembled,snapshot) {
  const index=snapshot?.instructionIndex ?? -1;
  document.querySelector('#assemblyList').innerHTML=assembled.assemblyLines.map((line,i)=>
    `<li class="${i===index?'active':''}" title="Source line ${line.sourceLine}">${escapeHtml(line.text)}</li>`).join('');
  document.querySelector('#machineList').innerHTML=assembled.encodings.map((enc,i)=>
    `<li class="${i===index?'active':''}" title="${escapeHtml(enc.note)}">${escapeHtml(enc.text)}</li>`).join('');
}
export function renderSnapshot(snapshot) {
  const stdout=document.querySelector('#programStdout');
  if(stdout)stdout.textContent=snapshot.stdout??'';
  const exit=document.querySelector('#programExit');
  if(exit)exit.textContent=snapshot.exitCode!=null?`Exit code: ${snapshot.exitCode} (0x${snapshot.exitCode.toString(16).padStart(4,'0')})`:(snapshot.fault?'CPU fault':snapshot.halted?'Stopped (EBRAKE)':'Program active');
  highlightArchitecture(snapshot);
  const pipelinePanel=document.querySelector('#pipelinePanel');
  if(pipelinePanel){
    const slots=document.querySelector('#pipelineSlots'),status=document.querySelector('#pipelineStatus');
    pipelinePanel.hidden=!snapshot.pipeline;
    if(snapshot.pipeline){
      status.textContent=`Cycle ${snapshot.signals?.cycle??0} · retired ${snapshot.signals?.retired??0}${snapshot.signals?.stall?' · STALL':''}${snapshot.signals?.flush?' · FLUSH':''}${snapshot.signals?.forwardEX?' · FORWARD':''}`;
      slots.innerHTML=['IF','ID','EX','MEM','WB'].map(stage=>{
        const slot=snapshot.pipeline[stage]||{},valid=slot.valid;
        return `<div class="pipeline-slot ${valid?'occupied':'bubble'}"><div class="pipeline-stage">${stage}</div><div class="pipeline-name">${valid?escapeHtml(slot.display||slot.op||'—'):'Bubble'}</div><div class="pipeline-pc">${valid?`PC ${hex(slot.pc??0,4)} · #${slot.tag??'—'}`:'valid = 0'}</div><div class="pipeline-word">${valid?hex(slot.word??0,6):'—'}</div></div>`;
      }).join('');
    }else {slots.replaceChildren();status.textContent='';}
  }
  const instruction=snapshot.instruction?.display ?? '—';
  document.querySelector('#stateSummary').innerHTML=`
    <dt>PC</dt><dd>${hex(snapshot.pc??0,4)}</dd>
    <dt>Phase</dt><dd>${escapeHtml(snapshot.phase??'—')}</dd>
    <dt>Instruction</dt><dd>${escapeHtml(instruction)}</dd>
    <dt>Index</dt><dd>${snapshot.instructionCount?`${(snapshot.instructionIndex??0)+1} / ${snapshot.instructionCount}`:'—'}</dd>
    <dt>ALU</dt><dd>${snapshot.alu?.op?`${escapeHtml(snapshot.alu.op)} · A=${snapshot.alu.a??'—'} B=${snapshot.alu.b??'—'} → ${snapshot.alu.result??'—'}`:'—'}</dd>
    <dt>Status</dt><dd>${snapshot.fault?'FAULT':snapshot.halted?'HALTED':'READY'}</dd>`;
  const signals=Object.entries(snapshot.signals??{});
  document.querySelector('#signalSummary').innerHTML=signals.length?signals.map(([k,v])=>`<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join(''):'<dt>signals</dt><dd>—</dd>';
  document.querySelector('#registerGrid').innerHTML=(snapshot.registers??Array(8).fill(0)).map((word,i)=>`
    <div class="reg ${snapshot.changedRegister===i?'changed':''}">
      <div class="name">x${i}${i===0?' · ZERO':''}</div>
      <div class="word">${hex(word,4)}</div>
      <div class="bytes">x${i}h=${hex((word>>>8)&255,2)} · x${i}l=${hex(word&255,2)}</div>
    </div>`).join('');
}
