import { db } from './database.js';
import { RESOURCES } from './constants.js';
import { generateUUID, generateUniqueKey } from './utils.js';
import { updateCardStockDisplay, promptForMeasuredStock, clearDailyStockCheckOverrides, getDailyStockCheckOverrides } from './stock.js';
import { getAllEntriesByDate, deleteEntryAndQueue, getGasoilLivraisonDateForPeriod, getProductionByDateRange, getVentesByDateRange, getEarliestDataDate, getFormEntriesByDateRange, getMiningProcessStartDate } from './data.js';
import { updateClientBalanceCard } from './balance.js';
import config from '../config.global.js';

// --- Module-scoped UI elements and shared data ---
let dateInput;
let machineList;
let resourceStockCardsContainer;
let syncStatusElement;
let addRessourceBtn;
let addProductionBtn;
let addVenteBtn;
let addDeblaiBtn;
let saveAllBtn;
let machineOptions = []; // This array holds the machine options for datalists
const selectedMachines = new Set(); // Tracks selected machines for the current date
const machineResourceSets = new Map(); // Map of machine elements to their selected resources
let masterDataInstance; // To hold the masterData manager instance
// Removed isEditMode - using individual card editing now

// --- Global cumul state management ---
let cumulPeriodMode = 'auto'; // 'auto', 'select', 'mining'
let cumulStartDate = null; // Selected start date for cumulative calculations

// --- Validation and cumul state functions ---

function validateCumulDates(startDate, endDate) {
    if (!startDate || !endDate) {
        return { valid: false, error: "Les dates ne peuvent pas être vides" };
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
        return { valid: false, error: "La date de début cumul ne peut pas être après la date sélectionnée" };
    }

    return { valid: true };
}

// Function to get the effective cumul start date based on current mode
async function getEffectiveCumulStartDate() {
    const currentDate = dateInput.value;

    switch (cumulPeriodMode) {
        case 'auto':
            // Default: last gasoil livraison or earliest data
            return await getGasoilLivraisonDateForPeriod(currentDate) || await getEarliestDataDate();

        case 'mining':
            // Mining start date
            return await getMiningProcessStartDate(currentDate) ||
                   await getGasoilLivraisonDateForPeriod(currentDate) ||
                   await getEarliestDataDate();

        case 'select':
            // User-selected date (if valid)
            if (cumulStartDate) {
                const validation = validateCumulDates(cumulStartDate, currentDate);
                if (validation.valid) {
                    return cumulStartDate;
                }
            }
            // Fallback to auto mode if invalid
            setCumulPeriodMode('auto');
            return await getEffectiveCumulStartDate();

        default:
            return await getGasoilLivraisonDateForPeriod(currentDate) || await getEarliestDataDate();
    }
}

// Function to set cumul period mode and handle validation
function setCumulPeriodMode(mode) {
    cumulPeriodMode = mode;
    console.log(`Cumul period mode changed to: ${mode}`);

    // Update UI to reflect current mode
    updateCumulModeUI();

    // Refresh all totals if dates are valid
    if (dateInput && dateInput.value) {
        loadEntriesForDate(dateInput.value);
        updateGasoilDateBadges(dateInput.value);
    }
}

// Function to set custom cumul start date
function setCumulStartDate(dateString) {
    const currentDate = dateInput.value;
    const validation = validateCumulDates(dateString, currentDate);

    if (validation.valid) {
        cumulStartDate = dateString;
        cumulPeriodMode = 'select';
        updateCumulModeUI();
        loadEntriesForDate(currentDate);
        updateGasoilDateBadges(currentDate);
    } else {
        alert(validation.error);
    }
}

// Function to update the cumul mode UI indicator
function updateCumulModeUI() {
    const indicator = document.getElementById('cumul-period-indicator');
    if (!indicator) return;

    let displayText = '';
    switch (cumulPeriodMode) {
        case 'auto':
            displayText = 'Auto (livraison)';
            break;
        case 'mining':
            displayText = 'Début minage';
            break;
        case 'select':
            if (cumulStartDate) {
                const date = new Date(cumulStartDate);
                displayText = `Depuis ${date.toLocaleDateString('fr-FR', { month: 'short', day: 'numeric' })}`;
            } else {
                displayText = 'Sélectionner';
            }
            break;
        default:
            displayText = 'Auto';
    }

    indicator.textContent = `Cumul: ${displayText}`;
}

// --- Helper Function Definitions ---

// --- Exported UI sync status helpers for sync.js ---
function updateSyncStatusUI(isOnline, message) {
    if (syncStatusElement) {
        syncStatusElement.textContent = message;
        syncStatusElement.className = isOnline ? 'online' : 'offline';
    }
}

function updateSyncButtonState() {
    const syncBtn = document.getElementById('sync-btn');
    if (!syncBtn) return;
    if (navigator.onLine) {
        syncBtn.disabled = false;
        syncBtn.textContent = 'Synchroniser';
    } else {
        syncBtn.disabled = true;
        syncBtn.textContent = 'Hors ligne';
    }
}

// Checks if the user is admin and shows the admin tab if so
function checkAdminStatus(account) {
    if (account && (account.username === config.adminEmail || account.email === config.adminEmail)) {
        const adminTab = document.getElementById('admin-tab');
        if (adminTab) adminTab.style.display = 'inline-block';
    }
}

export { updateSyncStatusUI, updateSyncButtonState, updateUnsyncedCount, checkAdminStatus, applySyncStatusClass };

function applySyncStatusClass(element, syncStatus) {
    if (!element) return;
    element.classList.remove('status-synced', 'status-saved');
    if (syncStatus === 1) {
        element.classList.add('status-synced');
    } else if (syncStatus === 0) {
        element.classList.add('status-saved');
    }
}

function getAvailableMachines() {
    return machineOptions.filter(m => !selectedMachines.has(m));
}
function updateMachineDatalist() {
    if (!machineList) return;
    machineList.innerHTML = '';
    getAvailableMachines().forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        machineList.appendChild(opt);
    });
}

function updateTruckDatalist() {
    if (!masterDataInstance) return;
    const truckList = document.getElementById('truck-list');
    if (!truckList) return;
    truckList.innerHTML = '';
    const trucks = masterDataInstance.getMachines(true).filter(m => m.machineType === 'Camion');
    trucks.forEach(truck => {
        const opt = document.createElement('option');
        opt.value = truck.idMachine;
        truckList.appendChild(opt);
    });
}

function getAvailableResourcesForMachine(machineSection) {
    let resourceSet = machineResourceSets.get(machineSection);
    if (!resourceSet) {
        resourceSet = new Set();
        machineResourceSets.set(machineSection, resourceSet);
    }
    
    const selectedResources = new Set();
    const existingSelects = machineSection.querySelectorAll('select[name="resource"]');
    existingSelects.forEach(select => {
        if (select.value) selectedResources.add(select.value);
    });
    
    resourceSet.clear();
    selectedResources.forEach(r => resourceSet.add(r));
    
    return RESOURCES.filter(r => !selectedResources.has(r));
}

