// comp.js: WebGL2 compositor. Accumulates K subframes
// (motion blur) in a float FBO, then a final pass adds bloom, chromatic aberration, vignette and film grain.
'use strict';
function makeComp(out) {
  const gl = out.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false, premultipliedAlpha: false });
  if (!gl) throw new Error('no webgl2');
  const hasFloat = !!gl.getExtension('EXT_color_buffer_float');
  const VS = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
  const FS_ACC = `#version 300 es
precision highp float; uniform sampler2D src; uniform float w; uniform vec2 res; out vec4 o;
void main(){ vec2 uv = gl_FragCoord.xy / res; uv.y = 1.0 - uv.y; o = vec4(texture(src, uv).rgb * w, 1.0); }`;
  const FS_FIN = `#version 300 es
precision highp float; uniform sampler2D acc; uniform vec2 res; uniform float frame, grain, ca, vig, bloom; out vec4 o;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 uv = gl_FragCoord.xy / res; vec2 d = uv - 0.5;
  vec3 col;
  if (ca > 0.01) { vec2 off = d * 2.0 * ca / res; col.r = texture(acc, uv + off).r; col.g = texture(acc, uv).g; col.b = texture(acc, uv - off).b; }
  else col = texture(acc, uv).rgb;
  if (bloom > 0.0) { vec3 b = vec3(0.0); float wsum = 0.0;
    for (int i = 0; i < 12; i++) { float a = float(i) * 0.5236; for (int k = 1; k <= 3; k++) { float rr = float(k) * 7.0; vec2 o2 = vec2(cos(a), sin(a)) * rr / res;
      vec3 s = texture(acc, uv + o2).rgb; float w = 1.0 / float(k); b += max(s - 0.62, 0.0) * w; wsum += w; } }
    col += bloom * b / wsum * 2.2; }
  float r = length(d * vec2(1.0, 0.82));
  col *= 1.0 - vig * smoothstep(0.28, 0.78, r);
  float g = hash(gl_FragCoord.xy + vec2(frame * 17.13, frame * 7.77)) + hash(gl_FragCoord.yx * 1.7 + frame * 3.1) - 1.0;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col += g * grain * (0.55 + 0.45 * (1.0 - abs(lum - 0.5) * 2.0));
  o = vec4(col, 1.0);
}`;
  function prog(fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  const pAcc = prog(FS_ACC), pFin = prog(FS_FIN);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  function tex(internal, fmt, type) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, W, H, 0, fmt, type, null); return t;
  }
  const srcTex = tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
  const accTex = hasFloat ? tex(gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT) : tex(gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE);
  const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, accTex, 0);
  const fbOk = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const uA = { src: gl.getUniformLocation(pAcc, 'src'), w: gl.getUniformLocation(pAcc, 'w'), res: gl.getUniformLocation(pAcc, 'res') };
  const uF = ['acc', 'res', 'frame', 'grain', 'ca', 'vig', 'bloom'].reduce((o, k) => (o[k] = gl.getUniformLocation(pFin, k), o), {});
  gl.viewport(0, 0, W, H);

  function begin() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  function add(canvas, w) {
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.useProgram(pAcc); gl.uniform1i(uA.src, 0); gl.uniform1f(uA.w, w); gl.uniform2f(uA.res, W, H);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }
  function finish(frame, fx) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    gl.useProgram(pFin);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, accTex);
    gl.uniform1i(uF.acc, 0); gl.uniform2f(uF.res, W, H); gl.uniform1f(uF.frame, frame % 997);
    gl.uniform1f(uF.grain, fx.grain); gl.uniform1f(uF.ca, fx.ca); gl.uniform1f(uF.vig, fx.vig); gl.uniform1f(uF.bloom, fx.bloom || 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.finish();
  }
  return { begin, add, finish, info: () => ({ hasFloat, fbOk, renderer: gl.getParameter(gl.RENDERER) }) };
}
