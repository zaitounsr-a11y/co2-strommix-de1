/**
 * Proxy-Server für das Studienprojekt
 * ------------------------------------
 * Löst zwei Probleme:
 *   1. CORS — der Browser darf ENTSO-E/GGC nicht direkt abfragen
 *   2. Secrets — die Tokens bleiben serverseitig, nie im Browser
 *
 * Setup:
 *   npm init -y
 *   npm install express cors dotenv fast-xml-parser
 *   node server.js          (Node 18+, wegen eingebautem fetch)
 *
 * .env (NICHT committen! -> .gitignore):
 *   ENTSOE_TOKEN=dein-token
 *   GGC_TOKEN=dein-traxes-bearer-token
 */

import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { XMLParser } from 'fast-xml-parser';
import { calculateIntensityWithStorage } from './emissionFactors.js';

const app = express();
app.use(cors());
app.use(express.static('public'));   // liefert public/index.html aus
const PORT = process.env.PORT || 3000;   // Hoster geben den Port vor

const ENTSOE_URL = 'https://web-api.tp.entsoe.eu/api';
const GGC_URL    = 'https://explore.traxes.io/greengrid-compass/v1';
const DE_LU      = '10Y1001A1001A82H';

// Nachbarn der Gebotszone DE-LU (EIC-Codes)
const NACHBARN = {
  'AT':  '10YAT-APG------L',
  'BE':  '10YBE----------2',
  'CH':  '10YCH-SWISSGRIDZ',
  'CZ':  '10YCZ-CEPS-----N',
  'DK1': '10YDK-1--------W',
  'DK2': '10YDK-2--------M',
  'FR':  '10YFR-RTE------C',
  'NL':  '10YNL----------L',
  'NO2': '10YNO-2--------T',
  'PL':  '10YPL-AREA-----S',
  'SE4': '10Y1001A1001A47J',
};

// ---------------------------------------------------------------------------
// ENTSO-E PsrType -> unsere Energieträger-Namen
// ---------------------------------------------------------------------------
const PSR_TYPES = {
  B01: 'Biomasse',
  B02: 'Braunkohle',
  B03: 'Sonstige Konventionelle',   // Kohlegas
  B04: 'Erdgas',
  B05: 'Steinkohle',
  B06: 'Sonstige Konventionelle',   // Öl
  B07: 'Sonstige Konventionelle',   // Ölschiefer
  B08: 'Sonstige Konventionelle',   // Torf
  B09: 'Sonstige Erneuerbare',      // Geothermie
  B10: 'Pumpspeicher',
  B11: 'Wasserkraft',               // Laufwasser
  B12: 'Wasserkraft',               // Speicherwasser
  B13: 'Sonstige Erneuerbare',      // Marine
  B14: 'Kernenergie',
  B15: 'Sonstige Erneuerbare',
  B16: 'Photovoltaik',
  B17: 'Sonstige Konventionelle',   // Abfall (GGC: nicht-erneuerbar für DE)
  B18: 'Wind Offshore',
  B19: 'Wind Onshore',
  B20: 'Sonstige Konventionelle',
};

// ---------------------------------------------------------------------------
// Rate Limiting: ENTSO-E erlaubt 400 Requests/Minute, dann 10 Min Sperre.
// Wir bleiben deutlich darunter.
// ---------------------------------------------------------------------------
let lastCall = 0;
const MIN_GAP_MS = 250;   // -> max 240/min

async function throttled(url, options = {}) {
  const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCall));
  if (wait) await new Promise(r => setTimeout(r, wait));
  lastCall = Date.now();
  return fetch(url, options);
}

// ---------------------------------------------------------------------------
// Simpler In-Memory-Cache. Historische Stunden ändern sich nicht mehr,
// also nicht bei jedem Reload neu ziehen.
// ---------------------------------------------------------------------------
const cache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000;

function fromCache(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL_MS) return hit.v;
  return null;
}
function toCache(key, v) { cache.set(key, { t: Date.now(), v }); }

