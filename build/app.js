"use strict";
const DATA = JSON.parse(document.getElementById('payload').textContent);
const MEDIA = DATA.media, GA = DATA.ga, SALES = DATA.sales, BUYERS = DATA.buyers || [], B = DATA.build;
const TAX = B.tax_factor || 1;
const MAIN_PRODUCT = B.main_product || 'Todos os produtos';
/* Canais: Meta/Google/TikTok = mídia paga (gasto vem das abas de mídia); "outros" = orgânico/
   direto/etc. (só entra na Visão Geral). A separação usa Session source/medium (GA4) e
   utm_source/utm_medium (Compras) — ver classify_channel() em build/build.py. */
const PAID = ['meta','google','tiktok'];
const CH_LABEL = {meta:'Meta Ads', google:'Google Ads', tiktok:'TikTok Ads', instagram_org:'Instagram Org', gpt:'ChatGPT Org', google_org:'Google Org', direto:'Direto', outros:'Outros'};

/* ---------------- format ---------------- */
const nf0=new Intl.NumberFormat('pt-BR',{maximumFractionDigits:0});
const nf1=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
const nf2=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
const brl=v=>(v==null||!isFinite(v))?'-':'R$ '+nf2.format(v);
const pct=v=>(v==null||!isFinite(v))?'-':nf2.format(v*100)+'%';
const intf=v=>(v==null||!isFinite(v))?'-':nf0.format(v);
const numf=v=>(v==null||!isFinite(v))?'-':nf1.format(v);
const roasf=v=>(v==null||!isFinite(v))?'-':nf1.format(v)+'x';
const dimf=v=>v==null?'-':String(v);
/* remove acentos p/ casar com o norm() do build.py (unicodedata NFKD) */
const norm=s=>(s==null?'':String(s)).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
const brdate=d=>{ if(!d) return '-'; const p=d.split('-'); return p[2]+'/'+p[1]+'/'+p[0]; };
const WD=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const weekday=d=>{ const dt=new Date(d+'T00:00:00'); return isNaN(dt)?'':WD[dt.getDay()]; };

/* ---------------- date helpers ---------------- */
function pad(n){return String(n).padStart(2,'0');}
function dstr(dt){return dt.getFullYear()+'-'+pad(dt.getMonth()+1)+'-'+pad(dt.getDate());}
function addDays(s,n){const dt=new Date(s+'T00:00:00');dt.setDate(dt.getDate()+n);return dstr(dt);}
const TODAY = B.today || B.date_max;

/* ---------------- STATE ---------------- */
const STATE = {
  page:'geral', from:B.date_min, to:B.date_max, preset:'todo', tax:true,
  gran:{gCombo:'dia',mCombo:'dia',relCombo:'dia'},   /* granularidade de cada gráfico de evolução */
  selDays:new Set(), gTraf:'todos', gSrc:'todos',   /* filtros da Visão Geral: tráfego (pago/organico) e canal (utm_source) */
  mSelC:new Set(), mSelA:new Set(), mSelAd:new Set(),
  sort:{}, colw: (()=>{ try{ return JSON.parse(localStorage.getItem('dm_colw')||'{}'); }catch(e){ return {}; } })(),
  search:{tCamp:'', tAdset:'', tAd:'', tKw:''},
};
const taxf = ()=> STATE.tax ? TAX : 1;
/* o imposto incide só sobre o gasto do Meta Ads */
const spx = r => r.sp * (r.ch==='meta' ? taxf() : 1);

/* active date test: selDays override the De/Até range */
function dateActive(d){
  if(!d) return false;
  if(STATE.selDays.size) return STATE.selDays.has(d);
  return (!STATE.from || d>=STATE.from) && (!STATE.to || d<=STATE.to);
}

/* ---------------- aggregation ----------------
   bucket = {sp,im,cl, pv,pvp,vi,atc,ck, vendas,fat,n}
   sp/im/cl : mídia paga (abas Meta/Google/TikTok)
   pv/vi/atc/ck : SESSÕES do GA4 (page_view / view_item / add_to_cart / begin_checkout)
   pvp : page views só dos canais pagos (base de CR e CPV — evita dividir tráfego orgânico por cliques pagos)
   vendas = nº de pedidos (Order IDs distintos) · fat = soma do Preço dos itens · n = itens */
function newBucket(){return {sp:0,im:0,cl:0,pv:0,pvp:0,vi:0,atc:0,ck:0,vv3:0,vv50:0,vv95:0,vendas:0,fat:0,n:0};}
function addMedia(a,r){ a.sp+=spx(r); a.im+=r.im; a.cl+=r.cl; a.vv3+=r.vv3||0; a.vv50+=r.vv50||0; a.vv95+=r.vv95||0; }
function addGa(a,r){ a.pv+=r.pv; if(r.ch!=='outros') a.pvp+=r.pv; a.vi+=r.vi; a.atc+=r.atc; a.ck+=r.ck; }
function addSales(a,r){ a.vendas+=r.main; a.fat+=r.val; a.n+=r.n; }
function derive(a){
  const g=a.sp;
  return {gasto:g, impr:a.im, cliques:a.cl, pv:a.pv, vi:a.vi, atc:a.atc, ck:a.ck, vendas:a.vendas, fat:a.fat,
    cpm:a.im?g/a.im*1000:null, ctr:a.im?a.cl/a.im:null, cpc:a.cl?g/a.cl:null,
    /* HR/BR/ER = retenção de vídeo (3s / 50% / 95%) sobre Impressões — só tabela de Anúncios do Meta */
    hr:a.im?a.vv3/a.im:null, br:a.im?a.vv50/a.im:null, er:a.im?a.vv95/a.im:null,
    cpv:a.pvp?g/a.pvp:null, cr:a.cl?a.pvp/a.cl:null,        /* CR = Page Views / Cliques */
    cppv:a.vi?g/a.vi:null, pvr:a.pv?a.vi/a.pv:null,         /* PVR = Product View / Page Views */
    cpac:a.atc?g/a.atc:null, acr:a.vi?a.atc/a.vi:null,      /* ACR = AddToCart / Product View */
    cpic:a.ck?g/a.ck:null, vischk:a.atc?a.ck/a.atc:null,    /* VisCHK = Checkouts / AddToCart */
    convpv:a.pv?a.vendas/a.pv:null,
    convchk:a.ck?a.vendas/a.ck:null,                        /* ConvCHK = Compras / Checkouts */
    cac:(a.vendas&&g)?g/a.vendas:null, roas:g?a.fat/g:null, ticket:a.vendas?a.fat/a.vendas:null};
}
function buildAgg(fS,fM,dim){
  const m={}; const get=k=>m[k]||(m[k]=newBucket());
  fM.forEach(r=>addMedia(get(r[dim]),r));
  fS.forEach(r=>addSales(get(r[dim]),r));
  return m;
}
function totals(fS,fM,fG){
  const a=newBucket();
  fM.forEach(r=>addMedia(a,r)); (fG||[]).forEach(r=>addGa(a,r)); fS.forEach(r=>addSales(a,r));
  return a;
}
function daily(fS,fM,fG){
  const days={}; const g=d=>days[d]||(days[d]=Object.assign({d},newBucket()));
  fM.forEach(r=>{ if(r.d) addMedia(g(r.d),r); });
  (fG||[]).forEach(r=>{ if(r.d) addGa(g(r.d),r); });
  fS.forEach(r=>{ if(r.d) addSales(g(r.d),r); });
  return Object.values(days).sort((a,b)=>a.d<b.d?-1:1);
}
const inRange=(d,a,b)=>d&&d>=a&&d<=b;

