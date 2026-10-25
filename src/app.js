import { PythonCompiler } from './adapters/python-compiler.js';
import { Wa824Assembler } from './adapters/wa824-assembler.js';
import { discoverCpus } from './cpu-registry.js';
import { renderArchitecture } from './ui/architecture.js';
import { updateGutter, renderAssembly, renderSnapshot } from './ui/render.js';

const compiler = new PythonCompiler();
const assembler = new Wa824Assembler();
let cpuRegistry = new Map();

const $ = selector => document.querySelector(selector);
const editor = $('#sourceEditor'), gutter = $('#sourceGutter');
const compileBtn = $('#compileBtn'), resetBtn = $('#resetBtn'), stepBtn = $('#stepBtn'), runBtn = $('#runBtn'), finishBtn = $('#finishBtn');
const message = $('#compileMessage'), speedSelect = $('#speedSelect');
const sourceMode = $('#sourceMode'), cpuMode = $('#cpuMode');
const DEMO_C = `// Real WA824 C subset: stack, loops, functions, ECALL.
int square(int x) {
    return x * x;
}
int main() {
    int a = 1;
    while (a <= 3) {
        print_int(square(a));
        putchar(10);
        a = a + 1;
    }
    return 0;
}`;
const DEMO_ASM = `; Actual WA824 assembly (3-byte little-endian instructions)\nstart:\n    ADDI x1l, x0l, 3\n    ADDI x1h, x0l, 5\n    ADD  x2l, x1l, x1h\n    XOR  x2h, x2l, x1h\n    EBRAKE`;
let assembled = null, cpu = null, currentImage = null;
let running = false, busy = false, tickTimeout = null, generation = 0;
function setMessage(text, kind = '') { message.textContent=text;message.className=`message ${kind}`.trim(); }
function cancelRun() {
  running=false;generation++;
  if(tickTimeout!==null)clearTimeout(tickTimeout);
  tickTimeout=null;runBtn.textContent='Run';
}
function toggleButtons(loading, snap) {
  const canExecute = !!currentImage && !!cpu && !snap?.halted && !loading;
  compileBtn.disabled=loading || !cpu;resetBtn.disabled=!currentImage || loading;
  stepBtn.disabled=!canExecute;runBtn.disabled=(!canExecute && !running) || loading;finishBtn.disabled=!canExecute;
  sourceMode.disabled=loading;cpuMode.disabled=loading;
}
async function refresh(snapshot=null) {
  const state=snapshot ?? await cpu.snapshot();
  if(assembled) renderAssembly(assembled, state);
  renderSnapshot(state);
  toggleButtons(busy,state);
  return state;
}
async function compile() {
  cancelRun();busy=true;currentImage=null;assembled=null;toggleButtons(true);
  setMessage('Compiling / assembling / loading…');
  try {
    if (!cpu) throw new Error('No CPU selected');
    let assembly, compilerInfo=null;
    if(sourceMode.value==='c') {
      compilerInfo=await compiler.compile(editor.value);
      assembly=compilerInfo.assembly;
    } else assembly=editor.value;
    assembled=assembler.assemble(assembly);
    if(compilerInfo?.lineMap) {
      for(const line of assembled.assemblyLines)line.sourceLine=compilerInfo.lineMap[line.sourceLine-1] ?? line.sourceLine;
    }
    const snapshot=await cpu.load(assembled.bytes, {origin:assembled.origin, instructions:assembled.instructions, input:$('#stdinInput').value});
    currentImage=assembled.bytes;
    busy=false;
    $('#assemblyOutput').value=assembly;
    setMessage(`${sourceMode.value==='c'?'Python compiler → ':''}JS assembler: ${assembled.instructions.length} instructions / ${assembled.bytes.length} bytes → ${cpuRegistry.get(cpuMode.value)?.name ?? cpuMode.value}`, 'success');
    await refresh(snapshot);
  } catch (err) {
    currentImage=null;assembled=null;busy=false;
    $('#assemblyList').innerHTML='';$('#machineList').innerHTML='';
    $('#assemblyOutput').value='';
    setMessage(err instanceof Error?err.message:String(err),'error');
    toggleButtons(false);
  }
}
async function step() {
  if(busy||!currentImage)return null;
  busy=true;toggleButtons(true);
  try {
    const snapshot=await cpu.step();
    busy=false;await refresh(snapshot);
    if(snapshot.halted) {
      cancelRun();setMessage(snapshot.fault ? `CPU fault: ${snapshot.signals?.fault ?? 'unknown'}` : 'Execution stopped. Reset to replay.',snapshot.fault?'error':'success');
    }
    return snapshot;
  } catch(err) {
    busy=false;cancelRun();toggleButtons(false);
    setMessage(`CPU execution error: ${err instanceof Error?err.message:String(err)}`,'error');
    return null;
  }
}
async function scheduleTick(token) {
  if(!running||token!==generation)return;
  const snap=await step();
  if(!running||token!==generation||!snap||snap.halted)return;
  tickTimeout=setTimeout(()=>scheduleTick(token),Number(speedSelect.value)||500);
}
function toggleRun() {
  if(running){cancelRun();return;}
  if(busy||!currentImage)return;
  running=true;runBtn.textContent='Pause';
  const token=++generation;
  scheduleTick(token);
}
function changeSourceMode() {
  cancelRun();currentImage=null;assembled=null;
  editor.value=sourceMode.value==='c'?DEMO_C:DEMO_ASM;
  $('#sourceHeading').textContent=sourceMode.value==='c'?'C Source':'Assembly source';
  $('#sourceHint').textContent=sourceMode.value==='c'?'Freestanding C subset → Python compiler and stack ABI.':'Direct WA824 assembly → JS assembler. Labels and all ISA formats are accepted.';
  updateGutter(editor,gutter);setMessage('Editor mode changed. Click Build & Load.');toggleButtons(false);
}
compileBtn.addEventListener('click',compile);
resetBtn.addEventListener('click',async()=>{
  cancelRun();busy=true;toggleButtons(true);
  try{const snapshot=await cpu.reset();busy=false;setMessage('CPU reset');await refresh(snapshot);}
  catch(e){busy=false;setMessage(e.message,'error');toggleButtons(false);}
});
stepBtn.addEventListener('click',step);
runBtn.addEventListener('click',toggleRun);
finishBtn.addEventListener('click',async()=>{
  cancelRun();if(busy||!currentImage)return;
  busy=true;toggleButtons(true);setMessage('Running program to completion…');
  try{
    const snapshot=await cpu.runToEnd();
    busy=false;setMessage(snapshot.fault ? `CPU fault: ${snapshot.signals?.fault ?? 'unknown'}` : 'Program completed. See stdout and exit code.',snapshot.fault?'error':'success');
    await refresh(snapshot);
  }catch(e){busy=false;setMessage(`CPU execution error: ${e.message}`,'error');toggleButtons(false);}
});
sourceMode.addEventListener('change',changeSourceMode);
cpuMode.addEventListener('change',()=>{
  cancelRun();currentImage=null;assembled=null;
  const selection=cpuRegistry.get(cpuMode.value);
  cpu=selection?.cpu || null;
  if (selection) renderArchitecture(selection.architecture);
  $('#assemblyList').replaceChildren(); $('#machineList').replaceChildren();
  $('#stateSummary').replaceChildren(); $('#signalSummary').replaceChildren(); $('#registerGrid').replaceChildren();
  $('#programStdout').textContent='';$('#programExit').textContent='Not running';
  const pipelinePanel=$('#pipelinePanel');if(pipelinePanel){pipelinePanel.hidden=true;$('#pipelineSlots').replaceChildren();}
  setMessage(`CPU selected: ${selection?.name || 'unknown'}. Click Build & Load.`);
  toggleButtons(false);
});
editor.addEventListener('input',()=>{updateGutter(editor,gutter);cancelRun();currentImage=null;setMessage('Source changed. Build & Load to update binary.');toggleButtons(false);});
editor.addEventListener('scroll',()=>gutter.scrollTop=editor.scrollTop);
$('#stdinInput').addEventListener('input',()=>{cancelRun();currentImage=null;setMessage('stdin changed. Build & Load to restart with new input.');toggleButtons(false);});
speedSelect.addEventListener('change',()=>{if(running){cancelRun();toggleRun();}});
editor.value=DEMO_C;updateGutter(editor,gutter);toggleButtons(false);
async function bootstrap() {
  try {
    cpuRegistry=await discoverCpus();
    cpuMode.replaceChildren();
    for (const [id,item] of cpuRegistry) {
      const opt=document.createElement('option');opt.value=id;opt.textContent=item.name;cpuMode.append(opt);
    }
    cpuMode.value=cpuRegistry.has('reference')?'reference':cpuRegistry.keys().next().value;
    cpuMode.dispatchEvent(new Event('change'));
    await compile();
  } catch(err) {
    cpuMode.replaceChildren();cpu=null;
    setMessage(`CPU discovery failed: ${err.message}`,'error');toggleButtons(false);
  }
}
bootstrap();
