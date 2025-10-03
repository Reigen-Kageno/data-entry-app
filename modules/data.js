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

// Function to find the most recent gasoil livraison date before or on a specific date
export async function getGasoilLivraisonDateForPeriod(currentDate) {
    try {
        const gasoilLivraisons = await db.formEntries
            .where('resource').equals('Gasoil')
            .and(entry => entry.machine.toLowerCase().startsWith('livraison') && entry.date <= currentDate)
            .sortBy('date');

        if (gasoilLivraisons.length > 0) {
            return gasoilLivraisons[gasoilLivraisons.length - 1].date;
        }
        return null;
    } catch (error) {
        console.error('Error fetching gasoil livraison date for period:', error);
        return null;
    }
}

// Function to find the most recent gasoil livraison date (for backward compatibility)
export async function getLatestGasoilLivraisonDate() {
    try {
        const gasoilLivraisons = await db.formEntries
            .where('resource').equals('Gasoil')
            .and(entry => entry.machine.toLowerCase().startsWith('livraison'))
            .sortBy('date');

        if (gasoilLivraisons.length > 0) {
            return gasoilLivraisons[gasoilLivraisons.length - 1].date;
        }
        return null;
    } catch (error) {
        console.error('Error fetching latest gasoil livraison date:', error);
        return null;
    }
}

// Function to get production entries across a date range
export async function getProductionByDateRange(startDate, endDate) {
    try {
        const entries = await db.production
            .where('date')
            .between(startDate, endDate, true, true)
            .toArray();
        console.log(`Production entries from ${startDate} to ${endDate}:`, entries);
        return entries;
    } catch (error) {
        console.error(`Error fetching production entries from ${startDate} to ${endDate}:`, error);
        return [];
    }
}

// Function to get ventes entries across a date range
export async function getVentesByDateRange(startDate, endDate) {
    try {
        const entries = await db.ventes
            .where('date')
            .between(startDate, endDate, true, true)
            .toArray();
        console.log(`Ventes entries from ${startDate} to ${endDate}:`, entries);
        return entries;
    } catch (error) {
        console.error(`Error fetching ventes entries from ${startDate} to ${endDate}:`, error);
        return [];
    }
}

// Function to get earliest available data date (for fallback when no gasoil livraison exists)
export async function getEarliestDataDate() {
    try {
        const [productionDates, ventesDates] = await Promise.all([
            db.production.orderBy('date').first(),
            db.ventes.orderBy('date').first()
        ]);

        const dates = [productionDates?.date, ventesDates?.date].filter(date => date);
        return dates.length > 0 ? dates.sort()[0] : null;
    } catch (error) {
        console.error('Error fetching earliest data date:', error);
        return null;
    }
}

// Function to get formEntries across a date range
export async function getFormEntriesByDateRange(startDate, endDate) {
    try {
        const entries = await db.formEntries
            .where('date')
            .between(startDate, endDate, true, true)
            .toArray();
        console.log(`Form entries from ${startDate} to ${endDate}:`, entries);
        return entries;
    } catch (error) {
        console.error(`Error fetching form entries from ${startDate} to ${endDate}:`, error);
        return [];
    }
}

// Function to find all mining process start dates (returns multiple for badge display)
// Returns array of up to 3 most recent mining dates for navigation badges
export async function getMiningProcessStartDates(currentDate, limit = 3) {
    try {
        // Configurable comment keywords to handle variations like "debut minage" vs "début minage"
        const MINING_COMMENT_KEYWORDS = ['debut minage', 'début minage'];
        let allMiningDates = [];

        for (const keyword of MINING_COMMENT_KEYWORDS) {
            const miningEntries = await db.formEntries
                .where('machine').equals('FOR')  // Exact match since machine name is validated
                .and(entry => entry.notes && entry.notes.toLowerCase().includes(keyword))
                .sortBy('date');

            if (miningEntries.length > 0) {
                const dates = miningEntries.map(entry => entry.date);
                // Remove duplicates and add to collection
                allMiningDates = [...new Set([...allMiningDates, ...dates])].sort();
            }
        }

        // Return up to specified limit, most recent first
        const result = allMiningDates.slice(-limit).reverse();

        console.log(`Found ${result.length} mining start dates:`, result);
        if (result.length === 0) {
            console.warn('No mining process start dates found. Look for entries with machine="FOR" and notes containing mining keywords.');
        }
        return result;
    } catch (error) {
        console.error('Error fetching mining process start dates:', error);
        return [];
    }
}

// Function to find the most recent mining process start date (backward compatibility)
// For cumulative calculations - filters by date <= currentDate like gasoil does
export async function getMiningProcessStartDate(currentDate) {
    try {
        const MINING_COMMENT_KEYWORDS = ['debut minage', 'début minage'];
        let miningDates = [];

        for (const keyword of MINING_COMMENT_KEYWORDS) {
            const miningEntries = await db.formEntries
                .where('machine').equals('FOR')
                .and(entry => entry.notes && entry.notes.toLowerCase().includes(keyword) && entry.date <= currentDate)
                .sortBy('date');

            if (miningEntries.length > 0) {
                const dates = miningEntries.map(entry => entry.date);
                miningDates = [...new Set([...miningDates, ...dates])].sort();
            }
        }

        const result = miningDates.length > 0 ? miningDates[miningDates.length - 1] : null;
        return result;
    } catch (error) {
        console.error('Error fetching mining process start date:', error);
        return null;
    }
}

// Function to get mining navigation dates for badge display (similar to gasoil)
export async function getMiningLivraisonNavigationDates(currentDate) {
    try {
        // Get ALL mining dates for navigation (like gasoil livraison - no limit)
        const miningDates = (await getMiningProcessStartDates(currentDate)).sort();

        if (miningDates.length === 0) {
            return { current: null, previous: null, next: null, all: [] };
        }

        // Find current period start (most recent date <= currentDate)
        const currentPeriodDate = miningDates
            .filter(date => date <= currentDate)
            .sort()
            .pop(); // Last (most recent) date <= currentDate

        // Find previous (date before current period start)
        const currentIndex = miningDates.indexOf(currentPeriodDate);
        const previousDate = currentIndex > 0 ? miningDates[currentIndex - 1] : null;

        // Find next (first date after currentDate)
        const nextDate = miningDates.find(date => date > currentDate) || null;

        return {
            current: currentPeriodDate,
            previous: previousDate,
            next: nextDate,
            all: miningDates  // All available mining dates for potential use
        };
    } catch (error) {
        console.error('Error fetching mining navigation dates:', error);
        return { current: null, previous: null, next: null, all: [] };
    }
}
