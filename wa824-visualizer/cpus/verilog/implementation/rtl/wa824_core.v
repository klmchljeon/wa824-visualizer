// WA824 multicycle CPU. One RTL rising clock edge = one of
// FETCH0/FETCH1/FETCH2/DECODE/EXECUTE/COMMIT. Fetches from 8-bit memory.
// Instructions: 24 bits, little-endian byte order, normal PC += 3.
// ECALL services 1/2/5 are simulator ABI v1; MRET/SL remain unsupported.
module wa824_core(
    input wire clk,
    input wire rst,
    input wire [15:0] origin,
    input wire [16:0] image_end,
    input wire [7:0] io_input_byte,
    input wire io_input_valid,
    output wire io_read_strobe,
    output wire io_write_strobe,
    output wire [7:0] io_write_data,
    output wire io_exit_strobe,
    output wire [15:0] io_exit_code,
    output reg [15:0] pc,
    output reg halted,
    output reg fault,
    output wire [15:0] mem_address,
    input wire [7:0] mem_read_data,
    output wire mem_write_enable,
    output wire [7:0] mem_write_data,
    output wire [23:0] instruction,
    output reg [2:0] last_phase,
    output reg [7:0] last_alu_a,
    output reg [7:0] last_alu_b,
    output reg [7:0] last_alu_result,
    output reg last_alu_enabled,
    output reg [3:0] changed_reg,
    output reg last_mem_write,
    output reg [15:0] last_mem_address,
    output reg [7:0] last_mem_data,
    output wire [15:0] dbg_r0, dbg_r1, dbg_r2, dbg_r3,
    output wire [15:0] dbg_r4, dbg_r5, dbg_r6, dbg_r7
);
    localparam FETCH0=3'd0, FETCH1=3'd1, FETCH2=3'd2,
               DECODE=3'd3, EXECUTE=3'd4, COMMIT=3'd5;
    reg [2:0] phase;
    reg [23:0] ir;
    assign instruction=ir;

    wire [3:0] opcode=ir[7:4], rd=ir[3:0], funct=ir[19:16];
    wire [3:0] rs1=ir[15:12], rs2=ir[11:8];
    wire [7:0] imm8={ir[23:20],ir[11:8]};
    wire [11:0] imm12_ls={ir[23:16],ir[11:8]};
    wire [11:0] imm12_jrp={ir[23:20],ir[15:8]};
    wire [15:0] imm16=ir[23:8];
    wire [3:0] byte_addr_a=(opcode==4'h8) ? 4'd2 : (opcode==4'h3) ? rd : rs1;
    wire [3:0] byte_addr_b=(opcode==4'h8) ? 4'd4 : (opcode==4'h4) ? rd : rs2;
    wire [2:0] word_addr=(opcode==4'h8) ? 3'd2 : (opcode==4'h7) ? ir[19:17] : ir[15:13];
    wire [7:0] ba, bb;
    wire [15:0] wbase;
    wire [7:0] alu_operand_b=(opcode==4'h1) ? imm8 : bb;
    wire [7:0] alu_out;
    wire alu_valid;
    wa824_alu alu(.funct(funct),.a(ba),.b(alu_operand_b),.result(alu_out),.valid(alu_valid));

    reg pending_reg_we, pending_reg_word;
    reg [3:0] pending_reg_dest;
    reg [15:0] pending_reg_data;
    reg pending_store;
    reg [15:0] pending_addr;
    reg [7:0] pending_store_data;
    reg [15:0] pending_next_pc;
    reg pending_halt, pending_fault;
    reg pending_io_get, pending_io_put, pending_io_exit;
    reg [7:0] pending_io_put_data;
    reg [15:0] pending_io_exit_code;
    assign io_read_strobe=commit_active && pending_io_get && !pending_fault;
    assign io_write_strobe=commit_active && pending_io_put && !pending_fault;
    assign io_write_data=pending_io_put_data;
    assign io_exit_strobe=commit_active && pending_io_exit && !pending_fault;
    assign io_exit_code=pending_io_exit_code;
    wire commit_active = (phase==COMMIT) && !halted;
    wire rf_write = commit_active && pending_reg_we && !pending_fault;
    wa824_register_file rf(
        .clk(clk),.rst(rst),.byte_addr_a(byte_addr_a),.byte_addr_b(byte_addr_b),
        .word_addr(word_addr),.byte_a(ba),.byte_b(bb),.word_value(wbase),
        .write_enable(rf_write),.write_word(pending_reg_word),
        .write_addr(pending_reg_dest),.write_value(pending_reg_data),
        .dbg_r0(dbg_r0),.dbg_r1(dbg_r1),.dbg_r2(dbg_r2),.dbg_r3(dbg_r3),
        .dbg_r4(dbg_r4),.dbg_r5(dbg_r5),.dbg_r6(dbg_r6),.dbg_r7(dbg_r7)
    );

    wire [15:0] effective_address=wbase + {{4{imm12_ls[11]}},imm12_ls};
    assign mem_address=(phase==FETCH1) ? pc + 16'd1 :
                       (phase==FETCH2) ? pc + 16'd2 :
                       (phase==EXECUTE && opcode==4'h2) ? effective_address :
                       (phase==COMMIT && pending_store) ? pending_addr : pc;
    assign mem_write_enable=commit_active && pending_store && !pending_fault;
    assign mem_write_data=pending_store_data;
    wire branch_taken=(funct==4'd0) ? (ba==bb) :
                      (funct==4'd1) ? (ba!=bb) :
                      (funct==4'd2) ? ($signed(ba)<$signed(bb)) :
                      (funct==4'd3) ? (ba<bb) : 1'b0;

    always @(posedge clk) begin
        if (rst) begin
            pc <= origin;
            halted <= 1'b0; fault <= 1'b0;
            phase <= FETCH0; ir <= 24'd0;
            last_phase <= 3'd6; changed_reg <= 4'd15;
            last_alu_a <= 0; last_alu_b <= 0; last_alu_result <= 0;
            last_alu_enabled <= 0;
            last_mem_write <= 0; last_mem_address <= 0; last_mem_data <= 0;
            pending_reg_we <= 0;pending_reg_word <= 0;pending_reg_dest <= 0;
            pending_reg_data <= 0;pending_store <= 0;pending_addr <= 0;
            pending_store_data <= 0;pending_next_pc <= 0;
            pending_halt <= 0;pending_fault <= 0;
            pending_io_get <= 0;pending_io_put <= 0;pending_io_exit <= 0;
            pending_io_put_data <= 0;pending_io_exit_code <= 0;
        end else if (!halted) begin
            last_phase <= phase;
            changed_reg <= 4'd15;
            last_mem_write <= 1'b0;
            case (phase)
                FETCH0: begin ir[7:0] <= mem_read_data; phase <= FETCH1; end
                FETCH1: begin ir[15:8] <= mem_read_data; phase <= FETCH2; end
                FETCH2: begin ir[23:16] <= mem_read_data; phase <= DECODE; end
                DECODE: phase <= EXECUTE;
                EXECUTE: begin
                    pending_next_pc <= pc + 16'd3;
                    pending_reg_we <= 0;
                    pending_reg_word <= 0;
                    pending_reg_dest <= rd;
                    pending_reg_data <= 0;
                    pending_store <= 0;
                    pending_addr <= 0;
                    pending_store_data <= 0;
                    pending_halt <= 0;
                    pending_fault <= 0;
                    pending_io_get <= 0;pending_io_put <= 0;pending_io_exit <= 0;
                    last_alu_enabled <= 0;
                    case (opcode)
                        4'h0,4'h1: begin
                            if ((opcode==4'h0 && ir[23:20]!=0) ||
                                (opcode==4'h1 && funct==4'h1) || !alu_valid) begin
                                pending_fault <= 1;
                            end else begin
                                pending_reg_we <= 1;
                                pending_reg_data <= {8'd0,alu_out};
                                last_alu_a <= ba;
                                last_alu_b <= alu_operand_b;
                                last_alu_result <= alu_out;
                                last_alu_enabled <= 1;
                            end
                        end
                        4'h2,4'h3: begin
                            if (ir[12]) pending_fault <= 1;
                            else if (opcode==4'h2) begin
                                pending_reg_we <= 1;
                                pending_reg_data <= {8'd0,mem_read_data};
                            end else begin
                                pending_store <= 1;
                                pending_addr <= effective_address;
                                pending_store_data <= ba;
                            end
                        end
                        4'h4: begin
                            if (funct>4'h3) pending_fault <= 1;
                            else if (branch_taken) pending_next_pc <= pc + {{8{imm8[7]}},imm8};
                        end
                        4'h5,4'h6: begin
                            if (ir[0]) pending_fault <= 1;
                            else begin
                                pending_next_pc <= opcode==4'h5 ? imm16 : pc + imm16;
                                pending_reg_we <= 1;
                                pending_reg_word <= 1;
                                pending_reg_dest <= {1'b0,ir[3:1]};
                                pending_reg_data <= pc + 16'd3;
                            end
                        end
                        4'h7: begin
                            if (ir[16] || ir[0]) pending_fault <= 1;
                            else begin
                                pending_next_pc <= wbase + {{4{imm12_jrp[11]}},imm12_jrp};
                                pending_reg_we <= 1;
                                pending_reg_word <= 1;
                                pending_reg_dest <= {1'b0,ir[3:1]};
                                pending_reg_data <= pc + 16'd3;
                            end
                        end
                        4'h8: begin
                            if (ir[23:20]!=0 || ir[15:8]!=0 || ir[3:0]!=0) pending_fault <= 1;
                            else if (funct==4'h1) pending_halt <= 1; // EBRAKE
                            else if (funct==4'h0) begin // ECALL ABI v1
                                case(ba)
                                    8'd1: begin // write character in x2l
                                        pending_io_put <= 1;
                                        pending_io_put_data <= bb;
                                    end
                                    8'd2: begin // getchar -> Wx2 0..255, or 0xffff at EOF
                                        pending_io_get <= 1;
                                        pending_reg_we <= 1;
                                        pending_reg_word <= 1;
                                        pending_reg_dest <= 4'd2;
                                        pending_reg_data <= io_input_valid ? {8'd0,io_input_byte} : 16'hffff;
                                    end
                                    8'd5: begin // exit with Wx2
                                        pending_io_exit <= 1;
                                        pending_io_exit_code <= wbase;
                                        pending_halt <= 1;
                                    end
                                    default: pending_fault <= 1;
                                endcase
                            end else pending_fault <= 1; // MRET unsupported
                        end
                        default: pending_fault <= 1;
                    endcase
                    phase <= COMMIT;
                end
                COMMIT: begin
                    if (pending_reg_we && !pending_fault) begin
                        if (pending_reg_word) begin
                            if (pending_reg_dest[2:0] != 0) changed_reg <= {1'b0,pending_reg_dest[2:0]};
                        end else if(pending_reg_dest[3:1] != 0)
                            changed_reg <= {1'b0,pending_reg_dest[3:1]};
                    end
                    if (pending_store && !pending_fault) begin
                        last_mem_write <= 1;
                        last_mem_address <= pending_addr;
                        last_mem_data <= pending_store_data;
                    end
                    pc <= pending_next_pc;
                    fault <= pending_fault;
                    if (pending_fault || pending_halt ||
                        pending_next_pc < origin ||
                        ({1'b0,pending_next_pc}+17'd2) >= image_end) halted <= 1'b1;
                    phase <= FETCH0;
                end
                default: begin fault <= 1'b1; halted <= 1'b1; end
            endcase
        end
    end
endmodule
