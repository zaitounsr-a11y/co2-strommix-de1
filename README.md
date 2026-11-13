# Hourly life-cycle CO₂ intensity of the German electricity mix

HAW Hamburg, Studienprojekt. Supervisor: Prof. Dr. Timmerberg.
Bidding zone DE-LU, data from the ENTSO-E Transparency Platform.

**Live dashboard:** https://co2-strommix-de1.onrender.com

## What this project does

| Task | Question | Result |
|---|---|---|
| 1 · Attributional | How much CO₂eq does one kWh carry on average, hour by hour, over its life cycle? Rebuild of the Green Grid Compass (GGC) method, imports excluded. | Correlation 0.9938 with GGC (10–17 June 2024, 168 hours); mean 308.8 vs 308.3 g/kWh |
| 2 · Consequential | If consumption rises by one kWh, which plant responds and what does it emit? | Marginal factor 562 g/kWh (summer week), regression on residual load, R² 0.936 |

The two answers differ because wind and solar cannot respond to extra demand. The marginal kWh is fossil, so it is about 1.4–1.8 times the average.

## Method in short

1. Download actual generation per production type (ENTSO-E, document A75 / process A16), aggregate quarter-hourly values to hours. Series marked `outBiddingZone` without `inBiddingZone` are consumption (e.g. pumping) and are skipped.
2. Emission factors in g CO₂eq per kWh of electricity (`emissionFactors.js`): fossil = EU JRC value per MWh of fuel ÷ plant efficiency (lignite 365 / 0.34 ≈ 1074); renewables and nuclear = IPCC AR5 Annex III. Biomass follows the GGC convention (excludes biogenic CO₂).
3. Intensity = Σ(generation × factor) ÷ Σ(all generation), wind and solar included in the denominator.
4. Pumped storage is valued in two passes: grid intensity without storage ÷ 0.80 round-trip efficiency.
5. Task 2: marginal factor = regression slope of Δ emissions on Δ residual load (generation − wind − solar), after Hawkes (2010).

Details: `Emissionsfaktoren_Herleitung.md`.

## Run it locally

```bash
npm install
# create a file named .env  (never commit it):
#   ENTSOE_TOKEN=your-entsoe-token
npm start        # dashboard at http://localhost:3000
```

Other scripts (run with `node <file>`):

| File | Purpose |
|---|---|
| `server.js` | Proxy and API (`/api/intensity`, `/api/generation`), serves `public/` |
| `emissionFactors.js` | Factor table and intensity calculation, incl. two-pass storage |
| `calcCurve.js` (`npm run curve`) | Hourly curve for a period |
| `compare.js` | Comparison with GGC reference data in `reference/` |
| `marginal.js` | Task 2: marginal emission factor (regression) |
| `imports.js` | Extension: consumption mix with imports |
| `curtailment.js` | Extension: marginal factor by day-ahead price level (price proxy for surplus hours) |
| `uncertainty.js` | Task 2: uncertainty of the marginal factor (Newey–West standard error, block-bootstrap 95 % interval) |

## Known limitations

- No Eurostat scaling (about 13 g/kWh in the benchmark week) and no CHP allocation.
- Biomass: Scope 2 is set to 5 g/kWh, derived from GGC's operational export (emissions ÷ generation, stable over the benchmark week); this is not a published GGC factor. Life cycle is 53 g/kWh, implied by GGC's life-cycle export. An earlier value of 95 was a UBA figure (biomass provision plus non-CO₂ gases) and was wrongly used as Scope 2.
- Task 2 is not validated against an external source. Marginal-supplier shares are inferred from generation changes, without plant capacity or regional data.
- Curtailment is approximated by negative day-ahead prices. Published curtailment data (SMARD, Bundesnetzagentur) is monthly or quarterly and covers congestion redispatch, so we found no hourly series.
- Dashboard: the most recent hours can be incomplete because ENTSO-E publishes carriers with a delay; hours with very low total generation are hidden.
- ENTSO-E data is retrieved with a 3-hour delay; the most recent hours may be incomplete.

## References

- Hawkes (2010), Estimating marginal CO₂ emissions rates for national electricity systems, Energy Policy 38(10)
- Ekvall & Weidema (2004), System boundaries and input data in consequential LCA
- Fleschutz et al. (2021), Applied Energy 295, 117040
- IPCC AR5 WGIII Annex III (Schlömer et al. 2014)
- EU JRC emission factors (Covenant of Mayors); Green Grid Compass methodology report
