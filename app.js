// c:\Users\DIA\Documents\soeco\data entry app\app.js

// 1. Define the database
const db = new Dexie("BasaltDataEntryDB");

// 2. Define the schema (tables and their indexes)
// Bump the version number when schema changes (e.g., reverting primary key)
db.version(4).stores({
  // Schema aligned with potential Excel columns
  // ++id: auto-incrementing primary key
  // date: indexed for querying by date
  // status: indexed for querying 'queued' entries
  // machine: indexed for querying by machine name (or 'livraison')
  formEntries: '++id, date, status, machine, resource, quantity',
  // Reverting stockChecks to use compound primary key '[resourceName+date]'
  // resourceName, date, quantityOnHand, synced are also individually indexed.
  stockChecks: '[resourceName+date], resourceName, date, quantityOnHand, synced'
}).upgrade(async (tx) => { // Making it async is good practice if you await inside, though not strictly needed here
  console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.log("!!! EXECUTING UPGRADE TO DATABASE VERSION 4 !!!");
  // When changing a primary key, it's often best to clear the old table
  // to avoid issues with data that doesn't conform to the new key structure.
  // This will remove any existing stock check data.
  console.log("!!! Version 4 Upgrade: Clearing existing stockChecks table (due to PK change). !!!");
  console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  return tx.table('stockChecks').clear();
});

// Wait for the DB to open (and the upgrade to run) before doing anything else:
db.open()
  .then(() => {
    console.log("✅ Dexie DB open and migrated to latest version");
    // Now it’s safe to wire up your sync button:
    document
      .getElementById('manual-sync-btn')
      .addEventListener('click', () => syncQueuedEntries(true, true));
    // Initialize the UI and load initial data
    initializeAppUI();
  })
  .catch(err => console.error("Failed to open DB:", err));

console.log("Dexie DB initialized:", db.name);

// --- Basic CRUD Operations ---

// Example: Function to add a new form entry
async function addFormEntry(entryData) {
  try {
    // entryData should be an object representing a row in your target format, e.g.,
    // { date: '2023-10-27', machine: 'EXC-300', resource: 'Gasoil', quantity: 50, status: 'queued', notes: '...' }
    // OR
    // { date: '2023-10-27', machine: 'livraison (Gasoil)', resource: 'Gasoil', quantity: 200, status: 'queued', notes: '...' }
    
    const id = await db.formEntries.add(entryData);
    console.log(`Form entry added with id ${id}`);
    return id;
  } catch (error) {
    console.error("Error adding form entry:", error);
  }
}

// Example: Function to get all queued form entries
async function getQueuedEntries() {
  try {
    // Assuming you add a 'status' field to your entries, e.g., 'queued', 'synced'
    const entries = await db.formEntries.where('status').equals('queued').toArray();
    console.log("Queued entries:", entries);
    return entries;
  } catch (error) {
    console.error("Error fetching queued entries:", error);
    return [];
  }
}

// Example: Function to update an entry (e.g., change its status after syncing)
async function updateEntryStatus(id, newStatus) {
  try {
    const count = await db.formEntries.update(id, { status: newStatus });
    if (count) {
      console.log(`Entry ${id} status updated to ${newStatus}`);
    } else {
      console.log(`Entry ${id} not found for update.`);
    }
    return count;
  } catch (error) {
    console.error("Error updating entry status:", error);
  }
}

// Example: Function to delete an entry (e.g., after successful sync)
async function deleteEntry(id) {
  try {
    await db.formEntries.delete(id);
    console.log(`Entry ${id} deleted.`);
  } catch (error) {
    console.error("Error deleting entry:", error);
  }
}

// --- Stock Check Operations ---

// Function to get the most recent stock check for a resource before a specific date
async function getMostRecentStockCheck(resourceName, beforeDate) {
  try {
    return await db.stockChecks
      .where('resourceName').equals(resourceName)
      .and(s => s.date < beforeDate)
      .reverse()
      .first();
  } catch (error) {
    console.error(`Error fetching most recent stock check for ${resourceName} before ${beforeDate}:`, error);
    return null;
  }
}

