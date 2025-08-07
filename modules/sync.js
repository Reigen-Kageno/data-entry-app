import { db } from './database.js';
import { getToken } from './auth.js';
import config from '../config.global.js';
import { updateSyncStatusUI, loadEntriesForDate } from './ui.js';
import { getQueuedDeletions } from './data.js';

/**
 * All sync operations use uniqueKey as the primary identifier for entries.
 * This ensures data consistency and prevents duplicates both locally and on SharePoint.
 * syncStatus: 0 = not synced, 1 = synced
 */

// --- Data Refresh from Server ---
async function fetchAllSharePointListItems(token, listId) {
  let items = [];
  let nextLink;

  let url = `https://graph.microsoft.com/v1.0/sites/${config.sharePoint.siteId}/lists/${listId}/items?expand=fields`;

  do {
      const response = await fetch(nextLink || url, {
          headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to fetch SharePoint list ${listId}: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      items = items.concat(data.value);
      nextLink = data['@odata.nextLink'];
  } while (nextLink);

  return items;
}

export async function refreshAllDataFromServer() {
    if (!confirm("Êtes-vous sûr de vouloir actualiser les données ? Toutes les données locales non synchronisées seront perdues et remplacées par les données du serveur.")) {
        return;
    }

    updateSyncStatusUI(true, 'Actualisation des données depuis le serveur en cours...');

    try {
        const token = await getToken();
        if (!token) {
            throw new Error("Authentication token could not be acquired.");
        }

        // 1. Fetch all data from SharePoint
        console.log("Fetching data from SharePoint lists...");
        const [spFormEntries, spStockChecks, spVentes, spProduction, spClientPayments, spDeblai] = await Promise.all([
            fetchAllSharePointListItems(token, config.sharePoint.lists.formEntries),
            fetchAllSharePointListItems(token, config.sharePoint.lists.stockChecks),
            fetchAllSharePointListItems(token, config.sharePoint.lists.ventes),
            fetchAllSharePointListItems(token, config.sharePoint.lists.production),
            fetchAllSharePointListItems(token, config.sharePoint.lists.clientPayments),
            fetchAllSharePointListItems(token, config.sharePoint.lists.deblai)
        ]);
        console.log(`Fetched: ${spFormEntries.length} form entries, ${spStockChecks.length} stock checks, ${spVentes.length} ventes, ${spProduction.length} production, ${spClientPayments.length} client payments, ${spDeblai.length} deblai.`);

        // 2. Transform SharePoint data to Dexie format
        const formEntries = spFormEntries.map(item => ({
            uniqueKey: item.fields.Title,
            date: item.fields.Date.split('T')[0],
            machine: item.fields.Machine,
            zoneActivite: item.fields.Zoneactivit_x00e9_,
            resource: item.fields.Resource,
            quantity: parseFloat(item.fields.Quantity) || 0,
            compteurMoteurDebut: parseFloat(item.fields.CompteurMoteurDebut) || 0,
            compteurMoteurFin: parseFloat(item.fields.CompteurMoteurFin) || 0,
            notes: item.fields.Commentaire,
            sharepointId: item.id,
            syncStatus: 1
        }));

        const stockChecks = spStockChecks.map(item => ({
            resourceName: item.fields.ResourceName,
            date: item.fields.Date.split('T')[0],
            quantityOnHand: parseFloat(item.fields.QuantityOnHand) || 0,
            sharepointId: item.id,
            syncStatus: 1
        }));

        const ventes = spVentes.map(item => ({
            uniqueKey: item.fields.Title,
            date: item.fields.Date.split('T')[0],
            client: item.fields.Client,
            produit: item.fields.produit,
            quantite: item.fields.quantit_x00e9_,
            montantPaye: parseFloat(item.fields.Montantpay_x00e9__x0028_CFA_x002) || 0,
            commentaire: item.fields.Commentaire,
            sharepointId: item.id,
            syncStatus: 1
        }));

        const production = spProduction.map(item => ({
            uniqueKey: item.fields.Title,
            date: item.fields.Date.split('T')[0],
            idCamion: item.fields.IDCamion,
            poids: parseFloat(item.fields.Poids) || 0,
            origine: item.fields.Origine,
            destination: item.fields.Destination,
            commentaire: item.fields.Commentaire,
            sharepointId: item.id,
            syncStatus: 1
        }));

        const clientPayments = spClientPayments.map(item => ({
            uniqueKey: item.fields.Title,
            client: item.fields.client,
            date: item.fields.date.split('T')[0],
            amount: parseFloat(item.fields.amount) || 0,
            sharepointId: item.id,
            syncStatus: 1
        }));

        const deblai = spDeblai.map(item => ({
            uniqueKey: item.fields.Title,
            date: item.fields.date.split('T')[0],
            idCamion: item.fields.IDCamion,
            voyages: parseInt(item.fields.Voyages, 10) || 0,
            commentaire: item.fields.Commentaire,
            sharepointId: item.id,
            syncStatus: 1
        }));

        // 3. Clear local tables and bulk add new data
        console.log("Clearing local database and inserting new data...");
        await db.transaction('rw', db.formEntries, db.stockChecks, db.ventes, db.production, db.clientPayments, db.deblai, db.deletionsQueue, async () => {
            await Promise.all([
                db.formEntries.clear(),
                db.stockChecks.clear(),
                db.ventes.clear(),
                db.production.clear(),
                db.clientPayments.clear(),
                db.deblai.clear(),
                db.deletionsQueue.clear()
            ]);
            await Promise.all([
                db.formEntries.bulkAdd(formEntries),
                db.stockChecks.bulkAdd(stockChecks),
                db.ventes.bulkAdd(ventes),
                db.production.bulkAdd(production),
                db.clientPayments.bulkAdd(clientPayments),
                db.deblai.bulkAdd(deblai)
            ]);
        });

        console.log("Data refresh successful.");
        updateSyncStatusUI(true, 'Actualisation des données terminée avec succès.');

        // 4. Refresh the UI with the new data for the current date
        const dateInput = document.getElementById('entry-date');
        await loadEntriesForDate(dateInput.value);

        // 5. Update the unsynced items counter in the UI
        if (typeof import('./ui.js').then === 'function') {
            // Dynamic import for safety in case of circular deps
            (await import('./ui.js')).updateUnsyncedCount();
        } else if (window.updateUnsyncedCount) {
            window.updateUnsyncedCount();
        }

    } catch (error) {
        console.error("Failed to refresh data from server:", error);
        updateSyncStatusUI(true, `Erreur lors de l'actualisation : ${error.message}`);
    }
}


// --- Sync Logic ---
async function syncTable(token, dbTable, listName, createPayload, isStockCheck = false) {
    const queuedItems = await dbTable.where('syncStatus').equals(0).toArray();
    if (queuedItems.length === 0) return;

    console.log(`Syncing ${queuedItems.length} items for ${dbTable.name}`);

    for (const item of queuedItems) {
        try {
            const listEndpoint = `https://graph.microsoft.com/v1.0/sites/${config.sharePoint.siteId}/lists/${listName}/items`;
            const payload = createPayload(item);
            let spIdToUpdate = item.sharepointId;
            let method;
            let url;

            if (isStockCheck) {
                // Stock checks use the old method of PATCHing if sharepointId exists
                method = spIdToUpdate ? 'PATCH' : 'POST';
                url = spIdToUpdate ? `${listEndpoint}/${spIdToUpdate}` : listEndpoint;
            } else {
                // Other tables use the new uniqueKey method
                const filterUrl = `${listEndpoint}?$filter=fields/Title eq '${item.uniqueKey}'`;
                const searchResponse = await fetch(filterUrl, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (!searchResponse.ok) {
                    throw new Error(`SharePoint search failed: ${searchResponse.statusText}`);
                }

                const searchData = await searchResponse.json();
                const existingSpItem = searchData.value && searchData.value[0];

                spIdToUpdate = existingSpItem ? existingSpItem.id : item.sharepointId;
                method = spIdToUpdate ? 'PATCH' : 'POST';
                url = spIdToUpdate ? `${listEndpoint}/${spIdToUpdate}` : listEndpoint;
            }

            const response = await fetch(url, {
                method: method,
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                const responseData = method === 'POST' ? await response.json() : null;
                const finalSpId = spIdToUpdate || responseData.id;

                const updateData = {
                    syncStatus: 1,
                    sharepointId: finalSpId
                };

                if (isStockCheck) {
                    await dbTable.update([item.resourceName, item.date], updateData);
                } else {
                    await dbTable.update(item.id, updateData);
                }
                console.log(`Successfully synced item from ${dbTable.name}. SharePoint ID: ${finalSpId}`);
            } else {
                const errorText = await response.text();
                throw new Error(`SharePoint ${method} failed: ${response.status} - ${errorText}`);
            }

        } catch (error) {
            console.error(`Failed to sync item from ${dbTable.name}:`, error);
        }
    }
}

async function syncDeletions(token) {
    const queuedDeletions = await getQueuedDeletions();
    if (queuedDeletions.length === 0) return;

    console.log(`Syncing ${queuedDeletions.length} deletions.`);

    for (const item of queuedDeletions) {
        try {
            const listEndpoint = `https://graph.microsoft.com/v1.0/sites/${config.sharePoint.siteId}/lists/${item.listName}/items/${item.sharepointId}`;
            const response = await fetch(listEndpoint, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                await db.deletionsQueue.delete(item.id);
                console.log(`Successfully deleted item ${item.sharepointId} from SharePoint list ${item.listName}.`);
            } else {
                const errorText = await response.text();
                throw new Error(`SharePoint DELETE failed: ${response.status} - ${errorText}`);
            }
        } catch (error) {
            console.error(`Failed to sync deletion for item ${item.sharepointId}:`, error);
        }
    }
}

export async function syncQueuedEntries(showStatus = true, manualTrigger = false) {
    if (!navigator.onLine) {
        console.log("Offline. Sync deferred.");
        updateSyncStatusUI(false, 'Hors ligne. Les entrées sont en file d\'attente.');
        return;
    }

    try {
        let token = await getToken();
        if (!token) {
            console.error("Failed to acquire authentication token");
            updateSyncStatusUI(true, 'Échec de l\'authentification. Veuillez réessayer.');
            return;
        }

        console.log("Online. Attempting to sync entries...");
        if (showStatus) updateSyncStatusUI(true, manualTrigger ? 'Synchronisation manuelle : En cours...' : 'Synchronisation en cours...');

        // Define payload creation functions for each table
        const createFormEntryPayload = (entry) => ({
            fields: {
                Title: entry.uniqueKey,
                Date: `${entry.date}T00:00:00Z`,
                Machine: String(entry.machine),
                Zoneactivit_x00e9_: String(entry.zoneActivite),
                Resource: String(entry.resource),
                Quantity: String(entry.quantity),
                CompteurMoteurDebut: String(entry.compteurMoteurDebut || 0),
                CompteurMoteurFin: String(entry.compteurMoteurFin || 0),
                Commentaire: String(entry.notes || '')
            }
        });

        const createStockCheckPayload = (check) => ({
            fields: {
                Title: `${check.resourceName}-${check.date}`,
                Date: `${check.date}T00:00:00Z`,
                ResourceName: String(check.resourceName),
                QuantityOnHand: String(check.quantityOnHand)
            }
        });

        const createVentePayload = (vente) => ({
            fields: {
                Title: vente.uniqueKey,
                Date: `${vente.date}T00:00:00Z`,
                Client: String(vente.client),
                produit: String(vente.produit),
                quantit_x00e9_: String(vente.quantite),
                Montantpay_x00e9__x0028_CFA_x002: String(vente.montantPaye || ''),
                Commentaire: String(vente.commentaire || '')
            }
        });

        const createProductionPayload = (prod) => ({
            fields: {
                Title: prod.uniqueKey,
                Date: `${prod.date}T00:00:00Z`,
                IDCamion: String(prod.idCamion),
                Poids: String(prod.poids),
                Origine: String(prod.origine),
                Destination: String(prod.destination),
                Commentaire: String(prod.commentaire || '')
            }
        });

        const createClientPaymentPayload = (payment) => ({
            fields: {
                Title: payment.uniqueKey,
                client: String(payment.client),
                date: `${payment.date}T00:00:00Z`,
                amount: String(payment.amount)
            }
        });

        const createDeblaiPayload = (deblai) => ({
            fields: {
                Title: deblai.uniqueKey,
                date: `${deblai.date}T00:00:00Z`,
                idCamion: String(deblai.idCamion),
                voyages: String(deblai.voyages),
                commentaire: String(deblai.commentaire || '')
            }
        });

        // Run sync for all tables and deletions
        await Promise.all([
            syncTable(token, db.formEntries, config.sharePoint.lists.formEntries, createFormEntryPayload),
            syncTable(token, db.stockChecks, config.sharePoint.lists.stockChecks, createStockCheckPayload, true),
            syncTable(token, db.ventes, config.sharePoint.lists.ventes, createVentePayload),
            syncTable(token, db.production, config.sharePoint.lists.production, createProductionPayload),
            syncTable(token, db.clientPayments, config.sharePoint.lists.clientPayments, createClientPaymentPayload),
            syncTable(token, db.deblai, config.sharePoint.lists.deblai, createDeblaiPayload),
            syncDeletions(token)
        ]);

        // Final status update
        const remainingEntries = await db.formEntries.where('syncStatus').equals(0).count();
        const remainingStockChecks = await db.stockChecks.where('syncStatus').equals(0).count();
        const remainingVentes = await db.ventes.where('syncStatus').equals(0).count();
        const remainingProduction = await db.production.where('syncStatus').equals(0).count();
        const remainingClientPayments = await db.clientPayments.where('syncStatus').equals(0).count();
        const remainingDeblai = await db.deblai.where('syncStatus').equals(0).count();
        const totalRemaining = remainingEntries + remainingStockChecks + remainingVentes + remainingProduction + remainingClientPayments + remainingDeblai;

        if (totalRemaining > 0) {
            const msg = `Tentative de synchronisation. ${totalRemaining} entrées restantes.`;
            console.log(msg);
            updateSyncStatusUI(true, msg);
        } else {
            console.log(manualTrigger ? "Manual Sync: All data synced." : "All data synced.");
            updateSyncStatusUI(true, 'Synchronisation complète. Toutes les données sont synchronisées.');
        }

        // Refresh the UI to show the new sync status
        const dateInput = document.getElementById('entry-date');
        if (dateInput && dateInput.value) {
            await loadEntriesForDate(dateInput.value);
        }
        
        (await import('./ui.js')).updateUnsyncedCount();

    } catch (error) {
        console.error('Network or other sync error:', error);
        if (showStatus) updateSyncStatusUI(true, `La synchronisation a échoué : ${error.message}`);
    }
}
