/* ===================================================================== */

const sb = (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {auth:{persistSession:true,autoRefreshToken:true}})
  : null;

let SESSION=null, HH=null, HOUSE=null, CH=null;
const cloud=()=>!!(sb&&SESSION);

/* ---------------- state ---------------- */
const uid=()=>Math.random().toString(36).slice(2,9);
const today=()=>new Date().toLocaleDateString('sv-SE');   // YYYY-MM-DD, local time
function defaultState(){
  return {
    tab:'plan', date:today(),
    daily:{kcal:1712, split:{p:46,c:22,f:32}, mode:'pct'},   // split = % of calories
    mealUnit:'g',                                           // per-meal entry: 'g' or 'pct'
    template:[
      {id:'m1',name:'Breakfast',t:{p:55,c:15,f:20}},
      {id:'m2',name:'Lunch',    t:{p:50,c:55,f:20}},
      {id:'m3',name:'Dinner',   t:{p:37,c:20,f:20}},
      {id:'m4',name:'Snack',    t:{p:0,c:0,f:0}},
      {id:'m5',name:'Supplement',t:{p:55,c:6,f:0}}
    ],
    days:{[today()]:{
      m1:[{fid:'egg',q:4},{fid:'whey-on',q:1},{fid:'strawberry',q:100}],
      m2:[{fid:'beef',q:200},{fid:'olive-oil',q:5},{fid:'rice',q:100}],
      m3:[{fid:'cottage-cheese-milla-3',q:60},{fid:'chicken-breast',q:150},{fid:'potato',q:200}],
      m5:[{fid:'whey-on',q:1}]
    }},
    foods:SEED_FOODS.map(f=>({...f})),
    saved:[], q:[]
  };
}
let S=defaultState(), ALT={}, foodFilter='', focusSearch=false, status='local';

const items=mid=>{ const d=S.days[S.date]||(S.days[S.date]={}); return d[mid]||(d[mid]=[]); };
const F=id=>S.foods.find(x=>x.id===id);
const perUnit=f=> f.b==='100g' ? {p:f.p/100,c:f.c/100,f:f.f/100,k:f.k/100} : {p:f.p,c:f.c,f:f.f,k:f.k};
function itemMacros(it){ const f=F(it.fid); if(!f) return {p:0,c:0,f:0,k:0}; const u=perUnit(f), q=+it.q||0;
  return {p:u.p*q,c:u.c*q,f:u.f*q,k:u.k*q}; }
function mealTotals(mid){ const t={p:0,c:0,f:0,k:0}; items(mid).forEach(it=>{const x=itemMacros(it);t.p+=x.p;t.c+=x.c;t.f+=x.f;t.k+=x.k;}); return t; }
const targetKcal=t=>t.p*4+t.c*4+t.f*9;
function dayTotals(){ const a={p:0,c:0,f:0,k:0},b={p:0,c:0,f:0,k:0};
  S.template.forEach(m=>{const t=mealTotals(m.id); a.p+=t.p;a.c+=t.c;a.f+=t.f;a.k+=t.k;
    b.p+=m.t.p;b.c+=m.t.c;b.f+=m.t.f;b.k+=targetKcal(m.t);}); return {act:a,tgt:b}; }
// daily target derived from calories + macro split
function dailyGrams(){ const d=S.daily, k=+d.kcal||0;
  return {p:k*(d.split.p/100)/4, c:k*(d.split.c/100)/4, f:k*(d.split.f/100)/9, k}; }
function allocated(){ const a={p:0,c:0,f:0,k:0};
  S.template.forEach(m=>{a.p+=m.t.p;a.c+=m.t.c;a.f+=m.t.f;a.k+=targetKcal(m.t);}); return a; }
// Calories are the budget. Move one macro and the other two give way,
// keeping their ratio to each other, so the split always adds up to 100%.
function setSplitBalanced(key,pct){
  const s=S.daily.split, keys=['p','c','f'], others=keys.filter(k=>k!==key);
  const v=Math.min(100,Math.max(0,+pct||0)), rest=100-v;
  const restNow=others.reduce((t,k)=>t+s[k],0);
  const next={p:s.p,c:s.c,f:s.f}; next[key]=v;
  if(restNow>0) others.forEach(k=>next[k]=s[k]/restNow*rest);
  else others.forEach(k=>next[k]=rest/2);
  keys.forEach(k=>next[k]=r1(Math.max(0,next[k])));
  const drift=r1(100-(next.p+next.c+next.f));          // absorb rounding error
  if(drift!==0){ const big=next[others[0]]>=next[others[1]]?others[0]:others[1];
    next[big]=r1(Math.max(0,next[big]+drift)); }
  S.daily.split=next;
}
// grams entered -> same operation, expressed in calories
function setDailyGram(key,v){
  const k=+S.daily.kcal||0; if(k<=0) return;
  setSplitBalanced(key, Math.max(0,+v||0)*(key==='f'?9:4)/k*100);
}

function normalizeSplit(){ const t=S.daily.split.p+S.daily.split.c+S.daily.split.f; if(t<=0) return;
  const s=S.daily.split; S.daily.split={p:r1(s.p/t*100), c:r1(s.c/t*100), f:r1(s.f/t*100)}; }
function scaleMealsToDaily(){            // keep each meal's shape, hit the daily total
  const d=dailyGrams(), a=allocated(), n=S.template.length||1;
  ['p','c','f'].forEach(k=>{
    if(a[k]>0){ const r=d[k]/a[k]; S.template.forEach(m=>m.t[k]=r1(m.t[k]*r)); }
    else S.template.forEach(m=>m.t[k]=r1(d[k]/n));
  });
}

const r1=n=>Math.round(n*10)/10, r0=n=>Math.round(n);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------------- local cache ---------------- */
const cacheKey=()=>'minumeal:v3:'+(SESSION?SESSION.user.id:'local');
const hasLS=(()=>{ try{ localStorage.setItem('__mm','1'); localStorage.removeItem('__mm'); return true; }catch(e){ return false; } })();
let saveTimer=null;
function save(){ clearTimeout(saveTimer); saveTimer=setTimeout(()=>{
  if(hasLS){ try{ localStorage.setItem(cacheKey(),JSON.stringify(S)); }catch(e){} }
},300); }
function loadCache(){ if(!hasLS) return null; try{ const v=localStorage.getItem(cacheKey()); return v?JSON.parse(v):null; }catch(e){ return null; } }

