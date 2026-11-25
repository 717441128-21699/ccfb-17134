// WebGL2 渲染:高度场冰面 + 实例化卵石点
// 性能策略:单实例缓冲 + 双 LOD 半球网格 + 每 12 帧重建的实例索引(近景/远景/剔除)
import { NX, NZ, SHEET_L, SHEET_W } from '../sim/constants';
import type { Simulation } from '../sim/Simulation';
import { PEB_STRIDE } from '../sim/Simulation';
import { clamp } from '../sim/rng';

const VERT_ICE = `#version 300 es
#ifdef GL_ES
precision highp float;
#endif
layout(location=0) in vec2 aGrid;
uniform mat4 uVP;
uniform sampler2D uHeight;
uniform sampler2D uRed;
uniform vec3 uHScale;      // x: 高度尺度(m/单位), y: 最低高度(m), z: 垂直夸张倍数
uniform float uShowRed;
out vec3 vWorld;
out float vRed;
void main() {
  ivec2 ij = ivec2(aGrid.x, aGrid.y);
  float hRaw = texelFetch(uHeight, ij, 0).r * uHScale.x + uHScale.y;
  float h = (hRaw - uHScale.y) * uHScale.z;   // 以最低点为基准夸张起伏
  float red = texelFetch(uRed, ij, 0).r;
  float x = (aGrid.x / float(${NX}) - 0.5) * ${SHEET_W.toFixed(3)};
  float z = (aGrid.y / float(${NZ}) - 0.5) * ${SHEET_L.toFixed(3)};
  vWorld = vec3(x, h, z);
  vRed = red * uShowRed;
  gl_Position = uVP * vec4(vWorld, 1.0);
}`;

const FRAG_ICE = `#version 300 es
#ifdef GL_ES
precision highp float;
#endif
in vec3 vWorld;
in float vRed;
out vec4 outColor;
void main() {
  vec3 ice = vec3(0.72, 0.85, 0.92);
  vec3 mark = vec3(0.95, 0.25, 0.22);
  vec3 col = mix(ice, mark, clamp(vRed, 0.0, 1.0));
  vec2 g = abs(fract(vWorld.xz / 1.0 - 0.5) - 0.5) / fwidth(vWorld.xz);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  col = mix(col, col * 0.82, line * 0.3);
  outColor = vec4(col, 1.0);
}`;

const VERT_PEB = `#version 300 es
#ifdef GL_ES
precision highp float;
#endif
layout(location=0) in vec3 aLocal;
layout(location=1) in vec4 aInst1;
layout(location=2) in vec4 aInst2;
uniform mat4 uVP;
uniform vec3 uHScale;
uniform float uPebScale;   // 卵石点视觉放大(物理数据不变)
uniform sampler2D uHeight;
out vec3 vNormal;
flat out int vZone;
void main() {
  float r = aInst1.z * 0.001 * uPebScale;
  float h = aInst1.w * 0.001 * uPebScale;
  float cut = aInst2.y;
  ivec2 ij = ivec2(
    clamp((aInst1.x / ${SHEET_W.toFixed(3)} + 0.5) * ${NX}.0, 0.0, ${NX - 1}.0),
    clamp((aInst1.y / ${SHEET_L.toFixed(3)} + 0.5) * ${NZ}.0, 0.0, ${NZ - 1}.0));
  float hRaw = texelFetch(uHeight, ij, 0).r * uHScale.x + uHScale.y;
  float ground = (hRaw - uHScale.y) * uHScale.z;
  float yScale = 1.0 - cut * 0.8;
  vec3 local = vec3(aLocal.x * r, aLocal.y * h * yScale + h * cut * 0.8,
    aLocal.z * r);
  vec3 world = vec3(aInst1.x + local.x, ground + local.y, aInst1.y + local.z);
  vNormal = normalize(vec3(aLocal.x / max(r, 1e-4),
    aLocal.y * r / max(h, 1e-4), aLocal.z / max(r, 1e-4)));
  vZone = int(aInst2.z);
  gl_Position = uVP * vec4(world, 1.0);
}`;

