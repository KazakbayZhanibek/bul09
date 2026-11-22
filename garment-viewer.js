// Three.js, GLTFLoader and the meshopt decoder are bundled locally for offline hosting.
import { THREE, GLTFLoader, MeshoptDecoder } from './viewer3d-fixed.min.js';

const host = document.getElementById('shirt3d');
if (host) mount(host);

function mount(host) {
  const perf = {started:performance.now(),modelBytes:0,modelTransferMs:null,modelParseMs:null,
    firstModelFrameMs:null,firstPrintedFrameMs:null,textures:{}};
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true, powerPreference:'low-power' });
  } catch {
    host.innerHTML = '<p class="viewer-error">В браузере недоступен WebGL.</p>';
    window.dispatchEvent(new Event('bulbul3derror'));
    return;
  }
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('role','img');
  canvas.setAttribute('aria-label','3D-модель футболки. Вращайте пальцем, мышью или клавишами со стрелками.');
  host.replaceChildren(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));
  renderer.setClearColor(0xddd9cb,0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;

  const controls = document.createElement('div');
  controls.className = 'viewer-controls';
  const makeButton = label => {
    const button = document.createElement('button'); button.type = 'button';
    button.textContent = label; controls.append(button); return button;
  };
  const rotation = makeButton('Автовращение'),back = makeButton('Со спины'),front = makeButton('Спереди');
  const status = document.createElement('span');
  status.setAttribute('role','status'); status.dataset.modelProgress = '';
  status.textContent = 'Загружаем модель…'; controls.append(status); host.append(controls);

  const state = {id:'horse',color:1,rx:-.045,ry:Math.PI,detail:false,inspection:'print'};
  try {
    const saved = JSON.parse(sessionStorage.getItem('bulbul3d-selection') || '{}');
    if(Number.isFinite(saved.rx) && Number.isFinite(saved.ry)){
      state.rx=THREE.MathUtils.clamp(saved.rx,-.48,.48); state.ry=saved.ry;
    }
  } catch {}
  const scene = new THREE.Scene(), pivot = new THREE.Group();
  scene.add(pivot); pivot.rotation.set(state.rx,state.ry,0);
  const camera = new THREE.PerspectiveCamera(28,1,.01,15);
  scene.add(new THREE.HemisphereLight(0xfffaf2, 0xb9aa98, 1.35));
  // A sideways key resolves knit relief. Diffuse bounce from the right keeps
  // the shadowed inside of the sleeve in the same tonal range as the packshots.
  const lights = [
    [0xfff1df, 2.5, -3.2, 2.5, 2.0],
    [0xe1e7ef, 0.75, 2.1, 0.5, 2.7],
    [0xf7ead6, 1.45, 1.9, 1.9, -2.7],
  ];
  for(const [color,intensity,x,y,z] of lights) {
    const lamp = new THREE.DirectionalLight(color,intensity); lamp.position.set(x,y,z); scene.add(lamp);
  }
  const shadowCanvas=document.createElement('canvas');
  shadowCanvas.width=128;shadowCanvas.height=64;
  const ctx=shadowCanvas.getContext('2d');
  ctx.scale(2,1);
  const gradient=ctx.createRadialGradient(32,32,0,32,32,32);
  gradient.addColorStop(0,'rgba(28,22,15,.24)');
  gradient.addColorStop(.55,'rgba(28,22,15,.10)');
  gradient.addColorStop(1,'rgba(28,22,15,0)');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
  const shadowTexture=new THREE.CanvasTexture(shadowCanvas);
  const shadow=new THREE.Sprite(new THREE.SpriteMaterial({map:shadowTexture,transparent:true,depthWrite:false,toneMapped:false}));
  shadow.position.set(0,-.354,0);shadow.scale.set(.54,.032,1);shadow.renderOrder=-1;scene.add(shadow);

  const uniform = {
    backInk:{value:null},frontInk:{value:null},backRect:{value:new THREE.Vector4()},frontRect:{value:new THREE.Vector4()},
    inkTone:{value:new THREE.Color(1,1,1)},hasPrint:{value:0},
    cottonDyeMean: { value: new THREE.Color(0xe3e3e3).r },
  };
  const bodyColors = [0x2c2d2a,0x62644d,0xbda787];
  const designFiles = {
    horse:['horse_back_traced.webp','horse_chest.webp'],
    leopard:['leopard_back.webp','leopard_chest.webp'],
    eagle:['eagle_back.webp','eagle_chest.webp'],
  };
  const textures = new Map();
  let fabric, garment, dirty=true, generation=0, disposed=false, frame=0, contextLost=false, presented=false;
  let requestedPrint='', activePrint='', pendingFrame=false, visible=true, drag=null, lastInput=performance.now(), lastTime=0;
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let paused=reducedMotion.matches;
  function invalidate() {
    dirty=true;
    if(!frame&&!disposed&&visible&&!document.hidden&&!contextLost)frame=requestAnimationFrame(loop);
  }
  function reportFailure(message){
    presented=false;status.textContent=message;
    window.dispatchEvent(new CustomEvent('bulbul3derror',{detail:{id:state.id}}));
  }

  // The inks are sampled on the same fragments as the cotton. Normal/roughness
  // lighting continues through the artwork, even at oblique angles or close up.
  function addPrintLayer(material) {
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms,uniform);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `
        #include <common>
        varying vec3 garmentPoint;
        varying vec3 garmentDirection;`)
        .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        garmentPoint = position * 0.00002;
        garmentDirection = normal;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
        #include <common>
        varying vec3 garmentPoint;
        varying vec3 garmentDirection;
        uniform sampler2D backInk;
        uniform sampler2D frontInk;
        uniform vec4 backRect;
        uniform vec4 frontRect;
        uniform vec3 inkTone;
        uniform float hasPrint;
        uniform float cottonDyeMean;`)
        .replace('#include <color_fragment>', `
        #include <color_fragment>
        float inkCoverage = 0.0;
        if (hasPrint > 0.5) {
          bool rear = garmentPoint.z < 0.0;
          vec4 region = rear ? backRect : frontRect;
          vec2 printUV = (garmentPoint.xy - region.xy) / region.zw + 0.5;
          if (rear) printUV.x = 1.0 - printUV.x;
          float facing = rear ? -garmentDirection.z : garmentDirection.z;
          if (facing > 0.16 && all(greaterThanEqual(printUV,vec2(0.0))) && all(lessThanEqual(printUV,vec2(1.0)))) {
            vec4 ink = rear ? texture2D(backInk,printUV) : texture2D(frontInk,printUV);
            float palePigment = smoothstep(0.28, 0.49, ink.r) *
              (1.0 - smoothstep(0.36, 0.68, (ink.r - ink.g) / max(ink.r,0.001)));
            vec3 printColor = mix(ink.rgb, ink.rgb * inkTone, palePigment);
            // The same yarn relief continues underneath the screenprint. Ink
            // sits on the crowns while a little dye shows through the valleys.
            float yarn = 1.0;
            #ifdef USE_MAP
              yarn = sampledDiffuseColor.g / cottonDyeMean;
            #endif
            inkCoverage = ink.a * mix(0.87, 0.985, smoothstep(0.76, 1.07, yarn));
            printColor *= mix(1.0, yarn, 0.48);
            diffuseColor.rgb = mix(diffuseColor.rgb, printColor, inkCoverage);
          }
        }`)
        .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.86, inkCoverage * 0.72);`);
    };
    material.customProgramCacheKey=()=> 'bulbul-jersey-ink-v2';
  }
  function loadInk(file) {
    if (textures.has(file)) return textures.get(file);
    const started=performance.now();
    const promise=new THREE.TextureLoader().loadAsync('assets/models/prints/'+file).then(texture=>{
      if(disposed){texture.dispose();throw Error('Viewer disposed');}
      texture.colorSpace=THREE.SRGBColorSpace;
      texture.anisotropy=Math.min(renderer.capabilities.getMaxAnisotropy(),8);
      perf.textures[file]=performance.now()-started;
      return texture;
    }).catch(error=>{textures.delete(file);throw error;});
    textures.set(file,promise);return promise;
  }
  function save() {
    try { sessionStorage.setItem('bulbul3d-selection',JSON.stringify(state)); } catch {}
  }
  function updateColor() {
    if (fabric) {
      fabric.color.setHex(bodyColors[state.color]);
      if (fabric.map) fabric.color.multiplyScalar(1 / uniform.cottonDyeMean.value);
    }
    uniform.inkTone.value.setHex(state.color===2 ? 0x776757 : 0xffffff);
    invalidate();
  }
  function setProduct(id,color) {
    if (!Object.hasOwn(designFiles,id)) return;
    state.id=id;state.color=THREE.MathUtils.clamp(Number(color)||0,0,2);
    updateColor();save();
    if(activePrint===id){
      if(requestedPrint!==id){generation++;requestedPrint=id;}
      uniform.hasPrint.value=1;invalidate();
      return;
    }
    if(requestedPrint===id)return;
    const ticket=++generation;requestedPrint=id;presented=false;
    uniform.hasPrint.value=0;
    status.textContent='Загружаем выбранный принт…';
    Promise.all(designFiles[id].map(loadInk)).then(([rear,face])=>{
      if(disposed||ticket!==generation)return;
      // Bounding boxes in garment-local metres, measured on the remodeled shirt.
      const width=id==='eagle' ? .313 : .306, chest=.067;
      uniform.backRect.value.set(0,.076,width,width*rear.image.height/rear.image.width);
      uniform.frontRect.value.set(.114,.147,chest,chest*face.image.height/face.image.width);
      uniform.backInk.value=rear;uniform.frontInk.value=face;uniform.hasPrint.value=1;
      activePrint=id;invalidate();
    }).catch(()=>{
      if(ticket===generation&&!disposed){requestedPrint='';reportFailure('Принт не загрузился.');}
    });
  }

  // Camera windows are measured in metres across the front of the garment.
  const windows = {
    full: { width: .88, height: .81, y: 0 },
    print: { width: .40, height: .41, y: .077 },
    fabric: { width: .16, height: .13, y: -.214 },
    collar: { width: .33, height: .19, y: .283 },
    hem: { width: .28, height: .15, y: -.289 },
  };
  function frameCamera() {
    const frame = windows[state.detail ? state.inspection : 'full'];
    let {width, height, y} = frame;
    // The lower flank catches both the jersey loops and the turn of a fold.
    let x = state.detail && state.inspection === 'fabric' ? -.105 : 0;
    if (state.detail) {
      if (state.inspection === 'print') {
        // The chest mark is smaller and sits off-centre. Track it through a turn.
        const direction = Math.cos(state.ry);
        const front = THREE.MathUtils.smoothstep(direction, 0, .88);
        x = .114 * front * direction;
        y += .07 * front;
        width -= .22 * front;
        height -= .21 * front;
      }
      y = y * Math.cos(state.rx) - .135 * Math.sin(state.rx);
    }
    const tangent = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(height, width / camera.aspect) / tangent;
    camera.position.set(x, y, distance + .145);
    camera.lookAt(x, y, 0);
    shadow.visible = !state.detail;
  }
  function syncCamera() {
    const width = host.clientWidth, height = host.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frameCamera();
    invalidate();
  }
  function setSide(which){
    state.rx=-.045;state.ry=which==='front'?0:Math.PI;
    pivot.rotation.set(state.rx,state.ry,0);lastInput=performance.now();frameCamera();invalidate();save();
  }
  let resumeAfterDetail = false;
  function setDetail(enabled) {
    if (state.detail === enabled) return;
    state.detail = Boolean(enabled);
    if (state.detail) {
      resumeAfterDetail = !paused;
      paused = true;
    } else if (resumeAfterDetail) {
      paused = false;
      resumeAfterDetail = false;
    }
    showRotation();
    lastInput = performance.now();
    frameCamera();
    invalidate();
  }
  function setInspection(area) {
    if (!Object.hasOwn(windows, area) || area === 'full') return;
    state.inspection = area;
    frameCamera();
    invalidate();
  }
  back.onclick=()=>setSide('back');front.onclick=()=>setSide('front');
  function showRotation(){rotation.textContent=paused?'Включить вращение':'Остановить вращение';rotation.setAttribute('aria-pressed',String(!paused));}
  function motionChanged(){resumeAfterDetail=false;paused=reducedMotion.matches||state.detail;showRotation();invalidate();}
  showRotation();reducedMotion.addEventListener('change',motionChanged);
  rotation.onclick=()=>{resumeAfterDetail=false;paused=!paused;lastInput=performance.now();showRotation();invalidate();};
  function turn(dx,dy){
    state.ry+=dx;state.rx=THREE.MathUtils.clamp(state.rx+dy,-.48,.48);
    pivot.rotation.set(state.rx,state.ry,0);if(state.detail)frameCamera();lastInput=performance.now();invalidate();
  }
  canvas.addEventListener('pointerdown',e=>{
    if(!e.isPrimary)return;
    drag={id:e.pointerId,x:e.clientX,y:e.clientY};
    canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';
  });
  canvas.addEventListener('pointermove',e=>{
    if(!drag||drag.id!==e.pointerId)return;
    turn((e.clientX-drag.x)*.009,(e.clientY-drag.y)*.004);drag.x=e.clientX;drag.y=e.clientY;
  });
  function release(){drag=null;canvas.style.cursor='grab';lastInput=performance.now();invalidate();save();}
  canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);
  canvas.addEventListener('keydown',e=>{
    const delta={ArrowRight:[.15,0],ArrowLeft:[-.15,0],ArrowDown:[0,.08],ArrowUp:[0,-.08]}[e.key];
    if(delta){e.preventDefault();turn(...delta);save();}
  });
  const resizer=new ResizeObserver(syncCamera);resizer.observe(host);syncCamera();
  const observer='IntersectionObserver' in window ? new IntersectionObserver(entries=>{
    visible=entries[0].isIntersecting;
    if(visible)invalidate();
  }) : null;
  observer?.observe(host);
  document.addEventListener('visibilitychange',invalidate);

  async function loadModel(){
    const t=performance.now();
    const response=await fetch(host.dataset.modelSrc);
    if(!response.ok)throw Error('Garment '+response.status);
    const buffer=await response.arrayBuffer();perf.modelBytes=buffer.byteLength;perf.modelTransferMs=performance.now()-t;
    const start=performance.now();
    const gltf=await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(buffer,'');
    perf.modelParseMs=performance.now()-start;
    if(disposed)return;
    garment=gltf.scene;garment.position.set(-.006025,-1.275451,.002473);
    garment.traverse(node=>{
      if(!node.isMesh)return;
      if(!fabric){
        fabric=node.material;addPrintLayer(fabric);
        for (const texture of [fabric.map, fabric.normalMap, fabric.roughnessMap]) {
          if (texture) texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
        }
      }
    });
    updateColor();pivot.add(garment);invalidate();
  }
  function loop(time){
    frame=0;
    if(disposed||contextLost)return;
    const dt=Math.min(.05,Math.max(0,(time-lastTime)/1000));lastTime=time;
    if(!visible||document.hidden)return;
    if(!paused&&!drag&&garment)frame=requestAnimationFrame(loop);
    if(!paused&&!drag&&time-lastInput>2500&&garment){state.ry+=dt*.12;pivot.rotation.y=state.ry;if(state.detail)frameCamera();dirty=true;}
    if(!dirty)return;
    renderer.render(scene,camera);dirty=false;
    if(!garment)return;
    if(perf.firstModelFrameMs===null)perf.firstModelFrameMs=performance.now()-perf.started;
    if(activePrint===state.id&&!presented&&!pendingFrame){
      const paintedId=activePrint;
      pendingFrame=true;
      requestAnimationFrame(()=>{
        pendingFrame=false;
        if(disposed||contextLost||renderer.getContext().isContextLost())return;
        if(paintedId!==state.id||paintedId!==activePrint){invalidate();return;}
        presented=true;
        status.textContent='Потяните в сторону, чтобы повернуть';
        if(perf.firstPrintedFrameMs===null){
          perf.firstPrintedFrameMs=performance.now()-perf.started;
          window.dispatchEvent(new CustomEvent('bulbul3dfirstframe',{detail:{...state}}));
        }
        window.dispatchEvent(new CustomEvent('bulbul3dpresented',{detail:{...state}}));
      });
    }
  }
  window.Bulbul3D={
    setProduct,setSide,setDetail,setInspection,getState:()=>({...state}),getPerformance:()=>structuredClone(perf),
    dispose(){
      disposed=true;generation++;save();cancelAnimationFrame(frame);resizer.disconnect();observer?.disconnect();
      reducedMotion.removeEventListener('change',motionChanged);
      document.removeEventListener('visibilitychange',invalidate);
      shadow.material.dispose();shadowTexture.dispose();
      garment?.traverse(obj=>obj.geometry?.dispose());fabric?.map?.dispose();fabric?.normalMap?.dispose();fabric?.roughnessMap?.dispose();fabric?.dispose();
      for(const promise of textures.values())promise.then(t=>t.dispose()).catch(()=>{});
      renderer.dispose();canvas.remove();controls.remove();
    },
  };
  canvas.addEventListener('webglcontextlost',()=>{contextLost=true;reportFailure('Потеряно соединение с графическим устройством.');});
  canvas.addEventListener('webglcontextrestored',()=>{contextLost=false;invalidate();});
  window.dispatchEvent(new CustomEvent('bulbul3dready',{detail:{...state}}));
  loadModel().catch(error=>{
    if(!disposed){console.warn('3D garment could not load', error);reportFailure('Не удалось загрузить 3D-модель.');}
  });
  invalidate();
}
