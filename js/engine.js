'use strict';
/* =============================================================
   マネーラボ 資産形成シミュレーター — 計算エンジン
   金額の単位はすべて「万円」。年齢は整数(年単位シミュレーション)。
   ============================================================= */

/* --- 教育費テーブル(万円/年・現在価値) ---
   出典目安: 文部科学省「子供の学習費調査」等をもとにした概算値 */
const EDU_COST = {
  kinder: { pub: 17,  priv: 31  },   // 3〜5歳
  elem:   { pub: 35,  priv: 167 },   // 6〜11歳
  jhs:    { pub: 54,  priv: 144 },   // 12〜14歳
  hs:     { pub: 51,  priv: 105 },   // 15〜17歳
};
/* 大学・専門課程(18歳〜)。perYear: null は私立医学部で、総額(medTotal)/6 を使う */
const UNIV_TYPES = {
  none:           { label: '進学なし',                 years: 0, perYear: 0 },
  national:       { label: '国公立大(4年)',            years: 4, perYear: 65 },
  private_hum:    { label: '私立文系(4年)',            years: 4, perYear: 105 },
  private_sci:    { label: '私立理系(4年)',            years: 4, perYear: 150 },
  national_med:   { label: '国公立 医・歯・薬(6年)',   years: 6, perYear: 65 },
  private_pharma: { label: '私立薬学部(6年 約1,200万)', years: 6, perYear: 200 },
  private_dent:   { label: '私立歯学部(6年 約3,200万)', years: 6, perYear: 530 },
  private_med:    { label: '私立医学部(6年・学費選択)', years: 6, perYear: null },
};
const MED_TOTALS = [2000, 2500, 3000, 3500, 4000, 4500, 5000];  // 私立医6年総額(万円)
const MED_TOTAL_DEFAULT = 3500;
const EDU_PLANS = {
  all_public:  { label: 'オール公立',       kinder: 'priv', elem: 'pub',  jhs: 'pub',  hs: 'pub'  },
  private_hs:  { label: '高校から私立',     kinder: 'priv', elem: 'pub',  jhs: 'pub',  hs: 'priv' },
  private_jhs: { label: '中学から私立',     kinder: 'priv', elem: 'pub',  jhs: 'priv', hs: 'priv' },
  all_private: { label: 'オール私立',       kinder: 'priv', elem: 'priv', jhs: 'priv', hs: 'priv' },
};
/* 子ども1人の教育費(万円/年・現在価値)。childAge は子の年齢 */
function childEduCost(child, childAge) {
  const plan = EDU_PLANS[child.plan] || EDU_PLANS.all_public;
  if (childAge >= 3  && childAge <= 5)  return EDU_COST.kinder[plan.kinder];
  if (childAge >= 6  && childAge <= 11) return EDU_COST.elem[plan.elem];
  if (childAge >= 12 && childAge <= 14) return EDU_COST.jhs[plan.jhs];
  if (childAge >= 15 && childAge <= 17) return EDU_COST.hs[plan.hs];
  const u = UNIV_TYPES[child.univ] || UNIV_TYPES.none;
  if (childAge >= 18 && childAge < 18 + u.years) {
    if (u.perYear !== null) return u.perYear;
    return (child.medTotal || MED_TOTAL_DEFAULT) / 6;   // 私立医学部
  }
  return 0;
}

/* 親の年齢 parentAge 時点の教育費合計(現在価値) */
function eduCostAt(p, parentAge) {
  if (!p.children || !p.children.length) return 0;
  let sum = 0;
  for (const c of p.children) {
    sum += childEduCost(c, parentAge - c.birthParentAge);
  }
  return sum;
}

/* 子ども別の内訳(教育費チャート用) */
function eduBreakdownAt(p, parentAge) {
  return (p.children || []).map(c => childEduCost(c, parentAge - c.birthParentAge));
}

/* =============================================================
   メインシミュレーション
   opt.retireAge : この年齢で労働収入が止まる(FIRE年齢)
   opt.side      : true ならリタイア後に副収入あり(サイドFIRE)
   opt.returns   : 年ごとのリターン配列(モンテカルロ用)。省略時は固定利回り
   ============================================================= */
