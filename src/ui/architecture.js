/** Data-driven SVG diagram renderer. Does not know any particular CPU layout. */
const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
};
function uniq(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} id in architecture`);
}
export function validateArchitecture(a) {
  if (!a || a.schemaVersion !== 1 || !Array.isArray(a.nodes) || !Array.isArray(a.edges) ||
      !Array.isArray(a.viewBox) || a.viewBox.length !== 4 || !a.viewBox.every(Number.isFinite) ||
      a.viewBox[2] <= 0 || a.viewBox[3] <= 0) throw new Error('Bad architecture.json: expected schemaVersion 1, viewBox, nodes, edges');
  if (a.nodes.length > 600 || a.edges.length > 1600) throw new Error('Architecture exceeds supported graph size');
  uniq(a.nodes.map(n => n.id), 'node'); uniq(a.edges.map(e => e.id), 'edge');
  const validId = s => typeof s === 'string' && /^[a-zA-Z0-9_.:-]{1,100}$/.test(s);
  for (const n of a.nodes) {
    if (!validId(n.id) || ![n.x,n.y,n.width,n.height].every(Number.isFinite) || n.width <= 0 || n.height <= 0 ||
        typeof n.label !== 'string' || (n.details && (!Array.isArray(n.details) || n.details.some(s => typeof s !== 'string'))))
      throw new Error(`Invalid architecture node: ${n.id}`);
  }
  for (const e of a.edges) {
    if (!validId(e.id) || !(typeof e.path === 'string' || (validId(e.from) && validId(e.to))))
      throw new Error(`Invalid architecture edge: ${e.id}`);
  }
  if (a.phases && (!Array.isArray(a.phases) || a.phases.some(p => !validId(p.id)))) throw new Error('Invalid architecture phases');
  return a;
}
function edgePath(edge, byId) {
  if (edge.path) return edge.path;
  const a = byId.get(edge.from), b = byId.get(edge.to);
  if (!a || !b) throw new Error(`Edge ${edge.id} refers to an unknown node`);
  return `M${a.x+a.width/2} ${a.y+a.height/2} L${b.x+b.width/2} ${b.y+b.height/2}`;
}
/** Rebuild whenever a CPU is selected. Node/edge IDs are scoped to this architecture. */
export function renderArchitecture(architecture) {
  const a = validateArchitecture(architecture), svg = document.querySelector('#datapath');
  svg.replaceChildren();
  svg.setAttribute('viewBox', a.viewBox.join(' '));
  // Preserve legible node labels for large CPU diagrams; the parent panel scrolls.
  svg.style.minWidth = `${Math.max(930, Math.ceil(a.viewBox[2]))}px`;
  svg.setAttribute('aria-label', `${a.name || 'CPU'} microarchitecture`);
  const defs = svgEl('defs'), marker = svgEl('marker', {id:'arrow', markerWidth:8,markerHeight:8,refX:7,refY:4,orient:'auto',markerUnits:'strokeWidth'});
  marker.append(svgEl('path',{d:'M0,0 L8,4 L0,8 z',class:'arrow-head'})); defs.append(marker); svg.append(defs);
  document.querySelector('#architectureHeading').textContent = a.name || 'CPU Datapath';
  document.querySelector('#architectureDescription').textContent = a.description || '';
  const phaseContainer = document.querySelector('#stageStrip'); phaseContainer.replaceChildren();
  const phases = a.phases || [];
  phaseContainer.style.setProperty('--phase-count', String(Math.max(1,phases.length)));
  for (const phase of phases) {
    const span = document.createElement('span'); span.dataset.phase = phase.id; span.textContent = phase.label || phase.id;
    phaseContainer.append(span);
  }
  const nodeMap = new Map(a.nodes.map(n => [n.id,n]));
  for (const lane of a.lanes || []) {
    const g = svgEl('g',{class:'lane'}); g.append(svgEl('rect',{x:lane.x,y:lane.y,width:lane.width,height:lane.height,rx:lane.radius??12}));
    const t = svgEl('text',{x:lane.x+12,y:lane.y+19});t.textContent=lane.label||'';g.append(t);svg.append(g);
  }
  for (const e of a.edges) {
    const g = svgEl('g',{class:`edge ${['control','forward'].includes(e.kind)?'kind-'+e.kind:''}`,'data-edge':e.id});
    g.append(svgEl('path',{d:edgePath(e,nodeMap)}));
    if (e.label) {const title=svgEl('title'); title.textContent=e.label;g.append(title);}
    svg.append(g);
  }
  for (const n of a.nodes) {
    const g = svgEl('g',{class:'node','data-node':n.id,transform:`translate(${n.x} ${n.y})`});
    g.append(svgEl('rect',{width:n.width,height:n.height,rx:n.radius??10}));
    const label=svgEl('text',{x:n.width/2,y:n.labelY??31});label.textContent=n.label;g.append(label);
    (n.details||[]).forEach((text,i)=>{
      const sub=svgEl('text',{class:'sub',x:n.width/2,y:n.detailYs?.[i]??(55+18*i)});
      sub.textContent=text;g.append(sub);
    });
    const value=svgEl('title');value.classList.add('node-value');g.append(value);
    svg.append(g);
  }
}
export function highlightArchitecture(snapshot) {
  const activeNodes = new Set(snapshot.activeNodes || []), activeEdges = new Set(snapshot.activeEdges || []);
  document.querySelectorAll('#datapath .node').forEach(el=>{
    el.classList.toggle('active',activeNodes.has(el.dataset.node));
    const value=snapshot.nodeValues?.[el.dataset.node];
    const title=el.querySelector('title.node-value');if(title)title.textContent=value==null?'':`${el.dataset.node}: ${value}`;
  });
  document.querySelectorAll('#datapath .edge').forEach(el=>el.classList.toggle('active',activeEdges.has(el.dataset.edge)));
  const activePhases=new Set(snapshot.activePhases || (snapshot.phase?[snapshot.phase]:[]));
  // Pipeline implementations can report multiple active phases simultaneously.
  document.querySelectorAll('#stageStrip span').forEach(el=>el.classList.toggle('active',activePhases.has(el.dataset.phase)));
}
