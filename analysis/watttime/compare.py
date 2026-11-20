"""Compare WattTime MOER (operational, g CO2/kWh) with this study, 10-17 June 2024.
Timestamps: UTC, confirmed by M. Mohr (19 Nov 2026). Each value is the average of WattTime's 5-minute
values for one hour. Checked against WattTime's raw 5-minute export for 2024 (sent 20 Nov 2026): the row shown as
hh:59:59.999 holds the average of the 5-minute values from hh+1:00 to hh+1:55 UTC, so ceil('h') gives the hour start. The earlier CEST reading (shift -2 h) is kept below only as a sensitivity check."""
import warnings; warnings.filterwarnings('ignore')
import os, json, sys
import pandas as pd, numpy as np
HERE=os.path.dirname(os.path.abspath(__file__))
WT=os.path.join(HERE,'data','WattTime_MOER_June_10-17_2024.xlsx')   # not in the repo: provided by the chair, do not redistribute
g=pd.read_csv(os.path.join(HERE,'entsoe_2024-06-09T22_to_06-18T01.csv'),parse_dates=['utc']).set_index('utc')
S2={'Braunkohle':1074,'Steinkohle':844,'Erdgas':381,'Sonstige Konventionelle':1348,'Biomasse':5}
VRE=['Wind Onshore','Wind Offshore','Photovoltaik']; FOS=['Braunkohle','Steinkohle','Erdgas','Sonstige Konventionelle']
DISP=FOS+['Biomasse','Pumpspeicher']
def load_wt(shift):
    wt=pd.read_excel(WT); wt.columns=['t','moer']
    wt['t']=wt['t'].dt.ceil('h')+pd.Timedelta(hours=shift); return wt.set_index('t')['moer']
tot=g.sum(axis=1); res=tot-g[VRE].sum(axis=1)
# operational emissions; storage = scope-2 grid intensity without storage / 0.8 over the benchmark week
wk=(g.index>='2024-06-10')&(g.index<'2024-06-17')
nos=[k for k in g.columns if k!='Pumpspeicher']
e_nos=sum(g[k]*S2.get(k,0) for k in nos)/1000
st=(e_nos[wk].sum()*1000/g.loc[wk,nos].sum().sum())/0.8
em=e_nos+g['Pumpspeicher']*st/1000
aef=em*1000/tot
fos=g[FOS].sum(axis=1); efos=sum(g[k]*S2[k] for k in FOS)/1000
def slope(x,y): return np.polyfit(x,y,1)[0]*1000, np.corrcoef(x,y)[0,1]**2
out={}
for label,shift in [('UTC',0),('CEST_old_assumption',-2)]:
    m=load_wt(shift)
    idx=g.index[wk]; mm=m.reindex(idx)
    o={'hours_overlap':int(mm.notna().sum()),'MOER_mean':round(mm.mean(),1),'MOER_median':round(mm.median(),1),
       'MOER_zero_hours':int((mm==0).sum()),'MOER_mean_nonzero':round(mm[mm>0].mean(),1)}
    # hourly marginal fuel (method B, storage excluded), operational factor
    mf=[]
    for i in range(1,len(idx)):
        a,b=idx[i-1],idx[i]; d=res[b]-res[a]
        c=[(k,g.at[b,k]-g.at[a,k]) for k in FOS+['Biomasse']]
        c=[x for x in c if np.sign(x[1])==np.sign(d) and x[1]!=0]
        mf.append(S2[max(c,key=lambda x:abs(x[1]))[0]] if c else np.nan)
    mf=pd.Series(mf,index=idx[1:])
    j=pd.concat([mm,aef,res,mf],axis=1,keys=['m','aef','res','mf']).dropna()
    o['corr_MOER_AEF']=round(j.m.corr(j.aef),3); o['corr_MOER_residual']=round(j.m.corr(j.res),3)
    o['corr_MOER_methodB_factor']=round(j.m.corr(j.mf),3); o['methodB_mean']=round(j.mf.mean(),1)
    # residual-load halves
    med=j.res.median(); o['MOER_low_res']=round(j.m[j.res<=med].mean(),1); o['MOER_high_res']=round(j.m[j.res>med].mean(),1)
    out[label]=o
dR=res[wk].diff().dropna(); 
em392=e_nos+g['Pumpspeicher']*392/1000   # regression uses the fixed operational storage factor, as in the report
out['ours']={'MEF_operational':[round(v,3) for v in slope(dR,em392[wk].diff().dropna())],
             'MEF_fossil_only_operational':[round(v,3) for v in slope(fos[wk].diff().dropna(),efos[wk].diff().dropna())],
             'AEF_operational_mean':round(aef[wk].mean(),1),'storage_factor_op':round(st,1)}
# by hour of day (CEST shift), local time
m=load_wt(0).reindex(g.index[wk]); loc=(g.index[wk]+pd.Timedelta(hours=2)).hour   # hour of day shown in German local time
hod=pd.DataFrame({'moer':m.values,'aef':aef[wk].values,'h':loc}).groupby('h').mean().round(0)
hod.to_csv(os.path.join(HERE,'data','by_hour_of_day.csv'))   # contains WattTime values: stays in data/
pd.DataFrame({'utc':g.index[wk],'moer_wattTime':m.values,'aef_operational_this_study':aef[wk].round(1).values,'residual_load_MWh':res[wk].values}).to_csv(os.path.join(HERE,'data','hourly_comparison.csv'),index=False)   # contains WattTime values: stays in data/
json.dump(out,open(os.path.join(HERE,'comparison_results.json'),'w'),indent=1); print(json.dumps(out,indent=1)); print(hod.T.to_string())
