/**
 * Erste eigene CO2-Intensitaetskurve
 * -----------------------------------
 * Holt die Erzeugungsdaten vom lokalen Proxy, rechnet mit unseren
 * Emissionsfaktoren und schreibt das Ergebnis als CSV.
 *
 * Voraussetzung: server.js laeuft (npm start in einem zweiten Terminal).
 *
 * Aufruf:
 *   node calcCurve.js 2026-07-13 2026-07-20
 */

import { writeFileSync } from 'fs';
import { calculateIntensity, calculateIntensityWithStorage,
         emissionFactors, getScope3 } from './emissionFactors.js';

const PROXY = 'http://localhost:3000';

const [, , startArg, endArg] = process.argv;
if (!startArg || !endArg) {
  console.error('Aufruf: node calcCurve.js <start YYYY-MM-DD> <end YYYY-MM-DD>');
  process.exit(1);
}

const start = `${startArg}T00:00:00Z`;
const end   = `${endArg}T00:00:00Z`;

console.log(`Lade Erzeugungsdaten ${startArg} bis ${endArg} ...`);

const resp = await fetch(`${PROXY}/api/generation?start=${start}&end=${end}`);
if (!resp.ok) {
  console.error(`Proxy-Fehler ${resp.status}:`, await resp.text());
  console.error('Laeuft der Server? -> npm start');
  process.exit(1);
}

const hours = await resp.json();
console.log(`${hours.length} Stunden empfangen.\n`);

if (!hours.length) {
  console.error('Keine Daten. Pruefe Zeitraum und Domain-Code.');
  process.exit(1);
}

// --- Sanity-Check: welche Traeger kommen vor, fehlt ein Faktor? -----------
const seen = new Set();
hours.forEach(h => Object.keys(h.values).forEach(k => seen.add(k)));
const missing = [...seen].filter(k => !emissionFactors[k]);
console.log('Energietraeger in den Daten:', [...seen].join(', '));
if (missing.length) {
  console.warn('FEHLENDE FAKTOREN:', missing.join(', '));
}

// --- Rechnung (Zwei-Pass, mit dynamisch bewertetem Pumpspeicher) ---------
const s2All = calculateIntensityWithStorage(hours, 'scope2');
const lcAll = calculateIntensityWithStorage(hours, 'lc');

console.log('\nPumpspeicher-Bewertung:');
console.log(`  mittlere Ladeintensitaet (Scope 2): ${s2All.mittlereLadeintensitaet.toFixed(1)} g/kWh`);
console.log(`  -> Entladefaktor Scope 2:           ${s2All.speicherFaktor.toFixed(1)} g/kWh`);
console.log(`  mittlere Ladeintensitaet (LC):      ${lcAll.mittlereLadeintensitaet.toFixed(1)} g/kWh`);
console.log(`  -> Entladefaktor LC:                ${lcAll.speicherFaktor.toFixed(1)} g/kWh`);

const rows = hours.map((h, i) => ({
  timestamp:          h.timestamp,
  generation_MWh:     Math.round(lcAll.rows[i].totalMWh),
  intensity_scope2:   s2All.rows[i].intensity !== null ? +s2All.rows[i].intensity.toFixed(1) : '',
  intensity_lc:       lcAll.rows[i].intensity !== null ? +lcAll.rows[i].intensity.toFixed(1) : '',
  emissions_scope2_t: Math.round(s2All.rows[i].totalTons),
  emissions_lc_t:     Math.round(lcAll.rows[i].totalTons),
}));

// --- Ausgabe -------------------------------------------------------------
const valid = rows.filter(r => r.intensity_lc !== '');
const avgS2 = valid.reduce((a, r) => a + r.intensity_scope2, 0) / valid.length;
const avgLC = valid.reduce((a, r) => a + r.intensity_lc, 0) / valid.length;
const minLC = Math.min(...valid.map(r => r.intensity_lc));
const maxLC = Math.max(...valid.map(r => r.intensity_lc));

console.log('\n--- Ergebnis ---');
console.log(`Mittel Scope 2:   ${avgS2.toFixed(1)} g/kWh`);
console.log(`Mittel Lifecycle: ${avgLC.toFixed(1)} g/kWh`);
console.log(`Spanne LC:        ${minLC.toFixed(0)} - ${maxLC.toFixed(0)} g/kWh`);

console.log('\nPlausibilitaetscheck:');
console.log('  Scope 2 sollte grob bei CO2Map liegen (ohne Biomasse/Kernenergie).');
console.log('  Lifecycle sollte etwas UNTER GGC liegen (wir lassen Skalierung,');
console.log('  KWK-Allokation und Importe weg).');
console.log('  Faktor 2+ Abweichung => Fehler in den Faktoren, nicht im Ablauf.');

// erste Stunde detailliert, zum Nachrechnen von Hand
const first = hours[0];
console.log(`\nDetail erste Stunde (${first.timestamp}):`);
for (const [t, mwh] of Object.entries(first.values)) {
  const f = emissionFactors[t];
  if (!f) continue;
  console.log(
    `  ${t.padEnd(24)} ${String(Math.round(mwh)).padStart(7)} MWh` +
    ` x ${String(f.lc).padStart(5)} g/kWh` +
    ` = ${String(Math.round(f.lc * mwh / 1000)).padStart(6)} t` +
    `   (Scope3-Anteil: ${getScope3(t).toFixed(0)} g/kWh)`
  );
}

// --- CSV -----------------------------------------------------------------
const header = Object.keys(rows[0]).join(',');
const csv = [header, ...rows.map(r => Object.values(r).join(','))].join('\n');
const outFile = `reference/eigene_berechnung_${startArg}_bis_${endArg}.csv`;
writeFileSync(outFile, csv);
console.log(`\nGeschrieben: ${outFile}`);
console.log('Jetzt gegen die GGC- und CO2Map-Dateien in /reference/ vergleichen.');
