/**
 * WebGL2 渲染器:
 * - 基础冰面:高度场网格,逐顶点着色(平整度热图 / 霜层 / 赛道标线)
 * - 卵石点:instanced UHemisphere(每实例 1 个四边形,片元里解析半球),
 *   42 万实例单 draw call;冻结中用半透明表达
 * - 试滑壶走线:GL_LINES
 * 相机:俯视斜角,支持平移/缩放;检测页叠加红格与热图。
 */
import { GRID_NX, GRID_NY, RINK } from './constants';
import type { IceField } from './icefield';
import type { PebbleArrays } from './pebble';

const FIELD_VERT = `#version 300 es
precision highp float;
layout(std140) uniform U {
  mat4 uViewProj;
  vec4 uCam;
  vec4 uTint;
  vec4 uOpts;
};
uniform sampler2D uHeight;
in vec2 aGrid;
out vec2 vWorld;
out float vHeight;
const float HALF_L = ${(RINK.LENGTH / 2).toFixed(3)};
const float HALF_W = ${(RINK.WIDTH / 2).toFixed(3)};
void main() {
  vec2 uv = aGrid;
  vec2 p = vec2(mix(-HALF_L, HALF_L, uv.x), mix(-HALF_W, HALF_W, uv.y));
  float h = texture(uHeight, uv).r;
  vWorld = p;
  vHeight = h;
  gl_Position = uViewProj * vec4(p.x, h * 0.01, p.y, 1.0);
}
`;

const FIELD_FRAG = `#version 300 es
precision highp float;
layout(std140) uniform U {
  mat4 uViewProj;
  vec4 uCam;
  vec4 uTint;
  vec4 uOpts;
};
uniform sampler2D uHeight;
uniform sampler2D uFrost;
in vec2 vWorld;
in float vHeight;
out vec4 outColor;

const float HALF_L = ${(RINK.LENGTH / 2).toFixed(3)};
const float HALF_W = ${(RINK.WIDTH / 2).toFixed(3)};
const float HOG = ${RINK.HOG_X.toFixed(3)};
const float TEE = ${RINK.TEE_X.toFixed(3)};

vec3 heat(float t) {
  // 蓝(低) → 青 → 绿 → 黄 → 红(高)
  t = clamp(t, 0.0, 1.0);
  vec3 c = mix(vec3(0.15,0.35,0.85), vec3(0.2,0.8,0.85), smoothstep(0.0,0.35,t));
  c = mix(c, vec3(0.35,0.8,0.35), smoothstep(0.3,0.55,t));
  c = mix(c, vec3(0.95,0.85,0.25), smoothstep(0.55,0.8,t));
  c = mix(c, vec3(0.9,0.15,0.12), smoothstep(0.8,1.0,t));
  return c;
}

float lineMask(vec2 p, float coord, float w) {
  return 1.0 - smoothstep(w, w * 1.8, abs(coord));
}

void main() {
  vec2 uv = vec2(vWorld.x / HALF_L * 0.5 + 0.5, vWorld.y / HALF_W * 0.5 + 0.5);
  float frost = texture(uFrost, uv).r;

  vec3 base = vec3(0.72, 0.84, 0.92); // 冰本色
  if (uOpts.x > 0.5) {
    // 热图:以局部高度映射(uniform 里 uTint.a 传高低差范围)
    float h = texture(uHeight, uv).r;
    base = heat(h / max(uTint.a, 0.001));
  } else {
    // 普通视图:轻微高度明暗
    float shade = 0.92 + 0.08 * clamp(vHeight * 0.5 + 0.5, 0.0, 1.0);
    base *= shade;
  }

  // 霜:白蒙层 + 颗粒感
  float grain = fract(sin(dot(vWorld * 40.0, vec2(12.9898,78.233))) * 43758.5453);
  base = mix(base, vec3(0.96, 0.97, 0.99), clamp(frost * 2.2 + grain * 0.05, 0.0, 0.85));

  // 标线
  if (uOpts.z > 0.5) {
    float lm = 0.0;
    lm = max(lm, lineMask(vWorld, abs(vWorld.x) - HOG, 0.035));            // 前掷线
    lm = max(lm, lineMask(vWorld, abs(vWorld.x) - TEE, 0.025));            // 圆心线
    lm = max(lm, lineMask(vWorld, vWorld.y, 0.02));                         // 中线
    // 营垒圈
    float d = length(vec2(abs(vWorld.x) - TEE, vWorld.y));
    float rings = max(lineMask(vWorld, d - 1.8288, 0.03), lineMask(vWorld, d - 1.2192, 0.03));
    rings = max(rings, lineMask(vWorld, d - 0.6096, 0.03));
    lm = max(lm, rings);
    base = mix(base, vec3(0.12, 0.16, 0.22), lm * 0.8);
  }

  outColor = vec4(base, 1.0);
}
`;

