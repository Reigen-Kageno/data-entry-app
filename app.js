// c:\Users\DIA\Documents\soeco\data entry app\app.js

// Global constants
const RESOURCES = ['Gasoil', 'HuileMoteur', 'HuileHydraulique', 'HuileLubrification', 'HuileBoite', 'HuilePont', 'HuileDirection']; 
const ZONES = ['Concassage', 'Extraction', 'Autres', 'BTC']; 

// 1. Define the database
const db = new Dexie("BasaltDataEntryDB");

// --- Module-scoped UI elements and shared data ---
// These variables will be assigned their DOM elements or initial values within initializeAppUI
// and will be accessible by all functions within this module.
let dateInput;
let machineList;
let machinesContainer;
let addMachineBtn;
let resourceStockCardsContainer;
let entryForm;
let saveBtn;
let editBtn;
let generalNotesInput;
let syncStatusElement;
let machineOptions = []; // This array holds the machine options for datalists
let dailyStockCheckOverrides = {}; // Stores stock check overrides for the current date
const selectedMachines = new Set(); // Tracks selected machines for the current date
const machineResourceSets = new Map(); // Map of machine elements to their selected resources

// 2. Define the schema (tables and their indexes)
// Bump the version number when schema changes
db.version(13).stores({
  formEntries: '++id, date, syncStatus, machine, zoneActivite, resource, quantity, compteurMoteurDebut, compteurMoteurFin, sharepointId, notes',
  stockChecks: '[resourceName+date], resourceName, date, quantityOnHand, syncStatus, sharepointId',
  machines: '++id, sharepointId, displayName, idMachine, location, machineType, active'
}).upgrade(async (tx) => {
  console.log("Upgrading to database version 13");
  try {
    // Get all records that need syncStatus conversion
    const stockChecks = await tx.table('stockChecks').toArray();
    
    // Clear and re-create stockChecks with new schema
    await tx.table('stockChecks').clear();
    
    // Convert and reinsert records with numeric syncStatus
    for (const check of stockChecks) {
      try {
        const { synced, ...rest } = check;
        await tx.table('stockChecks').add({
          ...rest,
          syncStatus: synced ? 1 : 0
        });
      } catch (err) {
        console.error('Error converting stockCheck record:', check, err);
      }
    }

    console.log(`Converted ${stockChecks.length} stock check records`);
  } catch (error) {
    console.error('Error during database upgrade:', error);
    throw error;
  }


});

import MasterDataManager from './masterData.js';
import { getToken, setAuthSuccessCallback, msalInstance } from './auth.js';
import config from './config.global.js';

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
    document.getElementById('syncStatus').textContent = 'Initializing application...';

    await db.open();
    console.log("✅ Dexie DB open and migrated to latest version");

    // Initialize master data (which handles auth and fetches from SharePoint)
    await masterData.initialize();
    console.log("Master data initialized");

    // Initialize the UI with the data
    initializeAppUI();
    console.log("Initial UI setup complete");

    // Set up the manual sync button
    document.getElementById('manual-sync-btn').addEventListener('click', () => syncQueuedEntries(true, true));

  } catch (err) {
    console.error("Fatal error during application startup:", err);
    // Display a user-friendly error message on the screen
    document.body.innerHTML = `<h1>Error</h1><p>Could not start the application. Please check the console for details.</p><p>${err.message}</p>`;
  }
}

// --- Basic CRUD Operations ---

// Example: Function to add a new form entry
async function addFormEntry(entryData) {
  try {
    // entryData should be an object representing a row in your target format
    // Add syncStatus if not present (0 = not synced, 1 = synced)
    const dataToAdd = {
      ...entryData,
      syncStatus: 0
    };
    delete dataToAdd.status; // Remove old status field if present
    
    const id = await db.formEntries.add(dataToAdd);
    console.log(`Form entry added with id ${id}`);
    return id;
  } catch (error) {
    console.error("Error adding form entry:", error);
  }
}

// Example: Function to get all unsynced form entries
async function getQueuedEntries() {
  try {
    const entries = await db.formEntries.where('syncStatus').equals(0).toArray();
    console.log("Queued entries:", entries);
    return entries;
  } catch (error) {
    console.error("Error fetching queued entries:", error);
    return [];
  }
}