function simulate(p, opt = {}) {
  const retireAge = opt.retireAge ?? p.targetFireAge;
  const side = opt.side ?? false;
  const endAge = p.endAge;
  const years = endAge - p.age + 1;

  let risk = p.currentRisk;
  let cash = p.currentCash;
  let depleted = null;
  let bonusPaid = false;
  const rows = [];

  for (let t = 0; t < years; t++) {
    const a = p.age + t;
    const infl = Math.pow(1 + p.inflation / 100, t);
    const working = a < retireAge;

    /* --- 収入 --- */
    let income = 0;
    if (working) {
      income += p.takehome * Math.pow(1 + p.salaryGrowth / 100, t);
      income += p.spouseTakehome * infl;
    }
    const sideInc = (!working && side && a < p.sideIncomeEnd) ? p.sideIncome * 12 * infl : 0;
    const pension = (a >= p.pensionStart) ? p.pensionMonthly * 12 * infl : 0;

    /* --- 退職金(リタイア年に一度だけ) --- */
    if (!working && !bonusPaid && retireAge <= endAge) {
      cash += p.retirementPay;
      bonusPaid = true;
    }

    /* --- 支出 --- */
    const living = (working ? p.livingCost : p.fireCost) * 12 * infl;
    const edu = eduCostAt(p, a) * infl;
    const expense = living + edu;

    /* --- キャッシュフロー --- */
    const surplus = income + sideInc + pension - expense;
    if (working) {
      const inv = p.monthlyInvest * 12;
      risk += inv;
      cash += surplus - inv;
    } else {
      cash += surplus;
    }
    /* 現金が尽きたらリスク資産を取り崩す */
    if (cash < 0) { risk += cash; cash = 0; }
    if (risk < 0) {
      cash += risk; risk = 0;
      if (cash < 0) { if (depleted === null) depleted = a; cash = 0; }
    }

    /* --- 運用リターン --- */
    const r = opt.returns ? opt.returns[t] : p.annualReturn / 100;
    risk *= (1 + r);
    cash *= (1 + p.cashReturn / 100);
    if (risk < 0) risk = 0;

    rows.push({
      age: a,
      risk, cash,
      total: risk + cash,
      real: (risk + cash) / infl,
      income: income + sideInc,
      pension,
      expense,
      edu,
      withdrawal: (!working && surplus < 0) ? -surplus : 0,
    });
  }
  return { rows, depleted, retireAge };
}

/* 100歳まで資産が尽きない最も早いリタイア年齢を探索 */
function findFireAge(p, side) {
  for (let A = p.age; A <= Math.min(80, p.endAge); A++) {
    const sim = simulate(p, { retireAge: A, side });
    if (sim.depleted === null) {
      /* リタイア時点の資産(前年末の残高) */
      const idx = Math.max(0, A - p.age - 1);
      const atFire = (A === p.age) ? (p.currentRisk + p.currentCash) : sim.rows[idx].total;
      return { age: A, assetsAtFire: atFire, sim };
    }
  }
  return null;
}

/* =============================================================
   モンテカルロシミュレーション
   ============================================================= */
function randNormal() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function monteCarlo(p, retireAge, side, nTrials = 1000) {
  const years = p.endAge - p.age + 1;
  const mu = p.annualReturn / 100;
  const sigma = p.volatility / 100;
  const totalsPerYear = Array.from({ length: years }, () => []);
  let success = 0;

  for (let n = 0; n < nTrials; n++) {
    const returns = new Array(years);
    for (let t = 0; t < years; t++) returns[t] = mu + sigma * randNormal();
    const sim = simulate(p, { retireAge, side, returns });
    if (sim.depleted === null) success++;
    for (let t = 0; t < years; t++) totalsPerYear[t].push(sim.rows[t].total);
  }

  const pct = (arr, q) => {
    const s = arr.slice().sort((a, b) => a - b);
    const i = (s.length - 1) * q;
    const lo = Math.floor(i), hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  const bands = { p5: [], p25: [], p50: [], p75: [], p95: [] };
  const ages = [];
  for (let t = 0; t < years; t++) {
    ages.push(p.age + t);
    bands.p5.push(pct(totalsPerYear[t], 0.05));
    bands.p25.push(pct(totalsPerYear[t], 0.25));
    bands.p50.push(pct(totalsPerYear[t], 0.50));
    bands.p75.push(pct(totalsPerYear[t], 0.75));
    bands.p95.push(pct(totalsPerYear[t], 0.95));
  }
  return { successRate: success / nTrials, bands, ages, nTrials };
}

/* =============================================================
   目標逆算: 「goalAge歳でリタイアするには毎月いくら積み立てが必要か」
   返り値: 万円/月。0=今の資産だけで達成可能。null=月300万でも困難。
   ============================================================= */
function requiredMonthlyInvest(p, goalAge, side) {
  const ok = inv => simulate({ ...p, monthlyInvest: inv }, { retireAge: goalAge, side }).depleted === null;
  if (ok(0)) return 0;
  let lo = 0, hi = 300;
  if (!ok(hi)) return null;
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2;
    if (ok(mid)) hi = mid; else lo = mid;
  }
  return hi;
}

