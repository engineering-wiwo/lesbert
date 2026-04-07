console.log("user.js loaded");

// ======================
// GLOBAL VARIABLES
// ======================

let capturedImage = "";
let stream = null;

let userEmail = "";
let userName = "";
let scannedAsset = "";

let scannerInstance = null;
let scanLock = false;

let restartTimeout = null;

// ======================
// INIT APP
// ======================
window.addEventListener("load", () => {
  userEmail = localStorage.getItem("userEmail") || "";
  userName  = localStorage.getItem("userName") || "";

  if (typeof google !== "undefined") {
    initLogin();
  } else {
    console.error("Google Identity Services not loaded");
  }

  setupPopupClose();
  loadUserAssets();
});

// ======================
// GOOGLE LOGIN
// ======================
function initLogin() {
  google.accounts.id.initialize({
    client_id: CONFIG.GOOGLE_CLIENT_ID,
    callback: handleLogin
  });

  google.accounts.id.renderButton(
    document.querySelector(".login-wrapper"),
    { theme: "outline", size: "large", width: "250" }
  );
}

function customLogin() {
  if (typeof google !== "undefined" && google.accounts?.id) {
    google.accounts.id.prompt();
  } else {
    alert("Google Sign-In is not available. Please refresh.");
  }
}

function handleLogin(response) {
  const data = parseJwt(response.credential);

  userEmail = data.email;
  userName = data.name;

  if (!userEmail.endsWith(CONFIG.COMPANY_DOMAIN)) {
    alert("Only company accounts allowed");
    return;
  }

  localStorage.setItem("userName", userName);
  localStorage.setItem("userEmail", userEmail);

  document.getElementById("userInfo").innerText = "Logged in: " + userEmail;

  const loginWrapper = document.querySelector(".login-wrapper");
  if (loginWrapper) loginWrapper.style.display = "none";

  setTimeout(startScanner, 500);

  sendEmailNotification({
    type: "login",
    user: userName,
    email: userEmail
  });
}

// ======================
// JWT
// ======================
function parseJwt(token) {
  let base64Url = token.split(".")[1];
  let base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(
    decodeURIComponent(
      atob(base64)
        .split("")
        .map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    )
  );
}

// ======================
// SOUND + VIBRATION
// ======================
function playScanBeep() {
  try {
    const audio = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");
    audio.volume = 0.5;
    audio.play();
  } catch (e) {}
}

function vibrateOnScan() {
  try {
    if (navigator.vibrate) {
      navigator.vibrate([150, 50, 150]);
    }
  } catch (e) {}
}

// ======================
// STOP SCANNER
// ======================
function stopScanner() {
  try {
    if (scannerInstance) {
      scannerInstance.clear();
      scannerInstance = null;
    }
  } catch (e) {}
}

// ======================
// RESTART SCANNER
// ======================
function restartScanner(delay = 1200) {
  clearTimeout(restartTimeout);

  restartTimeout = setTimeout(() => {
    stopScanner();
    startScanner();
  }, delay);
}

// ======================
// SCANNER
// ======================
function startScanner() {
  if (scannerInstance) return;

  if (typeof Html5QrcodeScanner === "undefined") {
    console.error("QR Scanner missing");
    return;
  }

  scanLock = false;

  scannerInstance = new Html5QrcodeScanner("scanner", {
    fps: 10,
    qrbox: 250
  });

  scannerInstance.render(async (decodedText) => {

    if (scanLock) return;
    scanLock = true;

    if (decodedText === scannedAsset) {
      scanLock = false;
      return;
    }

    scannedAsset = decodedText;
    capturedImage = "";

    document.getElementById("assetID").innerText = decodedText;

    playScanBeep();
    vibrateOnScan();

    stopScanner();

    try {
      const list = await fetch(CONFIG.API_URL + "?action=getAssets&nocache=" + Date.now())
        .then(r => r.json());

      const asset = list.find(a =>
        a.id === scannedAsset ||
        a.assetID === scannedAsset ||
        a.qr === scannedAsset
      );

      if (!asset) {
        document.getElementById("status").innerText = "Asset not found";
        updateActionButtons("");
        scanLock = false;
        return;
      }

      updateAssetUI(asset);

    } catch (err) {
      document.getElementById("status").innerText = "Error loading asset";
      scanLock = false;
    }

    setTimeout(() => {
      scanLock = false;
    }, 1500);
  });
}