/* ---------------- ui helpers ---------------- */
const $=s=>document.querySelector(s);
function toast(t){ const el=$('#toast'); el.textContent=t; el.classList.add('show'); clearTimeout(el._t); el._t=setTimeout(()=>el.classList.remove('show'),2400); }
let closeModal=null;
function modal(title,bodyHTML,buttons){
  return new Promise(res=>{
    $('#mTitle').textContent=title; $('#mBody').innerHTML=bodyHTML;
    $('#mBtns').innerHTML=buttons.map((b,i)=>`<button class="btn ${b.solid?'solid':b.ghost?'ghost':''}" data-i="${i}">${esc(b.label)}</button>`).join('');
    $('#veil').classList.add('show');
    const done=v=>{ $('#veil').classList.remove('show'); closeModal=null; res(v); };
    closeModal=done;
    $('#mBtns').onclick=e=>{ const b=e.target.closest('button'); if(!b) return; const spec=buttons[+b.dataset.i];
      done(spec.value!==undefined?spec.value:(spec.read?$('#mBody').querySelector(spec.read).value:true)); };
    const first=$('#mBody').querySelector('input,textarea'); if(first){ first.focus(); first.select&&first.select(); }
  });
}
const ask=(t,d='')=>modal(t,`<input type="text" id="mInput" value="${esc(d)}">`,
  [{label:'Cancel',ghost:true,value:null},{label:'OK',solid:true,read:'#mInput'}]);
const confirmBox=(t,m,ok='Yes')=>modal(t,`<p class="hint" style="margin:0">${esc(m)}</p>`,
  [{label:'Cancel',ghost:true,value:false},{label:ok,solid:true,value:true}]);
$('#veil').addEventListener('click',e=>{ if(e.target.id==='veil'&&closeModal) closeModal(null); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&closeModal) closeModal(null); });
function copyText(t){
  const ok=()=>toast('Copied to clipboard');
  if(navigator.clipboard?.writeText) return navigator.clipboard.writeText(t).then(ok,fb);
  return fb();
  function fb(){ try{ const ta=document.createElement('textarea'); ta.value=t; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); ok(); }catch(e){ toast('Copy failed — select the text manually.'); } }
}
function setStatus(s){ status=s; paintAccountBtn(); }
function paintAccountBtn(){
  const el=$('#btnAccount'); if(!el) return;
  el.className='acctbtn '+({ok:'s-ok',wait:'s-wait',local:'s-local'}[status]||'s-local');
  const label = SESSION ? (SESSION.user.email||'Account')
              : (sb ? 'Sign in' : 'Local mode');
  el.title = SESSION ? ({ok:'Synced',wait:'Changes pending',local:'Offline'}[status]) : label;
  $('#acctTxt').textContent = label.length>22 ? label.slice(0,20)+'…' : label;
}

/* ---------------- generator ---------------- */
const W={p:6,c:4,f:9};
const score=(tot,t)=>W.p*(tot.p-t.p)**2+W.c*(tot.c-t.c)**2+W.f*(tot.f-t.f)**2;
const snap=(v,f)=>{ const s=f.st||1; return Math.min(f.mx,Math.max(f.mn,Math.round(v/s)*s)); };
function optimize(foods,tgt){
  let q=foods.map(f=>snap((f.mn+f.mx)/4,f));
  const U=foods.map(perUnit);
  const cur=()=>{const t={p:0,c:0,f:0};U.forEach((u,i)=>{t.p+=u.p*q[i];t.c+=u.c*q[i];t.f+=u.f*q[i];});return t;};
  for(let it=0;it<45;it++){
    const order=foods.map((_,i)=>i).sort(()=>Math.random()-.5);
    for(const i of order){
      const t=cur(),u=U[i];
      const rp=t.p-u.p*q[i], rc=t.c-u.c*q[i], rf=t.f-u.f*q[i];
      const num=W.p*u.p*(tgt.p-rp)+W.c*u.c*(tgt.c-rc)+W.f*u.f*(tgt.f-rf);
      const den=W.p*u.p*u.p+W.c*u.c*u.c+W.f*u.f*u.f;
      if(den<=1e-9) continue;
      q[i]=snap(num/den,foods[i]);
    }
  }
  return {q,tot:cur()};
}
const pick=(arr,n)=>{ const c=[...arr],o=[]; while(o.length<n&&c.length) o.push(c.splice(Math.floor(Math.random()*c.length),1)[0]); return o; };
function candidates(meal,{shuffle=false}={}){
  const cur=items(meal.id), locked=cur.filter(i=>i.lock&&F(i.fid));
  const base={p:0,c:0,f:0}; locked.forEach(i=>{const x=itemMacros(i);base.p+=x.p;base.c+=x.c;base.f+=x.f;});
  const tgt={p:Math.max(0,meal.t.p-base.p),c:Math.max(0,meal.t.c-base.c),f:Math.max(0,meal.t.f-base.f)};
  if(tgt.p+tgt.c+tgt.f<=0) return [];
  const pool=S.foods.filter(f=>f.use&&!locked.some(l=>l.fid===f.id));
  if(!pool.length) return [];
  const byRole=r=>pool.filter(f=>f.role===r);
  const out=[],seen=new Set(),tries=shuffle?60:420;
  for(let t=0;t<tries;t++){
    const k=2+Math.floor(Math.random()*3);
    let set=[];
    if(tgt.p>8) set.push(...pick(byRole('protein'),1));
    if(tgt.c>8) set.push(...pick(byRole('carb'),1));
    if(tgt.f>8) set.push(...pick(byRole('fat'),1));
    if(!set.length) set.push(...pick(pool,1));
    while(set.length<k){ const e=pick(pool,1)[0]; if(!e) break; if(!set.includes(e)) set.push(e); }
    set=set.filter(Boolean); if(!set.length) continue;
    const sig=set.map(f=>f.id).sort().join('|'); if(seen.has(sig)) continue; seen.add(sig);
    let q,tot;
    if(shuffle){
      q=set.map(f=>{const s=f.st||1,steps=Math.max(1,Math.round((f.mx-f.mn)/s));return snap(f.mn+Math.round(Math.random()*steps*.6)*s,f);});
      const u=set.map(perUnit); tot={p:0,c:0,f:0}; u.forEach((x,i)=>{tot.p+=x.p*q[i];tot.c+=x.c*q[i];tot.f+=x.f*q[i];});
    } else { const o=optimize(set,tgt); q=o.q; tot=o.tot; }
    let dup=0; const rc={}; set.forEach(f=>{rc[f.role]=(rc[f.role]||0)+1;});
    Object.values(rc).forEach(v=>{ if(v>1) dup+=v-1; });
    out.push({set,q,s:score(tot,tgt)+set.length*3+dup*10});
  }
  out.sort((a,b)=>a.s-b.s);
  return (shuffle?out.sort(()=>Math.random()-.5):out).slice(0,8);
}
function applyCandidate(meal,cand){
  const kept=items(meal.id).filter(i=>i.lock);
  S.days[S.date][meal.id]=kept.concat(cand.set.map((f,i)=>({fid:f.id,q:cand.q[i],lock:false})));
}
function generate(mid,mode){
  const m=S.template.find(x=>x.id===mid);
  const list=candidates(m,{shuffle:mode==='shuffle'});
  if(!list.length){ toast(m.t.p+m.t.c+m.t.f<=0?'This meal has no target yet — set one on the Targets tab.':'No suitable foods found.'); return; }
  ALT[mid]={list,i:0}; applyCandidate(m,list[0]); touchDay(); render();
}
function nextAlt(mid){
  const a=ALT[mid]; if(!a||a.list.length<2){ generate(mid,'auto'); return; }
  a.i=(a.i+1)%a.list.length; applyCandidate(S.template.find(x=>x.id===mid),a.list[a.i]); touchDay(); render();
  toast(`Option ${a.i+1} of ${a.list.length}`);
}

