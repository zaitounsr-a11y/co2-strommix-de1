/**
 * Validierung: eigene Berechnung vs. Green Grid Compass
 * -----------------------------------------------------
 * Liest die eigene Ergebnis-CSV und die GGC-Exporte aus /reference/,
 * gleicht sie stundenweise ab und schreibt eine Vergleichstabelle.
 *
 * Aufruf:
 *   node compare.js
 *
 * Erwartete Dateien in reference/:
 *   eigene_berechnung_2024-06-10_bis_2024-06-17.csv
 *   ggc_intensity_lifecycle_2024-06.csv
 *   ggc_powermix_2024-06.csv        (optional, fuer Faktor-Rueckrechnung)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const DIR = 'reference';
const OWN  = `${DIR}/eigene_berechnung_2024-06-10_bis_2024-06-17.csv`;
const GGC  = `${DIR}/ggc_intensity_lifecycle_2024-06.csv`;
const MIX  = `${DIR}/ggc_powermix_2024-06.csv`;

// ---------------------------------------------------------------------------
// CSV-Parser. GGC nutzt Semikolon, unsere Datei Komma.
// ---------------------------------------------------------------------------
function parseCSV(path, sep) {
  const lines = readFileSync(path, 'utf8').trim().split(/\r?\n/);
  const head = lines[0].split(sep).map(s => s.trim());
  return lines.slice(1).map(l => {
    const cells = l.split(sep);
    return Object.fromEntries(head.map((h, i) => [h, cells[i]?.trim()]));
  });
}

/**
 * GGC-Exporte sind inkonsistent: Kopfzeile mit Semikolon, Datenzeilen
 * teils mit Komma, teils gemischt. Deshalb auf BEIDE Zeichen trennen.
 * Unsere eigene Datei enthaelt keine Semikolons -> unproblematisch.
 */
function parseGGC(path) {
  return parseCSV(path, /[;,]/);
}

/**
 * GGC-Datum: "10/06 00:00 UTC" (Tag/Monat, Jahr fehlt!)
 * -> auf ISO bringen. Jahr wird aus unserer Datei uebernommen.
 */
function ggcDateToISO(s, year) {
  const m = s.match(/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, day, month, hh, mm] = m;
  return `${year}-${month}-${day}T${hh}:${mm}:00.000Z`;
}

// ---------------------------------------------------------------------------
const own = parseCSV(OWN, ',');
const year = own[0].timestamp.slice(0, 4);
console.log(`Eigene Berechnung: ${own.length} Stunden, Jahr ${year}`);

const ggcRaw = parseGGC(GGC);
const ggc = new Map();
for (const r of ggcRaw) {
  const iso = ggcDateToISO(r.Date, year);
  const val = parseFloat(r['CO2 Intensity']);
  if (iso && isFinite(val)) ggc.set(iso, val);
}
console.log(`GGC-Intensitaet:   ${ggc.size} Stunden\n`);

// ---------------------------------------------------------------------------
// Abgleich
// ---------------------------------------------------------------------------
const rows = [];
for (const o of own) {
  const g = ggc.get(o.timestamp);
  if (g === undefined) continue;

  const mine = parseFloat(o.intensity_lc);
  if (!isFinite(mine)) continue;

  rows.push({
    timestamp: o.timestamp,
    eigen_lc:  mine,
    eigen_s2:  parseFloat(o.intensity_scope2),
    ggc_lc:    g,
    diff:      mine - g,
    diff_pct:  ((mine - g) / g) * 100,
  });
}

