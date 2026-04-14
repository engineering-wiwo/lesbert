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
let savingRows = new Set(); // track rows currently being saved (prevents double-clicks)

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
//
// FIX: Increased timeout to 20s, added URL guard, never drops
// empty strings (holder:"" must reach GAS to clear the field).

async function apiGet(baseUrl, params = {}, timeoutMs = 20000) {
  if (!baseUrl) throw new Error("API URL is not configured. Check config.js.");

  const url = new URL(baseUrl);
  // Explicitly set every param — never skip empty strings.
  // An empty "holder" param intentionally clears the field in GAS.
  Object.entries(params).forEach(([k, v]) => {
    url.searchParams.set(k, (v === null || v === undefined) ? "" : String(v));
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error("HTTP " + res.status + " — check GAS deployment.");
    const text = await res.text();
    return safeParseJson(text);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError")
      throw new Error("Request timed out after " + (timeoutMs / 1000) + "s. Verify your GAS /exec URL.");
    // Network/CORS errors land here — usually wrong URL or GAS not deployed as Anyone
    throw new Error(err.message || "Network error. Check GAS deployment URL and access permissions.");
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

// FIX: Always prefer ADMIN_API_URL — it's the confirmed working /exec URL.
// CONFIG.API_URL may point to a different or broken deployment.
function getAssetsApiUrl() {
  return CONFIG.ADMIN_API_URL || CONFIG.API_URL;
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

// ── Load assets for super admin ───────────────────────────────
// FIX: checks both table body and card container, handles GAS
// returning a plain array (not {success, assets}), shows specific
// errors for config problems vs backend errors vs network errors.

async function loadAssetsForSuperAdmin() {
  const body          = document.getElementById("superAssetsBody");
  const cardContainer = document.getElementById("superAssetsCards");
  if (!body && !cardContainer) return;

  setLoading(true);
  try {
    const apiUrl = getAssetsApiUrl();
    if (!apiUrl) {
      showErrorPopup("Config Error", "No API URL found in config.js. Set CONFIG.ADMIN_API_URL to your GAS /exec URL.");
      return;
    }

    const result = await apiGet(apiUrl, {
      action: "getAssets",
      t: Date.now(),
    });

    // GAS getAssets() returns a plain array, not { success, assets }
    if (Array.isArray(result)) {
      assets = result;
    } else if (result && result.success === false) {
      showErrorPopup("Backend Error", result.error || "GAS returned an error for getAssets.");
      assets = [];
    } else {
      assets = [];
    }

    displaySuperAssets();
    renderAssetCards();
  } catch (err) {
    console.error("Error loading assets:", err);
    showErrorPopup("Connection Error", "Could not load assets: " + err.message);
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

// ── Display accounts ──────────────────────────────────────────

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

// ── Display assets — desktop table ────────────────────────────

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
    row.setAttribute("data-id", asset.id);
    const txFormatted = formatDate(resolveTransactionDate(asset));
    const statusClass = asset.status === "Available" ? "status-available" : "status-borrowed";

    row.innerHTML = `
      <td>${esc(asset.id)}</td>
      <td contenteditable="true" data-field="name">${esc(asset.name)}</td>
      <td contenteditable="true" data-field="category">${esc(asset.category || "")}</td>
      <td>
        <select class="sa-status-select ${statusClass}" data-field="status">
          <option value="Available" ${asset.status === "Available" ? "selected" : ""}>✅ Available</option>
          <option value="Borrowed"  ${asset.status === "Borrowed"  ? "selected" : ""}>🔴 Borrowed</option>
        </select>
      </td>
      <td contenteditable="true" data-field="holder">${esc(asset.holder || "")}</td>
      <td><span style="font-size:12px;color:#cbd5e1">${txFormatted}</span></td>
      <td>${asset.qr
        ? `<img src="${esc(asset.qr)}" width="40" style="cursor:pointer"
                onclick="downloadQR('${esc(asset.id)}','${esc(asset.qr)}')">`
        : "—"
      }</td>
      <td>
        <button onclick="saveSuperAssetChanges('${esc(asset.id)}', this)" title="Save changes">💾</button>
        <button onclick="markSuperAssetAvailable('${esc(asset.id)}', this)" title="Mark Available"
          ${asset.status === "Available" ? "disabled style='opacity:.4;cursor:not-allowed;'" : ""}>♻️</button>
        <button onclick="deleteSuperAsset('${esc(asset.id)}')">🗑️</button>
      </td>`;

    // Live status colour update on select change
    row.querySelector('.sa-status-select').addEventListener("change", function () {
      this.className = "sa-status-select " + (this.value === "Available" ? "status-available" : "status-borrowed");
      const returnBtn = row.querySelectorAll("td:last-child button")[1];
      if (returnBtn) returnBtn.disabled = this.value === "Available";
    });

    body.appendChild(row);
  });
}

// ── Display assets — mobile cards ─────────────────────────────
// NEW: renders a card-per-asset for screens ≤ 768px.
// The HTML must include <div id="superAssetsCards"></div> below
// the desktop table wrapper.

function renderAssetCards() {
  const container = document.getElementById("superAssetsCards");
  if (!container) return;
  container.innerHTML = "";

  if (!assets.length) {
    container.innerHTML = '<div class="sa-empty-card">No assets found</div>';
    return;
  }

  assets.forEach((asset) => {
    const card = document.createElement("div");
    card.className = "sa-asset-card";
    card.setAttribute("data-id", asset.id);
    const statusClass = asset.status === "Available" ? "status-available" : "status-borrowed";
    const statusLabel = asset.status === "Available" ? "✅ Available" : "🔴 Borrowed";

    card.innerHTML = `
      <div class="sa-card-header">
        <span class="sa-card-id">${esc(asset.id)}</span>
        <span class="sa-card-badge ${statusClass}">${statusLabel}</span>
      </div>
      <div class="sa-card-field">
        <label>Asset Name</label>
        <input class="sa-card-input" type="text" value="${esc(asset.name)}"
          data-field="name" placeholder="Asset name" />
      </div>
      <div class="sa-card-field">
        <label>Category</label>
        <input class="sa-card-input" type="text" value="${esc(asset.category || "")}"
          data-field="category" placeholder="Category" />
      </div>
      <div class="sa-card-field">
        <label>Status</label>
        <select class="sa-card-select ${statusClass}" data-field="status">
          <option value="Available" ${asset.status === "Available" ? "selected" : ""}>✅ Available</option>
          <option value="Borrowed"  ${asset.status === "Borrowed"  ? "selected" : ""}>🔴 Borrowed</option>
        </select>
      </div>
      <div class="sa-card-field">
        <label>Current Holder</label>
        <input class="sa-card-input" type="text" value="${esc(asset.holder || "")}"
          data-field="holder" placeholder="None" />
      </div>
      <div class="sa-card-actions">
        <button class="sa-btn-save"   onclick="saveSuperAssetCard('${esc(asset.id)}', this)">💾 Save</button>
        <button class="sa-btn-return" onclick="returnSuperAssetCard('${esc(asset.id)}', this)"
          ${asset.status === "Available" ? "disabled" : ""}>♻️ Return</button>
        <button class="sa-btn-delete" onclick="deleteSuperAsset('${esc(asset.id)}')">🗑️ Delete</button>
      </div>`;

    // Live badge + select colour update
    card.querySelector('select[data-field="status"]').addEventListener("change", function () {
      const isAvail = this.value === "Available";
      this.className = "sa-card-select " + (isAvail ? "status-available" : "status-borrowed");
      const badge = card.querySelector(".sa-card-badge");
      if (badge) {
        badge.className = "sa-card-badge " + (isAvail ? "status-available" : "status-borrowed");
        badge.textContent = isAvail ? "✅ Available" : "🔴 Borrowed";
      }
      const returnBtn = card.querySelector(".sa-btn-return");
      if (returnBtn) returnBtn.disabled = isAvail;
    });

    container.appendChild(card);
  });
}

// ── Search (filters both table rows and mobile cards) ─────────

function searchAssetsSuper() {
  const q = document.getElementById("searchAssetsSuper").value.toLowerCase();
  document.querySelectorAll("#superAssetsBody tr").forEach((row) => {
    row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
  });
  document.querySelectorAll("#superAssetsCards .sa-asset-card").forEach((card) => {
    card.style.display = card.textContent.toLowerCase().includes(q) ? "" : "none";
  });
}

// ── Helpers: read data from desktop row / mobile card ─────────

function getRowData(row) {
  return {
    name:     (row.querySelector('[data-field="name"]')?.textContent     || "").trim(),
    category: (row.querySelector('[data-field="category"]')?.textContent || "").trim(),
    status:   (row.querySelector('[data-field="status"]')?.value         || "Available"),
    holder:   (row.querySelector('[data-field="holder"]')?.textContent   || "").trim(),
  };
}

function getCardData(card) {
  return {
    name:     (card.querySelector('[data-field="name"]')?.value     || "").trim(),
    category: (card.querySelector('[data-field="category"]')?.value || "").trim(),
    status:   (card.querySelector('[data-field="status"]')?.value   || "Available"),
    holder:   (card.querySelector('[data-field="holder"]')?.value   || "").trim(),
  };
}

function validateAssetData(data) {
  if (!data.name)     return "Asset name cannot be empty.";
  if (!data.category) return "Category cannot be empty.";
  const valid = ["Available", "Borrowed"];
  if (!valid.includes(data.status)) return "Invalid status value.";
  return null;
}

// ── Loading state for individual buttons ──────────────────────

function setBtnLoading(btn, loading, originalText) {
  if (!btn) return;
  btn.disabled    = loading;
  btn.textContent = loading ? "⏳ Saving…" : originalText;
}

// ── Save asset — desktop row ──────────────────────────────────
// FIX: was saveSuperAssetChanges; now also validates, uses
// savingRows guard, and preserves original button text.

async function saveSuperAssetChanges(assetId, btn) {
  if (savingRows.has(assetId)) return;

  const row = document.querySelector(`#superAssetsBody tr[data-id="${assetId}"]`);
  if (!row) return;

  const data = getRowData(row);
  const err  = validateAssetData(data);
  if (err) { showErrorPopup("Validation Error", err); return; }

  if (!confirm(`Save changes to asset ${assetId}?`)) return;

  savingRows.add(assetId);
  setBtnLoading(btn, true, "💾");
  setLoading(true);
  try {
    const result = await apiGet(getAssetsApiUrl(), {
      action:   "editAssetSuper",
      assetID:  String(assetId),
      ...data,
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
    savingRows.delete(assetId);
    setBtnLoading(btn, false, "💾");
    setLoading(false);
  }
}

// ── Save asset — mobile card ──────────────────────────────────

async function saveSuperAssetCard(assetId, btn) {
  if (savingRows.has(assetId)) return;

  const card = document.querySelector(`#superAssetsCards .sa-asset-card[data-id="${assetId}"]`);
  if (!card) return;

  const data = getCardData(card);
  const err  = validateAssetData(data);
  if (err) { showErrorPopup("Validation Error", err); return; }

  if (!confirm(`Save changes to asset ${assetId}?`)) return;

  savingRows.add(assetId);
  setBtnLoading(btn, true, "💾 Save");
  setLoading(true);
  try {
    const result = await apiGet(getAssetsApiUrl(), {
      action:  "editAssetSuper",
      assetID: String(assetId),
      ...data,
    });

    if (result.success) {
      await loadAssetsForSuperAdmin();
      showSuccessPopup("Success", "Asset updated successfully.");
    } else {
      showErrorPopup("Error", result.error || "Failed to update asset.");
    }
  } catch (err) {
    showErrorPopup("Error", "Failed to update asset: " + err.message);
  } finally {
    savingRows.delete(assetId);
    setBtnLoading(btn, false, "💾 Save");
    setLoading(false);
  }
}

// ── Mark available — desktop (original helper kept) ──────────
// FIX: now sends full asset data including exact id from local
// array so GAS can always find the row, and explicitly sends
// holder:"" to clear the field.

function markSuperAssetAvailable(assetId, btn) {
  const row = btn.closest("tr");
  if (!row) return;
  const statusSelect = row.querySelector('select[data-field="status"]');
  if (statusSelect) statusSelect.value = "Available";
  // Also clear the holder cell so getRowData picks it up as ""
  const holderCell = row.querySelector('[data-field="holder"]');
  if (holderCell) holderCell.textContent = "";
  saveSuperAssetChanges(assetId, btn);
}

// ── Return asset — desktop ────────────────────────────────────
// FIX: sends full asset data using exact id from local array,
// explicitly sets holder:"" to clear it in GAS.

async function returnSuperAsset(assetId, btn) {
  if (savingRows.has(assetId)) return;

  const asset = assets.find((a) => String(a.id) === String(assetId));
  if (!asset) {
    showErrorPopup("Error", "Asset " + assetId + " not found in local data. Try refreshing.");
    return;
  }

  const holder = asset.holder || "current holder";
  if (!confirm(`Mark asset ${assetId} as Available and clear holder (${holder})?`)) return;

  savingRows.add(assetId);
  setBtnLoading(btn, true, "♻️");
  setLoading(true);
  try {
    const result = await apiGet(getAssetsApiUrl(), {
      action:   "editAssetSuper",
      assetID:  String(asset.id),   // exact ID from fetched data
      name:     asset.name     || "",
      category: asset.category || "",
      status:   "Available",
      holder:   "",                  // explicitly clear holder
    });

    if (result.success) {
      await loadAssetsForSuperAdmin();
      showSuccessPopup("Returned", `Asset ${assetId} is now Available.`);
    } else {
      showErrorPopup("Error", result.error || "Failed to return asset.");
    }
  } catch (e) {
    showErrorPopup("Error", "Return failed: " + e.message);
  } finally {
    savingRows.delete(assetId);
    setBtnLoading(btn, false, "♻️");
    setLoading(false);
  }
}

// ── Return asset — mobile card ────────────────────────────────

async function returnSuperAssetCard(assetId, btn) {
  if (savingRows.has(assetId)) return;

  const asset = assets.find((a) => String(a.id) === String(assetId));
  if (!asset) {
    showErrorPopup("Error", "Asset " + assetId + " not found in local data. Try refreshing.");
    return;
  }

  const holder = asset.holder || "current holder";
  if (!confirm(`Mark asset ${assetId} as Available and clear holder (${holder})?`)) return;

  savingRows.add(assetId);
  setBtnLoading(btn, true, "♻️ Return");
  setLoading(true);
  try {
    const result = await apiGet(getAssetsApiUrl(), {
      action:   "editAssetSuper",
      assetID:  String(asset.id),
      name:     asset.name     || "",
      category: asset.category || "",
      status:   "Available",
      holder:   "",
    });

    if (result.success) {
      await loadAssetsForSuperAdmin();
      showSuccessPopup("Returned", `Asset ${assetId} is now Available.`);
    } else {
      showErrorPopup("Error", result.error || "Failed to return asset.");
    }
  } catch (e) {
    showErrorPopup("Error", "Return failed: " + e.message);
  } finally {
    savingRows.delete(assetId);
    setBtnLoading(btn, false, "♻️ Return");
    setLoading(false);
  }
}

// ── Delete asset ──────────────────────────────────────────────

async function deleteSuperAsset(assetId) {
  if (!confirm("Delete asset " + assetId + "? This cannot be undone.")) return;

  setLoading(true);
  try {
    const result = await apiGet(getAssetsApiUrl(), {
      action:  "deleteAssetSuper",
      assetID: String(assetId),
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

// ── Add asset ─────────────────────────────────────────────────

async function addSuperAsset() {
  const nameInput     = document.getElementById("superAssetName");
  const categoryInput = document.getElementById("superAssetCategory");
  const name          = nameInput.value.trim();
  const category      = categoryInput.value.trim();

  if (!name || !category) {
    showErrorPopup("Error", "Asset name and category are required.");
    return;
  }

  const assetID = generateSuperAssetId();

  setLoading(true);
  try {
    const result = await apiGet(getAssetsApiUrl(), {
      action:   "addAsset",
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

// ── Utilities ─────────────────────────────────────────────────

function resolveTransactionDate(asset) {
  return (
    asset.transactionDateTime ||
    asset.transactionAt       ||
    asset.lastTransactionAt   ||
    asset.lastUpdated         ||
    asset.updatedAt           ||
    asset.borrowedAt          ||
    asset.returnedAt          ||
    ""
  );
}

function downloadQR(id, url) {
  const img = new Image();
  img.crossOrigin = "anonymous";

  img.onload = () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width  = img.naturalWidth  || 200;
      canvas.height = img.naturalHeight || 200;
      canvas.getContext("2d").drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) { window.open(url, "_blank"); return; }
        const a = document.createElement("a");
        a.href     = URL.createObjectURL(blob);
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

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? esc(value) : d.toLocaleString();
}

function esc(str) {
  return String(str == null ? "" : str)
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;")
    .replace(/'/g,  "&#39;");
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

// ── Mobile card styles (injected once at runtime) ─────────────
// Keeps all mobile card CSS self-contained in this JS file so
// you don't have to touch style.css.  The desktop table is hidden
// via .sa-table-wrap at ≤768px; #superAssetsCards is shown instead.

(function injectMobileCardStyles() {
  if (document.getElementById("saCardStyles")) return;
  const style = document.createElement("style");
  style.id = "saCardStyles";
  style.textContent = `
    /* ── Status colours (used by both table select and card badge) ── */
    .status-available {
      background: rgba(16,185,129,0.12);
      border-color: rgba(16,185,129,0.4);
      color: #10b981;
    }
    .status-borrowed {
      background: rgba(239,68,68,0.12);
      border-color: rgba(239,68,68,0.4);
      color: #ef4444;
    }

    /* ── Desktop table status select ── */
    .sa-status-select {
      padding: 5px 8px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      border: 1.5px solid;
      cursor: pointer;
      font-family: inherit;
      transition: background 0.2s, border-color 0.2s;
    }
    .sa-status-select:focus { outline: none; box-shadow: 0 0 0 2px rgba(236,72,153,0.2); }

    /* ── Mobile cards hidden on desktop ── */
    #superAssetsCards { display: none; }

    /* ── Card layout ── */
    .sa-asset-card {
      background: rgba(15,23,42,0.7);
      border: 1px solid rgba(148,163,184,0.14);
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 14px;
      transition: border-color 0.2s;
    }
    .sa-asset-card:hover { border-color: rgba(236,72,153,0.3); }

    .sa-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }
    .sa-card-id {
      font-size: 13px;
      font-weight: 700;
      color: #94a3b8;
      letter-spacing: 0.05em;
    }
    .sa-card-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 20px;
      border: 1px solid;
      letter-spacing: 0.03em;
    }

    .sa-card-field { margin-bottom: 12px; }
    .sa-card-field label {
      display: block;
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      margin-bottom: 5px;
    }
    .sa-card-input {
      width: 100%;
      padding: 10px 12px;
      background: rgba(0,0,0,0.3);
      border: 1px solid rgba(148,163,184,0.18);
      border-radius: 9px;
      color: #f1f5f9;
      font-size: 14px;
      font-family: inherit;
      box-sizing: border-box;
      transition: border-color 0.2s;
    }
    .sa-card-input:focus {
      outline: none;
      border-color: #ec4899;
      box-shadow: 0 0 0 2px rgba(236,72,153,0.18);
    }
    .sa-card-select {
      width: 100%;
      padding: 10px 12px;
      border-radius: 9px;
      font-size: 14px;
      font-family: inherit;
      font-weight: 600;
      border: 1.5px solid;
      cursor: pointer;
      box-sizing: border-box;
      transition: border-color 0.2s;
    }
    .sa-card-select:focus { outline: none; }

    .sa-card-actions {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 4px;
    }
    .sa-card-actions button {
      width: 100%;
      padding: 11px 16px;
      border: none;
      border-radius: 10px;
      font-size: 14px;
      font-family: inherit;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s;
    }
    .sa-card-actions button:disabled { opacity: 0.4; cursor: not-allowed; }

    .sa-btn-save {
      background: linear-gradient(135deg, #6366f1, #818cf8);
      color: white;
      box-shadow: 0 2px 8px rgba(99,102,241,0.3);
    }
    .sa-btn-save:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(99,102,241,0.45); }

    .sa-btn-return {
      background: linear-gradient(135deg, #10b981, #34d399);
      color: white;
      box-shadow: 0 2px 8px rgba(16,185,129,0.3);
    }
    .sa-btn-return:hover:not(:disabled) { transform: translateY(-1px); }

    .sa-btn-delete {
      background: rgba(239,68,68,0.12);
      border: 1px solid rgba(239,68,68,0.3) !important;
      color: #ef4444;
    }
    .sa-btn-delete:hover:not(:disabled) { background: rgba(239,68,68,0.22); }

    .sa-empty-card {
      text-align: center;
      color: #94a3b8;
      padding: 32px;
      font-style: italic;
      background: rgba(15,23,42,0.4);
      border-radius: 14px;
      border: 1px dashed rgba(148,163,184,0.2);
    }

    /* ── Responsive breakpoint ── */
    @media (max-width: 768px) {
      /* Hide desktop table, show cards */
      .sa-table-wrap  { display: none !important; }
      #superAssetsCards { display: block !important; }

      /* Full-width search */
      #searchAssetsSuper { width: 100% !important; box-sizing: border-box; }
    }

    @media (max-width: 480px) {
      .sa-asset-card { padding: 14px; }
      .sa-card-actions { gap: 6px; }
    }
  `;
  document.head.appendChild(style);
})();
