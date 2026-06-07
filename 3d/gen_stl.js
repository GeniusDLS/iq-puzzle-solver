// Generate binary STL files for the board and all pieces — no deps, no OpenSCAD.
// Pieces = overlapping closed spheres + neck cylinders (slicers union them).
// Board  = mould enclosing the full 5x10 x 2-layer ball template (gap clearance),
//          meshed by greedy voxel-surface extraction (slicer-friendly).
const fs = require('fs');
const path = require('path');

// ---- params (keep in sync with iq_puzzle.scad) ----  ball diameter = 10 mm (1 cm)
const ball_d=10, pitch=10, vlayer=10, neck_ratio=0.45;
// board = a mould enclosing the full 5x10 x 2-layer ball template (gap clearance);
// the upper ball layer protrudes half a diameter for easy insert/remove.
const gap=0.4, wall=3, floor=3, push_d=5;   // push_d: bottom push-out hole under each ball
const VOX=0.4;   // voxel size for the board mesh (smaller = smoother, bigger file)
const ROWS=5, COLS=10;
const SEG=18;           // sphere/cylinder tessellation

const pieces = {
  A:[[0,0,0],[0,0,1],[1,0,0],[1,0,1],[2,0,1],[3,0,1],[3,1,1]],
  B:[[0,0,1],[1,0,0],[1,0,1],[1,1,0],[1,1,1],[2,0,1],[3,0,0],[3,0,1]],
  C:[[0,0,1],[0,1,1],[1,0,0],[1,0,1],[1,1,0],[1,1,1],[2,0,1],[3,0,1]],
  D:[[0,0,0],[0,0,1],[0,1,0],[0,1,1],[1,0,1],[2,0,1],[3,0,0],[3,0,1]],
  E:[[0,0,0],[0,0,1],[0,1,0],[0,1,1],[1,0,1],[2,0,0],[2,0,1],[3,0,1]],
  F:[[2,0,0],[2,0,1],[2,1,0],[2,1,1],[0,1,0],[1,1,0],[1,1,1],[3,1,0]],
  G:[[0,0,0],[0,0,1],[1,0,1],[1,1,1],[2,0,1],[2,1,1]],
  H:[[0,0,1],[0,1,1],[1,0,0],[1,0,1],[2,0,1],[2,1,1]],
  I:[[0,0,0],[0,0,1],[0,1,0],[0,1,1],[2,0,0],[2,1,0],[1,1,0]],
  J:[[0,0,1],[0,1,1],[1,0,0],[1,0,1],[1,1,0],[1,1,1],[2,0,1]],
};
const ballPos = (b) => [ b[0]*pitch, -b[1]*pitch, ball_d/2 + b[2]*vlayer ];
const adjacent = (a,b) => (Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]))===1;

// ---- geometry -> triangle list ([ [x,y,z]x3 ]) ----
function addSphere(tris,c,r,seg=SEG){
  const v=(i,j)=>{ const th=Math.PI*i/seg, ph=2*Math.PI*j/seg;
    return [c[0]+r*Math.sin(th)*Math.cos(ph), c[1]+r*Math.sin(th)*Math.sin(ph), c[2]+r*Math.cos(th)]; };
  for(let i=0;i<seg;i++) for(let j=0;j<seg;j++){
    const a=v(i,j),b=v(i+1,j),d=v(i+1,j+1),e=v(i,j+1);
    tris.push([a,b,d]); tris.push([a,d,e]);
  }
}
function addCylinder(tris,p0,p1,r,seg=SEG){
  const ax=[p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2]];
  const L=Math.hypot(...ax); const u=[ax[0]/L,ax[1]/L,ax[2]/L];
  let t=Math.abs(u[0])<0.9?[1,0,0]:[0,1,0];
  const n1=norm(cross(u,t)), n2=cross(u,n1);
  const ring=(p,j)=>{ const a=2*Math.PI*j/seg; return [p[0]+r*(Math.cos(a)*n1[0]+Math.sin(a)*n2[0]),
    p[1]+r*(Math.cos(a)*n1[1]+Math.sin(a)*n2[1]), p[2]+r*(Math.cos(a)*n1[2]+Math.sin(a)*n2[2])]; };
  for(let j=0;j<seg;j++){ const a=ring(p0,j),b=ring(p0,j+1),c=ring(p1,j+1),d=ring(p1,j);
    tris.push([a,b,c]); tris.push([a,c,d]);
    tris.push([p0,b,a]); tris.push([p1,d,c]);            // end caps
  }
}
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(v)=>{const L=Math.hypot(...v)||1;return [v[0]/L,v[1]/L,v[2]/L];};

