"""Figures for the short report. Run: python3 make_figures.py
Data: repo reference CSVs + summer_pairs.json (pulled from the live app, 10-17 Jun 2024).
Figures 4-9 use values written out in this file; they come from
analysis/full_period/analyse_period.js (2024, both weeks, 2019) and analysis/watttime/."""
import csv, json, os, datetime as dt
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager

HERE = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(HERE, "..", "..", "reference")   # repo reference/ folder

# ---- palette (dataviz reference instance, light mode, validated) ----
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"   # AEF / MEF / third series
INK, INK2, MUTED, GRID = "#0b0b0b", "#52514e", "#8a8984", "#e6e5e0"
NEUTRAL = "#b9b8b2"                                     # de-emphasised marks

plt.rcParams.update({
    "font.family": ["Inter", "Arial", "DejaVu Sans"], "font.size": 9, "axes.edgecolor": NEUTRAL, "axes.linewidth": .6,
    "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2, "xtick.labelsize": 8,
    "ytick.labelsize": 8, "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": .6, "axes.axisbelow": True,
    "legend.frameon": False, "legend.fontsize": 8, "figure.dpi": 100, "savefig.dpi": 220,
    "text.color": INK,
})

def save(fig, name):
    fig.savefig(os.path.join(HERE, name), bbox_inches="tight", facecolor="white")
    plt.close(fig)

def rounded_bars(ax, x, h, w, color, horizontal=False, **kw):
    if horizontal:
        return ax.barh(x, h, height=w, color=color, edgecolor="white", linewidth=1.5, **kw)
    return ax.bar(x, h, width=w, color=color, edgecolor="white", linewidth=1.5, **kw)

# ---------- F1: own vs GGC, hourly, benchmark week ----------
rows = list(csv.DictReader(open(f"{REF}/vergleich_eigen_vs_ggc.csv")))
t = [dt.datetime.fromisoformat(r["timestamp"].replace("Z", "")) for r in rows]
own = np.array([float(r["eigen_lc"]) for r in rows]); ggc = np.array([float(r["ggc_lc"]) for r in rows])
fig, ax = plt.subplots(figsize=(6.6, 2.7))
ax.plot(t, ggc, color=AQUA, lw=2, label="Green Grid Compass (reference)")
ax.plot(t, own, color=BLUE, lw=2, label="This study")
ax.set_ylabel("g CO₂eq/kWh"); ax.set_ylim(0, 650)
ax.xaxis.set_major_formatter(matplotlib.dates.DateFormatter("%a %d.%m"))
ax.text(t[3], ggc[3] + 45, "Reference", color=INK, fontsize=8)
ax.legend(loc="upper left", ncol=2, bbox_to_anchor=(0, 1.13))
save(fig, "f1_own_vs_reference.png")
r = np.corrcoef(own, ggc)[0, 1]
print("F1 r", round(r, 4), "means", own.mean().round(1), ggc.mean().round(1))

# ---------- F2: share of generation vs share of emissions, benchmark week ----------
d = json.load(open(f"{HERE}/summer_pairs.json"))
LC = {"Braunkohle": 1097, "Steinkohle": 968, "Erdgas": 492, "Sonstige Konventionelle": 1384, "Biomasse": 53,
      "Wasserkraft": 24, "Pumpspeicher": 365, "Wind Onshore": 11, "Wind Offshore": 12, "Photovoltaik": 48,
      "Sonstige Erneuerbare": 48}
group = {"Lignite": ["Braunkohle"], "Hard coal": ["Steinkohle"], "Natural gas": ["Erdgas"],
         "Other conventional": ["Sonstige Konventionelle"], "Pumped storage": ["Pumpspeicher"],
         "Biomass": ["Biomasse"], "Solar": ["Photovoltaik"], "Wind": ["Wind Onshore", "Wind Offshore"],
         "Hydro and other RE": ["Wasserkraft", "Sonstige Erneuerbare"]}