function updateResourceSelect(select, machineSection) {
    const currentValue = select.value;
    select.innerHTML = '';
    
    getAvailableResourcesForMachine(machineSection).forEach(r => {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = r;
        select.appendChild(opt);
    });

    if (currentValue && getAvailableResourcesForMachine(machineSection).includes(currentValue)) {
        select.value = currentValue;
    }
}

function trackResourceSelection(machineSection, resourceName) {
    let resourceSet = machineResourceSets.get(machineSection);
    if (!resourceSet) {
        resourceSet = new Set();
        machineResourceSets.set(machineSection, resourceSet);
    }
    
    const currentSelections = new Set();
    const existingSelects = machineSection.querySelectorAll('select[name="resource"]');
    existingSelects.forEach(select => {
        if (select.value && select.value !== resourceName) {
            currentSelections.add(select.value);
        }
    });
    
    if (resourceName) {
        currentSelections.add(resourceName);
    }
    
    resourceSet.clear();
    currentSelections.forEach(r => resourceSet.add(r));
}

function untrackResource(machineSection, resourceRow) {
    const resourceName = resourceRow.querySelector('select[name="resource"]').value;
    const resourceSet = machineResourceSets.get(machineSection);
    if (resourceSet) {
        resourceSet.delete(resourceName);
    }
}

function addResourceRow(section) {
    const clone = document.getElementById('resource-template').content.cloneNode(true);
    const row = clone.querySelector('.resource-row');
    const select = row.querySelector('select[name="resource"]');

    updateResourceSelect(select, section);

    select.addEventListener('change', () => {
        trackResourceSelection(section, select.value);
        updateResourceSelect(select, section);
    });

    row.querySelector('.remove-resource').onclick = () => {
        untrackResource(section, row);
        row.remove();
        section.querySelectorAll('select[name="resource"]').forEach(s => {
            updateResourceSelect(s, section);
        });
    };

    section.querySelector('.resources-container').appendChild(row);
    return row;
}

function createCard(templateId, entry = {}, fieldConfig) {
    const template = document.getElementById(templateId);
    const card = template.content.cloneNode(true).firstElementChild;
    card.dataset.id = entry.id || '';

    for (const [fieldName, selector] of Object.entries(fieldConfig.selectors)) {
        const element = card.querySelector(selector);
        if (element) {
            element.value = entry[fieldName] || fieldConfig.defaults[fieldName] || '';
        }
    }

    const checkbox = card.querySelector('.entry-checkbox');
    if (checkbox) {
        checkbox.dataset.id = entry.id || '';
    }

    if (templateId === 'ressource-card-template') {
        const machineInput = card.querySelector('input[name="machine"]');
        machineInput.dispatchEvent(new Event('change'));
        if (!entry.id) {
            addResourceRow(card);
        }
        card.querySelector('.add-resource').addEventListener('click', () => {
            addResourceRow(card);
        });
    }

    return card;
}

function createRessourceCard(entry = {}) {
    const fieldConfig = {
        selectors: {
            machine: 'input[name="machine"]',
            zoneActivite: 'select[name="zone-activite"]',
            compteurMoteurDebut: 'input[name="compteurMoteurDebut"]',
            compteurMoteurFin: 'input[name="compteurMoteurFin"]',
            notes: 'textarea[name="machine-notes"]'
        },
        defaults: {}
    };
    return createCard('ressource-card-template', entry, fieldConfig);
}

function createProductionCard(entry = {}) {
    const fieldConfig = {
        selectors: {
            idCamion: '[name="idCamion"]',
            poids: '[name="poids"]',
            voyages: '[name="voyages"]',
            origine: '[name="origine"]',
            destination: '[name="destination"]',
            commentaire: '[name="commentaire"]'
        },
        defaults: {
            origine: 'Extraction',
            destination: 'Concassage',
            voyages: 1
        }
    };
    return createCard('production-card-template', entry, fieldConfig);
}

function createDeblaiCard(entry = {}) {
    const fieldConfig = {
        selectors: {
            idCamion: '[name="idCamion"]',
            voyages: '[name="voyages"]',
            commentaire: '[name="commentaire"]'
        },
        defaults: {
            voyages: 1
        }
    };
    return createCard('deblai-card-template', entry, fieldConfig);
}

function createVenteCard(entry = {}) {
    const fieldConfig = {
        selectors: {
            client: '[name="client"]',
            produit: '[name="produit"]',
            quantite: '[name="quantite"]',
            montantPaye: '[name="montantPaye"]',
            commentaire: '[name="commentaire"]'
        },
        defaults: {}
    };
    return createCard('ventes-card-template', entry, fieldConfig);
}

function setCardReadOnly(card, isReadOnly, syncStatus) {
    card.querySelectorAll('input:not([type="checkbox"]), select, textarea').forEach(el => {
        el.readOnly = isReadOnly;
        el.disabled = isReadOnly;
    });

    // Display name field should ALWAYS be readonly, regardless of card edit mode
    const displayNameField = card.querySelector('input[name="machine-display-name"]');
    if (displayNameField) {
        displayNameField.readOnly = true;
    }

    card.querySelectorAll('.add-resource, .remove-resource').forEach(btn => {
        btn.style.display = isReadOnly ? 'none' : 'block';
    });

    // Show/hide edit button based on sync status - only show for unsynced entries
    const editBtn = card.querySelector('.edit-btn');
    if (editBtn) {
        editBtn.style.display = (syncStatus === 1) ? 'none' : 'inline-block';
    }

    const checkbox = card.querySelector('.entry-checkbox');
    if (checkbox) {
        // Hide the checkbox if the item is synced, otherwise ensure it's visible
        checkbox.style.display = (syncStatus === 1) ? 'none' : 'inline-block';
    }

    card.classList.remove('status-new', 'status-saved', 'status-synced', 'card-readonly');
    if (isReadOnly) {
        card.classList.add('card-readonly');
        applySyncStatusClass(card, syncStatus);
    } else {
        card.classList.add('status-new');
    }
}

async function loadProductionEntries(dateString, entries) {
  const container = document.getElementById('production-entries-container');
  if (!container) return;
  container.innerHTML = '';
  entries.forEach(entry => {
    const card = createProductionCard(entry);
    container.appendChild(card);
    setCardReadOnly(card, true, entry.syncStatus);
  });
}

async function loadVentesEntries(dateString, entries) {
  const container = document.getElementById('ventes-entries-container');
  if (!container) return;
  container.innerHTML = '';
  entries.forEach(entry => {
    const card = createVenteCard(entry);
    container.appendChild(card);
    setCardReadOnly(card, true, entry.syncStatus);
  });
}

async function loadDeblaiEntries(dateString, entries) {
    const container = document.getElementById('deblai-entries-container');
    if (!container) return;
    container.innerHTML = '';
    entries.forEach(entry => {
        const card = createDeblaiCard(entry);
        container.appendChild(card);
        setCardReadOnly(card, true, entry.syncStatus);
    });
}