function pieceTris(balls){
  const tris=[]; const r=ball_d/2, nr=ball_d*neck_ratio/2;
  for(const b of balls) addSphere(tris, ballPos(b), r);
  for(let i=0;i<balls.length;i++) for(let j=i+1;j<balls.length;j++)
    if(adjacent(balls[i],balls[j])) addCylinder(tris, ballPos(balls[i]), ballPos(balls[j]), nr);
  // drop to z=0
  let minz=Infinity; for(const t of tris) for(const v of t) if(v[2]<minz) minz=v[2];
  for(const t of tris) for(const v of t) v[2]-=minz;
  return tris;
}

function boardTris(){
  // Mould enclosing the full 5x10 x 2-layer ball template (spheres + necks in
  // x/y/z) with `gap` clearance; open at the top so the upper balls protrude.
  // Meshed by voxel-surface extraction (robust for arbitrary CSG).
  const R=ball_d/2, cr=R+gap, nr=ball_d*neck_ratio/2+gap, cr2=cr*cr, nr2=nr*nr, push_r2=(push_d/2)**2;
  const z_b=floor+R+gap, z_t=z_b+vlayer, H=z_t;          // top at upper-layer centre
  const zc=l=>z_b+l*vlayer;
  const edge=R+gap+wall;
  const x0=-edge, x1=(COLS-1)*pitch+edge, y0=-(ROWS-1)*pitch-edge, y1=edge;
  // Cavity must be insertable from the top: each grid column is a full-height
  // well (spherical bottom + cylinder up to the open top) and adjacent wells are
  // joined by full-height slots so the piece's necks can slide straight down.
  function inCavity(x,y,z){
    const ci=Math.round(x/pitch), ri=Math.round(-y/pitch);
    for(let dc=-1;dc<=1;dc++) for(let dr=-1;dr<=1;dr++){
      const c=ci+dc, r=ri+dr; if(c<0||c>=COLS||r<0||r>=ROWS) continue;
      const Cx=c*pitch, Cy=-r*pitch, d2=(x-Cx)**2+(y-Cy)**2;
      if(z>=z_b && d2<cr2) return true;                  // well (cylinder up to top)
      if(d2+(z-z_b)**2<cr2) return true;                 // rounded dimple bottom
      if(push_d>0 && z<z_b && d2<push_r2) return true;   // floor push-out hole
      if(z>=z_b){                                        // full-height neck slots
        if(c<COLS-1 && x>Cx && x<Cx+pitch && Math.abs(y-Cy)<nr) return true; // x slot
        if(r<ROWS-1 && y<Cy && y>Cy-pitch && Math.abs(x-Cx)<nr) return true; // y slot
      }
    }
    return false;
  }
  function inside(x,y,z){ if(x<x0||x>x1||y<y0||y>y1||z<0||z>H) return false; return !inCavity(x,y,z); }
  const h=VOX, hh=h/2;
  const nx=Math.ceil((x1-x0)/h)+2, ny=Math.ceil((y1-y0)/h)+2, nz=Math.ceil(H/h)+2;
  const ox=x0-h, oy=y0-h, oz=-h;
  const CX=i=>ox+(i+0.5)*h, CY=j=>oy+(j+0.5)*h, CZ=k=>oz+(k+0.5)*h;
  const field=new Uint8Array(nx*ny*nz), id=(i,j,k)=>(i*ny+j)*nz+k;
  for(let i=0;i<nx;i++)for(let j=0;j<ny;j++)for(let k=0;k<nz;k++) field[id(i,j,k)]=inside(CX(i),CY(j),CZ(k))?1:0;
  const tris=[];
  const dims=[nx,ny,nz], orig=[ox,oy,oz], cell=[0,0,0], nc=[0,0,0];
  // greedy-mesh boundary faces per axis/sign -> far fewer triangles
  for(let axis=0;axis<3;axis++){
    const u=(axis+1)%3, v=(axis+2)%3, W=dims[u], Hd=dims[v];
    for(let sign=-1;sign<=1;sign+=2){
      for(let f=0;f<dims[axis];f++){
        const mask=new Uint8Array(W*Hd);
        for(let a=0;a<W;a++) for(let b=0;b<Hd;b++){
          cell[axis]=f; cell[u]=a; cell[v]=b;
          if(!field[id(cell[0],cell[1],cell[2])]){ mask[a*Hd+b]=0; continue; }
          const nf=f+sign; let nb=0;
          if(nf>=0&&nf<dims[axis]){ nc[axis]=nf; nc[u]=a; nc[v]=b; nb=field[id(nc[0],nc[1],nc[2])]; }
          mask[a*Hd+b]= nb?0:1;
        }
        for(let a=0;a<W;a++) for(let b=0;b<Hd;b++){
          if(!mask[a*Hd+b]) continue;
          let w=1; while(a+w<W && mask[(a+w)*Hd+b]) w++;
          let hgt=1; while(b+hgt<Hd){ let ok=true; for(let k=0;k<w;k++) if(!mask[(a+k)*Hd+(b+hgt)]){ok=false;break;} if(!ok)break; hgt++; }
          for(let dx=0;dx<w;dx++) for(let dy=0;dy<hgt;dy++) mask[(a+dx)*Hd+(b+dy)]=0;
          const FV=orig[axis]+(f+0.5+0.5*sign)*h;
          const U0=orig[u]+a*h, U1=orig[u]+(a+w)*h, V0=orig[v]+b*h, V1=orig[v]+(b+hgt)*h;
          const P=(uu,vv)=>{ const p=[0,0,0]; p[axis]=FV; p[u]=uu; p[v]=vv; return p; };
          const c00=P(U0,V0),c10=P(U1,V0),c11=P(U1,V1),c01=P(U0,V1);
          if(sign>0){ tris.push([c00,c10,c11]); tris.push([c00,c11,c01]); }
          else      { tris.push([c00,c11,c10]); tris.push([c00,c01,c11]); }
        }
      }
    }
  }
  return tris;
}

