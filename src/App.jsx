import { useState, useEffect, useMemo, useRef } from 'react';
import {
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Area, AreaChart, Legend, Line, ComposedChart, LineChart,
} from 'recharts';
import { parseImport, readFileAsText } from './csvParser';
import * as S from './store';

/* ═══ HELPERS ═══ */
const f=(v,t='eur')=>{if(v==null||isNaN(v))return'–';if(t==='eur')return v.toLocaleString('de-DE',{style:'currency',currency:'EUR',minimumFractionDigits:0,maximumFractionDigits:0});if(t==='eur2')return v.toLocaleString('de-DE',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:2});if(t==='num')return Math.round(v).toLocaleString('de-DE');if(t==='pct')return(v*100).toFixed(1)+'%';return String(v)};
const cmp=v=>v>=1e6?(v/1e6).toFixed(1)+'M':v>=1e3?(v/1e3).toFixed(0)+'k':v.toFixed(0);
const cl=(v,a,b)=>Math.max(a,Math.min(b,v));
const C=['#FF9900','#0064D2','#2ecc71','#e74c3c','#9b59b6','#f39c12','#1abc9c','#e67e22','#2c3e50','#d35400'];
const TT=({active,payload,label})=>{if(!active||!payload?.length)return null;return(<div className="bg-[#1e293b] border border-white/10 rounded-lg p-2.5 text-xs shadow-2xl"><div className="font-semibold text-slate-300 mb-1">{label}</div>{payload.map((p,i)=><div key={i} className="flex justify-between gap-4"><span style={{color:p.color}}>{p.name}</span><span className="font-mono font-bold text-white">{typeof p.value==='number'?f(p.value):p.value}</span></div>)}</div>)};

