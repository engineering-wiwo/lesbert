// ================= GLOBAL VARIABLES =================
let accounts = [];
let selectedAccounts = new Set();

// Function to wait for CONFIG to be available
function waitForConfig() {
  return new Promise((resolve) => {
    if (typeof CONFIG !== 'undefined' && CONFIG.ADMIN_API_URL) {
      resolve(CONFIG);
      return;
    }
    
    const checkInterval = setInterval(() => {
      if (typeof CONFIG !== 'undefined' && CONFIG.ADMIN_API_URL) {
        clearInterval(checkInterval);
        resolve(CONFIG);
      }
    }, 100);
  });
}

// ================= SHOPIFY LOADING =================
function ensureFallbackLoadingOverlay() {
  let overlay = document.getElementById("fallbackLoadingOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "fallbackLoadingOverlay";
  overlay.innerHTML = `
    <div class="fallback-loading-card">
      <div class="tenor-gif-embed" data-postid="14596258" data-share-method="host" data-aspect-ratio="0.965625" data-width="100%">
      </div>
      <p>Loading...</p>
    </div>
  `;

  const style = document.createElement("style");
  style.id = "fallbackLoadingOverlayStyle";
  style.textContent = `
    #fallbackLoadingOverlay {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(10, 15, 25, 0.65);
      z-index: 99999;
      backdrop-filter: blur(2px);
      padding: 24px;
      box-sizing: border-box;
    }

    #fallbackLoadingOverlay.is-active {
      display: flex;
    }

    #fallbackLoadingOverlay .fallback-loading-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid rgba(148, 163, 184, 0.35);
      border-radius: 16px;
      padding: 14px 18px;
      color: #f8fafc;
      font-weight: 600;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
    }

    #fallbackLoadingOverlay .tenor-gif-embed {
      width: 100%;
      max-width: 280px;
      border-radius: 12px;
      overflow: hidden;
    }

    #fallbackLoadingOverlay p {
      margin: 0;
      letter-spacing: 0.02em;
    }
  `;

  if (!document.getElementById("fallbackLoadingOverlayStyle")) {
    document.head.appendChild(style);
  }

  if (!document.querySelector('script[src="https://tenor.com/embed.js"]')) {
    const tenorScript = document.createElement("script");
    tenorScript.src = "https://tenor.com/embed.js";
    tenorScript.async = true;
    document.head.appendChild(tenorScript);
  }

  document.body.appendChild(overlay);
  return overlay;
}

function setShopifyLoading(isLoading) {
  if (window.shopify && typeof window.shopify.loading === "function") {
    window.shopify.loading(isLoading);
    return;
  }

  const overlay = ensureFallbackLoadingOverlay();
  overlay.classList.toggle("is-active", Boolean(isLoading));
}


// ================= INITIALIZATION =================
document.addEventListener('DOMContentLoaded', async function() {
  console.log('Super Admin page loaded');

  const config = await waitForConfig();

  if (!config || !config.ADMIN_API_URL) {
    showErrorPopup('Configuration Error', 'Admin API URL is not configured.');
    return;
  }

  loadAccounts();

  // Mobile menu setup
  const mobileBtn = document.querySelector('.mobile-menu-btn');
  if (mobileBtn) {
    mobileBtn.addEventListener('click', function() {
      const nav = document.getElementById('mobileNav');
      if (nav) nav.classList.toggle('active');
    });
  }
});

// ================= JSONP HELPER FUNCTION =================
// This function bypasses CORS by using a script tag
function jsonpRequest(url, params) {
  return new Promise((resolve, reject) => {
    // Create a unique callback name
    const callbackName = 'jsonp_callback_' + Date.now() + '_' + Math.floor(Math.random() * 10000);
    
    // Add the callback parameter to the URL
    const jsonpUrl = url + (url.includes('?') ? '&' : '?') + 'callback=' + callbackName;
    
    // Add other parameters
    const paramString = new URLSearchParams(params).toString();
    const fullUrl = jsonpUrl + (paramString ? '&' + paramString : '');
    
    // Create the script element
    const script = document.createElement('script');
    script.src = fullUrl;
    
    // Set up the callback function
    window[callbackName] = function(data) {
      // Clean up
      delete window[callbackName];
      document.body.removeChild(script);
      
      // Resolve the promise with the data
      resolve(data);
    };
    
    // Handle errors
    script.onerror = function() {
      // Clean up
      delete window[callbackName];
      document.body.removeChild(script);
      
      // Reject the promise
      reject(new Error('JSONP request failed'));
    };
    
    // Add the script to the page to execute the request
    document.body.appendChild(script);
  });
}

// ================= API FUNCTIONS =================

// Load accounts from Google Sheets using JSONP
async function loadAccounts() {
  setShopifyLoading(true);
  try {
    // Double-check CONFIG is available
    if (typeof CONFIG === 'undefined' || !CONFIG.ADMIN_API_URL) {
      console.error('CONFIG.ADMIN_API_URL is not defined');
      showErrorPopup('Error', 'API URL is not configured');
      return;
    }
    
    console.log('Loading admin accounts from:', CONFIG.ADMIN_API_URL);
    
    // Use JSONP instead of fetch
    const result = await jsonpRequest(CONFIG.ADMIN_API_URL, {
      action: 'getAdminAccounts',
      t: Date.now()
    });
    
    console.log('Admin accounts loaded:', result);
    
    if (result.success) {
      accounts = result.accounts || [];
      console.log('Accounts array:', accounts);
      displayAccounts();
    } else {
      console.error('API returned error:', result.error);
      showErrorPopup('Error', result.error || 'Failed to load admin accounts');
    }
  } catch (error) {
    console.error('Error loading admin accounts:', error);
    showErrorPopup('Error', 'Failed to load admin accounts: ' + error.message);
  } finally {
    setShopifyLoading(false);
  }
}

// Add a new admin account to Google Sheets using JSONP
async function addAccount() {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const email = document.getElementById('email').value.trim();
  
  console.log('Adding admin account:', { username, email });
  
  // Validation
  if (!username || !password || !email) {
    showErrorPopup('Error', 'All fields are required');
    return;
  }
  
  // Validate email domain
  if (!email.endsWith(`@${CONFIG.COMPANY_DOMAIN}`)) {
    showErrorPopup('Error', `Email must be from ${CONFIG.COMPANY_DOMAIN} domain`);
    return;
  }
  
  // Check if username already exists
  if (accounts.some(a => a.username === username)) {
    showErrorPopup('Error', 'Username already exists');
    return;
  }

  setShopifyLoading(true);
  try {
    // Create the data object
    const data = {
      action: "addAdminAccount",
      username: username,
      password: password,
      email: email,
      createdDate: new Date().toISOString(),
      lastLogin: ""
    };
    
    console.log('Sending admin data:', data);
    
    // Double-check CONFIG is available
    if (typeof CONFIG === 'undefined' || !CONFIG.ADMIN_API_URL) {
      throw new Error('CONFIG.ADMIN_API_URL is not defined');
    }
    
    // Use JSONP instead of fetch
    const result = await jsonpRequest(CONFIG.ADMIN_API_URL, data);
    console.log('Add admin account result:', result);
    
    if (result.success) {
      // Reload accounts
      await loadAccounts();
      
      // Reset form
      document.getElementById('addAccountForm').reset();
      
      // Show success popup
      showSuccessPopup('Success', 'Admin account added successfully');
    } else {
      console.error('Add account API error:', result.error);
      showErrorPopup('Error', result.error || 'Failed to add admin account');
    }
  } catch (error) {
    console.error('Error adding admin account:', error);
    showErrorPopup('Error', 'Failed to add admin account: ' + error.message);
  } finally {
    setShopifyLoading(false);
  }
}

// Update an admin account in Google Sheets
async function saveAccountChanges() {
  const id = parseInt(document.getElementById('editAccountId').value);
  const username = document.getElementById('editUsername').value.trim();
  const email = document.getElementById('editEmail').value.trim();
  const password = document.getElementById('editPassword').value;
  
  console.log('Updating admin account:', { id, username, email });
  
  // Validation
  if (!username || !email) {
    showErrorPopup('Error', 'Username and email are required');
    return;
  }
  
  // Validate email domain
  if (!email.endsWith(`@${CONFIG.COMPANY_DOMAIN}`)) {
    showErrorPopup('Error', `Email must be from ${CONFIG.COMPANY_DOMAIN} domain`);
    return;
  }
  
  // Check if username already exists (excluding current account)
  if (accounts.some(a => a.username === username && a.id !== id)) {
    showErrorPopup('Error', 'Username already exists');
    return;
  }

  setShopifyLoading(true);
  try {
    // Create the data object
    const data = {
      action: "updateAdminAccount",
      id: id,
      username: username,
      email: email
    };
    
    // Only include password if it's provided
    if (password) {
      data.password = password;
    }
    
    // Use JSONP instead of fetch
    const result = await jsonpRequest(CONFIG.ADMIN_API_URL, data);
    console.log('Update admin account result:', result);
    
    if (result.success) {
      // Reload accounts
      await loadAccounts();
      
      closeEditPopup();
      showSuccessPopup('Success', 'Admin account updated successfully');
    } else {
      console.error('Update account API error:', result.error);
      showErrorPopup('Error', result.error || 'Failed to update admin account');
    }
  } catch (error) {
    console.error('Error updating admin account:', error);
    showErrorPopup('Error', 'Failed to update admin account: ' + error.message);
  } finally {
    setShopifyLoading(false);
  }
}

// Delete an admin account from Google Sheets
async function deleteAccount(id) {
  const account = accounts.find(a => a.id === id);
  
  // Check if this is the last account
  if (accounts.length <= 1) {
    showWarningPopup('Cannot Delete', 'You cannot delete the last admin account. At least one admin account must exist.');
    return;
  }
  
  if (confirm(`Are you sure you want to delete the admin account "${account.username}"?`)) {
    setShopifyLoading(true);
    try {
      console.log('Deleting admin account:', id);
      
      // Use JSONP instead of fetch
      const result = await jsonpRequest(CONFIG.ADMIN_API_URL, {
        action: 'deleteAdminAccount',
        id: id
      });
      console.log('Delete admin account result:', result);
      
      if (result.success) {
        // Reload accounts
        await loadAccounts();
        showSuccessPopup('Success', 'Admin account deleted successfully');
      } else {
        console.error('Delete account API error:', result.error);
        showErrorPopup('Error', result.error || 'Failed to delete admin account');
      }
    } catch (error) {
      console.error('Error deleting admin account:', error);
      showErrorPopup('Error', 'Failed to delete admin account: ' + error.message);
    } finally {
      setShopifyLoading(false);
    }
  }
}

// Delete multiple admin accounts from Google Sheets
async function confirmDelete() {
  setShopifyLoading(true);
  try {
    console.log('Deleting selected admin accounts:', Array.from(selectedAccounts));
    
    // Delete each selected account
    for (const id of selectedAccounts) {
      // Use JSONP instead of fetch
      const result = await jsonpRequest(CONFIG.ADMIN_API_URL, {
        action: 'deleteAdminAccount',
        id: id
      });
      
      if (!result.success) {
        throw new Error(result.error);
      }
    }
    
    selectedAccounts.clear();
    document.getElementById('selectAll').checked = false;
    
    // Reload accounts
    await loadAccounts();
    updateDeleteButton();
    closeDeletePopup();
    showSuccessPopup('Success', 'Selected admin accounts deleted successfully');
  } catch (error) {
    console.error('Error deleting admin accounts:', error);
    closeDeletePopup();
    showErrorPopup('Error', 'Failed to delete admin accounts: ' + error.message);
  } finally {
    setShopifyLoading(false);
  }
}

// ================= UI FUNCTIONS =================

// Display admin accounts in the table
function displayAccounts() {
  const accountsBody = document.getElementById('accountsBody');
  accountsBody.innerHTML = '';
  
  if (accounts.length === 0) {
    accountsBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--fg-muted);">No admin accounts found</td></tr>';
    return;
  }
  
  const isLastAccount = accounts.length <= 1;
  
  accounts.forEach(account => {
    const row = document.createElement('tr');
    
    // Determine if delete button should be shown
    const showDeleteButton = !isLastAccount || accounts.length > 1;
    
    row.innerHTML = `
      <td><input type="checkbox" class="account-checkbox" data-id="${account.id}" onchange="toggleAccountSelection(${account.id})"></td>
      <td>${account.username}</td>
      <td>${account.email || ''}</td>
      <td>
        <button class="btn-secondary" style="padding:6px 12px; font-size:12px;" onclick="editAccount(${account.id})">
          Edit
        </button>
        ${showDeleteButton ? 
          `<button class="btn-secondary" style="padding:6px 12px; font-size:12px; background:var(--danger);" onclick="deleteAccount(${account.id})">
            Delete
          </button>` : 
          `<button class="btn-secondary" style="padding:6px 12px; font-size:12px; background:var(--fg-muted); opacity:0.5; cursor:not-allowed;" disabled>
            Delete
          </button>`
        }
      </td>
    `;
    accountsBody.appendChild(row);
  });
  
  // Hide the "Delete Selected" button if there's only one account
  updateDeleteButtonVisibility();
}

