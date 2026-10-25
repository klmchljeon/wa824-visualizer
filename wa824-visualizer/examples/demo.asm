; WA824 instruction bytes, real JS assembler.
start:
    ADDI x1l, x0l, 3
    ADDI x1h, x0l, 5
    ADD x2l, x1l, x1h
    XOR x2h, x2l, x1h
    EBRAKE
