// =============================================================
// super_admin.js  —  BorrowSmart Super Admin Frontend
//
// CORS FIX: GAS does not handle OPTIONS preflight requests.
// fetch() POST with Content-Type:application/json always triggers
// a preflight → blocked. Fix: use GET for every call. GAS doGet()
// now handles all actions (reads AND writes) via URL params.
// =============================================================

let accounts = [];
let selectedAccounts = new Set();
let assets = [];

// ── Config wait ───────────────────────────────────────────────

function waitForConfig() {
  return new Promise((resolve) => {
    if (typeof CONFIG !== "undefined" && CONFIG.ADMIN_API_URL) {
      resolve(CONFIG);
      return;
    }
    const check = setInterval(() => {
      if (typeof CONFIG !== "undefined" && CONFIG.ADMIN_API_URL) {
        clearInterval(check);
        resolve(CONFIG);
      }
    }, 100);
  });
}

// ── Single API helper — GET only, no preflight ────────────────
// All params go in the URL query string.
// No custom headers = "simple request" = no CORS preflight.

async function apiGet(baseUrl, params = {}, timeoutMs = 15000) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
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

function safeParseJson(text) {
  const clean = (text || "").trim().replace(/^\)\]\}'/, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error("Server returned invalid JSON: " + clean.slice(0, 150));
  }
}

// ── Loading overlay ───────────────────────────────────────────

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
  if (window.shopify && typeof window.shopify.loading === "function") {
    window.shopify.loading(active);
    return;
  }
  ensureFallbackLoadingOverlay().classList.toggle("is-active", Boolean(active));
}

// ── Init ──────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async function () {
  const config = await waitForConfig();

  if (!config || !config.ADMIN_API_URL) {
    showErrorPopup("Configuration Error", "Admin API URL is not configured.");
    return;
  }

  loadAccounts();
  loadAssetsForSuperAdmin();
  
  const mobileBtn = document.querySelector(".mobile-menu-btn");
  if (mobileBtn) {
    mobileBtn.addEventListener("click", function () {
      const nav = document.getElementById("mobileNav");
      if (nav) nav.classList.toggle("active");
    });
  }
});

function getAssetsApiUrl() {
  return CONFIG.API_URL || CONFIG.ADMIN_API_URL;
}

// ── Load accounts ─────────────────────────────────────────────

async function loadAccounts() {
  setLoading(true);
  try {
    const result = await apiGet(CONFIG.ADMIN_API_URL, {
      action: "getAdminAccounts",
      t: Date.now(),
    });

    if (result.success) {
      accounts = result.accounts || [];
      displayAccounts();
    } else {
      showErrorPopup("Error", result.error || "Failed to load admin accounts");
    }
  } catch (err) {
    console.error("Error loading admin accounts:", err);
    showErrorPopup("Error", "Failed to load admin accounts: " + err.message);
  } finally {
    setLoading(false);
  }
}

// ── Load assets for super admin ──────────────────────────────

async function loadAssetsForSuperAdmin() {
  const body = document.getElementById("superAssetsBody");
  if (!body) return;

  setLoading(true);
  try {
    const result = await apiGet(getAssetsApiUrl(), {
      action: "getAssets",
      t: Date.now(),
    });

    assets = Array.isArray(result) ? result : [];
    displaySuperAssets();
  } catch (err) {
    console.error("Error loading assets:", err);
    showErrorPopup("Error", "Failed to load assets: " + err.message);
  } finally {
    setLoading(false);
  }
}

// ── Add account ───────────────────────────────────────────────

async function addAccount() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const email    = document.getElementById("email").value.trim();

  if (!username || !password || !email) {
    showErrorPopup("Error", "All fields are required");
    return;
  }

  if (CONFIG.COMPANY_DOMAIN && !email.endsWith("@" + CONFIG.COMPANY_DOMAIN)) {
    showErrorPopup("Error", "Email must be from " + CONFIG.COMPANY_DOMAIN + " domain");
    return;
  }

  if (accounts.some((a) => a.username === username)) {
    showErrorPopup("Error", "Username already exists");
    return;
  }

  setLoading(true);
  try {
    const result = await apiGet(CONFIG.ADMIN_API_URL, {
      action:      "addAdminAccount",
      username,
      password,
      email,
      createdDate: new Date().toISOString(),
    });

    if (result.success) {
      await loadAccounts();
      document.getElementById("addAccountForm").reset();
      showSuccessPopup("Success", "Admin account added successfully");
    } else {
      showErrorPopup("Error", result.error || "Failed to add admin account");
    }
  } catch (err) {
    console.error("Error adding admin account:", err);
    showErrorPopup("Error", "Failed to add admin account: " + err.message);
  } finally {
    setLoading(false);
  }
}


