import { db } from './modules/database.js';
import { RESOURCES } from './modules/constants.js';
import { generateUUID } from './modules/utils.js';
import MasterDataManager from './modules/masterData.js';
import { getToken, setAuthSuccessCallback, msalInstance, handleAuthRedirect } from './modules/auth.js';
import { syncQueuedEntries, refreshAllDataFromServer } from './modules/sync.js';
import { initializeAppUI, updateSyncStatusUI, updateSyncButtonState, loadEntriesForDate, checkAdminStatus } from './modules/ui.js';

// Create master data manager instance
const masterData = new MasterDataManager(db);

/**
 * This is the main initialization sequence for the application.
 * It should only be called once authentication is confirmed.
 */
async function startApp() {
  console.log("Starting application initialization...");
  try {
    // Show a loading indicator to the user
    document.getElementById('syncStatus').textContent = 'Initialisation de l\'application...';

    await db.open();
    console.log("✅ Dexie DB open and migrated to latest version");

    // Initialize master data (which handles auth and fetches from SharePoint)
    await masterData.initialize();
    console.log("Master data initialized");


    // Initialize the UI with the data
    initializeAppUI(masterData);
    console.log("Initial UI setup complete");

    // Check admin status after UI is ready
    const account = msalInstance.getAllAccounts()[0];
    checkAdminStatus(account);

    // Set up the manual sync button
    document.getElementById('manual-sync-btn').addEventListener('click', () => syncQueuedEntries(true, true));

    // Set up the refresh data button
    document.getElementById('refresh-data-btn').addEventListener('click', refreshAllDataFromServer);

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => { // Ensure page is loaded before registering SW
            navigator.serviceWorker.register('service-worker.js')
                .then(reg => console.log('Service Worker: Registered', reg))
                .catch(err => console.error('Service Worker: Registration Error', err));
        });
    }

  } catch (err) {
    console.error("Fatal error during application startup:", err);
    // Display a user-friendly error message on the screen
    document.body.innerHTML = `<h1>Error</h1><p>Could not start the application. Please check the console for details.</p><p>${err.message}</p>`;
  }
}

// --- Event Listeners for Online/Offline Status ---
window.addEventListener('offline', () => {
    console.log("Application is now offline.");
    updateSyncStatusUI(false, 'Hors ligne. Les entrées seront mises en file d\'attente.', false); // Pass false for isOnline
    updateSyncButtonState(); // Update button state
});

// Handle when app comes back online
window.addEventListener('online', () => {
    console.log("Application is now online.");
    updateSyncStatusUI(true, 'En ligne. Prêt à synchroniser.', true);
    updateSyncButtonState();
});


// --- Application Entry Point ---

// 1. Set the callback that auth.js will trigger after a successful redirect login.
setAuthSuccessCallback(startApp);

// 2. Handle the redirect case. This will check if the page is loaded after a redirect
// and if so, it will process the response and call our callback if successful.
handleAuthRedirect();

// 3. Check the auth state.
if (msalInstance.getAllAccounts().length > 0) {
  // If we already have an account, start the app.
  startApp();
} else {
  // If we don't have an account and we are not in a redirect, trigger the login.
  // The app will be started by the callback after the redirect.
  // We check for hash to avoid repeated login calls if the redirect is still processing.
  if (!window.location.hash.includes('code=')) {
    document.getElementById('syncStatus').textContent = 'Redirection vers la page de connexion...';
    getToken();
  }
}
