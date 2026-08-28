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
    profile:defaultProfile(),
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
const perUnit=f=> f.b==='100g' ? {p:f.p/100,c:f.c/100,f:f.f/100,k:f.k/100,fib:(f.fib||0)/100}
                              : {p:f.p,c:f.c,f:f.f,k:f.k,fib:(f.fib||0)};
function itemMacros(it){ const f=F(it.fid); if(!f) return {p:0,c:0,f:0,k:0,fib:0}; const u=perUnit(f), q=+it.q||0;
  return {p:u.p*q,c:u.c*q,f:u.f*q,k:u.k*q,fib:u.fib*q}; }
function mealTotals(mid){ const t={p:0,c:0,f:0,k:0,fib:0};
  items(mid).forEach(it=>{const x=itemMacros(it);t.p+=x.p;t.c+=x.c;t.f+=x.f;t.k+=x.k;t.fib+=x.fib;}); return t; }
const targetKcal=t=>t.p*4+t.c*4+t.f*9;
function dayTotals(){ const a={p:0,c:0,f:0,k:0,fib:0},b={p:0,c:0,f:0,k:0};
  S.template.forEach(m=>{const t=mealTotals(m.id); a.p+=t.p;a.c+=t.c;a.f+=t.f;a.k+=t.k;a.fib+=t.fib;
    b.p+=m.t.p;b.c+=m.t.c;b.f+=m.t.f;b.k+=targetKcal(m.t);}); return {act:a,tgt:b}; }
// daily target derived from calories + macro split
function dailyGrams(){ const d=S.daily, k=+d.kcal||0;
  return {p:k*(d.split.p/100)/4, c:k*(d.split.c/100)/4, f:k*(d.split.f/100)/9, k}; }
function allocated(){ const a={p:0,c:0,f:0,k:0};
  S.template.forEach(m=>{a.p+=m.t.p;a.c+=m.t.c;a.f+=m.t.f;a.k+=targetKcal(m.t);}); return a; }
// Calories are the budget. Move one macro and the other two give way,
// keeping their ratio to each other, so the split always adds up to 100%.
function setSplitBalanced(key,pct){ S.daily.split=balance(S.daily.split,key,pct); }
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
// Calories must agree with the macros: 4 kcal/g protein and carbs, 9 kcal/g fat.
// Real labels round and use slightly different factors, so allow some slack.
const calcKcal=f=>(+f.p||0)*4+(+f.c||0)*4+(+f.f||0)*9;
function kcalCheck(f){
  const want=calcKcal(f), got=+f.k||0, diff=got-want;
  if(want<=0) return {want,diff,level:got>0?'bad':'ok'};
  const rel=Math.abs(diff)/want;
  if(rel<=0.12||Math.abs(diff)<=12) return {want,diff,level:'ok'};
  return {want,diff,level:rel>0.25?'bad':'warn'};
}
// Split one macro against the other two so the three always total 100%.
function balance(split,key,pct){
  const keys=['p','c','f'], others=keys.filter(k=>k!==key);
  const v=Math.min(100,Math.max(0,+pct||0)), rest=100-v;
  const restNow=others.reduce((t,k)=>t+split[k],0);
  const next={p:split.p,c:split.c,f:split.f}; next[key]=v;
  if(restNow>0) others.forEach(k=>next[k]=split[k]/restNow*rest);
  else others.forEach(k=>next[k]=rest/2);
  keys.forEach(k=>next[k]=r1(Math.max(0,next[k])));
  const drift=r1(100-(next.p+next.c+next.f));
  if(drift!==0){ const big=next[others[0]]>=next[others[1]]?others[0]:others[1];
    next[big]=r1(Math.max(0,next[big]+drift)); }
  return next;
}
const gramsFrom=(kcal,sp)=>({p:kcal*(sp.p/100)/4, c:kcal*(sp.c/100)/4, f:kcal*(sp.f/100)/9, k:kcal});
const splitOf=t=>{ const k=t.p*4+t.c*4+t.f*9; return k<=0?{p:40,c:35,f:25}
  :{p:r1(t.p*4/k*100), c:r1(t.c*4/k*100), f:r1(t.f*9/k*100)}; };
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

