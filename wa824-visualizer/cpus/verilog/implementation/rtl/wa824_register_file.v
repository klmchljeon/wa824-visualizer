// Two independently addressed byte read ports, one 16-bit word read port,
// one write port (byte or word). x0 is hardwired zero in both views.
module wa824_register_file(
    input wire clk,
    input wire rst,
    input wire [3:0] byte_addr_a,
    input wire [3:0] byte_addr_b,
    input wire [2:0] word_addr,
    output wire [7:0] byte_a,
    output wire [7:0] byte_b,
    output wire [15:0] word_value,
    input wire write_enable,
    input wire write_word,
    input wire [3:0] write_addr,
    input wire [15:0] write_value,
    output wire [15:0] dbg_r0, dbg_r1, dbg_r2, dbg_r3,
    output wire [15:0] dbg_r4, dbg_r5, dbg_r6, dbg_r7
);
    reg [15:0] regs [0:7];
    integer i;
    assign byte_a = byte_addr_a[3:1] == 0 ? 8'd0 :
                    (byte_addr_a[0] ? regs[byte_addr_a[3:1]][15:8] : regs[byte_addr_a[3:1]][7:0]);
    assign byte_b = byte_addr_b[3:1] == 0 ? 8'd0 :
                    (byte_addr_b[0] ? regs[byte_addr_b[3:1]][15:8] : regs[byte_addr_b[3:1]][7:0]);
    assign word_value = word_addr == 0 ? 16'd0 : regs[word_addr];
    assign dbg_r0 = 16'd0;
    assign dbg_r1 = regs[1]; assign dbg_r2 = regs[2]; assign dbg_r3 = regs[3];
    assign dbg_r4 = regs[4]; assign dbg_r5 = regs[5]; assign dbg_r6 = regs[6]; assign dbg_r7 = regs[7];

    always @(posedge clk) begin
        if (rst) begin
            for (i = 0; i < 8; i = i + 1) regs[i] <= 16'd0;
        end else if (write_enable) begin
            if (write_word) begin
                if (write_addr[2:0] != 0) regs[write_addr[2:0]] <= write_value;
            end else if (write_addr[3:1] != 0) begin
                if (write_addr[0]) regs[write_addr[3:1]][15:8] <= write_value[7:0];
                else regs[write_addr[3:1]][7:0] <= write_value[7:0];
            end
        end
    end
endmodule