// Function to save a new stock check
async function saveStockCheck(stockCheckData) {
  try {
    // Add validation before saving
    if (!stockCheckData.resourceName || typeof stockCheckData.resourceName !== 'string' ||
        !stockCheckData.date || typeof stockCheckData.date !== 'string' ||
        typeof stockCheckData.quantityOnHand !== 'number' || isNaN(stockCheckData.quantityOnHand)) {
      console.error("Invalid stockCheckData:", stockCheckData);
      throw new Error("Attempted to save invalid stock check data.");
    }
    await db.stockChecks.add({
      ...stockCheckData,
      synced: false    // ← force a real boolean here
    });
    console.log(`Stock check saved: ${JSON.stringify(stockCheckData)}`);
  } catch (error) {
    console.error('Error saving stock check:', error);
  }
}
// Function to get all entries for a specific date
async function getEntriesByDate(dateString) {
  try {
    const entries = await db.formEntries.where('date').equals(dateString).toArray();
    console.log(`Entries for date ${dateString}:`, entries);
    return entries;
  } catch (error) {
    console.error(`Error fetching entries for date ${dateString}:`, error);
    return [];
  }
}

// Function to delete all entries for a specific date
async function deleteEntriesByDate(dateString) {
  try {
    const count = await db.formEntries.where('date').equals(dateString).delete();
    console.log(`${count} entries deleted for date ${dateString}.`);
    return count;
  } catch (error) {
    console.error(`Error deleting entries for date ${dateString}:`, error);
  }
}
// --- Example Usage (you'll integrate this with your form submission logic) ---
// This is just for demonstration. You'll call these from your event handlers.

// async function demoDexie() {
//   const newEntry = {
//     date: new Date().toISOString().split('T')[0],
//     site: 'Main Site',
//     machineName: 'Excavator ZX200',
//     hours: 8,
//     fuel: 150,
//     operator: 'John Doe',
//     notes: 'Routine check, all good.',
//     status: 'queued' // Important for sync logic
//   };
//   const entryId = await addFormEntry(newEntry);

//   if (entryId) {
//     await getQueuedEntries();
//     await updateEntryStatus(entryId, 'synced');
//     await getQueuedEntries(); // Should be empty or one less
//     // await deleteEntry(entryId); // Or delete after sync
//   }
// }
// demoDexie(); // Call this to test if you like

// --- Sync Logic ---
const SYNC_ENDPOINT_URL = 'YOUR_SHAREPOINT_FLOW_OR_AZURE_FUNCTION_URL_HERE'; // Replace this!