// Edit an admin account
function editAccount(id) {
  const account = accounts.find(a => a.id === id);
  if (account) {
    document.getElementById('editAccountId').value = account.id;
    document.getElementById('editUsername').value = account.username;
    document.getElementById('editEmail').value = account.email || '';
    document.getElementById('editPassword').value = '';
    
    document.getElementById('editPopup').classList.add('active');
  }
}

function closeEditPopup() {
  document.getElementById('editPopup').classList.remove('active');
}

// Toggle select all checkboxes
function toggleSelectAll() {
  const selectAll = document.getElementById('selectAll').checked;
  const checkboxes = document.querySelectorAll('.account-checkbox');
  
  checkboxes.forEach(checkbox => {
    checkbox.checked = selectAll;
    const id = parseInt(checkbox.getAttribute('data-id'));
    if (selectAll) {
      selectedAccounts.add(id);
    } else {
      selectedAccounts.delete(id);
    }
  });
  
  updateDeleteButton();
}

// Toggle individual checkbox selection
function toggleAccountSelection(id) {
  if (selectedAccounts.has(id)) {
    selectedAccounts.delete(id);
  } else {
    selectedAccounts.add(id);
  }
  
  updateDeleteButton();
  
  // Check if all checkboxes are selected
  const checkboxes = document.querySelectorAll('.account-checkbox');
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  document.getElementById('selectAll').checked = allChecked;
}