G = sum(d["gen"].values()); E = sum(d["gen"][k] * LC[k] for k in d["gen"])
names = list(group)
gs = [100 * sum(d["gen"][k] for k in group[n]) / G for n in names]
es = [100 * sum(d["gen"][k] * LC[k] for k in group[n]) / E for n in names]
order = np.argsort(es)
fig, ax = plt.subplots(figsize=(6.6, 3.0))
y = np.arange(len(names)); w = .38
rounded_bars(ax, y[: len(names)] + w / 2, [gs[i] for i in order], w, NEUTRAL, horizontal=True, label="Share of generation")
rounded_bars(ax, y - w / 2, [es[i] for i in order], w, BLUE, horizontal=True, label="Share of emissions")
ax.set_yticks(y); ax.set_yticklabels([names[i] for i in order])
for yi, i in zip(y, order):
    ax.text(es[i] + .8, yi - w / 2, f"{es[i]:.0f} %", va="center", fontsize=7.5, color=INK)
    ax.text(gs[i] + .8, yi + w / 2, f"{gs[i]:.0f} %", va="center", fontsize=7.5, color=INK2)
ax.set_xlabel("% of weekly total"); ax.grid(axis="y", visible=False); ax.set_xlim(0, 62)
ax.legend(loc="lower right")
save(fig, "f2_generation_vs_emissions.png")
print("F2 lignite gen/em", round(gs[0], 1), round(es[0], 1), "mean intensity", round(E / G, 1))

# ---------- F3: the regression ----------
x = np.array(d["dR"]); yv = np.array(d["dE"]); xt = np.array(d["dT"])
b, a = np.polyfit(x, yv, 1); bt, at = np.polyfit(xt, yv, 1)
r2 = np.corrcoef(x, yv)[0, 1] ** 2; r2t = np.corrcoef(xt, yv)[0, 1] ** 2
fig, axs = plt.subplots(1, 2, figsize=(6.6, 2.9), sharey=True)
for ax, xx, bb, aa, rr, col, ttl in [(axs[0], xt, bt, at, r2t, NEUTRAL, "Against total generation"),
                                     (axs[1], x, b, a, r2, ORANGE, "Against residual load")]:
    ax.scatter(xx, yv, s=14, color=col, alpha=.75, edgecolor="white", linewidth=.5)
    xs = np.array([xx.min(), xx.max()]); ax.plot(xs, aa + bb * xs, color=INK, lw=1.4)
    ax.set_title(ttl, fontsize=9, loc="left", color=INK)
    ax.text(.03, .94, f"slope {bb*1000:.0f} g/kWh\nR² = {rr:.3f}", transform=ax.transAxes, va="top", fontsize=8, color=INK)
    ax.set_xlabel("Δ MWh per hour"); ax.axhline(0, color=NEUTRAL, lw=.6); ax.axvline(0, color=NEUTRAL, lw=.6)
axs[0].set_ylabel("Δ emissions, t CO₂eq per hour")
save(fig, "f3_regression.png")
print("F3", round(b * 1000, 1), round(r2, 3), round(bt * 1000, 1), round(r2t, 3))

# ---------- F4: AEF vs MEF, three periods, with 95 % intervals ----------
per = ["Summer week\n10–17 Jun 2024", "Winter week\n10–17 Dec 2023", "Full year\n2024"]
aef = [308.8, 477.6, 389.2]; mef = [562.1, 679.2, 554.9]
lo = [530, 646, 544]; hi = [584, 713, 566]                 # block bootstrap (24 h / 24 h / 168 h)
fig, ax = plt.subplots(figsize=(6.6, 2.9))
xx = np.arange(3); w = .34
rounded_bars(ax, xx - w / 2, aef, w, BLUE, label="Average (AEF)")
rounded_bars(ax, xx + w / 2, mef, w, ORANGE, label="Marginal (MEF), with 95 % interval")
ax.errorbar(xx + w / 2, mef, yerr=[np.subtract(mef, lo), np.subtract(hi, mef)], fmt="none", ecolor=INK, elinewidth=1, capsize=3)
for i in range(3):
    ax.text(xx[i] - w / 2, aef[i] + 12, f"{aef[i]:.0f}", ha="center", fontsize=8, color=INK)
    ax.text(xx[i] + w / 2 + .03, hi[i] + 12, f"{mef[i]:.0f}", ha="center", fontsize=8, color=INK)
    ax.text(xx[i], -95, f"ratio {mef[i]/aef[i]:.2f}", ha="center", fontsize=8, color=INK2)
