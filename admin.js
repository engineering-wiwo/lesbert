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
      script.remove();
      resolve(data);
    };

    script.onerror = function () {
      delete window[callbackName];
      script.remove();
      reject(new Error('JSONP request failed'));
    };

    document.body.appendChild(script);
  });
}

// ================= LOADING OVERLAY =================
function ensureLoadingOverlay() {
  let overlay = document.getElementById("loadingOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "loadingOverlay";

  overlay.innerHTML = `
    <div class="loading-card">
      <img src="https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExOXRib21kZDh6NThmcTd2NXZnZGE0MmhzdWx1Z2JhcmdiOHphc2w1OSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/hL9q5k9dk9l0wGd4e0/giphy.gif" 
           style="width:120px; border-radius:12px;" />
      <p>Loading...</p>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    #loadingOverlay {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(10,15,25,0.75);
      backdrop-filter: blur(4px);
      z-index: 99999;
    }

    #loadingOverlay.active {
      display: flex;
    }

    .loading-card {
      background: rgba(15,23,42,0.95);
      padding: 20px;
      border-radius: 16px;
      text-align: center;
      color: white;
      font-weight: 600;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(overlay);
  return overlay;
}

function setLoading(show) {
  const overlay = ensureLoadingOverlay();
  overlay.classList.toggle("active", show);
}

// ================= LOGIN SYSTEM =================
function updateUI() {
  const isLoggedIn = sessionStorage.getItem("adminLoggedIn") === "true";
  const currentAdmin = JSON.parse(sessionStorage.getItem("currentAdmin") || "{}");

  const loginSection = document.getElementById("loginSection");
  const dashboardSection = document.getElementById("dashboardSection");

  if (isLoggedIn) {
    loginSection.style.display = "none";
    dashboardSection.style.display = "block";
    loadAssets();
  } else {
    loginSection.style.display = "block";
    dashboardSection.style.display = "none";
  }
}

async function handleLogin(e) {
  e.preventDefault();

  const user = document.getElementById("username").value.trim();
  const pass = document.getElementById("password").value.trim();
  const errorDiv = document.getElementById("loginError");

  if (!user || !pass) {
    errorDiv.textContent = "Required fields";
    errorDiv.style.display = "block";
    return;
  }

  try {
    errorDiv.textContent = "Authenticating...";
    errorDiv.style.display = "block";

    const result = await jsonpRequest(CONFIG.ADMIN_API_URL, {
      action: "authenticate",
      username: user,
      password: pass
    });

    if (result.success) {
      sessionStorage.setItem("adminLoggedIn", "true");
      sessionStorage.setItem("currentAdmin", JSON.stringify(result.account));
      updateUI();
    } else {
      errorDiv.textContent = "Invalid credentials";
    }
  } catch {
    errorDiv.textContent = "Login failed";
  }
}

function logout() {
  sessionStorage.clear();
  updateUI();
}

// ================= LOAD ASSETS =================
async function loadAssets() {
  setLoading(true);

  try {
    const data = await jsonpRequest(CONFIG.API_URL, { action: "getAssets" });
    const body = document.getElementById("assetBody");

    let html = "";
    data.forEach(asset => {
      html += `
        <tr>
          <td>${asset.id}</td>
          <td contenteditable="true">${asset.name}</td>
          <td contenteditable="true">${asset.category || ""}</td>
          <td>${asset.status}</td>
          <td>${asset.holder || ""}</td>
          <td>${asset.transactionDateTime || "-"}</td>
          <td>
            ${asset.qr ? `<img src="${asset.qr}" width="40">` : "-"}
          </td>
          <td>
            <button onclick="saveEdit(this,'${asset.id}')">💾</button>
            <button onclick="deleteAsset('${asset.id}')">🗑️</button>
          </td>
        </tr>
      `;
    });

    body.innerHTML = html;

  } catch (err) {
    console.error(err);
  } finally {
    setLoading(false);
  }
}

// ================= ADD ASSET =================
async function addAsset() {
  const btn = document.querySelector("#addAssetForm button");
  let name = document.getElementById("assetName").value.trim();
  let category = document.getElementById("category").value;

  if (!name) return alert("Name required");

  btn.disabled = true;
  btn.innerText = "Adding...";
  setLoading(true);

  try {
    const res = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ action:"addAsset", name, category })
    });

    const result = await res.json();

    if (result.message) {
      alert("Added!");
      loadAssets();
      document.getElementById("addAssetForm").reset();
    }

  } catch {
    alert("Error");
  } finally {
    btn.disabled = false;
    btn.innerText = "Add Asset";
    setLoading(false);
  }
}

// ================= EDIT =================
function saveEdit(btn, id) {
  const row = btn.closest("tr");

  setLoading(true);

  jsonpRequest(CONFIG.API_URL, {
    action: "editAsset",
    assetID: id,
    name: row.cells[1].innerText,
    category: row.cells[2].innerText
  })
  .then(loadAssets)
  .finally(() => setLoading(false));
}

// ================= DELETE =================
function deleteAsset(id) {
  if (!confirm("Delete?")) return;

  setLoading(true);

  jsonpRequest(CONFIG.API_URL, {
    action: "deleteAsset",
    assetID: id
  })
  .then(loadAssets)
  .finally(() => setLoading(false));
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", function () {

  // FORCE LOGIN EVERY TIME PAGE LOADS
  sessionStorage.clear();

  updateUI();
});
