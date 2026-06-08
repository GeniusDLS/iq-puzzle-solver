// Generate binary STL files for the board and all pieces — no deps, no OpenSCAD.
// Pieces = overlapping closed spheres + neck cylinders (slicers union them).
// Board  = mould enclosing the full 5x10 x 2-layer ball template (gap clearance),
//          meshed smoothly via Surface Nets over an analytic SDF.
const fs = require('fs');
const path = require('path');

// ---- params (keep in sync with iq_puzzle.scad) ----  ball diameter = 10 mm (1 cm)
const ball_d=10, pitch=10, vlayer=10, neck_ratio=0.45;
// board = a mould enclosing the full 5x10 x 2-layer ball template (gap clearance);
// the upper ball layer protrudes half a diameter for easy insert/remove.
const gap=0.4, wall=3, floor=3, push_d=5;   // push_d: bottom push-out hole under each ball
const VOX=0.7;   // voxel size for the board mesh (smaller = smoother, bigger file)
const ROWS=5, COLS=10;
const SEG=18;           // sphere/cylinder tessellation

const pieces = {   // hinge model: two flat faces sharing an edge, folded 90deg
  A:[[0,0,0],[0,0,1],[1,0,0],[1,0,1],[2,0,0],[3,0,0],[3,1,0]],
  B:[[0,0,0],[1,0,0],[1,0,1],[1,1,0],[2,0,0],[3,0,0],[3,0,1]],
  C:[[0,0,0],[0,1,0],[1,0,0],[1,0,1],[1,1,0],[2,0,0],[3,0,0]],
  D:[[0,0,0],[0,0,1],[0,1,0],[1,0,0],[2,0,0],[3,0,0],[3,0,1]],
  E:[[0,0,0],[0,0,1],[0,1,0],[1,0,0],[2,0,0],[2,0,1],[3,0,0]],
  F:[[0,0,0],[1,0,0],[1,0,1],[2,0,0],[2,0,1],[2,1,0],[3,0,0]],
  G:[[0,0,0],[0,0,1],[1,0,0],[1,1,0],[2,0,0],[2,1,0]],
  H:[[0,0,0],[0,1,0],[1,0,0],[1,0,1],[2,0,0],[2,1,0]],
  I:[[0,0,0],[0,0,1],[0,1,0],[1,0,0],[2,0,0],[2,1,0]],
  J:[[0,0,0],[0,1,0],[1,0,0],[1,0,1],[1,1,0],[2,0,0]],
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
  // Smooth board via Surface Nets over a signed-distance field (analytic
  // box/cylinder/sphere CSG). Solid = block minus cavity (wells + neck slots +
  // push holes). SDF gives smooth surfaces even on a coarse grid.
  const R=ball_d/2, cr=R+gap, nr=ball_d*neck_ratio/2+gap, push_r=push_d/2;
  const z_b=floor+R+gap, H=z_b+vlayer;
  const edge=R+gap+wall;
  const x0=-edge, x1=(COLS-1)*pitch+edge, y0=-(ROWS-1)*pitch-edge, y1=edge;
  const bcx=(x0+x1)/2, bcy=(y0+y1)/2, hbx=(x1-x0)/2, hby=(y1-y0)/2;
  const sBox=(px,py,pz,ax,ay,az,hx,hy,hz)=>{ const qx=Math.abs(px-ax)-hx,qy=Math.abs(py-ay)-hy,qz=Math.abs(pz-az)-hz;
    return Math.hypot(Math.max(qx,0),Math.max(qy,0),Math.max(qz,0))+Math.min(Math.max(qx,qy,qz),0); };
  const sSph=(px,py,pz,ax,ay,az,r)=>Math.hypot(px-ax,py-ay,pz-az)-r;
  const sCyl=(px,py,pz,ax,ay,z0,z1,r)=>{ const dxy=Math.hypot(px-ax,py-ay)-r, dz=Math.abs(pz-(z0+z1)/2)-(z1-z0)/2;
    return Math.hypot(Math.max(dxy,0),Math.max(dz,0))+Math.min(Math.max(dxy,dz),0); };
  function sdf(x,y,z){
    const block=sBox(x,y,z,bcx,bcy,H/2,hbx,hby,H/2);
    let cav=1e9; const ci=Math.round(x/pitch), ri=Math.round(-y/pitch);
    for(let dc=-1;dc<=1;dc++)for(let dr=-1;dr<=1;dr++){
      const c=ci+dc,r=ri+dr; if(c<0||c>=COLS||r<0||r>=ROWS) continue;
      const Cx=c*pitch, Cy=-r*pitch;
      cav=Math.min(cav, sCyl(x,y,z,Cx,Cy,z_b,H+5,cr));
      cav=Math.min(cav, sSph(x,y,z,Cx,Cy,z_b,cr));
      if(push_d>0) cav=Math.min(cav, sCyl(x,y,z,Cx,Cy,-5,z_b,push_r));
      if(c<COLS-1) cav=Math.min(cav, sBox(x,y,z,Cx+pitch/2,Cy,(z_b+H+5)/2,pitch/2,nr,(H+5-z_b)/2));
      if(r<ROWS-1) cav=Math.min(cav, sBox(x,y,z,Cx,Cy-pitch/2,(z_b+H+5)/2,nr,pitch/2,(H+5-z_b)/2));
    }
    return Math.max(block,-cav);
  }
  const h=VOX, m=2*h, X0=x0-m,Y0=y0-m,Z0=-m, X1=x1+m,Y1=y1+m,Z1=H+m;
  const Nx=Math.ceil((X1-X0)/h),Ny=Math.ceil((Y1-Y0)/h),Nz=Math.ceil((Z1-Z0)/h);
  const gy=Ny+1,gz=Nz+1, VX=i=>X0+i*h,VY=j=>Y0+j*h,VZ=k=>Z0+k*h;
  const f=new Float32Array((Nx+1)*gy*gz), vid=(i,j,k)=>(i*gy+j)*gz+k;
  for(let i=0;i<=Nx;i++)for(let j=0;j<=Ny;j++)for(let k=0;k<=Nz;k++) f[vid(i,j,k)]=sdf(VX(i),VY(j),VZ(k));
  const cellV=new Int32Array(Nx*Ny*Nz).fill(-1), cid=(i,j,k)=>(i*Ny+j)*Nz+k, verts=[];
  const CO=[[0,0,0],[1,0,0],[0,1,0],[1,1,0],[0,0,1],[1,0,1],[0,1,1],[1,1,1]];
  const EDG=[[0,1],[0,2],[0,4],[1,3],[1,5],[2,3],[2,6],[3,7],[4,5],[4,6],[5,7],[6,7]];
  for(let i=0;i<Nx;i++)for(let j=0;j<Ny;j++)for(let k=0;k<Nz;k++){
    const cv=[]; for(const o of CO) cv.push(f[vid(i+o[0],j+o[1],k+o[2])]);
    let neg=0; for(const v of cv) if(v<0) neg++; if(neg===0||neg===8) continue;
    let sx=0,sy=0,sz=0,n=0;
    for(const e of EDG){ const fa=cv[e[0]],fb=cv[e[1]]; if((fa<0)===(fb<0)) continue;
      const t=fa/(fa-fb), A=CO[e[0]],B=CO[e[1]];
      sx+=VX(i+A[0]+t*(B[0]-A[0])); sy+=VY(j+A[1]+t*(B[1]-A[1])); sz+=VZ(k+A[2]+t*(B[2]-A[2])); n++; }
    cellV[cid(i,j,k)]=verts.length; verts.push([sx/n,sy/n,sz/n]);
  }
  const tris=[];
  function quad(a,b,c,d,flip){ if(a<0||b<0||c<0||d<0) return; const A=verts[a],B=verts[b],C=verts[c],D=verts[d];
    if(!flip){ tris.push([A,B,C]); tris.push([A,C,D]); } else { tris.push([A,C,B]); tris.push([A,D,C]); } }
  for(let i=1;i<Nx;i++)for(let j=1;j<Ny;j++)for(let k=0;k<Nz;k++){ const s0=f[vid(i,j,k)]<0,s1=f[vid(i,j,k+1)]<0; if(s0===s1)continue;
    quad(cellV[cid(i-1,j-1,k)],cellV[cid(i,j-1,k)],cellV[cid(i,j,k)],cellV[cid(i-1,j,k)],s0); }
  for(let i=1;i<Nx;i++)for(let j=0;j<Ny;j++)for(let k=1;k<Nz;k++){ const s0=f[vid(i,j,k)]<0,s1=f[vid(i,j+1,k)]<0; if(s0===s1)continue;
    quad(cellV[cid(i-1,j,k-1)],cellV[cid(i,j,k-1)],cellV[cid(i,j,k)],cellV[cid(i-1,j,k)],!s0); }
  for(let i=0;i<Nx;i++)for(let j=1;j<Ny;j++)for(let k=1;k<Nz;k++){ const s0=f[vid(i,j,k)]<0,s1=f[vid(i+1,j,k)]<0; if(s0===s1)continue;
    quad(cellV[cid(i,j-1,k-1)],cellV[cid(i,j,k-1)],cellV[cid(i,j,k)],cellV[cid(i,j-1,k)],s0); }
  // orient every triangle outward (normal along +SDF gradient) — correct shading & slicing
  const eps=h*0.5;
  for(const t of tris){
    const ax=t[1][0]-t[0][0],ay=t[1][1]-t[0][1],az=t[1][2]-t[0][2], bx=t[2][0]-t[0][0],by=t[2][1]-t[0][1],bz=t[2][2]-t[0][2];
    const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
    const cx=(t[0][0]+t[1][0]+t[2][0])/3, cy=(t[0][1]+t[1][1]+t[2][1])/3, cz=(t[0][2]+t[1][2]+t[2][2])/3;
    const gx=sdf(cx+eps,cy,cz)-sdf(cx-eps,cy,cz), gy=sdf(cx,cy+eps,cz)-sdf(cx,cy-eps,cz), gz=sdf(cx,cy,cz+eps)-sdf(cx,cy,cz-eps);
    if(nx*gx+ny*gy+nz*gz<0){ const tmp=t[1]; t[1]=t[2]; t[2]=tmp; }
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
