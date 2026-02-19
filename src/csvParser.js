/**
 * CSV Parser for Marketplace Hub
 * Supports: Amazon Custom Transaction Report, eBay All Orders Report, generic CSV
 * Returns normalized { marketplace, daily[], sku[], states[], hourly[], weekday[], meta }
 */

const WEEKDAY_MAP = { 0:'So',1:'Mo',2:'Di',3:'Mi',4:'Do',5:'Fr',6:'Sa' };

function norm(text) {
  return (text||'').replace(/\ufeff/g,'').replace(/\u00a0/g,' ').replace(/\r\n/g,'\n').replace(/\r/g,'\n');
}

function pNum(val) {
  if (val==null||val===undefined) return 0;
  const s = String(val).replace(/[€%\s\u00a0]/g,'').trim();
  if (!s||s==='-'||s==='') return 0;
  const cleaned = s.replace(/\./g,'').replace(',','.');
  const n = parseFloat(cleaned);
  return isNaN(n)?0:n;
}

// Parse eBay date format "18-Feb-26" → "2026-02-18"
function parseEbayDate(d) {
  if(!d) return null;
  const months = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12',
    'Mär':'03','Mai':'05','Okt':'10','Dez':'12'};
  const parts = d.trim().split('-');
  if(parts.length!==3) return null;
  const day = parts[0].padStart(2,'0');
  const mon = months[parts[1]] || parts[1];
  let yr = parts[2]; if(yr.length===2) yr = (parseInt(yr)>50?'19':'20')+yr;
  return `${yr}-${mon}-${day}`;
}

// Parse German date "31.12.2024 23:12:04 UTC" → {date:"2024-12-31", hour:"23"}
function parseAmazonDate(d) {
  if(!d) return null;
  const parts = d.trim().split(' ')[0].split('.');
  if(parts.length!==3) return null;
  return { date: `${parts[2]}-${parts[1]}-${parts[0]}`, hour: d.substring(11,13)||'00' };
}

function detectFormat(text) {
  const first500 = text.substring(0,500).toLowerCase();
  if(first500.includes('verkaufsprotokollnummer') || first500.includes('angebotstitel') || first500.includes('verkauft für')) return 'ebay';
  // Amazon header might be further down (line 7+), check first 2000 chars
  const first2000 = text.substring(0,2000).toLowerCase();
  if(first2000.includes('datum/uhrzeit') && (first2000.includes('abrechnungsnummer') || first2000.includes('bestellnummer'))) return 'amazon_transaction';
  if(first2000.includes('einschließlich transaktionen') || first2000.includes('custom transaction')) return 'amazon_transaction';
  if(first500.includes('asin') || first500.includes('sitzungen')) return 'amazon_business';
  return 'generic';
}