const PEBBLE_VERT = `#version 300 es
precision highp float;
layout(std140) uniform U {
  mat4 uViewProj;
  vec4 uCam;
  vec4 uTint;
  vec4 uOpts;
};
in vec4 iData0; // x, z, rMm, hMm
in vec2 iData1; // cutMm, freeze
uniform float uRenderScale; // LOD 点尺寸缩放
out vec2 vLocal;
out float vFreeze;
out float vCut;
out float vR;
void main() {
  vec2 corner = vec2((gl_VertexID == 1 || gl_VertexID == 2 || gl_VertexID == 4) ? 1.0 : -1.0,
                     (gl_VertexID == 2 || gl_VertexID == 3 || gl_VertexID == 4) ? 1.0 : -1.0);
  float r = iData0.z * 0.001 * uRenderScale; // mm → m,再乘 LOD 缩放
  vec2 p = iData0.xy + corner * r;
  vLocal = corner;
  vFreeze = iData1.y;
  vCut = iData1.x;
  vR = iData0.z;
  gl_Position = uViewProj * vec4(p.x, 0.02, p.y, 1.0);
}
`;

const PEBBLE_FRAG = `#version 300 es
precision highp float;
layout(std140) uniform U {
  mat4 uViewProj;
  vec4 uCam;
  vec4 uTint;
  vec4 uOpts;
};
uniform float uRenderScale;
in vec2 vLocal;
in float vFreeze;
in float vCut;
in float vR;
out vec4 outColor;
void main() {
  float d2 = dot(vLocal, vLocal);
  if (d2 > 1.0) discard;
  // 半球轮廓:削顶后高度 = r - cut(用真实半径比,与渲染缩放无关)
  float dome = sqrt(1.0 - d2);
  float cutFrac = clamp(vCut / max(vR, 0.001), 0.0, 0.95);
  if (dome < cutFrac) discard; // 被削掉的顶部不画
  vec3 n = normalize(vec3(vLocal.x, dome, vLocal.y));
  float lit = 0.45 + 0.55 * clamp(n.y, 0.0, 1.0);
  // 冻结中偏蓝半透明,冻透乳白
  vec3 frozen = vec3(0.86, 0.92, 0.98);
  vec3 wet = vec3(0.35, 0.55, 0.95);
  vec3 c = mix(wet, frozen, smoothstep(0.1, 0.95, vFreeze)) * lit;
  float alpha = mix(0.55, 0.92, smoothstep(0.1, 0.95, vFreeze));
  outColor = vec4(c, alpha);
}
`;

const PATH_VERT = `#version 300 es
precision highp float;
layout(std140) uniform U {
  mat4 uViewProj;
  vec4 uCam;
  vec4 uTint;
  vec4 uOpts;
};
in vec2 aPos;
void main() {
  gl_Position = uViewProj * vec4(aPos.x, 0.05, aPos.y, 1.0);
}
`;

