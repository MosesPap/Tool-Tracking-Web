// Script to split duty-shifts.js into 3 files
// This script reads duty-shifts.js and splits it into:
// 1. duty-shifts-data.js - Global variables, data loading/saving, Firebase, Excel
// 2. duty-shifts-logic.js - Calculation logic, rotation algorithms, swap logic
// 3. duty-shifts-ui.js - UI rendering, modals, event handlers

const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'duty-shifts.js');
const dataFile = path.join(__dirname, 'duty-shifts-data.js');
const logicFile = path.join(__dirname, 'duty-shifts-logic.js');
const uiFile = path.join(__dirname, 'duty-shifts-ui.js');

// Read the original file
const content = fs.readFileSync(inputFile, 'utf8');
const lines = content.split('\n');

// Function name patterns for categorization
const dataFunctions = [
    'loadData', 'saveData', 'loadDataFromLocalStorage', 'saveDataToLocalStorage',
    'generateExcelFilesForCurrentMonth', 'exportExcel', 'importExcel',
    'sanitizeForFirestore', 'mergeAndSaveMonthOrganizedAssignmentsDoc',
    'clearDutyShiftsFirestoreDocs', 'rebuildCriticalAssignmentsFromLastDuties',
    'organizeAssignmentsByMonth', 'flattenAssignmentsByMonth',
    'getMonthKeyFromDate', 'rebuildRotationBaselineLastByType',
    'formatGroupAssignmentsToStringMap', 'getRotationBaselineAssignmentForType',
    'getFinalAssignmentForType', 'getAssignmentsForDayType',
    'getAssignmentForDate', 'setAssignmentForDate', 'deleteAssignmentForDate',
    'getAllAssignments', 'getPreviousMonthKeyFromDate', 'isMonthKey',
    'getLastRotationPersonForDate', 'setLastRotationPersonForMonth',
    'formatDateKey', 'getDayType', 'parseAssignedPersonForGroupFromAssignment',
    'dateToDateKey', 'dateKeyToInputValue', 'inputValueToDateKey', 'shiftDate',
    'findPreviousDateKeyByDayType', 'findNthPreviousSpecialHolidayDateKey',
    'getMonthNameFromDateKey', 'escapeHtml', 'greekUpperNoTones',
    'formatGreekMonthYear', 'buildPeriodLabel', 'isDateKeyInRange',
    'getGroupName', 'migrateGroupsFormat', 'getPersonGroup', 'getPersonDetails',
    'getAllPeople', 'getRankValue', 'getMaxRankValue', 'getSortedRankingsList',
    'insertPersonIntoRankings', 'computeDefaultVirtualDatesForArrival',
    'buildAutoPlacementForNewPerson', 'findPersonBInGroupForTypeOnDate',
    'getCriticalAssignmentForDate', 'getRotationBaselineAssignmentForDate',
    'extractGroupAssignmentsMap', 'getDayTypeCategoryFromDayType',
    'findTransferMatchesBackwards', 'getAssignedPersonNameForGroupFromAssignment',
    'extractAllPersonNames', 'normalizePersonKey', 'storeAssignmentReason',
    'formatGreekDayDate', 'getGreekDayName', 'getGreekMonthName',
    'isHoliday', 'isWeekend', 'isSpecialHoliday', 'initializeDefaultSpecialHolidays',
    'loadRecurringHolidaysConfig', 'calculateEasterDate', 'getDayTypeColor',
    'getDayTypeLabel', 'restoreCalendarCellHeight', 'saveCalendarCellHeight',
    'applyCalendarCellHeight', 'startDutyShiftsAppInit'
];

const logicFunctions = [
    'calculateDutiesForSelectedMonths', 'runSpecialHolidayLogic',
    'runWeekendLogic', 'runSemiNormalLogic', 'runNormalLogic',
    'runSemiNormalSwapLogic', 'runNormalSwapLogic',
    'executeCalculation', 'renderCurrentStep', 'showStepByStepCalculation',
    'saveStep1_SpecialHolidays', 'saveStep2_Weekends', 'saveStep3_SemiNormal',
    'saveStep4_Normal', 'findNextEligiblePersonAfterMissing',
    'findLastSemiBefore', 'mapDayTypeToRotationType',
    'getNextTwoRotationPeopleForCurrentMonth', 'hasDutyOnDay',
    'getConsecutiveDutyDates', 'checkRotationViolations',
    'getExpectedPersonForDate', 'isPersonAvailableForDuty',
    'getUnavailableReason', 'buildUnavailableReplacementReason',
    'normalizeSkipReasonText', 'normalizeSwapReasonText'
];

