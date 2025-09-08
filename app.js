const $ = (s) => document.querySelector(s);

function loadCfg() {
  return {
    baseUrl: localStorage.getItem("baseUrl") || "https://audio-hub.audio-elettrobonatese-1cf.workers.dev",
    user: localStorage.getItem("user") || "admin",
    pass: localStorage.getItem("pass") || "",
    device: localStorage.getItem("device") || "PC-MainStreet",
  };
}
function saveCfg(cfg) {
  localStorage.setItem("baseUrl", cfg.baseUrl);
  localStorage.setItem("user", cfg.user);
  localStorage.setItem("pass", cfg.pass);
  localStorage.setItem("device", cfg.device);
}

function authHeader(cfg) {
  const token = btoa(`${cfg.user}:${cfg.pass}`);
  return { Authorization: `Basic ${token}` };
}

async function api(path, { method = "GET", headers = {}, body = undefined, raw = false } = {}) {
  const cfg = loadCfg();
  const url = cfg.baseUrl.replace(/\/$/, "") + path;
  const h = { ...authHeader(cfg), ...headers };
  const res = await fetch(url, { method, headers: h, body });
  if (raw) return res;
  const txt = await res.text();
  let data = null;
  try { data = JSON.parse(txt); } catch { data = { raw: txt }; }
  if (!res.ok) throw Object.assign(new Error(data?.reason || txt || res.statusText), { status: res.status, data });
  return data;
}

function setConnStatus(text, ok = true) {
  const el = $("#connStatus");
  el.textContent = text;
  el.className = ok ? "ok" : "err";
}

(function init() {
  const cfg = loadCfg();
  $("#baseUrl").value = cfg.baseUrl;
  $("#user").value = cfg.user;
  $("#pass").value = cfg.pass;
  $("#device").value = cfg.device;

  $("#saveConn").addEventListener("click", async () => {
    const cfg = {
      baseUrl: $("#baseUrl").value.trim(),
      user: $("#user").value.trim(),
      pass: $("#pass").value,
      device: $("#device").value.trim(),
    };
    saveCfg(cfg);
    try {
      await api("/api/ping");
      const st = await api(`/api/devices/${encodeURIComponent(cfg.device)}/status`);
      setConnStatus(`OK · device ${cfg.device} connected=${st.connected}`, true);
    } catch (e) {
      setConnStatus("Errore connessione/API", false);
      console.error(e);
    }
  });

  setInterval(async () => {
    try {
      const cfg = loadCfg();
      const st = await api(`/api/state/get?device=${encodeURIComponent(cfg.device)}`);
      $("#nowPlaying").textContent = JSON.stringify(st?.state ?? st, null, 2);
    } catch (_) {}
  }, 2000);
})();

$("#btnPlay").onclick  = () => api(`/api/cmd/play?device=${encodeURIComponent(loadCfg().device)}`, { method: "POST" });
$("#btnPause").onclick = () => api(`/api/cmd/pause?device=${encodeURIComponent(loadCfg().device)}`, { method: "POST" });
$("#btnStop").onclick  = () => api(`/api/cmd/stop?device=${encodeURIComponent(loadCfg().device)}`, { method: "POST" });
$("#btnPrev").onclick  = () => api(`/api/cmd/prev?device=${encodeURIComponent(loadCfg().device)}`, { method: "POST" });
$("#btnNext").onclick  = () => api(`/api/cmd/next?device=${encodeURIComponent(loadCfg().device)}`, { method: "POST" });
$("#btnClear").onclick = () => api(`/api/cmd/clear?device=${encodeURIComponent(loadCfg().device)}`, { method: "POST" });

$("#btnVolAbs").onclick = () => {
  const v = parseInt($("#volAbs").value || "75", 10);
  return api(`/api/cmd/volume?device=${encodeURIComponent(loadCfg().device)}&value=${v}`, { method: "POST" });
};
$("#btnVolDown").onclick = () => api(`/api/cmd/volume?device=${encodeURIComponent(loadCfg().device)}&delta=-10`, { method: "POST" });
$("#btnVolUp").onclick   = () => api(`/api/cmd/volume?device=${encodeURIComponent(loadCfg().device)}&delta=+10`, { method: "POST" });

