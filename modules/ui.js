import { db } from './database.js';
import { RESOURCES } from './constants.js';
import { generateUUID } from './utils.js';
import { updateCardStockDisplay, promptForMeasuredStock, clearDailyStockCheckOverrides, getDailyStockCheckOverrides } from './stock.js';
import { getAllEntriesByDate, deleteEntryAndQueue } from './data.js';
import config from '../config.global.js';

// --- Module-scoped UI elements and shared data ---
let dateInput;
let machineList;
let resourceStockCardsContainer;
let syncStatusElement;
let addRessourceBtn;
let addProductionBtn;
let addVenteBtn;
let saveAllBtn;
let machineOptions = []; // This array holds the machine options for datalists
const selectedMachines = new Set(); // Tracks selected machines for the current date
const machineResourceSets = new Map(); // Map of machine elements to their selected resources
let masterDataInstance; // To hold the masterData manager instance
let isEditMode = false; // Global flag for edit mode

// --- Helper Function Definitions ---

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
            origine: '[name="origine"]',
            destination: '[name="destination"]',
            commentaire: '[name="commentaire"]'
        },
        defaults: {
            origine: 'Extraction',
            destination: 'Concassage'
        }
    };
    return createCard('production-card-template', entry, fieldConfig);
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

    card.classList.remove('status-new', 'status-saved', 'status-synced', 'card-readonly');
    if (isReadOnly) {
        card.classList.add('card-readonly');
        if (syncStatus === 1) {
            card.classList.add('status-synced');
        } else {
            card.classList.add('status-saved');
        }
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
    });

    saveAllBtn.addEventListener('click', async () => {
        const entryDateValue = dateInput.value;
        let changesMade = false;
        let allFormsValid = true;

        const containers = ['ressources-entries-container', 'production-entries-container', 'ventes-entries-container'];
        for (const containerId of containers) {
            const container = document.getElementById(containerId);
            const cards = container.querySelectorAll('.ressource-card, .production-card, .ventes-card');
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
}

async function saveCard(card, entryDate) {
    const cardType = card.classList.contains('ressource-card') ? 'ressource' :
                     card.classList.contains('production-card') ? 'production' :
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
        for (const row of newStateRows) {
            const resource = row.querySelector('select[name="resource"]').value;
            const quantity = parseFloat(row.querySelector('input[name="quantity"]').value);
            if (isNaN(quantity) || quantity <= 0 || !resource) continue;

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

    } else { // Production and Vente logic remains simpler
        let data;
        let table;
        if (cardType === 'production') {
            table = db.production;
            const idCamionInput = card.querySelector('[name="idCamion"]');
            const poidsInput = card.querySelector('[name="poids"]');
            data = {
                date: entryDate,
                idCamion: idCamionInput.value.trim(),
                poids: parseFloat(poidsInput.value),
                origine: card.querySelector('[name="origine"]').value,
                destination: card.querySelector('[name="destination"]').value,
                commentaire: card.querySelector('[name="commentaire"]').value.trim(),
                syncStatus: 0
            };
            if (!data.idCamion || isNaN(data.poids) || data.poids <= 0) isValid = false;
        } else { // vente
            table = db.ventes;
            const clientInput = card.querySelector('[name="client"]');
            const quantiteInput = card.querySelector('[name="quantite"]');
            data = {
                date: entryDate,
                client: clientInput.value.trim(),
                produit: card.querySelector('[name="produit"]').value,
                quantite: quantiteInput.value.trim(),
                montantPaye: parseFloat(card.querySelector('[name="montantPaye"]').value) || 0,
                commentaire: card.querySelector('[name="commentaire"]').value.trim(),
                syncStatus: 0
            };
            if (!data.client || !data.quantite) isValid = false;
        }

        if (!isValid) return false;

        if (id) {
            const existing = await table.get(id);
            data.uniqueKey = existing.uniqueKey;
            await table.update(id, data);
        } else {
            data.uniqueKey = cardType === 'production' ? `${data.idCamion}-${data.date}-${generateUUID()}` : `${data.client}-${data.produit}-${data.date}-${generateUUID()}`;
            await table.add(data);
        }
    }

    return isValid;
}

function toggleEditMode(isEditing) {
    const editDayBtn = document.getElementById('edit-day-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    const saveAllBtn = document.getElementById('save-all-btn');
    const allCards = document.querySelectorAll('.ressource-card, .production-card, .ventes-card');

    if (isEditing) {
        editDayBtn.textContent = 'Enregistrer les Modifications';
        editDayBtn.style.backgroundColor = '#4CAF50'; // Green for save
        saveAllBtn.style.display = 'none'; // Hide the main save button
        
        allCards.forEach(card => {
            // Only make saved cards editable. New cards are already editable.
            if (card.classList.contains('status-saved') || card.classList.contains('status-synced')) {
                setCardReadOnly(card, false, -1);
                card.style.border = '2px dashed #2196f3'; // Blue dashed border for editing
            }
        });
    } else {
        // This button click now effectively serves as the "Save All"
        saveAllBtn.click(); 
        
        editDayBtn.textContent = 'Modifier la Journée';
        editDayBtn.style.backgroundColor = '#2196f3'; // Blue for edit
        deleteSelectedBtn.style.display = 'none';
        saveAllBtn.style.display = 'inline-block';

        allCards.forEach(card => {
            card.style.border = ''; // Reset border
        });
    }
}


async function handleDeleteSelection() {
    const selectedCheckboxes = Array.from(document.querySelectorAll('.entry-checkbox:checked'));
    if (selectedCheckboxes.length === 0) return;

    if (confirm(`Êtes-vous sûr de vouloir supprimer les ${selectedCheckboxes.length} entrées sélectionnées ?`)) {
        for (const cb of selectedCheckboxes) {
            const card = cb.closest('.ressource-card, .production-card, .ventes-card');
            if (card) {
                const id = parseInt(card.dataset.id, 10);
                let tableName;
                if (card.classList.contains('ressource-card')) tableName = 'formEntries';
                else if (card.classList.contains('production-card')) tableName = 'production';
                else if (card.classList.contains('ventes-card')) tableName = 'ventes';

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

    clearTrackingSets();
    const dailyStockCheckOverrides = getDailyStockCheckOverrides();
    if (!dailyStockCheckOverrides[dateString]) {
        dailyStockCheckOverrides[dateString] = {};
    }

    const { ressources, production, ventes } = await getAllEntriesByDate(dateString);

    if (ressources.length === 0 && production.length === 0 && ventes.length === 0) {
        if(syncStatusElement) syncStatusElement.textContent = `Pas de données pour ${dateString}. Prêt pour une nouvelle saisie.`;
    } else {
        if(syncStatusElement) syncStatusElement.textContent = `Affichage des entrées pour ${dateString}.`;
    }

    await loadRessourcesEntries(dateString, ressources);
    await loadProductionEntries(dateString, production);
    await loadVentesEntries(dateString, ventes);

    for (const resource of RESOURCES) {
        await updateCardStockDisplay(resource, dateString);
    }
}

export function updateSyncStatusUI(isOnline, message) {
  const statusElement = document.getElementById('syncStatus');
  if (statusElement) {
    statusElement.textContent = `En ligne : ${isOnline} - ${message}`;
    statusElement.className = isOnline ? 'status-online' : 'status-offline';
  }
  console.log(`UI Sync Status: Online: ${isOnline} - ${message}`);
  updateSyncButtonState();
}

export function updateSyncButtonState() {
  const syncButton = document.getElementById('manual-sync-btn');
  if (syncButton) {
    syncButton.disabled = !navigator.onLine;
    syncButton.textContent = navigator.onLine ? 'Synchroniser Maintenant' : 'Hors ligne';
  }
}
