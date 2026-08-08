/**
 * Task 2 — Marginaler Emissionsfaktor (MEF)
 * ------------------------------------------
 * Attributional (Task 1): "Wie viel CO2 steckt im DURCHSCHNITT in einer kWh?"
 * Consequential (Task 2): "Wie viel CO2 verursacht die NAECHSTE kWh?"
 *
 * Zwei Verfahren, beide auf denselben Stundendaten:
 *
 *   A) Regression nach Hawkes (2010)
 *      Steigung von d(Emissionen) gegen d(Residuallast) zwischen
 *      aufeinanderfolgenden Stunden. Die Steigung IST der MEF.
 *
 *   B) Merit-Order-Zuordnung
 *      Welcher Erzeuger hat sich in derselben Richtung am staerksten
 *      bewegt? Der ist in dieser Stunde der marginale.
 *
 * WICHTIG: Regression auf die GESAMTerzeugung liefert Unsinn (R2 ~ 0),
 * weil Erzeugung vor allem mit der Sonne steigt und PV emissionsfrei ist.
 * Massgeblich ist die RESIDUALLAST = Last minus dargebotsabhaengige EE.
 *
 * Aufruf:  node marginal.js 2024-06-10 2024-06-17
 */

import { readFileSync, writeFileSync } from 'fs';
import { emissionFactors } from './emissionFactors.js';

const PROXY = 'http://localhost:3000';

// Dargebotsabhaengig: laeuft, wenn Wind weht / Sonne scheint. Nie marginal.
const VRE = ['Wind Onshore', 'Wind Offshore', 'Photovoltaik'];
// Regelbar: kommen als marginale Erzeuger in Frage.
const DISPATCHABLE = ['Braunkohle', 'Steinkohle', 'Erdgas',
                      'Sonstige Konventionelle', 'Pumpspeicher', 'Biomasse'];

const [, , startArg, endArg] = process.argv;
if (!startArg || !endArg) {
  console.error('Aufruf: node marginal.js <start YYYY-MM-DD> <end YYYY-MM-DD>');
  process.exit(1);
}

const resp = await fetch(
  `${PROXY}/api/generation?start=${startArg}T00:00:00Z&end=${endArg}T00:00:00Z`);
if (!resp.ok) { console.error('Proxy-Fehler. Laeuft der Server?'); process.exit(1); }
const hours = await resp.json();
console.log(`${hours.length} Stunden geladen.\n`);

// ---------------------------------------------------------------------------
// Kennzahlen je Stunde
// ---------------------------------------------------------------------------
const sum = (v, keys) => keys.reduce((s, k) => s + (v[k] ?? 0), 0);

const series = hours.map(h => {
  const total = Object.values(h.values).reduce((s, v) => s + v, 0);
  const vre   = sum(h.values, VRE);
  let emis = 0;
  for (const [k, mwh] of Object.entries(h.values)) {
    emis += (emissionFactors[k]?.lc ?? 0) * mwh / 1000;   // t CO2eq
  }
  return {
    t: h.timestamp,
    total,
    vre,
    residual: total - vre,          // Naeherung: Last ~ Erzeugung (ohne Handel)
    emis,
    intensity: emis * 1000 / total,
    values: h.values,
  };
});

// ---------------------------------------------------------------------------
// A) Regression
// ---------------------------------------------------------------------------
function regress(pairs) {
  const n = pairs.length;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  const sxy = pairs.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  const sxx = pairs.reduce((s, p) => s + (p[0] - mx) ** 2, 0);
  const slope = sxy / sxx;
  const inter = my - slope * mx;
  const ssTot = pairs.reduce((s, p) => s + (p[1] - my) ** 2, 0);
  const ssRes = pairs.reduce((s, p) => s + (p[1] - (slope * p[0] + inter)) ** 2, 0);
  return { slope, r2: 1 - ssRes / ssTot, n };
}

const dTotal    = [], dResidual = [];
for (let i = 1; i < series.length; i++) {
  const a = series[i - 1], b = series[i];
  dTotal.push(   [b.total    - a.total,    b.emis - a.emis]);
  dResidual.push([b.residual - a.residual, b.emis - a.emis]);
}

const rT = regress(dTotal);
const rR = regress(dResidual);
const aef = series.reduce((s, h) => s + h.intensity, 0) / series.length;

