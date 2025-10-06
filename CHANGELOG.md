# Changelog

## [Unreleased]

### Fixed
- **Machine Selection**: Hardcoded "livraison" machine option in addition to imported ones, allowing users to select livraison as a machine for gasoil delivery tracking
- **Mining Badge Detection**: Fixed mining start date detection to check the correct database field (`notes` instead of `commentaire`) so mining mode now shows navigation badges properly
- **Mining Cumulative Logic**: Fixed critical mining vs gasoil cumulative inconsistency - mining cumulative now properly filters by `date <= currentDate` like gasoil does, preventing GE35 hours badge from disappearing due to future date returns
- **Mining Badge Navigation**: Fixed mining badge ordering to behave like gasoil livraison - removing data-level limits and implementing UI-level logic to show max 3 badges centered around current mining period, allowing navigation to all mining periods regardless of current date position
- **Data vs UI Separation**: Moved badge limiting from data layer (`getMiningProcessStartDates` no longer enforces limit) to UI layer (show max 3 badges centered on current period) for better flexible navigation
- **UI Updates**: Renamed `updateGasoilDateBadges` to `updateDateBadges` and made it mode-aware to handle both gasoil and mining navigation badges
- **Navigation Logic**: Mining date navigation works correctly, collecting future mining dates and finding next dates after current date
- **Sorting Logic**: Mining date sorting correctly returns most recent dates first using slice(-limit) and reverse() combination
- **Mining Badge Consistency**: Mining mode now displays badges exactly like gasoil mode (previous/current/next instead of centered display) for consistent navigation behavior
- **Code Deduplication**: Eliminated duplicate mining start date functions by consolidating shared logic into `getAllMiningStartDates()` helper, reducing code duplication by ~90%
- **Production Voyages Sync**: Fixed production entries not syncing the voyages column with SharePoint - now properly reads voyages from server on refresh and sends voyages to server on sync

### Enhanced
-- **Data Integrity**: Clarified that MasterData manager includes a hardcoded livraison machine in `findMachineByIdMachine` and `getMachines` methods
- **Mode-Aware Badges**: Current period badge tooltip dynamically shows "Début minage" vs "Début période cumul" based on selected cumul mode
