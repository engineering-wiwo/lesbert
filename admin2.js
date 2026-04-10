// =============================================================
// admin.js  —  BorrowSmart Admin Frontend
//
// Architecture:
//   GET  → doGet()  in GAS — for reads (getAssets, authenticate, etc.)
//   POST → doPost() in GAS — for writes (addAsset, editAsset, deleteAsset)
//
// No JSONP. No mode:"no-cors". Standard fetch() everywhere.
// GAS backend sends Access-Control-Allow-Origin:* on every response.
// =============================================================

// ─── API HELPERS ─────────────────────────────────────────────

/**
 * GET — appends params to the URL and fetches JSON.
 * Used for all read operations.
 */
async function apiGet(baseUrl, params = {}, timeoutMs = 12000) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
      // No explicit mode — browser default is "cors", which is correct.
      // GAS will respond with Access-Control-Allow-Origin: *
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error("HTTP " + res.status);
    return safeParseJson(await res.text());
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError")
      throw new Error("Request timed out (" + timeoutMs / 1000 + "s)");
    throw err;
  }
}

/**
 * POST — sends a JSON body.
 * Used for all write operations (add, edit, delete).
 * Handled by doPost() in GAS.
 */
async function apiPost(baseUrl, body = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error("HTTP " + res.status);
    return safeParseJson(await res.text());
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError")
      throw new Error("Request timed out (" + timeoutMs / 1000 + "s)");
    throw err;
  }
}

/** Safely parse JSON — GAS occasionally adds a )]}' XSS guard prefix */
function safeParseJson(text) {
  const clean = (text || "").trim().replace(/^\)\]\}'/, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error("Server returned invalid JSON: " + clean.slice(0, 150));
  }
}

// ─── LOADING OVERLAY ─────────────────────────────────────────

function ensureFallbackLoadingOverlay() {
  if (document.getElementById("fallbackLoadingOverlay"))
    return document.getElementById("fallbackLoadingOverlay");

  const overlay = document.createElement("div");
  overlay.id = "fallbackLoadingOverlay";
  overlay.innerHTML = `
    <div class="fallback-loading-card">
      <div class="tenor-gif-embed" data-postid="14596258"
           data-share-method="host" data-aspect-ratio="0.965625" data-width="100%">
        <a href="https://tenor.com/view/polskie-radio-disco-polo-polski-rock-duck-walking-gif-14596258"></a>
      </div>
      <p>Loading…</p>
    </div>`;

  if (!document.getElementById("fallbackLoadingOverlayStyle")) {
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
      #fallbackLoadingOverlay .tenor-gif-embed{width:100%;max-width:280px;
        border-radius:12px;overflow:hidden}
      #fallbackLoadingOverlay p{margin:0;letter-spacing:.02em}`;
    document.head.appendChild(style);
  }

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
  if (window.shopify && typeof window.shopify.loading === "function") {
    window.shopify.loading(active);
    return;
  }
  ensureFallbackLoadingOverlay().classList.toggle("is-active", Boolean(active));
}

// ─── UI STATE ─────────────────────────────────────────────────

function updateUI() {
  const loggedIn = localStorage.getItem("adminLoggedIn") === "true";
  const admin = JSON.parse(localStorage.getItem("currentAdmin") || "{}");

  const nav           = document.getElementById("mainNav");
  const mobileNav     = document.getElementById("mobileNav");
  const loginSection  = document.getElementById("loginSection");
  const dashSection   = document.getElementById("dashboardSection");

  if (!nav || !mobileNav || !loginSection || !dashSection) return;

  if (loggedIn) {
    loginSection.style.display  = "none";
    dashSection.style.display   = "block";

    const displayName = admin.username
      ? admin.username.charAt(0).toUpperCase() + admin.username.slice(1)
      : "Admin";

    const links = `
      <a href="index.html">User Page</a>
      <a href="#" class="nav-admin">${displayName}</a>
      <a href="about.html">About</a>
      <a href="#" onclick="logout()">Logout</a>`;

    nav.innerHTML = mobileNav.innerHTML = links;
    loadAssets();
  } else {
    loginSection.style.display = "block";
    dashSection.style.display  = "none";

    const links = `
      <a href="index.html">User Page</a>
      <a href="about.html">About</a>
      <a href="#">Admin</a>`;

    nav.innerHTML = mobileNav.innerHTML = links;
  }
}