// ======================
// UI UPDATE
// ======================
function updateAssetUI(asset) {
  document.getElementById("status").innerText =
    `Status: ${asset.status} ${asset.holder ? "| Holder: " + asset.holder : ""}`;

  updateActionButtons(asset.status);

  // ✅ AUTO SWITCH MODE BEHAVIOR
  autoSwitchActionMode(asset.status);

  // OPTIONAL: auto-trigger return flow if borrowed
  const s = (asset.status || "").toLowerCase();
  if (s === "borrowed") {
    setTimeout(() => {
      console.log("Auto triggering return mode");
      returnAsset();
    }, 400);
  }
}

document.addEventListener('DOMContentLoaded', function () {

  // ======================
  // MOBILE MENU
  // ======================
  const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
  const mobileNav = document.querySelector('.mobile-nav');

  if (mobileMenuBtn && mobileNav) {

    mobileMenuBtn.addEventListener('click', function () {
      mobileNav.classList.toggle('active');
      document.body.classList.toggle('menu-open');
    });

    // Close menu when clicking links
    document.querySelectorAll('.mobile-nav a').forEach(link => {
      link.addEventListener('click', () => {
        mobileNav.classList.remove('active');
        document.body.classList.remove('menu-open');
      });
    });

    // Close when clicking outside
    document.addEventListener('touchstart', function (e) {
      if (
        mobileNav &&
        mobileMenuBtn &&
        !mobileNav.contains(e.target) &&
        !mobileMenuBtn.contains(e.target)
      ) {
        mobileNav.classList.remove('active');
        document.body.classList.remove('menu-open');
      }
    });

    // Close on ESC key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        mobileNav.classList.remove('active');
        document.body.classList.remove('menu-open');
      }
    });
  }

  // ======================
  // SCROLL ANIMATION
  // ======================
  const isMobile = window.innerWidth < 768;

  const observer = new IntersectionObserver(
    (entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate-in');
          obs.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    }
  );

  const elements = document.querySelectorAll('.card, .stat-card, .team-card');

  if (elements.length > 0) {
    elements.forEach(el => {
      if (!isMobile) {
        observer.observe(el);
      } else {
        el.classList.add('animate-in');
      }
    });
  }

});

function autoSwitchActionMode(status) {
  const s = (status || "").toLowerCase();

  const borrowBtn = document.getElementById("borrowBtn");
  const returnBtn = document.getElementById("returnBtn");

  if (s === "available") {
    console.log("Mode: BORROW");
    borrowBtn?.classList.add("highlight");
    returnBtn?.classList.remove("highlight");
  }

  if (s === "borrowed") {
    console.log("Mode: RETURN");
    returnBtn?.classList.add("highlight");
    borrowBtn?.classList.remove("highlight");
  }
}

// ======================
// BUTTONS
// ======================
function updateActionButtons(status) {
  const borrowBtn = document.getElementById("borrowBtn");
  const returnBtn = document.getElementById("returnBtn");

  if (!borrowBtn || !returnBtn) return;

  const s = (status || "").toLowerCase();

  if (s === "available") {
    borrowBtn.style.display = "block";
    returnBtn.style.display = "none";
  } else if (s === "borrowed") {
    borrowBtn.style.display = "none";
    returnBtn.style.display = "block";
  } else {
    borrowBtn.style.display = "none";
    returnBtn.style.display = "none";
  }
}

// ======================
// ACTIONS
// ======================
function borrowAsset() {
  sendAction("borrow");
  closePopup();
}

function returnAsset() {
  openCamera();
}

// ======================
// CAMERA SYSTEM
// ======================

function openCamera() {
  const modal = document.getElementById("cameraModal");
  const video = document.getElementById("cameraPreview");

  if (!modal || !video) return;

  modal.style.display = "flex";

  navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment" }
  })
  .then(s => {
    stream = s;
    video.srcObject = stream;
  })
  .catch(err => {
    alert("Camera error: " + err);
  });
}

function captureReturnPhoto() {
  const video = document.getElementById("cameraPreview");
  const canvas = document.getElementById("snapshot");
  const preview = document.getElementById("photoPreview");

  if (!video || !canvas || !preview) return;

  const ctx = canvas.getContext("2d");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  ctx.drawImage(video, 0, 0);

  capturedImage = canvas.toDataURL("image/png");

  preview.src = capturedImage;
  preview.style.display = "block";

  video.style.display = "none";

  const submitBtn = document.getElementById("submitReturnBtn");
  const retakeBtn = document.getElementById("retakeBtn");

  if (submitBtn) submitBtn.style.display = "inline-block";
  if (retakeBtn) retakeBtn.style.display = "inline-block";
}

