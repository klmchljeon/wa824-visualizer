// WA824: recursion, function calls, 16-bit arithmetic, stdout.
int fib(int n) {
    if (n <= 1) return n;
    return fib(n - 1) + fib(n - 2);
}
int main() {
    printf("fib(7) = %d\n", fib(7));
    return 0;
}
