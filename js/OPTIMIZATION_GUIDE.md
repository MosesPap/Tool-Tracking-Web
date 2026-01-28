# File Split Optimization Guide

## Current Status
The 3 files (`duty-shifts-data.js`, `duty-shifts-logic.js`, `duty-shifts-ui.js`) are currently identical copies of the original file. The application should work correctly since all code is present.

## Optimization Strategy

### Step 1: Keep Global Variables in duty-shifts-data.js
All global variable declarations should remain in `duty-shifts-data.js`:
- `groups`, `rankings`, `holidays`, `specialHolidays`
- `normalDayAssignments`, `semiNormalAssignments`, `weekendAssignments`, `specialHolidayAssignments`
- `rotationBaseline*Assignments`, `rotationBaselineLastByType`
- `dutyAssignments`, `assignmentReasons`, `criticalAssignments`
- `lastRotationPositions`, `crossMonthSwaps`
- `currentDate`, `currentGroup`, `calculationSteps`
- `recurringSpecialHolidays`, `missingReasons`
- `dataLastLoaded`, `isLoadingData`, `dutyShiftsInitStarted`

### Step 2: Remove from duty-shifts-data.js
Remove these sections (they belong in other files):
- Calculation functions: `calculateDutiesForSelectedMonths`, `runSpecialHolidayLogic`, `runWeekendLogic`, `runSemiNormalLogic`, `runNormalLogic`, `runSemiNormalSwapLogic`, `runNormalSwapLogic`
- UI rendering: `renderCalendar`, `renderGroups`, `showDayDetails`, `showStepByStepCalculation`
- Event handlers: `handleDragStart`, `handleDragEnter`, `handleDrop`, etc.

### Step 3: Keep in duty-shifts-logic.js
Keep these sections:
- `calculateDutiesForSelectedMonths` and all `run*Logic` functions
- `executeCalculation`, `renderStep1_SpecialHolidays`, `renderStep2_Weekends`, `renderStep3_SemiNormal`, `renderStep4_Normal`
- `findNextEligiblePersonAfterMissing`, `isPersonMissingOnDate`, `isPersonDisabledForDuty`
- `hasConsecutiveDuty`, `hasConsecutiveWeekendHolidayDuty`, `hasConsecutiveSpecialHolidayDuty`
- `storeAssignmentReason`, `buildUnavailableReplacementReason`
- All conflict detection and swap logic

### Step 4: Remove from duty-shifts-logic.js
Remove:
- Global variable declarations (except `calculationSteps`, `intendedAssignments`)
- Data loading/saving functions
- Excel generation functions
- UI rendering functions
- Event handlers

### Step 5: Keep in duty-shifts-ui.js
Keep these sections:
- `renderCalendar`, `renderGroups`, `renderHolidays`, `renderSpecialHolidays`, `renderRecurringHolidays`
- `showDayDetails`, `showStepByStepCalculation`
- All `handle*` event handler functions
- `openPersonActionsModal`, `openDisableSettingsFromActions`, `saveDisableSettings`
- `filterPeopleSearch`, `showPeopleSearchDropdown`, `selectPersonFromSearch`
- `openRankingsModal`, `handleRankingDragStart`, `handleRankingDrop`, etc.
- `updateStatistics`

### Step 6: Remove from duty-shifts-ui.js
Remove:
- Global variable declarations (except UI state like `draggedElement`, `isEditingPerson`, etc.)
- Data loading/saving functions
- Calculation logic functions
- Excel generation functions
- Core business logic (rotation algorithms, swap logic)

## Testing After Optimization

1. Test data loading/saving
2. Test calculation functionality
3. Test UI rendering (calendar, groups, modals)
4. Test Excel generation
5. Test all event handlers (drag & drop, clicks, etc.)

## Notes

- All files share the same global scope, so variables are accessible across files
- Functions can call each other across files
- The load order in HTML is: data.js → logic.js → ui.js
- Keep utility functions (formatDateKey, getDayType, etc.) in data.js as they're used by all files

## Automated Optimization

A Python script (`optimize_split.py`) was created but requires Python to run. Manual optimization following this guide is recommended for better control and testing.