if (!rows.length) {
  console.error('Keine gemeinsamen Stunden gefunden.');
  console.error('Pruefe Zeitstempel-Format in beiden Dateien.');
  console.error('  eigen:', own[0]?.timestamp);
  console.error('  GGC:  ', ggcRaw[0]?.Date);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Kennzahlen
// ---------------------------------------------------------------------------
const n     = rows.length;
const mean  = a => a.reduce((x, y) => x + y, 0) / a.length;
const mEig  = mean(rows.map(r => r.eigen_lc));
const mGGC  = mean(rows.map(r => r.ggc_lc));
const mBias = mean(rows.map(r => r.diff));
const mAbs  = mean(rows.map(r => Math.abs(r.diff)));
const mPct  = mean(rows.map(r => Math.abs(r.diff_pct)));
const rmse  = Math.sqrt(mean(rows.map(r => r.diff ** 2)));

// Korrelation: bildet die Kurve die richtige FORM ab?
const dE = rows.map(r => r.eigen_lc - mEig);
const dG = rows.map(r => r.ggc_lc  - mGGC);
const corr = dE.reduce((s, v, i) => s + v * dG[i], 0) /
             Math.sqrt(dE.reduce((s, v) => s + v * v, 0) * dG.reduce((s, v) => s + v * v, 0));

const sorted = [...rows].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

console.log('=== VERGLEICH EIGENE BERECHNUNG vs. GGC (Lifecycle) ===\n');
console.log(`Verglichene Stunden:        ${n}`);
console.log(`Mittelwert eigen:           ${mEig.toFixed(1)} g/kWh`);
console.log(`Mittelwert GGC:             ${mGGC.toFixed(1)} g/kWh`);
console.log(`Mittlere Abweichung (Bias): ${mBias >= 0 ? '+' : ''}${mBias.toFixed(1)} g/kWh` +
            `  (${((mEig - mGGC) / mGGC * 100).toFixed(1)} %)`);
console.log(`Mittlerer Absolutfehler:    ${mAbs.toFixed(1)} g/kWh  (${mPct.toFixed(1)} %)`);
console.log(`RMSE:                       ${rmse.toFixed(1)} g/kWh`);
console.log(`Korrelation:                ${corr.toFixed(4)}`);

console.log('\nGroesste Abweichungen:');
console.log('  Zeitstempel               eigen     GGC     Diff       %');
for (const r of sorted.slice(0, 5)) {
  console.log(`  ${r.timestamp.slice(0, 16)}  ${r.eigen_lc.toFixed(0).padStart(7)}` +
              ` ${r.ggc_lc.toFixed(0).padStart(7)} ${(r.diff >= 0 ? '+' : '') + r.diff.toFixed(0).padStart(7)}` +
              ` ${(r.diff_pct >= 0 ? '+' : '') + r.diff_pct.toFixed(1).padStart(6)}`);
}

console.log('\nBeste Uebereinstimmung:');
for (const r of sorted.slice(-3).reverse()) {
  console.log(`  ${r.timestamp.slice(0, 16)}  ${r.eigen_lc.toFixed(0).padStart(7)}` +
              ` ${r.ggc_lc.toFixed(0).padStart(7)} ${(r.diff >= 0 ? '+' : '') + r.diff.toFixed(0).padStart(7)}` +
              ` ${(r.diff_pct >= 0 ? '+' : '') + r.diff_pct.toFixed(1).padStart(6)}`);
}

// Systematisch oder zufaellig?
const hoch = rows.filter(r => r.ggc_lc > mGGC);
const tief = rows.filter(r => r.ggc_lc <= mGGC);
console.log('\nAbweichung nach Netzzustand:');
console.log(`  emissionsreiche Stunden (GGC > Mittel): ${mean(hoch.map(r => r.diff_pct)).toFixed(1)} %  (n=${hoch.length})`);
console.log(`  emissionsarme Stunden   (GGC <= Mittel): ${mean(tief.map(r => r.diff_pct)).toFixed(1)} %  (n=${tief.length})`);

// ---------------------------------------------------------------------------
// Rueckgerechnete GGC-Emissionsfaktoren (optional)
// ---------------------------------------------------------------------------
if (existsSync(MIX)) {
  const mixRaw = parseGGC(MIX);
  const emiRaw = ggcRaw;

  const TRAEGER = ['Lignite', 'Coal', 'Gas', 'Other Fossil', 'Hydro',
                   'Wind', 'Solar', 'Biomass', 'Other Renewables'];
  const sumGen = {}, sumEmi = {};
  for (const t of TRAEGER) { sumGen[t] = 0; sumEmi[t] = 0; }

  const mixByDate = new Map(mixRaw.map(r => [r.Date, r]));
  for (const e of emiRaw) {
    const m = mixByDate.get(e.Date);
    if (!m) continue;
    for (const t of TRAEGER) {
      const gv = parseFloat(m[t]), ev = parseFloat(e[t]);
      if (isFinite(gv) && isFinite(ev)) { sumGen[t] += gv; sumEmi[t] += ev; }
    }
  }

  console.log('\n=== GGC-EMISSIONSFAKTOREN (aus den Daten zurueckgerechnet) ===');
  console.log('  Traeger              GGC g/kWh');
  for (const t of TRAEGER) {
    if (sumGen[t] > 0) {
      console.log(`  ${t.padEnd(20)} ${(sumEmi[t] / sumGen[t] * 1000).toFixed(0).padStart(9)}`);
    }
  }
  console.log('  -> mit den Werten in emissionFactors.js vergleichen');
}

// ---------------------------------------------------------------------------
const header = 'timestamp,eigen_lc,eigen_scope2,ggc_lc,diff_g_kwh,diff_prozent';
const csv = [header, ...rows.map(r =>
  [r.timestamp, r.eigen_lc.toFixed(1), r.eigen_s2.toFixed(1),
   r.ggc_lc.toFixed(1), r.diff.toFixed(1), r.diff_pct.toFixed(2)].join(',')
)].join('\n');

writeFileSync(`${DIR}/vergleich_eigen_vs_ggc.csv`, csv);
console.log(`\nGeschrieben: ${DIR}/vergleich_eigen_vs_ggc.csv`);
