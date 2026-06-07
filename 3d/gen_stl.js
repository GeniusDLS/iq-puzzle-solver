// Generate binary STL files for the board and all pieces — no deps, no OpenSCAD.
// Pieces = overlapping closed spheres + neck cylinders (slicers union them).
// Board  = watertight slab with spherical dimples (heightfield top + walls + bottom).
const fs = require('fs');
const path = require('path');

// ---- params (keep in sync with iq_puzzle.scad) ----
const ball_d=14, pitch=14, vlayer=14, neck_ratio=0.62;
const socket_d=12, socket_depth=3, board_under=4, board_margin=6;
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
  const tris=[]; const R=socket_d/2, top=board_under+socket_depth;
  const centers=[]; for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++) centers.push([c*pitch,-r*pitch]);
  const edge=R+board_margin;
  const x0=-edge, x1=(COLS-1)*pitch+edge, y0=-(ROWS-1)*pitch-edge, y1=edge;
  const step=1.0;
  const nx=Math.ceil((x1-x0)/step), ny=Math.ceil((y1-y0)/step);
  const zc=top+(R-socket_depth);
  const Z=(x,y)=>{ let z=top; for(const [cx,cy] of centers){ const d2=(x-cx)**2+(y-cy)**2;
    if(d2<R*R){ const zz=zc-Math.sqrt(R*R-d2); if(zz<z) z=zz; } } return z; };
  const X=i=>x0+(x1-x0)*i/nx, Y=j=>y0+(y1-y0)*j/ny;
  // top surface
  for(let i=0;i<nx;i++)for(let j=0;j<ny;j++){
    const a=[X(i),Y(j),Z(X(i),Y(j))], b=[X(i+1),Y(j),Z(X(i+1),Y(j))],
          c=[X(i+1),Y(j+1),Z(X(i+1),Y(j+1))], d=[X(i),Y(j+1),Z(X(i),Y(j+1))];
    tris.push([a,b,c]); tris.push([a,c,d]);
  }
  // bottom (flat)
  const A=[x0,y0,0],B=[x1,y0,0],C=[x1,y1,0],D=[x0,y1,0];
  tris.push([A,C,B]); tris.push([A,D,C]);
  // walls
  for(let i=0;i<nx;i++){ // front/back (y0,y1)
    const xa=X(i),xb=X(i+1);
    tris.push([[xa,y0,0],[xb,y0,0],[xb,y0,Z(xb,y0)]]); tris.push([[xa,y0,0],[xb,y0,Z(xb,y0)],[xa,y0,Z(xa,y0)]]);
    tris.push([[xa,y1,0],[xb,y1,Z(xb,y1)],[xb,y1,0]]); tris.push([[xa,y1,0],[xa,y1,Z(xa,y1)],[xb,y1,Z(xb,y1)]]);
  }
  for(let j=0;j<ny;j++){ // left/right (x0,x1)
    const ya=Y(j),yb=Y(j+1);
    tris.push([[x0,ya,0],[x0,yb,Z(x0,yb)],[x0,yb,0]]); tris.push([[x0,ya,0],[x0,ya,Z(x0,ya)],[x0,yb,Z(x0,yb)]]);
    tris.push([[x1,ya,0],[x1,yb,0],[x1,yb,Z(x1,yb)]]); tris.push([[x1,ya,0],[x1,yb,Z(x1,yb)],[x1,ya,Z(x1,ya)]]);
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
