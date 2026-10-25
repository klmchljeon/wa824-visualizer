`timescale 1ns/1ps
// Simulator-only harness. Lines starting "TRACE " are parsed by runner.py.
module tb_wa824;
    reg clk=0;
    always #5 clk=~clk;
    reg rst=1;
    reg [15:0] origin=0;
    reg [16:0] image_end=0;
    wire [15:0] pc;
    wire halted, fault;
    wire [15:0] mem_address;
    wire [7:0] mem_read_data, mem_write_data;
    wire mem_write_enable;
    wire [23:0] instruction;
    wire [2:0] last_phase;
    wire [7:0] last_alu_a,last_alu_b,last_alu_result;
    wire last_alu_enabled;
    wire [3:0] changed_reg;
    wire last_mem_write;
    wire [15:0] last_mem_address;
    wire [7:0] last_mem_data;
    wire [15:0] r0,r1,r2,r3,r4,r5,r6,r7;
    reg [4095:0] memfile;
    reg [4095:0] inputfile;
    reg [7:0] stdin_bytes[0:4095];
    integer stdin_len=0, stdin_pos=0;
    wire [7:0] io_input_byte;
    wire io_input_valid;
    wire io_read_strobe,io_write_strobe,io_exit_strobe;
    wire [7:0] io_write_data;
    wire [15:0] io_exit_code;
    assign io_input_valid=(stdin_pos < stdin_len);
    assign io_input_byte=io_input_valid ? stdin_bytes[stdin_pos] : 8'hff;
    integer tmp, maxcycles, n;

    wa824_ram ram(.clk(clk),.address(mem_address),.read_data(mem_read_data),
        .write_enable(mem_write_enable),.write_data(mem_write_data));
    wa824_core dut(.clk(clk),.rst(rst),.origin(origin),.image_end(image_end),
        .pc(pc),.halted(halted),.fault(fault),
        .io_input_byte(io_input_byte),.io_input_valid(io_input_valid),
        .io_read_strobe(io_read_strobe),.io_write_strobe(io_write_strobe),
        .io_write_data(io_write_data),.io_exit_strobe(io_exit_strobe),
        .io_exit_code(io_exit_code),.mem_address(mem_address),
        .mem_read_data(mem_read_data),.mem_write_enable(mem_write_enable),
        .mem_write_data(mem_write_data),.instruction(instruction),.last_phase(last_phase),
        .last_alu_a(last_alu_a),.last_alu_b(last_alu_b),.last_alu_result(last_alu_result),
        .last_alu_enabled(last_alu_enabled),.changed_reg(changed_reg),
        .last_mem_write(last_mem_write),.last_mem_address(last_mem_address),
        .last_mem_data(last_mem_data),.dbg_r0(r0),.dbg_r1(r1),.dbg_r2(r2),
        .dbg_r3(r3),.dbg_r4(r4),.dbg_r5(r5),.dbg_r6(r6),.dbg_r7(r7));

    always @(posedge clk) begin
        if (!rst) begin
            if (io_write_strobe) $display("IO_PUT %0d",io_write_data);
            if (io_exit_strobe) $display("IO_EXIT %0d",io_exit_code);
            if (io_read_strobe && io_input_valid) stdin_pos <= stdin_pos+1;
        end
    end

    task trace;
        input integer event_phase;
        begin
            $display("TRACE %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d %0d",
                event_phase,pc,halted,instruction,last_alu_a,last_alu_b,
                last_alu_result,last_alu_enabled,changed_reg,last_mem_write,
                last_mem_address,last_mem_data,fault,
                r0,r1,r2,r3,r4,r5,r6,r7);
        end
    endtask

    initial begin
        if (!$value$plusargs("MEMFILE=%s",memfile)) $fatal(1,"Missing +MEMFILE");
        if (!$value$plusargs("ORIGIN=%d",tmp)) $fatal(1,"Missing +ORIGIN");
        origin=tmp;
        if (!$value$plusargs("END=%d",tmp)) $fatal(1,"Missing +END");
        image_end=tmp;
        if (!$value$plusargs("MAXCYCLES=%d",maxcycles)) maxcycles=6000;
        $readmemh(memfile,ram.bytes);
        if (!$value$plusargs("STDINLEN=%d",stdin_len)) stdin_len=0;
        if (stdin_len<0 || stdin_len>4096) $fatal(1,"Bad stdin length");
        if (stdin_len>0) begin
            if (!$value$plusargs("STDINFILE=%s",inputfile)) $fatal(1,"Missing STDINFILE");
            $readmemh(inputfile,stdin_bytes,0,stdin_len-1);
        end
        @(posedge clk);
        @(negedge clk);
        #1 rst=0;
        trace(6); // READY: initial state, before a CPU edge
        for (n=0;n<maxcycles;n=n+1) begin
            @(posedge clk);
            #1 trace(last_phase);
            if (halted) begin
                if (fault) $display("RTL_FAULT %0d %0d",pc,instruction);
                $finish;
            end
        end
        $display("RTL_TIMEOUT %0d",maxcycles);
        $finish;
    end
endmodule