/* ---------------- i18n ---------------- */
let LANG = (()=>{ try{ return localStorage.getItem('minumeal:lang')||'en'; }catch(e){ return 'en'; } })();
let ACTIVE_WIZARD_PAINT = null;   // set while the onboarding wizard is open, so switching language repaints it live
function setLang(l){ LANG=l; try{ localStorage.setItem('minumeal:lang',l); }catch(e){} paintLangBtn(); render(); if(ACTIVE_WIZARD_PAINT) ACTIVE_WIZARD_PAINT(); }
function paintLangBtn(){
  document.querySelectorAll('#langToggle button').forEach(b=>b.classList.toggle('on', b.dataset.l===LANG));
}
// Static UI text: t('exact English string') looks up RU, falls back to the English key itself.
const RU = {
  'Sign in':'Войти','Local mode':'Локальный режим','Account':'Аккаунт',
  'Plan':'План','Foods':'Продукты','Targets':'Цели','Saved':'Сохранённое',
  'Share plan':'Поделиться планом','Back up':'Резервная копия',
  'previous day':'предыдущий день','next day':'следующий день','Today':'Сегодня',
  'today':'сегодня','yesterday':'вчера','tomorrow':'завтра',
  'Calories':'Калории','Protein':'Белки','Carbs':'Углеводы','Fat':'Жиры','Fiber':'Клетчатка',
  "Today's plan":'План на сегодня','Fill the whole day':'Заполнить весь день',
  'Same as yesterday':'Как вчера','Share':'Поделиться','Copy as text':'Копировать как текст',
  'Build…':'Собрать…','Auto-fill':'Автозаполнение','Another option':'Другой вариант',
  'Shuffle':'Перемешать','Save':'Сохранить','Clear':'Очистить',
  'Empty — add something below or fill it automatically.':'Пусто — добавьте продукт ниже или заполните автоматически.',
  '+ add food…':'+ добавить продукт…','decrease':'уменьшить','increase':'увеличить',
  'Locked':'Закреплено','Lock':'Закрепить','Remove':'Удалить',
  'Food list':'Список продуктов','entries':'записей','shared kitchen':'общая кухня',
  'Values are per':'Значения указаны на','100 g':'100 г','1 piece/scoop':'1 шт./мерную ложку',
  'is the portion range the generator may use; unchecking':'— диапазон порций, который может использовать генератор; если снять галочку',
  'Search…':'Поиск…','Add food':'Добавить продукт',
  'Food':'Продукт','Unit':'Единица','piece/scoop':'шт./ложка',
  'Role':'Роль','Min':'Мин','Max':'Макс','Use':'Учитывать',
  'No food matches that search.':'Ничего не найдено.',
  'Edit':'Изменить','Delete':'Удалить',
  'protein':'белок','carb':'углевод','fat':'жир','veg':'овощ',
  'Daily target':'Дневная цель','% of calories':'% от калорий','grams':'граммы',
  'kcal per day':'ккал в день',
  'The split adds up to':'Сумма долей —','instead of 100%, so the grams above will not match your calorie goal.':'а не 100%, поэтому граммы выше не совпадут с целью по калориям.',
  'Normalise to 100%':'Нормализовать до 100%',
  'Split across meals':'Распределение по приёмам пищи','% of daily':'% от дня',
  'Meal':'Приём пищи',
  'Allocated':'Распределено','protein ':'белок ','carbs':'углеводы','fat ':'жир ',
  'Fit meals to daily target':'Подогнать приёмы под дневную цель',
  'Add meal':'Добавить приём пищи','Reset everything':'Сбросить всё',
  'Delete meal':'Удалить приём пищи',
  'Saved combinations':'Сохранённые комбинации',
  'Nothing saved yet. Hit':'Пока ничего не сохранено. Нажмите','on a meal you like in the Plan tab.':'на понравившемся приёме пищи на вкладке «План».',
  'The foods in this combination were deleted from the list.':'Продукты из этой комбинации были удалены из списка.',
  'Load':'Загрузить',
  'Profile':'Профиль','Not set up yet. Answer a few questions and we will suggest daily calories and macros for you.':'Пока не настроено. Ответьте на несколько вопросов, и мы предложим дневные калории и БЖУ.',
  'Redo profile':'Заполнить заново','Set up profile':'Настроить профиль',
  'Male':'Мужской','Female':'Женский','goal: lose weight':'цель: снижение веса','goal: gain weight':'цель: набор веса','maintaining':'поддержание',
  'Last estimate':'Последний расчёт',
  'No server configured, so data stays in this browser only — sync and shared kitchen are off.':'Сервер не настроен, данные хранятся только в этом браузере — синхронизация и общая кухня отключены.',
  'To turn them on, create a Supabase project, run':'Чтобы включить их, создайте проект Supabase, выполните','and fill in the two lines in':'и заполните две строки в',
  'Data':'Данные','Download a copy of every target, day, food and saved combination.':'Скачать копию всех целей, дней, продуктов и сохранённых комбинаций.',
  'Signing in stores your plans on the server, so your phone and computer see the same data. You can also keep using the app signed out — everything then stays in this browser.':'Вход сохраняет ваши планы на сервере, поэтому телефон и компьютер видят одни и те же данные. Можно пользоваться и без входа — тогда всё останется в этом браузере.',
  'Email':'Email','Password':'Пароль','Create account':'Создать аккаунт','Forgot password?':'Забыли пароль?',
  'Email and password are required.':'Введите email и пароль.',
  'Account created. Click the confirmation link in your email, then sign in.':'Аккаунт создан. Перейдите по ссылке в письме и затем войдите.',
  'Signed in as':'Вход выполнен как','Kitchen name':'Название кухни','My kitchen':'Моя кухня','Sign out':'Выйти',
  'Shared kitchen':'Общая кухня','Your invite code':'Ваш код приглашения','copy':'копировать',
  'Give this code to a friend and you will share the same food list and saved combinations. Daily plans stay private to each person.':'Дайте этот код другу — вы будете делиться списком продуктов и сохранёнными комбинациями. Планы на день у каждого свои.',
  'Join another kitchen':'Присоединиться к другой кухне','6-character code':'код из 6 символов',
  "Joining deletes your kitchen's food list and replaces it with theirs. Back up first.":'При присоединении список продуктов вашей кухни будет удалён и заменён их списком. Сначала сделайте резервную копию.',
  'Join':'Присоединиться',
  'What are you working towards?':'К чему вы стремитесь?',
  'Lose weight':'Похудеть','Maintain':'Поддерживать вес','Gain weight':'Набрать вес',
  'Target weight (kg)':'Целевой вес (кг)','— optional':'— необязательно',
  'In how many weeks?':'За сколько недель?',
  'Give both and we work out the pace directly from them (using ~7700 kcal per kg). Leave either blank and you pick a pace instead:':'Заполните оба поля — и мы рассчитаем темп напрямую (используя ~7700 ккал на кг). Оставьте пустыми — выберите темп сами:',
  'Pace':'Темп','Gentle':'Мягкий','Steady':'Умеренный','Standard':'Стандартный','Faster':'Быстрый',
  'A bit about you':'Немного о вас',
  'Age':'Возраст','Height cm':'Рост, см','Weight kg':'Вес, кг',
  'Daily activity':'Дневная активность','(job / general movement)':'(работа / общая активность)',
  'Sedentary':'Малоподвижный','Active':'Активный','Very active':'Очень активный',
  'Workouts per week':'Тренировок в неделю','days':'дней',
  'Protein target':'Цель по белку','Normal':'Средний','High':'Высокий','Very high':'Очень высокий',
  'Fat target':'Цель по жирам','Minimum':'Минимум','Low':'Низкий',
  'Your estimated targets':'Ваши расчётные цели','Estimated daily target':'Расчётная дневная цель',
  'no adjustment':'без корректировки','deficit':'дефицит','surplus':'профицит',
  'g fiber/day':'г клетчатки/день','maintenance':'поддержание',
  '% of calories':'% от калорий','grams':'граммы','from the macros':'из БЖУ','kcal for this meal':'ккал на этот приём',
  'No profile row — did schema.sql run?':'Нет строки профиля — выполнялся ли schema.sql?',
  'This is a starting point from standard formulas, not medical advice. Apply it and adjust anything in Targets afterwards — or skip and set numbers yourself.':'Это отправная точка по стандартным формулам, а не медицинская рекомендация. Примените и при желании скорректируйте на вкладке «Цели» — или пропустите и задайте цифры сами.',
  'Fill in age, height and weight to continue.':'Укажите возраст, рост и вес, чтобы продолжить.',
  'Back':'Назад','Skip':'Пропустить','Next':'Далее','Apply to my plan':'Применить к моему плану','Start over':'Начать заново',
  'Your goal':'Ваша цель','About you':'О вас','Your targets':'Ваши цели',
  'Name':'Название','Chicken breast':'Куриная грудка',
  'Values are given per':'Значения указаны на',
  'piece, scoop, slice…':'шт., ложка, ломтик…',
  'Protein g':'Белки, г','Carbs g':'Углеводы, г','Fat g':'Жиры, г','Fiber g':'Клетчатка, г',
  'calculate':'рассчитать','Give the food a name.':'Введите название продукта.',
  'Enter at least one macro.':'Введите хотя бы один макронутриент.',
  'Edit food':'Изменить продукт','New food':'Новый продукт','Cancel':'Отмена','OK':'ОК','Yes':'Да',
  'Target for this meal':'Цель для этого приёма','Any':'Любой','source':'источник',
  'Protein source':'Источник белка','Carb source':'Источник углеводов','Fat source':'Источник жиров',
  'Extra (optional)':'Дополнительно (необязательно)',
  'Leave a source on “Any” and the generator picks one. Portions are solved to land on the target; they snap to each food’s step size, so expect a percent or two of drift.':'Оставьте «Любой» — и генератор выберет сам. Порции подбираются под цель и округляются до шага продукта, так что возможно небольшое отклонение.',
  'Build':'Собрать',
  'Copied to clipboard':'Скопировано в буфер обмена','kcal':'ккал','g':'г','cm':'см','kg':'кг',
  'Macros work out to':'По макросам получается','or per':'или на','1 piece/scoop':'1 шт./ложку',
  'keeps a food out of suggestions.':'исключает продукт из подборок.',
  'This list is shared with everyone in your kitchen — edits reach them right away.':'Список общий для всей кухни — изменения видны сразу всем.',
  'Copy failed — select the text manually.':'Не удалось скопировать — выделите текст вручную.',
  'This meal has no target yet — set one on the Targets tab.':'У этого приёма пока нет цели — задайте её на вкладке «Цели».',
  'No suitable foods found.':'Подходящих продуктов не найдено.',
  'Could not build from those sources.':'Не удалось собрать из этих продуктов.',
  'Fill the meal first.':'Сначала заполните приём пищи.',
  'Save combination':'Сохранить комбинацию',
  'Could not save — no connection':'Не удалось сохранить — нет соединения',
  'Saved':'Сохранено',
  'Delete food':'Удалить продукт',
  'will be removed from the list and from every meal using it.':'будет удалён из списка и из всех приёмов пищи, где используется.',
  'and its targets will be deleted.':'и его цели будут удалены.',
  'Loaded':'Загружено',
  'Could not add — no connection':'Не удалось добавить — нет соединения','Food added':'Продукт добавлен',
  "Targets, today's plan and the food list all go back to their starting state.":'Цели, план на сегодня и список продуктов вернутся к исходному состоянию.',
  'Reset':'Сбросить',
  'Day filled':'День заполнен',
  'No plan saved for yesterday.':'За вчера план не сохранён.',
  "Yesterday's plan copied":'План вчерашнего дня скопирован',
  'Split normalised to 100%':'Доли нормализованы до 100%',
  'Meal targets scaled to the daily total':'Цели приёмов пищи подогнаны под дневную сумму',
  'New meal':'Новый приём пищи',
  'Share plan':'Поделиться планом',
  "This link carries the day's plan and targets — whoever opens it sees the same plan in their own Food's Up.":'Эта ссылка содержит план и цели дня — тот, кто её откроет, увидит тот же план в своём Food\'s Up.',
  'Close':'Закрыть','Copy link':'Копировать ссылку',
  'Every target, day, food and saved combination.':'Все цели, дни, продукты и сохранённые комбинации.',
  'Copy':'Копировать','Download':'Скачать','Backup downloaded':'Резервная копия скачана',
  'Download blocked — you can copy the text instead.':'Скачивание заблокировано — можно скопировать текст.',
  'Could not rename the kitchen':'Не удалось переименовать кухню','Kitchen renamed':'Кухня переименована',
  'Targets updated from your profile':'Цели обновлены на основе вашего профиля',
  'Reset password':'Сброс пароля','Enter your email':'Введите email',
  'has an account, a reset link is on its way — check your inbox.':'— если такой аккаунт есть, ссылка для сброса уже отправлена, проверьте почту.',
  'Join kitchen':'Присоединиться к кухне',
  'Your own food list will be deleted and replaced with theirs. Continue?':'Ваш список продуктов будет удалён и заменён их списком. Продолжить?',
  'Joined':'Готово, вы присоединились',
  'Set a new password':'Новый пароль',
  'Choose a new password for your account.':'Выберите новый пароль для вашего аккаунта.',
  'New password':'Новый пароль','Confirm password':'Подтвердите пароль',
  'Password must be at least 6 characters':'Пароль должен быть не менее 6 символов',
  'Passwords do not match':'Пароли не совпадают','Password updated':'Пароль обновлён',
  'Could not reach the server — continuing with the local copy.':'Не удалось связаться с сервером — продолжаем с локальной копией.',
  'Signed in':'Вход выполнен',
  'Shared plan':'Общий план',
  "Someone shared a Food's Up plan. Load it? It replaces today's plan and your targets.":'Кто-то поделился планом Food\'s Up. Загрузить? Он заменит план на сегодня и ваши цели.',
  'Shared plan loaded':'Общий план загружен',
  'Synced':'Синхронизировано','Changes pending':'Ожидает синхронизации','Offline':'Офлайн',
  'Calories are the budget: raise one macro and the other two give way to keep the split at 100%. Below, set each meal in grams, as a share of the day, or straight in calories — typing calories rescales that meal and keeps its own macro balance.':'Калории — это бюджет: увеличивая одну долю, вы уменьшаете две другие, чтобы сумма всегда была 100%. Ниже задайте каждый приём пищи в граммах, в процентах от дня или сразу в калориях — ввод калорий пересчитывает этот приём, сохраняя его баланс БЖУ.',
};
const AR = {
  "Sign in":"تسجيل الدخول",
  "Local mode":"وضع محلي",
  "Account":"الحساب",
  "Plan":"الخطة",
  "Foods":"الأطعمة",
  "Targets":"الأهداف",
  "Saved":"تم الحفظ",
  "Share plan":"مشاركة الخطة",
  "Back up":"نسخة احتياطية",
  "previous day":"اليوم السابق",
  "next day":"اليوم التالي",
  "Today":"اليوم",
  "today":"اليوم",
  "yesterday":"أمس",
  "tomorrow":"غدًا",
  "Calories":"السعرات الحرارية",
  "Protein":"البروتين",
  "Carbs":"الكربوهيدرات",
  "Fat":"الدهون",
  "Fiber":"الألياف",
  "Today's plan":"خطة اليوم",
  "Fill the whole day":"تعبئة اليوم بالكامل",
  "Same as yesterday":"مثل الأمس",
  "Share":"مشاركة",
  "Copy as text":"نسخ كنص",
  "Build…":"إنشاء…",
  "Auto-fill":"تعبئة تلقائية",
  "Another option":"خيار آخر",
  "Shuffle":"خلط",
  "Save":"حفظ",
  "Clear":"مسح",
  "Empty — add something below or fill it automatically.":"فارغ — أضف شيئًا أدناه أو املأه تلقائيًا.",
  "+ add food…":"+ إضافة طعام…",
  "decrease":"إنقاص",
  "increase":"زيادة",
  "Locked":"مثبّت",
  "Lock":"تثبيت",
  "Remove":"إزالة",
  "Food list":"قائمة الأطعمة",
  "entries":"عنصرًا",
  "shared kitchen":"مطبخ مشترك",
  "Values are per":"القيم لكل",
  "100 g":"100 جرام",
  "1 piece/scoop":"قطعة/مغرفة واحدة",
  "is the portion range the generator may use; unchecking":"هو نطاق الحصص الذي قد يستخدمه المولّد؛ وإلغاء تحديد",
  "Search…":"بحث…",
  "Add food":"إضافة طعام",
  "Food":"الطعام",
  "Unit":"الوحدة",
  "piece/scoop":"قطعة/مغرفة",
  "Role":"الدور",
  "Min":"الأدنى",
  "Max":"الأقصى",
  "Use":"استخدام",
  "No food matches that search.":"لا يوجد طعام مطابق لهذا البحث.",
  "Edit":"تعديل",
  "Delete":"حذف",
  "protein":"بروتين",
  "carb":"كربوهيدرات",
  "fat":"دهون",
  "veg":"خضار",
  "Daily target":"الهدف اليومي",
  "% of calories":"% من السعرات",
  "grams":"جرامات",
  "kcal per day":"سعرة حرارية يوميًا",
  "The split adds up to":"مجموع النسب هو",
  "instead of 100%, so the grams above will not match your calorie goal.":"بدلًا من 100%، لذا لن تتطابق الجرامات أعلاه مع هدف السعرات الخاص بك.",
  "Normalise to 100%":"ضبط إلى 100%",
  "Split across meals":"التوزيع على الوجبات",
  "% of daily":"% من اليوم",
  "Meal":"الوجبة",
  "Allocated":"الموزَّع",
  "protein ":"بروتين ",
  "carbs":"كربوهيدرات",
  "fat ":"دهون ",
  "Fit meals to daily target":"ضبط الوجبات على الهدف اليومي",
  "Add meal":"إضافة وجبة",
  "Reset everything":"إعادة ضبط كل شيء",
  "Delete meal":"حذف الوجبة",
  "Saved combinations":"التركيبات المحفوظة",
  "Nothing saved yet. Hit":"لا شيء محفوظ بعد. اضغط",
  "on a meal you like in the Plan tab.":"على وجبة تعجبك في تبويب الخطة.",
  "The foods in this combination were deleted from the list.":"تم حذف الأطعمة في هذه التركيبة من القائمة.",
  "Load":"تحميل",
  "Profile":"الملف الشخصي",
  "Not set up yet. Answer a few questions and we will suggest daily calories and macros for you.":"لم يتم إعداده بعد. أجب عن بضعة أسئلة وسنقترح لك السعرات والعناصر الغذائية اليومية.",
  "Redo profile":"إعادة تعبئة الملف الشخصي",
  "Set up profile":"إعداد الملف الشخصي",
  "Male":"ذكر",
  "Female":"أنثى",
  "goal: lose weight":"الهدف: إنقاص الوزن",
  "goal: gain weight":"الهدف: زيادة الوزن",
  "maintaining":"الحفاظ على الوزن",
  "Last estimate":"آخر تقدير",
  "No server configured, so data stays in this browser only — sync and shared kitchen are off.":"لم يتم إعداد خادم، لذا تبقى البيانات في هذا المتصفح فقط — المزامنة والمطبخ المشترك متوقفان.",
  "To turn them on, create a Supabase project, run":"لتفعيلهما، أنشئ مشروع Supabase، ونفّذ",
  "and fill in the two lines in":"واملأ السطرين في",
  "Data":"البيانات",
  "Download a copy of every target, day, food and saved combination.":"تنزيل نسخة من كل هدف ويوم وطعام وتركيبة محفوظة.",
  "Signing in stores your plans on the server, so your phone and computer see the same data. You can also keep using the app signed out — everything then stays in this browser.":"يؤدي تسجيل الدخول إلى حفظ خططك على الخادم، لذا يرى هاتفك وحاسوبك البيانات نفسها. يمكنك أيضًا الاستمرار في استخدام التطبيق دون تسجيل دخول — عندها يبقى كل شيء في هذا المتصفح.",
  "Email":"البريد الإلكتروني",
  "Password":"كلمة المرور",
  "Create account":"إنشاء حساب",
  "Forgot password?":"هل نسيت كلمة المرور؟",
  "Email and password are required.":"البريد الإلكتروني وكلمة المرور مطلوبان.",
  "Account created. Click the confirmation link in your email, then sign in.":"تم إنشاء الحساب. انقر على رابط التأكيد في بريدك الإلكتروني، ثم سجّل الدخول.",
  "Signed in as":"تم تسجيل الدخول باسم",
  "Kitchen name":"اسم المطبخ",
  "My kitchen":"مطبخي",
  "Sign out":"تسجيل الخروج",
  "Shared kitchen":"مطبخ مشترك",
  "Your invite code":"رمز الدعوة الخاص بك",
  "copy":"نسخ",
  "Give this code to a friend and you will share the same food list and saved combinations. Daily plans stay private to each person.":"أعطِ هذا الرمز لصديق وستشاركان قائمة الأطعمة نفسها والتركيبات المحفوظة. تبقى الخطط اليومية خاصة بكل شخص.",
  "Join another kitchen":"الانضمام إلى مطبخ آخر",
  "6-character code":"رمز من 6 أحرف",
  "Joining deletes your kitchen's food list and replaces it with theirs. Back up first.":"الانضمام يحذف قائمة أطعمة مطبخك ويستبدلها بقائمتهم. خذ نسخة احتياطية أولًا.",
  "Join":"انضمام",
  "What are you working towards?":"ما هو هدفك؟",
  "Lose weight":"إنقاص الوزن",
  "Maintain":"الحفاظ على الوزن",
  "Gain weight":"زيادة الوزن",
  "Target weight (kg)":"الوزن المستهدف (كجم)",
  "— optional":"— اختياري",
  "In how many weeks?":"خلال كم أسبوعًا؟",
  "Give both and we work out the pace directly from them (using ~7700 kcal per kg). Leave either blank and you pick a pace instead:":"أدخل كليهما وسنحسب الوتيرة مباشرة منهما (باستخدام ~7700 سعرة حرارية لكل كجم). اترك أحدهما فارغًا وستختار وتيرة بدلًا من ذلك:",
  "Pace":"الوتيرة",
  "Gentle":"لطيفة",
  "Steady":"ثابتة",
  "Standard":"قياسية",
  "Faster":"أسرع",
  "A bit about you":"القليل عنك",
  "Age":"العمر",
  "Height cm":"الطول (سم)",
  "Weight kg":"الوزن (كجم)",
  "Daily activity":"النشاط اليومي",
  "(job / general movement)":"(العمل / الحركة العامة)",
  "Sedentary":"قليل الحركة",
  "Active":"نشيط",
  "Very active":"نشيط جدًا",
  "Workouts per week":"التمارين أسبوعيًا",
  "days":"أيام",
  "Protein target":"هدف البروتين",
  "Normal":"عادي",
  "High":"مرتفع",
  "Very high":"مرتفع جدًا",
  "Fat target":"هدف الدهون",
  "Minimum":"الحد الأدنى",
  "Low":"منخفض",
  "Your estimated targets":"أهدافك المقدَّرة",
  "Estimated daily target":"الهدف اليومي المقدَّر",
  "no adjustment":"بلا تعديل",
  "deficit":"عجز",
  "surplus":"فائض",
  "g fiber/day":"جرام ألياف/يوم",
  "maintenance":"الحفاظ على الوزن",
  "from the macros":"من العناصر الغذائية",
  "kcal for this meal":"سعرة حرارية لهذه الوجبة",
  "No profile row — did schema.sql run?":"لا يوجد صف ملف شخصي — هل تم تنفيذ schema.sql؟",
  "This is a starting point from standard formulas, not medical advice. Apply it and adjust anything in Targets afterwards — or skip and set numbers yourself.":"هذه نقطة بداية من معادلات قياسية، وليست نصيحة طبية. طبّقها وعدّل أي شيء لاحقًا في الأهداف — أو تخطَّ ذلك وحدّد الأرقام بنفسك.",
  "Fill in age, height and weight to continue.":"أدخل العمر والطول والوزن للمتابعة.",
  "Back":"رجوع",
  "Skip":"تخطٍّ",
  "Next":"التالي",
  "Apply to my plan":"تطبيق على خطتي",
  "Start over":"البدء من جديد",
  "Your goal":"هدفك",
  "About you":"عنك",
  "Your targets":"أهدافك",
  "Name":"الاسم",
  "Chicken breast":"صدر دجاج",
  "Values are given per":"القيم مُعطاة لكل",
  "piece, scoop, slice…":"قطعة، مغرفة، شريحة…",
  "Protein g":"بروتين (جرام)",
  "Carbs g":"كربوهيدرات (جرام)",
  "Fat g":"دهون (جرام)",
  "Fiber g":"ألياف (جرام)",
  "calculate":"حساب",
  "Give the food a name.":"أعطِ الطعام اسمًا.",
  "Enter at least one macro.":"أدخل عنصرًا غذائيًا واحدًا على الأقل.",
  "Edit food":"تعديل الطعام",
  "New food":"طعام جديد",
  "Cancel":"إلغاء",
  "OK":"موافق",
  "Yes":"نعم",
  "Target for this meal":"الهدف لهذه الوجبة",
  "Any":"أي",
  "source":"مصدر",
  "Protein source":"مصدر البروتين",
  "Carb source":"مصدر الكربوهيدرات",
  "Fat source":"مصدر الدهون",
  "Extra (optional)":"إضافي (اختياري)",
  "Leave a source on “Any” and the generator picks one. Portions are solved to land on the target; they snap to each food’s step size, so expect a percent or two of drift.":"اترك مصدرًا على \"أي\" وسيختار المولّد واحدًا. تُحسب الحصص للوصول إلى الهدف، وتُقرَّب حسب خطوة كل طعام، لذا توقّع فارقًا بسيطًا لا يتجاوز نسبة مئوية أو اثنتين.",
  "Build":"إنشاء",
  "Copied to clipboard":"تم النسخ إلى الحافظة",
  "kcal":"سعرة حرارية",
  "g":"جم",
  "cm":"سم",
  "kg":"كجم",
  "Macros work out to":"تُحسب العناصر الغذائية إلى",
  "or per":"أو لكل",
  "keeps a food out of suggestions.":"يستبعد الطعام من الاقتراحات.",
  "This list is shared with everyone in your kitchen — edits reach them right away.":"هذه القائمة مشتركة مع الجميع في مطبخك — تصل التعديلات إليهم فورًا.",
  "Copy failed — select the text manually.":"فشل النسخ — حدّد النص يدويًا.",
  "This meal has no target yet — set one on the Targets tab.":"لا يوجد هدف لهذه الوجبة بعد — حدّد واحدًا في تبويب الأهداف.",
  "No suitable foods found.":"لم يتم العثور على أطعمة مناسبة.",
  "Could not build from those sources.":"تعذّر الإنشاء من هذه المصادر.",
  "Fill the meal first.":"املأ الوجبة أولًا.",
  "Save combination":"حفظ التركيبة",
  "Could not save — no connection":"تعذّر الحفظ — لا يوجد اتصال",
  "Delete food":"حذف الطعام",
  "will be removed from the list and from every meal using it.":"سيتم إزالته من القائمة ومن كل وجبة تستخدمه.",
  "and its targets will be deleted.":"وستُحذف أهدافها.",
  "Loaded":"تم التحميل",
  "Could not add — no connection":"تعذّرت الإضافة — لا يوجد اتصال",
  "Food added":"تمت إضافة الطعام",
  "Targets, today's plan and the food list all go back to their starting state.":"ستعود الأهداف وخطة اليوم وقائمة الأطعمة جميعها إلى حالتها الأولية.",
  "Reset":"إعادة ضبط",
  "Day filled":"تم ملء اليوم",
  "No plan saved for yesterday.":"لا توجد خطة محفوظة للأمس.",
  "Yesterday's plan copied":"تم نسخ خطة الأمس",
  "Split normalised to 100%":"تم ضبط النسب إلى 100%",
  "Meal targets scaled to the daily total":"تم تعديل أهداف الوجبات وفق المجموع اليومي",
  "New meal":"وجبة جديدة",
  "This link carries the day's plan and targets — whoever opens it sees the same plan in their own Food's Up.":"يحمل هذا الرابط خطة اليوم وأهدافه — ومن يفتحه يرى الخطة نفسها في تطبيق Food's Up الخاص به.",
  "Close":"إغلاق",
  "Copy link":"نسخ الرابط",
  "Every target, day, food and saved combination.":"كل هدف ويوم وطعام وتركيبة محفوظة.",
  "Copy":"نسخ",
  "Download":"تنزيل",
  "Backup downloaded":"تم تنزيل النسخة الاحتياطية",
  "Download blocked — you can copy the text instead.":"تم حظر التنزيل — يمكنك نسخ النص بدلًا من ذلك.",
  "Could not rename the kitchen":"تعذّرت إعادة تسمية المطبخ",
  "Kitchen renamed":"تمت إعادة تسمية المطبخ",
  "Targets updated from your profile":"تم تحديث الأهداف من ملفك الشخصي",
  "Reset password":"إعادة تعيين كلمة المرور",
  "Enter your email":"أدخل بريدك الإلكتروني",
  "has an account, a reset link is on its way — check your inbox.":"إن كان لديه حساب، فرابط إعادة التعيين في طريقه — تحقّق من بريدك.",
  "Join kitchen":"الانضمام إلى المطبخ",
  "Your own food list will be deleted and replaced with theirs. Continue?":"سيتم حذف قائمة أطعمتك واستبدالها بقائمتهم. المتابعة؟",
  "Joined":"تم الانضمام",
  "Set a new password":"تعيين كلمة مرور جديدة",
  "Choose a new password for your account.":"اختر كلمة مرور جديدة لحسابك.",
  "New password":"كلمة المرور الجديدة",
  "Confirm password":"تأكيد كلمة المرور",
  "Password must be at least 6 characters":"يجب أن تتكون كلمة المرور من 6 أحرف على الأقل",
  "Passwords do not match":"كلمتا المرور غير متطابقتين",
  "Password updated":"تم تحديث كلمة المرور",
  "Could not reach the server — continuing with the local copy.":"تعذّر الوصول إلى الخادم — المتابعة بالنسخة المحلية.",
  "Signed in":"تم تسجيل الدخول",
  "Shared plan":"خطة مشتركة",
  "Someone shared a Food's Up plan. Load it? It replaces today's plan and your targets.":"شارك أحدهم خطة Food's Up. هل تريد تحميلها؟ ستحل محل خطة اليوم وأهدافك.",
  "Shared plan loaded":"تم تحميل الخطة المشتركة",
  "Synced":"تمت المزامنة",
  "Changes pending":"تغييرات معلَّقة",
  "Offline":"غير متصل",
  "Calories are the budget: raise one macro and the other two give way to keep the split at 100%. Below, set each meal in grams, as a share of the day, or straight in calories — typing calories rescales that meal and keeps its own macro balance.":"السعرات الحرارية هي الميزانية: عند زيادة أحد العناصر الغذائية، يتراجع العنصران الآخران للحفاظ على مجموع 100%. أدناه، حدّد كل وجبة بالجرام، أو كنسبة من اليوم، أو مباشرة بالسعرات — كتابة السعرات تعيد ضبط تلك الوجبة مع الحفاظ على توازن عناصرها الغذائية.",
};
function t(key){ const d=LANG==='ru'?RU:LANG==='ar'?AR:null; return d?(d[key]||key):key; }



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
  const label = SESSION ? (SESSION.user.email||t('Account'))
              : (sb ? t('Sign in') : t('Local mode'));
  el.title = SESSION ? ({ok:t('Synced'),wait:t('Changes pending'),local:t('Offline')}[status]) : label;
  $('#acctTxt').textContent = label.length>22 ? label.slice(0,20)+'…' : label;
}


