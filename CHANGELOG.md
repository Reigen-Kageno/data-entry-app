## Changelog

This document tracks significant changes and updates to the SOECO Basalt Site Data Entry Application.

## [1.9.3] - 2025-07-16

### Added
- **Production and Ventes Totals**: Added summary cards to the "Production" and "Ventes" tabs to display key daily totals.
  - **Production**: Shows total weight, number of trips, and average weight per trip.
  - **Ventes**: Shows total revenue, number of sales, and the total quantity sold for each product.

## [1.9.2] - 2025-07-16

### Fixed
- **Stock Card Date Sync**: Fixed an issue where the stock cards were not updating when the selected date was changed. The cards now correctly refresh and display the stock levels for the selected date.

### Changed
- **Deletion Prevention for Synced Items**: To prevent accidental data modification, the checkbox for selecting an entry is now hidden if the entry has been synchronized with the server. This provides a clear visual cue that synced items cannot be deleted.

## [1.9.1] - 2025-07-14

### Changed
- **Save Logic Refactoring**: Replaced the "delete and recreate" method in the `saveCard` function with a more robust "diffing" algorithm. This new logic compares the state of resources before and after an edit, and performs precise `ADD`, `UPDATE`, and `DELETE` operations. This prevents unnecessary deletions and ensures data integrity with SharePoint, especially when a single resource is removed from a machine.

## [1.9.0] - 2025-07-14

### Changed
- **UI/UX Overhaul**: Implemented a global "Edit Mode" to streamline the user workflow.
  - Replaced the six individual "Edit" and "Delete" buttons for each section with a single, global "Modifier la Journée" button.
  - Clicking this button now toggles an edit mode for all saved cards on the page, allowing for more efficient multi-section editing.
  - The "Modifier la Journée" button dynamically transforms into an "Enregistrer les Modifications" button, serving as the single point of action to save all changes.
  - A global "Supprimer la Sélection" button now appears in edit mode to handle deletions across all sections.

### Fixed
- **CSS Styling**: Adjusted CSS to support the new global edit mode, including a distinct visual style for cards being edited.

## [1.8.1] - 2025-07-14

### Fixed
- **Resource Deletion Sync**: Fixed a bug where deleting a single resource from a machine's card would not queue the deletion for SharePoint. The `saveCard` function now correctly uses `deleteEntryAndQueue` to ensure these deletions are synchronized.

### Changed
- **Code Cleanup**: Removed the redundant and unused `deleteEntriesByDate` function from `modules/data.js` to improve code clarity and prevent future bugs.

## [1.8.0] - 2025-07-14

### Added
- **Deletion Synchronization**: Implemented a new feature to synchronize deletions with SharePoint.
  - A `deletionsQueue` table was added to the local database (schema version 16).
  - When an entry is deleted locally, its `sharepointId` is added to this queue.
  - The sync process now includes a `syncDeletions` function that sends `DELETE` requests to SharePoint for items in the queue.

### Fixed
- **Duplicate Entry on Edit**: Resolved a critical bug where editing an entry would create a new one instead of updating the existing one. The `saveCard` function now correctly uses the entry's internal database ID to ensure updates are applied to the correct record.

## [1.7.1] - 2025-07-14

### Fixed
- **Module Import Error**: Corrected an error in `modules/stock.js` that was caused by the recent data access layer refactoring. The module was attempting to import a non-existent function (`getEntriesByDate`). This has been fixed by updating the import to use the new, more specific `getRessourcesByDate` function.

## [1.7.0] - 2025-07-14

### Changed
- **Data Access Layer Refactoring**: Centralized all database query logic into the `modules/data.js` module. The `modules/ui.js` module no longer queries the database directly and instead uses the new `getAllEntriesByDate` function from `data.js`. This improves separation of concerns and makes the code more maintainable.
- **Architectural Documentation**: Updated `ARCHITECTURE.md` to reflect the new data flow.

## [1.6.0] - 2025-07-14