// ─── LOGIN ────────────────────────────────────────────────────

async function handleLogin(e) {
  e.preventDefault();

  const user     = document.getElementById("username").value.trim();
  const pass     = document.getElementById("password").value.trim();
  const errorDiv = document.getElementById("loginError");

  if (!user || !pass) {
    showLoginError(errorDiv, "Username and password are required.");
    return;
  }

  showLoginError(errorDiv, "Authenticating…");

  try {
    const result = await apiGet(CONFIG.ADMIN_API_URL, {
      action:   "authenticate",
      username: user,
      password: pass,
    });

    if (result && result.success) {
      localStorage.setItem("adminLoggedIn", "true");
      localStorage.setItem("currentAdmin", JSON.stringify(result.account));
      errorDiv.style.display = "none";
      notifyAdminAccess(user);
      updateUI();
    } else {
      showLoginError(errorDiv, (result && result.error) || "Invalid credentials.");
    }
  } catch (err) {
    console.error("[Login]", err);
    showLoginError(errorDiv, "Authentication failed — " + err.message);
  }
}

function showLoginError(el, msg) {
  if (!el) return;
  el.textContent    = msg;
  el.style.display  = "block";
}

/** Fire-and-forget access notification — errors are non-fatal */
function notifyAdminAccess(username) {
  const notifyEmail = localStorage.getItem("bs_notify_email") || "";
  if (!notifyEmail) return;

  apiGet(CONFIG.ADMIN_API_URL, {
    action:  "sendNotificationEmail",
    to:      notifyEmail,
    subject: "[BorrowSmart] Admin Login: " + username,
    body:    'Admin "' + username + '" logged in at ' + new Date().toLocaleString() + ".",
  }).catch((err) => console.warn("[Notify]", err));
}

function logout() {
  localStorage.removeItem("adminLoggedIn");
  localStorage.removeItem("currentAdmin");
  updateUI();
}

// ─── SECRET KEY ───────────────────────────────────────────────

let _keySeq   = [];
const _secret = "@";

function initSecretKey() {
  document.addEventListener("keydown", (e) => {
    const dash = document.getElementById("dashboardSection");
    if (!dash || dash.style.display === "none") return;
    _keySeq.push(e.key);
    if (_keySeq.length > _secret.length) _keySeq.shift();
    if (_keySeq.join("") === _secret) {
      window.location.href = "super_admin.html";
      _keySeq = [];
    }
  });
}

// ─── LOAD ASSETS ─────────────────────────────────────────────

async function loadAssets() {
  setLoading(true);
  try {
    const data = await apiGet(CONFIG.API_URL, { action: "getAssets" });
    const body = document.getElementById("assetBody");
    if (!body) return;

    const assets = Array.isArray(data) ? data : [];
    let html = "", borrowed = 0, available = 0;

    assets.forEach((asset) => {
      if (asset.status === "Borrowed")  borrowed++;
      if (asset.status === "Available") available++;

      const badge =
        asset.status === "Available" ? "badge badge-green" :
        asset.status === "Borrowed"  ? "badge badge-red"   : "badge";

      const locked =
        asset.status === "Borrowed"
          ? "disabled style='opacity:.4;pointer-events:none'"
          : "";

      const txFormatted = formatDateTime(resolveTransactionDate(asset));

      html += `
        <tr>
          <td>${esc(asset.id)}</td>
          <td contenteditable="true">${esc(asset.name)}</td>
          <td contenteditable="true">${esc(asset.category || "")}</td>
          <td><span class="${badge}">${esc(asset.status)}</span></td>
          <td>${esc(asset.holder || "")}</td>
          <td><span style="font-size:12px;color:#cbd5e1">${txFormatted}</span></td>
          <td>${asset.qr
            ? `<img src="${esc(asset.qr)}" width="40" style="cursor:pointer"
                    onclick="downloadQR('${esc(asset.id)}','${esc(asset.qr)}')">`
            : "—"
          }</td>
          <td>
            <button onclick="saveEdit(this,'${esc(asset.id)}')" ${locked}>💾</button>
            <button onclick="deleteAsset('${esc(asset.id)}')">🗑️</button>
          </td>
        </tr>`;
    });

    body.innerHTML = html;
    safeSet("borrowedAssets",  borrowed);
    safeSet("availableAssets", available);
  } catch (err) {
    console.error("[loadAssets]", err);
    alert("Failed to load assets: " + err.message);
  } finally {
    setLoading(false);
  }
}