/* ---------------- sync ---------------- */
const fromRow=r=>({id:r.id,n:r.name,b:r.basis,u:r.unit,p:+r.p,c:+r.c,f:+r.f,k:+r.kcal,mn:+r.mn,mx:+r.mx,st:+r.st,role:r.role,use:r.enabled});
const toRow=f=>({household_id:HH,name:f.n,basis:f.b,unit:f.u,p:f.p,c:f.c,f:f.f,kcal:f.k,mn:f.mn,mx:f.mx,st:f.st,role:f.role,enabled:f.use,updated_at:new Date().toISOString()});

function enqueue(op){
  S.q=S.q||[];
  const key=op.op+':'+(op.id||op.date||'');
  S.q=S.q.filter(o=>(o.op+':'+(o.id||o.date||''))!==key);
  S.q.push(op); save(); flush();
}
const touchDay=()=>{ save(); enqueue({op:'day',date:S.date}); };
const touchProfile=()=>{ save(); enqueue({op:'profile'}); };

let flushing=false;
async function flush(){
  if(!cloud()||flushing||!S.q?.length) return;
  flushing=true;
  try{
    while(S.q.length){
      const op=S.q[0];
      await runOp(op);
      S.q.shift(); save();
    }
    setStatus('ok');
  }catch(e){ setStatus('wait'); }
  finally{ flushing=false; }
}
async function runOp(op){
  const now=new Date().toISOString();
  if(op.op==='profile'){
    const payload={v:2,template:S.template,daily:S.daily,mealUnit:S.mealUnit};
    const {error}=await sb.from('profiles').update({meals:payload,updated_at:now}).eq('user_id',SESSION.user.id);
    if(error) throw error; return;
  }
  if(op.op==='day'){
    const plan=S.days[op.date]||{};
    const {error}=await sb.from('days').upsert({user_id:SESSION.user.id,day:op.date,plan,updated_at:now});
    if(error) throw error; return;
  }
  if(op.op==='food'){
    const f=F(op.id); if(!f) return;
    const {error}=await sb.from('foods').update(toRow(f)).eq('id',op.id);
    if(error) throw error; return;
  }
  if(op.op==='delfood'){ const {error}=await sb.from('foods').delete().eq('id',op.id); if(error) throw error; return; }
  if(op.op==='delcombo'){ const {error}=await sb.from('combos').delete().eq('id',op.id); if(error) throw error; return; }
}

async function cloudPull(){
  const u=SESSION.user.id;
  let prof=(await sb.from('profiles').select('*').eq('user_id',u).maybeSingle()).data;
  if(!prof){ await new Promise(r=>setTimeout(r,1200));
    prof=(await sb.from('profiles').select('*').eq('user_id',u).maybeSingle()).data; }
  if(!prof) throw new Error('No profile row — did schema.sql run?');
  HH=prof.household_id;
  HOUSE=(await sb.from('households').select('*').eq('id',HH).maybeSingle()).data;

  const pm=prof.meals;
  if(Array.isArray(pm)&&pm.length) S.template=pm;                       // v1 shape
  else if(pm&&pm.v===2){                                                 // v2 shape
    if(Array.isArray(pm.template)&&pm.template.length) S.template=pm.template;
    if(pm.daily) S.daily=pm.daily;
    if(pm.mealUnit) S.mealUnit=pm.mealUnit;
  } else await sb.from('profiles').update(
      {meals:{v:2,template:S.template,daily:S.daily,mealUnit:S.mealUnit},updated_at:new Date().toISOString()}).eq('user_id',u);

  const {data:rows}=await sb.from('foods').select('*').eq('household_id',HH);
  if(rows&&rows.length) S.foods=rows.map(fromRow).sort((a,b)=>a.n.localeCompare(b.n));
  else await uploadFoods();

  await loadDay(S.date);
  await pullCombos();
  subscribe();
  setStatus('ok');
  await flush();
}
async function uploadFoods(){
  const {data,error}=await sb.from('foods').insert(S.foods.map(toRow)).select();
  if(error) throw error;
  const byName={}; data.forEach(r=>byName[r.name]=r.id);
  const map={}; S.foods.forEach(f=>{ if(byName[f.n]) map[f.id]=byName[f.n]; });
  Object.values(S.days).forEach(d=>Object.values(d).forEach(arr=>arr.forEach(i=>{ if(map[i.fid]) i.fid=map[i.fid]; })));
  S.saved.forEach(s=>s.items.forEach(i=>{ if(map[i.fid]) i.fid=map[i.fid]; }));
  S.foods=data.map(fromRow).sort((a,b)=>a.n.localeCompare(b.n));
  Object.keys(S.days).forEach(d=>enqueue({op:'day',date:d}));
}
async function loadDay(date){
  if(!cloud()) return;
  const {data}=await sb.from('days').select('plan').eq('user_id',SESSION.user.id).eq('day',date).maybeSingle();
  if(data) S.days[date]=data.plan||{};
  else if(!S.days[date]) S.days[date]={};
  else enqueue({op:'day',date});          // exists locally but not on the server -> push
}
async function pullCombos(){
  const {data}=await sb.from('combos').select('*').eq('household_id',HH).order('created_at',{ascending:false});
  if(data) S.saved=data.map(c=>({id:c.id,name:c.name,items:c.items,...(c.macros||{}),mine:c.user_id===SESSION.user.id}));
}
function subscribe(){
  if(CH) sb.removeChannel(CH);
  CH=sb.channel('mm-'+HH)
    .on('postgres_changes',{event:'*',schema:'public',table:'foods',filter:'household_id=eq.'+HH},async()=>{
      const {data}=await sb.from('foods').select('*').eq('household_id',HH);
      if(data){ S.foods=data.map(fromRow).sort((a,b)=>a.n.localeCompare(b.n)); save(); render(); }})
    .on('postgres_changes',{event:'*',schema:'public',table:'combos',filter:'household_id=eq.'+HH},async()=>{
      await pullCombos(); save(); if(S.tab==='saved') render(); })
    .subscribe();
}