/* =============================================================
   同年代ベンチマーク
   出典: 金融経済教育推進機構(J-FLEC)「家計の金融行動に関する世論調査」2024年
   金融資産保有額(金融資産を保有していない世帯を含む)・世帯主の年令別
   dist は [非保有, 〜100, 100〜200, 200〜300, 300〜400, 400〜500,
            500〜700, 700〜1000, 1000〜1500, 1500〜2000, 2000〜3000, 3000〜] の%
   (無回答分を除いて正規化して使用)
   ============================================================= */
const BENCH_EDGES = [0, 100, 200, 300, 400, 500, 700, 1000, 1500, 2000, 3000];
const BENCH = {
  futari: {
    label: '二人以上世帯',
    ages: {
      20: { mean: 382,  median: 84,  dist: [22.8, 23.4, 11.1, 5.3, 4.1, 6.4, 5.8, 4.1, 5.8, 0.6, 0.0, 2.3] },
      30: { mean: 677,  median: 180, dist: [24.5, 13.1, 11.3, 7.6, 4.9, 3.1, 6.2, 7.3, 7.9, 3.5, 4.2, 2.8] },
      40: { mean: 944,  median: 250, dist: [25.7, 11.2, 6.2, 6.1, 4.6, 3.3, 7.7, 6.4, 8.2, 3.8, 5.5, 6.5] },
      50: { mean: 1168, median: 250, dist: [29.2, 8.7, 5.9, 5.1, 3.7, 3.2, 6.3, 5.8, 7.6, 3.8, 6.3, 10.7] },
      60: { mean: 2033, median: 650, dist: [20.5, 6.5, 5.3, 3.7, 3.1, 3.1, 6.3, 5.3, 8.9, 5.8, 8.0, 20.0] },
      70: { mean: 1923, median: 800, dist: [20.8, 5.4, 4.9, 3.4, 3.7, 2.3, 4.9, 6.4, 10.2, 6.6, 8.9, 19.0] },
    },
  },
  tanshin: {
    label: '単身世帯',
    ages: {
      20: { mean: 161,  median: 15,  dist: [36.6, 26.3, 9.5, 4.9, 4.8, 2.4, 4.6, 4.0, 2.4, 0.4, 0.4, 0.0] },
      30: { mean: 459,  median: 90,  dist: [33.4, 15.3, 8.3, 5.8, 5.2, 2.5, 6.1, 8.0, 4.3, 2.5, 2.8, 3.1] },
      40: { mean: 883,  median: 85,  dist: [33.3, 15.4, 7.7, 5.2, 4.0, 1.2, 4.9, 4.6, 5.9, 2.8, 3.7, 8.6] },
      50: { mean: 1087, median: 30,  dist: [40.2, 13.1, 4.1, 2.7, 3.8, 1.9, 3.3, 3.8, 5.5, 3.3, 3.8, 11.2] },
      60: { mean: 1679, median: 350, dist: [27.7, 8.9, 5.6, 3.0, 3.3, 2.8, 5.8, 5.1, 8.2, 2.6, 6.1, 16.8] },
      70: { mean: 1634, median: 475, dist: [27.0, 5.1, 5.7, 4.9, 3.9, 2.2, 7.3, 5.9, 8.9, 4.7, 6.1, 15.9] },
    },
  },
};

