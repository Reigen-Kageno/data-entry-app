// c:\Users\DIA\Documents\soeco\data entry app\app.js

// 1. Define the database
const db = new Dexie("BasaltDataEntryDB");

// 2. Define the schema (tables and their indexes)
// Bump the version number when schema changes
db.version(6).stores({
  formEntries: '++id, date, syncStatus, machine, resource, quantity',
  stockChecks: '[resourceName+date], resourceName, date, quantityOnHand, syncStatus'
}).upgrade(async (tx) => {
  console.log("!!! EXECUTING UPGRADE TO DATABASE VERSION 6 !!!");
  console.log("Converting all sync tracking to numeric syncStatus (0 = not synced, 1 = synced)...");
  
  // Get all records
  const stockChecks = await tx.table('stockChecks').toArray();
  
  // Clear and re-create with new schema
  await tx.table('stockChecks').clear();
  
  // Convert and reinsert records
  for (const check of stockChecks) {
    const { synced, ...rest } = check;
    await tx.table('stockChecks').add({
      ...rest,
      syncStatus: synced ? 1 : 0
    });
  }
});

// Wait for the DB to open (and the upgrade to run) before doing anything else:
db.open()
  .then(() => {
    console.log("✅ Dexie DB open and migrated to latest version");
    console.log("Dexie version:", Dexie.semVer);
    console.log("Dexie supports boolean keys:", typeof Dexie.maxKey === 'undefined' || Dexie.maxKey === true);
    
    console.log("DB Schema as seen by Dexie:", db.tables.map(table => ({
      name: table.name,
      schema: table.schema.indexes.map(idx => ({
        name: idx.name,
        keyPath: idx.keyPath,
        multiEntry: idx.multiEntry,
        unique: idx.unique
      }))
    })));
    // Now it's safe to wire up your sync button:
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
      console.log(`Entry ${id} status updated to ${syncStatus}`);
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
const SYNC_ENDPOINT_URL = window.SYNC_ENDPOINT_URL; // Adjust the import path as needed

async function syncQueuedEntries(showStatus = true, manualTrigger = false) {
  if (!navigator.onLine) {
    console.log("Offline. Sync deferred.");
    // Optionally, update UI to show offline status
    updateSyncStatusUI(false, 'Offline. Entries are queued.');
    return;
  }

  console.log("Online. Attempting to sync entries...");
  if (showStatus) updateSyncStatusUI(true, manualTrigger ? 'Manual Sync: Syncing...' : 'Syncing...');
  let queuedEntries = [];
  let queuedStockChecks = [];

  try {
    // Get all unsynced entries and stock checks
    queuedEntries = await getQueuedEntries();
    queuedStockChecks = await db.stockChecks.where('syncStatus').equals(0).toArray();

    if (queuedEntries.length === 0 && queuedStockChecks.length === 0) {
      console.log(manualTrigger ? "Manual Sync: No data to sync." : "No data to sync.");
      if (showStatus) updateSyncStatusUI(true, 'All data already synced.');
      return;
    }

    console.log(`Found ${queuedEntries.length} entries and ${queuedStockChecks.length} stock checks to sync.`);
    if (showStatus) updateSyncStatusUI(true, `Syncing ${queuedEntries.length} entries and ${queuedStockChecks.length} stock checks...`);

    // Prepare the consolidated payload
    const syncPayload = {
      entries: queuedEntries.map(entry => {
        const { id, status, ...data } = entry;
        return data;
      }),
      stockChecks: queuedStockChecks.map(check => {
        const { syncStatus, ...data } = check;
        return data;
      })
    };

    // Send everything in one request
    const response = await fetch(SYNC_ENDPOINT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(syncPayload),
    });

    let responseData;
    try {
      responseData = await response.json();
    } catch (e) {
      responseData = null;
    }

    if (response.ok) {
      // Update local sync status for all successfully synced items
      for (const entry of queuedEntries) {
        await updateEntryStatus(entry.id, true);
      }

      for (const check of queuedStockChecks) {
        if (check.resourceName && check.date) {
          await db.stockChecks.update(
            [check.resourceName, check.date],
            { syncStatus: 1 }
          );
        }
      }

      console.log('All data synced successfully');
      if (showStatus) updateSyncStatusUI(true, 'Sync completed successfully');

    } else {
      // Handle different error status codes
      let errorMessage = '';
      switch (response.status) {
        case 400:
          errorMessage = 'Invalid data format. Please check your entries.';
          console.error('Sync failed - Invalid data:', responseData?.error || response.statusText);
          break;
        case 401:
          errorMessage = 'Authentication failed. You may need to log in again.';
          console.error('Sync failed - Authentication error:', response.statusText);
          break;
        case 403:
          errorMessage = 'You do not have permission to sync this data.';
          break;
        default:
          errorMessage = `Server error (${response.status}). Please try again later.`;
      }

      if (responseData?.error) {
        errorMessage += ` Details: ${responseData.error}`;
      }

      console.error('Sync error:', errorMessage);
      if (showStatus) updateSyncStatusUI(true, `Sync failed: ${errorMessage}`);
      return; // Exit on error
    }

  } catch (error) {
    console.error('Network or other sync error:', error);
    if (showStatus) updateSyncStatusUI(true, `Sync failed: ${error.message}`);
    return;
  }
  // Check remaining unsynced items
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

    // --- Global-like variables for UI logic ---
    const machineOptions = ['EXC-300', 'BULL-24', 'CRANE-12', 'Livraison'];
    const resources = ['Gasoil', 'HuileMoteur', 'HuileHydraulique', 'HuileLubrification', 'HuileBoite', 'HuilePont', 'HuileDirection'];
    let dailyStockCheckOverrides = {}; // Store for today's stock check overrides. Key: date -> resourceName -> quantityOnHand

    // --- DOM Element Selections ---
    const dateInput = document.getElementById('entry-date');
    const machineList = document.getElementById('machine-list');
    const machinesContainer = document.getElementById('machines-container');
    const addMachineBtn = document.getElementById('add-machine');
    const resourceStockCardsContainer = document.getElementById('resource-stock-cards-container');
    const entryForm = document.getElementById('entry-form');
    const saveBtn = document.getElementById('save-entries-btn');
    const editBtn = document.getElementById('edit-entries-btn');
    // manualSyncBtn is already handled in db.open().then()
    const generalNotesInput = document.getElementById('general-notes');
    const syncStatusElement = document.getElementById('syncStatus');

    // --- Helper Function Definitions (moved from inline script) ---
    function addMachineSection() {
        const clone = document.getElementById('machine-template').content.cloneNode(true);
        const section = clone.querySelector('.machine-section');
        const machineInput = section.querySelector('input[name="machine"]');

        // Setup machine input handling
        machineInput.addEventListener('change', () => {
            const newMachineName = machineInput.value;
            if (selectedMachines.has(newMachineName)) {
                alert('This machine has already been added for today.');
                machineInput.value = '';
                return;
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
        document.querySelectorAll('#entry-form input, #entry-form select, #entry-form textarea, #general-notes').forEach(el => {
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
    }

    async function updateCardStockDisplay(resourceName, forDate) {
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

    async function handleSaveStockCheck(resourceName, cardElement, quantityOnHandFromPrompt) {
        const forDate = dateInput.value;
        if (isNaN(quantityOnHandFromPrompt)) return;

        await saveStockCheck({ resourceName, date: forDate, quantityOnHand: quantityOnHandFromPrompt, syncStatus: 0 });
        if (!dailyStockCheckOverrides[forDate]) dailyStockCheckOverrides[forDate] = {};
        dailyStockCheckOverrides[forDate][resourceName] = quantityOnHandFromPrompt;

        await updateCardStockDisplay(resourceName, forDate);
        alert(`Stock check for ${resourceName} on ${forDate} saved: ${quantityOnHandFromPrompt}.`);
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
        }
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
            if(syncStatusElement) syncStatusElement.textContent = `Displaying ${entries.length} saved entries for ${dateString}.`;
            let notesLoaded = false;
            entries.forEach(entry => {
                let machineSection = Array.from(machinesContainer.querySelectorAll('.machine-section'))
                    .find(ms => ms.querySelector('input[name="machine"]').value === entry.machine);
                if (!machineSection) {
                    machineSection = addMachineSection();
                    const machineInput = machineSection.querySelector('input[name="machine"]');
                    machineInput.value = entry.machine;
                    trackMachineSelection(machineSection, entry.machine);
                    if (entry.notes && machineSection.querySelector('textarea[name="machine-notes"]')) {
                        machineSection.querySelector('textarea[name="machine-notes"]').value = entry.notes;
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
            if(syncStatusElement) syncStatusElement.textContent = `No entries found for ${dateString}. Ready for new input.`;
            addMachineSection();
            setFormEditable(true);
            saveBtn.textContent = 'Save All Entries';
        }

        // After populating form or setting to new entry mode, update all card stock displays
        // This is now partly handled by clearAllFormEntries, but a final pass ensures consistency.
        for (const resource of resources) {
            await updateCardStockDisplay(resource, dateString);
        }
    }

    function clearAllFormEntries() {
        machinesContainer.innerHTML = '';
        if (generalNotesInput) generalNotesInput.value = '';
        // When clearing form, also update stock display as net movements from form are now 0
        // This needs to be async if updateCardStockDisplay is async
        const currentDate = dateInput.value;
        resources.forEach(r => {
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
    }

    // --- Duplicate Prevention System ---
    const selectedMachines = new Set(); // Track selected machines for the current date
    const machineResourceSets = new Map(); // Map of machine elements to their selected resources

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
        return resources.filter(r => !selectedResources.has(r));
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
    }

    function untrackMachine(machineSection) {
        const machineName = machineSection.querySelector('input[name="machine"]').value;
        selectedMachines.delete(machineName);
        machineResourceSets.delete(machineSection);
        updateMachineDatalist();
    }

    function untrackResource(machineSection, resourceRow) {
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

    // Prepopulate date
    dateInput.valueAsDate = new Date();

    // Populate machine datalist
    machineOptions.forEach(m => {
        const opt = document.createElement('option'); opt.value = m; machineList.appendChild(opt);
    });

    // Setup machines
    addMachineBtn.onclick = addMachineSection;

    // Resource Stock Cards Setup
    resources.forEach(r => {
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

    // Form Submit Handler
    entryForm.addEventListener('submit', async e => {
        e.preventDefault();
        const entryDateValue = dateInput.value;
        const generalNotes = generalNotesInput.value || '';
        let entriesSavedCount = 0;

        await deleteEntriesByDate(entryDateValue);

        const machineSections = machinesContainer.querySelectorAll('.machine-section');
        for (const section of machineSections) {
            const machineName = section.querySelector('input[name="machine"]').value;
            const machineNotes = section.querySelector('textarea[name="machine-notes"]')?.value || '';
            const resourceRows = section.querySelectorAll('.resource-row');

            for (const row of resourceRows) {
                const resource = row.querySelector('select[name="resource"]').value;
                const quantity = parseFloat(row.querySelector('input[name="quantity"]').value);
                let actualMachineName = machineName;

                if (machineName.toLowerCase().trim().startsWith('livraison')) {
                    actualMachineName = 'Livraison';
                    const originalMachineLower = machineName.toLowerCase().trim();
                    const resourceLower = resource.toLowerCase();
                    if (originalMachineLower !== 'livraison' && !originalMachineLower.includes(resourceLower)) {
                        continue;
                    }
                }                const usageEntryData = {
                    date: entryDateValue,
                    machine: actualMachineName,
                    resource: resource,
                    quantity: quantity,
                    notes: `${generalNotes} ${machineNotes}`.trim(),
                    syncStatus: 0 // 0 = not synced
                };
                if (!isNaN(quantity) && quantity > 0 && machineName) {
                    await addFormEntry(usageEntryData);
                    entriesSavedCount++;
                }
            }
        }
        if (entriesSavedCount > 0) {
            if(syncStatusElement) syncStatusElement.textContent = `${entriesSavedCount} entries saved/updated locally and queued for sync.`;
            await loadEntriesForDate(entryDateValue);
        } else {
            if(syncStatusElement) syncStatusElement.textContent = 'No new entries to save.';
            if (await getEntriesByDate(entryDateValue).then(e => e.length === 0)) {
                await loadEntriesForDate(entryDateValue);
            }
        }
    });

    // Edit Button Listener
    editBtn.addEventListener('click', () => {
        setFormEditable(true);
        saveBtn.textContent = 'Update Entries';
        if(syncStatusElement) syncStatusElement.textContent = 'Form is now editable for update.';
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