/* Granularidade dos gráficos de evolução: agrega as linhas diárias em semana/mês/trimestre/semestre/ano. */
const GRANS=[['dia','Diário','diária'],['semana','Semanal','semanal'],['mes','Mensal','mensal'],['tri','Trimestral','trimestral'],['sem','Semestral','semestral'],['ano','Anual','anual']];
function granKey(d,g){
  const y=+d.slice(0,4), m=+d.slice(5,7), yy=d.slice(2,4);
  if(g==='semana'){ const dt=new Date(d+'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate()-(dt.getUTCDay()+6)%7); const s=dt.toISOString().slice(0,10);
    const th=new Date(dt); th.setUTCDate(th.getUTCDate()+3); const wy=th.getUTCFullYear();
    const wk=Math.ceil(((th-Date.UTC(wy,0,1))/86400000+1)/7); return [s,'Semana '+wk+'/'+String(wy).slice(2)]; }
  if(g==='mes') return [d.slice(0,7), MONTHS_PT[m-1]+'/'+yy];
  if(g==='tri'){ const q=Math.ceil(m/3); return [y+'-'+q, q+'º Trimestre/'+yy]; }
  if(g==='sem'){ const h=m<=6?1:2; return [y+'-'+h, h+'º Semestre/'+yy]; }
  return [String(y), String(y)];
}
function rollup(dd,g){
  if(!g||g==='dia') return dd.map(x=>Object.assign({lbl:x.d.slice(8)+'/'+x.d.slice(5,7)+'/'+x.d.slice(0,4)},x));
  const out={};
  dd.forEach(x=>{ const [k,l]=granKey(x.d,g); const o=out[k]||(out[k]=Object.assign({d:k,lbl:l},newBucket()));
    Object.keys(newBucket()).forEach(f=>{ o[f]+=x[f]; }); });
  return Object.values(out).sort((a,b)=>a.d<b.d?-1:1);
}

/* Escopo de dados de uma página. ch=null -> todos os canais (Visão Geral); ch='meta'|'google'|'tiktok'
   -> só aquele canal, com o drill-down Campanha→Conjunto→Anúncio (`ex` = dimensão a NÃO filtrar,
   para a própria tabela mostrar todas as suas linhas). win = janela custom (período anterior).
   O GA4 não tem campanha/anúncio: com qualquer seleção ativa o funil do GA4 sai do escopo (sel=true). */
function scopeData(ch, ex, win, gf){
  const ok = win ? (d=>inRange(d,win.from,win.to)) : dateActive;
  const f = r => ok(r.d) && (!ch || r.ch===ch) && (!gf || geralMatch(r));
  let fM=MEDIA.filter(f), fS=SALES.filter(f), fG=GA.filter(f);
  let sel=false;
  if(ch){
    const flt=(set,k)=>{ if(set.size){ fM=fM.filter(r=>set.has(r[k])); fS=fS.filter(r=>set.has(r[k])); sel=true; } };
    if(ex!=='C') flt(STATE.mSelC,'camp');
    if(ex!=='A') flt(STATE.mSelA,'adset');
    if(ex!=='D') flt(STATE.mSelAd,'ad');
  }
  if(sel) fG=[];
  return {fM,fS,fG,sel};
}

/* Filtros da Visão Geral: Tráfego (Pago = mídia paga · Orgânico = o resto) e Canal (utm_source).
   Linhas de mídia não têm `src`: valem o próprio canal pago. */
const G_TRAF=[['todos','Todos'],['pago','Pago'],['organico','Orgânico']];
const G_SRC=[['todos','Todos'],['meta','Meta Ads'],['google','Google Ads'],['instagram_org','Instagram Org'],['gpt','ChatGPT Org'],['google_org','Google Org'],['direto','Direto'],['outros','Outros']];
function geralMatch(r){
  const paid=PAID.includes(r.ch);
  if(STATE.gTraf==='pago' && !paid) return false;
  if(STATE.gTraf==='organico' && paid) return false;
  return STATE.gSrc==='todos' || (r.src||r.ch)===STATE.gSrc;
}
function gfCloseAll(){ document.querySelectorAll('.gf-menu').forEach(m=>{ m.hidden=true; const b=m.parentElement.querySelector('.gf-btn'); if(b) b.setAttribute('aria-expanded','false'); }); }
document.addEventListener('click',gfCloseAll);
document.addEventListener('keydown',e=>{ if(e.key==='Escape') gfCloseAll(); });
function renderGeralFilters(){
  const mk=(id,opts,key)=>{ const el=document.getElementById(id); if(!el) return;
    const cur=(opts.find(o=>o[0]===STATE[key])||opts[0])[1];
    el.innerHTML=`<button type="button" class="btn gf-btn" aria-haspopup="true" aria-expanded="false"><span>${cur}</span><span class="period-caret">▾</span></button>`+
      `<div class="gf-menu" hidden>${opts.map(([v,l])=>`<button type="button" class="pp-preset${STATE[key]===v?' active':''}" data-v="${v}">${l}</button>`).join('')}</div>`;
    const btn=el.querySelector('.gf-btn'), menu=el.querySelector('.gf-menu');
    btn.onclick=e=>{ e.stopPropagation(); const open=menu.hidden; gfCloseAll(); if(open){ menu.hidden=false; btn.setAttribute('aria-expanded','true'); } };
    menu.onclick=e=>{ e.stopPropagation(); const b=e.target.closest('[data-v]'); if(b){ STATE[key]=b.dataset.v; renderAll(); } }; };
  mk('gfTraf',G_TRAF,'gTraf'); mk('gfSrc',G_SRC,'gSrc');
}
/* dropdown de granularidade (Diário/Semanal/…) no canto do card do gráfico; `chartId` = canvas */
function renderGranDD(chartId){
  const el=document.getElementById(chartId+'Gran'); if(!el) return;
  const cur=GRANS.find(g=>g[0]===STATE.gran[chartId])||GRANS[0];
  const title=document.getElementById(chartId+'Title'); if(title) title.textContent='Evolução '+cur[2];
  el.innerHTML=`<button type="button" class="btn gf-btn" aria-haspopup="true" aria-expanded="false"><span>${cur[1]}</span><span class="period-caret">▾</span></button>`+
    `<div class="gf-menu" hidden>${GRANS.map(g=>`<button type="button" class="pp-preset${cur[0]===g[0]?' active':''}" data-v="${g[0]}">${g[1]}</button>`).join('')}</div>`;
  const btn=el.querySelector('.gf-btn'), menu=el.querySelector('.gf-menu');
  btn.onclick=e=>{ e.stopPropagation(); const open=menu.hidden; gfCloseAll(); if(open){ menu.hidden=false; btn.setAttribute('aria-expanded','true'); } };
  menu.onclick=e=>{ e.stopPropagation(); const b=e.target.closest('[data-v]'); if(b){ STATE.gran[chartId]=b.dataset.v; renderAll(); } };
}

/* ---------------- generic interactive table ---------------- */
function colWidth(cfg,c){ const saved=(STATE.colw[cfg.id]||{})[c.key];
  if(saved) return saved;
  if(c.w) return c.w;
  if(c.type==='date') return 96;
  if(c.type==='dim') return c.big?300:150;
  return 88; }
function renderTable(cfg){
  const table=document.getElementById(cfg.id); if(!table) return;
  const sortState=STATE.sort[cfg.id];
  let rows=cfg.rows.slice();
  if(sortState){ const {key,dir}=sortState; const c=cfg.cols.find(x=>x.key===key);
    rows.sort((a,b)=>{ let va=a.cells[key], vb=b.cells[key];
      if(c && c.type==='dim'){ va=norm(va); vb=norm(vb); return dir==='asc'?(va<vb?-1:va>vb?1:0):(va>vb?-1:va<vb?1:0); }
      va=(va==null||!isFinite(va))?-Infinity:va; vb=(vb==null||!isFinite(vb))?-Infinity:vb;
      return dir==='asc'?va-vb:vb-va; }); }
  const ext={};
  cfg.cols.forEach(c=>{ if(c.heat){ const vs=rows.map(r=>r.cells[c.key]).filter(v=>v!=null&&isFinite(v)); ext[c.key]=[Math.min(...vs),Math.max(...vs)]; }});
  const fmt=(t,v)=> t==='brl'?brl(v):t==='pct'?pct(v):t==='int'?intf(v):t==='num'?numf(v):t==='roas'?roasf(v):t==='date'?brdate(v):dimf(v);
  const widths=cfg.cols.map(c=>colWidth(cfg,c)); const totalW=widths.reduce((a,b)=>a+b,0);
  const colgroup='<colgroup>'+cfg.cols.map((c,i)=>`<col style="width:${widths[i]}px">`).join('')+'</colgroup>';
  let thead='<thead><tr>'+cfg.cols.map((c,i)=>{
    const sc = sortState&&sortState.key===c.key ? (sortState.dir==='asc'?'sorted-asc':'sorted-desc') : '';
    return `<th class="${c.type==='dim'?'dim ':''}${sc}" data-k="${c.key}" data-ci="${i}">${c.label}<span class="rsz"></span></th>`;
  }).join('')+'</tr></thead>';
  let tbody='<tbody>'+rows.map(r=>{
    const sel = cfg.selectable && cfg.selSet && cfg.selSet.has(r.k);
    const tds=cfg.cols.map((c,ci)=>{
      const v=r.cells[c.key]; let bg='';
      if(c.heat && ext[c.key]) bg=`background:${heat(v,ext[c.key][0],ext[c.key][1],c.heat)}`;
      const cls=(c.type==='dim'?'dim':'');
      const dot = (ci===0 && cfg.statusMap) ? statusDot(cfg.statusMap[r.k]) : '';
      return `<td class="${cls}" style="${bg}">${dot}${fmt(c.type,v)}</td>`;
    }).join('');
    return `<tr class="${sel?'sel':''}" data-k="${encodeURIComponent(r.k)}">${tds}</tr>`;
  }).join('')+'</tbody>';
  let tfoot='';
  if(cfg.total){ tfoot='<tfoot><tr>'+cfg.cols.map((c,i)=>{
    const v=cfg.total[c.key]; return `<td class="${c.type==='dim'?'dim':''}">${i===0?(v==null?'Total Geral':fmt(c.type,v)):fmt(c.type,v)}</td>`;
  }).join('')+'</tr></tfoot>'; }
  table.style.width=totalW+'px';
  table.innerHTML=colgroup+thead+tbody+tfoot;
  const cols=table.querySelector('colgroup').children;
  table.querySelectorAll('thead th').forEach(th=>{
    th.addEventListener('click',e=>{ if(e.target.classList.contains('rsz'))return;
      const k=th.dataset.k, cur=STATE.sort[cfg.id];
      if(!cur||cur.key!==k) STATE.sort[cfg.id]={key:k,dir:'asc'};
      else if(cur.dir==='asc') STATE.sort[cfg.id]={key:k,dir:'desc'};
      else delete STATE.sort[cfg.id];
      renderTable(cfg);
    });
  });
  table.querySelectorAll('thead th .rsz').forEach(g=>{
    g.addEventListener('mousedown',e=>{ e.preventDefault(); e.stopPropagation();
      const th=g.parentElement, k=th.dataset.k, ci=+th.dataset.ci, x0=e.clientX;
      const w0=cols[ci].offsetWidth, tw0=table.offsetWidth;
      document.body.style.userSelect='none';
      const mv=ev=>{ const nw=Math.max(60,w0+(ev.clientX-x0)); cols[ci].style.width=nw+'px'; table.style.width=(tw0-w0+nw)+'px';
        STATE.colw[cfg.id]=STATE.colw[cfg.id]||{}; STATE.colw[cfg.id][k]=nw; };
      const up=()=>{ document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); document.body.style.userSelect=''; localStorage.setItem('dm_colw',JSON.stringify(STATE.colw)); };
      document.addEventListener('mousemove',mv); document.addEventListener('mouseup',up);
    });
  });
  if(cfg.selectable && cfg.onSelect){
    table.querySelectorAll('tbody tr').forEach(tr=>{
      tr.addEventListener('click',e=>{ cfg.onSelect(decodeURIComponent(tr.dataset.k), e); });
    });
  }
}
/* status ATIVO/PAUSADO ao lado do nome (campanha/conjunto/anúncio) — só o
   indicativo visual; não altera dado, ordenação ou filtro nenhum. */
function statusDot(active){
  if(active==null) return '';
  return active ? '<span class="status-dot on" title="Ativo"></span>' : '<span class="status-dot off" title="Pausado"></span>';
}
/* Heatmap por coluna: cor FIXA por métrica (definida em identidade-visual.css),
   só a OPACIDADE varia com o valor (maior valor = mais vibrante). */
const HEAT_HUE={gasto:'--heat-gasto', fat:'--heat-fat', roas:'--heat-roas', vendas:'--heat-vendas'};
function heat(v,lo,hi,kind){
  if(v==null||!isFinite(v)||hi===lo||!HEAT_HUE[kind]) return 'transparent';
  const t=Math.max(0,Math.min(1,(v-lo)/(hi-lo)));
  const c=hx2rgb(cvar(HEAT_HUE[kind]));
  return `rgba(${c[0]},${c[1]},${c[2]},${(0.06+0.5*t).toFixed(3)})`;
}
function toggleSet(set,key,ctrl){
  if(ctrl){ set.has(key)?set.delete(key):set.add(key); }
  else { const only=set.has(key)&&set.size===1; set.clear(); if(!only) set.add(key); }
}

/* ---------------- charts ---------------- */
const charts={};
const CHART_SERIES=['--cc1','--cc2','--cc3','--cc4','--cc5','--cc6','--cc7','--cc8','--cc9','--cc10'];
const cvar=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const chartPalette=()=>CHART_SERIES.map(v=>cvar(v)||'#888888');
const hx2rgb=h=>{h=(h||'').replace('#','').trim();if(h.length===3)h=h.split('').map(c=>c+c).join('');const n=parseInt(h||'888888',16);return [(n>>16)&255,(n>>8)&255,n&255];};
const cmuted=()=>cvar('--muted')||'#6B7280', cink=()=>cvar('--ink')||'#1A1D2E', cgrid=()=>cvar('--grid')||'#EEF0F5';
function destroy(id){ if(charts[id]){ charts[id].destroy(); delete charts[id]; } }
const FMT={brl:brl,pct:pct,num:numf,int:intf,roas:roasf};