// ── Save edits ────────────────────────────────────────────────

async function saveAccountChanges() {
  const id       = parseInt(document.getElementById("editAccountId").value);
  const username = document.getElementById("editUsername").value.trim();
  const email    = document.getElementById("editEmail").value.trim();
  const password = document.getElementById("editPassword").value;

  if (!username || !email) {
    showErrorPopup("Error", "Username and email are required");
    return;
  }

  if (CONFIG.COMPANY_DOMAIN && !email.endsWith("@" + CONFIG.COMPANY_DOMAIN)) {
    showErrorPopup("Error", "Email must be from " + CONFIG.COMPANY_DOMAIN + " domain");
    return;
  }

  if (accounts.some((a) => a.username === username && a.id !== id)) {
    showErrorPopup("Error", "Username already exists");
    return;
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
    console.error("Error updating admin account:", err);
    showErrorPopup("Error", "Failed to update admin account: " + err.message);
  } finally {
    setLoading(false);
  }
}

// ── Delete single account ─────────────────────────────────────

async function deleteAccount(id) {
  const account = accounts.find((a) => a.id === id);

  if (accounts.length <= 1) {
    showWarningPopup("Cannot Delete", "You cannot delete the last admin account.");
    return;
  }

  if (!confirm('Delete admin account "' + account.username + '"?')) return;

  setLoading(true);
  try {
    const result = await apiGet(CONFIG.ADMIN_API_URL, {
      action: "deleteAdminAccount",
      id,
    });

    if (result.success) {
      await loadAccounts();
      showSuccessPopup("Success", "Admin account deleted successfully");
    } else {
      showErrorPopup("Error", result.error || "Failed to delete admin account");
    }
  } catch (err) {
    console.error("Error deleting admin account:", err);
    showErrorPopup("Error", "Failed to delete admin account: " + err.message);
  } finally {
    setLoading(false);
  }
}

// ── Delete selected accounts ──────────────────────────────────

async function confirmDelete() {
  setLoading(true);
  try {
    for (const id of selectedAccounts) {
      const result = await apiGet(CONFIG.ADMIN_API_URL, {
        action: "deleteAdminAccount",
        id,
      });
      if (!result.success) throw new Error(result.error || "Delete failed");
    }

    selectedAccounts.clear();
    document.getElementById("selectAll").checked = false;
    await loadAccounts();
    updateDeleteButton();
    closeDeletePopup();
    showSuccessPopup("Success", "Selected admin accounts deleted successfully");
  } catch (err) {
    console.error("Error deleting admin accounts:", err);
    closeDeletePopup();
    showErrorPopup("Error", "Failed to delete admin accounts: " + err.message);
  } finally {
    setLoading(false);
  }
}

// ── Display ───────────────────────────────────────────────────

