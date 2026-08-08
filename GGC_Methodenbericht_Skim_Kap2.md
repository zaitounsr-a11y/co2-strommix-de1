# GGC Methodenbericht — Skim of Chapters 2.1–2.5

Source: *Green Grid Compass Methodology Report*, FfE / TenneT / 50Hertz, published 17.12.2024 (English version, Feb 2025).
Purpose of this document: give all three of us the same picture of what GGC actually does, so we can decide what to copy, what to simplify, and what to skip.

Everything below is paraphrased. Numbers are facts from the report; the *"What this means for us"* boxes are my reading, not the report's.

---

## ⚠️ Read this first

**The 2024 version of the report deliberately removed the numeric tables.** Emission factors per generation type, scaling factors, and power-plant own-consumption values were all deleted from the appendices, because they change every year with the statistics. The report says this explicitly in the change log.

Consequence: **we cannot copy GGC's factor table.** We have two options only —

1. Derive the factors ourselves from JRC + Eurostat + AGEB (faithful, slow), or
2. Use published per-kWh life-cycle factors from another source (IPCC AR5 Annex III, UBA, ecoinvent-derived literature) and document the deviation.

This is the single biggest scope decision in the project. **[High confidence]**

What *is* still in the report: the reference efficiencies for CHP allocation (Annex B) and the grid-loss percentages (Annex C). Germany = 4.46 %, Luxembourg = 3.68 %.

---

## 2.1 System boundaries

- **Resolution & scope:** hourly, per bidding zone inside the ENTSO-E area.
- **Two scopes, summed:** combustion-related emissions = **Scope 2**; upstream processes + plant construction + grid losses = **Scope 3.3**. Scope 2 + Scope 3 = the **life-cycle (LC)** factor.
- **Functional unit:** one kWh of electricity in the mix as reported to ENTSO-E. For DE-LU, because generation is scaled to statistics, this narrows to the *public grid excluding industrial self-generation*.
- **Geography:** Eurostat energy balances are national, so the calculation runs per country; each bidding zone inherits its country's value. DE-LU is the exception — German and Luxembourg statistics are aggregated before calculation.
- **Accounting type:** location-based (this is what the GHG Protocol makes mandatory for Scope 2). Imports/exports are added on top to produce the *consumption* mix.
- **Gases:** not just CO₂ — CH₄, N₂O and others, converted with GWP over a 100-year horizon.

> **What this means for us:** the Scope 2 / Scope 3 split *is* the LCA content of this project. A tool that only outputs combustion CO₂ is not an LCA. We should output both numbers from day one, even if the Scope 3 side is crude at first.

---

## 2.2 Power generation

- Input is **ENTSO-E net generation per production type** (dataset *Actual Generation per Production Type, 16.1.B&C*), at least hourly.
- Statistical data (Eurostat) is **gross** generation, ENTSO-E is **net**. To reconcile, GGC computes power-plant own consumption per generation type from **AGEB** German data and applies the German values to every country, because no Europe-wide dataset exists.
- Own consumption assumed **0 % for renewables** (biomass excepted). For fossil types where AGEB gives nothing, a flat **10 %** is assumed.
- Data is fetched with a **3-hour delay**, because real-time retrieval too often hits missing values. If data is still missing, GGC keeps re-checking for **up to 3 days** and recalculates that hour when the data lands.

> **What this means for us:** the 3-hour delay explains the lag the previous group struggled with — it is deliberate, not a bug on their side. Our "real-time" tool will always be ~1 h behind SMARD and ~3 h behind confirmed GGC values. Worth stating openly in our report instead of trying to engineer around it.

### 2.2.1 Generation types

GGC follows ENTSO-E's 21 types, classified as:

- **Non-renewable:** lignite, hard coal, oil, nuclear, **pumped storage**, energy storage, fossil gas, waste, peat, coal-derived gas, oil shale, *Other*
- **Renewable:** biomass, geothermal, hydro, solar, wind offshore, wind onshore, marine, *Other renewable*

Two classification calls worth noting:

- **Pumped storage counts as non-renewable** — stored electricity can't automatically be called renewable.
- **Waste is assumed 100 % non-renewable** for Germany; renewable waste is assumed to be sitting inside the biomass category. The report admits ENTSO-E doesn't document this clearly.

### 2.2.2 Scaling factors (DE-LU only)

