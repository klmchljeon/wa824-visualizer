"""Compiler frontend smoke tests; true machine-code execution tests in tests/c-integration.test.js."""
import unittest
from compiler import compile_source,CompileError

class PythonCompilerTests(unittest.TestCase):
    def test_function_main_and_real_instruction_flow(self):
        result=compile_source('int main(){int a=3;int b=5;return a+b;}')
        self.assertIn('__fn_main:',result['assembly'])
        self.assertIn('JA Wx5, __fn_main',result['assembly'])
        self.assertIn('S x1l, Wx7, 0',result['assembly'])
        self.assertIn('ECALL',result['assembly'])
        self.assertIn('JRP Wx0, Wx5, 0',result['assembly'])
        self.assertEqual(result['abi'],'WA824-FREESTANDING-1')
    def test_recursive_and_array_compile(self):
        src='int fact(int n){if(n<=1)return 1;return n*fact(n-1);}'
        src+='int main(){int a[2]={3,4};return fact(a[0]);}'
        result=compile_source(src)
        self.assertIn('__fn_fact:',result['assembly'])
        self.assertIn('__rt_mul16:',result['assembly'])
        self.assertIn('L x1l, Wx4, 0',result['assembly'])
    def test_printf_scanf_codegen(self):
        result=compile_source('int main(){int x;scanf("%d",&x);printf("%d\\n",x);return 0;}')
        self.assertIn('__fn_read_int:',result['assembly'])
        self.assertIn('__fn_print_int:',result['assembly'])
    def test_compiler_errors(self):
        for source in ('int main(){float x=2.1;return 0;}',
                       'int main(){int x=unknown;return x;}',
                       'int main(){int a[2]={1,2,3};return 0;}',
                       'unsigned char a=7;',
                       'int main(){printf("%f",3);return 0;}'):
            with self.subTest(source=source),self.assertRaises(CompileError):compile_source(source)

if __name__=='__main__':unittest.main()