function displayAccounts() {
  const accountsBody = document.getElementById("accountsBody");
  accountsBody.innerHTML = "";

  if (!accounts.length) {
    accountsBody.innerHTML =
      '<tr><td colspan="4" style="text-align:center;color:var(--fg-muted);">No admin accounts found</td></tr>';
    return;
  }

  const isLastAccount = accounts.length <= 1;

  accounts.forEach((account) => {
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
          ? `<button class="btn-secondary"
                style="padding:6px 12px;font-size:12px;background:var(--danger);"
                onclick="deleteAccount(${account.id})">Delete</button>`
          : `<button class="btn-secondary"
                style="padding:6px 12px;font-size:12px;opacity:.5;cursor:not-allowed;"
                disabled>Delete</button>`
        }
      </td>`;
    accountsBody.appendChild(row);
  });

  updateDeleteButtonVisibility();
}

function editAccount(id) {
  const account = accounts.find((a) => a.id === id);
  if (!account) return;
  document.getElementById("editAccountId").value = account.id;
  document.getElementById("editUsername").value  = account.username;
  document.getElementById("editEmail").value     = account.email || "";
  document.getElementById("editPassword").value  = "";
  document.getElementById("editPopup").classList.add("active");
}

function closeEditPopup() {
  document.getElementById("editPopup").classList.remove("active");
}

function toggleSelectAll() {
  const checked = document.getElementById("selectAll").checked;
  document.querySelectorAll(".account-checkbox").forEach((cb) => {
    cb.checked = checked;
    const id = parseInt(cb.getAttribute("data-id"));
    checked ? selectedAccounts.add(id) : selectedAccounts.delete(id);
  });
  updateDeleteButton();
}

function toggleAccountSelection(id) {
  selectedAccounts.has(id) ? selectedAccounts.delete(id) : selectedAccounts.add(id);
  updateDeleteButton();
  const allChecked = Array.from(
    document.querySelectorAll(".account-checkbox")
  ).every((cb) => cb.checked);
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
  const remaining = accounts.filter((a) => !selectedAccounts.has(a.id));
  if (!remaining.length) {
    showWarningPopup(
      "Cannot Delete",
      "You cannot delete all admin accounts. At least one must remain."
    );
    return;
  }
  document.getElementById("deletePopup").classList.add("active");
}

function closeDeletePopup() {
  document.getElementById("deletePopup").classList.remove("active");
}

function searchAccounts() {
  const q = document.getElementById("searchAccounts").value.toLowerCase();
  document.querySelectorAll("#accountsBody tr").forEach((row) => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

function displaySuperAssets() {
  const body = document.getElementById("superAssetsBody");
  if (!body) return;
  body.innerHTML = "";

  if (!assets.length) {
    body.innerHTML =
      '<tr><td colspan="8" style="text-align:center;color:var(--fg-muted);">No assets found</td></tr>';
    return;
  }

  assets.forEach((asset) => {
    const row = document.createElement("tr");
    const txFormatted = formatDate(resolveTransactionDate(asset));
    const holder = asset.holder || "";

    row.innerHTML = `
      <td>${esc(asset.id)}</td>
      <td contenteditable="true" data-field="name">${esc(asset.name)}</td>
      <td contenteditable="true" data-field="category">${esc(asset.category || "")}</td>
      <td>
        <select data-field="status">
          <option value="Available" ${asset.status === "Available" ? "selected" : ""}>Available</option>
          <option value="Borrowed" ${asset.status === "Borrowed" ? "selected" : ""}>Borrowed</option>
        </select>
      </td>
      <td data-field="holder">${esc(holder)}</td>
      <td><span style="font-size:12px;color:#cbd5e1">${txFormatted}</span></td>
      <td>${asset.qr
        ? `<img src="${esc(asset.qr)}" width="40" style="cursor:pointer"
                onclick="downloadQR('${esc(asset.id)}','${esc(asset.qr)}')">`
        : "—"
      }</td>
      <td>
        <button onclick="saveSuperAssetChanges('${esc(asset.id)}', this)">💾</button>
        <button onclick="markSuperAssetAvailable('${esc(asset.id)}', this)">♻️</button>
        <button onclick="deleteSuperAsset('${esc(asset.id)}')">🗑️</button>
      </td>`;
    body.appendChild(row);
  });
}

async function saveSuperAssetChanges(assetId, btn) {
  const row = btn.closest("tr");
  if (!row) return;

  const name = row.querySelector('[data-field="name"]').textContent.trim();
  const category = row.querySelector('[data-field="category"]').textContent.trim();
  const status = row.querySelector('select[data-field="status"]').value;

  if (!name || !category) {
    showErrorPopup("Error", "Asset name and category are required.");
    return;
  }

  const current = assets.find((a) => String(a.id) === String(assetId)) || {};
  const holder = status === "Available" ? "" : (current.holder || "");

  setLoading(true);
  try {
    const result = await apiGet(getAssetsApiUrl(), {
      action: "editAssetSuper",
      assetID: assetId,
      name,
      category,
      status,
      holder,
    });

    if (result.success) {
      await loadAssetsForSuperAdmin();
      showSuccessPopup("Success", "Asset updated successfully.");
    } else {
      showErrorPopup("Error", result.error || "Failed to update asset.");
    }
  } catch (err) {
    console.error("Error updating asset:", err);
    showErrorPopup("Error", "Failed to update asset: " + err.message);
  } finally {
    setLoading(false);
  }
}

function markSuperAssetAvailable(assetId, btn) {
  const row = btn.closest("tr");
  if (!row) return;
  const statusSelect = row.querySelector('select[data-field="status"]');
  if (statusSelect) statusSelect.value = "Available";
  saveSuperAssetChanges(assetId, btn);
}

async function deleteSuperAsset(assetId) {
  if (!confirm("Delete asset " + assetId + "?")) return;

  setLoading(true);
  try {
    const result = await apiGet(getAssetsApiUrl(), {
      action: "deleteAssetSuper",
      assetID: assetId,
    });

    if (result.success) {
      await loadAssetsForSuperAdmin();
      showSuccessPopup("Success", "Asset deleted successfully.");
    } else {
      showErrorPopup("Error", result.error || "Failed to delete asset.");
    }
  } catch (err) {
    console.error("Error deleting asset:", err);
    showErrorPopup("Error", "Failed to delete asset: " + err.message);
  } finally {
    setLoading(false);
  }
}

function resolveTransactionDate(asset) {
  return (
    asset.transactionDateTime ||
    asset.transactionAt ||
    asset.lastTransactionAt ||
    asset.lastUpdated ||
    asset.updatedAt ||
    asset.borrowedAt ||
    asset.returnedAt ||
    ""
  );
}

function downloadQR(id, url) {
  const img = new Image();
  img.crossOrigin = "anonymous";

  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || 200;
      canvas.height = img.naturalHeight || 200;
      canvas.getContext("2d").drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) {
          window.open(url, "_blank");
          return;
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `${id}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(a.href);
      }, "image/png");
    } catch {
      window.open(url, "_blank");
    }
  };

  img.onerror = () => window.open(url, "_blank");
  img.src = url;
}