async function loadRessourcesEntries(dateString, entries) {
    const container = document.getElementById('ressources-entries-container');
    if (!container) return;
    container.innerHTML = '';
    const machineEntries = new Map();

    entries.forEach(entry => {
        if (!machineEntries.has(entry.machine)) {
            machineEntries.set(entry.machine, []);
        }
        machineEntries.get(entry.machine).push(entry);
    });

    for (const [machine, resources] of machineEntries.entries()) {
        const card = createRessourceCard(resources[0]);
        container.appendChild(card);

        const resourcesContainer = card.querySelector('.resources-container');
        resourcesContainer.innerHTML = '';
        resources.forEach(resourceEntry => {
            const resourceRow = addResourceRow(card);
            resourceRow.querySelector('select[name="resource"]').value = resourceEntry.resource;
            resourceRow.querySelector('input[name="quantity"]').value = resourceEntry.quantity;
        });

        // Populate display name for existing cards
        const machineInput = card.querySelector('input[name="machine"]');
        if (machineInput && machineInput.value) {
            updateMachineDisplayName(machineInput);
        }

        setCardReadOnly(card, true, resources[0].syncStatus);
    }
}

// Clear tracking data when changing dates
function clearTrackingSets() {
    selectedMachines.clear();
    machineResourceSets.clear();
    if (machineList) {
        updateMachineDatalist();
    }
}

export function initializeAppUI(masterData) {
    masterDataInstance = masterData;
    console.log("DB is ready. Initializing UI.");

    // --- Global Elements ---
    dateInput = document.getElementById('entry-date');
    machineList = document.getElementById('machine-list');
    resourceStockCardsContainer = document.getElementById('resource-stock-cards-container');
    syncStatusElement = document.getElementById('syncStatus');
    addRessourceBtn = document.getElementById('add-ressource-btn');
    addProductionBtn = document.getElementById('add-production-btn');
    addVenteBtn = document.getElementById('add-vente-btn');
    addDeblaiBtn = document.getElementById('add-deblai-btn');
    saveAllBtn = document.getElementById('save-all-btn');
    
    const DEFAULT_FALLBACK_MACHINES = ['EXC-300', 'BULL-24', 'CRANE-12'];

    const setMachineOptions = (activeMachines, allMachines) => {
        if (activeMachines.length > 0) {
            machineOptions = activeMachines.map(m => m.idMachine);
        } else if (allMachines.length > 0) {
            console.warn('No active machines found, using all machines for options.');
            machineOptions = allMachines.map(m => m.idMachine);
        } else {
            console.warn('No machines found in MasterData. Falling back to default options.');
            machineOptions = [...DEFAULT_FALLBACK_MACHINES];
        }
        if (!machineOptions.includes('Livraison')) {
            machineOptions.push('Livraison');
        }
        updateMachineDatalist();
        updateTruckDatalist();
    };

    async function loadMachineOptions() {
        try {
            console.log('Loading active machines from MasterData...');
            const allMasterDataMachines = masterDataInstance.getMachines(false);
            const activeMasterDataMachines = masterDataInstance.getMachines(true);

            console.log('Total machines from MasterData:', allMasterDataMachines.length);
            console.log('Active machines from MasterData:', activeMasterDataMachines.length);
            
            setMachineOptions(activeMasterDataMachines, allMasterDataMachines);
            
            console.log('Final machine options for datalist:', machineOptions);
            return activeMasterDataMachines.length > 0 ? activeMasterDataMachines : allMasterDataMachines;
        } catch (error) {
            console.error('Failed to load machines from MasterData (or error in try block):', error);
            let allCachedMachines = [];
            let activeCachedMachines = [];
            if (masterDataInstance && masterDataInstance.machines && masterDataInstance.machines.length > 0) {
                console.warn('Falling back to masterData.machines internal cache due to error.');
                allCachedMachines = masterDataInstance.machines;
                activeCachedMachines = allCachedMachines.filter(m => m.active === 1);
            }
            setMachineOptions(activeCachedMachines, allCachedMachines);
            return [];
        }
    }

    console.log('initializeAppUI: Populating machine options from masterData.');
    loadMachineOptions(); 

    window.addEventListener('master-data-refreshed', () => {
        console.log('Master data has been refreshed in the background. Updating UI components.');
        loadMachineOptions();
    });

    if (dateInput) {
        dateInput.valueAsDate = new Date();
    } else {
        console.error('Date input element not found');
    }
    if (machineList && Array.isArray(machineOptions)) {
        machineOptions.forEach(m => {
            if (m) {
                const opt = document.createElement('option');
                opt.value = m;
                machineList.appendChild(opt);
            }
        });
    } else {
        console.error('Machine list element or options not properly initialized');
    }

    addRessourceBtn.onclick = () => {
        const container = document.getElementById('ressources-entries-container');
        const card = createRessourceCard();
        container.appendChild(card);
        setCardReadOnly(card, false, -1);
    };
    addProductionBtn.onclick = () => {
        const container = document.getElementById('production-entries-container');
        const card = createProductionCard();
        container.appendChild(card);
        setCardReadOnly(card, false, -1);
    };
    addVenteBtn.onclick = () => {
        const container = document.getElementById('ventes-entries-container');
        const card = createVenteCard();
        container.appendChild(card);
        setCardReadOnly(card, false, -1);
    };

    addDeblaiBtn.onclick = () => {
        const container = document.getElementById('deblai-entries-container');
        const card = createDeblaiCard();
        container.appendChild(card);
        setCardReadOnly(card, false, -1);
    };

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
            const editBtn = document.getElementById('edit-ressources-btn');
            const isInEditableMode = editBtn ? editBtn.style.display === 'none' : true;
            if (isInEditableMode && !card.classList.contains('disabled')) {
                promptForMeasuredStock(r, card);
            } else {
                 console.log(`Not prompting for ${r}. isInEditableMode: ${isInEditableMode}, card.disabled: ${card.classList.contains('disabled')}`);
            }
        });
        resourceStockCardsContainer.appendChild(card);
            // Update stock display for each card
            updateCardStockDisplay(r, dateInput.value);
    });

    saveAllBtn.addEventListener('click', async () => {
        const entryDateValue = dateInput.value;
        let changesMade = false;
        let allFormsValid = true;

        const containers = ['ressources-entries-container', 'production-entries-container', 'ventes-entries-container', 'deblai-entries-container'];
        for (const containerId of containers) {
            const container = document.getElementById(containerId);
            const cards = container.querySelectorAll('.ressource-card, .production-card, .ventes-card, .deblai-card');
            for (const card of cards) {
                if (card.classList.contains('card-readonly')) continue;

                const isCardValid = await saveCard(card, entryDateValue);

                if (isCardValid) {
                    changesMade = true;
                    setCardReadOnly(card, true, 0);
                } else {
                    allFormsValid = false;
                }
            }
        }

        if (!allFormsValid) {
            alert('Veuillez remplir tous les champs obligatoires avant de sauvegarder.');
        } else if (changesMade) {
            updateSyncStatusUI(navigator.onLine, 'Modifications enregistrées localement.');
            await loadEntriesForDate(entryDateValue);
            await updateGasoilDateBadges(entryDateValue);
            updateUnsyncedCount();
        }
    });

    dateInput.addEventListener('change', async (e) => {
        clearDailyStockCheckOverrides();
        clearTrackingSets();
        await updateGasoilDateBadges(e.target.value);
        loadEntriesForDate(e.target.value);
    });

    // Handle cumul period selector changes
    const cumulPeriodSelector = document.getElementById('cumul-period-selector');
    const customDatePicker = document.getElementById('custom-cumul-date-picker');

    if (cumulPeriodSelector) {
        cumulPeriodSelector.addEventListener('change', async (e) => {
            const selectedValue = e.target.value;

            if (selectedValue === 'auto') {
                customDatePicker.style.display = 'none';
                setCumulPeriodMode('auto');
            } else if (selectedValue === 'mining') {
                customDatePicker.style.display = 'none';
                setCumulPeriodMode('mining');
            } else if (selectedValue === 'select') {
                // Show the custom date picker
                customDatePicker.style.display = 'inline';
                // Set max date to prevent future dates
                customDatePicker.max = dateInput.value;
                // Pre-select current cumul date if any
                if (cumulStartDate) {
                    customDatePicker.value = cumulStartDate;
                }
            }
        });
    }

    // Handle custom date picker changes
    if (customDatePicker) {
        customDatePicker.addEventListener('change', (e) => {
            const selectedDate = e.target.value;
            if (selectedDate) {
                setCumulStartDate(selectedDate);
            }
        });
    }



    document.querySelector('.tab-nav').addEventListener('click', (e) => {
      if (e.target.matches('.tab-btn')) {
        const tabId = e.target.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById(tabId).classList.add('active');
      }
    });

    loadClientOptions();

    db.on('ready', () => {
        console.log("DB is ready event fired. Automatic initial sync disabled.");
    });



    if (navigator.onLine) {
        updateSyncStatusUI(true, 'En ligne.');
    } else {
        updateSyncStatusUI(false, 'Hors ligne. Les entrées seront mises en file d\'attente.');
    }

    loadEntriesForDate(dateInput.value);
    updateGasoilDateBadges(dateInput.value);
    updateSyncButtonState();
    updateUnsyncedCount();
    updateCumulModeUI();

    // Initialize individual card edit/delete functionality
    initializeCardEditing();

    // Initialize machine input validation and display name population
    initializeMachineSelection();
}

