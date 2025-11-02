// Turbo Lite: single-pass WebGL shader, 1080px cap, instant re-render.
const cin = document.getElementById('cin');
const cout = document.getElementById('cout');
const fileInput = document.getElementById('fileInput');
const autoBtn = document.getElementById('autoBtn');
const downloadBtn = document.getElementById('downloadBtn');
const statusEl = document.getElementById('status');

const strengthEl = document.getElementById('strength');
const scratchEl  = document.getElementById('scratch');
const smoothEl   = document.getElementById('smooth');
const detailEl   = document.getElementById('detail');
const contrastEl = document.getElementById('contrast');
const satEl      = document.getElementById('sat');
const warmEl     = document.getElementById('warm');

let gl, program, quad, texSrc;
let imgEl = null;

function status(t){ statusEl.textContent = t; }

function makeGL(canvas){
  const g = canvas.getContext('webgl', {premultipliedAlpha:false, preserveDrawingBuffer:true, powerPreference:'high-performance'});
  if(!g) throw new Error('WebGL not available.');
  return g;
}

const vsSrc = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv = (a_pos*0.5)+0.5;
  gl_Position = vec4(a_pos,0.0,1.0);
}`;

const fsSrc = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_strength; // 0..1
uniform float u_scratch;  // 0..1
uniform float u_smooth;   // 0..1
uniform float u_detail;   // 0..1
uniform float u_contrast; // 0..1
uniform float u_sat;      // 0..1
uniform float u_warm;     // -1..1

float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }

// HSL helpers
vec3 rgb2hsl(vec3 c){
  float mx=max(max(c.r,c.g),c.b), mn=min(min(c.r,c.g),c.b);
  float L=(mx+mn)*0.5; float S=0.0; float H=0.0;
  if(mx!=mn){
    float d=mx-mn;
    S = L>0.5 ? d/(2.0-mx-mn) : d/(mx+mn);
    if(mx==c.r) H=(c.g-c.b)/d + (c.g < c.b ? 6.0:0.0);
    else if(mx==c.g) H=(c.b-c.r)/d + 2.0;
    else H=(c.r-c.g)/d + 4.0;
    H/=6.0;
  }
  return vec3(H,S,L);
}
float hue2rgb(float p,float q,float t){
  if(t<0.0)t+=1.0; if(t>1.0)t-=1.0;
  if(t<1.0/6.0) return p+(q-p)*6.0*t;
  if(t<1.0/2.0) return q;
  if(t<2.0/3.0) return p+(q-p)*(2.0/3.0 - t)*6.0;
  return p;
}
vec3 hsl2rgb(vec3 hsl){
  float H=hsl.x,S=hsl.y,L=hsl.z; float r,g,b;
  if(S==0.0){ r=g=b=L; } else {
    float q = L<0.5 ? L*(1.0+S) : L+S-L*S;
    float p = 2.0*L - q;
    r = hue2rgb(p,q,H+1.0/3.0);
    g = hue2rgb(p,q,H);
    b = hue2rgb(p,q,H-1.0/3.0);
  }
  return vec3(r,g,b);
}

void main(){
  vec2 t = u_texel;
  vec3 c  = texture2D(u_tex, v_uv).rgb;
  vec3 l  = texture2D(u_tex, v_uv + vec2(-t.x, 0.0)).rgb;
  vec3 r  = texture2D(u_tex, v_uv + vec2( t.x, 0.0)).rgb;
  vec3 u  = texture2D(u_tex, v_uv + vec2(0.0, -t.y)).rgb;
  vec3 d  = texture2D(u_tex, v_uv + vec2(0.0,  t.y)).rgb;

  // ---- Tone + Contrast (pre) ----
  float k = 1.0 + 1.5*u_contrast;
  vec3 pre = pow(c, vec3(0.9 + 0.2*u_strength));
  pre = clamp((pre - 0.5) * k + 0.5, 0.0, 1.0);

  // ---- Scratch attenuate (thin line guess) ----
  float lh = abs(luma(l) - luma(r));
  float lv = abs(luma(u) - luma(d));
  float edge = max(lh, lv);
  vec3 medH = (l + c + r) / 3.0;
  vec3 medV = (u + c + d) / 3.0;
  vec3 med  = mix(medH, medV, 0.5);
  float dev = distance(pre, med);
  float mask = smoothstep(0.05, 0.15, dev) * (1.0 - smoothstep(0.05, 0.20, edge));
  vec3 noScratch = mix(pre, med, u_scratch * mask);

  // ---- Edge-aware smooth (very light, 5 taps) ----
  vec3 u2  = texture2D(u_tex, v_uv + vec2(0.0, -2.0*t.y)).rgb;
  vec3 d2  = texture2D(u_tex, v_uv + vec2(0.0,  2.0*t.y)).rgb;
  float centerL = luma(noScratch);
  float w1 = exp(-abs(luma(l)-centerL)*10.0);
  float w2 = exp(-abs(luma(r)-centerL)*10.0);
  float w3 = exp(-abs(luma(u)-centerL)*10.0);
  float w4 = exp(-abs(luma(d)-centerL)*10.0);
  float w5 = exp(-abs(luma(u2)-centerL)*12.0)*0.6;
  float w6 = exp(-abs(luma(d2)-centerL)*12.0)*0.6;
  float wsum = 1.0 + w1 + w2 + w3 + w4 + w5 + w6;
  vec3 blur = (noScratch + l*w1 + r*w2 + u*w3 + d*w4 + u2*w5 + d2*w6) / wsum;
  vec3 sm = mix(noScratch, blur, u_smooth);

  // ---- Unsharp (mix with sharpened residual) ----
  vec3 sharp = sm + (sm - blur) * (0.8*u_detail);
  // prevent halos
  sharp = clamp(mix(sm, sharp, 0.85), 0.0, 1.0);

  // ---- Warmth + Saturation ----
  vec3 hsl = rgb2hsl(sharp);
  hsl.x = fract(hsl.x + u_warm * 0.03);
  hsl.y = clamp(hsl.y * (1.0 + 0.8*u_sat), 0.0, 1.0);
  vec3 outc = hsl2rgb(hsl);
  outc = pow(outc, vec3(1.0/1.05)); // mild gamma

  gl_FragColor = vec4(outc, 1.0);
}
`;

