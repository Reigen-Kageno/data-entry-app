# SOECO Basalt Site Data Entry Application - Architecture Overview

This document provides an overview of the application's architecture, key modules, and data flow, building upon the core requirements outlined in `PROJECT_CHARTER.md`. It aims to provide essential context for developers and automated agents working with the codebase.

## 1. Core Architectural Principles

*   **Offline-First**: The application prioritizes local data storage and functionality, with synchronization occurring opportunistically when connectivity is available.
*   **Separation of Concerns**: Modules are designed with distinct responsibilities to enhance maintainability and reduce coupling.
*   **Centralized Data Management**: Master data (like machine lists) is managed by a dedicated service.
*   **Robustness**: Network operations include retry mechanisms and timeouts.

## 2. Key Modules and Their Responsibilities

This section details the role of each primary JavaScript file in the application:

*   **`app.js` (Application Core & UI Orchestration)**
    *   **Primary Role**: Manages the main application lifecycle, initializes the UI, handles user interactions, and orchestrates data operations.
    *   **UI Management**: Responsible for dynamically adding/removing machine and resource sections, updating stock displays, and managing form states (editable/read-only).
    *   **Data Interaction**: Interacts with `db` (Dexie.js) for local data persistence and delegates master data management to `masterData.js`.
    *   **Synchronization Trigger**: Initiates the data synchronization process (`syncQueuedEntries`) but does not directly handle network requests for master data.
    *   **Offline Status**: Updates the UI based on network connectivity.

*   **`masterData.js` (Master Data Manager)**
    *   **Primary Role**: **Solely responsible for managing master data, specifically the machine list.**
    *   **Initialization (`initialize()`):**
        *   Loads existing machine data from IndexedDB cache.
        *   If online, performs a **single, robust fetch** of the latest machine list from SharePoint.
        *   Handles retries (up to 3 attempts with 2-second delays) and timeouts (30 seconds) for SharePoint requests.
        *   Transforms raw SharePoint data into the application's `machines` table schema.
        *   Updates the IndexedDB `machines` table and its internal in-memory cache.
    *   **Data Provision (`getMachines()`):** Provides the cached machine list to UI components (e.g., `app.js`'s `loadMachineOptions`).
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
    *   **Caching**: Caches static assets (`index.html`, JS files, icons) and intercepts network requests to serve content from cache when offline.
    *   **Exclusions**: Explicitly avoids caching API calls to SharePoint or authentication endpoints.

*   **IndexedDB Schema (within `app.js` and `PROJECT_CHARTER.md`)**
    *   **Primary Role**: Defines the local database structure using Dexie.js.
    *   **Tables**: `formEntries`, `stockChecks`, `machines`.
    *   **Schema Evolution**: Includes `upgrade()` logic for database migrations, ensuring data integrity across application versions.

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

### 3.2. Form Saving and Editing

The application uses a single, robust "upsert" (update/insert) logic for handling form submissions, located in the `entryForm.addEventListener('submit', ...)` block in `app.js`.

1.  **Fetch Existing Data**: When the user saves, the application first fetches all entries for the selected date from the local database.
2.  **Compare and Process**: It then iterates through the entries currently in the UI.
    *   If an entry from the UI matches an existing entry in the database (by machine and resource), it performs an **update**, preserving the existing `sharepointId` and setting `syncStatus` to `0` to mark it for re-syncing.
    *   If an entry from the UI is new, it performs an **insert**.
3.  **Cleanup**: Any entries that were in the database but are no longer in the UI are deleted.
4.  **Result**: This ensures that both new data and edits to existing data are handled correctly and efficiently, preventing data loss and maintaining integrity with SharePoint.

### 3.3. Data Synchronization (`syncQueuedEntries`)

1.  **Trigger**: Can be initiated manually via the "Sync Now" button.
2.  **Connectivity Check**: Verifies `navigator.onLine`. If offline, the operation is aborted.
3.  **Token Acquisition**: Calls `getToken()` from `auth.js` to get an access token.
4.  **Local Data Retrieval**: Fetches all records where `syncStatus` is `0` from the `formEntries` and `stockChecks` tables.
5.  **SharePoint Upload**: Iterates through the unsynced records:
    *   If a `sharepointId` exists, it performs a `PATCH` (update) request to the corresponding item in the SharePoint list.
    *   If no `sharepointId` exists, it performs a `POST` (create) request to the SharePoint list.
    *   Upon a successful SharePoint operation, it updates the local record's `syncStatus` to `1` and, for new items, stores the `sharepointId` returned by the API.
6.  **Error Handling**: Individual sync errors are logged to the console, but the process continues with the next item.
7.  **Status Update**: Provides UI feedback on the sync progress and the number of remaining items.

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

    B -- Syncs Data --> H
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

## 6. Error Handling & Robustness

*   **Network Retries**: `masterData.js` implements retries for SharePoint API calls.
*   **Atomic DB Operations**: Dexie.js transactions are used for critical database updates (e.g., `masterData.refreshFromSharePoint()`).
*   **Graceful Degradation**: The application is designed to function offline, using cached data when network is unavailable.
*   **UI Feedback**: Sync status and error messages are provided to the user.

---

