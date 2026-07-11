'use strict';
/* =============================================================
   マネーラボ 資産形成シミュレーター — UI・チャート
   ============================================================= */

/* --- メンバーシップ合言葉(SHA-256ハッシュ) ---
   変更方法: ブラウザのコンソールで  await hashPass('新しい合言葉')
   を実行し、出力された文字列をここに貼り替える。 */
const PASS_HASH = '14d89c81a7e1bc8431b415f090e9e681a8c31fa8586173b020675a09c0fa66a3';

/* --- チャート配色(ダークサーフェス #0b1322 でCVD・コントラスト検証済み) --- */
const C = {
  teal:   '#0ea5a0',
  amber:  '#d97706',
  indigo: '#6366f1',
  pink:   '#ec4899',
  danger: '#f87171',
  ink2:   '#9fb0cc',
  ink3:   '#66788f',
  grid:   'rgba(159, 176, 204, 0.09)',
};
const TEAL_RGB = '14, 165, 160';

/* =============== パラメータ定義 =============== */
const PARAM_DEFS = {
  age:            { label: '現在の年齢',                 def: 35 },
  takehome:       { label: 'あなたの手取り年収',         def: 500 },
  livingCost:     { label: '現在の生活費(住居費込み)',   def: 25 },
  currentRisk:    { label: 'リスク資産(投資中の額)',     def: 800 },
  currentCash:    { label: '現金・預金',                 def: 300 },
  monthlyInvest:  { label: '毎月の積立投資額',           def: 10 },
  nisaUsed:       { label: '新NISAで使用済みの枠',       def: 0 },
  fireCost:       { label: 'FIRE後の生活費',             def: 22 },
  sideIncome:     { label: 'サイドFIRE時の副収入',       def: 10 },
  targetFireAge:  { label: 'リタイア想定年齢',           def: 65 },
  goalAge:        { label: '目標リタイア年齢',           def: 55 },
  annualReturn:   { label: '想定利回り(年率)',           def: 4.5 },
  inflation:      { label: 'インフレ率',                 def: 1.5 },
  spouseTakehome: { label: '配偶者の手取り年収',         def: 0 },
  pensionStart:   { label: '年金の受給開始年齢',         def: 65 },
  pensionMonthly: { label: '世帯の年金額(見込み)',       def: 15 },
  retirementPay:  { label: '退職金(リタイア時)',         def: 500 },
  salaryGrowth:   { label: '昇給率(年率)',               def: 1.0 },
  volatility:     { label: 'リターンのブレ(標準偏差)',   def: 15 },
  h_purchaseAge:  { label: '購入する年齢',               def: 40 },
  h_price:        { label: '物件価格',                   def: 5000 },
  h_down:         { label: '頭金',                       def: 500 },
  h_loanRate:     { label: 'ローン金利',                 def: 1.5 },
  h_rentMonthly:  { label: '比較する家賃',               def: 12 },
};
/* UIに出さない固定前提 */
const FIXED = { endAge: 100, cashReturn: 0.2, sideIncomeEnd: 70 };

/* --- 処方箋の関連記事リンク ---
   note記事を公開したら、該当キーにURLを貼るだけでボタンが現れる。
   空文字のうちはリンクなしで診断文のみ表示される。 */
const ARTICLES = {
  plan_fail:      '',   // 資産が尽きるプランの立て直し方
  emergency_fund: '',   // 生活防衛資金の作り方
  cash_drag:      '',   // 眠る現金とインフレ
  inflation:      '',   // インフレ前提の考え方
  bull_return:    '',   // 利回り前提の置き方
  fire_path:      '',   // FIREまでの道筋設計
  fire_done:      '',   // FIRE後の出口戦略
  side_income:    '',   // 副収入とサイドFIRE
  pension:        '',   // 年金の見込み方
  edu_peak:       '',   // 教育費ピークの乗り切り方
  bench_top:      '',   // 資産上位層の習慣
  nisa:           '',   // 新NISA戦略
  monte_carlo:    '',   // 暴落確率との付き合い方
};
const H_FIXED = { loanYears: 35, maintRate: 1.0, depRate: 1.5 };

const state = {
  params: Object.fromEntries(Object.entries(PARAM_DEFS).map(([k, d]) => [k, d.def])),
  children: [],
  mode: 'nominal',
  unlocked: false,
  activeTab: 'main',
  mcDirty: true,
  goalDirty: true,
  goalSide: false,
  benchType: 'futari',
};

/* =============== ユーティリティ =============== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

function fmtMan(v) {
  if (v === null || v === undefined || !isFinite(v)) return '--';
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 10000) {
    const oku = a / 10000;
    return sign + (oku >= 10 ? Math.round(oku) : oku.toFixed(2).replace(/0$/, '')) + '億円';
  }
  return sign + Math.round(a).toLocaleString() + '万円';
}
function fmtAxis(v) {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 10000) return (v / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + '億';
  return Math.round(v).toLocaleString() + '万';
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._tm);
  toast._tm = setTimeout(() => t.classList.remove('show'), 2600);
}
async function hashPass(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
window.hashPass = hashPass;

/* =============== 入力フィールド生成 =============== */
function buildFields() {
  $$('.field[data-param]').forEach(el => {
    const key = el.dataset.param;
    const def = PARAM_DEFS[key];
    if (!def) return;
    const unit = el.dataset.unit || '';
    el.innerHTML = `
      <label><span>${def.label}</span><span class="val"></span></label>
      <input type="range" min="${el.dataset.min}" max="${el.dataset.max}" step="${el.dataset.step}">
    `;
    const range = $('input', el);
    const val = $('.val', el);
    const sync = () => {
      range.value = state.params[key];
      val.textContent = (+state.params[key]).toLocaleString() + unit;
      const pct = (range.value - range.min) / (range.max - range.min) * 100;
      range.style.setProperty('--fill', pct + '%');
    };
    range.addEventListener('input', () => {
      state.params[key] = +range.value;
      sync();
      scheduleRecalc();
    });
    el._sync = sync;
    sync();
  });
}
function syncAllFields() { $$('.field[data-param]').forEach(el => el._sync && el._sync()); }

