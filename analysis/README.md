# Analysis scripts for the final report

These scripts reproduce the numbers and figures of the final report. They sit next to the
application code in the repository root, which they use (`emissionFactors.js`, `uncertainty.js`,
`reference/`).

## Requirements

- Node.js 18 or newer (for `fetch`), and the local server running with `npm start`
  (needs an ENTSO-E token in `.env`). Alternatively set `PROXY=https://co2-strommix-de1.onrender.com`.
- Python 3.10 or newer with `pandas`, `numpy`, `matplotlib` and `openpyxl`:
  `pip install pandas numpy matplotlib openpyxl`

## What reproduces what

| Script | Reproduces | Report section |
|---|---|---|
| `../uncertainty.js 2024-06-10 2024-06-17` | Marginal factor with Newey–West standard error and block-bootstrap interval | 6.5 |
| `full_period/analyse_period.js 2024-06-10 2024-06-17` | Benchmark week: marginal factor, low/high split, operational and fossil-only values, decomposition, storage sensitivity, Method B | 6.1–6.7, 9.5 |
| `full_period/analyse_period.js 2023-12-10 2023-12-17` | Winter week, same values | 6.5–6.7 |
| `full_period/analyse_period.js 2024-01-01 2025-01-01` | Full year 2024, plus monthly values and weekly range | 6.5–6.7, 9.1, 9.2 |
| `full_period/analyse_period.js 2019-01-01 2020-01-01` | 2019, this study's side of the elmada comparison | 6.8 |
| `watttime/compare_year.py` | WattTime against this study, full year 2024: averages, residual-load thirds, months, hour of day, benchmark week from raw data | 6.9 |
| `watttime/compare.py` | WattTime against this study, benchmark week: averages, correlations, Method B | 6.9 |
| `watttime/binned.py` | Benchmark week in thirds and halves of residual load | 6.9 |
| `watttime/make_figure_watttime.py` | WattTime figure (full year 2024) | Figure 9 |
| `figures/make_figures.py` | All other report figures | Figures 1–8, 10 |

Run the Node scripts from the repository root, for example:

```bash
node analysis/full_period/analyse_period.js 2024-06-10 2024-06-17
OUT=analysis/full_period/year_2024.json node analysis/full_period/analyse_period.js 2024-01-01 2025-01-01
```

The full year loads in 14-day pieces and takes a few minutes. Run the Python scripts from any
folder, for example `python analysis/watttime/compare.py`.

`analyse_period.js` was checked against the benchmark week: it gives 562 g CO₂eq/kWh (R² 0.936),
an average of 308.8, a storage factor of 365, 545 with operational factors and 742 for fossil plants
only, the same values as the report.

Figure files and report figure numbers: `f2` → Figure 1, `f1` → Figure 2, `f3`–`f7` → Figures 3–7,
`f9` → Figure 8, `f10` → Figure 9, `f8` → Figure 10.

## WattTime data are not in this repository

The WattTime marginal operating emission rate was provided by the supervising chair. WattTime's
terms allow publishing results based on the data, not passing on the data. To run the WattTime
scripts, place the two files listed in `watttime/data/README.md` in `watttime/data/`. That folder is
excluded from Git, and the scripts write their hour-by-hour outputs there as well, because those
contain WattTime values. Only aggregated results (`comparison_2024.json`, `monthly_2024.csv`,
`comparison_results.json`, `binned_by_residual_load.csv`) are committed.

- The 2024 file holds WattTime's raw 5-minute values in lbs/MWh, UTC. `compare_year.py` converts them
  to g CO2/kWh (x 0.453592) and averages the twelve values of each UTC hour.
- The benchmark-week xlsx holds hourly values in g CO2/kWh. Checked against the raw 5-minute data,
  the row shown as hh:59:59.999 holds the average for the hour starting at hh+1:00 UTC, so the
  scripts use `ceil('h')`.

`watttime/entsoe_2024_hourly.csv` (full year) and `watttime/entsoe_2024-06-09T22_to_06-18T01.csv`
(benchmark week) hold the public ENTSO-E generation data, as served by the application, so the
comparisons run without the server.

When citing the WattTime data, use the format of WattTime's licence: WattTime API, "CO2 Marginal
Operating Emissions Rate" [Data set], retrieved from api.watttime.org, accessed 10 July 2025, with
Siler-Evans et al. (2012), Callaway et al. (2018) and WattTime, "Methodology + Validation".

## Limits of this folder

- The `elmada` side of the 2019 comparison was run with the `elmada` Python package (version 0.1.0,
  cached data, no token). That run is not scripted here.
- Figures 4 to 8 and 10 use values written out in `make_figures.py`. They are the outputs of the
  scripts above; rerun those scripts to check them.
