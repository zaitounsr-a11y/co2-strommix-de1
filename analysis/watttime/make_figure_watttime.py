"""Figure 9 for the reports: WattTime MOER against this study, full year 2024, operational basis.
Values come from compare_year.py (comparison_2024.json, data/by_hour_of_day_2024.csv)."""
import os, json, numpy as np, pandas as pd, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get("OUT", os.path.join(HERE, "..", "figures"))
BLUE, ORANGE, AQUA, GREY = "#2a78d6", "#eb6834", "#1baf7a", "#6f6e69"
INK, INK2, NEUTRAL, GRID = "#0b0b0b", "#52514e", "#b9b8b2", "#e6e5e0"
plt.rcParams.update({"font.family": ["Inter", "Arial", "DejaVu Sans"], "font.size": 9, "axes.edgecolor": NEUTRAL,
    "axes.linewidth": .6, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2, "xtick.labelsize": 8,
    "ytick.labelsize": 8, "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.color": GRID,
    "grid.linewidth": .6, "axes.axisbelow": True, "legend.frameon": False, "legend.fontsize": 8, "savefig.dpi": 220,
    "text.color": INK})

r = json.load(open(os.path.join(HERE, "comparison_2024.json")))
y, t = r["year"], r["thirds"]
series = [("System response", ORANGE, y["MEF_operational"], [t[k]["MEF_operational"] for k in ("low", "middle", "high")]),
          ("Fossil only", AQUA, y["MEF_fossil_only_operational"], [t[k]["MEF_fossil_only_operational"] for k in ("low", "middle", "high")]),
          ("WattTime", GREY, round(y["MOER_mean"]), [t[k]["MOER_mean"] for k in ("low", "middle", "high")])]
b = t["bounds_GW"]
bins = [f"Low\n{b[0]:.0f}–{b[1]:.0f} GW", f"Middle\n{b[1]:.0f}–{b[2]:.0f} GW", f"High\n{b[2]:.0f}–{b[3]:.0f} GW"]
hod = pd.read_csv(os.path.join(HERE, "data", "by_hour_of_day_2024.csv"))

fig, (a, c, d) = plt.subplots(1, 3, figsize=(9.6, 3.0), gridspec_kw={"width_ratios": [0.8, 1.15, 1.25]})
for i, (nm, col, v, _) in enumerate(series):
    a.bar(i, v, width=.62, color=col, edgecolor="white", linewidth=1.5)
    a.text(i, v + 15, str(v), ha="center", fontsize=8.5)
a.set_xticks(range(3)); a.set_xticklabels(["System\nresponse", "Fossil\nonly", "WattTime"])
a.set_ylim(0, 950); a.set_ylabel("g CO₂/kWh, operational"); a.grid(axis="x", visible=False)
a.set_title("a  Year average", fontsize=9, loc="left")

x = np.arange(3)
for nm, col, _, vals in series:
    c.plot(x, vals, color=col, lw=2, marker="o", ms=6, mec="white", mew=1.2)
    c.text(2.1, vals[-1], nm, va="center", fontsize=8, color=INK)
c.set_xticks(x); c.set_xticklabels(bins); c.set_xlim(-.2, 3.0); c.set_ylim(0, 950)
c.set_title("b  By residual-load level (thirds)", fontsize=9, loc="left"); c.grid(axis="x", visible=False)

d.plot(hod.h, hod.moer, color=GREY, lw=2)
d.plot(hod.h, hod.aef, color=BLUE, lw=2)
d.text(23.4, hod.moer.iloc[-1], "WattTime", va="center", fontsize=8)
d.text(23.4, hod.aef.iloc[-1], "Average\n(this study)", va="center", fontsize=8)
d.set_xticks([0, 6, 12, 18, 23]); d.set_xlim(0, 28.5); d.set_ylim(0, 950); d.set_xlabel("Hour of day, German time")
d.set_title("c  Mean by hour of day", fontsize=9, loc="left"); d.grid(axis="x", visible=False)
fig.tight_layout()
fig.savefig(os.path.join(OUT, "f10_watttime_comparison.png"), bbox_inches="tight", facecolor="white")
print("ok")
