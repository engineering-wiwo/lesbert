// =============================================================
// super_admin.js  —  BorrowSmart Super Admin Frontend (Enhanced)
//
// Changes from original :
//   • Full assets table fetched from backend via getAssets
//   • Inline row editing: Name, Category, Status, Holder
//   • "Return Asset" button: sets status=Available, clears holder
//   • Delete asset with confirmation
//   • Add Asset from panel at top
//   • Confirmation dialog before any destructive / state-changing op
//   • Per-row saving lock: row dims and inputs disable while request is in flight
//   • Stats counters: Available / Borrowed counts
//   • Category dropdown auto-populated from live asset data
//   • All writes go through editAssetSuper (full field access for super admin)
// =============================================================

// ─── State ───────────────────────────────────────────────────
let accounts        = [];
let saAssets        = [];       // full asset list (raw from API)
let saFilteredAssets = [];      // after search filter
let selectedAccounts = new Set();

// Pending confirmation callback
let _confirmCallback = null;

// ─── Config wait ─────────────────────────────────────────────

function waitForConfig() {
  return new Promise((resolve) => {
    if (typeof CONFIG !== "undefined" && CONFIG.ADMIN_API_URL) { resolve(CONFIG); return; }
    const check = setInterval(() => {
      if (typeof CONFIG !== "undefined" && CONFIG.ADMIN_API_URL) { clearInterval(check); resolve(CONFIG); }
    }, 100);
  });
}

// ─── API helper — GET only ────────────────────────────────────

async function apiGet(baseUrl, params = {}, timeoutMs = 15000) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), { method: "GET", signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return safeParseJson(await res.text());
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error("Request timed out (" + timeoutMs / 1000 + "s)");
    throw err;
  }
}

function safeParseJson(text) {
  const clean = (text || "").trim().replace(/^\)\]\}'/, "").trim();
  try { return JSON.parse(clean); }
  catch { throw new Error("Server returned invalid JSON: " + clean.slice(0, 150)); }
}

// ─── Loading overlay ──────────────────────────────────────────

