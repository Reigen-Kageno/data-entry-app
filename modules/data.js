import { db } from './database.js';

// Example: Function to add a new form entry
export async function addFormEntry(entryData) {
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

// Example: Function to update an entry's sync status
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
  }
}

// Example: Function to delete an entry (e.g., after successful sync)
export async function deleteEntry(tableName, id) {
  try {
    await db[tableName].delete(id);
    console.log(`Entry ${id} deleted from ${tableName}.`);
  } catch (error) {
    console.error(`Error deleting entry ${id} from ${tableName}:`, error);
  }
}

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

export async function getAllEntriesByDate(dateString) {
    const [ressources, production, ventes] = await Promise.all([
        getRessourcesByDate(dateString),
        getProductionByDate(dateString),
        getVentesByDate(dateString)
    ]);
    return { ressources, production, ventes };
}