function retakePhoto() {
  const video = document.getElementById("cameraPreview");
  const preview = document.getElementById("photoPreview");

  if (!video || !preview) return;

  preview.style.display = "none";
  video.style.display = "block";

  const submitBtn = document.getElementById("submitReturnBtn");
  const retakeBtn = document.getElementById("retakeBtn");

  if (submitBtn) submitBtn.style.display = "none";
  if (retakeBtn) retakeBtn.style.display = "none";

  capturedImage = "";
}

function closeCamera() {
  const modal = document.getElementById("cameraModal");

  if (modal) modal.style.display = "none";

  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  const video = document.getElementById("cameraPreview");
  const preview = document.getElementById("photoPreview");

  if (video) video.style.display = "block";
  if (preview) preview.style.display = "none";

  capturedImage = "";
}



// ======================
// BORROW / RETURN REQUEST
// ======================
async function sendAction(action) {
  if (!userEmail) return alert("Login first");
  if (!scannedAsset) return alert("Scan QR first");

  document.getElementById("status").innerText = "Processing...";

  const borrowedAt = new Date().toISOString();

  try {
    const res = await fetch(CONFIG.API_URL + "?nocache=" + Date.now(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        asset: scannedAsset,
        email: userEmail,
        name: userName,
        borrowedAt
      })
    });

    const result = await res.json();
    document.getElementById("status").innerText = result.message;

    if (action === "borrow") {
      sendEmailNotification({
        type: "borrow",
        asset: scannedAsset,
        user: userName,
        email: userEmail,
        timestamp: borrowedAt
      });
    }

    loadUserAssets();
    restartScanner();

  } catch (err) {
    document.getElementById("status").innerText = "Error processing request";
  }
}

// ======================
// POPUP SYSTEM
// ======================

function confirmBorrow() {
  if (!scannedAsset) {
    alert("Scan a QR first");
    return;
  }

  const popup = document.getElementById("borrowPopup");
  const assetText = document.getElementById("popupAsset");

  if (!popup || !assetText) return;

  assetText.innerText = scannedAsset;

  // show popup
  popup.classList.add("active");
}

function closePopup() {
  const popup = document.getElementById("borrowPopup");
  if (!popup) return;

  popup.classList.remove("active");
}

function setupPopupClose() {
  const popup = document.getElementById("borrowPopup");
  if (!popup) return;

  // click outside to close
  popup.addEventListener("click", function (e) {
    if (e.target === popup) {
      closePopup();
    }
  });

  // ESC key to close (🔥 nice UX)
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      closePopup();
    }
  });
}

// ======================
// RETURN WITH PHOTO
// ======================
function submitReturnWithPhoto() {
  if (!capturedImage) return alert("Capture photo first");
  if (!userEmail) return alert("Login first");

  document.getElementById("status").innerText = "Processing return...";

  const returnedAt = new Date().toISOString();

  fetch(CONFIG.API_URL + "?nocache=" + Date.now(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "returnWithImage",
      asset: scannedAsset,
      email: userEmail,
      name: userName,
      image: capturedImage,
      returnedAt
    })
  })
    .then(r => r.json())
    .then(async result => {
      document.getElementById("status").innerText = result.message;

      sendEmailNotification({
        type: "return",
        asset: scannedAsset,
        user: userName,
        email: userEmail,
        timestamp: returnedAt
      });

      closeCamera();

      const list = await fetch(CONFIG.API_URL + "?action=getAssets&nocache=" + Date.now())
        .then(r => r.json());

      const asset = list.find(a => a.id === scannedAsset);
      if (asset) updateAssetUI(asset);

      loadUserAssets();
      restartScanner();
    })
    .catch(() => {
      document.getElementById("status").innerText = "Return failed";
    });
}

