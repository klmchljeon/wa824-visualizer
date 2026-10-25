// WA824 eight-bit arithmetic and logic unit. SL (funct 6) is deliberately
// unsupported because its semantics are not fixed by ISA-DECISIONS.md.
module wa824_alu(
    input wire [3:0] funct,
    input wire [7:0] a,
    input wire [7:0] b,
    output reg [7:0] result,
    output reg valid
);
    always @* begin
        result = 8'h00;
        valid = 1'b1;
        case (funct)
            4'h0: result = a + b;
            4'h1: result = a - b;
            4'h2: result = a & b;
            4'h3: result = a | b;
            4'h4: result = a ^ b;
            4'h5: result = a << b[2:0];
            4'h7: result = $signed(a) >>> b[2:0];
            4'h8: result = ($signed(a) < $signed(b)) ? 8'd1 : 8'd0;
            4'h9: result = (a < b) ? 8'd1 : 8'd0;
            default: valid = 1'b0;
        endcase
    end
endmodule