/* ═══ UI COMPONENTS ═══ */
const Badge=({value,invert})=>{if(value==null||isNaN(value))return<span className="text-slate-600 text-xs">–</span>;const pos=invert?value<=0:value>=0;return<span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${pos?'bg-emerald-500/15 text-emerald-400':'bg-red-500/15 text-red-400'}`}>{pos?'▲':'▼'}{Math.abs(value*100).toFixed(1)}%</span>};
const KPI=({label,value,format='eur',icon,color='#FF9900',sub,trend,sm})=>(<div className={`glass rounded-2xl ${sm?'p-3':'p-4'} relative overflow-hidden glow-card`}><div className="absolute -top-8 -right-8 w-24 h-24 rounded-full opacity-15" style={{background:`radial-gradient(circle,${color}60,transparent)`}}/><div className="flex justify-between items-start mb-1"><div className={`${sm?'text-[9px]':'text-[10px]'} text-slate-500 font-semibold uppercase tracking-wide`}>{icon} {label}</div>{trend!=null&&<Badge value={trend}/>}</div><div className={`${sm?'text-base':'text-xl lg:text-2xl'} font-bold text-white font-mono tracking-tight`}>{f(value,format)}</div>{sub&&<div className="text-[10px] text-slate-500 mt-1">{sub}</div>}</div>);
const GoalRing=({current,target,label,color='#FF9900'})=>{const pct=target>0?cl(current/target,0,1.5):0;const c=pct>=1?'#2ecc71':pct>=0.75?'#2ecc71':pct>=0.5?'#f1c40f':'#e74c3c';const st=pct>=1?'✅ Erreicht':pct>=0.75?'🟢 Kurs':pct>=0.5?'🟡 Machbar':'🔴 Kritisch';return(<div className="flex flex-col items-center gap-1.5"><div className="relative w-[100px] h-[100px]"><svg viewBox="0 0 100 100" className="w-full h-full -rotate-90"><circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7"/><circle cx="50" cy="50" r="42" fill="none" stroke={c} strokeWidth="7" strokeDasharray={`${cl(pct,0,1)*264} 264`} strokeLinecap="round" className="transition-all duration-700"/></svg><div className="absolute inset-0 flex items-center justify-center"><span className="text-lg font-bold text-white font-mono">{Math.round(pct*100)}%</span></div></div><div className="text-[10px] text-slate-400 text-center max-w-[110px]">{label}</div><div className="text-[10px] font-bold" style={{color:c}}>{st}</div></div>)};

/* ═══ COMPARISON CARD ═══ */
const CompCard=({comp})=>{if(!comp) return null;return(<div className="glass rounded-2xl p-4"><div className="text-xs font-bold text-white mb-0.5">{comp.label}</div><div className="text-[10px] text-slate-500 mb-3">{comp.currentLabel} vs. {comp.previousLabel}</div><div className="space-y-2">{Object.entries(comp.data).map(([k,v])=>{const labels={revenue:'Umsatz',orders:'Bestellungen',units:'Einheiten',refunds:'Erstattungen',net:'Netto'};return(<div key={k} className="flex items-center justify-between"><span className="text-[11px] text-slate-400">{labels[k]||k}</span><div className="flex items-center gap-2"><span className="text-xs font-mono text-white">{k==='orders'||k==='units'||k==='refunds'?f(v.current,'num'):f(v.current)}</span><Badge value={v.change}/></div></div>)})}</div></div>)};

/* ═══ UPLOAD MODAL ═══ */
function UploadModal({onClose,onImported}){
  const[dragOver,setDragOver]=useState(false);
  const[parsing,setParsing]=useState(false);
  const[result,setResult]=useState(null);
  const[error,setError]=useState('');
  const[success,setSuccess]=useState('');
  const fileRef=useRef(null);

  const handleFile=async(file)=>{
    setParsing(true);setError('');setResult(null);
    try{
      const text=await readFileAsText(file);
      if(!text?.trim()){setError('Datei ist leer.');setParsing(false);return;}
      const parsed=parseImport(text);
      if(!parsed?.daily?.length){setError('Keine Daten erkannt.');setParsing(false);return;}
      // Auto-save
      S.saveMarketplace(parsed.marketplace, parsed);
      const mp=S.MARKETPLACES.find(m=>m.id===parsed.marketplace);
      setSuccess(`✅ ${mp?.name||parsed.marketplace}: ${parsed.meta.orders} Bestellungen, ${f(parsed.meta.revenue)} importiert! (${parsed.daily.length} Tage)`);
      if(onImported)onImported();
      setTimeout(()=>{setSuccess('');setResult(null);onClose();},1800);
    }catch(e){console.error(e);setError('Fehler: '+(e.message||'Unbekannt'));}
    setParsing(false);
  };

  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#1e293b] rounded-2xl border border-white/10 w-full max-w-lg mx-4 shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div><div className="text-lg font-bold text-white">Report importieren</div><div className="text-xs text-slate-500 mt-0.5">Amazon oder eBay Report hochladen</div></div>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/10">✕</button>
        </div>
        <div className="p-5 space-y-4">
          {success&&<div className="bg-emerald-500/15 border border-emerald-500/30 rounded-xl p-4 text-emerald-400 text-sm font-semibold">{success}</div>}
          {error&&<div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">❌ {error}</div>}
          {!success&&(
            <div className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${dragOver?'border-amber-500 bg-amber-500/10':'border-white/10 hover:border-white/20'}`}
              onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={e=>{e.preventDefault();setDragOver(false);}}
              onDrop={e=>{e.preventDefault();setDragOver(false);const file=e.dataTransfer?.files?.[0];if(file)handleFile(file);}}
              onClick={()=>fileRef.current?.click()}>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className="hidden" onChange={e=>{const file=e.target?.files?.[0];if(file)handleFile(file);}}/>
              {parsing?(<div className="text-amber-400"><div className="text-3xl mb-2 animate-spin inline-block">⏳</div><div className="font-semibold">Analysiere Datei...</div></div>):(
                <><div className="text-4xl mb-3">📁</div><div className="text-white font-semibold">CSV hierher ziehen oder klicken</div>
                  <div className="text-slate-500 text-sm mt-1">Automatische Erkennung von Amazon & eBay</div>
                  <div className="flex flex-wrap gap-2 justify-center mt-4">
                    <span className="px-3 py-1 rounded-full text-[11px] font-semibold bg-[#FF9900]/20 text-[#FF9900]">🟠 Amazon Transaction Report</span>
                    <span className="px-3 py-1 rounded-full text-[11px] font-semibold bg-[#0064D2]/20 text-[#0064D2]">🔵 eBay Bestellbericht</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══ TABS ═══ */
const TABS=[
  {id:'dashboard',icon:'📊',label:'Dashboard',short:'Home'},
  {id:'compare',icon:'⚡',label:'Vergleich',short:'Vergl.'},
  {id:'marketplaces',icon:'🏪',label:'Marktplätze',short:'Märkte'},
  {id:'revenue',icon:'💰',label:'Umsatz & Kosten',short:'P&L'},
  {id:'products',icon:'📦',label:'Produkte',short:'Produkte'},
  {id:'refunds',icon:'↩️',label:'Erstattungen',short:'Retouren'},
  {id:'trends',icon:'📈',label:'Trends',short:'Trends'},
  {id:'time',icon:'⏰',label:'Zeitanalyse',short:'Zeit'},
  {id:'goals',icon:'🎯',label:'Ziele',short:'Ziele'},
  {id:'exports',icon:'📤',label:'Export',short:'Export'},
];

/* ═══════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════ */
export default function App(){
  const[tab,setTab]=useState('dashboard');
  const[showUpload,setShowUpload]=useState(false);
  const[refreshKey,setRefreshKey]=useState(0);
  const[goals,setGoals]=useState(S.getGoals);
  const[sideOpen,setSideOpen]=useState(false);
  const[prodSearch,setProdSearch]=useState('');
  const[prodSort,setProdSort]=useState({key:'revenue',dir:'desc'});

  useEffect(()=>{S.saveGoals(goals);},[goals]);

  // All data derived from store
  const store=useMemo(()=>S.getStore(),[refreshKey]);
  const hasData=Object.keys(store).length>0;
  const daily=useMemo(()=>S.getCombinedDaily(),[refreshKey]);
  const monthly=useMemo(()=>S.getMonthly(daily),[daily]);
  const total=useMemo(()=>S.getTotals(daily),[daily]);
  const allSKU=useMemo(()=>S.getCombinedSKU(),[refreshKey]);
  const comparisons=useMemo(()=>S.getComparisons(daily),[daily]);
  const forecast=useMemo(()=>S.getForecast(monthly),[monthly]);
  const avgGrowth=useMemo(()=>S.getAvgGrowth(monthly),[monthly]);

  const lastM=monthly[monthly.length-1];
  const prevM=monthly.length>1?monthly[monthly.length-2]:null;
  const mom=k=>prevM&&Math.abs(prevM[k])>0?(lastM[k]-prevM[k])/Math.abs(prevM[k]):null;

  // Enriched products
  const products=useMemo(()=>allSKU.map(s=>({...s,refundRate:s.orders>0?s.refunds/s.orders:0,avgPrice:s.units>0?s.revenue/s.units:0,feeRate:s.revenue>0?Math.abs(s.fees||0)/s.revenue:0,netMargin:s.revenue>0?(s.net||0)/s.revenue:0})),[allSKU]);
  const sortedProducts=useMemo(()=>{let a=[...products];if(prodSearch){const q=prodSearch.toLowerCase();a=a.filter(p=>p.sku.toLowerCase().includes(q)||p.title.toLowerCase().includes(q));}a.sort((x,y)=>{const va=x[prodSort.key]||0,vb=y[prodSort.key]||0;return prodSort.dir==='asc'?va-vb:vb-va;});return a;},[products,prodSort,prodSearch]);

  // Marketplace per-data
  const mpData=S.MARKETPLACES.map(mp=>{const d=store[mp.id];return{...mp,data:d,hasData:!!d,daily:d?.daily||[],total:d?S.getTotals(d.daily||[]):{},monthly:d?S.getMonthly(d.daily||[]):[]};});

  // Weekly aggregation
  const weekly=useMemo(()=>{const w={};daily.forEach(d=>{const dt=new Date(d.date);const wk=new Date(dt);wk.setDate(dt.getDate()-dt.getDay()+1);const k=wk.toISOString().split('T')[0];if(!w[k])w[k]={week:k,orders:0,units:0,revenue:0,refunds:0,net:0};w[k].orders+=d.orders;w[k].units+=d.units;w[k].revenue+=d.revenue;w[k].refunds+=d.refunds;w[k].net+=d.net;});return Object.values(w).sort((a,b)=>a.week.localeCompare(b.week));},[daily]);

  // Hourly/weekday combined
  const hourly=useMemo(()=>{const h={};Object.values(store).forEach(mp=>{(mp.hourly||[]).forEach(x=>{h[x.hour]=(h[x.hour]||0)+x.orders;});});return Object.entries(h).map(([hour,orders])=>({hour,orders})).sort((a,b)=>a.hour.localeCompare(b.hour));},[refreshKey]);
  const weekday=useMemo(()=>{const w={};Object.values(store).forEach(mp=>{(mp.weekday||[]).forEach(x=>{if(!w[x.day])w[x.day]={day:x.day,orders:0,revenue:0};w[x.day].orders+=x.orders;w[x.day].revenue+=x.revenue;});});return['Mo','Di','Mi','Do','Fr','Sa','So'].filter(d=>w[d]).map(d=>w[d]);},[refreshKey]);

  // States combined
  const states=useMemo(()=>{const s={};Object.values(store).forEach(mp=>{(mp.states||[]).forEach(x=>{if(!s[x.name])s[x.name]={name:x.name,orders:0,revenue:0,units:0};s[x.name].orders+=x.orders;s[x.name].revenue+=x.revenue;s[x.name].units+=x.units||0;});});return Object.values(s).sort((a,b)=>b.revenue-a.revenue);},[refreshKey]);

  const refresh=()=>setRefreshKey(k=>k+1);
  const daysInMonth=new Date(new Date().getFullYear(),new Date().getMonth()+1,0).getDate();
  const projectedRev=lastM?lastM.dailyAvgRev*daysInMonth:0;

  // Growth rates
  const growthRates=monthly.slice(1).map((m,i)=>({month:m.label,revGrowth:monthly[i].revenue>0?(m.revenue-monthly[i].revenue)/monthly[i].revenue:0}));

  /* ═══ EMPTY STATE ═══ */
  if(!hasData){
    return(
      <div className="min-h-screen bg-gradient-to-br from-[#0a0e1a] via-[#111827] to-[#0f172a] flex items-center justify-center">
        <div className="text-center max-w-md mx-auto p-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-2xl mx-auto mb-6 shadow-lg shadow-amber-500/20">M</div>
          <h1 className="text-2xl font-bold text-white mb-2">Marketplace Hub</h1>
          <p className="text-slate-400 mb-6">Importiere deinen ersten Report um das Dashboard zu aktivieren.</p>
          <div className="flex flex-wrap gap-2 justify-center mb-6">
            <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#FF9900]/15 text-[#FF9900]">🟠 Amazon Transaction Report</span>
            <span className="px-3 py-1.5 rounded-full text-xs font-semibold bg-[#0064D2]/15 text-[#0064D2]">🔵 eBay Bestellbericht</span>
          </div>
          <button onClick={()=>setShowUpload(true)} className="px-8 py-3.5 rounded-xl bg-amber-500 text-black font-bold text-base hover:bg-amber-400 transition-all shadow-lg shadow-amber-500/20">
            📁 Ersten Report importieren
          </button>
        </div>
        {showUpload&&<UploadModal onClose={()=>setShowUpload(false)} onImported={refresh}/>}
      </div>
    );
  }

  /* ═══ MAIN LAYOUT ═══ */
  return(
    <div className="min-h-screen bg-gradient-to-br from-[#0a0e1a] via-[#111827] to-[#0f172a] text-slate-200 font-sans">
      {/* HEADER */}
      <header className="h-13 border-b border-white/5 bg-black/40 backdrop-blur-xl flex items-center justify-between px-4 lg:px-6 sticky top-0 z-40">
        <div className="flex items-center gap-2.5">
          <button onClick={()=>setSideOpen(s=>!s)} className="lg:hidden text-slate-400 hover:text-white p-1">☰</button>
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-amber-500/20">M</div>
          <div className="hidden sm:block">
            <div className="text-sm font-bold text-white tracking-tight leading-tight">Marketplace Hub</div>
            <div className="text-[8px] text-slate-500 font-mono tracking-[0.2em]">ENTERPRISE ANALYTICS</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={()=>setShowUpload(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400 text-xs font-semibold hover:bg-amber-500/20 transition-all">↑ Import</button>
          <span className="hidden md:inline text-[10px] text-slate-500 font-mono">{Object.keys(store).length} Marktplätze • {f(total.orders,'num')} Best. • {f(total.revenue)}</span>
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"/>
        </div>
      </header>

      <div className="flex h-[calc(100vh-52px)]">
        {/* SIDEBAR */}
        <aside className={`${sideOpen?'translate-x-0':'-translate-x-full lg:translate-x-0'} fixed lg:relative z-30 w-48 h-full border-r border-white/5 bg-[#0b1120]/95 lg:bg-black/20 backdrop-blur-xl flex flex-col py-3 px-2 shrink-0 transition-transform`}>
          <div className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em] px-3 mb-2">Navigation</div>
          {TABS.map(t=>(<button key={t.id} onClick={()=>{setTab(t.id);setSideOpen(false);}} className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-0.5 text-[12px] font-medium transition-all w-full text-left ${tab===t.id?'bg-amber-500/15 text-amber-400 font-semibold':'text-slate-500 hover:text-slate-300 hover:bg-white/3'}`}><span className="text-sm">{t.icon}</span>{t.label}</button>))}

          <div className="text-[9px] font-bold text-slate-600 uppercase tracking-[0.2em] px-3 mt-3 mb-1.5">Marktplätze</div>
          {mpData.map(mp=>(<div key={mp.id} className="flex items-center justify-between px-3 py-1 text-[11px]"><div className="flex items-center gap-1.5"><span className="text-xs">{mp.icon}</span><span className={mp.hasData?'text-slate-300':'text-slate-600'}>{mp.name}</span></div>{mp.hasData?<span className="w-1.5 h-1.5 rounded-full" style={{background:mp.color}}/>:<span className="text-[9px] text-slate-600">–</span>}</div>))}

          <div className="flex-1"/>
          <div className="px-3 py-2 rounded-xl bg-white/3 text-[10px] text-slate-500 text-center space-y-0.5">
            <div>{daily.length} Tage Daten</div>
            {daily.length>0&&<div>{daily[0]?.date} – {daily[daily.length-1]?.date}</div>}
            <button onClick={()=>{if(confirm('Alle importierten Daten löschen?')){S.clearAll();refresh();}}} className="text-[9px] text-red-500/40 hover:text-red-400 mt-1">Zurücksetzen</button>
          </div>
        </aside>
        {sideOpen&&<div className="lg:hidden fixed inset-0 z-20 bg-black/50" onClick={()=>setSideOpen(false)}/>}

        {/* MOBILE NAV */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0b1120]/95 backdrop-blur-xl border-t border-white/5 flex overflow-x-auto">
          {TABS.slice(0,7).map(t=>(<button key={t.id} onClick={()=>setTab(t.id)} className={`flex flex-col items-center py-1.5 px-2 min-w-[48px] text-[9px] shrink-0 ${tab===t.id?'text-amber-400':'text-slate-600'}`}><span className="text-sm">{t.icon}</span><span className="mt-0.5">{t.short}</span></button>))}
        </div>

        {/* ═══ CONTENT ═══ */}
        <main className="flex-1 overflow-auto pb-20 lg:pb-4">
          <div className="p-4 md:p-5 max-w-[1440px] mx-auto">

{/* ══ DASHBOARD ══ */}
{tab==='dashboard'&&(<>
  <div className="flex items-end justify-between mb-5"><div><h1 className="text-xl font-bold text-white">Dashboard</h1><p className="text-xs text-slate-500">Alle Marktplätze kombiniert</p></div>
    {avgGrowth!==0&&<span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${avgGrowth>=0?'bg-emerald-500/15 text-emerald-400':'bg-red-500/15 text-red-400'}`}>Trend: {avgGrowth>=0?'📈':'📉'} {f(avgGrowth,'pct')}/M</span>}
  </div>
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
    <KPI label="Brutto-Umsatz" value={total.revenue} icon="💰" color="#FF9900" trend={mom('revenue')} sub={`Ø ${f(monthly.length?total.revenue/monthly.length:0)}/Monat`}/>
    <KPI label="Netto-Erlös" value={total.net} icon="💵" color="#2ecc71" trend={mom('net')} sub={`Marge: ${f(total.netMargin,'pct')}`}/>
    <KPI label="Bestellungen" value={total.orders} format="num" icon="🛒" color="#3498db" trend={mom('orders')} sub={`${f(total.units||0,'num')} Einheiten`}/>
    <KPI label="Ø Bestellwert" value={total.avgOrderValue} format="eur2" icon="🎯" color="#e74c3c"/>
  </div>
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
    <KPI sm label="Erstattungen" value={total.refunds||0} format="num" icon="↩️" color="#e74c3c" sub={`${f(total.refundRate,'pct')} Quote`}/>
    <KPI sm label="Verkaufsgebühren" value={Math.abs(total.fees||0)} icon="🏷️" color="#9b59b6"/>
    <KPI sm label="Werbeaktionen" value={Math.abs(total.promo||0)} icon="🎪" color="#1abc9c"/>
    <KPI sm label="Servicegebühren" value={Math.abs(total.serviceFees||0)} icon="⚙️" color="#3498db"/>
  </div>
  {/* Monthly chart */}
  {monthly.length>1&&(<div className="glass rounded-2xl p-4 mb-5"><div className="text-xs font-bold text-white mb-3">Monatliche Entwicklung</div>
    <ResponsiveContainer width="100%" height={240}><ComposedChart data={monthly}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/><XAxis dataKey="label" stroke="#334155" tick={{fill:'#64748b',fontSize:9}}/><YAxis yAxisId="l" stroke="#334155" tick={{fill:'#64748b',fontSize:9}} tickFormatter={cmp}/><YAxis yAxisId="r" orientation="right" stroke="#334155" tick={{fill:'#64748b',fontSize:9}}/><Tooltip content={<TT/>}/><Bar yAxisId="l" dataKey="revenue" name="Umsatz" fill="#FF9900" radius={[3,3,0,0]} opacity={0.8}/><Line yAxisId="l" type="monotone" dataKey="net" name="Netto" stroke="#2ecc71" strokeWidth={2} dot={false}/><Line yAxisId="r" type="monotone" dataKey="orders" name="Bestellungen" stroke="#3498db" strokeWidth={1.5} dot={false} strokeDasharray="4 2"/><Legend wrapperStyle={{fontSize:10}}/></ComposedChart></ResponsiveContainer>
  </div>)}
  {/* Quick insights + marketplace mini */}
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <div className="glass rounded-2xl p-4"><div className="text-xs font-bold text-white mb-3">🏪 Marktplatz-Übersicht</div>
      {mpData.filter(m=>m.hasData).map((mp,i)=>(<div key={i} className="flex items-center justify-between py-2 border-b border-white/3 last:border-0"><div className="flex items-center gap-2"><span className="w-2 h-2 rounded-sm" style={{background:mp.color}}/><span className="text-xs font-semibold text-white">{mp.name}</span></div><div className="flex items-center gap-3"><span className="text-xs font-mono text-white">{f(mp.total.revenue)}</span><span className="text-[10px] text-slate-500">{f(mp.total.orders,'num')} Best.</span></div></div>))}
      {mpData.filter(m=>!m.hasData).length>0&&<button onClick={()=>setShowUpload(true)} className="w-full mt-2 py-2 rounded-lg bg-white/3 text-[11px] text-slate-500 hover:text-amber-400 transition-all">+ Weitere Marktplätze importieren</button>}
    </div>
    <div className="glass rounded-2xl p-4"><div className="text-xs font-bold text-white mb-3">🏆 Top 10 Produkte</div>
      {products.slice(0,10).map((p,i)=>(<div key={i} className="flex items-center justify-between py-1.5 border-b border-white/3 last:border-0"><div className="flex items-center gap-2 min-w-0 flex-1"><span className="text-[10px] text-slate-600 w-4">{i+1}</span><span className="text-[11px] text-white truncate">{p.sku}</span></div><div className="flex items-center gap-2 shrink-0"><span className="text-[11px] font-mono font-bold text-white">{f(p.revenue)}</span>{p.refundRate>0.15&&<span className="text-[9px] px-1 py-0.5 rounded bg-red-500/15 text-red-400">{f(p.refundRate,'pct')}</span>}</div></div>))}
    </div>
  </div>
</>)}

{/* ══ COMPARE ══ */}
{tab==='compare'&&(<>
  <h1 className="text-xl font-bold text-white mb-5">⚡ Vergleich – Entwicklung</h1>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
    {['today','week','month','year'].map(k=>comparisons[k]&&<CompCard key={k} comp={comparisons[k]}/>)}
  </div>
  {/* Per-marketplace comparison */}
  <div className="glass rounded-2xl p-5">
    <div className="text-xs font-bold text-white mb-3">Vergleich pro Marktplatz – Dieser Monat vs. Vormonat</div>
    <div className="overflow-x-auto"><table className="w-full text-[11px]"><thead><tr>
      {['Marktplatz','Umsatz akt.','Umsatz VM','Δ','Best. akt.','Best. VM','Δ'].map(h=><th key={h} className="py-2 px-2 text-[9px] text-slate-500 uppercase border-b border-white/5 text-right first:text-left">{h}</th>)}
    </tr></thead><tbody>
      {mpData.filter(m=>m.hasData).map(mp=>{const cur=mp.monthly[mp.monthly.length-1];const prev=mp.monthly.length>1?mp.monthly[mp.monthly.length-2]:null;return(
        <tr key={mp.id} className="border-b border-white/3"><td className="py-2 px-2 text-left"><div className="flex items-center gap-2"><span className="w-2 h-2 rounded-sm" style={{background:mp.color}}/><span className="font-semibold text-white">{mp.name}</span></div></td>
          <td className="py-2 px-2 text-right font-mono font-bold text-white">{f(cur?.revenue||0)}</td>
          <td className="py-2 px-2 text-right font-mono text-slate-500">{f(prev?.revenue||0)}</td>
          <td className="py-2 px-2 text-right"><Badge value={prev?.revenue?(cur?.revenue-prev?.revenue)/prev.revenue:null}/></td>
          <td className="py-2 px-2 text-right font-mono">{f(cur?.orders||0,'num')}</td>
          <td className="py-2 px-2 text-right font-mono text-slate-500">{f(prev?.orders||0,'num')}</td>
          <td className="py-2 px-2 text-right"><Badge value={prev?.orders?(cur?.orders-prev?.orders)/prev.orders:null}/></td>
        </tr>);})}
    </tbody></table></div>
  </div>
</>)}

{/* ══ MARKETPLACES ══ */}
{tab==='marketplaces'&&(<>
  <div className="flex items-end justify-between mb-5"><div><h1 className="text-xl font-bold text-white">🏪 Marktplätze</h1></div><button onClick={()=>setShowUpload(true)} className="px-4 py-2 rounded-lg bg-amber-500/15 text-amber-400 text-xs font-semibold border border-amber-500/20">+ Import</button></div>
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
    {S.MARKETPLACES.map(mp=>{const d=store[mp.id];const t=d?S.getTotals(d.daily||[]):{};return(
      <div key={mp.id} className="glass rounded-2xl overflow-hidden" style={{borderColor:d?mp.color+'30':'transparent'}}>
        <div className="px-5 py-3 flex items-center justify-between" style={{background:mp.color+'12'}}><div className="flex items-center gap-2"><span className="text-xl">{mp.icon}</span><span className="text-sm font-bold text-white">{mp.name}</span></div>{d?<span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400">Aktiv</span>:<span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-white/5 text-slate-500">–</span>}</div>
        {d?(<div className="p-5 space-y-3"><div className="grid grid-cols-2 gap-3">
          <div><div className="text-[10px] text-slate-500">Umsatz</div><div className="text-lg font-bold text-white font-mono">{f(t.revenue)}</div></div>
          <div><div className="text-[10px] text-slate-500">Bestellungen</div><div className="text-lg font-bold text-white font-mono">{f(t.orders,'num')}</div></div>
          <div><div className="text-[10px] text-slate-500">Ø Bestellwert</div><div className="text-sm font-mono text-slate-300">{f(t.avgOrderValue,'eur2')}</div></div>
          {t.refundRate>0&&<div><div className="text-[10px] text-slate-500">Retourenquote</div><span className={`text-sm font-mono font-bold ${t.refundRate>0.1?'text-red-400':'text-emerald-400'}`}>{f(t.refundRate,'pct')}</span></div>}
        </div><div className="text-[10px] text-slate-500 pt-2 border-t border-white/5">{(d.daily||[]).length} Tage • {(d.sku||[]).length} Produkte • Import: {d._ts?.substring(0,10)}</div></div>):(
          <div className="p-5 text-center py-8"><div className="text-slate-600 text-sm mb-3">Noch keine Daten</div><button onClick={()=>setShowUpload(true)} className="px-4 py-2 rounded-lg text-xs font-semibold" style={{background:mp.color+'20',color:mp.color}}>CSV importieren</button></div>
        )}
      </div>);})}
  </div>
  {/* Revenue bar chart */}
  {mpData.some(m=>m.hasData)&&(<div className="glass rounded-2xl p-5"><div className="text-xs font-bold text-white mb-3">Umsatzvergleich</div>
    <ResponsiveContainer width="100%" height={250}><BarChart data={mpData.filter(m=>m.hasData).map(m=>({name:m.name,revenue:m.total.revenue||0,color:m.color}))} barCategoryGap="20%"><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/><XAxis dataKey="name" stroke="#334155" tick={{fill:'#64748b',fontSize:10}}/><YAxis stroke="#334155" tick={{fill:'#64748b',fontSize:9}} tickFormatter={cmp}/><Tooltip content={<TT/>}/><Bar dataKey="revenue" name="Umsatz" radius={[6,6,0,0]}>{mpData.filter(m=>m.hasData).map((m,i)=><Cell key={i} fill={m.color}/>)}</Bar></BarChart></ResponsiveContainer>
  </div>)}
</>)}

{/* ══ REVENUE ══ */}
{tab==='revenue'&&(<>
  <h1 className="text-xl font-bold text-white mb-5">💰 Umsatz, Kosten & Gewinn</h1>
  <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
    <KPI label="Brutto-Umsatz" value={total.revenue} icon="💰"/><KPI label="Erstattungen" value={total.refundAmount||0} icon="↩️" color="#e74c3c"/>
    <KPI label="Netto-Umsatz" value={total.revenue-(total.refundAmount||0)} icon="📊" color="#3498db"/><KPI label="Kosten" value={total.totalFees+Math.abs(total.promo||0)} icon="💳" color="#e67e22"/>
    <KPI label="Netto-Erlös" value={total.net} icon="💵" color="#2ecc71"/>
  </div>
  <div className="glass rounded-2xl p-5"><div className="text-xs font-bold text-white mb-3">Monatliche GuV</div><div className="overflow-x-auto"><table className="w-full text-[11px]"><thead><tr>
    {['Monat','Umsatz','Erstatt.','Gebühren','Promo','Netto','Marge','Ø Best.'].map(h=><th key={h} className="py-2 px-2 text-[9px] text-slate-500 uppercase border-b border-white/5 text-right first:text-left">{h}</th>)}
  </tr></thead><tbody>
    {monthly.map((m,i)=>(<tr key={i} className="border-b border-white/3 hover:bg-white/3"><td className="py-1.5 px-2 font-semibold text-white text-left">{m.label}</td><td className="py-1.5 px-2 text-right font-mono">{f(m.revenue)}</td><td className="py-1.5 px-2 text-right font-mono text-red-400">{f(m.refundAmount||0)}</td><td className="py-1.5 px-2 text-right font-mono text-orange-400">{f(m.totalFees)}</td><td className="py-1.5 px-2 text-right font-mono text-purple-400">{f(Math.abs(m.promo||0))}</td><td className={`py-1.5 px-2 text-right font-mono font-bold ${m.net>=0?'text-emerald-400':'text-red-400'}`}>{f(m.net)}</td><td className="py-1.5 px-2 text-right"><Badge value={m.netMargin}/></td><td className="py-1.5 px-2 text-right font-mono">{f(m.avgOrderValue,'eur2')}</td></tr>))}
  </tbody></table></div></div>
</>)}

{/* ══ PRODUCTS ══ */}
{tab==='products'&&(<>
  <div className="flex items-end justify-between mb-5 flex-wrap gap-3"><div><h1 className="text-xl font-bold text-white">📦 Produkte</h1><p className="text-xs text-slate-500">{products.length} Produkte</p></div>
    <input placeholder="🔍 SKU oder Titel..." value={prodSearch} onChange={e=>setProdSearch(e.target.value)} className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white w-56 focus:border-amber-500/50 focus:outline-none placeholder:text-slate-600"/>
  </div>
  <div className="glass rounded-2xl p-4"><div className="overflow-x-auto"><table className="w-full text-[11px]"><thead><tr>
    {[{k:'sku',l:'SKU'},{k:'revenue',l:'Umsatz'},{k:'units',l:'Einh.'},{k:'orders',l:'Best.'},{k:'avgPrice',l:'Ø Preis'},{k:'refunds',l:'Erst.'},{k:'refundRate',l:'Ret.%'},{k:'net',l:'Netto'}].map(h=>
      <th key={h.k} onClick={()=>setProdSort(s=>s.key===h.k?{key:h.k,dir:s.dir==='desc'?'asc':'desc'}:{key:h.k,dir:'desc'})} className={`py-2 px-2 text-[9px] text-slate-500 uppercase border-b border-white/5 cursor-pointer hover:text-slate-300 ${h.k==='sku'?'text-left':'text-right'}`}>{h.l}{prodSort.key===h.k&&<span className="text-amber-400 ml-0.5">{prodSort.dir==='asc'?'▲':'▼'}</span>}</th>)}
  </tr></thead><tbody>
    {sortedProducts.slice(0,60).map((p,i)=>(<tr key={i} className="border-b border-white/3 hover:bg-white/3">
      <td className="py-1.5 px-2 text-left"><div className="font-semibold text-amber-400 text-[11px]">{p.sku}</div><div className="text-[9px] text-slate-500 truncate max-w-[160px]">{p.title}</div>{p.marketplace&&<span className="text-[9px] px-1 rounded" style={{background:S.MARKETPLACES.find(m=>m.id===p.marketplace)?.color+'20',color:S.MARKETPLACES.find(m=>m.id===p.marketplace)?.color}}>{p.marketplace}</span>}</td>
      <td className="py-1.5 px-2 text-right font-mono font-bold text-white">{f(p.revenue)}</td><td className="py-1.5 px-2 text-right font-mono">{p.units}</td><td className="py-1.5 px-2 text-right font-mono">{p.orders}</td>
      <td className="py-1.5 px-2 text-right font-mono">{f(p.avgPrice,'eur2')}</td><td className="py-1.5 px-2 text-right font-mono text-red-400">{p.refunds||0}</td>
      <td className="py-1.5 px-2 text-right"><span className={`px-1 py-0.5 rounded text-[9px] font-bold ${p.refundRate>0.2?'bg-red-500/20 text-red-400':p.refundRate>0.1?'bg-yellow-500/20 text-yellow-400':'bg-emerald-500/15 text-emerald-400'}`}>{f(p.refundRate,'pct')}</span></td>
      <td className={`py-1.5 px-2 text-right font-mono font-bold ${(p.net||0)>=0?'text-emerald-400':'text-red-400'}`}>{f(p.net)}</td>
    </tr>))}
  </tbody></table></div></div>
</>)}

{/* ══ REFUNDS ══ */}
{tab==='refunds'&&(<>
  <h1 className="text-xl font-bold text-white mb-5">↩️ Erstattungen</h1>
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
    <KPI label="Erstattungen" value={total.refunds||0} format="num" icon="↩️" color="#e74c3c"/><KPI label="Betrag" value={total.refundAmount||0} icon="💸" color="#e67e22"/>
    <KPI label="Quote" value={total.refundRate} format="pct" icon="📉" color="#f39c12"/><KPI label="Ø/Erstattung" value={(total.refunds||0)>0?(total.refundAmount||0)/total.refunds:0} format="eur2" icon="🎯" color="#9b59b6"/>
  </div>
  {monthly.length>1&&(<div className="glass rounded-2xl p-5 mb-5"><div className="text-xs font-bold text-white mb-3">Erstattungsentwicklung</div>
    <ResponsiveContainer width="100%" height={220}><ComposedChart data={monthly}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/><XAxis dataKey="label" stroke="#334155" tick={{fill:'#64748b',fontSize:9}}/><YAxis yAxisId="l" stroke="#334155" tick={{fill:'#64748b',fontSize:9}}/><YAxis yAxisId="r" orientation="right" stroke="#334155" tick={{fill:'#64748b',fontSize:9}} tickFormatter={v=>(v*100).toFixed(0)+'%'}/><Tooltip content={<TT/>}/><Bar yAxisId="l" dataKey="refunds" name="Anzahl" fill="#e74c3c" radius={[3,3,0,0]} opacity={0.7}/><Line yAxisId="r" type="monotone" dataKey="refundRate" name="Quote" stroke="#f1c40f" strokeWidth={2.5} dot={false}/><Legend wrapperStyle={{fontSize:10}}/></ComposedChart></ResponsiveContainer>
  </div>)}
  <div className="glass rounded-2xl p-5"><div className="text-xs font-bold text-white mb-3">🚨 Höchste Retourenquoten (min. 5 Best.)</div><div className="overflow-x-auto"><table className="w-full text-[11px]"><thead><tr>
    {['SKU','Best.','Erst.','Quote','Betrag','Umsatz'].map(h=><th key={h} className="py-2 px-2 text-[9px] text-slate-500 uppercase border-b border-white/5 text-right first:text-left">{h}</th>)}
  </tr></thead><tbody>
    {products.filter(p=>p.orders>=5&&p.refunds>0).sort((a,b)=>b.refundRate-a.refundRate).slice(0,25).map((p,i)=>(<tr key={i} className="border-b border-white/3"><td className="py-1.5 px-2 text-left font-semibold text-white">{p.sku}</td><td className="py-1.5 px-2 text-right font-mono">{p.orders}</td><td className="py-1.5 px-2 text-right font-mono text-red-400 font-bold">{p.refunds}</td><td className="py-1.5 px-2 text-right"><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${p.refundRate>0.2?'bg-red-500/20 text-red-400':'bg-yellow-500/20 text-yellow-400'}`}>{f(p.refundRate,'pct')}</span></td><td className="py-1.5 px-2 text-right font-mono">{f(p.refundAmount||0)}</td><td className="py-1.5 px-2 text-right font-mono">{f(p.revenue)}</td></tr>))}
  </tbody></table></div></div>
</>)}

{/* ══ TRENDS ══ */}
{tab==='trends'&&(<>
  <h1 className="text-xl font-bold text-white mb-5">📈 Trends & Prognose</h1>
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
    <KPI sm label="Ø Wachstum/Monat" value={avgGrowth} format="pct" icon="📈" color={avgGrowth>=0?'#2ecc71':'#e74c3c'}/>
    <KPI sm label="Prognose +1M" value={forecast[0]?.revenue} icon="🔮" color="#9b59b6"/>
    <KPI sm label="Ø Tagesumsatz" value={lastM?.dailyAvgRev} icon="📅" color="#3498db"/>
    <KPI sm label="Hochrechnung Monat" value={projectedRev} icon="🎯" color="#f39c12"/>
  </div>
  {monthly.length>2&&(<div className="glass rounded-2xl p-5 mb-5"><div className="text-xs font-bold text-white mb-3">Umsatz + 6-Monats-Prognose</div>
    <ResponsiveContainer width="100%" height={280}><AreaChart data={[...monthly.map(m=>({label:m.label,Ist:m.revenue})),...forecast.map(fc=>({label:fc.label,Prognose:fc.revenue}))]}>
      <defs><linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FF9900" stopOpacity={0.3}/><stop offset="100%" stopColor="#FF9900" stopOpacity={0}/></linearGradient><linearGradient id="gF" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#9b59b6" stopOpacity={0.3}/><stop offset="100%" stopColor="#9b59b6" stopOpacity={0}/></linearGradient></defs>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/><XAxis dataKey="label" stroke="#334155" tick={{fill:'#64748b',fontSize:9}}/><YAxis stroke="#334155" tick={{fill:'#64748b',fontSize:9}} tickFormatter={cmp}/><Tooltip content={<TT/>}/>
      <Area type="monotone" dataKey="Ist" stroke="#FF9900" fill="url(#gA)" strokeWidth={2.5}/><Area type="monotone" dataKey="Prognose" stroke="#9b59b6" fill="url(#gF)" strokeWidth={2} strokeDasharray="6 3"/><Legend wrapperStyle={{fontSize:10}}/>
    </AreaChart></ResponsiveContainer>
  </div>)}
  {growthRates.length>1&&(<div className="glass rounded-2xl p-5"><div className="text-xs font-bold text-white mb-3">Monatliche Wachstumsraten</div>
    <ResponsiveContainer width="100%" height={200}><BarChart data={growthRates}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/><XAxis dataKey="month" stroke="#334155" tick={{fill:'#64748b',fontSize:9}}/><YAxis stroke="#334155" tick={{fill:'#64748b',fontSize:9}} tickFormatter={v=>(v*100).toFixed(0)+'%'}/><Tooltip formatter={v=>f(v,'pct')} contentStyle={{background:'#1e293b',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:10}}/><Bar dataKey="revGrowth" name="Umsatz-Δ">{growthRates.map((g,i)=><Cell key={i} fill={g.revGrowth>=0?'#2ecc71':'#e74c3c'} opacity={0.7}/>)}</Bar></BarChart></ResponsiveContainer>
  </div>)}
</>)}

{/* ══ TIME ══ */}
{tab==='time'&&(<>
  <h1 className="text-xl font-bold text-white mb-5">⏰ Zeitanalyse</h1>
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">
    {hourly.length>0&&(<div className="glass rounded-2xl p-5"><div className="text-xs font-bold text-white mb-3">Bestellungen nach Tageszeit</div>
      <ResponsiveContainer width="100%" height={220}><BarChart data={hourly}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/><XAxis dataKey="hour" stroke="#334155" tick={{fill:'#64748b',fontSize:9}}/><YAxis stroke="#334155" tick={{fill:'#64748b',fontSize:9}}/><Tooltip contentStyle={{background:'#1e293b',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,fontSize:10}}/><Bar dataKey="orders" name="Bestellungen" radius={[3,3,0,0]}>{hourly.map((h,i)=><Cell key={i} fill={h.orders>(total.orders/24)?'#FF9900':'#334155'} opacity={0.8}/>)}</Bar></BarChart></ResponsiveContainer>
    </div>)}
    {weekday.length>0&&(<div className="glass rounded-2xl p-5"><div className="text-xs font-bold text-white mb-3">Bestellungen nach Wochentag</div>
      <ResponsiveContainer width="100%" height={220}><ComposedChart data={weekday}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/><XAxis dataKey="day" stroke="#334155" tick={{fill:'#64748b',fontSize:10}}/><YAxis yAxisId="l" stroke="#334155" tick={{fill:'#64748b',fontSize:9}}/><YAxis yAxisId="r" orientation="right" stroke="#334155" tick={{fill:'#64748b',fontSize:9}} tickFormatter={cmp}/><Tooltip content={<TT/>}/><Bar yAxisId="l" dataKey="orders" name="Bestellungen" fill="#3498db" radius={[3,3,0,0]} opacity={0.7}/><Line yAxisId="r" type="monotone" dataKey="revenue" name="Umsatz" stroke="#FF9900" strokeWidth={2} dot={{r:3}}/><Legend wrapperStyle={{fontSize:10}}/></ComposedChart></ResponsiveContainer>
    </div>)}
  </div>
  {daily.length>30&&(<div className="glass rounded-2xl p-5"><div className="text-xs font-bold text-white mb-3">Täglicher Umsatz (letzte 60 Tage)</div>
    <ResponsiveContainer width="100%" height={200}><AreaChart data={daily.slice(-60)}><defs><linearGradient id="dg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#FF9900" stopOpacity={0.3}/><stop offset="100%" stopColor="#FF9900" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/><XAxis dataKey="date" stroke="#334155" tick={{fill:'#64748b',fontSize:8}} tickFormatter={v=>v.substring(5)}/><YAxis stroke="#334155" tick={{fill:'#64748b',fontSize:9}} tickFormatter={cmp}/><Tooltip content={<TT/>}/><Area type="monotone" dataKey="revenue" name="Umsatz" stroke="#FF9900" fill="url(#dg)" strokeWidth={1.5} dot={false}/></AreaChart></ResponsiveContainer>
  </div>)}
</>)}

{/* ══ GOALS ══ */}
{tab==='goals'&&(<>
  <h1 className="text-xl font-bold text-white mb-5">🎯 Ziele</h1>
  <div className="glass rounded-2xl p-5 mb-5"><div className="text-xs font-bold text-white mb-4">Monatsziele definieren</div>
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {[{k:'monthlyRevenue',l:'Monatsumsatz (€)',ph:'150000',icon:'💰'},{k:'monthlyOrders',l:'Bestellungen/Monat',ph:'1500',icon:'🛒'},{k:'monthlyNet',l:'Netto/Monat (€)',ph:'15000',icon:'💵'},{k:'maxRefundRate',l:'Max. Retourenquote (%)',ph:'8',icon:'↩️'},{k:'yearlyRevenue',l:'Jahresumsatz (€)',ph:'1500000',icon:'🏆'},{k:'targetMargin',l:'Ziel-Marge (%)',ph:'10',icon:'📊'}].map(g=>
        <div key={g.k}><label className="block text-[10px] text-slate-400 font-semibold mb-1">{g.icon} {g.l}</label><input type="number" placeholder={g.ph} value={goals[g.k]||''} onChange={e=>{const v=parseFloat(e.target.value);setGoals(p=>({...p,[g.k]:isNaN(v)?undefined:v}));}} className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm font-mono focus:border-amber-500/50 focus:outline-none placeholder:text-slate-600"/></div>)}
    </div>
  </div>
  {Object.values(goals).some(v=>v)&&lastM&&(<div className="glass rounded-2xl p-5 mb-5"><div className="text-xs font-bold text-white mb-4">Fortschritt ({lastM.label})</div>
    <div className="flex flex-wrap gap-6 justify-center">
      {goals.monthlyRevenue&&<GoalRing current={lastM.revenue} target={goals.monthlyRevenue} label={`${f(lastM.revenue)} / ${f(goals.monthlyRevenue)}`}/>}
      {goals.monthlyOrders&&<GoalRing current={lastM.orders} target={goals.monthlyOrders} label={`${f(lastM.orders,'num')} / ${f(goals.monthlyOrders,'num')} Best.`} color="#3498db"/>}
      {goals.monthlyNet&&<GoalRing current={lastM.net} target={goals.monthlyNet} label={`${f(lastM.net)} / ${f(goals.monthlyNet)}`} color="#2ecc71"/>}
      {goals.yearlyRevenue&&<GoalRing current={total.revenue} target={goals.yearlyRevenue} label={`${f(total.revenue)} / ${f(goals.yearlyRevenue)} Jahr`} color="#9b59b6"/>}
    </div>
  </div>)}
  {goals.monthlyRevenue&&lastM&&(()=>{const gap=goals.monthlyRevenue-lastM.revenue;const dLeft=daysInMonth-lastM.days;const dNeeded=dLeft>0?gap/dLeft:0;const cDaily=lastM.dailyAvgRev;const inc=cDaily>0?(dNeeded-cDaily)/cDaily:0;const onTrack=projectedRev>=goals.monthlyRevenue;return(
    <div className="glass rounded-2xl p-5"><div className="text-xs font-bold text-white mb-3">💡 Empfehlungen</div>
      <div className={`p-4 rounded-xl mb-3 ${onTrack?'bg-emerald-500/10 border border-emerald-500/20':'bg-red-500/10 border border-red-500/20'}`}><div className="text-sm font-bold text-white">{onTrack?'✅ Ziel erreichbar!':'⚠️ Ziel gefährdet'}</div><div className="text-xs text-slate-400 mt-1">Hochrechnung: {f(projectedRev)} / {f(goals.monthlyRevenue)} ({f(projectedRev/goals.monthlyRevenue,'pct')})</div></div>
      {gap>0&&<div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 space-y-1.5 text-[11px] text-slate-300"><div>• Noch <strong>{f(gap)}</strong> nötig ({dLeft} Tage)</div><div>• Benötigt: <strong>{f(dNeeded)}/Tag</strong> (aktuell: {f(cDaily)}/Tag)</div>{inc>0&&<div>• Tagesumsatz muss um <strong>{f(inc,'pct')}</strong> steigen</div>}</div>}
    </div>);})()}
</>)}

{/* ══ EXPORTS ══ */}
{tab==='exports'&&(<>
  <h1 className="text-xl font-bold text-white mb-5">📤 Export</h1>
  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    {[
      {l:'Monatsübersicht',d:'Alle KPIs pro Monat',icon:'📊',fn:()=>{const h='Monat;Umsatz;Bestell.;Einheiten;Erstatt.;Quote;Gebühren;Netto;Marge\n';const r=monthly.map(m=>`${m.month};${m.revenue};${m.orders};${m.units};${m.refunds||0};${(m.refundRate*100).toFixed(1)}%;${m.totalFees};${m.net};${(m.netMargin*100).toFixed(1)}%`).join('\n');dl(h+r,'Monatsuebersicht.csv');}},
      {l:'Alle Produkte',d:'SKU, Umsatz, Retouren etc.',icon:'📦',fn:()=>{const h='Marktplatz;SKU;Titel;Umsatz;Einheiten;Bestell.;Erstatt.;Quote;Netto\n';const r=products.map(p=>`${p.marketplace||'-'};${p.sku};"${p.title}";${p.revenue};${p.units};${p.orders};${p.refunds||0};${(p.refundRate*100).toFixed(1)}%;${p.net||0}`).join('\n');dl(h+r,'Produkte.csv');}},
      {l:'Tägliche Daten',d:'Alle Tageswerte kombiniert',icon:'📅',fn:()=>{const h='Datum;Bestellungen;Einheiten;Umsatz;Erstattungen;Gebühren;Netto\n';const r=daily.map(d=>`${d.date};${d.orders};${d.units};${d.revenue};${d.refunds};${d.fees};${d.net}`).join('\n');dl(h+r,'Tage.csv');}},
      {l:'Vergleichsreport',d:'Aktuell vs. Vorperioden',icon:'⚡',fn:()=>{const h='Zeitraum;KPI;Aktuell;Vorperiode;Veränderung\n';const r=Object.entries(comparisons).flatMap(([k,c])=>Object.entries(c.data).map(([kpi,v])=>`${c.label};${kpi};${v.current};${v.previous};${(v.change*100).toFixed(1)}%`)).join('\n');dl(h+r,'Vergleich.csv');}},
      {l:'Prognose',d:'6-Monats-Forecast',icon:'🔮',fn:()=>{const h='Monat;Umsatz;Bestellungen\n';const r=forecast.map(fc=>`${fc.label};${fc.revenue};${fc.orders}`).join('\n');dl(h+r,'Prognose.csv');}},
      {l:'JSON komplett',d:'Alle Rohdaten',icon:'🗄️',fn:()=>{dl(JSON.stringify({total,monthly,products:products.slice(0,100),daily,comparisons},null,2),'Dashboard.json');}},
    ].map((e,i)=>(<button key={i} onClick={e.fn} className="glass rounded-2xl p-5 text-left hover:bg-white/5 transition-all group"><div className="text-2xl mb-2 group-hover:scale-110 transition-transform">{e.icon}</div><div className="text-sm font-bold text-white">{e.l}</div><div className="text-[11px] text-slate-500 mt-1">{e.d}</div></button>))}
  </div>
</>)}

          </div>
        </main>
      </div>

      {showUpload&&<UploadModal onClose={()=>setShowUpload(false)} onImported={refresh}/>}
    </div>
  );
}

function dl(c,n){const b=new Blob(['\uFEFF'+c],{type:n.endsWith('.json')?'application/json':'text/csv;charset=utf-8;'});const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download=n;a.click();URL.revokeObjectURL(a.href);}