function initializeMachineSelection() {
    // Delegate event listener for machine input changes to populate display name
    document.addEventListener('input', (e) => {
        if (e.target.name === 'machine' && e.target.tagName === 'INPUT') {
            updateMachineDisplayName(e.target);
        }
    });

    // Also handle change event for when user selects from datalist
    document.addEventListener('change', (e) => {
        if (e.target.name === 'machine' && e.target.tagName === 'INPUT') {
            updateMachineDisplayName(e.target);
            validateMachineInput(e.target);
        }
    });
}

function updateMachineDisplayName(machineInput) {
    const machineId = machineInput.value.trim();
    const card = machineInput.closest('.ressource-card');

    if (!card) return;

    const displayNameField = card.querySelector('input[name="machine-display-name"]');
    if (!displayNameField) return;

    if (machineId) {
        const machine = masterDataInstance.findMachineByIdMachine(machineId);
        if (machine && machine.displayName) {
            displayNameField.value = machine.displayName;
        } else {
            displayNameField.value = '';
        }
    } else {
        displayNameField.value = '';
    }
}

function validateMachineInput(machineInput) {
    const machineId = machineInput.value.trim();

    // Clear any previous validation messages
    machineInput.setCustomValidity('');

    if (!machineId) {
        machineInput.setCustomValidity('ID Machine requis');
        return;
    }

    // Check if the entered machine ID exists in our machine list
    const machine = masterDataInstance.findMachineByIdMachine(machineId);
    if (!machine) {
        machineInput.setCustomValidity('Veuillez sélectionner une machine valide dans la liste');
        machineInput.value = ''; // Clear invalid input
        updateMachineDisplayName(machineInput); // Clear display name too
    }
}

function initializeCardEditing() {
    // Delegate event listener for all edit buttons (only shown for unsynced entries)
    document.body.addEventListener('click', async (e) => {
        const editBtn = e.target.closest('.edit-btn');
        if (editBtn) {
            const card = editBtn.closest('.ressource-card, .production-card, .ventes-card, .deblai-card');
            if (card) {
                startEditingCard(card);
            }
        }

        // Handle save button clicks
        const saveBtn = e.target.closest('.card-save-btn');
        if (saveBtn) {
            const card = saveBtn.closest('.ressource-card, .production-card, .ventes-card, .deblai-card');
            if (card) {
                const success = await saveCard(card, dateInput.value);
                if (success) {
                    finishEditingCard(card, true);
                    updateSyncStatusUI(navigator.onLine, 'Modifications enregistrées localement.');
                    await loadEntriesForDate(dateInput.value);
                    await updateGasoilDateBadges(dateInput.value);
                    updateUnsyncedCount();
                } else {
                    alert('Veuillez remplir tous les champs obligatoires.');
                }
            }
        }

        // Handle cancel button clicks
        const cancelBtn = e.target.closest('.card-cancel-btn');
        if (cancelBtn) {
            const card = cancelBtn.closest('.ressource-card, .production-card, .ventes-card, .deblai-card');
            if (card) {
                finishEditingCard(card, false);
            }
        }

        // Handle delete button clicks
        const deleteBtn = e.target.closest('.card-delete-btn');
        if (deleteBtn) {
            const card = deleteBtn.closest('.ressource-card, .production-card, .ventes-card, .deblai-card');
            if (card && confirm('Êtes-vous sûr de vouloir supprimer cette entrée ?')) {
                await deleteCard(card);
                await loadEntriesForDate(dateInput.value);
                await updateGasoilDateBadges(dateInput.value);
                updateUnsyncedCount();
                updateSyncStatusUI(navigator.onLine, 'Entrée supprimée.');
            }
        }
    });
}

function startEditingCard(card) {
    // Store original values for cancel functionality
    card.dataset.originalValues = JSON.stringify(getCardValues(card));

    // Make form fields editable
    setCardReadOnly(card, false, -1);

    // Hide edit button and show editing controls
    if (card.querySelector('.edit-btn')) {
        card.querySelector('.edit-btn').style.display = 'none';
    }

    // Add Save/Cancel/Delete buttons to card footer
    const existingControls = card.querySelector('.card-edit-controls');
    if (existingControls) {
        existingControls.remove();
    }

    const controls = document.createElement('div');
    controls.className = 'card-edit-controls';
    controls.innerHTML = `
        <button class="card-save-btn">Enregistrer</button>
        <button class="card-cancel-btn">Annuler</button>
        <button class="card-delete-btn">Supprimer</button>
    `;
    card.appendChild(controls);
}

function finishEditingCard(card, saved) {
    if (!saved) {
        // Restore original values
        const originalValues = JSON.parse(card.dataset.originalValues || '{}');
        setCardValues(card, originalValues);
    }

    // Clean up stored values
    delete card.dataset.originalValues;

    // Make card read-only again
    const syncStatus = card.classList.contains('status-synced') ?
        1 : card.classList.contains('status-saved') ? 0 : -1;
    setCardReadOnly(card, true, syncStatus);

    // Remove editing controls
    const controls = card.querySelector('.card-edit-controls');
    if (controls) {
        controls.remove();
    }
}