/* ---------------------------------------------------------------- body profile calculator
   Reverse-engineered from one worked example in the user's spreadsheet
   (30yo male, 76kg, 172cm, Sedentary + 4-6 workouts/week, Weight loss / Low,
   protein Very High, fat Low -> 1690 BMR, 2011 kcal, 198p/57f/177c, 36 fiber).
   Every formula below reproduces that example exactly. The tiers that example
   did not exercise (Active/Very Active, other workout counts, other protein/
   fat/pace levels) are reasonable industry-standard estimates, not verified
   against the sheet — check BIO_TABLES below if a number looks off; it is
   the only place this logic lives. */
const BIO_TABLES = {
  // BMR x this = daily maintenance calories (TDEE)
  activityMult: {
    sedentary:  {'0':1.2, '1-3':1.3, '4-6':1.4, '7+':1.5},   // verified: sedentary + 4-6 = 1.4
    active:     {'0':1.3, '1-3':1.4, '4-6':1.5, '7+':1.6},
    veryactive: {'0':1.4, '1-3':1.5, '4-6':1.6, '7+':1.7},
  },
  proteinPerKg: {normal:1.6, high:2.2, veryhigh:2.6},        // verified: veryhigh = 2.6
  fatPerKg:     {minimum:0.5, low:0.75, normal:1.0, high:1.3}, // verified: low = 0.75
  pacePct:      {verylow:0.10, low:0.15, normal:0.20, high:0.25}, // verified: low = 0.15
  fiberPer1000: 18,                                          // verified
  kcalPerKgFat: 7700,                                        // standard estimate, for the timeline option
};
function bmr(p){
  const base=10*p.weightKg+6.25*p.heightCm-5*p.age;
  return p.sex==='female'? base-161 : base+5;
}
function calcTargets(p){
  const b=bmr(p);
  const tdee=b*(BIO_TABLES.activityMult[p.activity]?.[p.workouts]??1.2);
  let pct;
  if(p.goal!=='maintain'&&p.weightKg>0&&p.targetWeightKg>0&&p.weeks>0){
    // timeline given -> derive the rate directly instead of a named tier
    const diff=Math.abs(p.weightKg-p.targetWeightKg);
    const dailyDelta=diff*BIO_TABLES.kcalPerKgFat/(p.weeks*7);
    pct=Math.min(0.28, dailyDelta/tdee);                     // clamp to a safe ceiling
  } else pct = BIO_TABLES.pacePct[p.pace] ?? 0.15;
  const kcal = p.goal==='lose' ? tdee*(1-pct) : p.goal==='gain' ? tdee*(1+pct) : tdee;
  const protein = p.weightKg*(BIO_TABLES.proteinPerKg[p.proteinLevel]??1.6);
  const fat = p.weightKg*(BIO_TABLES.fatPerKg[p.fatLevel]??1.0);
  const carbKcal = Math.max(0, kcal - protein*4 - fat*9);
  const carbs = carbKcal/4;
  const fiber = kcal/1000*BIO_TABLES.fiberPer1000;
  const k2=protein*4+carbs*4+fat*9;
  return { bmr:r0(b), tdee:r0(tdee), kcal:r0(kcal), fiber:r0(fiber), pct:r1(pct*100),
    split:{p:r1(protein*4/k2*100), c:r1(carbs*4/k2*100), f:r1(fat*9/k2*100)} };
}
function defaultProfile(){
  return {done:false, sex:'male', age:30, heightCm:170, weightKg:70, targetWeightKg:70, weeks:null,
    goal:'maintain', pace:'low', activity:'sedentary', workouts:'1-3', proteinLevel:'normal', fatLevel:'normal'};
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
function candidates(meal,{shuffle=false,must=[],target=null}={}){
  const cur=items(meal.id), locked=cur.filter(i=>i.lock&&F(i.fid));
  const base={p:0,c:0,f:0}; locked.forEach(i=>{const x=itemMacros(i);base.p+=x.p;base.c+=x.c;base.f+=x.f;});
  const goal=target||meal.t;
  const tgt={p:Math.max(0,goal.p-base.p),c:Math.max(0,goal.c-base.c),f:Math.max(0,goal.f-base.f)};
  if(tgt.p+tgt.c+tgt.f<=0) return [];
  const pool=S.foods.filter(f=>f.use&&!locked.some(l=>l.fid===f.id)&&!must.some(x=>x.id===f.id));
  if(!pool.length&&!must.length) return [];
  const byRole=r=>pool.filter(f=>f.role===r);
  const out=[],seen=new Set(),tries=shuffle?60:420;
  for(let t=0;t<tries;t++){
    const k=Math.max(must.length, 2+Math.floor(Math.random()*3));
    let set=[...must];
    const has=r=>set.some(f=>f.role===r);
    if(tgt.p>8&&!has('protein')) set.push(...pick(byRole('protein'),1));
    if(tgt.c>8&&!has('carb')) set.push(...pick(byRole('carb'),1));
    if(tgt.f>8&&!has('fat')) set.push(...pick(byRole('fat'),1));
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
  if(!list.length){ toast(m.t.p+m.t.c+m.t.f<=0?t('This meal has no target yet — set one on the Targets tab.'):t('No suitable foods found.')); return; }
  ALT[mid]={list,i:0}; applyCandidate(m,list[0]); touchDay(); render();
}
function nextAlt(mid){
  const a=ALT[mid]; if(!a||a.list.length<2){ generate(mid,'auto'); return; }
  a.i=(a.i+1)%a.list.length; applyCandidate(S.template.find(x=>x.id===mid),a.list[a.i]); touchDay(); render();
  toast(LANG==='ru'?`Вариант ${a.i+1} из ${a.list.length}`:`Option ${a.i+1} of ${a.list.length}`);
}

/* ---------------- sync ---------------- */
const fromRow=r=>({id:r.id,n:r.name,b:r.basis,u:r.unit,p:+r.p,c:+r.c,f:+r.f,k:+r.kcal,fib:+(r.fiber||0),mn:+r.mn,mx:+r.mx,st:+r.st,role:r.role,use:r.enabled});
const toRow=f=>({household_id:HH,name:f.n,basis:f.b,unit:f.u,p:f.p,c:f.c,f:f.f,kcal:f.k,fiber:f.fib||0,mn:f.mn,mx:f.mx,st:f.st,role:f.role,enabled:f.use,updated_at:new Date().toISOString()});

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
    const payload={v:3,template:S.template,daily:S.daily,mealUnit:S.mealUnit,profile:S.profile};
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
  if(!prof) throw new Error(t('No profile row — did schema.sql run?'));
  HH=prof.household_id;
  HOUSE=(await sb.from('households').select('*').eq('id',HH).maybeSingle()).data;

  const pm=prof.meals;
  if(Array.isArray(pm)&&pm.length) S.template=pm;                       // v1 shape
  else if(pm&&(pm.v===2||pm.v===3)){                                    // v2/v3 shape
    if(Array.isArray(pm.template)&&pm.template.length) S.template=pm.template;
    if(pm.daily) S.daily=pm.daily;
    if(pm.mealUnit) S.mealUnit=pm.mealUnit;
    if(pm.v===3&&pm.profile) S.profile=pm.profile;
  } else await sb.from('profiles').update(
      {meals:{v:3,template:S.template,daily:S.daily,mealUnit:S.mealUnit,profile:S.profile},updated_at:new Date().toISOString()}).eq('user_id',u);

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
  // upsert on (household_id, name): if this ever runs twice for the same kitchen
  // (race on first load, retried sync, etc.) it updates the existing row instead
  // of inserting a duplicate. Requires the unique constraint added in schema.sql.
  const {data,error}=await sb.from('foods').upsert(S.foods.map(toRow), {onConflict:'household_id,name'}).select();
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


/* ---------------- food dialog ---------------- */
const ROLE_LABEL={protein:'protein',carb:'carb',fat:'fat',veg:'veg'};
function guessRole(f){
  const tot=(f.p*4)+(f.c*4)+(f.f*9);
  if(tot<=0) return 'protein';
  if(f.b==='100g'&&calcKcal(f)<70) return 'veg';
  return Object.entries({protein:f.p*4/tot,carb:f.c*4/tot,fat:f.f*9/tot}).sort((a,b)=>b[1]-a[1])[0][0];
}
function defaultRange(f){
  if(f.b==='piece') return {mn:1,mx:8,st:1};
  if(calcKcal(f)>=450) return {mn:5,mx:80,st:5};
  if(calcKcal(f)<70)  return {mn:50,mx:400,st:10};
  return {mn:30,mx:350,st:10};
}
function foodDialog(existing){
  const f = existing ? {...existing} : {n:'',b:'100g',u:'g',p:0,c:0,f:0,fib:0,k:0,role:'',use:true};
  let autoKcal = !existing || kcalCheck(f).level==='ok';
  const num=(k,lab,step)=>`<label class="dfield"><span class="dlab">${t(lab)}</span>
    <input class="num" type="number" min="0" step="${step}" data-f="${k}" value="${f[k]||0}"></label>`;
  const body=`
    <div class="field"><label>${t('Name')}</label><input type="text" data-f="n" value="${esc(f.n)}" placeholder="${t('Chicken breast')}"></div>
    <div class="field"><label>${t('Values are given per')}</label>
      <div class="seg" data-basis>
        <button data-v="100g"${f.b==='100g'?' class="on"':''}>100 ${t('g')}</button>
        <button data-v="piece"${f.b==='piece'?' class="on"':''}>${t('1 piece/scoop')}</button>
      </div>
      <input type="text" data-f="u" value="${esc(f.u||'g')}" placeholder="${t('piece, scoop, slice…')}"
             style="margin-top:8px;display:${f.b==='piece'?'block':'none'}"></div>
    <div class="dgrid" style="margin-bottom:10px">
      ${num('p','Protein g',0.1)}${num('c','Carbs g',0.1)}${num('f','Fat g',0.1)}${num('fib','Fiber g',0.1)}
    </div>
    <div class="field" style="margin-bottom:6px"><label>${t('Calories')}</label>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="num" type="number" min="0" step="1" data-f="k" value="${f.k||0}" style="flex:1">
        <label class="hint" style="display:flex;gap:5px;align-items:center;white-space:nowrap">
          <input type="checkbox" data-auto${autoKcal?' checked':''} style="width:auto"> ${t('calculate')}</label>
      </div></div>
    <p class="hint" id="kMsg" style="margin:0"></p>`;
  const p=modal(existing?t('Edit food'):t('New food'),body,
    [{label:t('Cancel'),ghost:true,value:null},{label:t('Save'),solid:true,value:'save'}]);
  const host=$('#mBody'), saveBtn=()=>$('#mBtns').querySelector('[data-i="1"]');
  const get=k=>host.querySelector(`[data-f="${k}"]`);
  const read=()=>({n:get('n').value.trim(), b:host.querySelector('.seg button.on').dataset.v,
    u:get('u').value.trim()||'g', p:+get('p').value||0, c:+get('c').value||0,
    f:+get('f').value||0, fib:+get('fib').value||0, k:+get('k').value||0});
  function refresh(){
    const v=read(); if(v.b==='100g') v.u='g';
    if(autoKcal){ get('k').value=Math.round(calcKcal(v)); v.k=calcKcal(v); get('k').disabled=true; }
    else get('k').disabled=false;
    const chk=kcalCheck(v), msg=$('#kMsg'), btn=saveBtn();
    let text='', cls='hint';
    if(!v.n) text=t('Give the food a name.');
    else if(v.p+v.c+v.f<=0) text=t('Enter at least one macro.');
    else if(chk.level==='bad') text = LANG==='ru'
      ? `По этим макросам получается ${r0(chk.want)} ккал, а не ${r0(v.k)}. Проверьте цифры — 4 ккал на грамм белка и углеводов, 9 на грамм жира.`
      : `These macros work out to ${r0(chk.want)} kcal, not ${r0(v.k)}. Check the numbers — 4 kcal per gram of protein and carbs, 9 for fat.`;
    else if(chk.level==='warn') text = LANG==='ru'
      ? `Небольшое расхождение: по макросам ${r0(chk.want)} ккал. Это нормально, если так указано на этикетке.`
      : `Slightly off: the macros give ${r0(chk.want)} kcal. Fine if that is what the label says.`;
    else text = LANG==='ru'
      ? `${r0(calcKcal(v))} ккал из ${v.p}б + ${v.c}у + ${v.f}ж, на ${v.b==='100g'?'100 г':'1 '+v.u}.`
      : `${r0(calcKcal(v))} kcal from ${v.p}p + ${v.c}c + ${v.f}f, per ${v.b==='100g'?'100 g':'1 '+v.u}.`;
    if(chk.level==='bad'&&v.n&&v.p+v.c+v.f>0) cls='hint bad';
    msg.className=cls; msg.textContent=text;
    if(btn) btn.disabled = !v.n || v.p+v.c+v.f<=0 || chk.level==='bad';
  }
  host.addEventListener('input',refresh);
  host.addEventListener('change',e=>{ if(e.target.hasAttribute('data-auto')){ autoKcal=e.target.checked; refresh(); }});
  host.addEventListener('click',e=>{
    const b=e.target.closest('.seg button'); if(!b) return;
    host.querySelectorAll('.seg button').forEach(x=>x.classList.toggle('on',x===b));
    get('u').style.display = b.dataset.v==='piece'?'block':'none';
    if(b.dataset.v==='piece'&&get('u').value==='g') get('u').value='piece';
    refresh();
  });
  refresh();
  return p.then(v=>{
    if(v!=='save') return null;
    const out=read(); if(out.b==='100g') out.u='g';
    out.role = existing?.role || guessRole(out);
    Object.assign(out, existing?{mn:existing.mn,mx:existing.mx,st:existing.st}:defaultRange(out));
    out.use = existing?existing.use:true;
    out.id = existing?existing.id:uid();
    return out;
  });
}

/* ---------------- build a meal from chosen sources ---------------- */
function buildDialog(mid){
  const m=S.template.find(x=>x.id===mid);
  let kcal=Math.round(targetKcal(m.t))||600;
  let split=splitOf(m.t);
  let unit='g';                                  // 'g' = type grams, 'pct' = type percentages
  const opts=role=>['<option value="">'+t('Any')+' '+t(ROLE_LABEL[role])+' '+t('source')+'</option>'].concat(
    S.foods.filter(f=>f.role===role&&f.use).sort((a,b)=>a.n.localeCompare(b.n))
      .map(f=>`<option value="${f.id}">${esc(f.n)}</option>`)).join('');
  const body=`
    <div class="field"><label>${t('Target for this meal')}</label>
      <div class="seg" data-unit>
        <button data-v="g" class="on">${t('grams')}</button>
        <button data-v="pct">${t('% of calories')}</button>
      </div></div>
    <div class="dgrid" style="margin-bottom:4px">
      ${['p','c','f'].map((k,i)=>`<label class="dfield"><span class="dlab">
        <span class="dot d-${k}"></span>${t(['Protein','Carbs','Fat'][i])}</span>
        <input class="num" type="number" min="0" step="1" data-b="${k}">
        <span class="dsub" data-g="${k}"></span></label>`).join('')}
      <label class="dfield"><span class="dlab">${t('Calories')}</span>
        <input class="num" type="number" min="0" step="10" data-b="kcal" value="${kcal}">
        <span class="dsub" data-g="kcal"></span></label>
    </div>
    <div class="field" style="margin-top:12px"><label>${t('Protein source')}</label><select data-src="protein">${opts('protein')}</select></div>
    <div class="field"><label>${t('Carb source')}</label><select data-src="carb">${opts('carb')}</select></div>
    <div class="field"><label>${t('Fat source')}</label><select data-src="fat">${opts('fat')}</select></div>
    <div class="field"><label>${t('Extra (optional)')}</label><select data-src="veg">${opts('veg')}</select></div>
    <p class="hint" style="margin:0">${t('Leave a source on “Any” and the generator picks one. Portions are solved to land on the target; they snap to each food’s step size, so expect a percent or two of drift.')}</p>`;
  const p=modal(t('Build')+' '+m.name,body,
    [{label:t('Cancel'),ghost:true,value:null},{label:t('Build'),solid:true,value:'go'}]);
  const host=$('#mBody');
  const inp=k=>host.querySelector(`[data-b="${k}"]`);
  const sub=k=>host.querySelector(`[data-g="${k}"]`);
  function paint(){
    const g=gramsFrom(kcal,split);
    ['p','c','f'].forEach(k=>{
      const el=inp(k); if(el&&document.activeElement!==el) el.value = unit==='g'?r1(g[k]):split[k];
      sub(k).textContent = unit==='g'?split[k]+' %':r1(g[k])+' '+t('g');
    });
    const ke=inp('kcal'); if(ke&&document.activeElement!==ke) ke.value=r0(kcal);
    ke.disabled = unit==='g';
    sub('kcal').textContent = unit==='g'?t('from the macros'):t('kcal for this meal');
  }
  host.addEventListener('change',e=>{
    const k=e.target.dataset.b; if(!k) return;
    if(k==='kcal'){ kcal=Math.max(0,+e.target.value||0); }
    else if(unit==='pct'){ split=balance(split,k,+e.target.value||0); }
    else {                                        // grams typed -> calories follow
      const g=gramsFrom(kcal,split); g[k]=Math.max(0,+e.target.value||0);
      const k2=g.p*4+g.c*4+g.f*9;
      if(k2>0){ kcal=Math.round(k2); split={p:r1(g.p*4/k2*100),c:r1(g.c*4/k2*100),f:r1(g.f*9/k2*100)}; }
    }
    paint();
  });
  host.addEventListener('click',e=>{
    const b=e.target.closest('.seg button'); if(!b) return;
    host.querySelectorAll('.seg button').forEach(x=>x.classList.toggle('on',x===b));
    unit=b.dataset.v; paint();
  });
  paint();
  return p.then(v=>{
    if(v!=='go') return null;
    const picks=['protein','carb','fat','veg']
      .map(r=>host.querySelector(`[data-src="${r}"]`).value).filter(Boolean).map(F).filter(Boolean);
    return {kcal,split,picks};
  });
}


/* ---------------------------------------------------------------- onboarding / profile wizard */
function onboardingDialog(){
  return new Promise(resolve=>{
    let p = {...S.profile};
    let step = 0;   // 0 goal, 1 personal info, 2 results
    const steps = ['Your goal','About you','Your targets'];

    function goalStep(){
      const showPace = p.goal!=='maintain';
      return `
        <div class="wizprog">${steps.map((_,i)=>`<span class="${i===step?'on':i<step?'done':''}">${i+1}</span>`).join('')}</div>
        <div class="field"><label>${t('What are you working towards?')}</label>
          <div class="seg wide" data-w="goal">
            <button data-v="lose"${p.goal==='lose'?' class="on"':''}>${t('Lose weight')}</button>
            <button data-v="maintain"${p.goal==='maintain'?' class="on"':''}>${t('Maintain')}</button>
            <button data-v="gain"${p.goal==='gain'?' class="on"':''}>${t('Gain weight')}</button>
          </div></div>
        <div id="paceBlock" style="display:${showPace?'block':'none'}">
          <div class="field"><label>${t('Target weight (kg)')} <span class="hint">${t('— optional')}</span></label>
            <input class="num" type="number" min="0" step="0.5" data-w="targetWeightKg" value="${p.targetWeightKg||''}"></div>
          <div class="field"><label>${t('In how many weeks?')} <span class="hint">${t('— optional')}</span></label>
            <input class="num" type="number" min="0" step="1" data-w="weeks" value="${p.weeks||''}"></div>
          <p class="hint" style="margin:0 0 12px">${t('Give both and we work out the pace directly from them (using ~7700 kcal per kg). Leave either blank and you pick a pace instead:')}</p>
          <div class="field"><label>${t('Pace')}</label>
            <div class="seg wide" data-w="pace">
              ${[['verylow','Gentle'],['low','Steady'],['normal','Standard'],['high','Faster']].map(([v,l])=>
                `<button data-v="${v}"${p.pace===v?' class="on"':''}>${t(l)}</button>`).join('')}
            </div></div>
        </div>
        <p class="hint" id="wMsg" style="margin:8px 0 0"></p>`;
    }
    function infoStep(){
      const sel=(k,opts)=>`<select data-w="${k}">${opts.map(([v,l])=>`<option value="${v}"${p[k]===v?' selected':''}>${t(l)}</option>`).join('')}</select>`;
      return `
        <div class="wizprog">${steps.map((_,i)=>`<span class="${i===step?'on':i<step?'done':''}">${i+1}</span>`).join('')}</div>
        <div class="seg wide" data-w="sex" style="margin-bottom:12px">
          <button data-v="male"${p.sex==='male'?' class="on"':''}>${t('Male')}</button>
          <button data-v="female"${p.sex==='female'?' class="on"':''}>${t('Female')}</button></div>
        <div class="dgrid" style="margin-bottom:12px">
          <label class="dfield"><span class="dlab">${t('Age')}</span><input class="num" type="number" min="10" max="100" data-w="age" value="${p.age}"></label>
          <label class="dfield"><span class="dlab">${t('Height cm')}</span><input class="num" type="number" min="100" max="230" data-w="heightCm" value="${p.heightCm}"></label>
          <label class="dfield"><span class="dlab">${t('Weight kg')}</span><input class="num" type="number" min="30" max="300" step="0.1" data-w="weightKg" value="${p.weightKg}"></label>
        </div>
        <div class="field"><label>${t('Daily activity')} <span class="hint">${t('(job / general movement)')}</span></label>
          ${sel('activity',[['sedentary','Sedentary'],['active','Active'],['veryactive','Very active']])}</div>
        <div class="field"><label>${t('Workouts per week')}</label>
          ${sel('workouts',[['0','0'],['1-3','1–3 '+t('days')],['4-6','4–6 '+t('days')],['7+','7+ '+t('days')]])}</div>
        <div class="field"><label>${t('Protein target')}</label>
          ${sel('proteinLevel',[['normal','Normal'],['high','High'],['veryhigh','Very high']])}</div>
        <div class="field"><label>${t('Fat target')}</label>
          ${sel('fatLevel',[['minimum','Minimum'],['low','Low'],['normal','Normal'],['high','High']])}</div>
        <p class="hint" id="wMsg" style="margin:0"></p>`;
    }
    function resultStep(){
      const calc=calcTargets(p);
      return `
        <div class="wizprog">${steps.map((_,i)=>`<span class="${i===step?'on':i<step?'done':''}">${i+1}</span>`).join('')}</div>
        <div class="card daily" style="border:0;background:var(--paper);padding:14px 16px">
          <div class="dhead" style="border:0;padding:0 0 8px"><h3>${t('Estimated daily target')}</h3></div>
          <div class="dgrid">
            <label class="dfield"><span class="dlab">${t('Calories')}</span><div class="num" style="padding:8px 10px;text-align:right;font-weight:600;font-size:17px">${calc.kcal}</div></label>
            <label class="dfield"><span class="dlab"><span class="dot d-p"></span>${t('Protein')}</span><div class="num" style="padding:8px 10px;text-align:right">${calc.split.p}%</div></label>
            <label class="dfield"><span class="dlab"><span class="dot d-c"></span>${t('Carbs')}</span><div class="num" style="padding:8px 10px;text-align:right">${calc.split.c}%</div></label>
            <label class="dfield"><span class="dlab"><span class="dot d-f"></span>${t('Fat')}</span><div class="num" style="padding:8px 10px;text-align:right">${calc.split.f}%</div></label>
          </div>
          <p class="hint" style="margin:10px 0 0">BMR ${calc.bmr} ${t('kcal')} · ${t('maintenance')} ~${calc.tdee} ${t('kcal')} · ${p.goal==='maintain'?t('no adjustment'):(p.goal==='lose'?'-':'+')+calc.pct+'% '+(p.goal==='lose'?t('deficit'):t('surplus'))} · ~${calc.fiber} ${t('g fiber/day')}</p>
        </div>
        <p class="hint" style="margin:12px 0 0">${t('This is a starting point from standard formulas, not medical advice. Apply it and adjust anything in Targets afterwards — or skip and set numbers yourself.')}</p>`;
    }

    function paint(){
      $('#mTitle').textContent = step===0?t('What are you working towards?'):step===1?t('A bit about you'):t('Your estimated targets');
      $('#mBody').innerHTML = step===0?goalStep():step===1?infoStep():resultStep();
      const back = step>0?{label:t('Back')}:{label:t('Skip'),ghost:true};
      const fwd  = step<2?{label:t('Next'),solid:true}:{label:t('Apply to my plan'),solid:true};
      $('#mBtns').innerHTML = `<button class="btn ${back.ghost?'ghost':''}" data-nav="back">${back.label}</button>
        <span class="spacer"></span>
        ${step===2?'<button class="btn" data-nav="restart">'+t('Start over')+'</button>':''}
        <button class="btn ${fwd.solid?'solid':''}" data-nav="fwd">${fwd.label}</button>`;
    }
    ACTIVE_WIZARD_PAINT = paint;   // lets the header language toggle repaint this open dialog
    function readField(el){
      const k=el.dataset.w; if(!k) return;
      if(el.tagName==='SELECT') p[k]=el.value;
      else if(el.type==='number') p[k]= el.value===''? null : +el.value;
    }
    function valid(){
      if(step===0) return true;
      if(step===1) return p.age>0&&p.heightCm>0&&p.weightKg>0;
      return true;
    }
    $('#veil').classList.add('show');
    $('#mBody').addEventListener('change', e=>{ readField(e.target); });
    $('#mBody').addEventListener('click', e=>{
      const b=e.target.closest('.seg button'); if(!b) return;
      const host=b.closest('.seg'); host.querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));
      p[host.dataset.w]=b.dataset.v; paint();
    });
    $('#mBtns').onclick = e=>{
      const b=e.target.closest('button'); if(!b) return;
      const nav=b.dataset.nav;
      if(nav==='back'){ if(step===0){ $('#veil').classList.remove('show'); ACTIVE_WIZARD_PAINT=null; resolve({...p,done:true,_skipped:true}); return; } step--; paint(); return; }
      if(nav==='restart'){ step=0; paint(); return; }
      if(nav==='fwd'){
        if(!valid()){ const m=$('#wMsg'); if(m) m.textContent=t('Fill in age, height and weight to continue.'); return; }
        if(step<2){ step++; paint(); return; }
        $('#veil').classList.remove('show'); ACTIVE_WIZARD_PAINT=null; resolve({...p,done:true,_skipped:false});
      }
    };
    paint();
  });
}
async function runOnboarding(){
  const result = await onboardingDialog();
  S.profile = {...result}; delete S.profile._skipped;
  if(!result._skipped){
    const calc=calcTargets(result);
    S.daily.kcal=calc.kcal; S.daily.split=calc.split; S.daily.mode='pct';
    scaleMealsToDaily();
    toast(t('Targets updated from your profile'));
  }
  touchProfile(); render();
}