function safeSet(id, val) {
  const el = document.getElementById(id);
  if (el) el.innerText = val;
}

function resolveTransactionDate(asset) {
  const log = JSON.parse(localStorage.getItem("assetTransactions") || "{}");
  return (
    asset.transactionDateTime ||
    asset.transactionAt       ||
    asset.lastTransactionAt   ||
    asset.lastUpdated         ||
    asset.updatedAt           ||
    asset.borrowedAt          ||
    asset.returnedAt          ||
    (log[asset.id] && log[asset.id].dateTime) ||
    ""
  );
}

function formatDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? String(value) : d.toLocaleString();
}

/** Minimal XSS escaper for data inserted into innerHTML */
function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ─── QR DOWNLOAD ─────────────────────────────────────────────
// api.qrserver.com supports CORS — draw to canvas → Blob → download.
// Falls back to window.open if canvas is blocked (should not happen).

function downloadQR(id, url) {
  const img   = new Image();
  img.crossOrigin = "anonymous";

  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width  = img.naturalWidth  || 200;
      canvas.height = img.naturalHeight || 200;
      canvas.getContext("2d").drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) { window.open(url, "_blank"); return; }
        const a   = document.createElement("a");
        const obj = URL.createObjectURL(blob);
        a.href     = obj;
        a.download = id + ".png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(obj);
      }, "image/png");
    } catch {
      window.open(url, "_blank");
    }
  };

  img.onerror = () => window.open(url, "_blank");
  // Cache-bust prevents a previously-cached opaque response from tainting the canvas
  img.src = url + (url.includes("?") ? "&" : "?") + "_t=" + Date.now();
}

// ─── CRUD ─────────────────────────────────────────────────────

function saveEdit(btn, id) {
  const row = btn.closest("tr");
  setLoading(true);

  apiPost(CONFIG.API_URL, {
    action:   "editAsset",
    assetID:  id,
    name:     row.cells[1].innerText.trim(),
    category: row.cells[2].innerText.trim(),
    location: "",
  })
    .then(() => loadAssets())
    .catch((err) => alert("Edit failed: " + err.message))
    .finally(() => setLoading(false));
}

function deleteAsset(id) {
  if (!confirm("Delete asset " + id + "?")) return;
  setLoading(true);

  apiPost(CONFIG.API_URL, { action: "deleteAsset", assetID: id })
    .then(() => loadAssets())
    .catch((err) => alert("Delete failed: " + err.message))
    .finally(() => setLoading(false));
}

async function addAsset() {
  const name     = document.getElementById("assetName").value.trim();
  const category = document.getElementById("category").value.trim();
  const customCategory = document.getElementById("customCategory")?.value.trim() || "";

  if (!name) { alert("Asset name is required."); return; }

  // Use custom category if "Others" is selected and custom category is provided
  let finalCategory = category;
  if (category === 'Others') {
    if (!customCategory) {
      alert("Please enter a custom category name.");
      return;
    }
    finalCategory = customCategory;
  }

  setLoading(true);
  try {
    const assetID = await generateNextAssetID();
    const result  = await apiPost(CONFIG.API_URL, {
      action: "addAsset",
      assetID, 
      name, 
      category: finalCategory, 
      location: "",
    });

    const ok =
      result?.success === true ||
      (result?.message || "").toLowerCase().includes("success");

    if (ok) {
      generateQRPreview(assetID);
      alert("Asset added: " + assetID);
      loadAssets();
      const form = document.getElementById("addAssetForm");
      if (form) {
        form.reset();
        // Hide custom category input after reset
        const customDiv = document.getElementById("customCategoryDiv");
        if (customDiv) customDiv.style.display = 'none';
      }
    } else {
      alert(result?.error || result?.message || "Failed to add asset.");
    }
  } catch (err) {
    console.error("[addAsset]", err);
    alert("Failed to add asset: " + err.message);
  } finally {
    setLoading(false);
  }
}

