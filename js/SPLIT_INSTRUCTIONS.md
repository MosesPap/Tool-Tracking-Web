# File Split Instructions

The `duty-shifts.js` file (16,239 lines) has been split into 3 files:

1. **duty-shifts-data.js** (~5000 lines)
   - All global variable declarations
   - Data loading/saving functions (loadData, saveData, Firebase operations)
   - Excel generation functions
   - Data utility functions (formatDateKey, getDayType, parseAssignedPersonForGroupFromAssignment, etc.)

2. **duty-shifts-logic.js** (~8000 lines)
   - All calculation logic (calculateDutiesForSelectedMonths, runSpecialHolidayLogic, etc.)
   - Rotation algorithms
   - Swap logic (runSemiNormalSwapLogic, runNormalSwapLogic)
   - Missing/disabled person handling
   - Assignment processing
   - Step-by-step calculation functions

3. **duty-shifts-ui.js** (~3000 lines)
   - Calendar rendering (renderCalendar)
   - Modal displays (showDayDetails, showStepByStepCalculation, etc.)
   - UI event handlers (drag & drop, clicks, etc.)
   - Group management UI (renderGroups, etc.)
   - Statistics updates

## Load Order
The HTML file should load the files in this order:
1. duty-shifts-data.js
2. duty-shifts-logic.js
3. duty-shifts-ui.js

All files share the same global scope, so variables and functions are accessible across files.