console.log('=== A) REGRESSION ===\n');
console.log('Bezugsgroesse        MEF [g/kWh]     R2');
console.log(`Gesamterzeugung   ${(rT.slope * 1000).toFixed(0).padStart(10)}  ${rT.r2.toFixed(3).padStart(8)}   <- irrefuehrend`);
console.log(`Residuallast      ${(rR.slope * 1000).toFixed(0).padStart(10)}  ${rR.r2.toFixed(3).padStart(8)}   <- aussagekraeftig`);
console.log(`\nAEF (attributional, Task 1): ${aef.toFixed(0)} g/kWh`);
console.log(`MEF / AEF: ${(rR.slope * 1000 / aef).toFixed(2)}`);
console.log('\nEin Verhaeltnis > 1 bedeutet: die naechste kWh ist schmutziger');
console.log('als der Durchschnitt. Genau das ist der Unterschied zwischen');
console.log('attributional und consequential.');

// nach Netzzustand getrennt
const med = [...series.map(h => h.residual)].sort((a, b) => a - b)[Math.floor(series.length / 2)];
const hi = [], lo = [];
for (let i = 1; i < series.length; i++) {
  const p = [series[i].residual - series[i-1].residual, series[i].emis - series[i-1].emis];
  (series[i].residual > med ? hi : lo).push(p);
}
const rHi = regress(hi), rLo = regress(lo);
console.log('\nNach Residuallast getrennt:');
console.log(`  hohe Residuallast : ${(rHi.slope*1000).toFixed(0).padStart(5)} g/kWh  (R2 ${rHi.r2.toFixed(2)}, n=${rHi.n})`);
console.log(`  tiefe Residuallast: ${(rLo.slope*1000).toFixed(0).padStart(5)} g/kWh  (R2 ${rLo.r2.toFixed(2)}, n=${rLo.n})`);

// ---------------------------------------------------------------------------
// B) Merit-Order-Zuordnung: wer bewegt sich mit der Residuallast?
// ---------------------------------------------------------------------------
console.log('\n\n=== B) MARGINALER ERZEUGER JE STUNDE ===\n');

const rows = [];
const zaehler = {};
for (let i = 1; i < series.length; i++) {
  const a = series[i - 1], b = series[i];
  const dRes = b.residual - a.residual;

  // Wer hat sich am staerksten IN RICHTUNG der Residuallastaenderung bewegt?
  let best = null, bestDelta = 0;
  for (const k of DISPATCHABLE) {
    const d = (b.values[k] ?? 0) - (a.values[k] ?? 0);
    if (Math.sign(d) === Math.sign(dRes) && Math.abs(d) > Math.abs(bestDelta)) {
      best = k; bestDelta = d;
    }
  }
  if (!best) continue;

  zaehler[best] = (zaehler[best] ?? 0) + 1;
  rows.push({
    t: b.t, marginal: best,
    deckungsgrad: Math.abs(bestDelta / dRes),
    mef_traeger: emissionFactors[best]?.lc ?? 0,
    intensity: b.intensity,
  });
}

const gesamt = rows.length;
console.log('Haeufigkeit als marginaler Erzeuger:');
Object.entries(zaehler).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
  const bar = '#'.repeat(Math.round(v / gesamt * 40));
  console.log(`  ${k.padEnd(24)} ${String(v).padStart(3)}  ${(v/gesamt*100).toFixed(0).padStart(3)}%  ${bar}`);
});

const mefMerit = rows.reduce((s, r) => s + r.mef_traeger, 0) / gesamt;
console.log(`\nMittlerer MEF ueber die marginalen Traeger: ${mefMerit.toFixed(0)} g/kWh`);
console.log(`Zum Vergleich Regression (Residuallast):    ${(rR.slope*1000).toFixed(0)} g/kWh`);
console.log(`Zum Vergleich AEF (Task 1):                 ${aef.toFixed(0)} g/kWh`);

// ---------------------------------------------------------------------------
writeFileSync('reference/marginal_analyse.csv',
  ['timestamp,marginaler_traeger,mef_traeger_g_kwh,aef_stunde_g_kwh,deckungsgrad',
   ...rows.map(r => [r.t, r.marginal, r.mef_traeger.toFixed(0),
                     r.intensity.toFixed(1), r.deckungsgrad.toFixed(2)].join(','))
  ].join('\n'));
console.log('\nGeschrieben: reference/marginal_analyse.csv');

console.log(`
GRENZEN DIESER ANALYSE
  - Last wird durch Erzeugung angenaehert; Import/Export fehlt. In Stunden,
    in denen der Grenzausgleich ueber die Kuppelstellen laeuft, ist die
    Zuordnung falsch.
  - Verfahren B nimmt genau EINEN marginalen Erzeuger je Stunde an.
    Real reagieren mehrere Anlagen gleichzeitig.
  - Must-run (KWK-Waermebedarf, Netzstabilitaet) ist nicht beruecksichtigt.
  - Stunden mit negativen Preisen oder EE-Abregelung muessten getrennt
    behandelt werden: dort verdraengt die naechste kWh Abregelung,
    der marginale Faktor liegt also nahe null.`);