/* =============== 子ども設定 UI =============== */
function renderChildren() {
  const list = $('#childrenList');
  list.innerHTML = '';
  state.children.forEach((c, i) => {
    const card = document.createElement('div');
    card.className = 'child-card';
    const nowAge = state.params.age - c.birthParentAge;
    const ageNote = nowAge >= 0 ? `現在${nowAge}歳` : `${-nowAge}年後に誕生予定`;
    card.innerHTML = `
      <div class="child-head"><span>👶 子ども${i + 1}(${ageNote})</span>
        <button type="button" class="rm" title="削除">✕</button></div>
      <div class="field"><label><span>親が何歳のときの子?(予定含む)</span></label>
        <input type="number" min="18" max="60" value="${c.birthParentAge}" data-k="birthParentAge"></div>
      <div class="field"><label><span>小・中・高の進路</span></label>
        <select data-k="plan">${Object.entries(EDU_PLANS).map(([k, v]) =>
          `<option value="${k}" ${c.plan === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
      <div class="field"><label><span>大学・専門課程</span></label>
        <select data-k="univ">${Object.entries(UNIV_TYPES).map(([k, v]) =>
          `<option value="${k}" ${c.univ === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
      ${c.univ === 'private_med' ? `
      <div class="field"><label><span>私立医学部の学費(6年総額)</span></label>
        <select data-k="medTotal">${MED_TOTALS.map(v =>
          `<option value="${v}" ${(c.medTotal || MED_TOTAL_DEFAULT) === v ? 'selected' : ''}>${v.toLocaleString()}万円(年${Math.round(v / 6)}万円)</option>`).join('')}</select></div>` : ''}
    `;
    $('.rm', card).addEventListener('click', () => {
      state.children.splice(i, 1);
      renderChildren(); scheduleRecalc();
    });
    $$('[data-k]', card).forEach(inp => {
      inp.addEventListener('change', () => {
        const k = inp.dataset.k;
        c[k] = (inp.type === 'number' || k === 'medTotal') ? +inp.value : inp.value;
        renderChildren(); scheduleRecalc();
      });
    });
    list.appendChild(card);
  });
}

/* =============== Chart.js 共通設定 =============== */
let chartsReady = typeof Chart !== 'undefined';
if (chartsReady) {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 11;
  Chart.defaults.color = C.ink3;
  Chart.defaults.animation.duration = 350;
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.backgroundColor = 'rgba(11, 19, 34, .95)';
  Chart.defaults.plugins.tooltip.borderColor = 'rgba(94, 234, 212, .35)';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.titleColor = '#eef4ff';
  Chart.defaults.plugins.tooltip.bodyColor = '#9fb0cc';
  Chart.defaults.plugins.tooltip.padding = 12;
  Chart.defaults.plugins.tooltip.cornerRadius = 10;
  Chart.defaults.plugins.tooltip.displayColors = true;
  Chart.defaults.plugins.tooltip.boxPadding = 4;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.point.hoverRadius = 5;
  Chart.defaults.elements.point.hitRadius = 14;
  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.interaction = { mode: 'index', intersect: false };
}

/* 縦マーカー(リタイア・年金開始・資産枯渇)描画プラグイン */
const vlinesPlugin = {
  id: 'vlines',
  afterDatasetsDraw(chart) {
    const items = chart.$vlines || [];
    const { ctx, chartArea, scales } = chart;
    if (!chartArea) return;
    for (const it of items) {
      const idx = chart.data.labels.indexOf(it.age);
      if (idx < 0) continue;
      const x = scales.x.getPixelForValue(idx);
      ctx.save();
      ctx.strokeStyle = it.color;
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, chartArea.top + 14);
      ctx.lineTo(x, chartArea.bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = it.color;
      ctx.font = '700 10px ' + Chart.defaults.font.family;
      ctx.textAlign = idx > chart.data.labels.length * 0.75 ? 'right' : 'left';
      ctx.fillText(it.label, x + (ctx.textAlign === 'left' ? 5 : -5), chartArea.top + 9);
      ctx.restore();
    }
  },
};
if (chartsReady) Chart.register(vlinesPlugin);

function makeScales(stacked = false) {
  return {
    x: {
      stacked,
      grid: { color: C.grid, drawTicks: false },
      border: { display: false },
      ticks: { callback(v) { const l = this.getLabelForValue(v); return l % 5 === 0 ? l + '歳' : ''; }, maxRotation: 0, autoSkip: false },
    },
    y: {
      stacked,
      grid: { color: C.grid, drawTicks: false },
      border: { display: false },
      ticks: { maxTicksLimit: 7, callback: v => fmtAxis(v) },
    },
  };
}
function tealGradient(ctx, area, alphaTop = 0.35) {
  const g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
  g.addColorStop(0, `rgba(${TEAL_RGB}, ${alphaTop})`);
  g.addColorStop(1, `rgba(${TEAL_RGB}, 0)`);
  return g;
}
const tooltipMan = { callbacks: { label: c => ` ${c.dataset.label}: ${fmtMan(c.parsed.y)}`, title: t => t[0].label + '歳' } };
const legendOn = {
  display: true, position: 'bottom', align: 'start',
  labels: { usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 9, boxHeight: 9, padding: 16, color: C.ink2 },
};

const CH = {};
function makeLineChart(canvasId, extra = {}) {
  return new Chart($(canvasId), {
    type: 'line',
    data: { labels: [], datasets: [] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: makeScales(),
      plugins: { tooltip: tooltipMan, legend: legendOn },
      ...extra,
    },
  });
}

/* =============== 再計算 =============== */
let recalcTimer = null;
function scheduleRecalc() {
  saveLocal();
  clearTimeout(recalcTimer);
  recalcTimer = setTimeout(recalc, 120);
}

function currentP() {
  const p = { ...state.params, ...FIXED, children: state.children };
  p.targetFireAge = Math.max(p.targetFireAge, p.age);
  return p;
}

function recalc() {
  const p = currentP();
  const fire = findFireAge(p, false);
  const sideFire = findFireAge(p, true);
  const mainSim = simulate(p, { retireAge: p.targetFireAge });
  state.last = { fire, sideFire, mainSim };
  state.mcDirty = true;

  /* 金泥山水テーマの「手前の山」に資産カーブを流し込む */
  if (window.setBgCurve) {
    const rows = mainSim.rows;
    const maxV = Math.max(1, ...rows.map(r0 => r0.total));
    const curve = Array.from({ length: 64 }, (_, i) => {
      const idx = Math.round(i * (rows.length - 1) / 63);
      return Math.sqrt(Math.max(0, rows[idx].total) / maxV);  // √で圧縮して山らしく
    });
    setBgCurve(curve);
  }

  /* --- スタットタイル --- */
  setStat('#statFire', fire ? fire.age : null, fire ? '歳' : '', fire ? (fire.age <= p.targetFireAge ? 'good' : 'warn') : 'bad', fire ? null : '80歳まで困難');
  setStat('#statSideFire', sideFire ? sideFire.age : null, sideFire ? '歳' : '', sideFire ? 'good' : 'bad', sideFire ? null : '80歳まで困難');
  const needEl = $('#statNeed .v');
  needEl.innerHTML = fire ? fmtMan(fire.assetsAtFire) : '--';
  $('#statNeed').className = 'stat';
  const lifeStat = $('#statLife');
  if (mainSim.depleted !== null) {
    $('.v', lifeStat).innerHTML = `${mainSim.depleted}<span class="unit">歳で枯渇</span>`;
    lifeStat.className = 'stat bad';
  } else {
    $('.v', lifeStat).innerHTML = `100<span class="unit">歳+</span>`;
    lifeStat.className = 'stat good';
  }

  updateLevers(p, fire);
  updateCheckpoint(p, fire);

  state.goalDirty = true;
  if (chartsReady) {
    updateMainChart(p, mainSim);
    updateEduChart(p, mainSim);
    updateRetireChart(p, mainSim);
    updateHouseChart(p);
    updateBenchTab(p);
    updateNisa(p);
    updateRxTab(p);
    if (state.activeTab === 'goal') updateGoalTab(p);
    if (state.unlocked && state.activeTab === 'mc') runMC(p);
  }
}

function setStat(sel, val, unit, cls, fallback) {
  const el = $(sel);
  $('.v', el).innerHTML = val !== null ? `${val}<span class="unit">${unit}</span>` : (fallback || '--');
  el.className = 'stat ' + (cls || '');
}

/* =============== あと1万円レバー =============== */
function fireAgeWith(p, patch) {
  const f = findFireAge({ ...p, ...patch }, false);
  return f ? f.age : null;
}

function leverEffect(base, a2) {
  if (base === null && a2 === null) return { t: '80歳まで困難のまま', cls: 'mut' };
  if (base === null) return { t: `${a2}歳でFIRE可能に!`, cls: 'good' };
  if (a2 === null) return { t: '--', cls: 'mut' };
  const d = base - a2;
  if (d <= 0) return { t: '変化なし(1年未満の短縮)', cls: 'mut' };
  return { t: `${base}歳 → ${a2}歳(${d}年 早まる)`, cls: 'good' };
}

function updateLevers(p, fire) {
  const base = fire ? fire.age : null;
  const levers = [
    { icon: '💰', label: '積立をあと1万円/月 増やす', patch: { monthlyInvest: p.monthlyInvest + 1 } },
    { icon: '✂️', label: '生活費を月1万円 減らす(現役・FIRE後とも)', patch: { livingCost: Math.max(0, p.livingCost - 1), fireCost: Math.max(0, p.fireCost - 1) } },
    { icon: '📈', label: '利回りが年+1% 高いなら', patch: { annualReturn: p.annualReturn + 1 } },
  ];
  $('#leverRows').innerHTML = levers.map(l => {
    const r = leverEffect(base, fireAgeWith(p, l.patch));
    return `<div class="lever-row"><span class="lv-label">${l.icon} ${l.label}</span><span class="lv-effect ${r.cls}">${r.t}</span></div>`;
  }).join('');

  /* FIREを1年早める最小の追加積立(0.5万円刻み・上限30万円/月) */
  const goal = $('#leverGoal');
  if (base !== null && base > p.age) {
    const enough = add => {
      const a = fireAgeWith(p, { monthlyInvest: p.monthlyInvest + add });
      return a !== null && a <= base - 1;
    };
    if (enough(30)) {
      let lo = 0, hi = 30;
      while (hi - lo > 0.5) {
        const mid = (lo + hi) / 2;
        if (enough(mid)) hi = mid; else lo = mid;
      }
      const need = Math.ceil(hi * 2) / 2;
      goal.hidden = false;
      goal.innerHTML = `🎯 FIREを1年早める最短ルート: 積立をあと <b>${need}万円/月</b>(合計 ${p.monthlyInvest + need}万円/月)`;
    } else {
      goal.hidden = true;
    }
  } else {
    goal.hidden = true;
  }
}

/* =============== 定点観測 =============== */
function loadCheckpoint() {
  try { return JSON.parse(localStorage.getItem('ml_checkpoint')); } catch (e) { return null; }
}

function saveCheckpoint() {
  if (!state.last) return;
  const p = currentP();
  const cp = {
    d: Date.now(),
    fire: state.last.fire ? state.last.fire.age : null,
    side: state.last.sideFire ? state.last.sideFire.age : null,
    assets: p.currentRisk + p.currentCash,
  };
  try { localStorage.setItem('ml_checkpoint', JSON.stringify(cp)); } catch (e) { /* プライベートモード等 */ }
  updateCheckpoint(p, state.last.fire);
  toast('📍 記録しました。次に来たとき、今日からの変化がここに出ます');
}

function updateCheckpoint(p, fire) {
  const el = $('#cpText');
  const cp = loadCheckpoint();
  if (!cp) {
    el.innerHTML = `<span class="cp-title">📍 定点観測</span>今の結果を記録しておくと、次に来たとき「前回からどれだけ前進したか」がここに表示されます。`;
    return;
  }
  const dateStr = new Date(cp.d).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const nowFire = fire ? fire.age : null;
  const nowAssets = p.currentRisk + p.currentCash;

  let fireTxt;
  if (cp.fire === null && nowFire === null) {
    fireTxt = 'FIRE可能年齢: 変わらず';
  } else if (cp.fire === null) {
    fireTxt = `FIRE <b class="up">${nowFire}歳で可能に!</b>`;
  } else if (nowFire === null) {
    fireTxt = `FIRE ${cp.fire}歳 → <b class="down">80歳まで困難に</b>`;
  } else {
    const d = cp.fire - nowFire;
    fireTxt = d > 0 ? `FIRE ${cp.fire}歳 → ${nowFire}歳 <b class="up">(${d}年 前進🎉)</b>`
      : d < 0 ? `FIRE ${cp.fire}歳 → ${nowFire}歳 <b class="down">(${-d}年 後退)</b>`
      : `FIRE ${nowFire}歳(変わらず)`;
  }
  const dA = Math.round(nowAssets - cp.assets);
  const assetTxt = dA > 0 ? `資産 <b class="up">+${fmtMan(dA)}</b>`
    : dA < 0 ? `資産 <b class="down">-${fmtMan(-dA)}</b>` : '資産 ±0';
  el.innerHTML = `<span class="cp-title">📍 定点観測</span>前回の記録(${dateStr})との比較: ${fireTxt} ・ ${assetTxt}`;
}

/* =============== メインチャート =============== */
function updateMainChart(p, sim) {
  if (!CH.main) {
    CH.main = makeLineChart('#chartMain');
    CH.main.options.plugins.tooltip = { ...CH.main.options.plugins.tooltip, ...tooltipMan };
  }
  const real = state.mode === 'real';
  const labels = sim.rows.map(r => r.age);
  const total = sim.rows.map((r, t) => real ? r.real : r.total);
  const risk = sim.rows.map((r, t) => real ? r.risk / Math.pow(1 + p.inflation / 100, t) : r.risk);

  CH.main.data.labels = labels;
  CH.main.data.datasets = [
    {
      label: real ? '金融資産合計(実質)' : '金融資産合計',
      data: total, borderColor: C.teal, tension: 0.25,
      fill: true, backgroundColor: ctx => ctx.chart.chartArea ? tealGradient(ctx.chart.ctx, ctx.chart.chartArea) : 'transparent',
    },
    {
      label: 'うちリスク資産',
      data: risk, borderColor: C.indigo, borderDash: [6, 4], tension: 0.25, fill: false,
    },
  ];
  const vl = [{ age: sim.retireAge, color: C.amber, label: 'リタイア' }];
  if (p.pensionStart <= p.endAge) vl.push({ age: p.pensionStart, color: C.indigo, label: '年金開始' });
  if (sim.depleted !== null) vl.push({ age: sim.depleted, color: C.danger, label: '枯渇' });
  CH.main.$vlines = vl;
  CH.main.update();
}

/* =============== モンテカルロ =============== */
function runMC(p) {
  const mc = monteCarlo(p, p.targetFireAge, false, 1000);
  state.mcDirty = false;
  const pctEl = $('#mcPct');
  const pct = Math.round(mc.successRate * 100);
  pctEl.textContent = pct + '%';
  $('#mcGauge').style.width = pct + '%';
  $('#mcCap').textContent = `${p.targetFireAge}歳でリタイアして100歳まで資産がもつ確率(利回り${p.annualReturn}%±${p.volatility}%で1,000回試行)`;

  if (!CH.mc) {
    CH.mc = makeLineChart('#chartMC');
    CH.mc.options.plugins.legend = { display: false };  // 凡例はHTML側に用意済み
    CH.mc.options.plugins.tooltip.callbacks = {
      title: t => t[0].label + '歳',
      label: c => ` ${c.dataset.label}: ${fmtMan(c.parsed.y)}`,
    };
  }
  const t = (a) => a.map(v => Math.max(0, v));
  CH.mc.data.labels = mc.ages;
  CH.mc.data.datasets = [
    { label: '悲観(下位5%)', data: t(mc.bands.p5), borderColor: 'transparent', pointRadius: 0 },
    { label: '楽観(上位5%)', data: t(mc.bands.p95), borderColor: 'transparent', fill: '-1', backgroundColor: `rgba(${TEAL_RGB},.14)` },
    { label: '下位25%', data: t(mc.bands.p25), borderColor: 'transparent' },
    { label: '上位25%', data: t(mc.bands.p75), borderColor: 'transparent', fill: '-1', backgroundColor: `rgba(${TEAL_RGB},.32)` },
    { label: '中央値', data: t(mc.bands.p50), borderColor: C.teal, borderWidth: 2.5, tension: 0.25 },
  ];
  CH.mc.$vlines = [{ age: p.targetFireAge, color: C.amber, label: 'リタイア' }];
  CH.mc.update();
}

/* =============== 逆算タブ =============== */
function updateGoalTab(p) {
  state.goalDirty = false;
  const goalAge = Math.max(p.goalAge, p.age);
  const side = state.goalSide;
  const req = requiredMonthlyInvest(p, goalAge, side);

  $('#goalCap').textContent = `${goalAge}歳で${side ? 'サイドFIRE(副収入' + p.sideIncome + '万円/月)' : '完全FIRE'}するために必要な毎月の積立額`;
  const ans = $('#goalAnswer');
  const delta = $('#goalDelta');
  if (req === null) {
    ans.textContent = '達成困難';
    delta.textContent = '今の収入と支出の前提では積立を最大化しても届きません。目標年齢・生活費・収入のどれかを見直してみてください。';
  } else if (req === 0) {
    ans.textContent = '0円';
    delta.textContent = '追加の積立なしで達成可能です。今の資産と収支だけで足ります。';
  } else {
    ans.textContent = (req >= 10 ? Math.ceil(req * 10) / 10 : Math.ceil(req * 10) / 10).toFixed(1) + '万円/月';
    const diff = req - p.monthlyInvest;
    delta.textContent = diff > 0.05
      ? `今の積立(${p.monthlyInvest}万円/月)より あと ${diff.toFixed(1)}万円/月 必要です`
      : `今の積立(${p.monthlyInvest}万円/月)で足りています(余裕 ${(-diff).toFixed(1)}万円/月)`;
  }

  /* リタイア年齢×必要積立額の曲線 */
  if (!CH.goal) {
    CH.goal = makeLineChart('#chartGoal');
    CH.goal.options.scales.y.ticks.callback = v => v + '万';
    CH.goal.options.plugins.tooltip.callbacks = {
      title: t => t[0].label + '歳でリタイア',
      label: c => c.parsed.y === null ? ' 達成困難' : ` 必要積立: ${c.parsed.y.toFixed(1)}万円/月`,
    };
  }
  const from = Math.max(p.age, 38);
  const labels = [], data = [];
  for (let a = from; a <= 70; a++) {
    labels.push(a);
    const v = requiredMonthlyInvest(p, a, side);
    data.push(v === null ? null : Math.round(v * 10) / 10);
  }
  CH.goal.data.labels = labels;
  CH.goal.data.datasets = [{
    label: '必要な毎月積立額', data,
    borderColor: C.amber, tension: 0.3, fill: true, spanGaps: false,
    backgroundColor: ctx => {
      if (!ctx.chart.chartArea) return 'transparent';
      const g = ctx.chart.ctx.createLinearGradient(0, ctx.chart.chartArea.top, 0, ctx.chart.chartArea.bottom);
      g.addColorStop(0, 'rgba(217,119,6,.30)');
      g.addColorStop(1, 'rgba(217,119,6,0)');
      return g;
    },
  }];
  CH.goal.$vlines = [{ age: goalAge, color: C.teal, label: '目標' }];
  CH.goal.update();
}

/* =============== 同年代比較タブ =============== */
const BENCH_BUCKET_LABELS = ['0', '〜100万', '〜200万', '〜300万', '〜400万', '〜500万', '〜700万', '〜1000万', '〜1500万', '〜2000万', '〜3000万', '3000万〜'];
function userBucketIndex(assets) {
  if (assets <= 0) return 0;
  for (let i = 1; i < BENCH_EDGES.length; i++) {
    if (assets < BENCH_EDGES[i]) return i;
  }
  return 11;
}
function updateBenchTab(p) {
  const assets = p.currentRisk + p.currentCash;
  const r = benchPercentile(assets, p.age, state.benchType);

  /* 無料エリア: あなた vs 平均 vs 中央値 */
  const max = Math.max(assets, r.mean, r.median, 1);
  const bar = (cls, label, v) => {
    const w = Math.max(2, v / max * 100);
    const tiny = w < 30 ? ' tiny' : '';
    return `<div class="bb ${cls}"><div class="lb">${label}</div>
      <div class="track"><div class="fillbar${tiny}" style="width:${w}%">${fmtMan(v)}</div></div></div>`;
  };
  $('#benchBars').innerHTML =
    bar('you', '<strong>あなた</strong>', assets) +
    bar('avg', `${r.bracket}代の平均`, r.mean) +
    bar('med', `${r.bracket}代の中央値`, r.median) +
    `<div class="bench-src">出典: 金融経済教育推進機構「家計の金融行動に関する世論調査」2024年(${r.label}・金融資産を保有していない世帯を含む)。平均は一部の富裕世帯に引っ張られるため、実感に近いのは中央値です。</div>`;

  /* 限定エリア: 上位% + 分布 */
  $('#benchCap').textContent = `あなた(${r.bracket}代・${r.label})は同年代の`;
  const top = r.topPct;
  $('#benchAnswer').textContent = top <= 50
    ? `上位 ${top < 10 ? top.toFixed(1) : Math.round(top)}%`
    : `上位 ${Math.round(top)}%`;

  if (!chartsReady) return;
  if (!CH.bench) {
    CH.bench = new Chart($('#chartBench'), {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false }, border: { display: false },
               ticks: { maxRotation: 60, minRotation: 45, autoSkip: false, font: { size: 10 } } },
          y: { grid: { color: C.grid, drawTicks: false }, border: { display: false },
               ticks: { maxTicksLimit: 6, callback: v => v + '%' } },
        },
        plugins: { tooltip: { callbacks: {
          title: t => '金融資産 ' + t[0].label + '円',
          label: c => ` 同年代の ${c.parsed.y.toFixed(1)}% がこの階級`,
        } } },
      },
    });
  }
  const idx = userBucketIndex(assets);
  CH.bench.data.labels = BENCH_BUCKET_LABELS;
  CH.bench.data.datasets = [{
    label: '同年代の分布',
    data: r.dist.map(v => +(v * 100).toFixed(1)),
    backgroundColor: r.dist.map((_, i) => i === idx ? C.teal : 'rgba(159,176,204,.28)'),
    borderRadius: 4, borderSkipped: 'bottom',
  }];
  CH.bench.update();
}

