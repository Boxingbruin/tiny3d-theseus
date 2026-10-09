// Execute linked producers with controlled DP register reads. rsp-wasm has no
// RDP engine: this validates ownership ordering, not silicon timing.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Ucode, TRI_SIZE, writeScreenVertex} from './harness.mjs';

const BASE = 0x8000, OLD = 0x100000;
function dpReads(u, start, status) {
  // Substitute only mfc0 DP_START/DP_STATUS. Branches, DMA, rotation and
  // primitive assembly remain as linked by the target build.
  const statusReads=[];
  for (let pc = 0; pc < u.elf.bytes('.text').length; pc += 4) {
    const op = u.rsp.IMEM.getUint32(pc, true);
    if ((op >>> 21) !== (0x40000000 >>> 21)) continue;
    const rd = (op >>> 11) & 31, rt = (op >>> 16) & 31;
    if (rd !== 8 && rd !== 11) continue;
    if (rd===11) statusReads.push([pc,rt]);
    const value = rd === 8 ? start : status;
    assert.ok(value < 65536);
    u.rsp.IMEM.setUint32(pc, (0x34000000 | rt << 16 | value) >>> 0, true);
  }
  return () => statusReads.forEach(([pc,rt]) => u.rsp.IMEM.setUint32(pc,(0x34000000 | rt << 16) >>> 0,true));
}
function waitSymbol(u) { return u.sym.RSPQ_RdpReserveWait ? "RSPQ_RdpReserveWait" : "RSPQCmd_RdpSetBuffer_RdpWait"; }
function setup(u) {
  u.reset();
  u.w32(u.sym.RDPQ_DYNAMIC_BUFFERS, OLD);
  u.w32(u.sym.RDPQ_DYNAMIC_BUFFERS + 4, BASE);
  u.w32(u.sym.RDPQ_CURRENT, OLD);
  u.w32(u.sym.RDPQ_SENTINEL, 0);
  u.w8(u.sym.RDPQ_SYNCFULL_ONGOING, 0);
  u.w8(u.sym.RDPQ_TARGET_BITDEPTH, 2);
  for (let i = 0; i < 176; ++i) u.rdw8(BASE + i, 0xA5);
}

for (const [reason, status, sync] of [['FIFO full', 512, 0], ['SYNC_FULL busy', 64, 64], ['same-buffer DMA busy', 256, 0]]) {
  test(`triangle rollover leaves output untouched while ${reason}`, async () => {
    const u = await Ucode.load(); setup(u);
    u.w8(u.sym.RDPQ_SYNCFULL_ONGOING, sync);
    const release = dpReads(u, status === 256 ? BASE : 0, status);
    const vb = u.sym.VERT_BUFFER;
    u.w32(u.sym.TRI_COMMAND, 0xCF00);
    u.w16(u.sym.RDPQ_TRI_BUFF_OFFSET, 0);
    [{x:10,y:10,z:4096,rgba:0xFF0000FF,s:0,t:0,w:2},
     {x:100,y:20,z:12288,rgba:0x00FF00FF,s:32,t:0,w:4},
     {x:50,y:90,z:20480,rgba:0x0000FFFF,s:0,t:32,w:8}]
      .forEach((v,i) => writeScreenVertex(u, vb+i*TRI_SIZE, v));
    const r = u.call('RDPQ_Triangle_Send_Async', {$a0:vb,$a1:vb+TRI_SIZE,$a2:vb+2*TRI_SIZE,$v0:2}, [waitSymbol(u)]);
    assert.equal(r.pc, u.sym[waitSymbol(u)]);
    u.rsp.fn.rsp_set_halted(0); u.rsp.step(100);
    assert.equal(u.r32(u.sym.RDPQ_CURRENT), OLD);
    assert.ok(Array.from({length:176},(_,i)=>u.rdr8(BASE+i)).every(v=>v===0xA5));
    assert.equal(u.r32(u.sym.RDPQ_DYNAMIC_BUFFERS), BASE);
    release();
    const done = u.runUntil([u.RET_STUB]);
    assert.equal(done.pc, u.RET_STUB);
    assert.equal(u.r32(u.sym.RDPQ_CURRENT), BASE+176);
    assert.equal(u.r32(u.sym.RDPQ_SENTINEL), BASE+65536);
    assert.ok(u.call('RDPQ_Triangle_Send_End').returned);
    assert.equal(u.rdr8(BASE), 0xCF);
    assert.equal(u.r32(u.sym.RDPQ_DYNAMIC_BUFFERS+4), OLD);
  });
}

test('reservation preserves producer registers and vectors', async () => {
  const u=await Ucode.load(); setup(u); dpReads(u,0,0);
  const regs=['$a3','$t4','$t5','$t6','$t7','$s0','$s1','$s2','$s3','$s4','$s5','$s6','$s7'];
  regs.forEach((r,i)=>u.setGpr(r,0xABC000+i));
  u.setVpr('$v10',[1,2,3,4,5,6,7,8]);
  assert.ok(u.call('RSPQ_RdpNextBuffer').returned);
  regs.forEach((r,i)=>assert.equal(u.gpr(r),0xABC000+i,r));
  assert.deepEqual(u.vpr('$v10'),[1,2,3,4,5,6,7,8]);
  assert.equal(u.gpr('$a0'),BASE); assert.equal(u.gpr('$a1'),BASE);
  assert.equal(u.gpr('$a2'),BASE+65536);
  assert.equal(u.r32(u.sym.RDPQ_CURRENT),BASE);
});

