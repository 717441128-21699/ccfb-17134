import { HEIGHT_NX, HEIGHT_NZ, SHEET_LENGTH_M, SHEET_WIDTH_M } from '../game/config';
import { sampleHeight } from '../game/physics';
import { clamp } from '../game/rng';
import type { GameState } from '../game/types';

type Mat4 = Float32Array;

function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[0 * 4 + r] * b[c * 4 + 0] +
        a[1 * 4 + r] * b[c * 4 + 1] +
        a[2 * 4 + r] * b[c * 4 + 2] +
        a[3 * 4 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

function perspective(fovyRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovyRad / 2);
  const nf = 1 / (near - far);
  const m = identity();
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  m[15] = 0;
  return m;
}

function lookAt(eye: number[], center: number[], up: number[]): Mat4 {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = identity();
  m[0] = xx; m[1] = yx; m[2] = zx;
  m[4] = xy; m[5] = yy; m[6] = zy;
  m[8] = xz; m[9] = yz; m[10] = zz;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  return m;
}

function modelTRS(x: number, y: number, z: number, sx: number, sy: number, sz: number): Mat4 {
  const m = identity();
  m[0] = sx;
  m[5] = sy;
  m[10] = sz;
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}\n${source}`);
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

const ICE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aXZ;
layout(location=1) in vec2 aUV;
layout(location=2) in float aHeight;
layout(location=3) in float aRisk;
uniform mat4 uViewProj;
uniform float uMeanHeight;
uniform float uHeightExag;
out vec2 vUV;
out float vRisk;
out vec3 vWorld;
out float vHeight;
void main() {
  float y = (aHeight - uMeanHeight) * 0.001 * uHeightExag;
  vec3 p = vec3(aXZ.x, y, aXZ.y);
  vUV = aUV;
  vRisk = aRisk;
  vWorld = p;
  vHeight = aHeight;
  gl_Position = uViewProj * vec4(p, 1.0);
}`;

const ICE_FS = `#version 300 es
precision highp float;
in vec2 vUV;
in float vRisk;
in vec3 vWorld;
in float vHeight;
uniform sampler2D uMarkings;
uniform float uInspection;
uniform float uFrost;
uniform float uTime;
out vec4 outColor;
void main() {
  vec3 dx = dFdx(vWorld);
  vec3 dy = dFdy(vWorld);
  vec3 n = normalize(cross(dx, dy));
  if (n.y < 0.0) n = -n;
  vec3 lightDir = normalize(vec3(-0.35, 0.86, 0.28));
  float diffuse = 0.62 + 0.38 * max(dot(n, lightDir), 0.0);
  float shimmer = 0.025 * sin(vWorld.z * 2.1 + uTime * 0.7) + 0.018 * sin(vWorld.x * 7.0 - uTime);
  vec3 base = mix(vec3(0.48, 0.73, 0.86), vec3(0.76, 0.91, 0.97), 0.55 + shimmer);
  vec3 col = base * diffuse;
  vec4 marks = texture(uMarkings, vUV);
  col = mix(col, marks.rgb, marks.a * 0.86);

  float r = vRisk;
  float yellow = smoothstep(0.42, 0.82, r) * (1.0 - smoothstep(0.82, 1.04, r));
  float red = smoothstep(0.84, 1.04, r);
  vec3 heat = mix(vec3(0.05, 0.72, 0.42), vec3(1.0, 0.82, 0.12), yellow);
  heat = mix(heat, vec3(1.0, 0.05, 0.04), red);
  float pulse = 0.86 + 0.14 * sin(uTime * 5.0);
  col = mix(col, heat * pulse, uInspection * (0.18 + 0.62 * smoothstep(0.35, 1.0, r)));
  if (uInspection > 0.5 && r > 1.0) {
    col = mix(col, vec3(1.0, 0.02, 0.02), 0.45 + 0.25 * sin(uTime * 7.0));
  }

  float frostNoise = 0.55 + 0.45 * sin(vWorld.x * 31.0) * sin(vWorld.z * 17.0);
  col = mix(col, vec3(0.93, 0.97, 1.0), clamp(uFrost * (0.55 + 0.25 * frostNoise), 0.0, 0.86));
  float edgeFade = smoothstep(0.0, 0.015, vUV.x) * smoothstep(1.0, 0.985, vUV.x);
  col *= 0.82 + 0.18 * edgeFade;
  outColor = vec4(col, 1.0);
}`;