function compile(gl, type, src){
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s));
  }
  return s;
}
function link(gl, vsSrc, fsSrc){
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { throw new Error(gl.getProgramInfoLog(p)); }
  return p;
}

function initGL(w,h){
  if (gl) return;
  gl = makeGL(cout);
  cout.width = w; cout.height = h;
  program = link(gl, vsSrc, fsSrc);

  quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([ -1,-1, 1,-1, -1,1,  -1,1, 1,-1, 1,1 ]), gl.STATIC_DRAW);

  texSrc = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texSrc);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

function draw(){
  if (!gl || !imgEl) return;
  gl.bindTexture(gl.TEXTURE_2D, texSrc);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgEl);

  gl.viewport(0,0, cout.width, cout.height);
  gl.useProgram(program);

  const a_pos = gl.getAttribLocation(program, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(a_pos);
  gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texSrc);
  gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0);
  gl.uniform2f(gl.getUniformLocation(program, 'u_texel'), 1.0/cout.width, 1.0/cout.height);

  gl.uniform1f(gl.getUniformLocation(program, 'u_strength'), Number(strengthEl.value)/100);
  gl.uniform1f(gl.getUniformLocation(program, 'u_scratch'),  Number(scratchEl.value)/100);
  gl.uniform1f(gl.getUniformLocation(program, 'u_smooth'),   Number(smoothEl.value)/100);
  gl.uniform1f(gl.getUniformLocation(program, 'u_detail'),   Number(detailEl.value)/100);
  gl.uniform1f(gl.getUniformLocation(program, 'u_contrast'), Number(contrastEl.value)/100);
  gl.uniform1f(gl.getUniformLocation(program, 'u_sat'),      Number(satEl.value)/100);
  gl.uniform1f(gl.getUniformLocation(program, 'u_warm'),     Number(warmEl.value)/50);

  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // mirror original on the left
  const ctxIn = cin.getContext('2d');
  ctxIn.drawImage(imgEl, 0, 0, cin.width, cin.height);
}

function loadImage(file){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.onload = ()=> resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

fileInput.addEventListener('change', async (e)=>{
  const f = e.target.files?.[0];
  if (!f) return;
  status('Loading…');
  let img;
  try { img = await loadImage(f); } catch { status('Could not load image.'); return; }
  imgEl = img;
  // Cap size to 1080px on the longer side for speed
  const maxSide = 1080;
  let W = img.width, H = img.height;
  const r = Math.min(maxSide/W, maxSide/H, 1);
  W = Math.round(W * r); H = Math.round(H * r);

  cin.width = W; cin.height = H;
  cout.width = W; cout.height = H;

  try { initGL(W,H); } catch (err) { status('WebGL error: ' + err.message); return; }
  draw();
  status('Ready — tweak sliders or use Auto Fix, then Download.');
  downloadBtn.disabled = false;
});

autoBtn.addEventListener('click', ()=>{
  strengthEl.value = 70;
  scratchEl.value  = 40;
  smoothEl.value   = 25;
  detailEl.value   = 30;
  contrastEl.value = 22;
  satEl.value      = 16;
  warmEl.value     = 6;
  draw();
});

[strengthEl, scratchEl, smoothEl, detailEl, contrastEl, satEl, warmEl].forEach(el=>{
  el.addEventListener('input', draw);
});

downloadBtn.addEventListener('click', ()=>{
  cout.toBlob((blob)=>{
    const a = document.createElement('a');
    a.download = 'restored_lite.jpg';
    a.href = URL.createObjectURL(blob);
    a.click();
  }, 'image/jpeg', 0.95);
});
