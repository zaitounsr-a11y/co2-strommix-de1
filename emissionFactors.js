/**
 * Emissionsfaktoren für den deutschen Strommix
 * ---------------------------------------------
 * Alle Werte in gCO2eq pro kWh ELEKTRISCHER Energie (nicht Brennstoffinput!).
 *
 * scope2 = verbrennungsbedingte Emissionen
 * lc     = Lebenszyklus gesamt (Verbrennung + Vorkette + Anlagenbau)
 * scope3 = lc/(1-netzverluste) - scope2   (siehe getScope3)
 *
 * Herleitung + Validierung: siehe Emissionsfaktoren_Herleitung.md
 * Schlüssel entsprechen den Namen in energietraeger[] aus script.js.
 *
 * ACHTUNG: Werte sind Entwurf. Vor Abgabe gegen Primärquellen prüfen.
 */

export const GRID_LOSSES_DE = 0.0446;   // CEER 2018, via GGC Anhang C

// Konvention für Biomasse: 'ggc' (ohne biogenes CO2, ~95 g/kWh),
// 'inclusive' (mit biogenem CO2, ~978 g/kWh) oder 'zero' (wie CO2Map).
export const BIOMASS_CONVENTION = 'ggc';

const BIOMASS = {
  ggc:       { scope2: 95,  lc: 53 },
  inclusive: { scope2: 978, lc: 1113 },
  zero:      { scope2: 0,   lc: 0 },
};

export const emissionFactors = {
  // --- fossil: JRC-Faktor / Wirkungsgrad, validiert gegen CO2Map ---
  'Braunkohle':              { scope2: 1074, lc: 1097 },
  'Steinkohle':              { scope2: 844,  lc: 968  },
  'Erdgas':                  { scope2: 381,  lc: 492  },
  // konservativ: höchster fossiler Faktor im Land (GGC-Konvention)
  'Sonstige Konventionelle': { scope2: 1348, lc: 1384 },

  // --- nicht-fossil: IPCC AR5 Annex III Mediane ---
  'Kernenergie':             { scope2: 0, lc: 12 },
  'Wind Onshore':            { scope2: 0, lc: 11 },
  'Wind Offshore':           { scope2: 0, lc: 12 },
  'Photovoltaik':            { scope2: 0, lc: 48 },
  'Wasserkraft':             { scope2: 0, lc: 24 },
  // konservativ: höchster erneuerbarer Faktor
  'Sonstige Erneuerbare':    { scope2: 0, lc: 48 },

  'Biomasse':                BIOMASS[BIOMASS_CONVENTION],

  // Pumpspeicher: wird NICHT hier bewertet, sondern dynamisch in
  // calculateIntensityWithStorage(). Diese Werte sind nur Fallback,
  // falls jemand calculateIntensity() direkt aufruft.
  'Pumpspeicher':            { scope2: 392, lc: 430 },
};

/**
 * Scope-3-Faktor nach GGC-Formel:
 *   EMF_S3 = EMF_upstream / (1 - Netzverluste) - EMF_operation
 */
export function getScope3(traeger, losses = GRID_LOSSES_DE) {
  const f = emissionFactors[traeger];
  if (!f) return 0;
  return f.lc / (1 - losses) - f.scope2;
}

/**
 * Stündliche CO2-Intensität des Strommixes.
 *
 * @param {Object} generationMWh  { 'Braunkohle': 12345, 'Photovoltaik': 6789, ... }
 * @param {'scope2'|'lc'} scope
 * @returns {{ intensity: number|null, totalTons: number, totalMWh: number,
 *             perTraeger: Object }}
 *
 * WICHTIG: Der Nenner enthält IMMER die gesamte Erzeugung, auch die
 * emissionsfreien Träger. Das ist der attributionale Ansatz. Er darf NICHT
 * von einer UI-Auswahl (Checkboxen) abhängen — das war ein Bug im Altcode.
 */