// Update delete button visibility and text
function updateDeleteButton() {
  const deleteBtn = document.getElementById('deleteSelectedBtn');
  
  // Don't show delete button if there's only one account
  if (accounts.length <= 1) {
    deleteBtn.style.display = 'none';
    return;
  }
  
  if (selectedAccounts.size > 0) {
    deleteBtn.style.display = 'block';
    deleteBtn.textContent = `Delete Selected (${selectedAccounts.size})`;
  } else {
    deleteBtn.style.display = 'none';
  }
}

function updateDeleteButtonVisibility() {
  const deleteBtn = document.getElementById('deleteSelectedBtn');
  
  if (accounts.length <= 1) {
    deleteBtn.style.display = 'none';
  }
}

// Delete selected admin accounts
function deleteSelectedAccounts() {
  // Check if deleting selected accounts would leave zero accounts
  const remainingAccounts = accounts.filter(a => !selectedAccounts.has(a.id));
  if (remainingAccounts.length === 0) {
    showWarningPopup('Cannot Delete', 'You cannot delete all admin accounts. At least one admin account must exist.');
    return;
  }
  
  // Check if deleting selected accounts would leave only one account (which is fine)
  if (remainingAccounts.length === 1 && accounts.length > 1) {
    if (confirm(`Warning: This will leave only one admin account. Are you sure you want to delete the selected ${selectedAccounts.size} account(s)?`)) {
      document.getElementById('deletePopup').classList.add('active');
    }
  } else {
    document.getElementById('deletePopup').classList.add('active');
  }
}

function closeDeletePopup() {
  document.getElementById('deletePopup').classList.remove('active');
}

// Search admin accounts
function searchAccounts() {
  const searchTerm = document.getElementById('searchAccounts').value.toLowerCase();
  const rows = document.querySelectorAll('#accountsBody tr');
  
  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(searchTerm) ? '' : 'none';
  });
}

// ================= POPUP FUNCTIONS =================

function showSuccessPopup(title, message) {
  document.getElementById('successTitle').textContent = title;
  document.getElementById('successMessage').textContent = message;
  document.getElementById('successPopup').classList.add('active');
}

function closeSuccessPopup() {
  document.getElementById('successPopup').classList.remove('active');
}

function showErrorPopup(title, message) {
  document.getElementById('errorTitle').textContent = title;
  document.getElementById('errorMessage').textContent = message;
  document.getElementById('errorPopup').classList.add('active');
}

function closeErrorPopup() {
  document.getElementById('errorPopup').classList.remove('active');
}

function showWarningPopup(title, message) {
  document.getElementById('warningTitle').textContent = title;
  document.getElementById('warningMessage').textContent = message;
  document.getElementById('warningPopup').classList.add('active');
}

function closeWarningPopup() {
  document.getElementById('warningPopup').classList.remove('active');
}