// ---------------------------------------------------------------------------
// ENTSO-E: Datumsformat yyyyMMddHHmm in UTC, ohne Trennzeichen
// ---------------------------------------------------------------------------
function toEntsoeDate(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
         `${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/**
 * Wandelt die ENTSO-E-XML-Antwort (A75) in stündliche Werte je Energieträger.
 * Rückgabe: [{ timestamp: ISO-String, values: { 'Braunkohle': 1234, ... } }, ...]
 *
 * Wichtig:
 *  - TimeSeries mit outBiddingZone_Domain sind VERBRAUCH (z.B. Pumpspeicher
 *    beim Laden) und werden hier übersprungen.
 *  - Auflösung kann PT15M oder PT60M sein -> auf Stunden aggregieren.
 *  - Mehrere PsrTypes können auf denselben Namen mappen -> aufsummieren.
 */
function parseGeneration(xml) {
  const doc = parser.parse(xml);

  // Fehlerdokument von ENTSO-E?
  if (doc.Acknowledgement_MarketDocument) {
    const reason = doc.Acknowledgement_MarketDocument?.Reason?.text ?? 'unbekannt';
    throw new Error(`ENTSO-E: ${reason}`);
  }

  const root = doc.GL_MarketDocument;
  if (!root) throw new Error('Unerwartetes XML-Format von ENTSO-E');

  let series = root.TimeSeries ?? [];
  if (!Array.isArray(series)) series = [series];

  const hours = new Map();   // ISO-Stunde -> { träger: MWh }

  for (const ts of series) {
    // Verbrauchsreihen überspringen
    if (ts['outBiddingZone_Domain.mRID'] && !ts['inBiddingZone_Domain.mRID']) continue;

    const psr  = ts.MktPSRType?.psrType;
    const name = PSR_TYPES[psr];
    if (!name) continue;

    let periods = ts.Period ?? [];
    if (!Array.isArray(periods)) periods = [periods];

    for (const period of periods) {
      const start = new Date(period.timeInterval.start);
      const res   = period.resolution;                 // 'PT15M' | 'PT60M'
      const stepMin = res === 'PT15M' ? 15 : res === 'PT30M' ? 30 : 60;

      let points = period.Point ?? [];
      if (!Array.isArray(points)) points = [points];

      for (const pt of points) {
        const pos = Number(pt.position);
        const qty = Number(pt.quantity);
        if (!isFinite(qty)) continue;

        // Zeitstempel des Punktes
        const t = new Date(start.getTime() + (pos - 1) * stepMin * 60000);
        // auf volle Stunde abrunden
        const hour = new Date(t);
        hour.setUTCMinutes(0, 0, 0);
        const key = hour.toISOString();

        // MW -> MWh: bei 15-Min-Werten ist jeder Punkt eine Viertelstunde
        const mwh = qty * (stepMin / 60);

        if (!hours.has(key)) hours.set(key, {});
        const bucket = hours.get(key);
        bucket[name] = (bucket[name] ?? 0) + mwh;
      }
    }
  }

  return [...hours.entries()]
    .sort((a, b) => new Date(a[0]) - new Date(b[0]))
    .map(([timestamp, values]) => ({ timestamp, values }));
}

/**
 * Parst die ENTSO-E-Antwort auf Lastfluesse (A11).
 * Wurzelelement ist Publication_MarketDocument, nicht GL_MarketDocument.
 * Rueckgabe: Map ISO-Stunde -> MW (bzw. MWh bei Stundenaufloesung)
 */
function parseFlow(xml) {
  const doc = parser.parse(xml);
  if (doc.Acknowledgement_MarketDocument) return new Map();   // kein Fluss gemeldet
  const root = doc.Publication_MarketDocument;
  if (!root) return new Map();

  let series = root.TimeSeries ?? [];
  if (!Array.isArray(series)) series = [series];

  const hours = new Map();
  for (const ts of series) {
    let periods = ts.Period ?? [];
    if (!Array.isArray(periods)) periods = [periods];
    for (const period of periods) {
      const start = new Date(period.timeInterval.start);
      const res = period.resolution;
      const stepMin = res === 'PT15M' ? 15 : res === 'PT30M' ? 30 : 60;
      let points = period.Point ?? [];
      if (!Array.isArray(points)) points = [points];
      for (const pt of points) {
        const pos = Number(pt.position), qty = Number(pt.quantity);
        if (!isFinite(qty)) continue;
        const t = new Date(start.getTime() + (pos - 1) * stepMin * 60000);
        t.setUTCMinutes(0, 0, 0);
        const key = t.toISOString();
        hours.set(key, (hours.get(key) ?? 0) + qty * (stepMin / 60));
      }
    }
  }
  return hours;
}

async function getFlow(from, to, start, end) {
  const key = `flow:${from}:${to}:${start}:${end}`;
  const cached = fromCache(key);
  if (cached) return new Map(cached);

  const params = new URLSearchParams({
    documentType: 'A11',
    out_Domain: from,
    in_Domain:  to,
    periodStart: toEntsoeDate(start),
    periodEnd:   toEntsoeDate(end),
  });
  const r = await throttled(`${ENTSOE_URL}?${params}`, {
    headers: { SECURITY_TOKEN: process.env.ENTSOE_TOKEN },
  });
  if (!r.ok) return new Map();          // fehlende Grenze -> leer, nicht Abbruch
  const m = parseFlow(await r.text());
  toCache(key, [...m.entries()]);
  return m;
}

// ---------------------------------------------------------------------------
// Route: Erzeugung einer beliebigen Zone (fuer Nachbarn)
//   GET /api/zone-generation?zone=FR&start=...&end=...
// ---------------------------------------------------------------------------
app.get('/api/zone-generation', async (req, res) => {
  const { zone, start, end } = req.query;
  const eic = NACHBARN[zone] ?? zone;
  try {
    res.json(await getGeneration(start, end, eic));
  } catch (err) {
    res.status(502).json({ error: err.message, zone });
  }
});

// ---------------------------------------------------------------------------
// Route: Grenzueberschreitende Lastfluesse
//   GET /api/flows?start=...&end=...
// Rueckgabe je Stunde: Nettoimport je Grenze in MWh (positiv = Import nach DE)
// ---------------------------------------------------------------------------
app.get('/api/flows', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return res.status(400).json({ error: 'start und end erforderlich' });

  try {
    const out = {};
    for (const [name, eic] of Object.entries(NACHBARN)) {
      const rein  = await getFlow(eic, DE_LU, start, end);   // Nachbar -> DE
      const raus  = await getFlow(DE_LU, eic, start, end);   // DE -> Nachbar
      const keys  = new Set([...rein.keys(), ...raus.keys()]);
      for (const k of keys) {
        out[k] ??= {};
        out[k][name] = (rein.get(k) ?? 0) - (raus.get(k) ?? 0);   // netto
      }
    }
    res.json(Object.entries(out)
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))
      .map(([timestamp, borders]) => ({ timestamp, borders })));
  } catch (err) {
    console.error('[flows]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Route: Stromerzeugung aus ENTSO-E
//   GET /api/generation?start=2026-07-13T00:00:00Z&end=2026-07-20T00:00:00Z
// ---------------------------------------------------------------------------
async function getGeneration(start, end, zone = DE_LU) {
  const key = `gen:${zone}:${start}:${end}`;
  const cached = fromCache(key);
  if (cached) return cached;

  const params = new URLSearchParams({
    documentType: 'A75',
    processType:  'A16',
    in_Domain:    zone,
    periodStart:  toEntsoeDate(start),
    periodEnd:    toEntsoeDate(end),
  });

  // Token im Header, NICHT im Query-String (Query-Strings landen in Logs)
  const r = await throttled(`${ENTSOE_URL}?${params}`, {
    headers: { SECURITY_TOKEN: process.env.ENTSOE_TOKEN },
  });

  if (r.status === 401) throw new Error('Token ungültig oder fehlend (401)');
  if (r.status === 429) throw new Error('Rate Limit erreicht — 10 Minuten warten');
  if (!r.ok)            throw new Error(`ENTSO-E antwortete mit ${r.status}`);

  const data = parseGeneration(await r.text());
  toCache(key, data);
  return data;
}

app.get('/api/generation', async (req, res) => {
  const { start, end, zone = DE_LU } = req.query;
  if (!start || !end) {
    return res.status(400).json({ error: 'start und end sind erforderlich (ISO 8601)' });
  }
  try {
    res.json(await getGeneration(start, end, zone));
  } catch (err) {
    console.error('[generation]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Route: unsere EIGENE CO2-Intensitaet (Erzeugung + Faktoren, serverseitig)
//   GET /api/intensity?hours=48
// ---------------------------------------------------------------------------
app.get('/api/intensity', async (req, res) => {
  const hoursBack = Math.min(Number(req.query.hours) || 48, 168);

  // ENTSO-E liefert mit Verzoegerung; GGC wartet bewusst 3 h.
  const end   = new Date(Date.now() - 3 * 3600e3);
  end.setUTCMinutes(0, 0, 0);
  const start = new Date(end.getTime() - hoursBack * 3600e3);

  try {
    const gen = await getGeneration(start.toISOString(), end.toISOString());
    if (!gen.length) return res.status(502).json({ error: 'Keine Erzeugungsdaten erhalten' });

    const s2 = calculateIntensityWithStorage(gen, 'scope2');
    const lc = calculateIntensityWithStorage(gen, 'lc');

    res.json({
      updated: new Date().toISOString(),
      speicherFaktor: Math.round(lc.speicherFaktor),
      hours: gen.map((h, i) => ({
        timestamp:  h.timestamp,
        generation: h.values,
        totalMWh:   Math.round(lc.rows[i].totalMWh),
        scope2:     s2.rows[i].intensity,
        lc:         lc.rows[i].intensity,
      })),
    });
  } catch (err) {
    console.error('[intensity]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Route: CO2-Intensität von GGC (nur zum Vergleich, nicht für unsere Rechnung!)
//   GET /api/ggc?start=...&end=...&scope=Lifecycle
// ---------------------------------------------------------------------------
app.get('/api/ggc', async (req, res) => {
  const {
    start, end,
    zone  = 'DE_LU',
    scope = 'Lifecycle',        // 'Lifecycle' | 'Operational'
    type  = 'Production',       // 'Production' | 'Consumption'
  } = req.query;

  if (!start || !end) {
    return res.status(400).json({ error: 'start und end sind erforderlich' });
  }

  const key = `ggc:${zone}:${scope}:${type}:${start}:${end}`;
  const cached = fromCache(key);
  if (cached) return res.json(cached);

  const params = new URLSearchParams({
    start, end, zone,
    'time-resolution':  'Hourly',
    'calculation-type': type,
    'emission-type':    scope,
  });

  try {
    // ACHTUNG: Endpunkt-Pfad gegen die traxes.io-Doku prüfen!
    const r = await throttled(`${GGC_URL}/co2-intensity?${params}`, {
      headers: { Authorization: `Bearer ${process.env.GGC_TOKEN}` },
    });
    if (!r.ok) throw new Error(`GGC antwortete mit ${r.status}`);

    const data = await r.json();
    toCache(key, data);
    res.json(data);
  } catch (err) {
    console.error('[ggc]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
app.get('/api/health', (_, res) => res.json({
  ok: true,
  entsoeToken: Boolean(process.env.ENTSOE_TOKEN),
  ggcToken:    Boolean(process.env.GGC_TOKEN),
}));

app.listen(PORT, () => {
  console.log(`Proxy läuft auf Port ${PORT}`);
  if (!process.env.ENTSOE_TOKEN) console.warn('⚠️  ENTSOE_TOKEN fehlt in .env');
  if (!process.env.GGC_TOKEN)    console.warn('⚠️  GGC_TOKEN fehlt in .env');
});
