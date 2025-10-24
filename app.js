// ====== CONFIG FISSI ======
const DEFAULT_BASE_URL = "https://audio-hub.audio-elettrobonatese-1cf.workers.dev";
const DEFAULT_DEVICE   = "PC-MainStreet";
const DEFAULT_TZ       = "Europe/Rome";
const QUOTA_MB_LIMIT   = 20000; // 20 GB

// ====== STATO APP ======
const S = {
  baseUrl: DEFAULT_BASE_URL,
  device:  DEFAULT_DEVICE,
  user:    localStorage.getItem("user") || "",
  pass:    localStorage.getItem("pass") || "",
  authed:  false,

  // Player/State
  timerState: null,
  seeking: false,
  loopMode: "off", // "off" | "playlist" | "one"

  // Files / Quota
  r2Items: [],
  totalBytes: 0,

  // Playlist Editor
  currentPl: null,
  plChosen: [],
  plAvail:  [],
  selAvailIdx: null,
  selChosenIdx: null,
  playlistsCache: [],

  // Scheduler
  schedules: [],
  schedEditingId: null
};

const $  = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);

// ====== UI LOADER ======
function showLoader(on = true) {
  const el = $("#uploadOverlay");
  if (!el) return;
  el.style.display = on ? "flex" : "none";
}

function safeIcons(){
  try {
    if (window.lucide && typeof window.lucide.createIcons === "function" && window.lucide.icons) {
      window.lucide.createIcons();
    }
  } catch(e){ /* noop */ }
}

// ====== HELPERS ======
function setAuthed(ok){
  S.authed = !!ok;
  document.body.classList.toggle("locked", !S.authed);
  $("#btnLogin").innerHTML = S.authed
    ? `<i data-lucide="log-out"></i> Logout`
    : `<i data-lucide="log-in"></i> Login`;
  try { safeIcons(); } catch {}
}
function authHeaders(){
  const tok = btoa(`${S.user}:${S.pass}`);
  return { Authorization: `Basic ${tok}` };
}
async function api(path, {method="GET", headers={}, body}={}){
  const url = S.baseUrl.replace(/\/$/,"") + path;
  const res = await fetch(url, { method, headers: { ...authHeaders(), ...headers }, body });
  if (res.status === 401) {
    setAuthed(false);
    openLogin(true);
  }
  const txt = await res.text();
  let data = null; try{ data = JSON.parse(txt); }catch{ data = { raw: txt }; }
  if(!res.ok) throw Object.assign(new Error(data?.reason || txt || res.statusText), { status:res.status, data });
  return data;
}
function fmtTime(sec){
  sec = Math.max(0, ~~sec);
  const m = ~~(sec/60), s = sec%60;
  return `${m}:${String(s).padStart(2,"0")}`;
}
function setTopStatus(t, ok=true){
  const el = $("#topStatus");
  el.textContent = t;
  el.className = ok ? "ok" : "err";
}
function highlightRow(el, on){
  el.style.background = on ? "#15233b" : "";
  el.style.borderColor = on ? "#26436f" : "";
}
function normalizeDays(arr){
  const order = ["mon","tue","wed","thu","fri","sat","sun"];
  const set = new Set(arr.map(x=>x.toLowerCase()));
  return order.filter(d=>set.has(d)).join(",");
}
function daysToHuman(str){
  const map = {mon:"Lun",tue:"Mar",wed:"Mer",thu:"Gio",fri:"Ven",sat:"Sab",sun:"Dom"};
  return (str||"").split(",").map(x=>map[x]||x).join(", ");
}
function pad2(n){ return String(n).padStart(2,"0"); }
function toMB(bytes){ return (bytes/1024/1024); }
function fmtMB(bytes){ return `${toMB(bytes).toFixed(2)} MB`; }
function updateQuotaUi(){
  const usedMB = toMB(S.totalBytes);
  const pct = Math.min(100, (usedMB / QUOTA_MB_LIMIT) * 100);
  $("#quotaText").textContent = `${usedMB.toFixed(2)} / ${QUOTA_MB_LIMIT} MB`;
  $("#quotaBar").style.width = `${pct}%`;
}