/* ---------------- views ---------------- */
function ledger(){
  const host=$('#ledger'); if(!host) return;
  const {tgt}=dayTotals();                    // target only — what you plan to eat, not what's logged so far
  const cell=(cls,lab,v,unit)=>`<div class="lg ${cls}">
      <div class="lab"><span>${lab}</span></div>
      <div class="val">${r0(v)}${unit==='kcal'?' '+t('kcal'):' '+t('g')}</div></div>`;
  host.innerHTML=cell('k-cal',t('Calories'),tgt.k,'kcal')+cell('k-p',t('Protein'),tgt.p,'g')+
    cell('k-c',t('Carbs'),tgt.c,'g')+cell('k-f',t('Fat'),tgt.f,'g');
  const di=$('#dDate'); if(di) di.value=S.date;
  const dl=$('#dLabel');
  if(dl){ const diff=Math.round((new Date(S.date)-new Date(today()))/864e5);
    dl.textContent=diff===0?t('today'):diff===-1?t('yesterday'):diff===1?t('tomorrow'):
      new Date(S.date).toLocaleDateString(LANG==='ru'?'ru-RU':LANG==='ar'?'ar':'en-GB',
        {weekday:'long',day:'numeric',month:'long',numberingSystem:'latn'}); }   // keep digits Latin even in Arabic — matches the rest of the app's numbers
}
function mealCard(m){
  const list=items(m.id), tot=mealTotals(m.id);
  const rows=list.map((it,i)=>{
    const f=F(it.fid); if(!f) return '';
    const x=itemMacros(it);
    return `<div class="row" data-m="${m.id}" data-i="${i}">
      <div><div class="rname" title="${esc(f.n)}">${esc(f.n)}</div>
        <span class="rmac"><b class="c-p">${r1(x.p)}p</b> · <b class="c-c">${r1(x.c)}c</b> · <b class="c-f">${r1(x.f)}f</b>${x.fib>0.05?' · '+r1(x.fib)+' fib':''} · ${r0(x.k)} kcal</span></div>
      <div class="qty"><button data-act="dec" aria-label="${t('decrease')}">−</button>
        <input class="num" type="number" inputmode="decimal" data-act="qty" value="${it.q}" step="${f.st}" min="0">
        <button data-act="inc" aria-label="${t('increase')}">+</button><span class="u">${esc(f.u)}</span></div>
      <div class="icons">
        <button class="ico ${it.lock?'on':''}" data-act="lock" title="${it.lock?t('Locked'):t('Lock')}">${it.lock?'🔒':'🔓'}</button>
        <button class="ico" data-act="del" title="${t('Remove')}">✕</button></div></div>`;
  }).join('');
  const bar=(cls,lab,a,t)=>{
    const pct=t>0?Math.min(100,a/t*100):(a>0?100:0), over=t>0&&a>t*1.03, d=a-t;
    return `<div class="bar"><span class="bl">${lab}</span>
      <span class="track ${over?'over':''} k-${cls}" style="margin:0"><span class="fill" style="width:${pct}%"></span></span>
      <span class="bv">${r1(a)} <span class="hint">/ ${r1(t)}</span> <span class="delta ${Math.abs(d)<2?'fit':(d>0?'pos':'neg')}">${d>0?'+':''}${r1(d)}</span></span></div>`;
  };
  const opts=[...S.foods].sort((a,b)=>a.n.localeCompare(b.n)).map(f=>`<option value="${f.id}">${esc(f.n)}</option>`).join('');
  return `<section class="card meal" data-m="${m.id}">
    <div class="mhead"><span class="mname">${esc(m.name)}</span><span class="mkcal">${r0(tot.k)} / ${r0(targetKcal(m.t))} ${t('kcal')}</span></div>
    <div class="rows">${rows||'<div class="empty">'+t('Empty — add something below or fill it automatically.')+'</div>'}</div>
    <div class="addrow"><select data-act="add"><option value="">${t('+ add food…')}</option>${opts}</select></div>
    <div class="mtot">${bar('p','P',tot.p,m.t.p)}${bar('c','K',tot.c,m.t.c)}${bar('f','Y',tot.f,m.t.f)}</div>
    <div class="acts">
      <button class="btn solid" data-act="build">${t('Build…')}</button>
      <button class="btn" data-act="auto">${t('Auto-fill')}</button>
      <button class="btn ghost" data-act="alt">${t('Another option')}</button>
      <button class="btn ghost" data-act="shuffle">${t('Shuffle')}</button>
      <button class="btn ghost" data-act="savemeal">${t('Save')}</button>
      <button class="btn ghost" data-act="clear">${t('Clear')}</button></div></section>`;
}
const viewPlan=()=>`<div class="datebar">
    <button class="dnav" id="dPrev" aria-label="${t('previous day')}">‹</button>
    <input type="date" id="dDate">
    <button class="dnav" id="dNext" aria-label="${t('next day')}">›</button>
    <button class="mini" id="dToday">${t('Today')}</button>
    <span class="dlabel" id="dLabel"></span></div>
  <div class="ledger" id="ledger"></div>
  <div class="planhead"><h2 style="margin:0">${t("Today's plan")}</h2>
    ${dayTotals().act.fib>0.05?`<span class="chip">${r1(dayTotals().act.fib)} ${t('g')} ${t('Fiber').toLowerCase()}</span>`:''}<span class="spacer"></span>
    <button class="btn solid" id="fillAll">${t('Fill the whole day')}</button>
    <button class="btn" id="copyPrev">${t('Same as yesterday')}</button>
    <button class="btn" id="btnShare">${t('Share')}</button>
    <button class="btn ghost" id="copyDay">${t('Copy as text')}</button></div>
  <div class="grid">${S.template.map(mealCard).join('')}</div>`;

