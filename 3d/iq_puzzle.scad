// =====================================================================
//  IQ Puzzler — 3D-printable model (parametric)
//  Template (2 x 5 x 10 block of joined cubes) + pieces = chamfered cubes + necks.
//  Open in OpenSCAD (free): set `part` below, press F6, then Export as STL.
// =====================================================================

/* [What to render] */
// "demo"     -> template (ghost) + piece A highlighted in place
// "template" -> the full 2x5x10 block of joined cubes
// "all"      -> every piece laid out in a grid (for printing them together)
// "A".."J"   -> a single piece by id
part = "demo";           // ["demo","template","all","A","B","C","D","E","F","G","H","I","J"]

/* [Main dimensions, mm] — unit cube measured at 10 mm (1 cm) */
ball_d  = 10;            // cube side
cham    = 2.0;           // chamfer cut on every cube edge (truncated-cube look; flat bottom)
wall_in = 1.5;           // nominal partition between cells (sets the spacing)
gap     = 0.3;           // clearance allowance
neck_w  = 4;             // neck cross-section joining adjacent cubes
pitch   = ball_d + 2*gap + wall_in;   // 12.1 — spacing (uniform in all directions)
vlayer  = pitch;         // vertical spacing == horizontal (cubes spaced everywhere)
ROWS = 5;
COLS = 10;

/* [Quality] */
$fn = 48;

// ---------------------------------------------------------------------
//  Piece data.  Each cube = [col, row, layer]  (layer 0 = bottom).
//  Real 3-D shapes: each piece is two flat faces sharing a common edge (hinge)
//  folded at 90deg — face 1 lies flat (z=0), face 2 stands up. The cubes that
//  show in face 2 sit ON TOP. Both faces are preserved.
// ---------------------------------------------------------------------
pieces = [
  ["A", [[0,0,0],[0,0,1],[1,0,0],[1,0,1],[2,0,0],[3,0,0],[3,1,0]]],
  ["B", [[0,0,0],[1,0,0],[1,0,1],[1,1,0],[2,0,0],[3,0,0],[3,0,1]]],
  ["C", [[0,0,0],[0,1,0],[1,0,0],[1,0,1],[1,1,0],[2,0,0],[3,0,0]]],
  ["D", [[0,0,0],[0,0,1],[0,1,0],[1,0,0],[2,0,0],[3,0,0],[3,0,1]]],
  ["E", [[0,0,0],[0,0,1],[0,1,0],[1,0,0],[2,0,0],[2,0,1],[3,0,0]]],
  ["F", [[0,0,0],[1,0,0],[1,0,1],[2,0,0],[2,0,1],[2,1,0],[3,0,0]]],
  ["G", [[0,0,0],[0,0,1],[1,0,0],[1,1,0],[2,0,0],[2,1,0]]],
  ["H", [[0,0,0],[0,1,0],[1,0,0],[1,0,1],[2,0,0],[2,1,0]]],
  ["I", [[0,0,0],[0,0,1],[0,1,0],[1,0,0],[2,0,0],[2,1,0]]],
  ["J", [[0,0,0],[0,1,0],[1,0,0],[1,0,1],[1,1,0],[2,0,0]]],
];

// ---- helpers ----
function ballpos(b) = [ b[0]*pitch, -b[1]*pitch, ball_d/2 + b[2]*vlayer ];
function adjacent(a,b) = (abs(a[0]-b[0]) + abs(a[1]-b[1]) + abs(a[2]-b[2])) == 1;

// A chamfered cube ("truncated cube"): the cube clipped by three 45deg diamond
// prisms, one per axis pair, so all 12 edges are bevelled.  Flat octagonal
// bottom -> great bed adhesion.
module chamfered_cube(side, ch){
  a = side - ch; d = a*sqrt(2);
  intersection(){
    cube([side, side, side], center=true);
    rotate([0,0,45]) cube([d, d, side*3], center=true);
    rotate([45,0,0]) cube([side*3, d, d], center=true);
    rotate([0,45,0]) cube([d, side*3, d], center=true);
  }
}
module unit_solid(){ chamfered_cube(ball_d, cham); }
module neck(p,q){ hull(){ translate(p) cube(neck_w,center=true); translate(q) cube(neck_w,center=true); } }

module piece(balls){
  union(){
    for (b = balls) translate(ballpos(b)) unit_solid();
    for (i=[0:len(balls)-1]) for (j=[i+1:len(balls)-1])
      if (adjacent(balls[i],balls[j])) neck(ballpos(balls[i]), ballpos(balls[j]));
  }
}

// The full 2 x 5 x 10 block of joined cubes (the "master" all pieces fill).
function template_balls() = [for (c=[0:COLS-1]) for (r=[0:ROWS-1]) for (l=[0:1]) [c,r,l]];
module template(){ piece(template_balls()); }

module all_pieces(){
  sp = pitch;
  for (i = [0:len(pieces)-1]) {
    col = i % 5;
    row = floor(i / 5);
    translate([ col * (5*pitch + sp), -row * (3*pitch + sp), 0 ])
      piece(pieces[i][1]);
  }
}

module demo(){
  %template();                                   // ghost so the piece shows through
  color("#f5a623") piece(pieces[0][1]);          // piece A highlighted in its place
}

module render_part(){
  if (part == "template")   template();
  else if (part == "all")   all_pieces();
  else if (part == "demo")  demo();
  else {
    found = [for (p = pieces) if (p[0] == part) p];
    if (len(found) > 0) piece(found[0][1]);
    else echo("Unknown part: ", part);
  }
}

render_part();