/* =============== 教育費チャート =============== */
function updateEduChart(p, sim) {
  const stats = $('#eduStats');
  if (!CH.edu) {
    CH.edu = new Chart($('#chartEdu'), {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: makeScales(true),
        plugins: { legend: legendOn, tooltip: { callbacks: {
          title: t => `親 ${t[0].label}歳`,
          label: c => ` ${c.dataset.label}: ${fmtMan(c.parsed.y)}/年`,
        } } },
      },
    });
  }
  if (!state.children.length) {
    stats.innerHTML = `<div class="ss"><div class="k">左パネル「家族と教育」で</div><div class="v indigo">子どもを追加すると表示されます</div></div>`;
    CH.edu.data.labels = []; CH.edu.data.datasets = []; CH.edu.update();
    return;
  }
  const lastEdu = Math.max(...state.children.map(c => c.birthParentAge + 22));
  const from = p.age;
  const to = Math.min(Math.max(lastEdu, p.age + 5), p.endAge);
  const labels = [], perChild = state.children.map(() => []);
  let peakAge = from, peakVal = 0, totalAll = 0;
  for (let a = from; a <= to; a++) {
    labels.push(a);
    const br = eduBreakdownAt(p, a);
    let sum = 0;
    br.forEach((v, i) => { perChild[i].push(v); sum += v; });
    totalAll += sum;
    if (sum > peakVal) { peakVal = sum; peakAge = a; }
  }
  /* 今後発生する総額(まだ来ていない年だけでなく現在以降の合計) */
  const colors = [C.teal, C.amber, C.indigo, C.pink];
  CH.edu.data.labels = labels;
  CH.edu.data.datasets = perChild.map((d, i) => ({
    label: `子ども${i + 1}`, data: d,
    backgroundColor: colors[i % 4], borderRadius: 4,
    borderSkipped: 'bottom', barPercentage: 0.85, categoryPercentage: 0.9,
  }));
  CH.edu.update();

  stats.innerHTML = `
    <div class="ss"><div class="k">今後かかる教育費の総額(現在価値)</div><div class="v amber">${fmtMan(totalAll)}</div></div>
    <div class="ss"><div class="k">負担ピーク</div><div class="v pink">親${peakAge}歳・年${fmtMan(peakVal)}</div></div>
    <div class="ss"><div class="k">ピーク時の月あたり負担</div><div class="v indigo">${fmtMan(peakVal / 12)}/月</div></div>`;
}

