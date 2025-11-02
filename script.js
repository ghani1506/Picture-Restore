// WebGL turbo old photo corrector (multiple shader passes)
const inCanvas = document.getElementById('canvasIn');
const outCanvas = document.getElementById('canvasOut');
const fileInput = document.getElementById('fileInput');
const statusEl = document.getElementById('status');
const autoBtn = document.getElementById('autoBtn');
const downloadBtn = document.getElementById('downloadBtn');

const strengthEl = document.getElementById('strength');
const scratchEl = document.getElementById('scratch');
const sharpenEl = document.getElementById('sharpen');
const smoothEl = document.getElementById('smooth');
const contrastEl = document.getElementById('contrast');
const satEl = document.getElementById('sat');
const warmEl = document.getElementById('warm');

let gl, progTone, progScratch, progSmooth, progUnsharp, progFinal;
let texSrc, texA, texB, fboA, fboB;
let quad;
let imgEl = null;

function status(t){ statusEl.textContent = t; }

function makeGL(canvas){
  const g = canvas.getContext('webgl', {premultipliedAlpha:false, preserveDrawingBuffer:true, powerPreference:'high-performance'});
  if(!g) throw new Error('WebGL not available.');
  return g;
}

function compile(gl, type, src){
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if(!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const msg = gl.getShaderInfoLog(s);
    console.error('Shader error:', msg, src);
    throw new Error('Shader compile error: ' + msg);
  }
  return s;
}