/* combo: Compras (barras) · Gasto/Faturamento (R$) · ROAS (eixo próprio) */
function comboChart(id, d){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  d=rollup(d, STATE.gran[id]);
  const labels=d.map(x=>x.lbl), mut=cmuted(), gr=cgrid();
  charts[id]=new Chart(el,{
    data:{labels, datasets:[
      {type:'bar',label:'Compras',data:d.map(x=>x.vendas),backgroundColor:cvar('--chart-vendas'),yAxisID:'y',borderRadius:3,order:3},
      {type:'line',label:'Gasto',data:d.map(x=>+x.sp.toFixed(2)),borderColor:cvar('--chart-gasto'),backgroundColor:cvar('--chart-gasto'),yAxisID:'y3',borderWidth:2,pointRadius:2,tension:.25,order:2},
      {type:'line',label:'Faturamento',data:d.map(x=>+x.fat.toFixed(2)),borderColor:cvar('--chart-faturamento'),backgroundColor:cvar('--chart-faturamento'),yAxisID:'y1',borderWidth:2,pointRadius:2,tension:.25,order:2},
      {type:'line',label:'ROAS',data:d.map(x=>x.sp?+(x.fat/x.sp).toFixed(2):null),borderColor:cink(),backgroundColor:cink(),yAxisID:'y2',borderWidth:2,pointRadius:2,spanGaps:true,tension:.25,order:0},
    ]},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:10,usePointStyle:true,font:{size:11}}},
        tooltip:{callbacks:{label:c=>{const v=c.raw,ax=c.dataset.yAxisID; return c.dataset.label+': '+(ax==='y1'||ax==='y3'?brl(v):ax==='y2'?roasf(v):intf(v));}}}},
      scales:{x:{ticks:{color:mut,font:{size:10}},grid:{display:false}},
        y:{position:'left',ticks:{color:mut,font:{size:10}},grid:{color:gr},beginAtZero:true,title:{display:true,text:'Compras',color:mut,font:{size:10}}},
        y1:{position:'right',ticks:{color:mut,font:{size:10}},grid:{display:false},beginAtZero:true,title:{display:true,text:'Faturamento R$',color:mut,font:{size:10}}},
        y3:{position:'right',ticks:{color:cvar('--chart-gasto')||mut,font:{size:10},callback:v=>brl(v)},grid:{display:false},beginAtZero:true,title:{display:true,text:'Gasto R$',color:cvar('--chart-gasto')||mut,font:{size:10}}},
        y2:{position:'right',ticks:{color:mut,font:{size:10},callback:v=>numf(v)+'x'},grid:{display:false},beginAtZero:true,title:{display:true,text:'ROAS',color:mut,font:{size:10}}}}}
  });
}
/* linhas genéricas (1 ou 2 eixos) */
function multiLine(id, d, series, opts){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const labels=d.map(x=>x.d.slice(5)), mut=cmuted();
  const useR=series.some(s=>s.axis==='R');
  const datasets=series.map(s=>({label:s.label,data:d.map(s.fn),borderColor:s.color,backgroundColor:s.color,
    yAxisID:s.axis==='R'?'y1':'y',borderWidth:2,pointRadius:2,spanGaps:true,tension:.25,_fmt:FMT[s.fmt]||numf}));
  const scales={x:{ticks:{color:mut,font:{size:9}},grid:{display:false}},
    y:{position:'left',ticks:{color:mut,font:{size:9},callback:v=>(FMT[opts.L.fmt]||numf)(v)},grid:{color:cgrid()},grace:'10%'}};
  if(useR) scales.y1={position:'right',grid:{display:false},ticks:{color:mut,font:{size:9},callback:v=>(FMT[opts.R.fmt]||numf)(v)},grace:'10%'};
  charts[id]=new Chart(el,{type:'line',data:{labels,datasets},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:10,usePointStyle:true,font:{size:10}}},
        tooltip:{callbacks:{label:c=>c.dataset.label+': '+(c.dataset._fmt||numf)(c.raw)}}},
      scales}});
}
/* barras horizontais (faturamento por anúncio) */
const barLabels={id:'barLabels',afterDatasetsDraw(ch){const{ctx}=ch;ctx.save();ctx.font='600 11px Segoe UI,system-ui';ctx.fillStyle=cmuted();ctx.textBaseline='middle';
  const ds=ch.data.datasets[0], f=ds._fmt||intf;
  ch.getDatasetMeta(0).data.forEach((el,i)=>{const v=ds.data[i]; if(!v)return; ctx.fillText(f(v),el.x+5,el.y);});ctx.restore();}};
function hbar(id, items, valFn, color, top, fmtFn){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  let arr=items.slice().sort((a,b)=>valFn(b)-valFn(a)); if(top) arr=arr.slice(0,top);
  const mut=cmuted(), f=fmtFn||intf;
  charts[id]=new Chart(el,{type:'bar', plugins:[barLabels],
    data:{labels:arr.map(x=>x.label), datasets:[{label:'v',data:arr.map(valFn),backgroundColor:color||'#1BAF7A',borderRadius:3,_fmt:f}]},
    options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,layout:{padding:{right:44}},
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>f(c.raw)}}},
      scales:{x:{beginAtZero:true,ticks:{color:mut,font:{size:9}},grid:{color:cgrid()}},
              y:{ticks:{color:mut,font:{size:9}},grid:{display:false}}}}});
}
/* CAC por dia, por item de uma dimensão (campanha/conjunto/anúncio) - 1 linha por item.
   `dim` = 'camp' | 'adset' | 'ad'; usa os mesmos dados escopados da tabela acima. */
function cacDimChart(id, fM, fS, dim, selSet){
  destroy(id); const el=document.getElementById(id); if(!el) return;
  const spendTot={}; fM.forEach(r=>spendTot[r[dim]]=(spendTot[r[dim]]||0)+spx(r));
  const items=(selSet&&selSet.size)
    ? Object.keys(spendTot).filter(k=>selSet.has(k)).sort((a,b)=>spendTot[b]-spendTot[a])
    : Object.keys(spendTot).sort((a,b)=>spendTot[b]-spendTot[a]).slice(0,6);
  const dset=new Set(); fM.forEach(r=>r.d&&dset.add(r.d)); fS.forEach(r=>r.d&&dset.add(r.d));
  const days=[...dset].sort();
  const K=(c,dd)=>c+'\u0001'+dd, sp={}, vd={};
  fM.forEach(r=>{if(!r.d)return; sp[K(r[dim],r.d)]=(sp[K(r[dim],r.d)]||0)+spx(r);});
  fS.forEach(r=>{if(!r.d)return; vd[K(r[dim],r.d)]=(vd[K(r[dim],r.d)]||0)+r.main;});
  const PAL=chartPalette();
  const ds=items.map((c,i)=>({label:c.length>22?c.slice(0,22)+'…':c, _full:c,
    data:days.map(dd=>{const s=(sp[K(c,dd)]||0), v=vd[K(c,dd)]||0; return v?+(s/v).toFixed(2):null;}),
    borderColor:PAL[i%PAL.length],backgroundColor:PAL[i%PAL.length],borderWidth:2,pointRadius:1.5,spanGaps:true,tension:.25}));
  const mut=cmuted();
  charts[id]=new Chart(el,{type:'line',data:{labels:days.map(x=>x.slice(5)),datasets:ds},
    options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{labels:{color:cink(),boxWidth:8,font:{size:9}}},
        tooltip:{callbacks:{label:c=>(c.dataset._full||c.dataset.label)+': '+brl(c.raw)}}},
      scales:{x:{ticks:{color:mut,font:{size:9},maxRotation:0,autoSkip:true,autoSkipPadding:8},grid:{display:false}},y:{ticks:{color:mut,font:{size:9},callback:v=>brl(v)},grid:{color:cgrid()},beginAtZero:true}}}});
}

/* ---------------- colunas das tabelas ---------------- */
/* Tabela diária (nível canal/geral): funil completo, vindo do GA4 */
const METRIC_COLS=[
  {key:'gasto',label:'Gasto',type:'brl',heat:'gasto'},   /* heatmap vermelho */
  {key:'cpm',label:'CPM',type:'brl'},
  {key:'ctr',label:'CTR',type:'pct'},
  {key:'cr',label:'CR',type:'pct'},
  {key:'pvr',label:'PVR',type:'pct'},
  {key:'acr',label:'ACR',type:'pct'},
  {key:'vischk',label:'VisCHK',type:'pct'},
  {key:'convchk',label:'ConvCHK',type:'pct'},
  {key:'vendas',label:'Compras',type:'int',heat:'vendas'}, /* heatmap azul */
  {key:'cac',label:'CAC',type:'brl'},
  {key:'fat',label:'Faturamento',type:'brl',heat:'fat'},  /* heatmap verde */
  {key:'ticket',label:'Ticket',type:'brl'},
  {key:'roas',label:'ROAS',type:'roas',heat:'roas'},      /* heatmap amarelo */
];
/* Campanha/Conjunto/Anúncio: o GA4 não traz esses níveis, então só mídia + compras atribuídas por UTM */
const OPT_COLS=[
  {key:'gasto',label:'Gasto',type:'brl',heat:'gasto'},
  {key:'impr',label:'Impr.',type:'int'},
  {key:'cpm',label:'CPM',type:'brl'},
  {key:'cliques',label:'Cliques',type:'int'},
  {key:'cpc',label:'CPC',type:'brl'},
  {key:'ctr',label:'CTR',type:'pct'},
  {key:'vendas',label:'Compras',type:'int',heat:'vendas'},
  {key:'cac',label:'CAC',type:'brl'},
  {key:'fat',label:'Faturamento',type:'brl',heat:'fat'},
  {key:'ticket',label:'Ticket',type:'brl'},
  {key:'roas',label:'ROAS',type:'roas',heat:'roas'},
];
const DAILY_COLS=[{key:'date',label:'Data',type:'date'},{key:'wd',label:'Dia',type:'dim',w:64}].concat(METRIC_COLS);
/* Meta Ads: ordem de análise do funil (Checkouts/CPIC depois do ConvCHK, Ticket no fim) */
const META_DAILY_COLS=(()=>{ const by={}; METRIC_COLS.forEach(c=>by[c.key]=c);
  by.ck={key:'ck',label:'Checkouts',type:'int'}; by.cpic={key:'cpic',label:'CPIC',type:'brl'};
  return DAILY_COLS.slice(0,2).concat(['gasto','cpm','ctr','cr','pvr','acr','vischk','convchk','ck','cpic','vendas','cac','fat','roas','ticket'].map(k=>by[k])); })();
const HCOLS=[{key:'dim',label:'',type:'dim',big:true}].concat(OPT_COLS);
/* Só a tabela de Anúncios do Meta: Gasto→CPM→CTR→Compras→CAC→Faturamento→ROAS; Impr., Cliques, CPC e Ticket no fim (sem HR/BR/ER nem funil GA4, que não existem por anúncio) */
const AD_HCOLS=(()=>{ const by={}; HCOLS.forEach(c=>by[c.key]=c);
  return ['dim','gasto','cpm','ctr','vendas','cac','fat','roas','impr','cliques','cpc','ticket'].map(k=>by[k]); })();
function metricCells(x,d){
  return {gasto:d.gasto, impr:x.im, cliques:x.cl, cpm:d.cpm, cpc:d.cpc, hr:d.hr, br:d.br, er:d.er, ctr:d.ctr, cr:d.cr, pvr:d.pvr, acr:d.acr,
    vischk:d.vischk, convchk:d.convchk, ck:x.ck, cpic:d.cpic, vendas:x.vendas, cac:d.cac, fat:x.fat, ticket:d.ticket, roas:d.roas};
}
function dailyCells(x,d,isTotal){
  return Object.assign({date:isTotal?null:x.d, wd:isTotal?'':weekday(x.d)}, metricCells(x,d));
}

