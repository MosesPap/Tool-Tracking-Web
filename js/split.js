// Node.js script to split duty-shifts.js into 3 files
const fs = require('fs');
const path = require('path');

const inputFile = path.join(__dirname, 'duty-shifts.js');
const outputDir = __dirname;

// Read the entire file
const content = fs.readFileSync(inputFile, 'utf8');
const lines = content.split('\n');

// Function to check if a line contains a function definition
function isFunctionDef(line, funcNames) {
    const trimmed = line.trim();
    return funcNames.some(name => {
        const patterns = [
            new RegExp(`^\\s*(function|async function|const|let|var)\\s+${name}\\s*[=(]`),
            new RegExp(`^\\s*${name}\\s*[:=]\\s*(function|async function|\\(`)
        ];
        return patterns.some(p => p.test(trimmed));
    });
}

// Define function lists for each file
const dataFunctions = new Set([
    'loadData', 'saveData', 'loadDataFromLocalStorage', 'saveDataToLocalStorage',
    'sanitizeForFirestore', 'escapeHtml', 'mergeAndSaveMonthOrganizedAssignmentsDoc',
    'formatDateKey', 'getDayType', 'getMonthNameFromDateKey', 'organizeAssignmentsByMonth',
    'flattenAssignmentsByMonth', 'formatDate', 'getGreekDayName', 'getGreekMonthName',
    'getDayTypeColor', 'showExcelPreview', 'generateExcelFilesForCurrentMonth',
    'extractAllPersonNames', 'getAssignedPersonNameForGroupFromAssignment',
    'getNextTwoRotationPeopleForCurrentMonth', 'getPersonColor', 'getDayPersonColors',
    'getOrthodoxHolidayName', 'getOrthodoxHolidayNameAuto', 'isWeekend', 'isHoliday',
    'isSpecialHoliday', 'isOrthodoxOrCyprusHoliday', 'calculateOrthodoxEaster',
    'calculateOrthodoxHolidays', 'getGroupName', 'migrateGroupsFormat',
    'getAssignmentsForDayType', 'getAssignmentForDate', 'setAssignmentForDate',
    'deleteAssignmentForDate', 'getAllAssignments', 'parseAssignedPersonForGroupFromAssignment',
    'extractGroupAssignmentsMap', 'getRotationBaselineAssignmentForType',
    'getFinalAssignmentForType', 'findPersonBInGroupForTypeOnDate',
    'getMonthKeyFromDate', 'rebuildRotationBaselineLastByType',
    'formatGroupAssignmentsToStringMap', 'buildBaselineComputedCellHtml',
    'greekUpperNoTones', 'dateToDateKey', 'dateKeyToInputValue', 'inputValueToDateKey',
    'shiftDate', 'findPreviousDateKeyByDayType', 'findNthPreviousSpecialHolidayDateKey',
    'getPreviousMonthKeyFromDate', 'isMonthKey', 'getLastRotationPersonForDate',
    'setLastRotationPersonForMonth', 'getRotationBaselineAssignmentForDate',
    'getCriticalAssignmentForDate', 'mapDayTypeToRotationType',
    'getGreekDayNameUppercase', 'getGreekDayAccusativeArticle',
    'rebuildCriticalAssignmentsFromLastDuties', 'clearDutyShiftsFirestoreDocs',
    'applyCalendarCellHeight', 'restoreCalendarCellHeight', 'startDutyShiftsAppInit'
]);

