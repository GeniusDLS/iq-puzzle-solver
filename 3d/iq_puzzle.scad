// =====================================================================
//  IQ Puzzler — 3D-printable model (parametric)
//  Board (5 x 10 sockets) + pieces (fused balls).
//  Open in OpenSCAD (free): set `part` below, press F6, then Export as STL.
// =====================================================================

/* [What to render] */
// "demo"   -> board + piece A resting in it (to check the fit)
// "board"  -> the base plate only
// "all"    -> every piece laid out in a grid (for printing them together)
// "A".."J" -> a single piece by id
part = "demo";           // ["demo","board","all","A","B","C","D","E","F","G","H","I","J"]

/* [Main dimensions, mm]  — ball diameter measured at 10 mm (1 cm) */
ball_d     = 10;         // diameter of the balls (measured: 1 cm)
pitch      = 10;         // centre-to-centre spacing — == ball_d (balls touch)
neck_ratio = 0.45;       // neck thickness between balls (x ball_d) — keeps prints solid
vlayer     = 10;         // vertical spacing between stacked layers (== ball_d for a cubic stack)

/* [Board — mould enclosing the 5x10 x 2-layer ball template] */
gap    = 0.4;   // clearance around the template (free passage)
wall   = 3;     // side wall thickness
floor  = 3;     // floor thickness under the bottom ball layer
push_d = 5;     // push-out hole in the floor under each ball (0 = solid floor)
ROWS = 5;
COLS = 10;

/* [Printing helpers] */
bottom_flat = 1.0;       // shave this much off the very bottom of pieces for bed adhesion (0 = off)

/* [Quality] */
$fn = 48;

// ---------------------------------------------------------------------
//  Piece data.  Each ball = [col, row, layer]  (layer 0 = bottom).
//  Real 3-D shapes: each piece is two flat faces sharing a common edge (hinge)
//  folded at 90deg — face 1 lies flat (z=0), face 2 stands up (y=0). The balls
//  that show in face 2 sit ON TOP. Both faces are preserved.
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

module piece_solid(balls){
  union(){
    for (b = balls) translate(ballpos(b)) sphere(d = ball_d);
    // fuse neighbouring balls with a capsule (hull of two smaller spheres)
    for (i = [0:len(balls)-1])
      for (j = [i+1:len(balls)-1])
        if (adjacent(balls[i], balls[j]))
          hull(){
            translate(ballpos(balls[i])) sphere(d = ball_d*neck_ratio);
            translate(ballpos(balls[j])) sphere(d = ball_d*neck_ratio);
          }
  }
}

module piece(balls){
  if (bottom_flat > 0)
    difference(){
      piece_solid(balls);
      translate([-1000,-1000,-1000]) cube([2000,2000,1000 + bottom_flat]); // cut below z = bottom_flat
    }
  else
    piece_solid(balls);
}

function z_bottom() = floor + ball_d/2 + gap;   // bottom-layer ball centre
function z_top()    = z_bottom() + vlayer;      // top-layer ball centre
function board_H()  = z_top();                  // board top = top centre (upper balls protrude)

// Cavity insertable from the top: per-column wells (rounded bottom + cylinder up
// to the open top) joined by full-height slots so the piece's necks slide down.
module mould_cavity(){
  cr = ball_d/2 + gap; nr = ball_d*neck_ratio/2 + gap;
  H  = board_H(); zb = z_bottom();
  for (r=[0:ROWS-1]) for (c=[0:COLS-1]){
    translate([c*pitch, -r*pitch, zb]) sphere(r=cr);                         // dimple bottom
    translate([c*pitch, -r*pitch, zb]) cylinder(h=H-zb+1, r=cr, $fn=40);     // well to the top
  }
  for (r=[0:ROWS-1]) for (c=[0:COLS-2])                                      // x neck slots
    translate([c*pitch, -r*pitch-nr, zb]) cube([pitch, 2*nr, H-zb+1]);
  for (r=[0:ROWS-2]) for (c=[0:COLS-1])                                      // y neck slots
    translate([c*pitch-nr, -(r+1)*pitch, zb]) cube([2*nr, pitch, H-zb+1]);
}

module board(){
  H=board_H(); edge=ball_d/2+gap+wall;
  bx=(COLS-1)*pitch+2*edge; by=(ROWS-1)*pitch+2*edge;
  difference(){
    translate([-edge, -(ROWS-1)*pitch-edge, 0]) cube([bx, by, H]);
    mould_cavity();         // hollow it out (wells + full-height neck slots)
    if (push_d > 0)         // push-out holes in the floor under each ball
      for (r=[0:ROWS-1]) for (c=[0:COLS-1])
        translate([c*pitch, -r*pitch, -1]) cylinder(h=z_bottom()+1, d=push_d, $fn=24);
  }
}

// piece bounding width in columns (for the "all" layout)
function pcols(balls) = max([for (b = balls) b[0]]) + 1;
function prows(balls) = max([for (b = balls) b[1]]) + 1;

module all_pieces(){
  sp = pitch;                  // space between pieces
  for (i = [0:len(pieces)-1]) {
    col = i % 5;
    row = floor(i / 5);
    translate([ col * (5*pitch + sp), -row * (3*pitch + sp), 0 ])
      piece(pieces[i][1]);
  }
}

// absolute position of ball b of a piece dropped into the mould at grid (oc,or_)
function mpos(b, oc, or_) = [ (oc+b[0])*pitch, -(or_+b[1])*pitch, z_bottom()+b[2]*vlayer ];

// Place a piece inside the mould in its natural grid orientation.
module place_in_mould(balls, oc, or_, col){
  color(col) union(){
    for (b = balls) translate(mpos(b,oc,or_)) sphere(d = ball_d);
    for (i=[0:len(balls)-1]) for (j=[i+1:len(balls)-1])
      if (adjacent(balls[i],balls[j]))
        hull(){ translate(mpos(balls[i],oc,or_)) sphere(d=ball_d*neck_ratio);
                translate(mpos(balls[j],oc,or_)) sphere(d=ball_d*neck_ratio); }
  }
}

module demo(){
  %board();                                      // ghost so the piece shows through
  place_in_mould(pieces[0][1], 3, 1, "#f5a623"); // piece A dropped into the mould
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
