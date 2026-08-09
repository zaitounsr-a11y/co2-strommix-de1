/**
 * Erweiterung: Import/Export — Produktionsmix gegen Verbrauchsmix
 * ---------------------------------------------------------------
 * In Task 1 wurde der Handel bewusst ausgeklammert (Absprache mit dem
 * Betreuer). Diese Auswertung holt ihn in vereinfachter Form nach.
 *
 * VERFAHREN
 *   1. Erzeugungsmix DE-LU  -> eigene Intensitaet (= Task 1)
 *   2. Erzeugungsmix jedes Nachbarn -> dessen Intensitaet, mit UNSEREN Faktoren
 *   3. Nettofluss je Grenze und Stunde
 *   4. Verbrauchsmix:
 *
 *        I_verbrauch = ( E_inland + Σ Import_n × I_n )
 *                      / ( Erzeugung_inland + Σ Import_n )
 *
 *      Exporte werden mit der inlaendischen Intensitaet bewertet und
 *      verlassen die Bilanz.
 *
 * VEREINFACHUNG GEGENUEBER GGC
 *   GGC loest ein lineares Gleichungssystem ueber alle Zonen (Flow Tracing
 *   nach Tranberg et al. 2019). Damit wird auch beruecksichtigt, dass ein
 *   Nachbar seinerseits importiert. Hier wird jeder Nachbar mit seinem
 *   EIGENEN Erzeugungsmix bewertet — eine Naeherung erster Ordnung.
 *   Sie unterschaetzt den Effekt, wenn ein Nachbar viel schmutziger
 *   importiert als er selbst erzeugt.
 *
 * Aufruf:  node imports.js 2024-06-10 2024-06-17
 */

import { writeFileSync } from 'fs';
import { calculateIntensityWithStorage, emissionFactors } from './emissionFactors.js';

/**
 * SENSITIVITAET fuer die Kategorie "Sonstige Konventionelle" im Ausland.
 *
 * GGC bewertet unbekannte Kategorien konservativ mit dem hoechsten Faktor
 * des Landes (hier 1384 g/kWh, entspricht Abfall). Fuer DE ist die Kategorie
 * klein (~4 % der Erzeugung), fuer manche Nachbarn nicht: in den Niederlanden
 * entfallen rund 31 % der Erzeugung auf sie. Die Konvention ist damit nicht
 * uebertragbar.
 *
 * Daher werden zwei Varianten gerechnet:
 *   'konservativ'  Kategorie mit 1384 g/kWh (GGC-Konvention, unveraendert)
 *   'gas'          Kategorie mit dem Erdgasfaktor 492 g/kWh (untere Schranke)
 * Der wahre Wert liegt dazwischen.
 */
const VARIANTEN = {
  konservativ: emissionFactors['Sonstige Konventionelle'].lc,
  gas:         emissionFactors['Erdgas'].lc,
};

function intensitaetMitVariante(gen, faktorSonstige) {
  const original = emissionFactors['Sonstige Konventionelle'].lc;
  emissionFactors['Sonstige Konventionelle'].lc = faktorSonstige;
  const r = calculateIntensityWithStorage(gen, 'lc');
  emissionFactors['Sonstige Konventionelle'].lc = original;
  return r;
}

const PROXY = 'http://localhost:3000';
const NACHBARN = ['AT','BE','CH','CZ','DK1','DK2','FR','NL','NO2','PL','SE4'];

const [, , startArg, endArg] = process.argv;
if (!startArg || !endArg) {
  console.error('Aufruf: node imports.js <start YYYY-MM-DD> <end YYYY-MM-DD>');
  process.exit(1);
}
const start = `${startArg}T00:00:00Z`, end = `${endArg}T00:00:00Z`;

const hole = async (pfad) => {
  const r = await fetch(`${PROXY}${pfad}`);
  if (!r.ok) throw new Error(`${pfad} -> ${r.status}`);
  return r.json();
};

// ---------------------------------------------------------------------------
console.log('Erzeugung DE-LU ...');
const de = await hole(`/api/generation?start=${start}&end=${end}`);
console.log(`  ${de.length} Stunden`);

console.log('Grenzueberschreitende Fluesse ...');
const flows = await hole(`/api/flows?start=${start}&end=${end}`);
const flowMap = new Map(flows.map(f => [f.timestamp, f.borders]));
console.log(`  ${flows.length} Stunden`);

// --- Intensitaet je Nachbar ------------------------------------------------
console.log('Erzeugungsmix der Nachbarn (dauert etwas) ...');
const nachbarIntensitaet = {};   // land -> Map(stunde -> g/kWh)
const nachbarMittel = {};

const nachbarIntensitaetGas = {};   // Variante 'gas'
const nachbarMittelGas = {};
const anteilSonstige = {};          // Anteil der Kategorie an der Erzeugung

