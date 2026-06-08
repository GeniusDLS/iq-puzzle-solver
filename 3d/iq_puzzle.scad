// =====================================================================
//  IQ Puzzler — 3D-printable model (parametric)
//  Board (5 x 10 sockets) + pieces built from chamfered cubes.
//  Open in OpenSCAD (free): set `part` below, press F6, then Export as STL.
// =====================================================================

/* [What to render] */
// "demo"   -> board + piece A resting in it (to check the fit)
// "board"  -> the base plate only
// "all"    -> every piece laid out in a grid (for printing them together)
// "A".."J" -> a single piece by id
part = "demo";           // ["demo","board","all","A","B","C","D","E","F","G","H","I","J"]

/* [Main dimensions, mm] — unit cube measured at 10 mm (1 cm) */
ball_d = 10;             // cube side (was the ball diameter: 1 cm)
pitch  = 10;             // centre-to-centre spacing — == ball_d (cubes touch & fuse)
vlayer = 10;             // vertical spacing between stacked layers
cham   = 3.0;            // chamfer cut on every cube edge (truncated-cube look; flat bottom)

/* [Board — tray hugging the 5x10 x 2-layer footprint] */
gap    = 0.3;   // clearance around the pieces (free passage)
wall   = 3;     // side wall thickness
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

// A chamfered cube ("truncated cube"): the cube clipped by three 45deg diamond
// prisms, one per axis pair, so all 12 edges are bevelled.  A flat octagonal
// bottom remains (great bed adhesion); touching cubes fuse into one solid.
module unit_solid(){
  a = ball_d - cham;          // chamfer plane: |x|+|y| <= a  (etc.)
  d = a*sqrt(2);
  intersection(){
    cube([ball_d, ball_d, ball_d], center=true);
    rotate([0,0,45]) cube([d, d, ball_d*3], center=true);   // bevel the 4 z-edges
    rotate([45,0,0]) cube([ball_d*3, d, d], center=true);   // bevel the 4 x-edges
    rotate([0,45,0]) cube([d, ball_d*3, d], center=true);   // bevel the 4 y-edges
  }
}

module piece(balls){
  union(){ for (b = balls) translate(ballpos(b)) unit_solid(); }
}

function z_bottom() = floor + ball_d/2;          // bottom-layer cube centre (rests on floor)
function board_H()  = z_bottom() + vlayer;       // board top = upper-layer centre (protrudes half)

module board(){
  H = board_H(); edge = ball_d/2 + gap + wall; ph = ball_d/2 + gap;
  bx = (COLS-1)*pitch + 2*edge; by = (ROWS-1)*pitch + 2*edge;
  difference(){
    translate([-edge, -(ROWS-1)*pitch-edge, 0]) cube([bx, by, H]);
    // open pocket hugging the footprint (+gap), insertable straight from the top
    translate([-ph, -(ROWS-1)*pitch-ph, floor])
      cube([(COLS-1)*pitch + 2*ph, (ROWS-1)*pitch + 2*ph, H - floor + 1]);
    if (push_d > 0)         // push-out holes in the floor under each cell
      for (r=[0:ROWS-1]) for (c=[0:COLS-1])
        translate([c*pitch, -r*pitch, -1]) cylinder(h=floor+2, d=push_d, $fn=24);
  }
}

// piece bounding size (for the "all" layout)
function pcols(balls) = max([for (b = balls) b[0]]) + 1;

module all_pieces(){
  sp = pitch;
  for (i = [0:len(pieces)-1]) {
    col = i % 5;
    row = floor(i / 5);
    translate([ col * (5*pitch + sp), -row * (3*pitch + sp), 0 ])
      piece(pieces[i][1]);
  }
}

// Place a piece inside the tray in its natural grid orientation.
function mpos(b, oc, or_) = [ (oc+b[0])*pitch, -(or_+b[1])*pitch, z_bottom()+b[2]*vlayer ];
module place_in_mould(balls, oc, or_, col){
  color(col) union(){ for (b = balls) translate(mpos(b,oc,or_)) unit_solid(); }
}

module demo(){
  %board();                                      // ghost so the piece shows through
  place_in_mould(pieces[0][1], 3, 1, "#f5a623"); // piece A dropped into the tray
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