// ====== LOGIN MODAL ======
const loginWrap = $("#loginWrap");
function openLogin(force=false){
  $("#lgUser").value = S.user || "admin";
  $("#lgPass").value = S.pass || "";
  $("#lgInfo").textContent = `Worker: ${S.baseUrl} · Device: ${S.device}`;
  loginWrap.classList.add("show");
  setAuthed(false);
  $("#lgClose").style.visibility = S.authed ? "visible" : "hidden";
  if (!S.authed && !force && S.user && S.pass) {
    setTimeout(() => $("#lgEnter").click(), 50);
  }
}
function closeLogin(){
  if (!S.authed) return;
  loginWrap.classList.remove("show");
  $("#lgClose").style.visibility = "visible";
}
$("#btnLogin").onclick = () => {
  if (S.authed) {
    S.user = ""; S.pass = "";
    localStorage.removeItem("user");
    localStorage.removeItem("pass");
    setAuthed(false);
    openLogin(true);
  } else {
    openLogin(true);
  }
};
$("#lgClose").onclick  = closeLogin;
$("#lgEnter").onclick  = async () => {
  S.user = $("#lgUser").value.trim();
  S.pass = $("#lgPass").value;
  try{
    await api("/api/ping");
    const st = await api(`/api/devices/${encodeURIComponent(S.device)}/status`);
    setAuthed(true);
    setTopStatus(`OK · device ${S.device} connected=${st.connected}`, true);
    localStorage.setItem("user", S.user);
    localStorage.setItem("pass", S.pass);
    closeLogin();
    await bootstrapAfterLogin();
  }catch(e){
    setAuthed(false);
    setTopStatus("Errore login/API", false);
    $("#lgInfo").textContent = "Credenziali errate o Worker non raggiungibile.";
    console.error(e);
  }
};
$("#lgPass").addEventListener("keydown", (ev)=>{
  if (ev.key === "Enter") $("#lgEnter").click();
});

// ====== BOOT ======
async function bootstrapAfterLogin(){
  if (!S.authed) return;
  await loadPlaylists();
  await listFiles();
  await loadSchedules();
  if(!S.timerState){
    S.timerState = setInterval(refreshState, 1000);
  }
}
window.addEventListener("load", () => { openLogin(false); });

// ====== PLAYER CONTROLS ======
async function cmd(p){
  if (!S.authed) return openLogin(true);
  return api(`/api/cmd/${p}?device=${encodeURIComponent(S.device)}`, { method:"POST" });
}
$("#btnPlay").onclick  = () => cmd("play");
$("#btnPause").onclick = () => cmd("pause");
$("#btnStop").onclick  = () => cmd("stop");
$("#btnPrev").onclick  = () => cmd("prev");
$("#btnNext").onclick  = () => cmd("next");
$("#btnClear").onclick = () => cmd("clear");

// (volume, loop, refreshState — invariati dal tuo file originale)

// ====== STATO / NOW PLAYING ======
async function refreshState(){
  if (!S.authed) return;
  try{
    const st = await api(`/api/state/get?device=${encodeURIComponent(S.device)}`);
    const info = st?.state || st;

    const state = (info?.state || "").toLowerCase();
    const playing = state === "playing";

    const playBtn  = $("#btnPlay");
    const pauseBtn = $("#btnPause");

    if (playing) {
      playBtn.style.display = "none";
      pauseBtn.style.display = "inline-flex";
      pauseBtn.classList.add("primary");
      playBtn.classList.remove("primary");
    } else {
      pauseBtn.style.display = "none";
      playBtn.style.display = "inline-flex";
      playBtn.classList.add("primary");
      pauseBtn.classList.remove("primary");
    }

    const cur = info?.time ?? 0;
    const len = info?.length ?? Math.max(cur, 0);
    if(!S.seeking){
      $("#timeCur").textContent = fmtTime(cur);
      $("#timeTot").textContent = fmtTime(len);
      const seekBar = $("#seekBar");
      seekBar.max = len || 0;
      seekBar.value = cur || 0;
    }

    $("#trkState").textContent = `stato: ${state || "—"}`;
    const meta = info?.information?.category?.meta || {};
    const title = meta.title || meta.filename || "—";
    $("#trkTitle").textContent = title;

    const lastPl = st?.last_playlist || "—";
    $("#nowPl").textContent = `playlist: ${lastPl}`;

    const repeatOn = !!info?.repeat;
    const loopOn   = !!info?.loop;
    let mode = "off";
    if (loopOn) mode = "playlist";
    else if (repeatOn) mode = "one";
    S.loopMode = mode;
    updateLoopVisual(mode);
  }catch(e){
    console.warn("refreshState error", e);
  }
}