### Changed
- **Codebase Modularization**: Refactored the entire application into a modular architecture. The core logic, previously in a monolithic `app.js`, has been split into smaller, more focused modules (`database.js`, `ui.js`, `sync.js`, `stock.js`, `data.js`, `utils.js`). This significantly improves code organization, maintainability, and scalability.
- **Duplicate Code Removal**:
  - Consolidated the `loadMachineOptions` function in `ui.js` to remove redundant code in its `try` and `catch` blocks.
  - Created a generic `createCard` function in `ui.js` to eliminate duplication in the `createRessourceCard`, `createProductionCard`, and `createVenteCard` functions.
- **Architectural Documentation**: Updated `ARCHITECTURE.md` to reflect the new modular structure.

### Fixed
- **Scoping Issues**: The modularization inherently resolves previous `ReferenceError` issues by establishing clear dependencies between modules.

## [1.5.2] - 2025-07-14

### Fixed
- **Scoping Issue**: Resolved a `ReferenceError: clearTrackingSets is not defined` that occurred when changing the date. The `clearTrackingSets` function was moved to the global scope in `app.js` to ensure it is accessible from the date input's event listener.

## [1.5.1] - 2025-07-14

### Fixed
- **Sync Error**: Resolved a `ReferenceError: loadEntriesForDate is not defined` that occurred during data synchronization. The `loadEntriesForDate` function was moved to a higher scope in `app.js` to ensure it is accessible when the sync process calls it.

## [1.5.0] - 2025-07-12

### Added
- **Visual State Indicators**: Implemented visual cues on entry cards to show their state:
  - **Gray dot**: New, unsaved entry.
  - **Yellow dot**: Saved locally, not yet synced.
  - **Green dot**: Successfully synced with the server.
- **Read-only Styling**: Cards are now visually distinct when in a read-only state, improving clarity.

### Changed
- **Save Logic Refactoring**: Consolidated the save logic for all card types (`ressource`, `production`, `vente`) into a single `saveCard` function. This reduces code duplication and simplifies maintenance.
- **User Feedback on Save**: The UI now provides immediate feedback. When a card is saved, its state indicator changes instantly, and the card becomes read-only.

## [1.4.0] - 2025-07-12

### Added
- **Server Data Refresh**: Implemented a new feature to allow users to refresh all local data from the SharePoint server. This is accessible via a new "Actualiser les données du serveur" button.
- **User Confirmation**: A confirmation dialog is now displayed before the data refresh to prevent accidental data loss.
- **Full Data Sync**: The refresh process fetches all items from the `formEntries`, `stockChecks`, `ventes`, and `production` SharePoint lists, clears the corresponding local Dexie tables, and populates them with the server data.
- **UI Feedback**: The application now provides clear status updates during the data refresh process.

### Changed
- **UI**: Added a new button to `index.html` to trigger the data refresh.
- **Core Logic**: Added `refreshAllDataFromServer` and `fetchAllSharePointListItems` functions to `app.js` to handle the data refresh process.

## [1.3.0] - 2025-07-11

### Fixed
- **Synchronization Logic**: Corrected an issue where a uniform `uniqueKey` system was causing an `UpgradeError` for the `stockChecks` table. The `stockChecks` table has been reverted to its original, robust composite primary key `[resourceName+date]`.
- **Hybrid Sync Model**: The `syncTable` function now handles `stockChecks` as a special case, using its composite key for updates, while all other tables (`formEntries`, `ventes`, `production`) use the new `uniqueKey` system for synchronization. This hybrid model ensures both stability and the prevention of duplicate entries where it is most needed.

### Added
- **Robust Synchronization for Core Tables**: Implemented a new synchronization mechanism using a `uniqueKey` for `formEntries`, `ventes`, and `production`. This key is stored locally and used as the `Title` in SharePoint to prevent duplicate entries.
  - For `formEntries`, the key is generated from the entry's natural data (e.g., machine, resource, date).
  - For `ventes` and `production`, a UUID is appended to the key to ensure absolute uniqueness.
- **UUID Generation**: Added a `generateUUID` function to create unique identifiers for `ventes` and `production` entries.

