import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, onSnapshot, writeBatch, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA4ersiueCxTnQnV62evhqsDOaRGW9eve0",
  authDomain: "tabata-bunko.firebaseapp.com",
  projectId: "tabata-bunko",
  storageBucket: "tabata-bunko.firebasestorage.app",
  messagingSenderId: "466621970729",
  appId: "1:466621970729:web:3e3dcbcd73bf77dec11f38"
};
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
let db;
try { db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch { db = initializeFirestore(fbApp, {}); }

/* ================= 基本 ================= */
const KINDS = {book:{label:"本",color:"var(--book)"},manga:{label:"漫画",color:"var(--manga)"},doujin:{label:"同人誌",color:"var(--doujin)"}};
const STATUS = {unread:{label:"積読",color:"var(--unread)"},reading:{label:"読書中",color:"var(--reading)"},read:{label:"読了",color:"var(--read)"}};
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const today = () => new Date(Date.now() - new Date().getTimezoneOffset()*60000).toISOString().slice(0,10);
const store = {get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch{return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
function toast(msg){const t=document.createElement("div");t.className="toast";t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),2800)}

const S = {user:null, libId:null, lib:null, items:[], loaded:false, tab:"list", kind:"all", filt:null, q:"", sort:store.get("bunko.sort","added")};
let unsubItems = null, unsubLib = null;

/* ================= ISBN・書誌 ================= */
function c13(d12){let s=0;for(let i=0;i<12;i++)s+=(+d12[i])*(i%2?3:1);return String((10-s%10)%10)}
function toIsbn13(raw){
  const s = String(raw||"").replace(/[^0-9Xx]/g,"").toUpperCase();
  if(s.length===13 && /^97[89]\d{10}$/.test(s)) return c13(s.slice(0,12))===s[12] ? s : null;
  if(s.length===10 && /^\d{9}[\dX]$/.test(s)){
    let t=0;for(let i=0;i<9;i++)t+=(+s[i])*(10-i);t+=s[9]==="X"?10:+s[9];
    if(t%11) return null; const core="978"+s.slice(0,9); return core+c13(core);
  }
  return null;
}
const fmtIsbn = i => i && i.length===13 ? `${i.slice(0,3)}-${i.slice(3)}` : (i||"");
function cleanAuthor(a){
  if(!a) return "";
  const role = /^(著|編|編著|共著|訳|監訳|監修|イラスト|イラストレーション|絵|画|原作|作画|漫画|脚本|写真|解説|企画|他|ほか)$/;
  return String(a).replace(/[\/／]/g," ").split(/[\s　]+/)
    .map(p=>p.trim()).filter(p=>p && !role.test(p))
    .map(p=>p.replace(/[,，]?\s*\d{4}-?\d{0,4}\s*$/,"").split(/[,，]/).map(x=>x.trim()).filter(Boolean).join(""))
    .filter(Boolean).slice(0,3).join("・");
}
const nfkc = v => typeof v==="string" ? v.normalize("NFKC") : v;
function cleanSeries(s){ return String(s||"").replace(/\s*(?:VOL|Vol|vol)\.?\s*$/,"").replace(/[\s.．、,]+$/,"").trim() }
function splitVolume(title){
  let t = nfkc(String(title||"")).replace(/\s+/g," ").trim();
  t = t.replace(/\.\s*\[(\d+)\]/, " $1");
  t = t.replace(/[\s　]*[（(]\s*[^\d)）]{2,}\s*[)）]\s*$/, "");
  t = t.trim();
  const m = t.match(/^(.+?)[\s　]*[（(【\[]?(\d{1,3})[)）】\]]?[\s　]*(?:巻)?$/);
  if(m && m[1].trim().length>=2 && !/^\d+$/.test(m[1].trim())) return {series:cleanSeries(m[1].trim().replace(/[\s　]*[（(【\[]$/,"")), vol:Number(m[2])};
  return {series:"", vol:null};
}
async function fetchJson(url, ms){
  const ac = new AbortController(); const t = setTimeout(()=>ac.abort(), ms||9000);
  try{ const r = await fetch(url,{signal:ac.signal}); if(!r.ok) return null; return await r.json() }
  catch{ return null } finally{ clearTimeout(t) }
}
async function lookup(isbn){
  const ob = await fetchJson(`https://api.openbd.jp/v1/get?isbn=${isbn}`);
  const s = ob && ob[0] && ob[0].summary;
  let meta = null;
  if(s && (s.title||"").trim()){
    meta = {title:s.title.trim(), author:cleanAuthor(s.author), publisher:(s.publisher||"").trim(), label:(s.series||"").trim(), genre:""};
  }else{
    const gb = await fetchJson(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&country=JP`);
    const v = gb && gb.items && gb.items[0] && gb.items[0].volumeInfo;
    if(v && v.title) meta = {title:[v.title, v.subtitle].filter(Boolean).join(" "), author:(v.authors||[]).slice(0,3).join("・"), publisher:v.publisher||"", label:"", genre:(v.categories||[]).slice(0,2).join("/")};
  }
  if(!meta) return null;
  for(const k of ["title","author","publisher","label","genre"]) meta[k] = nfkc(meta[k]||"").trim();
  const sv = splitVolume(meta.title);
  return {...meta, series:sv.series, vol:sv.vol};
}
function guessKind(meta, pref){
  if(pref && pref!=="auto") return pref;
  const hay = [meta?.label, meta?.genre, meta?.publisher, meta?.title].join(" ");
  if(/コミック|COMIC|Comics|comics|まんが|漫画|少年|少女|ヤング|ジャンプ|マガジン|サンデー|アフタヌーン|チャンピオン|ビッグ|モーニング|ガンガン/.test(hay)) return "manga";
  return "book";
}
function metaTags(meta){ return [meta?.label, ...(meta?.genre?String(meta.genre).split(/[\/、,]/):[])].map(t=>String(t||"").trim()).filter(Boolean).slice(0,3) }

/* ================= データ ================= */
const itemsCol = () => collection(db, "libraries", S.libId, "items");
const itemRef = id => doc(db, "libraries", S.libId, "items", id);
const isLent = it => !!(it.lentTo && String(it.lentTo).trim());
const isOwner = () => S.lib && S.user && S.lib.owner === S.user.uid;
function clean(o){const r={};for(const[k,v]of Object.entries(o)){if(v===undefined)continue;r[k]=v}return r}
function stripId(it){const {id,...rest}=it;return rest}
function errMsg(e){
  const c = e?.code||"";
  if(c.includes("permission")) return "この台帳を編集する権限がありません";
  if(c.includes("unavailable")) return "通信できません。電波の良い場所で試してください（端末には保存済みです）";
  return "保存に失敗しました。もう一度試してください";
}
async function saveItem(id, data){
  const ref = id ? itemRef(id) : doc(itemsCol());
  try{ await setDoc(ref, clean(data)); return ref.id }
  catch(e){ toast(errMsg(e)); return null }
}
async function patchItem(it, changes, msg){
  try{ await updateDoc(itemRef(it.id), clean({...changes, updatedAt:Date.now()})); if(msg) toast(msg) }
  catch(e){ toast(errMsg(e)) }
}

/* ================= 表示 ================= */
function filtered(){
  let arr = S.items.slice();
  if(S.tab==="lent") arr = arr.filter(isLent);
  if(S.kind!=="all") arr = arr.filter(i=>i.kind===S.kind);
  if(S.filt==="unread") arr = arr.filter(i=>i.status==="unread" || !i.status);
  if(S.filt==="pending") arr = arr.filter(i=>i.needsInfo);
  if(S.filt==="lent") arr = arr.filter(isLent);
  const q = S.q.trim().toLowerCase().replace(/-/g,"");
  if(q) arr = arr.filter(i=>[i.title,i.author,i.series,i.circle,i.event,i.genre,i.publisher,i.isbn,i.location,i.note,i.lentTo,(i.tags||[]).join(" ")].join(" ").toLowerCase().replace(/-/g,"").includes(q));
  const cmp = (a,b)=>String(a||"").localeCompare(String(b||""),"ja");
  const byVol = (a,b)=>cmp(a.series||a.title,b.series||b.title)||((a.vol??0)-(b.vol??0))||cmp(a.title,b.title);
  if(S.tab==="lent") arr.sort((a,b)=>cmp(a.lentAt,b.lentAt));
  else if(S.sort==="title") arr.sort((a,b)=>cmp(a.title||"~",b.title||"~")||((a.vol??0)-(b.vol??0)));
  else if(S.sort==="series") arr.sort(byVol);
  else if(S.sort==="location") arr.sort((a,b)=>cmp(a.location||"~",b.location||"~")||byVol(a,b));
  else arr.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  return arr;
}
function daysSince(d){const t=Date.parse(d);return isNaN(t)?"?":Math.max(0,Math.floor((Date.now()-t)/864e5))}

function render(){
  const all = S.items;
  const unread = all.filter(i=>i.status==="unread"||!i.status).length;
  const lent = all.filter(isLent).length;
  const pending = all.filter(i=>i.needsInfo).length;
  const seriesCount = new Set(all.filter(i=>i.series).map(i=>String(i.series).trim())).size;
  $("#nList").textContent = all.length; $("#nSeries").textContent = seriesCount; $("#nLent").textContent = lent;
  const byKind = k => all.filter(i=>i.kind===k).length;
  $("#ledger").innerHTML = `
    <button data-f="" aria-pressed="${!S.filt}"><span class="k">所蔵</span><span class="v">${all.length}<small>冊</small></span><span class="k">本 ${byKind("book")}・漫画 ${byKind("manga")}・同人 ${byKind("doujin")}</span></button>
    <button data-f="unread" aria-pressed="${S.filt==="unread"}"><span class="k">積読</span><span class="v" style="color:var(--unread)">${unread}<small>冊</small></span><span class="k">${all.length?Math.round(unread/all.length*100):0}%</span></button>
    <button data-f="lent" aria-pressed="${S.filt==="lent"}"><span class="k">貸出中</span><span class="v" style="color:var(--lent)">${lent}<small>冊</small></span><span class="k">${lent?"返却待ち":"なし"}</span></button>
    <button data-f="pending" aria-pressed="${S.filt==="pending"}"><span class="k">書誌待ち</span><span class="v" style="color:var(--pending)">${pending}<small>冊</small></span><span class="k">ISBNのみ登録</span></button>`;
  $("#ledger").querySelectorAll("button").forEach(b=>b.onclick=()=>{S.filt=b.dataset.f||null; if(S.tab!=="list") setTab("list"); else render();});

  let bn = "";
  if(!S.loaded) bn = `<div class="banner"><span class="spin"></span> 蔵書を読み込み中…</div>`;
  else if(!all.length) bn = `<div class="banner"><b>まだ本がありません。</b>右下の「スキャン」でバーコードを読み取ると、書誌を自動で調べて登録します。</div>`;
  else if(pending && S.filt==="pending") bn = `<div class="banner"><b>書誌待ち</b>は、書誌データベースで見つからなかった本です。<button class="mini" id="refetchNow">もう一度まとめて調べる</button> 見つからない本は、行をタップして手入力してください。</div>`;
  $("#banner").innerHTML = bn;
  $("#refetchNow")?.addEventListener("click", refetchPending);

  $("#kindChips").innerHTML = [["all","すべて",null],...Object.entries(KINDS).map(([k,v])=>[k,v.label,v.color])]
    .map(([k,l,c])=>`<button class="chip" data-k="${k}" aria-pressed="${S.kind===k}">${c?`<span class="dot" style="background:${c}"></span>`:""}${l}</button>`).join("");
  $("#kindChips").querySelectorAll("button").forEach(b=>b.onclick=()=>{S.kind=b.dataset.k;render()});
  $("#sort").value = S.sort; $("#sort").hidden = S.tab!=="list";

  const v = $("#view");
  if(!S.loaded){ v.innerHTML=""; return; }
  v.innerHTML = S.tab==="series" ? renderSeries() : renderList(filtered());
  bindView(); fillDatalists();
}
function itemRow(it){
  const k = KINDS[it.kind]||KINDS.book, st = STATUS[it.status||"unread"]||STATUS.unread;
  const title = it.title ? esc(it.title) : `<span style="color:var(--pending)">書誌待ち</span>`;
  const vol = (it.vol!=null && it.vol!=="" && !(it.title||"").includes(String(it.vol))) ? `<span class="vol">${esc(it.vol)}巻</span>` : "";
  const who = it.kind==="doujin" ? [it.circle && `【${it.circle}】`, it.author, it.event, it.genre].filter(Boolean) : [it.author, it.publisher].filter(Boolean);
  const tags = [
    `<span class="tag s" style="--tc:${k.color}">${k.label}</span>`,
    `<span class="tag s" style="--tc:${st.color}">${st.label}${it.status==="read"&&it.readAt?` ${esc(String(it.readAt).slice(5).replace("-","/"))}`:""}</span>`,
    isLent(it) ? `<span class="tag s" style="--tc:var(--lent)">${esc(it.lentTo)}に貸出${it.lentAt?` ・${daysSince(it.lentAt)}日`:""}</span>` : "",
    it.location ? `<span class="tag">${esc(it.location)}</span>` : "",
    it.series && !(it.title||"").includes(it.series) ? `<span class="tag">${esc(it.series)}</span>` : "",
    ...(it.tags||[]).map(t=>`<span class="tag">#${esc(t)}</span>`),
    it.needsInfo || !it.title ? `<span class="tag mono">${esc(fmtIsbn(it.isbn))}</span>` : ""
  ].join("");
  const next = it.status==="read" ? "未読に戻す" : it.status==="reading" ? "読了にする" : "読み始める";
  return `<article class="item" style="--c:${k.color}">
    <div class="spine"></div>
    <button class="body" data-edit="${esc(it.id)}"><span class="t">${title}${vol}</span>${who.length?`<span class="m">${esc(who.join(" ／ "))}</span>`:""}<span class="tags">${tags}</span></button>
    <div class="acts">
      <button class="mini" data-cycle="${esc(it.id)}">${next}</button>
      ${isLent(it) ? `<button class="mini" data-ret="${esc(it.id)}">返却</button>` : ""}
    </div>
  </article>`;
}
function renderList(arr){
  if(!arr.length) return `<div class="empty">${S.tab==="lent" ? "貸し出している本はありません。" : S.items.length ? "条件に合う本がありません。" : "右下の「スキャン」から最初の1冊を登録しましょう。"}</div>`;
  return `<div class="list">${arr.map(itemRow).join("")}</div>`;
}
function renderSeries(){
  const groups = new Map();
  for(const it of S.items){
    if(!it.series || !String(it.series).trim()) continue;
    if(S.kind!=="all" && it.kind!==S.kind) continue;
    const key = String(it.series).trim();
    if(S.q && !key.toLowerCase().includes(S.q.trim().toLowerCase()) && !(it.author||"").includes(S.q.trim())) continue;
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  if(!groups.size) return `<div class="empty">シリーズ名を入れた本がまだありません。<br>本を編集して「シリーズ名」と「巻数」を入れると、ここに巻の抜けが表示されます。</div>`;
  const rows = [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],"ja")).map(([name,items])=>{
    const c = (KINDS[items[0].kind]||KINDS.book).color;
    const byVol = new Map(); const extra=[];
    items.forEach(i=>{const n=Number(i.vol); if(Number.isInteger(n)&&n>0) byVol.set(n,i); else extra.push(i)});
    const max = Math.max(0,...byVol.keys());
    const missing = []; for(let n=1;n<=max;n++) if(!byVol.has(n)) missing.push(n);
    const readN = items.filter(i=>i.status==="read").length;
    const cells = [];
    for(let n=1;n<=Math.min(max,300);n++){
      const it = byVol.get(n);
      cells.push(it ? `<button class="vc own ${it.status==="read"?"read":""} ${isLent(it)?"lent":""}" data-edit="${esc(it.id)}" title="${n}巻 ${esc((STATUS[it.status||"unread"]||STATUS.unread).label)}${isLent(it)?" / 貸出中":""}">${n}</button>`
                    : `<span class="vc" title="${n}巻 未所持">${n}</span>`);
    }
    cells.push(`<span class="vc next" title="次に買う巻">${max+1}</span>`);
    const author = items.find(i=>i.author)?.author || items.find(i=>i.circle)?.circle || "";
    return `<section class="srow" style="--c:${c}">
      <div class="h"><b>${esc(name)}</b><span class="m">${esc(author)}${author?" ・ ":""}${items.length}冊所持 ・ 読了 ${readN}/${items.length}</span>
      ${missing.length?`<span class="gap">抜け: ${missing.length>12?missing.slice(0,12).join(", ")+" ほか":missing.join(", ")}巻</span>`:`<span class="m">1〜${max}巻 揃い</span>`}</div>
      <div class="vols">${cells.join("")}</div>
      ${extra.length?`<div class="tags">${extra.map(i=>`<button class="tag" data-edit="${esc(i.id)}" style="background:none;cursor:pointer">${esc(i.title||"巻数なし")}</button>`).join("")}</div>`:""}
    </section>`;
  });
  return `<div class="legend"><span><i style="background:var(--manga);border-color:var(--manga)"></i>読了</span><span><i style="background:color-mix(in srgb,var(--manga) 22%,var(--surface))"></i>所持・未読</span><span><i style="box-shadow:inset 0 -3px 0 var(--lent)"></i>貸出中</span><span><i style="border-style:dashed"></i>次巻</span><span><i></i>未所持</span></div><div class="series">${rows.join("")}</div>`;
}
const find = id => S.items.find(i=>i.id===id);
function bindView(){
  $("#view").querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>openEdit(b.dataset.edit));
  $("#view").querySelectorAll("[data-cycle]").forEach(b=>b.onclick=()=>{
    const it = find(b.dataset.cycle); if(!it) return;
    const next = it.status==="read" ? "unread" : it.status==="reading" ? "read" : "reading";
    patchItem(it, {status:next, readAt: next==="read" ? (it.readAt||today()) : (next==="unread" ? "" : it.readAt||"")}, `「${it.title||"書誌待ち"}」を${STATUS[next].label}にしました`);
  });
  $("#view").querySelectorAll("[data-ret]").forEach(b=>b.onclick=()=>{
    const it = find(b.dataset.ret); if(!it) return;
    patchItem(it, {lentTo:"", lentAt:""}, `「${it.title}」を返却済みにしました`);
  });
}
const uniq = key => [...new Set(S.items.map(i=>i[key]).filter(Boolean).map(s=>String(s).trim()))].sort((a,b)=>a.localeCompare(b,"ja"));
function fillDatalists(){
  const map = {dlSeries:"series",dlLoc:"location",dlCircle:"circle",dlEvent:"event",dlGenre:"genre",dlLent:"lentTo"};
  for(const [id,key] of Object.entries(map)) $("#"+id).innerHTML = uniq(key).slice(0,200).map(v=>`<option value="${esc(v)}">`).join("");
}
function setTab(t){S.tab=t;document.querySelectorAll("#tabs button").forEach(b=>b.setAttribute("aria-selected",String(b.dataset.tab===t)));render()}
document.querySelectorAll("#tabs button").forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
let qT; $("#q").addEventListener("input",e=>{clearTimeout(qT);qT=setTimeout(()=>{S.q=e.target.value;render()},120)});
$("#sort").onchange=e=>{S.sort=e.target.value;store.set("bunko.sort",S.sort);render()};

/* ================= 編集 ================= */
const editDlg = $("#editDlg"); let editing = null, editKind = "book", editStatus = "unread", dupOk = null;
function segButtons(el, entries, cur, onPick){
  el.innerHTML = entries.map(([k,v])=>`<button type="button" data-v="${k}" aria-pressed="${k===cur}">${v.color?`<span class="dot" style="background:${v.color}"></span>`:""}${v.label}</button>`).join("");
  el.querySelectorAll("button").forEach(b=>b.onclick=()=>{el.querySelectorAll("button").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));onPick(b.dataset.v)});
}
function applyKind(){
  editDlg.querySelectorAll("[data-for]").forEach(f=>f.hidden=!f.dataset.for.split(" ").includes(editKind));
  $("#lAuthor").textContent = editKind==="doujin" ? "作家・ペンネーム" : "著者";
}
function openEdit(id){
  const it = id ? find(id) : null;
  editing = it;
  editKind = it?.kind || store.get("bunko.lastKind","book");
  editStatus = it?.status || "unread";
  $("#editTitle").textContent = it ? (it.title ? "本を編集" : "書誌を入力") : "本を登録";
  segButtons($("#kindSeg"), Object.entries(KINDS), editKind, k=>{editKind=k;applyKind()});
  segButtons($("#statusSeg"), Object.entries(STATUS), editStatus, s=>{editStatus=s; if(s==="read"&&!$("#fReadAt").value) $("#fReadAt").value=today()});
  const f = $("#editForm");
  for(const n of ["title","author","publisher","circle","event","genre","series","vol","isbn","location","readAt","lentTo","lentAt","note"]) f.elements[n].value = it?.[n] ?? "";
  if(!it) f.elements.location.value = store.get("bunko.lastLoc","");
  f.elements.isbn.value = it?.isbn ? fmtIsbn(it.isbn) : "";
  f.elements.tags.value = (it?.tags||[]).join(" ");
  $("#delBtn").hidden = !it;
  dupOk = null; resetDel(); applyKind();
  editDlg.showModal();
  if(!it) setTimeout(()=>$("#fTitle").focus(),30);
}
$("#returnBtn").onclick=()=>{$("#fLentTo").value="";$("#fLentAt").value=""};
$("#fLentTo").addEventListener("input",e=>{if(e.target.value && !$("#fLentAt").value) $("#fLentAt").value=today()});
$("#lookupBtn").onclick = async ()=>{
  const isbn = toIsbn13($("#fIsbn").value);
  if(!isbn){ toast("ISBNを正しく入れてください"); return }
  const b = $("#lookupBtn"); b.disabled = true; b.innerHTML = `<span class="spin"></span>`;
  const m = await lookup(isbn);
  b.disabled = false; b.textContent = "取得";
  if(!m){ toast("書誌が見つかりませんでした"); return }
  const f = $("#editForm").elements;
  f.title.value = m.title; if(m.author) f.author.value = m.author; if(m.publisher) f.publisher.value = m.publisher;
  if(m.series && !f.series.value) f.series.value = m.series; if(m.vol && !f.vol.value) f.vol.value = m.vol;
  const tags = new Set(f.tags.value.split(/\s+/).filter(Boolean)); metaTags(m).forEach(t=>tags.add(t)); f.tags.value=[...tags].join(" ");
  if(!editing){ editKind = guessKind(m, "auto"); segButtons($("#kindSeg"), Object.entries(KINDS), editKind, k=>{editKind=k;applyKind()}); applyKind(); }
  toast("書誌を入れました。確認して保存してください");
};
$("#editForm").addEventListener("submit", async e=>{
  e.preventDefault();
  const f = e.target.elements;
  const isbnRaw = f.isbn.value.trim();
  const isbn = isbnRaw ? toIsbn13(isbnRaw) : "";
  if(isbnRaw && !isbn){toast("ISBNの形式が正しくありません（13桁または10桁）");f.isbn.focus();return}
  const title = f.title.value.trim();
  if(!title && !isbn){toast("タイトルかISBNを入れてください");f.title.focus();return}
  if(!editing && isbn){
    const dup = S.items.find(i=>i.isbn===isbn);
    if(dup && dupOk!==isbn){ dupOk = isbn; toast(`「${dup.title||fmtIsbn(isbn)}」は登録済みです。もう1冊登録するなら、もう一度「保存」を押してください`); return }
  }
  const volRaw = f.vol.value.trim();
  const data = {
    ...(editing?stripId(editing):{}),
    kind:editKind, title, author:f.author.value.trim(), series:cleanSeries(f.series.value),
    vol: volRaw===""?null:Number(volRaw), isbn: isbn||"", location:f.location.value.trim(),
    status:editStatus, readAt: editStatus==="read" ? (f.readAt.value||today()) : f.readAt.value,
    tags: f.tags.value.split(/[\s　,、]+/).map(s=>s.replace(/^#/,"")).filter(Boolean),
    lentTo:f.lentTo.value.trim(), lentAt:f.lentTo.value.trim()?(f.lentAt.value||today()):"",
    note:f.note.value.trim(),
    publisher: editKind!=="doujin" ? f.publisher.value.trim() : (editing?.publisher||""),
    circle: editKind==="doujin" ? f.circle.value.trim() : (editing?.circle||""),
    event: editKind==="doujin" ? f.event.value.trim() : (editing?.event||""),
    genre: editKind==="doujin" ? f.genre.value.trim() : (editing?.genre||""),
    needsInfo: !title,
    createdAt: editing?.createdAt || Date.now(), updatedAt: Date.now()
  };
  $("#saveBtn").disabled = true;
  const ok = await saveItem(editing?.id, data);
  $("#saveBtn").disabled = false;
  if(ok){store.set("bunko.lastKind",editKind); if(data.location) store.set("bunko.lastLoc",data.location); editDlg.close(); toast(editing?"保存しました":`「${title||fmtIsbn(isbn)}」を登録しました`)}
});
let delArm = null, delTimer = null;
function resetDel(){ clearTimeout(delTimer); delArm = null; const b=$("#delBtn"); b.textContent="削除"; b.classList.remove("armed") }
$("#delBtn").onclick = async ()=>{
  if(!editing) return;
  const b = $("#delBtn");
  if(delArm !== editing.id){ delArm = editing.id; b.textContent = "もう一度押すと削除"; b.classList.add("armed"); delTimer = setTimeout(resetDel, 6000); return }
  resetDel(); b.disabled = true;
  try{ await deleteDoc(itemRef(editing.id)); editDlg.close(); toast(`「${editing.title||fmtIsbn(editing.isbn)}」を削除しました`) }
  catch(e){ toast(errMsg(e)) } finally{ b.disabled = false }
};
editDlg.addEventListener("close", ()=>{ resetDel(); dupOk = null });
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>b.closest("dialog").close());
$("#addBtn").onclick = ()=>openEdit(null);

/* ================= スキャン ================= */
const scanDlg = $("#scanDlg"); let scanKind = "auto", scanStatus = "unread";
function logScan(isbn, text, cls){
  const d = document.createElement("div"); if(cls) d.className = cls;
  d.innerHTML = `<span class="mono">${esc(fmtIsbn(isbn))}</span><span class="ti">${esc(text)}</span>`;
  $("#scanLog").prepend(d); return d;
}
let actx=null;
function beep(ok){try{actx ||= new (window.AudioContext||window.webkitAudioContext)();const o=actx.createOscillator(),g=actx.createGain();o.frequency.value=ok?1320:330;g.gain.value=.06;o.connect(g);g.connect(actx.destination);o.start();o.stop(actx.currentTime+(ok?.08:.2))}catch{}}
const recent = new Map();
async function registerIsbn(raw, quiet){
  const isbn = toIsbn13(raw);
  if(!isbn){
    if(/^19[12]/.test(String(raw).replace(/\D/g,""))) $("#scanMsg").textContent="それは価格用の下段バーコードです。上段（978〜）を読み取ってください。";
    else if(!quiet) toast("ISBNの形式が正しくありません");
    return false;
  }
  const now = Date.now(); if(recent.has(isbn) && now-recent.get(isbn) < 5000) return false; recent.set(isbn, now);
  const dup = S.items.find(i=>i.isbn===isbn);
  if(dup){ logScan(isbn, `所持済み: ${dup.title||"書誌待ち"}（${dup.location||"場所未設定"}）`, "warn"); beep(false); return false }
  const loc = $("#scanLoc").value.trim(); store.set("bunko.lastLoc", loc);
  const ref = doc(itemsCol());
  const base = {kind: scanKind==="auto"?"book":scanKind, title:"", author:"", publisher:"", series:"", vol:null, isbn,
    location:loc, status:scanStatus, readAt:scanStatus==="read"?today():"", needsInfo:true, tags:[], createdAt:Date.now(), updatedAt:Date.now()};
  const line = logScan(isbn, "登録しました。書誌を調べています…");
  beep(true); if(navigator.vibrate) try{navigator.vibrate(60)}catch{}
  setDoc(ref, base).catch(e=>{ line.className="warn"; line.querySelector(".ti").textContent = errMsg(e) });
  const m = await lookup(isbn);
  if(m){
    await updateDoc(ref, clean({title:m.title, author:m.author, publisher:m.publisher, series:m.series, vol:m.vol, tags:metaTags(m), kind:guessKind(m, scanKind), needsInfo:false, updatedAt:Date.now()})).catch(()=>{});
    line.className = "ok"; line.querySelector(".ti").textContent = `${m.title}${m.author?` ／ ${m.author}`:""}`;
    $("#scanMsg").textContent = `「${m.title}」を登録しました。続けてどうぞ。`;
  }else{
    line.className = "warn"; line.querySelector(".ti").textContent = "書誌が見つかりませんでした（書誌待ちとして登録）";
  }
  return true;
}
let stream=null, detector=null, timer=null, zxing=null;
async function getDetector(){
  if("BarcodeDetector" in window){ try{ const f = await BarcodeDetector.getSupportedFormats(); if(f.includes("ean_13")) return new BarcodeDetector({formats:["ean_13"]}) }catch{} }
  return null;
}
function loadScript(src){return new Promise((res,rej)=>{const s=document.createElement("script");s.src=src;s.onload=res;s.onerror=rej;document.head.appendChild(s)})}
async function getZxing(){
  if(zxing) return zxing;
  await loadScript("https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js").catch(()=>loadScript("https://cdnjs.cloudflare.com/ajax/libs/zxing-library/0.21.3/umd/index.min.js"));
  const hints = new Map(); hints.set(2, [ZXing.BarcodeFormat.EAN_13]);
  zxing = new ZXing.BrowserMultiFormatReader(hints); return zxing;
}
async function startCam(){
  $("#scanMsg").textContent = "カメラを起動しています…";
  try{ stream = await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:960}}}) }
  catch(e){
    const n=e?.name||"";
    $("#scanMsg").textContent = n==="NotAllowedError" ? "カメラが拒否されました。アドレスバーの鍵マークから、このページのカメラを許可してください。"
      : n==="NotFoundError" ? "カメラが見つかりませんでした。「写真から読み取る」をお使いください。" : "カメラを起動できませんでした。「写真から読み取る」をお使いください。";
    return;
  }
  const v=$("#video"); v.srcObject=stream; await v.play().catch(()=>{});
  $("#stage").hidden=false; $("#camBtn").textContent="カメラを止める";
  $("#scanMsg").textContent = "バーコードを枠に入れてください。読み取ると自動で登録します。";
  detector = await getDetector();
  if(!detector){ try{ await getZxing() }catch{ $("#scanMsg").textContent="読み取りエンジンを読み込めませんでした。通信できる状態で開き直してください。" } }
  loop();
}
function stopCam(){ clearTimeout(timer); timer=null; if(stream){ stream.getTracks().forEach(t=>t.stop()); stream=null } $("#video").srcObject=null; $("#stage").hidden=true; $("#camBtn").textContent="カメラで読み取る" }
async function loop(){
  if(!stream) return;
  const v=$("#video");
  try{
    if(detector){ const codes = await detector.detect(v); for(const c of codes) registerIsbn(c.rawValue, true) }
    else if(zxing){ const cv=document.createElement("canvas"); cv.width=v.videoWidth; cv.height=v.videoHeight;
      if(cv.width){ cv.getContext("2d").drawImage(v,0,0); try{ const r = await zxing.decodeFromCanvas(cv); if(r) registerIsbn(r.getText(), true) }catch{} } }
  }catch{}
  timer = setTimeout(loop, 220);
}
$("#camBtn").onclick = ()=> stream ? stopCam() : startCam();
$("#photoBtn").onclick = ()=> $("#photoInp").click();
$("#photoInp").onchange = async e=>{
  const files=[...(e.target.files||[])]; e.target.value=""; if(!files.length) return;
  let ok=0; const det = detector || await getDetector();
  for(const [i,f] of files.entries()){
    $("#scanMsg").textContent = `画像を解析しています… (${i+1}/${files.length})`;
    try{
      let code=null;
      if(det){ const bmp = await createImageBitmap(f); const r = await det.detect(bmp); code = r[0]?.rawValue || null; bmp.close?.() }
      if(!code){ const z = await getZxing(); const url = URL.createObjectURL(f); try{ const res = await z.decodeFromImageUrl(url); code = res?.getText() }finally{ URL.revokeObjectURL(url) } }
      if(code && await registerIsbn(code,true)) ok++;
    }catch{}
  }
  $("#scanMsg").textContent = `${files.length}枚中 ${ok}枚を登録しました。${ok<files.length?"読めなかった写真は、バーコードが大きく写るように撮り直してください。":""}`;
};
$("#manualAdd").onclick = async ()=>{
  const raw = $("#manualIsbn").value;
  const toks = (raw.match(/[0-9][0-9Xx\- ]{8,20}[0-9Xx]/g)||[]).map(t=>t.trim());
  if(!toks.length){ toast("ISBNが見つかりませんでした"); return }
  const bad=[]; let n=0;
  for(const t of toks){ if(toIsbn13(t)){ if(await registerIsbn(t)) n++ } else bad.push(t) }
  $("#manualIsbn").value = bad.join("\n");
  $("#scanMsg").textContent = `${n}冊を登録しました${bad.length?`（${bad.length}件は形式が正しくありません）`:""}`;
};
$("#scanBtn").onclick = ()=>{
  scanKind = store.get("bunko.scanKind","auto");
  segButtons($("#scanKindSeg"), [["auto",{label:"自動判定"}],...Object.entries(KINDS).filter(([k])=>k!=="doujin")], scanKind, k=>{scanKind=k;store.set("bunko.scanKind",k)});
  segButtons($("#scanStatusSeg"), Object.entries(STATUS), scanStatus, s=>scanStatus=s);
  $("#scanLoc").value = store.get("bunko.lastLoc","");
  $("#scanLog").innerHTML = ""; recent.clear();
  scanDlg.showModal();
  startCam();
};
scanDlg.addEventListener("close", stopCam);
document.addEventListener("visibilitychange",()=>{ if(document.hidden) stopCam() });