/* ---------------- tabela Compras por produto ---------------- */
function renderProdTable(id, salesSet){
  const by={}; let totN=0, totV=0;
  salesSet.forEach(r=>{ const a=by[r.prod]||(by[r.prod]={n:0,v:0}); a.n+=r.n; a.v+=r.val; totN+=r.n; totV+=r.val; });
  const rows=Object.entries(by).sort((a,b)=>b[1].v-a[1].v).map(([prod,a])=>
    ({k:prod, cells:{prod:prod, itens:a.n, fat:a.v, ticket:a.n?a.v/a.n:null, pctf:totV?a.v/totV:null}}));
  renderTable({id, cols:[{key:'prod',label:'Produto',type:'dim',big:true},{key:'itens',label:'Itens',type:'int',w:70},
      {key:'fat',label:'Faturamento',type:'brl',w:110},{key:'ticket',label:'Ticket Médio',type:'brl',w:110},{key:'pctf',label:'% Fat.',type:'pct',w:80}],
    rows, total:{prod:null,itens:totN,fat:totV,ticket:totN?totV/totN:null,pctf:totV?1:null}});
}

/* ---- comparativo período atual vs período anterior de MESMO tamanho ---- */
function prevWindow(){
  if(!STATE.from||!STATE.to) return null;
  const span=Math.round((new Date(STATE.to+'T00:00:00')-new Date(STATE.from+'T00:00:00'))/86400000)+1;
  if(!(span>=1)) return null;
  return {from:addDays(STATE.from,-span), to:addDays(STATE.from,-1), span};
}
/* métricas em que MENOR é melhor (custo); nas demais, maior é melhor */
const GOOD_LOW={gasto:1,cpm:1,cpc:1,cpv:1,cppv:1,cpac:1,cpic:1,cac:1};
function deltaBadge(cur,prev,key){
  if(cur==null||prev==null||!isFinite(cur)||!isFinite(prev)||prev===0) return '';
  const p=((cur-prev)/Math.abs(prev))*100; if(!isFinite(p)) return '';
  const flat=Math.abs(p)<0.05, up=cur>prev;
  const good=flat?null:(GOOD_LOW[key]?!up:up);
  const cls=flat?'flat':(good?'good':'bad'), arrow=flat?'→':(up?'▲':'▼');
  return `<span class="delta ${cls}">${arrow} ${nf1.format(Math.abs(p))}%</span>`;
}
/* sparkline (SVG) da série diária de uma etapa; sem dados suficientes -> vazio.
   dates/fmt alimentam o tooltip ao passar o mouse (ver initSparkTip) */
const SPARKS=[];
function spark(vals,dates,fmt){
  const v=vals.map(x=>(x==null||!isFinite(x))?null:x), n=v.length, nums=v.filter(x=>x!=null);
  if(!nums.length) return '<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none"></svg>';
  const mn=Math.min(...nums), mx=Math.max(...nums), rg=(mx-mn)||1;
  const X=i=>n>1?i/(n-1)*100:50, Y=x=>mx===mn?15:27-(x-mn)/rg*24;
  const pts=[]; v.forEach((x,i)=>{ if(x!=null) pts.push([X(i),Y(x)]); });
  const line=pts.map((q,i)=>(i?'L':'M')+q[0].toFixed(1)+' '+q[1].toFixed(1)).join(' ');
  const last=pts[pts.length-1];
  const area=pts.length>1?`<path d="${line} L${last[0].toFixed(1)} 30 L${pts[0][0].toFixed(1)} 30 Z" class="spark-area"/>`:'';
  const sid=SPARKS.push({v,dates:dates||[],fmt:fmt||numf,X,Y})-1;
  return `<svg class="spark" data-sp="${sid}" viewBox="0 0 100 30" preserveAspectRatio="none">${area}<path d="${line}" class="spark-line"/></svg>`;
}
/* tooltip discreto das sparklines: data, dia da semana e valor do ponto sob o mouse */
function initSparkTip(){
  const tip=document.createElement('div'); tip.className='spark-tip';
  const dot=document.createElement('div'); dot.className='spark-dot';
  document.body.appendChild(tip); document.body.appendChild(dot);
  const hide=()=>{ tip.style.display='none'; dot.style.display='none'; };
  document.addEventListener('mousemove',e=>{
    const svg=e.target.closest&&e.target.closest('svg.spark[data-sp]');
    if(!svg) return hide();
    const sp=SPARKS[+svg.dataset.sp]; if(!sp) return hide();
    const r=svg.getBoundingClientRect(), n=sp.v.length;
    const fx=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));
    let i=n>1?Math.round(fx*(n-1)):0;
    if(sp.v[i]==null){ let best=-1; sp.v.forEach((x,j)=>{ if(x!=null&&(best<0||Math.abs(j-i)<Math.abs(best-i))) best=j; }); i=best; }
    if(i<0||sp.v[i]==null) return hide();
    const d=sp.dates[i];
    tip.innerHTML=`<b>${d?brdate(d):''}</b>${d?' · '+weekday(d):''}<span>${sp.fmt(sp.v[i])}</span>`;
    tip.style.display='block';
    const px=r.left+sp.X(i)/100*r.width, py=r.top+sp.Y(sp.v[i])/30*r.height;
    dot.style.left=px+'px'; dot.style.top=py+'px'; dot.style.display='block';
    const tw=tip.offsetWidth, th=tip.offsetHeight;
    tip.style.left=Math.max(4,Math.min(innerWidth-tw-4,px-tw/2))+'px';
    tip.style.top=Math.max(4,py-th-10)+'px';
  });
  document.addEventListener('mouseleave',hide);
  window.addEventListener('scroll',hide,true);
}
initSparkTip();
/* funil horizontal: KPIs (Gasto/Faturamento/ROAS/Ticket) + etapas em linha, com a taxa de conversão entre elas */
function renderFunnel(id, steps, dd){
  dd=dd||[];
  const st={}; steps.forEach(s=>st[s[3]]=s);
  const ser={gasto:x=>x.sp, impr:x=>x.im, cl:x=>x.cl, pv:x=>x.pv, vi:x=>x.vi, atc:x=>x.atc, ck:x=>x.ck, vendas:x=>x.vendas, fat:x=>x.fat,
    roas:x=>x.sp?x.fat/x.sp:null, ticket:x=>x.vendas?x.fat/x.vendas:null};
  const fm={gasto:brl,fat:brl,ticket:brl,roas:roasf,impr:intf,cl:intf,pv:intf,vi:intf,atc:intf,ck:intf,vendas:intf};
  const dates=dd.map(x=>x.d);
  const sp=k=>spark(dd.map(ser[k]),dates,fm[k]);
  const sec=(s,i)=>s[2][i]||['',''];
  const pill=x=>`<span class="s-val${x[2]?' s-pill '+x[2]:''}">${x[1]}</span>`;
  const kpi=(label,val,key,delta,cls,tone)=>`<div class="fk${tone?' tint t-'+tone:''}"><div class="fk-label">${label}</div><div class="fk-val ${cls||''}">${val}</div>${delta?`<div class="m-delta">${delta}</div>`:''}${sp(key)}</div>`;
  const g=st.gasto, f=st.fat, roas=sec(f,0), tick=sec(f,1);
  const kpis=kpi('Gasto total',g[1],'gasto',g[5],'','red')+kpi('Faturamento',f[1],'fat',f[5],'','green')
    +kpi('ROAS',roas[1],'roas','','roas-v','yellow')+kpi('Ticket médio',tick[1],'ticket');
  const order=['impr','cl','pv','vi','atc','ck','vendas'];
  const stepsHtml=order.map((k,i)=>{
    const s=st[k], cost=sec(s,0), rate=sec(s,1);
    const conn=i?`<div class="fs-conn"><span class="fs-arrow">›</span><span class="fs-rate-l">${rate[0]}</span><span class="fs-rate">${rate[1]}</span></div>`:'';
    return conn+`<div class="fs${k==='vendas'?' tint t-blue':''}"><div class="fs-label">${s[0]}</div><div class="fs-val">${s[1]}</div>${s[5]?`<div class="m-delta">${s[5]}</div>`:''}${sp(k)}
      <div class="fs-cost"><span class="s-label">${cost[0]}</span>${pill(cost)}</div></div>`;
  }).join('');
  document.getElementById(id).innerHTML=`<div class="fnl-kpis">${kpis}</div><div class="fnl-steps">${stepsHtml}</div>`;
}
/* noGA: com campanha/conjunto/anúncio selecionado as etapas do GA4 não existem naquele nível */
function funnelSteps(t, tp, noGA){
  const d=derive(t), P=(k)=>tp?tp[k]:null, Pd=tp?derive(tp):null, dl=(cur,prev,key)=>deltaBadge(cur,prev,key);
  const G=(v,fn)=>noGA?'—':fn(v), S=(v,fn)=>noGA?'—':fn(v);
  return [
    ['Gasto Total', brl(d.gasto), [], 'gasto', '--heat-gasto', dl(d.gasto, Pd?Pd.gasto:null, 'gasto')],
    ['Impressões', intf(t.im), [['CPM',brl(d.cpm)]], 'impr', '--c6', dl(t.im, P('im'), 'im')],
    ['Cliques', intf(t.cl), [['CPC',brl(d.cpc)],['CTR',pct(d.ctr)]], 'cl', '--c1', dl(t.cl, P('cl'), 'cl')],
    ['Page Views', G(t.pv,intf), [['CPV',S(d.cpv,brl)],['CR',S(d.cr,pct)]], 'pv', '--c4', noGA?'':dl(t.pv, P('pv'), 'pv')],
    ['Product View', G(t.vi,intf), [['CPPV',S(d.cppv,brl)],['PVR',S(d.pvr,pct)]], 'vi', '--c8', noGA?'':dl(t.vi, P('vi'), 'vi')],
    ['AddToCart', G(t.atc,intf), [['CPAC',S(d.cpac,brl)],['ACR',S(d.acr,pct)]], 'atc', '--c3', noGA?'':dl(t.atc, P('atc'), 'atc')],
    ['Checkouts', G(t.ck,intf), [['CPIC',S(d.cpic,brl)],['VisCHK',S(d.vischk,pct)]], 'ck', '--c5', noGA?'':dl(t.ck, P('ck'), 'ck')],
    ['Compras', intf(t.vendas), [['CAC',brl(d.cac),'cac'],['ConvCHK',S(d.convchk,pct)]], 'vendas', '--c7', dl(t.vendas, P('vendas'), 'vendas')],
    ['Faturamento', brl(t.fat), [['ROAS',roasf(d.roas),'roas'],['Ticket Médio',brl(d.ticket)]], 'fat', '--heat-fat', dl(t.fat, P('fat'), 'fat')],
  ];
}
function convCharts(ids,dd){
  multiLine(ids[0], dd, [{label:'CPM',fn:x=>x.im?+(x.sp/x.im*1000).toFixed(2):null,color:cvar('--chart-cpm'),fmt:'brl',axis:'L'},
     {label:'CTR',fn:x=>x.im?+(x.cl/x.im).toFixed(4):null,color:cvar('--chart-ctr'),fmt:'pct',axis:'R'}], {L:{fmt:'brl'},R:{fmt:'pct'}});
  multiLine(ids[1], dd, [{label:'CR',fn:x=>x.cl?+(x.pvp/x.cl).toFixed(4):null,color:cvar('--chart-cr'),fmt:'pct',axis:'L'},
     {label:'PVR',fn:x=>x.pv?+(x.vi/x.pv).toFixed(4):null,color:cvar('--chart-vischk'),fmt:'pct',axis:'L'}], {L:{fmt:'pct'}});
  multiLine(ids[2], dd, [{label:'ACR',fn:x=>x.vi?+(x.atc/x.vi).toFixed(4):null,color:cvar('--chart-convlp'),fmt:'pct',axis:'L'},
     {label:'VisCHK',fn:x=>x.atc?+(x.ck/x.atc).toFixed(4):null,color:cvar('--chart-vischk'),fmt:'pct',axis:'L'}], {L:{fmt:'pct'}});
  multiLine(ids[3], dd, [{label:'ConvCHK',fn:x=>x.ck?+(x.vendas/x.ck).toFixed(4):null,color:cvar('--chart-convlp'),fmt:'pct',axis:'L'},
     {label:'Compras/Page View',fn:x=>x.pv?+(x.vendas/x.pv).toFixed(4):null,color:cvar('--chart-cr'),fmt:'pct',axis:'L'}], {L:{fmt:'pct'}});
}