// ======================
// FEATURE 1 — EMAIL NOTIFICATION
// Calls Apps Script endpoint which sends the email server-side
// Admin email is stored in localStorage by super_admin settings
// ======================
async function sendEmailNotification({ type, asset, user, email, timestamp }) {
  try {
    const notifyEmail = localStorage.getItem("bs_notify_email") || "";
    if (!notifyEmail) return;

    const ts = timestamp ? new Date(timestamp).toLocaleString() : new Date().toLocaleString();
    let subject = "", body = "";

    if (type === "borrow") {
      subject = `[BorrowSmart] Asset Borrowed: ${asset}`;
      body = `Asset ${asset} was borrowed by ${user} (${email}) at ${ts}.`;
    } else if (type === "return") {
      subject = `[BorrowSmart] Asset Returned: ${asset}`;
      body = `Asset ${asset} was returned by ${user} (${email}) at ${ts}.`;
    } else if (type === "login") {
      subject = `[BorrowSmart] User Login: ${user}`;
      body = `User ${user} (${email}) logged into BorrowSmart at ${new Date().toLocaleString()}.`;
    } else {
      return;
    }

    const params = new URLSearchParams({ action: "sendNotificationEmail", to: notifyEmail, subject, body });
    // Apps Script redirects on GET requests — must use no-cors or the browser blocks it
    fetch(CONFIG.ADMIN_API_URL + "?" + params.toString())
    .then(res => res.text())
    .then(data => console.log("Email response:", data))
    .catch(err => console.error("Email error:", err));

    console.log("Sending email notification:", { type, asset, user, email, timestamp });
  } catch (e) {
    console.warn("Email notification error:", e);
  }
}

// ======================
// LOAD ASSETS
// ======================
async function loadUserAssets() {
  const body = document.getElementById("userAssetBody");
  if (!body) return;
  body.innerHTML = "<tr><td colspan='5'>Loading...</td></tr>";
  try {
    const res = await fetch(CONFIG.API_URL + "?action=getAssets&nocache=" + Date.now());
    const data = await res.json();
    renderAssets(data);
  } catch (err) {
    console.error(err);
    body.innerHTML = "<tr><td colspan='5'>Failed to load</td></tr>";
  }
}

// ======================
// FEATURE 3 — RENDER ASSETS with timestamps
// ======================
function renderAssets(data) {
  const body = document.getElementById("userAssetBody");
  if (!body) return;
  body.innerHTML = "";

  if (!data || data.length === 0) {
    body.innerHTML = "<tr><td colspan='5'>No assets found</td></tr>";
    return;
  }

  data.forEach(asset => {
    let statusStyle = "";
    if (asset.status === "Available") statusStyle = "color:#10b981;font-weight:600;";
    if (asset.status === "Borrowed")  statusStyle = "color:#ef4444;font-weight:600;";

    const tx = getTransactionDetails(asset);
    const transactionDetails = [
      tx.borrowedAt
        ? `<div style="font-size:12px;color:#cbd5e1;">📤 Borrowed: ${formatTS(tx.borrowedAt)}</div>`
        : "",
      tx.returnedAt
        ? `<div style="font-size:12px;color:#cbd5e1;">📥 Returned: ${formatTS(tx.returnedAt)}</div>`
        : "",
      !tx.borrowedAt && !tx.returnedAt && tx.lastTransaction
        ? `<div style="font-size:12px;color:#cbd5e1;">🕒 Transaction: ${formatTS(tx.lastTransaction)}</div>`
        : ""
    ].filter(Boolean).join("") || `<span style="color:#94a3b8;font-size:12px;">No transaction yet</span>`;

    body.innerHTML += `
      <tr>
        <td>${asset.name}</td>
        <td>${asset.category || "—"}</td>
        <td style="${statusStyle}">${asset.status}</td>
        <td>${asset.holder || "—"}</td>
        <td>${transactionDetails}</td>
      </tr>
    `;
  });
}

function formatTS(iso) {
  const d = parseDateValue(iso);
  if (!d) return iso || "—";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function getTransactionDetails(asset) {
  return {
    borrowedAt: firstValue(asset, ["borrowedAt", "borrowed_at", "borrowDate", "borrowedDate"]),
    returnedAt: firstValue(asset, ["returnedAt", "returned_at", "returnDate", "returnedDate"]),
    lastTransaction: firstValue(asset, ["transactionAt", "transactionDateTime", "timestamp", "lastUpdated", "updatedAt"])
  };
}

function firstValue(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") return obj[key];
  }
  return "";
}

function parseDateValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;

  // Support Google Sheets serial date numbers
  if (typeof value === "number") {
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}


// ======================
// SEARCH
// ======================
function searchInventory() {
  const input = document.getElementById("search")?.value.toLowerCase();
  const rows = document.getElementById("userAssetBody")?.getElementsByTagName("tr");
  if (!rows) return;
  for (let row of rows) {
    let match = false;
    for (let cell of row.getElementsByTagName("td")) {
      if (cell.innerText.toLowerCase().includes(input)) { match = true; break; }
    }
    row.style.display = match ? "" : "none";
  }
}