async function refetchPending(){
  const list = S.items.filter(i=>i.needsInfo && i.isbn);
  if(!list.length){ toast("書誌待ちの本はありません"); return }
  toast(`${list.length}冊の書誌を調べています…`);
  let ok=0;
  for(const it of list){
    const m = await lookup(it.isbn);
    if(m){ ok++; await updateDoc(itemRef(it.id), clean({title:m.title, author:it.author||m.author, publisher:it.publisher||m.publisher, series:it.series||m.series, vol:it.vol??m.vol, tags:[...new Set([...(it.tags||[]), ...metaTags(m)])], needsInfo:false, updatedAt:Date.now()})).catch(()=>{}) }
  }
  toast(`${list.length}冊中 ${ok}冊の書誌が見つかりました`);
}

/* ================= メニュー・共有・入出力 ================= */
const menu = $("#menu");
$("#menuBtn").onclick = e=>{ e.stopPropagation(); menu.hidden = !menu.hidden; $("#menuBtn").setAttribute("aria-expanded", String(!menu.hidden)) };
document.addEventListener("click", e=>{ if(!menu.hidden && !menu.contains(e.target)) menu.hidden = true });
$("#mLogout").onclick = ()=>{ menu.hidden=true; signOut(auth) };
$("#mRefetch").onclick = ()=>{ menu.hidden=true; refetchPending() };
$("#mMyLib").onclick = ()=>{ menu.hidden=true; history.replaceState(null,"",location.pathname); openLibrary(S.user.uid) };
$("#mExport").onclick = ()=>{
  menu.hidden=true;
  const cols = ["kind","title","series","vol","author","publisher","circle","event","genre","isbn","location","status","readAt","lentTo","lentAt","tags","note"];
  const head = ["種類","タイトル","シリーズ","巻","著者","出版社","サークル","イベント","ジャンル","ISBN","保管場所","状況","読了日","貸出先","貸出日","タグ","メモ"];
  const cell = v => { v = Array.isArray(v) ? v.join(" ") : (v ?? ""); v = String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v };
  const rows = S.items.map(i=>cols.map(c=>cell(c==="kind"?KINDS[i.kind]?.label:c==="status"?(STATUS[i.status||"unread"]||STATUS.unread).label:i[c])).join(","));
  const blob = new Blob(["﻿"+[head.join(","),...rows].join("\r\n")], {type:"text/csv"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `田畑文庫_${today()}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href), 2000);
};
$("#mImport").onclick = ()=>{ menu.hidden=true; $("#importMsg").textContent=""; $("#importDlg").showModal() };
$("#importGo").onclick = async ()=>{
  let arr;
  try{ arr = JSON.parse($("#importText").value); if(!Array.isArray(arr)) throw 0 }catch{ $("#importMsg").textContent = "JSONの配列として読めませんでした"; return }
  const allowed = ["kind","title","author","publisher","series","vol","isbn","location","status","readAt","lentTo","lentAt","note","tags","circle","event","genre","needsInfo","createdAt","updatedAt"];
  let n=0;
  for(let i=0;i<arr.length;i+=400){
    const batch = writeBatch(db);
    for(const it of arr.slice(i,i+400)){
      if(!it || typeof it!=="object") continue;
      const data = {}; for(const k of allowed) if(it[k]!==undefined) data[k]=it[k];
      if(!data.kind || !KINDS[data.kind]) data.kind="book";
      const id = typeof it._id==="string" && /^[A-Za-z0-9_-]{1,100}$/.test(it._id) ? it._id : (typeof it.id==="string" && /^[A-Za-z0-9_-]{1,100}$/.test(it.id) ? it.id : doc(itemsCol()).id);
      batch.set(itemRef(id), clean(data)); n++;
    }
    try{ await batch.commit() }catch(e){ $("#importMsg").textContent = errMsg(e); return }
  }
  $("#importMsg").textContent = `${n}冊を取り込みました`; $("#importText").value=""; toast(`${n}冊を取り込みました`);
};
function inviteUrl(){ return `${location.origin}${location.pathname}?lib=${encodeURIComponent(S.libId)}` }
function renderMembers(){
  const owner = isOwner();
  const mem = (S.lib?.members||[]);
  $("#members").innerHTML = mem.map(m=>`<div><span>${esc(m)}${m===S.lib?.ownerEmail?"（持ち主）":""}</span>${owner && m!==S.lib?.ownerEmail?`<button class="mini" data-rm="${esc(m)}">外す</button>`:""}</div>`).join("");
  $("#members").querySelectorAll("[data-rm]").forEach(b=>b.onclick=async()=>{ try{ await updateDoc(doc(db,"libraries",S.libId),{members:arrayRemove(b.dataset.rm)}); toast("外しました") }catch(e){ toast(errMsg(e)) } });
  $("#addMemberRow").hidden = !owner;
  $("#shareNote").textContent = owner ? "ここに追加したGoogleアカウントの人は、この台帳を見て編集できます。追加したら招待リンクを送ってください。" : "この台帳の持ち主だけがメンバーを変更できます。";
  $("#inviteLink").value = inviteUrl();
}
$("#mShare").onclick = ()=>{ menu.hidden=true; renderMembers(); $("#shareDlg").showModal() };
$("#addMember").onclick = async ()=>{
  const email = $("#memberEmail").value.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ toast("メールアドレスを正しく入れてください"); return }
  try{ await updateDoc(doc(db,"libraries",S.libId),{members:arrayUnion(email)}); $("#memberEmail").value=""; toast(`${email} を追加しました`) }catch(e){ toast(errMsg(e)) }
};
$("#copyInvite").onclick = async ()=>{ try{ await navigator.clipboard.writeText(inviteUrl()); toast("招待リンクをコピーしました") }catch{ $("#inviteLink").select(); toast("リンクを選択しました。コピーしてください") } };

/* ================= ログイン・台帳 ================= */
function showGate(msg){
  $("#gate").hidden=false; $("#appMain").hidden=true; $("#fab").hidden=true; $("#tabs").hidden=true; $("#menuWrap").hidden=true; $("#libName").hidden=true;
  if(msg) $("#gateMsg").textContent = msg;
}
function showApp(){ $("#gate").hidden=true; $("#appMain").hidden=false; $("#fab").hidden=false; $("#tabs").hidden=false; $("#menuWrap").hidden=false }
$("#loginBtn").onclick = async ()=>{
  const provider = new GoogleAuthProvider(); provider.setCustomParameters({prompt:"select_account"});
  try{ await signInWithPopup(auth, provider) }
  catch(e){
    if(/popup-blocked|operation-not-supported|popup-closed-by-user/.test(e?.code||"") && e.code!=="auth/popup-closed-by-user") { await signInWithRedirect(auth, provider) }
    else if(e?.code!=="auth/popup-closed-by-user" && e?.code!=="auth/cancelled-popup-request") toast("ログインできませんでした: "+(e?.code||""));
  }
};
getRedirectResult(auth).catch(()=>{});

async function openLibrary(libId){
  if(unsubItems) unsubItems(); if(unsubLib) unsubLib();
  S.items=[]; S.loaded=false; S.libId=libId; S.lib=null; render();
  const u = S.user; const email = (u.email||"").toLowerCase();
  const libRef = doc(db,"libraries",libId);
  let snap;
  try{ snap = await getDoc(libRef) }
  catch(e){
    if(libId!==u.uid){ toast("この台帳には招待されていません。自分の台帳を開きます"); history.replaceState(null,"",location.pathname); return openLibrary(u.uid) }
    toast(errMsg(e)); return;
  }
  if(!snap.exists()){
    if(libId!==u.uid){ toast("台帳が見つかりませんでした。自分の台帳を開きます"); history.replaceState(null,"",location.pathname); return openLibrary(u.uid) }
    try{ await setDoc(libRef, {owner:u.uid, ownerEmail:email, members:[email], name:"田畑文庫", createdAt:Date.now()}) }
    catch(e){ toast(errMsg(e)); return }
  }
  setDoc(doc(db,"users",u.uid), {lastLib:libId, email}, {merge:true}).catch(()=>{});
  unsubLib = onSnapshot(libRef, s=>{ S.lib = s.data()||null; const own = isOwner();
    $("#libName").hidden = own; $("#libName").textContent = own ? "" : `${S.lib?.ownerEmail||"共有"} の台帳`;
    $("#mMyLib").hidden = own; if(!$("#shareDlg").hidden) renderMembers() }, ()=>{});
  unsubItems = onSnapshot(itemsCol(), snap=>{
    S.items = snap.docs.map(d=>({id:d.id, ...d.data()})); S.loaded = true; render();
  }, e=>{ S.loaded = true; render(); toast(errMsg(e)) });
}
onAuthStateChanged(auth, async user=>{
  S.user = user;
  if(!user){ if(unsubItems) unsubItems(); if(unsubLib) unsubLib(); showGate(); return }
  showApp();
  $("#whoName").textContent = user.displayName || user.email;
  if(user.photoURL){ $("#avatar").src = user.photoURL; $("#avatar").hidden = false }
  const param = new URLSearchParams(location.search).get("lib");
  let libId = param;
  if(!libId){ try{ libId = (await getDoc(doc(db,"users",user.uid))).data()?.lastLib }catch{} }
  openLibrary(libId || user.uid);
});