$("#btnSeekAbs").onclick = () => {
  const s = parseInt($("#seekAbs").value || "60", 10);
  return api(`/api/cmd/seek?device=${encodeURIComponent(loadCfg().device)}&sec=${s}`, { method: "POST" });
};
$("#btnSeekBack").onclick = () => api(`/api/cmd/seek?device=${encodeURIComponent(loadCfg().device)}&delta=-15`, { method: "POST" });
$("#btnSeekFwd").onclick  = () => api(`/api/cmd/seek?device=${encodeURIComponent(loadCfg().device)}&delta=+15`, { method: "POST" });

$("#plCreate").onclick = async () => {
  const name = $("#plName").value.trim();
  const r = await api(`/api/pl/create?name=${encodeURIComponent(name)}`, { method: "POST" });
  $("#plResult").textContent = JSON.stringify(r, null, 2);
};
$("#plGet").onclick = async () => {
  const name = $("#plName").value.trim();
  const r = await api(`/api/pl/get?name=${encodeURIComponent(name)}`);
  $("#plResult").textContent = JSON.stringify(r, null, 2);
};
$("#plReplace").onclick = async () => {
  const name = $("#plName").value.trim();
  const body = $("#plReplaceBox").value.trim();
  const r = await api(`/api/pl/replace?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body
  });
  $("#plResult").textContent = JSON.stringify(r, null, 2);
};
$("#plSend").onclick = async () => {
  const name = $("#plName").value.trim();
  const dev = loadCfg().device;
  const r = await api(`/api/pl/send?name=${encodeURIComponent(name)}&device=${encodeURIComponent(dev)}`, { method: "POST" });
  $("#plResult").textContent = JSON.stringify(r, null, 2);
};
$("#plDelete").onclick = async () => {
  const name = $("#plName").value.trim();
  const r = await api(`/api/pl/delete?name=${encodeURIComponent(name)}`, { method: "DELETE" });
  $("#plResult").textContent = JSON.stringify(r, null, 2);
};

// Inject responsive CSS for action buttons in table
const style = document.createElement("style");
style.textContent = `
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  @media (max-width: 600px) {
    .actions {
      flex-direction: column;
      align-items: stretch;
    }

    .actions button {
      width: 100%;
    }
  }
`;
document.head.appendChild(style);


$("#r2List").onclick = async () => {
  const prefix = $("#r2Prefix").value.trim();
  const r = await api(`/api/files/list?prefix=${encodeURIComponent(prefix)}&limit=200`);
  $("#r2Count").textContent = `${r.count} oggetti`;
  const rows = r.items.map(x =>
  
 `<tr>
    <td>${x.key}</td>
    <td class="muted">${x.size} B</td>
    <td colspan="2">
      <div class="actions">
        <button data-key="${x.key}" class="del">Elimina</button>
        <button data-key="${x.key}" class="send primary">Metti in coda</button>
      </div>
    </td>
  </tr>`

  ).join("");
  $("#r2Table").innerHTML = `<tr><th>Key</th><th>Size</th><th></th><th></th></tr>${rows}`;

  $("#r2Table").querySelectorAll("button.del").forEach(btn => {
    btn.onclick = async () => {
      const key = btn.getAttribute("data-key");
      if (!confirm(`Eliminare ${key}?`)) return;
      await api(`/api/files/delete?r2_key=${encodeURIComponent(key)}`, { method: "DELETE" });
      $("#r2List").click();
    };
  });
  $("#r2Table").querySelectorAll("button.send").forEach(btn => {
    btn.onclick = async () => {
      const key = btn.getAttribute("data-key");
      await api(`/api/cmd/enqueue-r2?device=${encodeURIComponent(loadCfg().device)}&r2_key=${encodeURIComponent(key)}`, { method: "POST" });
    };
  });
};

$("#upSend").onclick = async () => {
  const f = $("#upFile").files?.[0];
  if (!f) { $("#upOut").textContent = "Seleziona un file"; return; }
  const prefix = $("#upPrefix").value.trim();
  const fd = new FormData();
  fd.append("file", f, f.name);
  try {
    const r = await api(`/api/files/upload?prefix=${encodeURIComponent(prefix)}`, { method: "POST", body: fd });
    $("#upOut").textContent = `OK: ${r.key}`;
    $("#r2List").click();
  } catch (e) {
    $("#upOut").textContent = `Errore upload: ${e.message}`;
  }
};
