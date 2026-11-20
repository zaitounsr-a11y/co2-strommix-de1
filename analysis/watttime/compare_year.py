"""WattTime MOER (DE, 2024, 5-minute, lbs/MWh, UTC) against this study, full year 2024.

Inputs:
  data/DE_co2_moer_2024-01-01_2025-01-01.csv   WattTime raw API export (not in the repo: provided by the chair, do not redistribute)
  entsoe_2024_hourly.csv                       ENTSO-E generation by carrier, MWh per UTC hour (public, as served by the app)
Outputs: comparison_2024.json and monthly_2024.csv (aggregated, committed); data/by_hour_of_day_2024.csv (stays in data/).
Conversion: 1 lb/MWh = 0.453592 g/kWh. Hourly MOER = mean of the twelve 5-minute values starting at the full hour (UTC).
All of this study's values here are operational (Scope 2), to match WattTime.
"""
import json, os, warnings
import numpy as np, pandas as pd
warnings.filterwarnings("ignore")
HERE = os.path.dirname(os.path.abspath(__file__))
LB = 0.453592
S2 = {"Braunkohle": 1074, "Steinkohle": 844, "Erdgas": 381, "Sonstige Konventionelle": 1348, "Biomasse": 5}
LC = {"Braunkohle": 1097, "Steinkohle": 968, "Erdgas": 492, "Sonstige Konventionelle": 1384, "Biomasse": 53,
      "Wind Onshore": 11, "Wind Offshore": 12, "Photovoltaik": 48, "Wasserkraft": 24, "Sonstige Erneuerbare": 48}
VRE = ["Wind Onshore", "Wind Offshore", "Photovoltaik"]
FOS = ["Braunkohle", "Steinkohle", "Erdgas", "Sonstige Konventionelle"]
ST = "Pumpspeicher"

# ---------- data ----------
wt5 = pd.read_csv(os.path.join(HERE, "data", "DE_co2_moer_2024-01-01_2025-01-01.csv"), parse_dates=["point_time"])
wt5 = wt5.set_index("point_time")["value"] * LB
wt5.index = wt5.index.tz_localize(None)
moer = wt5.resample("h").mean()                       # hour-beginning average
n5 = wt5.resample("h").size()

g = pd.read_csv(os.path.join(HERE, "entsoe_2024_hourly.csv"))
g.index = pd.to_datetime(g.pop("utc"), format="%Y-%m-%dT%H")
g = g[g.sum(axis=1) > 0]
tot = g.sum(axis=1); res = tot - g[VRE].sum(axis=1)
nos = [k for k in g.columns if k != ST]
e2_nos = sum(g[k] * S2.get(k, 0) for k in nos) / 1000          # t CO2, operational, without storage
st_op = e2_nos.sum() * 1000 / g[nos].sum().sum() / 0.8          # year storage factor, operational
aef = (e2_nos + g[ST] * st_op / 1000) * 1000 / tot              # g/kWh, operational average
em392 = e2_nos + g[ST] * 392 / 1000                             # regression uses fixed 392, as in the report
emlc = sum(g[k] * LC.get(k, 0) for k in nos) / 1000 + g[ST] * 430 / 1000
fos = g[FOS].sum(axis=1); efos = sum(g[k] * S2[k] for k in FOS) / 1000

def slope(x, y):
    m = x.notna() & y.notna(); return float(np.polyfit(x[m], y[m], 1)[0] * 1000)

def mef(mask=None):
    """Regression slopes on hourly first differences; mask selects the END hour of each pair (consecutive hours only)."""
    d = pd.DataFrame({"dR": res.diff(), "dE": em392.diff(), "dF": fos.diff(), "dEF": efos.diff(), "dL": emlc.diff()})
    d = d[g.index.to_series().diff() == pd.Timedelta(hours=1)]
    if mask is not None: d = d[mask.reindex(d.index).fillna(False)]
    return {"MEF_operational": round(slope(d.dR, d.dE)), "MEF_fossil_only_operational": round(slope(d.dF, d.dEF)),
            "MEF_lifecycle": round(slope(d.dR, d.dL)), "pairs": len(d)}

j = pd.concat({"moer": moer, "aef": aef, "res": res}, axis=1).dropna()
out = {"coverage": {"wt_5min_values": int(len(wt5)), "wt_hours": int(moer.notna().sum()),
                    "wt_hours_incomplete": int((n5 < 12).sum()), "entsoe_hours": int(len(g)), "overlap_hours": int(len(j))},
       "storage_factor_operational_year": round(st_op, 1)}

