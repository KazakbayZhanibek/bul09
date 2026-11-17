let THREE, GLTFLoader, MeshoptDecoder;
const perf={started:0,modulesMs:null,modelTransferMs:null,modelParseMs:null,projectionPrepMs:null,firstModelFrameMs:null,firstPrintedFrameMs:null,textures:{},triangles:{front:0,back:0}};
let modelBytesPromise;
async function boot(){
 perf.started=Number.isFinite(window.__bulbulStart)?window.__bulbulStart:0;
 host.innerHTML='<p class="viewer-error" role="status">Подготавливаем 3D…</p>';
 const modelURL=host.dataset.modelSrc||'assets/models/edge-tee-plain.glb';
 modelBytesPromise=loadModelBytes(modelURL);
 // Observe rejection immediately while the dynamic modules are in flight.
 modelBytesPromise.catch(()=>{});
 try{const start=performance.now();const modules=await Promise.all([import('./assets/vendor/three.module.js'),import('./assets/vendor/GLTFLoader.js'),import('./assets/vendor/meshopt_decoder.module.js')]);THREE=modules[0];GLTFLoader=modules[1].GLTFLoader;MeshoptDecoder=modules[2].MeshoptDecoder;perf.modulesMs=performance.now()-start;init();}
 catch{host.innerHTML='<p class="viewer-error">Не удалось загрузить модуль 3D. Обновите страницу или используйте каталог.</p>';}
}
async function loadModelBytes(url){const start=performance.now(),res=await fetch(url);if(!res.ok)throw Error('model '+res.status);const length=Number(res.headers.get('content-length'))||0;const report=n=>{const label=length?'Модель: '+Math.min(100,Math.round(n/length*100))+'%':'Модель: '+(n/1048576).toFixed(1)+' МБ';const target=host.querySelector('[data-model-progress]')||host.querySelector('[role="status"]');if(target)target.textContent=label;};let buffer;if(res.body?.getReader){const reader=res.body.getReader(),chunks=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;chunks.push(value);size+=value.length;report(size);}const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}buffer=bytes.buffer;}else buffer=await res.arrayBuffer();perf.modelTransferMs=performance.now()-start;perf.modelBytes=buffer.byteLength;return buffer;}


/* Offline, mesh-based GLB preview. Geometry source attribution is shipped with
 * assets/models/ATTRIBUTION.txt. This is a garment visualization, not a scan of
 * the future BUL BUL CORP product. UV projection is derived from GLB axes and
 * independently checked Blender render: front +Z, back -Z, Y up, 0..0.76 m. */