ENTSO-E generation data systematically deviates from statistics — worst for natural gas, which is partly schedule values and extrapolations rather than measurements. So GGC scales it:

- **Annual scaling factor per generation type** = Eurostat net generation ÷ ENTSO-E net generation, taken from the most recent available year.
- **Monthly factors for solar and wind**, because Eurostat publishes monthly net generation for them and seasonality matters.
- Electricity from **autoproducers** (industrial plants generating for their own use) is excluded, since only the public grid is in scope.
- Exceptions: **geothermal** uses monthly net data directly; **hydro** is scaled as one block including pumped storage, because Eurostat doesn't split hydro types in the annual balances.
- **No scaling at all** for *Other* and *Other renewable* — the composition is unknown and their share is small.
- Scaling is implemented **only for DE-LU**. Other bidding zones use unscaled ENTSO-E data.

> **What this means for us:** scaling is a defensible thing to skip in v1. It's a correction of a few percent, it needs Eurostat annual balances plus AGEB, and GGC themselves only do it for one bidding zone. Skip it, name it in the limitations section, and see whether it shows up in the validation gap against GGC. **[Moderate confidence]**

---

## 2.3 Emission factors — the important chapter

### Where the factors come from

- Primary source: **EU Commission / JRC, "Covenant of Mayors — Greenhouse gas emission factors for local emission inventories"**, organised by Eurostat SIEC generation types. (This is the same publication the previous student group used.)
- Operational/combustion factors trace back to the **IPCC** database; other gases converted with **GWP100 from IPCC AR6**.
- Life-cycle factors add the upstream chain from **ecoinvent v3.9.1 (cut-off model)**, with processes chosen to represent the EU.
- **Nuclear and marine are not in the JRC dataset** → IPCC AR5 Annex III values are substituted.
- Where several Eurostat types map onto one ENTSO-E type, the factor is a **generation-weighted average**.
- *Other* / *Other renewable*: no composition is known, so GGC conservatively assigns the **highest factor present in that country** within the respective category.

### The unit conversion — this is where the old project went wrong

The JRC factors are **primary-energy based**: tCO₂eq per MWh of **fuel input**, not per MWh of electricity. GGC converts them using the utilisation degree:

```
EMF_electricity  =  EMF_primary_energy  /  (net electricity output / fuel input)
```

The efficiency terms come from Eurostat energy balances — electricity output (`GEP_MAPE`, `GEP_MAPCHP`) divided by fuel input (`TI_EHG_MAPE`, `TI_EHG_MAPCHP`) — then converted from gross to net using AGEB own consumption.

For **solar, wind, hydro and geothermal**, a utilisation degree of **100 %** is assumed.

> **What this means for us:** this is the correction we identified in the old code. Skipping the division by efficiency understates fossil factors by roughly the inverse of the efficiency — a factor of ~2.5 for lignite. Non-negotiable fix. **[High confidence]**

### CHP allocation (efficiency method)

CHP plants produce electricity *and* heat, so emissions must be split between the two co-products. GGC uses the **efficiency method** recommended by the GHG Protocol:

```
A_p  =  (P / e_P)  /  [ (P / e_P) + (H / e_H) ]
```

where `P` = electricity output, `H` = heat output (both from Eurostat MAPCHP data), and `e_P`, `e_H` are EU harmonised **reference efficiencies** for separate electricity and heat generation. These are in Annex B and were updated in 2024:

| Generation type | Electricity ref. eff. | Heat ref. eff. |
|---|---|---|
| Natural gas | 53.0 % | 92 % |
| Hard coal | 44.2 % | 88 % |
| Mineral oil | 44.2 % | 85 % |
| Lignite | 41.8 % | 86 % |
| Peat | 39.0 % | 86 % |
| Biomass | 37.0 % | 86 % |
| Nuclear | 33.0 % | 92 % |
| Photovoltaics | 30.0 % | 92 % |
| Oil shale | 30.0 % | 92 % |
| Waste | 25.0 % | 80 % |
| Geothermal | 19.5 % | 92 % |
| Industrial gases | 41.8 % | 80 % |

The final factor per generation type is then a **generation-weighted average of the CHP and non-CHP portions**.

GGC flags its own limitation here: the allocation factor is **annual**, so in warm hours (little heat demand, less CHP running) the emission intensity of CHP-heavy fuels is **underestimated**, and in cold hours **overestimated**. This matters because in DE-LU, **more than two thirds** of generation from *fossil gas* and *biomass* comes from CHP plants.

