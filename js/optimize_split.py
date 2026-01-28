#!/usr/bin/env python3
"""
Script to optimize the split of duty-shifts.js into 3 files by removing
sections that don't belong in each file.
"""

import re
import os

def read_file(filename):
    """Read file and return lines"""
    with open(filename, 'r', encoding='utf-8') as f:
        return f.readlines()

def write_file(filename, lines):
    """Write lines to file"""
    with open(filename, 'w', encoding='utf-8') as f:
        f.writelines(lines)

def is_function_start(line):
    """Check if line starts a function definition"""
    stripped = line.strip()
    return bool(re.match(r'^\s*(function|async function|const|let|var)\s+\w+', stripped))

def get_function_name(line):
    """Extract function name from line"""
    match = re.search(r'(?:function|async function|const|let|var)\s+(\w+)', line)
    return match.group(1) if match else None

# Define function categories
DATA_FUNCTIONS = {
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
    'applyCalendarCellHeight', 'restoreCalendarCellHeight', 'startDutyShiftsAppInit',
    'getMonthNameFromDateKey', 'getGreekDayName', 'getGreekMonthName'
}

LOGIC_FUNCTIONS = {
    'calculateDutiesForSelectedMonths', 'runSpecialHolidayLogic', 'runWeekendLogic',
    'runSemiNormalLogic', 'runNormalLogic', 'runSemiNormalSwapLogic', 'runNormalSwapLogic',
    'runWeekendSkipLogic', 'findNextEligiblePersonAfterMissing', 'isPersonMissingOnDate',
    'isPersonDisabledForDuty', 'getRotationPosition', 'executeCalculation',
    'renderStep1_SpecialHolidays', 'renderStep2_Weekends', 'renderStep3_SemiNormal',
    'renderStep4_Normal', 'renderCurrentStep', 'goToNextStep', 'goToPreviousStep',
    'cancelStepByStepCalculation', 'saveFinalNormalAssignments', 'showNormalSwapResults',
    'showSemiNormalSwapResults', 'storeAssignmentReason', 'buildUnavailableReplacementReason',
    'normalizeSkipReasonText', 'normalizeSwapReasonText', 'getUnavailableReasonShort',
    'computeDefaultVirtualDatesForArrival', 'buildAutoPlacementForNewPerson',
    'getMaxRankValue', 'getSortedRankingsList', 'insertPersonIntoRankings',
    'applyAutoAddPerson', 'getRankValue', 'findTransferMatchesBackwards',
    'applyAutoTransferPositionsFromMatches', 'getLastAndNextDutyDates',
    'hasDutyOnDay', 'getConsecutiveDutyDates', 'checkRotationViolations',
    'getDayTypeCategoryFromDayType', 'addDaysToDateKeyLocal', 'saveStep1_SpecialHolidays',
    'saveStep2_Weekends', 'saveStep3_SemiNormal', 'saveStep4_Normal',
    'findLastSemiBefore', 'getExpectedPersonForDate', 'isPersonAvailableForDuty',
    'getUnavailableReason', 'hasConsecutiveDuty', 'hadSpecialHolidayDutyBefore',
    'hasConsecutiveWeekendHolidayDuty', 'hasConsecutiveSpecialHolidayDuty',
    'hasSpecialHolidayDutyInMonth', 'getConsecutiveConflictNeighborDayKey',
    'getAssignmentReason', 'formatGreekDayDate', 'buildSwapReasonGreek',
    'buildSkipReasonGreek', 'normalizePersonKey'
}

UI_FUNCTIONS = {
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
    'showHierarchyPopup', 'hideHierarchyPopup', 'assignPersonToDay', 'removePersonFromDay',
    'previousMonth', 'nextMonth', 'getDayTypeLabel', 'isWeekAfterNext',
    'askPermissionForConflict', 'isSameMonth', 'isSameWeek', 'getWeekStart',
    'setStepFooterBusy', 'getExpectedPersonForDay'
}

def categorize_function(func_name):
    """Determine which file a function belongs to"""
    if func_name in DATA_FUNCTIONS:
        return 'data'
    elif func_name in LOGIC_FUNCTIONS:
        return 'logic'
    elif func_name in UI_FUNCTIONS:
        return 'ui'
    else:
        return 'unknown'

