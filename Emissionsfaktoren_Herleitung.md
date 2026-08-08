# Emission Factors — Derivation and Table

For: HAW Studienprojekt, dynamic LCA of the German electricity mix
Status: **draft — every row needs to be checked by one of us against the primary source before it goes in the report**

---

## 1. The structural problem with the JRC table

The previous group used the EU JRC "Covenant of Mayors" table (European Commission 2024). Two things about that table matter:

**(a) It is fuel-based, not electricity-based.** Every value is tCO₂eq per MWh of *fuel input*. To get an emission factor per kWh of *electricity*, you divide by the plant's net electrical efficiency. GGC states this explicitly:

```
EMF_electricity = EMF_primary_energy / (net electricity output / fuel input)
```

**(b) It contains no renewables.** It's a table of *fuels*. Wind, solar, hydro and nuclear are not fuels in that sense, so they simply don't appear. This is almost certainly why the previous group set them to zero — the source they used has no row for them.

That means: **the JRC table alone cannot produce a life-cycle factor set.** It gives you the fossil rows. Renewables and nuclear have to come from a second source (IPCC AR5 Annex III, or ecoinvent-derived literature). Any LCA built on JRC alone is structurally incomplete.

---

## 2. Fossil factors — derived and validated

Derivation: JRC value ÷ net electrical efficiency of the German fleet.

| Generation type | JRC combustion (t/MWh fuel) | JRC life cycle (t/MWh fuel) | Efficiency used | **Scope 2 (g/kWh)** | **Life cycle (g/kWh)** |
|---|---|---|---|---|---|
| Lignite | 0.365 | 0.373 | 0.34 | **1074** | **1097** |
| Hard coal | 0.342 | 0.392 | 0.405 | **844** | **968** |
| Fossil gas | 0.202 | 0.261 | 0.53 | **381** | **492** |
| Oil / gas-diesel oil | 0.268 | 0.340 | 0.40 | **670** | **850** |
| Waste (non-biogenic) | 0.337 | 0.346 | 0.25 | **1348** | **1384** |

### Why these efficiencies

The efficiencies are **not** the EU reference efficiencies from GGC Annex B. Those describe *new* reference plants (lignite 41.8 %, hard coal 44.2 %, gas 53.0 %) and are used only for CHP allocation. The actual German fleet is older and less efficient.

Instead they are back-calculated from CO₂Map's published per-kWh factors, which are derived independently from UBA emissions data and AGEB generation volumes. The agreement is the validation:

| | Our derivation | CO₂Map published | Δ |
|---|---|---|---|
| Lignite | 1074 | 1074 | 0 % |
| Hard coal | 844 | 844 | 0 % |
| Fossil gas | 381 | 379 | 0.5 % |
| Waste / "other fossil" | 1348 | 1346 | 0.1 % |

Two independent routes — JRC ÷ efficiency, and UBA ÷ AGEB — landing within 0.5 % of each other. **[High confidence]** in the fossil Scope 2 column.

Note that gas lands at 53 %, i.e. the reference efficiency, because the German gas fleet is relatively modern. Lignite lands at 34 %, well below its 41.8 % reference. That gap is exactly why using reference efficiencies naively would have understated lignite by about 20 %.

**Caveat:** CO₂Map's figures are from 2022. Fleet efficiency drifts slowly, so this is fine for a study project, but say so in the limitations. **[Moderate confidence]** on whether 2024/25 values differ materially.

---

## 3. Non-fossil factors — second source required

These cannot come from JRC. Values below are **IPCC AR5 Annex III lifecycle medians** (Schlömer et al. 2014), which is also the source GGC falls back on for nuclear.

| Generation type | Scope 2 (g/kWh) | Life cycle (g/kWh) | Note |
|---|---|---|---|
| Wind onshore | 0 | **11** | |
| Wind offshore | 0 | **12** | |
| Solar PV (utility) | 0 | **48** | AR5 median; rooftop 41 |
| Hydro (run-of-river/reservoir) | 0 | **24** | Wide spread in literature |
| Nuclear | 0 | **12** | GGC also uses IPCC here |
| Geothermal | 0 | **38** | Negligible in DE |
| Biomass | **~95** | see note | GGC convention |

### The biomass decision — flag this in the meeting

GGC's biomass factor **excludes biogenic combustion CO₂**, on the reasoning that the carbon was absorbed during growth. Direct factor ≈ **95 gCO₂eq/kWh**.

If you *include* biogenic CO₂, the direct factor becomes ≈ **978 gCO₂eq/kWh** — a tenfold jump. GGC states both numbers explicitly and chooses to exclude, which the GHG Protocol permits for location-based Scope 2.

CO₂Map takes a third position: biomass = 0.

The previous group's chart shows biomass as a large constant block at the bottom, which corresponds to none of these conventions cleanly. **Pick one, state it, keep it consistent.** This choice visibly changes every chart we produce.

### Pumped storage

GGC treats it as non-renewable, gives it a factor on discharge, and books charging emissions at the time of charging. CO₂Map computes a volume-weighted charging intensity assuming 80 % cycle efficiency — 392 g/kWh for 2022, 274 g/kWh for 2023.

Simplest v1: assign pumped storage the average grid intensity of the previous hours, or exclude it and note the omission. Its share is small.

### "Sonstige Konventionelle" / "Sonstige Erneuerbare"

GGC's convention: assign the **highest factor present in that country** within the respective category — deliberately conservative, because the composition is undocumented. For DE that means "Sonstige Konventionelle" gets the waste/oil factor, not a gas factor. The previous group used 0.261 (the gas LC value), which is the opposite of conservative.

---

## 4. Scope 3 and grid losses

Scope 3 = life cycle − Scope 2, then inflated for grid losses. GGC's formula:

```
EMF_S3 = EMF_upstream / (1 − grid_losses) − EMF_operation
```

Germany: **grid losses = 4.46 %** (CEER 2018, via GGC Annex C).

So for lignite: `1097 / (1 − 0.0446) − 1074 = 74 g/kWh` of Scope 3.

---

## 5. What still needs checking

1. **Verify the JRC values** against the actual publication (JRC136272), not the screenshot in the old report. Especially: which hard-coal row applies to the German fleet — anthracite (0.354) or other bituminous (0.342)? I used other bituminous; anthracite would give 877 instead of 844.
2. **Confirm the AR5 renewable medians** against Annex III directly.
3. **Decide the biomass convention** as a team.
4. **Check whether CO₂Map has updated** past 2022 for the fossil factors.
5. **Decide whether to derive efficiencies properly** from Eurostat energy balances (`GEP_MAPE / TI_EHG_MAPE`) instead of back-calculating them. That's the GGC-faithful route and would make the derivation independent of CO₂Map rather than validated against it — which is methodologically stronger, and a good target for v2.

Point 5 matters for the report: right now our factors are *calibrated to* CO₂Map, which weakens using CO₂Map as an independent validation source. Deriving efficiencies from Eurostat breaks that circularity.
