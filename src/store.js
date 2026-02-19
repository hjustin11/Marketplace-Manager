/**
 * Store - localStorage management for Marketplace Hub
 * Stores parsed marketplace data, goals, and provides comparison logic
 */

const STORE_KEY = 'mhub4-data';
const GOALS_KEY = 'mhub4-goals';

export const MARKETPLACES = [
  { id:'amazon', name:'Amazon', color:'#FF9900', icon:'🟠' },
  { id:'ebay', name:'eBay', color:'#0064D2', icon:'🔵' },
  { id:'otto', name:'Otto', color:'#D4213D', icon:'🟥' },
  { id:'kaufland', name:'Kaufland', color:'#E30613', icon:'🛒' },
  { id:'fressnapf', name:'Fressnapf', color:'#00A651', icon:'🟢' },
  { id:'saturn', name:'Saturn/MM', color:'#DF0000', icon:'🔶' },
];

/* ═══ RAW STORAGE ═══ */
export function getStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)||'{}'); } catch { return {}; }
}

export function saveMarketplace(mpId, data) {
  const store = getStore();
  store[mpId] = { ...data, _ts: new Date().toISOString() };
  localStorage.setItem(STORE_KEY, JSON.stringify(store));
}

export function getMarketplace(mpId) {
  return getStore()[mpId] || null;
}

export function clearAll() {
  localStorage.removeItem(STORE_KEY);
}

export function getGoals() {
  try { return JSON.parse(localStorage.getItem(GOALS_KEY)||'{}'); } catch { return {}; }
}

export function saveGoals(g) {
  localStorage.setItem(GOALS_KEY, JSON.stringify(g));
}

/* ═══ COMBINED DATA ═══ */
export function getCombinedDaily() {
  const store = getStore();
  const dayMap = {};
  Object.values(store).forEach(mp => {
    if(!mp.daily) return;
    mp.daily.forEach(d => {
      if(!dayMap[d.date]) dayMap[d.date] = {date:d.date,orders:0,units:0,revenue:0,refunds:0,refundUnits:0,refundAmount:0,fees:0,fbaFees:0,promo:0,net:0,serviceFees:0,storageFees:0,shippingCredit:0};
      const o = dayMap[d.date];
      o.orders+=d.orders||0; o.units+=d.units||0; o.revenue+=d.revenue||0;
      o.refunds+=d.refunds||0; o.refundAmount+=d.refundAmount||0;
      o.fees+=d.fees||0; o.fbaFees+=d.fbaFees||0; o.promo+=d.promo||0;
      o.net+=d.net||0; o.serviceFees+=d.serviceFees||0; o.storageFees+=d.storageFees||0;
    });
  });
  return Object.values(dayMap).sort((a,b) => a.date.localeCompare(b.date));
}

export function getCombinedSKU() {
  const store = getStore();
  const skuMap = {};
  Object.entries(store).forEach(([mpId, mp]) => {
    if(!mp.sku) return;
    mp.sku.forEach(s => {
      const key = `${mpId}:${s.sku}`;
      if(!skuMap[key]) skuMap[key] = {...s, marketplace:mpId};
      else { Object.keys(s).forEach(k => { if(typeof s[k]==='number') skuMap[key][k]=(skuMap[key][k]||0)+s[k]; }); }
    });
  });
  return Object.values(skuMap).sort((a,b) => b.revenue-a.revenue);
}

/* ═══ TOTALS ═══ */
export function getTotals(daily) {
  const T = daily.reduce((a,d) => {
    Object.keys(d).forEach(k => { if(k!=='date'&&typeof d[k]==='number') a[k]=(a[k]||0)+d[k]; });
    return a;
  }, {});
  T.avgOrderValue = T.orders>0 ? T.revenue/T.orders : 0;
  T.refundRate = T.orders>0 ? T.refunds/T.orders : 0;
  T.totalFees = Math.abs(T.fees||0)+Math.abs(T.fbaFees||0)+Math.abs(T.serviceFees||0)+Math.abs(T.storageFees||0);
  T.netMargin = T.revenue>0 ? T.net/T.revenue : 0;
  return T;
}

/* ═══ MONTHLY AGGREGATION ═══ */
export function getMonthly(daily) {
  const mm = {};
  daily.forEach(d => {
    const m = d.date.substring(0,7);
    if(!mm[m]) mm[m] = {month:m,orders:0,units:0,revenue:0,refunds:0,refundAmount:0,fees:0,fbaFees:0,promo:0,net:0,serviceFees:0,storageFees:0,shippingCredit:0,days:0,daysList:[]};
    const o = mm[m];
    Object.keys(d).forEach(k => { if(k!=='date'&&typeof d[k]==='number') o[k]=(o[k]||0)+d[k]; });
    o.days++; o.daysList.push(d);
  });
  const arr = Object.values(mm).sort((a,b)=>a.month.localeCompare(b.month));
  arr.forEach(m => {
    m.avgOrderValue = m.orders>0?m.revenue/m.orders:0;
    m.refundRate = m.orders>0?m.refunds/m.orders:0;
    m.totalFees = Math.abs(m.fees||0)+Math.abs(m.fbaFees||0)+Math.abs(m.serviceFees||0)+Math.abs(m.storageFees||0);
    m.netMargin = m.revenue>0?m.net/m.revenue:0;
    m.dailyAvgRev = m.days>0?m.revenue/m.days:0;
    m.dailyAvgOrd = m.days>0?m.orders/m.days:0;
    m.label = new Date(m.month+'-01').toLocaleDateString('de-DE',{month:'short',year:'2-digit'});
  });
  return arr;
}