/* =============== 老後チャート =============== */
function updateRetireChart(p, sim) {
  if (!CH.retire) CH.retire = makeLineChart('#chartRetire');
  const start = Math.max(p.targetFireAge, 60);
  const rows = sim.rows.filter(r => r.age >= Math.min(start, 60));
  CH.retire.data.labels = rows.map(r => r.age);
  CH.retire.data.datasets = [
    {
      label: '資産残高(名目)', data: rows.map(r => r.total),
      borderColor: C.teal, tension: 0.25, fill: true,
      backgroundColor: ctx => ctx.chart.chartArea ? tealGradient(ctx.chart.ctx, ctx.chart.chartArea, 0.28) : 'transparent',
    },
    {
      label: '資産残高(実質・今の価値)', data: rows.map(r => r.real),
      borderColor: C.indigo, borderDash: [6, 4], tension: 0.25,
    },
  ];
  const vl = [{ age: p.pensionStart, color: C.indigo, label: '年金開始' }];
  if (sim.depleted !== null) vl.push({ age: sim.depleted, color: C.danger, label: '枯渇' });
  CH.retire.$vlines = vl;
  CH.retire.update();

  const firstRetire = sim.rows.find(r => r.age === sim.retireAge);
  const at65 = sim.rows.find(r => r.age === 65);
  const wd = firstRetire ? firstRetire.withdrawal / 12 : 0;
  $('#retireStats').innerHTML = `
    <div class="ss"><div class="k">65歳時点の資産</div><div class="v teal">${at65 ? fmtMan(at65.total) : '--'}</div></div>
    <div class="ss"><div class="k">リタイア初年度の取り崩し</div><div class="v amber">${fmtMan(wd)}/月</div></div>
    <div class="ss"><div class="k">年金(設定値)</div><div class="v indigo">${p.pensionMonthly}万円/月 ・ ${p.pensionStart}歳から</div></div>
    <div class="ss"><div class="k">資産寿命</div><div class="v ${sim.depleted ? 'danger' : 'teal'}">${sim.depleted ? sim.depleted + '歳で枯渇' : '100歳まで維持'}</div></div>`;
}