const host = document.getElementById('shirt3d');
if(host){if('IntersectionObserver' in window){const lazy=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){lazy.disconnect();boot();}},{rootMargin:'240px'});lazy.observe(host);}else boot();}
function init() {
 const saved=readState();
 const state={id:saved.id||'horse',color:saved.color||0,rx:saved.rx??-.03,ry:saved.ry??Math.PI};
 const printPlacement={horse:{width:.34,cy:.49},leopard:{width:.32,cy:.48},eagle:{width:.35,cy:.49}};
 const models={horse:{back:'horse_back_traced.webp',front:'horse_chest.webp'},leopard:{back:'leopard_back.webp',front:'leopard_chest.webp'},eagle:{back:'eagle_back.webp',front:'eagle_chest.webp'}};
 let renderer;
 try { renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'}); }
 catch { host.innerHTML='<p class="viewer-error">3D недоступна в этом браузере. Исходные принты доступны в каталоге. Для вращения модели нужен WebGL.</p>'; return; }
 renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.setClearColor(0x202321,0);
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
 const canvas=renderer.domElement;host.replaceChildren(canvas);host.style.position='relative';canvas.style.cssText='display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab';canvas.tabIndex=0;canvas.setAttribute('role','img');canvas.setAttribute('aria-label','3D-футболка. Вращайте горизонтальным движением или клавишами со стрелками.');
 const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(30,1,.01,20);camera.position.set(0,0,1.8);
 scene.add(new THREE.HemisphereLight(0xe9f0e2,0x3b4136,2));
 for(const [color,intensity,x,y,z] of [[0xfff1db,3,-1.5,2.5,3],[0xd3e2f4,2,2,1,-2],[0xffffff,.7,-2,-1,-1]]){const l=new THREE.DirectionalLight(color,intensity);l.position.set(x,y,z);scene.add(l);}
 const pivot=new THREE.Group(),content=new THREE.Group(),paint=new THREE.Group();content.position.set(0,-.38,0);content.add(paint);pivot.add(content);scene.add(pivot);pivot.rotation.set(state.rx,state.ry,0);
 const fabric=new THREE.MeshStandardMaterial({color:0x252622,roughness:.94,metalness:0,side:THREE.DoubleSide});
 let sourceTriangles={front:[],back:[]},garment=null,projectionReady=false,appliedId=null,dirty=true,disposed=false,visible=true,drag=false,lastX=0,lastY=0,lastInput=0,lastTime=0,raf=0,modelFramePending=false,printFramePending=false,loadGeneration=0;
 const geometryCache=new Map(),textureCache=new Map(),pendingTextures=new Map();
 const mq=matchMedia('(prefers-reduced-motion: reduce)');let paused=mq.matches;
 const controls=document.createElement('div');controls.className='viewer-controls';controls.style.cssText='position:absolute;left:16px;right:16px;bottom:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;z-index:2';
 const pause=button(''),reset=button('Вид со спины'),front=button('Вид спереди');const status=document.createElement('span');status.setAttribute('role','status');status.dataset.modelProgress='';status.style.cssText='font:11px Arial;color:#c0c8b6;flex-basis:100%';status.textContent='Загружаем 3D-модель…';controls.append(pause,reset,front,status);host.append(controls);
 const diagnostic=document.createElement('details');diagnostic.style.cssText='position:absolute;top:10px;left:12px;right:12px;z-index:2;font:10px/1.5 monospace;color:#c0c8b6;pointer-events:auto';diagnostic.innerHTML='<summary style="cursor:pointer">Диагностика загрузки</summary><pre style="white-space:pre-wrap;background:#202321ed;padding:10px"></pre>';host.append(diagnostic);
 function metrics(){const ms=v=>v==null?'ожидание':Math.round(v)+' мс';diagnostic.querySelector('pre').textContent='Измерения текущего запуска: устройство, сеть и кеш влияют на результат.\nМодули: '+ms(perf.modulesMs)+'; модель (передача): '+ms(perf.modelTransferMs)+'\nGLB разбор: '+ms(perf.modelParseMs)+'; подготовка проекции: '+ms(perf.projectionPrepMs)+'\nПервый кадр модели: '+ms(perf.firstModelFrameMs)+'; с принтом: '+ms(perf.firstPrintedFrameMs)+' от старта страницы/inline timer.\nКадр: render + следующий rAF, не GPU/экранное измерение.\n'+Object.entries(perf.textures).map(([k,v])=>k+': '+ms(v)).join('\n');}metrics();
 function button(s){const b=document.createElement('button');b.type='button';b.textContent=s;b.style.cssText='background:#252b23;color:#e5eadb;border:1px solid #6e7864;padding:10px 12px;min-height:44px;font:12px Arial;cursor:pointer';return b;}
 function updatePause(){pause.textContent=paused?'Включить вращение':'Остановить вращение';pause.setAttribute('aria-pressed',String(!paused));}updatePause();
 pause.onclick=()=>{paused=!paused;updatePause();lastInput=performance.now();dirty=true};
 function setView(y){state.rx=-.03;state.ry=y;pivot.rotation.set(state.rx,state.ry,0);lastInput=performance.now();dirty=true;saveState();}
 reset.onclick=()=>setView(Math.PI);front.onclick=()=>setView(0);
 function motionChanged(){paused=mq.matches;updatePause();dirty=true;}mq.addEventListener('change',motionChanged);
 function getTexture(file){if(textureCache.has(file))return Promise.resolve(textureCache.get(file));if(pendingTextures.has(file))return pendingTextures.get(file);const start=performance.now();const promise=new Promise((resolve,reject)=>new THREE.TextureLoader().load('assets/prints/'+file,t=>{t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),4);if(disposed){t.dispose();reject(new Error('disposed'));return;}textureCache.set(file,t);pendingTextures.delete(file);perf.textures[file]=performance.now()-start;metrics();resolve(t)},undefined,e=>{pendingTextures.delete(file);reject(e)}));pendingTextures.set(file,promise);return promise;}
 function setProduct(id,c){if(!models[id])return;state.id=id;state.color=Math.max(0,Math.min(2,Number(c)||0));fabric.color.setHex([0x252622,0x5c6046,0xc3ae89][state.color]);dirty=true;saveState();if(appliedId===id){++loadGeneration;paint.children.forEach(m=>m.material.color.setHex(state.color===2?0x6e675b:0xffffff));return;}if(projectionReady)applyPrints();else{getTexture(models[id].back).catch(()=>{});getTexture(models[id].front).catch(()=>{});}}
 async function applyPrints(){const generation=++loadGeneration,id=state.id;status.textContent='Загружаем выбранный принт…';try{const [back,front]=await Promise.all([getTexture(models[id].back),getTexture(models[id].front)]);if(disposed||generation!==loadGeneration||state.id!==id)return;while(paint.children.length){const child=paint.children[0];child.material.dispose();paint.remove(child);}for(const [side,tex] of [['back',back],['front',front]]){const key=id+'-'+side;let geometry=geometryCache.get(key);if(!geometry){const width=side==='back'?printPlacement[id].width:.065,height=width*tex.image.height/tex.image.width;geometry=projectedGeometry(side,width,height,printPlacement[id].cy);geometryCache.set(key,geometry);}const material=new THREE.MeshStandardMaterial({map:tex,transparent:true,alphaTest:.04,depthWrite:false,roughness:.96,metalness:0,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,color:state.color===2?0x6e675b:0xffffff});const mesh=new THREE.Mesh(geometry,material);mesh.renderOrder=3;paint.add(mesh);}appliedId=id;status.textContent='Потяните в сторону, чтобы повернуть';dirty=true;}catch{if(!disposed&&generation===loadGeneration)status.textContent='Принт не загрузился. Выберите модель ещё раз или обновите страницу.';}}
 // Clips actual GLB triangles in an orthographic print rectangle. Every new
 // vertex stays on the garment triangle, including folds; there is no floating
 // rectangular card. Normals and front/back depth separate the two surfaces.
 function projectedGeometry(side,width,height,backCenter){const back=side==='back',cx=back?0:.11,cy=back?backCenter:.55,x0=cx-width/2,x1=cx+width/2,y0=cy-height/2,y1=cy+height/2,sign=back?-1:1;const pos=[],normal=[],uv=[];
  const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
  function clip(poly,axis,bound,greater){let out=[];for(let i=0;i<poly.length;i++){let a=poly[i],b=poly[(i+1)%poly.length],ina=greater?a[axis]>=bound:a[axis]<=bound,inb=greater?b[axis]>=bound:b[axis]<=bound;if(ina)out.push(a);if(ina!==inb)out.push(mix(a,b,(bound-a[axis])/(b[axis]-a[axis])));}return out;}
  for(const tri of sourceTriangles[side]){const meanZ=(tri[0][2]+tri[1][2]+tri[2][2])/3,meanNZ=(tri[0][5]+tri[1][5]+tri[2][5])/3;if(meanZ*sign<=0||meanNZ*sign<.15)continue;if(Math.max(...tri.map(p=>p[0]))<x0||Math.min(...tri.map(p=>p[0]))>x1||Math.max(...tri.map(p=>p[1]))<y0||Math.min(...tri.map(p=>p[1]))>y1)continue;let poly=clip(tri,0,x0,true);if(!poly.length)continue;poly=clip(poly,0,x1,false);if(!poly.length)continue;poly=clip(poly,1,y0,true);if(!poly.length)continue;poly=clip(poly,1,y1,false);for(let i=1;i<poly.length-1;i++)for(const v of [poly[0],poly[i],poly[i+1]]){const length=Math.hypot(v[3],v[4],v[5])||1,n=[v[3]/length,v[4]/length,v[5]/length];pos.push(v[0]+n[0]*.00035,v[1]+n[1]*.00035,v[2]+n[2]*.00035);normal.push(...n);uv.push(back?(x1-v[0])/width:(v[0]-x0)/width,(v[1]-y0)/height);}}
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normal,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.computeBoundingSphere();return geometry;}
 // Selected art begins loading with the model, never all six PNGs up front.
 getTexture(models[state.id].back).catch(()=>{});getTexture(models[state.id].front).catch(()=>{});
 modelBytesPromise.then(async bytes=>{const parseStart=performance.now();const gltf=await new Promise((resolve,reject)=>new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(bytes,'',resolve,reject));perf.modelParseMs=performance.now()-parseStart;if(disposed)return;garment=gltf.scene;garment.updateMatrixWorld(true);const meshes=[];garment.traverse(obj=>{if(obj.isMesh)meshes.push(obj)});
 const prepStart=performance.now();
 for(const obj of meshes){const g=obj.geometry,p=g.attributes.position,n=g.attributes.normal,index=g.index,normalMatrix=new THREE.Matrix3().getNormalMatrix(obj.matrixWorld);const vertex=i=>{const v=new THREE.Vector3().fromBufferAttribute(p,i).applyMatrix4(obj.matrixWorld),nn=n?new THREE.Vector3().fromBufferAttribute(n,i).applyMatrix3(normalMatrix).normalize():new THREE.Vector3(0,0,1);return[v.x,v.y,v.z,nn.x,nn.y,nn.z]};
 // Store only the two maximum print regions, not every clothing triangle.
 for(let k=0;k<(index?index.count:p.count);k+=3){const tri=[vertex(index?index.getX(k):k),vertex(index?index.getX(k+1):k+1),vertex(index?index.getX(k+2):k+2)];const x0=Math.min(tri[0][0],tri[1][0],tri[2][0]),x1=Math.max(tri[0][0],tri[1][0],tri[2][0]),y0=Math.min(tri[0][1],tri[1][1],tri[2][1]),y1=Math.max(tri[0][1],tri[1][1],tri[2][1]),z=(tri[0][2]+tri[1][2]+tri[2][2])/3,nz=(tri[0][5]+tri[1][5]+tri[2][5])/3;
 if(z<0&&nz<-.15&&x1>=-.185&&x0<=.185&&y1>=.29&&y0<=.68)sourceTriangles.back.push(tri);
 if(z>0&&nz>.15&&x1>=.0775&&x0<=.1425&&y1>=.51&&y0<=.59)sourceTriangles.front.push(tri);
 if(k>0&&k%12000===0)await new Promise(resolve=>setTimeout(resolve,0));if(disposed)return;}
 const old=Array.isArray(obj.material)?obj.material:[obj.material];old.forEach(m=>m?.dispose());obj.material=fabric;}
 perf.projectionPrepMs=performance.now()-prepStart;perf.triangles.front=sourceTriangles.front.length;perf.triangles.back=sourceTriangles.back.length;content.add(garment);projectionReady=true;metrics();setProduct(state.id,state.color);dirty=true;
 }).catch(()=>{if(!disposed)status.textContent='Не удалось загрузить 3D-модель. Обновите страницу или используйте каталог.';});
 canvas.addEventListener('pointerdown',e=>{drag=true;lastX=e.clientX;lastY=e.clientY;lastInput=performance.now();canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing'});
 canvas.addEventListener('pointermove',e=>{if(!drag)return;state.ry+=(e.clientX-lastX)*.009;state.rx=THREE.MathUtils.clamp(state.rx+(e.clientY-lastY)*.004,-.35,.35);pivot.rotation.set(state.rx,state.ry,0);lastX=e.clientX;lastY=e.clientY;lastInput=performance.now();dirty=true;});
 function release(){drag=false;canvas.style.cursor='grab';lastInput=performance.now();saveState();}canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
 canvas.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();if(e.key==='ArrowLeft')state.ry-=.15;if(e.key==='ArrowRight')state.ry+=.15;if(e.key==='ArrowUp')state.rx=Math.max(-.35,state.rx-.08);if(e.key==='ArrowDown')state.rx=Math.min(.35,state.rx+.08);pivot.rotation.set(state.rx,state.ry,0);lastInput=performance.now();dirty=true;saveState();});
 const ro=new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);camera.aspect=w/h;const vertical=.86/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))),horizontal=.82/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect);camera.position.z=Math.max(vertical,horizontal);camera.updateProjectionMatrix();dirty=true;});ro.observe(host);
 const io=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;dirty=true;},{threshold:.01});io.observe(host);
 function loop(t){if(disposed)return;raf=requestAnimationFrame(loop);const dt=Math.min((t-lastTime)/1000,.05);lastTime=t;if(!visible||document.hidden)return;if(!paused&&!drag&&t-lastInput>2500&&garment){state.ry+=dt*.12;pivot.rotation.y=state.ry;dirty=true;}if(dirty){renderer.render(scene,camera);if(garment&&projectionReady&&perf.firstModelFrameMs==null&&!modelFramePending){modelFramePending=true;requestAnimationFrame(()=>{if(disposed)return;perf.firstModelFrameMs=performance.now()-perf.started;metrics();});}if(paint.children.length&&perf.firstPrintedFrameMs==null&&!printFramePending){printFramePending=true;requestAnimationFrame(()=>{if(disposed)return;perf.firstPrintedFrameMs=performance.now()-perf.started;metrics();});}dirty=false;}}raf=requestAnimationFrame(loop);
 function saveState(){try{sessionStorage.setItem('bulbul3d-selection',JSON.stringify(state));}catch{}}
 window.Bulbul3D={setProduct,getState:()=>({...state}),getPerformance:()=>structuredClone(perf),dispose(){saveState();disposed=true;++loadGeneration;cancelAnimationFrame(raf);ro.disconnect();io.disconnect();mq.removeEventListener('change',motionChanged);scene.traverse(o=>{o.geometry?.dispose();if(o.material&&o.material!==fabric)o.material.dispose()});fabric.dispose();textureCache.forEach(t=>t.dispose());geometryCache.forEach(g=>g.dispose());renderer.dispose();canvas.remove();controls.remove();diagnostic.remove();}};
 window.dispatchEvent(new CustomEvent('bulbul3dready',{detail:{...state}}));
}
function readState(){try{const s=JSON.parse(sessionStorage.getItem('bulbul3d-selection')||'{}');return ['horse','leopard','eagle'].includes(s.id)&&Number.isFinite(s.rx)&&Number.isFinite(s.ry)?s:{};}catch{return {};}}
