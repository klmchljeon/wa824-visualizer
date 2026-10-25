"""Local HTTP bridge for Python compiler + Icarus Verilog trace runner.

Usage: python backend/server.py
Environment: WA824_PORT=8001, WA824_VERILOG_TRACE_CMD='<trusted executable>'
No third-party Python packages needed.
"""
import hashlib
import json
import os
import re
from pathlib import Path
import shlex
import subprocess
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from backend.python.compiler import compile_source, CompileError

MAX_BYTES = 1_000_000
MAX_TRACE_STEPS = 200_000
PLUGIN_ROOT = ROOT / 'cpus'
PLUGIN_ID = re.compile(r'^[a-zA-Z0-9_-]+$')


def installed_cpus():
    """Only complete local folders are advertised. This is a trusted developer workspace."""
    plugins = {}
    if not PLUGIN_ROOT.is_dir():
        return plugins
    for folder in sorted(PLUGIN_ROOT.iterdir()):
        if not folder.is_dir() or not PLUGIN_ID.fullmatch(folder.name):
            continue
        if not all((folder / item).exists() for item in
                   ('architecture.json', 'adapter.js', 'implementation')):
            continue
        try:
            arch = json.loads((folder / 'architecture.json').read_text(encoding='utf-8'))
            if not isinstance(arch,dict) or arch.get('schemaVersion') != 1 or \
                arch.get('isa', 'WA824') != 'WA824' or not isinstance(arch.get('nodes'),list) or \
                not isinstance(arch.get('edges'),list):
                continue
            # cpu.json is entirely optional; directory name becomes the stable identifier.
            manifest_path = folder / 'cpu.json'
            manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {}
            if not isinstance(manifest,dict) or manifest.get('id',folder.name) != folder.name or \
                manifest.get('isa','WA824') != 'WA824':
                continue
            name=manifest.get('name', arch.get('name', folder.name))
            if not isinstance(name,str):
                continue
        except (OSError, ValueError, TypeError, AttributeError):
            continue
        plugins[folder.name] = {'id':folder.name,'name':name,
                                'description':manifest.get('description',arch.get('description','')),'isa':'WA824'}
    return plugins



def validate_snapshot(item):
    if not isinstance(item, dict):
        raise ValueError('snapshot must be an object')
    required = ('pc','registers','phase','halted','activeNodes','activeEdges','signals')
    for key in required:
        if key not in item:
            raise ValueError(f'snapshot missing {key}')
    if not (isinstance(item['registers'], list) and len(item['registers']) == 8 and all(isinstance(r,int) and 0<=r<=65535 for r in item['registers'])):
        raise ValueError('registers must contain exactly eight 16-bit words')
    if not isinstance(item['pc'],int) or not 0<=item['pc']<=65535:
        raise ValueError('invalid PC')
    if not isinstance(item['halted'],bool):
        raise ValueError('invalid halted field')
    if not isinstance(item['activeNodes'],list) or not isinstance(item['activeEdges'],list) or not isinstance(item['signals'],dict):
        raise ValueError('invalid datapath fields')


class CpuSession:
    def __init__(self, runner=None):
        self.runner = runner
        self.snapshots = []
        self.cursor = 0

    def load(self, image):
        bytes_ = image.get('bytes')
        origin = image.get('origin', 0)
        input_text = image.get('input', '')
        if not isinstance(input_text,str) or len(input_text.encode('utf-8'))>4096:
            raise ValueError('input must be <=4096 UTF-8 bytes')
        if not isinstance(bytes_,list) or not bytes_ or len(bytes_) > 65536 or any(type(b) is not int or not 0<=b<=255 for b in bytes_):
            raise ValueError('bytes must be a nonempty array of 8-bit values')
        if type(origin) is not int or origin<0 or origin+len(bytes_)>65536:
            raise ValueError('bad image origin')
        override = os.environ.get('WA824_VERILOG_TRACE_CMD') if self.runner is None else None
        cmd = shlex.split(override) if override else [sys.executable, str(self.runner or (ROOT / 'backend/verilog/runner.py'))]
        # Command comes from local trusted process environment, NEVER browser request.
        proc = subprocess.run(cmd, input=json.dumps({'bytes':bytes_,'origin':origin,'input':input_text}), text=True, capture_output=True, timeout=30, cwd=ROOT)
        if proc.returncode:
            raise RuntimeError(f'RTL runner exited {proc.returncode}: {proc.stderr[-800:]}')
        result = json.loads(proc.stdout)
        expected_hash = hashlib.sha256(bytes(bytes_)).hexdigest()
        if result.get('programSha256') != expected_hash:
            raise ValueError('RTL runner response missing matching programSha256; refusing mismatched trace')
        snaps = result.get('snapshots')
        if not isinstance(snaps,list) or not 1<=len(snaps)<=MAX_TRACE_STEPS:
            raise ValueError('RTL runner must provide 1..200000 snapshots')
        for snap in snaps: validate_snapshot(snap)
        self.snapshots = snaps
        self.cursor = 0
        return self.snapshots[0]

    def snapshot(self):
        if not self.snapshots: raise ValueError('No RTL program loaded')
        return self.snapshots[self.cursor]

    def reset(self):
        self.cursor=0
        return self.snapshot()

    def step(self):
        if self.cursor + 1 < len(self.snapshots):
            self.cursor+=1
        return self.snapshot()

    def run(self):
        if not self.snapshots: raise ValueError('No RTL program loaded')
        self.cursor=len(self.snapshots)-1
        return self.snapshot()