/* =============== 住宅チャート =============== */
function updateHouseChart(p) {
  if (!CH.house) CH.house = makeLineChart('#chartHouse');
  const h = {
    purchaseAge: Math.max(state.params.h_purchaseAge, p.age),
    price: state.params.h_price,
    down: Math.min(state.params.h_down, state.params.h_price),
    loanRate: state.params.h_loanRate,
    rentMonthly: state.params.h_rentMonthly,
    ...H_FIXED,
  };
  const r = housingCompare(p, h);
  CH.house.data.labels = r.ages;
  CH.house.data.datasets = [
    { label: '購入した場合の純資産', data: r.buy, borderColor: C.amber, tension: 0.25 },
    { label: '賃貸を続けた場合の純資産', data: r.rent, borderColor: C.teal, tension: 0.25 },
  ];
  CH.house.$vlines = [
    { age: h.purchaseAge, color: C.amber, label: '購入' },
    { age: h.purchaseAge + h.loanYears, color: C.ink3, label: '完済' },
  ];
  CH.house.update();

  const i65 = r.ages.indexOf(65);
  const diff = i65 >= 0 ? r.buy[i65] - r.rent[i65] : 0;
  $('#houseStats').innerHTML = `
    <div class="ss"><div class="k">月々のローン返済</div><div class="v amber">${fmtMan(r.payMonthly)}/月(${h.loanYears}年)</div></div>
    <div class="ss"><div class="k">65歳時点の純資産差(購入 − 賃貸)</div>
      <div class="v ${diff >= 0 ? 'teal' : 'pink'}">${diff >= 0 ? '+' : ''}${fmtMan(diff)}</div></div>
    <div class="ss"><div class="k">判定</div><div class="v ${diff >= 0 ? 'amber' : 'teal'}">${diff >= 0 ? 'この条件では購入が有利' : 'この条件では賃貸が有利'}</div></div>`;
}

/* =============== タブ =============== */
function activateTab(name) {
  state.activeTab = name;
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $$('.tab-pane').forEach(pn => pn.classList.toggle('active', pn.id === 'pane-' + name));
  if (chartsReady) {
    if (name === 'mc' && state.unlocked && state.mcDirty) runMC(currentP());
    if (name === 'goal' && state.goalDirty) updateGoalTab(currentP());
  }
  /* パネルが表示された直後にチャートをリサイズ・再レイアウト */
  requestAnimationFrame(() => Object.values(CH).forEach(c => { c.resize(); c.update('none'); }));
}

function initTabs() {
  $$('.tabs button').forEach(btn => {
    btn.addEventListener('click', () => activateTab(btn.dataset.tab));
  });
  $$('.hero-chips button').forEach(btn => {
    btn.addEventListener('click', () => {
      activateTab(btn.dataset.goto);
      $('.tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
  $$('#mainToggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.mode = btn.dataset.mode;
      $$('#mainToggle button').forEach(b => b.classList.toggle('on', b === btn));
      recalc();
    });
  });
  $$('#goalMode button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.goalSide = btn.dataset.side === '1';
      $$('#goalMode button').forEach(b => b.classList.toggle('on', b === btn));
      updateGoalTab(currentP());
    });
  });
  $$('#benchType button').forEach(btn => {
    btn.addEventListener('click', () => {
      state.benchType = btn.dataset.type;
      $$('#benchType button').forEach(b => b.classList.toggle('on', b === btn));
      updateBenchTab(currentP());
    });
  });
}

/* =============== 新NISA消化率メーター =============== */
const NISA_CAP = 1800;        // 生涯投資枠(万円)
const NISA_MONTHLY_MAX = 30;  // 年間360万円 → 月30万円まで
const CGT = 0.20315;          // 譲渡益課税

