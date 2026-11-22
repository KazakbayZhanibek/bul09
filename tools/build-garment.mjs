// Run with Node and meshoptimizer 1.1.1 installed, or pass its index.js path.
// node tools/build-garment.mjs [/path/to/meshoptimizer/index.js]
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readPanels, writeGarment } from './garment-glb.mjs';
const source = process.argv[2] ? pathToFileURL(resolve(process.argv[2])).href : 'meshoptimizer';
const { MeshoptDecoder, MeshoptEncoder } = await import(source);
await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready]);
const directory = new URL('../assets/models/',import.meta.url);
const panels = await readPanels(new URL('threadlab-fixed.glb',directory), MeshoptDecoder);
const TAU = 2*Math.PI;
const clamp = (x,low,high) => Math.max(low,Math.min(high,x));
const smooth = (x,low,high) => { const t=clamp((x-low)/(high-low),0,1); return t*t*(3-2*t); };
const bell = x => Math.exp(-x*x);
const dot = (a,b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const add = (a,b,scale=1) => a.map((v,k)=>v+scale*b[k]);
const normalize = a => {const d=Math.hypot(...a)||1;return a.map(v=>v/d);};
const distance = (a,b) => Math.hypot(...a.map((v,k)=>v-b[k]));

// The packshots show fabric suspended from the shoulders, going slack below
// the chest and stacking softly above the hem. Each tapered crease has a raised
// roll and an adjacent shallow valley. Coordinates and depth are in metres.
function crease(startX, startY, endX, endY, depth, width, bow) {
  const dx = endX - startX, dy = endY - startY;
  const length = Math.hypot(dx, dy);
  return { startX, startY, tx: dx / length, ty: dy / length, length, depth, width, bow };
}

const frontFolds = [
  crease(-.126, .304, -.094, .166, .0065, .023, -.006),
  crease(.136, .281, .092, .056, .0095, .023, .013),
  crease(-.190, .179, -.152, -.089, .014, .025, -.009),
  crease(-.105, .061, -.174, -.208, .021, .032, -.013),
  crease(-.181, -.209, -.066, -.092, .011, .022, .006),
  crease(-.181, -.259, -.073, -.205, .012, .020, .007),
  crease(-.173, -.305, -.067, -.270, .007, .019, -.006),
  crease(.134, .150, .169, -.243, .018, .033, .019),
  crease(.184, -.218, .108, -.151, .009, .021, -.004),
  crease(.183, -.280, .053, -.226, .011, .023, .006),
  crease(-.062, -.336, .077, -.260, .0065, .030, .010),
];
const backFolds = [
  crease(-.102, .310, -.147, .230, .0055, .024, .003),
  crease(.136, .277, .160, .107, .009, .026, -.006),
  crease(-.172, .213, -.162, -.127, .013, .026, .009),
  crease(-.093, .002, -.161, -.228, .021, .033, -.009),
  crease(-.178, -.240, -.084, -.154, .0115, .022, .014),
  crease(-.175, -.309, -.067, -.214, .010, .021, -.004),
  crease(.123, .115, .159, -.206, .017, .032, .010),
  crease(.168, -.219, .095, -.110, .014, .026, -.008),
  crease(.174, -.270, .031, -.207, .014, .026, .011),
  crease(-.116, -.206, .115, -.216, .010, .026, -.013),
  crease(-.046, -.305, .142, -.277, .0095, .020, .013),
];

function foldHeight(x, y, folds) {
  let height = 0;
  for (const fold of folds) {
    const dx = x - fold.startX, dy = y - fold.startY;
    const t = (dx * fold.tx + dy * fold.ty) / fold.length;
    if (t <= 0 || t >= 1) continue;
    const taper = Math.sin(Math.PI * t);
    const across = dy * fold.tx - dx * fold.ty - fold.bow * taper;
    const q = across / (fold.width * (.65 + .35 * taper));
    if (q < -3.8 || q > 3.8) continue;
    height += fold.depth * taper * taper * (bell(q) - .56 * bell((q - 1.1) / .86));
  }
  return height;
}

function shape(x, y, z) {
  const side = Math.abs(x), outer = smooth(side, .155, .305);
  const front = smooth(z, -.052, .057);
  const hem = 1 - smooth(y, -.31, .055);
  const face = Math.tanh(z / .052);
  const frontHeight = front > 0 ? foldHeight(x, y, frontFolds) : 0;
  const rearHeight = front < 1 ? foldHeight(x, y, backFolds) : 0;
  let folds = rearHeight * (1 - front) + frontHeight * front;

  // The loose centre drops under its own weight. Folds widen toward the hem
  // and tighten where they meet an armhole or the lower side seam.
  const sag = (1 - smooth(y, -.19, .27)) * (1 - smooth(side, .16, .23));
  const track = .024 * Math.sin(4.8 * y + 8.5 * x + .5 * front);
  folds += sag * (.009 * bell((x + .052 + track) / .042)
    - .010 * bell((x - .027 + track * .3) / .057)
    + .012 * bell((x - .109 - track) / .038));

  // Follow each sleeve's downward axis. A single long fold from the cap to
  // its opening breaks up the smooth surface without bunching the elbow.
  const sleeve = smooth(side, .176, .237) * smooth(y, -.045, .035);
  const sleeveCentre = .263 - .35 * (y - .018);
  const ridge = side - sleeveCentre + (x < 0 ? .021 : -.015) + .014 * front;
  folds += sleeve * (.0105 * bell(ridge / .024) - .005 * bell((ridge + .023) / .023));
  const tuck = .092 + (x > 0 ? -.012 : .019) + .48 * (side - .225) + .012 * front;
  folds += sleeve * .0045 * bell((y - tuck) / .030);

  // The hem has a slightly stiffer turned edge and uneven settling at either
  // side. Preserve its roundness and let a fine pucker run across the stitch.
  const edge = Math.exp(-Math.pow((y + .332) / .017, 2));
  const edgePucker = edge * (.0016 * Math.sin(86*x + 5*front) + .0006 * Math.sin(141*x - 3*front));
  const hemLift = hem * (.008 * bell((x + .14) / .043)
    + .004 * bell((x - .10) / .047) - .006 * bell((x + .024) / .083) + .004 * face);
  const shoulderDrop = .043 * outer * smooth(y, -.09, .055);
  const neckOpening = .021 * bell(x / .098) * smooth(y, .241, .315) * smooth(z, -.051, .049);
  const horizontal = 1.22 + .048 * hem - .052 * outer;
  return [
    x * horizontal + .004 * hem * Math.sin(5.1 * y + .1)
      + Math.sign(x) * folds * .24 * (1 - Math.abs(face)) * smooth(side, .12, .20),
    .95 * y - shoulderDrop + hemLift - neckOpening,
    z * (1 - .105 * hem) + face * (folds + edgePucker) + .003 * hem * Math.sin(12 * x + 4 * y),
  ];
}

// Transform normals by the cofactor of the sculpt's local Jacobian. This
// retains the source's smoothed split normals at seams and garment edges.
function shapedNormal(p,n) {
  const h=.00008;
  const derivatives=[0,1,2].map(axis=>{
    const lo=p.slice(),hi=p.slice();lo[axis]-=h;hi[axis]+=h;
    return add(shape(...hi),shape(...lo),-1);
  });
  const a=cross(derivatives[1],derivatives[2]),b=cross(derivatives[2],derivatives[0]),c=cross(derivatives[0],derivatives[1]);
  return normalize(a.map((v,i)=>n[0]*v+n[1]*b[i]+n[2]*c[i]));
}
const blank = name => ({name,points:[],normals:[],uv:[],shades:[],indices:[]});
const names=['Turned sleeve cuffs and lower hem','Front and right sleeve','Left sleeve and back side panel','Back body panel'];
// The original flat chest was aggressively decimated. Split long edges before
// shaping so a new crease bends the actual surface without angular facets.
function refine(panel) {
  for(let pass=0;pass<5;pass++){
    const next=[],edges=new Map();
    function midpoint(a,b){
      const y = (panel.points[a][1] + panel.points[b][1]) / 2;
      const edgeLimit = y < -.10 || y > .18 ? .0115 : .015;
      if (distance(panel.points[a],panel.points[b]) <= edgeLimit) return -1;
      const key=a<b ? a+':'+b : b+':'+a;
      if(edges.has(key))return edges.get(key);
      const m=panel.points.length;edges.set(key,m);
      panel.points.push(panel.points[a].map((v,k)=>(v+panel.points[b][k])/2));
      panel.normals.push(normalize(add(panel.normals[a],panel.normals[b])));
      return m;
    }
    for(let i=0;i<panel.indices.length;i+=3){
      const v=panel.indices.slice(i,i+3);
      const m=v.map((a,k)=>midpoint(a,v[(k+1)%3]));
      const split=m.filter(k=>k>=0).length;
      if(split===0){next.push(...v);continue;}
      if(split===3){next.push(v[0],m[0],m[2], m[0],v[1],m[1], m[2],m[1],v[2], m[0],m[1],m[2]);continue;}
      const r=m.findIndex(k=>split===1 ? k>=0 : k<0);
      const a=v[r], b=v[(r+1)%3], c=v[(r+2)%3];
      if(split===1)next.push(a,m[r],c, m[r],b,c);
      else{
        const bc=m[(r+1)%3], ca=m[(r+2)%3];
        next.push(c,ca,bc, a,b,bc, a,bc,ca);
      }
    }
    panel.indices=next;
    if(!edges.size)break;
  }
}
// Lay the repeat in garment space before the sculpt so the knit follows a
// fold. Unroll the torso and each sleeve separately, using arc length around
// their cross-sections to keep the yarn size even through the side views.
function arcLengthTable(halfWidth, halfDepth, repeats) {
  const arc = [0], segments = 256;
  for (let i = 0; i < segments; i++) {
    const angle = (i + .5) * TAU / segments - Math.PI;
    arc.push(arc[i] + Math.hypot(halfWidth * Math.cos(angle), halfDepth * Math.sin(angle)));
  }
  const total = arc[segments];
  return angle => {
    const sample = (angle / TAU + .5) * segments;
    const low = clamp(Math.floor(sample), 0, segments - 1);
    return (arc[low] + (arc[low + 1] - arc[low]) * (sample - low)) * repeats / total;
  };
}
const bodyRepeats = 28, sleeveRepeats = 10;
const bodyArc = arcLengthTable(.221, .137, bodyRepeats);
const sleeveArc = arcLengthTable(.066, .061, sleeveRepeats);

function clothUV(point, sleeve) {
  const [x, y, z] = point;
  if (!sleeve) {
    const angle = Math.atan2(x / .185, (z + .004) / .135);
    return [bodyArc(angle), y / .040];
  }
  const side = Math.abs(x), axisX = .263 - .35 * (y - .018);
  const axisZ = x < 0 ? -.033 : -.021;
  const angle = Math.atan2((side - axisX) / .055, (z - axisZ) / .068);
  const alongSleeve = .944 * y - .330 * (side - .180);
  return [sleeveArc(angle), alongSleeve / .040];
}

function grainCoordinates(source, mesh) {
  const baseChart = new Int8Array(source.points.length).fill(-1), duplicates = new Map();
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const indices = mesh.indices.slice(offset, offset + 3);
    const [a,b,c] = indices.map(i => source.points[i]);
    const x = (a[0] + b[0] + c[0]) / 3, y = (a[1] + b[1] + c[1]) / 3;
    const sleeve = y > -.055 && Math.abs(x) > .180 + .029 * smooth(y,.020,.265);
    const repeat = sleeve ? sleeveRepeats : bodyRepeats;
    const coords = indices.map(i => clothUV(source.points[i], sleeve));
    const across = coords.map(uv => uv[0]);
    const crossesSeam = Math.max(...across) - Math.min(...across) > .5 * repeat;
    for (let k = 0; k < 3; k++) {
      const index = indices[k], uv = coords[k];
      const wrap = crossesSeam && uv[0] < .5 * repeat;
      if (wrap) uv[0] += repeat;
      const chart = Number(sleeve) * 2 + Number(wrap);
      if (baseChart[index] === -1) {
        baseChart[index] = chart;
        mesh.uv[index] = uv;
      } else if (baseChart[index] !== chart) {
        const key = index * 4 + chart;
        if (!duplicates.has(key)) {
          duplicates.set(key, mesh.points.length);
          mesh.points.push(mesh.points[index]);
          mesh.normals.push(mesh.normals[index]);
          mesh.shades.push(mesh.shades[index]);
          mesh.uv.push(uv);
        }
        mesh.indices[offset + k] = duplicates.get(key);
      }
    }
  }
}

