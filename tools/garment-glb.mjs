// glTF IO for the authored garment. Input panels have meshopt-compressed
// normalized signed-short positions; output coordinates use 20 µm per unit.
import { readFile, writeFile } from 'node:fs/promises';

export const origin = [.006025, 1.275451, -.002473];
export const unit = .00002;

export async function readPanels(file, decoder) {
  const bytes = await readFile(file);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength));
  const bin = bytes.subarray(28 + jsonLength);
  const views = gltf.bufferViews.map(view => {
    const ext = view.extensions.EXT_meshopt_compression;
    const out = new Uint8Array(ext.count * ext.byteStride);
    decoder.decodeGltfBuffer(out, ext.count, ext.byteStride, bin.subarray(ext.byteOffset, ext.byteOffset + ext.byteLength), ext.mode, ext.filter);
    return out.buffer;
  });
  return gltf.nodes.map(node => {
    const primitive = gltf.meshes[node.mesh].primitives[0];
    const p = gltf.accessors[primitive.attributes.POSITION];
    const n = gltf.accessors[primitive.attributes.NORMAL];
    const indices = gltf.accessors[primitive.indices];
    const pos = new Int16Array(views[p.bufferView]);
    const nor = new Int8Array(views[n.bufferView]);
    const points = [], normals = [];
    // These source panels share a -90 degree X rotation and uniform scale.
    if (Math.abs(node.rotation[0] + Math.SQRT1_2) > 1e-5) throw Error('Unexpected source panel orientation');
    const [x, y, z] = node.translation.map((v, k) => v - origin[k]);
    const scale = node.scale[0] / 32767;
    for (let i = 0; i < p.count * 4; i += 4) {
      points.push([x + scale * pos[i], y + scale * pos[i+2], z - scale * pos[i+1]]);
      normals.push([nor[i] / 127, nor[i+2] / 127, -nor[i+1] / 127]);
    }
    return { points, normals, indices: Array.from(new Uint16Array(views[indices.bufferView], indices.byteOffset, indices.count)) };
  });
}

export async function writeGarment(file, panels, encoder, imageDirectory) {
  const extName = 'EXT_meshopt_compression';
  const gltf = {
    asset: { version: '2.0', generator: 'BUL BUL CORP field tee asset builder', copyright: 'Adapted from Oversized t-shirt by kylelhb, CC BY 4.0. See ATTRIBUTION.txt.' },
    extensionsUsed: [extName, 'KHR_mesh_quantization'], extensionsRequired: [extName, 'KHR_mesh_quantization'],
    scene: 0, scenes: [{ name: 'Field collection', nodes: [] }], nodes: [], meshes: [],
    buffers: [], bufferViews: [], accessors: [], images: [], textures: [],
    samplers: [{ minFilter: 9987, magFilter: 9729, wrapT: 10497, wrapS: 10497 }],
    materials: [{ name: 'Combed cotton jersey', doubleSided: true, normalTexture: {index: 0, scale: .68},
      pbrMetallicRoughness: {baseColorFactor:[.14,.15,.105,1], roughnessFactor:.96, metallicFactor:0, metallicRoughnessTexture:{index:1}} }],
  };
  const chunks = [];
  let stored = 0, decoded = 0;
  function append(bytes) {
    const offset = stored;
    const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const padded = Buffer.alloc((data.length + 3) & ~3);
    data.copy(padded); chunks.push(padded); stored += padded.length;
    return offset;
  }
  function accessor(array, count, byteStride, type, componentType, extras = {}) {
    const mode = type === 'SCALAR' ? 'TRIANGLES' : 'ATTRIBUTES';
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const packed = encoder.encodeGltfBuffer(bytes, count, byteStride, mode);
    const offset = append(packed);
    const view = {buffer:1, byteOffset:decoded, byteLength:bytes.length, target:type === 'SCALAR' ? 34963 : 34962,
      extensions:{[extName]:{buffer:0,byteOffset:offset,byteLength:packed.length,byteStride,count,mode}} };
    if (mode === 'ATTRIBUTES') view.byteStride = byteStride;
    decoded += (bytes.length + 3) & ~3;
    const bufferView = gltf.bufferViews.push(view) - 1;
    return gltf.accessors.push({ bufferView, componentType, count, type, ...extras }) - 1;
  }
  for (const panel of panels) {
    const count = panel.points.length;
    const pos = new Int16Array(count * 4), normal = new Int8Array(count * 4);
    const uv = new Float32Array(count * 2), color = new Uint8Array(count * 4);
    const min = [32767,32767,32767], max = [-32768,-32768,-32768];
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) {
        const coord = Math.round(panel.points[i][k] / unit);
        if (Math.abs(coord) > 32767) throw Error('Position quantization overflow');
        pos[i*4+k] = coord; min[k] = Math.min(min[k],coord); max[k] = Math.max(max[k],coord);
        normal[i*4+k] = Math.round(panel.normals[i][k] * 127);
        color[i*4+k] = Math.round(255 * panel.shades[i]);
      }
      color[i*4+3] = 255;
      uv[i*2] = Math.round(panel.uv[i][0] * 1024) / 1024;
      uv[i*2+1] = Math.round(panel.uv[i][1] * 1024) / 1024;
    }
    if (count > 65535) throw Error('Split mesh before writing 16-bit indices');
    const attributes = {
      POSITION:accessor(pos,count,8,'VEC3',5122,{min,max}),
      NORMAL:accessor(normal,count,4,'VEC3',5120,{normalized:true}),
      TEXCOORD_0:accessor(uv,count,8,'VEC2',5126),
      COLOR_0:accessor(color,count,4,'VEC4',5121,{normalized:true}),
    };
    const indices = accessor(new Uint16Array(panel.indices),panel.indices.length,2,'SCALAR',5123);
    const mesh = gltf.meshes.push({ name:panel.name, primitives:[{ attributes, indices, material:0 }] })-1;
    gltf.scenes[0].nodes.push(gltf.nodes.length);
    gltf.nodes.push({ name:panel.name, mesh, scale:[unit,unit,unit], translation:origin });
  }
  for (const name of ['jersey-normal.png','jersey-roughness.png']) {
    const bytes = await readFile(new URL(name,imageDirectory));
    const bufferView = gltf.bufferViews.push({buffer:0,byteOffset:append(bytes),byteLength:bytes.length})-1;
    const source = gltf.images.push({bufferView,mimeType:'image/png',name})-1;
    gltf.textures.push({sampler:0,source});
  }
  gltf.buffers = [{byteLength:stored},{byteLength:decoded,extensions:{[extName]:{fallback:true}}}];
  const json = Buffer.from(JSON.stringify(gltf));
  const jsonChunk = Buffer.alloc((json.length+3)&~3,0x20); json.copy(jsonChunk);
  const header = Buffer.alloc(20); header.write('glTF'); header.writeUInt32LE(2,4);
  header.writeUInt32LE(28+jsonChunk.length+stored,8); header.writeUInt32LE(jsonChunk.length,12); header.write('JSON',16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(stored); binHeader.write('BIN\0',4);
  await writeFile(file,Buffer.concat([header,jsonChunk,binHeader,...chunks]));
}
