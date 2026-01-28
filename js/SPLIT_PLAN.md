# Duty Shifts File Split Plan

## Current Situation
- `duty-shifts.js` is 16,239 lines with complex interdependencies
- Many functions call each other across what would be different files
- Global variables are used throughout
- Complete automated split would be error-prone

## Proposed Solution

### Option 1: Keep Single File (Recommended for now)
- Add better organization with clear section comments
- Group related functions together
- This maintains functionality while improving readability

### Option 2: Incremental Split (If you want 3 files)
1. **duty-shifts-data.js** (~4000 lines)
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

3. **duty-shifts-ui.js** (~4000 lines)
   - Calendar rendering (renderCalendar)
   - Modal displays (showDayDetails, showStepByStepCalculation, etc.)
   - UI event handlers (drag & drop, clicks, etc.)
   - Group management UI (renderGroups, etc.)

## Implementation Notes
- All 3 files need to share the same global scope
- Load order: data.js → logic.js → ui.js
- Test thoroughly after split to ensure no broken dependencies

## Recommendation
Given the complexity, I recommend keeping the file as-is for now and adding better organization comments. If you still want the split, we can do it incrementally, testing after each major section is moved.
