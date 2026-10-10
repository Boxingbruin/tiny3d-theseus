from pathlib import Path
import struct
p=Path("filesystem");p.mkdir(exist_ok=True)
def write(name,words): (p/name).write_bytes(struct.pack(">"+"H"*len(words),*words))
write("delayed.bin",[3,0,10,0,3,0,20])
write("zero.bin",[0,0,10,0,3,0,20])
write("quat.bin",[0x8003,0,0xdff7,0xfdff,0x8003,0,0xdff7,0xfdff])
write("long.bin",[0,0,10,0]+[v for i in range(1,62) for v in (1,0,10+i)])