// ====== FILES (R2) CON PAGINAZIONE ======
async function listFiles(page = 1, perPage = 10){
  if (!S.authed) return;
  const r = await api(`/api/files/list?prefix=&limit=1000`);
  S.r2Items = (r.items || []).slice().sort((a,b)=>
    a.key.localeCompare(b.key, 'it', {sensitivity:'base'})
  );
  S.totalBytes = S.r2Items.reduce((acc, x)=>acc + (x.size||0), 0);
  $("#r2Count").textContent = `${S.r2Items.length} oggetti`;
  updateQuotaUi();

  // PAGINAZIONE
  const totalPages = Math.ceil(S.r2Items.length / perPage);
  page = Math.max(1, Math.min(totalPages, page));
  const start = (page - 1) * perPage;
  const items = S.r2Items.slice(start, start + perPage);

  const rows = items.map(x=>`
    <tr>
      <td>${x.key}</td>
      <td class="muted">${fmtMB(x.size)}</td>
      <td><button data-key="${x.key}" class="pill play primary"><i data-lucide="play"></i> Play</button></td>
      <td><button data-key="${x.key}" class="pill warn del"><i data-lucide="trash-2"></i> Elimina</button></td>
    </tr>`).join("");

  // Mostra tabella + controlli
  $("#r2Table").innerHTML = `
    <tr><th>Key</th><th>Size</th><th></th><th></th></tr>
    ${rows}
  `;

// Footer con bottoni pagina (rimuove eventuali precedenti)
document.querySelectorAll(".pagination-controls").forEach(el => el.remove());

const pagination = document.createElement("div");
pagination.className = "row pagination-controls";
pagination.style.marginTop = "12px";
pagination.style.justifyContent = "center";
pagination.innerHTML = `
  <button id="pagePrev" class="pill" ${page===1?"disabled":""}>← Prev</button>
  <span class="muted" style="margin:0 8px">Pagina ${page} / ${totalPages}</span>
  <button id="pageNext" class="pill" ${page===totalPages?"disabled":""}>Next →</button>
`;
$("#r2Table").after(pagination);


  safeIcons();

  // Eventi pulsanti pagina
  $("#pagePrev")?.addEventListener("click", ()=> listFiles(page-1, perPage));
  $("#pageNext")?.addEventListener("click", ()=> listFiles(page+1, perPage));

  // Eventi Play / Elimina
  $$("#r2Table .play").forEach(b=> b.onclick = async ()=>{
    if (!S.authed) return openLogin(true);
    const key = b.dataset.key;
    await api(`/api/cmd/clear?device=${encodeURIComponent(S.device)}`, { method:"POST" }).catch(()=>{});
    await api(`/api/cmd/enqueue-r2?device=${encodeURIComponent(S.device)}&r2_key=${encodeURIComponent(key)}`, { method:"POST" });
    await api(`/api/cmd/play?device=${encodeURIComponent(S.device)}`, { method:"POST" });
  });

  $$("#r2Table .del").forEach(b=> b.onclick = async ()=>{
    if (!S.authed) return openLogin(true);
    if(!confirm(`Eliminare ${b.dataset.key}?`)) return;
    await api(`/api/files/delete?r2_key=${encodeURIComponent(b.dataset.key)}`, { method:"DELETE" });
    await listFiles(page, perPage);
  });
}

