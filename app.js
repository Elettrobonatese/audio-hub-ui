// ====== CONFIG FISSI ======
const DEFAULT_BASE_URL = "https://audio-hub.audio-elettrobonatese-1cf.workers.dev";
const DEFAULT_DEVICE   = "PC-MainStreet";

// ====== STATO APP ======
const S = {
  baseUrl: DEFAULT_BASE_URL,
  device:  DEFAULT_DEVICE,
  user:    localStorage.getItem("user") || "",
  pass:    localStorage.getItem("pass") || "",
  authed:  false,            // <— stato autenticazione
  currentPl: null,
  plChosen: [],
  plAvail:  [],
  timerState: null,
  seeking: false
};

const $ = (q) => document.querySelector(q);
const $$ = (q) => document.querySelectorAll(q);

// ====== HELPERS ======
function setAuthed(ok){
  S.authed = !!ok;
  document.body.classList.toggle("locked", !S.authed);
  // bottone in header cambia etichetta
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
  // se 401 → forziamo rilogin e blocco UI
  if (res.status === 401) {
    setAuthed(false);
    openLogin(true); // forza visibile
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
  // blocca UI
  setAuthed(false);
  // non permettere chiusura finché non authed
  $("#lgClose").style.visibility = S.authed ? "visible" : "hidden";
  // se ho credenziali salvate e devo auto-login
  if (!S.authed && !force && S.user && S.pass) {
    // piccolo delay per far disegnare la modale
    setTimeout(() => $("#lgEnter").click(), 50);
  }
}
function closeLogin(){
  if (!S.authed) return; // non chiudere se non autenticato
  loginWrap.classList.remove("show");
  $("#lgClose").style.visibility = "visible";
}

$("#btnLogin").onclick = () => {
  if (S.authed) {
    // Logout
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
    // resta aperta; mostro messaggio in modale
    $("#lgInfo").textContent = "Credenziali errate o Worker non raggiungibile.";
    console.error(e);
  }
};

// Enter per inviare
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

// All'apertura: mostra SEMPRE la modale; se ho user/pass salvati provo auto-login
window.addEventListener("load", () => {
  openLogin(false);
});

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

$("#btnVolAbs").onclick = () => {
  if (!S.authed) return openLogin(true);
  const v = parseInt($("#volAbs").value||"75",10);
  return api(`/api/cmd/volume?device=${encodeURIComponent(S.device)}&value=${v}`, { method:"POST" });
};
$("#btnVolDown").onclick = () => S.authed && api(`/api/cmd/volume?device=${encodeURIComponent(S.device)}&delta=-10`, { method:"POST" });
$("#btnVolUp").onclick   = () => S.authed && api(`/api/cmd/volume?device=${encodeURIComponent(S.device)}&delta=+10`, { method:"POST" });

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

// Stato/Now playing
async function refreshState(){
  if (!S.authed) return;
  try{
    const st = await api(`/api/state/get?device=${encodeURIComponent(S.device)}`);
    const info = st?.state || st;
    const playState = info?.state || "—";
    const cur = info?.time ?? 0;
    const len = info?.length ?? Math.max(cur, 0);
    $("#trkState").textContent = `stato: ${playState}`;
    if(!S.seeking){
      $("#timeCur").textContent = fmtTime(cur);
      $("#timeTot").textContent = fmtTime(len);
      seekBar.max = len||0; seekBar.value = cur||0;
    }
    const meta = info?.information?.category?.meta || {};
    const title = meta.title || meta.filename || "—";
    $("#trkTitle").textContent = title;
  }catch(e){
    // se cade la sessione, api() aprirà la modale
  }
}

// ====== FILES (R2) ======
async function listFiles(){
  if (!S.authed) return;
  const prefix = $("#r2Prefix").value.trim();
  const r = await api(`/api/files/list?prefix=${encodeURIComponent(prefix)}&limit=500`);
  r.items.sort((a,b)=>a.key.localeCompare(b.key,'it',{numeric:true,sensitivity:'base'}));
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

// ====== PLAYLIST EDITOR MODALE ======
const plWrap = $("#plWrap");
function closePl(){ plWrap.classList.remove("show"); }
$("#plClose").onclick = closePl;

async function openPlEditor(name){
  if (!S.authed) return openLogin(true);
  $("#plHdr").textContent = name ? `Modifica: ${name}` : "Crea playlist";
  $("#plNameBox").value = name || "";
  $("#plDeleteBtn").style.display = name ? "inline-flex" : "none";
  plWrap.classList.add("show");
  if(name){
    const r = await api(`/api/pl/get?name=${encodeURIComponent(name)}`);
    S.plChosen = (r.tracks||[]).map(t=>t.r2_key);
  }else{
    S.plChosen = [];
  }
  await loadAvailFromR2();
  renderPlLists();
}

async function loadAvailFromR2(){
  const prefix = $("#plPrefix").value.trim();
  const r = await api(`/api/files/list?prefix=${encodeURIComponent(prefix)}&limit=1000`);
  S.plAvail = (r.items||[]).map(x=>x.key).sort((a,b)=>a.localeCompare(b,'it',{numeric:true,sensitivity:'base'}));
}
$("#plReloadFiles").onclick = ()=> S.authed ? loadAvailFromR2().then(renderPlLists) : openLogin(true);

function renderPlLists(){
  const availHtml = S.plAvail.map(k=>{
    const inPl = S.plChosen.includes(k);
    return `<div class="item">
      <span>${k}</span>
      <div class="row">
        <button class="pill ${inPl?'ghost':'primary'}" data-k="${k}" data-act="add" ${inPl?'disabled':''}>Aggiungi</button>
      </div>
    </div>`;
  }).join("");
  $("#plAvail").innerHTML = availHtml || `<div class="muted">Nessun file col prefix dato</div>`;

  const chosenHtml = S.plChosen.map((k,i)=>`
    <div class="item">
      <span>${i+1}. ${k}</span>
      <div class="row">
        <button class="pill" data-idx="${i}" data-act="up">↑</button>
        <button class="pill" data-idx="${i}" data-act="down">↓</button>
        <button class="pill warn" data-idx="${i}" data-act="rm">✕</button>
      </div>
    </div>
  `).join("");
  $("#plChosen").innerHTML = chosenHtml || `<div class="muted">Nessuna traccia selezionata</div>`;

  $$("#plAvail [data-act='add']").forEach(b=>{
    b.onclick = ()=>{ S.plChosen.push(b.dataset.k); renderPlLists(); };
  });
  $$("#plChosen [data-act]").forEach(b=>{
    const idx = parseInt(b.dataset.idx,10);
    const act = b.dataset.act;
    b.onclick = ()=>{
      if(act==="rm"){ S.plChosen.splice(idx,1); }
      if(act==="up" && idx>0){ const t=S.plChosen[idx]; S.plChosen[idx]=S.plChosen[idx-1]; S.plChosen[idx-1]=t; }
      if(act==="down" && idx<S.plChosen.length-1){ const t=S.plChosen[idx]; S.plChosen[idx]=S.plChosen[idx+1]; S.plChosen[idx+1]=t; }
      renderPlLists();
    };
  });
}

// upload integrato
$("#plUploadBtn").onclick = async ()=>{
  if (!S.authed) return openLogin(true);
  const f = $("#plUploadFile").files?.[0];
  if(!f) return alert("Seleziona un file");
  const prefix = $("#plUploadPrefix").value.trim();
  const fd = new FormData(); fd.append("file", f, f.name);
  await api(`/api/files/upload?prefix=${encodeURIComponent(prefix)}`, { method:"POST", body:fd });
  await loadAvailFromR2(); renderPlLists();
};

// salva & invia
$("#plSave").onclick = async ()=>{
  if (!S.authed) return openLogin(true);
  const name = ($("#plNameBox").value || "").trim();
  if(!name) return alert("Inserisci un nome playlist");
  await api(`/api/pl/create?name=${encodeURIComponent(name)}`, { method:"POST" });
  const body = S.plChosen.join("\n");
  await api(`/api/pl/replace?name=${encodeURIComponent(name)}`, { method:"POST", headers:{ "Content-Type":"text/plain" }, body });
  await api(`/api/pl/send?name=${encodeURIComponent(name)}&device=${encodeURIComponent(S.device)}`, { method:"POST" });
  setTopStatus(`Playlist "${name}" salvata e inviata`, true);
  closePl();
  await loadPlaylists();
};

// elimina playlist (e clear player)
$("#plDeleteBtn").onclick = async ()=>{
  if (!S.authed) return openLogin(true);
  const name = ($("#plNameBox").value || "").trim();
  if(!name) return;
  if(!confirm(`Eliminare la playlist "${name}"?`)) return;
  await api(`/api/pl/delete?name=${encodeURIComponent(name)}`, { method:"DELETE" });
  await cmd("clear").catch(()=>{});
  setTopStatus(`Playlist "${name}" eliminata`, true);
  closePl();
  await loadPlaylists();
};