const uiFunctions = [
    'renderCalendar', 'renderGroups', 'renderHolidays', 'renderRecurringHolidays',
    'showDayDetails', 'openPersonActionsModal', 'openDisableSettingsFromActions',
    'saveDisableSettings', 'openMissingDisabledPeopleModal', 'editPersonStatus',
    'getDisabledState', 'isPersonDisabledForDuty', 'getDisabledReasonText',
    'getUnavailableReasonShort', 'openEditPersonFromActions',
    'openMissingPeriodFromActions', 'openTransferFromActions',
    'openTransferTargetGroupModal', 'cancelTransferTargetGroup',
    'confirmTransferTargetGroup', 'deletePersonFromActions',
    'filterPeopleSearch', 'showPeopleSearchDropdown', 'hidePeopleSearchDropdown',
    'selectPersonFromSearch', 'handlePersonSearchKeydown',
    'openRankingsModal', 'updateRankingsAfterMove', 'startRankingAutoScroll',
    'stopRankingAutoScroll', 'editRankingManually', 'saveRankingEdit',
    'cancelRankingEdit', 'addPerson', 'editPerson', 'savePerson',
    'handleDragStart', 'handleDragEnter', 'handleDragLeave', 'handleDragOver',
    'handleDrop', 'handleDragEnd', 'handleRankingDragStart', 'trackRankingMousePosition',
    'handleRankingDragOver', 'handleRankingDragEnter', 'handleRankingDragLeave',
    'handleRankingDrop', 'handleRankingDragEnd', 'showHierarchyPopup',
    'hideHierarchyPopup', 'updateStatistics', 'showExcelPreview',
    'renderAutoAddRankingsPicker', 'openAutoAddRankPickerModal',
    'renderAutoAddPersonTable', 'openAutoAddPersonModal', 'applyAutoAddPerson',
    'buildBaselineComputedCellHtml', 'buildPreviewCalculationSummaryHtml',
    'getOpenLists', 'restoreOpenLists', 'ensureGroupListPopulated',
    'getLastAndNextDutyDates', 'createPersonItem', 'renderTransferPositionLists',
    'assignPersonToDay', 'removePersonFromDay', 'getNextMonth', 'getPreviousMonth',
    'changeMonth', 'changeYear'
];

// Categorize lines
let currentFunction = null;
let currentCategory = null;
const categorizedLines = { data: [], logic: [], ui: [], shared: [] };

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check for function declaration
    const funcMatch = line.match(/^\s*(async\s+)?function\s+(\w+)/);
    if (funcMatch) {
        const funcName = funcMatch[2];
        if (dataFunctions.includes(funcName)) {
            currentCategory = 'data';
            currentFunction = funcName;
        } else if (logicFunctions.includes(funcName)) {
            currentCategory = 'logic';
            currentFunction = funcName;
        } else if (uiFunctions.includes(funcName)) {
            currentCategory = 'ui';
            currentFunction = funcName;
        } else {
            // Unknown function - put in shared or try to infer from context
            currentCategory = 'shared';
            currentFunction = funcName;
        }
    }
    
    // Check for global variable declarations (always data)
    if (line.match(/^\s*(let|const|var)\s+[a-zA-Z]/) && !currentFunction) {
        currentCategory = 'data';
    }
    
    // Add line to appropriate category
    if (currentCategory) {
        categorizedLines[currentCategory].push(line);
    } else {
        // Default to shared for unknown content
        categorizedLines.shared.push(line);
    }
}

// Write the files
const dataContent = categorizedLines.data.join('\n');
const logicContent = categorizedLines.logic.join('\n');
const uiContent = categorizedLines.ui.join('\n');
const sharedContent = categorizedLines.shared.join('\n');

// Add shared content to all files (global variables, etc.)
const finalDataContent = dataContent + '\n\n// Shared content\n' + sharedContent;
const finalLogicContent = '// Logic functions - depends on duty-shifts-data.js\n' + logicContent;
const finalUiContent = '// UI functions - depends on duty-shifts-data.js and duty-shifts-logic.js\n' + uiContent;

fs.writeFileSync(dataFile, finalDataContent, 'utf8');
fs.writeFileSync(logicFile, finalLogicContent, 'utf8');
fs.writeFileSync(uiFile, finalUiContent, 'utf8');

console.log('Split complete!');
console.log(`Data file: ${dataFile} (${finalDataContent.split('\n').length} lines)`);
console.log(`Logic file: ${logicFile} (${finalLogicContent.split('\n').length} lines)`);
console.log(`UI file: ${uiFile} (${finalUiContent.split('\n').length} lines)`);