const PEBBLE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 iOffset;
layout(location=3) in vec3 iProps;
uniform mat4 uViewProj;
uniform float uMeanHeight;
uniform float uHeightExag;
uniform float uPebbleScale;
uniform float uWearY;
out vec3 vNormal;
out float vShade;
out vec3 vWorld;
void main() {
  float r = max(0.0001, iProps.x * 0.001 * uPebbleScale);
  float h = max(0.00005, iProps.y * 0.001 * uPebbleScale * uWearY);
  float baseY = (iOffset.y - uMeanHeight) * 0.001 * uHeightExag + 0.004;
  vec3 p = vec3(aPos.x * r, aPos.y * h, aPos.z * r);
  vec3 world = vec3(iOffset.x, baseY, iOffset.z) + p;
  float yScale = max(0.18, h / r);
  vNormal = normalize(vec3(aNormal.x, aNormal.y / yScale, aNormal.z));
  vShade = iProps.z;
  vWorld = world;
  gl_Position = uViewProj * vec4(world, 1.0);
}`;

const PEBBLE_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in float vShade;
in vec3 vWorld;
uniform float uFrost;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 l = normalize(vec3(-0.35, 0.88, 0.32));
  float key = max(dot(n, l), 0.0);
  float rim = pow(1.0 - max(n.y, 0.0), 2.0) * 0.18;
  vec3 base = mix(vec3(0.72, 0.88, 0.96), vec3(0.96, 0.99, 1.0), vShade);
  vec3 col = base * (0.42 + 0.62 * key) + vec3(0.55, 0.75, 0.9) * rim;
  col = mix(col, vec3(0.96, 0.985, 1.0), clamp(uFrost * 0.78, 0.0, 0.82));
  outColor = vec4(col, 1.0);
}`;

const SIMPLE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uViewProj;
uniform mat4 uModel;
out vec3 vNormal;
out vec3 vWorld;
void main() {
  vec4 w = uModel * vec4(aPos, 1.0);
  vWorld = w.xyz;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uViewProj * w;
}`;

const SIMPLE_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vWorld;
uniform vec3 uColor;
out vec4 outColor;
void main() {
  vec3 n = normalize(vNormal);
  vec3 l = normalize(vec3(0.4, 0.85, 0.35));
  float d = 0.42 + 0.58 * abs(dot(n, l));
  outColor = vec4(uColor * d, 1.0);
}`;

interface CameraState {
  yaw: number;
  pitch: number;
  distance: number;
}