const built = panels.map((source, i) => {
  refine(source);
  const out = blank(names[i]);
  out.indices = source.indices.slice();
  for (let k = 0; k < source.points.length; k++) {
    const p = source.points[k], n = source.normals[k];
    out.points.push(shape(...p));
    out.normals.push(shapedNormal(p, n));
    out.shades.push(i === 0 ? .93 : 1);
    out.uv.push([0, 0]);
  }
  grainCoordinates(source, out);
  return out;
});

// Index high shoulder triangles in the XZ plane for conforming collar ribs
// and shoulder topstitching. Samples return the uppermost actual surface.
const cells=new Map(),step=.012;
const key=(x,z)=>Math.floor(x/step)+','+Math.floor(z/step);
for(const panel of panels)for(let i=0;i<panel.indices.length;i+=3){
  const tri=panel.indices.slice(i,i+3).map(k=>panel.points[k]);
  if(Math.max(...tri.map(p=>p[1]))<.18)continue;
  const xs=tri.map(p=>p[0]),zs=tri.map(p=>p[2]);
  for(let a=Math.floor(Math.min(...xs)/step);a<=Math.floor(Math.max(...xs)/step);a++)
    for(let b=Math.floor(Math.min(...zs)/step);b<=Math.floor(Math.max(...zs)/step);b++){
      const k=a+','+b;if(!cells.has(k))cells.set(k,[]);cells.get(k).push(tri);
    }
}
function surface(x,z) {
  let y=-Infinity;
  for(const [a,b,c] of cells.get(key(x,z))||[]){
    const dx=b[0]-a[0],dz=b[2]-a[2],ex=c[0]-a[0],ez=c[2]-a[2];
    const det=dx*ez-dz*ex;if(Math.abs(det)<1e-11)continue;
    const u=((x-a[0])*ez-(z-a[2])*ex)/det,v=(dx*(z-a[2])-dz*(x-a[0]))/det;
    if(u>=-.001&&v>=-.001&&u+v<=1.001)y=Math.max(y,a[1]+u*(b[1]-a[1])+v*(c[1]-a[1]));
  }
  return y;
}
function vertex(mesh,p,n,shade,u,v) {
  mesh.points.push(p);mesh.normals.push(n);mesh.uv.push([u,v]);mesh.shades.push(clamp(shade,0,1));
}
function quad(mesh,a,b,c,d){mesh.indices.push(a,b,c,a,c,d);}
function recompute(mesh){
  const normals=mesh.points.map(()=>[0,0,0]);
  for(let i=0;i<mesh.indices.length;i+=3){
    const [a,b,c]=mesh.indices.slice(i,i+3);
    const face=cross(add(mesh.points[b],mesh.points[a],-1),add(mesh.points[c],mesh.points[a],-1));
    for(const k of [a,b,c])normals[k]=add(normals[k],face);
  }
  mesh.normals=normals.map(normalize);
}