function getCardValues(card) {
    const values = {};
    card.querySelectorAll('input, select, textarea').forEach(field => {
        if (field.name) {
            values[field.name] = field.value;
        }
    });

    // Handle resource rows for ressource cards
    if (card.classList.contains('ressource-card')) {
        const resourceRows = [];
        card.querySelectorAll('.resource-row').forEach(row => {
            const resourceSelect = row.querySelector('select[name="resource"]');
            const quantityInput = row.querySelector('input[name="quantity"]');
            if (resourceSelect && quantityInput) {
                resourceRows.push({
                    resource: resourceSelect.value,
                    quantity: quantityInput.value
                });
            }
        });
        values.resourceRows = resourceRows;
    }

    return values;
}

function setCardValues(card, values) {
    card.querySelectorAll('input, select, textarea').forEach(field => {
        if (field.name && values[field.name] !== undefined) {
            field.value = values[field.name];
        }
    });

    // Handle resource rows for ressource cards
    if (card.classList.contains('ressource-card') && values.resourceRows) {
        const resourcesContainer = card.querySelector('.resources-container');
        if (resourcesContainer) {
            resourcesContainer.innerHTML = '';
            values.resourceRows.forEach(rowData => {
                const row = addResourceRow(card);
                row.querySelector('select[name="resource"]').value = rowData.resource;
                row.querySelector('input[name="quantity"]').value = rowData.quantity;
            });
        }
    }
}

async function deleteCard(card) {
    const id = card.dataset.id ? parseInt(card.dataset.id, 10) : null;
    if (!id) return;

    let tableName, listName;
    if (card.classList.contains('ressource-card')) {
        // For resource cards, delete all entries for this machine on this date
        tableName = 'formEntries';
        listName = config.sharePoint.lists.formEntries;

        // Get the entry to find the machine name and date
        const entry = await db.formEntries.get(id);
        if (entry) {
            // Find and delete all entries for this machine on this date
            const allEntriesForMachine = await db.formEntries
                .where({ machine: entry.machine, date: entry.date })
                .toArray();

            for (const entryToDelete of allEntriesForMachine) {
                await deleteEntryAndQueue(tableName, listName, entryToDelete.id);
            }
        }
    } else if (card.classList.contains('production-card')) {
        tableName = 'production';
        listName = config.sharePoint.lists.production;
        await deleteEntryAndQueue(tableName, listName, id);
    } else if (card.classList.contains('ventes-card')) {
        tableName = 'ventes';
        listName = config.sharePoint.lists.ventes;
        await deleteEntryAndQueue(tableName, listName, id);
    } else if (card.classList.contains('deblai-card')) {
        tableName = 'deblai';
        listName = config.sharePoint.lists.deblai;
        await deleteEntryAndQueue(tableName, listName, id);
    }
}

