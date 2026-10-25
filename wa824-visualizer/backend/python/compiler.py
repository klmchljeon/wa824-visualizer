"""WA824 C subset compiler. pycparser frontend -> genuine WA824 text assembly.

This is deliberately a documented freestanding *subset*, not a hosted ISO C compiler.
All C integer values are 16 bits except char (8); no heap, structs, or floats.
ABI details: docs/ABI-IO.md.
"""
import ast
import itertools
import re
from dataclasses import dataclass
from pycparser import c_ast, c_parser
from pycparser.c_parser import ParseError

class CompileError(ValueError):
    pass

@dataclass
class CType:
    bits: int = 16
    unsigned: bool = False
    array: int = 0
    ptr: bool = False
    def element_width(self): return 1 if self.bits == 8 else 2
    def width(self): return self.array * self.element_width() if self.array else (2 if self.ptr else self.element_width())


def ctype(node):
    if isinstance(node, c_ast.Decl): return ctype(node.type)
    if isinstance(node, c_ast.Typename): return ctype(node.type)
    if isinstance(node, c_ast.ArrayDecl):
        t=ctype(node.type)
        if node.dim is None: return CType(t.bits,t.unsigned,ptr=True)
        if not isinstance(node.dim,c_ast.Constant):raise CompileError('Array size must be a constant')
        n=int(node.dim.value,0)
        if n<=0 or n>1024:raise CompileError('Array size must be 1..1024')
        return CType(t.bits,t.unsigned,n,t.ptr)
    if isinstance(node,c_ast.PtrDecl):
        t=ctype(node.type)
        return CType(t.bits,t.unsigned,ptr=True)
    if isinstance(node,c_ast.FuncDecl):return ctype(node.type)
    if isinstance(node,c_ast.TypeDecl):return ctype(node.type)
    if isinstance(node,c_ast.IdentifierType):
        names=node.names
        if 'void' in names:return CType(0)
        if 'char' in names or 'uint8_t' in names or 'int8_t' in names:
            return CType(8,'unsigned' in names or 'uint8_t' in names)
        return CType(16,'unsigned' in names or 'uint16_t' in names or 'size_t' in names)
    raise CompileError(f'Unsupported type {type(node).__name__}')

from pathlib import Path
LIBRARY = Path(__file__).with_name('runtime.c').read_text(encoding='utf8')

class Function:
    def __init__(self,name,node):
        self.name=name;self.node=node;self.params={};self.locals={};self.frame_size=0
        self.ret=ctype(node.decl.type.type)
        args=node.decl.type.args.params if node.decl.type.args else []
        args=[a for a in args if not (isinstance(a,c_ast.Typename) and ctype(a).bits==0)]
        for i,a in enumerate(args):
            if not isinstance(a,c_ast.Decl) or not a.name:raise CompileError(f'Unsupported parameter in {name}')
            self.params[a.name]=(4+2*(len(args)-1-i),ctype(a))
        for item in self.walk_decls(node.body):
            if item.name in self.params or item.name in self.locals:raise CompileError(f'Duplicate local {item.name} in {name}')
            t=ctype(item)
            size=t.width()
            self.frame_size+=size
            self.locals[item.name]=(-self.frame_size,t)
        if self.frame_size>1800:raise CompileError(f'Frame too large in {name}')
    @classmethod
    def walk_decls(cls,node):
        if node is None:return
        if isinstance(node,c_ast.Decl) and not isinstance(node.type,c_ast.FuncDecl):
            yield node
            return
        for _,child in node.children():
            if not isinstance(child,c_ast.FuncDef):yield from cls.walk_decls(child)
    def variable(self,name):
        if name in self.locals:return self.locals[name]
        if name in self.params:return self.params[name]
        raise CompileError(f'Undeclared variable {name!r} in {self.name}')