/* ═══ AMAZON TRANSACTION REPORT PARSER ═══ */
function parseAmazonTransaction(lines) {
  // Find header line
  let headerIdx = -1;
  for(let i=0;i<Math.min(15,lines.length);i++) {
    if(lines[i].includes('Datum/Uhrzeit')) { headerIdx=i; break; }
  }
  if(headerIdx===-1) throw new Error('Amazon-Header nicht gefunden');

  const rows = [];
  for(let i=headerIdx+1;i<lines.length;i++) {
    const line = lines[i].trim();
    if(!line) continue;
    // Simple CSV parse respecting quotes
    rows.push(csvSplit(line, ','));
  }

  const daily={}, skuMap={}, stateMap={}, hourlyMap={}, wdMap={};
  let totalOrders=0, totalRevenue=0;

  for(const r of rows) {
    if(r.length<27) continue;
    const dt = parseAmazonDate(r[0]);
    if(!dt) continue;
    const {date,hour} = dt;
    const typ = r[2];
    const sku = r[4]||'';
    const desc = r[5]||'';

    if(!daily[date]) daily[date]={date,orders:0,units:0,revenue:0,refunds:0,refundUnits:0,refundAmount:0,fees:0,fbaFees:0,promo:0,shippingCredit:0,net:0,serviceFees:0,storageFees:0};
    const d = daily[date];

    if(typ==='Bestellung') {
      d.orders++; d.units+=pNum(r[6]); d.revenue+=pNum(r[13]);
      d.fees+=pNum(r[22]); d.fbaFees+=pNum(r[23]); d.promo+=pNum(r[19]);
      d.shippingCredit+=pNum(r[15]);
      hourlyMap[hour] = (hourlyMap[hour]||0)+1;
      try { const wd = new Date(date).getDay(); wdMap[WEEKDAY_MAP[wd]]=(wdMap[WEEKDAY_MAP[wd]]||{orders:0,revenue:0}); wdMap[WEEKDAY_MAP[wd]].orders++; wdMap[WEEKDAY_MAP[wd]].revenue+=pNum(r[13]); } catch{}
      if(sku) {
        if(!skuMap[sku]) skuMap[sku]={sku,title:desc.substring(0,100),revenue:0,units:0,orders:0,refunds:0,refundAmount:0,fees:0,fbaFees:0,promo:0,net:0};
        skuMap[sku].revenue+=pNum(r[13]); skuMap[sku].units+=pNum(r[6]); skuMap[sku].orders++;
        skuMap[sku].fees+=pNum(r[22]); skuMap[sku].fbaFees+=pNum(r[23]); skuMap[sku].promo+=pNum(r[19]);
        skuMap[sku].net+=pNum(r[26]);
      }
      if(r[10]) { const st=r[10].trim(); if(st) { if(!stateMap[st]) stateMap[st]={name:st,orders:0,revenue:0,units:0}; stateMap[st].orders++; stateMap[st].revenue+=pNum(r[13]); stateMap[st].units+=pNum(r[6]); }}
      totalOrders++; totalRevenue+=pNum(r[13]);
    } else if(typ==='Erstattung') {
      d.refunds++; d.refundUnits+=Math.abs(pNum(r[6])); d.refundAmount+=Math.abs(pNum(r[13]));
      if(sku&&skuMap[sku]) { skuMap[sku].refunds++; skuMap[sku].refundAmount+=Math.abs(pNum(r[13])); }
    } else if(typ==='Servicegebühr') {
      d.serviceFees+=pNum(r[24])+pNum(r[25]);
    } else if((typ||'').includes('Lagergebühr')) {
      d.storageFees+=pNum(r[25]);
    }
    d.net+=pNum(r[26]);
  }

  const dailyArr = Object.values(daily).sort((a,b)=>a.date.localeCompare(b.date));
  const skuArr = Object.values(skuMap).sort((a,b)=>b.revenue-a.revenue);
  const stateArr = Object.values(stateMap).sort((a,b)=>b.revenue-a.revenue);
  // Normalize NRW
  const stateNorm = {}; stateArr.forEach(s=>{let n=s.name;if(n==='NRW')n='Nordrhein-Westfalen';if(n==='Deutschland'||n==='DE')n='Unbekannt (DE)';if(!stateNorm[n])stateNorm[n]={name:n,orders:0,revenue:0,units:0};stateNorm[n].orders+=s.orders;stateNorm[n].revenue+=s.revenue;stateNorm[n].units+=s.units;});
  const hourlyArr = Object.entries(hourlyMap).map(([h,c])=>({hour:h,orders:c})).sort((a,b)=>a.hour.localeCompare(b.hour));
  const wdOrder = ['Mo','Di','Mi','Do','Fr','Sa','So'];
  const weekdayArr = wdOrder.filter(d=>wdMap[d]).map(d=>({day:d,orders:wdMap[d].orders,revenue:Math.round(wdMap[d].revenue*100)/100}));

  return {
    marketplace:'amazon', daily:dailyArr, sku:skuArr,
    states:Object.values(stateNorm).sort((a,b)=>b.revenue-a.revenue),
    hourly:hourlyArr, weekday:weekdayArr,
    meta:{orders:totalOrders, revenue:Math.round(totalRevenue*100)/100, rows:rows.length, dateRange:[dailyArr[0]?.date,dailyArr[dailyArr.length-1]?.date]}
  };
}