async function saveCard(card, entryDate) {
    const cardType = card.classList.contains('ressource-card') ? 'ressource' :
                     card.classList.contains('production-card') ? 'production' :
                     card.classList.contains('deblai-card') ? 'deblai' :
                     'vente';
    const id = card.dataset.id ? parseInt(card.dataset.id, 10) : null;

    let isValid = true;

    if (cardType === 'ressource') {
        const machineNameInput = card.querySelector('input[name="machine"]');
        const zoneActiviteInput = card.querySelector('select[name="zone-activite"]');
        const machineName = machineNameInput.value.trim();
        const zoneActivite = zoneActiviteInput.value;

        if (!machineName) {
            machineNameInput.classList.add('invalid');
            isValid = false;
        } else {
            machineNameInput.classList.remove('invalid');
        }
        if (!zoneActivite) {
            zoneActiviteInput.classList.add('invalid');
            isValid = false;
        } else {
            zoneActiviteInput.classList.remove('invalid');
        }
        if (!isValid) return false;

        const machineNotes = card.querySelector('textarea[name="machine-notes"]').value.trim();
        const compteurDebut = parseFloat(card.querySelector('input[name="compteurMoteurDebut"]').value || '0');
        const compteurFin = parseFloat(card.querySelector('input[name="compteurMoteurFin"]').value || '0');

        // VALIDATION: Compteur fin must be >= compteur debut
        const compteurDebutInput = card.querySelector('input[name="compteurMoteurDebut"]');
        const compteurFinInput = card.querySelector('input[name="compteurMoteurFin"]');

        if (!isNaN(compteurDebut) && !isNaN(compteurFin) && compteurFin < compteurDebut) {
            compteurFinInput.classList.add('invalid');
            compteurDebutInput.classList.add('invalid');
            isValid = false;
        } else {
            compteurFinInput.classList.remove('invalid');
            compteurDebutInput.classList.remove('invalid');
        }

        // --- Diffing Logic ---
        const oldState = id ? await db.formEntries.where({ machine: (await db.formEntries.get(id)).machine, date: entryDate }).toArray() : [];
        const newStateRows = Array.from(card.querySelectorAll('.resource-row'));

        // 1. Identify deletions
        for (const oldEntry of oldState) {
            const stillExists = newStateRows.some(row => row.querySelector('select[name="resource"]').value === oldEntry.resource);
            if (!stillExists) {
                await deleteEntryAndQueue('formEntries', config.sharePoint.lists.formEntries, oldEntry.id);
            }
        }

        // 2. Identify additions and updates
        let hasResourceEntry = false;
        for (const row of newStateRows) {
            const resource = row.querySelector('select[name="resource"]').value;
            const quantity = parseFloat(row.querySelector('input[name="quantity"]').value);
            if (isNaN(quantity) || quantity <= 0 || !resource) continue;
            hasResourceEntry = true;

            const existingEntry = oldState.find(e => e.resource === resource);
            const entryData = {
                date: entryDate,
                machine: machineName,
                zoneActivite,
                resource,
                quantity,
                compteurMoteurDebut: compteurDebut,
                compteurMoteurFin: compteurFin,
                notes: machineNotes,
                syncStatus: 0,
                uniqueKey: generateUniqueKey('ressource', machineName, resource, entryDate)
            };

            if (existingEntry) {
                // Update if quantity or other machine-level data changed
                if (existingEntry.quantity !== quantity || existingEntry.notes !== machineNotes || existingEntry.compteurMoteurDebut !== compteurDebut || existingEntry.compteurMoteurFin !== compteurFin) {
                    await db.formEntries.update(existingEntry.id, entryData);
                }
            } else {
                // Add if it's a new resource for this machine
                await db.formEntries.add(entryData);
            }
        }

        // 3. If no valid resource entry, allow saving a machine-only entry for mileage
        if (!hasResourceEntry) {
            // Check if a machine-only entry already exists
            const existingMachineOnly = oldState.find(e => !e.resource);
            const entryData = {
                date: entryDate,
                machine: machineName,
                zoneActivite,
                resource: null,
                quantity: null,
                compteurMoteurDebut: compteurDebut,
                compteurMoteurFin: compteurFin,
                notes: machineNotes,
                syncStatus: 0,
                uniqueKey: generateUniqueKey('ressource', machineName, entryDate)
            };
            if (existingMachineOnly) {
                await db.formEntries.update(existingMachineOnly.id, entryData);
            } else {
                await db.formEntries.add(entryData);
            }
        }

    } else { // Production, Vente, and Deblai logic
        let data;
        let table;
        if (cardType === 'production') {
            table = db.production;
            const idCamionInput = card.querySelector('[name="idCamion"]');
            const poidsInput = card.querySelector('[name="poids"]');
            const voyagesInput = card.querySelector('[name="voyages"]');
            data = {
                date: entryDate,
                idCamion: idCamionInput.value.trim(),
                poids: parseFloat(poidsInput.value),
                voyages: parseInt(voyagesInput.value, 10) || 1,
                origine: card.querySelector('[name="origine"]').value,
                destination: card.querySelector('[name="destination"]').value,
                commentaire: card.querySelector('[name="commentaire"]').value.trim(),
                syncStatus: 0
            };
            if (!data.idCamion || isNaN(data.poids) || data.poids <= 0 || data.voyages <= 0) {
                isValid = false;
                if (!data.idCamion) idCamionInput.classList.add('invalid'); else idCamionInput.classList.remove('invalid');
                if (isNaN(data.poids) || data.poids <= 0) poidsInput.classList.add('invalid'); else poidsInput.classList.remove('invalid');
                if (data.voyages <= 0) voyagesInput.classList.add('invalid'); else voyagesInput.classList.remove('invalid');
            } else {
                idCamionInput.classList.remove('invalid');
                poidsInput.classList.remove('invalid');
                voyagesInput.classList.remove('invalid');
            }
        } else if (cardType === 'deblai') {
            table = db.deblai;
            const idCamionInput = card.querySelector('[name="idCamion"]');
            const voyagesInput = card.querySelector('[name="voyages"]');
            data = {
                date: entryDate,
                idCamion: idCamionInput.value.trim(),
                voyages: parseInt(voyagesInput.value, 10) || 1,
                commentaire: card.querySelector('[name="commentaire"]').value.trim(),
                syncStatus: 0
            };
            if (!data.idCamion || data.voyages <= 0) {
                isValid = false;
                if (!data.idCamion) idCamionInput.classList.add('invalid'); else idCamionInput.classList.remove('invalid');
                if (data.voyages <= 0) voyagesInput.classList.add('invalid'); else voyagesInput.classList.remove('invalid');
            } else {
                idCamionInput.classList.remove('invalid');
                voyagesInput.classList.remove('invalid');
            }
        } else { // vente
            table = db.ventes;
            const clientInput = card.querySelector('[name="client"]');
            const produitInput = card.querySelector('[name="produit"]');
            const quantiteInput = card.querySelector('[name="quantite"]');
            const montantPayeInput = card.querySelector('[name="montantPaye"]');
            data = {
                date: entryDate,
                client: clientInput.value.trim(),
                produit: produitInput.value,
                quantite: parseFloat(quantiteInput.value),
                montantPaye: parseFloat(montantPayeInput.value),
                commentaire: card.querySelector('[name="commentaire"]').value.trim(),
                syncStatus: 0
            };
            
            if (!data.client) {
                clientInput.classList.add('invalid');
                isValid = false;
            } else {
                const existingClients = Array.from(document.getElementById('client-list').options).map(opt => opt.value);
                if (!existingClients.includes(data.client)) {
                    if (confirm(`Le client "${data.client}" n'existe pas. Voulez-vous l'ajouter ?`)) {
                        const newOption = document.createElement('option');
                        newOption.value = data.client;
                        document.getElementById('client-list').appendChild(newOption);
                        clientInput.classList.remove('invalid');
                    } else {
                        clientInput.classList.add('invalid');
                        isValid = false;
                    }
                } else {
                    clientInput.classList.remove('invalid');
                }
            }
            if (!data.produit) {
                produitInput.classList.add('invalid');
                isValid = false;
            } else {
                produitInput.classList.remove('invalid');
            }
            if (!data.quantite) {
                quantiteInput.classList.add('invalid');
                isValid = false;
            } else {
                quantiteInput.classList.remove('invalid');
            }
            if (isNaN(data.montantPaye)) {
                montantPayeInput.classList.add('invalid');
                isValid = false;
            } else {
                montantPayeInput.classList.remove('invalid');
            }
        }

        if (!isValid) return false;

        if (id) {
            const existing = await table.get(id);
            data.uniqueKey = existing.uniqueKey;
            await table.update(id, data);
        } else {
            const identifier = cardType === 'vente' ? data.client : data.idCamion;
            data.uniqueKey = generateUniqueKey(cardType, identifier, data.date);
            await table.add(data);
        }
    }

    return isValid;
}



async function loadClientOptions() {
  const clientList = document.getElementById('client-list');
  if (!clientList) return;
  const clients = await db.ventes.orderBy('client').uniqueKeys();
  clientList.innerHTML = '';
  clients.forEach(client => {
    const option = document.createElement('option');
    option.value = client;
    clientList.appendChild(option);
  });
}

export async function loadEntriesForDate(dateString) {
    console.log(`Loading entries for date: ${dateString}`);
    if(syncStatusElement) syncStatusElement.textContent = `Chargement des entrées pour ${dateString}...`;

    const ressourcesContainer = document.getElementById('ressources-entries-container');
    if (ressourcesContainer) ressourcesContainer.innerHTML = '';
    const productionContainer = document.getElementById('production-entries-container');
    if (productionContainer) productionContainer.innerHTML = '';
    const ventesContainer = document.getElementById('ventes-entries-container');
    if (ventesContainer) ventesContainer.innerHTML = '';
    const deblaiContainer = document.getElementById('deblai-entries-container');
    if (deblaiContainer) deblaiContainer.innerHTML = '';

    clearTrackingSets();
    const dailyStockCheckOverrides = getDailyStockCheckOverrides();
    if (!dailyStockCheckOverrides[dateString]) {
        dailyStockCheckOverrides[dateString] = {};
    }

    const { ressources, production, ventes, deblai } = await getAllEntriesByDate(dateString);

    // CRITICAL: Populate selectedMachines with already-saved machines to prevent duplicates
    selectedMachines.clear();
    ressources.forEach(entry => {
        if (entry.machine) selectedMachines.add(entry.machine);
    });
    updateMachineDatalist();

    if (ressources.length === 0 && production.length === 0 && ventes.length === 0 && deblai.length === 0) {
        if(syncStatusElement) syncStatusElement.textContent = `Pas de données pour ${dateString}. Prêt pour une nouvelle saisie.`;
    } else {
        if(syncStatusElement) syncStatusElement.textContent = `Affichage des entrées pour ${dateString}.`;
    }

    // Restore UI population
    await loadRessourcesEntries(dateString, ressources);
    await loadProductionEntries(dateString, production);
    await loadVentesEntries(dateString, ventes);
    await loadDeblaiEntries(dateString, deblai);

    // After loading entries, refresh all stock cards for the new date
    RESOURCES.forEach(resource => {
        updateCardStockDisplay(resource, dateString);
    });

    // Update the new totals cards
    updateProductionTotals(production, dateString);
    updateVentesTotals(ventes, dateString);
    updateDeblaiTotals(deblai);
    updateClientBalanceCard('EHD', dateString, ventes);
}