class Compiler:
    def __init__(self,source):
        self.source=source;self.lines=[];self.line_map=[];self.unique=itertools.count();self.fn=None
        self.functions={};self.loop=[];self.used_div=False;self.used_mul=False
    def emit(self,code,node=None):
        self.lines.append(code)
        self.line_map.append(getattr(getattr(node,'coord',None),'line',1) or 1)
    def label(self,prefix='L'):return f'__cg_{prefix}_{next(self.unique)}'
    def mark(self,label):self.emit(label+':')
    def jmp(self,label):self.emit(f'JA Wx0, {label}')
    def load_const(self,reg,val):
        val=val&0xffff
        for half,byte in [('l',val&255),('h',val>>8)]:
            self.emit(f'ADDI x{reg}{half}, x0l, {byte if byte<128 else byte-256}')
    def copy(self,dst,src):
        if dst==src:return
        for h in 'lh':self.emit(f'ADD x{dst}{h}, x{src}{h}, x0l')
    def adjust(self,reg,delta):
        # 16-bit add/sub small signed chunk, with explicit carry/borrow.
        while delta:
            n=max(-127,min(127,delta)); delta-=n
            self.emit(f'ADD x3l, x{reg}l, x0l')
            self.emit(f'ADDI x{reg}l, x{reg}l, {n}')
            if n>0:
                self.emit(f'SLTU x3h, x{reg}l, x3l')
                self.emit(f'ADD x{reg}h, x{reg}h, x3h')
            else:
                self.emit(f'SLTU x3h, x3l, x{reg}l')
                self.emit(f'SUB x{reg}h, x{reg}h, x3h')
    def push(self,reg):
        self.adjust(7,-2)
        self.emit(f'S x{reg}l, Wx7, 0')
        self.emit(f'S x{reg}h, Wx7, 1')
    def pop(self,reg):
        self.emit(f'L x{reg}l, Wx7, 0')
        self.emit(f'L x{reg}h, Wx7, 1')
        self.adjust(7,2)
    def address(self,name):
        off,t=self.fn.variable(name)
        self.copy(1,6)
        self.adjust(1,off)
        return t
    def deref(self,t):
        self.copy(4,1)
        self.emit('L x1l, Wx4, 0')
        if t.bits>8 or t.ptr:self.emit('L x1h, Wx4, 1')
        elif t.unsigned:self.emit('ADD x1h, x0l, x0l')
        else:self.emit('SRAI x1h, x1l, 7')
    def store(self,t):
        # destination address Wx4, incoming value Wx2; result Wx1.
        self.emit('S x2l, Wx4, 0')
        if t.bits>8 or t.ptr:self.emit('S x2h, Wx4, 1')
        elif t.unsigned:self.emit('ADD x2h, x0l, x0l')
        else:self.emit('SRAI x2h, x2l, 7')
        self.copy(1,2)
    def type_expr(self,n):
        if isinstance(n,c_ast.ID):return self.fn.variable(n.name)[1]
        if isinstance(n,c_ast.ArrayRef):
            t=self.type_expr(n.name)
            return CType(t.bits,t.unsigned)
        if isinstance(n,c_ast.UnaryOp) and n.op=='*':return CType(8,True)
        return CType()
    def addr_expr(self,node):
        if isinstance(node,c_ast.ID):return self.address(node.name)
        if isinstance(node,c_ast.UnaryOp) and node.op=='*':
            self.expr(node.expr);return self.type_expr(node)
        if isinstance(node,c_ast.ArrayRef):
            elem=self.type_expr(node)
            self.expr(node.name) # array ID evaluates to address
            self.push(1)
            self.expr(node.subscript)
            if elem.element_width()==2:
                self.emit('ADD x3l, x1l, x0l')
                self.emit('SLLI x1l, x1l, 1')
                self.emit('SRAI x3l, x3l, 7')
                self.emit('ANDI x3l, x3l, 1')
                self.emit('SLLI x1h, x1h, 1')
                self.emit('OR x1h, x1h, x3l')
            self.pop(2)
            self.add_words()
            return elem
        raise CompileError(f'Not an lvalue: {type(node).__name__}')
    def add_words(self):
        # x2(left) + x1(right) -> x1
        self.emit('ADD x1l, x2l, x1l')
        self.emit('SLTU x3l, x1l, x2l')
        self.emit('ADD x1h, x2h, x1h')
        self.emit('ADD x1h, x1h, x3l')
    def sub_words(self):
        self.emit('SLTU x3l, x2l, x1l')
        self.emit('SUB x1l, x2l, x1l')
        self.emit('SUB x1h, x2h, x1h')
        self.emit('SUB x1h, x1h, x3l')
    def cmp_words(self,op,signed):
        # x2(left), x1(right) -> x1 0/1
        if op in ('==','!='):
            self.emit('XOR x3l, x2l, x1l')
            self.emit('XOR x3h, x2h, x1h')
            self.emit('OR x3l, x3l, x3h')
            self.emit('SLTUI x1l, x3l, 1')
            if op=='!=':self.emit('XORI x1l, x1l, 1')
        else:
            if op in ('>','<='):
                self.copy(4,1);self.copy(1,2);self.copy(2,4)
            if signed:
                self.emit('XORI x2h, x2h, -128')
                self.emit('XORI x1h, x1h, -128')
            self.emit('XOR x4l, x2h, x1h')
            self.emit('SLTUI x4l, x4l, 1')
            self.emit('SLTU x4h, x2l, x1l')
            self.emit('AND x4h, x4h, x4l')
            self.emit('SLTU x3l, x2h, x1h')
            self.emit('OR x1l, x3l, x4h')
            if op in ('<=','>='):self.emit('XORI x1l, x1l, 1')
        self.emit('ADD x1h, x0l, x0l')
    def boolify(self):
        self.emit('OR x1l, x1l, x1h')
        self.emit('SLTUI x1l, x1l, 1')
        self.emit('XORI x1l, x1l, 1')
        self.emit('ADD x1h, x0l, x0l')
    def branch_false(self,target):
        # short conditional branch is 8-bit; fixed skip over long JA.
        self.emit('OR x1l, x1l, x1h')
        self.emit('BNE x1l, x0l, 6')
        self.jmp(target)
    def branch_true(self,target):
        self.emit('OR x1l, x1l, x1h')
        self.emit('BEQ x1l, x0l, 6')
        self.jmp(target)
    def emit_char(self,byte):
        if byte<0 or byte>255:raise CompileError('Only byte-oriented text output supported')
        self.load_const(2,byte)
        self.load_const(1,1)
        self.emit('ECALL')
    def expr(self,n):
        if isinstance(n,c_ast.Constant):
            if n.type=='char':
                try:v=ord(ast.literal_eval(n.value))
                except Exception:raise CompileError(f'Unsupported character literal {n.value}')
            elif n.type in ('int','unsigned int','long','unsigned long'):v=int(re.sub(r'[uUlL]+$','',n.value),0)
            else:raise CompileError(f'Unsupported literal {n.value}')
            self.load_const(1,v);return CType()
        if isinstance(n,c_ast.ID):
            t=self.fn.variable(n.name)[1]
            self.address(n.name)
            if not t.array:self.deref(t)
            return t
        if isinstance(n,c_ast.ArrayRef):
            t=self.addr_expr(n);self.deref(t);return t
        if isinstance(n,c_ast.Assignment):
            if n.op!='=':
                op=n.op[:-1]
                self.expr(n.lvalue);self.push(1);self.expr(n.rvalue);self.pop(2)
                self.binop(op, CType())
            else:self.expr(n.rvalue)
            self.push(1)
            t=self.addr_expr(n.lvalue)
            self.copy(4,1)
            self.pop(2)
            self.store(t)
            return t
        if isinstance(n,c_ast.BinaryOp):
            if n.op in ('&&','||'):
                skip=self.label('logic_skip');done=self.label('logic_done')
                self.expr(n.left)
                if n.op=='&&':self.branch_false(skip)
                else:self.branch_true(skip)
                self.expr(n.right);self.boolify();self.jmp(done)
                self.mark(skip);self.load_const(1,1 if n.op=='||' else 0)
                self.mark(done);return CType()
            lt=self.expr(n.left);self.push(1)
            rt=self.expr(n.right);self.pop(2)
            self.binop(n.op,CType(unsigned=lt.unsigned or rt.unsigned));return CType()
        if isinstance(n,c_ast.UnaryOp):
            if n.op=='&':self.addr_expr(n.expr);return CType(ptr=True)
            if n.op=='*':
                self.expr(n.expr);t=self.type_expr(n);self.deref(t);return t
            if n.op in ('p++','p--','++','--'):
                op='+' if '++' in n.op else '-'
                self.expr(n.expr);self.push(1)
                self.load_const(1,1);self.pop(2);self.binop(op,CType())
                self.push(1);t=self.addr_expr(n.expr);self.copy(4,1);self.pop(2);self.store(t)
                if n.op.startswith('p'):
                    self.adjust(1,-1 if op=='+' else 1)
                return t
            self.expr(n.expr)
            if n.op=='+':return CType()
            if n.op=='-':
                self.emit('SUB x1l, x0l, x1l')
                self.emit('SLTUI x3l, x1l, 1')  # if low!=0, borrow
                self.emit('XORI x3l, x3l, 1')
                self.emit('SUB x1h, x0l, x1h')
                self.emit('SUB x1h, x1h, x3l')
            elif n.op=='~':
                self.emit('XORI x1l, x1l, -1');self.emit('XORI x1h, x1h, -1')
            elif n.op=='!':
                self.boolify();self.emit('XORI x1l, x1l, 1')
            else:raise CompileError(f'Unsupported unary operator {n.op}')
            return CType()
        if isinstance(n,c_ast.FuncCall):
            if not isinstance(n.name,c_ast.ID):raise CompileError('Indirect calls not supported')
            name=n.name.name
            args=n.args.exprs if n.args else []
            if name=='putchar':
                if len(args)!=1:raise CompileError('putchar takes one argument')
                self.expr(args[0]);self.copy(2,1);self.load_const(1,1);self.emit('ECALL');self.copy(1,2)
                return CType()
            if name=='getchar':
                if args:raise CompileError('getchar takes no arguments')
                self.load_const(1,2);self.emit('ECALL');self.copy(1,2);return CType()
            if name=='exit':
                if len(args)!=1:raise CompileError('exit requires one argument')
                self.expr(args[0]);self.copy(2,1);self.load_const(1,5);self.emit('ECALL');return CType()
            if name=='printf':
                if not args or not isinstance(args[0],c_ast.Constant) or args[0].type!='string':
                    raise CompileError('printf requires a literal format string')
                try:fmt=ast.literal_eval(args[0].value)
                except Exception:raise CompileError('Invalid printf format literal')
                arg_i=1;i=0
                while i<len(fmt):
                    if fmt[i]=='%':
                        i+=1
                        if i>=len(fmt):raise CompileError('Unfinished printf specifier')
                        spec=fmt[i]
                        if spec=='%':self.emit_char(ord('%'))
                        elif spec=='c':
                            if arg_i>=len(args):raise CompileError('printf too few arguments')
                            self.expr(args[arg_i]);arg_i+=1
                            self.copy(2,1);self.load_const(1,1);self.emit('ECALL')
                        elif spec=='d':
                            if arg_i>=len(args):raise CompileError('printf too few arguments')
                            self.expr(args[arg_i]);arg_i+=1
                            self.push(1);self.emit('JA Wx5, __fn_print_int');self.adjust(7,2)
                        else:raise CompileError(f'Unsupported printf format %{spec} (use %d/%c/%%)')
                    else:self.emit_char(ord(fmt[i]))
                    i+=1
                if arg_i!=len(args):raise CompileError('printf too many arguments')
                self.load_const(1,len(fmt));return CType()
            if name=='scanf':
                if not args or not isinstance(args[0],c_ast.Constant) or args[0].type!='string':
                    raise CompileError('scanf requires a literal format string')
                try:fmt=ast.literal_eval(args[0].value)
                except Exception:raise CompileError('Invalid scanf format literal')
                if re.sub(r'\s+','',fmt)!='%d'*(len(args)-1):
                    raise CompileError('scanf supports whitespace-separated %d only')
                for target in args[1:]:
                    if not isinstance(target,c_ast.UnaryOp) or target.op!='&':
                        raise CompileError('scanf arguments must be &variable')
                    self.emit('JA Wx5, __fn_read_int')
                    self.push(1)
                    t=self.addr_expr(target.expr)
                    self.copy(4,1);self.pop(2);self.store(t)
                self.load_const(1,len(args)-1);return CType()
            if name=='puts':
                if len(args)!=1 or not isinstance(args[0],c_ast.Constant) or args[0].type!='string':
                    raise CompileError('puts currently supports a string literal')
                try:sval=ast.literal_eval(args[0].value)
                except Exception:raise CompileError('Invalid string literal')
                for ch in sval:self.emit_char(ord(ch))
                self.emit_char(10);self.load_const(1,0);return CType()
            if name not in self.functions:raise CompileError(f'Undefined function {name}')
            for arg in args:self.expr(arg);self.push(1)
            self.emit(f'JA Wx5, __fn_{name}')
            if args:self.adjust(7,2*len(args))
            return self.functions[name].ret
        if isinstance(n,c_ast.Cast):
            self.expr(n.expr);t=ctype(n.to_type)
            if t.bits==8:
                if t.unsigned:self.emit('ADD x1h, x0l, x0l')
                else:
                    self.emit('SRAI x1h, x1l, 7')
            return t
        if isinstance(n,c_ast.TernaryOp):
            alternate=self.label('ternary_else');finish=self.label('ternary_end')
            self.expr(n.cond);self.branch_false(alternate)
            self.expr(n.iftrue);self.jmp(finish)
            self.mark(alternate);self.expr(n.iffalse);self.mark(finish);return CType()
        if isinstance(n,c_ast.ExprList):
            for e in n.exprs:self.expr(e)
            return CType()
        raise CompileError(f'Unsupported expression {type(n).__name__}')
    def binop(self,op,left_type):
        if op=='+':self.add_words()
        elif op=='-':self.sub_words()
        elif op in ('&','|','^'):
            m={'&':'AND','|':'OR','^':'XOR'}[op]
            for h in 'lh':self.emit(f'{m} x1{h}, x2{h}, x1{h}')
        elif op in ('==','!=','<','<=','>','>='):self.cmp_words(op,not left_type.unsigned)
        elif op in ('*','/','%'):
            if op=='*':self.used_mul=True;self.emit('JA Wx5, __rt_mul16')
            else:
                self.used_div=True;self.emit(f'JA Wx5, {"__rt_udivmod16" if left_type.unsigned else "__rt_sdivmod16"}')
                if op=='%':self.copy(1,2)
        elif op in ('<<','>>'):
            self.emit('ANDI x1l, x1l, 15')
            self.emit('ADD x3h, x1l, x0l')
            start=self.label('shift');end=self.label('shift_end')
            self.copy(1,2);self.mark(start)
            self.emit('BNE x3h, x0l, 6');self.jmp(end)
            if op=='<<':
                self.emit('SRAI x4l, x1l, 7');self.emit('ANDI x4l, x4l, 1')
                self.emit('SLLI x1l, x1l, 1');self.emit('SLLI x1h, x1h, 1')
                self.emit('OR x1h, x1h, x4l')
            else:
                self.emit('ANDI x4l, x1h, 1')
                self.emit('SLLI x4l, x4l, 7')
                self.emit('SRAI x1l, x1l, 1');self.emit('ANDI x1l, x1l, 127')
                self.emit('OR x1l, x1l, x4l')
                self.emit('SRAI x1h, x1h, 1')
                if left_type.unsigned:self.emit('ANDI x1h, x1h, 127')
            self.emit('ADDI x3h, x3h, -1');self.jmp(start);self.mark(end)
        else:raise CompileError(f'Unsupported binary operator {op}')
    def stmt(self,n):
        if n is None:return
        if isinstance(n,c_ast.Compound):
            for item in n.block_items or []:self.stmt(item)
        elif isinstance(n,c_ast.Decl):
            if n.init is not None:
                t=ctype(n)
                if t.array:
                    if isinstance(n.init,c_ast.InitList):
                        values=n.init.exprs
                    elif (isinstance(n.init,c_ast.Constant) and n.init.type=='string'
                          and t.bits==8):
                        try:decoded=ast.literal_eval(n.init.value)
                        except Exception:raise CompileError('Invalid string initializer')
                        values=[c_ast.Constant('int',str(ord(ch))) for ch in decoded+'\0']
                    else:raise CompileError('Array initializer requires {values} or a char string literal')
                    if len(values)>t.array:raise CompileError(f'Initializer for {n.name} exceeds array size')
                    item_type=CType(t.bits,t.unsigned)
                    for i,value in enumerate(values):
                        self.expr(value);self.push(1)
                        self.address(n.name)
                        self.adjust(1,i*t.element_width())
                        self.copy(4,1);self.pop(2);self.store(item_type)
                    # C initializes unspecified elements to zero for partial initializers.
                    for i in range(len(values),t.array):
                        self.load_const(1,0);self.push(1)
                        self.address(n.name);self.adjust(1,i*t.element_width())
                        self.copy(4,1);self.pop(2);self.store(item_type)
                else:
                    self.expr(n.init);self.push(1);self.address(n.name)
                    self.copy(4,1);self.pop(2);self.store(t)
        elif isinstance(n,c_ast.Return):
            if n.expr:self.expr(n.expr)
            else:self.load_const(1,0)
            if self.fn.ret.bits==8:
                if self.fn.ret.unsigned:self.emit('ADD x1h, x0l, x0l')
                else:self.emit('SRAI x1h, x1l, 7')
            self.jmp(self.end_label)
        elif isinstance(n,c_ast.If):
            alternate=self.label('else');end=self.label('endif')
            self.expr(n.cond);self.branch_false(alternate)
            self.stmt(n.iftrue)
            if n.iffalse:self.jmp(end)
            self.mark(alternate)
            if n.iffalse:self.stmt(n.iffalse);self.mark(end)
        elif isinstance(n,c_ast.While):
            start=self.label('while');end=self.label('endwhile')
            self.mark(start);self.expr(n.cond);self.branch_false(end)
            self.loop.append((start,end));self.stmt(n.stmt);self.loop.pop()
            self.jmp(start);self.mark(end)
        elif isinstance(n,c_ast.For):
            if n.init:self.stmt(n.init)
            start=self.label('for');post=self.label('forpost');end=self.label('endfor')
            self.mark(start)
            if n.cond:self.expr(n.cond);self.branch_false(end)
            self.loop.append((post,end));self.stmt(n.stmt);self.loop.pop()
            self.mark(post)
            if n.next:self.expr(n.next)
            self.jmp(start);self.mark(end)
        elif isinstance(n,c_ast.DeclList):
            for item in n.decls:self.stmt(item)
        elif isinstance(n,c_ast.Break):
            if not self.loop:raise CompileError('break outside loop')
            self.jmp(self.loop[-1][1])
        elif isinstance(n,c_ast.Continue):
            if not self.loop:raise CompileError('continue outside loop')
            self.jmp(self.loop[-1][0])
        elif isinstance(n,c_ast.EmptyStatement):pass
        elif isinstance(n,c_ast.Node):self.expr(n)
        else:raise CompileError(f'Unsupported statement {type(n).__name__}')
    def function(self,fn):
        self.fn=fn;self.end_label=self.label(f'{fn.name}_ret')
        self.mark(f'__fn_{fn.name}')
        self.push(6);self.push(5);self.copy(6,7)
        if fn.frame_size:self.adjust(7,-fn.frame_size)
        self.stmt(fn.node.body)
        self.load_const(1,0)
        self.mark(self.end_label)
        self.copy(7,6)
        self.emit('L x5l, Wx7, 0');self.emit('L x5h, Wx7, 1')
        self.emit('L x4l, Wx7, 2');self.emit('L x4h, Wx7, 3')
        self.copy(6,4)
        self.adjust(7,4)
        self.emit('JRP Wx0, Wx5, 0')
    @classmethod
    def find_calls(cls,node):
        if isinstance(node,c_ast.FuncCall) and isinstance(node.name,c_ast.ID):
            yield node.name.name
        for _,child in node.children():yield from cls.find_calls(child)
    def parse(self):
        source=re.sub(r'/\*.*?\*/',lambda m:'\n'*m.group().count('\n'),self.source,flags=re.S)
        source=re.sub(r'//[^\n]*','',source)
        source=re.sub(r'^\s*#\s*include\b[^\n]*','',source,flags=re.M)
        source=re.sub(r'^\s*#\s*define\s+(\w+)\s+([\d]+)\s*$','',source,flags=re.M)
        prolog='typedef unsigned char uint8_t; typedef signed char int8_t; typedef unsigned short uint16_t; typedef short int16_t;\n'
        proto='int putchar(int c); int getchar(void); void exit(int code);\n'
        runtime=re.sub(r'/\*.*?\*/','',LIBRARY,flags=re.S)
        try:return c_parser.CParser().parse(prolog+proto+source+'\n'+runtime)
        except ParseError as e:raise CompileError(f'C syntax error: {e}') from e
    def compile(self):
        ast=self.parse()
        for item in ast.ext:
            if isinstance(item,c_ast.FuncDef):
                fn=Function(item.decl.name,item)
                if fn.name in self.functions:raise CompileError(f'Duplicate function {fn.name}')
                self.functions[fn.name]=fn
            elif isinstance(item,c_ast.Decl) and isinstance(item.type,c_ast.FuncDecl):continue
            elif isinstance(item,c_ast.Typedef):continue
            else:raise CompileError('Global variables not yet supported (declare locals in main)')
        if 'main' not in self.functions:raise CompileError('Program needs int main()')
        self.mark('__start')
        self.load_const(7,0xfffe)
        self.emit('JA Wx5, __fn_main')
        self.copy(2,1)
        self.load_const(1,5)
        self.emit('ECALL');self.emit('EBRAKE')
        # Emit only functions reachable from main; the bundled library is dead-code eliminated.
        reachable={'main'}
        while True:
            old=len(reachable)
            for name in list(reachable):
                node=self.functions[name].node
                for call in self.find_calls(node.body):
                    if call in self.functions:reachable.add(call)
                    if call=='printf':reachable.add('print_int')
                    if call=='scanf':reachable.add('read_int')
            if len(reachable)==old:break
        for name in sorted(reachable):
            self.function(self.functions[name])
        if self.used_mul:self.mul_helper()
        if self.used_div:
            self.div_helper()
            self.signed_div_helper()
        return {'assembly':'\n'.join(self.lines),'lineMap':self.line_map,
                'variables':{},'functions':list(self.functions),'abi':'WA824-FREESTANDING-1'}
    def mul_helper(self):
        self.mark('__rt_mul16')
        # multiplier x1, multiplicand x2, product x3 (x4 temp)
        self.load_const(3,0)
        begin=self.label('mul');done=self.label('muldone');skip=self.label('mulskip')
        self.mark(begin)
        self.emit('OR x4l, x1l, x1h')
        self.emit('BNE x4l, x0l, 6');self.jmp(done)
        self.emit('ANDI x4l, x1l, 1')
        self.emit('BNE x4l, x0l, 6');self.jmp(skip)
        self.emit('ADD x4h, x3l, x0l')
        self.emit('ADD x3l, x3l, x2l')
        self.emit('SLTU x4l, x3l, x4h')
        self.emit('ADD x3h, x3h, x2h')
        self.emit('ADD x3h, x3h, x4l')
        self.mark(skip)
        # x2 <<= 1
        self.emit('SRAI x4l, x2l, 7');self.emit('ANDI x4l, x4l, 1')
        self.emit('SLLI x2l, x2l, 1');self.emit('SLLI x2h, x2h, 1');self.emit('OR x2h, x2h, x4l')
        # x1 logical >>=1
        self.emit('ANDI x4l, x1h, 1');self.emit('SLLI x4l, x4l, 7')
        self.emit('SRAI x1l, x1l, 1');self.emit('ANDI x1l, x1l, 127');self.emit('OR x1l, x1l, x4l')
        self.emit('SRAI x1h, x1h, 1');self.emit('ANDI x1h, x1h, 127')
        self.jmp(begin);self.mark(done);self.copy(1,3);self.emit('JRP Wx0, Wx5, 0')
    def div_helper(self):
        # Binary restoring division, unsigned x2/x1 -> quotient x1, remainder x2.
        self.mark('__rt_udivmod16')
        self.copy(4,1) # divisor
        self.copy(3,2) # quotient initial dividend
        self.load_const(2,0) # remainder
        self.load_const(1,16) # iteration count (x1l)
        begin=self.label('div');done=self.label('divdone');skip=self.label('divskip')
        self.mark(begin)
        self.emit('BNE x1l, x0l, 6');self.jmp(done)
        # remainder = (remainder << 1) | high_bit(quotient)
        self.emit('SRAI x1h, x2l, 7');self.emit('ANDI x1h, x1h, 1')
        self.emit('SLLI x2h, x2h, 1');self.emit('OR x2h, x2h, x1h')
        self.emit('SRAI x1h, x3h, 7');self.emit('ANDI x1h, x1h, 1')
        self.emit('SLLI x2l, x2l, 1');self.emit('OR x2l, x2l, x1h')
        # quotient <<= 1
        self.emit('SRAI x1h, x3l, 7');self.emit('ANDI x1h, x1h, 1')
        self.emit('SLLI x3h, x3h, 1');self.emit('OR x3h, x3h, x1h')
        self.emit('SLLI x3l, x3l, 1')
        # if remainder >= divisor, subtract divisor and set quotient bit
        do_sub=self.label('divsub')
        self.emit('SLTU x1h, x2h, x4h')
        self.emit('BEQ x1h, x0l, 6');self.jmp(skip)
        self.emit('SLTU x1h, x4h, x2h')
        self.emit('BEQ x1h, x0l, 6');self.jmp(do_sub)
        self.emit('SLTU x1h, x2l, x4l')
        self.emit('BEQ x1h, x0l, 6');self.jmp(skip)
        self.mark(do_sub)
        self.emit('SLTU x1h, x2l, x4l')
        self.emit('SUB x2l, x2l, x4l')
        self.emit('SUB x2h, x2h, x4h')
        self.emit('SUB x2h, x2h, x1h')
        self.emit('ORI x3l, x3l, 1')
        self.mark(skip)
        self.emit('ADDI x1l, x1l, -1');self.jmp(begin)
        self.mark(done);self.copy(1,3);self.emit('JRP Wx0, Wx5, 0')


    def negate(self,reg):
        self.emit(f'SUB x{reg}l, x0l, x{reg}l')
        self.emit(f'SLTUI x3l, x{reg}l, 1')
        self.emit('XORI x3l, x3l, 1')
        self.emit(f'SUB x{reg}h, x0l, x{reg}h')
        self.emit(f'SUB x{reg}h, x{reg}h, x3l')
    def signed_div_helper(self):
        self.mark('__rt_sdivmod16')
        self.emit('SRAI x3l, x2h, 7');self.emit('ANDI x3l, x3l, 1')
        self.emit('SRAI x3h, x1h, 7');self.emit('ANDI x3h, x3h, 1')
        self.emit('XOR x3h, x3h, x3l')
        # W x3 = {quotient_negative, remainder_negative}
        self.copy(4,3)
        self.adjust(7,-2)
        self.emit('S x4l, Wx7, 0');self.emit('S x4h, Wx7, 1')
        left_nonneg=self.label('l_nonneg');right_nonneg=self.label('r_nonneg')
        self.emit('SRAI x3l, x2h, 7')
        self.emit('BNE x3l, x0l, 6');self.jmp(left_nonneg)
        self.negate(2)
        self.mark(left_nonneg)
        # restoring right operand sign flag x3h survives the x3l temp
        # used by negate(), but quotient sign flag in x3h is retained.
        self.emit('SRAI x4l, x1h, 7')
        self.emit('BNE x4l, x0l, 6');self.jmp(right_nonneg)
        self.negate(1)
        self.mark(right_nonneg)
        self.push(5)
        self.emit('JA Wx5, __rt_udivmod16')
        self.pop(5)
        self.emit('L x4l, Wx7, 0');self.emit('L x4h, Wx7, 1');self.adjust(7,2)
        no_neg_quot=self.label('no_neg_q');no_neg_rem=self.label('no_neg_r')
        self.emit('BNE x4h, x0l, 6');self.jmp(no_neg_quot)
        self.negate(1)
        self.mark(no_neg_quot)
        self.emit('BNE x4l, x0l, 6');self.jmp(no_neg_rem)
        self.negate(2)
        self.mark(no_neg_rem)
        self.emit('JRP Wx0, Wx5, 0')


def compile_source(source):
    if not isinstance(source,str):raise CompileError('C source must be a string')
    return Compiler(source).compile()