function updateNisa(p) {
  const used = Math.min(p.nisaUsed, NISA_CAP);
  const rest = NISA_CAP - used;
  const pace = Math.min(p.monthlyInvest, NISA_MONTHLY_MAX);
  const pct = used / NISA_CAP * 100;
  $('#nisaPct').textContent = Math.round(pct) + '%';
  $('#nisaFill').style.width = Math.max(1, pct) + '%';

  let fillHtml, taxHtml;
  if (rest <= 0) {
    fillHtml = `<div class="ss"><div class="k">残り枠</div><div class="v teal">完全消化 🎉</div></div>`;
    taxHtml = '';
    $('#nisaNote').textContent = '生涯投資枠を使い切っています。あとは非課税の複利に任せるフェーズです。';
  } else if (pace <= 0) {
    fillHtml = `<div class="ss"><div class="k">残り枠</div><div class="v amber">${fmtMan(rest)}</div></div>
      <div class="ss"><div class="k">埋まるまで</div><div class="v danger">積立0円では埋まりません</div></div>`;
    taxHtml = '';
    $('#nisaNote').textContent = '毎月の積立額を設定すると、枠が埋まる年齢と節税インパクトを試算します。';
  } else {
    const months = Math.ceil(rest / pace);
    const fillAge = p.age + Math.floor(months / 12);
    /* 残枠を今のペースで埋め、65歳まで運用した場合の非課税メリット概算 */
    const rm = p.annualReturn / 100 / 12;
    let v = 0, principal = 0;
    const investMonths = months;
    const totalMonths = Math.max(investMonths, (65 - p.age) * 12);
    for (let m2 = 0; m2 < totalMonths; m2++) {
      v *= 1 + rm;
      if (m2 < investMonths) {
        const add = Math.min(pace, rest - principal);
        v += add; principal += add;
      }
    }
    const save = Math.max(0, (v - principal) * CGT);
    fillHtml = `
      <div class="ss"><div class="k">残り枠</div><div class="v amber">${fmtMan(rest)}</div></div>
      <div class="ss"><div class="k">今のペース(月${pace}万円)なら</div><div class="v teal">約${(months / 12).toFixed(1)}年で消化(${fillAge}歳)</div></div>`;
    taxHtml = `<div class="ss"><div class="k">65歳まで運用時の節税インパクト</div><div class="v indigo">約${fmtMan(save)}</div></div>`;
    $('#nisaNote').textContent = '節税インパクト = 残り枠を今のペースで埋めて65歳まで運用した場合の含み益 × 20.315%(課税口座との差額の概算)。';
  }
  $('#nisaStats').innerHTML = fillHtml + taxHtml;
}

/* =============== 処方箋(自動診断) =============== */
function diagnose(p) {
  const { fire, sideFire, mainSim } = state.last;
  const rx = [];
  const total = p.currentRisk + p.currentCash;
  const cashMonths = p.livingCost > 0 ? p.currentCash / p.livingCost : 99;

  /* --- 危険域 --- */
  if (mainSim.depleted !== null) {
    rx.push({ sev: 'danger', icon: '⚠️', key: 'plan_fail',
      title: `このプランは${mainSim.depleted}歳で資産が尽きます`,
      body: `リタイア想定${mainSim.retireAge}歳では100歳まで持ちません。リタイアを遅らせる・FIRE後の生活費(現在${p.fireCost}万円/月)を下げる・積立を増やす、のいずれかで曲線は大きく変わります。` });
  }
  if (cashMonths < 6) {
    rx.push({ sev: 'danger', icon: '🚨', key: 'emergency_fund',
      title: '生活防衛資金が不足しています',
      body: `現金${fmtMan(p.currentCash)}は生活費の${cashMonths.toFixed(1)}ヶ月分。暴落時に投資を取り崩さずに済むよう、まず生活費6ヶ月分(${fmtMan(p.livingCost * 6)})の現金確保をおすすめします。` });
  }

  /* --- 注意域 --- */
  if (cashMonths > 24 && p.currentCash / Math.max(1, total) > 0.5) {
    rx.push({ sev: 'warn', icon: '💤', key: 'cash_drag',
      title: '現金が眠っています',
      body: `現金${fmtMan(p.currentCash)}は生活費${Math.round(cashMonths)}ヶ月分で、資産の${Math.round(p.currentCash / total * 100)}%。インフレ${p.inflation}%が続くと実質価値は毎年目減りします。生活防衛資金を残して投資に回す余地があります。` });
  }
  if (p.inflation === 0) {
    rx.push({ sev: 'warn', icon: '🎈', key: 'inflation',
      title: 'インフレ0%は楽観的すぎるかもしれません',
      body: '2024年の物価上昇率は+2.7%。インフレを入れると必要額は大きく変わります。日銀目標の2%で再計算してみてください。' });
  }
  if (p.annualReturn >= 8) {
    rx.push({ sev: 'warn', icon: '📈', key: 'bull_return',
      title: `利回り${p.annualReturn}%は強気の前提です`,
      body: 'S&P500の過去30年でも円ベース年率約10%、全世界株は7〜9%。今後も続く保証はありません。4〜6%でもプランが成立するか確認しておくと安心です。' });
  }
  if (fire === null) {
    rx.push({ sev: 'warn', icon: '🧭', key: 'fire_path',
      title: 'FIREへの道筋がまだ見えません',
      body: '80歳までに完全リタイアできる条件が見つかりませんでした。「逆算」タブで目標年齢に必要な積立額を、副収入ありのサイドFIREも合わせて検討してみてください。' });
  }
  /* 教育費ピークの赤字 */
  const deficitYear = mainSim.rows.find(r => r.age < mainSim.retireAge && r.edu > 0 && r.income < r.expense);
  if (deficitYear) {
    rx.push({ sev: 'warn', icon: '🎓', key: 'edu_peak',
      title: `${deficitYear.age}歳ごろ、教育費で家計が赤字になります`,
      body: `働いていても収入より支出が多い年があります(教育費${fmtMan(deficitYear.edu)}/年)。資産を取り崩す前提なら問題ありませんが、積立を止める場合は「いつ再開するか」まで決めておくのが重要です。` });
  }

  /* --- 提案 --- */
  if (p.sideIncome === 0) {
    const side5 = findFireAge({ ...p, sideIncome: 5 }, true);
    if (side5 && fire && side5.age < fire.age) {
      rx.push({ sev: 'info', icon: '🌤', key: 'side_income',
        title: `月5万円の副収入で、リタイアが${fire.age - side5.age}年早まります`,
        body: `完全FIRE${fire.age}歳に対し、月5万円の副収入があれば${side5.age}歳でサイドFIRE可能。小さな収入の柱は想像以上に強力です。` });
    }
  }
  if (p.pensionMonthly === 0) {
    rx.push({ sev: 'info', icon: '🏛', key: 'pension',
      title: '年金が未設定です',
      body: '年金を0円で計算しています。ねんきん定期便の見込額(会社員世帯なら月14〜22万円程度が目安)を入れると、必要額はかなり現実的になります。' });
  }
  const restNisa = NISA_CAP - Math.min(p.nisaUsed, NISA_CAP);
  if (restNisa > 0 && p.monthlyInvest > 0) {
    rx.push({ sev: 'info', icon: '🌱', key: 'nisa',
      title: `新NISAの残り枠が${fmtMan(restNisa)}あります`,
      body: '課税口座より先に非課税枠を埋めるのが原則です。「資産推移」タブ下のメーターで、今のペースで何歳で埋まるか・節税インパクトを確認できます。' });
  }

  /* --- 良い知らせ --- */
  if (fire && fire.age <= p.age + 2) {
    rx.push({ sev: 'good', icon: '🎉', key: 'fire_done',
      title: '経済的自立はほぼ達成しています',
      body: `計算上、${fire.age}歳で完全リタイアしても100歳まで資産が持ちます。ここからは「増やす」より「どう使うか・どう守るか」の出口戦略がテーマになります。` });
  }
  const bench = benchPercentile(total, p.age, state.benchType);
  if (bench.topPct <= 20) {
    rx.push({ sev: 'good', icon: '🏆', key: 'bench_top',
      title: `金融資産は同年代の上位${bench.topPct < 10 ? bench.topPct.toFixed(1) : Math.round(bench.topPct)}%です`,
      body: `${bench.bracket}代(${bench.label})の中で上位層に入っています。この位置を守る鍵は、暴落時に売らないルールづくりです。` });
  }
  /* モンテカルロ(メンバー限定の値を使った診断) */
  if (state.unlocked) {
    const mc = monteCarlo(p, p.targetFireAge, false, 300);
    const pct = Math.round(mc.successRate * 100);
    if (pct < 70) {
      rx.push({ sev: 'danger', icon: '🎲', key: 'monte_carlo',
        title: `リターンのブレを考えると成功確率は約${pct}%です`,
        body: '平均通りにいけば成立するプランでも、暴落のタイミング次第で3回に1回は失敗する水準。現金クッションを厚くするか、リタイア年齢に1〜2年の余裕を持たせてください。' });
    } else if (pct >= 90) {
      rx.push({ sev: 'good', icon: '🎲', key: 'monte_carlo',
        title: `暴落を織り込んでも成功確率は約${pct}%です`,
        body: 'リターンのブレを1,000回試行しても十分に頑健なプランです。' });
    }
  } else {
    rx.push({ sev: 'info', icon: '🔒', key: '',
      title: 'このプランの「暴落込み成功確率」も診断できます',
      body: 'メンバーシップの合言葉を入力すると、モンテカルロ試行に基づく成功確率の診断が処方箋に加わります。合言葉は<a href="https://note.com/dolphin415/membership" target="_blank" rel="noopener" style="color:#fbbf24">マネーラボのメンバーシップ内の掲示板</a>でお知らせしています。', cta: true });
  }

  const order = { danger: 0, warn: 1, info: 2, good: 3 };
  return rx.sort((a, b) => order[a.sev] - order[b.sev]);
}