/* ═══ EBAY ORDER REPORT PARSER ═══ */
function parseEbayOrders(lines) {
  // Find header line (usually line 1)
  let headerIdx = -1;
  for(let i=0;i<Math.min(5,lines.length);i++) {
    if(lines[i].includes('Verkaufsprotokollnummer') || lines[i].includes('Bestellnummer')) { headerIdx=i; break; }
  }
  if(headerIdx===-1) throw new Error('eBay-Header nicht gefunden');

  const headerRow = csvSplit(lines[headerIdx], ';');
  // Find column indices
  const col = {};
  headerRow.forEach((h,i)=>{
    const hl = h.toLowerCase().replace(/\u00a0/g,' ').trim();
    if(hl.includes('bestellnummer') && !col.orderId) col.orderId=i;
    if(hl.includes('bestandseinheit') || hl.includes('sku')) col.sku=i;
    if(hl.includes('angebotstitel')) col.title=i;
    if(hl.includes('anzahl') && !col.qty) col.qty=i;
    if(hl.includes('verkauft für') && !col.price) col.price=i;
    if(hl.includes('gesamtbetrag') && !hl.includes('inkl') && col.total===undefined) col.total=i;
    if(hl.includes('verkauft am')) col.date=i;
    if((hl.includes('versand nach') && hl.includes('ort')) || hl.includes('wohnort des käufers')) { if(!col.city) col.city=i; }
    if((hl.includes('versand nach') && hl.includes('bundesland')) || hl.includes('bundesland des käufers')) { if(!col.state) col.state=i; }
    if(hl.includes('verpackung und versand')) col.shipping=i;
    if(hl.includes('artikelnummer') && !col.itemNo) col.itemNo=i;
  });

  console.log('[eBay] Column map:', col);

  const daily={}, skuMap={}, cityMap={}, hourlyMap={}, wdMap={};
  const seenOrders = new Set();
  let totalOrders=0, totalRevenue=0;

  for(let i=headerIdx+1;i<lines.length;i++) {
    const line = lines[i].trim();
    if(!line || line.startsWith('""') || line.startsWith('"";')) continue;
    const r = csvSplit(line, ';');
    if(r.length<20) continue;
    if(!r[col.orderId]?.trim() && !r[0]?.trim()) continue;

    const dateStr = r[col.date]||'';
    const isoDate = parseEbayDate(dateStr);
    if(!isoDate) continue;

    const qty = pNum(r[col.qty])||1;
    const price = pNum(r[col.price]);
    const total = pNum(r[col.total]) || price*qty;
    const sku = (r[col.sku]||'').trim();
    const title = (r[col.title]||'').trim().substring(0,100);
    const city = (r[col.city]||'').trim();
    const orderId = (r[col.orderId]||'').trim();

    if(!daily[isoDate]) daily[isoDate]={date:isoDate,orders:0,units:0,revenue:0,refunds:0,refundUnits:0,refundAmount:0,fees:0,fbaFees:0,promo:0,shippingCredit:0,net:0,serviceFees:0,storageFees:0};
    const d = daily[isoDate];

    // Count unique orders
    if(!seenOrders.has(orderId)) { d.orders++; seenOrders.add(orderId); totalOrders++; }
    d.units+=qty;
    d.revenue+=total;
    d.net+=total; // eBay doesn't show fees in this export
    totalRevenue+=total;

    try { const wd=new Date(isoDate).getDay(); const wdn=WEEKDAY_MAP[wd]; if(!wdMap[wdn])wdMap[wdn]={orders:0,revenue:0}; wdMap[wdn].orders++; wdMap[wdn].revenue+=total; } catch{}

    if(sku) {
      if(!skuMap[sku]) skuMap[sku]={sku,title,revenue:0,units:0,orders:0,refunds:0,refundAmount:0,fees:0,fbaFees:0,promo:0,net:0};
      skuMap[sku].revenue+=total; skuMap[sku].units+=qty; skuMap[sku].orders++; skuMap[sku].net+=total;
    }

    if(city) { if(!cityMap[city]) cityMap[city]={name:city,orders:0,revenue:0,units:0}; cityMap[city].orders++; cityMap[city].revenue+=total; cityMap[city].units+=qty; }
  }

  const dailyArr = Object.values(daily).sort((a,b)=>a.date.localeCompare(b.date));
  const skuArr = Object.values(skuMap).sort((a,b)=>b.revenue-a.revenue);
  const cityArr = Object.values(cityMap).sort((a,b)=>b.revenue-a.revenue);
  const wdOrder=['Mo','Di','Mi','Do','Fr','Sa','So'];
  const weekdayArr = wdOrder.filter(d=>wdMap[d]).map(d=>({day:d,orders:wdMap[d].orders,revenue:Math.round(wdMap[d].revenue*100)/100}));

  return {
    marketplace:'ebay', daily:dailyArr, sku:skuArr,
    states:cityArr, hourly:[], weekday:weekdayArr,
    meta:{orders:totalOrders, revenue:Math.round(totalRevenue*100)/100, rows:lines.length-headerIdx-1, dateRange:[dailyArr[0]?.date,dailyArr[dailyArr.length-1]?.date]}
  };
}

/* ═══ Simple CSV line splitter respecting quotes ═══ */
function csvSplit(line, delim=',') {
  const result = []; let cur=''; let inQuote=false;
  for(let i=0;i<line.length;i++) {
    const c = line[i];
    if(c==='"') {
      if(inQuote && line[i+1]==='"') { cur+='"'; i++; }
      else inQuote=!inQuote;
    } else if(c===delim && !inQuote) { result.push(cur); cur=''; }
    else cur+=c;
  }
  result.push(cur);
  return result;
}

/* ═══ MAIN PARSE FUNCTION ═══ */
export function parseImport(fileText) {
  const cleaned = norm(fileText);
  const format = detectFormat(cleaned);
  console.log('[Parser] Detected format:', format, '| Length:', cleaned.length);

  const lines = cleaned.split('\n');

  if(format==='amazon_transaction') return parseAmazonTransaction(lines);
  if(format==='ebay') return parseEbayOrders(lines);

  // Fallback: try as Amazon business report (from previous parser)
  throw new Error(`Unbekanntes Format. Unterstützt: Amazon Custom Transaction Report, eBay Bestellbericht.\nErkannt: ${format}`);
}

export function readFileAsText(file) {
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = e => resolve(e.target.result);
    r.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
    r.readAsText(file, 'UTF-8');
  });
}
