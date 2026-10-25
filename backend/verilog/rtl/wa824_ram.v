// Simulation RAM with 8-bit data and a 16-bit byte address.
// The program is loaded by the *testbench*, not by the CPU RTL.
module wa824_ram(
    input wire clk,
    input wire [15:0] address,
    output wire [7:0] read_data,
    input wire write_enable,
    input wire [7:0] write_data
);
    reg [7:0] bytes [0:65535];
    assign read_data = bytes[address];
    always @(posedge clk) if (write_enable) bytes[address] <= write_data;
endmodule
