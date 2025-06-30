## Changelog

This document tracks significant changes and updates to the SOECO Basalt Site Data Entry Application.

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
- Added testing guidelines