// Example: Function to update an entry's sync status
async function updateEntryStatus(id, isSynced) {
  try {
    const count = await db.formEntries.update(id, { syncStatus: isSynced ? 1 : 0 });
    if (count) {
      console.log(`Entry ${id} status updated to ${isSynced ? 1 : 0}`);
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
    await db.stockChecks.put({
      ...stockCheckData,
      syncStatus: 0    // 0 = not synced, 1 = synced
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

// --- Sync Logic ---
async function syncQueuedEntries(showStatus = true, manualTrigger = false) {
    if (!navigator.onLine) {
        console.log("Offline. Sync deferred.");
        updateSyncStatusUI(false, 'Offline. Entries are queued.');
        return;
    }

    try {
    let token = await getToken();
    if (!token) {
      console.error("Failed to acquire authentication token");
      updateSyncStatusUI(true, 'Authentication failed. Please try again.');
      return;
    }

    console.log("Online. Attempting to sync entries...");
    if (showStatus) updateSyncStatusUI(true, manualTrigger ? 'Manual Sync: Syncing...' : 'Syncing...');
    
    let queuedEntries = [];
    let queuedStockChecks = [];

    // Get all unsynced entries and stock checks
    queuedEntries = await getQueuedEntries();
    queuedStockChecks = await db.stockChecks.where('syncStatus').equals(0).toArray();

    if (queuedEntries.length === 0 && queuedStockChecks.length === 0) {
      console.log(manualTrigger ? "Manual Sync: No data to sync." : "No data to sync.");
      if (showStatus) updateSyncStatusUI(true, 'All data already synced.');
      return;
    }

    // Sync form entries
    for (const entry of queuedEntries) {
      try {
         const endpoint = `https://graph.microsoft.com/v1.0/sites/${config.sharePoint.siteId}/lists/${config.sharePoint.lists.formEntries}/items`;
        const payload = {
          fields: {
            Title: `${entry.machine}-${entry.date}`,
            Date: `${entry.date}T00:00:00Z`, // Use ISO 8601 with time for SharePoint
            Machine: String(entry.machine),
            Zoneactivit_x00e9_: String(entry.zoneActivite), // Corrected field name for SharePoint
            Resource: String(entry.resource),
            Quantity: String(entry.quantity),
            CompteurMoteurDebut: String(entry.compteurMoteurDebut || 0),
            CompteurMoteurFin: String(entry.compteurMoteurFin || 0),
            Commentaire: String(entry.notes || '')
          }
        };

        // If we have a SharePoint ID, update existing item
        if (entry.sharepointId) {
          const response = await fetch(`${endpoint}/${entry.sharepointId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });

          if (response.ok) {
            await updateEntryStatus(entry.id, true);
          }
        } else {
          // Create new item
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });

          if (response.ok) {
            const data = await response.json();
            // Update local entry with SharePoint ID and mark as synced
            await db.formEntries.update(entry.id, {
              sharepointId: data.id,
              syncStatus: 1
            });
          }
        }
      } catch (error) {
        console.error(`Failed to sync entry ${entry.id}:`, error);
      }
    }

    // Sync stock checks
    for (const check of queuedStockChecks) {
      try {
        const endpoint = `https://graph.microsoft.com/v1.0/sites/${config.sharePoint.siteId}/lists/${config.sharePoint.lists.stockChecks}/items`;
        const payload = {
          fields: {
            Title: `${check.resourceName}-${check.date}`,
            Date: `${check.date}T00:00:00Z`,
            ResourceName: String(check.resourceName),
            QuantityOnHand: String(check.quantityOnHand)
          }
        };

        if (check.sharepointId) {
          const response = await fetch(`${endpoint}/${check.sharepointId}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });

          if (response.ok) {
            await db.stockChecks.update(
              [check.resourceName, check.date],
              { syncStatus: 1 }
            );
          }
        } else {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
          });

          if (response.ok) {
            const data = await response.json();
            await db.stockChecks.update(
              [check.resourceName, check.date],
              {
                sharepointId: data.id,
                syncStatus: 1
              }
            );
          }
        }
      } catch (error) {
        console.error(`Failed to sync stock check ${check.resourceName}-${check.date}:`, error);
      }
    }

    // Final status update
    const remainingEntries = await getQueuedEntries();
    const remainingStockChecks = await db.stockChecks.where('syncStatus').equals(0).toArray();
    
    if (remainingEntries.length > 0 || remainingStockChecks.length > 0) {
      const msg = `Sync attempted. ${remainingEntries.length} entries and ${remainingStockChecks.length} stock checks still queued.`;
      console.log(msg);
      updateSyncStatusUI(true, msg);
    } else {
      console.log(manualTrigger ? "Manual Sync: All data synced." : "All data synced.");
      updateSyncStatusUI(true, 'Sync complete. All data synced.');
    }

  } catch (error) {
    console.error('Network or other sync error:', error);
    if (showStatus) updateSyncStatusUI(true, `Sync failed: ${error.message}`);
    return;
  }
}

// --- Event Listeners for Online/Offline Status ---
// window.addEventListener('online', syncQueuedEntries); // Removed automatic sync on online event

window.addEventListener('offline', () => {
    console.log("Application is now offline.");
    updateSyncStatusUI(false, 'Offline. Entries will be queued.', false); // Pass false for isOnline
    updateSyncButtonState(); // Update button state
});

// Handle when app comes back online
window.addEventListener('online', () => {
    console.log("Application is now online.");
    updateSyncStatusUI(true, 'Online. Ready to sync.', true);
    updateSyncButtonState();
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

// Initialize App UI
function initializeAppUI() {
    console.log("DB is ready. Initializing UI.");
    
    // --- DOM Element Selections (assign to module-scoped variables) ---
    dateInput = document.getElementById('entry-date');
    machineList = document.getElementById('machine-list');
    machinesContainer = document.getElementById('machines-container');
    addMachineBtn = document.getElementById('add-machine');
    resourceStockCardsContainer = document.getElementById('resource-stock-cards-container');
    entryForm = document.getElementById('entry-form');
    saveBtn = document.getElementById('save-entries-btn');
    editBtn = document.getElementById('edit-entries-btn');
    generalNotesInput = document.getElementById('general-notes');
    syncStatusElement = document.getElementById('syncStatus');
    
    const DEFAULT_FALLBACK_MACHINES = ['EXC-300', 'BULL-24', 'CRANE-12'];
    async function loadMachineOptions() {
        try {
            console.log('Loading active machines from MasterData...');
            // Get machines from MasterDataManager (which holds cached/refreshed list)
            const allMasterDataMachines = masterData.getMachines(false); // Get all, active or not
            const activeMasterDataMachines = masterData.getMachines(true); // Get only active

            console.log('Total machines from MasterData:', allMasterDataMachines.length);
            console.log('Active machines from MasterData:', activeMasterDataMachines.length);
             // Use idMachine for the dropdown values, as this is used for lookups
            if (activeMasterDataMachines.length > 0) {
                machineOptions = activeMasterDataMachines.map(m => m.idMachine);
            } else if (allMasterDataMachines.length > 0) {
                console.warn('No active machines found in MasterData, using all machines for options.');
                machineOptions = allMasterDataMachines.map(m => m.idMachine);
            } else {
                console.warn('No machines found in MasterData. Falling back to default options.');
                machineOptions = [...DEFAULT_FALLBACK_MACHINES];
            }
            // Always add Livraison option
            if (!machineOptions.includes('Livraison')) {
                machineOptions.push('Livraison');
            }
            
            console.log('Final machine options for datalist:', machineOptions);
            updateMachineDatalist();
            return activeMasterDataMachines.length > 0 ? activeMasterDataMachines : allMasterDataMachines;
        } catch (error) {
            console.error('Failed to load machines from MasterData (or error in try block):', error);
            // Attempt to use masterData.machines directly if masterData.getMachines() failed 
            // but masterData object and its cache exist
            if (masterData && masterData.machines && masterData.machines.length > 0) {
                console.warn('Falling back to masterData.machines internal cache due to error.');
                const allCachedMachines = masterData.machines; // Already an array of machine objects
                const activeCachedMachines = allCachedMachines.filter(m => m.active === 1);
                if (activeCachedMachines.length > 0) {
                    machineOptions = activeCachedMachines.map(m => m.idMachine);
                } else { // If no active, use all from the internal cache
                    machineOptions = allCachedMachines.map(m => m.idMachine);
                }
            } else {
                // Ultimate fallback to hardcoded values if masterData or its cache is unavailable
                console.warn('MasterData or its cache unavailable. Falling back to hardcoded machine options.');
                machineOptions = [...DEFAULT_FALLBACK_MACHINES];
            }
            if (!machineOptions.includes('Livraison')) {
                machineOptions.push('Livraison');
            }
            updateMachineDatalist();
            return [];
        }
    }

    // Initial machine list load. `masterData.initialize()` has already run, loaded from cache,
    // and attempted a single refresh from SharePoint if the app was online at startup.
    // Now, we just need to populate the UI with the data that masterData has prepared.
    console.log('initializeAppUI: Populating machine options from masterData.');
    // loadMachineOptions will populate the UI based on masterData's current state.
    loadMachineOptions(); 

    // --- Original initializeAppUI code continues below ---
    // --- Helper Function Definitions (moved from inline script) ---
    function addMachineSection() {
        const clone = document.getElementById('machine-template').content.cloneNode(true);
        const section = clone.querySelector('.machine-section');
        const machineInput = section.querySelector('input[name="machine"]');
        const machineDisplayName = section.querySelector('input[name="machine-display-name"]');
        const zoneSelect = section.querySelector('select[name="zone-activite"]');

        // Populate zone dropdown
        ZONES.forEach(zone => {
            const option = document.createElement('option');
            option.value = zone;
            option.textContent = zone;
            zoneSelect.appendChild(option);
        });        // Setup machine input filtering and validation
        machineInput.addEventListener('input', () => {
            const value = machineInput.value.trim();
            // Clear custom validity on input to allow real-time feedback
            machineInput.setCustomValidity(''); 

            // Basic pattern validation on input (optional, can be moved to change event)
            const machinePattern = /^[A-Za-z0-9-]+$/;
            if (value && !machinePattern.test(value) && value !== 'Livraison') {
                machineInput.setCustomValidity('Veuillez entrer un ID de machine valide (alphanumérique et tirets uniquement).');
            }
            if (value) {
                const matchingMachines = machineOptions.filter(m => 
                    m && m.toLowerCase().startsWith(value.toLowerCase())
                );
                console.log('Matching machines:', matchingMachines);
            }
        });

        // Handle machine selection
        machineInput.addEventListener('change', async () => {
            const newMachineName = machineInput.value.trim();

              // Full pattern validation on change
            const machinePattern = /^[A-Za-z0-9-]+$/;
            if (!machinePattern.test(newMachineName) && newMachineName !== 'Livraison') {
                machineInput.setCustomValidity('Veuillez entrer un ID de machine valide (alphanumérique et tirets uniquement).');
                machineInput.value = '';
                machineDisplayName.value = '';
                return;
            }
            
            // Validate the machine name is from our list
            const isValidMachine = newMachineName === 'Livraison' || 
                                 machineOptions.includes(newMachineName);
            
            if (!isValidMachine) {
                machineInput.setCustomValidity('Veuillez sélectionner une machine de la liste');
                machineInput.value = '';
                machineDisplayName.value = '';
                return;
            }
            
            if (selectedMachines.has(newMachineName)) {
                machineInput.setCustomValidity('Cette machine a déjà été ajoutée pour aujourd\'hui');
                alert('Cette machine a déjà été ajoutée pour aujourd\'hui.');
                machineInput.value = '';
                machineDisplayName.value = '';
                return;
            } else {
                machineInput.setCustomValidity('');
            }

            // Look up machine display name
            if (newMachineName && newMachineName !== 'Livraison') {
                const machine = await db.machines
                    .where('idMachine')
                    .equals(newMachineName)
                    .first();
                
                if (machine) {
                    machineDisplayName.value = machine.displayName || machine.idMachine;
                } else {
                    machineDisplayName.value = newMachineName;
                }
            } else if (newMachineName === 'Livraison') {
                machineDisplayName.value = 'Livraison';
            } else {
                machineDisplayName.value = '';
            }

            trackMachineSelection(section, newMachineName);
        });

        // Setup resource addition
        section.querySelector('.add-resource').onclick = () => addResourceRow(section);

        // Setup machine section removal
        const removeBtn = document.createElement('button');
        removeBtn.textContent = '✕ Remove Machine';
        removeBtn.className = 'btn small';
        removeBtn.style.float = 'right';
        removeBtn.onclick = () => {
            untrackMachine(section);
            section.remove();
        };
        section.insertBefore(removeBtn, section.firstChild);

        machinesContainer.appendChild(section);
        return section;
    }

    function addResourceRow(section) {
        const clone = document.getElementById('resource-template').content.cloneNode(true);
        const row = clone.querySelector('.resource-row');
        const select = row.querySelector('select[name="resource"]');

        // Populate select with available resources
        updateResourceSelect(select, section);

        // Handle resource selection
        select.addEventListener('change', () => {
            trackResourceSelection(section, select.value);
            updateResourceSelect(select, section);
        });

        // Handle resource removal
        row.querySelector('.remove-resource').onclick = () => {
            untrackResource(section, row);
            row.remove();
            // Update other resource selects in this machine section
            section.querySelectorAll('select[name="resource"]').forEach(s => {
                updateResourceSelect(s, section);
            });
        };

        section.querySelector('.resources-container').appendChild(row);
        return row;
    }

    function setFormEditable(isEditable) {
        // First check if any entries are already synced
        const currentDate = document.getElementById('entry-date').value;
          getEntriesByDate(currentDate).then(async entries => {
            const hasSyncedEntries = entries.some(entry => entry.syncStatus === 1);
            
            // Check if any resources have synced stock checks

            document.querySelectorAll('#entry-form input, #entry-form select, #entry-form textarea, #general-notes')
                .forEach(el => {
                    if (el.id === 'entry-date') {
                        el.readOnly = false;
                        el.disabled = false;
                    } else {
                        el.readOnly = !isEditable;
                        el.disabled = !isEditable;
                    }
                });
                document.querySelectorAll('.stock-card').forEach(card => {
                    isEditable ? card.classList.remove('disabled') : card.classList.add('disabled');
                });
                document.querySelectorAll('.add-resource, .remove-resource, .remove-delivery').forEach(btn => {
                    btn.style.display = isEditable ? '' : 'none';
                });
                addMachineBtn.style.display = isEditable ? '' : 'none';
                saveBtn.style.display = isEditable ? '' : 'none';
                saveBtn.textContent = isEditable ? (editBtn.style.display === 'none' ? 'Save All Entries' : 'Update Entries') : 'Save All Entries';
                editBtn.style.display = isEditable ? 'none' : '';
                updateSyncButtonState();
                
                // Always re-enable the date picker
                const dateInput = document.getElementById('entry-date');
                if (dateInput) {
                    dateInput.readOnly = false;
                    dateInput.disabled = false;
                    dateInput.classList.remove('disabled');
                }
            }); 
        } 

    const updateCardStockDisplay = async function(resourceName, forDate) {
        const cardElement = resourceStockCardsContainer.querySelector(`.stock-card[data-resource="${resourceName}"]`);
        if (!cardElement) return;

        let baseStockQty = 0;
        if (dailyStockCheckOverrides[forDate] && dailyStockCheckOverrides[forDate][resourceName] !== undefined) {
            baseStockQty = dailyStockCheckOverrides[forDate][resourceName];
        } else {
            // First check if there's a measured stock for today
            const todayStockCheck = await db.stockChecks.get([resourceName, forDate]);
            if (todayStockCheck) {
                baseStockQty = todayStockCheck.quantityOnHand;
                if (!dailyStockCheckOverrides[forDate]) dailyStockCheckOverrides[forDate] = {};
                dailyStockCheckOverrides[forDate][resourceName] = baseStockQty;
            } else {
                // If no measured stock today, calculate from previous day's final stock
                const previousDate = new Date(forDate);
                previousDate.setDate(previousDate.getDate() - 1);
                const prevDateStr = previousDate.toISOString().split('T')[0];
                
                // Get previous day's measured stock (if any)
                const prevDayStockCheck = await db.stockChecks.get([resourceName, prevDateStr]);
                
                // Get previous day's transactions to calculate ending stock
                const prevDayEntries = await getEntriesByDate(prevDateStr);
                let prevDayNet = 0;
                
                prevDayEntries.forEach(entry => {
                    if (entry.resource === resourceName) {
                        if (entry.machine.toLowerCase().startsWith('livraison')) {
                            prevDayNet += entry.quantity;
                        } else {
                            prevDayNet -= entry.quantity;
                        }
                    }
                });

                if (prevDayStockCheck) {
                    // If we had a measured stock yesterday, use it as base and apply yesterday's movements
                    baseStockQty = prevDayStockCheck.quantityOnHand + prevDayNet;
                } else {
                    // If no measured stock yesterday, look for most recent check and apply all movements since then
                    const recentCheck = await getMostRecentStockCheck(resourceName, forDate);
                    if (recentCheck) {
                        baseStockQty = recentCheck.quantityOnHand;
                        // Calculate all movements since that check
                        const movements = await calculateMovementsSinceDate(resourceName, recentCheck.date, forDate);
                        baseStockQty += movements;
                    }
                }
            }
        }

        const formEntriesToday = await getEntriesByDate(forDate);
        let sumDeliveriesToday = 0;
        let sumUsagesToday = 0;
        formEntriesToday.forEach(entry => {
            if (entry.resource === resourceName) {
                if (entry.machine.toLowerCase().startsWith('livraison')) {
                    sumDeliveriesToday += entry.quantity;
                } else {
                    sumUsagesToday += entry.quantity;
                }
            }
        });

        let netMovementToday = sumDeliveriesToday - sumUsagesToday;
        const displayStock = (dailyStockCheckOverrides[forDate] && dailyStockCheckOverrides[forDate][resourceName] !== undefined)
            ? dailyStockCheckOverrides[forDate][resourceName] + netMovementSinceLastCheck(resourceName, forDate, formEntriesToday, dailyStockCheckOverrides[forDate][resourceName])
            : baseStockQty + netMovementToday;

        const stockValueEl = cardElement.querySelector('.stock-value');
        if (stockValueEl) stockValueEl.textContent = `Stock: ${displayStock.toFixed(1)}`;

        const measuredDisplayEl = cardElement.querySelector('.measured-stock-display');
        if (measuredDisplayEl) {
            const todayMeasured = dailyStockCheckOverrides[forDate] && dailyStockCheckOverrides[forDate][resourceName] !== undefined
                ? dailyStockCheckOverrides[forDate][resourceName] : 'N/A';
            measuredDisplayEl.textContent = `Measured: ${todayMeasured}`;
        }

        const deltaEl = cardElement.querySelector('.stock-delta');
        if (deltaEl) deltaEl.textContent = `Δ Today: +${sumDeliveriesToday.toFixed(1)} | -${sumUsagesToday.toFixed(1)}`;
    }

    async function handleSaveStockCheck(resourceName, cardElement, quantityOnHand) {
        const forDate = dateInput.value;
        if (isNaN(quantityOnHand)) return;

        // Fetch the existing record to preserve its sharepointId
        const existingCheck = await db.stockChecks.get([resourceName, forDate]);

        const stockCheckData = {
            resourceName: resourceName,
            date: forDate,
            quantityOnHand: quantityOnHand,
            syncStatus: 0, // Mark as unsynced for the next sync operation
            sharepointId: existingCheck ? existingCheck.sharepointId : undefined
        };

        await saveStockCheck(stockCheckData);
        if (!dailyStockCheckOverrides[forDate]) dailyStockCheckOverrides[forDate] = {};
        dailyStockCheckOverrides[forDate][resourceName] = quantityOnHand;

        await updateCardStockDisplay(resourceName, forDate);
        alert(`Stock check for ${resourceName} on ${forDate} saved: ${quantityOnHand}.`);
    }

    function promptForMeasuredStock(resourceName, cardElement) {
        const forDate = dateInput.value;
        let currentMeasured = (dailyStockCheckOverrides[forDate] && dailyStockCheckOverrides[forDate][resourceName] !== undefined)
            ? dailyStockCheckOverrides[forDate][resourceName]
            : '';
        const measuredStockStr = prompt(`Enter measured stock for ${resourceName} on ${forDate}:`, currentMeasured);

        if (measuredStockStr === null) return;

        const quantityOnHand = parseFloat(measuredStockStr);
        if (isNaN(quantityOnHand)) {
            alert('Please enter a valid number for measured stock.');
            return;
        }        // Use the compound key for the update
        handleSaveStockCheck(resourceName, cardElement, quantityOnHand);
    }

    async function loadEntriesForDate(dateString) {
        console.log(`Loading entries for date: ${dateString}`);
        if(syncStatusElement) syncStatusElement.textContent = `Loading entries for ${dateString}...`;
        
        clearAllFormEntries(); // This will also call updateCardStockDisplay for all resources
        clearTrackingSets(); // Reset our duplicate tracking system
        if (!dailyStockCheckOverrides[dateString]) dailyStockCheckOverrides[dateString] = {};

        const entries = await getEntriesByDate(dateString);

        if (entries && entries.length > 0) {
          const uiMachineSections = new Map(); // Use a map to track UI sections for each machine
            if(syncStatusElement) syncStatusElement.textContent = `Displaying ${entries.length} saved entries for ${dateString}.`;
            let notesLoaded = false;
            entries.forEach(entry => {
                let machineSection = uiMachineSections.get(entry.machine);
                if (!machineSection) {
                    machineSection = addMachineSection();
                    uiMachineSections.set(entry.machine, machineSection);
                    const machineInput = machineSection.querySelector('input[name="machine"]');
                    machineInput.value = entry.machine;
                    trackMachineSelection(machineSection, entry.machine);
                    
                    // Set zone activité if it exists
                    const zoneSelect = machineSection.querySelector('select[name="zone-activite"]');
                    if (zoneSelect && entry.zoneActivite) {
                        zoneSelect.value = entry.zoneActivite;
                    }
                    
                    // Set notes if they exist
                    if (entry.notes && machineSection.querySelector('textarea[name="machine-notes"]')) {
                        machineSection.querySelector('textarea[name="machine-notes"]').value = entry.notes;
                    }
                    
                    // Set machine display name
                    const machineDisplayName = machineSection.querySelector('input[name="machine-display-name"]');
                    if (machineDisplayName) {
                        if (entry.machine === 'Livraison') {
                            machineDisplayName.value = 'Livraison';
                        } else {
                             const machineData = masterData.findMachineByIdMachine(entry.machine);
                            if (machineData) {
                                machineDisplayName.value = machineData.displayName || machineData.idMachine;
                            } else {
                                machineDisplayName.value = entry.machine;
                            }
                        }
                    }
                    
                    // Set mileage readings if they exist
                    const compteurDebutInput = machineSection.querySelector('input[name="compteurMoteurDebut"]');
                    const compteurFinInput = machineSection.querySelector('input[name="compteurMoteurFin"]');
                    if (compteurDebutInput && entry.compteurMoteurDebut !== undefined) {
                        compteurDebutInput.value = entry.compteurMoteurDebut;
                    }
                    if (compteurFinInput && entry.compteurMoteurFin !== undefined) {
                        compteurFinInput.value = entry.compteurMoteurFin;
                    }
                }
                const resourceRow = addResourceRow(machineSection);
                const resourceSelect = resourceRow.querySelector('select[name="resource"]');
                
                // Track this resource before setting its value
                trackResourceSelection(machineSection, entry.resource);
                
                // Update the select with available options and set its value
                updateResourceSelect(resourceSelect, machineSection);
                resourceSelect.value = entry.resource;
                
                // Set quantity and add event listener
                resourceRow.querySelector('input[name="quantity"]').value = entry.quantity;
                resourceRow.querySelector('input[name="quantity"]').addEventListener('input', () => {
                    updateCardStockDisplay(entry.resource, dateString);
                });
                if (!notesLoaded && entry.notes && generalNotesInput) {
                    generalNotesInput.value = entry.notes;
                    notesLoaded = true;
                }
            });
            setFormEditable(false);
            saveBtn.textContent = 'Save All Entries';
        } else {
            if(syncStatusElement) syncStatusElement.textContent = `Pas de données pour ${dateString}. Prêt pour une nouvelle saisie.`;
            addMachineSection();
            setFormEditable(true);
            saveBtn.textContent = 'Save All Entries';
        }

        // After populating form or setting to new entry mode, update all card stock displays
        // This is now partly handled by clearAllFormEntries, but a final pass ensures consistency.
        for (const resource of RESOURCES) {
            await updateCardStockDisplay(resource, dateString);
        }
    }

    function clearAllFormEntries() {
        machinesContainer.innerHTML = '';
        if (generalNotesInput) generalNotesInput.value = '';
        // When clearing form, also update stock display as net movements from form are now 0
        // This needs to be async if updateCardStockDisplay is async
        const currentDate = dateInput.value;
        RESOURCES.forEach(r => {
            updateCardStockDisplay(r, currentDate); // This is async, but forEach won't wait.
                                                    // For UI updates, this might be fine. If strict order needed, use for...of with await.
        });
    }

    function netMovementSinceLastCheck(resourceName, forDate, formEntriesToday, lastCheckQty) {
        let net = 0;
        formEntriesToday.forEach(entry => {
            if (entry.resource === resourceName) {
                net += (entry.machine.toLowerCase().startsWith('livraison') ? entry.quantity : -entry.quantity);
            }
        });
        return net;
    }

    async function calculateMovementsSinceDate(resourceName, startDate, endDate) {
        let totalNet = 0;
        const entries = await db.formEntries
            .where('date')
            .between(startDate, endDate)
            .and(entry => entry.resource === resourceName)
            .toArray();

        entries.forEach(entry => {
            if (entry.machine.toLowerCase().startsWith('livraison')) {
                totalNet += entry.quantity;
            } else {
                totalNet -= entry.quantity;
            }
        });

        return totalNet;
    }    // --- Duplicate Prevention System ---

    
    function getAvailableMachines() {
        return machineOptions.filter(m => !selectedMachines.has(m));
    }    function getAvailableResourcesForMachine(machineSection) {
        // Get or create the resource set for this machine section
        let resourceSet = machineResourceSets.get(machineSection);
        if (!resourceSet) {
            resourceSet = new Set();
            machineResourceSets.set(machineSection, resourceSet);
        }
        
        // Build set of currently selected resources in this machine section
        const selectedResources = new Set();
        const existingSelects = machineSection.querySelectorAll('select[name="resource"]');
        existingSelects.forEach(select => {
            if (select.value) selectedResources.add(select.value);
        });
        
        // Update the tracked set with current selections
        resourceSet.clear();
        selectedResources.forEach(r => resourceSet.add(r));
        
        // Return resources that aren't currently selected in this machine
        return RESOURCES.filter(r => !selectedResources.has(r));
    }

    function updateMachineDatalist() {
        // Clear and repopulate the datalist with available machines
        machineList.innerHTML = '';
        getAvailableMachines().forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            machineList.appendChild(opt);
        });
    }

    function updateResourceSelect(select, machineSection) {
        const currentValue = select.value;
        select.innerHTML = ''; // Clear existing options
        
        // Add available resources as options
        getAvailableResourcesForMachine(machineSection).forEach(r => {
            const opt = document.createElement('option');
            opt.value = r;
            opt.textContent = r;
            select.appendChild(opt);
        });

        // If the current value is still valid, keep it selected
        if (currentValue && getAvailableResourcesForMachine(machineSection).includes(currentValue)) {
            select.value = currentValue;
        }
    }

    function trackMachineSelection(machineSection, machineName) {
        if (machineName && !selectedMachines.has(machineName)) {
            selectedMachines.add(machineName);
            if (!machineResourceSets.has(machineSection)) {
                machineResourceSets.set(machineSection, new Set());
            }
            updateMachineDatalist();
        }
    }    function trackResourceSelection(machineSection, resourceName) {
        let resourceSet = machineResourceSets.get(machineSection);
        if (!resourceSet) {
            resourceSet = new Set();
            machineResourceSets.set(machineSection, resourceSet);
        }
        
        // Update resourceSet to accurately reflect current selections
        const currentSelections = new Set();
        const existingSelects = machineSection.querySelectorAll('select[name="resource"]');
        existingSelects.forEach(select => {
            if (select.value && select.value !== resourceName) {
                currentSelections.add(select.value);
            }
        });
        
        // Add the new selection if provided
        if (resourceName) {
            currentSelections.add(resourceName);
        }
        
        // Update the tracked set
        resourceSet.clear();
        currentSelections.forEach(r => resourceSet.add(r));
    }    function untrackMachine(machineSection) {
        const machineName = machineSection.querySelector('input[name="machine"]').value;
        if (machineName) {
            console.log('Untracking machine:', machineName);
            selectedMachines.delete(machineName);
            machineResourceSets.delete(machineSection);
            updateMachineDatalist();
        }
    }function untrackResource(machineSection, resourceRow) {
        const resourceName = resourceRow.querySelector('select[name="resource"]').value;
        const resourceSet = machineResourceSets.get(machineSection);
        if (resourceSet) {
            resourceSet.delete(resourceName);
        }
    }

    // Clear tracking data when changing dates
    function clearTrackingSets() {
        selectedMachines.clear();
        machineResourceSets.clear();
        updateMachineDatalist();
    }

    // --- Initial Setup and Event Listeners ---

    // Make sure dateInput exists before using it
    if (dateInput) {
        // Prepopulate date
        dateInput.valueAsDate = new Date();
    } else {
        console.error('Date input element not found');
    }    // Populate machine datalist if it exists
    if (machineList && Array.isArray(machineOptions)) {
        machineOptions.forEach(m => {
            if (m) {  // Only add if machine name is valid
                const opt = document.createElement('option');
                opt.value = m;
                machineList.appendChild(opt);
            }
        });
    } else {
        console.error('Machine list element or options not properly initialized');
    }

    // Setup machines
    addMachineBtn.onclick = addMachineSection;

    // Resource Stock Cards Setup
    RESOURCES.forEach(r => {
        const card = document.createElement('div');
        card.className = 'stock-card';
        card.dataset.resource = r;
        card.innerHTML = `
            <span class="resource-name">${r}</span> 
            <div class="stock-value">Stock: N/A</div>
            <div class="stock-delta">Δ Today: +0 | -0</div>
            <div class="measured-stock-display">Measured: N/A</div>
        `;
        card.querySelector('.resource-name').addEventListener('click', () => {
            const isInEditableMode = editBtn.style.display === 'none';
            if (isInEditableMode && !card.classList.contains('disabled')) {
                promptForMeasuredStock(r, card);
            } else {
                 console.log(`Not prompting for ${r}. isInEditableMode (editBtn hidden): ${isInEditableMode}, card.disabled: ${card.classList.contains('disabled')}`);
            }
        });
        resourceStockCardsContainer.appendChild(card);
    });


    // Edit Button Click Listener
    editBtn.addEventListener('click', async () => {
        const currentDate = dateInput.value;
        // Check if any data for this date has already been synced
        const formEntries = await getEntriesByDate(currentDate);
        const stockChecks = await db.stockChecks.where({ date: currentDate }).toArray();
        const hasSyncedData = formEntries.some(e => e.syncStatus === 1) || stockChecks.some(s => s.syncStatus === 1);

        if (hasSyncedData) {
            if (!confirm('Données déjà synchronisées. Êtes-vous sûr de vouloir les modifier ?')) {
                return; // User cancelled, do nothing.
            }
        }

        // Proceed with making the form editable
        setFormEditable(true);
        saveBtn.textContent = 'Update Entries';
        if (syncStatusElement) syncStatusElement.textContent = 'Form is now editable for update.';
    });

    // Form Submit Handler
    entryForm.addEventListener('submit', async e => {
        e.preventDefault();
        const entryDateValue = dateInput.value;
        const generalNotes = generalNotesInput.value || '';
        let entriesProcessedCount = 0;

        // 1. Fetch existing entries for the current date to compare against
        const existingEntries = await getEntriesByDate(entryDateValue);
        const existingEntryMap = new Map(existingEntries.map(e => [`${e.machine}-${e.resource}`, e]));
        const entriesToKeep = new Set(); // To track which existing entries are still valid

        const machineSections = machinesContainer.querySelectorAll('.machine-section');
        for (const section of machineSections) {
            const machineName = section.querySelector('input[name="machine"]').value;
            const zoneActivite = section.querySelector('select[name="zone-activite"]').value;
            const machineNotes = section.querySelector('textarea[name="machine-notes"]')?.value || '';
            const resourceRows = section.querySelectorAll('.resource-row');

            const compteurDebut = parseFloat(section.querySelector('input[name="compteurMoteurDebut"]')?.value || '0');
            const compteurFin = parseFloat(section.querySelector('input[name="compteurMoteurFin"]')?.value || '0');

            for (const row of resourceRows) {
                const resource = row.querySelector('select[name="resource"]').value;
                const quantity = parseFloat(row.querySelector('input[name="quantity"]').value);

                if (isNaN(quantity) || quantity <= 0 || !machineName || !resource) {
                    continue;
                }

                const newEntryData = { date: entryDateValue, machine: machineName, zoneActivite, resource, quantity, compteurMoteurDebut: compteurDebut, compteurMoteurFin: compteurFin, notes: `${generalNotes} ${machineNotes}`.trim() };
                const existingEntry = existingEntryMap.get(`${newEntryData.machine}-${newEntryData.resource}`);

                if (existingEntry) {
                    await db.formEntries.update(existingEntry.id, { ...newEntryData, sharepointId: existingEntry.sharepointId, syncStatus: 0 });
                    entriesToKeep.add(existingEntry.id);
                } else {
                    const newId = await db.formEntries.add({ ...newEntryData, syncStatus: 0 });
                    entriesToKeep.add(newId);
                }
                entriesProcessedCount++;
            }
        }

        for (const oldEntry of existingEntries) {
            if (!entriesToKeep.has(oldEntry.id)) {
                await db.formEntries.delete(oldEntry.id);
            }
        }

        if (syncStatusElement) syncStatusElement.textContent = `${entriesProcessedCount} entries saved/updated locally and queued for sync.`;
        await loadEntriesForDate(entryDateValue);
    });

    // Date Input Change Listener
    dateInput.addEventListener('change', (e) => {
        dailyStockCheckOverrides = {}; // Clear overrides when date changes
        clearTrackingSets(); // Clear tracking sets when changing dates
        loadEntriesForDate(e.target.value);
    });

    // --- Initial UI State ---
    db.on('ready', () => { // This is more of an informational hook if db was already open.
                           // The main gate is db.open().then()
        console.log("DB is ready event fired. Automatic initial sync disabled.");
    });

    if (navigator.onLine) {
        updateSyncStatusUI(true, 'Online.');
    } else {
        updateSyncStatusUI(false, 'Offline. Entries will be queued.');
    }

    loadEntriesForDate(dateInput.value); // Load for today's date
    updateSyncButtonState(); // Initial state for sync button

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => { // Ensure page is loaded before registering SW
            navigator.serviceWorker.register('service-worker.js')
                .then(reg => console.log('Service Worker: Registered', reg))
                .catch(err => console.error('Service Worker: Registration Error', err));
        });
    }
    
}

// --- Application Entry Point ---

// 1. Set the callback that auth.js will trigger after a successful redirect login.
setAuthSuccessCallback(startApp);

// 2. Check the auth state.
// `handleRedirectPromise` is called by auth.js when it's loaded.
// We just need to decide if we should start the app now or wait for the redirect.
if (msalInstance.getAllAccounts().length > 0) {
  // If we already have an account, start the app.
  startApp();
} else if (!window.location.hash.includes('code=')) {
  // If we don't have an account and we are not in a redirect, trigger the login.
  // The app will be started by the callback after the redirect.
  document.getElementById('syncStatus').textContent = 'Redirecting to login...';
  getToken();
}
// If we are in a redirect (hash contains 'code='), auth.js will handle it and call our callback.
