import { db } from './database.js';
import { generateUniqueKey } from './utils.js';

/**
 * Checks if a form entry with the same uniqueKey already exists.
 * @param {string} uniqueKey
 * @returns {Promise<boolean>} true if duplicate exists
 */
export async function formEntryExists(uniqueKey) {
  const entry = await db.formEntries.where({ uniqueKey }).first();
  return !!entry;
}

/**
 * Adds a new form entry, enforcing uniqueKey uniqueness.
 * @param {Object} entryData
 * @returns {Promise<number|null>} id if added, null if duplicate
 */
export async function addFormEntry(entryData) {
  try {
    if (await formEntryExists(entryData.uniqueKey)) {
      console.warn(`Duplicate uniqueKey detected: ${entryData.uniqueKey}`);
      return null;
    }
    const dataToAdd = {
      ...entryData,
      syncStatus: 0
    };
    delete dataToAdd.status;
    const id = await db.formEntries.add(dataToAdd);
    console.log(`Form entry added with id ${id}`);
    return id;
  } catch (error) {
    console.error("Error adding form entry:", error);
    return null;
  }
}

/**
 * Gets all unsynced form entries.
 * @returns {Promise<Array>}
 */
export async function getQueuedEntries() {
  try {
    const entries = await db.formEntries.where('syncStatus').equals(0).toArray();
    console.log("Queued entries:", entries);
    return entries;
  } catch (error) {
    console.error("Error fetching queued entries:", error);
    return [];
  }
}

/**
 * Updates an entry's sync status.
 * @param {number} id
 * @param {boolean} isSynced
 * @returns {Promise<number>}
 */
export async function updateEntryStatus(id, isSynced) {
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
    return 0;
  }
}

/**
 * Deletes an entry from a table.
 * @param {string} tableName
 * @param {number} id
 */
export async function deleteEntry(tableName, id) {
  try {
    await db[tableName].delete(id);
    console.log(`Entry ${id} deleted from ${tableName}.`);
  } catch (error) {
    console.error(`Error deleting entry ${id} from ${tableName}:`, error);
  }
}

/**
 * Queues an entry for deletion on SharePoint and deletes locally.
 * @param {string} tableName
 * @param {string} listName
 * @param {number} id
 */
export async function deleteEntryAndQueue(tableName, listName, id) {
    try {
        const entry = await db[tableName].get(id);
        if (entry && entry.sharepointId) {
            await db.deletionsQueue.add({
                sharepointId: entry.sharepointId,
                listName: listName
            });
            console.log(`Entry ${entry.sharepointId} from ${listName} queued for deletion.`);
        }
        await deleteEntry(tableName, id);
    } catch (error) {
        console.error(`Error queuing deletion for entry ${id} from ${tableName}:`, error);
    }
}

export async function getQueuedDeletions() {
    try {
        return await db.deletionsQueue.toArray();
    } catch (error) {
        console.error("Error fetching queued deletions:", error);
        return [];
    }
}

// Function to get all entries for a specific date
export async function getRessourcesByDate(dateString) {
  try {
    const entries = await db.formEntries.where('date').equals(dateString).toArray();
    console.log(`Ressource entries for date ${dateString}:`, entries);
    return entries;
  } catch (error) {
    console.error(`Error fetching ressource entries for date ${dateString}:`, error);
    return [];
  }
}

export async function getProductionByDate(dateString) {
  try {
    const entries = await db.production.where('date').equals(dateString).toArray();
    console.log(`Production entries for date ${dateString}:`, entries);
    return entries;
  } catch (error) {
    console.error(`Error fetching production entries for date ${dateString}:`, error);
    return [];
  }
}

export async function getVentesByDate(dateString) {
  try {
    const entries = await db.ventes.where('date').equals(dateString).toArray();
    console.log(`Ventes entries for date ${dateString}:`, entries);
    return entries;
  } catch (error) {
    console.error(`Error fetching ventes entries for date ${dateString}:`, error);
    return [];
  }
}

export async function getDeblaiByDate(dateString) {
  try {
    const entries = await db.deblai.where('date').equals(dateString).toArray();
    console.log(`Deblai entries for date ${dateString}:`, entries);
    return entries;
  } catch (error) {
    console.error(`Error fetching deblai entries for date ${dateString}:`, error);
    return [];
  }
}

export async function getAllEntriesByDate(dateString) {
    const [ressources, production, ventes, deblai] = await Promise.all([
        getRessourcesByDate(dateString),
        getProductionByDate(dateString),
        getVentesByDate(dateString),
        getDeblaiByDate(dateString)
    ]);
    return { ressources, production, ventes, deblai };
}

export async function saveClientPayment(paymentData) {
    try {
        await db.transaction('rw', db.clientPayments, async () => {
            const existingPayment = await db.clientPayments.where({
                client: paymentData.client,
                date: paymentData.date
            }).first();

            const dataToSave = {
                ...paymentData,
                syncStatus: 0,
                uniqueKey: existingPayment ? existingPayment.uniqueKey : generateUniqueKey('clientPayment', paymentData.client, paymentData.date)
            };

            if (existingPayment) {
                await db.clientPayments.update(existingPayment.id, dataToSave);
                console.log(`Client payment updated for ${paymentData.client} on ${paymentData.date}`);
            } else {
                await db.clientPayments.add(dataToSave);
                console.log(`Client payment added for ${paymentData.client} on ${paymentData.date}`);
            }
        });
    } catch (error) {
        console.error("Error saving client payment:", error);
    }
}

export async function getClientPayments(client) {
    try {
        return await db.clientPayments.where('client').equals(client).toArray();
    } catch (error) {
        console.error(`Error fetching payments for client ${client}:`, error);
        return [];
    }
}

export async function getClientPaymentsByDate(dateString) {
    try {
        return await db.clientPayments.where('date').equals(dateString).toArray();
    } catch (error) {
        console.error(`Error fetching client payments for date ${dateString}:`, error);
        return [];
    }
}
