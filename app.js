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
  currentPl: null,
  plChosen: [],
  plAvail:  [],
  timerState: null,
  seeking: false,
  loopMode: "off" // "off" | "playlist" | "one"
};

const $ = (q) => document.querySelector(q);
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

// ====== PLAYLIST EDITOR (stessa versione di prima, omessa per brevità) ======
// ... Se la tua pagina ha l’editor modale già funzionante, lascia quello attuale ...
// (Se vuoi lo reincollo intero, ma non è toccato per il loop.)
