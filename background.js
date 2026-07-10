'use strict';
/* =============================================================
   動的背景エンジン — WebGLシェーダー4テーマ + 浮遊粒子
   テーマ: space(深宇宙) / nebula(星雲) / water(水面) / land(風景)
   ・低解像度レンダリング+拡大でモバイルでも軽量
   ・タブ非表示時は描画停止、prefers-reduced-motion では静止画
   ・WebGL非対応環境ではCSSの光彩(.bg-orbs)にフォールバック
   ・切替は window.setBgTheme('space'|'nebula'|'water'|'land')
   ============================================================= */
(function () {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LS_KEY = 'ml_bg';

  /* ---------- 共通GLSL(ノイズ関数) ---------- */
  const HEAD = `
precision highp float;
uniform float t;
uniform vec2 r;
uniform vec2 m;
uniform float s;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
/* リアルな月面: 球体シェーディング+海(マリア)+クレーター+周縁減光。
   戻り値: rgb=月面色, a=マスク */
vec4 moonSurf(vec2 md, float rad, float phase, vec3 tint){
  float dist = length(md);
  float mask = smoothstep(rad, rad * 0.982, dist);
  vec2 p = md / rad;
  float nz = sqrt(max(0.0, 1.0 - dot(p, p)));
  vec3 n = vec3(p, nz);
  vec3 L = normalize(vec3(cos(phase), 0.22, sin(phase)));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  float maria = fbm(p * 2.4 + vec2(3.1, 7.7));
  float tex = 1.0 - 0.38 * smoothstep(0.42, 0.75, maria);
  tex -= 0.20 * smoothstep(0.60, 0.92, fbm(p * 6.5 + 11.0));
  tex -= 0.10 * smoothstep(0.75, 0.95, fbm(p * 13.0 + 23.0));
  tex += (noise(p * 34.0) - 0.5) * 0.08;
  float limb = 0.5 + 0.5 * nz;
  vec3 c = tint * (0.05 + diff * max(tex, 0.0) * limb);
  return vec4(c, mask);
}
float stars(vec2 uv, float density, float speed){
  vec2 sp = uv * 130.0;
  vec2 id = floor(sp);
  vec2 gv = fract(sp) - 0.5;
  float s = hash(id);
  float thr = 1.0 - density;
  if (s > thr) {
    float tw = 0.55 + 0.45 * sin(t * (1.0 + s * 3.0) * speed + s * 40.0);
    float d = length(gv - (vec2(hash(id + 1.3), hash(id + 2.7)) - 0.5) * 0.6);
    return tw * smoothstep(0.18, 0.0, d) * (s - thr) / density * 0.8;
  }
  return 0.0;
}
`;

  /* ---------- テーマ別フラグメントシェーダー ---------- */
  const THEMES = {
    /* 深宇宙: 星雲+オーロラ+恒星フレア */
    space: HEAD + `
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * r) / r.y;
  uv += m * 0.10;
  vec3 col = vec3(0.012, 0.020, 0.046);

  float n1 = fbm(uv * 2.2 + vec2(t * 0.015, -t * 0.010));
  float n2 = fbm(uv * 3.1 + vec2(-t * 0.020, t * 0.008) + 5.2);
  float n3 = fbm(uv * 1.6 + vec2(0.0, t * 0.012) + 8.0);
  col += vec3(0.05, 0.24, 0.21) * pow(n1, 3.0) * 1.7;
  col += vec3(0.32, 0.17, 0.05) * pow(n2, 3.5) * 1.3;
  col += vec3(0.11, 0.11, 0.32) * pow(n3, 3.0) * 1.3;

  vec2 sunP = vec2(0.5 * r.x / r.y * 0.72, 0.34);
  vec2 sd = uv - sunP;
  float pulse = 0.9 + 0.1 * sin(t * 0.6);
  col += vec3(1.0, 0.86, 0.62) * (0.011 / (length(sd) + 0.015)) * 0.5 * pulse;
  col += vec3(1.0, 0.92, 0.75) * exp(-abs(sd.y) * 110.0) * exp(-abs(sd.x) * 5.0) * 0.30 * pulse;
  col += vec3(0.75, 0.88, 1.0) * exp(-abs(sd.x) * 110.0) * exp(-abs(sd.y) * 9.0) * 0.18 * pulse;

  float wave1 = fbm(vec2(uv.x * 2.5 + t * 0.05, t * 0.02));
  float band1 = exp(-abs(uv.y - 0.30 - 0.18 * wave1) * 6.0);
  col += vec3(0.05, 0.46, 0.39) * band1 * (0.30 + 0.40 * fbm(vec2(uv.x * 6.0 + t * 0.10, 2.0)));
  float wave2 = fbm(vec2(uv.x * 1.8 - t * 0.04, 7.0));
  float band2 = exp(-abs(uv.y - 0.05 - 0.22 * wave2) * 8.0);
  col += vec3(0.26, 0.19, 0.47) * band2 * 0.28;
  float wave3 = fbm(vec2(uv.x * 3.2 + t * 0.03, 11.0));
  float band3 = exp(-abs(uv.y + 0.42 - 0.10 * wave3) * 10.0);
  col += vec3(0.30, 0.22, 0.06) * band3 * 0.22;

  col += vec3(0.75, 0.85, 1.0) * stars(uv, 0.034, 1.0);
  col *= 1.0 - 0.56 * dot(uv * vec2(0.75, 1.05), uv * vec2(0.75, 1.05));
  gl_FragColor = vec4(col, 1.0);
}`,

    /* 星雲: ドメインワープで渦巻く極彩色のガス雲 */
    nebula: HEAD + `
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * r) / r.y;
  uv += m * 0.12;
  vec3 col = vec3(0.020, 0.012, 0.042);

  /* 渦(ドメインワープ) */
  vec2 q = vec2(fbm(uv * 1.6 + vec2(t * 0.02, 0.0)),
                fbm(uv * 1.6 + vec2(5.2, t * 0.015)));
  vec2 w = uv + 1.6 * (q - 0.5);
  float f1 = fbm(w * 2.4 + vec2(t * 0.010, -t * 0.014));
  float f2 = fbm(w * 3.2 - q * 1.5 + 3.7);
  float f3 = fbm(w * 4.4 + q * 2.0 + 9.1);

  col += vec3(0.42, 0.18, 0.70) * pow(f1, 2.4) * 1.15;   /* 紫 */
  col += vec3(0.08, 0.46, 0.42) * pow(f2, 3.0) * 1.05;   /* ティール */
  col += vec3(0.62, 0.18, 0.38) * pow(f3, 3.4) * 0.95;   /* ピンク */
  col += vec3(0.95, 0.75, 0.45) * pow(f1 * f2, 4.0) * 1.6; /* 中心の金色の輝き */

  /* 星雲の芯 */
  vec2 core = uv - vec2(-0.18, 0.06);
  col += vec3(0.9, 0.7, 1.0) * (0.006 / (length(core) + 0.05)) * (0.8 + 0.2 * sin(t * 0.4));

  col += vec3(0.85, 0.88, 1.0) * stars(uv, 0.05, 1.3);
  col += vec3(0.85, 0.88, 1.0) * stars(uv * 1.7 + 31.0, 0.03, 0.8) * 0.6;

  col *= 1.0 - 0.52 * dot(uv * vec2(0.75, 1.05), uv * vec2(0.75, 1.05));
  gl_FragColor = vec4(col, 1.0);
}`,

    /* 水面: 深海から見上げる光。コースティクスと光の柱 */
    water: HEAD + `
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * r) / r.y;
  uv += m * 0.08;

  /* 深度グラデーション(上ほど明るい) */
  vec3 deep    = vec3(0.004, 0.028, 0.048);
  vec3 shallow = vec3(0.016, 0.115, 0.135);
  vec3 col = mix(deep, shallow, smoothstep(-0.55, 0.55, uv.y));

  /* コースティクス(2層のノイズの積で鋭い網目に) */
  float c1 = fbm(uv * 5.0 + vec2(t * 0.11, t * 0.06));
  float c2 = fbm(uv * 5.0 - vec2(t * 0.09, -t * 0.05) + 3.3);
  float ca = pow(c1 * c2 * 4.0, 3.0);
  col += vec3(0.10, 0.42, 0.42) * ca * (0.16 + 0.5 * smoothstep(-0.2, 0.55, uv.y));

  /* 上から差す光の柱 */
  float ang = uv.x - (uv.y - 0.9) * 0.22;
  float beams = pow(fbm(vec2(ang * 3.2 + t * 0.04, 0.7)), 3.0);
  col += vec3(0.10, 0.34, 0.34) * beams * smoothstep(-0.35, 0.75, uv.y) * 1.5;

  /* 水面のゆらめき(画面上端) */
  float surf = exp(-abs(uv.y - 0.52) * 22.0);
  col += vec3(0.25, 0.65, 0.62) * surf * (0.4 + 0.6 * fbm(vec2(uv.x * 8.0 + t * 0.35, t * 0.2)));

  /* 深部の浮遊感(ごく淡い粒状ノイズ) */
  col += vec3(0.06, 0.16, 0.16) * pow(fbm(uv * 7.0 + vec2(0.0, t * 0.05)), 4.0);

  col *= 1.0 - 0.42 * dot(uv * vec2(0.8, 0.9), uv * vec2(0.8, 0.9));
  gl_FragColor = vec4(col, 1.0);
}`,

    /* 風景: 黄昏の山なみ+オーロラ+月 */
    land: HEAD + `
float ridge(vec2 uv, float base, float amp, float freq, float seed, float soft){
  float h = base + amp * fbm(vec2(uv.x * freq + seed, seed * 1.7));
  return smoothstep(h + soft, h - soft, uv.y);
}
void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5 * r) / r.y;
  uv.x += m.x * 0.13;
  uv.y -= m.y * 0.05;

  /* 黄昏の空 */
  vec3 skyTop = vec3(0.008, 0.016, 0.045);
  vec3 horizon = vec3(0.30, 0.19, 0.06);
  vec3 col = mix(horizon, skyTop, smoothstep(-0.30, 0.45, uv.y));

  /* 星(空の上部のみ) */
  col += vec3(0.8, 0.87, 1.0) * stars(uv, 0.03, 1.0) * smoothstep(-0.05, 0.25, uv.y);

  /* オーロラ */
  float wave = fbm(vec2(uv.x * 2.2 + t * 0.05, t * 0.02));
  float band = exp(-abs(uv.y - 0.22 - 0.16 * wave) * 7.0);
  col += vec3(0.06, 0.45, 0.35) * band * (0.35 + 0.45 * fbm(vec2(uv.x * 5.0 + t * 0.09, 2.0)));
  float band2 = exp(-abs(uv.y - 0.05 - 0.20 * fbm(vec2(uv.x * 1.5 - t * 0.03, 6.0))) * 9.0);
  col += vec3(0.22, 0.16, 0.40) * band2 * 0.25;

  /* 月(クレーター入りのリアル月・上弦過ぎ) */
  vec2 md = uv - vec2(-0.5 * r.x / r.y * 0.84, 0.42);
  vec4 mn = moonSurf(md, 0.052, 1.95, vec3(1.00, 0.99, 0.92));
  col = mix(col, mn.rgb, mn.a);
  col += vec3(0.50, 0.55, 0.52) * (0.0022 / (length(md) + 0.02)) * (1.0 - mn.a);

  /* 流れる薄雲 */
  float cloud = fbm(vec2(uv.x * 2.5 + t * 0.02, uv.y * 6.0 + 4.0));
  col += vec3(0.10, 0.09, 0.12) * pow(cloud, 3.0) * smoothstep(0.0, 0.3, uv.y) * 0.8;

  /* 山なみ(奥→手前) */
  float m1 = ridge(uv, -0.16, 0.13, 1.5, 3.7, 0.006);
  col = mix(col, vec3(0.030, 0.055, 0.075), m1);
  float m2 = ridge(uv, -0.25, 0.11, 2.3, 8.9, 0.005);
  col = mix(col, vec3(0.016, 0.032, 0.048), m2);
  float m3 = ridge(uv, -0.34, 0.09, 3.2, 17.3, 0.004);
  col = mix(col, vec3(0.006, 0.014, 0.024), m3);

  /* 谷にたまる霧 */
  float mist = fbm(vec2(uv.x * 3.0 + t * 0.015, 9.0));
  col += vec3(0.05, 0.09, 0.10) * mist * smoothstep(-0.20, -0.42, uv.y) * 0.9;

  col *= 1.0 - 0.40 * dot(uv * vec2(0.75, 1.0), uv * vec2(0.75, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`,

    /* 金泥山水: 紺紙に金泥で描く山水画のオマージュ。
       手前の稜線はシミュレーションの資産カーブそのもの(uniform c[64])。
       奥山はシード生成で、ダブルクリックすると生まれ変わる */
    shuimo: HEAD + `
uniform float c[64];
/* 資産カーブの高さをサンプリング(0..1 → 0..1) */
float curveH(float x01){
  float f = clamp(x01, 0.0, 1.0) * 63.0;
  float fi = floor(f);
  float fr = f - fi;
  float a = 0.0, b = 0.0;
  for (int i = 0; i < 64; i++) {
    float k = float(i);
    if (k == fi) a = c[i];
    if (k == fi + 1.0) b = c[i];
  }
  return mix(a, b, fr);
}
float goldWash(vec2 uv, float base, float amp, float freq, float layer, float scroll){
  float h = base + amp * fbm(vec2(uv.x * freq + scroll + s * (13.7 + layer * 7.1), layer * 4.3 + s));
  float inside = smoothstep(h + 0.005, h - 0.005, uv.y);
  return inside * (0.35 + 0.65 * exp(-(h - uv.y) * 6.0));
}
void main(){
  float aspect = 0.5 * r.x / r.y;
  vec2 uv = (gl_FragCoord.xy - 0.5 * r) / r.y;
  uv.x += m.x * 0.11;
  uv.y -= m.y * 0.04;
  float drift = t * 0.012;

  /* 紺紙(闇夜の藍) + 紙目 + まれに散る金砂子 */
  vec3 col = vec3(0.028, 0.032, 0.058);
  col += (noise(uv * 110.0 + s) - 0.5) * 0.016;
  float sunago = step(0.9965, hash(floor(uv * 260.0) + floor(s)));
  col += vec3(0.85, 0.66, 0.28) * sunago * (0.25 + 0.35 * sin(t * 1.5 + uv.x * 40.0));

  /* 金の月(クレーターまで金泥で描いた満月) */
  vec2 sd2 = uv - vec2(aspect * 0.82, 0.40);
  vec4 mn = moonSurf(sd2, 0.066, 1.62, vec3(1.15, 0.92, 0.52));
  col = mix(col, mn.rgb, mn.a);
  col += vec3(0.55, 0.40, 0.14) * (0.0030 / (length(sd2) + 0.02)) * (1.0 - mn.a);

  /* 奥山(金の淡彩・シード生成) */
  float w1 = goldWash(uv, 0.02, 0.10, 1.2, 1.0, drift * 0.25);
  col = mix(col, vec3(0.135, 0.110, 0.058), w1 * 0.85);
  float w2 = goldWash(uv, -0.07, 0.11, 1.9, 2.0, drift * 0.5);
  col = mix(col, vec3(0.095, 0.078, 0.042), w2 * 0.92);

  /* 金の霞 */
  float haze = fbm(vec2(uv.x * 1.5 + drift * 0.5 + s, 6.0 + s));
  col += vec3(0.19, 0.15, 0.07) * haze * exp(-abs(uv.y + 0.06) * 5.0) * 0.55;

  /* ===== 手前の山 = あなたの資産カーブ ===== */
  float x01 = (uv.x + aspect) / (2.0 * aspect);
  float h = -0.42 + curveH(x01) * 0.34;
  h += 0.010 * fbm(vec2(uv.x * 9.0 + s, 3.0));          /* 筆の揺らぎ */
  float inside = smoothstep(h + 0.004, h - 0.004, uv.y);

  /* 山体: 濃紺。稜線は金泥、裾へ金のにじみ */
  col = mix(col, vec3(0.012, 0.014, 0.026), inside * 0.96);
  float below = step(uv.y, h);
  col += vec3(0.98, 0.80, 0.38) * exp(-abs(uv.y - h) * 120.0) * (0.9 + 0.25 * sin(t * 0.8)) * 0.9;
  col += vec3(0.42, 0.32, 0.13) * below * exp(-(h - uv.y) * 9.0) * 0.75;
  /* 山肌に舞う金砂 */
  float dust = step(0.994, hash(floor(uv * 320.0) + 7.0));
  col += vec3(0.9, 0.7, 0.3) * dust * inside * (0.3 + 0.3 * sin(t * 2.0 + uv.y * 60.0));

  /* 落款(朱印) */
  vec2 sd = uv - vec2(aspect * 0.86, -0.40);
  float seal = step(max(abs(sd.x), abs(sd.y)), 0.018);
  float sealTex = 0.75 + 0.25 * noise(sd * 300.0);
  col = mix(col, vec3(0.60, 0.14, 0.09) * sealTex, seal * 0.85);

  col *= 1.0 - 0.30 * dot(uv * vec2(0.7, 0.95), uv * vec2(0.7, 0.95));
  gl_FragColor = vec4(col, 1.0);
}`,
  };

  /* ---------- 粒子レイヤーのテーマ設定 ---------- */
  const SPORE_CONF = {
    space:  { colors: ['94,234,212', '251,191,36', '165,180,252'], vy: [0.08, 0.43], sway: 30, count: 1.0, alpha: [0.25, 0.70], bottomOnly: false },
    nebula: { colors: ['192,132,252', '244,114,182', '94,234,212'], vy: [0.05, 0.30], sway: 40, count: 1.1, alpha: [0.25, 0.75], bottomOnly: false },
    water:  { colors: ['170,220,255', '140,235,225', '210,240,255'], vy: [0.45, 1.30], sway: 14, count: 1.4, alpha: [0.20, 0.55], bottomOnly: false },
    land:   { colors: ['251,191,36', '253,230,138', '167,243,208'], vy: [0.03, 0.14], sway: 55, count: 0.7, alpha: [0.30, 0.85], bottomOnly: true },
    shuimo: { colors: ['235,190,90', '250,220,140', '200,150,60'], vy: [0.02, 0.12], sway: 75, count: 0.5, alpha: [0.12, 0.40], bottomOnly: false },
  };

  /* ---------- WebGL 初期化 ---------- */
  let gl = null, canvas = null;
  const progs = {};
  let active = null;
  let mx = 0, my = 0, tx = 0, ty = 0;
  let running = true;
  let seed = Math.random() * 100;   // 山水などの地形シード(訪れるたびに違う景色)
  let px = -100, py = -100;         // カーソル位置(ピクセル・スクリーンセーバー用)
  /* 資産カーブ(金泥山水の手前の山)。設定されるまでは緩やかな上り坂 */
  let curveArr = new Float32Array(64).map((_, i) => 0.25 + 0.5 * (i / 63));
  const t0 = performance.now();

  function compileTheme(name) {
    if (progs[name]) return progs[name];
    const mk = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn('bg shader (' + name + '):', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };
    const vs = mk(gl.VERTEX_SHADER, 'attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }');
    const fs = mk(gl.FRAGMENT_SHADER, THEMES[name]);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    progs[name] = {
      prog,
      uT: gl.getUniformLocation(prog, 't'),
      uR: gl.getUniformLocation(prog, 'r'),
      uM: gl.getUniformLocation(prog, 'm'),
      uS: gl.getUniformLocation(prog, 's'),
      uC: gl.getUniformLocation(prog, 'c'),
      aP: gl.getAttribLocation(prog, 'p'),
    };
    return progs[name];
  }

  function resize() {
    if (!canvas) return;
    const s = 0.6 * Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.max(2, Math.round(canvas.clientWidth * s));
    canvas.height = Math.max(2, Math.round(canvas.clientHeight * s));
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (reduced) drawFrame(performance.now());
  }

  function drawFrame(now) {
    const p = active && progs[active];
    if (!p) return;
    mx += (tx - mx) * 0.03;
    my += (ty - my) * 0.03;
    gl.useProgram(p.prog);
    gl.enableVertexAttribArray(p.aP);
    gl.vertexAttribPointer(p.aP, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(p.uT, (now - t0) / 1000);
    gl.uniform2f(p.uR, canvas.width, canvas.height);
    gl.uniform2f(p.uM, mx, -my);
    if (p.uS) gl.uniform1f(p.uS, seed);
    if (p.uC) gl.uniform1fv(p.uC, curveArr);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function loop(now) {
    if (!running || reduced) return;
    drawFrame(now);
    requestAnimationFrame(loop);
  }

  function initGL() {
    canvas = document.createElement('canvas');
    canvas.id = 'bgGL';
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:-2;pointer-events:none;';
    gl = canvas.getContext('webgl', { antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) return false;
    document.body.prepend(canvas);
    document.documentElement.classList.add('gl-on');

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', e => {
      tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ty = (e.clientY / window.innerHeight - 0.5) * 2;
      px = e.clientX; py = e.clientY;
    }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      running = !document.hidden;
      if (running && !reduced) requestAnimationFrame(loop);
    });
    /* 余白をダブルクリック(ダブルタップ)すると景色が生まれ変わる
       (スクリーンセーバー中のダブルクリックは「終了」なので発動しない) */
    window.addEventListener('dblclick', e => {
      if (ssOn) return;
      if (e.target.closest('.panel, button, input, select, dialog, .tabs, .stat, a')) return;
      seed = Math.random() * 100;
      if (reduced) drawFrame(performance.now());
    });
    return true;
  }

  /* ---------- スクリーンセーバー演出(テーマ別アクター) ----------
     深宇宙: 人工衛星・彗星・流れ星 / 星雲: 流れ星 / 水面: 魚群・クジラ
     風景: 鹿・くまの影絵 / 金泥山水: 金の鳥の群れ */
  let ssOn = false;
  let actors = [];
  let nextSpawn = 0;
  const spriteCache = {};

  /* 絵文字の形を切り出すアルファマスク */
  function emojiMask(emoji, size) {
    const c = document.createElement('canvas');
    c.width = c.height = Math.ceil(size * 1.4);
    const g = c.getContext('2d');
    g.font = size + 'px "Apple Color Emoji", "Segoe UI Emoji", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(emoji, c.width / 2, c.height / 2);
    return c;
  }
  function tinted(mask, paint) {
    const c = document.createElement('canvas');
    c.width = mask.width; c.height = mask.height;
    const g = c.getContext('2d');
    g.drawImage(mask, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = paint(g, c);
    g.fillRect(0, 0, c.width, c.height);
    return c;
  }
  /* 立体シルエット: 上下グラデーションの陰影 + 左上からのリムライトで
     3Dモデルのような量感を出す */
  function emoji3D(emoji, size, cTop, cBottom, rim) {
    const key = ['3d', emoji, size, cTop, cBottom, rim].join('|');
    if (spriteCache[key]) return spriteCache[key];
    const mask = emojiMask(emoji, size);
    const body = tinted(mask, (g, c) => {
      const grad = g.createLinearGradient(0, c.height * 0.08, 0, c.height * 0.95);
      grad.addColorStop(0, cTop);
      grad.addColorStop(1, cBottom);
      return grad;
    });
    const rimC = tinted(mask, () => rim);
    const out = document.createElement('canvas');
    out.width = mask.width; out.height = mask.height;
    const o = out.getContext('2d');
    o.drawImage(rimC, -1.6, -1.6);   // 左上に光の縁
    o.drawImage(body, 1.0, 1.0);
    spriteCache[key] = out;
    return out;
  }
  /* 接地影 */
  function groundShadow(g, x, y, w) {
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.beginPath();
    g.ellipse(x, y, w, w * 0.18, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  function drawSprite(g, sp, x, y, flip, alpha, rot) {
    g.save();
    g.globalAlpha = alpha;
    g.translate(x, y);
    if (rot) g.rotate(rot);
    if (flip) g.scale(-1, 1);
    g.drawImage(sp, -sp.width / 2, -sp.height / 2);
    g.restore();
  }
  const rnd = (a, b) => a + Math.random() * (b - a);

  const ACTOR_FACTORY = {
    /* 流れ星: 一瞬の光の筋 */
    meteor() {
      const x0 = rnd(0.25, 1.05) * SW, y0 = rnd(0.02, 0.35) * SH;
      const sp = rnd(14, 24), ang = rnd(2.55, 2.85);   // 左下へ
      const vx = Math.cos(ang) * sp, vy = -Math.sin(ang) * sp;
      let x = x0, y = y0, life = rnd(24, 40);
      return {
        update() { x += vx; y += vy; if (--life <= 0 || x < -100) this.dead = true; },
        draw(g) {
          const fade = Math.min(1, life / 12);
          const grad = g.createLinearGradient(x, y, x - vx * 9, y - vy * 9);
          grad.addColorStop(0, `rgba(255,255,255,${0.9 * fade})`);
          grad.addColorStop(1, 'rgba(255,255,255,0)');
          g.strokeStyle = grad; g.lineWidth = 2.2; g.lineCap = 'round';
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - vx * 9, y - vy * 9); g.stroke();
        },
      };
    },
    /* 彗星: 長い尾を引いてゆっくり横断 */
    comet() {
      const dir = Math.random() < 0.5 ? 1 : -1;
      let x = dir > 0 ? -140 : SW + 140;
      const y0 = rnd(0.08, 0.42) * SH;
      const vx = dir * rnd(1.4, 2.2), vy = rnd(0.15, 0.4);
      let y = y0;
      return {
        update() { x += vx; y += vy; if (x < -220 || x > SW + 220) this.dead = true; },
        draw(g, now) {
          const tail = 190;
          const grad = g.createLinearGradient(x, y, x - vx * tail, y - vy * tail);
          grad.addColorStop(0, 'rgba(190,240,235,.85)');
          grad.addColorStop(0.35, 'rgba(120,210,205,.30)');
          grad.addColorStop(1, 'rgba(120,210,205,0)');
          g.strokeStyle = grad; g.lineWidth = 4; g.lineCap = 'round';
          g.beginPath(); g.moveTo(x, y); g.lineTo(x - vx * tail, y - vy * tail); g.stroke();
          const glow = g.createRadialGradient(x, y, 0, x, y, 14);
          glow.addColorStop(0, 'rgba(240,255,252,.95)');
          glow.addColorStop(1, 'rgba(240,255,252,0)');
          g.fillStyle = glow;
          g.beginPath(); g.arc(x, y, 14, 0, Math.PI * 2); g.fill();
        },
      };
    },
    /* 人工衛星: 点滅灯をつけてゆっくり周回 */
    satellite() {
      const dir = Math.random() < 0.5 ? 1 : -1;
      let x = dir > 0 ? -60 : SW + 60;
      const y = rnd(0.06, 0.4) * SH;
      const vx = dir * rnd(0.5, 0.9);
      const sp = emoji3D('🛰️', 38, '#e6edf8', '#5b6678', 'rgba(255,255,255,0.95)');
      return {
        update() { x += vx; if (x < -90 || x > SW + 90) this.dead = true; },
        draw(g, now) {
          drawSprite(g, sp, x, y, dir > 0, 0.9, dir * 0.3);
          if (Math.floor(now / 500) % 2 === 0) {
            g.fillStyle = 'rgba(255,90,80,.95)';
            g.beginPath(); g.arc(x + dir * 14, y - 12, 2.4, 0, Math.PI * 2); g.fill();
          }
        },
      };
    },
    /* 魚群: 波打ちながら泳ぐ */
    fishschool() {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const n = 5 + (Math.random() * 4 | 0);
      const baseY = rnd(0.45, 0.85) * SH;
      const v = dir * rnd(1.1, 1.7);
      let x = dir > 0 ? -60 : SW + 60;
      const sp = emoji3D('🐟', 26, 'rgba(205,242,245,0.85)', 'rgba(26,84,96,0.85)', 'rgba(240,255,255,0.9)');
      const offs = Array.from({ length: n }, (_, i) => ({ dx: -dir * i * 30 - dir * rnd(0, 14), dy: rnd(-22, 22), ph: rnd(0, 6.28) }));
      return {
        update() { x += v; if (x < -SW * 0.1 - n * 40 - 100 || x > SW * 1.1 + n * 40 + 100) this.dead = true; },
        draw(g, now) {
          for (const o of offs) {
            drawSprite(g, sp, x + o.dx, baseY + o.dy + Math.sin(now / 400 + o.ph) * 8, dir > 0, 0.62);
          }
        },
      };
    },
    /* クジラ: 大きくゆったり */
    whale() {
      const dir = Math.random() < 0.5 ? 1 : -1;
      let x = dir > 0 ? -160 : SW + 160;
      const y = rnd(0.55, 0.8) * SH;
      const vx = dir * rnd(0.32, 0.5);
      const sp = emoji3D('🐋', 130, 'rgba(175,228,235,0.9)', 'rgba(15,52,68,0.9)', 'rgba(225,250,255,0.85)');
      return {
        update() { x += vx; if (x < -220 || x > SW + 220) this.dead = true; },
        draw(g, now) { drawSprite(g, sp, x, y + Math.sin(now / 1600) * 14, dir > 0, 0.45); },
      };
    },
    /* 鹿: 月明かりの尾根を歩く */
    deer() {
      const dir = Math.random() < 0.5 ? 1 : -1;
      let x = dir > 0 ? -70 : SW + 70;
      const y = SH * rnd(0.74, 0.80);
      const vx = dir * rnd(0.5, 0.7);
      const sp = emoji3D('🦌', 76, '#8194b8', '#141c2e', 'rgba(230,240,255,0.98)');
      return {
        update() { x += vx; if (x < -110 || x > SW + 110) this.dead = true; },
        draw(g, now) {
          const yy = y + Math.abs(Math.sin(now / 190)) * -4;
          const halo = g.createRadialGradient(x, yy, 0, x, yy, 110);
          halo.addColorStop(0, 'rgba(240,195,110,0.20)');
          halo.addColorStop(1, 'rgba(240,195,110,0)');
          g.fillStyle = halo;
          g.beginPath(); g.arc(x, yy, 110, 0, Math.PI * 2); g.fill();
          groundShadow(g, x, y + 38, 40);
          drawSprite(g, sp, x, yy, dir > 0, 1);
        },
      };
    },
    /* くま: 月明かりの尾根をのっそり歩く */
    bear() {
      const dir = Math.random() < 0.5 ? 1 : -1;
      let x = dir > 0 ? -70 : SW + 70;
      const y = SH * rnd(0.76, 0.82);
      const vx = dir * rnd(0.28, 0.42);
      const sp = emoji3D('🧸', 72, '#6d7494', '#12141f', 'rgba(226,236,255,0.95)');   // 全身シルエットが「くま」に見える
      return {
        update() { x += vx; if (x < -110 || x > SW + 110) this.dead = true; },
        draw(g, now) {
          const yy = y + Math.abs(Math.sin(now / 300)) * -3;
          const halo = g.createRadialGradient(x, yy, 0, x, yy, 105);
          halo.addColorStop(0, 'rgba(240,195,110,0.20)');
          halo.addColorStop(1, 'rgba(240,195,110,0)');
          g.fillStyle = halo;
          g.beginPath(); g.arc(x, yy, 105, 0, Math.PI * 2); g.fill();
          groundShadow(g, x, y + 34, 38);
          drawSprite(g, sp, x, yy, dir > 0, 1);
        },
      };
    },
    /* 金の鳥の群れ(金泥山水) */
    cranes() {
      const dir = Math.random() < 0.5 ? 1 : -1;
      let x = dir > 0 ? -80 : SW + 80;
      const baseY = rnd(0.12, 0.35) * SH;
      const vx = dir * rnd(1.0, 1.4);
      const sp = emoji3D('🕊️', 30, '#ffedb0', '#9a7016', '#fff7dd');
      const offs = [{ dx: 0, dy: 0 }, { dx: -dir * 34, dy: 18 }, { dx: -dir * 62, dy: 34 }];
      return {
        update() { x += vx; if (x < -180 || x > SW + 180) this.dead = true; },
        draw(g, now) {
          offs.forEach((o, i) => drawSprite(g, sp, x + o.dx, baseY + o.dy + Math.sin(now / 260 + i) * 5, dir > 0, 0.95));
        },
      };
    },
  };

  /* ---------- クリック演出(スクリーンセーバー中の遊び) ---------- */
  const FX_FACTORY = {
    /* 星が生まれる(深宇宙・星雲) */
    starbirth(x, y) {
      const born = performance.now();
      const sparks = Array.from({ length: 9 }, (_, i) => ({ a: i / 9 * Math.PI * 2 + Math.random() * 0.4, sp: rnd(60, 130) }));
      const hue = active === 'nebula' ? '210,150,255' : '150,240,230';
      return {
        update() {},
        draw(g, now) {
          const t = (now - born) / 1000;
          if (t > 9) { this.dead = true; return; }
          /* 誕生の衝撃波リング */
          if (t < 1.1) {
            g.strokeStyle = `rgba(${hue},${(1.1 - t) / 1.1 * 0.5})`;
            g.lineWidth = 1.6;
            g.beginPath(); g.arc(x, y, t * 150, 0, Math.PI * 2); g.stroke();
          }
          /* 放射スパーク */
          if (t < 0.9) {
            g.strokeStyle = `rgba(255,255,255,${(0.9 - t) * 0.7})`;
            g.lineWidth = 1.4;
            for (const s of sparks) {
              const d0 = t * s.sp, d1 = d0 + 10;
              g.beginPath();
              g.moveTo(x + Math.cos(s.a) * d0, y + Math.sin(s.a) * d0);
              g.lineTo(x + Math.cos(s.a) * d1, y + Math.sin(s.a) * d1);
              g.stroke();
            }
          }
          /* 新星本体: ふくらんで、しばらく瞬いて、消える */
          const grow = Math.min(1, t * 2.2);
          const fade = t > 7.5 ? Math.max(0, (9 - t) / 1.5) : 1;
          const tw = 0.72 + 0.28 * Math.sin(now / 95 + x);
          const R = 13 * grow;
          const gl = g.createRadialGradient(x, y, 0, x, y, R);
          gl.addColorStop(0, `rgba(255,255,255,${0.95 * fade * tw})`);
          gl.addColorStop(0.35, `rgba(${hue},${0.55 * fade * tw})`);
          gl.addColorStop(1, `rgba(${hue},0)`);
          g.fillStyle = gl;
          g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
          /* 十字の光条 */
          g.strokeStyle = `rgba(255,255,255,${0.5 * fade * tw})`;
          g.lineWidth = 1;
          g.beginPath();
          g.moveTo(x - R * 1.9, y); g.lineTo(x + R * 1.9, y);
          g.moveTo(x, y - R * 1.9); g.lineTo(x, y + R * 1.9);
          g.stroke();
        },
      };
    },
    /* 波紋と泡(水面) */
    ripple(x, y) {
      const born = performance.now();
      const bubbles = Array.from({ length: 6 }, () => ({ dx: rnd(-24, 24), sp: rnd(28, 60), r: rnd(1.5, 3.5), ph: rnd(0, 6) }));
      return {
        update() {},
        draw(g, now) {
          const t = (now - born) / 1000;
          if (t > 3) { this.dead = true; return; }
          for (let i = 0; i < 3; i++) {
            const tt = t - i * 0.28;
            if (tt < 0 || tt > 2.2) continue;
            const a = (2.2 - tt) / 2.2 * 0.45;
            g.strokeStyle = `rgba(170,230,235,${a})`;
            g.lineWidth = 1.6;
            g.beginPath();
            g.ellipse(x, y, tt * 130, tt * 44, 0, 0, Math.PI * 2);
            g.stroke();
          }
          for (const b of bubbles) {
            const byy = y - t * b.sp;
            const a = Math.max(0, 0.6 - t * 0.25);
            g.strokeStyle = `rgba(210,245,250,${a})`;
            g.lineWidth = 1;
            g.beginPath();
            g.arc(x + b.dx + Math.sin(t * 3 + b.ph) * 6, byy, b.r, 0, Math.PI * 2);
            g.stroke();
          }
        },
      };
    },
    /* 蛍が湧く(風景) */
    fireflyburst(x, y) {
      const born = performance.now();
      const flies = Array.from({ length: 10 }, (_, i) => ({ a: rnd(0, 6.28), sp: rnd(18, 55), tw: rnd(2, 5), ph: rnd(0, 6) }));
      return {
        update() {},
        draw(g, now) {
          const t = (now - born) / 1000;
          if (t > 4) { this.dead = true; return; }
          const fade = t > 3 ? (4 - t) : Math.min(1, t * 3);
          for (const f of flies) {
            const d = Math.sqrt(t) * f.sp;
            const fx = x + Math.cos(f.a) * d + Math.sin(now / 300 + f.ph) * 10;
            const fy = y + Math.sin(f.a) * d * 0.7 - t * 6 + Math.cos(now / 260 + f.ph) * 8;
            const a = fade * (0.5 + 0.5 * Math.sin(now / 1000 * f.tw + f.ph)) * 0.85;
            const gl = g.createRadialGradient(fx, fy, 0, fx, fy, 9);
            gl.addColorStop(0, `rgba(253,224,120,${a})`);
            gl.addColorStop(1, 'rgba(253,224,120,0)');
            g.fillStyle = gl;
            g.beginPath(); g.arc(fx, fy, 9, 0, Math.PI * 2); g.fill();
          }
        },
      };
    },
    /* 金の墨がにじむ(金泥山水) */
    inkblot(x, y) {
      const born = performance.now();
      const dust = Array.from({ length: 14 }, () => ({ dx: rnd(-70, 70), dy: rnd(-50, 50), ph: rnd(0, 6), s: rnd(0.8, 2) }));
      return {
        update() {},
        draw(g, now) {
          const t = (now - born) / 1000;
          if (t > 3.2) { this.dead = true; return; }
          const R = 26 + Math.sqrt(t) * 70;
          const a = Math.max(0, 0.34 * (1 - t / 3.2));
          const gl = g.createRadialGradient(x, y, 0, x, y, R);
          gl.addColorStop(0, `rgba(235,190,90,${a})`);
          gl.addColorStop(0.6, `rgba(200,150,60,${a * 0.5})`);
          gl.addColorStop(1, 'rgba(200,150,60,0)');
          g.fillStyle = gl;
          g.beginPath(); g.arc(x, y, R, 0, Math.PI * 2); g.fill();
          /* 舞う金砂子 */
          for (const d of dust) {
            const prog = Math.min(1, t / 2.5);
            const a2 = Math.max(0, 0.8 - t * 0.3) * (0.5 + 0.5 * Math.sin(now / 140 + d.ph));
            g.fillStyle = `rgba(250,220,140,${a2})`;
            g.fillRect(x + d.dx * prog, y + d.dy * prog - t * 8, d.s, d.s);
          }
        },
      };
    },
  };
  const CLICK_FX = { space: 'starbirth', nebula: 'starbirth', water: 'ripple', land: 'fireflyburst', shuimo: 'inkblot' };
  window.addEventListener('pointerdown', e => {
    if (!ssOn) return;
    const fx = FX_FACTORY[CLICK_FX[active] || 'starbirth'];
    actors.push(fx(e.clientX, e.clientY));
  });

  /* ---------- スクリーンセーバー中の光るカーソル ---------- */
  const CURSOR_COLOR = { space: '150,240,230', nebula: '210,160,255', water: '175,225,255', land: '251,205,110', shuimo: '240,205,120' };
  const trail = [];
  function drawCursor(g, now) {
    if (px < 0) return;
    const col = CURSOR_COLOR[active] || '150,240,230';
    trail.push({ x: px, y: py });
    if (trail.length > 14) trail.shift();
    for (let i = 0; i < trail.length - 1; i++) {
      const a = i / trail.length * 0.30;
      g.fillStyle = `rgba(${col},${a})`;
      g.beginPath(); g.arc(trail[i].x, trail[i].y, 1.5 + i * 0.22, 0, Math.PI * 2); g.fill();
    }
    const pulse = 0.75 + 0.25 * Math.sin(now / 320);
    const gl = g.createRadialGradient(px, py, 0, px, py, 16);
    gl.addColorStop(0, `rgba(255,255,255,${0.95 * pulse})`);
    gl.addColorStop(0.3, `rgba(${col},${0.6 * pulse})`);
    gl.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = gl;
    g.beginPath(); g.arc(px, py, 16, 0, Math.PI * 2); g.fill();
    g.strokeStyle = `rgba(${col},${0.5 * pulse})`;
    g.lineWidth = 1.2;
    g.beginPath(); g.arc(px, py, 7.5, 0, Math.PI * 2); g.stroke();
  }

  const EVENT_KINDS = {
    space:  ['satellite', 'comet', 'meteor', 'meteor'],
    nebula: ['meteor', 'meteor', 'meteor', 'comet'],
    water:  ['fishschool', 'fishschool', 'whale'],
    land:   ['deer', 'bear'],
    shuimo: ['cranes'],
  };
  function spawnActor() {
    const kinds = EVENT_KINDS[active] || [];
    if (!kinds.length) return;
    const kind = kinds[Math.random() * kinds.length | 0];
    actors.push(ACTOR_FACTORY[kind]());
  }
  window.addEventListener('ml:screensaver', e => {
    ssOn = !!(e.detail && e.detail.on);
    actors = [];
    nextSpawn = performance.now() + 900;   // 入って1秒弱で最初の演出
  });
  window.__spawnActor = kind => { if (ACTOR_FACTORY[kind]) actors.push(ACTOR_FACTORY[kind]()); };
  /* rAFが止まっていても演出を進めて1フレーム描く(検証用) */
  window.__bgAdvance = (steps = 60) => {
    if (!sporeCtx) return 0;
    const nowMs = performance.now() + steps * 16;
    sporeCtx.clearRect(0, 0, SW, SH);
    actors = actors.filter(a => !a.dead);
    for (const a of actors) {
      for (let i = 0; i < steps; i++) a.update(nowMs - (steps - i) * 16);
      a.draw(sporeCtx, nowMs);
    }
    if (ssOn) drawCursor(sporeCtx, nowMs);
    return actors.length;
  };

  /* ---------- 粒子レイヤー ---------- */
  let sporeCtx = null, sporeCanvas = null, dots = [], sporeConf = SPORE_CONF.space;
  let SW = 0, SH = 0;

  function spawn(anywhere) {
    const c = sporeConf;
    return {
      x: Math.random() * SW,
      y: anywhere
        ? (c.bottomOnly ? SH * (0.5 + Math.random() * 0.5) : Math.random() * SH)
        : SH + 20,
      r: 0.8 + Math.random() * 2.2,
      vy: c.vy[0] + Math.random() * (c.vy[1] - c.vy[0]),
      sway: 0.3 + Math.random() * 1.2,
      phase: Math.random() * Math.PI * 2,
      c: c.colors[Math.random() * c.colors.length | 0],
      a: c.alpha[0] + Math.random() * (c.alpha[1] - c.alpha[0]),
      tw: 0.5 + Math.random() * 2,
    };
  }
  function respawnAll() {
    const n = Math.min(46, Math.round(window.innerWidth / 34 * sporeConf.count));
    dots = Array.from({ length: n }, () => spawn(true));
  }
  function initSpores() {
    sporeCanvas = document.createElement('canvas');
    sporeCanvas.id = 'bgSpores';
    sporeCanvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;';
    document.body.prepend(sporeCanvas);
    sporeCtx = sporeCanvas.getContext('2d');
    const rs = () => { SW = sporeCanvas.width = window.innerWidth; SH = sporeCanvas.height = window.innerHeight; };
    rs();
    window.addEventListener('resize', rs);
    respawnAll();

    function frame(now) {
      if (!running) return;
      sporeCtx.clearRect(0, 0, SW, SH);
      const t = now / 1000;
      for (let i = 0; i < dots.length; i++) {
        const d = dots[i];
        d.y -= d.vy;
        /* マウスパララックス: 大きい(手前の)粒ほど大きく動く */
        const x = d.x + Math.sin(t * 0.4 + d.phase) * d.sway * sporeConf.sway / 30
                + mx * 55 * (d.r / 3);
        const yy = d.y + my * 30 * (d.r / 3);
        if (d.y < -30) dots[i] = spawn(false);
        const glow = d.a * (0.6 + 0.4 * Math.sin(t * d.tw + d.phase));
        const g = sporeCtx.createRadialGradient(x, yy, 0, x, yy, d.r * 7);
        g.addColorStop(0, `rgba(${d.c},${glow})`);
        g.addColorStop(0.35, `rgba(${d.c},${glow * 0.35})`);
        g.addColorStop(1, `rgba(${d.c},0)`);
        sporeCtx.fillStyle = g;
        sporeCtx.beginPath();
        sporeCtx.arc(x, yy, d.r * 7, 0, Math.PI * 2);
        sporeCtx.fill();
        sporeCtx.fillStyle = `rgba(255,255,255,${glow * 0.9})`;
        sporeCtx.beginPath();
        sporeCtx.arc(x, yy, d.r * 0.55, 0, Math.PI * 2);
        sporeCtx.fill();
      }
      /* スクリーンセーバー中のテーマ演出 + 光るカーソル */
      if (ssOn) {
        if (now > nextSpawn) {
          spawnActor();
          nextSpawn = now + 3500 + Math.random() * 7000;
        }
        actors = actors.filter(a => !a.dead);
        for (const a of actors) { a.update(now); a.draw(sporeCtx, now); }
        drawCursor(sporeCtx, now);
      }
      requestAnimationFrame(frame);
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) requestAnimationFrame(frame);
    });
    requestAnimationFrame(frame);
  }

  /* ---------- 公開API ---------- */
  window.setBgTheme = function (name) {
    if (!THEMES[name] || !gl) return;
    if (!compileTheme(name)) return;
    active = name;
    sporeConf = SPORE_CONF[name];
    if (sporeCtx) respawnAll();
    actors = [];   // テーマの演出(動物・天体)は持ち越さない
    nextSpawn = performance.now() + 1500;
    try { localStorage.setItem(LS_KEY, name); } catch (e) { /* 保存失敗は無視 */ }
    if (reduced) drawFrame(performance.now());
  };
  window.getBgTheme = () => active;
  /* シミュレーション側から資産カーブ(0..1×64点)を流し込む */
  window.setBgCurve = function (arr) {
    if (!arr || arr.length !== 64) return;
    curveArr = Float32Array.from(arr, v => Math.min(1, Math.max(0, v)));
    if (reduced && gl) drawFrame(performance.now());
  };

  try {
    if (!initGL()) return;
    let saved = 'space';
    try { saved = localStorage.getItem(LS_KEY) || 'space'; } catch (e) { /* 既定値 */ }
    if (!THEMES[saved]) saved = 'space';
    window.setBgTheme(saved);
    if (!reduced) {
      requestAnimationFrame(loop);
      initSpores();
    }
  } catch (e) {
    console.warn('dynamic bg disabled:', e);
  }
})();