// ====== UPLOAD FILES (R2) ======
$("#filesUploadBtn").onclick = async () => {
  if (!S.authed) return openLogin(true);
  const f = $("#filesUpload").files?.[0];
  if (!f) return alert("Seleziona un file da caricare.");

  const wouldMB = toMB(S.totalBytes + f.size);
  if (wouldMB > QUOTA_MB_LIMIT) {
    return alert(`Spazio insufficiente: supereresti ${QUOTA_MB_LIMIT} MB.`);
  }

  try {
    showLoader(true);
    const fd = new FormData();
    fd.append("file", f, f.name);
    const up = await api(`/api/files/upload`, { method: "POST", body: fd });

    const key = up.key || f.name;
    const ok = await prefetchR2(key);
    if (!ok) {
      await api(`/api/files/delete?r2_key=${encodeURIComponent(key)}`, { method: "DELETE" }).catch(()=>{});
      throw new Error("Download sul PC non riuscito.");
    }

    $("#filesUpload").value = "";
    await listFiles();
    setTopStatus(`File "${key}" caricato con successo`, true);
  } catch (e) {
    console.error(e);
    alert(e.message || "Errore durante upload");
  } finally {
    showLoader(false);
  }
};



// ====== PREFETCH R2 ======
async function prefetchR2(key){
  try{
    await api(`/api/cmd/prefetch-r2?device=${encodeURIComponent(S.device)}&r2_key=${encodeURIComponent(key)}`, { method:"POST" });
    return true;
  }catch(e){
    if (e?.status === 404) {
      const keep = confirm("Worker non supporta 'prefetch-r2'. Tenere il file nel bucket?");
      return keep;
    }
    return false;
  }
}

// ====== PLAYLISTS: SIDEBAR + EDITOR ======
// ====== PLAYLISTS: SIDEBAR ======
async function loadPlaylists(){
  if (!S.authed) return;
  const r = await api("/api/pl/list");
  S.playlistsCache = (r.playlists||[]).map(p=>p.name);

  const items = (r.playlists||[]).map(p=>`
    <div class="pl-item">
      <div>
        <div class="name">${p.name}</div>
        <small class="muted">${p.count} tracce</small>
      </div>
      <div class="row">
        <button class="pill" data-name="${p.name}" data-act="edit"><i data-lucide="pencil"></i></button>
        <button class="pill primary" data-name="${p.name}" data-act="send"><i data-lucide="send"></i></button>
        <button class="pill warn" data-name="${p.name}" data-act="delete"><i data-lucide="trash-2"></i></button>
      </div>
    </div>`).join("");

  $("#plSidebar").innerHTML = items || `<div class="muted">Nessuna playlist</div>`;
  safeIcons();

  // Azioni bottoni playlist
  $$("#plSidebar [data-act]").forEach(btn=>{
    const name = btn.dataset.name;
    const act = btn.dataset.act;
    btn.onclick = async ()=>{
      if (!S.authed) return openLogin(true);
      if (act === "send"){
        await api(`/api/pl/send?name=${encodeURIComponent(name)}&device=${encodeURIComponent(S.device)}`, { method:"POST" });
        setTopStatus(`Playlist "${name}" inviata`, true);
      }
      else if (act === "delete"){
        if (!confirm(`Eliminare la playlist "${name}"?`)) return;
        await api(`/api/pl/delete?name=${encodeURIComponent(name)}`, { method:"DELETE" });
        await cmd("clear").catch(()=>{});
        await loadPlaylists();
      }
      else if (act === "edit"){
        S.currentPl = name;
        openPlEditor(name);
      }
    };
  });
}

$("#btnNewPl").onclick = ()=>{ if(S.authed){ S.currentPl=null; openPlEditor(null); } else openLogin(true); };

const plWrap = $("#plWrap");
$("#plClose").onclick = ()=> plWrap.classList.remove("show");

// Apri l'editor playlist (nuova o esistente)
async function openPlEditor(name){
  if (!S.authed) return openLogin(true);

  // Header + campi base
  $("#plHdr").textContent = name ? `Modifica: ${name}` : "Crea playlist";
  $("#plNameBox").value = name || "";
  $("#plDeleteBtn").style.display = name ? "inline-flex" : "none";

  // reset selezioni
  S.selAvailIdx = null;
  S.selChosenIdx = null;

  // tracce della playlist (se in modifica)
  if (name) {
    const r = await api(`/api/pl/get?name=${encodeURIComponent(name)}`);
    S.plChosen = (r.tracks || []).map(t => t.r2_key);
  } else {
    S.plChosen = [];
  }

  // carica lista file disponibili e apri modale
  await loadAvailFromR2();
  plWrap.classList.add("show");
  renderPlLists();
}

