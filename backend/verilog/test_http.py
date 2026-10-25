"""Exercise real HTTP routes using a mocked RTL subprocess response.
Not a substitute for a real iverilog run (see rtl-compare.test.js).
"""
import hashlib
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
import urllib.request

sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from backend import server as bridge

class HttpSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http=bridge.ThreadingHTTPServer(('127.0.0.1',0),bridge.Handler)
        cls.port=cls.http.server_address[1]
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.thread.join(timeout=3)
        cls.http.server_close()

    def send(self,path,payload):
        request=urllib.request.Request(f'http://127.0.0.1:{self.port}{path}',
            data=json.dumps(payload).encode(),
            headers={'Content-Type':'application/json'},method='POST')
        with urllib.request.urlopen(request,timeout=3) as response:
            self.assertEqual(response.status,200)
            return json.load(response)

    def test_compiler_and_cpu_http(self):
        compiler=self.send('/api/compiler/compile',{'source':'int main(){int a=3;return a;}'})
        self.assertIn('__fn_main:',compiler['assembly'])
        self.assertIn('ECALL',compiler['assembly'])
        image=[0x12,3,0,0x80,0,1]
        hash_=hashlib.sha256(bytes(image)).hexdigest()
        snaps=[dict(pc=0,phase='READY',halted=False,registers=[0]*8,activeNodes=[],activeEdges=[],signals={}),
               dict(pc=6,phase='COMMIT',halted=True,registers=[0,3,0,0,0,0,0,0],activeNodes=[],activeEdges=[],signals={})]
        fake=type('Completed',(),dict(returncode=0,stdout=json.dumps({'programSha256':hash_,'snapshots':snaps}),stderr=''))()
        with patch('backend.server.subprocess.run',return_value=fake):
            self.assertEqual(self.send('/api/cpu/load',{'bytes':image})['snapshot']['pc'],0)
            self.assertEqual(self.send('/api/cpu/step',{})['snapshot']['registers'][1],3)
            self.assertEqual(self.send('/api/cpu/reset',{})['snapshot']['pc'],0)
            self.assertEqual(self.send('/api/cpu/snapshot',{})['snapshot']['phase'],'READY')

if __name__=='__main__':unittest.main()
