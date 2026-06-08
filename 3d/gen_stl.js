// Generate binary STL files for the board and all pieces — no deps, no OpenSCAD.
// Units are chamfered cubes (truncated-edge cubes) instead of balls: a flat
// bottom prints far better on an FDM printer than a sphere's point contact.
// Everything is meshed with Surface Nets over an analytic SDF, so pieces come
// out watertight (touching cubes fuse) and the board is a clean tray.
const fs = require('fs');
const path = require('path');

// ---- params (keep in sync with iq_puzzle.scad) ----  cube side = 10 mm (1 cm)
const ball_d=10, pitch=10, vlayer=10;       // cube side, grid spacing, layer height
const cham=2.0;                              // chamfer cut on every cube edge (mm)
// board = a tray hugging the full 5x10 x 2-layer footprint (gap clearance);
// the upper layer protrudes half a cube for easy insert/remove.
const gap=0.4, wall=3, floor=3, push_d=5;   // push_d: bottom push-out hole under each cell
const VOX=0.7;    // voxel size for the board mesh
const VOXP=0.5;   // voxel size for the pieces (finer -> crisper chamfers)
const ROWS=5, COLS=10;
const half=ball_d/2, ACH=ball_d-cham;        // chamfer plane offset: |x|+|y| <= ACH

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

const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(v)=>{const L=Math.hypot(...v)||1;return [v[0]/L,v[1]/L,v[2]/L];};

// ---- SDF primitives ----
const sBox=(px,py,pz,ax,ay,az,hx,hy,hz)=>{ const qx=Math.abs(px-ax)-hx,qy=Math.abs(py-ay)-hy,qz=Math.abs(pz-az)-hz;
  return Math.hypot(Math.max(qx,0),Math.max(qy,0),Math.max(qz,0))+Math.min(Math.max(qx,qy,qz),0); };
const sCyl=(px,py,pz,ax,ay,z0,z1,r)=>{ const dxy=Math.hypot(px-ax,py-ay)-r, dz=Math.abs(pz-(z0+z1)/2)-(z1-z0)/2;
  return Math.hypot(Math.max(dxy,0),Math.max(dz,0))+Math.min(Math.max(dxy,dz),0); };
// chamfered cube centred at (cx,cy,cz): cube clipped by three 45deg diamond prisms
const sCube=(px,py,pz,cx,cy,cz)=>{ const x=px-cx,y=py-cy,z=pz-cz;
  const box=sBox(x,y,z,0,0,0,half,half,half);
  const d1=(Math.abs(x)+Math.abs(y)-ACH)/Math.SQRT2;
  const d2=(Math.abs(y)+Math.abs(z)-ACH)/Math.SQRT2;
  const d3=(Math.abs(x)+Math.abs(z)-ACH)/Math.SQRT2;
  return Math.max(box,d1,d2,d3); };

// ---- generic Surface Nets mesher over an SDF ----
function meshSDF(sdf, X0,Y0,Z0, X1,Y1,Z1, h){
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
  // orient every triangle outward (normal along +SDF gradient)
  const eps=h*0.5;
  for(const t of tris){
    const ax=t[1][0]-t[0][0],ay=t[1][1]-t[0][1],az=t[1][2]-t[0][2], bx=t[2][0]-t[0][0],by=t[2][1]-t[0][1],bz=t[2][2]-t[0][2];
    const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
    const cx=(t[0][0]+t[1][0]+t[2][0])/3, cy=(t[0][1]+t[1][1]+t[2][1])/3, cz=(t[0][2]+t[1][2]+t[2][2])/3;
    const gx=sdf(cx+eps,cy,cz)-sdf(cx-eps,cy,cz), gyv=sdf(cx,cy+eps,cz)-sdf(cx,cy-eps,cz), gzv=sdf(cx,cy,cz+eps)-sdf(cx,cy,cz-eps);
    if(nx*gx+ny*gyv+nz*gzv<0){ const tmp=t[1]; t[1]=t[2]; t[2]=tmp; }
  }
  return tris;
}

// ---- piece: union (min) of chamfered cubes, dropped so the bottom sits at z=0 ----
function pieceTris(balls){
  const cen=balls.map(b=>[b[0]*pitch, -b[1]*pitch, half + b[2]*vlayer]);
  const sdf=(x,y,z)=>{ let d=1e9; for(const c of cen) d=Math.min(d, sCube(x,y,z,c[0],c[1],c[2])); return d; };
  let X0=1e9,Y0=1e9,X1=-1e9,Y1=-1e9, Z1=-1e9;
  for(const c of cen){ X0=Math.min(X0,c[0]-half); X1=Math.max(X1,c[0]+half);
    Y0=Math.min(Y0,c[1]-half); Y1=Math.max(Y1,c[1]+half); Z1=Math.max(Z1,c[2]+half); }
  const m=2*VOXP;
  return meshSDF(sdf, X0-m,Y0-m,-m, X1+m,Y1+m,Z1+m, VOXP);
}

// ---- board: a tray hugging the footprint, open top, push holes in the floor ----
function boardTris(){
  const z_b=floor+half, Htop=z_b+vlayer;          // bottom cube centre, board top
  const edge=half+gap+wall, ph=half+gap, pr=push_d/2;
  const bx0=-edge, bx1=(COLS-1)*pitch+edge, by0=-(ROWS-1)*pitch-edge, by1=edge;
  const px0=-ph, px1=(COLS-1)*pitch+ph, py0=-(ROWS-1)*pitch-ph, py1=ph;
  const bcx=(bx0+bx1)/2,bcy=(by0+by1)/2,hbx=(bx1-bx0)/2,hby=(by1-by0)/2;
  const pcx=(px0+px1)/2,pcy=(py0+py1)/2,hpx=(px1-px0)/2,hpy=(py1-py0)/2;
  function sdf(x,y,z){
    const block=sBox(x,y,z,bcx,bcy,Htop/2,hbx,hby,Htop/2);
    const pocket=sBox(x,y,z,pcx,pcy,(floor+Htop+5)/2,hpx,hpy,(Htop+5-floor)/2);
    let v=Math.max(block,-pocket);
    if(push_d>0){ const ci=Math.round(x/pitch),ri=Math.round(-y/pitch);
      for(let dc=-1;dc<=1;dc++)for(let dr=-1;dr<=1;dr++){ const c=ci+dc,r=ri+dr;
        if(c<0||c>=COLS||r<0||r>=ROWS) continue;
        v=Math.max(v, -sCyl(x,y,z,c*pitch,-r*pitch,-5,floor+1,pr)); } }
    return v;
  }
  const m=2*VOX;
  return meshSDF(sdf, bx0-m,by0-m,-m, bx1+m,by1+m,Htop+m, VOX);
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