function benchBracket(age) {
  return Math.min(70, Math.max(20, Math.floor(age / 10) * 10));
}

/* assets(万円)が同年代の中で「下位から何%」の位置かを分布から推計 */
function benchPercentile(assets, age, type) {
  const bracket = benchBracket(age);
  const b = BENCH[type].ages[bracket];
  const total = b.dist.reduce((a, v) => a + v, 0);   // 無回答を除いて正規化
  const d = b.dist.map(v => v / total);
  let below = 0;
  if (assets <= 0) {
    below = d[0] * 0.5;   // 非保有層の中央とみなす
  } else {
    below = d[0];
    for (let i = 1; i < d.length; i++) {
      const lo = BENCH_EDGES[i - 1];
      const hi = (i < BENCH_EDGES.length) ? BENCH_EDGES[i] : Infinity;
      if (i === d.length - 1) {
        /* 3,000万円以上の層は3億円までの対数補間で近似 */
        const frac = Math.min(1, (Math.log(assets) - Math.log(3000)) / (Math.log(30000) - Math.log(3000)));
        below += d[i] * Math.max(0, frac);
        break;
      }
      if (assets >= hi) { below += d[i]; continue; }
      below += d[i] * (assets - lo) / (hi - lo);
      break;
    }
  }
  const pct = Math.min(0.999, Math.max(0.001, below));
  return {
    bracket,
    label: BENCH[type].label,
    mean: b.mean,
    median: b.median,
    dist: d,
    belowPct: pct * 100,
    topPct: (1 - pct) * 100,
  };
}

/* =============================================================
   住宅 購入 vs 賃貸 比較
   同じ積立ペースを前提に、住居関連の支出差だけをポートフォリオに反映した
   簡易比較。純資産 = 金融資産 + (持ち家の想定売却価値 − ローン残債)
   ============================================================= */
function housingCompare(p, h) {
  const years = p.endAge - p.age + 1;
  const r = p.annualReturn / 100;
  const P0 = p.currentRisk + p.currentCash;

  /* 月々のローン返済額(元利均等) */
  const loan = Math.max(0, h.price - h.down);
  const im = h.loanRate / 100 / 12;
  const nm = h.loanYears * 12;
  const payM = im > 0
    ? loan * im * Math.pow(1 + im, nm) / (Math.pow(1 + im, nm) - 1)
    : (nm > 0 ? loan / nm : 0);

  const buy = { portfolio: P0, netWorth: [] };
  const rent = { portfolio: P0, netWorth: [] };
  let balance = 0, owned = false, ownedYears = 0;
  const ages = [];

  for (let t = 0; t < years; t++) {
    const a = p.age + t;
    const infl = Math.pow(1 + p.inflation / 100, t);
    ages.push(a);

    /* --- 賃貸シナリオ: 家賃を払い続ける --- */
    rent.portfolio -= h.rentMonthly * 12 * infl;
    rent.portfolio *= (1 + r);

    /* --- 購入シナリオ --- */
    if (!owned && a >= h.purchaseAge) {
      owned = true;
      balance = loan;
      buy.portfolio -= h.down + h.price * 0.07;  // 頭金+諸費用(約7%)
    }
    if (owned) {
      /* ローン返済(月次で残債を更新) */
      let paidThisYear = 0;
      for (let m = 0; m < 12 && balance > 0; m++) {
        const interest = balance * im;
        const principal = Math.min(payM - interest, balance);
        balance -= principal;
        paidThisYear += interest + principal;
      }
      buy.portfolio -= paidThisYear;
      buy.portfolio -= h.price * (h.maintRate / 100);  // 管理・修繕・固定資産税
      ownedYears++;
    } else {
      buy.portfolio -= h.rentMonthly * 12 * infl;      // 購入前は賃貸
    }
    buy.portfolio *= (1 + r);

    const homeValue = owned ? h.price * Math.pow(1 - h.depRate / 100, ownedYears) : 0;
    buy.netWorth.push(buy.portfolio + homeValue - balance);
    rent.netWorth.push(rent.portfolio);
  }
  return { ages, buy: buy.netWorth, rent: rent.netWorth, payMonthly: payM };
}