async function updateProductionTotals(dailyEntries, currentDate) {
    const container = document.getElementById('production-totals-container');
    if (!container) return;

    // Calculate daily totals
    const concassageEntries = dailyEntries.filter(e => e.destination === 'Concassage');
    const extractionEntries = dailyEntries.filter(e => e.origine === 'Extraction');
    const stockageEntries = dailyEntries.filter(e => e.destination === 'Stockage');
    const stockOutEntries = dailyEntries.filter(e => e.origine === 'Stockage' && e.destination === 'Concassage');

    const totalWeightConcassage = concassageEntries.reduce((sum, e) => sum + (e.poids * (e.voyages || 1)), 0);
    const totalTripsConcassage = concassageEntries.reduce((sum, e) => sum + (e.voyages || 1), 0);
    const avgWeightConcassage = totalTripsConcassage > 0 ? totalWeightConcassage / totalTripsConcassage : 0;

    const totalWeightExtraction = extractionEntries.reduce((sum, e) => sum + (e.poids * (e.voyages || 1)), 0);
    const totalTripsExtraction = extractionEntries.reduce((sum, e) => sum + (e.voyages || 1), 0);
    const avgWeightExtraction = totalTripsExtraction > 0 ? totalWeightExtraction / totalTripsExtraction : 0;

    const totalWeightStockage = stockageEntries.reduce((sum, e) => sum + (e.poids * (e.voyages || 1)), 0);
    const totalWeightStockOut = stockOutEntries.reduce((sum, e) => sum + (e.poids * (e.voyages || 1)), 0);
    const stockRestant = totalWeightStockage - totalWeightStockOut;

    // Calculate cumul (running totals) using global cumul start date
    let cumulConcassage = 0;
    let cumulExtraction = 0;

    const startDate = await getEffectiveCumulStartDate();

    if (startDate) {
        const cumulEntries = await getProductionByDateRange(startDate, currentDate);
        const cumulConcassageEntries = cumulEntries.filter(e => e.destination === 'Concassage');
        const cumulExtractionEntries = cumulEntries.filter(e => e.origine === 'Extraction');

        cumulConcassage = cumulConcassageEntries.reduce((sum, e) => sum + (e.poids * (e.voyages || 1)), 0);
        cumulExtraction = cumulExtractionEntries.reduce((sum, e) => sum + (e.poids * (e.voyages || 1)), 0);
    }

    container.innerHTML = `
        <div class="stock-card">
            <span class="resource-name">Total Concassage</span>
            <div class="stock-value">${totalWeightConcassage.toFixed(2)} t</div>
            <div class="stock-value" style="font-weight: bold;">Cumul: ${cumulConcassage.toFixed(2)} t</div>
        </div>
        <div class="stock-card">
            <span class="resource-name">Poids Moyen Concassage</span>
            <div class="stock-value">${avgWeightConcassage.toFixed(2)} t</div>
        </div>
        <div class="stock-card">
            <span class="resource-name">Total Extraction</span>
            <div class="stock-value">${totalWeightExtraction.toFixed(2)} t</div>
            <div class="stock-value" style="font-weight: bold;">Cumul: ${cumulExtraction.toFixed(2)} t</div>
        </div>
        <div class="stock-card">
            <span class="resource-name">Poids Moyen Extraction</span>
            <div class="stock-value">${avgWeightExtraction.toFixed(2)} t</div>
        </div>
        <div class="stock-card">
            <span class="resource-name">Total Stockage</span>
            <div class="stock-value">${totalWeightStockage.toFixed(2)} t</div>
        </div>
        <div class="stock-card">
            <span class="resource-name">Stock Restant</span>
            <div class="stock-value">${stockRestant.toFixed(2)} t</div>
        </div>
    `;
}

function updateDeblaiTotals(entries) {
    const container = document.getElementById('deblai-totals-container');
    if (!container) return;

    const totalVoyages = entries.reduce((sum, entry) => sum + (entry.voyages || 1), 0);

    container.innerHTML = `
        <div class="stock-card">
            <span class="resource-name">Total Voyages Déblai</span>
            <div class="stock-value">${totalVoyages}</div>
        </div>
    `;
}

async function updateVentesTotals(dailyEntries, currentDate) {
    const container = document.getElementById('ventes-totals-container');
    if (!container) return;

    // Calculate daily totals
    const totalRevenue = dailyEntries.reduce((sum, entry) => sum + (entry.montantPaye || 0), 0);
    const salesCount = dailyEntries.length;
    const productTotals = dailyEntries.reduce((acc, entry) => {
        const quantity = parseFloat(entry.quantite) || 0;
        if (!acc[entry.produit]) {
            acc[entry.produit] = 0;
        }
        acc[entry.produit] += quantity;
        return acc;
    }, {});

    // Calculate grand total in tonnes (sum of all products)
    const totalTonnes = Object.values(productTotals).reduce((sum, quantity) => sum + (quantity * 1.5), 0);

    let productTotalsHtml = '';
    for (const [product, total] of Object.entries(productTotals)) {
        const totalInTons = total * 1.5;
        productTotalsHtml += `<div><strong>${product}:</strong> ${totalInTons.toFixed(2)} tonnes</div>`;
    }

    // Calculate cumul (running totals) using global cumul start date
    let cumulRevenue = 0;
    let cumulTonnes = 0;

    const startDate = await getEffectiveCumulStartDate();

    if (startDate) {
        const cumulEntries = await getVentesByDateRange(startDate, currentDate);
        cumulRevenue = cumulEntries.reduce((sum, entry) => sum + (entry.montantPaye || 0), 0);

        // Calculate cumulative tonnes
        const cumulProductTotals = cumulEntries.reduce((acc, entry) => {
            const quantity = parseFloat(entry.quantite) || 0;
            if (!acc[entry.produit]) {
                acc[entry.produit] = 0;
            }
            acc[entry.produit] += quantity;
            return acc;
        }, {});
        cumulTonnes = Object.values(cumulProductTotals).reduce((sum, quantity) => sum + (quantity * 1.5), 0);
    }

    container.innerHTML = `
        <div class="stock-card">
            <span class="resource-name">Revenu Total</span>
            <div class="stock-value">${totalRevenue.toLocaleString('fr-FR')} CFA</div>
            <div class="stock-value" style="font-weight: bold;">Cumul: ${cumulRevenue.toLocaleString('fr-FR')} CFA</div>
        </div>
        <div class="stock-card">
            <span class="resource-name">Total Tonnes</span>
            <div class="stock-value">${totalTonnes.toFixed(2)} t</div>
            <div class="stock-value" style="font-weight: bold;">Cumul: ${cumulTonnes.toFixed(2)} t</div>
        </div>
        <div class="stock-card">
            <span class="resource-name">Nb. Ventes</span>
            <div class="stock-value">${salesCount}</div>
        </div>
        <div class="stock-card" style="width: auto; min-width: 150px;">
            <span class="resource-name">Total par Produit</span>
            <div class="stock-value">${productTotalsHtml}</div>
        </div>
    `;
}

