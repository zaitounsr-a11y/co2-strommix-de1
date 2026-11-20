"""Binned regressions (Siler-Evans et al. 2012 style), benchmark week 10-17 June 2024, operational factors.
Compares this study's two definitions with WattTime's MOER in the same residual-load bins."""
import warnings; warnings.filterwarnings('ignore')
import os, json, sys
import pandas as pd, numpy as np
HERE=os.path.dirname(os.path.abspath(__file__))
WT=os.path.join(HERE,'data','WattTime_MOER_June_10-17_2024.xlsx')   # not in the repo: provided by the chair, do not redistribute
g=pd.read_csv(os.path.join(HERE,'entsoe_2024-06-09T22_to_06-18T01.csv'),parse_dates=['utc']).set_index('utc')
S2={'Braunkohle':1074,'Steinkohle':844,'Erdgas':381,'Sonstige Konventionelle':1348,'Biomasse':5,'Pumpspeicher':392}
VRE=['Wind Onshore','Wind Offshore','Photovoltaik']; FOS=['Braunkohle','Steinkohle','Erdgas','Sonstige Konventionelle']
wk=(g.index>='2024-06-10')&(g.index<'2024-06-17'); G=g[wk]
res=G.sum(axis=1)-G[VRE].sum(axis=1); em=sum(G[k]*S2.get(k,0) for k in G.columns)/1000
fos=G[FOS].sum(axis=1); efos=sum(G[k]*S2[k] for k in FOS)/1000
wt=pd.read_excel(WT); wt.columns=['t','m']
wt['t']=wt.t.dt.ceil('h')    # UTC; row hh:59:59.999 = average of hh+1:00..hh+1:55 (checked against raw 5-min data)
m=wt.set_index('t').m.reindex(G.index)
D=lambda s: s.diff().iloc[1:]
dR,dE,dF,dEF=D(res),D(em),D(fos),D(efos); lvl=res.iloc[1:]; mm=m.iloc[1:]
sl=lambda x,y: np.polyfit(x,y,1)[0]*1000
out=[]
for nb in (2,3):
    q=pd.qcut(lvl,nb,labels=False)
    for b in range(nb):
        k=q==b
        out.append({'bins':nb,'bin':b+1,'residual_load_GW':f"{lvl[k].min()/1000:.0f}-{lvl[k].max()/1000:.0f}",
                    'system_response':round(sl(dR[k],dE[k])),'fossil_only':round(sl(dF[k],dEF[k])),'WattTime_mean':round(mm[k].mean())})
df=pd.DataFrame(out); print(df.to_string(index=False)); df.to_csv(os.path.join(HERE,'binned_by_residual_load.csv'),index=False)
print('whole week: system',round(sl(dR,dE)),' fossil-only',round(sl(dF,dEF)),' WattTime mean',round(mm.mean()),' nonzero',round(mm[mm>0].mean()))