/* ---------------- PAGE 1: Visão Geral (acumulado de todos os canais) ---------------- */
function renderGeral(){
  renderGeralFilters();
  const S=scopeData(null,null,null,true), t=totals(S.fS,S.fM,S.fG), d=derive(t);
  const pw=prevWindow(); let tp=null;
  if(pw){ const P=scopeData(null,null,pw,true); tp=totals(P.fS,P.fM,P.fG); }
  const dd=daily(S.fS,S.fM,S.fG);
  renderFunnel('geralFunnel', funnelSteps(t, tp, false), dd);
  convCharts(['gCpmCtr','gCrPvr','gAcrChk','gConv'], dd);
  renderGranDD('gCombo'); comboChart('gCombo', dd);
  renderProdTable('gProd', S.fS);

  /* resumo por canal */
  const chRows=['meta','google','tiktok','instagram_org','gpt','google_org','direto','outros'].map(ch=>{
    const f=r=>(r.src||r.ch)===ch, x=totals(S.fS.filter(f),S.fM.filter(f),S.fG.filter(f)), dv=derive(x);
    return {k:ch, cells:{dim:CH_LABEL[ch], gasto:dv.gasto, cliques:x.cl, pv:x.pv, ck:x.ck, vendas:x.vendas, cac:dv.cac, fat:x.fat, ticket:dv.ticket, roas:dv.roas, share:t.fat?x.fat/t.fat:null}};
  });
  renderTable({id:'gChan', cols:[{key:'dim',label:'Canal',type:'dim',w:130},
      {key:'gasto',label:'Gasto',type:'brl'},{key:'cliques',label:'Cliques',type:'int'},{key:'pv',label:'Page Views',type:'int'},
      {key:'ck',label:'Checkouts',type:'int'},{key:'vendas',label:'Compras',type:'int',heat:'vendas'},{key:'cac',label:'CAC',type:'brl'},
      {key:'fat',label:'Faturamento',type:'brl',heat:'fat',w:120},{key:'ticket',label:'Ticket',type:'brl'},{key:'roas',label:'ROAS',type:'roas'},
      {key:'share',label:'% Fat.',type:'pct'}],
    rows:chRows,
    total:{dim:null,gasto:d.gasto,cliques:t.cl,pv:t.pv,ck:t.ck,vendas:t.vendas,cac:d.cac,fat:t.fat,ticket:d.ticket,roas:d.roas,share:t.fat?1:null}});

  const dl=dd.slice().reverse();
  renderTable({id:'gDaily', cols:DAILY_COLS,
    rows:dl.map(x=>{const dv=derive(x); return {k:x.d, cells:dailyCells(x,dv)};}),
    total:dailyCells(t,d,true),
    selectable:true, selSet:STATE.selDays,
    onSelect:(k,e)=>{ toggleSet(STATE.selDays,k,e&&(e.ctrlKey||e.metaKey)); syncDateInputs(); renderAll(); },
  });
}

/* ---------------- PAGE 2: canal de mídia (Meta / Google / TikTok) ---------------- */
function latestStatusByDim(fM, dim, statusField){
  const latest={};
  fM.forEach(r=>{
    const st=r[statusField];
    if(st==null) return;
    const k=r[dim];
    const prev=latest[k];
    if(!prev || (r.d||'')>=(prev.d||'')) latest[k]={d:r.d, v:st};
  });
  const out={};
  Object.keys(latest).forEach(k=>out[k]=latest[k].v);
  return out;
}
/* Mesmo escopo de campanha/conjunto/anúncio, mas SEM filtro de data (o ativo/pausado usa a linha mais recente) */
function mediaAllDates(ch, ex){
  let fM=MEDIA.filter(r=>r.ch===ch);
  if(ex!=='C'&&STATE.mSelC.size) fM=fM.filter(r=>STATE.mSelC.has(r.camp));
  if(ex!=='A'&&STATE.mSelA.size) fM=fM.filter(r=>STATE.mSelA.has(r.adset));
  if(ex!=='D'&&STATE.mSelAd.size) fM=fM.filter(r=>STATE.mSelAd.has(r.ad));
  return fM;
}
function selDim(dim,key,ctrl){
  const s={C:STATE.mSelC,A:STATE.mSelA,D:STATE.mSelAd}[dim];
  if(ctrl){ s.has(key)?s.delete(key):s.add(key); }
  else { const sole=s.has(key)&&s.size===1; s.clear(); if(!sole) s.add(key); }
  renderChannel();
}
function renderChannel(){
  const ch=STATE.page, label=CH_LABEL[ch];
  const S=scopeData(ch), t=totals(S.fS,S.fM,S.fG), d=derive(t);
  const hasMedia=!!(B.channels_with_data||{})[ch];
  document.getElementById('chWait').hidden=hasMedia;
  document.getElementById('chWaitName').textContent=label;
  document.getElementById('chSelNote').hidden=!S.sel;
  document.querySelectorAll('.ch-name').forEach(e=>e.textContent=label);
  const pw=prevWindow(); let tp=null;
  if(pw){ const P=scopeData(ch,null,pw); tp=totals(P.fS,P.fM,P.fG); }
  const dd=daily(S.fS,S.fM,S.fG);
  renderFunnel('metaFunnel', funnelSteps(t, tp, S.sel), dd);

  convCharts(['mCpmCtr','mCrPvr','mAcrChk','mConv'], dd);
  renderGranDD('mCombo'); comboChart('mCombo', dd);
  const aggAd=buildAgg(S.fS,S.fM,'ad');
  const realAds=Object.entries(aggAd).filter(([n])=>n!=='(sem anúncio)');
  document.getElementById('adBlock').hidden=!realAds.length;
  document.getElementById('adTableBlock').hidden=!realAds.length;
  hbar('mContent', realAds.map(([label,a])=>({label,v:a.fat})), x=>x.v, cvar('--chart-faturamento'), 10, brl);
  renderProdTable('mProd', S.fS);

  const dl=dd.slice().reverse();
  renderTable({id:'tDaily', cols:ch==='meta'?META_DAILY_COLS:DAILY_COLS,
    rows:dl.map(x=>{const dv=derive(x); return {k:x.d, cells:dailyCells(x,dv)};}),
    total:dailyCells(t,d,true),
    selectable:true, selSet:STATE.selDays,
    onSelect:(k,e)=>{ toggleSet(STATE.selDays,k,e&&(e.ctrlKey||e.metaKey)); syncDateInputs(); renderAll(); },
  });

  function hierRows(map,searchKey){ let rows=Object.entries(map).map(([k,a])=>{const dv=derive(a);
      return {k, cells:Object.assign({dim:k}, metricCells(a,dv))};});
    const q=norm(STATE.search[searchKey]);
    if(q) rows=rows.filter(r=>norm(r.cells.dim).includes(q));
    return rows; }
  function totRowOf(tt){const dv=derive(tt);return Object.assign({dim:null}, metricCells(tt,dv));}
  const Sc=scopeData(ch,'C'), Sa=scopeData(ch,'A'), Sd=scopeData(ch,'D');
  const adset=ch==='meta'?'Conjunto':'Grupo de anúncios';
  document.getElementById('adsetTitle').textContent=adset+(ch==='meta'?' (Ad Sets)':'');
  renderTable({id:'tCamp', cols:HCOLS.map((c,i)=>i===0?{...c,label:'Campanha'}:c), rows:hierRows(buildAgg(Sc.fS,Sc.fM,'camp'),'tCamp'), total:totRowOf(totals(Sc.fS,Sc.fM)),
    statusMap:latestStatusByDim(mediaAllDates(ch,'C'),'camp','cs'), selectable:true, selSet:STATE.mSelC, onSelect:(k,e)=>selDim('C',k,e&&(e.ctrlKey||e.metaKey))});
  renderTable({id:'tAdset', cols:HCOLS.map((c,i)=>i===0?{...c,label:adset,big:true}:c), rows:hierRows(buildAgg(Sa.fS,Sa.fM,'adset'),'tAdset'), total:totRowOf(totals(Sa.fS,Sa.fM)),
    statusMap:latestStatusByDim(mediaAllDates(ch,'A'),'adset','as'), selectable:true, selSet:STATE.mSelA, onSelect:(k,e)=>selDim('A',k,e&&(e.ctrlKey||e.metaKey))});
  renderTable({id:'tAd', cols:(ch==='meta'?AD_HCOLS:HCOLS).map((c,i)=>i===0?{...c,label:'Anúncio'}:c), rows:hierRows(buildAgg(Sd.fS,Sd.fM,'ad'),'tAd'), total:totRowOf(totals(Sd.fS,Sd.fM)),
    statusMap:latestStatusByDim(mediaAllDates(ch,'D'),'ad','ds'), selectable:true, selSet:STATE.mSelAd, onSelect:(k,e)=>selDim('D',k,e&&(e.ctrlKey||e.metaKey))});

  cacDimChart('chCamp', Sc.fM, Sc.fS, 'camp', STATE.mSelC);
  cacDimChart('chAdset', Sa.fM, Sa.fS, 'adset', STATE.mSelA);
  cacDimChart('chAd', Sd.fM, Sd.fS, 'ad', STATE.mSelAd);

  /* Palavras-chave (só Google): mídia (coluna keyword) + compras (utm_term); respeita período e campanha, não conjunto/anúncio */
  const kwOn=ch==='google';
  document.getElementById('kwTableBlock').hidden=!kwOn; document.getElementById('kwNote').hidden=!kwOn;
  if(kwOn){
    const kf=r=>r.ch===ch && dateActive(r.d) && (!STATE.mSelC.size||STATE.mSelC.has(r.camp));
    const kM=MEDIA.filter(kf), kS=SALES.filter(kf).filter(r=>r.kw);
    const kAgg=buildAgg(kS,kM,'kw');
    let kRows=Object.entries(kAgg).map(([k,a])=>({k, cells:Object.assign({dim:k}, metricCells(a,derive(a)))}))
      .sort((a,b)=>(b.cells.gasto-a.cells.gasto)||(b.cells.vendas-a.cells.vendas));
    const q=norm(STATE.search.tKw); if(q) kRows=kRows.filter(r=>norm(r.cells.dim).includes(q));
    renderTable({id:'tKw', cols:HCOLS.map((c,i)=>i===0?{...c,label:'Palavra-chave',big:true}:c), rows:kRows, total:totRowOf(totals(kS,kM))});
    cacDimChart('chKw', kM, kS, 'kw', null);
  }

  /* Compradores: últimos pedidos (PII mascarada), respeitando canal + período */
  const rows=BUYERS.filter(b=>b.ch===ch && dateActive(b.d));
  document.getElementById('qCount').textContent=rows.length+' compras';
  renderTable({id:'tQual',
    cols:[{key:'d',label:'Data',type:'date'},{key:'nm',label:'Nome',type:'dim'},{key:'prod',label:'Produto',type:'dim',big:true},
      {key:'val',label:'Valor',type:'brl',w:110},{key:'camp',label:'Campanha',type:'dim',big:true},{key:'ad',label:'Anúncio',type:'dim',big:true},{key:'em',label:'E‑mail',type:'dim',w:200}],
    rows:rows.map((s,i)=>({k:'s'+i, cells:{d:s.d,nm:s.nm,prod:s.prod,val:s.val,camp:s.camp,ad:s.ad,em:s.em}}))});
}

