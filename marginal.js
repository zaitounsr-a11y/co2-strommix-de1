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

/**
 * Pumpspeicher ist ein Sonderfall. Er ERZEUGT keine Energie, er verschiebt
 * sie. Wenn er auf eine Laststeigerung reagiert, sind die Emissionen bereits
 * frueher entstanden - bei den Kraftwerken, die ihn geladen haben.
 * Ihn als "marginales Kraftwerk" zu zaehlen, ist eine Kategorienverwechslung.
 *
 * Deshalb drei Varianten:
 *   B1  Speicher zaehlt mit eigenem Faktor        (naiv, zum Vergleich)
 *   B2  Speicher ausgeschlossen -> naechstgroesster regelbarer Erzeuger
 *   B3  Speicher zaehlt, aber mit dem MEF der Ladestunden / Wirkungsgrad
 *
 * B3 ist methodisch am saubersten: geladen wird bei niedriger Residuallast,
 * also gilt der dort marginale Faktor, erhoeht um die Zyklusverluste.
 */
const ETA_ZYKLUS = 0.80;

// MEF der Ladestunden ~ MEF im unteren Residuallast-Quartil
const q25 = [...series.map(h => h.residual)].sort((a, b) => a - b)[Math.floor(series.length * 0.25)];
const ladePaare = [];
for (let i = 1; i < series.length; i++) {
  if (series[i].residual <= q25) {
    ladePaare.push([series[i].residual - series[i-1].residual,
                    series[i].emis     - series[i-1].emis]);
  }
}
const mefLade = ladePaare.length > 5 ? regress(ladePaare).slope * 1000 : rR.slope * 1000;
const mefSpeicher = mefLade / ETA_ZYKLUS;

console.log(`\nPumpspeicher, konsequenzielle Bewertung:`);
console.log(`  MEF in den Ladestunden (unteres Quartil): ${mefLade.toFixed(0)} g/kWh`);
console.log(`  / Zykluswirkungsgrad ${ETA_ZYKLUS}            = ${mefSpeicher.toFixed(0)} g/kWh`);
console.log(`  (statt ${emissionFactors['Pumpspeicher']?.lc ?? 0} g/kWh aus der attributionalen Rechnung)\n`);

const rows = [];
const zaehler = {}, zaehlerOhne = {};
let mefB1 = 0, mefB2 = 0, mefB3 = 0, nB2 = 0;

for (let i = 1; i < series.length; i++) {
  const a = series[i - 1], b = series[i];
  const dRes = b.residual - a.residual;

  // alle regelbaren Erzeuger, die sich in Richtung der Residuallast bewegt haben,
  // absteigend nach Betrag der Aenderung
  const kandidaten = DISPATCHABLE
    .map(k => ({ k, d: (b.values[k] ?? 0) - (a.values[k] ?? 0) }))
    .filter(x => Math.sign(x.d) === Math.sign(dRes) && x.d !== 0)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d));

  if (!kandidaten.length) continue;

  const best      = kandidaten[0];
  const bestOhne  = kandidaten.find(x => x.k !== 'Pumpspeicher');

  const fB1 = emissionFactors[best.k]?.lc ?? 0;
  const fB3 = best.k === 'Pumpspeicher' ? mefSpeicher : fB1;

  zaehler[best.k] = (zaehler[best.k] ?? 0) + 1;
  mefB1 += fB1;
  mefB3 += fB3;
  if (bestOhne) {
    zaehlerOhne[bestOhne.k] = (zaehlerOhne[bestOhne.k] ?? 0) + 1;
    mefB2 += emissionFactors[bestOhne.k]?.lc ?? 0;
    nB2++;
  }

  rows.push({
    t: b.t,
    marginal: best.k,
    marginal_ohne_speicher: bestOhne ? bestOhne.k : '',
    deckungsgrad: Math.abs(best.d / dRes),
    mef_traeger: fB3,
    intensity: b.intensity,
  });
}

const gesamt = rows.length;
const zeige = (titel, z, n) => {
  console.log(titel);
  Object.entries(z).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k.padEnd(24)} ${String(v).padStart(3)}  ${(v/n*100).toFixed(0).padStart(3)}%  ${'#'.repeat(Math.round(v/n*40))}`);
  });
};
zeige('Haeufigkeit als marginaler Erzeuger (inkl. Speicher):', zaehler, gesamt);
zeige('\nOhne Speicher - welches Kraftwerk reagiert tatsaechlich:', zaehlerOhne, nB2);

console.log('\n--- MEF nach Verfahren ---');
console.log(`  A   Regression (Residuallast)          ${(rR.slope*1000).toFixed(0).padStart(5)} g/kWh   R2 ${rR.r2.toFixed(3)}`);
console.log(`  B1  Merit-Order, Speicher naiv         ${(mefB1/gesamt).toFixed(0).padStart(5)} g/kWh`);
console.log(`  B2  Merit-Order, Speicher ausgenommen  ${(mefB2/nB2).toFixed(0).padStart(5)} g/kWh`);
console.log(`  B3  Merit-Order, Speicher konsequenz.  ${(mefB3/gesamt).toFixed(0).padStart(5)} g/kWh   <- bevorzugt`);
console.log(`  --  AEF (attributional, Task 1)        ${aef.toFixed(0).padStart(5)} g/kWh`);
console.log(`\n  B3 / AEF = ${(mefB3/gesamt/aef).toFixed(2)}`);

// ---------------------------------------------------------------------------
writeFileSync('reference/marginal_analyse.csv',
  ['timestamp,marginaler_traeger,marginal_ohne_speicher,mef_g_kwh,aef_stunde_g_kwh,deckungsgrad',
   ...rows.map(r => [r.t, r.marginal, r.marginal_ohne_speicher, r.mef_traeger.toFixed(0),
                     r.intensity.toFixed(1), r.deckungsgrad.toFixed(2)].join(','))
  ].join('\n'));
console.log('\nGeschrieben: reference/marginal_analyse.csv');

console.log(`
GRENZEN DIESER ANALYSE
  - Last wird durch Erzeugung angenaehert; Import/Export fehlt. In Stunden,
    in denen der Grenzausgleich ueber die Kuppelstellen laeuft, ist die
    Zuordnung falsch.
  - Verfahren B nimmt genau EINEN marginalen Erzeuger je Stunde an.
    Real reagieren mehrere Anlagen gleichzeitig. Die Regression (A) bildet
    die Gesamtreaktion ab und ist deshalb der belastbarere Wert.
  - Der Speicher-MEF in B3 wird aus dem unteren Residuallast-Quartil
    geschaetzt, nicht aus den tatsaechlichen Ladezeitreihen. Diese liegen
    in ENTSO-E als eigene Verbrauchsreihe vor und koennten ausgewertet
    werden.
  - Must-run (KWK-Waermebedarf, Netzstabilitaet) ist nicht beruecksichtigt.
  - Stunden mit negativen Preisen oder EE-Abregelung muessten getrennt
    behandelt werden: dort verdraengt die naechste kWh Abregelung,
    der marginale Faktor liegt also nahe null.`);