const collar=blank('Rib-knit neck binding');
const collarSegments=800, bands=13;
const centerZ=-.041;
for(let i=0;i<collarSegments;i++){
  const angle=i*TAU/collarSegments,cos=Math.cos(angle),sin=Math.sin(angle);
  let inner=.034;
  while (inner < .118 && surface(inner*cos,centerZ+inner*sin) < .245) inner += .00065;
  let lower = inner - .00065;
  for (let pass = 0; pass < 6; pass++) {
    const middle = (lower + inner) * .5;
    if (surface(middle*cos, centerZ+middle*sin) >= .245) inner = middle;
    else lower = middle;
  }
  for(let j=0;j<bands;j++){
    const across=j/(bands-1),r=inner+.0018+.019*across;
    const x=r*cos,z=centerZ+r*sin,sy=surface(x,z);
    if(!Number.isFinite(sy))throw Error('Could not fit neck binding to shoulder');
    const rib=.5+.5*Math.cos(angle*200);
    const lift=.0010+Math.sin(Math.PI*across)*(.0014+.00055*rib);
    const p=shape(x,sy+lift,z);
    vertex(collar,p,[0,1,0],.84+.065*rib,24*i/collarSegments,across*.48);
  }
}
for(let i=0;i<collarSegments;i++)for(let j=0;j<bands-1;j++){
  const a=i*bands+j,b=((i+1)%collarSegments)*bands+j;
  quad(collar,a,b,b+1,a+1);
}
recompute(collar); built.push(collar);