function viewFoods(){
  const list=S.foods.filter(f=>f.n.toLowerCase().includes(foodFilter));
  const rows=list.map(f=>`<tr data-f="${f.id}">
    <td><input data-k="n" value="${esc(f.n)}"></td>
    <td><select data-k="b"><option value="100g"${f.b==='100g'?' selected':''}>100 ${t('g')}</option><option value="piece"${f.b==='piece'?' selected':''}>${t('piece/scoop')}</option></select></td>
    <td class="n"><input data-k="p" class="num" type="number" step="0.1" value="${f.p}"></td>
    <td class="n"><input data-k="c" class="num" type="number" step="0.1" value="${f.c}"></td>
    <td class="n"><input data-k="f" class="num" type="number" step="0.1" value="${f.f}"></td>
    <td class="n"><input data-k="fib" class="num" type="number" step="0.1" value="${f.fib||0}"></td>
    <td class="n"><input data-k="k" class="num" type="number" step="1" value="${f.k}"></td>
    <td>${(()=>{const c=kcalCheck(f); return c.level==='ok'?'' :
      `<span class="kflag ${c.level}" title="${t('Macros work out to')} ${r0(c.want)} ${t('kcal')}">${c.diff>0?'+':''}${r0(c.diff)}</span>`;})()}</td>
    <td><select data-k="role">${['protein','carb','fat','veg'].map(r=>`<option value="${r}"${f.role===r?' selected':''}>${t({protein:'protein',carb:'carb',fat:'fat',veg:'veg'}[r])}</option>`).join('')}</select></td>
    <td class="n"><input data-k="mn" class="num" type="number" step="1" value="${f.mn}"></td>
    <td class="n"><input data-k="mx" class="num" type="number" step="1" value="${f.mx}"></td>
    <td style="text-align:center"><input data-k="use" type="checkbox"${f.use?' checked':''} style="width:auto"></td>
    <td style="white-space:nowrap"><button class="ico" data-act="editfood" title="${t('Edit')}">✎</button><button class="ico" data-act="delfood" title="${t('Delete')}">✕</button></td></tr>`).join('');
  return `<h2>${t('Food list')} <span class="hint">· ${S.foods.length} ${t('entries')}${cloud()?' · '+t('shared kitchen'):''}</span></h2>
    <p class="hint" style="margin:-4px 0 12px">${t('Values are per')} <b>100 ${t('g')}</b> ${t('or per')} <b>${t('1 piece/scoop')}</b>. <b>Min/Max</b> ${t('is the portion range the generator may use; unchecking')} <b>${t('Use')}</b> ${t('keeps a food out of suggestions.')}${cloud()?' '+t('This list is shared with everyone in your kitchen — edits reach them right away.'):''}</p>
    <div class="searchbar"><input id="fq" placeholder="${t('Search…')}" value="${esc(foodFilter)}"><button class="btn solid" id="addFood">${t('Add food')}</button></div>
    <div class="tablewrap"><table><thead><tr>
      <th>${t('Food')}</th><th>${t('Unit')}</th><th class="n">${t('Protein')}</th><th class="n">${t('Carbs')}</th><th class="n">${t('Fat')}</th><th class="n">${t('Fiber')}</th><th class="n">${t('kcal')}</th><th></th>
      <th>${t('Role')}</th><th class="n">${t('Min')}</th><th class="n">${t('Max')}</th><th>${t('Use')}</th><th></th></tr></thead>
      <tbody>${rows||'<tr><td colspan="13" class="empty">'+t('No food matches that search.')+'</td></tr>'}</tbody></table></div>`;
}
function viewTargets(){
  const d=dailyGrams(), a=allocated(), sp=S.daily.split;
  const sum=r1(sp.p+sp.c+sp.f), byPct=S.daily.mode==='pct', mealPct=S.mealUnit==='pct';
  const seg=(id,cur,opts)=>`<div class="seg" id="${id}">`+opts.map(o=>
    `<button data-v="${o[0]}"${cur===o[0]?' class="on"':''}>${t(o[1])}</button>`).join('')+`</div>`;

  const macro=(k,lab,cls)=>{
    const g=d[k], pc=sp[k];
    return `<label class="dfield"><span class="dlab"><span class="dot d-${cls}"></span>${t(lab)}</span>
      <input class="num" type="number" step="${byPct?'0.5':'1'}" data-daily="${k}"
             value="${byPct?pc:r1(g)}" min="0">
      <span class="dsub">${byPct?`${r1(g)} ${t('g')}`:`${d.k>0?r1(pc):0} %`}</span></label>`;
  };

  const rows=S.template.map(m=>{
    const cell=k=>{
      const v=mealPct?(d[k]>0?r1(m.t[k]/d[k]*100):0):m.t[k];
      return `<input type="number" data-k="${k}" step="${mealPct?'1':'1'}" value="${v}" min="0">`;
    };
    return `<div class="trow" data-m="${m.id}">
      <input type="text" data-k="name" value="${esc(m.name)}">
      ${cell('p')}${cell('c')}${cell('f')}
      <input class="num" type="number" data-k="kcal" step="10" min="0" value="${r0(targetKcal(m.t))}">
      <button class="ico" data-act="delmeal" title="${t('Delete meal')}">✕</button></div>`;
  }).join('');

  const gap=(lab,al,da,cls)=>{
    const diff=al-da, near=Math.abs(diff)<(lab==='kcal'?12:1.5);
    return `<span class="allocitem"><span class="dot d-${cls}"></span>${t(lab)}
      <b class="num">${r0(al)}</b><span class="hint num"> / ${r0(da)}</span>
      <span class="delta num ${near?'fit':(diff>0?'pos':'neg')}">${diff>0?'+':''}${r0(diff)}</span></span>`;
  };

  return `<h2>${t('Targets')}</h2>
  <p class="hint" style="margin:-4px 0 14px">${t('Calories are the budget: raise one macro and the other two give way to keep the split at 100%. Below, set each meal in grams, as a share of the day, or straight in calories — typing calories rescales that meal and keeps its own macro balance.')}</p>

  <section class="card daily">
    <div class="dhead"><h3>${t('Daily target')}</h3><span class="spacer"></span>
      ${seg('segDaily',S.daily.mode,[['pct','% of calories'],['g','grams']])}</div>
    <div class="dgrid">
      <label class="dfield kcalfield"><span class="dlab">${t('Calories')}</span>
        <input class="num" type="number" step="10" min="0" data-daily="kcal" value="${r0(S.daily.kcal)}">
        <span class="dsub">${t('kcal per day')}</span></label>
      ${macro('p','Protein','p')}${macro('c','Carbs','c')}${macro('f','Fat','f')}
    </div>
    ${byPct&&Math.abs(sum-100)>0.5?`<div class="warn">${t('The split adds up to')} ${sum}% ${t('instead of 100%, so the grams above will not match your calorie goal.')}
      <button class="btn" id="normSplit" style="margin-left:6px">${t('Normalise to 100%')}</button></div>`:''}
  </section>

  <section class="card" style="margin-top:14px">
    <div class="dhead"><h3>${t('Split across meals')}</h3><span class="spacer"></span>
      ${seg('segMeal',S.mealUnit,[['g','grams'],['pct','% of daily']])}</div>
    <div class="trow thead"><span>${t('Meal')}</span><span style="text-align:right">${t('Protein')}</span><span style="text-align:right">${t('Carbs')}</span><span style="text-align:right">${t('Fat')}</span><span style="text-align:right">${t('Calories')}</span><span></span></div>
    ${rows}
    <div class="alloc">
      <span class="alloclab">${t('Allocated')}</span>
      ${gap('protein ',a.p,d.p,'p')}${gap('carbs',a.c,d.c,'c')}${gap('fat ',a.f,d.f,'f')}
      <span class="allocitem">${t('kcal')} <b class="num">${r0(a.k)}</b><span class="hint num"> / ${r0(d.k)}</span>
        <span class="delta num ${Math.abs(a.k-d.k)<12?'fit':(a.k>d.k?'pos':'neg')}">${a.k>d.k?'+':''}${r0(a.k-d.k)}</span></span>
    </div>
  </section>

  <div class="acts" style="margin-top:12px">
    <button class="btn solid" id="scaleMeals">${t('Fit meals to daily target')}</button>
    <button class="btn" id="addMeal">${t('Add meal')}</button>
    <button class="btn ghost" id="resetAll">${t('Reset everything')}</button></div>`;
}
function viewSaved(){
  if(!S.saved.length) return `<h2>${t('Saved combinations')}</h2><div class="card empty" style="padding:26px">${t('Nothing saved yet. Hit')} <b>${t('Save')}</b> ${t('on a meal you like in the Plan tab.')}</div>`;
  const mopts=S.template.map(m=>`<option value="${m.id}">${esc(m.name)}</option>`).join('');
  return `<h2>${t('Saved combinations')}${cloud()?' <span class="hint">· '+t('shared kitchen')+'</span>':''}</h2><div class="grid">${S.saved.map(s=>{
    const it=s.items.map(i=>{const f=F(i.fid);return f?`${esc(f.n)} <span class="hint">${i.q}${f.b==='100g'?t('g'):' '+esc(f.u)}</span>`:''}).filter(Boolean).join(' · ');
    return `<section class="card meal" data-s="${s.id}">
      <div class="mhead"><span class="mname">${esc(s.name)}</span><span class="mkcal">${r0(s.k||0)} ${t('kcal')}</span></div>
      <p style="margin:9px 0 10px;font-size:13px;line-height:1.6">${it||'<span class="hint">'+t('The foods in this combination were deleted from the list.')+'</span>'}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <span class="chip c-p">${r1(s.p||0)} p</span><span class="chip c-c">${r1(s.c||0)} k</span><span class="chip c-f">${r1(s.f||0)} y</span></div>
      <div class="acts"><select data-act="loadto" style="border:1px solid var(--line);border-radius:7px;padding:6px 8px;font-size:12.5px">${mopts}</select>
        <button class="btn solid" data-act="load">${t('Load')}</button>
        <button class="btn ghost" data-act="delsaved">${t('Delete')}</button></div></section>`;}).join('')}</div>`;
}

