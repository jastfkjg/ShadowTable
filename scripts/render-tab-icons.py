"""Render the two simple navigation line icons as antialiased PNGs for native tabBar."""
import math, struct, zlib
from pathlib import Path

def distance(x,y,a,b):
    dx,dy=b[0]-a[0],b[1]-a[1]
    t=max(0,min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)))
    return math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)

def render(name,color):
    lines=([(6,5),(18,5),(18,21),(6,21),(6,5)],[(9,5),(9,2),(21,2),(21,17),(18,17)],[(10,10),(14,10)],[(10,15),(13,15)]) if name=='table' else ()
    rows=[]
    for py in range(64):
        row=bytearray([0])
        for px in range(64):
            hit=0
            for sy in range(4):
                for sx in range(4):
                    x,y=(px+(sx+.5)/4)*24/64,(py+(sy+.5)/4)*24/64
                    if name=='table':
                        on=any(distance(x,y,a,b)<.85 for path in lines for a,b in zip(path,path[1:]))
                    else:
                        on=abs(math.hypot(x-12,y-7)-4)<.85 or (y>=17 and y<=21 and (abs(x-4)<.85 or abs(x-20)<.85)) or (y<=17 and y>=10.5 and abs(math.hypot(x-12,y-18)-8)<.85)
                    hit+=on
            row.extend((*color,round(hit*255/16)))
        rows.append(row)
    def chunk(t,data):return struct.pack('!I',len(data))+t+data+struct.pack('!I',zlib.crc32(t+data))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('!2I5B',64,64,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b''.join(rows)))+chunk(b'IEND',b'')
root=Path(__file__).resolve().parents[1]/'miniprogram/assets'
for name in ['table','me']:
    for suffix,color in [('',(177,191,198)),('-active',(229,198,139))]:
        (root/f'tab-{name}{suffix}.png').write_bytes(render(name,color))