async function syncQueuedEntries(showStatus = true, manualTrigger = false) {
  if (!navigator.onLine) {
    console.log("Offline. Sync deferred.");
    // Optionally, update UI to show offline status
    updateSyncStatusUI(false, 'Offline. Entries are queued.');
    return;
  }

  console.log("Online. Attempting to sync entries...");
  if (showStatus) updateSyncStatusUI(true, manualTrigger ? 'Manual Sync: Syncing...' : 'Syncing...');

  const queuedEntries = await getQueuedEntries();

  if (queuedEntries.length === 0) {
    console.log(manualTrigger ? "Manual Sync: No entries to sync." : "No entries to sync.");
    if (showStatus) updateSyncStatusUI(true, 'All entries synced.');
    return;
  }

  // We will send entries one by one. If your backend can handle batches,
  // you could group them here before sending.

  for (const entry of queuedEntries) {
    try {
      // The entry object from Dexie should now match the structure needed by the backend.
      // For now, we send the whole entry, excluding its local 'id' and 'status'.
      const { id, status, ...payload } = entry;

      const response = await fetch(SYNC_ENDPOINT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        console.log(`Entry ${id} (Machine: ${entry.machine}) synced successfully.`);
        // Option 1: Update status to 'synced'
        await updateEntryStatus(id, 'synced');
        // Option 2: Delete after successful sync (if you don't need to keep synced items locally)
        // await deleteEntry(id);
        if (showStatus) updateSyncStatusUI(true, manualTrigger ? `Manual Sync: Synced entry ${id}.` : `Synced entry ${id}.`);
      } else {
        console.error(`Error syncing entry ${id} (Machine: ${entry.machine}): ${response.status} ${response.statusText}`);
        // Keep status as 'queued' so it's retried later
        // Maybe add a retry count or error message to the entry in Dexie
        // Handle non-OK responses: maybe update status to 'failed', retry later, etc.
        updateSyncStatusUI(true, `Error syncing entry ${id}.`);
      }
    } catch (error) {
      console.error(`Network error or exception syncing entry ${entry.id}:`, error);
      updateSyncStatusUI(true, 'Network error during sync.');
      // If one fails, we stop and try again later to maintain order if necessary
      // or you could implement a more robust retry for individual items.
      return; // Stop syncing on the first error to try again later
    }
  }
  // Sync stock checks
  // Now that 'synced' is indexed, we can use the more efficient query
  let queuedStockChecks = [];
try {
  queuedStockChecks = await db.stockChecks.where('synced').equals(false).toArray();
} catch (err) {
  console.warn('synced-index lookup failed, falling back to JS filter:', err);
  const allChecks = await db.stockChecks.toArray();
  queuedStockChecks = allChecks.filter(sc => sc.synced === false);
}
console.log(`Found ${queuedStockChecks.length} stock checks to sync.`);
  for (const stockCheck of queuedStockChecks) {
    try {
      const response = await fetch(SYNC_ENDPOINT_URL + "/stock-check", { // Assuming different endpoint or flag
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stockCheck),
      });
if (response.ok) {
  // Use the compound PK [resourceName, date] to mark as synced
  if (stockCheck.resourceName && stockCheck.date) {
    await db.stockChecks.update(
      [stockCheck.resourceName, stockCheck.date],
      { synced: true }
    );
    console.log(`Stock check for ${stockCheck.resourceName} on ${stockCheck.date} marked synced.`);
  } else {
    console.error('Skipping stockCheck update due to missing resourceName or date:', stockCheck);
  }
}
    } catch (error) { /* Handle stock check sync error */ }
  }

  console.log(manualTrigger ? "Manual Sync: Process finished." : "Sync process finished.");
  updateSyncStatusUI(true, 'Sync complete. All queued entries processed.');
}

// --- Event Listeners for Online/Offline Status ---
// window.addEventListener('online', syncQueuedEntries); // Removed automatic sync on online event

window.addEventListener('offline', () => {
  console.log("Application is now offline.");
  updateSyncStatusUI(false, 'Offline. Entries will be queued.', false); // Pass false for isOnline
  updateSyncButtonState(); // Update button state
});

// --- UI Update for Sync Status (Placeholder) ---
// You'll need to create an element in your HTML to show this, e.g., <div id="syncStatus"></div>
function updateSyncStatusUI(isOnline, message) {
  const statusElement = document.getElementById('syncStatus');
  if (statusElement) {
    statusElement.textContent = `Online: ${isOnline} - ${message}`;
    statusElement.className = isOnline ? 'status-online' : 'status-offline';
  }
  console.log(`UI Sync Status: Online: ${isOnline} - ${message}`);
  updateSyncButtonState(); // Update button state whenever status changes
}

// --- Sync Button State ---
function updateSyncButtonState() {
  const syncButton = document.getElementById('manual-sync-btn');
  if (syncButton) {
    syncButton.disabled = !navigator.onLine;
    syncButton.textContent = navigator.onLine ? 'Sync Now' : 'Offline';
  }
}

// This function will be called after Dexie is ready
function initializeAppUI() {
  console.log("DB is ready. Initializing UI.");
  db.on('ready', () => {
    console.log("DB is ready. Automatic initial sync disabled.");
  });

  // Initialize UI based on current online status
  if (navigator.onLine) {
    updateSyncStatusUI(true, 'Online.');
  } else {
    updateSyncStatusUI(false, 'Offline. Entries will be queued.');
  }

  // Logic moved from index.html's DOMContentLoaded
  const dateInput = document.getElementById('entry-date'); // Assuming dateInput is globally accessible or passed
  loadEntriesForDate(dateInput.value); // Load for today's date
  updateSyncButtonState(); // Initial state for sync button
}