/* ---------------- PAGE: Insights de IA (relatórios) ----------------
   Total = todos os canais.  Tráfego = só canais de mídia paga (Meta + Google + TikTok).
   Código de cor aplicado APENAS a CAC e ROAS (metas em build/config.py; 0 = sem meta). */
const CAC_TARGET=B.cac_target, ROAS_TARGET=B.roas_target;
const REL_BAND_LO=(B.report_band_low!=null?B.report_band_low:0.7);
const REL_BAND_HI=(B.report_band_high!=null?B.report_band_high:1.3);
const AD_LINKS=DATA.ad_links||{};

/* ---- saúde do funil: histórico da conta (todo o período, sem filtro) ---- */
const HIST=derive(totals(SALES,MEDIA,GA));
const HEALTH_GOAL_KEY='dm_health_cac_goal';
STATE.cacGoal=(()=>{ let v=NaN; try{ v=parseFloat(localStorage.getItem(HEALTH_GOAL_KEY)); }catch(e){}
  if(isFinite(v)&&v>0) return v;
  return (CAC_TARGET&&CAC_TARGET>0)?CAC_TARGET:(HIST.cac||null); })();
const HEALTH_ROAS_TARGET=(ROAS_TARGET&&ROAS_TARGET>0)?ROAS_TARGET:(HIST.roas||null);
const HEALTH_TOL=0.85; /* piso = 85% da taxa histórica da conta */
const HEALTH_CTR_MIN=HIST.ctr!=null?HIST.ctr*HEALTH_TOL:null;
const HEALTH_CR_MIN=HIST.cr!=null?HIST.cr*HEALTH_TOL:null;
const HEALTH_VISCHK_MIN=HIST.vischk!=null?HIST.vischk*HEALTH_TOL:null;
const HEALTH_CONVCHK_MIN=HIST.convchk!=null?HIST.convchk*HEALTH_TOL:null;
function healthPerf(actual,target,higherIsBetter){
  if(actual==null||!isFinite(actual)||!target||!isFinite(target)||target<=0) return null;
  return higherIsBetter ? actual/target : target/actual;
}
function healthBar(label,valTxt,perf,note){
  const pct=perf==null?0:Math.max(0,Math.min(100,Math.round(perf*100)));
  const cls=perf==null?'':(perf>=1?'hb-ok':(perf>=0.75?'hb-warn':'hb-bad'));
  return `<div class="health-bar-item"><div class="health-bar-head"><span>${label}${note?` <span class="health-bar-note">${note}</span>`:''}</span><b>${valTxt}</b></div>
    <div class="health-bar-track"><div class="health-bar-fill ${cls}" style="width:${pct}%"></div></div></div>`;
}
function renderHealthCard(d){
  const goal=STATE.cacGoal;
  const minCtr=HEALTH_CTR_MIN, minCr=HEALTH_CR_MIN, minVischk=HEALTH_VISCHK_MIN, minConvchk=HEALTH_CONVCHK_MIN;

  const pRoas=healthPerf(d.roas,HEALTH_ROAS_TARGET,true);
  const pCac=healthPerf(d.cac,goal,false);
  const pCtr=healthPerf(d.ctr,minCtr,true);
  const pCr=healthPerf(d.cr,minCr,true);
  const pVischk=healthPerf(d.vischk,minVischk,true);
  const pConvchk=healthPerf(d.convchk,minConvchk,true);

  /* ROAS tem o maior peso: funil saudável precisa dar lucro, não só bater metas operacionais */
  const comps=[[pRoas,0.35],[pCac,0.25],[pCtr,0.1],[pCr,0.1],[pVischk,0.1],[pConvchk,0.1]].filter(c=>c[0]!=null);
  const wSum=comps.reduce((s,c)=>s+c[1],0);
  const score=wSum? Math.max(0,Math.min(100,Math.round(comps.reduce((s,c)=>s+Math.min(c[0],1.3)*c[1],0)/wSum*100))) : null;

  const band = score==null?{cls:'',lbl:'Sem dados'}:
    score>=100?{cls:'rc-cyan',lbl:'Excelente'}:
    score>=70?{cls:'rc-green',lbl:'Bom'}:
    score>=40?{cls:'rc-yellow',lbl:'Regular'}:
    {cls:'rc-red',lbl:'Crítico'};
  const ringColor = band.cls==='rc-cyan'?'var(--aqua)':band.cls==='rc-green'?'var(--good)':band.cls==='rc-yellow'?'var(--yellow)':band.cls==='rc-red'?'var(--red)':'var(--border)';

  document.getElementById('healthScore').textContent = score==null?'--':score;
  document.getElementById('healthRing').style.background = `conic-gradient(${ringColor} ${(score||0)*3.6}deg, var(--border) 0deg)`;
  const badgeEl=document.getElementById('healthBadge');
  badgeEl.textContent = score==null?'--':`${band.lbl} · ${score}/100`;
  badgeEl.className = 'health-badge '+band.cls;
  document.getElementById('healthDesc').textContent = goal ? 'ROAS (lucratividade) tem o maior peso na nota' : 'defina a meta de CAC abaixo p/ calcular a nota';

  const goalInput=document.getElementById('healthGoalInput');
  if(document.activeElement!==goalInput) goalInput.value = goal!=null? goal.toFixed(2) : '';

  document.getElementById('healthBars').innerHTML = [
    healthBar('ROAS · meta '+(HEALTH_ROAS_TARGET?roasf(HEALTH_ROAS_TARGET):'—'), roasf(d.roas), pRoas),
    healthBar('CAC · meta '+(goal!=null?brl(goal):'—'), brl(d.cac), pCac),
    healthBar('CTR · mín '+(minCtr!=null?pct(minCtr):'—'), pct(d.ctr), pCtr),
    healthBar('CR · mín '+(minCr!=null?pct(minCr):'—'), pct(d.cr), pCr),
    healthBar('VisCHK · mín '+(minVischk!=null?pct(minVischk):'—'), pct(d.vischk), pVischk),
    healthBar('ConvCHK · mín '+(minConvchk!=null?pct(minConvchk):'—'), pct(d.convchk), pConvchk),
  ].join('');
}
if(!window.__healthGoalWired){
  window.__healthGoalWired=true;
  document.addEventListener('input',e=>{
    if(e.target&&e.target.id==='healthGoalInput'){
      const v=parseFloat(e.target.value);
      STATE.cacGoal=(isFinite(v)&&v>0)?v:null;
      try{ if(STATE.cacGoal!=null) localStorage.setItem(HEALTH_GOAL_KEY,String(STATE.cacGoal));
           else localStorage.removeItem(HEALTH_GOAL_KEY); }catch(err){}
      if(STATE.page==='rel'){ const S=scopeData(null); renderHealthCard(derive(totals(S.fS,S.fM,S.fG))); }
    }
  });
}
/* desempenho vs meta: CAC menor=melhor (meta/valor); ROAS maior=melhor (valor/meta) */
function relPerf(v,kind){
  if(v==null||!isFinite(v)) return null;
  if(kind==='roas'){ return ROAS_TARGET?v/ROAS_TARGET:null; }
  return (CAC_TARGET&&v>0)?CAC_TARGET/v:null;
}
function relColor(v,kind){ const p=relPerf(v,kind); if(p==null) return '';
  if(p<REL_BAND_LO) return 'rc-red'; if(p<1) return 'rc-yellow';
  if(p<REL_BAND_HI) return 'rc-green'; return 'rc-cyan'; }
function relCard(label,val,hero){ return `<div class="rel-card${hero?' hero':''}"><div class="rl">${label}</div><div class="rv">${val}</div></div>`; }
function relCards(id,t){ const d=derive(t);
  document.getElementById(id).innerHTML=[
    relCard('Valor Gasto',brl(d.gasto)),
    relCard('Compras',intf(t.vendas)),
    relCard('Faturamento',brl(t.fat)),
    relCard('CAC',`<span class="${relColor(d.cac,'cac')}">${brl(d.cac)}</span>`),
    relCard('Ticket Médio',brl(d.ticket)),
    relCard('ROAS',`<span class="${relColor(d.roas,'roas')}">${roasf(d.roas)}</span>`,true),
  ].join('');
}
/* tabela estática simples (cols/rows/foot = [{v,cls}]) — mantém a estética .dt */
function relRenderTable(id,cols,rows,foot){
  const el=document.getElementById(id); if(!el) return;
  const th='<thead><tr>'+cols.map(c=>`<th class="${c.cls||''}">${c.label}</th>`).join('')+'</tr></thead>';
  const tb='<tbody>'+(rows.length?rows.map(r=>'<tr>'+r.map(c=>`<td class="${c.cls||''}">${c.v}</td>`).join('')+'</tr>').join('')
    :`<tr><td class="dim" colspan="${cols.length}" style="color:var(--muted)">Sem dados no período.</td></tr>`)+'</tbody>';
  const tf=foot?('<tfoot><tr>'+foot.map(c=>`<td class="${c.cls||''}">${c.v}</td>`).join('')+'</tr></tfoot>'):'';
  el.innerHTML=th+tb+tf;
}
function adLink(name){ const u=AD_LINKS[name];
  return u?`<a class="rel-adlink" href="${esc(u)}" target="_blank" rel="noopener">Abrir ▸</a>`:'<span class="rel-adlink off">—</span>'; }
