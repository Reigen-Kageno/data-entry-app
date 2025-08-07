# SOECO Basalt Site Data Entry Application - Architecture Overview

This document provides an overview of the application's architecture, key modules, and data flow, building upon the core requirements outlined in `PROJECT_CHARTER.md`. It aims to provide essential context for developers and automated agents working with the codebase.

## 1. Core Architectural Principles

*   **Offline-First**: The application prioritizes local data storage and functionality, with synchronization occurring opportunistically when connectivity is available.
*   **Separation of Concerns**: Modules are designed with distinct responsibilities to enhance maintainability and reduce coupling.
*   **Centralized Data Management**: Master data (like machine lists) is managed by a dedicated service.
*   **Robustness**: Network operations include retry mechanisms and timeouts.

## 2. Key Modules and Their Responsibilities

This section details the role of each primary JavaScript file in the application, which has been refactored into a modular architecture.

*   **`app.js` (Application Core)**
    *   **Primary Role**: Serves as the main entry point for the application. It initializes the necessary modules and orchestrates the overall application startup sequence.
    *   **Orchestration**: Coordinates the initialization of the database, master data, and UI modules.
    *   **Event Handling**: Manages global event listeners for online/offline status.

*   **`modules/` (Directory for all core logic modules)**

    *   **`database.js` (Database Manager)**
        *   **Primary Role**: Defines and manages the IndexedDB (Dexie.js) database schema.
        *   **Responsibilities**: Exports the `db` instance for use in other modules.

    *   **`ui.js` (UI Manager)**
        *   **Primary Role**: Manages all aspects of the user interface.
        *   **Responsibilities**: Initializes all UI components, handles DOM manipulation, manages event listeners for UI elements (buttons, forms, etc.), and creates/updates the various data entry cards. It does **not** directly access the database; instead, it relies on the `data.js` module for all data retrieval.

    *   **`sync.js` (Synchronization Manager)**
        *   **Primary Role**: Handles all data synchronization with the SharePoint server.
        *   **Responsibilities**: Contains the logic for fetching data from SharePoint, pushing local changes to the server, and handling the full data refresh process.

    *   **`stock.js` (Stock Manager)**
        *   **Primary Role**: Manages all logic related to resource stock levels.
        *   **Responsibilities**: Calculates current stock levels, handles stock check overrides, and updates the stock display cards.

    *   **`data.js` (Data Access Layer)**
        *   **Primary Role**: Provides a centralized and simplified interface for all database CRUD (Create, Read, Update, Delete) operations. This is the **only** module that should directly query the database for application data.
        *   **Responsibilities**: Contains functions for fetching all entry types for a given date (`getAllEntriesByDate`), as well as adding, retrieving, and deleting specific entries from the local database tables.

    *   **`utils.js` (Utility Functions)**
        *   **Primary Role**: Contains shared helper functions used across the application.
        *   **Responsibilities**: Currently includes a `generateUUID` function.

    *   **`balance.js` (Balance Manager)**
        *   **Primary Role**: Manages all logic related to client balances.
        *   **Responsibilities**:  
            *   Calculates client balances and formats values for display.  
            *   Handles creation/editing of **payment** entries **via the `data.js` layer (no direct IndexedDB calls)**.  
            *   Updates the balance display card and emits UI events when balances change.

        *   **`masterData.js` (Master Data Manager)**    *   **Primary Role**: **Solely responsible for managing master data, specifically the machine list.**
    *   **Initialization (`initialize()`):**
        *   Loads existing machine data from IndexedDB cache.
        *   If online, performs a **single, robust fetch** of the latest machine list from SharePoint.
        *   Handles retries (up to 3 attempts with 2-second delays) and timeouts (30 seconds) for SharePoint requests.
        *   Transforms raw SharePoint data into the application's `machines` table schema.
        *   Updates the IndexedDB `machines` table and its internal in-memory cache.
    *   **Data Provision (`getMachines()`):** Provides the cached machine list to UI components (e.g., `ui.js`'s `loadMachineOptions`).
    *   **Authentication**: Acquires necessary tokens using `getToken()` from `auth.js`.

*   **`auth.js` (Authentication Manager)**
    *   **Primary Role**: Manages all Microsoft Authentication Library (MSAL) related operations.
    *   **Token Acquisition (`getToken()`):** Handles silent token acquisition and interactive login flows (redirects) to obtain OAuth 2.0 access tokens for Microsoft Graph API.
    *   **Configuration**: Uses `config.global.js` for MSAL client IDs, authorities, and scopes.
    *   **No Data Fetching**: **Crucially, this module does NOT perform any data fetching from SharePoint directly.** It only provides the authentication token.

*   **`config.global.js` (Global Configuration)**
    *   **Primary Role**: Centralized repository for all application-wide configuration settings.
    *   **Contents**: Includes MSAL configuration (client ID, tenant ID, redirect URI), SharePoint site and list IDs (for machines, form entries, stock checks), and API scopes.
    *   **Environment-Specific**: Designed to be replaced with production values during deployment (as indicated in its comments).

*   **`service-worker.js` (Offline Caching Strategy)**
    *   **Primary Role**: Implements the Progressive Web App (PWA) caching strategy for offline access.
    *   **Caching**: Caches static assets (`index.html`, JS files, icons, and local libraries) and intercepts network requests to serve content from cache when offline.
    *   **Exclusions**: Explicitly avoids caching API calls to SharePoint or authentication endpoints.

*   **`libs/` (Local Libraries Directory)**
    *   **Primary Role**: Stores local copies of third-party JavaScript libraries (e.g., `dexie.min.js`, `msal-browser.min.js`).
    *   **Offline-First**: Ensures the application's core dependencies are always available, even when offline, by avoiding reliance on external CDNs.
    *   **Version Control**: This directory **must** be committed to the repository to ensure the application functions correctly when deployed.

## 3. Key Data Flows

### 3.1. Application Startup & Machine List Loading

This is a critical flow demonstrating the separation of concerns:

1.  **`db.open().then(...)` (in `app.js`):** The application starts by opening the IndexedDB.
2.  **`masterData.initialize()` (in `app.js`):** Once the DB is open, `masterData.initialize()` is called.
    *   It first loads any existing machine data from the local `db.machines` table (cache).
    *   If `navigator.onLine` is true, it then calls `masterData.refreshFromSharePoint()`.
        *   `refreshFromSharePoint()` obtains a token via `getToken()` from `auth.js`.
        *   It then fetches the latest machine list from SharePoint (with retries/timeout).
        *   The fetched data is transformed and used to clear and repopulate the `db.machines` table, and update `masterData`'s internal memory cache.
3.  **`initializeAppUI()` (in `app.js`):** After `masterData` is initialized, `initializeAppUI()` is called.
    *   It calls `loadMachineOptions()`.
    *   `loadMachineOptions()` retrieves the machine list directly from `masterData.getMachines()`. This ensures the UI always gets the most up-to-date data that `masterData` has (either from cache or the fresh SharePoint fetch).
    *   The UI's machine datalist is then populated.

### 3.2. Daily Data Loading

This flow describes how the UI loads all necessary data for a selected date, demonstrating the new, centralized data access pattern.

1.  **Date Selection**: The user selects a date in the UI.
2.  **UI Request**: The `loadEntriesForDate` function in `ui.js` is triggered.
3.  **Centralized Data Fetch**: `loadEntriesForDate` makes a single call to `getAllEntriesByDate(dateString)` in the `data.js` module.
4.  **Database Queries**: `getAllEntriesByDate` executes parallel queries to fetch data from the `formEntries`, `production`, `ventes`, and `deblai` tables in IndexedDB for the given date.
5.  **Data Return**: The `data.js` function returns an object containing arrays of all four entry types (e.g., `{ ressources: [...], production: [...], ventes: [...], deblai: [...] }`).
6.  **UI Population**: Back in `ui.js`, the `loadEntriesForDate` function receives this object and passes the relevant data to its helper functions (`loadRessourcesEntries`, `loadProductionEntries`, `loadVentesEntries`, `loadDeblaiEntries`) to populate the UI with the appropriate cards.

### 3.3. Form Saving and Editing

The application uses a robust "upsert" (update/insert) logic for handling form submissions, managed by a unified `saveCard` function.

1.  **Unified Save Logic (`saveCard`)**: All entry types (`ressource`, `production`, `vente`, `deblai`) are saved through a single `saveCard` function. This function determines the card type, validates the input fields, and prepares the data for saving.
2.  **Unique Key Generation**: When a user saves an entry for the first time, a `uniqueKey` is generated for most tables.
    *   For `formEntries`, this key is composed of the natural data fields (e.g., `${machine}-${resource}-${date}`).
    *   For `ventes`, `production`, and `deblai`, a UUID is appended to the natural key to ensure absolute uniqueness.
    *   The `stockChecks` table does **not** use this system and continues to rely on its `[resourceName+date]` composite primary key for identification.
3.  **Local Save**: The data, including the `uniqueKey` where applicable, is saved to the local IndexedDB. The `syncStatus` is set to `0` (unsynced).
4.  **Editing**: When a user edits an existing entry, the application updates the record in the local database. The `uniqueKey` remains unchanged, ensuring a stable identifier for the life of the entry.
5.  **Visual Feedback**: Upon a successful save, the card is set to a read-only state, and a visual indicator is updated to show its status (e.g., yellow for "saved").

### 3.3. Data Synchronization (`syncQueuedEntries`)

The synchronization process is designed to be robust and prevent duplicate entries.

1.  **Trigger**: Can be initiated manually via the "Sync Now" button or automatically when the application comes online.
2.  **Token Acquisition**: Gets an access token from `auth.js`.
3.  **Local Data Retrieval**: Fetches all records where `syncStatus` is `0` from all data tables.
4.  **SharePoint Upload (per table)**: The generic `syncTable` function handles the logic for each table, employing a hybrid strategy.
    *   **For `formEntries`, `ventes`, `production`, and `deblai` (Unique Key Strategy)**:
        *   **Check for Existence**: For each local item, it queries the SharePoint list, filtering the `Title` field by the item's `uniqueKey`.
        *   **`PATCH` or `POST`**: If the query returns an existing SharePoint item, it performs a `PATCH` request; otherwise, it performs a `POST` request, using the `uniqueKey` as the `Title`.
    *   **For `stockChecks` (Special Case)**:
        *   This table does not use the `uniqueKey` lookup.
        *   It relies on the `sharepointId` stored locally. If a `sharepointId` exists, it performs a `PATCH`; otherwise, it performs a `POST`. This preserves the original, stable behavior for stock checks.
    *   **Update Local Status**: Upon a successful SharePoint operation, the local record's `syncStatus` is set to `1`, and the `sharepointId` is stored for future reference.
5.  **Error Handling**: Individual sync errors are logged, allowing the process to continue with other items.
6.  **Status Update**: Provides UI feedback on the sync progress.

### 3.4. Data Refresh from Server (`refreshAllDataFromServer`)

This flow allows for a complete refresh of local data from the SharePoint server, which is useful for new device setup or data corruption recovery.

1.  **Trigger**: The user clicks the "Actualiser les données du serveur" button.
2.  **Confirmation**: A confirmation dialog is shown to prevent accidental data loss.
3.  **Token Acquisition**: An access token is obtained from `auth.js`.
4.  **Fetch All Data**: The `fetchAllSharePointListItems` helper function is called for each data list (`formEntries`, `stockChecks`, `ventes`, `production`, `deblai`). This function handles pagination to ensure all records are retrieved.
5.  **Data Transformation**: The fetched SharePoint data is mapped to the local Dexie.js schema.
6.  **Atomic Database Update**: A Dexie transaction is used to perform the following operations atomically:
    *   `clear()` is called on each local data table.
    *   `bulkAdd()` is used to insert the fresh data into the cleared tables.
7.  **UI Refresh**: `loadEntriesForDate()` is called to refresh the UI with the new data for the currently selected date.
8.  **Status Update**: The user is notified of the successful completion or any errors that occurred during the process.

## 4. Visual Architecture Diagram

```mermaid
graph TD
    subgraph "User Interface (index.html)"
        A[User Interaction]
    end

    subgraph "Application Logic"
        B(app.js) -- Manages UI & State --> A
        C(masterData.js) -- Provides Machine List --> B
        D(auth.js) -- Provides Auth Token --> C
        D -- Provides Auth Token --> B
        E(config.global.js) -- Config --> D
        E -- Config --> B
        F(service-worker.js) -- Caches Assets --> A
    end

    subgraph "Local Storage (Offline)"
        G[IndexedDB (Dexie.js)]
        B -- Reads/Writes --> G
        C -- Caches Machines --> G
    end

    subgraph "External Services (Online)"
        H[SharePoint API]
        I[Microsoft Auth]
    end

    B -- Syncs Data (Push) --> H
    B -- Refreshes Data (Pull) --> H
    C -- Fetches Master Data --> H
    D -- Authenticates --> I

    style B fill:#cde4f7,stroke:#333,stroke-width:2px
    style C fill:#d5e8d4,stroke:#333,stroke-width:2px
    style D fill:#e1d5e7,stroke:#333,stroke-width:2px
```

## 5. Data Structures (IndexedDB)

(Refer to `PROJECT_CHARTER.md` for detailed schema definitions. This section highlights key aspects.)

*   **`formEntries`**: Stores daily machine usage data. Includes `syncStatus` (0=unsynced, 1=synced) and `sharepointId` for linking to SharePoint items.
*   **`stockChecks`**: Stores daily stock measurements. Uses a compound primary key `[resourceName+date]` and includes `syncStatus` and `sharepointId`.
*   **`machines`**: Stores master data about machines. Populated and managed by `masterData.js`. Includes `idMachine` (unique identifier), `displayName` (for UI), `active` status, `location`, and `machineType`.
*   **`ventes`**: Stores sales records. Includes `syncStatus` and `sharepointId`.

## 6. Error Handling & Robustness

*   **Network Retries**: `masterData.js` implements retries for SharePoint API calls.
*   **Atomic DB Operations**: Dexie.js transactions are used for critical database updates (e.g., `masterData.refreshFromSharePoint()`).
*   **Graceful Degradation**: The application is designed to function offline, using cached data when network is unavailable.
*   **UI Feedback**: Sync status and error messages are provided to the user.

---