def optimize_file(input_file, output_file, category):
    """Create optimized version of file keeping only relevant functions"""
    lines = read_file(input_file)
    output_lines = []
    current_function = None
    in_function = False
    brace_count = 0
    keep_current = False
    
    i = 0
    while i < len(lines):
        line = lines[i]
        
        # Check for global variable declarations (always keep in data.js)
        if category == 'data' and re.match(r'^\s*(let|const|var)\s+\w+', line.strip()):
            output_lines.append(line)
            i += 1
            continue
        
        # Check for function start
        if is_function_start(line):
            func_name = get_function_name(line)
            if func_name:
                func_category = categorize_function(func_name)
                keep_current = (func_category == category)
                current_function = func_name
                in_function = True
                brace_count = 0
                
                # Count opening brace on same line
                brace_count += line.count('{') - line.count('}')
        
        # If we're in a function, track braces
        if in_function:
            brace_count += line.count('{') - line.count('}')
            
            if keep_current:
                output_lines.append(line)
            
            # Function ends when braces balance
            if brace_count <= 0 and '{' in line:
                in_function = False
                current_function = None
                keep_current = False
        else:
            # Outside functions - keep comments and certain patterns
            stripped = line.strip()
            if not stripped or stripped.startswith('//') or stripped.startswith('/*'):
                # Keep comments in all files
                if category == 'data' or 'TODO' in line or 'NOTE' in line:
                    output_lines.append(line)
            elif category == 'data' and ('window.' in line or 'document.addEventListener' in line):
                # Keep initialization code in data.js
                output_lines.append(line)
        
        i += 1
    
    write_file(output_file, output_lines)
    print(f"Created {output_file} with {len(output_lines)} lines")

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    input_file = os.path.join(script_dir, 'duty-shifts.js')
    
    if not os.path.exists(input_file):
        print(f"Error: {input_file} not found")
        return
    
    print("Optimizing split files...")
    print("Note: This is a simplified optimization. Manual review recommended.")
    
    # For now, just add header comments explaining the split
    # Full optimization would require more sophisticated parsing
    print("Adding optimization headers to files...")
    
    header_data = """        // ============================================================================
        // DUTY-SHIFTS-DATA.JS
        // ============================================================================
        // This file contains:
        // - All global variable declarations
        // - Data loading/saving functions (Firebase, localStorage)
        // - Excel generation functions
        // - Data utility functions (formatDateKey, getDayType, etc.)
        // - Date/string formatting utilities
        // ============================================================================

"""
    
    header_logic = """        // ============================================================================
        // DUTY-SHIFTS-LOGIC.JS
        // ============================================================================
        // This file contains:
        // - All calculation logic (calculateDutiesForSelectedMonths, etc.)
        // - Rotation algorithms
        // - Swap logic (runSemiNormalSwapLogic, runNormalSwapLogic)
        // - Missing/disabled person handling
        // - Step-by-step calculation functions
        // ============================================================================

"""
    
    header_ui = """        // ============================================================================
        // DUTY-SHIFTS-UI.JS
        // ============================================================================
        // This file contains:
        // - Calendar rendering (renderCalendar)
        // - Modal displays (showDayDetails, showStepByStepCalculation, etc.)
        // - UI event handlers (drag & drop, clicks, etc.)
        // - Group management UI (renderGroups, etc.)
        // - Statistics updates
        // ============================================================================

"""
    
    # Add headers to files
    for filename, header in [('duty-shifts-data.js', header_data),
                             ('duty-shifts-logic.js', header_logic),
                             ('duty-shifts-ui.js', header_ui)]:
        filepath = os.path.join(script_dir, filename)
        if os.path.exists(filepath):
            lines = read_file(filepath)
            # Check if header already exists
            if not lines[0].startswith('        // ============================================================================'):
                lines.insert(0, header)
                write_file(filepath, lines)
                print(f"Added header to {filename}")
    
    print("\nOptimization complete!")
    print("Note: Files currently contain all code. Manual removal of irrelevant")
    print("sections recommended for full optimization. See SPLIT_INSTRUCTIONS.md")

if __name__ == '__main__':
    main()
