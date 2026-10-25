"""Integration tests for the Python bridge's load/step/reset/trace checksum protocol.
These use a stubbed *subprocess*, not RTL verification; the latter has its own tests.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend.server import CpuSession


class BridgeTests(unittest.TestCase):
    def test_default_runner_and_steps(self):
        program=[0x12,3,0,0x80,0,1]
        sha=hashlib.sha256(bytes(program)).hexdigest()
        initial=dict(pc=0,phase='READY',halted=False,registers=[0]*8,activeNodes=[],activeEdges=[],signals={})
        later=dict(pc=3,phase='COMMIT',halted=True,registers=[0,3,0,0,0,0,0,0],activeNodes=[],activeEdges=[],signals={})
        response=type('Completed',(),dict(returncode=0,stdout=json.dumps(dict(programSha256=sha,snapshots=[initial,later])),stderr=''))()
        with patch.dict(os.environ,{'WA824_VERILOG_TRACE_CMD':''}),patch('backend.server.subprocess.run',return_value=response) as sub:
            sess=CpuSession()
            self.assertEqual(sess.load({'bytes':program})['phase'],'READY')
            argv=sub.call_args.args[0]
            self.assertEqual(argv[0],sys.executable)
            self.assertTrue(argv[1].endswith('backend/verilog/runner.py'))
            self.assertEqual(sess.step()['registers'][1],3)
            self.assertTrue(sess.step()['halted'])
            self.assertEqual(sess.reset()['pc'],0)

    def test_stale_trace_rejected(self):
        payload=json.dumps({'programSha256':'0'*64,'snapshots':[]})
        response=type('Completed',(),dict(returncode=0,stdout=payload,stderr=''))()
        with patch('backend.server.subprocess.run',return_value=response):
            with self.assertRaisesRegex(ValueError,'programSha256'):
                CpuSession().load({'bytes':[0x80,0,1]})


if __name__=='__main__':unittest.main()