function writeSTL(file,tris){
  const buf=Buffer.alloc(84+tris.length*50);
  buf.writeUInt32LE(tris.length,80);
  let o=84;
  for(const t of tris){
    const n=norm(cross([t[1][0]-t[0][0],t[1][1]-t[0][1],t[1][2]-t[0][2]],
                        [t[2][0]-t[0][0],t[2][1]-t[0][1],t[2][2]-t[0][2]]));
    buf.writeFloatLE(n[0],o);buf.writeFloatLE(n[1],o+4);buf.writeFloatLE(n[2],o+8);o+=12;
    for(const v of t){ buf.writeFloatLE(v[0],o);buf.writeFloatLE(v[1],o+4);buf.writeFloatLE(v[2],o+8);o+=12; }
    o+=2;
  }
  fs.writeFileSync(file,buf);
  return tris.length;
}

const out=path.join(__dirname,'stl'); fs.mkdirSync(out,{recursive:true});
let total=0, report=[];
report.push(['board', writeSTL(path.join(out,'board.stl'), boardTris())]);
for(const id in pieces) report.push(['piece_'+id, writeSTL(path.join(out,'piece_'+id+'.stl'), pieceTris(pieces[id]))]);
for(const [n,t] of report){ total+=t; console.log(n.padEnd(10), t, 'tris'); }
console.log('TOTAL', total, 'triangles');