async function updateUnsyncedCount() {
    const badge = document.getElementById('unsynced-count-badge');
    if (!badge) return;

    const counts = await Promise.all([
        db.formEntries.where('syncStatus').equals(0).count(),
        db.production.where('syncStatus').equals(0).count(),
        db.ventes.where('syncStatus').equals(0).count(),
        db.stockChecks.where('syncStatus').equals(0).count(),
        db.deblai.where('syncStatus').equals(0).count(),
        db.clientPayments.where('syncStatus').equals(0).count()
    ]);

    const totalUnsynced = counts.reduce((sum, count) => sum + count, 0);

    badge.textContent = totalUnsynced;
    badge.style.display = totalUnsynced > 0 ? 'inline-block' : 'none';
}

// Function to get the 3 relevant gasoil livraison dates for navigation
async function getGasoilLivraisonNavigationDates(currentDate) {
    try {
        // Get all gasoil livraison dates
        const allGasoilDates = await db.formEntries
            .where('resource').equals('Gasoil')
            .and(entry => entry.machine.toLowerCase().startsWith('livraison'))
            .sortBy('date');

        if (allGasoilDates.length === 0) {
            return { current: null, previous: null, next: null };
        }

        const dates = allGasoilDates.map(entry => entry.date);

        // Find current period start (most recent date <= currentDate)
        const currentPeriodDate = dates
            .filter(date => date <= currentDate)
            .sort()
            .pop(); // Last (most recent) date <= currentDate

        // Find previous (date before current period start)
        const currentIndex = dates.indexOf(currentPeriodDate);
        const previousDate = currentIndex > 0 ? dates[currentIndex - 1] : null;

        // Find next (first date after currentDate)
        const nextDate = dates.find(date => date > currentDate) || null;

        return {
            current: currentPeriodDate,
            previous: previousDate,
            next: nextDate
        };
    } catch (error) {
        console.error('Error fetching gasoil livraison navigation dates:', error);
        return { current: null, previous: null, next: null };
    }
}

// Function to format date for display (month/day only)
function formatGasoilDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun',
                       'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
    return `${monthNames[date.getMonth()]} ${date.getDate()}`;
}

// Function to update gasoil livraison date badges
async function updateGasoilDateBadges(currentDate) {
    const indicator = document.getElementById('gasoil-dates-indicator');
    if (!indicator) return;

    const { current, previous, next } = await getGasoilLivraisonNavigationDates(currentDate);

    // Clear existing badges
    indicator.innerHTML = '';

    // Helper to create a badge
    const createBadge = (date, type, tooltip) => {
        if (!date) return;

        const badge = document.createElement('div');
        badge.className = `gasoil-badge ${type === 'current' ? 'current-period' : ''}`;
        badge.title = tooltip;

        const icon = document.createElement('span');
        icon.className = 'date-icon';
        icon.textContent = '📅';
        badge.appendChild(icon);

        const text = document.createElement('span');
        text.className = 'date-text';
        text.textContent = formatGasoilDate(date);
        badge.appendChild(text);

        // Click handler to navigate to date
        badge.addEventListener('click', () => {
            const dateInput = document.getElementById('entry-date');
            if (dateInput) {
                dateInput.value = date;
                // Trigger change event to reload data
                dateInput.dispatchEvent(new Event('change'));
            }
        });

        return badge;
    };

    // Helper to create GE35 hours badge (non-clickable)
    const createGE35Badge = async () => {
        // Use the global effective cumulative start date, not gasoil hard-coded date
        const startDate = await getEffectiveCumulStartDate();
        if (!startDate) return null;

        const formEntries = await getFormEntriesByDateRange(startDate, currentDate);
        const ge35Entries = formEntries
            .filter(e => e.machine === 'GE35')
            .sort((a,b) => new Date(a.date) - new Date(b.date)); // Sort by date

        if (ge35Entries.length === 0) return null;

        // SAFE numeric calculation - only use valid positive values
        let maxFinal = -Infinity;
        let minStarting = Infinity;
        let hasIncompleteData = false;

        ge35Entries.forEach(entry => {
            const debut = parseFloat(entry.compteurMoteurDebut);
            const fin = parseFloat(entry.compteurMoteurFin);

            // Only use valid, positive numbers (no || 0 fallbacks!)
            if (!isNaN(fin) && fin > 0) {
                maxFinal = Math.max(maxFinal, fin);
            } else if (!isNaN(debut) && debut > 0) {
                // Has valid debut but no/invalid fin
                hasIncompleteData = true;
            }

            if (!isNaN(debut) && debut > 0) {
                minStarting = Math.min(minStarting, debut);
            } else if (!isNaN(fin) && fin > 0) {
                // Has valid fin but no/invalid debut
                hasIncompleteData = true;
            }
        });

        const ge35Hours = maxFinal > minStarting ? maxFinal - minStarting : 0;

        if (ge35Hours === 0) return null; // Don't show if no hours

        const badge = document.createElement('div');
        badge.className = 'gasoil-badge ge35-hours';
        badge.style.cursor = 'default'; // Non-clickable

        // Set styling based on data completeness
        if (hasIncompleteData) {
            badge.title = 'Heures approximatives GE35 - données incomplètes depuis dernière livraison';
            badge.style.backgroundColor = '#fff3cd'; // Light yellow
            badge.style.borderColor = '#f0ad4e'; // Orange border
        } else {
            badge.title = 'Heures cumulées GE35 depuis dernière livraison';
            badge.style.backgroundColor = '#e8f5e8'; // Light green
            badge.style.borderColor = '#4caf50'; // Green border
        }

        const icon = document.createElement('span');
        icon.className = 'date-icon';
        icon.textContent = hasIncompleteData ? '⚠️' : '⚙️';
        badge.appendChild(icon);

        const text = document.createElement('span');
        text.className = 'date-text';
        text.textContent = hasIncompleteData
            ? `${ge35Hours.toFixed(1)} heures (approx)`
            : `${ge35Hours.toFixed(1)} heures cumul`;
        badge.appendChild(text);

        return badge;
    };

    // Add GE35 hours badge first (rightmost)
    const ge35Badge = await createGE35Badge(current);
    if (ge35Badge) indicator.appendChild(ge35Badge);

    // Add badges in order: previous, current, next
    if (previous) {
        const prevBadge = createBadge(previous, 'previous', 'Livraison précédente');
        if (prevBadge) indicator.appendChild(prevBadge);
    }

    if (current) {
        const currentBadge = createBadge(current, 'current', 'Début période cumul');
        if (currentBadge) indicator.appendChild(currentBadge);
    }

    if (next) {
        const nextBadge = createBadge(next, 'next', 'Livraison suivante');
        if (nextBadge) indicator.appendChild(nextBadge);
    }
}
