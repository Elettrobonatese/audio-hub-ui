// ====== CONFIG FISSI ======
const DEFAULT_BASE_URL = "https://audio-hub.audio-elettrobonatese-1cf.workers.dev";
const DEFAULT_DEVICE   = "PC-MainStreet";

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
  selChosenIdx: null   // indice selezionato in "Tracce nella playlist"
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
      // OFF → PLAYLIST (accendi pl_loop)
      await api(`/api/cmd/loop?device=${encodeURIComponent(S.device)}&mode=playlist`, { method:"POST" });
      S.loopMode = "playlist";
    } else if (cur === "playlist") {
      // PLAYLIST → ONE (spegni pl_loop, accendi pl_repeat)
      await api(`/api/cmd/loop?device=${encodeURIComponent(S.device)}&mode=playlist`, { method:"POST" }); // toggle OFF
      await api(`/api/cmd/loop?device=${encodeURIComponent(S.device)}&mode=one`, { method:"POST" });       // toggle ON
      S.loopMode = "one";
    } else {
      // ONE → OFF (spegni pl_repeat)
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
      // evita che il click su "Aggiungi" sovrascriva la selezione
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
  // reset
  $$("#plAvail .item").forEach(div=> highlightRow(div,false));
  $$("#plChosen .item").forEach(div=> highlightRow(div,false));
  // highlight selezionati
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