/* ═══ COMPARISON: Today vs Yesterday, Week, Month, Year ═══ */
export function getComparisons(daily) {
  if(!daily.length) return {};
  const sorted = [...daily].sort((a,b)=>a.date.localeCompare(b.date));
  const today = sorted[sorted.length-1]?.date;
  if(!today) return {};

  const todayDate = new Date(today);
  const sum = (arr, key) => arr.reduce((a,d)=>a+(d[key]||0),0);
  const filterRange = (from, to) => sorted.filter(d=>d.date>=from&&d.date<=to);

  // Format dates as YYYY-MM-DD
  const fmt = d => d.toISOString().split('T')[0];
  const addDays = (d, n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r; };

  // Today vs Yesterday
  const yesterday = fmt(addDays(todayDate, -1));
  const todayData = sorted.find(d=>d.date===today) || {};
  const yesterdayData = sorted.find(d=>d.date===yesterday) || {};

  // This week (Mon-Sun) vs last week
  const dow = todayDate.getDay()||7; // Mon=1..Sun=7
  const thisWeekStart = fmt(addDays(todayDate, -(dow-1)));
  const lastWeekStart = fmt(addDays(todayDate, -(dow+6)));
  const lastWeekEnd = fmt(addDays(todayDate, -dow));
  const thisWeek = filterRange(thisWeekStart, today);
  const lastWeek = filterRange(lastWeekStart, lastWeekEnd);

  // This month vs last month (same number of days)
  const thisMonthStart = today.substring(0,8)+'01';
  const thisMonth = filterRange(thisMonthStart, today);
  const daysThisMonth = thisMonth.length;
  const lastMonthEnd = fmt(addDays(new Date(thisMonthStart), -1));
  const lastMonthStart = fmt(addDays(new Date(lastMonthEnd), -(daysThisMonth-1)));
  const lastMonth = filterRange(lastMonthStart, lastMonthEnd);

  // This year vs last year (same period)
  const thisYearStart = today.substring(0,4)+'-01-01';
  const thisYear = filterRange(thisYearStart, today);
  const lastYearStart = (parseInt(today.substring(0,4))-1)+'-01-01';
  const lastYearEnd = (parseInt(today.substring(0,4))-1)+today.substring(4);
  const lastYear = filterRange(lastYearStart, lastYearEnd);

  const compare = (current, previous, keys=['revenue','orders','units','refunds','net']) => {
    const result = {};
    keys.forEach(k => {
      const cur = typeof current==='object'&&!Array.isArray(current) ? (current[k]||0) : sum(current,k);
      const prev = typeof previous==='object'&&!Array.isArray(previous) ? (previous[k]||0) : sum(previous,k);
      result[k] = { current:cur, previous:prev, change: prev!==0 ? (cur-prev)/Math.abs(prev) : (cur>0?1:0) };
    });
    return result;
  };

  return {
    today: { label:'Heute vs. Gestern', data:compare(todayData, yesterdayData), currentLabel:today, previousLabel:yesterday },
    week: { label:'Diese Woche vs. Letzte', data:compare(thisWeek, lastWeek), currentLabel:`KW ab ${thisWeekStart}`, previousLabel:`KW ab ${lastWeekStart}` },
    month: { label:'Dieser Monat vs. Vormonat', data:compare(thisMonth, lastMonth), currentLabel:`${daysThisMonth} Tage`, previousLabel:`${lastMonth.length} Tage` },
    year: { label:'Dieses Jahr vs. Vorjahr', data:compare(thisYear, lastYear), currentLabel:today.substring(0,4), previousLabel:lastYearStart.substring(0,4) },
  };
}

/* ═══ FORECAST ═══ */
export function getForecast(monthly) {
  if(monthly.length<3) return [];
  const last6 = monthly.slice(-6);
  const growths = last6.slice(1).map((m,i) => last6[i].revenue>0?(m.revenue-last6[i].revenue)/last6[i].revenue:0);
  const avgG = growths.length>0 ? growths.reduce((a,g)=>a+g,0)/growths.length : 0;
  const lastRev = last6[last6.length-1]?.revenue||0;
  const lastOrd = last6[last6.length-1]?.orders||0;
  return [1,2,3,4,5,6].map(i => ({
    month:`+${i}M`, revenue:Math.round(lastRev*(1+avgG*0.7)**i), orders:Math.round(lastOrd*(1+avgG*0.7)**i),
    label: new Date(new Date().getFullYear(), new Date().getMonth()+i, 1).toLocaleDateString('de-DE',{month:'short',year:'2-digit'}),
  }));
}

export function getAvgGrowth(monthly) {
  if(monthly.length<3) return 0;
  const last6 = monthly.slice(-6);
  const growths = last6.slice(1).map((m,i) => last6[i].revenue>0?(m.revenue-last6[i].revenue)/last6[i].revenue:0);
  return growths.length>0 ? growths.reduce((a,g)=>a+g,0)/growths.length : 0;
}
