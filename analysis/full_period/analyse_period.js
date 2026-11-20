/**
 * Task 2 — full analysis of the marginal emission factor for any period
 * ----------------------------------------------------------------------
 * Reproduces the numbers of report Sections 6.5–6.7 and 9.5 for a chosen period:
 *
 *   - marginal factor (regression of Δ emissions on Δ residual load), R², Newey–West SE,
 *     block-bootstrap 95 % interval, regression on total generation for comparison
 *   - average factor with storage valued as in Task 1 (grid intensity without storage ÷ 0.80)
 *   - marginal factor at low and high residual load (median split)
 *   - operational (Scope 2) factors and fossil plants only
 *   - decomposition of the response by carrier (shares add up to 100 %)
 *   - sensitivity to the valuation of pumped storage (zero / fixed / self-consistent)
 *   - Method B: carrier that moves most in the same direction as residual load (share of hours)
 *   - monthly values and weekly range (when the period is long enough)
 *
 * Usage (local server running with `npm start`):
 *   node analysis/full_period/analyse_period.js 2024-06-10 2024-06-17      benchmark week
 *   node analysis/full_period/analyse_period.js 2024-01-01 2025-01-01      full year 2024
 *   node analysis/full_period/analyse_period.js 2019-01-01 2020-01-01      2019 (elmada comparison)
 * Options: PROXY=https://co2-strommix-de1.onrender.com  OUT=results.json  B=1000
 */

import { writeFileSync } from 'fs';
import { emissionFactors } from '../../emissionFactors.js';
import { ols, seNeweyWest, bootstrapCI } from '../../uncertainty.js';

const PROXY = process.env.PROXY ?? 'http://localhost:3000';
const B = Number(process.env.B ?? 1000);
const ETA = 0.80;
const VRE = ['Wind Onshore', 'Wind Offshore', 'Photovoltaik'];
const FOSSIL = ['Braunkohle', 'Steinkohle', 'Erdgas', 'Sonstige Konventionelle'];
const METHOD_B = [...FOSSIL, 'Biomasse'];            // dispatchable candidates, storage excluded
const STORAGE = 'Pumpspeicher';

const [, , startArg, endArg] = process.argv;
if (!startArg || !endArg) {
  console.error('Usage: node analysis/full_period/analyse_period.js <start YYYY-MM-DD> <end YYYY-MM-DD>');
  process.exit(1);
}

// ---------- data ----------
async function load(startIso, endIso) {
  const out = [];
  const step = 14 * 86400e3;
  const t1 = Date.parse(endIso);
  for (let t = Date.parse(startIso); t < t1; t += step) {
    const a = new Date(t).toISOString();
    const b = new Date(Math.min(t + step, t1)).toISOString();
    const j = await (await fetch(`${PROXY}/api/generation?start=${a}&end=${b}`)).json();
    if (!Array.isArray(j)) throw new Error(`Proxy error for ${a}: ${JSON.stringify(j).slice(0, 200)}`);
    out.push(...j);
  }
  return out;
}

// ---------- helpers ----------
const lc = k => emissionFactors[k]?.lc ?? 0;
const s2 = k => emissionFactors[k]?.scope2 ?? 0;
const diff = a => a.slice(1).map((v, i) => v - a[i]);
const slope = (x, y) => ols(x, y).slope;
const g = v => Math.round(v * 1000);                 // t/MWh -> g/kWh, rounded

function series(hours, factor) {
  return hours.map(h => {
    let total = 0, emis = 0;
    for (const [k, mwh] of Object.entries(h.values)) { total += mwh; emis += factor(k) * mwh / 1000; }
    const vre = VRE.reduce((s, k) => s + (h.values[k] ?? 0), 0);
    return { t: h.timestamp, total, residual: total - vre, emis, v: h.values };
  });
}

function aefTask1(hours) {                           // storage = grid intensity without storage / ETA
  let e = 0, m = 0;
  for (const h of hours) for (const [k, mwh] of Object.entries(h.values)) {
    if (k === STORAGE) continue; e += lc(k) * mwh / 1000; m += mwh;
  }
  const fStore = e * 1000 / m / ETA;
  let sum = 0;
  for (const h of hours) {
    let te = 0, tm = 0;
    for (const [k, mwh] of Object.entries(h.values)) { tm += mwh; te += (k === STORAGE ? fStore : lc(k)) * mwh / 1000; }
    sum += te * 1000 / tm;
  }
  return { aef: sum / hours.length, storageFactor: fStore };
}