// Carica i file disponibili (R2) per l’editor
async function loadAvailFromR2(){
  const r = await api(`/api/files/list?prefix=&limit=1000`);
  S.plAvail = (r.items || []).map(x => x.key)
    .sort((a,b)=>a.localeCompare(b,'it',{sensitivity:'base'}));
}

// Aggiorna l’elenco disponibili dall’editor
$("#plReloadFiles").onclick = async ()=>{
  if (!S.authed) return openLogin(true);
  await loadAvailFromR2();
  renderPlLists();
};


// Upload file nel playlist editor con loader
$("#plUploadBtn").onclick = async ()=>{
  if (!S.authed) return openLogin(true);
  const f = $("#plUploadFile").files?.[0];
  if(!f) return alert("Seleziona un file");
  const wouldMB = toMB(S.totalBytes + f.size);
  if (wouldMB > QUOTA_MB_LIMIT) {
    return alert(`Spazio insufficiente. Caricando "${f.name}" supereresti ${QUOTA_MB_LIMIT} MB.`);
  }
  try{
    showLoader(true);
    const fd = new FormData(); fd.append("file", f, f.name);
    const up = await api(`/api/files/upload`, { method:"POST", body:fd });
    const key = up.key || f.name;
    const ok = await prefetchR2(key);
    if (!ok){
      await api(`/api/files/delete?r2_key=${encodeURIComponent(key)}`, { method:"DELETE" }).catch(()=>{});
      throw new Error("Download sul PC non riuscito.");
    }
    $("#plUploadFile").value = "";
    await listFiles();
    await loadAvailFromR2();
    renderPlLists();
    setTopStatus(`Caricato e prefetch: ${key}`, true);
  }catch(e){
    console.error(e);
    alert(e.message || "Upload/prefetch fallito");
  } finally {
    showLoader(false);
  }
};
function renderPlLists(){
  const availHtml = S.plAvail.map((k,i)=>`
    <div class="item" data-idx="${i}">
      <span>${k}</span>
      <div class="row">
        <button class="pill primary add" data-idx="${i}">Aggiungi</button>
      </div>
    </div>
  `).join("");
  $("#plAvail").innerHTML = availHtml || `<div class="muted">Nessun file disponibile</div>`;

  const chosenHtml = S.plChosen.map((k,i)=>`
    <div class="item" data-idx="${i}">
      <span>${i+1}. ${k}</span>
      <div class="row">
        <button class="pill up" data-idx="${i}">Su</button>
        <button class="pill down" data-idx="${i}">Giù</button>
        <button class="pill warn rm" data-idx="${i}">✕</button>
      </div>
    </div>
  `).join("");
  $("#plChosen").innerHTML = chosenHtml || `<div class="muted">Nessuna traccia selezionata</div>`;

  $$("#plAvail .item").forEach(div=>{
    const i = parseInt(div.dataset.idx,10);
    div.onclick = (e)=>{
      if (e.target && e.target.classList.contains("add")) return;
      S.selAvailIdx = i;
      S.selChosenIdx = null;
      updateSelections();
    };
  });
  $$("#plChosen .item").forEach(div=>{
    const i = parseInt(div.dataset.idx,10);
    div.onclick = ()=>{
      S.selChosenIdx = i;
      S.selAvailIdx = null;
      updateSelections();
    };
  });

  $$("#plAvail .add").forEach(btn=>{
    btn.onclick = ()=>{
      const i = parseInt(btn.dataset.idx,10);
      const k = S.plAvail[i];
      S.plChosen.push(k);
      renderPlLists();
    };
  });
  $$("#plChosen .rm").forEach(btn=>{
    btn.onclick = ()=>{
      const i = parseInt(btn.dataset.idx,10);
      S.plChosen.splice(i,1);
      if (S.selChosenIdx === i) S.selChosenIdx = null;
      renderPlLists();
    };
  });
  $$("#plChosen .up").forEach(btn=>{
    btn.onclick = ()=>{
      const i = parseInt(btn.dataset.idx,10);
      if (i>0){ const t=S.plChosen[i]; S.plChosen[i]=S.plChosen[i-1]; S.plChosen[i-1]=t; }
      renderPlLists();
    };
  });
  $$("#plChosen .down").forEach(btn=>{
    btn.onclick = ()=>{
      const i = parseInt(btn.dataset.idx,10);
      if (i < S.plChosen.length-1){ const t=S.plChosen[i]; S.plChosen[i]=S.plChosen[i+1]; S.plChosen[i+1]=t; }
      renderPlLists();
    };
  });

  $("#plUp").onclick = ()=>{
    const i = S.selChosenIdx; if (i==null || i<=0) return;
    const t=S.plChosen[i]; S.plChosen[i]=S.plChosen[i-1]; S.plChosen[i-1]=t;
    S.selChosenIdx = i-1;
    renderPlLists();
  };
  $("#plDown").onclick = ()=>{
    const i = S.selChosenIdx; if (i==null || i>=S.plChosen.length-1) return;
    const t=S.plChosen[i]; S.plChosen[i]=S.plChosen[i+1]; S.plChosen[i+1]=t;
    S.selChosenIdx = i+1;
    renderPlLists();
  };
  $("#plDelItem").onclick = ()=>{
    const i = S.selChosenIdx; if (i==null) return;
    S.plChosen.splice(i,1); S.selChosenIdx = null;
    renderPlLists();
  };

  updateSelections();
  try { safeIcons(); } catch {}
}

