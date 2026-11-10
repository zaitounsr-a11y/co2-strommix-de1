/**
 * Erweiterung: Abregelung und Stunden mit negativen Preisen
 * ----------------------------------------------------------
 * In Task 2 wurde der marginale Emissionsfaktor ueber alle Stunden gemittelt.
 * Das ist in einer Klasse von Stunden falsch.
 *
 * Wenn Wind und PV mehr einspeisen, als das System aufnehmen kann, wird
 * abgeregelt und der Day-Ahead-Preis faellt unter null. Eine zusaetzlich
 * verbrauchte kWh verdraengt dann KEINE fossile Erzeugung, sondern die
 * Abregelung. Der marginale Faktor liegt in diesen Stunden nahe null.
 * Werden sie mit den uebrigen zusammengefasst, wird der MEF ueberschaetzt.
 *
 * Diese Auswertung trennt die Regime und rechnet sie getrennt.
 *
 * REGIME
 *   Ueberschuss   Preis < 0 EUR/MWh   -> Abregelung wahrscheinlich
 *   Knapp         0 <= Preis < 20     -> Uebergangsbereich
 *   Normal        Preis >= 20         -> fossile Erzeugung ist marginal
 *
 * Der Preis ist ein Indikator fuer Abregelung, keine Messung. Die tatsaechlich
 * abgeregelte Menge wird von ENTSO-E nur unvollstaendig veroeffentlicht.
 *
 * Aufruf:  node curtailment.js 2024-01-01 2024-12-31
 *          (kurze Zeitraeume enthalten zu wenige Ueberschussstunden)
 */

import { writeFileSync } from 'fs';
import { emissionFactors } from './emissionFactors.js';

const PROXY = 'http://localhost:3000';
const VRE = ['Wind Onshore', 'Wind Offshore', 'Photovoltaik'];

const GRENZE_UEBERSCHUSS = 0;    // EUR/MWh
const GRENZE_KNAPP       = 20;   // EUR/MWh
const MIN_PAARE          = 15;   // unter dieser Zahl wird keine Regression berichtet

const [, , startArg, endArg] = process.argv;
if (!startArg || !endArg) {
  console.error('Aufruf: node curtailment.js <start YYYY-MM-DD> <end YYYY-MM-DD>');
  process.exit(1);
}
const start = `${startArg}T00:00:00Z`, end = `${endArg}T00:00:00Z`;