function profileCard(){
  const p=S.profile, has=p&&p.done&&!p._skipped;
  const calc=has?calcTargets(p):null;
  return `<section class="card acct" style="margin-top:14px">
    <div class="dhead"><h3>${t('Profile')}</h3></div>
    ${has?`<p class="hint" style="margin:0 0 4px">${p.sex==='male'?t('Male'):t('Female')}, ${p.age}, ${p.heightCm} ${t('cm')}, ${p.weightKg} ${t('kg')}
      ${p.goal!=='maintain'?' · '+(p.goal==='lose'?t('goal: lose weight'):t('goal: gain weight')):' · '+t('maintaining')}</p>
      <p class="hint" style="margin:0 0 12px">${t('Last estimate')}: ${calc.kcal} ${t('kcal')} · P${calc.split.p}% C${calc.split.c}% F${calc.split.f}%</p>`
      :`<p class="hint" style="margin:0 0 12px">${t('Not set up yet. Answer a few questions and we will suggest daily calories and macros for you.')}</p>`}
    <div class="acts" style="margin:0"><button class="btn solid" id="doProfile">${has?t('Redo profile'):t('Set up profile')}</button></div>
  </section>`;
}

function viewAccount(){
  const dataCard = `<section class="card acct" style="margin-top:14px">
      <div class="dhead"><h3>${t('Data')}</h3></div>
      <p class="hint" style="margin:0 0 10px">${t('Download a copy of every target, day, food and saved combination.')}</p>
      <div class="acts" style="margin:0"><button class="btn" id="btnExport">${t('Back up')}</button></div>
    </section>`;

  if(!sb) return `<h2>${t('Account')}</h2>
    <section class="card acct">
      <div class="dhead"><h3>${t('Local mode')}</h3></div>
      <p style="margin:0 0 10px">${t('No server configured, so data stays in this browser only — sync and shared kitchen are off.')}</p>
      <p class="hint" style="margin:0">${t('To turn them on, create a Supabase project, run')} <code>schema.sql</code>, ${t('and fill in the two lines in')} <code>config.js</code>.</p>
    </section>
    ${profileCard()}
    ${dataCard}`;

  if(!SESSION) return `<h2>${t('Account')}</h2>
    <section class="card acct">
      <div class="dhead"><h3>${t('Sign in')}</h3></div>
      <p class="hint" style="margin:0 0 14px">${t('Signing in stores your plans on the server, so your phone and computer see the same data. You can also keep using the app signed out — everything then stays in this browser.')}</p>
      <div class="field"><label>${t('Email')}</label><input type="email" id="aEmail" autocomplete="email"></div>
      <div class="field"><label>${t('Password')}</label><input type="password" id="aPass" autocomplete="current-password"></div>
      <div class="acts" style="margin:0"><button class="btn solid" id="doLogin">${t('Sign in')}</button><button class="btn" id="doSignup">${t('Create account')}</button></div>
      <p class="hint" style="margin:10px 0 0"><button class="btn ghost" id="doForgot" style="padding:2px 0">${t('Forgot password?')}</button></p>
      <p class="hint" id="aMsg" style="margin:8px 0 0"></p>
    </section>
    ${profileCard()}
    ${dataCard}`;

  return `<h2>${t('Account')}</h2>
    <section class="card acct">
      <div class="dhead"><h3>${t('Profile')}</h3></div>
      <div class="field"><label>${t('Signed in as')}</label><div>${esc(SESSION.user.email||'')}</div></div>
      <div class="field"><label>${t('Kitchen name')}</label>
        <input type="text" id="houseName" value="${esc(HOUSE?.name||'')}" placeholder="${t('My kitchen')}"></div>
      <div class="acts" style="margin:0"><button class="btn" id="doLogout">${t('Sign out')}</button></div>
    </section>

    <section class="card acct" style="margin-top:14px">
      <div class="dhead"><h3>${t('Shared kitchen')}</h3></div>
      <div class="field"><label>${t('Your invite code')}</label>
        <div><span class="code">${esc(HOUSE?.invite_code||'—')}</span>
          <button class="btn ghost" id="copyCode">${t('copy')}</button></div>
        <p class="hint" style="margin:6px 0 0">${t('Give this code to a friend and you will share the same food list and saved combinations. Daily plans stay private to each person.')}</p></div>
      <div class="field"><label>${t('Join another kitchen')}</label><input type="text" id="joinCode" placeholder="${t('6-character code')}"></div>
      <div class="warn">${t("Joining deletes your kitchen's food list and replaces it with theirs. Back up first.")}</div>
      <div class="acts" style="margin:0"><button class="btn solid" id="doJoin">${t('Join')}</button></div>
    </section>

    ${profileCard()}
    ${dataCard}`;
}
function render(){
  document.querySelectorAll('#tabs button').forEach(b=>{
    b.setAttribute('aria-selected',String(b.dataset.tab===S.tab));
    if(b.dataset.t) b.textContent=t(b.dataset.t);
  });
  document.documentElement.lang = LANG;
  document.documentElement.dir = LANG==='ar' ? 'rtl' : 'ltr';
  paintLangBtn();
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
  S.tab='plan'; touchProfile(); touchDay(); render(); toast(t('Shared plan loaded'));
}
function dayAsText(){
  const txt=S.template.map(m=>{const l=items(m.id); if(!l.length) return null; const t=mealTotals(m.id);
    return `${m.name} — ${r0(t.k)} kcal (P${r1(t.p)} C${r1(t.c)} F${r1(t.f)})\n`+
      l.map(i=>{const f=F(i.fid);return f?`  · ${f.n} ${i.q}${f.b==='100g'?' g':' '+f.u}`:'';}).join('\n');
  }).filter(Boolean).join('\n\n');
  const d=dayTotals().act;
  const lbl = LANG==='ru' ? 'ИТОГО ЗА ДЕНЬ' : 'DAILY TOTAL';
  return `${S.date}\n\n`+txt+`\n\n${lbl}: ${r0(d.k)} ${t('kcal')} · P${r0(d.p)} C${r0(d.c)} F${r0(d.f)}`;
}

