import { db } from './database.js';
import { RESOURCES } from './constants.js';
import { generateUUID } from './utils.js';
import { updateCardStockDisplay, promptForMeasuredStock, clearDailyStockCheckOverrides, getDailyStockCheckOverrides } from './stock.js';
import { getAllEntriesByDate, deleteEntryAndQueue } from './data.js';
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
let isEditMode = false; // Global flag for edit mode

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

    card.querySelectorAll('.add-resource, .remove-resource').forEach(btn => {
        btn.style.display = isReadOnly ? 'none' : 'block';
    });

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
    const editDayBtn = document.getElementById('edit-day-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    
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
            updateUnsyncedCount();
        }
    });

    dateInput.addEventListener('change', (e) => {
        clearDailyStockCheckOverrides();
        clearTrackingSets();
        loadEntriesForDate(e.target.value);
    });

    editDayBtn.addEventListener('click', () => {
        isEditMode = !isEditMode;
        toggleEditMode(isEditMode);
    });

    deleteSelectedBtn.addEventListener('click', () => {
        handleDeleteSelection();
    });

    // Add a single listener for all checkboxes to update the delete button state
    document.body.addEventListener('click', (e) => {
        if (e.target.matches('.entry-checkbox')) {
            const anyChecked = document.querySelector('.entry-checkbox:checked');
            deleteSelectedBtn.style.display = anyChecked ? 'inline-block' : 'none';
        }
    });

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
    updateSyncButtonState();
    updateUnsyncedCount();
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
                uniqueKey: `${machineName}-${resource}-${entryDate}`
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
                uniqueKey: `${machineName}-${entryDate}`
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
                quantite: quantiteInput.value.trim(),
                montantPaye: parseFloat(montantPayeInput.value) || 0,
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
            // Use a ternary operator to select the correct identifier
            const identifier = cardType === 'vente' ? data.client : data.idCamion;
            data.uniqueKey = `${cardType}-${identifier}-${data.date}-${generateUUID()}`;
            await table.add(data);
        }
    }

    return isValid;
}

function toggleEditMode(isEditing) {
    const editDayBtn = document.getElementById('edit-day-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    const saveAllBtn = document.getElementById('save-all-btn');
    const allCards = document.querySelectorAll('.ressource-card, .production-card, .ventes-card, .deblai-card');

    if (isEditing) {
        editDayBtn.textContent = 'Enregistrer les Modifications';
        editDayBtn.style.backgroundColor = '#4CAF50';
        saveAllBtn.style.display = 'none';
        allCards.forEach(card => {
            // Only allow editing for unsynced cards
            if (card.classList.contains('status-synced')) {
                setCardReadOnly(card, true, 1); // keep synced cards read-only
            } else {
                setCardReadOnly(card, false, -1);
                card.style.border = '2px dashed #2196f3';
            }
        });
    } else {
        saveAllBtn.click();
        editDayBtn.textContent = 'Modifier la Journée';
        editDayBtn.style.backgroundColor = '#2196f3';
        deleteSelectedBtn.style.display = 'none';
        saveAllBtn.style.display = 'inline-block';
        allCards.forEach(card => {
            card.style.border = '';
        });
    }

}
async function handleDeleteSelection() {
    const selectedCheckboxes = Array.from(document.querySelectorAll('.entry-checkbox:checked'));
    if (selectedCheckboxes.length === 0) return;

    if (confirm(`Êtes-vous sûr de vouloir supprimer les ${selectedCheckboxes.length} entrées sélectionnées ?`)) {
        for (const cb of selectedCheckboxes) {
            const card = cb.closest('.ressource-card, .production-card, .ventes-card, .deblai-card');
            if (card) {
                const id = parseInt(card.dataset.id, 10);
                let tableName;
                if (card.classList.contains('ressource-card')) {
                    tableName = 'formEntries';
                } else if (card.classList.contains('production-card')) {
                    tableName = 'production';
                } else if (card.classList.contains('ventes-card')) {
                    tableName = 'ventes';
                } else if (card.classList.contains('deblai-card')) {
                    tableName = 'deblai';
                }

                if (id && tableName) {
                    const listName = config.sharePoint.lists[tableName];
                    await deleteEntryAndQueue(tableName, listName, id);
                }
            }
        }
        await loadEntriesForDate(dateInput.value);
    }
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
    updateProductionTotals(production);
    updateVentesTotals(ventes);
    updateDeblaiTotals(deblai);
    updateClientBalanceCard('EHD', dateString, ventes);
}

function updateProductionTotals(entries) {
    const container = document.getElementById('production-totals-container');
    if (!container) return;

    const concassageEntries = entries.filter(e => e.destination === 'Concassage');
    const extractionEntries = entries.filter(e => e.origine === 'Extraction');
    const stockageEntries = entries.filter(e => e.destination === 'Stockage');
    const stockOutEntries = entries.filter(e => e.origine === 'Stockage' && e.destination === 'Concassage');

    const totalWeightConcassage = concassageEntries.reduce((sum, e) => sum + (e.poids * (e.voyages || 1)), 0);
    const totalTripsConcassage = concassageEntries.reduce((sum, e) => sum + (e.voyages || 1), 0);
    const avgWeightConcassage = totalTripsConcassage > 0 ? totalWeightConcassage / totalTripsConcassage : 0;

    const totalWeightExtraction = extractionEntries.reduce((sum, e) => sum + (e.poids * (e.voyages || 1)), 0);
    const totalTripsExtraction = extractionEntries.reduce((sum, e) => sum + (e.voyages || 1), 0);
    const avgWeightExtraction = totalTripsExtraction > 0 ? totalWeightExtraction / totalTripsExtraction : 0;

    const totalWeightStockage = stockageEntries.reduce((sum, e) => sum + (e.poids * (e.voyages || 1)), 0);
    const totalWeightStockOut = stockOutEntries.reduce((sum, e) => sum + (e.poids * (e.voyages || 1)), 0);
    const stockRestant = totalWeightStockage - totalWeightStockOut;

    container.innerHTML = `
        <div class="stock-card">
            <span class="resource-name">Total Concassage</span>
            <div class="stock-value">${totalWeightConcassage.toFixed(2)} t</div>
        </div>
        <div class="stock-card">
            <span class="resource-name">Poids Moyen Concassage</span>
            <div class="stock-value">${avgWeightConcassage.toFixed(2)} t</div>
        </div>
        <div class="stock-card">
            <span class="resource-name">Total Extraction</span>
            <div class="stock-value">${totalWeightExtraction.toFixed(2)} t</div>
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

function updateVentesTotals(entries) {
    const container = document.getElementById('ventes-totals-container');
    if (!container) return;

    const totalRevenue = entries.reduce((sum, entry) => sum + (entry.montantPaye || 0), 0);
    const salesCount = entries.length;
    const productTotals = entries.reduce((acc, entry) => {
        const quantity = parseFloat(entry.quantite) || 0;
        if (!acc[entry.produit]) {
            acc[entry.produit] = 0;
        }
        acc[entry.produit] += quantity;
        return acc;
    }, {});

    let productTotalsHtml = '';
    for (const [product, total] of Object.entries(productTotals)) {
        const totalInTons = total * 1.5;
        productTotalsHtml += `<div><strong>${product}:</strong> ${totalInTons.toFixed(2)} tonnes</div>`;
    }

    container.innerHTML = `
        <div class="stock-card">
            <span class="resource-name">Revenu Total</span>
            <div class="stock-value">${totalRevenue.toLocaleString('fr-FR')} CFA</div>
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
