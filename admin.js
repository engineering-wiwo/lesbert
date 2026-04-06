// ================= JSONP HELPER FUNCTION =================
function jsonpRequest(url, params) {
  return new Promise((resolve, reject) => {
    const callbackName = 'jsonp_callback_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    const jsonpUrl = url + (url.includes('?') ? '&' : '?') + 'callback=' + callbackName;
    const paramString = new URLSearchParams(params).toString();
    const fullUrl = jsonpUrl + (paramString ? '&' + paramString : '');
    const script = document.createElement('script');
    script.src = fullUrl;
    window[callbackName] = function (data) {
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
      resolve(data);
    };
    script.onerror = function () {
      delete window[callbackName];
      if (script.parentNode) script.parentNode.removeChild(script);
      reject(new Error('JSONP request failed'));
    };
    document.body.appendChild(script);
  });
}

// ================= LOGIN & AUTH =================
function updateUI() {
  const isLoggedIn = localStorage.getItem("adminLoggedIn") === "true";
  const currentAdmin = JSON.parse(localStorage.getItem("currentAdmin") || "{}");

  const nav = document.getElementById("mainNav");
  const mobileNav = document.getElementById("mobileNav");
  const loginSection = document.getElementById("loginSection");
  const dashboardSection = document.getElementById("dashboardSection");

  if (!nav || !mobileNav || !loginSection || !dashboardSection) return;

  if (isLoggedIn) {
    loginSection.style.display = "none";
    dashboardSection.style.display = "block";

    const formattedUsername = currentAdmin.username
      ? currentAdmin.username.charAt(0).toUpperCase() + currentAdmin.username.slice(1)
      : 'Admin';

    nav.innerHTML = `
      <a href="index.html">User Page</a>
      <a href="#" class="nav-admin">${formattedUsername}</a>
      <a href="about.html">About</a>
      <a href="#" onclick="logout()">Logout</a>
    `;
    mobileNav.innerHTML = nav.innerHTML;
    loadAssets();
  } else {
    loginSection.style.display = "block";
    dashboardSection.style.display = "none";
    nav.innerHTML = `
      <a href="index.html">User Page</a>
      <a href="about.html">About</a>
      <a href="#">Admin</a>
    `;
    mobileNav.innerHTML = nav.innerHTML;
  }
}

// ================= LOGIN =================
async function handleLogin(e) {
  e.preventDefault();

  const user = document.getElementById("username").value.trim();
  const pass = document.getElementById("password").value.trim();
  const errorDiv = document.getElementById("loginError");

  if (!user || !pass) {
    errorDiv.textContent = "Username and password are required";
    errorDiv.style.display = "block";
    return;
  }

  try {
    errorDiv.textContent = "Authentication...";
    errorDiv.style.display = "block";

    const result = await jsonpRequest(CONFIG.ADMIN_API_URL, {
      action: "authenticate",
      username: user,
      password: pass
    });

    if (result.success) {
      localStorage.setItem("adminLoggedIn", "true");
      localStorage.setItem("currentAdmin", JSON.stringify(result.account));
      errorDiv.style.display = "none";

      // FEATURE 1: Notify admin that admin page was accessed
      notifyAdminAccess(user, result.account?.email || "");

      updateUI();
    } else {
      errorDiv.textContent = result.error || "Invalid credentials";
      errorDiv.style.display = "block";
    }
  } catch (error) {
    console.error(error);
    errorDiv.textContent = "Authentication failed.";
    errorDiv.style.display = "block";
  }
}

// FEATURE 1: Send email when admin page is accessed
function notifyAdminAccess(username, adminEmail) {
  try {
    const notifyEmail = localStorage.getItem("bs_notify_email") || "";
    if (!notifyEmail) return;
    const subject = `[BorrowSmart] Admin Login: ${username}`;
    const body = `Admin account "${username}" logged into the admin dashboard at ${new Date().toLocaleString()}.`;
    const params = new URLSearchParams({ action: "sendNotificationEmail", to: notifyEmail, subject, body });
    fetch(CONFIG.ADMIN_API_URL + "?" + params.toString(), { mode: "no-cors" }).catch(() => {});
  } catch (e) { console.warn("Notify failed:", e); }
}

function logout() {
  localStorage.removeItem("adminLoggedIn");
  localStorage.removeItem("currentAdmin");
  updateUI();
}

// ================= SECRET KEY =================
let keySequence = [];
const secretKey = '@';

function initSecretKey() {
  document.addEventListener('keydown', function (event) {
    const dash = document.getElementById('dashboardSection');
    if (dash && dash.style.display !== 'none') {
      keySequence.push(event.key);
      if (keySequence.length > secretKey.length) keySequence.shift();
      if (keySequence.join('') === secretKey) {
        window.location.href = 'super_admin.html';
        keySequence = [];
      }
    }
  });
}

