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

// A relaxed box cut with dropped shoulders. Each drape is defined in metres,
// allowing continuous folds across the four separately indexed source panels.
function shape(x,y,z) {
  const side=Math.abs(x), face=Math.tanh(z/.045);
  const hem=1-smooth(y,-.30,.10), outer=smooth(side,.155,.305);
  const back=z<0 ? 1 : 0;
  let fold=0;
  // Uneven vertical folds released from the chest into the lower body.
  for (const [center,amplitude,bend,width] of [
    [-.155,.020,.040,.022],[-.086,-.013,-.027,.025],[-.034,.011,.028,.028],
    [.047,-.017,.040,.026],[.112,.024,-.045,.024],[.159,-.014,.020,.018],
  ]) {
    const track=center + bend*(y+.3) + .013*Math.sin(6*y+center*19+back*.9);
    fold += amplitude * bell((x-track)/width);
  }
  fold *= (.52+hem*.93)*(1-smooth(y,.06,.29));
  // Pull lines at the lower armhole, fading across the printed chest.
  const underarm = smooth(side,.073,.165) * (1-smooth(side,.195,.25));
  const slope = .65*(side-.14) + (x>0 ? .009 : -.008) + back*.012;
  fold += underarm*(.009*bell((y-.053-slope)/.030)-.008*bell((y-.006-slope)/.026)
    +.006*bell((y+.044-slope)/.038));
  // Raised sleeve folds run diagonally away from the armscye.
  const sleeve=smooth(side,.183,.275);
  fold += sleeve*(.007*Math.sin(37*y+13*x+back*.8)+.003*Math.sin(65*y-21*x));
  const shoulderDrop=.044*outer*smooth(y,-.09,.04);
  const width=1.22 + .052*hem - .055*outer;
  const taper=1-.115*hem;
  const hemWave=(.007*Math.sin(19*x+.8)+.0055*Math.sin(39*x-1.3)+.0045*face)
    *(1-smooth(y,-.32,-.015));
  return [
    x*width + .008*hem*Math.sin(6*y+.2),
    .951*y - shoulderDrop + hemWave,
    z*taper + face*fold + .008*hem*Math.sin(13*x+5*y),
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
      if(distance(panel.points[a],panel.points[b])<=.018)return -1;
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
const built=panels.map((source,i)=>{
  refine(source);
  const out=blank(names[i]);out.indices=source.indices.slice();
  for(let k=0;k<source.points.length;k++) {
    const p=source.points[k],n=source.normals[k],w=shape(...p);
    out.points.push(w);out.normals.push(shapedNormal(p,n));out.shades.push(i===0?.93:1);
    const angle=Math.atan2(w[0],w[2]*1.38);
    out.uv.push([(angle/TAU+.5)*30,w[1]/.040]);
  }
  // Split the cylindrical UV seam so no triangle interpolates through a full circumference.
  const duplicates=new Map();
  for(let k=0;k<out.indices.length;k+=3){
    const tri=out.indices.slice(k,k+3),coords=tri.map(j=>out.uv[j][0]);
    if(Math.max(...coords)-Math.min(...coords)<15) continue;
    for(let c=0;c<3;c++){
      const v=tri[c];if(coords[c]>15)continue;
      if(!duplicates.has(v)){
        duplicates.set(v,out.points.length);out.points.push(out.points[v]);out.normals.push(out.normals[v]);
        out.shades.push(out.shades[v]);out.uv.push([out.uv[v][0]+30,out.uv[v][1]]);
      }
      out.indices[k+c]=duplicates.get(v);
    }
  }
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
const collarPath=[], collarSegments=480, bands=11;
const centerZ=-.041;
for(let i=0;i<collarSegments;i++){
  const angle=i*TAU/collarSegments,cos=Math.cos(angle),sin=Math.sin(angle);
  let inner=.034;
  while(inner<.118 && surface(inner*cos,centerZ+inner*sin)<.245) inner+=.00065;
  for(let j=0;j<bands;j++){
    const across=j/(bands-1),r=inner+.0018+.019*across;
    const x=r*cos,z=centerZ+r*sin,sy=surface(x,z);
    if(!Number.isFinite(sy))throw Error('Could not fit neck binding to shoulder');
    const rib=.5+.5*Math.cos(angle*120);
    const lift=.0007+Math.sin(Math.PI*across)*(.0018+.0011*rib);
    const p=shape(x,sy+lift,z);
    vertex(collar,p,[0,1,0],.73+.15*rib,i/20,j/28);
    if(j===bands-1)collarPath.push(p);
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
  const count=Math.round(cursor/.0043);
  let segment=0;
  function at(s) {
    while(segment+1<segments && s>lengths[segment][0]+lengths[segment][1])segment++;
    const next=(segment+1)%points.length,t=clamp((s-lengths[segment][0])/lengths[segment][1],0,1);
    return [points[segment].map((v,k)=>v+(points[next][k]-v)*t),normalize(upVectors[segment].map((v,k)=>v+(upVectors[next][k]-v)*t))];
  }
  for(let i=0;i<count;i++){
    const [start,n]=at((i+.07)*cursor/count),[end]=at((i+.93)*cursor/count);
    const along=normalize(add(end,start,-1)),lateral=normalize(cross(n,along)),base=stitches.points.length;
    for(const [t,width,height] of [[0,.00019,.00020],[.20,.00055,.00077],[.82,.00055,.00077],[1,.00019,.00020]]){
      const center=start.map((v,k)=>v+(end[k]-v)*t);
      for(let s=0;s<4;s++){
        const a=s*TAU/4,radial=lateral.map((v,k)=>v*Math.cos(a)+n[k]*Math.sin(a));
        const pos=add(add(center,n,height),radial,width);
        vertex(stitches,pos,normalize(radial),.66+.14*Math.max(0,Math.sin(a)),i*.10+t*.1,s/4);
      }
    }
    for(let a=0;a<3;a++)for(let s=0;s<4;s++){
      const p=base+a*4+s,q=base+a*4+(s+1)%4;quad(stitches,p,q,q+4,p+4);
    }
  }
}
stitchLine(collarPath,collarPath.map(()=>[0,1,0]));
for (const sign of [-1,1]){
  const shoulder=[],up=[];
  for(let i=0;i<=55;i++){
    const t=i/55,x=sign*(.105+.109*t),z=-.034+.016*t,sy=surface(x,z);
    if(!Number.isFinite(sy))continue;
    shoulder.push(shape(x,sy+.001,z));up.push([0,1,0]);
  }
  stitchLine(shoulder,up,false);
}

// Reuse the source's actual hem and cuff openings. Angular bins locate the
// lowest cloth and its nearest outward-facing point for each row of thread.
function hemRows(vertices,xc,zc,tilt) {
  const bins=Array.from({length:144},()=>[]);
  for(const [p,n] of vertices){
    const a=(Math.atan2(p[2]-zc,p[0]-xc)+TAU)%TAU;
    bins[Math.floor(a/TAU*bins.length)%bins.length].push({p,n,h:p[1]-tilt*(p[0]-xc)});
  }
  const occupied=bins.map((bin,i)=>({i,bin})).filter(x=>x.bin.length);
  for(const offset of [.006,.012]){
    let path=[],up=[];
    for(const {i} of occupied){
      const candidates=[...bins[(i+143)%144],...bins[i],...bins[(i+1)%144]];
      const min=Math.min(...candidates.map(k=>k.h));
      const a=(i+.5)*TAU/144,dir=[Math.cos(a),0,Math.sin(a)];
      let best=null,score=Infinity;
      for(const v of candidates){
        const b=Math.atan2(v.p[2]-zc,v.p[0]-xc);
        const error=Math.abs(v.h-min-offset)+.018*(1-Math.cos(a-b))+.003*(1-dot(v.n,dir));
        if(error<score){score=error;best=v;}
      }
      const n=shapedNormal(best.p,best.n);
      path.push(add(shape(...best.p),n,.0008));up.push(n);
    }
    for(let pass=0;pass<3;pass++){
      path=path.map((p,k)=>p.map((v,j)=>(2*v+path[(k+1)%path.length][j]+path[(k+path.length-1)%path.length][j])/4));
    }
    stitchLine(path,up);
  }
}
const trim=panels[0].points.map((p,k)=>[p,panels[0].normals[k]]);
hemRows(trim.filter(([p])=>p[1]<-.295),0,0,0);
for(const sign of [-1,1])hemRows(trim.filter(([p])=>p[0]*sign>.19 && p[1]>-.06),sign*.261,sign===1?-.021:-.034,sign*.45);
built.push(stitches);
await writeGarment(new URL('field-tee.glb',directory),built,MeshoptEncoder,directory);
console.log(built.map(m=>m.name+': '+m.points.length+' vertices').join('\n'));
