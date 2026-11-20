Place the WattTime files here (provided by the supervising chair):

- `DE_co2_moer_2024-01-01_2025-01-01.csv`: raw 5-minute MOER for 2024, UTC, lbs/MWh (used by `compare_year.py`)
- `WattTime_MOER_June_10-17_2024.xlsx`: hourly MOER for the benchmark week, g CO2/kWh (used by `compare.py`, `binned.py`)

This folder is excluded from Git: WattTime's terms do not allow redistributing the data.
The scripts also write their hour-by-hour outputs here, because those contain WattTime values.
