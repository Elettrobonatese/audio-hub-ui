// ====== CONFIG FISSI ======
const DEFAULT_BASE_URL = "https://audio-hub.audio-elettrobonatese-1cf.workers.dev";
const DEFAULT_DEVICE   = "PC-MainStreet";
const DEFAULT_TZ       = "Europe/Rome";

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

  // Playlist Editor
  currentPl: null,     // nome playlist in editing (o null per nuova)
  plChosen: [],        // array di r2_key nella playlist (ordine)
  plAvail:  [],        // array di r2_key disponibili (da R2)
  selAvailIdx: null,   // indice selezionato in "Disponibili"
  selChosenIdx: null,  // indice selezionato in "Tracce nella playlist"
  playlistsCache: [],  // elenco playlist (per select dello scheduler)

  // Scheduler
  schedules: [],
  schedEditingId: null // id in edit (null = nuova)
};

const $  = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);

// ====== HELPERS ======
function setAuthed(ok){
  S.authed = !!ok;
  document.body.classList.toggle("locked", !S.authed);
  $("#btnLogin").innerHTML = S.authed
    ? `<i data-lucide="log-out"></i> Logout`
    : `<i data-lucide="log-in"></i> Login`;
  try { lucide.createIcons(); } catch {}
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
  await loadPlaylists();   // popola sidebar + cache playlist
  await listFiles();
  await loadSchedules();   // carica lista schedulazioni
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

// LOOP tri-stato
function updateLoopVisual(mode){
  const btn = $("#btnLoop");
  btn.classList.toggle("primary", mode !== "off");
  if (mode === "playlist") btn.innerHTML = `<i data-lucide="repeat"></i>`;
  else if (mode === "one") btn.innerHTML = `<i data-lucide="repeat-1"></i>`;
  else btn.innerHTML = `<i data-lucide="repeat"></i>`;
  try { lucide.createIcons(); } catch {}
}
const btnLoop = $("#btnLoop");
btnLoop.onclick = async () => {
  if (!S.authed) return openLogin(true);
  const cur = S.loopMode;
  try {
    if (cur === "off") {
      await api(`/api/cmd/loop?device=${encodeURIComponent(S.device)}&mode=playlist`, { method:"POST" });
      S.loopMode = "playlist";
    } else if (cur === "playlist") {
      await api(`/api/cmd/loop?device=${encodeURIComponent(S.device)}&mode=playlist`, { method:"POST" }); // toggle OFF
      await api(`/api/cmd/loop?device=${encodeURIComponent(S.device)}&mode=one`, { method:"POST" });       // toggle ON
      S.loopMode = "one";
    } else {
      await api(`/api/cmd/loop?device=${encodeURIComponent(S.device)}&mode=one`, { method:"POST" });       // toggle OFF
      S.loopMode = "off";
    }
  } catch (e) {
    console.error(e);
  }
  updateLoopVisual(S.loopMode); // feedback immediato
};

// Seek bar
const seekBar = $("#seekBar");
seekBar.addEventListener("input", ()=>{
  if (!S.authed) return;
  S.seeking = true;
  $("#timeCur").textContent = fmtTime(seekBar.value);
});
seekBar.addEventListener("change", async ()=>{
  if (!S.authed) return openLogin(true);
  const sec = parseInt(seekBar.value||"0",10);
  await api(`/api/cmd/seek?device=${encodeURIComponent(S.device)}&sec=${sec}`, { method:"POST" });
  S.seeking = false;
});

// Stato/Now playing (toggle Play/Pausa blu + loop)
async function refreshState(){
  if (!S.authed) return;
  try{
    const st = await api(`/api/state/get?device=${encodeURIComponent(S.device)}`);
    const info = st?.state || st;

    // stato
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

    // tempi
    const cur = info?.time ?? 0;
    const len = info?.length ?? Math.max(cur, 0);
    if(!S.seeking){
      $("#timeCur").textContent = fmtTime(cur);
      $("#timeTot").textContent = fmtTime(len);
      seekBar.max = len||0; seekBar.value = cur||0;
    }
    $("#trkState").textContent = `stato: ${state || "—"}`;

    // titolo
    const meta = info?.information?.category?.meta || {};
    const title = meta.title || meta.filename || "—";
    $("#trkTitle").textContent = title;

    // loop flags → tri-stato
    const repeatOn = !!info?.repeat; // brano
    const loopOn   = !!info?.loop;   // playlist
    let mode = "off";
    if (loopOn) mode = "playlist"; else if (repeatOn) mode = "one";
    S.loopMode = mode;
    updateLoopVisual(mode);
  }catch(e){ /* api 401 ecc. aprono modale */ }
}

// ====== FILES (R2) ======
async function listFiles(){
  if (!S.authed) return;
  const prefix = $("#r2Prefix").value.trim();
  const r = await api(`/api/files/list?prefix=${encodeURIComponent(prefix)}&limit=500`);
  $("#r2Count").textContent = `${r.items.length} oggetti`;
  const rows = r.items.map(x=>`
    <tr>
      <td>${x.key}</td>
      <td class="muted">${x.size} B</td>
      <td><button data-key="${x.key}" class="pill send primary">Enqueue→Device</button></td>
      <td><button data-key="${x.key}" class="pill warn del">Elimina</button></td>
    </tr>`).join("");
  $("#r2Table").innerHTML = `<tr><th>Key</th><th>Size</th><th></th><th></th></tr>${rows}`;
  $$("#r2Table .send").forEach(b=> b.onclick = ()=> S.authed && api(`/api/cmd/enqueue-r2?device=${encodeURIComponent(S.device)}&r2_key=${encodeURIComponent(b.dataset.key)}`, { method:"POST" }));
  $$("#r2Table .del").forEach(b=> b.onclick = async ()=>{
    if (!S.authed) return openLogin(true);
    if(!confirm(`Eliminare ${b.dataset.key}?`)) return;
    await api(`/api/files/delete?r2_key=${encodeURIComponent(b.dataset.key)}`, { method:"DELETE" });
    listFiles();
  });
}
$("#r2List").onclick = ()=> S.authed ? listFiles() : openLogin(true);

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
  lucide.createIcons();
  $$("#plSidebar [data-act]").forEach(btn=>{
    const name = btn.dataset.name, act = btn.dataset.act;
    btn.onclick = async ()=>{
      if (!S.authed) return openLogin(true);
      if(act==="send"){
        await api(`/api/pl/send?name=${encodeURIComponent(name)}&device=${encodeURIComponent(S.device)}`, { method:"POST" });
        setTopStatus(`Playlist "${name}" inviata`, true);
      }else if(act==="delete"){
        if(!confirm(`Eliminare la playlist "${name}"?`)) return;
        await api(`/api/pl/delete?name=${encodeURIComponent(name)}`, { method:"DELETE" });
        await cmd("clear").catch(()=>{});
        await loadPlaylists();
      }else if(act==="edit"){
        S.currentPl = name;
        openPlEditor(name);
      }
    };
  });
}
$("#btnNewPl").onclick = ()=>{ if(S.authed){ S.currentPl=null; openPlEditor(null); } else openLogin(true); };