function relBriefKey(){ if(STATE.selDays.size) return null; return STATE.preset||null; }
function renderRelBrief(){
  const wrap=document.getElementById('relBrief'), stampEl=document.getElementById('relBriefStamp');
  const bf=DATA.briefings||{}, per=bf.periodos||{}, key=relBriefKey();
  stampEl.textContent = bf.generated_at ? `Briefing gerado por IA · última atualização ${bf.generated_at} · atualiza 1×/dia às 23h59` : '';
  if(!Object.keys(per).length){
    wrap.innerHTML='<div class="rel-brief-empty">O briefing por IA ainda não foi gerado. Ele é atualizado automaticamente 1×/dia às 23h59.</div>'; return; }
  if(!key || !per[key]){
    wrap.innerHTML='<div class="rel-brief-empty">Briefing disponível para os períodos predefinidos (Hoje, Ontem, 3&nbsp;dias, 7&nbsp;dias, 14&nbsp;dias, 30&nbsp;dias, Este mês, Mês passado, Todo período). Selecione um desses botões no topo.</div>'; return; }
  const item=per[key];
  wrap.innerHTML = item.html || item.texto || '<div class="rel-brief-empty">Sem conteúdo.</div>';
}
function renderRelatorios(){
  const S=scopeData(null);
  const isPaid=r=>PAID.includes(r.ch);
  const fSads=S.fS.filter(isPaid), fGads=S.fG.filter(isPaid);
  const tTot=totals(S.fS,S.fM,S.fG), tAds=totals(fSads,S.fM,fGads);
  const dvT=derive(tTot), dvA=derive(tAds);

  /* cabeçalho do período */
  const pr=PRESETS.find(p=>p[0]===STATE.preset);
  document.getElementById('relPeriodName').textContent = STATE.selDays.size?'Dias selecionados':(pr?pr[1]:'Personalizado');
  let rangeTxt='';
  if(STATE.from&&STATE.to){ const nD=Math.round((new Date(STATE.to+'T00:00:00')-new Date(STATE.from+'T00:00:00'))/86400000)+1;
    rangeTxt=`${brdate(STATE.from)} a ${brdate(STATE.to)}`+(nD>0?` · ${nD} dia${nD>1?'s':''}`:''); }
  document.getElementById('relPeriodRange').textContent=rangeTxt;

  relCards('relCardsTotal',tTot);
  relCards('relCardsAds',tAds);
  renderHealthCard(dvT);
  renderGranDD('relCombo'); comboChart('relCombo', daily(S.fS,S.fM,S.fG));

  /* visão por campanha (canais de mídia paga) */
  const keyCamp=r=>r.ch+'\u0001'+r.camp, byC={};
  const gC=k=>byC[k]||(byC[k]=newBucket());
  S.fM.forEach(r=>addMedia(gC(keyCamp(r)),r));
  fSads.forEach(r=>addSales(gC(keyCamp(r)),r));
  const crows=Object.entries(byC).sort((a,b)=>b[1].sp-a[1].sp).map(([k,ag])=>{ const d=derive(ag), [ch,name]=k.split('\u0001');
    return [{v:esc(CH_LABEL[ch]),cls:'dim'},{v:esc(name),cls:'dim'},{v:brl(d.gasto)},{v:intf(ag.vendas)},
      {v:roasf(d.roas),cls:relColor(d.roas,'roas')},{v:brl(d.cac),cls:relColor(d.cac,'cac')},
      {v:brl(d.cpm)},{v:pct(d.ctr)}]; });
  relRenderTable('relCamp',
    [{label:'Canal',cls:'dim'},{label:'Campanha',cls:'dim'},{label:'Gasto'},{label:'Compras'},{label:'ROAS'},{label:'CAC'},{label:'CPM'},{label:'CTR'}],
    crows,
    [{v:'Total',cls:'dim'},{v:'',cls:'dim'},{v:brl(dvA.gasto)},{v:intf(tAds.vendas)},{v:roasf(dvA.roas),cls:relColor(dvA.roas,'roas')},{v:brl(dvA.cac),cls:relColor(dvA.cac,'cac')},
     {v:brl(dvA.cpm)},{v:pct(dvA.ctr)}]);

  /* top / piores anúncios (mídia paga, com nome de anúncio e gasto no período) */
  const keyAd=r=>r.ch+'\u0001'+r.camp+'\u0001'+r.ad, byA={};
  const gA=k=>byA[k]||(byA[k]=newBucket());
  S.fM.forEach(r=>{ if(r.ad!=='(sem anúncio)') addMedia(gA(keyAd(r)),r); });
  fSads.forEach(r=>{ if(r.ad!=='(sem anúncio)') addSales(gA(keyAd(r)),r); });
  const ads=Object.entries(byA).filter(([k,ag])=>ag.sp>0).map(([k,ag])=>{ const d=derive(ag);
    return {name:k.split('\u0001')[2],gasto:d.gasto,vendas:ag.vendas,cac:d.cac,roas:d.roas}; });
  ads.sort((a,b)=>{ const ra=a.roas==null?-1:a.roas, rb=b.roas==null?-1:b.roas; if(rb!==ra) return rb-ra;
    const ca=a.cac==null?Infinity:a.cac, cb=b.cac==null?Infinity:b.cac; return ca-cb; });
  const TOP_MIN_VENDAS=3;
  const top=ads.filter(a=>a.vendas>=TOP_MIN_VENDAS).slice(0,5), topSet=new Set(top);
  const worst=ads.filter(a=>!topSet.has(a)).slice(-5).reverse();
  const adCols=[{label:'Anúncio',cls:'dim'},{label:'Gasto'},{label:'Compras'},{label:'CAC'},{label:'ROAS'},{label:'Link',cls:'dim'}];
  const adRows=list=>list.map(a=>[{v:esc(a.name),cls:'dim'},{v:brl(a.gasto)},{v:intf(a.vendas)},
    {v:brl(a.cac),cls:relColor(a.cac,'cac')},{v:roasf(a.roas),cls:relColor(a.roas,'roas')},{v:adLink(a.name),cls:'dim'}]);
  relRenderTable('relTop',adCols,adRows(top));
  relRenderTable('relWorst',adCols,adRows(worst));

  renderRelBrief();
}

const esc=s=>String(s==null?'':s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));

/* ---------------- date presets ---------------- */
const PRESETS=[
  ['hoje','Hoje',()=>[TODAY,TODAY]],
  ['ontem','Ontem',()=>[addDays(TODAY,-1),addDays(TODAY,-1)]],
  ['3d','3 dias',()=>[addDays(TODAY,-2),TODAY]],
  ['7d','7 dias',()=>[addDays(TODAY,-6),TODAY]],
  ['14d','14 dias',()=>[addDays(TODAY,-13),TODAY]],
  ['30d','30 dias',()=>[addDays(TODAY,-29),TODAY]],
  ['mes','Este mês',()=>{const [y,m]=TODAY.split('-');return [`${y}-${m}-01`,TODAY];}],
  ['mespass','Mês passado',()=>{const dt=new Date(TODAY+'T00:00:00');const f=new Date(dt.getFullYear(),dt.getMonth()-1,1);const l=new Date(dt.getFullYear(),dt.getMonth(),0);return [dstr(f),dstr(l)];}],
  ['todo','Máximo',()=>[B.date_min,B.date_max]],
];
/* rótulo do botão de período — mostra o intervalo aplicado dentro do próprio botão */
function syncDateInputs(){
  const el=document.getElementById('periodBtnLabel'); if(!el) return;
  if(STATE.selDays.size){ el.textContent=STATE.selDays.size+(STATE.selDays.size>1?' dias selecionados':' dia selecionado'); return; }
  const pr=PRESETS.find(p=>p[0]===STATE.preset);
  if(STATE.from&&STATE.to) el.textContent=brdate(STATE.from)+' – '+brdate(STATE.to)+(pr?' · '+pr[1]:'');
  else el.textContent='Selecionar período';
}
function applyPreset(id){ const p=PRESETS.find(x=>x[0]===id); if(!p)return; const [f,t]=p[2]();
  STATE.from=f; STATE.to=t; STATE.preset=id; STATE.selDays.clear(); ppClose(); syncDateInputs(); renderAll(); }

/* ---- popover do seletor de período (estilo Data Studio) ---- */
const MONTHS_PT=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DOW_PT=['D','S','T','Q','Q','S','S'];
const PP={from:null,to:null,preset:'',fromView:'',toView:''};
function ymView(ds){ return (ds||TODAY).slice(0,7); }
function shiftView(view,delta){ const [y,m]=view.split('-').map(Number); const dt=new Date(y,m-1+delta,1); return dt.getFullYear()+'-'+pad(dt.getMonth()+1); }
function ppIsOpen(){ const pop=document.getElementById('periodPop'); return pop && !pop.hidden; }
function ppOpen(){
  PP.from=STATE.from; PP.to=STATE.to; PP.preset=STATE.selDays.size?'':STATE.preset;
  PP.fromView=ymView(STATE.from); PP.toView=ymView(STATE.to);
  document.getElementById('periodPop').hidden=false;
  document.getElementById('periodBtn').setAttribute('aria-expanded','true');
  ppRenderAll();
}
function ppClose(){ const pop=document.getElementById('periodPop'); if(pop) pop.hidden=true;
  const b=document.getElementById('periodBtn'); if(b) b.setAttribute('aria-expanded','false'); }
function ppRenderAll(){ ppRenderPresets(); ppRenderCal('from'); ppRenderCal('to'); ppRenderRange(); }
function ppRenderPresets(){
  const host=document.getElementById('ppPresets');
  host.innerHTML=PRESETS.map(p=>`<button class="pp-preset ${PP.preset===p[0]?'active':''}" data-p="${p[0]}">${p[1]}</button>`).join('');
  host.querySelectorAll('.pp-preset').forEach(c=>c.addEventListener('click',()=>{
    const p=PRESETS.find(x=>x[0]===c.dataset.p); const [f,t]=p[2]();
    PP.from=f; PP.to=t; PP.preset=p[0]; PP.fromView=ymView(f); PP.toView=ymView(t); ppRenderAll();
  }));
}
function ppRenderCal(side){
  const host=document.getElementById(side==='from'?'ppCalFrom':'ppCalTo');
  const view=side==='from'?PP.fromView:PP.toView;
  const [y,m]=view.split('-').map(Number);
  const startDow=new Date(y,m-1,1).getDay(), dim=new Date(y,m,0).getDate();
  let cells='';
  for(let i=0;i<startDow;i++) cells+='<span class="pp-day empty"></span>';
  for(let d=1;d<=dim;d++){
    const ds=view+'-'+pad(d);
    const inR=PP.from&&PP.to&&ds>=PP.from&&ds<=PP.to, isEdge=(ds===PP.from||ds===PP.to);
    const cls=['pp-day']; if(inR) cls.push('in'); if(ds===PP.from) cls.push('edge-l'); if(ds===PP.to) cls.push('edge-r'); if(isEdge) cls.push('sel');
    cells+=`<button class="${cls.join(' ')}" data-side="${side}" data-d="${ds}">${d}</button>`;
  }
  host.innerHTML=`<div class="pp-cal-head"><span class="pp-cal-title">${side==='from'?'Data de início':'Data de término'}</span></div>
    <div class="pp-cal-nav"><button class="pp-nav" data-nav="-1">‹</button><span class="pp-cal-month">${MONTHS_PT[m-1]} ${y}</span><button class="pp-nav" data-nav="1">›</button></div>
    <div class="pp-dow">${DOW_PT.map(x=>`<span>${x}</span>`).join('')}</div>
    <div class="pp-grid">${cells}</div>`;
  host.querySelectorAll('.pp-nav').forEach(b=>b.addEventListener('click',()=>{
    const nv=shiftView(view,+b.dataset.nav); if(side==='from') PP.fromView=nv; else PP.toView=nv; ppRenderCal(side);
  }));
  host.querySelectorAll('.pp-day[data-d]').forEach(b=>b.addEventListener('click',()=>ppPickDay(side,b.dataset.d)));
}
function ppPickDay(side,ds){
  PP.preset='';
  if(side==='from'){ PP.from=ds; if(PP.to&&PP.from>PP.to) PP.to=PP.from; }
  else { PP.to=ds; if(PP.from&&PP.to<PP.from) PP.from=PP.to; }
  ppRenderAll();
}
function ppRenderRange(){
  const el=document.getElementById('ppRange');
  if(PP.from&&PP.to){ const n=Math.round((new Date(PP.to+'T00:00:00')-new Date(PP.from+'T00:00:00'))/86400000)+1;
    el.textContent=brdate(PP.from)+' – '+brdate(PP.to)+(n>0?' · '+n+(n>1?' dias':' dia'):''); }
  else el.textContent='Selecione as datas';
}
function ppApply(){
  if(!PP.from||!PP.to){ ppClose(); return; }
  STATE.from=PP.from; STATE.to=PP.to; STATE.preset=PP.preset||''; STATE.selDays.clear();
  ppClose(); syncDateInputs(); renderAll();
}