/* ---------------- views ---------------- */
function ledger(){
  const host=$('#ledger'); if(!host) return;
  const {act,tgt}=dayTotals();
  const cell=(cls,lab,a,t,unit)=>{
    const pct=t>0?Math.min(140,a/t*100):0, over=t>0&&a>t*1.02, d=a-t;
    const ds=Math.abs(d)<(unit==='kcal'?15:2)?'fit':(d>0?'pos':'neg');
    return `<div class="lg ${cls} ${over?'over':''}">
      <div class="lab"><span>${lab}</span><span class="delta ${ds}">${d>0?'+':''}${r0(d)}</span></div>
      <div class="val">${r0(a)} <small>/ ${r0(t)}${unit==='kcal'?'':' g'}</small></div>
      <div class="track"><div class="fill" style="width:${Math.min(100,pct)}%"></div><div class="tick" style="left:calc(${t>0?Math.min(100,100*t/Math.max(a,t)):100}% - 1px)"></div></div></div>`;
  };
  host.innerHTML=cell('k-cal','Calories',act.k,tgt.k,'kcal')+cell('k-p','Protein',act.p,tgt.p)+
    cell('k-c','Carbs',act.c,tgt.c)+cell('k-f','Fat',act.f,tgt.f);
  const di=$('#dDate'); if(di) di.value=S.date;
  const dl=$('#dLabel');
  if(dl){ const diff=Math.round((new Date(S.date)-new Date(today()))/864e5);
    dl.textContent=diff===0?'today':diff===-1?'yesterday':diff===1?'tomorrow':
      new Date(S.date).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'}); }
}
function mealCard(m){
  const list=items(m.id), tot=mealTotals(m.id);
  const rows=list.map((it,i)=>{
    const f=F(it.fid); if(!f) return '';
    const x=itemMacros(it);
    return `<div class="row" data-m="${m.id}" data-i="${i}">
      <div><div class="rname" title="${esc(f.n)}">${esc(f.n)}</div>
        <span class="rmac"><b class="c-p">${r1(x.p)}p</b> · <b class="c-c">${r1(x.c)}k</b> · <b class="c-f">${r1(x.f)}y</b> · ${r0(x.k)} kcal</span></div>
      <div class="qty"><button data-act="dec" aria-label="decrease">−</button>
        <input class="num" type="number" inputmode="decimal" data-act="qty" value="${it.q}" step="${f.st}" min="0">
        <button data-act="inc" aria-label="increase">+</button><span class="u">${esc(f.u)}</span></div>
      <div class="icons">
        <button class="ico ${it.lock?'on':''}" data-act="lock" title="${it.lock?'Locked':'Lock'}">${it.lock?'🔒':'🔓'}</button>
        <button class="ico" data-act="del" title="Remove">✕</button></div></div>`;
  }).join('');
  const bar=(cls,lab,a,t)=>{
    const pct=t>0?Math.min(100,a/t*100):(a>0?100:0), over=t>0&&a>t*1.03, d=a-t;
    return `<div class="bar"><span class="bl">${lab}</span>
      <span class="track ${over?'over':''} k-${cls}" style="margin:0"><span class="fill" style="width:${pct}%"></span></span>
      <span class="bv">${r1(a)} <span class="hint">/ ${r1(t)}</span> <span class="delta ${Math.abs(d)<2?'fit':(d>0?'pos':'neg')}">${d>0?'+':''}${r1(d)}</span></span></div>`;
  };
  const opts=[...S.foods].sort((a,b)=>a.n.localeCompare(b.n)).map(f=>`<option value="${f.id}">${esc(f.n)}</option>`).join('');
  return `<section class="card meal" data-m="${m.id}">
    <div class="mhead"><span class="mname">${esc(m.name)}</span><span class="mkcal">${r0(tot.k)} / ${r0(targetKcal(m.t))} kcal</span></div>
    <div class="rows">${rows||'<div class="empty">Empty — add something below or fill it automatically.</div>'}</div>
    <div class="addrow"><select data-act="add"><option value="">+ add food…</option>${opts}</select></div>
    <div class="mtot">${bar('p','P',tot.p,m.t.p)}${bar('c','K',tot.c,m.t.c)}${bar('f','Y',tot.f,m.t.f)}</div>
    <div class="acts">
      <button class="btn solid" data-act="auto">Auto-fill</button>
      <button class="btn" data-act="alt">Another option</button>
      <button class="btn" data-act="shuffle">Shuffle</button>
      <button class="btn ghost" data-act="savemeal">Save</button>
      <button class="btn ghost" data-act="clear">Clear</button></div></section>`;
}
const viewPlan=()=>`<div class="datebar">
    <button class="dnav" id="dPrev" aria-label="previous day">‹</button>
    <input type="date" id="dDate">
    <button class="dnav" id="dNext" aria-label="next day">›</button>
    <button class="mini" id="dToday">Today</button>
    <span class="dlabel" id="dLabel"></span></div>
  <div class="ledger" id="ledger"></div>
  <div class="planhead"><h2 style="margin:0">Today's plan</h2><span class="spacer"></span>
    <button class="btn solid" id="fillAll">Fill the whole day</button>
    <button class="btn" id="copyPrev">Same as yesterday</button>
    <button class="btn" id="btnShare">Share</button>
    <button class="btn ghost" id="copyDay">Copy as text</button></div>
  <div class="grid">${S.template.map(mealCard).join('')}</div>`;

function viewFoods(){
  const list=S.foods.filter(f=>f.n.toLowerCase().includes(foodFilter));
  const rows=list.map(f=>`<tr data-f="${f.id}">
    <td><input data-k="n" value="${esc(f.n)}"></td>
    <td><select data-k="b"><option value="100g"${f.b==='100g'?' selected':''}>100 g</option><option value="piece"${f.b==='piece'?' selected':''}>piece/scoop</option></select></td>
    <td class="n"><input data-k="p" class="num" type="number" step="0.1" value="${f.p}"></td>
    <td class="n"><input data-k="c" class="num" type="number" step="0.1" value="${f.c}"></td>
    <td class="n"><input data-k="f" class="num" type="number" step="0.1" value="${f.f}"></td>
    <td class="n"><input data-k="k" class="num" type="number" step="1" value="${f.k}"></td>
    <td><select data-k="role">${['protein','carb','fat','veg'].map(r=>`<option value="${r}"${f.role===r?' selected':''}>${({protein:'protein',carb:'carb',fat:'fat',veg:'veg'})[r]}</option>`).join('')}</select></td>
    <td class="n"><input data-k="mn" class="num" type="number" step="1" value="${f.mn}"></td>
    <td class="n"><input data-k="mx" class="num" type="number" step="1" value="${f.mx}"></td>
    <td style="text-align:center"><input data-k="use" type="checkbox"${f.use?' checked':''} style="width:auto"></td>
    <td><button class="ico" data-act="delfood" title="Delete">✕</button></td></tr>`).join('');
  return `<h2>Food list <span class="hint">· ${S.foods.length} entries${cloud()?' · shared kitchen':''}</span></h2>
    <p class="hint" style="margin:-4px 0 12px">Values are per <b>100 g</b> or per <b>1 piece/scoop</b>. <b>Min/Max</b> is the portion range the generator may use; unchecking <b>Use</b> keeps a food out of suggestions.${cloud()?' This list is shared with everyone in your kitchen — edits reach them right away.':''}</p>
    <div class="searchbar"><input id="fq" placeholder="Search…" value="${esc(foodFilter)}"><button class="btn solid" id="addFood">Add food</button></div>
    <div class="tablewrap"><table><thead><tr>
      <th>Food</th><th>Unit</th><th class="n">Protein</th><th class="n">Carbs</th><th class="n">Fat</th><th class="n">kcal</th>
      <th>Role</th><th class="n">Min</th><th class="n">Max</th><th>Use</th><th></th></tr></thead>
      <tbody>${rows||'<tr><td colspan="11" class="empty">No food matches that search.</td></tr>'}</tbody></table></div>`;
}
function viewTargets(){
  const d=dailyGrams(), a=allocated(), sp=S.daily.split;
  const sum=r1(sp.p+sp.c+sp.f), byPct=S.daily.mode==='pct', mealPct=S.mealUnit==='pct';
  const seg=(id,cur,opts)=>`<div class="seg" id="${id}">`+opts.map(o=>
    `<button data-v="${o[0]}"${cur===o[0]?' class="on"':''}>${o[1]}</button>`).join('')+`</div>`;

  const macro=(k,lab,cls)=>{
    const g=d[k], pc=sp[k];
    return `<label class="dfield"><span class="dlab"><span class="dot d-${cls}"></span>${lab}</span>
      <input class="num" type="number" step="${byPct?'0.5':'1'}" data-daily="${k}"
             value="${byPct?pc:r1(g)}" min="0">
      <span class="dsub">${byPct?`${r1(g)} g`:`${d.k>0?r1(pc):0} %`}</span></label>`;
  };

  const rows=S.template.map(m=>{
    const cell=k=>{
      const v=mealPct?(d[k]>0?r1(m.t[k]/d[k]*100):0):m.t[k];
      return `<input type="number" data-k="${k}" step="${mealPct?'1':'1'}" value="${v}" min="0">`;
    };
    return `<div class="trow" data-m="${m.id}">
      <input type="text" data-k="name" value="${esc(m.name)}">
      ${cell('p')}${cell('c')}${cell('f')}
      <span class="num hint thide" style="text-align:right">${r0(targetKcal(m.t))} kcal</span>
      <button class="ico" data-act="delmeal" title="Delete meal">✕</button></div>`;
  }).join('');

  const gap=(lab,al,da,cls)=>{
    const diff=al-da, near=Math.abs(diff)<(lab==='kcal'?12:1.5);
    return `<span class="allocitem"><span class="dot d-${cls}"></span>${lab}
      <b class="num">${r0(al)}</b><span class="hint num"> / ${r0(da)}</span>
      <span class="delta num ${near?'fit':(diff>0?'pos':'neg')}">${diff>0?'+':''}${r0(diff)}</span></span>`;
  };

  return `<h2>Targets</h2>
  <p class="hint" style="margin:-4px 0 14px">Start from your daily calories and split them into macros, then decide how much of each goes to which meal. Targets are personal and apply to every day.</p>

  <section class="card daily">
    <div class="dhead"><h3>Daily target</h3><span class="spacer"></span>
      ${seg('segDaily',S.daily.mode,[['pct','% of calories'],['g','grams']])}</div>
    <div class="dgrid">
      <label class="dfield kcalfield"><span class="dlab">Calories</span>
        <input class="num" type="number" step="10" min="0" data-daily="kcal" value="${r0(S.daily.kcal)}">
        <span class="dsub">kcal per day</span></label>
      ${macro('p','Protein','p')}${macro('c','Carbs','c')}${macro('f','Fat','f')}
    </div>
    ${byPct&&Math.abs(sum-100)>0.5?`<div class="warn">The split adds up to ${sum}% instead of 100%, so the grams above will not match your calorie goal.
      <button class="btn" id="normSplit" style="margin-left:6px">Normalise to 100%</button></div>`:''}
  </section>

  <section class="card" style="margin-top:14px">
    <div class="dhead"><h3>Split across meals</h3><span class="spacer"></span>
      ${seg('segMeal',S.mealUnit,[['g','grams'],['pct','% of daily']])}</div>
    <div class="trow thead"><span>Meal</span><span style="text-align:right">Protein</span><span style="text-align:right">Carbs</span><span style="text-align:right">Fat</span><span class="thide" style="text-align:right">Calories</span><span></span></div>
    ${rows}
    <div class="alloc">
      <span class="alloclab">Allocated</span>
      ${gap('protein',a.p,d.p,'p')}${gap('carbs',a.c,d.c,'c')}${gap('fat',a.f,d.f,'f')}
      <span class="allocitem">kcal <b class="num">${r0(a.k)}</b><span class="hint num"> / ${r0(d.k)}</span>
        <span class="delta num ${Math.abs(a.k-d.k)<12?'fit':(a.k>d.k?'pos':'neg')}">${a.k>d.k?'+':''}${r0(a.k-d.k)}</span></span>
    </div>
  </section>

  <div class="acts" style="margin-top:12px">
    <button class="btn solid" id="scaleMeals">Fit meals to daily target</button>
    <button class="btn" id="addMeal">Add meal</button>
    <button class="btn ghost" id="resetAll">Reset everything</button></div>`;
}
function viewSaved(){
  if(!S.saved.length) return `<h2>Saved combinations</h2><div class="card empty" style="padding:26px">Nothing saved yet. Hit <b>Save</b> on a meal you like in the Plan tab.</div>`;
  const mopts=S.template.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('');
  return `<h2>Saved combinations${cloud()?' <span class="hint">· shared kitchen</span>':''}</h2><div class="grid">${S.saved.map(s=>{
    const it=s.items.map(i=>{const f=F(i.fid);return f?`${esc(f.n)} <span class="hint">${i.q}${f.b==='100g'?'g':' '+esc(f.u)}</span>`:''}).filter(Boolean).join(' · ');
    return `<section class="card meal" data-s="${s.id}">
      <div class="mhead"><span class="mname">${esc(s.name)}</span><span class="mkcal">${r0(s.k||0)} kcal</span></div>
      <p style="margin:9px 0 10px;font-size:13px;line-height:1.6">${it||'<span class="hint">The foods in this combination were deleted from the list.</span>'}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <span class="chip c-p">${r1(s.p||0)} p</span><span class="chip c-c">${r1(s.c||0)} k</span><span class="chip c-f">${r1(s.f||0)} y</span></div>
      <div class="acts"><select data-act="loadto" style="border:1px solid var(--line);border-radius:7px;padding:6px 8px;font-size:12.5px">${mopts}</select>
        <button class="btn solid" data-act="load">Load</button>
        <button class="btn ghost" data-act="delsaved">Delete</button></div></section>`;}).join('')}</div>`;
}
function viewAccount(){
  if(!sb) return `<h2>Account</h2>
    <section class="card acct">
      <div class="dhead"><h3>Local mode</h3></div>
      <p style="margin:0 0 10px">No server configured, so data stays in this browser only — sync and shared kitchen are off.</p>
      <p class="hint" style="margin:0">To turn them on, create a Supabase project, run <code>schema.sql</code>, and fill in the two lines in <code>config.js</code>.</p>
    </section>
    <section class="card acct" style="margin-top:14px">
      <div class="dhead"><h3>Data</h3></div>
      <p class="hint" style="margin:0 0 10px">Download a copy of every target, day, food and saved combination.</p>
      <div class="acts" style="margin:0"><button class="btn" id="btnExport">Back up</button></div>
    </section>`;

  if(!SESSION) return `<h2>Account</h2>
    <section class="card acct">
      <div class="dhead"><h3>Sign in</h3></div>
      <p class="hint" style="margin:0 0 14px">Signing in stores your plans on the server, so your phone and computer see the same data. You can also keep using the app signed out — everything then stays in this browser.</p>
      <div class="field"><label>Email</label><input type="email" id="aEmail" autocomplete="email"></div>
      <div class="field"><label>Password</label><input type="password" id="aPass" autocomplete="current-password"></div>
      <div class="acts" style="margin:0"><button class="btn solid" id="doLogin">Sign in</button><button class="btn" id="doSignup">Create account</button></div>
      <p class="hint" id="aMsg" style="margin:12px 0 0"></p>
    </section>
    <section class="card acct" style="margin-top:14px">
      <div class="dhead"><h3>Data</h3></div>
      <p class="hint" style="margin:0 0 10px">Download a copy of every target, day, food and saved combination.</p>
      <div class="acts" style="margin:0"><button class="btn" id="btnExport">Back up</button></div>
    </section>`;

  return `<h2>Account</h2>
    <section class="card acct">
      <div class="dhead"><h3>Profile</h3></div>
      <div class="field"><label>Signed in as</label><div>${esc(SESSION.user.email||'')}</div></div>
      <div class="field"><label>Kitchen name</label>
        <input type="text" id="houseName" value="${esc(HOUSE?.name||'')}" placeholder="My kitchen"></div>
      
      <div class="acts" style="margin:0"><button class="btn" id="doLogout">Sign out</button></div>
    </section>

    <section class="card acct" style="margin-top:14px">
      <div class="dhead"><h3>Shared kitchen</h3></div>
      <div class="field"><label>Your invite code</label>
        <div><span class="code">${esc(HOUSE?.invite_code||'—')}</span>
          <button class="btn ghost" id="copyCode">copy</button></div>
        <p class="hint" style="margin:6px 0 0">Give this code to a friend and you will share the same food list and saved combinations. Daily plans stay private to each person.</p></div>
      <div class="field"><label>Join another kitchen</label><input type="text" id="joinCode" placeholder="6-character code"></div>
      <div class="warn">Joining deletes your kitchen's food list and replaces it with theirs. Back up first.</div>
      <div class="acts" style="margin:0"><button class="btn solid" id="doJoin">Join</button></div>
    </section>

    <section class="card acct" style="margin-top:14px">
      <div class="dhead"><h3>Data</h3></div>
      <p class="hint" style="margin:0 0 10px">Download a copy of every target, day, food and saved combination.</p>
      <div class="acts" style="margin:0"><button class="btn" id="btnExport">Back up</button></div>
    </section>`;
}

function render(){
  document.querySelectorAll('#tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===S.tab)));
  paintAccountBtn();
  $('#view').innerHTML = S.tab==='plan'?viewPlan():S.tab==='foods'?viewFoods():S.tab==='targets'?viewTargets():
                         S.tab==='saved'?viewSaved():viewAccount();
  ledger();
  const fq=$('#fq'); if(fq&&focusSearch){ fq.focus(); fq.setSelectionRange(fq.value.length,fq.value.length); }
  focusSearch=false;
}

/* ---------------- sharing / text export ---------------- */
const SEED_IDS=new Set(SEED_FOODS.map(f=>f.id));
function b64e(str){ const b=new TextEncoder().encode(str); let s='';
  for(let i=0;i<b.length;i+=4096) s+=String.fromCharCode(...b.subarray(i,i+4096));
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function b64d(str){ const s=atob(str.replace(/-/g,'+').replace(/_/g,'/'));
  return new TextDecoder().decode(Uint8Array.from(s,c=>c.charCodeAt(0))); }
function shareLink(){
  const used=new Set(); S.template.forEach(m=>items(m.id).forEach(i=>used.add(i.fid)));
  const custom=S.foods.filter(f=>used.has(f.id)&&!SEED_IDS.has(f.id));
  const pack={v:3,m:S.template.map(m=>({n:m.name,t:m.t,i:items(m.id).map(x=>[x.fid,x.q])})),f:custom};
  return location.href.split('#')[0]+'#p='+b64e(JSON.stringify(pack));
}
function readShared(){ const h=location.hash; if(!h.startsWith('#p=')) return null;
  try{ const d=JSON.parse(b64d(h.slice(3))); return d&&d.m?d:null; }catch(e){ return null; } }
function applyShared(d){
  (d.f||[]).forEach(f=>{ if(!F(f.id)) S.foods.push(f); });
  S.template=d.m.map((m,i)=>({id:'s'+i+uid(),name:m.n,t:m.t}));
  S.days[S.date]={}; d.m.forEach((m,i)=>{ S.days[S.date][S.template[i].id]=(m.i||[]).filter(x=>F(x[0])).map(x=>({fid:x[0],q:x[1],lock:false})); });
  S.tab='plan'; touchProfile(); touchDay(); render(); toast('Shared plan loaded');
}
function dayAsText(){
  const txt=S.template.map(m=>{const l=items(m.id); if(!l.length) return null; const t=mealTotals(m.id);
    return `${m.name} — ${r0(t.k)} kcal (P${r1(t.p)} C${r1(t.c)} F${r1(t.f)})\n`+
      l.map(i=>{const f=F(i.fid);return f?`  · ${f.n} ${i.q}${f.b==='100g'?' g':' '+f.u}`:'';}).join('\n');
  }).filter(Boolean).join('\n\n');
  const d=dayTotals().act;
  return `${S.date}\n\n`+txt+`\n\nDAILY TOTAL: ${r0(d.k)} kcal · P${r0(d.p)} C${r0(d.c)} F${r0(d.f)}`;
}

/* ---------------- events ---------------- */
$('#tabs').addEventListener('click',e=>{const b=e.target.closest('button'); if(!b)return; S.tab=b.dataset.tab; save(); render();});

async function goDate(d){ S.date=d; ALT={}; if(cloud()) { try{ await loadDay(d); }catch(e){ setStatus('wait'); } } save(); render(); }
$('#btnAccount').addEventListener('click',()=>{ S.tab='account'; save(); render(); });
const shiftDate=n=>{ const d=new Date(S.date); d.setDate(d.getDate()+n); goDate(d.toLocaleDateString('sv-SE')); };

$('#view').addEventListener('click',e=>{
  const sg=e.target.closest('.seg button');
  if(sg){ const host=sg.parentElement.id;
    if(host==='segDaily') S.daily.mode=sg.dataset.v; else if(host==='segMeal') S.mealUnit=sg.dataset.v;
    touchProfile(); render(); return; }
  const b=e.target.closest('[data-act]'); if(!b) return;
  const act=b.dataset.act, mealEl=b.closest('[data-m]'), rowEl=b.closest('.row');
  if(act==='dec'||act==='inc'){
    const l=items(rowEl.dataset.m), it=l[+rowEl.dataset.i], f=F(it.fid);
    it.q=Math.max(0,r1((+it.q||0)+(act==='inc'?f.st:-f.st))); touchDay(); render(); return; }
  if(act==='lock'){ const l=items(rowEl.dataset.m); l[+rowEl.dataset.i].lock=!l[+rowEl.dataset.i].lock; touchDay(); render(); return; }
  if(act==='del'){ items(rowEl.dataset.m).splice(+rowEl.dataset.i,1); touchDay(); render(); return; }
  if(act==='auto'||act==='shuffle'){ generate(mealEl.dataset.m,act); return; }
  if(act==='alt'){ nextAlt(mealEl.dataset.m); return; }
  if(act==='clear'){ const mid=mealEl.dataset.m; S.days[S.date][mid]=items(mid).filter(i=>i.lock); touchDay(); render(); return; }
  if(act==='savemeal'){
    const m=S.template.find(x=>x.id===mealEl.dataset.m), l=items(m.id);
    if(!l.length){ toast('Fill the meal first.'); return; }
    const t=mealTotals(m.id);
    ask('Save combination',m.name+' — '+r0(t.k)+' kcal').then(async name=>{ if(!name) return;
      const rec={id:uid(),name,items:l.map(i=>({fid:i.fid,q:i.q})),...t,mine:true};
      if(cloud()){ const {data,error}=await sb.from('combos').insert({household_id:HH,user_id:SESSION.user.id,
          name,items:rec.items,macros:{p:t.p,c:t.c,f:t.f,k:t.k}}).select().maybeSingle();
        if(error){ toast('Could not save — no connection'); return; } rec.id=data.id; }
      S.saved.unshift(rec); save(); toast('Saved'); });
    return; }
  if(act==='delfood'){ const id=b.closest('tr').dataset.f, f=F(id);
    confirmBox('Delete food',`"${f?f.n:''}" will be removed from the list and from every meal using it.`,'Delete').then(ok=>{ if(!ok) return;
      S.foods=S.foods.filter(x=>x.id!==id);
      Object.values(S.days).forEach(d=>Object.keys(d).forEach(k=>d[k]=d[k].filter(i=>i.fid!==id)));
      if(cloud()) enqueue({op:'delfood',id});
      touchDay(); render(); }); return; }
  if(act==='delmeal'){ const id=mealEl.dataset.m, m=S.template.find(x=>x.id===id);
    confirmBox('Delete meal',`"${m?m.name:''}" and its targets will be deleted.`,'Delete').then(ok=>{ if(!ok) return;
      S.template=S.template.filter(x=>x.id!==id);
      Object.values(S.days).forEach(d=>delete d[id]);
      touchProfile(); touchDay(); render(); }); return; }
  if(act==='delsaved'){ const id=b.closest('[data-s]').dataset.s;
    S.saved=S.saved.filter(s=>s.id!==id); if(cloud()) enqueue({op:'delcombo',id}); save(); render(); return; }
  if(act==='load'){ const el=b.closest('[data-s]'), s=S.saved.find(x=>x.id===el.dataset.s);
    const mid=el.querySelector('[data-act=loadto]').value;
    S.days[S.date][mid]=s.items.map(i=>({...i,lock:false}));
    touchDay(); S.tab='plan'; render(); toast('Loaded'); return; }
});

$('#view').addEventListener('change',e=>{
  const el=e.target;
  if(el.dataset.act==='add'&&el.value){ const mid=el.closest('[data-m]').dataset.m, f=F(el.value);
    items(mid).push({fid:f.id,q:f.b==='100g'?100:1,lock:false}); touchDay(); render(); return; }
  const tr=el.closest('tr[data-f]');
  if(tr&&el.dataset.k){ const f=F(tr.dataset.f), k=el.dataset.k;
    if(k==='b'&&el.value!==f.b){ const to=el.value, fac=to==='piece'?1/100:100;
      Object.values(S.days).forEach(d=>Object.values(d).forEach(arr=>arr.forEach(i=>{ if(i.fid===f.id) i.q=r1(i.q*fac); })));
      f.mn=r1(f.mn*fac); f.mx=r1(f.mx*fac); f.st=to==='piece'?0.5:10; f.u=to==='piece'?'adet':'g'; touchDay(); }
    f[k]= k==='use'?el.checked : (k==='n'||k==='b'||k==='role')?el.value : (+el.value||0);
    save(); if(cloud()) enqueue({op:'food',id:f.id});
    if(k==='b'||k==='n') render(); else ledger(); return; }
  if(el.id==='dDate'&&el.value){ goDate(el.value); return; }
  if(el.id==='houseName'){ const name=el.value.trim()||'My kitchen';
    if(HOUSE) HOUSE.name=name;
    if(cloud()) sb.from('households').update({name}).eq('id',HH)
      .then(({error})=>toast(error?'Could not rename the kitchen':'Kitchen renamed'));
    return; }
  if(el.dataset.daily){ const k=el.dataset.daily, v=+el.value||0;
    if(k==='kcal') S.daily.kcal=Math.max(0,v);
    else if(S.daily.mode==='pct') setSplitBalanced(k,v);
    else setDailyGram(k,v);
    touchProfile(); render(); return; }
  const tw=el.closest('.trow[data-m]');
  if(tw&&el.dataset.k){ const m=S.template.find(x=>x.id===tw.dataset.m), k=el.dataset.k;
    if(k==='name') m.name=el.value;
    else if(S.mealUnit==='pct'){ const d=dailyGrams(); m.t[k]=r1((+el.value||0)/100*d[k]); }
    else m.t[k]=+el.value||0;
    touchProfile(); render(); return; }
});

$('#view').addEventListener('input',e=>{
  const el=e.target;
  if(el.dataset.act==='qty'){ const row=el.closest('.row'), l=items(row.dataset.m);
    l[+row.dataset.i].q=Math.max(0,+el.value||0);
    const x=itemMacros(l[+row.dataset.i]);
    row.querySelector('.rmac').innerHTML=`<b class="c-p">${r1(x.p)}p</b> · <b class="c-c">${r1(x.c)}k</b> · <b class="c-f">${r1(x.f)}y</b> · ${r0(x.k)} kcal`;
    patchMeal(row.dataset.m); ledger(); touchDay(); return; }
  if(el.id==='fq'){ foodFilter=el.value.toLowerCase(); focusSearch=true; render(); }
});
function patchMeal(mid){
  const card=document.querySelector(`.meal[data-m="${mid}"]`); if(!card) return;
  const m=S.template.find(x=>x.id===mid), tot=mealTotals(mid);
  card.querySelector('.mkcal').textContent=`${r0(tot.k)} / ${r0(targetKcal(m.t))} kcal`;
  const keys=[[m.t.p,tot.p],[m.t.c,tot.c],[m.t.f,tot.f]];
  card.querySelectorAll('.mtot .bar').forEach((bar,i)=>{
    const [t,a]=keys[i], pct=t>0?Math.min(100,a/t*100):(a>0?100:0), d=a-t;
    bar.querySelector('.fill').style.width=pct+'%';
    bar.querySelector('.track').classList.toggle('over',t>0&&a>t*1.03);
    bar.querySelector('.bv').innerHTML=`${r1(a)} <span class="hint">/ ${r1(t)}</span> <span class="delta ${Math.abs(d)<2?'fit':(d>0?'pos':'neg')}">${d>0?'+':''}${r1(d)}</span>`;
  });
}

document.addEventListener('click',async e=>{
  const id=e.target.id;
  if(id==='fillAll'){ S.template.forEach(m=>{ if(m.t.p+m.t.c+m.t.f>0){ const l=candidates(m); if(l.length){ALT[m.id]={list:l,i:0};applyCandidate(m,l[0]);} }});
    touchDay(); render(); toast('Day filled'); }
  if(id==='copyPrev'){ const d=new Date(S.date); d.setDate(d.getDate()-1); const prev=d.toLocaleDateString('sv-SE');
    if(cloud()) await loadDay(prev);
    const p=S.days[prev];
    if(!p||!Object.keys(p).length){ toast('No plan saved for yesterday.'); return; }
    S.days[S.date]=JSON.parse(JSON.stringify(p)); touchDay(); render(); toast("Yesterday's plan copied"); }
  if(id==='dPrev') shiftDate(-1);
  if(id==='dNext') shiftDate(1);
  if(id==='dToday') goDate(today());
  if(id==='normSplit'){ normalizeSplit(); touchProfile(); render(); toast('Split normalised to 100%'); }
  if(id==='scaleMeals'){ scaleMealsToDaily(); touchProfile(); render(); toast('Meal targets scaled to the daily total'); }
  if(id==='addMeal'){ S.template.push({id:uid(),name:'New meal',t:{p:0,c:0,f:0}}); touchProfile(); render(); }
  if(id==='addFood'){ ask('New food','').then(async n=>{ if(!n) return;
    let f={n,id:uid(),b:'100g',u:'g',p:0,c:0,f:0,k:0,mn:30,mx:300,st:10,role:'protein',use:true};
    if(cloud()){ const {data,error}=await sb.from('foods').insert(toRow(f)).select().maybeSingle();
      if(error){ toast('Could not add — no connection'); return; } f=fromRow(data); }
    S.foods.unshift(f); foodFilter=''; save(); render(); }); }
  if(id==='resetAll'){ confirmBox('Reset everything',"Targets, today's plan and the food list all go back to their starting state.",'Reset')
    .then(ok=>{ if(!ok) return; const keep=S.tab; S=defaultState(); S.tab=keep;
      touchProfile(); touchDay(); render(); toast('Reset'); }); }
  if(id==='copyDay') copyText(dayAsText());
  if(id==='copyCode'&&HOUSE) copyText(HOUSE.invite_code);
  if(id==='btnShare'){ const url=shareLink();
    modal('Share plan',`<p class="hint" style="margin:0 0 8px">This link carries the day's plan and targets — whoever opens it sees the same plan in their own Minumeal.</p><textarea id="mUrl" readonly style="height:96px">${esc(url)}</textarea>`,
      [{label:'Close',ghost:true,value:'x'},{label:'Copy link',solid:true,value:'copy'}]).then(v=>{ if(v==='copy') copyText(url); }); }
  if(id==='btnExport'){ const json=JSON.stringify(S,null,2);
    modal('Back up',`<p class="hint" style="margin:0 0 8px">Every target, day, food and saved combination.</p><textarea id="mJson" readonly>${esc(json)}</textarea>`,
      [{label:'Close',ghost:true,value:'x'},{label:'Copy',value:'copy'},{label:'Download',solid:true,value:'dl'}]).then(v=>{
        if(v==='copy') copyText(json);
        if(v==='dl'){ try{ const a=document.createElement('a');
          a.href=URL.createObjectURL(new Blob([json],{type:'application/json'}));
          a.download='minumeal-'+today()+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); toast('Backup downloaded');
        }catch(err){ toast('Download blocked — you can copy the text instead.'); } } }); }

  /* hesap */
  if(id==='doLogin'||id==='doSignup'){
    const email=$('#aEmail').value.trim(), pass=$('#aPass').value;
    if(!email||!pass){ $('#aMsg').textContent='Email and password are required.'; return; }
    e.target.disabled=true; $('#aMsg').textContent='…';
    const {data,error}= id==='doSignup'
      ? await sb.auth.signUp({email,password:pass})
      : await sb.auth.signInWithPassword({email,password:pass});
    e.target.disabled=false;
    if(error){ $('#aMsg').textContent=error.message; return; }
    if(id==='doSignup'&&!data.session){ $('#aMsg').textContent='Account created. Click the confirmation link in your email, then sign in.'; return; }
  }
  if(id==='doLogout'){ await sb.auth.signOut(); }
  if(id==='doJoin'){ const code=$('#joinCode').value.trim(); if(!code) return;
    const ok=await confirmBox('Join kitchen','Your own food list will be deleted and replaced with theirs. Continue?','Join');
    if(!ok) return;
    const {error}=await sb.rpc('join_household',{code});
    if(error){ toast(error.message); return; }
    toast('Joined'); S.foods=[]; await cloudPull(); render(); }
});

/* ---------------- boot ---------------- */
function adoptCache(){ const c=loadCache(); if(c&&c.template&&c.foods){ S=Object.assign(defaultState(),c); if(!S.days[S.date]) S.days[S.date]={}; } }

async function onSession(sess){
  const wasSignedIn=!!SESSION;
  SESSION=sess;
  if(SESSION){
    adoptCache();
    if(!wasSignedIn&&S.tab==='account') S.tab='plan';   // land on the plan, not the sign-in screen
    setStatus('wait'); render();                        // paint now, sync in the background
    try{ await cloudPull(); }catch(e){ setStatus('wait'); toast('Could not reach the server — continuing with the local copy.'); }
    if(!wasSignedIn) toast('Signed in');
  } else { HH=HOUSE=null; if(CH){ sb?.removeChannel(CH); CH=null; } adoptCache(); setStatus('local'); }
  render();
}

(async()=>{
  adoptCache(); setStatus(sb?'wait':'local'); render();
  if(sb){
    const {data}=await sb.auth.getSession();
    await onSession(data.session||null);
    sb.auth.onAuthStateChange((_e,sess)=>{ if((sess?.user?.id||null)!==(SESSION?.user?.id||null)) onSession(sess||null); });
    setInterval(flush,20000);
    window.addEventListener('online',flush);
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden) flush(); });
  }
  const shared=readShared();
  if(shared){
    try{ history.replaceState(null,'',location.href.split('#')[0]); }catch(e){ location.hash=''; }
    const ok=await confirmBox('Shared plan',"Someone shared a Minumeal plan. Load it? It replaces today's plan and your targets.",'Load');
    if(ok) applyShared(shared);
  }
})();