const logicFunctions = new Set([
    'calculateDutiesForSelectedMonths', 'runSpecialHolidayLogic', 'runWeekendLogic',
    'runSemiNormalLogic', 'runNormalLogic', 'runSemiNormalSwapLogic', 'runNormalSwapLogic',
    'findNextEligiblePersonAfterMissing', 'isPersonMissingOnDate', 'isPersonDisabledForDuty',
    'getRotationPosition', 'executeCalculation', 'renderStep1_SpecialHolidays',
    'renderStep2_Weekends', 'renderStep3_SemiNormal', 'renderStep4_Normal',
    'renderCurrentStep', 'goToNextStep', 'goToPreviousStep', 'cancelStepByStepCalculation',
    'saveFinalNormalAssignments', 'showNormalSwapResults', 'showSemiNormalSwapResults',
    'storeAssignmentReason', 'buildUnavailableReplacementReason',
    'normalizeSkipReasonText', 'normalizeSwapReasonText', 'getUnavailableReasonShort',
    'computeDefaultVirtualDatesForArrival', 'buildAutoPlacementForNewPerson',
    'getMaxRankValue', 'getSortedRankingsList', 'insertPersonIntoRankings',
    'applyAutoAddPerson', 'getRankValue', 'findTransferMatchesBackwards',
    'applyAutoTransferPositionsFromMatches', 'getLastAndNextDutyDates',
    'hasDutyOnDay', 'getConsecutiveDutyDates', 'checkRotationViolations',
    'getDayTypeCategoryFromDayType', 'addDaysToDateKeyLocal'
]);

const uiFunctions = new Set([
    'renderCalendar', 'renderGroups', 'renderHolidays', 'renderSpecialHolidays',
    'renderRecurringHolidays', 'showDayDetails', 'showStepByStepCalculation',
    'updateStatistics', 'createPersonItem', 'handleDragStart', 'handleDragEnter',
    'handleDragLeave', 'handleDragOver', 'handleDrop', 'handleDragEnd',
    'addPerson', 'editPerson', 'savePerson', 'removePerson', 'movePersonInList',
    'openPersonActionsModal', 'openDisableSettingsFromActions', 'saveDisableSettings',
    'openMissingDisabledPeopleModal', 'editPersonStatus', 'getDisabledState',
    'getDisabledReasonText', 'openEditPersonFromActions', 'openMissingPeriodFromActions',
    'openTransferFromActions', 'openTransferTargetGroupModal', 'cancelTransferTargetGroup',
    'confirmTransferTargetGroup', 'deletePersonFromActions', 'getAllPeople',
    'getPersonGroup', 'getPersonDetails', 'filterPeopleSearch', 'showPeopleSearchDropdown',
    'hidePeopleSearchDropdown', 'selectPersonFromSearch', 'handlePersonSearchKeydown',
    'openRankingsModal', 'handleRankingDragStart', 'trackRankingMousePosition',
    'handleRankingDragOver', 'handleRankingDragEnter', 'handleRankingDragLeave',
    'handleRankingDrop', 'handleRankingDragEnd', 'updateRankingsAfterMove',
    'startRankingAutoScroll', 'stopRankingAutoScroll', 'editRankingManually',
    'saveRankings', 'normalizeGroupPriorities', 'normalizeRankingsSequential',
    'isPersonInAnyGroupLists', 'toggleTransferDropdown', 'transferPerson',
    'openTransferPositionModal', 'renderTransferAutoPreview', 'renderTransferPositionLists',
    'setTransferPosition', 'completeTransfer', 'addHoliday', 'saveHoliday',
    'removeHoliday', 'initializeDefaultSpecialHolidays', 'loadRecurringHolidaysConfig',
    'saveRecurringHolidaysConfig', 'addSpecialHoliday', 'saveSpecialHoliday',
    'removeSpecialHoliday', 'toggleRecurringHolidayFields', 'addRecurringHoliday',
    'saveRecurringHoliday', 'removeRecurringHoliday', 'renderAutoAddRankingsPicker',
    'openAutoAddRankPickerModal', 'renderAutoAddPersonTable', 'openAutoAddPersonModal',
    'getOpenLists', 'restoreOpenLists', 'ensureGroupListPopulated',
    'showHierarchyPopup', 'hideHierarchyPopup', 'assignPersonToDay', 'removePersonFromDay'
]);

console.log('Splitting file...');
console.log('Total lines:', lines.length);

// For now, just copy the file to show structure
// Actual splitting would require more sophisticated parsing
console.log('Note: Manual splitting recommended due to file complexity.');
console.log('See SPLIT_INSTRUCTIONS.md for details.');