// ====== PLAYLIST EDITOR (MODALE) ======
const plWrap = $("#plWrap");
$("#plClose").onclick = ()=> plWrap.classList.remove("show");

async function openPlEditor(name){
  if (!S.authed) return openLogin(true);

  $("#plHdr").textContent = name ? `Modifica: ${name}` : "Crea playlist";
  $("#plNameBox").value = name || "";
  $("#plDeleteBtn").style.display = name ? "inline-flex" : "none";

  // reset selezioni
  S.selAvailIdx = null;
  S.selChosenIdx = null;

  // carica tracce esistenti (se editing)
  if (name) {
    const r = await api(`/api/pl/get?name=${encodeURIComponent(name)}`);
    S.plChosen = (r.tracks||[]).map(t=>t.r2_key);
  } else {
    S.plChosen = [];
  }

  // carica lista disponibili da R2 secondo il prefisso
  await loadAvailFromR2();

  // mostra modale + render
  plWrap.classList.add("show");
  renderPlLists();
}

async function loadAvailFromR2(){
  const prefix = $("#plPrefix").value.trim();
  const r = await api(`/api/files/list?prefix=${encodeURIComponent(prefix)}&limit=1000`);
  S.plAvail = (r.items||[]).map(x=>x.key);
}

$("#plReloadFiles").onclick = async ()=>{
  if (!S.authed) return openLogin(true);
  await loadAvailFromR2();
  renderPlLists();
};

$("#plUploadBtn").onclick = async ()=>{
  if (!S.authed) return openLogin(true);
  const f = $("#plUploadFile").files?.[0];
  if(!f) return alert("Seleziona un file");
  const prefix = $("#plUploadPrefix").value.trim();
  const fd = new FormData(); fd.append("file", f, f.name);
  await api(`/api/files/upload?prefix=${encodeURIComponent(prefix)}`, { method:"POST", body:fd });
  await loadAvailFromR2(); renderPlLists();
};