### Changed
- **Database Schema**: Updated the IndexedDB schema to version 15. This version adds a `uniqueKey` field to the `formEntries`, `ventes`, and `production` tables. The `stockChecks` table schema remains unchanged to preserve its stability.

## [1.2.0] - 2025-07-04

### Added
- **Production and Sales Tracking:** Implemented two new major features for tracking production output and sales.
- **Tab-Based Navigation:** Introduced a three-tab navigation system (`Ressources`, `Production`, `Ventes`) to organize the application's features.
- **Client Autocomplete:** The "Client" field in the Ventes form now provides autocomplete suggestions based on previously entered client names.

### Changed
- **Database Schema:** Upgraded the database to version 14 to include the new `ventes` and `production` tables.
- **Sync Logic:** The `syncQueuedEntries` function has been extended to handle the synchronization of the new `ventes` and `production` tables with their corresponding SharePoint lists. It now uses `PATCH` requests to update existing entries, ensuring that local edits are reflected in SharePoint.

## [1.1.0] - 2025-06-30

### Fixed
- **Critical Save/Edit Bug:** Resolved a major issue where duplicate form submission handlers caused data to be deleted or overwritten incorrectly. The application now uses a single, reliable "upsert" logic, ensuring data integrity when creating and updating entries.
- **Machine Untracking Logic:** Improved the process for untracking machines when they are removed from the form, preventing potential state inconsistencies.

### Added
- **Duplicate Prevention:** Implemented robust checks to prevent the same machine from being added more than once per day. Also prevents the same resource from being added more than once to the same machine.
- **Live Stock Card Updates:** Resource stock cards now update in real-time as users enter or modify quantities in the form.
- **Edit Confirmation:** Added a confirmation prompt to prevent accidental edits of data that has already been synchronized with SharePoint.
- **Sync Status UI:** The UI now provides more detailed feedback on the number of unsynced items queued for synchronization.

### Changed
- **Database Schema:** Upgraded the database to version 13 to support new data fields and improve indexing.

### Fixed
- **Critical Offline Loading Error:** Resolved an issue (`net::ERR_INTERNET_DISCONNECTED`) that prevented the app from loading when offline. All third-party libraries (Dexie.js, MSAL) are now stored locally in a `libs/` directory and cached by the service worker, ensuring the application is fully self-contained and offline-capable.


### [Date, July 24, 2024] - Debugging & Stability Fixes

#### Summary
Addressed critical `ReferenceError` by refactoring variable scoping, improved SharePoint synchronization, and refined form validation.

#### Changes Made
- **`app.js` Scoping Fix**: Moved UI element declarations (e.g., `dateInput`, `machinesContainer`) and core helper functions/event listeners to module-global scope to resolve `Uncaught ReferenceError: dateInput is not defined` and ensure proper UI interaction.
- **SharePoint Sync Refinements**:
    - Ensured `zoneActivite` is correctly included in `formEntries` payload for SharePoint.
    - Corrected SharePoint internal column name for `Zone Activité` to `Zoneactivit_x00e9_` in sync payload.
- **Form Validation**: Implemented JavaScript-based validation for machine input, replacing problematic HTML `pattern` attribute and ensuring `setCustomValidity('')` is cleared correctly.
- **Master Data Handling**: Updated `masterData.js` to correctly interpret SharePoint's 'Active' column values (1 or 0) for machine filtering.

#### Impact Analysis
- **Stability**: Resolved critical JavaScript runtime errors, significantly improving application robustness.
- **Data Integrity**: Ensured correct data persistence and synchronization for `zoneActivite` field.
- **User Experience**: Provided clearer and more reliable form validation feedback.


### June 18, 2025 - Version 1.x (Initial Release / Major Enhancement)

#### Summary
Enhancement of machine selection, zone tracking, and form validation with improved data integrity and user experience.

#### Changes Made
```diff
+ Added zoneActivite field to formEntries table
+ Added proper indexes for machine tracking
+ Updated syncStatus to use numeric values (0/1)
```

**UI Enhancements:**
```diff
+ Added filtered machine selection dropdown
+ Added read-only machine display name field
+ Added required Zone Activité dropdown
- Removed old compteurMoteur field handling
+ Updated form validation to use browser-native API
```