function ensureFallbackLoadingOverlay() {
  let overlay = document.getElementById("fallbackLoadingOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "fallbackLoadingOverlay";
  overlay.innerHTML = `
    <div class="fallback-loading-card">
      <div class="tenor-gif-embed" data-postid="14596258" data-share-method="host"
           data-aspect-ratio="0.965625" data-width="100%"></div>
      <p>Loading...</p>
    </div>`;

  const style = document.createElement("style");
  style.id = "fallbackLoadingOverlayStyle";
  style.textContent = `
    #fallbackLoadingOverlay{position:fixed;inset:0;display:none;align-items:center;
      justify-content:center;background:rgba(10,15,25,.65);z-index:99999;
      backdrop-filter:blur(2px);padding:24px;box-sizing:border-box}
    #fallbackLoadingOverlay.is-active{display:flex}
    #fallbackLoadingOverlay .fallback-loading-card{display:flex;flex-direction:column;
      align-items:center;gap:12px;background:rgba(15,23,42,.88);
      border:1px solid rgba(148,163,184,.35);border-radius:16px;
      padding:14px 18px;color:#f8fafc;font-weight:600;
      box-shadow:0 10px 28px rgba(0,0,0,.45)}
    #fallbackLoadingOverlay .tenor-gif-embed{width:100%;max-width:280px;border-radius:12px;overflow:hidden}
    #fallbackLoadingOverlay p{margin:0;letter-spacing:.02em}`;

  if (!document.getElementById("fallbackLoadingOverlayStyle"))
    document.head.appendChild(style);

  if (!document.querySelector('script[src="https://tenor.com/embed.js"]')) {
    const s = document.createElement("script");
    s.src = "https://tenor.com/embed.js";
    s.async = true;
    document.head.appendChild(s);
  }

  document.body.appendChild(overlay);
  return overlay;
}

function setLoading(active) {
  ensureFallbackLoadingOverlay().classList.toggle("is-active", Boolean(active));
}

// ─── Init ─────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async function () {
  const config = await waitForConfig();
  if (!config || !config.ADMIN_API_URL) {
    showErrorPopup("Configuration Error", "Admin API URL is not configured.");
    return;
  }

  loadAccounts();
  saLoadAssets();

  const mobileBtn = document.querySelector(".mobile-menu-btn");
  if (mobileBtn) {
    mobileBtn.addEventListener("click", function () {
      const nav = document.getElementById("mobileNav");
      if (nav) nav.classList.toggle("active");
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// ASSETS — LOAD & RENDER
// ═══════════════════════════════════════════════════════════════

async function saLoadAssets() {
  const body = document.getElementById("saAssetsBody");
  if (!body) return;

  body.innerHTML = `<tr><td colspan="8" class="table-loading">
    <div class="spinner"></div> Loading assets…
  </td></tr>`;

  try {
    const config = await waitForConfig();
    const data   = await apiGet(CONFIG.ADMIN_API_URL, { action: "getAssets", t: Date.now() });
    saAssets = Array.isArray(data) ? data : [];

    // Populate category dropdown in Add Asset panel with dynamic cats
    saPopulateCategoryDropdown(saAssets);

    saRenderAssets(saAssets);
    saUpdateStats(saAssets);
  } catch (err) {
    console.error("[saLoadAssets]", err);
    body.innerHTML = `<tr><td colspan="8" class="table-empty">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"/>
      </svg>
      Failed to load assets: ${esc(err.message)}
    </td></tr>`;
  }
}

function saUpdateStats(assets) {
  const available = assets.filter(a => a.status === "Available").length;
  const borrowed  = assets.filter(a => a.status === "Borrowed").length;
  safeSet("saAvailableCount", available);
  safeSet("saBorrowedCount",  borrowed);
}

function saRenderAssets(assets) {
  const body = document.getElementById("saAssetsBody");
  if (!body) return;

  if (!assets.length) {
    body.innerHTML = `<tr><td colspan="8" class="table-empty">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z"/>
      </svg>
      No assets found.
    </td></tr>`;
    return;
  }

  let html = "";
  assets.forEach(asset => {
    const isBorrowed    = asset.status === "Borrowed";
    const statusClass   = asset.status === "Available" ? "available"
                        : asset.status === "Borrowed"  ? "borrowed"
                        : "maintenance";
    const txFormatted   = saFormatDate(saResolveDate(asset));

    html += `<tr id="saRow_${esc(asset.id)}" data-id="${esc(asset.id)}">
      <td style="font-size:12px;color:#64748b;font-family:monospace;">${esc(asset.id)}</td>
      <td class="cell-name">${esc(asset.name || "")}</td>
      <td class="cell-cat">${esc(asset.category || "")}</td>
      <td>
        <span class="status-badge ${statusClass}">
          <span class="status-dot"></span>
          ${esc(asset.status || "Unknown")}
        </span>
      </td>
      <td class="cell-holder" style="color:${asset.holder ? "#f1f5f9" : "#475569"}">
        ${asset.holder ? esc(asset.holder) : '<span style="font-size:11px;color:#475569;">—</span>'}
      </td>
      <td style="font-size:11px;color:#64748b;white-space:nowrap;">${txFormatted}</td>
      <td>
        ${asset.qr
          ? `<img src="${esc(asset.qr)}" class="qr-thumb"
               onclick="saDownloadQR('${esc(asset.id)}','${esc(asset.qr)}')"
               title="Click to download QR">`
          : '<span style="color:#475569;font-size:11px;">—</span>'
        }
      </td>
      <td>
        <div class="action-btns">
          <button class="btn-act btn-edit" onclick="saStartEdit('${esc(asset.id)}')" id="editBtn_${esc(asset.id)}">
            ✏️ Edit
          </button>
          ${isBorrowed
            ? `<button class="btn-act btn-return" onclick="saConfirmReturn('${esc(asset.id)}')" id="returnBtn_${esc(asset.id)}">
                ↩ Return
               </button>`
            : ""
          }
          <button class="btn-act btn-delete" onclick="saConfirmDelete('${esc(asset.id)}')">
            🗑
          </button>
        </div>
      </td>
    </tr>`;
  });

  body.innerHTML = html;
}

// ─── Filter ───────────────────────────────────────────────────

function saFilterAssets(query) {
  const q = (query || "").toLowerCase().trim();
  if (!q) {
    saRenderAssets(saAssets);
    saUpdateStats(saAssets);
    return;
  }
  const filtered = saAssets.filter(a =>
    [a.id, a.name, a.category, a.status, a.holder].some(
      v => (v || "").toLowerCase().includes(q)
    )
  );
  saRenderAssets(filtered);
  saUpdateStats(filtered);
}

// ═══════════════════════════════════════════════════════════════
// ASSETS — INLINE EDIT
// ═══════════════════════════════════════════════════════════════

function saStartEdit(id) {
  const row   = document.getElementById("saRow_" + id);
  const asset = saAssets.find(a => String(a.id) === String(id));
  if (!row || !asset) return;

  // Mark row as editing
  row.classList.add("editing");

  // Get category options from the dropdown
  const catOptions = saGetCategoryOptions();
  const catSelect  = catOptions.map(c =>
    `<option value="${esc(c)}" ${c === asset.category ? "selected" : ""}>${esc(c)}</option>`
  ).join("");

  const statusOptions = ["Available", "Borrowed", "Maintenance"]
    .map(s => `<option value="${esc(s)}" ${s === asset.status ? "selected" : ""}>${esc(s)}</option>`)
    .join("");

  // Replace cells with inputs
  row.querySelector(".cell-name").innerHTML =
    `<input class="cell-edit" id="editName_${esc(id)}" value="${esc(asset.name || "")}" placeholder="Asset name">`;

  row.querySelector(".cell-cat").innerHTML =
    `<select class="cell-edit" id="editCat_${esc(id)}">${catSelect}<option value="__custom__">+ Custom…</option></select>`;

  // Status cell
  const statusTd = row.cells[3];
  statusTd.innerHTML =
    `<select class="cell-edit" id="editStatus_${esc(id)}">${statusOptions}</select>`;

  // Holder cell
  row.querySelector(".cell-holder").innerHTML =
    `<input class="cell-edit" id="editHolder_${esc(id)}" value="${esc(asset.holder || "")}" placeholder="Holder name">`;

  // Actions cell — swap to Save / Cancel
  const actionTd = row.cells[7];
  actionTd.innerHTML = `
    <div class="action-btns">
      <button class="btn-act btn-save" onclick="saSaveEdit('${esc(id)}')">💾 Save</button>
      <button class="btn-act btn-cancel" onclick="saCancelEdit('${esc(id)}')">✕ Cancel</button>
    </div>`;

  // Custom category listener
  const catEl = document.getElementById("editCat_" + id);
  if (catEl) {
    catEl.addEventListener("change", function () {
      if (this.value === "__custom__") {
        const custom = prompt("Enter custom category name:");
        if (custom && custom.trim()) {
          const opt = new Option(custom.trim(), custom.trim());
          this.insertBefore(opt, this.querySelector('option[value="__custom__"]'));
          this.value = custom.trim();
        } else {
          this.value = asset.category || "";
        }
      }
    });
  }

  // Auto-clear holder when status changes to Available
  const statusEl = document.getElementById("editStatus_" + id);
  if (statusEl) {
    statusEl.addEventListener("change", function () {
      if (this.value === "Available") {
        const holderEl = document.getElementById("editHolder_" + id);
        if (holderEl) holderEl.value = "";
      }
    });
  }

  // Focus name
  const nameEl = document.getElementById("editName_" + id);
  if (nameEl) nameEl.focus();
}

function saCancelEdit(id) {
  // Re-render just this row by doing a full re-render
  saRenderAssets(saAssets);
}

async function saSaveEdit(id) {
  const nameEl   = document.getElementById("editName_"   + id);
  const catEl    = document.getElementById("editCat_"    + id);
  const statusEl = document.getElementById("editStatus_" + id);
  const holderEl = document.getElementById("editHolder_" + id);

  if (!nameEl || !catEl || !statusEl || !holderEl) return;

  const name   = nameEl.value.trim();
  const cat    = catEl.value.trim();
  const status = statusEl.value;
  const holder = holderEl.value.trim();

  // Validate
  if (!name) {
    nameEl.classList.add("error");
    nameEl.focus();
    nameEl.placeholder = "Name is required!";
    return;
  }
  if (!cat || cat === "__custom__") {
    catEl.classList.add("error");
    return;
  }

  const row = document.getElementById("saRow_" + id);
  if (row) row.classList.add("saving");

  try {
    const config = await waitForConfig();
    const result = await apiGet(ADMIN.API_URL, {
      action:   "editAssetSuper",
      assetID:  id,
      name,
      category: cat,
      status,
      holder:   status === "Available" ? "" : holder,
    });

    if (result && (result.success === true || (result.message || "").toLowerCase().includes("success"))) {
      // Update local cache
      const idx = saAssets.findIndex(a => String(a.id) === String(id));
      if (idx !== -1) {
        saAssets[idx].name     = name;
        saAssets[idx].category = cat;
        saAssets[idx].status   = status;
        saAssets[idx].holder   = status === "Available" ? "" : holder;
      }
      saRenderAssets(saAssets);
      saUpdateStats(saAssets);
    } else {
      if (row) row.classList.remove("saving");
      showErrorPopup("Save Failed", result?.error || result?.message || "Unknown error from server.");
    }
  } catch (err) {
    if (row) row.classList.remove("saving");
    showErrorPopup("Save Failed", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// ASSETS — RETURN (clear holder, set Available)
// ═══════════════════════════════════════════════════════════════

function saConfirmReturn(id) {
  const asset = saAssets.find(a => String(a.id) === String(id));
  const label = asset ? `"${asset.name}"` : `asset ${id}`;

  showConfirm(
    "warn",
    "Return Asset",
    `Mark ${label} as Available and clear the current holder?`,
    "Return",
    async () => {
      await saDoReturn(id);
    }
  );
}

async function saDoReturn(id) {
  const row = document.getElementById("saRow_" + id);
  if (row) row.classList.add("saving");

  try {
    const config = await waitForConfig();
    const result = await apiGet(ADMIN.API_URL, {
      action:   "editAssetSuper",
      assetID:  id,
      status:   "Available",
      holder:   "",
    });

    if (result && (result.success === true || (result.message || "").toLowerCase().includes("success"))) {
      const idx = saAssets.findIndex(a => String(a.id) === String(id));
      if (idx !== -1) {
        saAssets[idx].status = "Available";
        saAssets[idx].holder = "";
      }
      saRenderAssets(saAssets);
      saUpdateStats(saAssets);
    } else {
      if (row) row.classList.remove("saving");
      showErrorPopup("Return Failed", result?.error || "Could not update asset.");
    }
  } catch (err) {
    if (row) row.classList.remove("saving");
    showErrorPopup("Return Failed", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// ASSETS — DELETE
// ═══════════════════════════════════════════════════════════════

function saConfirmDelete(id) {
  const asset = saAssets.find(a => String(a.id) === String(id));
  const label = asset ? `"${asset.name}"` : `asset ${id}`;

  showConfirm(
    "danger",
    "Delete Asset",
    `Delete ${label} permanently? This cannot be undone.`,
    "Delete",
    async () => {
      await saDoDeleteAsset(id);
    }
  );
}

async function saDoDeleteAsset(id) {
  const row = document.getElementById("saRow_" + id);
  if (row) row.classList.add("saving");

  try {
    const config = await waitForConfig();
    const result = await apiGet(ADMIN.API_URL, {
      action:  "deleteAsset",
      assetID: id,
    });

    if (result && (result.success === true || (result.message || "").toLowerCase().includes("success"))) {
      saAssets = saAssets.filter(a => String(a.id) !== String(id));
      saRenderAssets(saAssets);
      saUpdateStats(saAssets);
    } else {
      if (row) row.classList.remove("saving");
      showErrorPopup("Delete Failed", result?.error || "Could not delete asset.");
    }
  } catch (err) {
    if (row) row.classList.remove("saving");
    showErrorPopup("Delete Failed", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// ASSETS — ADD NEW
// ═══════════════════════════════════════════════════════════════

async function saAddAsset() {
  const nameEl   = document.getElementById("newAssetName");
  const catEl    = document.getElementById("newAssetCategory");
  const customEl = document.getElementById("newAssetCustomCategory");
  const statusEl = document.getElementById("addAssetStatus");
  const btn      = document.getElementById("addAssetBtn");

  const name = (nameEl?.value || "").trim();
  let category = (catEl?.value || "").trim();
  if (category === "Others") category = (customEl?.value || "").trim();

  // Validate
  if (!name) {
    nameEl.style.borderColor = "#ef4444";
    nameEl.focus();
    statusEl.textContent = "Asset name is required.";
    statusEl.className = "add-status err";
    return;
  }
  if (!category) {
    catEl.style.borderColor = "#ef4444";
    statusEl.textContent = "Please select or enter a category.";
    statusEl.className = "add-status err";
    return;
  }

  // Reset error states
  nameEl.style.borderColor = "";
  catEl.style.borderColor  = "";

  btn.disabled = true;
  statusEl.textContent = "Adding asset…";
  statusEl.className   = "add-status";

  try {
    const config  = await waitForConfig();
    const assetID = await saGenerateNextID(config);

    const result = await apiGet(CONFIG.ADMIN_API_URL, {
      action:   "addAsset",
      assetID,
      name,
      category,
      location: "",
    });

    const ok = result?.success === true ||
               (result?.message || "").toLowerCase().includes("success");

    if (ok) {
      statusEl.textContent = "✓ Asset added: " + assetID;
      statusEl.className   = "add-status ok";

      // Clear form
      if (nameEl)   nameEl.value   = "";
      if (catEl)    catEl.value    = "";
      if (customEl) customEl.value = "";
      document.getElementById("customCatField").style.display = "none";

      // Reload assets
      await saLoadAssets();
      setTimeout(() => { statusEl.textContent = ""; }, 3000);
    } else {
      statusEl.textContent = result?.error || result?.message || "Failed to add asset.";
      statusEl.className   = "add-status err";
    }
  } catch (err) {
    console.error("[saAddAsset]", err);
    statusEl.textContent = "Error: " + err.message;
    statusEl.className   = "add-status err";
  } finally {
    btn.disabled = false;
  }
}

async function saGenerateNextID(config) {
  try {
    const data  = await apiGet(CONFIG.ADMIN_API_URL, { action: "getAssets" });
    const items = Array.isArray(data) ? data : [];
    if (!items.length) return "AST-001";
    const max = Math.max(0, ...items.map(a => {
      const m = (a.id || "").match(/AST-(\d+)/);
      return m ? parseInt(m[1], 10) : 0;
    }));
    return "AST-" + String(max + 1).padStart(3, "0");
  } catch {
    return "AST-" + Date.now();
  }
}

// ─── Category helpers ─────────────────────────────────────────

function saGetCategoryOptions() {
  const defaults  = ["Keys", "Electronics", "Equipment", "Tools"];
  const fromAssets = [...new Set(saAssets.map(a => a.category).filter(Boolean))];
  const merged    = [...new Set([...defaults, ...fromAssets])].sort((a, b) => {
    const ai = defaults.indexOf(a);
    const bi = defaults.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b);
  });
  return merged;
}

function saPopulateCategoryDropdown(assets) {
  const sel = document.getElementById("newAssetCategory");
  if (!sel) return;

  const defaults  = ["Keys", "Electronics", "Equipment", "Tools"];
  const dynamic   = [...new Set(assets.map(a => a.category).filter(Boolean))]
    .filter(c => !defaults.some(d => d.toLowerCase() === c.toLowerCase()))
    .sort();

  sel.innerHTML = `<option value="">Select category…</option>`;
  defaults.forEach(c  => sel.innerHTML += `<option value="${c}">${c}</option>`);
  dynamic.forEach(c   => sel.innerHTML += `<option value="${c}">${c}</option>`);
  sel.innerHTML += `<option value="Others">Others (custom…)</option>`;
}

// ─── QR download ─────────────────────────────────────────────

function saDownloadQR(id, url) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width  = img.naturalWidth  || 200;
      canvas.height = img.naturalHeight || 200;
      canvas.getContext("2d").drawImage(img, 0, 0);
      canvas.toBlob(blob => {
        if (!blob) { window.open(url, "_blank"); return; }
        const a   = document.createElement("a");
        const obj = URL.createObjectURL(blob);
        a.href = obj; a.download = id + ".png";
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(obj);
      }, "image/png");
    } catch { window.open(url, "_blank"); }
  };
  img.onerror = () => window.open(url, "_blank");
  img.src = url + (url.includes("?") ? "&" : "?") + "_t=" + Date.now();
}

// ─── Date helpers ─────────────────────────────────────────────

function saResolveDate(asset) {
  const log = JSON.parse(localStorage.getItem("assetTransactions") || "{}");
  return (
    asset.transactionDateTime || asset.transactionAt  || asset.lastTransactionAt ||
    asset.lastUpdated         || asset.updatedAt       || asset.borrowedAt        ||
    asset.returnedAt          || (log[asset.id] && log[asset.id].dateTime) || ""
  );
}

function saFormatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

// ─── XSS escaper ─────────────────────────────────────────────

function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeSet(id, val) {
  const el = document.getElementById(id);
  if (el) el.innerText = val;
}

// ═══════════════════════════════════════════════════════════════
// CONFIRM DIALOG
// ═══════════════════════════════════════════════════════════════

function showConfirm(type, title, msg, confirmLabel, callback) {
  _confirmCallback = callback;

  document.getElementById("confirmTitle").textContent = title;
  document.getElementById("confirmMsg").textContent   = msg;

  const iconEl  = document.getElementById("confirmIcon");
  const okBtn   = document.getElementById("confirmOkBtn");
  const iconSvg = document.getElementById("confirmIconSvg");

  iconEl.className = "confirm-icon " + (type === "danger" ? "danger" : "warn");
  okBtn.className  = "confirm-btn confirm" + (type === "danger" ? " danger" : "");
  okBtn.textContent = confirmLabel || "Confirm";

  if (type === "danger") {
    iconSvg.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round"
      d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>`;
    iconSvg.style.stroke = "#ef4444";
  } else {
    iconSvg.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round"
      d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3"/>`;
    iconSvg.style.stroke = "#f59e0b";
  }

  document.getElementById("confirmOverlay").classList.add("active");
}

function closeConfirm() {
  document.getElementById("confirmOverlay").classList.remove("active");
  _confirmCallback = null;
}

function confirmAction() {
  closeConfirm();
  if (typeof _confirmCallback === "function") _confirmCallback();
}

// ═══════════════════════════════════════════════════════════════
// ADMIN ACCOUNTS — unchanged from original, kept intact
// ═══════════════════════════════════════════════════════════════

async function loadAccounts() {
  setLoading(true);
  try {
    const result = await apiGet(CONFIG.ADMIN_API_URL, { action: "getAdminAccounts", t: Date.now() });
    if (result.success) {
      accounts = result.accounts || [];
      displayAccounts();
    } else {
      showErrorPopup("Error", result.error || "Failed to load admin accounts");
    }
  } catch (err) {
    showErrorPopup("Error", "Failed to load admin accounts: " + err.message);
  } finally {
    setLoading(false);
  }
}

async function addAccount() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const email    = document.getElementById("email").value.trim();

  if (!username || !password || !email) { showErrorPopup("Error", "All fields are required"); return; }

  if (CONFIG.COMPANY_DOMAIN && !email.endsWith("@" + CONFIG.COMPANY_DOMAIN)) {
    showErrorPopup("Error", "Email must be from " + CONFIG.COMPANY_DOMAIN + " domain"); return;
  }
  if (accounts.some(a => a.username === username)) { showErrorPopup("Error", "Username already exists"); return; }

  setLoading(true);
  try {
    const result = await apiGet(CONFIG.ADMIN_API_URL, {
      action: "addAdminAccount", username, password, email, createdDate: new Date().toISOString(),
    });
    if (result.success) {
      await loadAccounts();
      document.getElementById("addAccountForm").reset();
      showSuccessPopup("Success", "Admin account added successfully");
    } else {
      showErrorPopup("Error", result.error || "Failed to add admin account");
    }
  } catch (err) {
    showErrorPopup("Error", "Failed to add admin account: " + err.message);
  } finally {
    setLoading(false);
  }
}

async function saveAccountChanges() {
  const id       = parseInt(document.getElementById("editAccountId").value);
  const username = document.getElementById("editUsername").value.trim();
  const email    = document.getElementById("editEmail").value.trim();
  const password = document.getElementById("editPassword").value;

  if (!username || !email) { showErrorPopup("Error", "Username and email are required"); return; }
  if (CONFIG.COMPANY_DOMAIN && !email.endsWith("@" + CONFIG.COMPANY_DOMAIN)) {
    showErrorPopup("Error", "Email must be from " + CONFIG.COMPANY_DOMAIN + " domain"); return;
  }
  if (accounts.some(a => a.username === username && a.id !== id)) {
    showErrorPopup("Error", "Username already exists"); return;
  }

  setLoading(true);
  try {
    const params = { action: "updateAdminAccount", id, username, email };
    if (password) params.password = password;
    const result = await apiGet(CONFIG.ADMIN_API_URL, params);
    if (result.success) {
      await loadAccounts();
      closeEditPopup();
      showSuccessPopup("Success", "Admin account updated successfully");
    } else {
      showErrorPopup("Error", result.error || "Failed to update admin account");
    }
  } catch (err) {
    showErrorPopup("Error", "Failed to update admin account: " + err.message);
  } finally {
    setLoading(false);
  }
}

async function deleteAccount(id) {
  if (accounts.length <= 1) { showWarningPopup("Cannot Delete", "You cannot delete the last admin account."); return; }
  if (!confirm('Delete admin account "' + accounts.find(a => a.id === id)?.username + '"?')) return;
  setLoading(true);
  try {
    const result = await apiGet(CONFIG.ADMIN_API_URL, { action: "deleteAdminAccount", id });
    if (result.success) {
      await loadAccounts();
      showSuccessPopup("Success", "Admin account deleted successfully");
    } else {
      showErrorPopup("Error", result.error || "Failed to delete admin account");
    }
  } catch (err) {
    showErrorPopup("Error", "Failed to delete admin account: " + err.message);
  } finally {
    setLoading(false);
  }
}

async function confirmDelete() {
  setLoading(true);
  try {
    for (const id of selectedAccounts) {
      const result = await apiGet(CONFIG.ADMIN_API_URL, { action: "deleteAdminAccount", id });
      if (!result.success) throw new Error(result.error || "Delete failed");
    }
    selectedAccounts.clear();
    document.getElementById("selectAll").checked = false;
    await loadAccounts();
    updateDeleteButton();
    closeDeletePopup();
    showSuccessPopup("Success", "Selected admin accounts deleted successfully");
  } catch (err) {
    closeDeletePopup();
    showErrorPopup("Error", "Failed to delete admin accounts: " + err.message);
  } finally {
    setLoading(false);
  }
}

function displayAccounts() {
  const accountsBody = document.getElementById("accountsBody");
  accountsBody.innerHTML = "";

  if (!accounts.length) {
    accountsBody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--fg-muted);">No admin accounts found</td></tr>';
    return;
  }

  const isLastAccount = accounts.length <= 1;
  accounts.forEach(account => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><input type="checkbox" class="account-checkbox" data-id="${account.id}"
          onchange="toggleAccountSelection(${account.id})"></td>
      <td>${account.username}</td>
      <td>${account.email || ""}</td>
      <td>
        <button class="btn-secondary" style="padding:6px 12px;font-size:12px;"
            onclick="editAccount(${account.id})">Edit</button>
        ${!isLastAccount
          ? `<button class="btn-secondary" style="padding:6px 12px;font-size:12px;background:var(--danger);"
                onclick="deleteAccount(${account.id})">Delete</button>`
          : `<button class="btn-secondary" style="padding:6px 12px;font-size:12px;opacity:.5;cursor:not-allowed;" disabled>Delete</button>`
        }
      </td>`;
    accountsBody.appendChild(row);
  });
  updateDeleteButtonVisibility();
}

function editAccount(id) {
  const account = accounts.find(a => a.id === id);
  if (!account) return;
  document.getElementById("editAccountId").value = account.id;
  document.getElementById("editUsername").value  = account.username;
  document.getElementById("editEmail").value     = account.email || "";
  document.getElementById("editPassword").value  = "";
  document.getElementById("editPopup").classList.add("active");
}

function closeEditPopup() { document.getElementById("editPopup").classList.remove("active"); }

function toggleSelectAll() {
  const checked = document.getElementById("selectAll").checked;
  document.querySelectorAll(".account-checkbox").forEach(cb => {
    cb.checked = checked;
    const id = parseInt(cb.getAttribute("data-id"));
    checked ? selectedAccounts.add(id) : selectedAccounts.delete(id);
  });
  updateDeleteButton();
}

function toggleAccountSelection(id) {
  selectedAccounts.has(id) ? selectedAccounts.delete(id) : selectedAccounts.add(id);
  updateDeleteButton();
  const allChecked = Array.from(document.querySelectorAll(".account-checkbox")).every(cb => cb.checked);
  document.getElementById("selectAll").checked = allChecked;
}

function updateDeleteButton() {
  const btn = document.getElementById("deleteSelectedBtn");
  if (accounts.length <= 1) { btn.style.display = "none"; return; }
  if (selectedAccounts.size > 0) {
    btn.style.display = "block";
    btn.textContent   = "Delete Selected (" + selectedAccounts.size + ")";
  } else {
    btn.style.display = "none";
  }
}

function updateDeleteButtonVisibility() {
  const btn = document.getElementById("deleteSelectedBtn");
  if (accounts.length <= 1) btn.style.display = "none";
}

function deleteSelectedAccounts() {
  const remaining = accounts.filter(a => !selectedAccounts.has(a.id));
  if (!remaining.length) {
    showWarningPopup("Cannot Delete", "You cannot delete all admin accounts. At least one must remain.");
    return;
  }
  document.getElementById("deletePopup").classList.add("active");
}

function closeDeletePopup() { document.getElementById("deletePopup").classList.remove("active"); }

function searchAccounts() {
  const q = document.getElementById("searchAccounts").value.toLowerCase();
  document.querySelectorAll("#accountsBody tr").forEach(row => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

// ── Popups ────────────────────────────────────────────────────

function showSuccessPopup(title, message) {
  document.getElementById("successTitle").textContent   = title;
  document.getElementById("successMessage").textContent = message;
  document.getElementById("successPopup").classList.add("active");
}
function closeSuccessPopup() { document.getElementById("successPopup").classList.remove("active"); }

function showErrorPopup(title, message) {
  document.getElementById("errorTitle").textContent   = title;
  document.getElementById("errorMessage").textContent = message;
  document.getElementById("errorPopup").classList.add("active");
}
function closeErrorPopup() { document.getElementById("errorPopup").classList.remove("active"); }

function showWarningPopup(title, message) {
  document.getElementById("warningTitle").textContent   = title;
  document.getElementById("warningMessage").textContent = message;
  document.getElementById("warningPopup").classList.add("active");
}
function closeWarningPopup() { document.getElementById("warningPopup").classList.remove("active"); }
