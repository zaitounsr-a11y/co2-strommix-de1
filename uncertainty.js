/**
 * Task 2 — Unsicherheit des marginalen Emissionsfaktors (MEF)
 * -----------------------------------------------------------
 * marginal.js liefert EINEN Wert (Steigung der Regression). Diese Datei
 * liefert dazu die Unsicherheit:
 *
 *   1) Newey-West-Standardfehler (Newey & West 1987)
 *      Stuendliche Differenzen sind autokorreliert. Der normale
 *      OLS-Standardfehler ist deshalb zu klein.
 *   2) Block-Bootstrap (Kuensch 1989), "circular", feste Blocklaenge
 *      Es werden ganze Bloecke (z.B. 24 h) mit Zuruecklegen gezogen,
 *      damit die Tagesstruktur erhalten bleibt. 95-%-Intervall aus den
 *      2,5-%- und 97,5-%-Quantilen der Steigung.
 *
 * Die Intervalle beschreiben NUR das Stichprobenrauschen innerhalb des
 * Zeitraums. Sie sagen nichts ueber die Wahl der Emissionsfaktoren oder
 * der Bezugsgroesse (Residuallast).
 *
 * Aufruf:   node uncertainty.js 2024-06-10 2024-06-17
 *           node uncertainty.js 2024-01-01 2025-01-01        (ganzes Jahr)
 * Optional: PROXY=https://co2-strommix-de1.onrender.com node uncertainty.js ...
 *           BLOCK=168 LAGS=48 B=2000 node uncertainty.js ...
 *
 * Lange Zeitraeume werden in 14-Tage-Stuecken geladen (ein Jahr in einem
 * Abruf schlaegt fehl).
 */

import { emissionFactors } from './emissionFactors.js';

const PROXY = process.env.PROXY ?? 'http://localhost:3000';
const BLOCK = Number(process.env.BLOCK ?? 24);     // Blocklaenge in Stunden
const LAGS  = Number(process.env.LAGS  ?? 24);     // Newey-West-Lags
const B     = Number(process.env.B     ?? 2000);   // Bootstrap-Wiederholungen
const SEED  = Number(process.env.SEED  ?? 12345);  // fester Startwert -> reproduzierbar

const VRE = ['Wind Onshore', 'Wind Offshore', 'Photovoltaik'];

const isMain = process.argv[1]?.endsWith('uncertainty.js');
const [, , startArg, endArg] = process.argv;
if (isMain && (!startArg || !endArg)) {
  console.error('Aufruf: node uncertainty.js <start YYYY-MM-DD> <end YYYY-MM-DD>');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Daten laden (in 14-Tage-Stuecken)
// ---------------------------------------------------------------------------
async function load(startIso, endIso) {
  const out = [];
  const step = 14 * 86400e3;
  const t1 = Date.parse(endIso);
  for (let t = Date.parse(startIso); t < t1; t += step) {
    const a = new Date(t).toISOString();
    const b = new Date(Math.min(t + step, t1)).toISOString();
    const r = await fetch(`${PROXY}/api/generation?start=${a}&end=${b}`);
    const j = await r.json();
    if (!Array.isArray(j)) throw new Error(`Proxy-Fehler fuer ${a}: ${JSON.stringify(j).slice(0, 200)}`);
    out.push(...j);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Statistik
// ---------------------------------------------------------------------------
export function ols(x, y) {
  const n = x.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  const slope = sxy / sxx, inter = my - slope * mx;
  const resid = x.map((xi, i) => y[i] - inter - slope * xi);
  const ssr = resid.reduce((s, e) => s + e * e, 0);
  return { slope, inter, r2: 1 - ssr / syy, n, mx, sxx, resid, ssr };
}

/** Normaler OLS-Standardfehler der Steigung (zum Vergleich, zu klein). */
export function seOls(r) {
  return Math.sqrt(r.ssr / (r.n - 2) / r.sxx);
}

/** Newey-West-Standardfehler der Steigung, Bartlett-Gewichte, L Lags. */
export function seNeweyWest(x, r, L) {
  const n = x.length;
  const u = x.map((xi, i) => (xi - r.mx) * r.resid[i]);
  let S = u.reduce((s, v) => s + v * v, 0);
  for (let l = 1; l <= L; l++) {
    let g = 0;
    for (let i = l; i < n; i++) g += u[i] * u[i - l];
    S += 2 * (1 - l / (L + 1)) * g;
  }
  return Math.sqrt(S) / r.sxx;
}

/** Einfacher, reproduzierbarer Zufallsgenerator (LCG). */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/** Circular Block Bootstrap der Steigung -> [2,5 %, 97,5 %]. */
export function bootstrapCI(x, y, blockLen, reps, seed = 12345) {
  const n = x.length, rand = rng(seed), slopes = [];
  const xs = new Array(n), ys = new Array(n);
  for (let b = 0; b < reps; b++) {
    let c = 0;
    while (c < n) {
      const start = Math.floor(rand() * n);
      for (let k = 0; k < blockLen && c < n; k++) {
        const j = (start + k) % n;
        xs[c] = x[j]; ys[c] = y[j]; c++;
      }
    }
    slopes.push(ols(xs, ys).slope);
  }
  slopes.sort((a, b) => a - b);
  return [slopes[Math.floor(0.025 * reps)], slopes[Math.floor(0.975 * reps)]];
}

// ---------------------------------------------------------------------------
// Hauptprogramm
// ---------------------------------------------------------------------------
if (isMain) {
  const hours = await load(`${startArg}T00:00:00Z`, `${endArg}T00:00:00Z`);
  console.log(`${hours.length} Stunden geladen (${startArg} bis ${endArg}).\n`);

  const series = hours.map(h => {
    let total = 0, emis = 0;
    for (const [k, mwh] of Object.entries(h.values)) {
      total += mwh;
      emis  += (emissionFactors[k]?.lc ?? 0) * mwh / 1000;      // t CO2eq
    }
    const vre = VRE.reduce((s, k) => s + (h.values[k] ?? 0), 0);
    return { residual: total - vre, emis };
  });

  const dRes = [], dEmis = [];
  for (let i = 1; i < series.length; i++) {
    dRes.push(series[i].residual - series[i - 1].residual);
    dEmis.push(series[i].emis - series[i - 1].emis);
  }

  const r  = ols(dRes, dEmis);
  const ci = bootstrapCI(dRes, dEmis, BLOCK, B, SEED);
  const g  = v => (v * 1000).toFixed(1);

  console.log('=== MEF MIT UNSICHERHEIT (Regression auf Residuallast) ===\n');
  console.log(`  Paare (Stundenuebergaenge)        ${r.n}`);
  console.log(`  MEF                               ${g(r.slope)} g/kWh`);
  console.log(`  R2                                ${r.r2.toFixed(3)}`);
  console.log(`  Standardfehler OLS (zu klein)     ${g(seOls(r))} g/kWh`);
  console.log(`  Standardfehler Newey-West (${LAGS} Lags) ${g(seNeweyWest(dRes, r, LAGS))} g/kWh`);
  console.log(`  95-%-Intervall Block-Bootstrap    ${Math.round(ci[0] * 1000)} bis ${Math.round(ci[1] * 1000)} g/kWh`);
  console.log(`     (Blocklaenge ${BLOCK} h, ${B} Wiederholungen, Startwert ${SEED})`);
  console.log('\n  Hinweis: Das Intervall beschreibt nur das Stichprobenrauschen im');
  console.log('  gewaehlten Zeitraum, nicht die Unsicherheit der Emissionsfaktoren.');
}
