// Generate binary STL files for the template and all pieces — no deps, no OpenSCAD.
// Units are chamfered cubes (flat bottom -> good FDM adhesion), spaced equally in
// all directions and joined by necks.  The "template" is the full 2x5x10 block of
// joined cubes that all pieces together fill.  Meshed watertight via Surface Nets
// over an analytic SDF.
const fs = require('fs');
const path = require('path');

// ---- params (keep in sync with iq_puzzle.scad) ----  cube side = 10 mm (1 cm)
const ball_d=10;                             // cube side
const cham=2.0;                              // chamfer cut on every cube edge (mm)
const gap=0.3;                               // clearance around pieces (free passage)
const wall_in=1.5;                           // nominal partition between cells (sets the spacing)
const pitch=ball_d+2*gap+wall_in;            // 12.1 — spacing (uniform in all directions)
const vlayer=pitch;                          // vertical spacing == horizontal (cubes spaced everywhere)
const neck_w=4;                              // neck cross-section joining a piece's cubes
const VOX=0.7;    // voxel size for the template mesh
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
const gManhattan=(a,b)=>Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]);

const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const norm=(v)=>{const L=Math.hypot(...v)||1;return [v[0]/L,v[1]/L,v[2]/L];};

// ---- SDF primitives ----
const sBox=(px,py,pz,ax,ay,az,hx,hy,hz)=>{ const qx=Math.abs(px-ax)-hx,qy=Math.abs(py-ay)-hy,qz=Math.abs(pz-az)-hz;
  return Math.hypot(Math.max(qx,0),Math.max(qy,0),Math.max(qz,0))+Math.min(Math.max(qx,qy,qz),0); };
const sCyl=(px,py,pz,ax,ay,z0,z1,r)=>{ const dxy=Math.hypot(px-ax,py-ay)-r, dz=Math.abs(pz-(z0+z1)/2)-(z1-z0)/2;
  return Math.hypot(Math.max(dxy,0),Math.max(dz,0))+Math.min(Math.max(dxy,dz),0); };
// chamfered box centred at (cx,cy,cz), half-extents (hx,hy,hz), chamfer ch on all edges
const sChamBox=(px,py,pz,cx,cy,cz,hx,hy,hz,ch)=>{ const x=px-cx,y=py-cy,z=pz-cz;
  const box=sBox(x,y,z,0,0,0,hx,hy,hz);
  const d1=(Math.abs(x)+Math.abs(y)-(hx+hy-ch))/Math.SQRT2;
  const d2=(Math.abs(y)+Math.abs(z)-(hy+hz-ch))/Math.SQRT2;
  const d3=(Math.abs(x)+Math.abs(z)-(hx+hz-ch))/Math.SQRT2;
  return Math.max(box,d1,d2,d3); };
// chamfered cube = chamfered box with equal extents
const sCube=(px,py,pz,cx,cy,cz)=>sChamBox(px,py,pz,cx,cy,cz,half,half,half,cham);
// neck bar between two cube centres a,b (square section neck_w, spanning centre-to-centre)
const sNeck=(px,py,pz,a,b)=>{ const cx=(a[0]+b[0])/2,cy=(a[1]+b[1])/2,cz=(a[2]+b[2])/2;
  const hx=a[0]!==b[0]?Math.abs(a[0]-b[0])/2:neck_w/2;
  const hy=a[1]!==b[1]?Math.abs(a[1]-b[1])/2:neck_w/2;
  const hz=a[2]!==b[2]?Math.abs(a[2]-b[2])/2:neck_w/2;
  return sBox(px,py,pz,cx,cy,cz,hx,hy,hz); };

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

// ---- piece: chamfered cubes joined by neck bars, bottom sitting at z=0 ----
function pieceTris(balls){
  const C=balls.map(b=>[b[0]*pitch, -b[1]*pitch, half + b[2]*vlayer]);
  const pairs=[];
  for(let i=0;i<balls.length;i++)for(let j=i+1;j<balls.length;j++)
    if(gManhattan(balls[i],balls[j])===1) pairs.push([C[i],C[j]]);
  const sdf=(x,y,z)=>{ let d=1e9; for(const c of C) d=Math.min(d, sCube(x,y,z,c[0],c[1],c[2]));
    for(const p of pairs) d=Math.min(d, sNeck(x,y,z,p[0],p[1])); return d; };
  let X0=1e9,Y0=1e9,X1=-1e9,Y1=-1e9, Z1=-1e9;
  for(const c of C){ X0=Math.min(X0,c[0]-half); X1=Math.max(X1,c[0]+half);
    Y0=Math.min(Y0,c[1]-half); Y1=Math.max(Y1,c[1]+half); Z1=Math.max(Z1,c[2]+half); }
  const m=2*VOXP;
  return meshSDF(sdf, X0-m,Y0-m,-m, X1+m,Y1+m,Z1+m, VOXP);
}

// ---- template: the 2 x 5 x 10 "master" that all pieces together fill ----
// Used to CUT a mould, so each cell is a SOLID vertical pillar spanning both
// layers (no waist between layers -> the cut is a continuous shaft); adjacent
// pillars are joined by thin horizontal necks at each layer (these become the
// wall slots). SDF localised to nearby cells so it stays fast.
function templateTris(){
  const Hpil=ball_d+vlayer, pcz=Hpil/2;            // pillar height & centre (spans z 0..Hpil)
  const cen=(c,r,l)=>[c*pitch, -r*pitch, half + l*vlayer];
  const sdf=(x,y,z)=>{
    let d=1e9; const ci=Math.round(x/pitch), ri=Math.round(-y/pitch);
    for(let c=ci-1;c<=ci+1;c++)for(let r=ri-1;r<=ri+1;r++){
      if(c<0||c>=COLS||r<0||r>=ROWS) continue;
      const Cx=c*pitch, Cy=-r*pitch;
      d=Math.min(d, sChamBox(x,y,z,Cx,Cy,pcz,half,half,Hpil/2,cham));    // solid pillar (both layers)
      for(let l=0;l<2;l++){ const A=cen(c,r,l);
        if(c+1<COLS) d=Math.min(d, sNeck(x,y,z,A,cen(c+1,r,l)));         // horizontal necks per layer
        if(r+1<ROWS) d=Math.min(d, sNeck(x,y,z,A,cen(c,r+1,l)));
      }
    }
    return d;
  };
  const m=2*VOX;
  return meshSDF(sdf, -half-m, -(ROWS-1)*pitch-half-m, -m,
                      (COLS-1)*pitch+half+m, half+m, Hpil+m, VOX);
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
report.push(['template', writeSTL(path.join(out,'template.stl'), templateTris())]);
for(const id in pieces) report.push(['piece_'+id, writeSTL(path.join(out,'piece_'+id+'.stl'), pieceTris(pieces[id]))]);
for(const [n,t] of report){ total+=t; console.log(n.padEnd(10), t, 'tris'); }
console.log('TOTAL', total, 'triangles');