async function addSuperAsset() {
  const nameInput = document.getElementById("superAssetName");
  const categoryInput = document.getElementById("superAssetCategory");
  const name = nameInput.value.trim();
  const category = categoryInput.value.trim();

  if (!name || !category) {
    showErrorPopup("Error", "Asset name and category are required.");
    return;
  }

  const assetID = generateSuperAssetId();

  setLoading(true);
  try {
    const result = await apiGet(getAssetsApiUrl(), {
      action: "addAsset",
      assetID,
      name,
      category,
      location: "",
    });

    if (result.success || (result.message || "").toLowerCase().includes("success")) {
      document.getElementById("addSuperAssetForm").reset();
      await loadAssetsForSuperAdmin();
      showSuccessPopup("Success", "Asset added successfully.");
    } else {
      showErrorPopup("Error", result.error || "Failed to add asset.");
    }
  } catch (err) {
    console.error("Error adding asset:", err);
    showErrorPopup("Error", "Failed to add asset: " + err.message);
  } finally {
    setLoading(false);
  }
}

function generateSuperAssetId() {
  const max = Math.max(
    0,
    ...assets.map((a) => {
      const match = String(a.id || "").match(/AST-(\d+)/i);
      return match ? parseInt(match[1], 10) : 0;
    })
  );
  return "AST-" + String(max + 1).padStart(3, "0");
}

function searchAssetsSuper() {
  const q = document.getElementById("searchAssetsSuper").value.toLowerCase();
  document.querySelectorAll("#superAssetsBody tr").forEach((row) => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleString();
}

function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Popups ────────────────────────────────────────────────────

function showSuccessPopup(title, message) {
  document.getElementById("successTitle").textContent   = title;
  document.getElementById("successMessage").textContent = message;
  document.getElementById("successPopup").classList.add("active");
}
function closeSuccessPopup() {
  document.getElementById("successPopup").classList.remove("active");
}

function showErrorPopup(title, message) {
  document.getElementById("errorTitle").textContent   = title;
  document.getElementById("errorMessage").textContent = message;
  document.getElementById("errorPopup").classList.add("active");
}
function closeErrorPopup() {
  document.getElementById("errorPopup").classList.remove("active");
}

function showWarningPopup(title, message) {
  document.getElementById("warningTitle").textContent   = title;
  document.getElementById("warningMessage").textContent = message;
  document.getElementById("warningPopup").classList.add("active");
}
function closeWarningPopup() {
  document.getElementById("warningPopup").classList.remove("active");
}