/* ---------------- events ---------------- */
$('#tabs').addEventListener('click',e=>{const b=e.target.closest('button'); if(!b)return; S.tab=b.dataset.tab; save(); render();});
$('#langToggle').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return; setLang(b.dataset.l); });

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
  if(act==='build'){ const mid=mealEl.dataset.m;
    buildDialog(mid).then(cfg=>{ if(!cfg) return;
      const m=S.template.find(x=>x.id===mid);
      const g=gramsFrom(cfg.kcal,cfg.split);
      m.t={p:r1(g.p),c:r1(g.c),f:r1(g.f)};                       // the meal target is what you asked for
      const list=candidates(m,{must:cfg.picks});
      if(!list.length){ toast(t('Could not build from those sources.')); touchProfile(); render(); return; }
      ALT[mid]={list,i:0}; applyCandidate(m,list[0]);
      touchProfile(); touchDay(); render(); toast((LANG==='ru'?'Собрано на ':'Built to ')+r0(cfg.kcal)+' '+t('kcal'));
    });
    return; }
  if(act==='editfood'){ const id=b.closest('tr').dataset.f, f=F(id);
    foodDialog(f).then(async out=>{ if(!out) return;
      Object.assign(f,out);
      save(); if(cloud()) enqueue({op:'food',id:f.id});
      render(); toast(t('Saved')); });
    return; }
  if(act==='alt'){ nextAlt(mealEl.dataset.m); return; }
  if(act==='clear'){ const mid=mealEl.dataset.m; S.days[S.date][mid]=items(mid).filter(i=>i.lock); touchDay(); render(); return; }
  if(act==='savemeal'){
    const m=S.template.find(x=>x.id===mealEl.dataset.m), l=items(m.id);
    if(!l.length){ toast(t('Fill the meal first.')); return; }
    const tot=mealTotals(m.id);
    ask(t('Save combination'),m.name+' — '+r0(tot.k)+' '+t('kcal')).then(async name=>{ if(!name) return;
      const rec={id:uid(),name,items:l.map(i=>({fid:i.fid,q:i.q})),...tot,mine:true};
      if(cloud()){ const {data,error}=await sb.from('combos').insert({household_id:HH,user_id:SESSION.user.id,
          name,items:rec.items,macros:{p:tot.p,c:tot.c,f:tot.f,k:tot.k}}).select().maybeSingle();
        if(error){ toast(t('Could not save — no connection')); return; } rec.id=data.id; }
      S.saved.unshift(rec); save(); toast(t('Saved')); });
    return; }
  if(act==='delfood'){ const id=b.closest('tr').dataset.f, f=F(id);
    confirmBox(t('Delete food'),`"${f?f.n:''}" `+t('will be removed from the list and from every meal using it.'),t('Delete')).then(ok=>{ if(!ok) return;
      S.foods=S.foods.filter(x=>x.id!==id);
      Object.values(S.days).forEach(d=>Object.keys(d).forEach(k=>d[k]=d[k].filter(i=>i.fid!==id)));
      if(cloud()) enqueue({op:'delfood',id});
      touchDay(); render(); }); return; }
  if(act==='delmeal'){ const id=mealEl.dataset.m, m=S.template.find(x=>x.id===id);
    confirmBox(t('Delete meal'),`"${m?m.name:''}" `+t('and its targets will be deleted.'),t('Delete')).then(ok=>{ if(!ok) return;
      S.template=S.template.filter(x=>x.id!==id);
      Object.values(S.days).forEach(d=>delete d[id]);
      touchProfile(); touchDay(); render(); }); return; }
  if(act==='delsaved'){ const id=b.closest('[data-s]').dataset.s;
    S.saved=S.saved.filter(s=>s.id!==id); if(cloud()) enqueue({op:'delcombo',id}); save(); render(); return; }
  if(act==='load'){ const el=b.closest('[data-s]'), s=S.saved.find(x=>x.id===el.dataset.s);
    const mid=el.querySelector('[data-act=loadto]').value;
    S.days[S.date][mid]=s.items.map(i=>({...i,lock:false}));
    touchDay(); S.tab='plan'; render(); toast(t('Loaded')); return; }
});