ax.set_xticks(xx); ax.set_xticklabels(per); ax.set_ylabel("g CO₂eq/kWh"); ax.set_ylim(0, 800)
ax.grid(axis="x", visible=False); ax.legend(loc="upper left", ncol=2, bbox_to_anchor=(0, 1.12))
ax.tick_params(axis="x", pad=18)
save(fig, "f4_aef_vs_mef.png")

# ---------- F5: monthly 2024 ----------
mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
m_mef = [622, 631, 597, 548, 512, 564, 550, 523, 523, 551, 522, 542]
m_aef = [393, 374, 397, 325, 349, 360, 369, 394, 371, 442, 478, 414]
fig, ax = plt.subplots(figsize=(6.6, 2.8))
ax.plot(mo, m_mef, color=ORANGE, lw=2, marker="o", ms=5, mec="white", mew=1.2, label="Marginal (MEF)")
ax.plot(mo, m_aef, color=BLUE, lw=2, marker="o", ms=5, mec="white", mew=1.2, label="Average (AEF)")
ax.text(11.15, m_mef[-1], "MEF", va="center", fontsize=8, color=INK)
ax.text(11.15, m_aef[-1], "AEF", va="center", fontsize=8, color=INK)
for i, lab in [(3, "ratio 1.69"), (10, "ratio 1.09")]:
    ax.text(i + 0.15, (m_mef[i] + 45) if i == 10 else (m_mef[i] + m_aef[i]) / 2, lab, fontsize=8, color=INK2, va="center",
            ha="center" if i == 10 else "left")
    ax.plot([i, i], [m_aef[i], m_mef[i]], color=NEUTRAL, lw=1, ls=":")
ax.set_ylim(0, 700); ax.set_ylabel("g CO₂eq/kWh"); ax.grid(axis="x", visible=False)
ax.legend(loc="lower left", ncol=2)
save(fig, "f5_monthly_2024.png")
print("F5 corr", round(np.corrcoef(m_mef, m_aef)[0, 1], 2))

# ---------- F6: what responds (decomposition), 2024 ----------
car = ["Pumped storage", "Natural gas", "Lignite", "Hard coal", "Biomass", "Hydro", "Other conventional"]
sh = [36.0, 27.4, 17.7, 10.1, 5.0, 3.1, 0.6]
fossil = [False, True, True, True, False, False, True]
fig, ax = plt.subplots(figsize=(6.6, 2.6))
yy = np.arange(len(car))[::-1]
rounded_bars(ax, yy, sh, .62, [ORANGE if f else NEUTRAL for f in fossil], horizontal=True)
ax.set_yticks(yy); ax.set_yticklabels(car); ax.grid(axis="y", visible=False)
for y_, v in zip(yy, sh): ax.text(v + .6, y_, f"{v:.1f} %", va="center", fontsize=8, color=INK)
ax.set_xlabel("Share of one additional MWh of residual load, full year 2024"); ax.set_xlim(0, 42)
from matplotlib.patches import Patch
ax.legend(handles=[Patch(color=ORANGE, label="Fossil (56 % together)"), Patch(color=NEUTRAL, label="Not fossil")], loc="lower right")
save(fig, "f6_what_responds.png")