> **What this means for us:** CHP is the most defensible thing to simplify, and also the most interesting thing to *discuss*. If we skip it we should say so and quantify roughly what it costs us. If someone wants a strong section in the report, this is a good one.

### Grid losses (Scope 3)

Electricity delivered is less than electricity generated, so the upstream factor is inflated, then the direct part is subtracted out (because it already sits in Scope 2):

```
EMF_S3  =  EMF_upstream / (1 − grid_losses)  −  EMF_operation
```

Loss factors come from **CEER** (2018 data). **Germany = 4.46 %**, Luxembourg = 3.68 %. Missing countries get the average across all countries (6.78 %).

### Biogenic emissions (Digression 3)

The biomass factor **excludes biogenic combustion CO₂**, on the logic that the carbon was absorbed during growth. If biogenic CO₂ *were* included, the direct biomass factor would jump from about **95 gCO₂eq/kWh to about 978 gCO₂eq/kWh**. GGC chooses not to report biogenic emissions separately, citing insufficient data — permitted under the GHG Protocol for location-based Scope 2.

> **What this means for us:** the old project gave biomass a large non-zero factor, producing that constant green block at the bottom of their emissions chart. Under GGC's convention biomass should be a *small* contributor. We need to pick a convention consciously and state it, because it visibly changes the chart.

---

## 2.4 Imports and exports — flow tracing

Only relevant for the **consumption mix**. The professor told us to ignore imports in step 1, so this is background for now — but it comes back in Task 2.

- Modelled as an hourly linear system **A · x = b**.
- **A** describes energy flows: load in each region plus trade with the other regions.
- Load balance: `Load(reg) = Gen + Imp + P_out,storage − Exp − P_in,storage`
- **b** holds the emissions in the system — direct and/or upstream depending on the scope being calculated; per generation process, net generation × its emission factor.
- **x**, the solution, is the vector of consumption-based emission factors per region.
- Absolute emissions for a bidding zone = hourly intensity × electrical load.
- **Pumped storage** enters twice: on discharge it behaves like a generation type with its own factor; the emissions of charging are booked at the *time of charging*, via whatever plants were running then. Emissions are **not shifted forward in time** to the moment of consumption.
- If load data or more than one cross-border flow is missing in a main zone, **no consumption-based intensity is calculated** for that hour at all.
- Method basis: Tranberg et al. (2019), Böing & Regett (2019).

> **What this means for us:** flow tracing is genuinely out of scope for a first version and we've been told so. But note that CO₂Map does the same thing and publishes its code on GitHub — if we ever want it, that's the shortcut. **[Moderate confidence]**

---

## 2.5 Replacement values

Input data has gaps often enough that GGC substitutes them. For **DE-LU and Belgium**, missing hours are filled with the values from the **previously calculated day-ahead forecast**, and these substituted points are **flagged as such** in the output.

> **What this means for us:** this is exactly what the previous group did on the display side — filling unconfirmed hours with forecast values. Good instinct, but we should copy GGC's discipline and *mark* substituted points in the chart rather than blending them invisibly into the confirmed series.

---

## Decision summary for our team meeting

| GGC step | Effort to replicate | Recommendation for v1 | Cost of skipping |
|---|---|---|---|
| Hourly generation per type | Low | **Do it** | — |
| Primary→electricity factor conversion | Medium | **Do it** | Results 2–3× too low. Fatal |
| Scope 2 / Scope 3 split | Low–medium | **Do it** | Not an LCA any more |
| Grid losses (4.46 %) | Very low | **Do it** — one line of code | Small, but free to include |
| Gross→net via AGEB own consumption | Medium | Skip, document | A few % |
| Scaling factors to Eurostat | Medium–high | Skip, document | A few %, mostly gas |
| CHP allocation (efficiency method) | High | Skip v1, discuss in report | Significant for gas & biomass |
| Flow tracing / imports | Very high | Skip — explicitly permitted | Consumption mix unavailable |
| Forecast substitution for gaps | Low | Do it, and flag substituted points | Gaps in the chart |

**The three questions to settle in the meeting:** (1) derive factors ourselves or take published per-kWh values, (2) SMARD or ENTSO-E as the data source, (3) do we attempt CHP allocation at all.
