// =====================================================================
//  IQ Puzzler — 3D-printable model (parametric)
//  Board = full waffle (5 x 10 cells) + pieces = chamfered cubes + necks.
//  Open in OpenSCAD (free): set `part` below, press F6, then Export as STL.
// =====================================================================

/* [What to render] */
// "demo"   -> board + piece A resting in it (to check the fit)
// "board"  -> the base plate only
// "all"    -> every piece laid out in a grid (for printing them together)
// "A".."J" -> a single piece by id
part = "demo";           // ["demo","board","all","A","B","C","D","E","F","G","H","I","J"]

/* [Main dimensions, mm] — unit cube measured at 10 mm (1 cm) */
ball_d  = 10;            // cube side
cham    = 3.0;           // chamfer cut on every cube edge (truncated-cube look; flat bottom)
wall_in = 1.5;           // internal partition thickness between cells (the waffle walls)
gap     = 0.3;           // clearance around the pieces (free passage)
neck_w  = 4;             // neck cross-section joining a piece's cubes
pitch   = ball_d + 2*gap + wall_in;   // 12.1 — spacing (uniform in all directions)
vlayer  = pitch;         // vertical spacing == horizontal (cubes spaced everywhere)

/* [Board outer] */
wall   = 3;     // outer wall thickness
floor  = 3;     // floor thickness under the bottom layer
push_d = 5;     // push-out hole in the floor under each cell (0 = solid floor)
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
module unit_solid(){
  a = ball_d - cham;          // chamfer plane: |x|+|y| <= a  (etc.)
  d = a*sqrt(2);
  intersection(){
    cube([ball_d, ball_d, ball_d], center=true);
    rotate([0,0,45]) cube([d, d, ball_d*3], center=true);
    rotate([45,0,0]) cube([ball_d*3, d, d], center=true);
    rotate([0,45,0]) cube([d, ball_d*3, d], center=true);
  }
}
module neck(p,q){ hull(){ translate(p) cube(neck_w,center=true); translate(q) cube(neck_w,center=true); } }

module piece(balls){
  union(){
    for (b = balls) translate(ballpos(b)) unit_solid();
    for (i=[0:len(balls)-1]) for (j=[i+1:len(balls)-1])
      if (adjacent(balls[i],balls[j])) neck(ballpos(balls[i]), ballpos(balls[j]));
  }
}

function z_bottom() = floor + ball_d/2;          // bottom-layer cube centre (rests on floor)
function board_H()  = z_bottom() + vlayer;       // board top = upper-layer centre (protrudes half)

module board(){
  H = board_H(); edge = ball_d/2 + gap + wall; wh = ball_d/2 + gap; sh = neck_w/2 + gap;
  bx = (COLS-1)*pitch + 2*edge; by = (ROWS-1)*pitch + 2*edge;
  difference(){
    translate([-edge, -(ROWS-1)*pitch-edge, 0]) cube([bx, by, H]);
    for (r=[0:ROWS-1]) for (c=[0:COLS-1])                                   // square wells
      translate([c*pitch-wh, -r*pitch-wh, floor]) cube([2*wh, 2*wh, H-floor+1]);
    for (r=[0:ROWS-1]) for (c=[0:COLS-2])                                   // x neck slots
      translate([c*pitch+pitch/2-2, -r*pitch-sh, floor]) cube([4, 2*sh, H-floor+1]);
    for (r=[0:ROWS-2]) for (c=[0:COLS-1])                                   // y neck slots
      translate([c*pitch-sh, -r*pitch-pitch/2-2, floor]) cube([2*sh, 4, H-floor+1]);
    if (push_d > 0)                                                         // push-out holes
      for (r=[0:ROWS-1]) for (c=[0:COLS-1])
        translate([c*pitch, -r*pitch, -1]) cylinder(h=floor+2, d=push_d, $fn=24);
  }
}

module all_pieces(){
  sp = pitch;
  for (i = [0:len(pieces)-1]) {
    col = i % 5;
    row = floor(i / 5);
    translate([ col * (5*pitch + sp), -row * (3*pitch + sp), 0 ])
      piece(pieces[i][1]);
  }
}

// Place a piece inside the waffle in its natural grid orientation.
function mpos(b, oc, or_) = [ (oc+b[0])*pitch, -(or_+b[1])*pitch, z_bottom()+b[2]*vlayer ];
module place_in_mould(balls, oc, or_, col){
  color(col) union(){
    for (b = balls) translate(mpos(b,oc,or_)) unit_solid();
    for (i=[0:len(balls)-1]) for (j=[i+1:len(balls)-1])
      if (adjacent(balls[i],balls[j])) neck(mpos(balls[i],oc,or_), mpos(balls[j],oc,or_));
  }
}

module demo(){
  %board();                                      // ghost so the piece shows through
  place_in_mould(pieces[0][1], 3, 1, "#f5a623"); // piece A dropped into the waffle
}

module render_part(){
  if (part == "board")      board();
  else if (part == "all")   all_pieces();
  else if (part == "demo")  demo();
  else {
    found = [for (p = pieces) if (p[0] == part) p];
    if (len(found) > 0) piece(found[0][1]);
    else echo("Unknown part: ", part);
  }
}

render_part();
