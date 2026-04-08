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

// ============= AUTO LOGOUT ON PAGE CLOSE =============
window.addEventListener("beforeunload", function() {
  localStorage.removeItem("adminLoggedIn");
  localStorage.removeItem("currentAdmin");
});

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
  setShopifyLoading(true);
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

      const txValue = resolveTransactionDateTime(asset);
      const formattedTx = formatTransactionDateTime(txValue);
      const transactionDetails = `<span style='font-size:12px;color:#cbd5e1;'>${formattedTx}</span>`;

      html += `
        <tr>
          <td>${asset.id}</td>
          <td contenteditable="true">${asset.name}</td>
          <td contenteditable="true">${asset.category || ""}</td>
          <td><span class="${statusClass}">${asset.status}</span></td>
          <td>${asset.holder || ""}</td>
          <td>${transactionDetails}</td>
          <td>${asset.qr ? `<img src="${asset.qr}" width="40" style="cursor:pointer" onclick="downloadQR('${asset.id}','${asset.qr}')">` : "—"}</td>
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
  } finally {
    setShopifyLoading(false);
  }
}

// ================= OTHER FUNCTIONS (TRANSACTION, CSV, SEARCH, QR) =================
function resolveTransactionDateTime(asset) {
  const transactionLog = JSON.parse(localStorage.getItem("assetTransactions") || "{}");
  const localEntry = transactionLog[asset.id];
  return asset.transactionDateTime || asset.transactionAt || asset.lastTransactionAt || asset.lastUpdated || asset.updatedAt || asset.borrowedAt || asset.returnedAt || localEntry?.dateTime || "";
}

function formatTransactionDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

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

function saveEdit(btn, id) {
  const row = btn.closest("tr");
  setShopifyLoading(true);
  jsonpRequest(CONFIG.API_URL, {
    action: "editAsset",
    assetID: id,
    name: row.cells[1].innerText,
    category: row.cells[2].innerText,
    location: ""
  })
  .then(() => loadAssets())
  .catch(() => alert("Edit failed"))
  .finally(() => setShopifyLoading(false));
}

function deleteAsset(id) {
  if (!confirm("Delete this asset?")) return;
  setShopifyLoading(true);
  jsonpRequest(CONFIG.API_URL, { action: "deleteAsset", assetID: id })
    .then(() => loadAssets())
    .catch(() => alert("Delete failed"))
    .finally(() => setShopifyLoading(false));
}

// ================= ADD ASSET =================
async function addAsset() {
  let name = document.getElementById("assetName").value.trim();
  let category = document.getElementById("category").value.trim();
  if (!name) { alert("Name required"); return; }

  setShopifyLoading(true);
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
  } finally {
    setShopifyLoading(false);
  }
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", function () {
  updateUI();
  initSecretKey();

  // MOBILE MENU
  const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
  const mobileNav = document.querySelector('.mobile-nav');
  if (mobileMenuBtn && mobileNav) {
    mobileMenuBtn.addEventListener('click', e => {
      e.stopPropagation();
      mobileNav.classList.toggle('active');
      document.body.style.overflow = mobileNav.classList.contains('active') ? 'hidden' : '';
    });
    document.addEventListener('click', e => {
      if (!mobileNav.contains(e.target) && !mobileMenuBtn.contains(e.target)) {
        mobileNav.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
    mobileNav.addEventListener('click', e => {
      if (e.target.tagName === 'A') {
        mobileNav.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
  }
});
