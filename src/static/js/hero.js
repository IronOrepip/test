// Home hero media: the animated background from the original homepage, confined to the hero.
// One WebGL pass. It stops when reduced motion is requested or the hero is off screen.
const canvas = document.querySelector('[data-hero-canvas]');
const gl = canvas?.getContext('webgl', { alpha: false, antialias: true });
if (gl) {
  const vertex = 'attribute vec2 p; varying vec2 uv; void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }';
  const fragment = [
    'precision highp float;',
    'varying vec2 uv; uniform vec2 res; uniform float t;',
    'vec2 hash2(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return -1.0 + 2.0 * fract(sin(p) * 43758.5453); }',
    'float noise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(dot(hash2(i), f), dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x), mix(dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y); }',
    'float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.0; a *= 0.5; } return v; }',
    'void main() {',
    '  vec2 flow = uv * vec2(res.x / res.y, 1.0) * 0.9; float s = t * 0.05;',
    '  vec2 q = vec2(fbm(flow + s), fbm(flow + vec2(5.2, 1.3) - s));',
    '  vec2 r = vec2(fbm(flow + 3.0 * q + vec2(1.7, 9.2) + s * 1.5), fbm(flow + 3.0 * q + vec2(8.3, 2.8) - s));',
    '  float f = fbm(flow + 3.0 * r); float x = f * 2.2 + q.x * 1.3 + r.y * 0.8;',
    '  vec3 iri = 0.5 + 0.5 * cos(6.2832 * (x + vec3(0.0, 0.18, 0.42)));',
    '  iri = mix(iri, vec3(0.949, 0.314, 0.059), smoothstep(0.55, 0.95, iri.r) * 0.6);',
    '  vec3 color = mix(vec3(0.063, 0.078, 0.094), iri * 0.85, smoothstep(-0.25, 0.45, f + 0.6 * q.y) * 0.8);',
    '  gl_FragColor = vec4(color, 1.0);',
    '}'
  ].join('\n');
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  };
  const vs = compile(gl.VERTEX_SHADER, vertex), fs = compile(gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (vs && fs) {
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
  }
  if (vs && fs && gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(program, 'res'), uTime = gl.getUniformLocation(program, 't');
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let visible = true, pending = false, lost = false;
    const size = () => {
      const d = Math.min(devicePixelRatio || 1, 1.5);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * d * 0.5));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * d * 0.5));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    const frame = (ms) => {
      pending = false;
      if (lost) return;
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, motion.matches ? 20 : 20 + ms / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!motion.matches && visible) schedule();
    };
    const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(frame); } };
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
    new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) schedule(); }).observe(canvas);
    motion.addEventListener('change', schedule);
    addEventListener('resize', () => { size(); schedule(); });
    size();
    schedule();
  }
}