const stitches=blank('Twin needle hems and shoulder stitching');
// Interpolated actual surface contours with short, slightly proud thread segments.
function stitchLine(points,upVectors,closed=true) {
  let cursor=0;
  const lengths=[],segments=closed?points.length:points.length-1;
  for(let i=0;i<segments;i++){const len=distance(points[i],points[(i+1)%points.length]);lengths.push([cursor,len]);cursor+=len;}
  const count=Math.round(cursor/.00365);
  let segment=0;
  function at(s) {
    while(segment+1<segments && s>lengths[segment][0]+lengths[segment][1])segment++;
    const next=(segment+1)%points.length,t=clamp((s-lengths[segment][0])/lengths[segment][1],0,1);
    return [points[segment].map((v,k)=>v+(points[next][k]-v)*t),normalize(upVectors[segment].map((v,k)=>v+(upVectors[next][k]-v)*t))];
  }
  for(let i=0;i<count;i++){
    const [start,n]=at((i+.07)*cursor/count),[end]=at((i+.93)*cursor/count);
    const along=normalize(add(end,start,-1)),lateral=normalize(cross(n,along)),base=stitches.points.length;
    for(const [t,width,height] of [[0,.00015,.00016],[.20,.00041,.00052],[.82,.00041,.00052],[1,.00015,.00016]]){
      const center=start.map((v,k)=>v+(end[k]-v)*t);
      for(let s=0;s<4;s++){
        const a=s*TAU/4,radial=lateral.map((v,k)=>v*Math.cos(a)+n[k]*Math.sin(a));
        const pos=add(add(center,n,height),radial,width);
        vertex(stitches,pos,normalize(radial),.84+.12*Math.max(0,Math.sin(a)),i*.10+t*.1,s/4);
      }
    }
    for(let a=0;a<3;a++)for(let s=0;s<4;s++){
      const p=base+a*4+s,q=base+a*4+(s+1)%4;quad(stitches,p,q,q+4,p+4);
    }
  }
}
const collarPath = [], collarNormals = [];
for (let i = 0; i < collarSegments; i++) {
  const k = i * bands + bands - 2, n = collar.normals[k];
  collarPath.push(add(collar.points[k], n, .00018));
  collarNormals.push(n);
}
stitchLine(collarPath, collarNormals);

