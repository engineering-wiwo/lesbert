
const CONFIG = {
  API_URL: "https://asset-api-proxy.b4nn3d-0124.workers.dev/",
  ADMIN_API_URL: "https://script.google.com/macros/s/AKfycbzwAbpJb1KZnP8Y4jl9YUkM996TJP2BTs7ImAbo0oYWsFtMsgmEkiiqo8c0gEWCCIA/exec",
  JSON_API_URL: "https://script.google.com/macros/s/AKfycbwvkADinvGO_ZnTzmVM4owXMf2uBN_Hba7LXgHu-AJFNHVaVqRiW_ENY-24JV9AA_AJ/exec",
  GOOGLE_CLIENT_ID: "955024166373-hjrj6splihhs19pj96fgpv0ri4cf7u2q.apps.googleusercontent.com",
  COMPANY_DOMAIN: "gmail.com"
};

window.CONFIG = CONFIG;

// Add a debug log to verify the config is loaded correctly
console.log('CONFIG loaded:', CONFIG);
console.log('ADMIN_API_URL:', CONFIG.ADMIN_API_URL); 
