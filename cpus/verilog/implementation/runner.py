"""WA824 RTL bridge: JSON program on stdin -> actual Icarus simulation -> JSON trace.

Requires iverilog and vvp on PATH (or WA824_IVERILOG / WA824_VVP).
Compilation and memory initialization run in a temporary directory per program.
No Python ISA interpreter is used to produce PC/register data: all state comes
from TRACE records printed by tb_wa824.v running wa824_core.v.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
RTL = HERE / 'rtl'
PHASE_NAMES = ('FETCH0','FETCH1','FETCH2','DECODE','EXECUTE','COMMIT','READY')
R = ('ADD','SUB','AND','OR','XOR','SLL','SL','SRA','SLT','SLTU')
I = ('ADDI',None,'ANDI','ORI','XORI','SLLI','SLI','SRAI','SLTI','SLTUI')
B = ('BEQ','BNE','BLT','BLTU')


def signed(n, bits):
    return n - (1 << bits) if n & (1 << (bits - 1)) else n


def byte_name(i):
    return f'x{i // 2}{"h" if i & 1 else "l"}'


def describe(word):
    """UI-only disassembly. Not used to execute instructions or derive RTL state."""
    code = (word >> 4) & 15
    rd = word & 15
    fn = (word >> 16) & 15
    rs1 = (word >> 12) & 15
    rs2 = (word >> 8) & 15
    imm8 = signed(((word >> 20) << 4) | ((word >> 8) & 15), 8)
    imm12 = signed(((word >> 16) << 4) | ((word >> 8) & 15), 12)
    if code in (0, 1):
        table = R if code == 0 else I
        op = table[fn] if fn < len(table) else None
        return f'{op} {byte_name(rd)}, {byte_name(rs1)}, {byte_name(rs2) if code == 0 else imm8}' if op else 'INVALID'
    if code in (2, 3):
        return f'{"L" if code == 2 else "S"} {byte_name(rd)}, Wx{(word >> 13) & 7}, {imm12}'
    if code == 4:
        return f'{B[fn] if fn < len(B) else "INVALID"} {byte_name(rs1)}, {byte_name(rd)}, {imm8}'
    if code in (5, 6):
        imm = (word >> 8) & 65535
        return f'{"JA" if code == 5 else "JR"} Wx{(word >> 1) & 7}, {imm if code == 5 else signed(imm, 16)}'
    if code == 7:
        v = signed(((word >> 20) << 8) | ((word >> 8) & 255), 12)
        return f'JRP Wx{(word >> 1) & 7}, Wx{(word >> 17) & 7}, {v}'
    if code == 8:
        return {0: 'ECALL', 1: 'EBRAKE', 14: 'MRET'}.get(fn, 'INVALID')
    return 'INVALID'


def visuals(phase, op):
    nodes = ['pc']
    edges = []
    if phase.startswith('FETCH'):
        nodes += ['ifu','mem']; edges += ['pc-ifu','mem-ifu']
    elif phase == 'DECODE':
        nodes += ['ifu','ir','decoder','controller']; edges += ['ifu-ir','ir-decoder']
    elif phase == 'EXECUTE':
        nodes += ['decoder','rf']; edges += ['decoder-rf']
        if op in (0, 1):
            nodes.append('alu'); edges += ['rf-alu-a','decoder-alu']
            if op == 0: edges.append('rf-alu-b')
        elif op in (2, 3, 7):
            nodes.append('agu');edges += ['rf-agu','decoder-agu']
        elif op == 4:
            nodes.append('branch');edges.append('rf-branch')
        if op in (2, 3):
            nodes += ['lsu','mem'];edges += ['agu-lsu','lsu-mem']
    elif phase == 'COMMIT':
        if op in (0,1,2,5,6,7):
            nodes += ['wb','rf'];edges.append('wb-rf')
        if op in (4,5,6,7):
            nodes.append('branch');edges.append('branch-pc')
    return nodes,edges


def snapshot(values, origin, image, index):
    if len(values) != 21:
        raise RuntimeError(f'Bad RTL trace width: expected 21 numbers, got {len(values)}')
    (phase_num, pc, halted, ir, a, b, result, alu_enabled, changed,
     wrote, addr, data, fault, *rest) = values
    regs = rest[:8]
    phase = PHASE_NAMES[phase_num]
    # UI display uses current PC program instruction. This is an annotation,
    # not a source of architectural PC, register or memory results.
    ix = max(0, min((pc - origin) // 3, len(image) // 3 - 1))
    lookup_pc = origin + ix * 3
    off = lookup_pc - origin
    word = image[off] | (image[off + 1] << 8) | (image[off + 2] << 16) if off + 2 < len(image) else 0
    op = (word >> 4) & 15
    nodes,edges=visuals(phase,op)
    signals = {'rtlCycle': index, 'rtlPhase': phase, 'rtlIR': f'0x{ir:06X}'}
    if phase.startswith('FETCH'): signals['fetchAddress']=f'0x{((pc+int(phase[-1]))&65535):04X}'
    if phase=='COMMIT': signals['pcAction']='HALT' if halted else f'0x{pc:04X}'
    if wrote: signals['memoryWrite']=f'[{addr:04X}] = {data:02X}'
    alu = {'op': None, 'a':None,'b':None,'result':None}
    if alu_enabled:
        ins_op = (ir >> 4) & 15
        fn = (ir >> 16) & 15
        table = R if ins_op == 0 else I if ins_op == 1 else ()
        opname = table[fn] if fn < len(table) else None
        alu={'op':opname,'a':a,'b':b,'result':result}
    return {
        'pc':pc,'phase':phase,'halted':bool(halted),'registers':regs,
        'instructionIndex':ix,'instructionCount':len(image)//3,
        'instruction':{'display':describe(word)}, 'alu':alu,'signals':signals,
        'activeNodes':nodes,'activeEdges':edges,
        'changedRegister':None if changed==15 else changed,
        'memoryChange': {'address':addr,'value':data} if wrote else None,
    }, bool(fault)


def run(payload):
    image=payload.get('bytes')
    input_text=payload.get('input','')
    if not isinstance(input_text,str):raise ValueError('input must be a string')
    input_bytes=input_text.encode('utf-8')
    if len(input_bytes)>4096:raise ValueError('stdin limited to 4096 bytes')
    origin=payload.get('origin',0)
    if not isinstance(image,list) or not image or len(image)%3 or any(type(x) is not int or not 0<=x<=255 for x in image):
        raise ValueError('Nonempty instruction image must contain 3-byte instructions')
    if type(origin) is not int or origin<0 or origin+len(image)>65536:
        raise ValueError('Image outside 16-bit address space')
    iverilog=os.getenv('WA824_IVERILOG','iverilog')
    vvp=os.getenv('WA824_VVP','vvp')
    maxcycles=int(os.getenv('WA824_MAX_RTL_CYCLES','160000'))
    if not 6<=maxcycles<=200000:
        raise ValueError('WA824_MAX_RTL_CYCLES must be in 6..200000')
    # Runner is per-program; never caches old executable nor leaks RAM state.
    with tempfile.TemporaryDirectory(prefix='wa824-rtl-') as folder:
        target=Path(folder)
        memfile=target/'image.mem'
        sim=target/'wa824_sim.out'
        stdinfile=target/'stdin.mem'
        stdinfile.write_text(''.join(f'{byte:02x}\n' for byte in input_bytes) or '00\n',encoding='ascii')
        mem=bytearray(65536)
        mem[origin:origin+len(image)] = bytes(image)
        memfile.write_text(''.join(f'{value:02x}\n' for value in mem),encoding='ascii')
        files=[RTL/'wa824_alu.v',RTL/'wa824_register_file.v',RTL/'wa824_ram.v',RTL/'wa824_core.v',RTL/'tb_wa824.v']
        compile_cmd=[iverilog,'-g2012','-s','tb_wa824','-o',str(sim),*[str(f) for f in files]]
        subprocess.run(compile_cmd,check=True,capture_output=True,text=True,timeout=20)
        command=[vvp,str(sim),f'+MEMFILE={memfile}',f'+ORIGIN={origin}',
                 f'+END={origin+len(image)}',f'+MAXCYCLES={maxcycles}',
                 f'+STDINLEN={len(input_bytes)}',f'+STDINFILE={stdinfile}']
        process=subprocess.run(command,capture_output=True,text=True,timeout=20)
        if process.returncode:
            raise RuntimeError(f'vvp exited {process.returncode}: {process.stderr[-600:]}')
        snapshots=[]
        last_memory_change = None
        stdout=''
        exit_code=None
        for line in process.stdout.splitlines():
            if line.startswith('TRACE '):
                values=[int(x) for x in line.split()[1:]]
                snap,fault=snapshot(values,origin,image,len(snapshots))
                snap['stdout']=stdout
                snap['exitCode']=exit_code
                if snap['memoryChange'] is not None:
                    last_memory_change=snap['memoryChange']
                else:
                    snap['memoryChange']=last_memory_change
                # COMMIT changes the PC at this edge; annotate the instruction
                # that was *just executed*, not the one at the new PC.
                if snap['phase']=='COMMIT':
                    previous_pc=snapshots[-1]['pc'] if snapshots else origin
                    snap['instructionIndex']=max(0,min((previous_pc-origin)//3,len(image)//3-1))
                    snap['instruction']={'display':describe(values[3])}
                elif snap['phase'] in ('DECODE','EXECUTE'):
                    snap['instruction']={'display':describe(values[3])}
                snapshots.append(snap)
                if fault: raise RuntimeError(f'RTL fault: unsupported/invalid instruction at PC {snap["pc"]:#06x}')
            elif line.startswith('IO_PUT '):
                stdout+=chr(int(line.split()[1]))
            elif line.startswith('IO_EXIT '):
                exit_code=int(line.split()[1])
            elif line.startswith('RTL_TIMEOUT'):
                raise RuntimeError(f'RTL did not halt within {maxcycles} clock cycles (infinite loop or increase WA824_MAX_RTL_CYCLES)')
        if not snapshots or snapshots[0]['phase']!='READY' or not snapshots[-1]['halted']:
            raise RuntimeError('RTL output has no initial snapshot or no terminal halt')
        return {'programSha256':hashlib.sha256(bytes(image)).hexdigest(),'snapshots':snapshots}


if __name__ == '__main__':
    try:
        response=run(json.load(sys.stdin))
        json.dump(response,sys.stdout,separators=(',',':'))
        sys.stdout.write('\n')
    except (ValueError,RuntimeError,FileNotFoundError,subprocess.SubprocessError) as err:
        print(f'WA824 RTL runner error: {err}',file=sys.stderr)
        sys.exit(1)