function updateSelections(){
  $$("#plAvail .item").forEach(div=> highlightRow(div,false));
  $$("#plChosen .item").forEach(div=> highlightRow(div,false));
  if (S.selAvailIdx!=null){
    const div = $(`#plAvail .item[data-idx="${S.selAvailIdx}"]`);
    if (div) highlightRow(div,true);
  }
  if (S.selChosenIdx!=null){
    const div = $(`#plChosen .item[data-idx="${S.selChosenIdx}"]`);
    if (div) highlightRow(div,true);
  }
}

// Salva (niente auto-play)
$("#plSave").onclick = async ()=>{
  if (!S.authed) return openLogin(true);
  const name = ($("#plNameBox").value || "").trim();
  if(!name) return alert("Inserisci un nome playlist");

  await api(`/api/pl/create?name=${encodeURIComponent(name)}`, { method:"POST" });
  const body = S.plChosen.join("\n");
  await api(`/api/pl/replace?name=${encodeURIComponent(name)}`, {
    method:"POST", headers:{ "Content-Type":"text/plain" }, body
  });

  setTopStatus(`Playlist "${name}" salvata`, true);
  plWrap.classList.remove("show");
  await loadPlaylists();
};

// Elimina playlist (e clear player)
$("#plDeleteBtn").onclick = async ()=>{
  if (!S.authed) return openLogin(true);
  const name = ($("#plNameBox").value || "").trim();
  if(!name) return;
  if(!confirm(`Eliminare la playlist "${name}"?`)) return;
  await api(`/api/pl/delete?name=${encodeURIComponent(name)}`, { method:"DELETE" });
  await cmd("clear").catch(()=>{});
  setTopStatus(`Playlist "${name}" eliminata`, true);
  plWrap.classList.remove("show");
  await loadPlaylists();
};

// ====== SCHEDULE (UI) ======
const schWrap = $("#schWrap");
const schEnabledBtn = $("#schEnabled");

function setSchEnabledVisual(on){
  schEnabledBtn.classList.toggle("on", !!on);
  schEnabledBtn.dataset.on = on ? "1" : "0";
  schEnabledBtn.innerHTML = on
    ? `<i data-lucide="power"></i> ON`
    : `<i data-lucide="power"></i> OFF`;
  try { safeIcons(); } catch {}
}
schEnabledBtn.onclick = ()=>{
  const on = schEnabledBtn.dataset.on === "1";
  setSchEnabledVisual(!on);
};