console.log('  Land   Stunden   konservativ        Gas-Variante   Anteil "Sonstige"');
for (const land of NACHBARN) {
  try {
    const g = await hole(`/api/zone-generation?zone=${land}&start=${start}&end=${end}`);
    if (!g.length) { console.log(`  ${land.padEnd(4)} keine Daten`); continue; }

    let sonst = 0, gesamt = 0;
    for (const h of g) {
      sonst  += h.values['Sonstige Konventionelle'] ?? 0;
      gesamt += Object.values(h.values).reduce((a, b) => a + b, 0);
    }
    anteilSonstige[land] = gesamt > 0 ? sonst / gesamt : 0;

    const bau = (faktor, ziel, mittel) => {
      const r = intensitaetMitVariante(g, faktor);
      const m = new Map();
      r.rows.forEach(row => { if (row.intensity !== null) m.set(row.timestamp, row.intensity); });
      ziel[land] = m;
      const w = [...m.values()];
      mittel[land] = w.reduce((a, b) => a + b, 0) / w.length;
      return w.length;
    };
    const n = bau(VARIANTEN.konservativ, nachbarIntensitaet, nachbarMittel);
    bau(VARIANTEN.gas, nachbarIntensitaetGas, nachbarMittelGas);

    const warn = anteilSonstige[land] > 0.15 ? '  <-- Kategorie dominiert' : '';
    console.log(`  ${land.padEnd(4)} ${n.toString().padStart(6)}   ` +
      `${nachbarMittel[land].toFixed(0).padStart(8)} g/kWh   ` +
      `${nachbarMittelGas[land].toFixed(0).padStart(8)} g/kWh   ` +
      `${(anteilSonstige[land] * 100).toFixed(0).padStart(5)} %${warn}`);
  } catch (e) {
    console.log(`  ${land.padEnd(4)} Fehler: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Produktions- und Verbrauchsmix je Stunde
// ---------------------------------------------------------------------------
const deLC = calculateIntensityWithStorage(de, 'lc');
const rows = [];
let ohneNachbardaten = 0;

de.forEach((h, i) => {
  const prod = deLC.rows[i];
  if (prod.intensity === null) return;

  const borders = flowMap.get(h.timestamp) ?? {};
  let importMWh = 0, importTons = 0, exportMWh = 0, unbekannt = 0;

  for (const [land, netto] of Object.entries(borders)) {
    if (netto > 0) {                                   // Import nach DE
      const iN = nachbarIntensitaet[land]?.get(h.timestamp);
      if (iN === undefined) { unbekannt += netto; continue; }
      importMWh  += netto;
      importTons += iN * netto / 1000;
    } else if (netto < 0) {
      exportMWh += -netto;
    }
  }
  if (unbekannt > 0) ohneNachbardaten++;

  // Import, fuer den keine Nachbardaten vorliegen: mit inlaendischer
  // Intensitaet bewertet (neutrale Annahme, keine Verzerrung der Richtung)
  importMWh  += unbekannt;
  importTons += prod.intensity * unbekannt / 1000;

  const verbrauchMWh  = prod.totalMWh + importMWh - exportMWh;
  const inlandTons    = prod.totalTons;
  const exportTons    = prod.intensity * exportMWh / 1000;
  const verbrauchTons = inlandTons + importTons - exportTons;

  rows.push({
    timestamp:  h.timestamp,
    produktion: prod.intensity,
    verbrauch:  verbrauchMWh > 0 ? verbrauchTons * 1000 / verbrauchMWh : null,
    erzeugung_MWh: Math.round(prod.totalMWh),
    import_MWh:    Math.round(importMWh),
    export_MWh:    Math.round(exportMWh),
    netto_MWh:     Math.round(importMWh - exportMWh),
  });
});

// --- zweiter Durchlauf mit der Gas-Variante --------------------------------
const rowsGas = [];
de.forEach((h, i) => {
  const prod = deLC.rows[i];
  if (prod.intensity === null) return;
  const borders = flowMap.get(h.timestamp) ?? {};
  let impMWh = 0, impTons = 0, expMWh = 0;
  for (const [land, netto] of Object.entries(borders)) {
    if (netto > 0) {
      const iN = nachbarIntensitaetGas[land]?.get(h.timestamp) ?? prod.intensity;
      impMWh += netto; impTons += iN * netto / 1000;
    } else if (netto < 0) expMWh += -netto;
  }
  const vMWh = prod.totalMWh + impMWh - expMWh;
  const vTons = prod.totalTons + impTons - prod.intensity * expMWh / 1000;
  if (vMWh > 0) rowsGas.push(vTons * 1000 / vMWh);
});

// ---------------------------------------------------------------------------
const gueltig = rows.filter(r => r.verbrauch !== null);
const mit = a => a.reduce((x, y) => x + y, 0) / a.length;
const mProd = mit(gueltig.map(r => r.produktion));
const mVerb = mit(gueltig.map(r => r.verbrauch));
const mImp  = mit(gueltig.map(r => r.import_MWh));
const mExp  = mit(gueltig.map(r => r.export_MWh));
const impStunden = gueltig.filter(r => r.netto_MWh > 0).length;

console.log('\n=== PRODUKTIONSMIX GEGEN VERBRAUCHSMIX ===\n');
console.log(`Stunden                       : ${gueltig.length}`);
console.log(`Mittel Produktionsmix         : ${mProd.toFixed(1)} g/kWh   (Task 1)`);
console.log(`Mittel Verbrauchsmix          : ${mVerb.toFixed(1)} g/kWh`);
console.log(`Differenz                     : ${(mVerb - mProd >= 0 ? '+' : '')}${(mVerb - mProd).toFixed(1)} g/kWh` +
            `  (${((mVerb - mProd) / mProd * 100).toFixed(1)} %)`);
const mVerbGas = rowsGas.reduce((a, b) => a + b, 0) / rowsGas.length;
console.log(`\nSensitivitaet "Sonstige Konventionelle" im Ausland:`);
console.log(`  konservativ (1384 g/kWh)    : ${mVerb.toFixed(1)} g/kWh Verbrauchsmix`);
console.log(`  Erdgasfaktor (492 g/kWh)    : ${mVerbGas.toFixed(1)} g/kWh Verbrauchsmix`);
console.log(`  Spanne                      : ${Math.abs(mVerb - mVerbGas).toFixed(1)} g/kWh` +
            `  (${(Math.abs(mVerb - mVerbGas) / mProd * 100).toFixed(1)} % des Produktionsmix)`);
console.log(`  -> Aussage "Verbrauchsmix < Produktionsmix" ist ` +
            `${(mVerb < mProd && mVerbGas < mProd) ? 'in BEIDEN Varianten stabil' : 'NICHT robust'}.`);

console.log(`\nMittlerer Import              : ${mImp.toFixed(0)} MWh/h`);
console.log(`Mittlerer Export              : ${mExp.toFixed(0)} MWh/h`);
console.log(`Stunden mit Nettoimport       : ${impStunden} von ${gueltig.length}` +
            `  (${(impStunden / gueltig.length * 100).toFixed(0)} %)`);
if (ohneNachbardaten) {
  console.log(`\nHinweis: in ${ohneNachbardaten} Stunden fehlten Daten fuer mindestens`);
  console.log(`einen importierenden Nachbarn; dieser Anteil wurde mit der`);
  console.log(`inlaendischen Intensitaet bewertet.`);
}

console.log('\nMittlere Intensitaet der Nachbarn (konservative Variante):');
Object.entries(nachbarMittel).sort((a, b) => a[1] - b[1]).forEach(([l, v]) => {
  const zeichen = v < mProd ? 'sauberer' : 'schmutziger';
  console.log(`  ${l.padEnd(4)} ${v.toFixed(0).padStart(5)} g/kWh   ${zeichen} als DE`);
});

const groesste = [...gueltig].sort((a, b) =>
  Math.abs(b.verbrauch - b.produktion) - Math.abs(a.verbrauch - a.produktion)).slice(0, 5);
console.log('\nGroesste Abweichungen:');
console.log('  Zeitstempel        Produktion  Verbrauch    Diff   Netto MWh');
groesste.forEach(r => console.log(
  `  ${r.timestamp.slice(0, 16)}  ${r.produktion.toFixed(0).padStart(9)}` +
  ` ${r.verbrauch.toFixed(0).padStart(10)} ${((r.verbrauch - r.produktion) >= 0 ? '+' : '') +
  (r.verbrauch - r.produktion).toFixed(0).padStart(7)} ${r.netto_MWh.toString().padStart(11)}`));

writeFileSync('reference/import_export_analyse.csv',
  ['timestamp,produktionsmix_g_kwh,verbrauchsmix_g_kwh,erzeugung_MWh,import_MWh,export_MWh,netto_MWh',
   ...gueltig.map(r => [r.timestamp, r.produktion.toFixed(1), r.verbrauch.toFixed(1),
     r.erzeugung_MWh, r.import_MWh, r.export_MWh, r.netto_MWh].join(','))].join('\n'));
console.log('\nGeschrieben: reference/import_export_analyse.csv');

console.log(`
EINORDNUNG
  Der Verbrauchsmix bewertet den tatsaechlich in DE verbrauchten Strom,
  der Produktionsmix nur die inlaendische Erzeugung. GGC weist beide aus
  und verwendet fuer die Anwendung den produktionsbasierten Wert.

  Vereinfachung: kein Flow Tracing. Jeder Nachbar wird mit seinem eigenen
  Erzeugungsmix bewertet, nicht mit seinem Verbrauchsmix. Importiert ein
  Nachbar seinerseits schmutzigen Strom, wird der Effekt unterschaetzt.
  Vgl. GGC Methodenbericht Kap. 2.4 und Tranberg et al. (2019).`);