session = CpuSession()  # backwards-compatible /api/cpu/... endpoint
plugin_sessions = {}  # one independently resettable trace per plugin (local single-user server)


def cpu_session_for(id_):
    if id_ not in installed_cpus():
        raise ValueError(f'Unknown CPU plugin: {id_}')
    runner = PLUGIN_ROOT / id_ / 'implementation' / 'runner.py'
    if not runner.is_file():
        raise NotImplementedError(f'CPU {id_} has no Python runner. For JS CPUs use its browser adapter; for SystemC add implementation/runner.py.')
    if id_ not in plugin_sessions:
        plugin_sessions[id_] = CpuSession(runner)
    return plugin_sessions[id_]



class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(ROOT),**kwargs)

    def json_response(self,status,payload):
        data=json.dumps(payload,ensure_ascii=False).encode('utf8')
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/api/cpus':
            self.json_response(200, {'cpus':list(installed_cpus().values())})
            return
        super().do_GET()

    def do_POST(self):
        plugin_match = re.fullmatch(r'/api/cpus/([a-zA-Z0-9_-]+)/(load|reset|step|snapshot|run)',self.path)
        if not plugin_match and self.path not in ('/api/compiler/compile','/api/cpu/load','/api/cpu/reset','/api/cpu/step','/api/cpu/snapshot','/api/cpu/run'):
            self.json_response(404,{'error':'Unknown API route'});return
        try:
            size=int(self.headers.get('Content-Length','0'))
            if size <= 0 or size > MAX_BYTES: raise ValueError('invalid request size')
            data=json.loads(self.rfile.read(size))
            if not isinstance(data,dict):raise ValueError('JSON body must be object')
            if plugin_match:
                cpu_id, op = plugin_match.groups()
                selected = cpu_session_for(cpu_id)
                result = selected.load(data) if op=='load' else getattr(selected,op)()
                self.json_response(200,{'snapshot':result})
            elif self.path == '/api/compiler/compile':
                result=compile_source(data.get('source'))
                self.json_response(200,result)
            elif self.path == '/api/cpu/load':
                self.json_response(200,{'snapshot':session.load(data)})
            elif self.path == '/api/cpu/reset':
                self.json_response(200,{'snapshot':session.reset()})
            elif self.path == '/api/cpu/step':
                self.json_response(200,{'snapshot':session.step()})
            elif self.path == '/api/cpu/run':
                self.json_response(200,{'snapshot':session.run()})
            else:
                self.json_response(200,{'snapshot':session.snapshot()})
        except NotImplementedError as exc:
            self.json_response(501,{'error':str(exc)})
        except (ValueError,TypeError,CompileError,json.JSONDecodeError) as exc:
            self.json_response(400,{'error':str(exc)})
        except subprocess.TimeoutExpired:
            self.json_response(504,{'error':'RTL runner timed out (30s)'})
        except Exception as exc:
            self.json_response(500,{'error':str(exc)})


if __name__=='__main__':
    port=int(os.environ.get('WA824_PORT','8001'))
    print(f'WA824 dev bridge: http://localhost:{port}',flush=True)
    ThreadingHTTPServer(('127.0.0.1',port),Handler).serve_forever()