function getDaySelection(){
  const boxes = $$(".schDay");
  const sel = Array.from(boxes).filter(b=>b.checked).map(b=>b.value);
  return normalizeDays(sel);
}
function setDaySelection(daysCsv){
  const set = new Set((daysCsv||"").split(","));
  $$(".schDay").forEach(b=> b.checked = set.has(b.value));
}
function populatePlSelect(){
  const sel = $("#schPlSel");
  sel.innerHTML = (S.playlistsCache||[]).map(n=>`<option value="${n}">${n}</option>`).join("");
}
async function openSchModal(id=null){
  if (!S.authed) return openLogin(true);
  S.schedEditingId = id;

  if (!S.playlistsCache || S.playlistsCache.length===0) {
    await loadPlaylists();
  }
  populatePlSelect();

  if (id==null){
    $("#schHdr").textContent = "Nuova schedulazione";
    const now = new Date();
    const hh = pad2(now.getHours());
    const mm = pad2(now.getMinutes());
    $("#schTime").value = `${hh}:${mm}`;
    setDaySelection("mon,tue,wed,thu,fri,sat,sun");
    setSchEnabledVisual(true);
  } else {
    $("#schHdr").textContent = `Modifica schedulazione #${id}`;
    const row = S.schedules.find(x=>x.id===id);
    if (!row) { alert("Schedulazione non trovata"); return; }
    $("#schTime").value = row.time_hhmm;
    setDaySelection(row.days || "");
    $("#schPlSel").value = row.playlist_name;
    setSchEnabledVisual(!!row.enabled);
  }

  schWrap.classList.add("show");
}
$("#schClose").onclick = ()=> schWrap.classList.remove("show");
$("#btnNewSched").onclick = ()=> openSchModal(null);

$("#schSave").onclick = async ()=>{
  if (!S.authed) return openLogin(true);
  const hhmm = ($("#schTime").value || "").trim();
  const days = getDaySelection();
  const pl   = $("#schPlSel").value;
  const wantEnabled = $("#schEnabled").dataset.on === "1";
  const endhhmm = ($("#schEndTime").value || "").trim();


if (!/^\d\d:\d\d$/.test(hhmm)) return alert("Inserisci un orario di inizio HH:MM");
if (!/^\d\d:\d\d$/.test(endhhmm)) return alert("Inserisci un orario di fine HH:MM");
if (hhmm >= endhhmm) return alert("L’orario di fine deve essere successivo all’inizio");


  const dupe = S.schedules.find(s =>
    (s.playlist_name===pl) && (s.time_hhmm===hhmm) && (String(s.days)===days)
  );
  if (S.schedEditingId==null && dupe){
    alert("Esiste già una schedulazione per questi giorni e quest’ora con la stessa playlist.");
    return;
  }

  try{
    if (S.schedEditingId==null){
      await api(`/api/sched/create?device=${encodeURIComponent(S.device)}&name=${encodeURIComponent(pl)}&time=${encodeURIComponent(hhmm)}&end_time=${encodeURIComponent(endhhmm)}&days=${encodeURIComponent(days)}&tz=${encodeURIComponent(DEFAULT_TZ)}`, { method:"POST" });

      await loadSchedules();
      if (!wantEnabled){
        const row = S.schedules.find(s => s.playlist_name===pl && s.time_hhmm===hhmm && String(s.days)===days);
        if (row){ await api(`/api/sched/toggle?id=${row.id}&enabled=0`, { method:"POST" }); }
      }
      setTopStatus("Schedulazione creata", true);
    } else {
      const id = S.schedEditingId;
      await api(`/api/sched/delete?id=${id}`, { method:"DELETE" });
     await api(`/api/sched/create?device=${encodeURIComponent(S.device)}&name=${encodeURIComponent(pl)}&time=${encodeURIComponent(hhmm)}&end_time=${encodeURIComponent(endhhmm)}&days=${encodeURIComponent(days)}&tz=${encodeURIComponent(DEFAULT_TZ)}`, { method:"POST" });

      await loadSchedules();
      if (!wantEnabled){
        const row = S.schedules.find(s => s.playlist_name===pl && s.time_hhmm===hhmm && String(s.days)===days);
        if (row){ await api(`/api/sched/toggle?id=${row.id}&enabled=0`, { method:"POST" }); }
      }
      setTopStatus("Schedulazione aggiornata", true);
    }
    schWrap.classList.remove("show");
    await loadSchedules();
  }catch(e){
    alert(e?.data?.reason || e.message || "Errore");
  }
};