// ─── CATEGORY HANDLER ─────────────────────────────────────────────
// NEW: Function to handle category dropdown change
function handleCategoryChange(value) {
  const customCategoryDiv = document.getElementById('customCategoryDiv');
  const customCategoryInput = document.getElementById('customCategory');
  
  if (value === 'Others') {
    customCategoryDiv.style.display = 'block';
    customCategoryInput.required = true;
  } else {
    customCategoryDiv.style.display = 'none';
    customCategoryInput.required = false;
    customCategoryInput.value = '';
  }
}

async function generateNextAssetID() {
  try {
    const data  = await apiGet(CONFIG.API_URL, { action: "getAssets" });
    const items = Array.isArray(data) ? data : [];
    if (!items.length) return "AST-001";

    const max = Math.max(
      0,
      ...items.map((a) => {
        const m = (a.id || "").match(/AST-(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      })
    );
    return "AST-" + String(max + 1).padStart(3, "0");
  } catch {
    return "AST-" + Date.now();
  }
}

// ─── QR PREVIEW ──────────────────────────────────────────────

function generateQRPreview(id) {
  const container = document.getElementById("qrPreviewContainer");
  const img       = document.getElementById("qrPreview");
  if (!container || !img) return;
  container.style.display = "block";
  img.src =
    "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" +
    encodeURIComponent(id);
}

// ─── SEARCH ───────────────────────────────────────────────────

function searchInventory() {
  const q = (document.getElementById("search").value || "").toLowerCase();
  document.querySelectorAll("#assetBody tr").forEach((row) => {
    row.style.display = row.innerText.toLowerCase().includes(q) ? "" : "none";
  });
}

// ─── CSV ──────────────────────────────────────────────────────

function downloadCSV() {
  const table = document.querySelector("table");
  if (!table) return;

  const rows = [];
  table.querySelectorAll("tr").forEach((row) => {
    const cols = [];
    row.querySelectorAll("td,th").forEach((cell) =>
      cols.push('"' + cell.innerText.replace(/"/g, '""') + '"')
    );
    rows.push(cols.join(","));
  });

  const a   = document.createElement("a");
  a.href    = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
  a.download = "BorrowSmart_Inventory_Report.csv";
  a.click();
}

// ─── INIT ─────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  updateUI();
  initSecretKey();

  // ── Mobile nav
  const mobileMenuBtn = document.querySelector(".mobile-menu-btn");
  const mobileNav     = document.querySelector(".mobile-nav");

  if (mobileMenuBtn && mobileNav) {
    mobileMenuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = mobileNav.classList.toggle("active");
      document.body.style.overflow = open ? "hidden" : "";
    });

    document.addEventListener("click", (e) => {
      if (!mobileNav.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
        mobileNav.classList.remove("active");
        document.body.style.overflow = "";
      }
    });

    mobileNav.addEventListener("click", (e) => {
      if (e.target.tagName === "A") {
        mobileNav.classList.remove("active");
        document.body.style.overflow = "";
      }
    });
  }

  // ── Card entrance animations
  const isMobile  = window.innerWidth < 768;
  const observer  = new IntersectionObserver((entries) =>
    entries.forEach((entry) => {
      if (entry.isIntersecting) entry.target.classList.add("animate-in");
    })
  );

  document.querySelectorAll(".card, .stat-card, .team-card").forEach((el) => {
    if (isMobile) el.classList.add("animate-in");
    else observer.observe(el);
  });
});