/* ---- popover de metas de investimento e divisão de verba por fonte de tráfego ----
   Salvo no navegador (localStorage 'dm_budget'): {goal: R$/mês, pct: {canal: %}}. Só planejamento —
   não altera os dados; o "realizado" compara com o gasto do mês corrente das abas de mídia. */
const BUDGET_KEY='dm_budget';
const BUDGET_CH=[['google','Google Ads'],['meta','Meta Ads'],['tiktok','TikTok Ads'],['shopee','Shopee'],['amazon','Amazon'],['mercadolivre','Mercado Livre']];
const BP={goal:0,pct:{}};
function bpLoad(){ try{ const o=JSON.parse(localStorage.getItem(BUDGET_KEY)||'null'); return o&&typeof o==='object'?{goal:+o.goal||0,pct:o.pct||{}}:{goal:0,pct:{}}; }catch(e){ return {goal:0,pct:{}}; } }
const BUDGET=bpLoad();
function bpNum(s){ s=String(s==null?'':s).trim().replace(/[^\d.,]/g,''); if(!s) return 0;
  if(s.includes(',')) s=s.replace(/\./g,'').replace(',','.'); else if(/^\d{1,3}(\.\d{3})+$/.test(s)) s=s.replace(/\./g,'');
  const v=parseFloat(s); return isFinite(v)&&v>0?v:0; }
function bpSpent(ch){ if(!PAID.includes(ch)) return null; const ym=TODAY.slice(0,7);
  return MEDIA.reduce((s,r)=>s+((r.ch===ch&&r.d&&r.d.slice(0,7)===ym)?spx(r):0),0); }
function bpIsOpen(){ const pop=document.getElementById('budgetPop'); return pop && !pop.hidden; }
function bpOpen(){
  ppClose(); BP.goal=BUDGET.goal; BP.pct=Object.assign({},BUDGET.pct);
  document.getElementById('bpGoal').value=BP.goal?nf2.format(BP.goal):'';
  document.getElementById('budgetPop').hidden=false;
  document.getElementById('budgetBtn').setAttribute('aria-expanded','true');
  bpRenderRows(); bpUpdate();
}
function bpClose(){ const pop=document.getElementById('budgetPop'); if(pop) pop.hidden=true;
  const b=document.getElementById('budgetBtn'); if(b) b.setAttribute('aria-expanded','false'); }
function bpRenderRows(){
  document.getElementById('bpRows').innerHTML=BUDGET_CH.map(([k,l])=>{
    const sp=bpSpent(k);
    return `<div class="bp-row" data-k="${k}">
      <div class="bp-name"><span>${l}</span><span class="bp-bar" ${sp==null?'hidden':''}><i></i></span><span class="bp-sub"></span></div>
      <label class="bp-pct"><input type="text" inputmode="decimal" placeholder="0" value="${BP.pct[k]?String(BP.pct[k]).replace('.',','):''}" autocomplete="off"><span>%</span></label>
      <div class="bp-val">-</div></div>`; }).join('');
  document.querySelectorAll('#bpRows .bp-pct input').forEach(i=>i.addEventListener('input',()=>{
    BP.pct[i.closest('.bp-row').dataset.k]=bpNum(i.value); bpUpdate(); }));
}
function bpUpdate(){
  const goal=BP.goal; let tot=0;
  document.querySelectorAll('#bpRows .bp-row').forEach(row=>{
    const k=row.dataset.k, p=BP.pct[k]||0, alloc=goal*p/100, sp=bpSpent(k); tot+=p;
    row.querySelector('.bp-val').textContent=goal&&p?brl(alloc):'-';
    const sub=row.querySelector('.bp-sub'), bar=row.querySelector('.bp-bar i');
    if(sp==null){ sub.textContent='Sem gasto automático (informe manualmente)'; return; }
    sub.textContent='Realizado no mês: '+brl(sp)+(alloc?' · '+pct(sp/alloc)+' da verba':'');
    bar.style.width=alloc?Math.min(100,sp/alloc*100)+'%':'0%'; bar.classList.toggle('over',!!alloc&&sp>alloc);
  });
  tot=Math.round(tot*100)/100;
  const el=document.getElementById('bpTotal'), ok=tot===100, empty=tot===0;
  el.innerHTML=empty?'Defina a divisão (soma = 100%)':`Total: <span class="${ok?'bp-total-ok':'bp-total-bad'}">${nf2.format(tot)}%</span>`+(ok?'':(tot<100?' · faltam '+nf2.format(100-tot)+'%':' · excede '+nf2.format(tot-100)+'%'));
  document.getElementById('bpApply').disabled=!(ok||empty);
}
function bpSyncLabel(){
  const el=document.getElementById('budgetBtnLabel'); if(!el) return;
  el.textContent=BUDGET.goal?'Meta '+brl(BUDGET.goal)+'/mês':'Metas e verba';
}
function bpApply(){
  BUDGET.goal=BP.goal; BUDGET.pct={}; BUDGET_CH.forEach(([k])=>{ if(BP.pct[k]>0) BUDGET.pct[k]=BP.pct[k]; });
  try{ localStorage.setItem(BUDGET_KEY,JSON.stringify(BUDGET)); }catch(e){}
  bpClose(); bpSyncLabel();
}

/* ---------------- navigation & boot ---------------- */
const CH_PAGES=['meta','google','tiktok'];
function setPage(p){
  if(CH_PAGES.includes(p) && STATE.page!==p){ STATE.mSelC.clear(); STATE.mSelA.clear(); STATE.mSelAd.clear(); STATE.search={tCamp:'',tAdset:'',tAd:'',tKw:''};
    ['searchCamp','searchAdset','searchAd','searchKw'].forEach(i=>{ const e=document.getElementById(i); if(e) e.value=''; }); }
  STATE.page=p;
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.page===p));
  document.getElementById('page-geral').classList.toggle('active',p==='geral');
  document.getElementById('page-ch').classList.toggle('active',CH_PAGES.includes(p));
  document.getElementById('page-rel').classList.toggle('active',p==='rel');
  document.getElementById('ptitle').textContent = CH_PAGES.includes(p)?CH_LABEL[p]:(p==='rel'?'Insights de IA':'Visão Geral');
  document.getElementById('navToggle').checked=false;
  history.replaceState(null,'', '#'+p);
  renderAll();
}
function renderAll(){ if(CH_PAGES.includes(STATE.page)) renderChannel(); else if(STATE.page==='rel') renderRelatorios(); else renderGeral(); }

/* Tema ESCURO é o padrão; só fica claro se o usuário tiver escolhido 'light'. */
function applyTheme(){ let t=null; try{ t=localStorage.getItem('dm_theme'); }catch(e){} if(t==='light') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme','dark'); }
applyTheme();
document.getElementById('themeBtn').addEventListener('click',()=>{ const dark=document.documentElement.getAttribute('data-theme')==='dark'; try{ localStorage.setItem('dm_theme',dark?'light':'dark'); }catch(e){} applyTheme(); renderAll(); });

document.querySelectorAll('.nav-item').forEach(n=>n.addEventListener('click',()=>setPage(n.dataset.page)));
document.getElementById('taxToggle').addEventListener('click',function(){ STATE.tax=!STATE.tax; this.classList.toggle('on',STATE.tax); renderAll(); });
if(TAX===1) document.getElementById('taxToggle').style.display='none';   /* sem imposto configurado: esconde o toggle */
/* seletor de período: abre/fecha popover, aplicar/cancelar, fechar ao clicar fora/Esc */
document.getElementById('periodBtn').addEventListener('click',e=>{ e.stopPropagation(); bpClose(); ppIsOpen()?ppClose():ppOpen(); });
/* metas e verba: mesmo comportamento de abrir/fechar */
document.getElementById('budgetBtn').addEventListener('click',e=>{ e.stopPropagation(); bpIsOpen()?bpClose():bpOpen(); });
document.getElementById('budgetPop').addEventListener('click',e=>e.stopPropagation());
document.getElementById('bpGoal').addEventListener('input',function(){ BP.goal=bpNum(this.value); bpUpdate(); });
document.getElementById('bpGoal').addEventListener('blur',function(){ this.value=BP.goal?nf2.format(BP.goal):''; });
document.getElementById('bpApply').addEventListener('click',bpApply);
document.getElementById('bpCancel').addEventListener('click',bpClose);
document.getElementById('bpClear').addEventListener('click',()=>{ BP.goal=0; BP.pct={}; document.getElementById('bpGoal').value=''; bpRenderRows(); bpUpdate(); });
document.getElementById('ppApply').addEventListener('click',ppApply);
document.getElementById('ppCancel').addEventListener('click',ppClose);
document.getElementById('periodPop').addEventListener('click',e=>e.stopPropagation());
document.addEventListener('click',()=>{ if(ppIsOpen()) ppClose(); if(bpIsOpen()) bpClose(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape'){ if(ppIsOpen()) ppClose(); if(bpIsOpen()) bpClose(); } });
document.getElementById('clearBtn').addEventListener('click',()=>{ STATE.mSelC.clear();STATE.mSelA.clear();STATE.mSelAd.clear();STATE.selDays.clear(); STATE.gTraf='todos'; STATE.gSrc='todos'; applyPreset('mes'); });
/* botões ✕ Filtro de cada tabela (Campanhas/Conjuntos/Anúncios): limpam só a própria dimensão */
document.getElementById('clearCampBtn').addEventListener('click',()=>{ STATE.mSelC.clear(); renderChannel(); });
document.getElementById('clearAdsetBtn').addEventListener('click',()=>{ STATE.mSelA.clear(); renderChannel(); });
document.getElementById('clearAdBtn').addEventListener('click',()=>{ STATE.mSelAd.clear(); renderChannel(); });
/* busca por nome (campanha/conjunto/anúncio) — case/acento-insensitive */
[['searchCamp','tCamp'],['searchAdset','tAdset'],['searchAd','tAd'],['searchKw','tKw']].forEach(([inputId,key])=>{
  document.getElementById(inputId).addEventListener('input',function(){ STATE.search[key]=this.value; renderChannel(); });
});
document.getElementById('refreshBtn').addEventListener('click',function(){ this.classList.add('loading'); location.href=location.pathname+'?t='+Date.now()+location.hash; });

document.title=(B.client_sub?B.client_sub+' · ':'')+(B.client_name||'Dashboard');
{ const nm=(B.client_name||'—').trim(), k=nm.indexOf(' '); document.getElementById('logoMain').textContent=k>0?nm.slice(0,k):nm; document.getElementById('logoName').textContent=k>0?nm.slice(k+1):''; }
document.getElementById('logoSub').textContent=B.client_sub||'';
document.getElementById('taxLabel').textContent=B.tax_label||'Imposto';
document.getElementById('updated').innerHTML='Última atualização:<br>'+B.generated_at_brt+' (BRT)';
document.getElementById('buildFoot').textContent='build __BUILD_ID__';
document.getElementById('buildFoot2').textContent='· build __BUILD_ID__';

syncDateInputs();
bpSyncLabel();
document.getElementById('taxToggle').classList.toggle('on', STATE.tax);
setPage((()=>{ const h=location.hash.replace('#',''); return (h==='rel'||CH_PAGES.includes(h))?h:'geral'; })());

/* auto-refresh com cache-bust ~30 min */
setTimeout(()=>{ location.href=location.pathname+'?t='+Date.now()+location.hash; }, 30*60*1000);