for (const [reason,status,sync] of [['FIFO full',512,0],['SYNC_FULL busy',64,64],['same-buffer DMA busy',256,0]]) {
  test(`packet rollover leaves output untouched while ${reason}`, {skip: !process.env.RDPQ_ELF && 'Set RDPQ_ELF to test the SDK packet producer'}, async () => {
    const u=await Ucode.load(process.env.RDPQ_ELF); setup(u);
    u.w8(u.sym.RDPQ_SYNCFULL_ONGOING,sync);
    const release=dpReads(u,status===256 ? BASE : 0,status);
    const src=u.sym.RDPQ_CMD_STAGING ?? u.sym.RSPQ_SCRATCH_MEM;
    u.w32(src,0xE7000000); u.w32(src+4,0);
    const r=u.call('RDPQ_Send',{$s4:src,$s3:src+8},[waitSymbol(u)]);
    assert.equal(r.pc,u.sym[waitSymbol(u)]);
    u.rsp.fn.rsp_set_halted(0); u.rsp.step(100);
    assert.equal(u.r32(u.sym.RDPQ_CURRENT),OLD);
    assert.equal(u.rdr32(BASE),0xA5A5A5A5);
    release();
    assert.equal(u.runUntil([u.RET_STUB]).pc,u.RET_STUB);
    assert.equal(u.r32(u.sym.RDPQ_CURRENT),BASE+8);
    assert.equal(u.rdr32(BASE),0xE7000000);
    assert.equal(u.rdr32(BASE+8),0xA5A5A5A5);
  });
}

for (const [name, words] of [
  ['Packets_Write8', [0xFC123456, 0xFEDCBA98]],
  ['Packets_Write16', [0xE4123456, 0x789ABCDE, 0x0123FEDC, 0x89ABCDEF]],
  ['Packets_Write16', [0xE5123456, 0x789ABCDE, 0xFEDC0123, 0xABCDEF89]],
]) {
  test(`prepared transport preserves ${words[0].toString(16)} and every payload bit`,
    {skip: !process.env.PACKETS_ELF && 'Set PACKETS_ELF to test the Theseus transport'}, async () => {
      const u = await Ucode.load(process.env.PACKETS_ELF); setup(u); dpReads(u, 0, 0);
      // A long command's final argument is read from the queue, beyond a0-a3.
      const size = words.length * 4 + 4;
      words.forEach((word, i) => u.w32(u.sym.RSPQ_DMEM_BUFFER + 4 + i * 4, word));
      const r = u.call(name, {$a0:0x12000000, $a1:words[0], $a2:words[1],
        $a3:words[2] ?? 0, $gp:size}, ['RSPQ_Loop']);
      assert.equal(r.pc, u.sym.RSPQ_Loop);
      words.forEach((word, i) => assert.equal(u.rdr32(BASE + i * 4), word));
      assert.equal(u.rdr32(BASE + words.length * 4), 0xA5A5A5A5);
      assert.equal(u.r32(u.sym.RDPQ_CURRENT), BASE + words.length * 4);
    });
}

for (const word of [0xFC123456, 0xE7000000, 0xFD10003F, 0xFFFFFFFF]) {
  test(`resident prepared word preserves ${word.toString(16)} and geometry state`, async () => {
    const u=await Ucode.load(); setup(u); dpReads(u,0,0);
    u.w32(u.sym.RDPQ_CURRENT,BASE); u.w32(u.sym.RDPQ_SENTINEL,BASE+8);
    const state=u.bytes(u.sym._RSPQ_SAVED_STATE_START,
      u.sym._RSPQ_SAVED_STATE_END-u.sym._RSPQ_SAVED_STATE_START);
    u.setVpr('$v10',[1,2,3,4,5,6,7,8]);
    const result=u.command('Theseus_Prepared8',[0,word,0xFEDCBA98],{$gp:44});
    assert.equal(result.pc,u.sym.RSPQ_Loop);
    assert.equal(u.rdr32(BASE),word); assert.equal(u.rdr32(BASE+4),0xFEDCBA98);
    assert.equal(u.rdr32(BASE+8),0xA5A5A5A5);
    assert.equal(u.r32(u.sym.RDPQ_CURRENT),BASE+8);
    assert.equal(u.gpr('$gp'),44);
    assert.deepEqual(u.vpr('$v10'),[1,2,3,4,5,6,7,8]);
    assert.deepEqual(u.bytes(u.sym._RSPQ_SAVED_STATE_START,state.length),state);
  });
}

for (const [reason,status,sync] of [['FIFO full',512,0],['SYNC_FULL busy',64,64],['same-buffer DMA busy',256,0]]) {
  test(`resident prepared rollover waits before DMA while ${reason}`, async () => {
    const u=await Ucode.load(); setup(u);
    u.w8(u.sym.RDPQ_SYNCFULL_ONGOING,sync);
    const release=dpReads(u,status===256 ? BASE : 0,status);
    const r=u.command('Theseus_Prepared8',[0,0xFC123456,0xFEDCBA98],{},['RSPQCmd_RdpSetBuffer_RdpWait']);
    assert.equal(r.pc,u.sym.RSPQCmd_RdpSetBuffer_RdpWait);
    u.rsp.fn.rsp_set_halted(0); u.rsp.step(100);
    assert.equal(u.r32(u.sym.RDPQ_CURRENT),OLD);
    assert.equal(u.rdr32(BASE),0xA5A5A5A5);
    release(); assert.equal(u.runUntil([u.sym.RSPQ_Loop]).pc,u.sym.RSPQ_Loop);
    assert.equal(u.rdr32(BASE),0xFC123456); assert.equal(u.rdr32(BASE+4),0xFEDCBA98);
    assert.equal(u.rdr32(BASE+8),0xA5A5A5A5);
    assert.equal(u.r32(u.sym.RDPQ_CURRENT),BASE+8);
  });
}
