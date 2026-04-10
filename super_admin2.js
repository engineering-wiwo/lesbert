// ================= GLOBAL VARIABLES =================
let accounts = [];
let selectedAccounts = new Set();

// ================= CONFIG LOADER =================
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

// ================= LOADING OVERLAY =================
function ensureFallbackLoadingOverlay() {
  let overlay = document.getElementById("fallbackLoadingOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "fallbackLoadingOverlay";
  overlay.innerHTML = `
    <div class="fallback-loading-card">
      <p>Loading...</p>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    #fallbackLoadingOverlay {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.5);
      z-index: 99999;
    }
    #fallbackLoadingOverlay.is-active {
      display: flex;
    }
  `;

  document.head.appendChild(style);
  document.body.appendChild(overlay);
  return overlay;
}

function setShopifyLoading(isLoading) {
  const overlay = ensureFallbackLoadingOverlay();
  overlay.classList.toggle("is-active", isLoading);
}

// ================= API REQUEST (FIXED) =================
async function apiRequest(params, method = "GET") {
  if (!CONFIG || !CONFIG.ADMIN_API_URL) {
    throw new Error("API URL not configured");
  }

  let url = CONFIG.ADMIN_API_URL;

  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
    },
  };

  if (method === "GET") {
    const query = new URLSearchParams(params).toString();
    url += "?" + query;
  } else {
    options.body = JSON.stringify(params);
  }

  const res = await fetch(url, options);

  if (!res.ok) {
    throw new Error("HTTP " + res.status);
  }

  return await res.json();
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", async () => {
  const config = await waitForConfig();

  if (!config) {
    alert("Missing config");
    return;
  }

  loadAccounts();
});

// ================= LOAD ACCOUNTS =================
async function loadAccounts() {
  setShopifyLoading(true);

  try {
    const result = await apiRequest({
      action: "getAdminAccounts",
    }, "GET");

    if (result.success) {
      accounts = result.accounts || [];
      displayAccounts();
    } else {
      showErrorPopup("Error", result.error || "Failed to load accounts");
    }
  } catch (err) {
    showErrorPopup("Error", err.message);
  } finally {
    setShopifyLoading(false);
  }
}

// ================= ADD ACCOUNT =================
async function addAccount() {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  const email = document.getElementById("email").value.trim();

  if (!username || !password || !email) {
    return showErrorPopup("Error", "All fields required");
  }

  setShopifyLoading(true);

  try {
    const result = await apiRequest(
      {
        action: "addAdminAccount",
        username,
        password,
        email,
        createdDate: new Date().toISOString(),
      },
      "POST"
    );

    if (result.success) {
      await loadAccounts();
      document.getElementById("addAccountForm").reset();
      showSuccessPopup("Success", "Account added");
    } else {
      showErrorPopup("Error", result.error);
    }
  } catch (err) {
    showErrorPopup("Error", err.message);
  } finally {
    setShopifyLoading(false);
  }
}

// ================= UPDATE ACCOUNT =================
async function saveAccountChanges() {
  const id = parseInt(document.getElementById("editAccountId").value);
  const username = document.getElementById("editUsername").value.trim();
  const email = document.getElementById("editEmail").value.trim();
  const password = document.getElementById("editPassword").value;

  setShopifyLoading(true);

  try {
    const data = {
      action: "updateAdminAccount",
      id,
      username,
      email,
    };

    if (password) data.password = password;

    const result = await apiRequest(data, "POST");

    if (result.success) {
      await loadAccounts();
      closeEditPopup();
      showSuccessPopup("Success", "Updated successfully");
    } else {
      showErrorPopup("Error", result.error);
    }
  } catch (err) {
    showErrorPopup("Error", err.message);
  } finally {
    setShopifyLoading(false);
  }
}

// ================= DELETE ACCOUNT =================
async function deleteAccount(id) {
  if (!confirm("Delete this account?")) return;

  setShopifyLoading(true);

  try {
    const result = await apiRequest(
      {
        action: "deleteAdminAccount",
        id,
      },
      "POST"
    );

    if (result.success) {
      await loadAccounts();
      showSuccessPopup("Deleted", "Account removed");
    } else {
      showErrorPopup("Error", result.error);
    }
  } catch (err) {
    showErrorPopup("Error", err.message);
  } finally {
    setShopifyLoading(false);
  }
}

// ================= DISPLAY =================
function displayAccounts() {
  const body = document.getElementById("accountsBody");
  body.innerHTML = "";

  if (!accounts.length) {
    body.innerHTML = "<tr><td colspan='3'>No accounts</td></tr>";
    return;
  }

  accounts.forEach((a) => {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td>${a.username}</td>
      <td>${a.email}</td>
      <td>
        <button onclick="deleteAccount(${a.id})">Delete</button>
        <button onclick="editAccount(${a.id})">Edit</button>
      </td>
    `;

    body.appendChild(row);
  });
}

// ================= EDIT =================
function editAccount(id) {
  const acc = accounts.find((a) => a.id === id);
  if (!acc) return;

  document.getElementById("editAccountId").value = acc.id;
  document.getElementById("editUsername").value = acc.username;
  document.getElementById("editEmail").value = acc.email;

  document.getElementById("editPopup").classList.add("active");
}

function closeEditPopup() {
  document.getElementById("editPopup").classList.remove("active");
}

// ================= POPUPS =================
function showSuccessPopup(t, m) {
  alert(t + ": " + m);
}

function showErrorPopup(t, m) {
  alert(t + ": " + m);
}