function updateRxTab(p) {
  const list = $('#rxList');
  const rx = diagnose(p);
  if (!rx.length) {
    list.innerHTML = '<div class="rx-empty">大きな問題は見つかりませんでした。スライダーを動かすと診断が変わります。</div>';
    return;
  }
  list.innerHTML = rx.map(r => `
    <div class="rx-card ${r.sev}">
      <div class="rx-title">${r.icon} ${r.title}</div>
      <div class="rx-body">${r.body}</div>
      ${r.cta ? `<a class="rx-link" href="#" onclick="openUnlock();return false">🔑 合言葉を入力する</a>`
        : (ARTICLES[r.key] ? `<a class="rx-link" href="${ARTICLES[r.key]}" target="_blank" rel="noopener">📖 関連記事を読む</a>` : '')}
    </div>`).join('');
}

/* =============== 市場前提プリセット =============== */
function markPresets() {
  $$('.preset-row').forEach(row => {
    const cur = state.params[row.dataset.target];
    $$('button', row).forEach(b => b.classList.toggle('on', +b.dataset.val === cur));
  });
}
function initPresets() {
  $$('.preset-row button').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.closest('.preset-row').dataset.target;
      state.params[key] = +btn.dataset.val;
      syncAllFields();
      markPresets();
      scheduleRecalc();
    });
  });
  markPresets();
}

/* =============== 結果画像ダウンロード(X投稿用) =============== */
function drawShareImage(debugNoDownload) {
  const p = currentP();
  const fire = state.last.fire;
  const sideFire = state.last.sideFire;
  const sim = state.last.mainSim;

  const W = 1200, H = 675;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const FONT = '"Hiragino Sans", "Noto Sans JP", sans-serif';

  /* 背景: 深宇宙グラデーション+星 */
  const bg = x.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0a1526');
  bg.addColorStop(0.55, '#060b16');
  bg.addColorStop(1, '#101a12');
  x.fillStyle = bg;
  x.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {
    const sx = (i * 137.5) % W, sy = (i * 89.7) % H;
    x.fillStyle = `rgba(220,235,255,${0.10 + (i % 7) * 0.05})`;
    x.beginPath(); x.arc(sx, sy, (i % 3) * 0.6 + 0.5, 0, Math.PI * 2); x.fill();
  }
  const glow = x.createRadialGradient(W * 0.82, H * 0.16, 0, W * 0.82, H * 0.16, 380);
  glow.addColorStop(0, 'rgba(14,165,160,.28)');
  glow.addColorStop(1, 'rgba(14,165,160,0)');
  x.fillStyle = glow;
  x.fillRect(0, 0, W, H);

  /* ブランド */
  x.fillStyle = '#5eead4';
  x.font = `bold 24px ${FONT}`;
  x.fillText('● MONEY LAB', 60, 66);
  x.fillStyle = '#eef4ff';
  x.font = `bold 44px ${FONT}`;
  x.fillText('資産形成シミュレーション結果', 60, 122);

  /* 資産カーブ(右側) */
  const cx0 = 640, cy0 = 210, cw = 490, chh = 330;
  x.strokeStyle = 'rgba(159,176,204,.18)';
  x.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const gy = cy0 + chh - (chh / 4) * g;
    x.beginPath(); x.moveTo(cx0, gy); x.lineTo(cx0 + cw, gy); x.stroke();
  }
  const rows = sim.rows;
  const maxV = Math.max(...rows.map(r => r.total), 1);
  const px = i => cx0 + (i / (rows.length - 1)) * cw;
  const py = v => cy0 + chh - (v / maxV) * chh;
  const area = x.createLinearGradient(0, cy0, 0, cy0 + chh);
  area.addColorStop(0, 'rgba(14,165,160,.4)');
  area.addColorStop(1, 'rgba(14,165,160,0)');
  x.beginPath();
  rows.forEach((r0, i) => i === 0 ? x.moveTo(px(i), py(r0.total)) : x.lineTo(px(i), py(r0.total)));
  x.lineTo(cx0 + cw, cy0 + chh); x.lineTo(cx0, cy0 + chh); x.closePath();
  x.fillStyle = area; x.fill();
  x.beginPath();
  rows.forEach((r0, i) => i === 0 ? x.moveTo(px(i), py(r0.total)) : x.lineTo(px(i), py(r0.total)));
  x.strokeStyle = '#2dd4bf'; x.lineWidth = 4; x.stroke();
  x.fillStyle = '#66788f';
  x.font = `bold 20px ${FONT}`;
  x.fillText(`${rows[0].age}歳`, cx0, cy0 + chh + 32);
  x.fillText('100歳', cx0 + cw - 58, cy0 + chh + 32);
  x.fillText('金融資産の推移', cx0, cy0 - 16);

  /* スタット(左側) */
  const stats = [
    ['🔥 FIRE可能年齢', fire ? fire.age + '歳' : '80歳まで困難', '#5eead4'],
    ['🌤 サイドFIRE可能年齢', sideFire ? sideFire.age + '歳' : '80歳まで困難', '#fbbf24'],
    ['🎯 FIRE時に必要な資産', fire ? fmtMan(fire.assetsAtFire) : '--', '#a5b4fc'],
    ['⏳ 資産寿命', sim.depleted ? sim.depleted + '歳で枯渇' : '100歳まで維持', sim.depleted ? '#f87171' : '#5eead4'],
  ];
  stats.forEach((s, i) => {
    const sy = 205 + i * 92;
    x.fillStyle = '#9fb0cc';
    x.font = `bold 21px ${FONT}`;
    x.fillText(s[0], 60, sy);
    x.fillStyle = s[2];
    x.font = `bold 46px ${FONT}`;
    x.fillText(s[1], 60, sy + 52);
  });

  /* フッター */
  x.fillStyle = 'rgba(159,176,204,.7)';
  x.font = `bold 19px ${FONT}`;
  x.fillText('あなた仕様のFIRE・老後シミュレーション | マネーラボ 資産形成シミュレーター', 60, H - 34);

  if (debugNoDownload) return cv;
  cv.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'moneylab_simulation.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast('📸 結果画像を保存しました。Xでのシェア歓迎です!');
  }, 'image/png');
}

