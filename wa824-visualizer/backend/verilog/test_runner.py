"""Runner schema tests without Icarus. RTL execution tests are in tests/rtl-compare.test.js."""
import hashlib
import importlib.util
import unittest
from pathlib import Path

p=Path(__file__).with_name('runner.py')
spec=importlib.util.spec_from_file_location('wa824_runner',p)
runner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class TestTraceContract(unittest.TestCase):
    def test_initial_snapshot_is_actual_machine_state(self):
        # READY 0 0 IR=0 alu..., 8 word regs, changed_reg=no-write
        values=[6,0,0,0,0,0,0,0,15,0,0,0,0,0,0,0,0,0,0,0,0]
        snap,fault=runner.snapshot(values,0,[0x12,0x03,0],0)
        self.assertFalse(fault)
        self.assertEqual(snap['registers'],[0]*8)
        self.assertEqual(snap['instruction']['display'],'ADDI x1l, x0l, 3')
        self.assertEqual(snap['phase'],'READY')
        self.assertEqual(snap['instructionCount'],1)

    def test_rtl_commit_state_is_read_from_trace(self):
        values=[5,3,1,0x130312,3,5,8,1,1,0,0,0,0,0,0x0503,0,0,0,0,0,0]
        snap,fault=runner.snapshot(values,0,[0x12,0x03,0],6)
        self.assertFalse(fault)
        self.assertEqual(snap['registers'][1],0x0503)
        self.assertEqual(snap['pc'],3)
        self.assertTrue(snap['halted'])
        self.assertEqual(snap['changedRegister'],1)

    def test_invalid_trace_width(self):
        with self.assertRaises(RuntimeError):runner.snapshot([0,0],0,[0,0,0],0)

    def test_hash_byte_order(self):
        self.assertEqual(hashlib.sha256(bytes([0x12,0x03,0])).hexdigest(),
                         'b03189d6e8fc9976ee83fc94b1943a9233c7004539744b3828d0b689620e576c')


if __name__=='__main__':unittest.main()