function analyse(hours, { full = true } = {}) {
  hours = hours.filter(h => Object.values(h.values).reduce((a, b) => a + b, 0) > 0);
  const S = series(hours, lc);
  const dR = diff(S.map(s => s.residual)), dT = diff(S.map(s => s.total)), dE = diff(S.map(s => s.emis));
  const r = ols(dR, dE), rt = ols(dT, dE);
  const { aef, storageFactor } = aefTask1(hours);
  const o = { hours: hours.length, pairs: r.n, MEF: g(r.slope), R2: +r.r2.toFixed(3),
              MEF_total_generation: g(rt.slope), R2_total_generation: +rt.r2.toFixed(3),
              AEF: +aef.toFixed(1), ratio: +(r.slope * 1000 / aef).toFixed(2), storageFactor: Math.round(storageFactor) };
  if (!full) return o;

  const long = hours.length > 1000, L = long ? 168 : 24, block = long ? 168 : 24;
  o.se_newey_west = +(seNeweyWest(dR, r, L) * 1000).toFixed(1);
  const ci = bootstrapCI(dR, dE, block, B);
  o.ci95_block_bootstrap = [g(ci[0]), g(ci[1])];
  o.ci_settings = `block ${block} h, Newey–West ${L} lags, ${B} replications`;

  // median split by residual-load level
  const med = [...S.map(s => s.residual)].sort((a, b) => a - b)[Math.floor(S.length / 2)];
  const hi = [[], []], lo = [[], []];
  for (let i = 1; i < S.length; i++) (S[i].residual > med ? hi : lo).forEach((arr, j) => arr.push(j ? dE[i - 1] : dR[i - 1]));
  o.MEF_low_residual = g(slope(lo[0], lo[1])); o.MEF_high_residual = g(slope(hi[0], hi[1]));

  // operational factors and fossil plants only
  const S2 = series(hours, s2);
  o.MEF_operational = g(slope(dR, diff(S2.map(s => s.emis))));
  const fos = S.map(s => FOSSIL.reduce((a, k) => a + (s.v[k] ?? 0), 0));
  const fosLc = S.map(s => FOSSIL.reduce((a, k) => a + lc(k) * (s.v[k] ?? 0) / 1000, 0));
  const fosS2 = S.map(s => FOSSIL.reduce((a, k) => a + s2(k) * (s.v[k] ?? 0) / 1000, 0));
  o.MEF_fossil_only_lc = g(slope(diff(fos), diff(fosLc)));
  o.MEF_fossil_only_operational = g(slope(diff(fos), diff(fosS2)));

  // decomposition of the response
  const carriers = Object.keys(emissionFactors).filter(k => !VRE.includes(k));
  const dec = {}; let contrib = 0;
  for (const k of carriers) {
    const sh = slope(dR, diff(S.map(s => s.v[k] ?? 0)));
    dec[k] = { share_pct: +(100 * sh).toFixed(1), g_per_kWh_in_MEF: +(sh * lc(k)).toFixed(1) };
    contrib += sh * lc(k);
  }
  const vreContrib = VRE.reduce((a, k) => a + slope(dR, diff(S.map(s => s.v[k] ?? 0))) * lc(k), 0);
  o.decomposition = dec;
  o.wind_solar_artefact = +vreContrib.toFixed(1);
  o.fossil_share_of_response_pct = +FOSSIL.reduce((a, k) => a + dec[k].share_pct, 0).toFixed(1);

  // storage valuation
  const sh = dec[STORAGE].share_pct / 100, without = r.slope * 1000 - sh * lc(STORAGE);
  o.storage_sensitivity = { storage_zero: Math.round(without), fixed_lc_factor: g(r.slope),
                            storage_at_MEF_div_eta: Math.round(without / (1 - sh / ETA)) };

  // Method B
  const cnt = {}; let n = 0;
  for (let i = 1; i < S.length; i++) {
    const d = S[i].residual - S[i - 1].residual;
    const c = METHOD_B.map(k => ({ k, d: (S[i].v[k] ?? 0) - (S[i - 1].v[k] ?? 0) }))
      .filter(x => x.d !== 0 && Math.sign(x.d) === Math.sign(d))
      .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
    if (!c) continue; cnt[c.k] = (cnt[c.k] ?? 0) + 1; n++;
  }
  o.method_B_share_of_hours_pct = Object.fromEntries(Object.entries(cnt).map(([k, v]) => [k, +(100 * v / n).toFixed(1)]));
  o.method_B_hours = n;

  // monthly and weekly
  if (long) {
    const byMonth = {};
    for (const h of hours) (byMonth[h.timestamp.slice(0, 7)] ??= []).push(h);
    o.monthly = Object.fromEntries(Object.entries(byMonth).map(([m, hs]) => {
      const a = analyse(hs, { full: false }); return [m, { MEF: a.MEF, R2: a.R2, AEF: Math.round(a.AEF), ratio: a.ratio }];
    }));
    const weeks = [];
    for (let i = 0; i + 168 <= hours.length; i += 168) {
      const a = analyse(hours.slice(i, i + 168), { full: false }); weeks.push({ start: hours[i].timestamp.slice(0, 10), ...a });
    }
    const m = weeks.map(w => w.MEF).sort((a, b) => a - b), rt2 = weeks.map(w => w.ratio);
    o.weekly = { weeks: weeks.length, MEF_min: m[0], MEF_median: m[Math.floor(m.length / 2)], MEF_max: m.at(-1),
                 ratio_min: Math.min(...rt2), ratio_max: Math.max(...rt2), min_R2: Math.min(...weeks.map(w => w.R2)),
                 weeks_MEF_below_AEF: weeks.filter(w => w.ratio < 1).map(w => w.start) };
  }
  return o;
}

// ---------- main ----------
const hours = await load(`${startArg}T00:00:00Z`, `${endArg}T00:00:00Z`);
const res = { period: `${startArg} to ${endArg} (UTC, end exclusive)`, ...analyse(hours) };
console.log(JSON.stringify(res, null, 2));
if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(res, null, 2));