**Code Improvements:**
```diff
+ Added proper error boundaries around async code
+ Improved machine tracking with Set/Map
+ Added French validation messages
+ Enhanced SharePoint sync error handling
```

#### Testing Performed
1. Machine Selection:
   - [x] Tested machine list filtering
   - [x] Verified duplicate prevention
   - [x] Validated display name updates
   - [x] Tested offline behavior

2. Zone Activité:
   - [x] Verified required field validation
   - [x] Tested saving/loading
   - [x] Checked all zone options

3. Data Integrity:
   - [x] Tested form submission
   - [x] Verified IndexedDB storage
   - [x] Checked SharePoint sync
   - [x] Validated error handling

#### Impact Analysis
1. Database:
   - Requires schema upgrade to version 13
   - No data migration needed for new zone field
   - Backwards compatible with existing entries

2. User Experience:
   - Improved machine selection accuracy
   - Added required zone tracking
   - Better validation feedback
   - French language support

3. Performance:
   - Optimized machine list filtering
   - Efficient data structure usage
   - No significant impact on sync time

#### Rollback Plan
1. Database:
   ```sql
   -- If needed, can revert schema:
   DELETE FROM formEntries WHERE zoneActivite IS NOT NULL;
   -- Remove zoneActivite column in next schema version
   ```

2. Code:
   - Previous version available in source control
   - No dependent systems affected
   - Can revert UI changes independently

#### Security Considerations
- No new authentication requirements
- Uses existing SharePoint permissions
- Form validation prevents injection
- Data sanitized before storage

#### Documentation
- Updated README.MD with technical details
- Added code comments for complex logic
- Updated schema documentation
- Added testing guidelines

### Detailed PCR - June 18, 2025 (from README.md)

#### Summary
Enhancement of machine selection, zone tracking, and form validation with improved data integrity and user experience.

#### Changes Made
1. Database Schema Updates:
   ```diff
   + Added zoneActivite field to formEntries table
   + Added proper indexes for machine tracking
   + Updated syncStatus to use numeric values (0/1)
   ```

2. UI Enhancements:
   ```diff
   + Added filtered machine selection dropdown
   + Added read-only machine display name field
   + Added required Zone Activité dropdown
   - Removed old compteurMoteur field handling
   + Updated form validation to use browser-native API
   ```

3. Code Improvements:
   ```diff
   + Added proper error boundaries around async code
   + Improved machine tracking with Set/Map
   + Added French validation messages
   + Enhanced SharePoint sync error handling
   ```

#### Testing Performed
1. Machine Selection:
   - [x] Tested machine list filtering
   - [x] Verified duplicate prevention
   - [x] Validated display name updates
   - [x] Tested offline behavior

2. Zone Activité:
   - [x] Verified required field validation
   - [x] Tested saving/loading
   - [x] Checked all zone options

3. Data Integrity:
   - [x] Tested form submission
   - [x] Verified IndexedDB storage
   - [x] Checked SharePoint sync
   - [x] Validated error handling

#### Impact Analysis
1. Database:
   - Requires schema upgrade to version 13
   - No data migration needed for new zone field
   - Backwards compatible with existing entries

2. User Experience:
   - Improved machine selection accuracy
   - Added required zone tracking
   - Better validation feedback
   - French language support

3. Performance:
   - Optimized machine list filtering
   - Efficient data structure usage
   - No significant impact on sync time

#### Rollback Plan
1. Database:
   ```sql
   -- If needed, can revert schema:
   DELETE FROM formEntries WHERE zoneActivite IS NOT NULL;
   -- Remove zoneActivite column in next schema version
   ```

2. Code:
   - Previous version available in source control
   - No dependent systems affected
   - Can revert UI changes independently

#### Security Considerations
- No new authentication requirements
- Uses existing SharePoint permissions
- Form validation prevents injection
- Data sanitized before storage

#### Documentation
- Updated README.MD with technical details
- Added code comments for complex logic
- Updated schema documentation
- Added testing guidelines