# ---------- F7: storage convention ----------
conv = ["Storage counted\nas zero", "Fixed 430 g/kWh\n(reported)", "Storage at\nMEF ÷ 0.80"]
vals = {"Summer week": [412, 562, 731], "Winter week": [580, 679, 815], "Full year 2024": [400, 555, 727]}
cols = [BLUE, ORANGE, AQUA]
fig, ax = plt.subplots(figsize=(6.6, 2.9))
xx = np.arange(3); w = .26
for k, (nm, v) in enumerate(vals.items()):
    rounded_bars(ax, xx + (k - 1) * w, v, w, cols[k], label=nm)
    for i in range(3): ax.text(xx[i] + (k - 1) * w, v[i] + 12, str(v[i]), ha="center", fontsize=7.5, color=INK)
ax.set_xticks(xx); ax.set_xticklabels(conv); ax.set_ylabel("MEF, g CO₂eq/kWh"); ax.set_ylim(0, 900)
ax.grid(axis="x", visible=False); ax.legend(loc="upper left", ncol=3, bbox_to_anchor=(0, 1.12))
save(fig, "f7_storage_convention.png")

# ---------- F8: price regimes, 2024 ----------
rows = list(csv.DictReader(open(f"{REF}/abregelung_analyse.csv")))
reg = {"Surplus\n(price < 0)": [], "Transition\n(0–20 €/MWh)": [], "Normal\n(≥ 20 €/MWh)": []}
for r_ in rows:
    p = float(r_["preis_eur_mwh"]); k = list(reg)[0 if p < 0 else 1 if p < 20 else 2]
    reg[k].append(float(r_["aef_g_kwh"]))
hours = [340, 593, 7827]   # from the live-data run in the report (CSV prices are rounded: 339/594)
reg_aef = [168, 195, 413]; reg_mef = [379, 533, 555]; rlo = [297, 482, 550]; rhi = [450, 583, 562]
fig, ax = plt.subplots(figsize=(6.6, 2.9))
xx = np.arange(3); w = .34
rounded_bars(ax, xx - w / 2, reg_aef, w, BLUE, label="Average (AEF)")
rounded_bars(ax, xx + w / 2, reg_mef, w, ORANGE, label="Marginal (MEF), with 95 % interval")
ax.errorbar(xx + w / 2, reg_mef, yerr=[np.subtract(reg_mef, rlo), np.subtract(rhi, reg_mef)], fmt="none", ecolor=INK, elinewidth=1, capsize=3)
for i in range(3):
    ax.text(xx[i] - w / 2, reg_aef[i] + 12, str(reg_aef[i]), ha="center", fontsize=8)
    ax.text(xx[i] + w / 2 + .03, rhi[i] + 12, str(reg_mef[i]), ha="center", fontsize=8)
ax.set_xticks(xx); ax.set_xticklabels([f"{k}\n{h:,} h" for k, h in zip(reg, hours)])
ax.set_ylabel("g CO₂eq/kWh"); ax.set_ylim(0, 700); ax.grid(axis="x", visible=False)
ax.legend(loc="upper left", ncol=2, bbox_to_anchor=(0, 1.12))
save(fig, "f8_price_regimes.png")
print("F8 hours", hours, "AEF means", [round(np.mean(v)) for v in reg.values()])

# ---------- F9: elmada comparison, Germany 2019 ----------
labs = ["This study,\nheadline (life cycle)", "This study,\noperational factors", "This study,\nfossil plants only", "elmada\n(merit order)"]
v9 = [671, 623, 823, 890]
fig, ax = plt.subplots(figsize=(6.6, 2.6))
rounded_bars(ax, np.arange(4), v9, .55, [ORANGE, ORANGE, ORANGE, NEUTRAL])
for i, v in enumerate(v9): ax.text(i, v + 15, ("≈ " if i == 3 else "") + str(v), ha="center", fontsize=8.5)
ax.set_xticks(range(4)); ax.set_xticklabels(labs); ax.set_ylabel("MEF 2019, g CO₂eq/kWh"); ax.set_ylim(0, 1000)
ax.grid(axis="x", visible=False)
save(fig, "f9_elmada_2019.png")
print("done")