$('#view').addEventListener('change',e=>{
  const el=e.target;
  if(el.dataset.act==='add'&&el.value){ const mid=el.closest('[data-m]').dataset.m, f=F(el.value);
    items(mid).push({fid:f.id,q:f.b==='100g'?100:1,lock:false}); touchDay(); render(); return; }
  const tr=el.closest('tr[data-f]');
  if(tr&&el.dataset.k){ const f=F(tr.dataset.f), k=el.dataset.k;
    if(k==='b'&&el.value!==f.b){ const to=el.value, fac=to==='piece'?1/100:100;
      Object.values(S.days).forEach(d=>Object.values(d).forEach(arr=>arr.forEach(i=>{ if(i.fid===f.id) i.q=r1(i.q*fac); })));
      f.mn=r1(f.mn*fac); f.mx=r1(f.mx*fac); f.st=to==='piece'?0.5:10; f.u=to==='piece'?'pc':'g'; touchDay(); }
    f[k]= k==='use'?el.checked : (k==='n'||k==='b'||k==='role')?el.value : (+el.value||0);
    save(); if(cloud()) enqueue({op:'food',id:f.id});
    if(k==='b'||k==='n') render(); else ledger(); return; }
  if(el.id==='dDate'&&el.value){ goDate(el.value); return; }
  if(el.id==='houseName'){ const name=el.value.trim()||t('My kitchen');
    if(HOUSE) HOUSE.name=name;
    if(cloud()) sb.from('households').update({name}).eq('id',HH)
      .then(({error})=>toast(error?t('Could not rename the kitchen'):t('Kitchen renamed')));
    return; }
  if(el.dataset.daily){ const k=el.dataset.daily, v=+el.value||0;
    if(k==='kcal') S.daily.kcal=Math.max(0,v);
    else if(S.daily.mode==='pct') setSplitBalanced(k,v);
    else setDailyGram(k,v);
    touchProfile(); render(); return; }
  const tw=el.closest('.trow[data-m]');
  if(tw&&el.dataset.k){ const m=S.template.find(x=>x.id===tw.dataset.m), k=el.dataset.k;
    if(k==='name') m.name=el.value;
    else if(k==='kcal'){                                   // scale this meal to the calories you typed
      const want=Math.max(0,+el.value||0);
      const sp=targetKcal(m.t)>0?splitOf(m.t):S.daily.split;
      const g=gramsFrom(want,sp); m.t={p:r1(g.p),c:r1(g.c),f:r1(g.f)};
    }
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
    touchDay(); render(); toast(t('Day filled')); }
  if(id==='copyPrev'){ const d=new Date(S.date); d.setDate(d.getDate()-1); const prev=d.toLocaleDateString('sv-SE');
    if(cloud()) await loadDay(prev);
    const p=S.days[prev];
    if(!p||!Object.keys(p).length){ toast(t('No plan saved for yesterday.')); return; }
    S.days[S.date]=JSON.parse(JSON.stringify(p)); touchDay(); render(); toast(t("Yesterday's plan copied")); }
  if(id==='dPrev') shiftDate(-1);
  if(id==='dNext') shiftDate(1);
  if(id==='dToday') goDate(today());
  if(id==='normSplit'){ normalizeSplit(); touchProfile(); render(); toast(t('Split normalised to 100%')); }
  if(id==='scaleMeals'){ scaleMealsToDaily(); touchProfile(); render(); toast(t('Meal targets scaled to the daily total')); }
  if(id==='doProfile') runOnboarding();
  if(id==='addMeal'){ S.template.push({id:uid(),name:t('New meal'),t:{p:0,c:0,f:0}}); touchProfile(); render(); }
  if(id==='addFood'){ foodDialog(null).then(async f=>{ if(!f) return;
    if(cloud()){ const {data,error}=await sb.from('foods').insert(toRow(f)).select().maybeSingle();
      if(error){ toast(t('Could not add — no connection')); return; } f=fromRow(data); }
    S.foods.unshift(f); foodFilter=''; save(); render(); toast(t('Food added')); }); }
  if(id==='resetAll'){ confirmBox(t('Reset everything'),t("Targets, today's plan and the food list all go back to their starting state."),t('Reset'))
    .then(ok=>{ if(!ok) return; const keep=S.tab; S=defaultState(); S.tab=keep;
      touchProfile(); touchDay(); render(); toast(t('Reset')); }); }
  if(id==='copyDay') copyText(dayAsText());
  if(id==='copyCode'&&HOUSE) copyText(HOUSE.invite_code);
  if(id==='btnShare'){ const url=shareLink();
    modal(t('Share plan'),`<p class="hint" style="margin:0 0 8px">${t("This link carries the day's plan and targets — whoever opens it sees the same plan in their own Food's Up.")}</p><textarea id="mUrl" readonly style="height:96px">${esc(url)}</textarea>`,
      [{label:t('Close'),ghost:true,value:'x'},{label:t('Copy link'),solid:true,value:'copy'}]).then(v=>{ if(v==='copy') copyText(url); }); }
  if(id==='btnExport'){ const json=JSON.stringify(S,null,2);
    modal(t('Back up'),`<p class="hint" style="margin:0 0 8px">${t('Every target, day, food and saved combination.')}</p><textarea id="mJson" readonly>${esc(json)}</textarea>`,
      [{label:t('Close'),ghost:true,value:'x'},{label:t('Copy'),value:'copy'},{label:t('Download'),solid:true,value:'dl'}]).then(v=>{
        if(v==='copy') copyText(json);
        if(v==='dl'){ try{ const a=document.createElement('a');
          a.href=URL.createObjectURL(new Blob([json],{type:'application/json'}));
          a.download='foodsup-'+today()+'.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); toast(t('Backup downloaded'));
        }catch(err){ toast(t('Download blocked — you can copy the text instead.')); } } }); }

  /* hesap */
  if(id==='doLogin'||id==='doSignup'){
    const email=$('#aEmail').value.trim(), pass=$('#aPass').value;
    if(!email||!pass){ $('#aMsg').textContent=t('Email and password are required.'); return; }
    e.target.disabled=true; $('#aMsg').textContent='…';
    const {data,error}= id==='doSignup'
      ? await sb.auth.signUp({email,password:pass,options:{emailRedirectTo:location.origin+'/app.html?start=1'}})
      : await sb.auth.signInWithPassword({email,password:pass});
    e.target.disabled=false;
    if(error){ $('#aMsg').textContent=error.message; return; }
    if(id==='doSignup'&&!data.session){ $('#aMsg').textContent=t('Account created. Click the confirmation link in your email, then sign in.'); return; }
  }
  if(id==='doForgot'){
    const email=$('#aEmail')?.value.trim();
    const target = email || await ask(t('Reset password'),t('Enter your email'));
    if(!target) return;
    const {error}=await sb.auth.resetPasswordForEmail(target, {redirectTo: location.origin+location.pathname});
    const msg=$('#aMsg');
    if(msg) msg.textContent = error ? error.message :
      (LANG==='ru'?`Если у ${target} есть аккаунт, ссылка для сброса уже отправлена — проверьте почту.`
                  :`If ${target} has an account, a reset link is on its way — check your inbox.`);
  }
  if(id==='doLogout'){ await sb.auth.signOut(); location.href='index.html'; }
  if(id==='doJoin'){ const code=$('#joinCode').value.trim(); if(!code) return;
    const ok=await confirmBox(t('Join kitchen'),t('Your own food list will be deleted and replaced with theirs. Continue?'),t('Join'));
    if(!ok) return;
    const {error}=await sb.rpc('join_household',{code});
    if(error){ toast(error.message); return; }
    toast(t('Joined')); S.foods=[]; await cloudPull(); render(); }
});


function resetPasswordDialog(){
  const body=`<p class="hint" style="margin:0 0 12px">${t('Choose a new password for your account.')}</p>
    <div class="field"><label>${t('New password')}</label><input type="password" id="rPass1" autocomplete="new-password"></div>
    <div class="field"><label>${t('Confirm password')}</label><input type="password" id="rPass2" autocomplete="new-password"></div>
    <p class="hint" id="rMsg" style="margin:0"></p>`;
  modal(t('Set a new password'), body, [{label:t('Cancel'),ghost:true,value:null},{label:t('Save'),solid:true,value:'go'}]).then(async v=>{
    if(v!=='go') return;
    const p1=$('#rPass1')?.value||'', p2=$('#rPass2')?.value||'';
    if(p1.length<6){ toast(t('Password must be at least 6 characters')); return resetPasswordDialog(); }
    if(p1!==p2){ toast(t('Passwords do not match')); return resetPasswordDialog(); }
    const {error}=await sb.auth.updateUser({password:p1});
    toast(error?error.message:t('Password updated'));
  });
}

/* ---------------- boot ---------------- */
function adoptCache(){ const c=loadCache(); if(c&&c.template&&c.foods){ S=Object.assign(defaultState(),c); if(!S.days[S.date]) S.days[S.date]={}; } }

async function onSession(sess){
  const wasSignedIn=!!SESSION;
  SESSION=sess;
  if(SESSION){
    adoptCache();
    if(!wasSignedIn&&S.tab==='account') S.tab='plan';   // land on the plan, not the sign-in screen
    setStatus('wait'); render();                        // paint now, sync in the background
    try{ await cloudPull(); }catch(e){ setStatus('wait'); toast(t('Could not reach the server — continuing with the local copy.')); }
    if(!wasSignedIn) toast(t('Signed in'));
  } else { HH=HOUSE=null; if(CH){ sb?.removeChannel(CH); CH=null; } adoptCache(); setStatus('local'); }
  render();
}

(async()=>{
  adoptCache();
  try{ if(new URLSearchParams(location.search).get('start')){ S.tab='account';
    history.replaceState(null,'',location.pathname+location.hash); } }catch(e){}
  setStatus(sb?'wait':'local'); render();
  if(!readShared()&&!S.profile?.done&&S.tab!=='account') setTimeout(()=>{ if(!S.profile?.done) runOnboarding(); }, 400);
  if(sb){
    const {data}=await sb.auth.getSession();
    await onSession(data.session||null);
    sb.auth.onAuthStateChange((evt,sess)=>{
      if(evt==='PASSWORD_RECOVERY'){ resetPasswordDialog(); return; }
      if((sess?.user?.id||null)!==(SESSION?.user?.id||null)) onSession(sess||null);
    });
    setInterval(flush,20000);
    window.addEventListener('online',flush);
    document.addEventListener('visibilitychange',()=>{ if(!document.hidden) flush(); });
  }
  const shared=readShared();
  if(shared){
    try{ history.replaceState(null,'',location.href.split('#')[0]); }catch(e){ location.hash=''; }
    const ok=await confirmBox(t('Shared plan'),t("Someone shared a Food's Up plan. Load it? It replaces today's plan and your targets."),t('Load'));
    if(ok) applyShared(shared);
  }
})();
