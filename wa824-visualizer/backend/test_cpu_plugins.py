"""Test plugin discovery, optional manifests, and independent native trace loading."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from backend import server


class CpuPluginTest(unittest.TestCase):
    def test_bundled_plugins_found(self):
        plugins = server.installed_cpus()
        self.assertIn('reference', plugins)
        self.assertIn('verilog', plugins)
        self.assertEqual(plugins['reference']['isa'], 'WA824')

    def test_three_file_plugin_and_architecture_can_differ(self):
        with tempfile.TemporaryDirectory() as root:
            plugin = Path(root) / 'new-pipeline'
            (plugin / 'implementation').mkdir(parents=True)
            (plugin / 'adapter.js').write_text('export function createCpu() {}')
            (plugin / 'architecture.json').write_text(json.dumps({
                'schemaVersion':1,'isa':'WA824','name':'Student pipeline CPU',
                'nodes':[{'id':'ifu'}],'edges':[]
            }))
            with patch.object(server, 'PLUGIN_ROOT', Path(root)):
                plugins = server.installed_cpus()
                self.assertIn('new-pipeline', plugins)
                self.assertEqual(plugins['new-pipeline']['name'], 'Student pipeline CPU')
                with self.assertRaises(NotImplementedError):
                    server.cpu_session_for('new-pipeline')

    def test_independent_sessions_use_each_plugin_runner(self):
        with tempfile.TemporaryDirectory() as root:
            for name in ('one','two'):
                d=Path(root)/name
                (d/'implementation').mkdir(parents=True)
                (d/'implementation'/'runner.py').write_text('# tested via mocked process')
                (d/'adapter.js').write_text('export function createCpu() {}')
                (d/'architecture.json').write_text(json.dumps({'schemaVersion':1,'nodes':[],'edges':[]}))
            bytes_=[0x80,0,1]
            h=hashlib.sha256(bytes(bytes_)).hexdigest()
            response={'programSha256':h,'snapshots':[
                dict(pc=0,phase='IF',halted=False,registers=[0]*8,activeNodes=[],activeEdges=[],signals={}),
                dict(pc=3,phase='WB',halted=True,registers=[0]*8,activeNodes=[],activeEdges=[],signals={})
            ]}
            result=type('Process',(),dict(returncode=0,stdout=json.dumps(response),stderr=''))()
            with patch.object(server,'PLUGIN_ROOT',Path(root)),patch.dict(server.plugin_sessions,{},clear=True), \
                 patch.object(server.subprocess,'run',return_value=result) as run:
                a=server.cpu_session_for('one')
                a.load({'bytes':bytes_})
                self.assertIn('one/implementation/runner.py', run.call_args.args[0][1].replace('\\','/'))
                self.assertTrue(a.step()['halted'])
                b=server.cpu_session_for('two')
                self.assertEqual(b.load({'bytes':bytes_})['pc'],0)
                self.assertEqual(a.snapshot()['pc'],3)
                self.assertEqual(b.snapshot()['pc'],0)

if __name__=='__main__': unittest.main()