// ================= LOAD ASSETS =================
async function loadAssets() {
  try {
    const data = await jsonpRequest(CONFIG.API_URL, { action: "getAssets" });
    const body = document.getElementById("assetBody");
    if (!body) return;

    let html = "";
    let borrowed = 0;
    let available = 0;

    data.forEach(asset => {
      if (asset.status === "Borrowed") borrowed++;
      if (asset.status === "Available") available++;

      let statusClass = "badge";
      if (asset.status === "Available") statusClass += " badge-green";
      else if (asset.status === "Borrowed") statusClass += " badge-red";

      let lockEdit = asset.status === "Borrowed"
        ? "disabled style='opacity:0.4;pointer-events:none;'" : "";

      // FEATURE 3: show timestamps in admin table
      const borrowedAt = asset.borrowedAt
        ? `<span style="font-size:11px;opacity:0.7;">📤 ${formatTS(asset.borrowedAt)}</span>` : "—";
      const returnedAt = asset.returnedAt
        ? `<span style="font-size:11px;opacity:0.7;">📥 ${formatTS(asset.returnedAt)}</span>` : "—";

      html += `
        <tr>
          <td>${asset.id}</td>
          <td contenteditable="true">${asset.name}</td>
          <td contenteditable="true">${asset.category || ""}</td>
          <td><span class="${statusClass}">${asset.status}</span></td>
          <td>${asset.holder || ""}</td>
          <td>${borrowedAt}</td>
          <td>${returnedAt}</td>
          <td>
            ${asset.qr ? `<img src="${asset.qr}" width="40" style="cursor:pointer" onclick="downloadQR('${asset.id}','${asset.qr}')">` : "—"}
          </td>
          <td>
            <button onclick="saveEdit(this,'${asset.id}')" ${lockEdit}>💾</button>
            <button onclick="deleteAsset('${asset.id}')">🗑️</button>
          </td>
        </tr>
      `;
    });

    body.innerHTML = html;
    document.getElementById("borrowedAssets").innerText = borrowed;
    document.getElementById("availableAssets").innerText = available;
  } catch (error) {
    console.error(error);
  }
}

function formatTS(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

// ================= DOWNLOAD QR =================
function downloadQR(id, url) {
  fetch(url)
    .then(res => res.blob())
    .then(blob => {
      const link = document.createElement("a");
      const objectURL = URL.createObjectURL(blob);
      link.href = objectURL;
      link.download = id + ".png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectURL);
    })
    .catch(() => alert("Failed to download QR"));
}

// ================= EDIT =================
function saveEdit(btn, id) {
  const row = btn.closest("tr");
  jsonpRequest(CONFIG.API_URL, {
    action: "editAsset",
    assetID: id,
    name: row.cells[1].innerText,
    category: row.cells[2].innerText,
    location: ""
  })
    .then(() => loadAssets())
    .catch(() => alert("Edit failed"));
}

// ================= DELETE =================
function deleteAsset(id) {
  if (!confirm("Delete this asset?")) return;
  jsonpRequest(CONFIG.API_URL, { action: "deleteAsset", assetID: id })
    .then(() => loadAssets())
    .catch(() => alert("Delete failed"));
}

// ================= ADD ASSET =================
async function addAsset() {
  let name = document.getElementById("assetName").value.trim();
  let category = document.getElementById("category").value.trim();
  if (!name) { alert("Name required"); return; }

  try {
    const assetID = await generateNextAssetID();
    const res = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "addAsset", assetID, name, category, location: "" })
    });
    const result = await res.json();
    if (result.message === "Asset added successfully") {
      generateQR(assetID);
      alert("Asset added successfully: " + assetID);
      loadAssets();
      document.getElementById("addAssetForm").reset();
    } else {
      alert(result.message || "Failed to add asset");
    }
  } catch (error) {
    console.error("Error adding asset:", error);
    alert("Failed to add asset");
  }
}

async function generateNextAssetID() {
  try {
    const data = await jsonpRequest(CONFIG.API_URL, { action: "getAssets" });
    if (!data || data.length === 0) return "AST-001";
    const numbers = data.map(asset => {
      const match = asset.id.match(/AST-(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    });
    return "AST-" + String(Math.max(...numbers) + 1).padStart(3, "0");
  } catch { return "AST-" + Date.now(); }
}

// ================= QR =================
function generateQR(id) {
  const container = document.getElementById("qrPreviewContainer");
  const img = document.getElementById("qrPreview");
  if (!container || !img) return;
  container.style.display = "block";
  img.src = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" + id;
}

// ================= SEARCH =================
function searchInventory() {
  let input = document.getElementById("search").value.toLowerCase();
  document.querySelectorAll("#assetBody tr").forEach(row => {
    row.style.display = row.innerText.toLowerCase().includes(input) ? "" : "none";
  });
}

// ================= CSV =================
function downloadCSV() {
  let table = document.querySelector("table");
  if (!table) return;
  let csv = [];
  table.querySelectorAll("tr").forEach(row => {
    let rowData = [];
    row.querySelectorAll("td,th").forEach(col => rowData.push('"' + col.innerText.replace(/"/g, '""') + '"'));
    csv.push(rowData.join(","));
  });
  let link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv.join("\n")], { type: "text/csv" }));
  link.download = "BorrowSmart_Inventory_Report.csv";
  link.click();
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", function () {
  updateUI();
  initSecretKey();

  const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
  const mobileNav = document.querySelector('.mobile-nav');
  if (mobileMenuBtn && mobileNav) {
    mobileMenuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      mobileNav.classList.toggle('active');
      document.body.style.overflow = mobileNav.classList.contains('active') ? 'hidden' : '';
    });
    document.addEventListener('click', function (e) {
      if (!mobileNav.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
        mobileNav.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
    mobileNav.addEventListener('click', function (e) {
      if (e.target.tagName === 'A') {
        mobileNav.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('animate-in'); });
  });
  const isMobile = window.innerWidth < 768;
  document.querySelectorAll('.card, .stat-card, .team-card').forEach(el => {
    if (!isMobile) observer.observe(el);
    else el.classList.add('animate-in');
  });
});
