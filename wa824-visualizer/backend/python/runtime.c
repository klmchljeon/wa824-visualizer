/* WA824 freestanding C runtime. Compiled with user source as needed. */
void print_int(int n) {
    if (n < 0) { putchar(45); n = -n; }
    if (n >= 10) { print_int(n / 10); }
    putchar(48 + n % 10);
}
int read_int(void) {
    int c = getchar();
    while (c == 32 || c == 10 || c == 13 || c == 9) c = getchar();
    int sign = 1;
    if (c == 45) { sign = -1; c = getchar(); }
    int n = 0;
    while (c >= 48 && c <= 57) {
        n = n * 10 + c - 48;
        c = getchar();
    }
    return n * sign;
}
void puts_wa(char *s) {
    int i = 0;
    while (s[i] != 0) { putchar(s[i]); i++; }
    putchar(10);
}