function shoulderSurface(x,z) {
  const y = surface(x,z);
  return Number.isFinite(y) ? shape(x,y,z) : null;
}
for (const sign of [-1,1]) {
  const shoulder = [], up = [], h = .00035;
  for (let i = 0; i <= 80; i++) {
    const t = i / 80, x = sign * (.105 + .109*t), z = -.034 + .016*t;
    const p = shoulderSurface(x,z), dx = shoulderSurface(x+h,z), dz = shoulderSurface(x,z+h);
    if (!p || !dx || !dz) continue;
    const n = normalize(cross(add(dz,p,-1),add(dx,p,-1)));
    shoulder.push(add(p,n,.00016));
    up.push(n);
  }
  stitchLine(shoulder,up,false);
}

// Intersect the finished cloth with radial planes. The outer surface can sit
// above the folded trim at a sewing line, so intersect the body panels too.
// Fitting both rows here prevents them from vanishing inside convex folds.
function hemRows(cx, cz, tilt, segments, includesSource, maxRadius) {
  const slices = Array.from({length: segments}, (_, i) => {
    const angle = (i + .5) * TAU / segments;
    return { cos: Math.cos(angle), sin: Math.sin(angle), lines: [], edge: Infinity };
  });
  const mix = (a, b, t) => a.map((v,k) => v + t * (b[k] - v));

  for (const [panelIndex, panel] of panels.entries()) {
    const mesh = built[panelIndex];
    for (let i = 0; i < panel.indices.length; i += 3) {
      const tri = panel.indices.slice(i, i + 3);
      if (!tri.some(k => includesSource(panel.points[k]))) continue;
      const points = tri.map(k => mesh.points[k]);
      const angles = points.map(p => Math.atan2(p[2] - cz, p[0] - cx));
      for (let k = 1; k < 3; k++) {
        if (angles[k] - angles[0] > Math.PI) angles[k] -= TAU;
        if (angles[k] - angles[0] < -Math.PI) angles[k] += TAU;
      }
      const first = Math.ceil(Math.min(...angles) * segments / TAU - .5);
      const last = Math.floor(Math.max(...angles) * segments / TAU - .5);
      for (let j = first; j <= last; j++) {
        const slice = slices[(j + segments) % segments];
        const sides = points.map(p => (p[2] - cz) * slice.cos - (p[0] - cx) * slice.sin);
        const hits = [];
        for (let k = 0; k < 3; k++) {
          const next = (k + 1) % 3;
          if ((sides[k] < 0) === (sides[next] < 0)) continue;
          const t = sides[k] / (sides[k] - sides[next]);
          const p = mix(points[k], points[next], t);
          const r = (p[0] - cx) * slice.cos + (p[2] - cz) * slice.sin;
          if (r <= 0 || r > maxRadius) continue;
          hits.push({ p, n: mix(mesh.normals[tri[k]], mesh.normals[tri[next]], t),
            r, h: p[1] - tilt * (p[0] - cx) });
        }
        if (hits.length !== 2) continue;
        slice.lines.push(hits);
        if (panelIndex === 0) slice.edge = Math.min(slice.edge, hits[0].h, hits[1].h);
      }
    }
  }
  for (const offset of [.0055, .011]) {
    const path = [], up = [];
    for (const slice of slices) {
      const h = slice.edge + offset;
      let radius = 0, surfacePoint, surfaceNormal;
      for (const [a,b] of slice.lines) {
        if ((a.h < h) === (b.h < h)) continue;
        const t = (h - a.h) / (b.h - a.h);
        const r = a.r + t * (b.r - a.r);
        if (r <= radius) continue;
        radius = r;
        surfacePoint = mix(a.p, b.p, t);
        surfaceNormal = normalize(mix(a.n, b.n, t));
      }
      if (!surfacePoint) throw Error('No cloth at hem stitch, centre ' + cx + ', offset ' + offset);
      // Normals at the overlap can point toward the inside of the hem.
      if (surfaceNormal[0] * slice.cos + surfaceNormal[2] * slice.sin < 0) {
        surfaceNormal = surfaceNormal.map(v => -v);
      }
      path.push(add(surfacePoint, surfaceNormal, .00016));
      up.push(surfaceNormal);
    }
    stitchLine(path, up);
  }
}
hemRows(0, -.003, 0, 650, p => p[1] < -.285, .30);
for (const sign of [-1,1]) {
  hemRows(sign * .308, sign < 0 ? -.033 : -.021, sign * .28, 280,
    p => p[0] * sign > .18 && p[1] > -.07 && p[1] < .105, .117);
}
built.push(stitches);
await writeGarment(new URL('field-tee-v2.glb',directory),built,MeshoptEncoder,directory);
console.log(built.map(m=>m.name+': '+m.points.length+' vertices').join('\n'));
