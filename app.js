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
function setStatus(s){ status=s; const el=$('#sync');
  el.className='sync '+({ok:'s-ok',wait:'s-wait',local:'s-local'}[s]||'s-local');
  $('#syncTxt').textContent={ok:'synced',wait:'pending',local:sb?'signed out':'local'}[s]; }

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
    const {error}=await sb.from('profiles').update({meals:S.template,updated_at:now}).eq('user_id',SESSION.user.id);
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

  if(Array.isArray(prof.meals)&&prof.meals.length) S.template=prof.meals;
  else await sb.from('profiles').update({meals:S.template,updated_at:new Date().toISOString()}).eq('user_id',u);

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
  const {act,tgt}=dayTotals();
  const cell=(cls,lab,a,t,unit)=>{
    const pct=t>0?Math.min(140,a/t*100):0, over=t>0&&a>t*1.02, d=a-t;
    const ds=Math.abs(d)<(unit==='kcal'?15:2)?'fit':(d>0?'pos':'neg');
    return `<div class="lg ${cls} ${over?'over':''}">
      <div class="lab"><span>${lab}</span><span class="delta ${ds}">${d>0?'+':''}${r0(d)}</span></div>
      <div class="val">${r0(a)} <small>/ ${r0(t)}${unit==='kcal'?'':' g'}</small></div>
      <div class="track"><div class="fill" style="width:${Math.min(100,pct)}%"></div><div class="tick" style="left:calc(${t>0?Math.min(100,100*t/Math.max(a,t)):100}% - 1px)"></div></div></div>`;
  };
  $('#ledger').innerHTML=cell('k-cal','Calories',act.k,tgt.k,'kcal')+cell('k-p','Protein',act.p,tgt.p)+
    cell('k-c','Carbs',act.c,tgt.c)+cell('k-f','Fat',act.f,tgt.f);
  $('#dDate').value=S.date;
  const diff=Math.round((new Date(S.date)-new Date(today()))/864e5);
  $('#dLabel').textContent=diff===0?'today':diff===-1?'yesterday':diff===1?'tomorrow':
    new Date(S.date).toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});
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
const viewPlan=()=>`<div class="planhead"><h2 style="margin:0">Today's plan</h2><span class="spacer"></span>
  <button class="btn solid" id="fillAll">Fill the whole day</button>
  <button class="btn" id="copyPrev">Same as yesterday</button>
  <button class="btn" id="copyDay">Copy as text</button></div>
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
  const {tgt}=dayTotals();
  const rows=S.template.map(m=>`<div class="trow" data-m="${m.id}">
    <input type="text" data-k="name" value="${esc(m.name)}">
    <input type="number" data-k="p" step="1" value="${m.t.p}">
    <input type="number" data-k="c" step="1" value="${m.t.c}">
    <input type="number" data-k="f" step="1" value="${m.t.f}">
    <span class="num hint thide" style="text-align:right">${r0(targetKcal(m.t))} kcal</span>
    <button class="ico" data-act="delmeal" title="Delete meal">✕</button></div>`).join('');
  return `<h2>Targets</h2>
    <p class="hint" style="margin:-4px 0 12px">Meal calories come from the macros: 4×protein + 4×carbs + 9×fat. Targets are personal and apply to every day.</p>
    <div class="card"><div class="trow thead"><span>Meal</span><span style="text-align:right">Protein</span><span style="text-align:right">Carbs</span><span style="text-align:right">Fat</span><span class="thide" style="text-align:right">Calories</span><span></span></div>
      ${rows}
      <div class="tsum"><span>Daily:</span>
        <span><span class="dot d-p"></span> ${r0(tgt.p)} g protein</span>
        <span><span class="dot d-c"></span> ${r0(tgt.c)} g carbs</span>
        <span><span class="dot d-f"></span> ${r0(tgt.f)} g fat</span>
        <span><b>${r0(tgt.k)} kcal</b></span></div></div>
    <div class="acts" style="margin-top:12px"><button class="btn" id="addMeal">Add meal</button>
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
  if(!sb) return `<h2>Account</h2><div class="card acct">
    <p style="margin:0 0 10px">No server configured, so the app runs in <b>local mode</b>: data stays in this browser only, with sync and shared kitchen turned off.</p>
    <p class="hint" style="margin:0">To turn them on, create a Supabase project, run <code>schema.sql</code>, and fill in the two lines in <code>config.js</code>.</p></div>`;
  if(!SESSION) return `<h2>Sign in</h2><div class="card acct">
    <p class="hint" style="margin:0 0 14px">Signing in stores your plans on the server, so your phone and computer see the same data. You can also use the app signed out — everything then stays in this browser.</p>
    <div class="field"><label>Email</label><input type="email" id="aEmail" autocomplete="email"></div>
    <div class="field"><label>Password</label><input type="password" id="aPass" autocomplete="current-password"></div>
    <div class="acts"><button class="btn solid" id="doLogin">Sign in</button><button class="btn" id="doSignup">Create account</button></div>
    <p class="hint" id="aMsg" style="margin:12px 0 0"></p></div>`;
  return `<h2>Account</h2><div class="card acct">
    <div class="field"><label>Signed in as</label><div>${esc(SESSION.user.email||'')}</div></div>
    <div class="field"><label>Kitchen</label><div>${esc(HOUSE?.name||'—')}</div></div>
    <div class="field"><label>Invite code</label><div><span class="code">${esc(HOUSE?.invite_code||'—')}</span>
      <button class="btn ghost" id="copyCode">copy</button></div>
      <p class="hint" style="margin:6px 0 0">Give this code to a friend and you will share the same food list and saved combinations. Daily plans stay private to each person.</p></div>
    <div class="field"><label>Join another kitchen</label><input type="text" id="joinCode" placeholder="6-character code"></div>
    <div class="warn">Joining deletes your kitchen's food list and replaces it with theirs. Back up first.</div>
    <div class="acts"><button class="btn solid" id="doJoin">Join</button><button class="btn ghost" id="doLogout">Sign out</button></div></div>`;
}
function render(){
  document.querySelectorAll('#tabs button').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===S.tab)));
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
$('#dPrev').onclick=()=>{ const d=new Date(S.date); d.setDate(d.getDate()-1); goDate(d.toLocaleDateString('sv-SE')); };
$('#dNext').onclick=()=>{ const d=new Date(S.date); d.setDate(d.getDate()+1); goDate(d.toLocaleDateString('sv-SE')); };
$('#dToday').onclick=()=>goDate(today());
$('#dDate').onchange=e=>{ if(e.target.value) goDate(e.target.value); };

$('#view').addEventListener('click',e=>{
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
  const tw=el.closest('.trow[data-m]');
  if(tw&&el.dataset.k){ const m=S.template.find(x=>x.id===tw.dataset.m), k=el.dataset.k;
    if(k==='name') m.name=el.value; else m.t[k]=+el.value||0;
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
  SESSION=sess;
  if(SESSION){
    adoptCache();
    setStatus('wait');
    try{ await cloudPull(); }catch(e){ setStatus('wait'); toast('Could not reach the server — continuing with the local copy.'); }
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