$("#schReload").onclick = ()=> S.authed ? loadSchedules() : openLogin(true);

async function loadSchedules(){
  if (!S.authed) return;
  const r = await api(`/api/sched/list`);
S.schedules = (r.schedules || []).map(x=>({
  id: x.id,
  device: x.device,
  playlist_name: x.playlist_name,
  tz: x.tz,
  time_hhmm: x.time_hhmm,
  end_time_hhmm: x.end_time_hhmm || null,
  days: x.days,
  enabled: !!x.enabled,
  last_fired_key: x.last_fired_key || null
}));


  S.schedules.sort((a,b)=>{
    if (a.time_hhmm !== b.time_hhmm) return a.time_hhmm.localeCompare(b.time_hhmm);
    if (a.days !== b.days) return a.days.localeCompare(b.days);
    return a.playlist_name.localeCompare(b.playlist_name);
  });

  renderSchedules();
}

function renderSchedules(){
  $("#schCount").textContent = `${S.schedules.length} regole`;

  const rows = S.schedules.map(s=>{
    const humanDays = daysToHuman(s.days);
    const enCls = s.enabled ? "primary" : "";
    const enLabel = s.enabled ? "ON" : "OFF";
    const last = s.last_fired_key ? `<small class="muted">${s.last_fired_key}</small>` : `<small class="muted">—</small>`;
    return `
      <tr data-id="${s.id}">
        <td><strong>${s.time_hhmm}–${s.end_time_hhmm || "?"}</strong><div>${humanDays}</div></td>

        <td>${s.playlist_name}</td>
        <td>${last}</td>
        <td style="white-space:nowrap">
          <button class="pill ${enCls}" data-act="toggle" title="Abilita/Disabilita">${enLabel}</button>
          <button class="pill" data-act="run"><i data-lucide="play-circle"></i></button>
          <button class="pill" data-act="edit"><i data-lucide="pencil"></i></button>
          <button class="pill warn" data-act="del"><i data-lucide="trash-2"></i></button>
        </td>
      </tr>`;
  }).join("");

  $("#schTable").innerHTML = `
    <tr><th>Quando</th><th>Playlist</th><th>Ultimo avvio</th><th>Azioni</th></tr>
    ${rows || `<tr><td colspan="4"><div class="muted">Nessuna schedulazione</div></td></tr>`}
  `;

  safeIcons();

  $$("#schTable tr[data-id]").forEach(tr=>{
    const id = parseInt(tr.dataset.id,10);
    tr.querySelectorAll("[data-act]").forEach(btn=>{
      const act = btn.dataset.act;
      btn.onclick = async ()=>{
        if (!S.authed) return openLogin(true);
        const row = S.schedules.find(x=>x.id===id);
        if (!row) return;

        if (act === "toggle"){
          const want = row.enabled ? 0 : 1;
          const msg = want ? "Attivare questa schedulazione?" : "Disattivare questa schedulazione?";
          if (!confirm(msg)) return;
          await api(`/api/sched/toggle?id=${id}&enabled=${want}`, { method:"POST" });
          await loadSchedules();
          setTopStatus(`Schedulazione ${want ? "attivata" : "disattivata"}`, true);
        }
        else if (act === "edit"){
          await openSchModal(id);
        }
        else if (act === "del"){
          if (!confirm("Eliminare questa schedulazione?")) return;
          await api(`/api/sched/delete?id=${id}`, { method:"DELETE" });
          await loadSchedules();
          setTopStatus("Schedulazione eliminata", true);
        }
        else if (act === "run"){
          await api(`/api/sched/run-now?id=${id}`, { method:"POST" });
          setTopStatus("Avviata ora", true);
        }
      };
    });
  });
}
