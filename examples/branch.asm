; loop to 5 via branch
    ADDI x1l, x0l, 0
loop:
    ADDI x1l, x1l, 1
    ADDI x2l, x0l, 5
    BNE x1l, x2l, loop
    EBRAKE
