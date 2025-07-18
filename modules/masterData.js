import { getToken, graphConfig } from './auth.js'; // Use getToken directly
import config from '../config.global.js'; // Import global config for SharePoint list IDs

class MasterDataManager {
    constructor(db) {        this.db = db;
        this.machines = [];
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;

        // First, load from IndexedDB. This is fast and ensures the app can start.
        await this.loadFromCache();
        this.initialized = true; // Mark as initialized so the app can proceed
        
        // Then, trigger a refresh from SharePoint in the background if online.
        // We don't await this, so it doesn't block the UI.
        if (navigator.onLine) {
            this.refreshFromSharePoint().then(refreshed => {
                if (refreshed) {
                    console.log("Background refresh of master data successful.");
                    // Optionally, trigger an event to update the UI if needed
                    window.dispatchEvent(new CustomEvent('master-data-refreshed'));
                } else {
                    console.warn("Background refresh of master data failed.");
                }
            });
        }
    }

    async loadFromCache() {
        this.machines = await this.db.machines.toArray();
        console.log(`Loaded from cache: ${this.machines.length} machines`);
    }

    async refreshFromSharePoint() {
        console.log('MasterDataManager: Attempting to refresh machine list from SharePoint.');
        let attempt = 0;
        const maxRetries = 3;
        const retryDelay = 2000; // 2 second

            while (attempt <= maxRetries) {
            try {
                console.log(`MasterDataManager: Attempt ${attempt + 1} to fetch machines.`);
                const token = await getToken();
                if (!token) {
                    throw new Error('MasterDataManager: Failed to get authentication token for machine list.');
                }

                // Use config from config.global.js directly for consistency with original app.js
                const endpoint = new URL(`https://graph.microsoft.com/v1.0/sites/${config.sharePoint.siteId}/lists/${config.sharePoint.lists.machines}/items`);
                endpoint.searchParams.append('expand', 'fields');
                // Select fields based on original app.js and schema requirements
                endpoint.searchParams.append('select', 'id,fields/ID_x0020_Machine,fields/Title,fields/Machines,fields/Lieu,fields/TypeMachine,fields/Active');

                console.log('MasterDataManager: Fetching machines from endpoint:', endpoint.toString());

                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

                const response = await fetch(endpoint.toString(), {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json',
                    },
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`MasterDataManager: HTTP error! status: ${response.status}, message: ${errorText}`);
                }

                const data = await response.json();
                console.log('MasterDataManager: Received machine data:', data.value ? `${data.value.length} items` : 'No data.value');

                if (!data.value || !Array.isArray(data.value)) {
                     // If data.value is an empty array, it's a valid response (empty list)
                    if (data.value && data.value.length === 0) {
                        console.log("MasterDataManager: SharePoint returned an empty list of machines. Clearing local data.");
                        await this.db.machines.clear();
                        this.machines = [];
                        return true; // Success, list is empty
                    }
                    throw new Error('MasterDataManager: Invalid response format from SharePoint: data.value is not an array.');
                }

                const newMachines = data.value.map(item => ({
                    sharepointId: item.id, // Use Graph item ID as sharepointId
                    idMachine: item.fields.ID_x0020_Machine || item.fields.Title,
                    displayName: item.fields.TypeMachine || item.fields.Title, // Prefer TypeMachine, fallback to Title
                    location: item.fields.Lieu || '',
                    machineType: item.fields.TypeMachine || '',
                    active: item.fields.Active == 1 ? 1 : 0, // SharePoint 'Active' column is 1 for true, 0 for false.
                })).filter(m => m.idMachine); // Ensure idMachine is present

                await this.db.transaction('rw', this.db.machines, async () => {
                    await this.db.machines.clear();
                    if (newMachines.length > 0) {
                        await this.db.machines.bulkPut(newMachines);
                    }
                });
                this.machines = newMachines; // Update in-memory cache

                console.log(`MasterDataManager: Refreshed from SharePoint: ${this.machines.length} machines loaded.`);
                return true; // Success
            } catch (error) {
                console.error(`MasterDataManager: Error refreshing machine list (attempt ${attempt + 1}):`, error.message);
                attempt++;
                if (attempt <= maxRetries) {
                    console.log(`MasterDataManager: Retrying in ${retryDelay / 1000} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, retryDelay));
                } else {
                    console.error("MasterDataManager: Max retries reached. Failed to refresh machine list from SharePoint.");
                    return false; // Failure after all retries
                }
            }
        }

     return false; // Should only be reached if maxRetries is 0 or less.

    }

    getMachines(activeOnly = true) {
        return activeOnly
            ? this.machines.filter(m => m.active)
            : this.machines;
    }

    findMachineByIdMachine(idMachine) {
        return this.machines.find(m => m.idMachine === idMachine);
    }
}

export default MasterDataManager;
