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
  ggc:       { scope2: 95,  lc: 230 },
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

  // Pumpspeicher: v1 vereinfacht. Siehe TODO unten.
  'Pumpspeicher':            { scope2: 0, lc: 0 },
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

/* TODO vor Abgabe:
 * - Pumpspeicher: Entladung mit gewichteter Ladeintensität bewerten
 *   (CO2Map: 274 g/kWh für 2023, Zyklus-Wirkungsgrad 80 %)
 * - Wirkungsgrade aus Eurostat-Energiebilanzen herleiten statt aus CO2Map
 *   zurückrechnen (behebt Zirkularität in der Validierung)
 * - Biomasse-Konvention im Team final entscheiden
 */