export class IceRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private observer: ResizeObserver;
  private dprScale = 1.25;

  private iceProgram: WebGLProgram;
  private pebbleProgram: WebGLProgram;
  private simpleProgram: WebGLProgram;
  private markingTexture: WebGLTexture;

  private iceVAO: WebGLVertexArrayObject;
  private indexCount = 0;
  private heightBuffer: WebGLBuffer;
  private riskBuffer: WebGLBuffer;

  private pebbleVAO: WebGLVertexArrayObject;
  private pebbleIndexCount = 0;
  private pebbleInstanceBuffer: WebGLBuffer;
  private pebbleGeometryBuffer: WebGLBuffer | null = null;
  private pebbleIndexBuffer: WebGLBuffer | null = null;
  private lastPebbleData: Float32Array | null = null;
  private pebbleTopKey = '';

  private cylinderVAO: WebGLVertexArrayObject;
  private cylinderIndexCount = 0;

  private camera: CameraState = { yaw: 0.72, pitch: 0.62, distance: 48 };
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private userDistance = false;

  inspection = false;
  heightExaggeration = 18;
  pebbleScale = 6.2;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    if (!gl) throw new Error('当前浏览器或设备不支持 WebGL2。');
    this.gl = gl;
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0.025, 0.055, 0.085, 1);

    this.iceProgram = createProgram(gl, ICE_VS, ICE_FS);
    this.pebbleProgram = createProgram(gl, PEBBLE_VS, PEBBLE_FS);
    this.simpleProgram = createProgram(gl, SIMPLE_VS, SIMPLE_FS);
    this.markingTexture = this.createMarkingTexture();

    const ice = this.createIceMesh();
    this.iceVAO = ice.vao;
    this.indexCount = ice.indexCount;
    this.heightBuffer = ice.heightBuffer;
    this.riskBuffer = ice.riskBuffer;

    const dome = this.createPebbleVAO(0.98);
    this.pebbleVAO = dome.vao;
    this.pebbleIndexCount = dome.indexCount;
    this.pebbleInstanceBuffer = dome.instanceBuffer;

    const cylinder = this.createCylinderVAO();
    this.cylinderVAO = cylinder.vao;
    this.cylinderIndexCount = cylinder.indexCount;

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(canvas.parentElement ?? canvas);
    this.resize();
    this.bindControls();
  }

  private createMarkingTexture(): WebGLTexture {
    const gl = this.gl;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 2048;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width;
    const H = canvas.height;
    const xToPx = (x: number) => ((x + SHEET_WIDTH_M / 2) / SHEET_WIDTH_M) * W;
    const zToPx = (z: number) => ((z + SHEET_LENGTH_M / 2) / SHEET_LENGTH_M) * H;

    ctx.clearRect(0, 0, W, H);
    ctx.lineCap = 'round';

    // 边界
    ctx.strokeStyle = 'rgba(220,245,255,0.72)';
    ctx.lineWidth = 7;
    ctx.strokeRect(10, 10, W - 20, H - 20);

    // 中线
    ctx.strokeStyle = 'rgba(190,40,55,0.55)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(xToPx(0), zToPx(-SHEET_LENGTH_M / 2 + 0.4));
    ctx.lineTo(xToPx(0), zToPx(SHEET_LENGTH_M / 2 - 0.4));
    ctx.stroke();

    const drawAcross = (z: number, color: string, width: number, dash: number[] = []) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(18, zToPx(z));
      ctx.lineTo(W - 18, zToPx(z));
      ctx.stroke();
      ctx.restore();
    };

    // 虚构但尺度接近正式场地的主要线。
    for (const z of [-20.2, 20.2]) drawAcross(z, 'rgba(30,70,120,0.72)', 10);
    for (const z of [-17.0, 17.0]) drawAcross(z, 'rgba(190,45,60,0.78)', 9);
    for (const z of [-10.8, 10.8]) drawAcross(z, 'rgba(210,55,70,0.82)', 11);
    drawAcross(-13.5, 'rgba(34,211,238,0.95)', 8, [18, 14]);
    drawAcross(13.5, 'rgba(34,211,238,0.95)', 8, [18, 14]);

    // 两端大本营：由于纹理 x/z 像素比例不同，使用椭圆保持物理圆形。
    for (const zc of [-17, 17]) {
      const cx = xToPx(0);
      const cy = zToPx(zc);
      const rx = 1.83 * (W / SHEET_WIDTH_M);
      const ry = 1.83 * (H / SHEET_LENGTH_M);
      const rings: Array<[number, string]> = [
        [1.83, 'rgba(37,99,235,0.28)'],
        [1.22, 'rgba(248,113,113,0.30)'],
        [0.61, 'rgba(255,255,255,0.34)']
      ];
      for (const [r, color] of rings) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.ellipse(cx, cy, r * (W / SHEET_WIDTH_M), r * (H / SHEET_LENGTH_M), 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(20,60,110,0.55)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(8,47,73,0.72)';
    ctx.font = 'bold 54px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.save();
    ctx.translate(70, zToPx(-13.5));
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('FRONT GATE', 0, 18);
    ctx.restore();
    ctx.save();
    ctx.translate(W - 70, zToPx(13.5));
    ctx.rotate(Math.PI / 2);
    ctx.fillText('BACK GATE', 0, 18);
    ctx.restore();

    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  private createIceMesh() {
    const gl = this.gl;
    const nx = HEIGHT_NX;
    const nz = HEIGHT_NZ;
    const staticData = new Float32Array(nx * nz * 4);
    let p = 0;
    for (let iz = 0; iz < nz; iz++) {
      const z = -SHEET_LENGTH_M / 2 + (iz / (nz - 1)) * SHEET_LENGTH_M;
      for (let ix = 0; ix < nx; ix++) {
        const x = -SHEET_WIDTH_M / 2 + (ix / (nx - 1)) * SHEET_WIDTH_M;
        staticData[p++] = x;
        staticData[p++] = z;
        staticData[p++] = ix / (nx - 1);
        staticData[p++] = iz / (nz - 1);
      }
    }
    const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let q = 0;
    for (let iz = 0; iz < nz - 1; iz++) {
      for (let ix = 0; ix < nx - 1; ix++) {
        const a = iz * nx + ix;
        const b = a + 1;
        const c = a + nx;
        const d = c + 1;
        indices[q++] = a; indices[q++] = c; indices[q++] = b;
        indices[q++] = b; indices[q++] = c; indices[q++] = d;
      }
    }

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const staticBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, staticBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, staticData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    const heightBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, heightBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, nx * nz * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 4, 0);

    const riskBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, riskBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, nx * nz * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 4, 0);

    const indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    gl.bindVertexArray(null);
    return { vao, indexCount: indices.length, heightBuffer, riskBuffer };
  }

  private buildDomeGeometry(topRatio: number, segments = 6, rings = 2) {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const addVertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
      positions.push(x, y, z);
      normals.push(nx, ny, nz);
      return positions.length / 3 - 1;
    };

    for (let r = 0; r <= rings; r++) {
      const f = r / rings;
      const yActual = topRatio * f;
      const radiusXZ = Math.sqrt(Math.max(0, 1 - yActual * yActual));
      for (let s = 0; s < segments; s++) {
        const theta = (s / segments) * Math.PI * 2;
        const x = Math.cos(theta) * radiusXZ;
        const z = Math.sin(theta) * radiusXZ;
        // (x, yActual, z) is already the unit-sphere normal.
        addVertex(x, f, z, x, yActual, z);
      }
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < segments; s++) {
        const a = r * segments + s;
        const b = r * segments + ((s + 1) % segments);
        const c = (r + 1) * segments + s;
        const d = (r + 1) * segments + ((s + 1) % segments);
        indices.push(a, c, b, b, c, d);
      }
    }

    const capRadius = Math.sqrt(Math.max(0, 1 - topRatio * topRatio));
    const capStart = positions.length / 3;
    for (let s = 0; s < segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      addVertex(Math.cos(theta) * capRadius, 1, Math.sin(theta) * capRadius, 0, 1, 0);
    }
    const center = addVertex(0, 1, 0, 0, 1, 0);
    for (let s = 0; s < segments; s++) {
      const a = capStart + s;
      const b = capStart + ((s + 1) % segments);
      indices.push(center, b, a);
    }

    const vertexData = new Float32Array((positions.length / 3) * 6);
    for (let i = 0; i < positions.length / 3; i++) {
      vertexData[i * 6] = positions[i * 3];
      vertexData[i * 6 + 1] = positions[i * 3 + 1];
      vertexData[i * 6 + 2] = positions[i * 3 + 2];
      vertexData[i * 6 + 3] = normals[i * 3];
      vertexData[i * 6 + 4] = normals[i * 3 + 1];
      vertexData[i * 6 + 5] = normals[i * 3 + 2];
    }
    return { vertexData, indices: new Uint16Array(indices) };
  }

  private createPebbleVAO(topRatio: number) {
    const gl = this.gl;
    const geo = this.buildDomeGeometry(topRatio);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const geometryBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, geometryBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geo.vertexData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);

    const indexBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);

    const instanceBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, 500_000 * 6 * 4, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 24, 12);
    gl.vertexAttribDivisor(3, 1);

    gl.bindVertexArray(null);
    this.pebbleGeometryBuffer = geometryBuffer;
    this.pebbleIndexBuffer = indexBuffer;
    return { vao, indexCount: geo.indices.length, instanceBuffer };
  }

  uploadPebbles(state: GameState): void {
    if (!state.pebbleData) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pebbleInstanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, state.pebbleData, gl.DYNAMIC_DRAW);
    this.lastPebbleData = state.pebbleData;
  }

  private syncPebbleGeometry(state: GameState): void {
    if (!state.pebble.applied && !state.walk) return;
    const radius = Math.max(0.1, state.pebble.radiusMm);
    const ratio = clamp(state.pebble.remainingMm / radius, 0.15, 1);
    const key = Math.round(ratio * 24).toString();
    if (key === this.pebbleTopKey) return;
    this.pebbleTopKey = key;
    const geo = this.buildDomeGeometry(Number(key) / 24);
    const gl = this.gl;
    if (this.pebbleGeometryBuffer) gl.deleteBuffer(this.pebbleGeometryBuffer);
    if (this.pebbleIndexBuffer) gl.deleteBuffer(this.pebbleIndexBuffer);
    gl.bindVertexArray(this.pebbleVAO);
    // 重新绑定 ARRAY_BUFFER 并替换为当前削顶比例的低多边形剖面。
    const geomBuffer = gl.createBuffer()!;
    this.pebbleGeometryBuffer = geomBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, geomBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geo.vertexData, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const indexBuffer = gl.createBuffer()!;
    this.pebbleIndexBuffer = indexBuffer;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);
    this.pebbleIndexCount = geo.indices.length;
    // 重新绑定实例属性，避免新 geometry buffer 覆盖 ARRAY_BUFFER 后实例指针丢失。
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pebbleInstanceBuffer);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 24, 12);
    gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);
  }

  private createCylinderVAO() {
    const gl = this.gl;
    const seg = 22;
    const vertices: number[] = [];
    const indices: number[] = [];
    for (let s = 0; s <= seg; s++) {
      const t = (s / seg) * Math.PI * 2;
      const x = Math.cos(t);
      const z = Math.sin(t);
      vertices.push(x, -0.5, z, x, 0, z);
      vertices.push(x, 0.5, z, x, 0, z);
    }
    for (let s = 0; s < seg; s++) {
      const a = s * 2;
      indices.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
    const topCenter = vertices.length / 6;
    vertices.push(0, 0.5, 0, 0, 1, 0);
    const topStart = vertices.length / 6;
    for (let s = 0; s <= seg; s++) {
      const t = (s / seg) * Math.PI * 2;
      vertices.push(Math.cos(t), 0.5, Math.sin(t), 0, 1, 0);
    }
    for (let s = 0; s < seg; s++) indices.push(topCenter, topStart + s, topStart + s + 1);

    const data = new Float32Array((vertices.length / 6) * 6);
    for (let i = 0; i < vertices.length / 6; i++) {
      data[i * 6] = vertices[i * 6];
      data[i * 6 + 1] = vertices[i * 6 + 1];
      data[i * 6 + 2] = vertices[i * 6 + 2];
      data[i * 6 + 3] = vertices[i * 6 + 3];
      data[i * 6 + 4] = vertices[i * 6 + 4];
      data[i * 6 + 5] = vertices[i * 6 + 5];
    }

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, indexCount: indices.length };
  }

  private bindControls(): void {
    const el = this.canvas;
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.camera.yaw -= dx * 0.006;
      this.camera.pitch = clamp(this.camera.pitch + dy * 0.004, 0.16, 1.42);
    });
    const endDrag = () => { this.dragging = false; };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.userDistance = true;
      this.camera.distance = clamp(this.camera.distance * Math.exp(e.deltaY * 0.001), 9, 95);
    }, { passive: false });
  }

  setView(view: 'panorama' | 'top' | 'close'): void {
    this.userDistance = view !== 'panorama';
    if (view === 'panorama') {
      this.camera.yaw = 0.72;
      this.camera.pitch = 0.62;
      this.camera.distance = 48;
      this.userDistance = false;
    } else if (view === 'top') {
      this.camera.yaw = 0.18;
      this.camera.pitch = 1.46;
      this.camera.distance = 55;
      this.userDistance = true;
    } else {
      this.camera.yaw = 0.72;
      this.camera.pitch = 0.48;
      this.camera.distance = 15;
      this.userDistance = true;
    }
  }

  private resize(): void {
    const parent = this.canvas.parentElement;
    const w = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth);
    const h = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, this.dprScale);
    const bw = Math.floor(w * dpr);
    const bh = Math.floor(h * dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
      this.gl.viewport(0, 0, bw, bh);
    }
  }

  private cameraMatrix(): Mat4 {
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    if (!this.userDistance) {
      const fit = (SHEET_LENGTH_M * 0.58) / (Math.tan((50 * Math.PI) / 360) * Math.max(0.62, aspect));
      this.camera.distance = clamp(fit, 24, 78);
    }
    const { yaw, pitch, distance } = this.camera;
    const eye = [
      Math.cos(pitch) * Math.sin(yaw) * distance,
      Math.sin(pitch) * distance + 0.8,
      Math.cos(pitch) * Math.cos(yaw) * distance
    ];
    const proj = perspective((50 * Math.PI) / 180, aspect, 0.08, 220);
    const view = lookAt(eye, [0, 0.1, 0], [0, 1, 0]);
    return multiply(proj, view);
  }

  render(state: GameState, nowMs: number): void {
    const gl = this.gl;
    const vp = this.cameraMatrix();
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // 每帧量很小，直接 subData，保证浇水/刮平后立即变形。
    gl.bindBuffer(gl.ARRAY_BUFFER, this.heightBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.height);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.riskBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, state.risk);

    this.drawIce(state, vp, nowMs);
    this.syncPebbleGeometry(state);
    if (state.pebbleData && this.lastPebbleData !== state.pebbleData) this.uploadPebbles(state);
    this.drawPebbles(state, vp, nowMs);
    this.drawTrialStone(state, vp, nowMs, 'right');
    this.drawTrialStone(state, vp, nowMs, 'left');
    this.drawWalker(state, vp);
  }

  private drawIce(state: GameState, vp: Mat4, now: number): void {
    const gl = this.gl;
    gl.useProgram(this.iceProgram);
    gl.bindVertexArray(this.iceVAO);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.iceProgram, 'uViewProj'), false, vp);
    gl.uniform1f(gl.getUniformLocation(this.iceProgram, 'uMeanHeight'), state.flatness.meanMm);
    gl.uniform1f(gl.getUniformLocation(this.iceProgram, 'uHeightExag'), this.heightExaggeration * (this.inspection ? 1.25 : 1));
    gl.uniform1f(gl.getUniformLocation(this.iceProgram, 'uInspection'), this.inspection ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(this.iceProgram, 'uFrost'), state.frost);
    gl.uniform1f(gl.getUniformLocation(this.iceProgram, 'uTime'), now / 1000);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.markingTexture);
    gl.uniform1i(gl.getUniformLocation(this.iceProgram, 'uMarkings'), 0);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  private drawPebbles(state: GameState, vp: Mat4, now: number): void {
    if (!state.pebbleData || state.pebbleDrawCount <= 0) return;
    const gl = this.gl;
    gl.useProgram(this.pebbleProgram);
    gl.bindVertexArray(this.pebbleVAO);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.pebbleProgram, 'uViewProj'), false, vp);
    gl.uniform1f(gl.getUniformLocation(this.pebbleProgram, 'uMeanHeight'), state.flatness.meanMm);
    gl.uniform1f(gl.getUniformLocation(this.pebbleProgram, 'uHeightExag'), this.heightExaggeration);
    gl.uniform1f(gl.getUniformLocation(this.pebbleProgram, 'uPebbleScale'), this.pebbleScale);
    gl.uniform1f(gl.getUniformLocation(this.pebbleProgram, 'uWearY'), 0.72 + 0.28 * state.pebble.wornFactor);
    gl.uniform1f(gl.getUniformLocation(this.pebbleProgram, 'uFrost'), state.frost);
    gl.uniform1f(gl.getUniformLocation(this.pebbleProgram, 'uTime'), now / 1000);
    const count = Math.min(state.pebbleDrawCount, 500_000);
    gl.drawElementsInstanced(gl.TRIANGLES, this.pebbleIndexCount, gl.UNSIGNED_SHORT, 0, count);
    gl.bindVertexArray(null);
  }

  private stonePose(state: GameState, now: number, lane: 'left' | 'right' = 'left'): { x: number; z: number; visible: boolean } {
    const trial = state.lastTrial;
    if (!trial) return { x: 0, z: -13.5, visible: false };
    const samples = lane === 'left' ? trial.samples : trial.rightSamples;
    const endT = samples[samples.length - 1]?.t ?? 0;
    let t = endT;
    if (state.trialAnim?.active) {
      const p = clamp((now - state.trialAnim.startRealMs) / state.trialAnim.durationMs, 0, 1);
      t = p * endT;
      if (p >= 1) state.trialAnim.active = false;
    }
    let a = samples[0];
    let b = samples[samples.length - 1];
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].t >= t) {
        a = samples[i - 1];
        b = samples[i];
        break;
      }
    }
    const f = clamp((t - a.t) / Math.max(0.001, b.t - a.t), 0, 1);
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, visible: true };
  }

  private drawCylinder(vp: Mat4, x: number, y: number, z: number, radius: number, height: number, color: [number, number, number]): void {
    const gl = this.gl;
    gl.useProgram(this.simpleProgram);
    gl.bindVertexArray(this.cylinderVAO);
    const model = modelTRS(x, y, z, radius, height, radius);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.simpleProgram, 'uViewProj'), false, vp);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.simpleProgram, 'uModel'), false, model);
    gl.uniform3fv(gl.getUniformLocation(this.simpleProgram, 'uColor'), color);
    gl.drawElements(gl.TRIANGLES, this.cylinderIndexCount, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
  }

  private drawTrialStone(state: GameState, vp: Mat4, now: number, lane: 'left' | 'right'): void {
    const pose = this.stonePose(state, now, lane);
    if (!pose.visible) return;
    const surface = (sampleHeight(state.height, pose.x, pose.z) - state.flatness.meanMm) * 0.001 * this.heightExaggeration;
    this.drawCylinder(vp, pose.x, surface + 0.075, pose.z, 0.145, 0.15, [0.12, 0.16, 0.2]);
    const handle: [number, number, number] = lane === 'left' ? [0.72, 0.12, 0.16] : [0.1, 0.45, 0.95];
    this.drawCylinder(vp, pose.x, surface + 0.17, pose.z, 0.075, 0.055, handle);
  }

  private drawWalker(state: GameState, vp: Mat4): void {
    const walk = state.walk;
    if (!walk?.active) return;
    const p = clamp(walk.elapsedS / walk.durationS, 0, 1);
    const laneCount = state.pebble.laneCount;
    const total = laneCount * SHEET_LENGTH_M;
    const d = p * total;
    let lane = Math.min(laneCount - 1, Math.floor(d / SHEET_LENGTH_M));
    let along = d - lane * SHEET_LENGTH_M;
    if (lane % 2 === 1) along = SHEET_LENGTH_M - along;
    const laneWidth = SHEET_WIDTH_M / laneCount;
    let x = -SHEET_WIDTH_M / 2 + laneWidth * (lane + 0.5) + walk.params.balanceCm / 100;
    const z = -SHEET_LENGTH_M / 2 + along;
    x = clamp(x, -SHEET_WIDTH_M / 2 + 0.2, SHEET_WIDTH_M / 2 - 0.2);
    const surface = (sampleHeight(state.height, x, z) - state.flatness.meanMm) * 0.001 * this.heightExaggeration;
    this.drawCylinder(vp, x, surface + 0.34, z, 0.16, 0.68, [0.08, 0.36, 0.55]);
    this.drawCylinder(vp, x, surface + 0.78, z, 0.13, 0.16, [0.95, 0.72, 0.2]);
  }

  setDprScale(scale: number): void {
    this.dprScale = clamp(scale, 0.8, 2);
    this.resize();
  }

  get effectiveDprScale(): number {
    return Math.min(window.devicePixelRatio || 1, this.dprScale);
  }

  dispose(): void {
    this.observer.disconnect();
  }
}
