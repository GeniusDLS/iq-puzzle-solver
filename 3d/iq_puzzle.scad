// =====================================================================
//  IQ Puzzler — 3D-printable model (parametric)
//  Board (5 x 10 sockets) + pieces (fused balls).
//  Open in OpenSCAD (free): set `part` below, press F6, then Export as STL.
// =====================================================================

/* [What to render] */
// "board"  -> the base plate with sockets
// "all"    -> every piece laid out in a grid (for printing them together)
// "A".."J" -> a single piece by id
part = "all";            // ["board","all","A","B","C","D","E","F","G","H","I","J"]

/* [Main dimensions, mm]  — ball diameter measured at 10 mm (1 cm) */
ball_d     = 10;         // diameter of the balls (measured: 1 cm)
pitch      = 10;         // centre-to-centre spacing — == ball_d (balls touch)
neck_ratio = 0.62;       // neck thickness between balls (x ball_d) — keeps prints solid
vlayer     = 10;         // vertical spacing between stacked layers (== ball_d for a cubic stack)

/* [Board] — through-holes; the ball drops in and is held by the smaller hole */
hole_d       = 8;        // through-hole diameter (< pitch and < ball_d so the ball seats)
board_thick  = 4;        // plate thickness
seat_chamfer = 1;        // top countersink so the ball seats nicely (0 = none)
board_margin = 5;        // flat border around the grid
ROWS = 5;
COLS = 10;

/* [Printing helpers] */
bottom_flat = 1.0;       // shave this much off the very bottom of pieces for bed adhesion (0 = off)

/* [Quality] */
$fn = 48;

// ---------------------------------------------------------------------
//  Piece data.  Each ball = [col, row, layer]  (layer 0 = bottom).
//  These are the real 3-D shapes, reconstructed from the two orthogonal
//  projections (faces) of each piece: face 1 = top view (col,row),
//  face 2 = front view (col,layer). A piece occupies (x,y,z) iff (x,y) is in
//  the top view and (x,z) is in the front view. Both projections verified.
// ---------------------------------------------------------------------
pieces = [
  ["A", [[0,0,0],[0,0,1],[1,0,0],[1,0,1],[2,0,1],[3,0,1],[3,1,1]]],
  ["B", [[0,0,1],[1,0,0],[1,0,1],[1,1,0],[1,1,1],[2,0,1],[3,0,0],[3,0,1]]],
  ["C", [[0,0,1],[0,1,1],[1,0,0],[1,0,1],[1,1,0],[1,1,1],[2,0,1],[3,0,1]]],
  ["D", [[0,0,0],[0,0,1],[0,1,0],[0,1,1],[1,0,1],[2,0,1],[3,0,0],[3,0,1]]],
  ["E", [[0,0,0],[0,0,1],[0,1,0],[0,1,1],[1,0,1],[2,0,0],[2,0,1],[3,0,1]]],
  ["F", [[2,0,0],[2,0,1],[2,1,0],[2,1,1],[0,1,0],[1,1,0],[1,1,1],[3,1,0]]],
  ["G", [[0,0,0],[0,0,1],[1,0,1],[1,1,1],[2,0,1],[2,1,1]]],
  ["H", [[0,0,1],[0,1,1],[1,0,0],[1,0,1],[2,0,1],[2,1,1]]],
  ["I", [[0,0,0],[0,0,1],[0,1,0],[0,1,1],[2,0,0],[2,1,0],[1,1,0]]],
  ["J", [[0,0,1],[0,1,1],[1,0,0],[1,0,1],[1,1,0],[1,1,1],[2,0,1]]],
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

module board(){
  edge   = hole_d/2 + board_margin;
  bx     = (COLS-1)*pitch + 2*edge;
  by     = (ROWS-1)*pitch + 2*edge;
  difference(){
    translate([-edge, -(ROWS-1)*pitch - edge, 0]) cube([bx, by, board_thick]);
    for (r = [0:ROWS-1])
      for (c = [0:COLS-1]){
        translate([c*pitch, -r*pitch, -1])
          cylinder(h = board_thick + 2, d = hole_d, $fn = 32);          // through-hole
        if (seat_chamfer > 0)
          translate([c*pitch, -r*pitch, board_thick - seat_chamfer])
            cylinder(h = seat_chamfer + 0.01, d1 = hole_d, d2 = hole_d + 2*seat_chamfer, $fn = 32);
      }
  }
}

// piece bounding width in columns (for the "all" layout)
function pcols(balls) = max([for (b = balls) b[0]]) + 1;
function prows(balls) = max([for (b = balls) b[1]]) + 1;

module all_pieces(){
  gap = pitch;                 // space between pieces
  x = 0;
  // simple shelf layout: 5 per row
  for (i = [0:len(pieces)-1]) {
    col = i % 5;
    row = floor(i / 5);
    translate([ col * (5*pitch + gap), -row * (3*pitch + gap), 0 ])
      piece(pieces[i][1]);
  }
}

module render_part(){
  if (part == "board")      board();
  else if (part == "all")   all_pieces();
  else {
    found = [for (p = pieces) if (p[0] == part) p];
    if (len(found) > 0) piece(found[0][1]);
    else echo("Unknown part: ", part);
  }
}

render_part();