const hole = async (pfad) => {
  const r = await fetch(`${PROXY}${pfad}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return j;
};

console.log('Erzeugung ...');
const gen = await hole(`/api/generation?start=${start}&end=${end}`);
console.log(`  ${gen.length} Stunden`);

console.log('Day-Ahead-Preise ...');
const preise = await hole(`/api/prices?start=${start}&end=${end}`);
const preisMap = new Map(preise.map(p => [p.timestamp, p.price]));
console.log(`  ${preise.length} Stunden\n`);

// ---------------------------------------------------------------------------
function regress(p) {
  const n = p.length;
  if (n < 2) return { slope: NaN, r2: NaN, n };
  const mx = p.reduce((s, q) => s + q[0], 0) / n;
  const my = p.reduce((s, q) => s + q[1], 0) / n;
  const sxx = p.reduce((s, q) => s + (q[0] - mx) ** 2, 0);
  if (sxx === 0) return { slope: NaN, r2: NaN, n };
  const b = p.reduce((s, q) => s + (q[0] - mx) * (q[1] - my), 0) / sxx;
  const a = my - b * mx;
  const st = p.reduce((s, q) => s + (q[1] - my) ** 2, 0);
  const sr = p.reduce((s, q) => s + (q[1] - (b * q[0] + a)) ** 2, 0);
  return { slope: b, r2: st > 0 ? 1 - sr / st : NaN, n };
}

const S = gen.map(h => {
  const total = Object.values(h.values).reduce((s, v) => s + v, 0);
  const vre = VRE.reduce((s, k) => s + (h.values[k] ?? 0), 0);
  let e = 0;
  for (const [k, v] of Object.entries(h.values)) e += (emissionFactors[k]?.lc ?? 0) * v / 1000;
  return {
    t: h.timestamp, total, vre, res: total - vre, e,
    intensity: e * 1000 / total,
    vreAnteil: vre / total,
    preis: preisMap.get(h.timestamp),
  };
}).filter(h => h.preis !== undefined);

if (!S.length) { console.error('Keine Stunden mit Preis- UND Erzeugungsdaten.'); process.exit(1); }

const regimeVon = p => p < GRENZE_UEBERSCHUSS ? 'Ueberschuss'
                     : p < GRENZE_KNAPP       ? 'Knapp' : 'Normal';

// --- Stundenuebergaenge klassifizieren -------------------------------------
const paare = { Ueberschuss: [], Knapp: [], Normal: [], Alle: [] };
for (let i = 1; i < S.length; i++) {
  const a = S[i - 1], b = S[i];
  if (new Date(b.t) - new Date(a.t) !== 3600e3) continue;      // Luecke
  const p = [b.res - a.res, b.e - a.e];
  paare.Alle.push(p);
  paare[regimeVon((a.preis + b.preis) / 2)].push(p);
}

// --- Verteilung ------------------------------------------------------------
const zaehl = { Ueberschuss: 0, Knapp: 0, Normal: 0 };
S.forEach(h => zaehl[regimeVon(h.preis)]++);
const mit = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;

console.log('=== VERTEILUNG DER STUNDEN ===\n');
console.log('  Regime         Stunden   Anteil   Mittel AEF   Mittel EE-Anteil   Mittel Preis');
for (const r of ['Ueberschuss', 'Knapp', 'Normal']) {
  const h = S.filter(x => regimeVon(x.preis) === r);
  if (!h.length) { console.log(`  ${r.padEnd(13)} ${'0'.padStart(7)}`); continue; }
  console.log(`  ${r.padEnd(13)} ${h.length.toString().padStart(7)}` +
    ` ${(h.length / S.length * 100).toFixed(1).padStart(7)} %` +
    ` ${mit(h.map(x => x.intensity)).toFixed(0).padStart(11)}` +
    ` ${(mit(h.map(x => x.vreAnteil)) * 100).toFixed(0).padStart(17)} %` +
    ` ${mit(h.map(x => x.preis)).toFixed(1).padStart(14)}`);
}

// --- MEF je Regime ---------------------------------------------------------
console.log('\n=== MARGINALER FAKTOR JE REGIME ===\n');
console.log('  Regime         Paare      MEF        R2');
const erg = {};
for (const r of ['Ueberschuss', 'Knapp', 'Normal', 'Alle']) {
  const p = paare[r];
  if (p.length < MIN_PAARE) {
    console.log(`  ${r.padEnd(13)} ${p.length.toString().padStart(6)}      \u2014         \u2014   (zu wenige)`);
    continue;
  }
  const g = regress(p);
  erg[r] = g;
  console.log(`  ${r.padEnd(13)} ${g.n.toString().padStart(6)}` +
    ` ${(g.slope * 1000).toFixed(0).padStart(8)} g/kWh` +
    ` ${g.r2.toFixed(3).padStart(9)}`);
}

if (erg.Normal && erg.Alle) {
  const d = (erg.Normal.slope - erg.Alle.slope) * 1000;
  console.log(`\n  Normal gegen Alle: ${(d >= 0 ? '+' : '')}${d.toFixed(0)} g/kWh`);
  console.log('  Positiv bedeutet: der ungetrennte MEF aus Task 2 unterschaetzt');
  console.log('  den Faktor in normalen Stunden, weil Ueberschussstunden ihn druecken.');
}
if (erg.Ueberschuss) {
  console.log(`\n  MEF in Ueberschussstunden: ${(erg.Ueberschuss.slope * 1000).toFixed(0)} g/kWh`);
  console.log('  Erwartung nahe null: die zusaetzliche kWh verdraengt Abregelung,');
  console.log('  nicht fossile Erzeugung. Ein deutlich positiver Wert wuerde bedeuten,');
  console.log('  dass der Preis hier kein guter Indikator fuer Abregelung ist.');
}

// ---------------------------------------------------------------------------
// A) Schwellensensitivitaet
//    Die Grenze fuer "Knapp" ist gesetzt, nicht hergeleitet. Wenn der MEF
//    der Ueberschussstunden stark von ihr abhaengt, sind die Regime ein
//    Artefakt der Schwelle und keine reale Struktur.
// ---------------------------------------------------------------------------
console.log('\n=== A) SENSITIVITAET DER SCHWELLEN ===\n');
console.log('  Ueberschuss-Grenze   Stunden   Paare        MEF        R2');
for (const g of [-50, -20, -10, -5, 0, 5, 10]) {
  const p = [];
  for (let i = 1; i < S.length; i++) {
    const a = S[i - 1], b = S[i];
    if (new Date(b.t) - new Date(a.t) !== 3600e3) continue;
    if ((a.preis + b.preis) / 2 < g) p.push([b.res - a.res, b.e - a.e]);
  }
  const n = S.filter(h => h.preis < g).length;
  if (p.length < MIN_PAARE) {
    console.log(`  < ${String(g).padStart(4)} EUR/MWh ${n.toString().padStart(13)} ${p.length.toString().padStart(7)}        \u2014         \u2014`);
    continue;
  }
  const r = regress(p);
  console.log(`  < ${String(g).padStart(4)} EUR/MWh ${n.toString().padStart(13)} ${r.n.toString().padStart(7)}` +
    ` ${(r.slope * 1000).toFixed(0).padStart(10)} g/kWh ${r.r2.toFixed(3).padStart(9)}`);
}
console.log('\n  Bleibt der MEF ueber die Schwellen hinweg aehnlich, ist die Trennung');
console.log('  robust. Faellt er zu strengeren Schwellen hin deutlich, deutet das');
console.log('  darauf hin, dass erst tief negative Preise echte Abregelung anzeigen.');

// ---------------------------------------------------------------------------
// B) Was laeuft in den Ueberschussstunden?
//    Wenn der marginale Faktor dort nicht nahe null liegt, muss etwas
//    Fossiles weiterlaufen. Must-run (KWK-Waermebedarf, Netzstabilitaet)
//    ist die naheliegende Erklaerung und laesst sich direkt nachsehen.
// ---------------------------------------------------------------------------
const REGELBAR = ['Braunkohle', 'Steinkohle', 'Erdgas', 'Sonstige Konventionelle', 'Biomasse'];
const idxVon = new Map(gen.map((h, i) => [h.timestamp, i]));

const mittelMix = (filter) => {
  const hs = S.filter(filter).map(h => gen[idxVon.get(h.t)]).filter(Boolean);
  if (!hs.length) return null;
  const acc = {};
  for (const h of hs) for (const [k, v] of Object.entries(h.values)) acc[k] = (acc[k] ?? 0) + v;
  for (const k of Object.keys(acc)) acc[k] /= hs.length;
  return { n: hs.length, acc };
};

const ueber = mittelMix(h => regimeVon(h.preis) === 'Ueberschuss');
const norm  = mittelMix(h => regimeVon(h.preis) === 'Normal');

console.log('\n=== B) ERZEUGUNG IN UEBERSCHUSSSTUNDEN ===\n');
if (ueber && norm) {
  console.log(`  Mittelwerte ueber ${ueber.n} Ueberschuss- und ${norm.n} Normalstunden\n`);
  console.log('  Traeger                  Ueberschuss      Normal    Rueckgang');
  let restFossil = 0;
  for (const k of REGELBAR) {
    const u = ueber.acc[k] ?? 0, nn = norm.acc[k] ?? 0;
    if (u === 0 && nn === 0) continue;
    if (k !== 'Biomasse') restFossil += u;
    const rueck = nn > 0 ? (1 - u / nn) * 100 : 0;
    console.log(`  ${k.padEnd(24)} ${Math.round(u).toString().padStart(8)} MWh` +
      ` ${Math.round(nn).toString().padStart(10)} MWh ${rueck.toFixed(0).padStart(9)} %`);
  }
  const uTot = Object.values(ueber.acc).reduce((a, b) => a + b, 0);
  console.log(`\n  Fossile Restleistung in Ueberschussstunden: ${Math.round(restFossil)} MWh/h`);
  console.log(`  Anteil an der Erzeugung dieser Stunden    : ${(restFossil / uTot * 100).toFixed(1)} %`);
  console.log('\n  Bleibt hier nennenswert Fossiles am Netz, ist Must-run die plausible');
  console.log('  Erklaerung dafuer, dass der marginale Faktor nicht nahe null liegt:');
  console.log('  KWK-Anlagen folgen dem Waermebedarf, weitere Bloecke laufen aus');
  console.log('  Netzstabilitaetsgruenden. Diese Anlagen reagieren weiter auf');
  console.log('  Lastaenderungen, obwohl der Preis negativ ist.');
} else {
  console.log('  Zu wenige Stunden fuer einen Vergleich.');
}

// --- Preis gegen Emissionsintensitaet (nach Fleschutz et al.) ---------------
const rang = a => { const s = [...a].map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = new Array(a.length); s.forEach(([, i], k) => r[i] = k + 1); return r; };
const spearman = (x, y) => {
  const rx = rang(x), ry = rang(y), n = x.length;
  const mx = (n + 1) / 2;
  const num = rx.reduce((s, v, i) => s + (v - mx) * (ry[i] - mx), 0);
  const den = Math.sqrt(rx.reduce((s, v) => s + (v - mx) ** 2, 0) *
                        ry.reduce((s, v) => s + (v - mx) ** 2, 0));
  return num / den;
};
const rho = spearman(S.map(h => h.preis), S.map(h => h.intensity));
console.log('\n=== PREIS UND EMISSIONSINTENSITAET ===\n');
console.log(`  Spearman-Korrelation Preis / AEF : ${rho.toFixed(3)}`);
console.log('  Fleschutz et al. (2021) zeigen, dass preisbasierte Lastverschiebung');
console.log('  die Emissionen erhoehen kann, wenn Preis und Emissionsintensitaet');
console.log('  entlang der Merit-Order nicht korrelieren. Sie beziffern den fuer');
console.log('  Deutschland noetigen CO2-Preis zur Entkopplung auf 42,6 EUR/t (2019).');
console.log('');
console.log('  ACHTUNG BEIM VERGLEICH: Fleschutz et al. berichten fuer den XEF');
console.log('  (Durchschnittsfaktor) gegen den Preis Werte zwischen 0,62 und 0,88');
console.log('  fuer Deutschland - hier wird derselbe Zusammenhang gemessen.');
console.log('  Ihre NEGATIVEN Korrelationen (-0,16 bis -0,42) beziehen sich auf');
console.log('  den MEF, nicht auf den Durchschnitt. Kein Widerspruch.');

// ---------------------------------------------------------------------------
writeFileSync('reference/abregelung_analyse.csv',
  ['timestamp,preis_eur_mwh,regime,aef_g_kwh,residuallast_MWh,ee_anteil',
   ...S.map(h => [h.t, h.preis.toFixed(2), regimeVon(h.preis), h.intensity.toFixed(1),
     Math.round(h.res), (h.vreAnteil * 100).toFixed(1)].join(','))].join('\n'));
console.log('\nGeschrieben: reference/abregelung_analyse.csv');

console.log(`
GRENZEN
  - Der negative Preis ist ein Indikator fuer Abregelung, keine Messung.
    Tatsaechliche Abregelungsmengen veroeffentlicht ENTSO-E nur luecken-
    haft; die Bundesnetzagentur weist sie im Monitoringbericht aus.
  - Die Schwelle von 20 EUR/MWh fuer das Regime "Knapp" ist gesetzt, nicht
    hergeleitet. Sie sollte variiert werden.
  - Kurze Zeitraeume enthalten zu wenige Ueberschussstunden. Fuer belast-
    bare Aussagen wird ein volles Jahr benoetigt.`);
