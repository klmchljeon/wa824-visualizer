import test from 'node:test';
import assert from 'node:assert/strict';
import {runC} from '../tools/execute-c.mjs';

const cases=[
  ['16-bit addition and carry','int main(){int a=1000;int b=2222;return a+b;}',3222,''],
  ['8-bit unsigned wrap','int main(){unsigned char a=250;unsigned char b=10;a=a+b;return a;}',4,''],
  ['8-bit signed extension','int main(){signed char a=-3;return a;}',65533,''],
  ['if/else','int main(){int a=10;if(a>5)a+=3;else a=1;return a;}',13,''],
  ['while loop / accumulator','int main(){int i=0;int sum=0;while(i<10){sum+=i;i++;}return sum;}',45,''],
  ['for, continue, break','int main(){int sum=0;for(int i=0;i<10;i++){if(i==3)continue;if(i==7)break;sum+=i;}return sum;}',18,''],
  ['byte array initialization and index','int main(){unsigned char a[3]={5,2,4};return a[0]+a[1]+a[2];}',11,''],
  ['16-bit array initialization','int main(){int a[4]={1000,2222,7,11};return a[0]+a[1];}',3222,''],
  ['function arguments','int add(int a,int b){return a+b;}int main(){return add(19,23);}',42,''],
  ['recursion Fibonacci','int fib(int n){if(n<=1)return n;return fib(n-1)+fib(n-2);}int main(){return fib(6);}',8,''],
  ['multiplication','int main(){return 11*12;}',132,''],
  ['unsigned division','int main(){unsigned int a=65535;unsigned int b=255;return a/b;}',257,''],
  ['unsigned modulo','int main(){unsigned int a=65535;unsigned int b=255;return a%b;}',0,''],
  ['signed division','int main(){return -125/10;}',65524,''],
  ['signed modulo','int main(){return -125%10;}',65531,''],
  ['signed division negative divisor','int main(){return 125/-10;}',65524,''],
  ['16-bit shift left','int main(){return 129<<4;}',2064,''],
  ['16-bit shift right','int main(){return 256>>3;}',32,''],
  ['unsigned/signed compare','int main(){int x=-1;if(x<0 && !(x>0))return 7;return 0;}',7,''],
  ['putchar/exit','int main(){putchar(65);putchar(66);return 7;}',7,'AB'],
  ['getchar echo','int main(){int c=getchar();putchar(c);return 0;}',0,'Z','Z'],
  ['getc EOF','int main(){return getchar();}',65535,''],
  ['printf format limited','int main(){printf("result=%d%c\\n",42,33);return 0;}',0,'result=42!\n'],
  ['scanf input and printf','int main(){int a=0;int b=0;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}',0,'42\n','12 30\n'],
  ['read_int and negative print','int main(){int a=read_int();print_int(a);return 0;}',0,'-42','-42\n'],
  ['array passed to function','int sum(unsigned char *a,int n){int s=0;for(int i=0;i<n;i++)s+=a[i];return s;}int main(){unsigned char a[4]={4,5,6,7};return sum(a,4);}',22,''],
  ['string char array','int main(){char s[7]="WA824!";int i=0;while(s[i]!=0){putchar(s[i]);i++;}return 0;}',0,'WA824!'],
  ['built-in puts','int main(){puts("Hello");return 0;}',0,'Hello\n'],
];
for(const [name,source,exitCode,stdout,input=''] of cases) {
  test(`C → Python → JS ASM → JS CPU: ${name}`,async()=>{
    const result=await runC(source,input,70000);
    assert.equal(result.exitCode,exitCode);
    assert.equal(result.stdout,stdout);
    assert.equal(result.registers[0],0,'x0 hardwired zero');
    assert.ok(result.binary.bytes.length>0 && result.binary.bytes.length%3===0);
    assert.ok(!result.compiled.assembly.includes('@mockset'));
  });
}