function renderPlLists(){
  // DISPONIBILI (R2)
  const availHtml = S.plAvail.map((k,i)=>`
    <div class="item" data-idx="${i}">
      <span>${k}</span>
      <div class="row">
        <button class="pill primary add" data-idx="${i}">Aggiungi</button>
      </div>
    </div>
  `).join("");
  $("#plAvail").innerHTML = availHtml || `<div class="muted">Nessun file col prefix dato</div>`;

  // CHOSEN (playlist)
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

  // Selezione righe (per i controlli globali)
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

  // Bottoni per-item
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

  // Controlli GLOBALI (Su / Giù / Rimuovi)
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

  // evidenzia selezioni
  updateSelections();

  try { lucide.createIcons(); } catch {}
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

// Salva & invia
$("#plSave").onclick = async ()=>{
  if (!S.authed) return openLogin(true);
  const name = ($("#plNameBox").value || "").trim();
  if(!name) return alert("Inserisci un nome playlist");

  await api(`/api/pl/create?name=${encodeURIComponent(name)}`, { method:"POST" });
  const body = S.plChosen.join("\n");
  await api(`/api/pl/replace?name=${encodeURIComponent(name)}`, { method:"POST", headers:{ "Content-Type":"text/plain" }, body });
  await api(`/api/pl/send?name=${encodeURIComponent(name)}&device=${encodeURIComponent(S.device)}`, { method:"POST" });

  setTopStatus(`Playlist "${name}" salvata e inviata`, true);
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
  try { lucide.createIcons(); } catch {}
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

  // Assicura la lista playlist popolata
  if (!S.playlistsCache || S.playlistsCache.length===0) {
    await loadPlaylists();
  }
  populatePlSelect();

  if (id==null){
    $("#schHdr").textContent = "Nuova schedulazione";
    // default: ora prossima tonda (minuto corrente)
    const now = new Date();
    const hh = pad2(now.getHours());
    const mm = pad2(now.getMinutes());
    $("#schTime").value = `${hh}:${mm}`;
    setDaySelection("mon,tue,wed,thu,fri,sat,sun"); // default: tutti
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

  if (!/^\d\d:\d\d$/.test(hhmm)) return alert("Inserisci un orario HH:MM");
  if (!days) return alert("Seleziona almeno un giorno");
  if (!pl) return alert("Seleziona una playlist");

  // dedup client-side: stessa combina (device, tz, hh:mm, days)
  const dupe = S.schedules.find(s =>
    (s.playlist_name===pl) && (s.time_hhmm===hhmm) && (String(s.days)===days)
  );
  if (S.schedEditingId==null && dupe){
    alert("Esiste già una schedulazione per questi giorni e quest’ora con la stessa playlist.");
    return;
  }

  try{
    if (S.schedEditingId==null){
      // Create
      await api(`/api/sched/create?device=${encodeURIComponent(S.device)}&name=${encodeURIComponent(pl)}&time=${encodeURIComponent(hhmm)}&days=${encodeURIComponent(days)}&tz=${encodeURIComponent(DEFAULT_TZ)}`, { method:"POST" });
      // Se vogliamo disabilitata, toggliamo dopo la creazione
      await loadSchedules();
      if (!wantEnabled){
        const row = S.schedules.find(s => s.playlist_name===pl && s.time_hhmm===hhmm && String(s.days)===days);
        if (row){ await api(`/api/sched/toggle?id=${row.id}&enabled=0`, { method:"POST" }); }
      }
      setTopStatus("Schedulazione creata", true);
    } else {
      // Edit: non abbiamo API update → facciamo delete + create (+toggle)
      const id = S.schedEditingId;
      await api(`/api/sched/delete?id=${id}`, { method:"DELETE" });
      await api(`/api/sched/create?device=${encodeURIComponent(S.device)}&name=${encodeURIComponent(pl)}&time=${encodeURIComponent(hhmm)}&days=${encodeURIComponent(days)}&tz=${encodeURIComponent(DEFAULT_TZ)}`, { method:"POST" });
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
    // se il Worker un domani risponde 409 per duplicati, mostriamo il messaggio
    alert(e?.data?.reason || e.message || "Errore");
  }
};

$("#schReload").onclick = ()=> S.authed ? loadSchedules() : openLogin(true);

async function loadSchedules(){
  if (!S.authed) return;
  const r = await api(`/api/sched/list`);
  S.schedules = (r.schedules || []).map(x=>({
    id:x.id, device:x.device, playlist_name:x.playlist_name,
    tz:x.tz, time_hhmm:x.time_hhmm, days:x.days, enabled:!!x.enabled,
    last_fired_key: x.last_fired_key || null
  }));

  // ordine: ora, giorni, playlist
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
        <td><strong>${s.time_hhmm}</strong><div>${humanDays}</div></td>
        <td>${s.playlist_name}</td>
        <td>${s.device}</td>
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
    <tr><th>Quando</th><th>Playlist</th><th>Device</th><th>Ultimo avvio</th><th>Azioni</th></tr>
    ${rows || `<tr><td colspan="5"><div class="muted">Nessuna schedulazione</div></td></tr>`}
  `;

  lucide.createIcons();

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