const PATH_FRAG = `#version 300 es
precision highp float;
uniform vec4 uPathColor;
out vec4 outColor;
void main() { outColor = uPathColor; }
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader 编译失败: ' + log);
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('Program 链接失败: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

/** UBO 布局:mat4(64) + vec4×3(48) = 112 字节,16 对齐 */
const UBO_SIZE = 112;

export interface RenderOptions {
  heatmap: boolean;
  showPebbles: boolean;
  showLines: boolean;
  showRedCells: boolean;
}

export class Renderer {
  private gl: WebGL2RenderingContext;
  private fieldProg: WebGLProgram;
  private pebbleProg: WebGLProgram;
  private pathProg: WebGLProgram;
  private ubo: WebGLBuffer;
  private heightTex: WebGLTexture;
  private frostTex: WebGLTexture;
  private fieldVbo: WebGLBuffer;
  private fieldIbo: WebGLBuffer;
  private pebbleVbo: WebGLBuffer;
  private pebbleVao: WebGLVertexArrayObject;
  private fieldVao: WebGLVertexArrayObject;
  private pathVao: WebGLVertexArrayObject;
  private pathVbo: WebGLBuffer;
  private indexCount = 0;
  private pathCount = 0;

  // 相机
  camX = 0;
  camZ = 0;
  zoom = 1;

  /** 渲染 LOD:最多绘制的实例数(物理仍保留全量);0 = 不限制 */
  renderBudget = 40000;
  /** 点渲染尺寸缩放(缩小四边形 → 降低片元过绘制) */
  renderScale = 0.4;

  // FPS
  fps = 0;
  private frames = 0;
  private fpsT = performance.now();

  // 红格(检测页):网格中心坐标列表
  private redCells: Float32Array = new Float32Array(0);
  private redVbo: WebGLBuffer;
  private redVao: WebGLVertexArrayObject;
  private redProg: WebGLProgram;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;

    this.fieldProg = program(gl, FIELD_VERT, FIELD_FRAG);
    this.pebbleProg = program(gl, PEBBLE_VERT, PEBBLE_FRAG);
    this.pathProg = program(gl, PATH_VERT, PATH_FRAG);
    this.redProg = program(gl, PATH_VERT, PATH_FRAG);

    this.ubo = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferData(gl.UNIFORM_BUFFER, UBO_SIZE, gl.DYNAMIC_DRAW);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.ubo);
    for (const prog of [this.fieldProg, this.pebbleProg, this.pathProg, this.redProg]) {
      const idx = gl.getUniformBlockIndex(prog, 'U');
      gl.uniformBlockBinding(prog, idx, 0);
    }

    // 高度/霜纹理(R32F)
    this.heightTex = this.makeFieldTexture();
    this.frostTex = this.makeFieldTexture();

    // 冰面网格
    const { vao, vbo, ibo, count } = this.makeFieldMesh();
    this.fieldVao = vao;
    this.fieldVbo = vbo;
    this.fieldIbo = ibo;
    this.indexCount = count;

    // 卵石点实例缓冲(每实例 6 float = 24 字节,42 万 ≈ 10MB)
    this.pebbleVao = gl.createVertexArray()!;
    this.pebbleVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.pebbleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pebbleVbo);
    gl.bufferData(gl.ARRAY_BUFFER, PEBBLE_CAP_BYTES, gl.DYNAMIC_DRAW);
    const loc0 = gl.getAttribLocation(this.pebbleProg, 'iData0');
    const loc1 = gl.getAttribLocation(this.pebbleProg, 'iData1');
    gl.enableVertexAttribArray(loc0);
    gl.vertexAttribPointer(loc0, 4, gl.FLOAT, false, 24, 0);
    gl.vertexAttribDivisor(loc0, 1);
    gl.enableVertexAttribArray(loc1);
    gl.vertexAttribPointer(loc1, 2, gl.FLOAT, false, 24, 16);
    gl.vertexAttribDivisor(loc1, 1);

    // 走线
    this.pathVao = gl.createVertexArray()!;
    this.pathVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.pathVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathVbo);
    gl.bufferData(gl.ARRAY_BUFFER, 16384 * 8, gl.DYNAMIC_DRAW);
    const pa = gl.getAttribLocation(this.pathProg, 'aPos');
    gl.enableVertexAttribArray(pa);
    gl.vertexAttribPointer(pa, 2, gl.FLOAT, false, 0, 0);

    // 红格
    this.redVao = gl.createVertexArray()!;
    this.redVbo = gl.createBuffer()!;
    gl.bindVertexArray(this.redVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.redVbo);
    gl.bufferData(gl.ARRAY_BUFFER, GRID_NX * GRID_NY * 6 * 8, gl.DYNAMIC_DRAW);
    const ra = gl.getAttribLocation(this.redProg, 'aPos');
    gl.enableVertexAttribArray(ra);
    gl.vertexAttribPointer(ra, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  private makeFieldTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, GRID_NX, GRID_NY, 0, gl.RED, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private makeFieldMesh() {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;
    const ibo = gl.createBuffer()!;
    const verts = new Float32Array(GRID_NX * GRID_NY * 2);
    let k = 0;
    for (let ix = 0; ix < GRID_NX; ix++) {
      for (let iz = 0; iz < GRID_NY; iz++) {
        verts[k++] = ix / (GRID_NX - 1);
        verts[k++] = iz / (GRID_NY - 1);
      }
    }
    const idx: number[] = [];
    for (let ix = 0; ix < GRID_NX - 1; ix++) {
      for (let iz = 0; iz < GRID_NY - 1; iz++) {
        const a = ix * GRID_NY + iz;
        const b = a + 1;
        const c = a + GRID_NY;
        const d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.fieldProg, 'aGrid');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    return { vao, vbo, ibo, count: idx.length };
  }

  /** 上传高度场与霜场(每帧) */
  uploadField(field: IceField): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GRID_NX, GRID_NY, gl.RED, gl.FLOAT, field.base);
    gl.bindTexture(gl.TEXTURE_2D, this.frostTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GRID_NX, GRID_NY, gl.RED, gl.FLOAT, field.frost);
  }

  /** 上传卵石点实例:数据本身就是交错布局,一次零拷贝 subData */
  uploadPebbles(arr: PebbleArrays): void {
    const gl = this.gl;
    gl.bindVertexArray(this.pebbleVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pebbleVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr.data.subarray(0, arr.count * 6));
  }

  /** 更新检测页红格(局部高差 >1mm 的格子,画成红色小方框) */
  uploadRedCells(field: IceField, thresholdMm: number): number {
    const gl = this.gl;
    const dx = RINK.LENGTH / GRID_NX;
    const dz = RINK.WIDTH / GRID_NY;
    const pts: number[] = [];
    for (let ix = 1; ix < GRID_NX - 1; ix++) {
      for (let iz = 1; iz < GRID_NY - 1; iz++) {
        const c = field.base[field.idx(ix, iz)];
        let delta = 0;
        for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          delta = Math.max(delta, Math.abs(c - field.base[field.idx(ix + ax, iz + az)]));
        }
        if (delta <= thresholdMm) continue;
        const x = -RINK.LENGTH / 2 + (ix + 0.5) * dx;
        const z = -RINK.WIDTH / 2 + (iz + 0.5) * dz;
        const hx = dx * 0.42;
        const hz = dz * 0.42;
        // 方框:8 个点,4 条线段
        pts.push(x - hx, z - hz, x + hx, z - hz);
        pts.push(x + hx, z - hz, x + hx, z + hz);
        pts.push(x + hx, z + hz, x - hx, z + hz);
        pts.push(x - hx, z + hz, x - hx, z - hz);
      }
    }
    const data = new Float32Array(pts);
    this.redCells = data;
    gl.bindVertexArray(this.redVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.redVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    return data.length / 2;
  }

  setPath(points: Array<{ x: number; z: number }>): void {
    const gl = this.gl;
    const data = new Float32Array(points.length * 2);
    points.forEach((p, i) => {
      data[i * 2] = p.x;
      data[i * 2 + 1] = p.z;
    });
    gl.bindVertexArray(this.pathVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pathVbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
    this.pathCount = points.length;
  }

  private writeUbo(opts: RenderOptions, reliefMm: number): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    // 正交投影:沿 y 轴俯视、轻微倾斜通过缩放表达
    const viewH = (RINK.WIDTH + 2.2) / this.zoom;
    const viewW = viewH * aspect;
    const ortho = orthoMatrix(
      this.camX - viewW / 2,
      this.camX + viewW / 2,
      this.camZ - viewH / 2,
      this.camZ + viewH / 2,
      -10,
      10
    );
    const data = new ArrayBuffer(UBO_SIZE);
    new Float32Array(data, 0, 16).set(ortho);
    new Float32Array(data, 64).set([this.camX, this.camZ, this.zoom, aspect]);
    new Float32Array(data, 80).set([0, 0, 0, reliefMm]);
    new Float32Array(data, 96).set([
      opts.heatmap ? 1 : 0,
      opts.showPebbles ? 1 : 0,
      opts.showLines ? 1 : 0,
      0
    ]);
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Float32Array(data));
  }

  render(arr: PebbleArrays, opts: RenderOptions, reliefMm: number, showPath: boolean, showRed: boolean): void {
    const gl = this.gl;
    const canvas = gl.canvas as HTMLCanvasElement;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.floor(canvas.clientWidth * dpr);
    const h = Math.floor(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.07, 0.09, 0.13, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.writeUbo(opts, reliefMm);

    // 纹理槽
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.frostTex);

    // 冰面
    gl.useProgram(this.fieldProg);
    gl.uniform1i(gl.getUniformLocation(this.fieldProg, 'uHeight'), 0);
    gl.uniform1i(gl.getUniformLocation(this.fieldProg, 'uFrost'), 1);
    gl.uniform2f(gl.getUniformLocation(this.fieldProg, 'uFieldSize'), GRID_NX, GRID_NY);
    gl.bindVertexArray(this.fieldVao);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_INT, 0);

    // 卵石点(LOD:只画预算内的实例,物理数据全量保留)
    if (opts.showPebbles && arr.count > 0) {
      gl.useProgram(this.pebbleProg);
      gl.uniform1f(gl.getUniformLocation(this.pebbleProg, 'uRenderScale'), this.renderScale);
      gl.bindVertexArray(this.pebbleVao);
      const drawCount =
        this.renderBudget < 0
          ? 0
          : this.renderBudget > 0
            ? Math.min(arr.count, this.renderBudget)
            : arr.count;
      if (drawCount > 0) gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, drawCount);
    }

    // 走线
    if (showPath && this.pathCount > 1) {
      gl.useProgram(this.pathProg);
      gl.uniform4f(gl.getUniformLocation(this.pathProg, 'uPathColor'), 1.0, 0.45, 0.1, 0.95);
      gl.bindVertexArray(this.pathVao);
      gl.drawArrays(gl.LINE_STRIP, 0, this.pathCount);
    }

    // 红格
    if (showRed && this.redCells.length > 0) {
      gl.useProgram(this.redProg);
      gl.uniform4f(gl.getUniformLocation(this.redProg, 'uPathColor'), 1.0, 0.08, 0.05, 0.95);
      gl.bindVertexArray(this.redVao);
      gl.drawArrays(gl.LINES, 0, this.redCells.length / 2);
    }

    gl.bindVertexArray(null);

    // FPS
    this.frames++;
    const now = performance.now();
    if (now - this.fpsT >= 1000) {
      this.fps = (this.frames * 1000) / (now - this.fpsT);
      this.frames = 0;
      this.fpsT = now;
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.fieldProg);
    gl.deleteProgram(this.pebbleProg);
    gl.deleteProgram(this.pathProg);
    gl.deleteProgram(this.redProg);
    gl.deleteBuffer(this.ubo);
    gl.deleteBuffer(this.fieldVbo);
    gl.deleteBuffer(this.fieldIbo);
    gl.deleteBuffer(this.pebbleVbo);
    gl.deleteBuffer(this.pathVbo);
    gl.deleteBuffer(this.redVbo);
    gl.deleteTexture(this.heightTex);
    gl.deleteTexture(this.frostTex);
  }
}

const PEBBLE_CAP_BYTES = 420000 * 24;

function orthoMatrix(l: number, r: number, b: number, t: number, n: number, f: number): Float32Array {
  return new Float32Array([
    2 / (r - l), 0, 0, 0,
    0, 2 / (t - b), 0, 0,
    0, 0, -2 / (f - n), 0,
    -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1
  ]);
}