/* =============== 背景テーマ切替 =============== */
function initBgSwitch() {
  const menu = $('#bgSwitch .bg-menu');
  const btn = $('#bgSwitchBtn');
  const mark = () => {
    const cur = (window.getBgTheme && getBgTheme()) || 'space';
    $$('#bgSwitch .bg-menu button').forEach(b => b.classList.toggle('on', b.dataset.bg === cur));
  };
  const setMenu = open => {
    menu.hidden = !open;
    btn.textContent = open ? '✕' : '🎨';
    if (open) mark();
  };
  btn.addEventListener('click', () => setMenu(menu.hidden));
  $$('#bgSwitch .bg-menu button[data-bg]').forEach(b => {
    b.addEventListener('click', () => {
      if (window.setBgTheme) setBgTheme(b.dataset.bg);
      setMenu(false);
      toast(b.textContent.trim() + ' に切り替えました');
    });
  });
  $('#ssBtn').addEventListener('click', () => {
    setMenu(false);
    enterScreensaver();
  });
  // iOS Safariは非インタラクティブ要素へのタップでclickを発火しないため pointerdown で閉じる
  document.addEventListener('pointerdown', e => {
    if (!e.target.closest('#bgSwitch')) setMenu(false);
  });
  window.addEventListener('scroll', () => { if (!menu.hidden) setMenu(false); }, { passive: true });
}

/* =============== スクリーンセーバー =============== */
function enterScreensaver() {
  document.body.classList.add('screensaver');
  state.ssAt = Date.now();
  const hint = $('#ssHint');
  hint.classList.add('show');
  clearTimeout(enterScreensaver._tm);
  enterScreensaver._tm = setTimeout(() => hint.classList.remove('show'), 5000);
  window.dispatchEvent(new CustomEvent('ml:screensaver', { detail: { on: true } }));
}
function exitScreensaver() {
  if (!document.body.classList.contains('screensaver')) return;
  document.body.classList.remove('screensaver');
  $('#ssHint').classList.remove('show');
  window.dispatchEvent(new CustomEvent('ml:screensaver', { detail: { on: false } }));
}
function initScreensaver() {
  /* シングルクリックはクリック演出(background.js側)。終了はダブルクリックかキー */
  document.addEventListener('dblclick', () => {
    if (document.body.classList.contains('screensaver') && Date.now() - state.ssAt > 600) exitScreensaver();
  });
  document.addEventListener('keydown', () => exitScreensaver());
}

/* =============== ロック解除 =============== */
function applyUnlock() {
  state.unlocked = true;
  document.body.classList.add('unlocked');
  $$('fieldset.premium-zone').forEach(f => f.disabled = false);
  $('#unlockBarBtn').style.display = 'none';
  if (state.activeTab === 'mc' && chartsReady) runMC(currentP());
}
window.openUnlock = function () {
  $('#passErr').textContent = '';
  $('#passInput').value = '';
  $('#unlockModal').showModal();
  setTimeout(() => $('#passInput').focus(), 60);
};
async function tryUnlock() {
  const v = $('#passInput').value.trim();
  if (!v) return;
  try {
    const h = await hashPass(v);
    if (h === PASS_HASH) {
      localStorage.setItem('ml_member', h);
      $('#unlockModal').close();
      applyUnlock();
      recalc();
      toast('✦ メンバーシップ完全版が解放されました');
    } else {
      $('#passErr').textContent = '合言葉が違います。メンバーシップ記事をご確認ください。';
    }
  } catch (e) {
    $('#passErr').textContent = 'この環境では照合できません(https でお試しください)。';
  }
}

/* =============== 保存・共有・復元 =============== */
function saveLocal() {
  try {
    localStorage.setItem('ml_params', JSON.stringify({ p: state.params, c: state.children }));
  } catch (e) { /* プライベートモード等では保存しない */ }
}
function encodeShare() {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(state.params)) {
    if (v !== PARAM_DEFS[k].def) q.set(k, v);
  }
  if (state.children.length) {
    q.set('kids', state.children.map(c =>
      `${c.birthParentAge}.${c.plan}.${c.univ}${c.univ === 'private_med' ? '.' + (c.medTotal || MED_TOTAL_DEFAULT) : ''}`).join('_'));
  }
  const url = location.origin + location.pathname + (q.toString() ? '#' + q.toString() : '');
  return url;
}
function decodeShare() {
  if (!location.hash || location.hash.length < 2) return false;
  try {
    const q = new URLSearchParams(location.hash.slice(1));
    let any = false;
    for (const [k, v] of q.entries()) {
      if (k === 'kids') {
        state.children = v.split('_').map(s => {
          const [b, plan, univ, med] = s.split('.');
          return {
            birthParentAge: +b || 30,
            plan: EDU_PLANS[plan] ? plan : 'all_public',
            univ: UNIV_TYPES[univ] ? univ : 'national',
            medTotal: +med || MED_TOTAL_DEFAULT,
          };
        });
        any = true;
      } else if (k in PARAM_DEFS && isFinite(+v)) {
        state.params[k] = +v;
        any = true;
      }
    }
    return any;
  } catch (e) { return false; }
}
function loadLocal() {
  try {
    const raw = localStorage.getItem('ml_params');
    if (!raw) return;
    const { p, c } = JSON.parse(raw);
    for (const k in p) if (k in PARAM_DEFS && isFinite(+p[k])) state.params[k] = +p[k];
    if (Array.isArray(c)) state.children = c;
  } catch (e) { /* 破損時は初期値 */ }
}

/* =============== 初期化 =============== */
function init() {
  loadLocal();
  decodeShare();
  buildFields();
  renderChildren();
  initTabs();
  initBgSwitch();
  initScreensaver();

  $('#addChildBtn').addEventListener('click', () => {
    state.children.push({ birthParentAge: Math.min(state.params.age, 35), plan: 'all_public', univ: 'national' });
    renderChildren(); scheduleRecalc();
  });
  initPresets();
  $('#snapBtn').addEventListener('click', () => {
    if (!state.last) return;
    drawShareImage();
  });
  $('#cpBtn').addEventListener('click', saveCheckpoint);
  $('#passSubmit').addEventListener('click', tryUnlock);
  $('#passInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); tryUnlock(); } });

  $('#shareBtn').addEventListener('click', async () => {
    const url = encodeShare();
    try {
      await navigator.clipboard.writeText(url);
      toast('🔗 設定入りURLをコピーしました');
    } catch (e) {
      prompt('このURLをコピーしてください', url);
    }
  });
  $('#resetBtn').addEventListener('click', () => {
    localStorage.removeItem('ml_params');
    history.replaceState(null, '', location.pathname);
    location.reload();
  });

  /* 保存済みメンバー判定(合言葉を変えると自動的に再ロックされる) */
  if (localStorage.getItem('ml_member') === PASS_HASH) applyUnlock();

  if (!chartsReady) {
    $$('.chart-box').forEach(b => {
      b.innerHTML = '<p style="color:#9fb0cc;font-size:13px;padding:30px 10px;text-align:center">チャートライブラリを読み込めませんでした。通信環境をご確認のうえ再読み込みしてください。</p>';
    });
  }
  recalc();

  /* PWA: Service Worker登録(オフライン対応・ホーム画面追加) */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* http環境などでは黙って無効 */ });
  }
}
document.addEventListener('DOMContentLoaded', init);
