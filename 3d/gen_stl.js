// Generate binary STL files for the board and all pieces — no deps, no OpenSCAD.
// Pieces = overlapping closed spheres + neck cylinders (slicers union them).
// Board  = watertight slab with spherical dimples (heightfield top + walls + bottom).
const fs = require('fs');
const path = require('path');

// ---- params (keep in sync with iq_puzzle.scad) ----  ball diameter = 10 mm (1 cm)
const ball_d=10, pitch=10, vlayer=10, neck_ratio=0.62;
const hole_d=8, board_thick=4, board_margin=5;   // board with through-holes
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
  // Flat plate of thickness T with cylindrical THROUGH-holes at every grid point.
  // Watertight: cap faces are fanned per grid-cell; hole-edge arcs use the same
  // 15-degree samples as the hole-wall cylinders, so all vertices coincide.
  const tris=[]; const T=board_thick, rh=hole_d/2, SEGQ=6;
  const edge=rh+board_margin;
  const x0=-edge, x1=(COLS-1)*pitch+edge, y0=-(ROWS-1)*pitch-edge, y1=edge;
  const holeX=[], holeY=[];
  for(let c=0;c<COLS;c++) holeX.push(c*pitch);
  for(let r=0;r<ROWS;r++) holeY.push(-r*pitch);
  const key=v=>Math.round(v*1000);
  const HX=new Set(holeX.map(key)), HY=new Set(holeY.map(key));
  const isHole=(x,y)=>HX.has(key(x))&&HY.has(key(y));
  const uniq=a=>[...new Set(a.map(key))].map(k=>k/1000).sort((p,q)=>p-q);
  const xs=uniq([x0,...holeX,x1]), ys=uniq([y0,...holeY,y1]);

  // boundary polygon (CCW) of one cell, inserting quarter-arcs at hole corners
  function cellPoly(xa,xb,ya,yb){
    const corners=[ // [x,y, inDir, outDir]
      [xa,ya,[0,-1],[1,0]], [xb,ya,[1,0],[0,1]],
      [xb,yb,[0,1],[-1,0]], [xa,yb,[-1,0],[0,-1]],
    ];
    const pts=[];
    for(const [x,y,inD,outD] of corners){
      if(isHole(x,y)){
        const u1=[-inD[0],-inD[1]], u2=[outD[0],outD[1]];
        let a1=Math.atan2(u1[1],u1[0]), a2=Math.atan2(u2[1],u2[0]);
        if(a2-a1> Math.PI) a2-=2*Math.PI; if(a2-a1<-Math.PI) a2+=2*Math.PI;
        for(let s=0;s<=SEGQ;s++){ const a=a1+(a2-a1)*s/SEGQ; pts.push([x+rh*Math.cos(a), y+rh*Math.sin(a)]); }
      } else pts.push([x,y]);
    }
    return pts;
  }
  // caps
  for(let i=0;i<xs.length-1;i++) for(let j=0;j<ys.length-1;j++){
    const xa=xs[i],xb=xs[i+1],ya=ys[j],yb=ys[j+1];
    const poly=cellPoly(xa,xb,ya,yb);
    const cx=(xa+xb)/2, cy=(ya+yb)/2, n=poly.length;
    for(let k=0;k<n;k++){ const p=poly[k], q=poly[(k+1)%n];
      tris.push([[cx,cy,T],[p[0],p[1],T],[q[0],q[1],T]]);   // top  (+z)
      tris.push([[cx,cy,0],[q[0],q[1],0],[p[0],p[1],0]]);   // bottom (-z)
    }
  }
  // hole walls (full cylinders, 24 segments at 15 deg — matches the cap arcs)
  const SEG=4*SEGQ;
  for(const hx of holeX) for(const hy of holeY){
    for(let k=0;k<SEG;k++){
      const a=2*Math.PI*k/SEG, b=2*Math.PI*(k+1)/SEG;
      const a0=[hx+rh*Math.cos(a),hy+rh*Math.sin(a),0], aT=[hx+rh*Math.cos(a),hy+rh*Math.sin(a),T];
      const b0=[hx+rh*Math.cos(b),hy+rh*Math.sin(b),0], bT=[hx+rh*Math.cos(b),hy+rh*Math.sin(b),T];
      tris.push([a0,aT,bT]); tris.push([a0,bT,b0]);          // inward-facing
    }
  }
  // outer side walls — subdivided at the same grid lines as the caps (no T-junctions)
  for(let i=0;i<xs.length-1;i++){ const xa=xs[i],xb=xs[i+1];
    tris.push([[xa,y0,0],[xb,y0,0],[xb,y0,T]]); tris.push([[xa,y0,0],[xb,y0,T],[xa,y0,T]]); // y0 (-y)
    tris.push([[xb,y1,0],[xa,y1,0],[xa,y1,T]]); tris.push([[xb,y1,0],[xa,y1,T],[xb,y1,T]]); // y1 (+y)
  }
  for(let j=0;j<ys.length-1;j++){ const ya=ys[j],yb=ys[j+1];
    tris.push([[x0,yb,0],[x0,ya,0],[x0,ya,T]]); tris.push([[x0,yb,0],[x0,ya,T],[x0,yb,T]]); // x0 (-x)
    tris.push([[x1,ya,0],[x1,yb,0],[x1,yb,T]]); tris.push([[x1,ya,0],[x1,yb,T],[x1,ya,T]]); // x1 (+x)
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