export function calculateIntensity(generationMWh, scope = 'lc') {
  let totalTons = 0;
  let totalMWh = 0;
  const perTraeger = {};

  for (const [traeger, mwh] of Object.entries(generationMWh)) {
    if (typeof mwh !== 'number' || !isFinite(mwh) || mwh < 0) continue;

    const f = emissionFactors[traeger];
    if (!f) {
      console.warn(`Kein Emissionsfaktor für "${traeger}" — wird ignoriert.`);
      continue;
    }

    // g/kWh * MWh = g/kWh * 1000 kWh = kg  ->  /1000 = t
    const tons = (f[scope] * mwh) / 1000;
    perTraeger[traeger] = tons;
    totalTons += tons;
    totalMWh  += mwh;
  }

  return {
    intensity: totalMWh > 0 ? (totalTons * 1000) / totalMWh : null,  // g/kWh
    totalTons,
    totalMWh,
    perTraeger,
  };
}

/**
 * Zwei-Pass-Berechnung mit dynamischer Bewertung des Pumpspeichers.
 *
 * Problem: Pumpspeicher erzeugt keinen Strom, er gibt gespeicherten Strom
 * zurück. Ein Faktor von 0 wäre falsch (Strom war nicht emissionsfrei),
 * ein fester Faktor auch (die Ladeintensität schwankt stündlich).
 *
 * Lösung (nach GGC-Logik, vereinfacht):
 *   Pass 1: Intensität des Netzes OHNE Pumpspeicher berechnen.
 *   Pass 2: Pumpspeicher-Entladung mit dem Mittel dieser Intensität
 *           bewerten, geteilt durch den Zyklus-Wirkungsgrad (Verluste
 *           beim Laden/Entladen erhöhen die Intensität je kWh Rückgabe).
 *
 * Abweichung zu GGC: GGC bucht die Ladeemissionen zum Zeitpunkt des
 * Ladens. Wir mitteln über das Fenster. In der Limitationen-Sektion
 * dokumentieren.
 *
 * @param {Array} hours  [{ timestamp, values: {...} }, ...] vom Proxy
 * @param {'scope2'|'lc'} scope
 * @param {number} cycleEfficiency  Zyklus-Wirkungsgrad, Default 0.80
 */
export function calculateIntensityWithStorage(hours, scope = 'lc', cycleEfficiency = 0.80) {
  const STORAGE = 'Pumpspeicher';

  // --- Pass 1: Intensität ohne Speicher ---------------------------------
  let sumTons = 0;
  let sumMWh  = 0;

  for (const h of hours) {
    const ohneSpeicher = { ...h.values };
    delete ohneSpeicher[STORAGE];
    const r = calculateIntensity(ohneSpeicher, scope);
    sumTons += r.totalTons;
    sumMWh  += r.totalMWh;
  }

  const mittlereLadeintensitaet = sumMWh > 0 ? (sumTons * 1000) / sumMWh : 0;
  const speicherFaktor = mittlereLadeintensitaet / cycleEfficiency;

  // --- Pass 2: mit bewertetem Speicher ----------------------------------
  const ergebnis = hours.map(h => {
    const r = calculateIntensity(
      Object.fromEntries(Object.entries(h.values).filter(([k]) => k !== STORAGE)),
      scope
    );

    const speicherMWh  = h.values[STORAGE] ?? 0;
    const speicherTons = (speicherFaktor * speicherMWh) / 1000;

    const totalTons = r.totalTons + speicherTons;
    const totalMWh  = r.totalMWh  + speicherMWh;

    return {
      timestamp: h.timestamp,
      intensity: totalMWh > 0 ? (totalTons * 1000) / totalMWh : null,
      totalTons,
      totalMWh,
      perTraeger: { ...r.perTraeger, [STORAGE]: speicherTons },
    };
  });

  return { rows: ergebnis, speicherFaktor, mittlereLadeintensitaet };
}

/* TODO vor Abgabe:
 * - Pumpspeicher: ggf. stündliche statt gemittelte Ladeintensität
 *   (CO2Map: 274 g/kWh für 2023, Zyklus-Wirkungsgrad 80 %)
 * - Wirkungsgrade aus Eurostat-Energiebilanzen herleiten statt aus CO2Map
 *   zurückrechnen (behebt Zirkularität in der Validierung)
 * - Biomasse-Konvention im Team final entscheiden
 */