function link(gl, vsSrc, fsSrc){
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  if(!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Link error: ' + gl.getProgramInfoLog(p));
  return p;
}

const vsFull = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main(){
  v_uv = (a_pos*0.5)+0.5;
  gl_Position = vec4(a_pos,0.0,1.0);
}`;

function fragTone(){ return `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_contrast;
uniform float u_strength;
uniform float u_warm;
vec3 rgb2hsl(vec3 c){
  float maxc=max(max(c.r,c.g),c.b), minc=min(min(c.r,c.g),c.b);
  float L=(maxc+minc)*0.5; float S=0.0; float H=0.0;
  if(maxc!=minc){ float d=maxc-minc; S = L>0.5 ? d/(2.0-maxc-minc) : d/(maxc+minc);
    if(maxc==c.r) H=(c.g-c.b)/d + (c.g<c.b?6.0:0.0);
    else if(maxc==c.g) H=(c.b-c.r)/d + 2.0;
    else H=(c.r-c.g)/d + 4.0; H/=6.0; }
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
  vec3 c = texture2D(u_tex, v_uv).rgb;
  float k = 1.0 + 1.5*u_contrast;
  c = pow(c, vec3(0.9 + 0.2*u_strength));
  c = clamp((c-0.5)*k + 0.5, 0.0, 1.0);
  vec3 hsl = rgb2hsl(c);
  hsl.x = fract(hsl.x + u_warm*0.03);
  c = hsl2rgb(hsl);
  gl_FragColor = vec4(c,1.0);
}`;}

function fragScratch(){ return `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_amt;
float luminance(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
float median3(float a,float b,float c){ return max(min(a,b), min(max(a,b),c)); }
vec3 median3v(vec3 a, vec3 b, vec3 c){
  return vec3(median3(a.r,b.r,c.r), median3(a.g,b.g,c.g), median3(a.b,b.b,c.b));
}
void main(){
  vec3 C  = texture2D(u_tex, v_uv).rgb;
  vec3 L1 = texture2D(u_tex, v_uv + vec2(-u_texel.x,0.0)).rgb;
  vec3 R1 = texture2D(u_tex, v_uv + vec2( u_texel.x,0.0)).rgb;
  vec3 U1 = texture2D(u_tex, v_uv + vec2(0.0,-u_texel.y)).rgb;
  vec3 D1 = texture2D(u_tex, v_uv + vec2(0.0, u_texel.y)).rgb;

  vec3 Hmed = median3v(L1, C, R1);
  vec3 Vmed = median3v(U1, C, D1);
  vec3 med  = (Hmed + Vmed) * 0.5;

  float lH = abs(luminance(L1) - luminance(R1));
  float lV = abs(luminance(U1) - luminance(D1));
  float edge = max(lH, lV);
  float dev = distance(C, med);
  float mask = smoothstep(0.06, 0.16, dev) * (1.0 - smoothstep(0.05, 0.2, edge));
  vec3 outc = mix(C, med, clamp(u_amt,0.0,1.0) * mask);
  gl_FragColor = vec4(outc,1.0);
}`;}

function fragSmooth(){ return `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_amt;
float lum(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
void main(){
  vec3 c0 = texture2D(u_tex, v_uv).rgb;
  vec2 t = u_texel;
  vec3 s[9];
  int k=0;
  for(int j=-1;j<=1;j++){
    for(int i=-1;i<=1;i++){
      s[k++] = texture2D(u_tex, v_uv + vec2(float(i)*t.x, float(j)*t.y)).rgb;
    }
  }
  float centerL = lum(c0);
  vec3 acc = vec3(0.0); float wsum = 0.0;
  for(int n=0;n<9;n++){
    float dl = abs(lum(s[n]) - centerL);
    float w = exp(-dl*10.0);
    if(n==4) w += 0.5;
    acc += s[n]*w; wsum += w;
  }
  vec3 sm = acc / max(wsum, 1e-5);
  vec3 outc = mix(c0, sm, clamp(u_amt,0.0,1.0));
  gl_FragColor = vec4(outc,1.0);
}`;}

function fragUnsharp(){ return `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_amt;
void main(){
  vec2 t = u_texel;
  vec3 c00 = texture2D(u_tex, v_uv + vec2(-t.x,-t.y)).rgb;
  vec3 c10 = texture2D(u_tex, v_uv + vec2( 0.0,-t.y)).rgb;
  vec3 c20 = texture2D(u_tex, v_uv + vec2( t.x,-t.y)).rgb;
  vec3 c01 = texture2D(u_tex, v_uv + vec2(-t.x, 0.0)).rgb;
  vec3 c11 = texture2D(u_tex, v_uv).rgb;
  vec3 c21 = texture2D(u_tex, v_uv + vec2( t.x, 0.0)).rgb;
  vec3 c02 = texture2D(u_tex, v_uv + vec2(-t.x, t.y)).rgb;
  vec3 c12 = texture2D(u_tex, v_uv + vec2( 0.0, t.y)).rgb;
  vec3 c22 = texture2D(u_tex, v_uv + vec2( t.x, t.y)).rgb;
  vec3 blur = (c00+c20+c02+c22)*0.0625 + (c10+c01+c21+c12)*0.125 + c11*0.25;
  vec3 sharp = mix(c11, c11 + (c11 - blur)*1.5, clamp(u_amt,0.0,1.0));
  gl_FragColor = vec4(sharp,1.0);
}`;}

function fragFinal(){ return `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_sat;
vec3 rgb2hsl(vec3 c){
  float maxc=max(max(c.r,c.g),c.b), minc=min(min(c.r,c.g),c.b);
  float L=(maxc+minc)*0.5; float S=0.0; float H=0.0;
  if(maxc!=minc){ float d=maxc-minc; S = L>0.5 ? d/(2.0-maxc-minc) : d/(maxc+minc);
    if(maxc==c.r) H=(c.g-c.b)/d + (c.g<c.b?6.0:0.0);
    else if(maxc==c.g) H=(c.b-c.r)/d + 2.0;
    else H=(c.r-c.g)/d + 4.0; H/=6.0; }
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
  vec3 c = texture2D(u_tex, v_uv).rgb;
  vec3 hsl = rgb2hsl(c);
  hsl.y = clamp(hsl.y * (1.0 + 0.8*u_sat), 0.0, 1.0);
  c = hsl2rgb(hsl);
  c = pow(c, vec3(1.0/1.05));
  gl_FragColor = vec4(c,1.0);
}`;}

function initGL(width, height){
  if(gl) return;
  gl = makeGL(outCanvas);
  outCanvas.width = width; outCanvas.height = height;

  progTone    = link(gl, vsFull, fragTone());
  progScratch = link(gl, vsFull, fragScratch());
  progSmooth  = link(gl, vsFull, fragSmooth());
  progUnsharp = link(gl, vsFull, fragUnsharp());
  progFinal   = link(gl, vsFull, fragFinal());

  // Quad
  quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([ -1,-1, 1,-1, -1,1,  -1,1, 1,-1, 1,1 ]), gl.STATIC_DRAW);

  function makeTex(w,h){
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }
  function makeFBO(tex){
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return fb;
  }
  texA = makeTex(width, height);
  texB = makeTex(width, height);
  fboA = makeFBO(texA);
  fboB = makeFBO(texB);

  texSrc = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texSrc);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

function drawTo(tex, fb, program, uniforms){
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.viewport(0, 0, outCanvas.width, outCanvas.height);
  gl.useProgram(program);
  const a_pos = gl.getAttribLocation(program, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(a_pos);
  gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const u_tex = gl.getUniformLocation(program, 'u_tex');
  if (u_tex) gl.uniform1i(u_tex, 0);

  if (uniforms) uniforms(program);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function render(){
  if(!gl || !imgEl) return;
  gl.bindTexture(gl.TEXTURE_2D, texSrc);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, imgEl);

  const texelX = 1.0 / outCanvas.width, texelY = 1.0 / outCanvas.height;

  drawTo(texSrc, fboA, progTone, (p)=>{
    gl.uniform1f(gl.getUniformLocation(p, 'u_contrast'), Number(contrastEl.value)/100);
    gl.uniform1f(gl.getUniformLocation(p, 'u_strength'), Number(strengthEl.value)/100);
    gl.uniform1f(gl.getUniformLocation(p, 'u_warm'), Number(warmEl.value)/50.0);
  });

  drawTo(texA, fboB, progScratch, (p)=>{
    gl.uniform2f(gl.getUniformLocation(p, 'u_texel'), texelX, texelY);
    gl.uniform1f(gl.getUniformLocation(p, 'u_amt'), Number(scratchEl.value)/100);
  });

  drawTo(texB, fboA, progSmooth, (p)=>{
    gl.uniform2f(gl.getUniformLocation(p, 'u_texel'), texelX, texelY);
    gl.uniform1f(gl.getUniformLocation(p, 'u_amt'), Number(smoothEl.value)/100);
  });

  drawTo(texA, fboB, progUnsharp, (p)=>{
    gl.uniform2f(gl.getUniformLocation(p, 'u_texel'), texelX, texelY);
    gl.uniform1f(gl.getUniformLocation(p, 'u_amt'), Number(sharpenEl.value)/100);
  });

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, outCanvas.width, outCanvas.height);
  gl.useProgram(progFinal);
  const a_pos = gl.getAttribLocation(progFinal, 'a_pos');
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.enableVertexAttribArray(a_pos);
  gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texB);
  gl.uniform1i(gl.getUniformLocation(progFinal, 'u_tex'), 0);
  gl.uniform1f(gl.getUniformLocation(progFinal, 'u_sat'), Number(satEl.value)/100);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  const ctxIn = inCanvas.getContext('2d');
  ctxIn.drawImage(imgEl, 0, 0, inCanvas.width, inCanvas.height);
}

function loadImage(file){
  return new Promise((resolve, reject)=>{
    const img = new Image();
    img.onload = ()=> resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

fileInput.addEventListener('change', async (e)=>{
  const f = e.target.files?.[0];
  if(!f) return;
  status('Loading image…');
  let img;
  try{ img = await loadImage(f); } catch{ status('Could not load image.'); return; }
  imgEl = img;
  const maxW = 3000, maxH = 3000; // keep speedy but high-res
  const r = Math.min(maxW/img.width, maxH/img.height, 1);
  const W = Math.round(img.width*r), H = Math.round(img.height*r);
  inCanvas.width = W; inCanvas.height = H;
  outCanvas.width = W; outCanvas.height = H;
  try{ initGL(W,H); } catch(err){ status('WebGL error: '+err.message); return; }
  render();
  status('Loaded. Use Auto Fix or adjust sliders, then Download.');
  downloadBtn.disabled = false;
});

autoBtn.addEventListener('click', ()=>{
  strengthEl.value = 65;
  scratchEl.value  = 45;
  smoothEl.value   = 25;
  sharpenEl.value  = 35;
  contrastEl.value = 22;
  satEl.value      = 16;
  warmEl.value     = 6;
  render();
});

[strengthEl, scratchEl, sharpenEl, smoothEl, contrastEl, satEl, warmEl].forEach(el=>{
  el.addEventListener('input', ()=> render());
});

downloadBtn.addEventListener('click', ()=>{
  outCanvas.toBlob((blob)=>{
    const a = document.createElement('a');
    a.download = 'restored.jpg';
    a.href = URL.createObjectURL(blob);
    a.click();
  }, 'image/jpeg', 0.95);
});