const FRAG_PEB = `#version 300 es
#ifdef GL_ES
precision highp float;
#endif
in vec3 vNormal;
flat in int vZone;
out vec4 outColor;
void main() {
  float shade = 0.55 + 0.45
    * max(dot(normalize(vNormal), normalize(vec3(0.3, 1.0, 0.4))), 0.0);
  vec3 tint = (vZone % 2 == 0)
    ? vec3(1.0, 0.97, 0.93) : vec3(0.94, 0.97, 1.0);
  outColor = vec4(vec3(0.86, 0.93, 0.98) * tint * shade, 1.0);
}`;

const VERT_LINE = `#version 300 es
#ifdef GL_ES
precision highp float;
#endif
layout(location=0) in vec3 aPos;
uniform mat4 uVP;
void main() { gl_Position = uVP * vec4(aPos, 1.0); }`;

const FRAG_LINE = `#version 300 es
#ifdef GL_ES
precision highp float;
#endif
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;

export interface Camera { yaw: number; pitch: number; dist: number; targetY: number }

function hemisphere(rings: number, seg: number): { v: Float32Array; n: number } {
  const verts: number[] = [];
  for (let rI = 0; rI <= rings; rI++) {
    const phi = (rI / rings) * Math.PI / 2;
    for (let s = 0; s <= seg; s++) {
      const theta = (s / seg) * Math.PI * 2;
      verts.push(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta));
    }
  }
  const idx: number[] = [];
  const row = seg + 1;
  for (let rI = 0; rI < rings; rI++) {
    for (let s = 0; s < seg; s++) {
      const a = rI * row + s;
      const b = a + row;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const out = new Float32Array(idx.length * 3);
  idx.forEach((vi, k) => {
    out[k * 3] = verts[vi * 3];
    out[k * 3 + 1] = verts[vi * 3 + 1];
    out[k * 3 + 2] = verts[vi * 3 + 2];
  });
  return { v: out, n: idx.length };
}

type Vec3 = [number, number, number];

export class Renderer {
  private gl: WebGL2RenderingContext;
  private iceProg: WebGLProgram;
  private pebProg: WebGLProgram;
  private lineProg: WebGLProgram;
  private iceVAO: WebGLVertexArrayObject;
  private iceIndexCount = 0;
  private pebVAO: WebGLVertexArrayObject;
  private pebVBO!: WebGLBuffer;
  private visibleVBO!: WebGLBuffer;
  private lineVAO: WebGLVertexArrayObject;
  private nearMesh: { vbo: WebGLBuffer; n: number };
  private farMesh: { vbo: WebGLBuffer; n: number };
  private heightTex: WebGLTexture;
  private redTex: WebGLTexture;
  private lineCount = 0;
  private uploadedVersion = -1;
  private uploadedCount = 0;
  private nearData = new Float32Array(0);
  private farData = new Float32Array(0);
  private nearCount = 0;
  private farCount = 0;
  private frameNo = 0;
  private hScale = { x: 1 / 255, y: 0 };
  private readonly heightExag = 22;    // 冰面起伏垂直夸张(仅视觉)
  private readonly pebScale = 9;      // 卵石点视觉放大倍数(仅视觉)
  cam: Camera = { yaw: 0.05, pitch: 0.42, dist: 26, targetY: 0 };
  showRed = true;
  fps = 60;
  private frames = 0;
  private fpsT = 0;
  visibleCount = 0;
  private dprScale = 1;          // 自适应分辨率系数
  private perfAccum = 0;         // 降/升分辨率冷却计时
  private basis = {
    right: [1, 0, 0] as Vec3,
    up: [0, 1, 0] as Vec3,
    fwd: [0, 0, -1] as Vec3,
    eye: [0, 0, 0] as Vec3,
  };

  constructor(private canvas: HTMLCanvasElement, private sim: Simulation) {
    const gl = canvas.getContext('webgl2', {
      antialias: true, powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('当前浏览器不支持 WebGL2');
    this.gl = gl;
    this.iceProg = this.program(VERT_ICE, FRAG_ICE);
    this.pebProg = this.program(VERT_PEB, FRAG_PEB);
    this.lineProg = this.program(VERT_LINE, FRAG_LINE);
    this.iceVAO = this.buildIce();
    // 卵石仅毫米级:近景 64 三角形、远景 10 三角形,省下的顶点换帧率
    const near = hemisphere(4, 8);    // 192 索引
    const far = hemisphere(1, 5);    // 30 索引
    this.nearMesh = { vbo: this.meshBuffer(near.v), n: near.n };
    this.farMesh = { vbo: this.meshBuffer(far.v), n: far.n };
    this.pebVAO = this.buildPebbles();
    this.lineVAO = this.buildLines();
    this.heightTex = this.makeTex(NX, NZ, null, gl.R32F, gl.RED, gl.FLOAT);
    this.redTex = this.makeTex(NX, NZ, null, gl.R8, gl.RED, gl.UNSIGNED_BYTE);
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.07, 0.09, 0.12, 1);
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error('shader 编译失败: ' + gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  private program(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error('program 链接失败: ' + gl.getProgramInfoLog(p));
    }
    return p;
  }

  private meshBuffer(data: Float32Array): WebGLBuffer {
    const gl = this.gl;
    const b = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return b;
  }

  private buildIce(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const grid = new Float32Array(NX * NZ * 2);
    for (let i = 0; i < NX; i++) {
      for (let j = 0; j < NZ; j++) {
        const k = (i * NZ + j) * 2;
        grid[k] = i;
        grid[k + 1] = j;
      }
    }
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // 整个网格一条 TRIANGLE_STRIP 索引
    const strip: number[] = [];
    for (let i = 0; i < NX - 1; i++) {
      if (i > 0) strip.push(i * NZ); // degenerate 连接相邻行
      for (let j = 0; j < NZ; j++) {
        strip.push(i * NZ + j, (i + 1) * NZ + j);
      }
    }
    const idx = Uint32Array.from(strip);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.iceIndexCount = idx.length;
    gl.bindVertexArray(null);
    return vao;
  }

  private buildPebbles(): WebGLVertexArrayObject {
    const gl = this.gl;
    // 全量实例数据(CPU 侧数据源,不直接参与绘制)
    this.pebVBO = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pebVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.sim.peb.byteLength, gl.DYNAMIC_DRAW);

    // 可见实例紧凑缓冲(每 12 帧重建)
    this.visibleVBO = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.visibleVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.sim.peb.byteLength, gl.DYNAMIC_DRAW);

    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nearMesh.vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    const stride = PEB_STRIDE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.visibleVBO);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
    return vao;
  }

  private buildLines(): WebGLVertexArrayObject {
    const gl = this.gl;
    const y = 0.45;  // 抬到垂直夸张后的冰面之上
    const pts: number[] = [];
    const add = (x1: number, z1: number, x2: number, z2: number) => {
      pts.push(x1, y, z1, x2, y, z2);
    };
    add(-SHEET_W / 2, -SHEET_L / 2, SHEET_W / 2, -SHEET_L / 2);
    add(SHEET_W / 2, -SHEET_L / 2, SHEET_W / 2, SHEET_L / 2);
    add(SHEET_W / 2, SHEET_L / 2, -SHEET_W / 2, SHEET_L / 2);
    add(-SHEET_W / 2, SHEET_L / 2, -SHEET_W / 2, -SHEET_L / 2);
    add(-SHEET_W / 2, -10.97, SHEET_W / 2, -10.97);
    add(-SHEET_W / 2, 10.97, SHEET_W / 2, 10.97);
    for (const cz of [-16.459, 16.459]) {
      for (const rad of [0.152, 0.61, 1.219, 1.829]) {
        const N = 48;
        for (let k = 0; k < N; k++) {
          const a = (k / N) * Math.PI * 2;
          const b = ((k + 1) / N) * Math.PI * 2;
          add(Math.cos(a) * rad, cz + Math.sin(a) * rad,
            Math.cos(b) * rad, cz + Math.sin(b) * rad);
        }
      }
      add(0, cz - 1.829, 0, cz + 1.829);
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.lineCount = pts.length / 3;
    gl.bindVertexArray(null);
    return vao;
  }

  private makeTex(w: number, h: number, data: ArrayBufferView | null,
    internal: number, fmt: number, type: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, fmt, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private uploadHeight() {
    const gl = this.gl;
    const h = this.sim.height;
    const buf = new Uint8Array(h.length);
    let min = Infinity;
    let max = -Infinity;
    for (let k = 0; k < h.length; k++) {
      if (h[k] < min) min = h[k];
      if (h[k] > max) max = h[k];
    }
    const scale = Math.max(max - min, 1e-6) / 255;
    this.hScale = { x: scale, y: min };
    for (let k = 0; k < h.length; k++) {
      buf[k] = clamp((h[k] - min) / scale, 0, 255);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NX, NZ,
      gl.RED, gl.UNSIGNED_BYTE, buf);
    gl.bindTexture(gl.TEXTURE_2D, this.redTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NX, NZ,
      gl.RED, gl.UNSIGNED_BYTE, this.sim.redMask);
  }

  private uploadPebbles() {
    if (this.sim.pebVersion === this.uploadedVersion) return;
    const gl = this.gl;
    this.uploadedVersion = this.sim.pebVersion;
    this.uploadedCount = this.sim.pebCount;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.pebVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.sim.peb.byteLength, gl.DYNAMIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0,
      this.sim.peb.subarray(0, this.sim.pebCount * PEB_STRIDE));
    this.frameNo = 0; // 强制重建可见缓冲
  }

  /** 相机在世界系中的位置 */
  eye(): [number, number, number] {
    const c = this.cam;
    return [
      Math.sin(c.yaw) * Math.cos(c.pitch) * c.dist,
      Math.sin(c.pitch) * c.dist + c.targetY + 4,
      Math.cos(c.yaw) * Math.cos(c.pitch) * c.dist,
    ];
  }

  /** 相机移动后立即作废可见索引,下一帧重建 */
  invalidateVisibility() {
    this.frameNo = 0;
  }

  /** 每 12 帧按相机视锥把可见实例压缩进紧凑缓冲,近景高模/远景低模,锥外剔除 */
  private rebuildVisibility() {
    const { eye, right, up, fwd } = this.basis;
    const fov = (48 * Math.PI) / 180;
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const halfH = Math.tan(fov / 2);
    const halfW = halfH * aspect;
    const nearPlane = 1;
    const farPlane = 130;
    const nearCut = 12;   // 12m 内高模,其余低模
    const p = this.sim.peb;
    const needNear = this.uploadedCount * PEB_STRIDE;
    if (this.nearData.length < needNear) {
      this.nearData = new Float32Array(needNear);
      this.farData = new Float32Array(needNear);
    }
    let ni = 0;
    let fi = 0;
    for (let k = 0; k < this.uploadedCount; k++) {
      const o = k * PEB_STRIDE;
      const rx = p[o] - eye[0];
      const ry = p[o + 3] * 0.001 - eye[1];
      const rz = p[o + 1] - eye[2];
      // 视图空间:相机朝 -Z 看,深度 = r·fwd(前方为正)
      const vx = rx * right[0] + ry * right[1] + rz * right[2];
      const vy = rx * up[0] + ry * up[1] + rz * up[2];
      const depth = rx * fwd[0] + ry * fwd[1] + rz * fwd[2];
      if (depth < nearPlane || depth > farPlane) continue;
      // 留 0.4m 边界,避免边缘实例被误剔
      if (Math.abs(vx) > depth * halfW + 0.4) continue;
      if (Math.abs(vy) > depth * halfH + 0.4) continue;
      const tgt = depth < nearCut ? this.nearData : this.farData;
      const ti = depth < nearCut ? ni : fi;
      tgt.set(p.subarray(o, o + PEB_STRIDE), ti * PEB_STRIDE);
      if (depth < nearCut) ni++; else fi++;
    }
    this.nearCount = ni;
    this.farCount = fi;
    this.visibleCount = ni + fi;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.visibleVBO);
    gl.bufferData(gl.ARRAY_BUFFER, this.sim.peb.byteLength, gl.DYNAMIC_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0,
      this.nearData.subarray(0, ni * PEB_STRIDE));
    gl.bufferSubData(gl.ARRAY_BUFFER, ni * PEB_STRIDE * 4,
      this.farData.subarray(0, fi * PEB_STRIDE));
  }

  private viewProj(): Float32Array {
    const c = this.cam;
    const eye = this.eye();
    const target: Vec3 = [0, c.targetY, 0];
    const fwd = norm3(sub3(target, eye));
    const right = norm3(cross3(fwd, [0, 1, 0]));
    const camUp = cross3(right, fwd);
    this.basis = { eye, right: right as Vec3, up: camUp as Vec3, fwd: fwd as Vec3 };
    const fov = (48 * Math.PI) / 180;
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const near = 0.1;
    const far = 130;
    const f = 1 / Math.tan(fov / 2);
    const view = new Float32Array([
      right[0], camUp[0], -fwd[0], 0,
      right[1], camUp[1], -fwd[1], 0,
      right[2], camUp[2], -fwd[2], 0,
      -dot3(right, eye), -dot3(camUp, eye), dot3(fwd, eye), 1,
    ]);
    const proj = new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) / (near - far), -1,
      0, 0, (2 * far * near) / (near - far), 0,
    ]);
    return mul4(proj, view);
  }

  frame(dt: number) {
    const gl = this.gl;
    // 自适应分辨率:持续低帧就降渲染分辨率,帧率富余再慢慢升回来
    this.perfAccum += dt;
    if (this.perfAccum > 1.2) {
      if (this.fps < 45 && this.dprScale > 0.5) this.dprScale -= 0.18;
      else if (this.fps > 57 && this.dprScale < 1) this.dprScale += 0.08;
      this.perfAccum = 0;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.dprScale;
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.uploadHeight();
    this.uploadPebbles();
    if (this.frameNo++ % 12 === 0) this.rebuildVisibility();
    const vp = this.viewProj();

    // ---- 冰面 ----
    gl.useProgram(this.iceProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.iceProg, 'uVP'), false, vp);
    gl.uniform3fv(gl.getUniformLocation(this.iceProg, 'uHScale'),
      [this.hScale.x, this.hScale.y, this.heightExag]);
    gl.uniform1f(gl.getUniformLocation(this.iceProg, 'uShowRed'),
      this.showRed ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
    gl.uniform1i(gl.getUniformLocation(this.iceProg, 'uHeight'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.redTex);
    gl.uniform1i(gl.getUniformLocation(this.iceProg, 'uRed'), 1);
    gl.bindVertexArray(this.iceVAO);
    gl.drawElements(gl.TRIANGLE_STRIP, this.iceIndexCount,
      gl.UNSIGNED_INT, 0);

    // ---- 卵石点:近景高模、远景低模,按实例索引绘制 ----
    if (this.uploadedCount > 0) {
      gl.useProgram(this.pebProg);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.pebProg, 'uVP'), false, vp);
      gl.uniform3fv(gl.getUniformLocation(this.pebProg, 'uHScale'),
        [this.hScale.x, this.hScale.y, this.heightExag]);
      gl.uniform1f(gl.getUniformLocation(this.pebProg, 'uPebScale'), this.pebScale);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.heightTex);
      gl.uniform1i(gl.getUniformLocation(this.pebProg, 'uHeight'), 0);
      gl.bindVertexArray(this.pebVAO);
      this.drawLod(this.nearMesh, this.nearCount, 0);
      this.drawLod(this.farMesh, this.farCount, this.nearCount);
    }

    // ---- 场地线 ----
    gl.useProgram(this.lineProg);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProg, 'uVP'), false, vp);
    gl.uniform4fv(gl.getUniformLocation(this.lineProg, 'uColor'),
      new Float32Array([0.92, 0.28, 0.22, 1]));
    gl.bindVertexArray(this.lineVAO);
    gl.drawArrays(gl.LINES, 0, this.lineCount);
    gl.bindVertexArray(null);

    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) {
      this.fps = Math.round(this.frames / this.fpsT);
      this.frames = 0;
      this.fpsT = 0;
    }
  }

  /** 切换 LOD 网格与实例缓冲字节偏移,近/远各一次 draw call */
  private drawLod(mesh: { vbo: WebGLBuffer; n: number },
    count: number, instanceOffset: number) {
    if (!count) return;
    const gl = this.gl;
    const stride = PEB_STRIDE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.visibleVBO);
    const byteOffset = instanceOffset * stride;
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, byteOffset);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, byteOffset + 16);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.n, count);
  }
}

function sub3(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function dot3(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross3(a: number[], b: number[]): number[] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function norm3(a: number[]): number[] {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function mul4(a: Float32Array, b: Float32Array): Float32Array {
  const o = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] = a[r * 4] * b[c]
        + a[r * 4 + 1] * b[4 + c]
        + a[r * 4 + 2] * b[8 + c]
        + a[r * 4 + 3] * b[12 + c];
    }
  }
  return o;
}
