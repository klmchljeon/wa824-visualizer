import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateArchitecture } from '../src/ui/architecture.js';

for (const id of ['reference','verilog']) {
  test(`bundled ${id} diagram matches v4 signal IDs`, () => {
    const architecture=JSON.parse(readFileSync(new URL(`../cpus/${id}/architecture.json`,import.meta.url),'utf8'));
    assert.doesNotThrow(()=>validateArchitecture(architecture));
    assert.equal(architecture.nodes.length,12);
    assert.equal(architecture.edges.length,17);
    for (const node of ['pc','ifu','ir','decoder','rf','alu','wb','mem','lsu','agu','branch','controller'])
      assert.ok(architecture.nodes.some(n=>n.id===node),`${node} missing`);
    for (const edge of architecture.edges) assert.ok(edge.path.startsWith('M'));
  });
}
test('pipeline layout is accepted independently of the original CPU', () => {
  const pipeline=JSON.parse(readFileSync(new URL('../templates/systemc-cpu/architecture.json',import.meta.url),'utf8'));
  assert.equal(validateArchitecture(pipeline).phases.length,5);
  assert.deepEqual(pipeline.nodes.map(n=>n.id),['ifu','decoder','alu','lsu','wb']);
});
test('duplicate IDs and invalid diagrams are rejected', () => {
  const graph={schemaVersion:1,viewBox:[0,0,600,200],nodes:[{id:'A',x:0,y:0,width:10,height:10,label:'A'}],edges:[]};
  assert.doesNotThrow(()=>validateArchitecture(graph));
  assert.throws(()=>validateArchitecture({...graph,nodes:[graph.nodes[0],graph.nodes[0]]}),/Duplicate/);
  assert.throws(()=>validateArchitecture({...graph,viewBox:[0,0,0,0]}),/Bad architecture/);
});