# ---------- year ----------
out["year"] = {"MOER_mean": round(moer.mean(), 1), "MOER_median": round(moer.median(), 1),
               "MOER_share_zero_hours_pct": round(100 * (moer == 0).mean(), 1),
               "MOER_mean_nonzero": round(moer[moer > 0].mean(), 1),
               "MOER_p10_p90": [round(moer.quantile(.1)), round(moer.quantile(.9))],
               "AEF_operational_mean": round(aef.mean(), 1), **mef(),
               "corr_MOER_AEF": round(j.moer.corr(j.aef), 3), "corr_MOER_residual": round(j.moer.corr(j.res), 3)}

# ---------- residual-load thirds (year) ----------
q = j.res.quantile([1/3, 2/3]).values
lab = pd.Series(np.where(res <= q[0], "low", np.where(res <= q[1], "middle", "high")), index=res.index)
out["thirds"] = {"bounds_GW": [round(res.min()/1000, 1), round(q[0]/1000, 1), round(q[1]/1000, 1), round(res.max()/1000, 1)]}
for k in ["low", "middle", "high"]:
    m = lab == k
    mo = moer.reindex(m.index)[m]
    out["thirds"][k] = {"MOER_mean": round(mo.mean()), "MOER_share_zero_pct": round(100 * (mo == 0).mean(), 1),
                        **{kk: v for kk, v in mef(m).items() if kk != "MEF_lifecycle"}}

# ---------- months ----------
mon = {}
for p, _ in g.groupby(g.index.to_period("M")):
    m = pd.Series(g.index.to_period("M") == p, index=g.index)
    r = mef(m); mm = moer[moer.index.to_period("M") == p]
    mon[str(p)] = {"MOER_mean": round(mm.mean()), "MOER_zero_pct": round(100 * (mm == 0).mean(), 1),
                   "MEF_operational": r["MEF_operational"], "MEF_fossil_only_operational": r["MEF_fossil_only_operational"],
                   "AEF_operational": round(aef[m].mean())}
out["monthly"] = mon
mdf = pd.DataFrame(mon).T
out["monthly_corr"] = {"MOER_vs_MEF_operational": round(mdf.MOER_mean.corr(mdf.MEF_operational), 2),
                       "MOER_vs_MEF_fossil_only": round(mdf.MOER_mean.corr(mdf.MEF_fossil_only_operational), 2),
                       "MOER_vs_AEF": round(mdf.MOER_mean.corr(mdf.AEF_operational), 2)}

# ---------- hour of day (German local time) ----------
loc = j.index.tz_localize("UTC").tz_convert("Europe/Berlin").hour
hod = j.assign(h=loc).groupby("h")[["moer", "aef"]].mean().round(0)
hod.to_csv(os.path.join(HERE, "data", "by_hour_of_day_2024.csv"))
out["hour_of_day"] = {"MOER_min_hour": int(hod.moer.idxmin()), "MOER_min": int(hod.moer.min()),
                      "MOER_max_hour": int(hod.moer.idxmax()), "MOER_max": int(hod.moer.max()),
                      "AEF_min_hour": int(hod.aef.idxmin()), "AEF_max_hour": int(hod.aef.idxmax()),
                      "corr_profiles": round(hod.moer.corr(hod.aef), 2)}

# ---------- benchmark week redone from raw 5-minute data ----------
wk = (j.index >= "2024-06-10") & (j.index < "2024-06-17")
w = j[wk]; qw = w.res.quantile([1/3, 2/3]).values
out["june_week_raw"] = {"MOER_mean": round(w.moer.mean(), 1), "MOER_median": round(w.moer.median(), 1),
                        "corr_MOER_AEF": round(w.moer.corr(w.aef), 3), "corr_MOER_residual": round(w.moer.corr(w.res), 3),
                        "MOER_thirds": [round(w.moer[w.res <= qw[0]].mean()), round(w.moer[(w.res > qw[0]) & (w.res <= qw[1])].mean()),
                                        round(w.moer[w.res > qw[1]].mean())]}

pd.DataFrame(mon).T.to_csv(os.path.join(HERE, "monthly_2024.csv"))
json.dump(out, open(os.path.join(HERE, "comparison_2024.json"), "w"), indent=1)
print(json.dumps(out, indent=1))
