        // Data storage - each group has four order lists: special, weekend, semi, normal
        // Each person also has last duty dates for each type, missing periods, and priorities
        let groups = {
            1: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {} },
            2: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {} },
            3: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {} },
            4: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {} }
        };
        // Organizational rankings - separate from priority, doesn't affect list order
        let rankings = {}; // Format: { "Person Name": rankNumber }
        let rankingsModified = false; // Track if rankings have been modified (only save when true)
        let holidays = [];
        let specialHolidays = []; // User-defined special holidays
        // Separate assignments by day type
        let normalDayAssignments = {};
        let semiNormalAssignments = {};
        let weekendAssignments = {};
        let specialHolidayAssignments = {};
        // Legacy: Keep dutyAssignments for backward compatibility during migration
        let dutyAssignments = {};
        
        // Track skip/swap reasons for each assignment
        // Structure: assignmentReasons[dateKey][groupNum][personName] = { type: 'skip'|'swap', reason: '...', swappedWith: '...' }
        let assignmentReasons = {};
        // Track critical assignments from last duties - these must NEVER be deleted
        // Format: { "2025-12-25": ["Person Name (Ομάδα 1)", ...], ... }
        let criticalAssignments = {};
        // Track cross-month swaps: when a person is swapped from one month to next
        // Structure: crossMonthSwaps[dateKey][groupNum] = personName
        // Example: crossMonthSwaps["2026-03-05"][1] = "Person A" means Person A must be assigned to March 5, Group 1
        let crossMonthSwaps = {};
        // Track last rotation positions (normal rotation, ignoring swaps) for each day type and group
        // Structure: lastRotationPositions[dayType][groupNum] = rotationPosition
        // Example: lastRotationPositions["normal"][1] = 5 means the last normal rotation position for group 1 was 5
        let lastRotationPositions = {
            normal: {},
            semi: {},
            weekend: {},
            special: {}
        };
        
        // Helper functions to get/set assignments based on day type
        function getAssignmentsForDayType(dayTypeCategory) {
            if (dayTypeCategory === 'special') {
                return specialHolidayAssignments;
            } else if (dayTypeCategory === 'weekend') {
                return weekendAssignments;
            } else if (dayTypeCategory === 'semi') {
                return semiNormalAssignments;
            } else { // normal
                return normalDayAssignments;
            }
        }
        
        // Get assignment for a specific date (checks correct document based on day type)
        function getAssignmentForDate(dateKey) {
            try {
                const date = new Date(dateKey + 'T00:00:00');
                if (isNaN(date.getTime())) return null;
                
                const dayType = getDayType(date);
                if (dayType === 'special-holiday') {
                    return specialHolidayAssignments[dateKey] || null;
                } else if (dayType === 'weekend-holiday') {
                    return weekendAssignments[dateKey] || null;
                } else if (dayType === 'semi-normal-day') {
                    return semiNormalAssignments[dateKey] || null;
                } else if (dayType === 'normal-day') {
                    return normalDayAssignments[dateKey] || null;
                }
            } catch (error) {
                console.error(`Error getting assignment for ${dateKey}:`, error);
            }
            // Fallback to legacy dutyAssignments
            return dutyAssignments[dateKey] || null;
        }
        
        // Set assignment for a specific date (saves to correct document based on day type)
        function setAssignmentForDate(dateKey, assignmentValue) {
            try {
                const date = new Date(dateKey + 'T00:00:00');
                if (isNaN(date.getTime())) {
                    console.error(`Invalid date key: ${dateKey}`);
                    return;
                }
                
                const dayType = getDayType(date);
                if (dayType === 'special-holiday') {
                    specialHolidayAssignments[dateKey] = assignmentValue;
                } else if (dayType === 'weekend-holiday') {
                    weekendAssignments[dateKey] = assignmentValue;
                } else if (dayType === 'semi-normal-day') {
                    semiNormalAssignments[dateKey] = assignmentValue;
                } else if (dayType === 'normal-day') {
                    normalDayAssignments[dateKey] = assignmentValue;
                }
                
                // Also update legacy dutyAssignments for backward compatibility
                dutyAssignments[dateKey] = assignmentValue;
            } catch (error) {
                console.error(`Error setting assignment for ${dateKey}:`, error);
            }
        }
        
        // Delete assignment for a specific date
        function deleteAssignmentForDate(dateKey) {
            try {
                const date = new Date(dateKey + 'T00:00:00');
                if (isNaN(date.getTime())) return;
                
                const dayType = getDayType(date);
                if (dayType === 'special-holiday') {
                    delete specialHolidayAssignments[dateKey];
                } else if (dayType === 'weekend-holiday') {
                    delete weekendAssignments[dateKey];
                } else if (dayType === 'semi-normal-day') {
                    delete semiNormalAssignments[dateKey];
                } else if (dayType === 'normal-day') {
                    delete normalDayAssignments[dateKey];
                }
                
                // Also delete from legacy dutyAssignments
                delete dutyAssignments[dateKey];
            } catch (error) {
                console.error(`Error deleting assignment for ${dateKey}:`, error);
            }
        }
        
        // Get all assignments (merged from all day types) - for backward compatibility
        function getAllAssignments() {
            const all = {};
            // Merge all day type assignments
            Object.assign(all, normalDayAssignments);
            Object.assign(all, semiNormalAssignments);
            Object.assign(all, weekendAssignments);
            Object.assign(all, specialHolidayAssignments);
            return all;
        }
        // Track intended assignments - when a person should be assigned but was skipped due to conflicts
        // Format: { "2026-02-05": { "1": "Person A", "2": "Person B", ... }, ... }
        // This ensures N-day rotation counts from the intended day, not the actual assignment day
        let intendedAssignments = {};
        let currentDate = new Date();
        let currentGroup = null;
        let selectedDateForDuty = null;
        
        // Step-by-step calculation state
        let calculationSteps = {
            currentStep: 1,
            totalSteps: 4,
            startDate: null,
            endDate: null,
            preserveExisting: true,
            dayTypeLists: null
        };
        
        // Configuration for recurring special holidays
        // Format: { month: 1-12, day: 1-31, name: string, type: 'fixed' | 'easter-relative', offset?: number }
        let recurringSpecialHolidays = [
            { month: 12, day: 24, name: 'Παραμονή Χριστουγέννων', type: 'fixed' },
            { month: 12, day: 25, name: 'Χριστούγεννα', type: 'fixed' },
            { month: 12, day: 31, name: 'Παραμονή Πρωτοχρονιάς', type: 'fixed' },
            { month: 1, day: 1, name: 'Πρωτοχρονιά', type: 'fixed' },
            { name: 'Μεγάλο Σάββατο', type: 'easter-relative', offset: -1 }, // 1 day before Easter
            { name: 'Πάσχα', type: 'easter-relative', offset: 0 } // Easter Sunday
        ];

        // Track data loading to prevent duplicate loads
        let dataLastLoaded = null;
        let isLoadingData = false;
        const DATA_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache duration
        
        // Initialize
        document.addEventListener('DOMContentLoaded', async function() {
            // Wait for Firebase to be ready
            if (window.auth && window.db) {
                // Check authentication
                let authListenerUnsubscribed = false;
                const unsubscribe = window.auth.onAuthStateChanged(async function(user) {
                    // Prevent duplicate processing if listener fires multiple times
                    if (authListenerUnsubscribed) return;
                    
                    if (user && user.emailVerified) {
                        // Check if data was recently loaded to prevent duplicate reads
                        const now = Date.now();
                        if (dataLastLoaded && (now - dataLastLoaded) < DATA_CACHE_DURATION && !isLoadingData) {
                            console.log('[DUTY-SHIFTS] Data recently loaded, skipping reload');
                            // Still render with existing data
                            renderGroups();
                            renderHolidays();
                            renderRecurringHolidays();
                            renderCalendar();
                            updateStatistics();
                            return;
                        }
                        
                        isLoadingData = true;
                        await loadData();
                        dataLastLoaded = Date.now();
                        isLoadingData = false;
                        
                        renderGroups();
                        renderHolidays();
                        renderRecurringHolidays();
                        renderCalendar();
                        updateStatistics();
                    } else {
                        // Not authenticated, use localStorage
                        loadDataFromLocalStorage();
                        renderGroups();
                        renderHolidays();
                        renderRecurringHolidays();
                        renderCalendar();
                        updateStatistics();
                    }
                });
                
                // Clean up listener when page is hidden/unloaded to prevent background reads
                document.addEventListener('visibilitychange', function() {
                    if (document.hidden) {
                        // Page is hidden, unsubscribe to prevent background reads
                        if (unsubscribe && typeof unsubscribe === 'function') {
                            unsubscribe();
                            authListenerUnsubscribed = true;
                        }
                    }
                });
                
                window.addEventListener('beforeunload', function() {
                    // Page is unloading, unsubscribe to prevent reads
                    if (unsubscribe && typeof unsubscribe === 'function') {
                        unsubscribe();
                        authListenerUnsubscribed = true;
                    }
                });
            } else {
                // Firebase not loaded yet, wait a bit and try again
                setTimeout(() => {
                    document.dispatchEvent(new Event('DOMContentLoaded'));
                }, 500);
            }
        });

        // Load data from Firebase Firestore
        async function loadData() {
            try {
                // Wait for Firebase to be ready
                if (!window.db) {
                    console.log('Waiting for Firebase to initialize...');
                    setTimeout(loadData, 100);
                    return;
                }
                
                const db = window.db || firebase.firestore();
                const user = window.auth?.currentUser;
                
                if (!user) {
                    console.log('User not authenticated, using localStorage as fallback');
                    loadDataFromLocalStorage();
                    return;
                }
                
                // Load groups
                const groupsDoc = await db.collection('dutyShifts').doc('groups').get();
                if (groupsDoc.exists) {
                    const data = groupsDoc.data();
                    // Remove metadata fields
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    // Migrate old format to new format if needed
                    groups = migrateGroupsFormat(data) || { 1: { regular: [], special: [] }, 2: { regular: [], special: [] }, 3: { regular: [], special: [] }, 4: { regular: [], special: [] } };
                    
                    // CRITICAL: Always ensure priorities object exists and is properly initialized
                    for (let i = 1; i <= 4; i++) {
                        if (!groups[i]) {
                            groups[i] = { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {} };
                        }
                        if (!groups[i].priorities) {
                            groups[i].priorities = {};
                        }
                        
                        // Ensure all people in lists have priority entries (only if they don't already exist)
                        const listTypes = ['special', 'weekend', 'semi', 'normal'];
                        listTypes.forEach(listType => {
                            const list = groups[i][listType] || [];
                            list.forEach(person => {
                                if (!groups[i].priorities[person]) {
                                    groups[i].priorities[person] = {};
                                }
                                // Only set default if priority doesn't exist (preserve existing priorities)
                                if (groups[i].priorities[person][listType] === undefined) {
                                    groups[i].priorities[person][listType] = 999; // Default priority
                                }
                            });
                        });
                    }
                    
                    // NOTE: Do NOT call saveData() here - it would overwrite assignments that haven't been loaded yet
                    // Priorities will be saved when they're actually modified by the user
                    
                    // Debug: Log lastDuties and priorities to verify they're loaded
                    console.log('Loaded groups from Firestore');
                    for (let g = 1; g <= 4; g++) {
                        if (groups[g] && groups[g].lastDuties) {
                            const lastDutiesCount = Object.keys(groups[g].lastDuties).length;
                            if (lastDutiesCount > 0) {
                                console.log(`Group ${g} has ${lastDutiesCount} people with lastDuties:`, Object.keys(groups[g].lastDuties));
                                // Log sample lastDuties
                                const samplePerson = Object.keys(groups[g].lastDuties)[0];
                                console.log(`Sample lastDuties for ${samplePerson}:`, groups[g].lastDuties[samplePerson]);
                            }
                        }
                        if (groups[g] && groups[g].priorities) {
                            const prioritiesCount = Object.keys(groups[g].priorities).length;
                            if (prioritiesCount > 0) {
                                console.log(`Group ${g} has ${prioritiesCount} people with priorities:`, Object.keys(groups[g].priorities));
                            }
                        }
                    }
                }
                
                // Load holidays
                const holidaysDoc = await db.collection('dutyShifts').doc('holidays').get();
                if (holidaysDoc.exists) {
                    const data = holidaysDoc.data();
                    holidays = data.list || [];
                }
                
                // Load special holidays
                const specialHolidaysDoc = await db.collection('dutyShifts').doc('specialHolidays').get();
                if (specialHolidaysDoc.exists) {
                    const data = specialHolidaysDoc.data();
                    specialHolidays = data.list || [];
                }
                
                // Load recurring holidays configuration
                await loadRecurringHolidaysConfig();
                
                // Initialize default special holidays if they don't exist
                initializeDefaultSpecialHolidays();
                
                // Load assignments from separate documents by day type
                // Support both old format (flat date keys) and new format (month-organized)
                const normalDayDoc = await db.collection('dutyShifts').doc('normalDayAssignments').get();
                if (normalDayDoc.exists) {
                    const data = normalDayDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    delete data._migratedFrom;
                    delete data._migrationDate;
                    // Check if data is month-organized (new format) or flat (old format)
                    const isMonthOrganized = Object.keys(data).some(key => {
                        // Check if key looks like "Month Year" (e.g., "February 2026")
                        return /^[A-Za-z]+\s+\d{4}$/.test(key) && typeof data[key] === 'object';
                    });
                    if (isMonthOrganized) {
                        normalDayAssignments = flattenAssignmentsByMonth(data);
                        console.log('Loaded normalDayAssignments from month-organized format');
                    } else {
                        normalDayAssignments = data || {};
                        console.log('Loaded normalDayAssignments from flat format (legacy)');
                    }
                }
                
                const semiNormalDoc = await db.collection('dutyShifts').doc('semiNormalAssignments').get();
                if (semiNormalDoc.exists) {
                    const data = semiNormalDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    delete data._migratedFrom;
                    delete data._migrationDate;
                    const isMonthOrganized = Object.keys(data).some(key => {
                        return /^[A-Za-z]+\s+\d{4}$/.test(key) && typeof data[key] === 'object';
                    });
                    if (isMonthOrganized) {
                        semiNormalAssignments = flattenAssignmentsByMonth(data);
                        console.log('Loaded semiNormalAssignments from month-organized format');
                    } else {
                        semiNormalAssignments = data || {};
                        console.log('Loaded semiNormalAssignments from flat format (legacy)');
                    }
                }
                
                const weekendDoc = await db.collection('dutyShifts').doc('weekendAssignments').get();
                if (weekendDoc.exists) {
                    const data = weekendDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    delete data._migratedFrom;
                    delete data._migrationDate;
                    const isMonthOrganized = Object.keys(data).some(key => {
                        return /^[A-Za-z]+\s+\d{4}$/.test(key) && typeof data[key] === 'object';
                    });
                    if (isMonthOrganized) {
                        weekendAssignments = flattenAssignmentsByMonth(data);
                        console.log('Loaded weekendAssignments from month-organized format');
                    } else {
                        weekendAssignments = data || {};
                        console.log('Loaded weekendAssignments from flat format (legacy)');
                    }
                }
                
                const specialHolidayDoc = await db.collection('dutyShifts').doc('specialHolidayAssignments').get();
                if (specialHolidayDoc.exists) {
                    const data = specialHolidayDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    delete data._migratedFrom;
                    delete data._migrationDate;
                    const isMonthOrganized = Object.keys(data).some(key => {
                        return /^[A-Za-z]+\s+\d{4}$/.test(key) && typeof data[key] === 'object';
                    });
                    if (isMonthOrganized) {
                        specialHolidayAssignments = flattenAssignmentsByMonth(data);
                        console.log('Loaded specialHolidayAssignments from month-organized format');
                    } else {
                        specialHolidayAssignments = data || {};
                        console.log('Loaded specialHolidayAssignments from flat format (legacy)');
                    }
                }
                
                // Also load legacy assignments document for backward compatibility
                const assignmentsDoc = await db.collection('dutyShifts').doc('assignments').get();
                if (assignmentsDoc.exists) {
                    const data = assignmentsDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    
                    // Check if data is organized by month and flatten if needed
                    const isMonthOrganized = data && typeof data === 'object' && Object.keys(data).some(key => {
                        const val = data[key];
                        return typeof val === 'object' && val !== null && !Array.isArray(val) && 
                               !(key === 'lastUpdated' || key === 'updatedBy' || key === '_migratedFrom' || key === '_migrationDate') &&
                               Object.keys(val).some(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
                    });
                    
                    if (isMonthOrganized) {
                        dutyAssignments = flattenAssignmentsByMonth(data);
                        console.log('Loaded dutyAssignments from month-organized format');
                    } else {
                    dutyAssignments = data || {};
                        console.log('Loaded dutyAssignments from flat format (legacy)');
                    }
                    
                    // Merge legacy assignments into day-type-specific documents if they don't exist
                    for (const dateKey in dutyAssignments) {
                        if (dateKey === 'lastUpdated' || dateKey === 'updatedBy') continue;
                        try {
                            const date = new Date(dateKey + 'T00:00:00');
                            if (isNaN(date.getTime())) continue;
                            const dayType = getDayType(date);
                            const assignmentValue = dutyAssignments[dateKey];
                            
                            if (dayType === 'special-holiday' && !specialHolidayAssignments[dateKey]) {
                                specialHolidayAssignments[dateKey] = assignmentValue;
                            } else if (dayType === 'weekend-holiday' && !weekendAssignments[dateKey]) {
                                weekendAssignments[dateKey] = assignmentValue;
                            } else if (dayType === 'semi-normal-day' && !semiNormalAssignments[dateKey]) {
                                semiNormalAssignments[dateKey] = assignmentValue;
                            } else if (dayType === 'normal-day' && !normalDayAssignments[dateKey]) {
                                normalDayAssignments[dateKey] = assignmentValue;
                            }
                        } catch (error) {
                            console.error(`Error processing legacy assignment ${dateKey}:`, error);
                        }
                    }
                }
                
                // Load critical assignments
                const criticalAssignmentsDoc = await db.collection('dutyShifts').doc('criticalAssignments').get();
                if (criticalAssignmentsDoc.exists) {
                    const data = criticalAssignmentsDoc.data();
                    // Remove metadata fields
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    criticalAssignments = data || {};
                    
                    console.log('Loaded criticalAssignments from Firestore:', Object.keys(criticalAssignments).length, 'dates');
                    console.log('Sample criticalAssignments:', Object.entries(criticalAssignments).slice(0, 3));
                    
                    // Restore critical assignments to dutyAssignments if they're missing
                    Object.keys(criticalAssignments).forEach(dateKey => {
                        const criticalPeople = criticalAssignments[dateKey];
                        // Handle both array format and string format (for backward compatibility)
                        let peopleArray = [];
                        if (Array.isArray(criticalPeople)) {
                            peopleArray = criticalPeople;
                        } else if (typeof criticalPeople === 'string') {
                            peopleArray = [criticalPeople];
                        }
                        
                        if (peopleArray.length > 0) {
                            // Ensure critical assignments are in day-type-specific documents
                            const existingAssignment = getAssignmentForDate(dateKey);
                            if (!existingAssignment) {
                                setAssignmentForDate(dateKey, peopleArray.join(', '));
                                console.log(`Restored critical assignment for ${dateKey}: ${peopleArray.join(', ')}`);
                            } else {
                                // Merge critical assignments with existing ones
                                const existing = existingAssignment.split(', ');
                                peopleArray.forEach(person => {
                                    if (!existing.includes(person)) {
                                        existing.push(person);
                                    }
                                });
                                setAssignmentForDate(dateKey, existing.join(', '));
                                console.log(`Merged critical assignment for ${dateKey}: ${existing.join(', ')}`);
                            }
                        }
                    });
                } else {
                    console.log('No criticalAssignments document found in Firestore');
                }
                
                // Load cross-month swaps from Firestore
                const crossMonthSwapsDoc = await db.collection('dutyShifts').doc('crossMonthSwaps').get();
                if (crossMonthSwapsDoc.exists) {
                    const data = crossMonthSwapsDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    crossMonthSwaps = data || {};
                    console.log('Loaded crossMonthSwaps from Firestore:', Object.keys(crossMonthSwaps).length, 'dates');
                } else {
                    // Try loading from localStorage as fallback
                    const localCrossMonth = localStorage.getItem('dutyShiftsCrossMonthSwaps');
                    if (localCrossMonth) {
                        try {
                            crossMonthSwaps = JSON.parse(localCrossMonth);
                            console.log('Loaded crossMonthSwaps from localStorage');
                        } catch (e) {
                            console.error('Error parsing crossMonthSwaps from localStorage:', e);
                            crossMonthSwaps = {};
                        }
                    } else {
                        crossMonthSwaps = {};
                    }
                }
                
                // Load assignment reasons (swap/skip indicators)
                const assignmentReasonsDoc = await db.collection('dutyShifts').doc('assignmentReasons').get();
                if (assignmentReasonsDoc.exists) {
                    const data = assignmentReasonsDoc.data();
                    // Remove metadata fields
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    assignmentReasons = data || {};
                    console.log('Loaded assignmentReasons from Firestore:', Object.keys(assignmentReasons).length, 'dates');
                    console.log('Sample assignmentReasons:', Object.entries(assignmentReasons).slice(0, 3));
                } else {
                    console.log('No assignmentReasons document found in Firestore, starting with empty reasons');
                    assignmentReasons = {};
                }
                
                // Load last rotation positions from Firestore
                const lastRotationPositionsDoc = await db.collection('dutyShifts').doc('lastRotationPositions').get();
                if (lastRotationPositionsDoc.exists) {
                    const data = lastRotationPositionsDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    // Merge with existing structure
                    if (data.normal) lastRotationPositions.normal = data.normal;
                    if (data.semi) lastRotationPositions.semi = data.semi;
                    if (data.weekend) lastRotationPositions.weekend = data.weekend;
                    if (data.special) lastRotationPositions.special = data.special;
                    console.log('Loaded lastRotationPositions from Firestore:', lastRotationPositions);
                } else {
                    // Initialize empty if not found
                    lastRotationPositions = {
                        normal: {},
                        semi: {},
                        weekend: {},
                        special: {}
                    };
                }
                
                // Load rankings from Firestore
                const rankingsDoc = await db.collection('dutyShifts').doc('rankings').get();
                if (rankingsDoc.exists) {
                    const data = rankingsDoc.data();
                    // Remove metadata fields
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    // Store rankings from Firestore: { "Person Name": rankNumber }
                    rankings = data || {};
                    console.log('Loaded rankings from Firestore:', Object.keys(rankings).length, 'people');
                    console.log('Sample rankings:', Object.entries(rankings).slice(0, 5));
                } else {
                    console.log('No rankings document found in Firestore, starting with empty rankings');
                    rankings = {};
                }
                
                // Reset rankingsModified flag after loading (rankings haven't been modified yet)
                rankingsModified = false;
                
                // After loading all data, rebuild criticalAssignments from lastDuties if they're missing
                // This ensures manually entered dates are always protected
                rebuildCriticalAssignmentsFromLastDuties();
                
                console.log('Data loaded from Firebase');
            } catch (error) {
                console.error('Error loading data from Firebase:', error);
                // Fallback to localStorage
                loadDataFromLocalStorage();
            }
        }

        // Rebuild criticalAssignments from lastDuties
        // This ensures manually entered dates are always protected, even if criticalAssignments wasn't saved
        // IMPORTANT: This function only updates in-memory data. It does NOT save to Firebase.
        // Saving should only happen when actual changes are made by the user.
        function rebuildCriticalAssignmentsFromLastDuties() {
            let rebuiltCount = 0;
            let updatedCount = 0;
            
            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                const groupData = groups[groupNum];
                if (!groupData || !groupData.lastDuties) continue;
                
                Object.keys(groupData.lastDuties).forEach(personName => {
                    const lastDuties = groupData.lastDuties[personName];
                    const personGroupStr = `${personName} (Ομάδα ${groupNum})`;
                    
                    // Process each last duty date
                    const dutyTypes = ['special', 'weekend', 'semi', 'normal'];
                    dutyTypes.forEach(type => {
                        const dateStr = lastDuties[type];
                        if (dateStr) {
                            try {
                                // Parse date string - handle both YYYY-MM-DD and DD/MM/YYYY formats
                                let dateObj;
                                if (dateStr.includes('/')) {
                                    // DD/MM/YYYY format
                                    const parts = dateStr.split('/');
                                    if (parts.length === 3) {
                                        let year = parseInt(parts[2]);
                                        if (year < 100) {
                                            year = year < 50 ? 2000 + year : 1900 + year;
                                        }
                                        dateObj = new Date(year, parseInt(parts[1]) - 1, parseInt(parts[0]));
                                    }
                                } else {
                                    // YYYY-MM-DD format
                                    const [year, month, day] = dateStr.split('-').map(Number);
                                    dateObj = new Date(year, month - 1, day);
                                }
                                
                                if (dateObj && !isNaN(dateObj.getTime())) {
                                    const dateKey = formatDateKey(dateObj);
                                    
                                    // Add to criticalAssignments (only if not already there)
                                    if (!criticalAssignments[dateKey]) {
                                        criticalAssignments[dateKey] = [];
                                    }
                                    if (!criticalAssignments[dateKey].includes(personGroupStr)) {
                                        criticalAssignments[dateKey].push(personGroupStr);
                                        rebuiltCount++;
                                    }
                                    
                                    // Also ensure it's in day-type-specific assignments (only if not already there)
                                    const existingAssignment = getAssignmentForDate(dateKey);
                                    if (!existingAssignment) {
                                        setAssignmentForDate(dateKey, personGroupStr);
                                        updatedCount++;
                                    } else if (!existingAssignment.includes(personGroupStr)) {
                                        setAssignmentForDate(dateKey, existingAssignment + `, ${personGroupStr}`);
                                        updatedCount++;
                                    }
                                }
                            } catch (error) {
                                console.error(`Error rebuilding critical assignment for ${dateStr}:`, error);
                            }
                        }
                    });
                });
            }
            
            // Only log if there were actual changes
            if (rebuiltCount > 0 || updatedCount > 0) {
                console.log(`Rebuilt ${rebuiltCount} critical assignments and updated ${updatedCount} duty assignments from lastDuties (in-memory only, not saved)`);
            }
        }

        // Fallback: Load data from localStorage
        function loadDataFromLocalStorage() {
            const savedGroups = localStorage.getItem('dutyShiftsGroups');
            const savedHolidays = localStorage.getItem('dutyShiftsHolidays');
            
            if (savedGroups) {
                const parsed = JSON.parse(savedGroups);
                groups = migrateGroupsFormat(parsed) || { 1: { regular: [], special: [] }, 2: { regular: [], special: [] }, 3: { regular: [], special: [] }, 4: { regular: [], special: [] } };
                
                // Initialize priorities if they don't exist (backward compatibility)
                for (let i = 1; i <= 4; i++) {
                    if (!groups[i]) continue;
                    if (!groups[i].priorities) groups[i].priorities = {};
                    
                    // Ensure all people in lists have priority entries
                    const listTypes = ['special', 'weekend', 'semi', 'normal'];
                    listTypes.forEach(listType => {
                        const list = groups[i][listType] || [];
                        list.forEach(person => {
                            if (!groups[i].priorities[person]) {
                                groups[i].priorities[person] = {};
                            }
                            if (groups[i].priorities[person][listType] === undefined) {
                                groups[i].priorities[person][listType] = 999; // Default priority
                            }
                        });
                    });
                }
            }
            if (savedHolidays) {
                holidays = JSON.parse(savedHolidays);
            }
            
            const savedSpecialHolidays = localStorage.getItem('dutyShiftsSpecialHolidays');
            if (savedSpecialHolidays) {
                specialHolidays = JSON.parse(savedSpecialHolidays);
            }
            
            // Load recurring holidays configuration
            loadRecurringHolidaysConfig();
            
            // Initialize default special holidays if they don't exist
            initializeDefaultSpecialHolidays();
            
            // Load separate day-type assignments
            const savedNormalDayAssignments = localStorage.getItem('dutyShiftsNormalDayAssignments');
            if (savedNormalDayAssignments) {
                normalDayAssignments = JSON.parse(savedNormalDayAssignments);
            }
            
            const savedSemiNormalAssignments = localStorage.getItem('dutyShiftsSemiNormalAssignments');
            if (savedSemiNormalAssignments) {
                semiNormalAssignments = JSON.parse(savedSemiNormalAssignments);
            }
            
            const savedWeekendAssignments = localStorage.getItem('dutyShiftsWeekendAssignments');
            if (savedWeekendAssignments) {
                weekendAssignments = JSON.parse(savedWeekendAssignments);
            }
            
            const savedSpecialHolidayAssignments = localStorage.getItem('dutyShiftsSpecialHolidayAssignments');
            if (savedSpecialHolidayAssignments) {
                specialHolidayAssignments = JSON.parse(savedSpecialHolidayAssignments);
            }
            
            // Also load legacy assignments for backward compatibility
            const savedAssignments = localStorage.getItem('dutyShiftsAssignments');
            if (savedAssignments) {
                dutyAssignments = JSON.parse(savedAssignments);
                // Merge legacy assignments into day-type-specific documents if they don't exist
                for (const dateKey in dutyAssignments) {
                    if (dateKey === 'lastUpdated' || dateKey === 'updatedBy') continue;
                    try {
                        const date = new Date(dateKey + 'T00:00:00');
                        if (isNaN(date.getTime())) continue;
                        const dayType = getDayType(date);
                        const assignmentValue = dutyAssignments[dateKey];
                        
                        if (dayType === 'special-holiday' && !specialHolidayAssignments[dateKey]) {
                            specialHolidayAssignments[dateKey] = assignmentValue;
                        } else if (dayType === 'weekend-holiday' && !weekendAssignments[dateKey]) {
                            weekendAssignments[dateKey] = assignmentValue;
                        } else if (dayType === 'semi-normal-day' && !semiNormalAssignments[dateKey]) {
                            semiNormalAssignments[dateKey] = assignmentValue;
                        } else if (dayType === 'normal-day' && !normalDayAssignments[dateKey]) {
                            normalDayAssignments[dateKey] = assignmentValue;
                        }
                    } catch (error) {
                        console.error(`Error processing legacy assignment ${dateKey}:`, error);
                    }
                }
            }
            
            // Load critical assignments
            const savedCriticalAssignments = localStorage.getItem('dutyShiftsCriticalAssignments');
            if (savedCriticalAssignments) {
                criticalAssignments = JSON.parse(savedCriticalAssignments);
                
                // Restore critical assignments to day-type-specific documents if they're missing
                Object.keys(criticalAssignments).forEach(dateKey => {
                    const criticalPeople = criticalAssignments[dateKey];
                    if (Array.isArray(criticalPeople) && criticalPeople.length > 0) {
                        const existingAssignment = getAssignmentForDate(dateKey);
                        if (!existingAssignment) {
                            setAssignmentForDate(dateKey, criticalPeople.join(', '));
                        } else {
                            // Merge critical assignments with existing ones
                            const existing = existingAssignment.split(', ');
                            criticalPeople.forEach(person => {
                                if (!existing.includes(person)) {
                                    existing.push(person);
                                }
                            });
                            setAssignmentForDate(dateKey, existing.join(', '));
                        }
                    }
                });
            }
            
            // Load assignment reasons (swap/skip indicators)
            const savedAssignmentReasons = localStorage.getItem('dutyShiftsAssignmentReasons');
            if (savedAssignmentReasons) {
                assignmentReasons = JSON.parse(savedAssignmentReasons);
            } else {
                assignmentReasons = {};
            }
            
            // Load cross-month swaps from localStorage
            const savedCrossMonthSwaps = localStorage.getItem('dutyShiftsCrossMonthSwaps');
            if (savedCrossMonthSwaps) {
                try {
                    crossMonthSwaps = JSON.parse(savedCrossMonthSwaps);
                    console.log('Loaded crossMonthSwaps from localStorage:', Object.keys(crossMonthSwaps).length, 'dates');
                } catch (e) {
                    console.error('Error parsing crossMonthSwaps from localStorage:', e);
                    crossMonthSwaps = {};
                }
            } else {
                crossMonthSwaps = {};
            }
            
            // Load last rotation positions from localStorage
            const savedLastRotationPositions = localStorage.getItem('dutyShiftsLastRotationPositions');
            if (savedLastRotationPositions) {
                try {
                    const parsed = JSON.parse(savedLastRotationPositions);
                    if (parsed.normal) lastRotationPositions.normal = parsed.normal;
                    if (parsed.semi) lastRotationPositions.semi = parsed.semi;
                    if (parsed.weekend) lastRotationPositions.weekend = parsed.weekend;
                    if (parsed.special) lastRotationPositions.special = parsed.special;
                    console.log('Loaded lastRotationPositions from localStorage:', lastRotationPositions);
                } catch (e) {
                    console.error('Error parsing lastRotationPositions from localStorage:', e);
                }
            }
            
            // Load rankings
            const savedRankings = localStorage.getItem('dutyShiftsRankings');
            if (savedRankings) {
                rankings = JSON.parse(savedRankings);
            }
            
            // Reset rankingsModified flag after loading from localStorage
            rankingsModified = false;
            
            // After loading from localStorage, rebuild criticalAssignments from lastDuties
            rebuildCriticalAssignmentsFromLastDuties();
        }

        // Helper function to sanitize data for Firestore (remove undefined, functions, etc.)
        function sanitizeForFirestore(obj) {
            if (obj === null || obj === undefined) {
                return null;
            }
            
            // Handle arrays
            if (Array.isArray(obj)) {
                return obj.map(item => sanitizeForFirestore(item)).filter(item => item !== undefined);
            }
            
            // Handle Date objects - convert to ISO string
            if (obj instanceof Date) {
                return obj.toISOString();
            }
            
            // Handle functions - skip them
            if (typeof obj === 'function') {
                return undefined;
            }
            
            // Handle primitives
            if (typeof obj !== 'object') {
                return obj;
            }
            
            // Handle objects
            const sanitized = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    // Skip Firestore metadata fields that will be added separately
                    if (key === 'lastUpdated' || key === 'updatedBy' || key === '_migratedFrom' || key === '_migrationDate') {
                        continue;
                    }
                    
                    const value = sanitizeForFirestore(obj[key]);
                    // Only add if value is not undefined
                    if (value !== undefined) {
                        sanitized[key] = value;
                    }
                }
            }
            return sanitized;
        }

        // Save data to Firebase Firestore
        async function saveData() {
            try {
                // Wait for Firebase to be ready
                if (!window.db) {
                    console.log('Firebase not ready, saving to localStorage');
                    saveDataToLocalStorage();
                    return;
                }
                
                const db = window.db || firebase.firestore();
                const user = window.auth?.currentUser;
                
                if (!user) {
                    console.log('User not authenticated, saving to localStorage');
                    saveDataToLocalStorage();
                    return;
                }
                
                // Save groups
                try {
                    const sanitizedGroups = sanitizeForFirestore(groups);
                await db.collection('dutyShifts').doc('groups').set({
                        ...sanitizedGroups,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: user.uid
                });
                } catch (error) {
                    console.error('Error saving groups to Firestore:', error);
                }
                
                // Save holidays
                try {
                await db.collection('dutyShifts').doc('holidays').set({
                        list: Array.isArray(holidays) ? holidays : [],
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: user.uid
                });
                } catch (error) {
                    console.error('Error saving holidays to Firestore:', error);
                }
                
                // Save special holidays
                try {
                await db.collection('dutyShifts').doc('specialHolidays').set({
                        list: Array.isArray(specialHolidays) ? specialHolidays : [],
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: user.uid
                });
                } catch (error) {
                    console.error('Error saving specialHolidays to Firestore:', error);
                }
                
                // Save assignments to separate documents by day type, organized by month
                // Only save if there are actual assignments to avoid overwriting with empty data
                try {
                    const assignmentCount = Object.keys(normalDayAssignments).filter(key => 
                        key !== 'lastUpdated' && key !== 'updatedBy' && key !== '_migratedFrom' && key !== '_migrationDate'
                    ).length;
                    if (assignmentCount > 0) {
                        const organizedNormal = organizeAssignmentsByMonth(normalDayAssignments);
                        const sanitizedNormal = sanitizeForFirestore(organizedNormal);
                    await db.collection('dutyShifts').doc('normalDayAssignments').set({
                            ...sanitizedNormal,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                        console.log('Saved normalDayAssignments organized by month:', Object.keys(organizedNormal).length, 'months', assignmentCount, 'assignments');
                    } else {
                        console.log('Skipping save of normalDayAssignments - no assignments to save');
                    }
                } catch (error) {
                    console.error('Error saving normalDayAssignments to Firestore:', error);
                }
                
                try {
                    const assignmentCount = Object.keys(semiNormalAssignments).filter(key => 
                        key !== 'lastUpdated' && key !== 'updatedBy' && key !== '_migratedFrom' && key !== '_migrationDate'
                    ).length;
                    if (assignmentCount > 0) {
                        const organizedSemi = organizeAssignmentsByMonth(semiNormalAssignments);
                        const sanitizedSemi = sanitizeForFirestore(organizedSemi);
                    await db.collection('dutyShifts').doc('semiNormalAssignments').set({
                            ...sanitizedSemi,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                        console.log('Saved semiNormalAssignments organized by month:', Object.keys(organizedSemi).length, 'months', assignmentCount, 'assignments');
                    } else {
                        console.log('Skipping save of semiNormalAssignments - no assignments to save');
                    }
                } catch (error) {
                    console.error('Error saving semiNormalAssignments to Firestore:', error);
                }
                
                try {
                    const assignmentCount = Object.keys(weekendAssignments).filter(key => 
                        key !== 'lastUpdated' && key !== 'updatedBy' && key !== '_migratedFrom' && key !== '_migrationDate'
                    ).length;
                    if (assignmentCount > 0) {
                        const organizedWeekend = organizeAssignmentsByMonth(weekendAssignments);
                        const sanitizedWeekend = sanitizeForFirestore(organizedWeekend);
                    await db.collection('dutyShifts').doc('weekendAssignments').set({
                            ...sanitizedWeekend,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                        console.log('Saved weekendAssignments organized by month:', Object.keys(organizedWeekend).length, 'months', assignmentCount, 'assignments');
                    } else {
                        console.log('Skipping save of weekendAssignments - no assignments to save');
                    }
                } catch (error) {
                    console.error('Error saving weekendAssignments to Firestore:', error);
                }
                
                try {
                    const assignmentCount = Object.keys(specialHolidayAssignments).filter(key => 
                        key !== 'lastUpdated' && key !== 'updatedBy' && key !== '_migratedFrom' && key !== '_migrationDate'
                    ).length;
                    if (assignmentCount > 0) {
                        const organizedSpecial = organizeAssignmentsByMonth(specialHolidayAssignments);
                        const sanitizedSpecial = sanitizeForFirestore(organizedSpecial);
                    await db.collection('dutyShifts').doc('specialHolidayAssignments').set({
                            ...sanitizedSpecial,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                        console.log('Saved specialHolidayAssignments organized by month:', Object.keys(organizedSpecial).length, 'months', assignmentCount, 'assignments');
                    } else {
                        console.log('Skipping save of specialHolidayAssignments - no assignments to save');
                    }
                } catch (error) {
                    console.error('Error saving specialHolidayAssignments to Firestore:', error);
                }
                
                // Save critical assignments separately
                try {
                console.log('Saving criticalAssignments to Firestore:', Object.keys(criticalAssignments).length, 'dates');
                if (Object.keys(criticalAssignments).length > 0) {
                    console.log('Sample criticalAssignments being saved:', Object.entries(criticalAssignments).slice(0, 3));
                }
                    const sanitizedCritical = sanitizeForFirestore(criticalAssignments);
                await db.collection('dutyShifts').doc('criticalAssignments').set({
                        ...sanitizedCritical,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: user.uid
                });
                } catch (error) {
                    console.error('Error saving criticalAssignments to Firestore:', error);
                }
                
                // Save cross-month swaps separately
                try {
                    console.log('Saving crossMonthSwaps to Firestore:', Object.keys(crossMonthSwaps).length, 'dates');
                    if (Object.keys(crossMonthSwaps).length > 0) {
                        const sanitizedCrossMonth = sanitizeForFirestore(crossMonthSwaps);
                        await db.collection('dutyShifts').doc('crossMonthSwaps').set({
                            ...sanitizedCrossMonth,
                            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                            updatedBy: user.uid
                        });
                        console.log('Saved crossMonthSwaps to Firestore successfully');
                    } else {
                        console.log('No crossMonthSwaps to save');
                    }
                } catch (error) {
                    console.error('Error saving crossMonthSwaps to Firestore:', error);
                }
                
                // Save assignment reasons (swap/skip indicators) separately
                try {
                    console.log('Saving assignmentReasons to Firestore:', Object.keys(assignmentReasons).length, 'dates');
                    if (Object.keys(assignmentReasons).length > 0) {
                        console.log('Sample assignmentReasons being saved:', Object.entries(assignmentReasons).slice(0, 3));
                    }
                    const sanitizedReasons = sanitizeForFirestore(assignmentReasons);
                    await db.collection('dutyShifts').doc('assignmentReasons').set({
                        ...sanitizedReasons,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Assignment reasons saved to Firestore successfully');
                } catch (error) {
                    console.error('Error saving assignmentReasons to Firestore:', error);
                }
                
                // Save rankings to Firestore ONLY if they have been modified
                // This prevents saving rankings on every page refresh or when other data is saved
                if (rankingsModified) {
                    // Check if rankings object has any actual ranking data (not just metadata)
                    const rankingsData = { ...rankings };
                    delete rankingsData.lastUpdated;
                    delete rankingsData.updatedBy;
                    const hasRankingsData = Object.keys(rankingsData).length > 0;
                    
                    if (hasRankingsData) {
                        try {
                            console.log('Saving rankings to Firestore (rankings were modified):', Object.keys(rankingsData).length, 'people');
                            const sanitizedRankings = sanitizeForFirestore(rankingsData);
                            await db.collection('dutyShifts').doc('rankings').set({
                                ...sanitizedRankings,
                                lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                                updatedBy: user.uid
                            });
                            console.log('Rankings saved to Firestore successfully');
                            
                            // Reset flag after successful save
                            rankingsModified = false;
                        } catch (error) {
                            console.error('Error saving rankings to Firestore:', error);
                        }
                    } else {
                        console.log('Skipping rankings save - no rankings data to save (preventing overwrite of existing rankings)');
                        rankingsModified = false;
                    }
                } else {
                    console.log('Skipping rankings save - rankings have not been modified since last load');
                }
                
                // Save last rotation positions (this is called separately from executeCalculation)
                // But we also save it here as a backup
                try {
                    if (Object.keys(lastRotationPositions.normal).length > 0 || 
                        Object.keys(lastRotationPositions.semi).length > 0 ||
                        Object.keys(lastRotationPositions.weekend).length > 0 ||
                        Object.keys(lastRotationPositions.special).length > 0) {
                        const sanitizedPositions = sanitizeForFirestore(lastRotationPositions);
                        await db.collection('dutyShifts').doc('lastRotationPositions').set({
                            ...sanitizedPositions,
                            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                            updatedBy: user.uid
                        });
                        console.log('Saved lastRotationPositions to Firestore');
                    }
                } catch (error) {
                    console.error('Error saving lastRotationPositions to Firestore:', error);
                }
                
                console.log('Data saved to Firebase');
                
                // Also save to localStorage as backup
                saveDataToLocalStorage();
            } catch (error) {
                console.error('Error saving data to Firebase:', error);
                console.error('Error details:', error.message, error.stack);
                // Fallback to localStorage
                saveDataToLocalStorage();
            }
        }

        // Migration function: Split assignments by day type
        async function migrateAssignmentsByDayType() {
            try {
                if (!window.db) {
                    alert('Firebase not ready');
                    return;
                }
                
                const db = window.db || firebase.firestore();
                const user = window.auth?.currentUser;
                
                if (!user) {
                    alert('User not authenticated');
                    return;
                }
                
                // Confirm migration
                if (!confirm('Αυτή η λειτουργία θα διαχωρίσει τις υπηρεσίες σε 4 ξεχωριστά έγγραφα ανά τύπο ημέρας.\n\nΣυνέχεια;')) {
                    return;
                }
                
                console.log('Starting migration: Splitting assignments by day type...');
                
                // Load current assignments
                const assignmentsDoc = await db.collection('dutyShifts').doc('assignments').get();
                if (!assignmentsDoc.exists) {
                    alert('Δεν βρέθηκε έγγραφο assignments');
                    return;
                }
                
                const data = assignmentsDoc.data();
                // Remove metadata fields
                const assignments = { ...data };
                delete assignments.lastUpdated;
                delete assignments.updatedBy;
                
                // Initialize separate assignment objects
                const normalDayAssignments = {};
                const semiNormalAssignments = {};
                const weekendAssignments = {};
                const specialHolidayAssignments = {};
                
                let processedCount = 0;
                let errorCount = 0;
                
                // Process each date
                for (const dateKey in assignments) {
                    if (dateKey === 'lastUpdated' || dateKey === 'updatedBy') continue;
                    
                    try {
                        // Parse date key (format: YYYY-MM-DD)
                        const date = new Date(dateKey + 'T00:00:00');
                        if (isNaN(date.getTime())) {
                            console.warn(`Invalid date key: ${dateKey}`);
                            errorCount++;
                            continue;
                        }
                        
                        // Determine day type
                        const dayType = getDayType(date);
                        const assignmentValue = assignments[dateKey];
                        
                        // Split based on day type
                        if (dayType === 'special-holiday') {
                            specialHolidayAssignments[dateKey] = assignmentValue;
                        } else if (dayType === 'weekend-holiday') {
                            weekendAssignments[dateKey] = assignmentValue;
                        } else if (dayType === 'semi-normal-day') {
                            semiNormalAssignments[dateKey] = assignmentValue;
                        } else if (dayType === 'normal-day') {
                            normalDayAssignments[dateKey] = assignmentValue;
                        } else {
                            console.warn(`Unknown day type for ${dateKey}: ${dayType}`);
                            errorCount++;
                            continue;
                        }
                        
                        processedCount++;
                    } catch (error) {
                        console.error(`Error processing ${dateKey}:`, error);
                        errorCount++;
                    }
                }
                
                // Save to separate documents
                console.log('Saving split assignments...');
                
                await db.collection('dutyShifts').doc('normalDayAssignments').set({
                    ...normalDayAssignments,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: user.uid,
                    _migratedFrom: 'assignments',
                    _migrationDate: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                await db.collection('dutyShifts').doc('semiNormalAssignments').set({
                    ...semiNormalAssignments,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: user.uid,
                    _migratedFrom: 'assignments',
                    _migrationDate: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                await db.collection('dutyShifts').doc('weekendAssignments').set({
                    ...weekendAssignments,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: user.uid,
                    _migratedFrom: 'assignments',
                    _migrationDate: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                await db.collection('dutyShifts').doc('specialHolidayAssignments').set({
                    ...specialHolidayAssignments,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: user.uid,
                    _migratedFrom: 'assignments',
                    _migrationDate: firebase.firestore.FieldValue.serverTimestamp()
                });
                
                console.log('Migration completed!');
                console.log(`Processed: ${processedCount} dates`);
                console.log(`Errors: ${errorCount}`);
                console.log(`Normal days: ${Object.keys(normalDayAssignments).length}`);
                console.log(`Semi-normal days: ${Object.keys(semiNormalAssignments).length}`);
                console.log(`Weekend/Holiday days: ${Object.keys(weekendAssignments).length}`);
                console.log(`Special holidays: ${Object.keys(specialHolidayAssignments).length}`);
                
                alert(`Μεταφορά ολοκληρώθηκε!\n\nΕπεξεργάστηκε: ${processedCount} ημερομηνίες\nΣφάλματα: ${errorCount}\n\nΚαθημερινές: ${Object.keys(normalDayAssignments).length}\nΗμιαργίες: ${Object.keys(semiNormalAssignments).length}\nΣαββατοκύριακα/Αργίες: ${Object.keys(weekendAssignments).length}\nΕιδικές Αργίες: ${Object.keys(specialHolidayAssignments).length}`);
                
            } catch (error) {
                console.error('Error during migration:', error);
                alert('Σφάλμα κατά τη μεταφορά: ' + error.message);
            }
        }

        // Fallback: Save data to localStorage
        function saveDataToLocalStorage() {
            localStorage.setItem('dutyShiftsGroups', JSON.stringify(groups));
            localStorage.setItem('dutyShiftsHolidays', JSON.stringify(holidays));
            localStorage.setItem('dutyShiftsSpecialHolidays', JSON.stringify(specialHolidays));
            // Save separate day-type assignments
            localStorage.setItem('dutyShiftsNormalDayAssignments', JSON.stringify(normalDayAssignments));
            localStorage.setItem('dutyShiftsSemiNormalAssignments', JSON.stringify(semiNormalAssignments));
            localStorage.setItem('dutyShiftsWeekendAssignments', JSON.stringify(weekendAssignments));
            localStorage.setItem('dutyShiftsSpecialHolidayAssignments', JSON.stringify(specialHolidayAssignments));
            // Also save legacy dutyAssignments for backward compatibility
            localStorage.setItem('dutyShiftsAssignments', JSON.stringify(dutyAssignments));
            localStorage.setItem('dutyShiftsCriticalAssignments', JSON.stringify(criticalAssignments));
            localStorage.setItem('dutyShiftsAssignmentReasons', JSON.stringify(assignmentReasons));
            localStorage.setItem('dutyShiftsCrossMonthSwaps', JSON.stringify(crossMonthSwaps));
            localStorage.setItem('dutyShiftsLastRotationPositions', JSON.stringify(lastRotationPositions));
            localStorage.setItem('dutyShiftsRankings', JSON.stringify(rankings));
        }

        // Get group name by number
        function getGroupName(groupNum) {
            const groupNames = {
                1: 'ΕΠΙΚΕΦΑΛΗΣ-ΑΥΜ',
                2: 'ΜΗΧΑΝΙΚΟΣ-ΟΠΛΟΥΡΓΟΣ-ΟΔΗΓΟΣ',
                3: 'ΤΕΧΝΙΚΟΣ Ε/Π AW139',
                4: 'ΤΕΧΝΙΚΟΣ ΕΠΙΓΕΙΩΝ ΜΕΣΩΝ'
            };
            return groupNames[groupNum] || `Ομάδα ${groupNum}`;
        }

        // Migrate old groups format to new format
        function migrateGroupsFormat(data) {
            if (!data) return null;
            
            const migrated = {
                1: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {} },
                2: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {} },
                3: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {} },
                4: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {} }
            };
            
            for (let i = 1; i <= 4; i++) {
                if (Array.isArray(data[i])) {
                    // Old format - array of names, copy to all lists
                    const people = [...data[i]];
                    migrated[i].special = [...people];
                    migrated[i].weekend = [...people];
                    migrated[i].semi = [...people];
                    migrated[i].normal = [...people];
                    // Preserve lastDuties, missingPeriods, and priorities if they exist (shouldn't in old format, but just in case)
                    if (data[i].lastDuties) migrated[i].lastDuties = data[i].lastDuties;
                    if (data[i].missingPeriods) migrated[i].missingPeriods = data[i].missingPeriods;
                    if (data[i].priorities) migrated[i].priorities = data[i].priorities;
                } else if (data[i] && typeof data[i] === 'object') {
                    // ALWAYS preserve lastDuties, missingPeriods, and priorities if they exist
                    if (data[i].lastDuties) migrated[i].lastDuties = data[i].lastDuties;
                    if (data[i].missingPeriods) migrated[i].missingPeriods = data[i].missingPeriods;
                    if (data[i].priorities) migrated[i].priorities = data[i].priorities;
                    
                    // Check if old format (regular/special) or new format
                    if (data[i].regular || data[i].special) {
                        // Old format with regular/special
                        const allPeople = [...new Set([...(data[i].regular || []), ...(data[i].special || [])])];
                        migrated[i].special = [...allPeople];
                        migrated[i].weekend = [...allPeople];
                        migrated[i].semi = [...allPeople];
                        migrated[i].normal = [...allPeople];
                    } else if (data[i].special || data[i].weekend || data[i].semi || data[i].normal) {
                        // New format - copy as is
                        migrated[i].special = data[i].special || [];
                        migrated[i].weekend = data[i].weekend || [];
                        migrated[i].semi = data[i].semi || [];
                        migrated[i].normal = data[i].normal || [];
                    } else {
                        // Fallback
                        const people = data[i].people || [];
                        migrated[i].special = [...people];
                        migrated[i].weekend = [...people];
                        migrated[i].semi = [...people];
                        migrated[i].normal = [...people];
                    }
                    // Preserve lastDuties, missingPeriods, and priorities if they exist (for all cases)
                    if (data[i].lastDuties) migrated[i].lastDuties = data[i].lastDuties;
                    if (data[i].missingPeriods) migrated[i].missingPeriods = data[i].missingPeriods;
                    if (data[i].priorities) migrated[i].priorities = data[i].priorities;
                }
            }
            
            return migrated;
        }

        // Helper function to track which lists are currently open
        function getOpenLists() {
            const openLists = [];
            for (let i = 1; i <= 4; i++) {
                const listTypes = ['special', 'weekend', 'semi', 'normal'];
                listTypes.forEach(lt => {
                    const listId = `${lt}List_${i}`;
                    const listElement = document.getElementById(listId);
                    if (listElement && listElement.classList.contains('show')) {
                        openLists.push(listId);
                    }
                });
            }
            return openLists;
        }

        // Helper function to restore open lists after renderGroups
        function restoreOpenLists(openLists) {
            if (!openLists || openLists.length === 0) return;
            
            setTimeout(() => {
                openLists.forEach(listId => {
                    const listElement = document.getElementById(listId);
                    if (listElement) {
                        const bsCollapse = new bootstrap.Collapse(listElement, {
                            toggle: false
                        });
                        bsCollapse.show();
                        // Update chevron
                        const chevronId = listId.replace('List_', 'Chevron_');
                        const chevronElement = document.getElementById(chevronId);
                        if (chevronElement) {
                            chevronElement.classList.remove('fa-chevron-down');
                            chevronElement.classList.add('fa-chevron-up');
                        }
                    }
                });
            }, 50);
        }

        // Render groups - shows 4 separate order lists per group
        // preserveOpenLists: if true, preserves currently open lists
        // forceOpenLists: array of list IDs that should be opened after render
        function renderGroups(preserveOpenLists = true, forceOpenLists = []) {
            // Track open lists before rendering if preserveOpenLists is true
            const openLists = preserveOpenLists ? getOpenLists() : [];
            
            // Add any forced open lists to the list
            if (forceOpenLists && forceOpenLists.length > 0) {
                forceOpenLists.forEach(listId => {
                    if (!openLists.includes(listId)) {
                        openLists.push(listId);
                    }
                });
            }
            for (let i = 1; i <= 4; i++) {
                const container = document.getElementById(`group${i}People`);
                container.innerHTML = '';
                
                const groupData = groups[i] || { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, priorities: {} };
                
                // Ensure priorities exist
                if (!groupData.priorities) groupData.priorities = {};
                
                // Sort each list by priority before rendering
                const listTypes = ['special', 'weekend', 'semi', 'normal'];
                listTypes.forEach(listType => {
                    if (groupData[listType]) {
                        groupData[listType].sort((a, b) => {
                            // Get priorities (default to 999 if not set)
                            const priorityA = groupData.priorities[a]?.[listType] ?? 999;
                            const priorityB = groupData.priorities[b]?.[listType] ?? 999;
                            
                            // First sort by priority (lower number = higher priority)
                            if (priorityA !== priorityB) {
                                return priorityA - priorityB;
                            }
                            
                            // If priorities are equal, sort by last duty date (most recent first, no date last)
                            const dateA = groupData.lastDuties?.[a]?.[listType];
                            const dateB = groupData.lastDuties?.[b]?.[listType];
                            
                            if (!dateA && !dateB) return 0; // Both have no date, maintain order
                            if (!dateA) return 1; // A has no date, put it last
                            if (!dateB) return -1; // B has no date, put it last
                            
                            // Both have dates, sort by date (most recent first)
                            return new Date(dateB) - new Date(dateA);
                        });
                    }
                });
                
                const specialList = groupData.special || [];
                const weekendList = groupData.weekend || [];
                const semiList = groupData.semi || [];
                const normalList = groupData.normal || [];
                
                const allPeople = new Set([...specialList, ...weekendList, ...semiList, ...normalList]);
                
                if (allPeople.size === 0) {
                    container.innerHTML = '<p class="text-muted text-center">Δεν έχουν προστεθεί άτομα ακόμα</p>';
                } else {
                    // Special holidays order
                    const specialDiv = document.createElement('div');
                    specialDiv.className = 'mb-3 border rounded p-2';
                    specialDiv.innerHTML = `
                        <div class="list-header d-flex justify-content-between align-items-center mb-2" onclick="toggleListCollapse('specialList_${i}', 'specialChevron_${i}')">
                            <strong class="text-warning"><i class="fas fa-star me-1"></i>Σειρά Ειδικών Αργιών:</strong>
                            <i id="specialChevron_${i}" class="fas fa-chevron-down"></i>
                        </div>
                        <div id="specialList_${i}" class="collapse"></div>
                    `;
                    container.appendChild(specialDiv);
                    
                    // Weekend/Holiday order
                    const weekendDiv = document.createElement('div');
                    weekendDiv.className = 'mb-3 border rounded p-2';
                    weekendDiv.innerHTML = `
                        <div class="list-header d-flex justify-content-between align-items-center mb-2" onclick="toggleListCollapse('weekendList_${i}', 'weekendChevron_${i}')">
                            <strong class="text-info"><i class="fas fa-calendar-week me-1"></i>Σειρά Σαββατοκύριακων/Αργιών:</strong>
                            <i id="weekendChevron_${i}" class="fas fa-chevron-down"></i>
                        </div>
                        <div id="weekendList_${i}" class="collapse"></div>
                    `;
                    container.appendChild(weekendDiv);
                    
                    // Ημιαργία order
                    const semiDiv = document.createElement('div');
                    semiDiv.className = 'mb-3 border rounded p-2';
                    semiDiv.innerHTML = `
                        <div class="list-header d-flex justify-content-between align-items-center mb-2" onclick="toggleListCollapse('semiList_${i}', 'semiChevron_${i}')">
                            <strong class="text-warning"><i class="fas fa-calendar-alt me-1"></i>Σειρά Ημιαργιών:</strong>
                            <i id="semiChevron_${i}" class="fas fa-chevron-down"></i>
                        </div>
                        <div id="semiList_${i}" class="collapse"></div>
                    `;
                    container.appendChild(semiDiv);
                    
                    // Καθημερινή order
                    const normalDiv = document.createElement('div');
                    normalDiv.className = 'mb-3 border rounded p-2';
                    normalDiv.innerHTML = `
                        <div class="list-header d-flex justify-content-between align-items-center mb-2" onclick="toggleListCollapse('normalList_${i}', 'normalChevron_${i}')">
                            <strong class="text-primary"><i class="fas fa-calendar-day me-1"></i>Σειρά Καθημερινών:</strong>
                            <i id="normalChevron_${i}" class="fas fa-chevron-down"></i>
                        </div>
                        <div id="normalList_${i}" class="collapse"></div>
                    `;
                    container.appendChild(normalDiv);
                    
                    // Render each list
                    const lists = [
                        { type: 'special', list: specialList, containerId: `specialList_${i}` },
                        { type: 'weekend', list: weekendList, containerId: `weekendList_${i}` },
                        { type: 'semi', list: semiList, containerId: `semiList_${i}` },
                        { type: 'normal', list: normalList, containerId: `normalList_${i}` }
                    ];
                    
                    lists.forEach(({ type, list, containerId }) => {
                        const listContainer = document.getElementById(containerId);
                        if (list.length === 0) {
                            listContainer.innerHTML = '<p class="text-muted text-center small">Δεν υπάρχουν άτομα</p>';
                        } else {
                            list.forEach((person, index) => {
                                const personDiv = createPersonItem(i, person, index, type, list);
                                listContainer.appendChild(personDiv);
                            });
                        }
                    });
                }
                
                const rotationSpan = document.getElementById(`group${i}Rotation`);
                rotationSpan.textContent = allPeople.size > 0 ? allPeople.size : '-';
            }
            
            // Restore open lists if preserveOpenLists is true
            if (preserveOpenLists && openLists.length > 0) {
                restoreOpenLists(openLists);
            }
        }

        // Helper function to get last duty date and calculate next duty date based on rotation order
        function getLastAndNextDutyDates(person, groupNum, listType, listArrayLength) {
            const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [], lastDuties: {} };
            const lastDuties = groupData.lastDuties?.[person] || {};
            const lastDutyDateStr = lastDuties[listType];
            
            let lastDutyDate = null;
            let lastDutyFormatted = 'Δεν έχει';
            
            // First check manually entered last duty date
            if (lastDutyDateStr) {
                // Parse the date string - handle both YYYY-MM-DD and DD/MM/YYYY formats
                let parsedDate = null;
                if (lastDutyDateStr.includes('/')) {
                    // DD/MM/YYYY or DD/MM/YY format
                    const parts = lastDutyDateStr.split('/');
                    if (parts.length === 3) {
                        let year = parseInt(parts[2]);
                        const month = parseInt(parts[1]);
                        const day = parseInt(parts[0]);
                        // Handle 2-digit years: if year < 50, assume 20XX, else assume 19XX
                        if (year < 100) {
                            year = year < 50 ? 2000 + year : 1900 + year;
                        }
                        // Validate the date components
                        if (!isNaN(year) && !isNaN(month) && !isNaN(day) && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                            parsedDate = new Date(year, month - 1, day);
                        }
                    }
                } else {
                    // YYYY-MM-DD format
                    parsedDate = new Date(lastDutyDateStr + 'T00:00:00');
                }
                if (parsedDate && !isNaN(parsedDate.getTime())) {
                    // Create a fresh Date object to avoid any reference issues
                    lastDutyDate = new Date(parsedDate.getTime());
                    lastDutyDate.setHours(0, 0, 0, 0);
                    lastDutyFormatted = lastDutyDate.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                }
            }
            
            // If no manually entered date, check actual assignments to find most recent duty of THIS SPECIFIC TYPE
            if (!lastDutyDate) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                // Look through assignments to find most recent duty of this SPECIFIC type
                const sortedDateKeys = Object.keys(dutyAssignments).sort().reverse();
                
                for (const dateKey of sortedDateKeys) {
                    const assignment = dutyAssignments[dateKey];
                    if (!assignment) continue;
                    
                    // Use extractAllPersonNames to properly parse the assignment string
                    const assignedPersons = extractAllPersonNames(assignment);
                    
                    // Check if this person is assigned on this date
                    const isPersonAssigned = assignedPersons.some(p => 
                        p.name === person && p.group === groupNum
                    );
                    
                    if (!isPersonAssigned) continue;
                    
                    const assignmentDate = new Date(dateKey + 'T00:00:00');
                    if (isNaN(assignmentDate.getTime())) continue; // Skip invalid dates
                    assignmentDate.setHours(0, 0, 0, 0);
                    if (assignmentDate > today) continue; // Skip future dates
                    
                    // Check for special holidays FIRST using isSpecialHoliday() directly
                    let dayTypeCategory = 'normal';
                    const isSpecial = isSpecialHoliday(assignmentDate);
                    if (isSpecial) {
                        dayTypeCategory = 'special';
                    } else {
                        // For non-special holidays, use getDayType()
                        const dayType = getDayType(assignmentDate);
                        if (dayType === 'semi-normal-day') {
                            dayTypeCategory = 'semi';
                        } else if (dayType === 'weekend-holiday') {
                            dayTypeCategory = 'weekend';
                        }
                        // else remains 'normal'
                    }
                    
                    // Only consider assignments that match the EXACT listType we're looking for
                    if (dayTypeCategory === listType) {
                        // Create a fresh Date object to avoid any reference issues
                        lastDutyDate = new Date(assignmentDate.getTime());
                        lastDutyDate.setHours(0, 0, 0, 0);
                        lastDutyFormatted = lastDutyDate.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        break; // Found the most recent one, stop searching
                    }
                }
            }
            
            // Calculate next duty date based on rotation order (not person's last duty)
            let nextDutyFormatted = 'Δεν έχει';
            
            if (listArrayLength > 0) {
                // Get the person's index in the list (their rotation position)
                const list = groups[groupNum]?.[listType] || [];
                const personIndex = list.indexOf(person);
                
                if (personIndex === -1) {
                    return { lastDuty: lastDutyFormatted, nextDuty: 'Δεν έχει' };
                }
                
                // Find all upcoming days of this type starting from today
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                
                const upcomingDays = [];
                const checkDate = new Date(today);
                const maxDaysAhead = 3650; // 10 years limit
                let daysChecked = 0;
                
                // Collect all upcoming days of the matching type
                while (daysChecked < maxDaysAhead && upcomingDays.length < listArrayLength * 3) {
                    // Check for special holidays FIRST using isSpecialHoliday() directly
                    let dayTypeCategory = 'normal';
                    const isSpecial = isSpecialHoliday(checkDate);
                    if (isSpecial) {
                        dayTypeCategory = 'special';
                    } else {
                        // For non-special holidays, use getDayType()
                        const dayType = getDayType(checkDate);
                        if (dayType === 'semi-normal-day') {
                            dayTypeCategory = 'semi';
                        } else if (dayType === 'weekend-holiday') {
                            dayTypeCategory = 'weekend';
                        }
                        // else remains 'normal'
                    }
                    
                    // If this day matches the list type, add it
                    if (dayTypeCategory === listType) {
                        upcomingDays.push(new Date(checkDate));
                    }
                    
                    // Move to next day
                    checkDate.setDate(checkDate.getDate() + 1);
                    daysChecked++;
                }
                
                // Find the next day that matches this person's rotation position
                // Person at index 0 gets days: 0, listLength, 2*listLength, ...
                // Person at index 1 gets days: 1, listLength+1, 2*listLength+1, ...
                // Person at index 2 gets days: 2, listLength+2, 2*listLength+2, ...
                for (let i = 0; i < upcomingDays.length; i++) {
                    if (i % listArrayLength === personIndex) {
                        nextDutyFormatted = upcomingDays[i].toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        break;
                    }
                }
                
                if (nextDutyFormatted === 'Δεν έχει' && upcomingDays.length > 0) {
                    nextDutyFormatted = 'Δεν βρέθηκε';
                }
            }
            
            return { lastDuty: lastDutyFormatted, nextDuty: nextDutyFormatted };
        }

        // Create person item with reorder controls
        function createPersonItem(groupNum, person, index, listType, listArray) {
            const personDiv = document.createElement('div');
            personDiv.className = 'person-item';
            personDiv.draggable = true;
            personDiv.dataset.groupNum = groupNum;
            personDiv.dataset.index = index;
            personDiv.dataset.listType = listType;
            
            // Check if person is currently missing
            const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {} };
            const missingPeriods = groupData.missingPeriods?.[person] || [];
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const isCurrentlyMissing = missingPeriods.some(period => {
                const start = new Date(period.start + 'T00:00:00');
                const end = new Date(period.end + 'T00:00:00');
                return today >= start && today <= end;
            });
            const missingBadge = isCurrentlyMissing ? '<span class="badge bg-warning ms-2"><i class="fas fa-user-slash me-1"></i>Απουσία</span>' : '';
            
            // Get last duty date and calculate next duty date
            const dutyDates = getLastAndNextDutyDates(person, groupNum, listType, listArray.length);
            
            // Get priority number for this person in this list type
            const priority = groupData.priorities?.[person]?.[listType] ?? 999;
            
            // Determine priority class based on value (1-3 = high, 4-6 = medium, 7+ = low)
            let priorityClass = 'priority-low';
            if (priority <= 3) {
                priorityClass = 'priority-high';
            } else if (priority <= 6) {
                priorityClass = 'priority-medium';
            }
            
            // Create 3D priority badge
            const priorityBadge = priority < 999 ? 
                `<div class="priority-badge-3d ${priorityClass}" onclick="event.stopPropagation(); editPerson(${groupNum}, '${person.replace(/'/g, "\\'")}')" title="Προτεραιότητα: ${priority} - Κάντε κλικ για επεξεργασία">
                    ${priority}
                </div>` : 
                `<div class="priority-badge-3d priority-low" onclick="event.stopPropagation(); editPerson(${groupNum}, '${person.replace(/'/g, "\\'")}')" title="Δεν έχει οριστεί προτεραιότητα - Κάντε κλικ για επεξεργασία" style="opacity: 0.6;">
                    ?
                </div>`;
            
            personDiv.innerHTML = `
                <div class="person-name-card" onclick="openPersonActionsModal(${groupNum}, '${person.replace(/'/g, "\\'")}', ${index}, '${listType}')">
                    <div style="display: flex; flex-direction: column;">
                        <div style="display: flex; align-items: center;">
                            <i class="fas fa-grip-vertical text-muted me-2" style="cursor: move;"></i>
                            ${priorityBadge}
                            <span>${person}${missingBadge}</span>
                        </div>
                        <div style="font-size: 0.75rem; color: #666; margin-top: 0.25rem; margin-left: 1.5rem;">
                            <div><strong>Τελευταία:</strong> ${dutyDates.lastDuty}</div>
                            <div><strong>Επόμενη:</strong> ${dutyDates.nextDuty}</div>
                        </div>
                    </div>
                </div>
                <div class="person-actions">
                    <div class="btn-group btn-group-sm" role="group">
                        <button class="btn btn-outline-secondary" onclick="event.stopPropagation(); movePersonInList(${groupNum}, ${index}, '${listType}', 'up')" ${index === 0 ? 'disabled' : ''} title="Μετακίνηση προς τα πάνω">
                            <i class="fas fa-arrow-up"></i>
                        </button>
                        <button class="btn btn-outline-secondary" onclick="event.stopPropagation(); movePersonInList(${groupNum}, ${index}, '${listType}', 'down')" ${index === listArray.length - 1 ? 'disabled' : ''} title="Μετακίνηση προς τα κάτω">
                            <i class="fas fa-arrow-down"></i>
                        </button>
                    </div>
                </div>
            `;
            
            // Add drag and drop handlers
            personDiv.addEventListener('dragstart', handleDragStart);
            personDiv.addEventListener('dragenter', handleDragEnter);
            personDiv.addEventListener('dragleave', handleDragLeave);
            personDiv.addEventListener('dragover', handleDragOver);
            personDiv.addEventListener('drop', handleDrop);
            personDiv.addEventListener('dragend', handleDragEnd);
            
            return personDiv;
        }

        // Drag and drop handlers
        let draggedElement = null;
        let dragOverElement = null;
        
        function handleDragStart(e) {
            draggedElement = this;
            this.style.opacity = '0.5';
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        }
        
        function handleDragEnter(e) {
            if (e.preventDefault) {
                e.preventDefault();
            }
            if (draggedElement && draggedElement !== this) {
                this.classList.add('drag-over');
                dragOverElement = this;
            }
        }
        
        function handleDragLeave(e) {
            this.classList.remove('drag-over');
            if (dragOverElement === this) {
                dragOverElement = null;
            }
        }
        
        function handleDragOver(e) {
            if (e.preventDefault) {
                e.preventDefault();
            }
            e.dataTransfer.dropEffect = 'move';
            
            // Show drop indicator
            if (draggedElement && draggedElement !== this) {
                if (!this.classList.contains('drag-over')) {
                    this.classList.add('drag-over');
                }
                dragOverElement = this;
                
                // Auto-scroll when dragging near edges
                const rect = this.getBoundingClientRect();
                const scrollContainer = this.closest('.collapse.show') || this.closest('[id*="List_"]');
                
                if (scrollContainer) {
                    const containerRect = scrollContainer.getBoundingClientRect();
                    const scrollThreshold = 50; // pixels from edge
                    const scrollSpeed = 10; // pixels per scroll
                    
                    // Check if near top edge
                    if (rect.top < containerRect.top + scrollThreshold) {
                        scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - scrollSpeed);
                    }
                    // Check if near bottom edge
                    else if (rect.bottom > containerRect.bottom - scrollThreshold) {
                        scrollContainer.scrollTop = Math.min(
                            scrollContainer.scrollHeight - scrollContainer.clientHeight,
                            scrollContainer.scrollTop + scrollSpeed
                        );
                    }
                }
            }
            
            return false;
        }
        
        function handleDrop(e) {
            if (e.stopPropagation) {
                e.stopPropagation();
            }
            
            // Remove all drag-over classes
            document.querySelectorAll('.person-item.drag-over').forEach(el => {
                el.classList.remove('drag-over');
            });
            
            if (draggedElement !== this) {
                const groupNum = parseInt(this.dataset.groupNum);
                const listType = this.dataset.listType;
                const fromIndex = parseInt(draggedElement.dataset.index);
                const toIndex = parseInt(this.dataset.index);
                
                const list = groups[groupNum][listType];
                const person = list[fromIndex];
                list.splice(fromIndex, 1);
                list.splice(toIndex, 0, person);
                
                // Update priorities to reflect the new order (priority = index + 1)
                if (!groups[groupNum].priorities) groups[groupNum].priorities = {};
                list.forEach((personName, index) => {
                    if (!groups[groupNum].priorities[personName]) {
                        groups[groupNum].priorities[personName] = {};
                    }
                    groups[groupNum].priorities[personName][listType] = index + 1;
                });
                
                saveData();
                
                // Ensure the list we just modified is open
                const modifiedListId = `${listType}List_${groupNum}`;
                renderGroups(true, [modifiedListId]);
            }
            
            dragOverElement = null;
            return false;
        }
        
        function handleDragEnd(e) {
            this.style.opacity = '1';
            this.classList.remove('dragging');
            
            // Remove all drag-over classes
            document.querySelectorAll('.person-item.drag-over').forEach(el => {
                el.classList.remove('drag-over');
            });
            
            draggedElement = null;
            dragOverElement = null;
        }

        // Global variable to track if we're editing
        let isEditingPerson = false;
        let editingPersonName = null;
        
        // Global variables for person actions modal
        let currentPersonActionsGroup = null;
        let currentPersonActionsName = null;
        let currentPersonActionsIndex = null;
        let currentPersonActionsListType = null;

        // Add person
        function addPerson(groupNumber) {
            isEditingPerson = false;
            editingPersonName = null;
            currentGroup = groupNumber;
            
            document.getElementById('modalTitle').innerHTML = `Προσθήκη Ατόμου στην <span id="modalGroupNumber">${getGroupName(groupNumber)}</span>`;
            document.getElementById('personName').value = '';
            document.getElementById('personName').readOnly = false;
            document.getElementById('lastSpecialDuty').value = '';
            document.getElementById('lastWeekendDuty').value = '';
            document.getElementById('lastSemiDuty').value = '';
            document.getElementById('lastNormalDuty').value = '';
            document.getElementById('prioritySpecial').value = '';
            document.getElementById('priorityWeekend').value = '';
            document.getElementById('prioritySemi').value = '';
            document.getElementById('priorityNormal').value = '';
            document.getElementById('savePersonButton').textContent = 'Προσθήκη Ατόμου';
            
            const modal = new bootstrap.Modal(document.getElementById('addPersonModal'));
            modal.show();
        }

        // Edit person
        function editPerson(groupNumber, personName) {
            isEditingPerson = true;
            editingPersonName = personName;
            currentGroup = groupNumber;
            
            const groupData = groups[groupNumber] || { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {} };
            const lastDuties = groupData.lastDuties?.[personName] || {};
            const priorities = groupData.priorities?.[personName] || {};
            
            // Debug: Log what we're loading
            console.log(`Edit person: ${personName} in group ${groupNumber}`);
            console.log(`Group data lastDuties:`, groupData.lastDuties);
            console.log(`Person lastDuties:`, lastDuties);
            console.log(`Special: ${lastDuties.special}, Weekend: ${lastDuties.weekend}, Semi: ${lastDuties.semi}, Normal: ${lastDuties.normal}`);
            
            document.getElementById('modalTitle').innerHTML = `Επεξεργασία Στοιχείων: ${personName}`;
            document.getElementById('personName').value = personName;
            document.getElementById('personName').readOnly = false;
            document.getElementById('lastSpecialDuty').value = lastDuties.special || '';
            document.getElementById('lastWeekendDuty').value = lastDuties.weekend || '';
            document.getElementById('lastSemiDuty').value = lastDuties.semi || '';
            document.getElementById('lastNormalDuty').value = lastDuties.normal || '';
            document.getElementById('prioritySpecial').value = priorities.special || '';
            document.getElementById('priorityWeekend').value = priorities.weekend || '';
            document.getElementById('prioritySemi').value = priorities.semi || '';
            document.getElementById('priorityNormal').value = priorities.normal || '';
            document.getElementById('savePersonButton').textContent = 'Αποθήκευση Αλλαγών';
            
            // Debug: Verify values were set
            console.log(`Form values set - Special: ${document.getElementById('lastSpecialDuty').value}, Weekend: ${document.getElementById('lastWeekendDuty').value}, Semi: ${document.getElementById('lastSemiDuty').value}, Normal: ${document.getElementById('lastNormalDuty').value}`);
            
            const modal = new bootstrap.Modal(document.getElementById('addPersonModal'));
            modal.show();
        }

        // Save person - adds to all 4 lists and stores last duty dates
        function savePerson() {
            const name = document.getElementById('personName').value.trim();
            if (!name) {
                alert('Παρακαλώ εισάγετε όνομα');
                return;
            }
            
            if (!groups[currentGroup]) {
                groups[currentGroup] = { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, priorities: {} };
            }
            
            // Initialize lists if needed
            if (!groups[currentGroup].special) groups[currentGroup].special = [];
            if (!groups[currentGroup].weekend) groups[currentGroup].weekend = [];
            if (!groups[currentGroup].semi) groups[currentGroup].semi = [];
            if (!groups[currentGroup].normal) groups[currentGroup].normal = [];
            if (!groups[currentGroup].lastDuties) groups[currentGroup].lastDuties = {};
            if (!groups[currentGroup].priorities) groups[currentGroup].priorities = {};
            
            // Get last duty dates
            const lastSpecialDuty = document.getElementById('lastSpecialDuty').value;
            const lastWeekendDuty = document.getElementById('lastWeekendDuty').value;
            const lastSemiDuty = document.getElementById('lastSemiDuty').value;
            const lastNormalDuty = document.getElementById('lastNormalDuty').value;
            
            // Get priority values
            const prioritySpecial = document.getElementById('prioritySpecial').value.trim();
            const priorityWeekend = document.getElementById('priorityWeekend').value.trim();
            const prioritySemi = document.getElementById('prioritySemi').value.trim();
            const priorityNormal = document.getElementById('priorityNormal').value.trim();
            
            // Check if name changed when editing
            const nameChanged = isEditingPerson && name !== editingPersonName;
            const oldName = isEditingPerson ? editingPersonName : null;
            
            // Store last duties - use new name (name) for the key
            const personKey = name;
            
            // IMPORTANT: Read old lastDuties BEFORE updating, so we can compare and remove old assignments
            const oldLastDuties = isEditingPerson ? (groups[currentGroup].lastDuties[oldName] || {}) : {};
            
            // If name changed, we need to update all references
            if (nameChanged) {
                console.log(`[EDIT] Name changed from "${oldName}" to "${name}"`);
                
                // Update name in all 4 lists
                const listTypes = ['special', 'weekend', 'semi', 'normal'];
                listTypes.forEach(listType => {
                    const index = groups[currentGroup][listType].indexOf(oldName);
                    if (index !== -1) {
                        groups[currentGroup][listType][index] = name;
                        console.log(`[EDIT] Updated name in ${listType} list`);
                    }
                });
                
                // Rename key in lastDuties
                if (groups[currentGroup].lastDuties[oldName]) {
                    groups[currentGroup].lastDuties[name] = groups[currentGroup].lastDuties[oldName];
                    delete groups[currentGroup].lastDuties[oldName];
                    console.log(`[EDIT] Renamed lastDuties key from "${oldName}" to "${name}"`);
                }
                
                // Rename key in missingPeriods
                if (groups[currentGroup].missingPeriods && groups[currentGroup].missingPeriods[oldName]) {
                    if (!groups[currentGroup].missingPeriods[name]) {
                        groups[currentGroup].missingPeriods[name] = groups[currentGroup].missingPeriods[oldName];
                    }
                    delete groups[currentGroup].missingPeriods[oldName];
                    console.log(`[EDIT] Renamed missingPeriods key from "${oldName}" to "${name}"`);
                }
                
                // Rename key in priorities
                if (groups[currentGroup].priorities && groups[currentGroup].priorities[oldName]) {
                    if (!groups[currentGroup].priorities[name]) {
                        groups[currentGroup].priorities[name] = groups[currentGroup].priorities[oldName];
                    }
                    delete groups[currentGroup].priorities[oldName];
                    console.log(`[EDIT] Renamed priorities key from "${oldName}" to "${name}"`);
                }
                
                // Update all occurrences in dutyAssignments
                const oldPersonGroupStr = `${oldName} (Ομάδα ${currentGroup})`;
                const newPersonGroupStr = `${name} (Ομάδα ${currentGroup})`;
                
                Object.keys(dutyAssignments).forEach(dateKey => {
                    if (dutyAssignments[dateKey] && dutyAssignments[dateKey].includes(oldPersonGroupStr)) {
                        dutyAssignments[dateKey] = dutyAssignments[dateKey].replace(oldPersonGroupStr, newPersonGroupStr);
                        console.log(`[EDIT] Updated dutyAssignments[${dateKey}]`);
                    }
                });
                
                // Update all occurrences in criticalAssignments
                Object.keys(criticalAssignments).forEach(dateKey => {
                    if (criticalAssignments[dateKey]) {
                        const index = criticalAssignments[dateKey].indexOf(oldPersonGroupStr);
                        if (index !== -1) {
                            criticalAssignments[dateKey][index] = newPersonGroupStr;
                            console.log(`[EDIT] Updated criticalAssignments[${dateKey}]`);
                        }
                    }
                });
            }
            
            // Now update lastDuties with new values (using new name as key)
            groups[currentGroup].lastDuties[personKey] = {
                special: lastSpecialDuty || null,
                weekend: lastWeekendDuty || null,
                semi: lastSemiDuty || null,
                normal: lastNormalDuty || null
            };
            
            // Handle priority position shifts when editing
            if (isEditingPerson) {
                // Get old priorities before updating
                const oldPriorities = groups[currentGroup].priorities[oldName] || {};
                const listTypes = ['special', 'weekend', 'semi', 'normal'];
                const priorityInputs = {
                    special: prioritySpecial ? parseInt(prioritySpecial) : null,
                    weekend: priorityWeekend ? parseInt(priorityWeekend) : null,
                    semi: prioritySemi ? parseInt(prioritySemi) : null,
                    normal: priorityNormal ? parseInt(priorityNormal) : null
                };
                
                listTypes.forEach(listType => {
                    const oldPriority = oldPriorities[listType];
                    const newPriority = priorityInputs[listType];
                    
                    // Only process if priority actually changed and new priority is provided
                    if (newPriority !== null && oldPriority !== undefined && oldPriority !== newPriority) {
                        // Get current sorted list to find positions
                        const sortedList = [...groups[currentGroup][listType]].sort((a, b) => {
                            const priorityA = groups[currentGroup].priorities?.[a]?.[listType] ?? 999;
                            const priorityB = groups[currentGroup].priorities?.[b]?.[listType] ?? 999;
                            if (priorityA !== priorityB) return priorityA - priorityB;
                            // If priorities equal, sort by last duty date
                            const dateA = groups[currentGroup].lastDuties[a]?.[listType];
                            const dateB = groups[currentGroup].lastDuties[b]?.[listType];
                            if (!dateA && !dateB) return 0;
                            if (!dateA) return 1;
                            if (!dateB) return -1;
                            return new Date(dateB) - new Date(dateA);
                        });
                        
                        // Find current position (1-based) of the person being edited in the sorted list
                        const currentPos = sortedList.indexOf(oldName) + 1;
                        const targetPos = newPriority;
                        
                        // Only shift if positions are different and target is valid
                        if (currentPos !== targetPos && targetPos >= 1) {
                            // Initialize priorities for all people if needed
                            sortedList.forEach(person => {
                                if (!groups[currentGroup].priorities[person]) {
                                    groups[currentGroup].priorities[person] = {};
                                }
                            });
                            
                            // Create new list order with edited person at target position
                            // Remove the person being edited from the list
                            const listWithoutEdited = sortedList.filter(p => p !== oldName);
                            
                            // Insert edited person at target position (1-based, so insert at index targetPos - 1)
                            const newList = [...listWithoutEdited];
                            const insertIndex = Math.min(targetPos - 1, newList.length);
                            newList.splice(insertIndex, 0, oldName);
                            
                            // Reassign priorities sequentially (1, 2, 3, ...) based on new order
                            // This implements the "bump" behavior: everyone shifts to make room
                            newList.forEach((person, index) => {
                                const newPos = index + 1;
                                if (!groups[currentGroup].priorities[person]) {
                                    groups[currentGroup].priorities[person] = {};
                                }
                                // Update priority to reflect new position
                                // Only update if person had a valid priority before (not 999 default) or is the person being edited
                                const hadValidPriority = person === oldName || 
                                    (groups[currentGroup].priorities[person][listType] !== undefined && 
                                     groups[currentGroup].priorities[person][listType] < 999);
                                if (hadValidPriority || person === oldName) {
                                    groups[currentGroup].priorities[person][listType] = newPos;
                                }
                            });
                        }
                    }
                });
            }
            
            // Handle priority position shifts when adding a new person (to avoid duplicates)
            if (!isEditingPerson) {
                const listTypes = ['special', 'weekend', 'semi', 'normal'];
                const priorityInputs = {
                    special: prioritySpecial ? parseInt(prioritySpecial) : null,
                    weekend: priorityWeekend ? parseInt(priorityWeekend) : null,
                    semi: prioritySemi ? parseInt(prioritySemi) : null,
                    normal: priorityNormal ? parseInt(priorityNormal) : null
                };
                
                listTypes.forEach(listType => {
                    const newPriority = priorityInputs[listType];
                    
                    // Only process if a priority is provided (not null and not 999 default)
                    if (newPriority !== null && newPriority < 999) {
                        // Get current sorted list to find if anyone already has this priority
                        const sortedList = [...(groups[currentGroup][listType] || [])].sort((a, b) => {
                            const priorityA = groups[currentGroup].priorities?.[a]?.[listType] ?? 999;
                            const priorityB = groups[currentGroup].priorities?.[b]?.[listType] ?? 999;
                            if (priorityA !== priorityB) return priorityA - priorityB;
                            // If priorities equal, sort by last duty date
                            const dateA = groups[currentGroup].lastDuties[a]?.[listType];
                            const dateB = groups[currentGroup].lastDuties[b]?.[listType];
                            if (!dateA && !dateB) return 0;
                            if (!dateA) return 1;
                            if (!dateB) return -1;
                            return new Date(dateB) - new Date(dateA);
                        });
                        
                        // Check if anyone already has this priority
                        const hasConflict = sortedList.some(person => {
                            const personPriority = groups[currentGroup].priorities?.[person]?.[listType] ?? 999;
                            return personPriority === newPriority;
                        });
                        
                        // If there's a conflict, shift everyone at this priority and below down by 1
                        if (hasConflict) {
                            // Initialize priorities for all people if needed
                            sortedList.forEach(person => {
                                if (!groups[currentGroup].priorities[person]) {
                                    groups[currentGroup].priorities[person] = {};
                                }
                            });
                            
                            // Shift people at priority newPriority and below down by 1
                            sortedList.forEach(person => {
                                const personPriority = groups[currentGroup].priorities[person]?.[listType] ?? 999;
                                // Shift anyone at the target priority or below (but not default 999)
                                if (personPriority >= newPriority && personPriority < 999) {
                                    groups[currentGroup].priorities[person][listType] = personPriority + 1;
                                }
                            });
                        }
                    }
                });
            }
            
            // Store priorities (using new name as key)
            // If priority is not provided, use a default value (999 for sorting - puts them at the end)
            groups[currentGroup].priorities[personKey] = {
                special: prioritySpecial ? parseInt(prioritySpecial) : 999,
                weekend: priorityWeekend ? parseInt(priorityWeekend) : 999,
                semi: prioritySemi ? parseInt(prioritySemi) : 999,
                normal: priorityNormal ? parseInt(priorityNormal) : 999
            };
            
            // Add last duty dates as critical assignments in the calendar (protected from recalculation)
            const lastDutyDates = [
                { date: lastSpecialDuty, type: 'special' },
                { date: lastWeekendDuty, type: 'weekend' },
                { date: lastSemiDuty, type: 'semi' },
                { date: lastNormalDuty, type: 'normal' }
            ];
            
            const addedAssignments = [];
            lastDutyDates.forEach(({ date, type }) => {
                if (date && date.trim()) {
                    try {
                        // Parse date string (YYYY-MM-DD) and create date in local timezone
                        const [year, month, day] = date.split('-').map(Number);
                        const dateObj = new Date(year, month - 1, day);
                        if (isNaN(dateObj.getTime())) {
                            console.error(`Invalid date: ${date}`);
                            return;
                        }
                        const dateKey = formatDateKey(dateObj);
                        const dayType = getDayType(dateObj);
                        
                        // Always add as critical assignment - these are manually entered baseline dates
                        // personKey is already defined above, use it here
                        const mode = isEditingPerson ? 'EDIT' : 'NEW';
                        console.log(`[${mode}] Adding critical assignment for ${personKey} on ${dateKey} (type: ${type}, dayType: ${dayType})`);
                        
                        // Always ensure this person's assignment is present for this date
                        // This is a critical baseline assignment that must be preserved
                        const existingAssignment = getAssignmentForDate(dateKey);
                        const personGroupStr = `${personKey} (Ομάδα ${currentGroup})`;
                        
                        // Mark this as a critical assignment (from last duty) - NEVER delete these
                        if (!criticalAssignments[dateKey]) {
                            criticalAssignments[dateKey] = [];
                        }
                        if (!criticalAssignments[dateKey].includes(personGroupStr)) {
                            criticalAssignments[dateKey].push(personGroupStr);
                            console.log(`[${mode}] ✓ Added to criticalAssignments[${dateKey}]:`, criticalAssignments[dateKey]);
                        } else {
                            console.log(`[${mode}] ✓ Already in criticalAssignments[${dateKey}]:`, criticalAssignments[dateKey]);
                        }
                        
                        // Verify criticalAssignments was updated
                        if (!criticalAssignments[dateKey] || !criticalAssignments[dateKey].includes(personGroupStr)) {
                            console.error(`[${mode}] ERROR: Failed to add to criticalAssignments for ${dateKey}!`);
                        }
                        
                        // ALWAYS update assignments - even if editing, we want the new dates
                        if (existingAssignment) {
                            // Check if this person is already assigned
                            if (!existingAssignment.includes(personGroupStr)) {
                                // Add this person to existing assignments
                                setAssignmentForDate(dateKey, existingAssignment + `, ${personGroupStr}`);
                                console.log(`[${mode}] Added to existing assignment for ${dateKey}: ${existingAssignment + ', ' + personGroupStr}`);
                            } else {
                                console.log(`[${mode}] Person already in assignment for ${dateKey}`);
                            }
                        } else {
                            // Create new assignment
                            setAssignmentForDate(dateKey, personGroupStr);
                            console.log(`[${mode}] Created new assignment for ${dateKey}: ${personGroupStr}`);
                        }
                        
                        // Verify it was added correctly
                        if (!dutyAssignments[dateKey] || !dutyAssignments[dateKey].includes(personGroupStr)) {
                            console.error(`[${mode}] ERROR: Failed to add assignment for ${dateKey}! Expected: ${personGroupStr}, Got: ${dutyAssignments[dateKey]}`);
                        } else {
                            console.log(`[${mode}] ✓ Verified assignment for ${dateKey}: ${dutyAssignments[dateKey]}`);
                        }
                        
                        addedAssignments.push(dateKey);
                    } catch (error) {
                        console.error(`Error processing date ${date}:`, error);
                    }
                }
            });
            
            if (addedAssignments.length > 0) {
                console.log(`✓ Added ${addedAssignments.length} critical baseline assignments for ${personKey}`);
                // Verify criticalAssignments contains these dates
                addedAssignments.forEach(dateKey => {
                    if (criticalAssignments[dateKey] && criticalAssignments[dateKey].length > 0) {
                        console.log(`✓ Verified criticalAssignments[${dateKey}] =`, criticalAssignments[dateKey]);
                    } else {
                        console.error(`ERROR: criticalAssignments[${dateKey}] is missing or empty!`);
                    }
                });
                console.log(`Total criticalAssignments keys:`, Object.keys(criticalAssignments).length);
            }
            
            // Note: New assignments are added in the lastDutyDates.forEach loop above
            // This applies to both new and edit modes
            // The loop runs FIRST, adding new assignments, then we remove old ones if editing
            
            if (isEditingPerson) {
                console.log(`[EDIT] Editing mode: Removing old assignments for ${editingPersonName}`);
                console.log(`[EDIT] Old lastDuties:`, oldLastDuties);
                console.log(`[EDIT] New lastDuties:`, groups[currentGroup].lastDuties[personKey]);
                
                // Get the NEW dates that will be set, organized by type
                const newDatesByType = {
                    special: lastSpecialDuty || null,
                    weekend: lastWeekendDuty || null,
                    semi: lastSemiDuty || null,
                    normal: lastNormalDuty || null
                };
                
                // Convert new dates to dateKeys for comparison
                const newDateKeysByType = {};
                Object.keys(newDatesByType).forEach(type => {
                    const dateStr = newDatesByType[type];
                    if (dateStr && dateStr.trim()) {
                        const [year, month, day] = dateStr.split('-').map(Number);
                        newDateKeysByType[type] = formatDateKey(new Date(year, month - 1, day));
                    }
                });
                
                // Remove old assignments - compare by TYPE
                // If the old date for a type is different from the new date for that type, remove the old one
                const oldDates = [
                    { date: oldLastDuties.special, type: 'special' },
                    { date: oldLastDuties.weekend, type: 'weekend' },
                    { date: oldLastDuties.semi, type: 'semi' },
                    { date: oldLastDuties.normal, type: 'normal' }
                ];
                
                oldDates.forEach(({ date, type }) => {
                    if (date) {
                        // Parse date string (YYYY-MM-DD) and create date in local timezone
                        const [year, month, day] = date.split('-').map(Number);
                        const dateObj = new Date(year, month - 1, day);
                        const oldDateKey = formatDateKey(dateObj);
                        const newDateKey = newDateKeysByType[type];
                        
                        // Remove if:
                        // 1. The old date is different from the new date for this type, OR
                        // 2. There's no new date for this type (user cleared it)
                        const shouldRemove = (newDateKey && oldDateKey !== newDateKey) || (!newDateKey && oldDateKey);
                        
                        if (shouldRemove) {
                            // Use current name (may have been changed) for removal
                            // If name changed, all references were already updated to use new name
                            const personGroupStr = `${name} (Ομάδα ${currentGroup})`;
                            const existingAssignment = dutyAssignments[oldDateKey];
                            
                            // Remove from critical assignments
                            if (criticalAssignments[oldDateKey]) {
                                criticalAssignments[oldDateKey] = criticalAssignments[oldDateKey].filter(a => a !== personGroupStr);
                                if (criticalAssignments[oldDateKey].length === 0) {
                                    delete criticalAssignments[oldDateKey];
                                }
                                console.log(`[EDIT] Removed old critical assignment for ${oldDateKey} (${type} changed from ${oldDateKey} to ${newDateKey || 'empty'})`);
                            }
                            
                            // Remove from regular assignments
                            if (existingAssignment && existingAssignment.includes(personGroupStr)) {
                                const assignments = existingAssignment.split(', ').filter(a => a !== personGroupStr);
                                if (assignments.length > 0) {
                                    dutyAssignments[oldDateKey] = assignments.join(', ');
                                } else {
                                    delete dutyAssignments[oldDateKey];
                                }
                                console.log(`[EDIT] Removed old assignment for ${oldDateKey} (${type} changed)`);
                            }
                        }
                    }
                });
            } else {
                // Adding new person - add to all lists if not already present
                const listTypes = ['special', 'weekend', 'semi', 'normal'];
                listTypes.forEach(listType => {
                    if (!groups[currentGroup][listType].includes(name)) {
                        groups[currentGroup][listType].push(name);
                    }
                });
            }
                
            // Sort each list by priority (lower number = higher priority), then by last duty date
            const listTypes = ['special', 'weekend', 'semi', 'normal'];
                listTypes.forEach(listType => {
                    groups[currentGroup][listType].sort((a, b) => {
                    // Get priorities (default to 999 if not set)
                    const priorityA = groups[currentGroup].priorities?.[a]?.[listType] ?? 999;
                    const priorityB = groups[currentGroup].priorities?.[b]?.[listType] ?? 999;
                    
                    // First sort by priority (lower number = higher priority)
                    if (priorityA !== priorityB) {
                        return priorityA - priorityB;
                    }
                    
                    // If priorities are equal, sort by last duty date (most recent first, no date last)
                        const dateA = groups[currentGroup].lastDuties[a]?.[listType];
                        const dateB = groups[currentGroup].lastDuties[b]?.[listType];
                        
                        if (!dateA && !dateB) return 0; // Both have no date, maintain order
                        if (!dateA) return 1; // A has no date, put it last
                        if (!dateB) return -1; // B has no date, put it last
                        
                        // Both have dates, sort by date (most recent first)
                        return new Date(dateB) - new Date(dateA);
                    });
                
                // Preserve user-entered priority values - do not reassign sequentially
                // This allows users to set priorities like 10 even if there are only 3 people
                const list = groups[currentGroup][listType];
                list.forEach((person) => {
                    if (!groups[currentGroup].priorities[person]) {
                        groups[currentGroup].priorities[person] = {};
                    }
                    // Only set default priority (999) if no priority was set
                    if (groups[currentGroup].priorities[person][listType] === undefined) {
                        groups[currentGroup].priorities[person][listType] = 999;
                    }
                });
            });
            
            // Clear form
            document.getElementById('personName').value = '';
            document.getElementById('personName').readOnly = false;
            document.getElementById('lastSpecialDuty').value = '';
            document.getElementById('lastWeekendDuty').value = '';
            document.getElementById('lastSemiDuty').value = '';
            document.getElementById('lastNormalDuty').value = '';
            document.getElementById('prioritySpecial').value = '';
            document.getElementById('priorityWeekend').value = '';
            document.getElementById('prioritySemi').value = '';
            document.getElementById('priorityNormal').value = '';
            
            isEditingPerson = false;
            editingPersonName = null;
            
            // Verify assignments are in the object before saving/rendering
            console.log('Before save - dutyAssignments for added dates:', 
                addedAssignments.map(key => ({ key, assignment: dutyAssignments[key] }))
            );
            
            // Verify assignments and criticalAssignments before saving
            console.log('Before saveData:');
            console.log('  - dutyAssignments keys:', Object.keys(dutyAssignments).length);
            console.log('  - criticalAssignments keys:', Object.keys(criticalAssignments).length);
            addedAssignments.forEach(key => {
                console.log(`  - dutyAssignments['${key}'] =`, dutyAssignments[key]);
                console.log(`  - criticalAssignments['${key}'] =`, criticalAssignments[key]);
            });
            
            saveData();
            renderGroups();
            
            // Double-check assignments are still there after saveData (should be, but verify)
            console.log('After saveData:');
            console.log('  - dutyAssignments keys:', Object.keys(dutyAssignments).length);
            console.log('  - criticalAssignments keys:', Object.keys(criticalAssignments).length);
            addedAssignments.forEach(key => {
                console.log(`  - dutyAssignments['${key}'] =`, dutyAssignments[key]);
                console.log(`  - criticalAssignments['${key}'] =`, criticalAssignments[key]);
            });
            
            // Force calendar refresh - ensure critical assignments are restored before rendering
            console.log('About to render calendar. Current criticalAssignments keys:', Object.keys(criticalAssignments).length);
            console.log('Current dutyAssignments keys:', Object.keys(dutyAssignments).length);
            
            renderCalendar(); // Refresh calendar to show the new critical assignments
            updateStatistics();
            
            // Verify assignments are visible after render
            setTimeout(() => {
                console.log('After calendar render - checking if assignments are visible');
                addedAssignments.forEach(key => {
                    const assignment = dutyAssignments[key];
                    console.log(`Post-render check: dutyAssignments['${key}'] =`, assignment);
                    if (!assignment) {
                        console.error(`WARNING: Assignment for ${key} is missing after render!`);
                    }
                });
            }, 100);
            
            const modal = bootstrap.Modal.getInstance(document.getElementById('addPersonModal'));
            modal.hide();
        }

        // Open person actions modal
        function openPersonActionsModal(groupNum, personName, index, listType) {
            currentPersonActionsGroup = groupNum;
            currentPersonActionsName = personName;
            currentPersonActionsIndex = index;
            currentPersonActionsListType = listType;
            
            document.getElementById('personActionsName').textContent = personName;
            document.getElementById('personActionsGroup').textContent = getGroupName(groupNum);
            
            const modal = new bootstrap.Modal(document.getElementById('personActionsModal'));
            modal.show();
        }
        
        // Open edit person from actions modal
        function openEditPersonFromActions() {
            const modal = bootstrap.Modal.getInstance(document.getElementById('personActionsModal'));
            modal.hide();
            editPerson(currentPersonActionsGroup, currentPersonActionsName);
        }
        
        // Open missing period modal from actions
        function openMissingPeriodFromActions() {
            const modal = bootstrap.Modal.getInstance(document.getElementById('personActionsModal'));
            modal.hide();
            openMissingPeriodModal(currentPersonActionsGroup, currentPersonActionsName);
        }
        
        // Open transfer modal from actions
        function openTransferFromActions() {
            const modal = bootstrap.Modal.getInstance(document.getElementById('personActionsModal'));
            modal.hide();
            // Show selection for target group
            const availableGroups = [1, 2, 3, 4].filter(g => g !== currentPersonActionsGroup);
            if (availableGroups.length === 0) {
                alert('Δεν υπάρχουν άλλες ομάδες για μεταφορά');
                return;
            }
            
            const groupOptions = availableGroups.map(g => `${g}: ${getGroupName(g)}`).join(', ');
            const targetGroupStr = prompt(`Επιλέξτε την ομάδα προορισμού (${groupOptions}):`);
            const targetGroup = parseInt(targetGroupStr);
            
            if (targetGroup && availableGroups.includes(targetGroup)) {
                transferPerson(currentPersonActionsGroup, currentPersonActionsIndex, targetGroup, currentPersonActionsListType);
            } else if (targetGroupStr !== null) {
                alert('Μη έγκυρη επιλογή ομάδας');
            }
        }
        
        // Delete person from actions modal
        function deletePersonFromActions() {
            if (confirm(`Είστε σίγουροι ότι θέλετε να διαγράψετε το άτομο "${currentPersonActionsName}" από όλες τις λίστες;`)) {
                const modal = bootstrap.Modal.getInstance(document.getElementById('personActionsModal'));
                modal.hide();
                
                // Remove from all lists in the group
                const allListTypes = ['special', 'weekend', 'semi', 'normal'];
                allListTypes.forEach(listType => {
                    const list = groups[currentPersonActionsGroup][listType] || [];
                    const index = list.indexOf(currentPersonActionsName);
                    if (index !== -1) {
                        list.splice(index, 1);
                    }
                });
                
                // Remove last duties and missing periods
                if (groups[currentPersonActionsGroup].lastDuties) {
                    delete groups[currentPersonActionsGroup].lastDuties[currentPersonActionsName];
                }
                if (groups[currentPersonActionsGroup].missingPeriods) {
                    delete groups[currentPersonActionsGroup].missingPeriods[currentPersonActionsName];
                }
                
                // Remove from critical assignments and duty assignments
                Object.keys(criticalAssignments).forEach(dateKey => {
                    if (criticalAssignments[dateKey]) {
                        criticalAssignments[dateKey] = criticalAssignments[dateKey].filter(a => 
                            !a.includes(`${currentPersonActionsName} (Ομάδα ${currentPersonActionsGroup})`)
                        );
                        if (criticalAssignments[dateKey].length === 0) {
                            delete criticalAssignments[dateKey];
                        }
                    }
                });
                
                Object.keys(dutyAssignments).forEach(dateKey => {
                    if (dutyAssignments[dateKey]) {
                        const personGroupStr = `${currentPersonActionsName} (Ομάδα ${currentPersonActionsGroup})`;
                        if (dutyAssignments[dateKey].includes(personGroupStr)) {
                            dutyAssignments[dateKey] = dutyAssignments[dateKey]
                                .split(', ')
                                .filter(a => a !== personGroupStr)
                                .join(', ');
                            if (dutyAssignments[dateKey] === '') {
                                delete dutyAssignments[dateKey];
                            }
                        }
                    }
                });
                
                saveData();
                renderGroups();
                renderCalendar();
                updateStatistics();
            }
        }

        // Get all unique people across all groups
        function getAllPeople() {
            const allPeople = new Set();
            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                const group = groups[groupNum];
                if (group) {
                    ['special', 'weekend', 'semi', 'normal'].forEach(listType => {
                        if (Array.isArray(group[listType])) {
                            group[listType].forEach(person => allPeople.add(person));
                        }
                    });
                }
            }
            return Array.from(allPeople).sort();
        }

        // Get group number for a person (returns first group found)
        function getPersonGroup(personName) {
            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                const group = groups[groupNum];
                if (group) {
                    const listTypes = ['special', 'weekend', 'semi', 'normal'];
                    for (const listType of listTypes) {
                        if (Array.isArray(group[listType]) && group[listType].includes(personName)) {
                            return groupNum;
                        }
                    }
                }
            }
            return null;
        }

        // Open rankings management modal
        function openRankingsModal() {
            const allPeople = getAllPeople();
            const container = document.getElementById('rankingsListBody');
            container.innerHTML = '';
            
            if (allPeople.length === 0) {
                container.innerHTML = '<div class="text-center text-muted p-4">Δεν υπάρχουν άτομα στο σύστημα</div>';
                const modal = new bootstrap.Modal(document.getElementById('rankingsModal'));
                modal.show();
                return;
            }
            
            // Sort people by ranking from Firestore (rankings loaded from Firestore in loadData)
            // Rankings are stored in the global 'rankings' object: { "Person Name": rankNumber }
            const sortedPeople = [...allPeople].sort((a, b) => {
                // Get ranking from Firestore data (rankings object)
                const rankA = rankings[a] || 9999;  // Use 9999 for unranked people (put them at end)
                const rankB = rankings[b] || 9999;
                return rankA - rankB;  // Sort ascending: 1, 2, 3, ... 9999
            });
            
            // Find the highest ranking to assign sequential numbers to unranked people
            const rankedPeople = sortedPeople.filter(p => rankings[p] && rankings[p] > 0);
            const unrankedPeople = sortedPeople.filter(p => !rankings[p] || rankings[p] <= 0);
            const maxRanking = rankedPeople.length > 0 
                ? Math.max(...rankedPeople.map(p => rankings[p]))
                : 0;
            
            // Create draggable items for each person
            sortedPeople.forEach((person, index) => {
                let currentRanking;
                if (rankings[person] && rankings[person] > 0) {
                    currentRanking = rankings[person];
                } else {
                    // Assign sequential ranking starting from maxRanking + 1
                    const unrankedIndex = unrankedPeople.indexOf(person);
                    currentRanking = maxRanking + unrankedIndex + 1;
                }
                const groupNum = getPersonGroup(person);
                const groupName = groupNum ? getGroupName(groupNum) : 'Άγνωστη';
                
                const item = document.createElement('div');
                item.className = 'ranking-item';
                item.draggable = true;
                item.dataset.person = person;
                item.dataset.ranking = currentRanking;
                
                item.innerHTML = `
                    <div class="ranking-drag-handle">
                        <i class="fas fa-grip-vertical"></i>
                    </div>
                    <div class="ranking-number" data-editable="true">${currentRanking}</div>
                    <div class="ranking-name" style="cursor: pointer;" onclick="editRankingManually(this, '${person.replace(/'/g, "\\'")}')">${person}</div>
                    <div class="ranking-group">${groupName}</div>
                `;
                
                // Add drag event listeners
                item.addEventListener('dragstart', handleRankingDragStart);
                item.addEventListener('dragover', handleRankingDragOver);
                item.addEventListener('drop', handleRankingDrop);
                item.addEventListener('dragend', handleRankingDragEnd);
                item.addEventListener('dragenter', handleRankingDragEnter);
                item.addEventListener('dragleave', handleRankingDragLeave);
                
                container.appendChild(item);
            });
            
            const modal = new bootstrap.Modal(document.getElementById('rankingsModal'));
            modal.show();
        }

        // Drag and drop variables for rankings
        let draggedRankingItem = null;
        let rankingScrollInterval = null;
        let currentMouseY = 0;

        function handleRankingDragStart(e) {
            draggedRankingItem = this;
            this.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/html', this.innerHTML);
            
            // Track mouse position
            document.addEventListener('dragover', trackRankingMousePosition);
            
            // Start auto-scrolling
            startRankingAutoScroll();
        }

        function trackRankingMousePosition(e) {
            currentMouseY = e.clientY;
        }

        function handleRankingDragOver(e) {
            if (e.preventDefault) {
                e.preventDefault();
            }
            
            if (draggedRankingItem !== this) {
                this.classList.add('drag-over');
            }
            
            return false;
        }

        function handleRankingDragEnter(e) {
            if (draggedRankingItem !== this) {
                this.classList.add('drag-over');
            }
        }

        function handleRankingDragLeave(e) {
            this.classList.remove('drag-over');
        }

        function handleRankingDrop(e) {
            if (e.stopPropagation) {
                e.stopPropagation();
            }
            
            if (draggedRankingItem !== this) {
                const container = document.getElementById('rankingsListBody');
                const items = Array.from(container.querySelectorAll('.ranking-item'));
                const fromIndex = items.indexOf(draggedRankingItem);
                const toIndex = items.indexOf(this);
                
                // Move the item in the DOM
                if (fromIndex < toIndex) {
                    container.insertBefore(draggedRankingItem, this.nextSibling);
                } else {
                    container.insertBefore(draggedRankingItem, this);
                }
                
                // After DOM update, reassign rankings sequentially (1, 2, 3, ...) based on new order
                // This ensures continuity with no gaps or duplicates
                // Note: Changes are temporary until "Save" is clicked
                updateRankingsAfterMove();
            }
            
            this.classList.remove('drag-over');
            return false;
        }

        function handleRankingDragEnd(e) {
            this.classList.remove('dragging');
            const items = document.querySelectorAll('.ranking-item');
            items.forEach(item => item.classList.remove('drag-over'));
            draggedRankingItem = null;
            
            // Remove mouse tracking
            document.removeEventListener('dragover', trackRankingMousePosition);
            
            // Stop auto-scrolling
            stopRankingAutoScroll();
        }

        function updateRankingsAfterMove() {
            const container = document.getElementById('rankingsListBody');
            const allItems = Array.from(container.querySelectorAll('.ranking-item'));
            
            // After moving, reassign rankings sequentially from 1 to N based on the new order
            // This ensures continuity: 1, 2, 3, 4, ... with no gaps or duplicates
            allItems.forEach((item, index) => {
                const newRanking = index + 1; // Sequential ranking: 1, 2, 3, ...
                
                // Update the ranking number display
                const rankingNumberEl = item.querySelector('.ranking-number');
                if (rankingNumberEl) {
                    rankingNumberEl.textContent = newRanking;
                }
                item.dataset.ranking = newRanking;
            });
        }

        function startRankingAutoScroll() {
            const container = document.getElementById('rankingsListContainer');
            if (!container) return;
            
            rankingScrollInterval = setInterval(() => {
                if (!draggedRankingItem) {
                    stopRankingAutoScroll();
                    return;
                }
                
                const rect = container.getBoundingClientRect();
                
                // Scroll up if near top
                if (currentMouseY < rect.top + 50) {
                    container.scrollTop = Math.max(0, container.scrollTop - 15);
                }
                // Scroll down if near bottom
                else if (currentMouseY > rect.bottom - 50) {
                    container.scrollTop = Math.min(
                        container.scrollHeight - container.clientHeight,
                        container.scrollTop + 15
                    );
                }
            }, 50);
        }

        function stopRankingAutoScroll() {
            if (rankingScrollInterval) {
                clearInterval(rankingScrollInterval);
                rankingScrollInterval = null;
            }
        }

        // Edit ranking manually by clicking on person's name
        function editRankingManually(nameElement, personName) {
            const item = nameElement.closest('.ranking-item');
            const rankingNumberEl = item.querySelector('.ranking-number');
            const currentRanking = parseInt(rankingNumberEl.textContent) || 1;
            
            // Create input field
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'form-control form-control-sm';
            input.value = currentRanking;
            input.min = 1;
            input.style.width = '80px';
            input.style.textAlign = 'center';
            input.style.fontWeight = 'bold';
            input.style.color = '#0d6efd';
            
            // Replace ranking number with input
            rankingNumberEl.innerHTML = '';
            rankingNumberEl.appendChild(input);
            input.focus();
            input.select();
            
            // Handle input completion
            const finishEdit = () => {
                const newRanking = parseInt(input.value) || 1;
                if (newRanking < 1) {
                    alert('Η ιεραρχία πρέπει να είναι τουλάχιστον 1');
                    input.focus();
                    return;
                }
                
                // Get all items and find the target position
                const container = document.getElementById('rankingsListBody');
                const allItems = Array.from(container.querySelectorAll('.ranking-item'));
                const maxRanking = allItems.length;
                
                if (newRanking > maxRanking) {
                    alert(`Η μέγιστη ιεραρχία είναι ${maxRanking}`);
                    input.focus();
                    return;
                }
                
                // Find current position of this item
                const currentIndex = allItems.indexOf(item);
                const targetIndex = newRanking - 1;
                
                // Move the item to the target position in the DOM
                if (currentIndex !== targetIndex) {
                    if (currentIndex < targetIndex) {
                        // Moving down (e.g., position 6 → 9)
                        // Need to get fresh items list after potential DOM changes
                        const freshItems = Array.from(container.querySelectorAll('.ranking-item'));
                        if (targetIndex < freshItems.length - 1) {
                            container.insertBefore(item, freshItems[targetIndex + 1]);
                        } else {
                            container.appendChild(item);
                        }
                    } else {
                        // Moving up (e.g., position 9 → 6)
                        const freshItems = Array.from(container.querySelectorAll('.ranking-item'));
                        container.insertBefore(item, freshItems[targetIndex]);
                    }
                }
                
                // After moving, reassign all rankings sequentially based on new order
                // This ensures continuity: 1, 2, 3, ... with no gaps or duplicates
                // Example: Moving person from 6 to 9:
                // - Person at 7 becomes 6
                // - Person at 8 becomes 7
                // - Person at 9 becomes 8
                // - Moved person becomes 9
                updateRankingsAfterMove();
            };
            
            input.addEventListener('blur', finishEdit);
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    finishEdit();
                }
            });
        }

        // Save rankings to Firestore
        function saveRankings() {
            const container = document.getElementById('rankingsListBody');
            const items = Array.from(container.querySelectorAll('.ranking-item'));
            
            // First, ensure continuity: reassign rankings sequentially based on current order
            // This ensures no gaps or duplicates before saving
            items.forEach((item, index) => {
                const newRanking = index + 1; // Sequential ranking: 1, 2, 3, ...
                
                // Update the ranking number display
                const rankingNumberEl = item.querySelector('.ranking-number');
                if (rankingNumberEl) {
                    rankingNumberEl.textContent = newRanking;
                }
                item.dataset.ranking = newRanking;
            });
            
            // Collect all rankings from the current list order (now sequential)
            const newRankings = {};
            items.forEach((item, index) => {
                const person = item.dataset.person;
                const ranking = parseInt(item.dataset.ranking) || (index + 1);
                if (person && ranking > 0) {
                    newRankings[person] = ranking;
                }
            });
            
            // Update global rankings object (will be saved to Firestore)
            rankings = newRankings;
            
            // Mark rankings as modified so they'll be saved
            rankingsModified = true;
            
            // Save to Firestore (saveData() saves rankings to Firestore)
            saveData();
            
            const modal = bootstrap.Modal.getInstance(document.getElementById('rankingsModal'));
            modal.hide();
            
            alert('Η ιεραρχία αποθηκεύτηκε επιτυχώς στο Firestore!');
        }

        // Remove person from specific list
        function removePerson(groupNumber, index, listType) {
            if (confirm('Είστε σίγουροι ότι θέλετε να αφαιρέσετε αυτό το άτομο από αυτή τη λίστα;')) {
                const list = groups[groupNumber][listType];
                const person = list[index];
                list.splice(index, 1);
                
                // Also remove from all other lists if it exists there
                const allListTypes = ['special', 'weekend', 'semi', 'normal'];
                allListTypes.forEach(otherListType => {
                    if (otherListType !== listType) {
                        const otherList = groups[groupNumber][otherListType] || [];
                        const otherIndex = otherList.indexOf(person);
                        if (otherIndex !== -1) {
                            otherList.splice(otherIndex, 1);
                        }
                    }
                });
                
                // Remove last duties entry if person is removed from all lists
                const stillInAnyList = allListTypes.some(lt => (groups[groupNumber][lt] || []).includes(person));
                if (!stillInAnyList && groups[groupNumber].lastDuties) {
                    delete groups[groupNumber].lastDuties[person];
                }
                
                saveData();
                renderGroups();
                updateStatistics();
            }
        }

        // Move person up or down in list
        function movePersonInList(groupNumber, index, listType, direction) {
            const list = groups[groupNumber][listType];
            if (direction === 'up' && index > 0) {
                [list[index - 1], list[index]] = [list[index], list[index - 1]];
            } else if (direction === 'down' && index < list.length - 1) {
                [list[index], list[index + 1]] = [list[index + 1], list[index]];
            }
            
            saveData();
            renderGroups();
        }

        // Toggle transfer dropdown
        function toggleTransferDropdown(groupNumber, index, listType, event) {
            event.stopPropagation();
            
            // Close all other dropdowns
            document.querySelectorAll('.transfer-dropdown-content').forEach(dropdown => {
                dropdown.classList.remove('show');
            });
            
            // Toggle current dropdown
            const dropdown = document.getElementById(`transferDropdown_${groupNumber}_${index}_${listType}`);
            dropdown.classList.toggle('show');
        }

        // Global variables for transfer
        let transferData = {
            person: null,
            fromGroup: null,
            toGroup: null,
            lastDuties: null,
            missingPeriods: null,
            positions: {} // { listType: { referencePerson: string, position: 'above'|'below'|'end' } }
        };

        // Transfer person to another group - opens positioning modal
        function transferPerson(fromGroup, index, toGroup, listType) {
            const list = groups[fromGroup][listType];
            const person = list[index];
            
            if (!person) return;
            
            // Store transfer data
            transferData.person = person;
            transferData.fromGroup = fromGroup;
            transferData.toGroup = toGroup;
            transferData.lastDuties = groups[fromGroup].lastDuties?.[person] || null;
            transferData.missingPeriods = groups[fromGroup].missingPeriods?.[person] || null;
            transferData.positions = {};
            
            // Close dropdown
            document.querySelectorAll('.transfer-dropdown-content').forEach(dropdown => {
                dropdown.classList.remove('show');
            });
            
            // Open positioning modal
            openTransferPositionModal();
        }

        // Open transfer position modal
        function openTransferPositionModal() {
            document.getElementById('transferPersonName').textContent = transferData.person;
            document.getElementById('transferFromGroup').textContent = getGroupName(transferData.fromGroup);
            document.getElementById('transferToGroup').textContent = getGroupName(transferData.toGroup);
            
            // Find people from target group who had duty on same days
            const sameDayPeople = findPeopleWithSameDutyDays(transferData.person, transferData.fromGroup, transferData.toGroup);
            
            // Render positioning options for each list type
            renderTransferPositionLists(sameDayPeople);
            
            const modal = new bootstrap.Modal(document.getElementById('transferPositionModal'));
            modal.show();
        }

        // Find people from target group who had duty on same days as the person being transferred
        function findPeopleWithSameDutyDays(person, fromGroup, toGroup) {
            const sameDayPeople = {
                special: [],
                weekend: [],
                semi: [],
                normal: []
            };
            
            // Get all days where person had duty
            const personDutyDays = [];
            for (const [dayKey, assignment] of Object.entries(dutyAssignments)) {
                // Ensure assignment is a string
                const assignmentStr = typeof assignment === 'string' ? assignment : String(assignment || '');
                if (assignmentStr.includes(`${person} (Ομάδα ${fromGroup})`)) {
                    personDutyDays.push(dayKey);
                }
            }
            
            if (personDutyDays.length === 0) {
                return sameDayPeople; // No duty days found
            }
            
            // For each day type, find people from target group who had duty on same days
            const targetGroupData = groups[toGroup] || { special: [], weekend: [], semi: [], normal: [] };
            
            personDutyDays.forEach(dayKey => {
                const dayDate = new Date(dayKey + 'T00:00:00');
                const dayType = getDayType(dayDate);
                let dayTypeCategory = 'normal';
                
                if (dayType === 'special-holiday') {
                    dayTypeCategory = 'special';
                } else if (dayType === 'semi-normal-day') {
                    dayTypeCategory = 'semi';
                } else if (dayType === 'weekend-holiday') {
                    dayTypeCategory = 'weekend';
                }
                
                // Check if anyone from target group had duty on this day
                const assignment = dutyAssignments[dayKey];
                if (assignment) {
                    // Ensure assignment is a string
                    const assignmentStr = typeof assignment === 'string' ? assignment : String(assignment);
                    const targetGroupPeople = targetGroupData[dayTypeCategory] || [];
                    targetGroupPeople.forEach(targetPerson => {
                        if (assignmentStr.includes(`${targetPerson} (Ομάδα ${toGroup})`)) {
                            if (!sameDayPeople[dayTypeCategory].includes(targetPerson)) {
                                sameDayPeople[dayTypeCategory].push(targetPerson);
                            }
                        }
                    });
                }
            });
            
            return sameDayPeople;
        }

        // Render positioning lists for transfer
        function renderTransferPositionLists(sameDayPeople) {
            const container = document.getElementById('transferPositionLists');
            const listTypes = [
                { type: 'special', label: 'Ειδικές Αργίες', icon: 'fa-star' },
                { type: 'weekend', label: 'Σαββατοκύριακα/Αργίες', icon: 'fa-calendar-week' },
                { type: 'semi', label: 'Ημιαργίες', icon: 'fa-calendar-alt' },
                { type: 'normal', label: 'Καθημερινές', icon: 'fa-calendar-day' }
            ];
            
            const targetGroupData = groups[transferData.toGroup] || { special: [], weekend: [], semi: [], normal: [] };
            
            container.innerHTML = listTypes.map(({ type, label, icon }) => {
                const list = targetGroupData[type] || [];
                const sameDayPeopleList = sameDayPeople[type] || [];
                
                let optionsHtml = '';
                
                if (sameDayPeopleList.length > 0) {
                    // Show people who had duty on same days
                    optionsHtml = `
                        <div class="mb-2">
                            <small class="text-muted">Άτομα με υπηρεσία την ίδια ημέρα:</small>
                            <div class="btn-group-vertical w-100" role="group">
                                ${sameDayPeopleList.map(refPerson => {
                                    return `
                                        <div class="btn-group mb-1" role="group">
                                            <button type="button" class="btn btn-outline-primary btn-sm" onclick="setTransferPosition('${type}', '${refPerson.replace(/'/g, "\\'")}', 'above')">
                                                <i class="fas fa-arrow-up me-1"></i>Πάνω από ${refPerson}
                                            </button>
                                            <button type="button" class="btn btn-outline-primary btn-sm" onclick="setTransferPosition('${type}', '${refPerson.replace(/'/g, "\\'")}', 'below')">
                                                <i class="fas fa-arrow-down me-1"></i>Κάτω από ${refPerson}
                                            </button>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    `;
                }
                
                // Show option to add at end
                optionsHtml += `
                    <div class="mb-2">
                        <button type="button" class="btn btn-outline-secondary btn-sm w-100" onclick="setTransferPosition('${type}', null, 'end')">
                            <i class="fas fa-plus me-1"></i>Προσθήκη στο τέλος
                        </button>
                    </div>
                `;
                
                // Show current selection
                const currentPosition = transferData.positions[type];
                let positionDisplay = '<small class="text-muted">Δεν έχει επιλεγεί</small>';
                if (currentPosition) {
                    if (currentPosition.position === 'end') {
                        positionDisplay = '<small class="text-success"><i class="fas fa-check me-1"></i>Θα προστεθεί στο τέλος</small>';
                    } else {
                        const positionText = currentPosition.position === 'above' ? 'πάνω' : 'κάτω';
                        positionDisplay = `<small class="text-success"><i class="fas fa-check me-1"></i>Θα τοποθετηθεί ${positionText} από ${currentPosition.referencePerson}</small>`;
                    }
                }
                
                return `
                    <div class="card mb-3">
                        <div class="card-header">
                            <i class="fas ${icon} me-2"></i><strong>${label}</strong>
                        </div>
                        <div class="card-body">
                            ${optionsHtml}
                            <div class="mt-2">
                                ${positionDisplay}
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Set transfer position for a list type
        function setTransferPosition(listType, referencePerson, position) {
            transferData.positions[listType] = {
                referencePerson: referencePerson,
                position: position
            };
            
            // Re-render to show updated selection
            const sameDayPeople = findPeopleWithSameDutyDays(transferData.person, transferData.fromGroup, transferData.toGroup);
            renderTransferPositionLists(sameDayPeople);
        }

        // Complete the transfer with selected positions
        function completeTransfer() {
            // Remove from current group's all lists
            const allListTypes = ['special', 'weekend', 'semi', 'normal'];
            allListTypes.forEach(lt => {
                const currentList = groups[transferData.fromGroup][lt] || [];
                const currentIndex = currentList.indexOf(transferData.person);
                if (currentIndex !== -1) {
                    currentList.splice(currentIndex, 1);
                }
            });
            
            // Initialize target group if needed
            if (!groups[transferData.toGroup]) {
                groups[transferData.toGroup] = { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {} };
            }
            
            // Add to target group with positioning
            allListTypes.forEach(listType => {
                if (!groups[transferData.toGroup][listType]) groups[transferData.toGroup][listType] = [];
                
                const list = groups[transferData.toGroup][listType];
                
                // Remove person if already exists
                const existingIndex = list.indexOf(transferData.person);
                if (existingIndex !== -1) {
                    list.splice(existingIndex, 1);
                }
                
                // Position person according to selection
                const position = transferData.positions[listType];
                if (position) {
                    if (position.position === 'end') {
                        // Add at end
                        list.push(transferData.person);
                    } else if (position.referencePerson) {
                        // Find reference person index
                        const refIndex = list.indexOf(position.referencePerson);
                        if (refIndex !== -1) {
                            if (position.position === 'above') {
                                list.splice(refIndex, 0, transferData.person);
                            } else { // below
                                list.splice(refIndex + 1, 0, transferData.person);
                            }
                        } else {
                            // Reference person not found, add at end
                            list.push(transferData.person);
                        }
                    } else {
                        // No valid position, add at end
                        list.push(transferData.person);
                    }
                } else {
                    // No position selected, add at end
                    list.push(transferData.person);
                }
            });
            
            // Transfer last duties
            if (!groups[transferData.toGroup].lastDuties) groups[transferData.toGroup].lastDuties = {};
            if (transferData.lastDuties) {
                groups[transferData.toGroup].lastDuties[transferData.person] = transferData.lastDuties;
            }
            
            // Transfer missing periods
            if (!groups[transferData.toGroup].missingPeriods) groups[transferData.toGroup].missingPeriods = {};
            if (transferData.missingPeriods) {
                groups[transferData.toGroup].missingPeriods[transferData.person] = transferData.missingPeriods;
            }
            
            // Remove last duties and missing periods from source group if person is completely removed
            const stillInSourceGroup = allListTypes.some(lt => (groups[transferData.fromGroup][lt] || []).includes(transferData.person));
            if (!stillInSourceGroup) {
                if (groups[transferData.fromGroup].lastDuties) {
                    delete groups[transferData.fromGroup].lastDuties[transferData.person];
                }
                if (groups[transferData.fromGroup].missingPeriods) {
                    delete groups[transferData.fromGroup].missingPeriods[transferData.person];
                }
            }
            
            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('transferPositionModal'));
            modal.hide();
            
            saveData();
            renderGroups();
            updateStatistics();
            
            // Reset transfer data
            transferData = {
                person: null,
                fromGroup: null,
                toGroup: null,
                lastDuties: null,
                missingPeriods: null,
                positions: {}
            };
        }

        // Close dropdowns when clicking outside
        document.addEventListener('click', function(event) {
            if (!event.target.closest('.transfer-dropdown')) {
                document.querySelectorAll('.transfer-dropdown-content').forEach(dropdown => {
                    dropdown.classList.remove('show');
                });
            }
        });

        // Add holiday
        function addHoliday() {
            document.getElementById('holidayDate').value = '';
            document.getElementById('holidayName').value = '';
            const modal = new bootstrap.Modal(document.getElementById('addHolidayModal'));
            modal.show();
        }

        // Save holiday
        function saveHoliday() {
            const date = document.getElementById('holidayDate').value;
            const name = document.getElementById('holidayName').value.trim();
            
            if (!date) {
                alert('Παρακαλώ επιλέξτε ημερομηνία');
                return;
            }
            
            const holidayDate = new Date(date + 'T00:00:00');
            const holidayKey = formatDateKey(holidayDate);
            
            // Check if already exists
            if (holidays.find(h => h.date === holidayKey)) {
                alert('Αυτή η ημερομηνία είναι ήδη σημειωμένη ως αργία');
                return;
            }
            
            holidays.push({
                date: holidayKey,
                name: name || 'Holiday'
            });
            
            saveData();
            renderHolidays();
            renderCalendar();
            
            const modal = bootstrap.Modal.getInstance(document.getElementById('addHolidayModal'));
            modal.hide();
        }

        // Remove holiday
        function removeHoliday(index) {
            if (confirm('Είστε σίγουροι ότι θέλετε να αφαιρέσετε αυτή την αργία;')) {
                holidays.splice(index, 1);
                saveData();
                renderHolidays();
                renderCalendar();
            }
        }

        // Render holidays
        function renderHolidays() {
            const container = document.getElementById('holidaysList');
            if (!container) return;
            
            container.innerHTML = '';
            
            if (holidays.length === 0) {
                container.innerHTML = '<p class="text-muted text-center">Δεν έχουν προστεθεί αργίες ακόμα</p>';
                return;
            }
            
            holidays.sort((a, b) => a.date.localeCompare(b.date));
            
            holidays.forEach((holiday, index) => {
                const holidayDiv = document.createElement('div');
                holidayDiv.className = 'holiday-item';
                const date = new Date(holiday.date + 'T00:00:00');
                holidayDiv.innerHTML = `
                    <div>
                        <strong>${formatDate(date)}</strong>
                        ${holiday.name ? `<span class="text-muted ms-2">- ${holiday.name}</span>` : ''}
                    </div>
                    <button class="btn btn-sm btn-outline-danger" onclick="removeHoliday(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                `;
                container.appendChild(holidayDiv);
            });
        }

        // Configuration: How many years ahead to calculate recurring special holidays
        const SPECIAL_HOLIDAYS_YEARS_AHEAD = 30; // Calculate for next 30 years

        // Initialize default special holidays based on recurring configuration
        function initializeDefaultSpecialHolidays() {
            const currentYear = new Date().getFullYear();
            const yearsToCalculate = SPECIAL_HOLIDAYS_YEARS_AHEAD;
            const expectedHolidays = new Map(); // Track which dates SHOULD be special holidays with their names
            
            // First, collect all dates that SHOULD be special holidays based on recurring config
            recurringSpecialHolidays.forEach(holidayDef => {
                if (holidayDef.type === 'fixed') {
                    // Fixed date holidays (month + day)
                    for (let year = currentYear; year <= currentYear + yearsToCalculate; year++) {
                        const date = new Date(year, holidayDef.month - 1, holidayDef.day);
                        const dateKey = formatDateKey(date);
                        expectedHolidays.set(dateKey, holidayDef.name);
                    }
                } else if (holidayDef.type === 'easter-relative') {
                    // Movable holidays based on Orthodox Easter
                    for (let year = currentYear; year <= currentYear + yearsToCalculate; year++) {
                        const orthodoxHolidays = calculateOrthodoxHolidays(year);
                        const easterDate = orthodoxHolidays.easterSunday;
                        
                        const holidayDate = new Date(easterDate);
                        holidayDate.setDate(holidayDate.getDate() + (holidayDef.offset || 0));
                        
                        const dateKey = formatDateKey(holidayDate);
                        expectedHolidays.set(dateKey, holidayDef.name);
                    }
                }
            });
            
            // Remove special holidays that are no longer in the recurring configuration
            // (but keep manually added ones if they exist - though currently all are from recurring)
            specialHolidays = specialHolidays.filter(h => {
                // Keep if it's in the expected list OR if it's a manually added one
                // For now, we'll remove all that aren't in expected list since all come from recurring
                return expectedHolidays.has(h.date);
            });
            
            // Add missing holidays from recurring configuration
            expectedHolidays.forEach((holidayName, dateKey) => {
                if (!specialHolidays.some(h => h.date === dateKey)) {
                    specialHolidays.push({
                        date: dateKey,
                        name: holidayName
                    });
                } else {
                    // Update the name if it changed
                    const existing = specialHolidays.find(h => h.date === dateKey);
                    if (existing && existing.name !== holidayName) {
                        existing.name = holidayName;
                    }
                }
            });
            
            // Sort by date
            specialHolidays.sort((a, b) => a.date.localeCompare(b.date));
            // NOTE: Do NOT call saveData() here - it will be called when user makes actual changes
            // This prevents unnecessary Firebase writes on every page load
        }
        
        // Load recurring holidays configuration
        async function loadRecurringHolidaysConfig() {
            try {
                if (window.db) {
                    const db = window.db || firebase.firestore();
                    const user = window.auth?.currentUser;
                    
                    if (user) {
                        const doc = await db.collection('dutyShifts').doc('recurringSpecialHolidays').get();
                        if (doc.exists) {
                            const data = doc.data();
                            recurringSpecialHolidays = data.list || recurringSpecialHolidays;
                        }
                    }
                }
                
                // Fallback to localStorage
                const saved = localStorage.getItem('dutyShiftsRecurringHolidays');
                if (saved) {
                    recurringSpecialHolidays = JSON.parse(saved);
                }
            } catch (error) {
                console.error('Error loading recurring holidays config:', error);
                const saved = localStorage.getItem('dutyShiftsRecurringHolidays');
                if (saved) {
                    recurringSpecialHolidays = JSON.parse(saved);
                }
            }
        }
        
        // Save recurring holidays configuration to Firebase
        async function saveRecurringHolidaysConfig() {
            try {
                if (!window.db) {
                    localStorage.setItem('dutyShiftsRecurringHolidays', JSON.stringify(recurringSpecialHolidays));
                    return;
                }
                
                const db = window.db || firebase.firestore();
                const user = window.auth?.currentUser;
                
                if (!user) {
                    localStorage.setItem('dutyShiftsRecurringHolidays', JSON.stringify(recurringSpecialHolidays));
                    return;
                }
                
                await db.collection('dutyShifts').doc('recurringSpecialHolidays').set({
                    list: recurringSpecialHolidays,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: user.uid
                });
                
                localStorage.setItem('dutyShiftsRecurringHolidays', JSON.stringify(recurringSpecialHolidays));
            } catch (error) {
                console.error('Error saving recurring holidays config:', error);
                localStorage.setItem('dutyShiftsRecurringHolidays', JSON.stringify(recurringSpecialHolidays));
            }
        }

        // Render special holidays
        function renderSpecialHolidays() {
            const container = document.getElementById('specialHolidaysList');
            if (!container) return;
            
            container.innerHTML = '';
            
            if (specialHolidays.length === 0) {
                container.innerHTML = '<p class="text-muted text-center">Δεν έχουν προστεθεί ειδικές αργίες ακόμα</p>';
                return;
            }
            
            specialHolidays.sort((a, b) => a.date.localeCompare(b.date));
            
            specialHolidays.forEach((holiday, index) => {
                const holidayDiv = document.createElement('div');
                holidayDiv.className = 'holiday-item';
                holidayDiv.style.borderLeft = '4px solid #FFC107';
                const date = new Date(holiday.date + 'T00:00:00');
                holidayDiv.innerHTML = `
                    <div>
                        <strong><i class="fas fa-star text-warning me-1"></i>${formatDate(date)}</strong>
                        ${holiday.name ? `<span class="text-muted ms-2">- ${holiday.name}</span>` : ''}
                    </div>
                    <button class="btn btn-sm btn-outline-danger" onclick="removeSpecialHoliday(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                `;
                container.appendChild(holidayDiv);
            });
        }

        // Add special holiday
        function addSpecialHoliday() {
            document.getElementById('specialHolidayDate').value = '';
            document.getElementById('specialHolidayName').value = '';
            const modal = new bootstrap.Modal(document.getElementById('addSpecialHolidayModal'));
            modal.show();
        }

        // Save special holiday
        function saveSpecialHoliday() {
            const date = document.getElementById('specialHolidayDate').value;
            const name = document.getElementById('specialHolidayName').value.trim();
            
            if (!date) {
                alert('Παρακαλώ επιλέξτε ημερομηνία');
                return;
            }
            
            const dateKey = formatDateKey(new Date(date + 'T00:00:00'));
            
            // Check if already exists
            if (specialHolidays.some(h => h.date === dateKey)) {
                alert('Αυτή η ημερομηνία είναι ήδη σημειωμένη ως ειδική αργία');
                return;
            }
            
            specialHolidays.push({
                date: dateKey,
                name: name || ''
            });
            
            // Sort by date
            specialHolidays.sort((a, b) => a.date.localeCompare(b.date));
            
            saveData();
            renderCalendar();
            
            const modal = bootstrap.Modal.getInstance(document.getElementById('addSpecialHolidayModal'));
            modal.hide();
        }

        // Remove special holiday (kept for backward compatibility, but not used in UI)
        function removeSpecialHoliday(index) {
            if (confirm('Είστε σίγουροι ότι θέλετε να αφαιρέσετε αυτή την ειδική αργία;')) {
                specialHolidays.splice(index, 1);
                saveData();
                renderCalendar();
            }
        }

        // Toggle recurring holiday fields based on type
        function toggleRecurringHolidayFields() {
            const type = document.getElementById('recurringHolidayType').value;
            const fixedFields = document.getElementById('fixedDateFields');
            const fixedDayFields = document.getElementById('fixedDayFields');
            const easterFields = document.getElementById('easterOffsetFields');
            
            if (type === 'fixed') {
                fixedFields.style.display = 'block';
                fixedDayFields.style.display = 'block';
                easterFields.style.display = 'none';
            } else {
                fixedFields.style.display = 'none';
                fixedDayFields.style.display = 'none';
                easterFields.style.display = 'block';
            }
        }

        // Render recurring holidays configuration
        function renderRecurringHolidays() {
            const container = document.getElementById('recurringHolidaysList');
            if (!container) return;
            
            container.innerHTML = '';
            
            if (recurringSpecialHolidays.length === 0) {
                container.innerHTML = '<p class="text-muted text-center">Δεν έχουν οριστεί επαναλαμβανόμενες αργίες</p>';
                return;
            }
            
            recurringSpecialHolidays.forEach((holiday, index) => {
                const holidayDiv = document.createElement('div');
                holidayDiv.className = 'holiday-item';
                holidayDiv.style.borderLeft = '4px solid #17a2b8';
                
                let displayText = '';
                if (holiday.type === 'fixed') {
                    const monthNames = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 
                                       'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];
                    displayText = `${holiday.day} ${monthNames[holiday.month - 1]} - ${holiday.name}`;
                } else if (holiday.type === 'easter-relative') {
                    const offsetText = holiday.offset === 0 ? 'Πάσχα' : 
                                      holiday.offset === -1 ? '1 ημέρα πριν το Πάσχα' :
                                      holiday.offset === 1 ? '1 ημέρα μετά το Πάσχα' :
                                      `${holiday.offset} ημέρες ${holiday.offset > 0 ? 'μετά' : 'πριν'} το Πάσχα`;
                    displayText = `${holiday.name} (${offsetText})`;
                }
                
                holidayDiv.innerHTML = `
                    <div>
                        <strong><i class="fas fa-repeat text-info me-1"></i>${displayText}</strong>
                    </div>
                    <button class="btn btn-sm btn-outline-danger" onclick="removeRecurringHoliday(${index})">
                        <i class="fas fa-trash"></i>
                    </button>
                `;
                container.appendChild(holidayDiv);
            });
        }

        // Add recurring holiday
        function addRecurringHoliday() {
            document.getElementById('recurringHolidayType').value = 'fixed';
            document.getElementById('recurringHolidayMonth').value = '';
            document.getElementById('recurringHolidayDay').value = '';
            document.getElementById('recurringHolidayEasterOffset').value = '0';
            document.getElementById('recurringHolidayName').value = '';
            toggleRecurringHolidayFields();
            const modal = new bootstrap.Modal(document.getElementById('addRecurringHolidayModal'));
            modal.show();
        }

        // Save recurring holiday
        function saveRecurringHoliday() {
            const type = document.getElementById('recurringHolidayType').value;
            const name = document.getElementById('recurringHolidayName').value.trim();
            
            if (!name) {
                alert('Παρακαλώ εισάγετε όνομα');
                return;
            }
            
            let holidayDef = { name: name, type: type };
            
            if (type === 'fixed') {
                const month = parseInt(document.getElementById('recurringHolidayMonth').value);
                const day = parseInt(document.getElementById('recurringHolidayDay').value);
                
                if (!month || !day) {
                    alert('Παρακαλώ επιλέξτε μήνα και ημέρα');
                    return;
                }
                
                holidayDef.month = month;
                holidayDef.day = day;
            } else if (type === 'easter-relative') {
                const offset = parseInt(document.getElementById('recurringHolidayEasterOffset').value) || 0;
                holidayDef.offset = offset;
            }
            
            recurringSpecialHolidays.push(holidayDef);
            saveRecurringHolidaysConfig();
            renderRecurringHolidays();
            
            // Regenerate special holidays for all years
            initializeDefaultSpecialHolidays();
            renderCalendar();
            
            const modal = bootstrap.Modal.getInstance(document.getElementById('addRecurringHolidayModal'));
            modal.hide();
        }

        // Remove recurring holiday
        function removeRecurringHoliday(index) {
            if (confirm('Είστε σίγουροι ότι θέλετε να αφαιρέσετε αυτή την επαναλαμβανόμενη αργία;')) {
                recurringSpecialHolidays.splice(index, 1);
                saveRecurringHolidaysConfig();
                renderRecurringHolidays();
                
                // Regenerate special holidays
                initializeDefaultSpecialHolidays();
                renderCalendar();
            }
        }

        // Calculate Orthodox Easter (returns the date of Easter Sunday)
        // Orthodox Easter is calculated using the Julian calendar
        function calculateOrthodoxEaster(year) {
            // Algorithm for calculating Orthodox Easter (Julian calendar)
            const a = year % 19;
            const b = year % 7;
            const c = year % 4;
            
            const d = (19 * a + 15) % 30;
            const e = (2 * c + 4 * b - d + 34) % 7;
            const f = d + e + 114;
            
            const month = Math.floor(f / 31);
            const day = (f % 31) + 1;
            
            // Convert to Gregorian calendar (add 13 days for 20th-21st century)
            const easterDate = new Date(year, month - 1, day);
            easterDate.setDate(easterDate.getDate() + 13);
            
            return easterDate;
        }

        // Calculate all Orthodox holidays based on Easter
        function calculateOrthodoxHolidays(year) {
            const easterSunday = calculateOrthodoxEaster(year);
            const holidays = {};
            
            // Clean Monday (48 days before Easter)
            const cleanMonday = new Date(easterSunday);
            cleanMonday.setDate(cleanMonday.getDate() - 48);
            holidays['cleanMonday'] = cleanMonday;
            
            // Palm Sunday (7 days before Easter)
            const palmSunday = new Date(easterSunday);
            palmSunday.setDate(palmSunday.getDate() - 7);
            holidays['palmSunday'] = palmSunday;
            
            // Good Friday (2 days before Easter)
            const goodFriday = new Date(easterSunday);
            goodFriday.setDate(goodFriday.getDate() - 2);
            holidays['goodFriday'] = goodFriday;
            
            // Great Saturday (1 day before Easter)
            const greatSaturday = new Date(easterSunday);
            greatSaturday.setDate(greatSaturday.getDate() - 1);
            holidays['greatSaturday'] = greatSaturday;
            
            // Easter Sunday (Great Sunday)
            holidays['easterSunday'] = easterSunday;
            
            // Easter Monday (1 day after Easter)
            const easterMonday = new Date(easterSunday);
            easterMonday.setDate(easterMonday.getDate() + 1);
            holidays['easterMonday'] = easterMonday;
            
            // Ascension Day (39 days after Easter)
            const ascensionDay = new Date(easterSunday);
            ascensionDay.setDate(ascensionDay.getDate() + 39);
            holidays['ascensionDay'] = ascensionDay;
            
            // Pentecost (49 days after Easter)
            const pentecost = new Date(easterSunday);
            pentecost.setDate(pentecost.getDate() + 49);
            holidays['pentecost'] = pentecost;
            
            // Whit Monday (50 days after Easter)
            const whitMonday = new Date(easterSunday);
            whitMonday.setDate(whitMonday.getDate() + 50);
            holidays['whitMonday'] = whitMonday;
            
            return holidays;
        }

        // Check if date is a special holiday (checks both specialHolidays array and recurring configuration)
        function isSpecialHoliday(date) {
            const key = formatDateKey(date);
            
            // First check the specialHolidays array (for current/future years)
            if (specialHolidays.some(h => h.date === key)) {
                return true;
            }
            
            // Also check against recurring configuration (works for ANY year, including past years)
            const year = date.getFullYear();
            const month = date.getMonth() + 1; // 1-12
            const day = date.getDate();
            
            for (const holidayDef of recurringSpecialHolidays) {
                if (holidayDef.type === 'fixed') {
                    // Fixed date holidays (month + day)
                    if (holidayDef.month === month && holidayDef.day === day) {
                        return true;
                    }
                } else if (holidayDef.type === 'easter-relative') {
                    // Movable holidays based on Orthodox Easter
                    const orthodoxHolidays = calculateOrthodoxHolidays(year);
                    const easterDate = orthodoxHolidays.easterSunday;
                    const holidayDate = new Date(easterDate);
                    holidayDate.setDate(holidayDate.getDate() + (holidayDef.offset || 0));
                    
                    // Check if the date matches
                    if (formatDateKey(holidayDate) === key) {
                        return true;
                    }
                }
            }
            
            return false;
        }

        // Check if date is holiday (including automatically detected Orthodox/Cyprus holidays)
        function isHoliday(date) {
            const key = formatDateKey(date);
            // Check user-defined holidays
            if (holidays.some(h => h.date === key)) {
                return true;
            }
            // Check automatically detected Orthodox/Cyprus holidays
            return isOrthodoxOrCyprusHoliday(date);
        }

        // Check if date is an Orthodox or Cyprus Greek holiday (automatic detection)
        function isOrthodoxOrCyprusHoliday(date) {
            const month = date.getMonth() + 1; // 1-12
            const day = date.getDate();
            const year = date.getFullYear();
            const dateKey = formatDateKey(date);
            
            // Fixed Orthodox/Cyprus holidays
            if (month === 1 && day === 1) return true;  // New Year's Day
            if (month === 1 && day === 6) return true;  // Epiphany/Theophany
            if (month === 3 && day === 25) return true; // Annunciation / Greek Independence Day
            if (month === 4 && day === 1) return true;  // EOKA Liberation Struggle Day
            if (month === 5 && day === 1) return true;  // Labor Day
            if (month === 8 && day === 15) return true; // Dormition of the Theotokos
            if (month === 10 && day === 1) return true; // Cyprus Independence Day
            if (month === 10 && day === 28) return true; // Ochi Day
            // December 24 is a special holiday, not a normal holiday
            if (month === 12 && day === 25) return true; // Christmas (Nativity of Christ)
            if (month === 12 && day === 26) return true; // Synaxis of the Theotokos
            if (month === 12 && day === 31) return true; // New Year's Eve
            
            // Orthodox holidays based on Easter (excluding Ascension and Pentecost)
            const orthodoxHolidays = calculateOrthodoxHolidays(year);
            const excludedHolidays = ['ascensionDay', 'pentecost']; // Holidays to exclude
            for (const key in orthodoxHolidays) {
                if (!excludedHolidays.includes(key) && dateKey === formatDateKey(orthodoxHolidays[key])) {
                    return true;
                }
            }
            
            return false;
        }

        // Get Orthodox/Cyprus holiday name for a date (automatic detection)
        function getOrthodoxHolidayNameAuto(date) {
            if (!isOrthodoxOrCyprusHoliday(date)) return null;
            
            const month = date.getMonth() + 1;
            const day = date.getDate();
            const year = date.getFullYear();
            const dateKey = formatDateKey(date);
            
            // Fixed Orthodox holidays
            if (month === 1 && day === 1) return 'Πρωτοχρονιά';
            if (month === 1 && day === 6) return 'Θεοφάνια';
            if (month === 3 && day === 25) return 'Ευαγγελισμός';
            if (month === 4 && day === 1) return 'ΕΟΚΑ';
            if (month === 5 && day === 1) return 'Πρωτομαγιά';
            if (month === 8 && day === 15) return 'Κοίμηση';
            if (month === 10 && day === 1) return 'Ανεξαρτησία';
            if (month === 10 && day === 28) return 'Όχι';
            // December 24 is a special holiday, name comes from special holidays list
            if (month === 12 && day === 25) return 'Χριστούγεννα';
            if (month === 12 && day === 26) return 'Σύναξης';
            if (month === 12 && day === 31) return 'Παραμονή';
            
            // Orthodox holidays based on Easter (excluding Ascension and Pentecost)
            const orthodoxHolidays = calculateOrthodoxHolidays(year);
            
            if (dateKey === formatDateKey(orthodoxHolidays.cleanMonday)) return 'Καθαρά Δευτέρα';
            if (dateKey === formatDateKey(orthodoxHolidays.palmSunday)) return 'Κυριακή Βαΐων';
            if (dateKey === formatDateKey(orthodoxHolidays.goodFriday)) return 'Μ. Παρασκευή';
            if (dateKey === formatDateKey(orthodoxHolidays.greatSaturday)) return 'Μ. Σάββατο';
            if (dateKey === formatDateKey(orthodoxHolidays.easterSunday)) return 'Πάσχα';
            if (dateKey === formatDateKey(orthodoxHolidays.easterMonday)) return 'Δευτέρα Πάσχα';
            if (dateKey === formatDateKey(orthodoxHolidays.whitMonday)) return 'Αγίου Πνεύματος';
            
            return null;
        }

        // Check if date is weekend
        function isWeekend(date) {
            const day = date.getDay();
            return day === 0 || day === 6; // Sunday or Saturday
        }

        // Get day type
        function getDayType(date) {
            // Special holidays have highest priority
            if (isSpecialHoliday(date)) {
                return 'special-holiday';
            }
            
            if (isHoliday(date)) {
                return 'weekend-holiday';
            }
            
            if (isWeekend(date)) {
                return 'weekend-holiday';
            }
            
            // Special case: December 30th should be normal day (unless it's Friday or weekend)
            // Don't classify it as semi-normal just because next day (Dec 31) is a special holiday
            const isDecember30 = date.getMonth() === 11 && date.getDate() === 30;
            
            // For December 30th, check if it's Friday (semi-normal) or return normal
            if (isDecember30) {
                if (date.getDay() === 5) {
                    return 'semi-normal-day'; // Friday
                }
                // December 30th is normal day (unless it's Friday or weekend, which is already checked above)
                return 'normal-day';
            }
            
            // For all other days, check if next day is weekend, holiday, or special holiday
            const nextDay = new Date(date);
            nextDay.setDate(nextDay.getDate() + 1);
            
            if (isWeekend(nextDay) || isHoliday(nextDay) || isSpecialHoliday(nextDay)) {
                return 'semi-normal-day';
            }
            
            // Check if it's Friday
            if (date.getDay() === 5) {
                return 'semi-normal-day';
            }
            
            return 'normal-day';
        }

        // Format date key
        function formatDateKey(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        // Convert date key (YYYY-MM-DD) to month name (e.g., "February 2026")
        function getMonthNameFromDateKey(dateKey) {
            try {
                const [year, month] = dateKey.split('-').map(Number);
                const date = new Date(year, month - 1, 1);
                const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
                return `${monthNames[month - 1]} ${year}`;
            } catch (error) {
                console.error('Error converting date key to month name:', dateKey, error);
                return null;
            }
        }

        // Organize assignments by month for Firestore storage
        function organizeAssignmentsByMonth(assignments) {
            const organized = {};
            for (const dateKey in assignments) {
                if (dateKey === 'lastUpdated' || dateKey === 'updatedBy' || dateKey === '_migratedFrom' || dateKey === '_migrationDate') {
                    continue;
                }
                const monthName = getMonthNameFromDateKey(dateKey);
                if (monthName) {
                    if (!organized[monthName]) {
                        organized[monthName] = {};
                    }
                    organized[monthName][dateKey] = assignments[dateKey];
                }
            }
            return organized;
        }

        // Flatten month-organized assignments back to date-key format
        function flattenAssignmentsByMonth(organizedAssignments) {
            const flattened = {};
            for (const monthName in organizedAssignments) {
                if (monthName === 'lastUpdated' || monthName === 'updatedBy' || monthName === '_migratedFrom' || monthName === '_migrationDate') {
                    continue;
                }
                const monthData = organizedAssignments[monthName];
                if (typeof monthData === 'object' && monthData !== null) {
                    for (const dateKey in monthData) {
                        flattened[dateKey] = monthData[dateKey];
                    }
                }
            }
            return flattened;
        }

        // Format date for display
        function formatDate(date) {
            return date.toLocaleDateString('el-GR', { 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric',
                weekday: 'long'
            });
        }

        // Get Greek day name (short)
        function getGreekDayName(date) {
            const days = ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'];
            return days[date.getDay()];
        }
        
        // Get Greek day name in uppercase for Excel
        function getGreekDayNameUppercase(date) {
            const days = ['ΚΥΡΙΑΚΗ', 'ΔΕΥΤΕΡΑ', 'ΤΡΙΤΗ', 'ΤΕΤΑΡΤΗ', 'ΠΕΜΠΤΗ', 'ΠΑΡΑΣΚΕΥΗ', 'ΣΑΒΒΑΤΟ'];
            return days[date.getDay()];
        }

        // Get Greek month name
        function getGreekMonthName(date) {
            const months = ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου',
                          'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'];
            return months[date.getMonth()];
        }

        // Get day type background color for PDF
        function getDayTypeColor(dayType) {
            const colors = {
                'normal-day': [232, 245, 233],      // #E8F5E9 - light green
                'semi-normal-day': [255, 249, 196], // #FFF9C4 - light yellow
                'weekend-holiday': [255, 224, 178],  // #FFE0B2 - light orange
                'special-holiday': [225, 190, 231]   // #E1BEE7 - light purple
            };
            return colors[dayType] || [255, 255, 255]; // Default white
        }

        // Show Excel preview before generating files
        function showExcelPreview() {
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const monthName = getGreekMonthName(currentDate);
            
            // Get all days of the month
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            const daysInMonth = lastDay.getDate();
            
            const previewContent = document.getElementById('excelPreviewContent');
            previewContent.innerHTML = '';
            
            let hasAnyGroup = false;
            
            // Generate preview for each group
            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                const groupName = getGroupName(groupNum);
                const groupData = groups[groupNum];
                
                // Skip if group has no people
                if (!groupData || (!groupData.special?.length && !groupData.weekend?.length && !groupData.semi?.length && !groupData.normal?.length)) {
                    continue;
                }
                
                hasAnyGroup = true;
                
                // Create preview table for this group
                const groupPreview = document.createElement('div');
                groupPreview.className = 'mb-4';
                groupPreview.innerHTML = `
                    <h5 class="mb-3" style="color: #428BCA;">
                        <i class="fas fa-users me-2"></i>${groupName} - ${monthName} ${year}
                    </h5>
                    <div class="table-responsive">
                        <table class="table table-bordered" style="font-size: 12px;">
                            <thead>
                                <tr style="background-color: #428BCA; color: white;">
                                    <th style="width: 12%; text-align: center; padding: 8px;">ΗΜΕΡ.</th>
                                    <th style="width: 15%; text-align: center; padding: 8px;">ΗΜΕΡΑ</th>
                                    <th style="width: 30%; text-align: center; padding: 8px;">ΟΝΟΜΑΤΕΠΩΝΥΜΟ</th>
                                </tr>
                            </thead>
                            <tbody id="previewGroup${groupNum}">
                                <!-- Rows will be inserted here -->
                            </tbody>
                        </table>
                    </div>
                `;
                previewContent.appendChild(groupPreview);
                
                const tbody = document.getElementById(`previewGroup${groupNum}`);
                
                // Add data rows
                for (let day = 1; day <= daysInMonth; day++) {
                    const date = new Date(year, month, day);
                    const dayKey = formatDateKey(date);
                    const dayType = getDayType(date);
                    const dayName = getGreekDayNameUppercase(date);
                    
                    // Get assignment for this group
                    const assignment = dutyAssignments[dayKey] || '';
                    let personName = '';
                    
                    if (assignment) {
                        // Extract person name for this group
                        const parts = assignment.split(',').map(p => p.trim()).filter(p => p);
                        for (const part of parts) {
                            const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                            if (match && parseInt(match[2]) === groupNum) {
                                personName = match[1].trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '');
                                break;
                            }
                        }
                    }
                    
                    // Format date as DD/MM/YYYY
                    const dateStr = `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;
                    
                    // Get color for this day type
                    const color = getDayTypeColor(dayType);
                    const rgbColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
                    
                    const row = document.createElement('tr');
                    row.style.height = '22px';
                    row.innerHTML = `
                        <td style="padding: 4px; border: 1px solid #ddd; background-color: ${rgbColor} !important;">${dateStr}</td>
                        <td style="padding: 4px; border: 1px solid #ddd; background-color: ${rgbColor} !important;">${dayName}</td>
                        <td style="padding: 4px; border: 1px solid #ddd; background-color: ${rgbColor} !important;">${personName || ''}</td>
                    `;
                    tbody.appendChild(row);
                }
            }
            
            // Show message if no groups have data
            const generateBtn = document.getElementById('generateExcelBtn');
            if (!hasAnyGroup) {
                previewContent.innerHTML = `
                    <div class="alert alert-warning">
                        <i class="fas fa-exclamation-triangle me-2"></i>
                        Δεν υπάρχουν ομάδες με άτομα για να δημιουργηθούν Excel αρχεία.
                    </div>
                `;
                if (generateBtn) {
                    generateBtn.disabled = true;
                }
            } else {
                if (generateBtn) {
                    generateBtn.disabled = false;
                }
            }
            
            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('excelPreviewModal'));
            modal.show();
        }

        // Generate Excel files for current month for all groups
        async function generateExcelFilesForCurrentMonth(skipPreview = false) {
            try {
                const year = currentDate.getFullYear();
                const month = currentDate.getMonth();
                const monthName = getGreekMonthName(currentDate);
                
                // Get all days of the month
                const firstDay = new Date(year, month, 1);
                const lastDay = new Date(year, month + 1, 0);
                const daysInMonth = lastDay.getDate();
                
                // Show loading message
                const loadingAlert = document.createElement('div');
                loadingAlert.className = 'alert alert-info position-fixed top-50 start-50 translate-middle';
                loadingAlert.style.zIndex = '9999';
                loadingAlert.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Δημιουργία Excel αρχείων...';
                document.body.appendChild(loadingAlert);
                
                // Check if ExcelJS is available, otherwise fall back to SheetJS
                const useExcelJS = typeof ExcelJS !== 'undefined';
                
                // Generate Excel file for each group
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const groupName = getGroupName(groupNum);
                    const groupData = groups[groupNum];
                    
                    // Skip if group has no people
                    if (!groupData || (!groupData.special?.length && !groupData.weekend?.length && !groupData.semi?.length && !groupData.normal?.length)) {
                        continue;
                    }
                    
                    if (useExcelJS) {
                        // Use ExcelJS for better styling support
                        const workbook = new ExcelJS.Workbook();
                        const worksheet = workbook.addWorksheet('Υπηρεσίες');
                        
                        // Set title - merge cells A1 through C1
                        worksheet.mergeCells('A1:C1');
                        const titleCell = worksheet.getCell('A1');
                        titleCell.value = `ΥΠΗΡΕΣΙΑ ${groupName} ΜΗΝΟΣ ${monthName.toUpperCase()} ${year}`;
                        titleCell.font = { 
                            name: 'Arial', 
                            bold: true, 
                            size: 12 
                        };
                        titleCell.alignment = { 
                            horizontal: 'center', 
                            vertical: 'middle' 
                        };
                        titleCell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FF428BCA' } // Blue background like in photo
                        };
                        titleCell.font.color = { argb: 'FFFFFFFF' }; // White text
                        // Add borders to title cell
                        titleCell.border = {
                            top: { style: 'thick' },
                            left: { style: 'thick' },
                            bottom: { style: 'thick' },
                            right: { style: 'thick' }
                        };
                        worksheet.getRow(1).height = 22;
                        
                        // Empty row
                        worksheet.getRow(2).height = 5;
                        
                        // Header row
                        const headerRow = worksheet.getRow(3);
                        headerRow.getCell(1).value = 'ΗΜΕΡ.';
                        headerRow.getCell(2).value = 'ΗΜΕΡΑ';
                        headerRow.getCell(3).value = 'ΟΝΟΜΑΤΕΠΩΝΥΜΟ';
                        
                        // Style each header cell individually
                        ['A3', 'B3', 'C3'].forEach(cellRef => {
                            const cell = worksheet.getCell(cellRef);
                            cell.font = { 
                                name: 'Arial', 
                                bold: true, 
                                size: 12,
                                color: { argb: 'FFFFFFFF' } // White text
                            };
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: 'FF428BCA' } // Blue background
                            };
                            cell.alignment = { 
                                horizontal: 'center', 
                                vertical: 'middle' 
                            };
                            // Add borders to header cells
                            cell.border = {
                                top: { style: 'thick' },
                                left: { style: 'thin' },
                                bottom: { style: 'thick' },
                                right: { style: 'thin' }
                            };
                        });
                        // Add thick left and right borders to first and last header cells
                        worksheet.getCell('A3').border.left = { style: 'thick' };
                        worksheet.getCell('C3').border.right = { style: 'thick' };
                        headerRow.height = 22;
                        
                        // Set column widths
                        worksheet.getColumn(1).width = 12;
                        worksheet.getColumn(2).width = 15;
                        worksheet.getColumn(3).width = 30;
                        
                        // Data rows
                        for (let day = 1; day <= daysInMonth; day++) {
                            const date = new Date(year, month, day);
                            const dayKey = formatDateKey(date);
                            const dayType = getDayType(date);
                            const dayName = getGreekDayNameUppercase(date); // Use uppercase
                            
                            // Get assignment for this group
                            const assignment = dutyAssignments[dayKey] || '';
                            let personName = '';
                            
                            if (assignment) {
                                // Extract person name for this group - split by comma first to handle properly
                                const parts = assignment.split(',').map(p => p.trim()).filter(p => p);
                                for (const part of parts) {
                                    const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                                    if (match && parseInt(match[2]) === groupNum) {
                                        // Remove any leading/trailing commas from the name
                                        personName = match[1].trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '');
                                        break;
                                    }
                                }
                            }
                            
                            // Format date as DD/MM/YYYY
                            const dateStr = `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;
                            
                            const row = worksheet.getRow(day + 3); // +3 for title, empty, header rows
                            row.getCell(1).value = dateStr;
                            row.getCell(2).value = dayName;
                            row.getCell(3).value = personName;
                            
                            // Apply color based on day type
                            const color = getDayTypeColor(dayType);
                            const hexColor = 'FF' + color.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
                            
                            // Style each cell in the row
                            const isFirstDataRow = day === 1;
                            const isLastDataRow = day === daysInMonth;
                            
                            [1, 2, 3].forEach(colNum => {
                                const cell = row.getCell(colNum);
                                cell.fill = {
                                    type: 'pattern',
                                    pattern: 'solid',
                                    fgColor: { argb: hexColor }
                                };
                                cell.font = { 
                                    name: 'Arial', 
                                    size: 12 
                                };
                                cell.alignment = { 
                                    horizontal: 'left', 
                                    vertical: 'middle' 
                                };
                                
                                // Add borders - thick on outside, thin on inside
                                const isFirstCol = colNum === 1;
                                const isLastCol = colNum === 3;
                                
                                cell.border = {
                                    top: isFirstDataRow ? { style: 'thick' } : { style: 'thin' },
                                    bottom: isLastDataRow ? { style: 'thick' } : { style: 'thin' },
                                    left: isFirstCol ? { style: 'thick' } : { style: 'thin' },
                                    right: isLastCol ? { style: 'thick' } : { style: 'thin' }
                                };
                            });
                            
                            row.height = 22;
                        }
                        
                        // Generate file name
                        const fileName = `YPHRESIA_${groupName.replace(/[^a-zA-Z0-9]/g, '_')}_${monthName.replace(/[^a-zA-Z0-9]/g, '_')}_${year}.xlsx`;
                        
                        // Write file
                        const buffer = await workbook.xlsx.writeBuffer();
                        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = fileName;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                    } else {
                        // Fallback to SheetJS (limited styling)
                        const wb = XLSX.utils.book_new();
                        const data = [];
                        const rowDayTypes = [];
                        
                        data.push([`ΥΠΗΡΕΣΙΑ ${groupName} ΜΗΝΟΣ ${monthName.toUpperCase()} ${year}`]);
                        data.push([]);
                        rowDayTypes.push(null, null);
                        
                        data.push(['ΗΜΕΡ.', 'ΗΜΕΡΑ', 'ΟΝΟΜΑΤΕΠΩΝΥΜΟ']);
                        rowDayTypes.push(null);
                        
                        for (let day = 1; day <= daysInMonth; day++) {
                            const date = new Date(year, month, day);
                            const dayKey = formatDateKey(date);
                            const dayType = getDayType(date);
                            const dayName = getGreekDayNameUppercase(date); // Use uppercase
                            
                            const assignment = dutyAssignments[dayKey] || '';
                            let personName = '';
                            
                            if (assignment) {
                                const parts = assignment.split(',').map(p => p.trim()).filter(p => p);
                                for (const part of parts) {
                                    const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                                    if (match && parseInt(match[2]) === groupNum) {
                                        personName = match[1].trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '');
                                        break;
                                    }
                                }
                            }
                            
                            const dateStr = `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;
                            data.push([dateStr, dayName, personName]);
                            rowDayTypes.push(dayType);
                        }
                        
                        const ws = XLSX.utils.aoa_to_sheet(data);
                        ws['!cols'] = [{ wch: 12 }, { wch: 15 }, { wch: 30 }];
                        if (!ws['!merges']) ws['!merges'] = [];
                        ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } });
                        
                        // Style title row (row 1)
                        const titleCell = 'A1';
                        if (!ws[titleCell]) ws[titleCell] = { t: 's', v: data[0][0] || '' };
                        if (!ws[titleCell].s) ws[titleCell].s = {};
                        ws[titleCell].s.font = { name: 'Arial', bold: true, sz: 12, color: { rgb: 'FFFFFF' } };
                        ws[titleCell].s.fill = { fgColor: { rgb: '428BCA' }, patternType: 'solid' };
                        ws[titleCell].s.alignment = { horizontal: 'center', vertical: 'center' };
                        
                        // Style header row (row 3)
                        const headerRow = 2; // 0-indexed, so row 3 is index 2
                        ['A', 'B', 'C'].forEach((col, idx) => {
                            const cellRef = col + (headerRow + 1);
                            if (!ws[cellRef]) ws[cellRef] = { t: 's', v: data[headerRow][idx] || '' };
                            if (!ws[cellRef].s) ws[cellRef].s = {};
                            ws[cellRef].s.font = { name: 'Arial', bold: true, sz: 12, color: { rgb: 'FFFFFF' } };
                            ws[cellRef].s.fill = { fgColor: { rgb: '428BCA' }, patternType: 'solid' };
                            ws[cellRef].s.alignment = { horizontal: 'center', vertical: 'center' };
                        });
                        
                        // Apply colors and fonts to data rows
                        for (let rowIdx = 3; rowIdx < rowDayTypes.length; rowIdx++) {
                            const dayType = rowDayTypes[rowIdx];
                            if (!dayType) continue;
                            
                            const color = getDayTypeColor(dayType);
                            const hexColor = color.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
                            const excelRow = rowIdx + 1;
                            
                            ['A', 'B', 'C'].forEach((col, colIdx) => {
                                const cellRef = col + excelRow;
                                if (!ws[cellRef]) {
                                    ws[cellRef] = { t: 's', v: data[rowIdx] ? (data[rowIdx][colIdx] || '') : '' };
                                }
                                if (!ws[cellRef].s) ws[cellRef].s = {};
                                ws[cellRef].s.fill = { fgColor: { rgb: hexColor }, patternType: 'solid' };
                                ws[cellRef].s.font = { name: 'Arial', sz: 12 };
                                ws[cellRef].s.alignment = { horizontal: 'left', vertical: 'center' };
                            });
                        }
                        
                        XLSX.utils.book_append_sheet(wb, ws, 'Υπηρεσίες');
                        const fileName = `YPHRESIA_${groupName.replace(/[^a-zA-Z0-9]/g, '_')}_${monthName.replace(/[^a-zA-Z0-9]/g, '_')}_${year}.xlsx`;
                        XLSX.writeFile(wb, fileName);
                    }
                }
                
                // Remove loading message
                if (document.body.contains(loadingAlert)) {
                    document.body.removeChild(loadingAlert);
                }
                
                // Close preview modal if it's open
                if (skipPreview) {
                    const previewModal = bootstrap.Modal.getInstance(document.getElementById('excelPreviewModal'));
                    if (previewModal) {
                        previewModal.hide();
                    }
                }
                
                alert('Τα Excel αρχεία δημιουργήθηκαν επιτυχώς!');
            } catch (error) {
                console.error('Error generating Excel files:', error);
                alert('Σφάλμα κατά τη δημιουργία των Excel αρχείων: ' + error.message);
                // Remove loading message if still present
                const loadingAlert = document.querySelector('.alert.position-fixed');
                if (loadingAlert) {
                    document.body.removeChild(loadingAlert);
                }
            }
        }


        // Generate a consistent color for a person based on their name
        function getPersonColor(personName) {
            // Create a hash from the person's name
            let hash = 0;
            for (let i = 0; i < personName.length; i++) {
                hash = personName.charCodeAt(i) + ((hash << 5) - hash);
            }
            
            // Generate a color from the hash (bright, distinct colors)
            const hue = Math.abs(hash) % 360;
            // Use high saturation and medium lightness for vibrant colors
            return `hsl(${hue}, 70%, 60%)`;
        }

        // Extract all person names from assignment string
        function extractAllPersonNames(assignment) {
            if (!assignment) return [];
            
            // Ensure assignment is a string - convert if needed
            let assignmentStr = assignment;
            if (typeof assignment !== 'string') {
                // If it's an object, try to convert it
                if (typeof assignment === 'object' && assignment !== null) {
                    // If it's an array, join it
                    if (Array.isArray(assignment)) {
                        assignmentStr = assignment.join(', ');
                    } else {
                        // If it's an object, try to stringify or return empty
                        console.warn('extractAllPersonNames: assignment is an object, cannot parse:', assignment);
                        return [];
                    }
                } else {
                    // Try to convert to string
                    assignmentStr = String(assignment);
                }
            }
            
            // Match all patterns like "Name (Ομάδα X)"
            const matches = assignmentStr.matchAll(/([^(]+)\s*\(Ομάδα\s*(\d+)\)/g);
            const persons = [];
            
            for (const match of matches) {
                if (match[1]) {
                    persons.push({
                        name: match[1].trim(),
                        group: parseInt(match[2])
                    });
                }
            }
            
            return persons;
        }

        // Get person colors for a day
        function getDayPersonColors(assignment) {
            if (!assignment) return [];
            
            const persons = extractAllPersonNames(assignment);
            return persons.map(p => ({
                color: getPersonColor(p.name),
                name: p.name,
                group: p.group
            }));
        }

        // Get holiday name for a date (checks special holidays first, then auto-detected Orthodox holidays)
        function getOrthodoxHolidayName(date) {
            // First check special holidays (user-defined)
            if (isSpecialHoliday(date)) {
                const key = formatDateKey(date);
                const holiday = specialHolidays.find(h => h.date === key);
                return holiday ? holiday.name : null;
            }
            
            // Then check auto-detected Orthodox/Cyprus holidays
            return getOrthodoxHolidayNameAuto(date);
        }

        // Render calendar
        function renderCalendar() {
            const calendarGrid = document.getElementById('calendarGrid');
            const currentMonthYear = document.getElementById('currentMonthYear');
            
            if (!calendarGrid || !currentMonthYear) {
                console.error('Calendar elements not found');
                return;
            }
            
            // CRITICAL: Restore critical assignments to day-type-specific documents before rendering
            // This ensures manually entered last duty dates are always visible
            Object.keys(criticalAssignments).forEach(dateKey => {
                const criticalPeople = criticalAssignments[dateKey];
                if (Array.isArray(criticalPeople) && criticalPeople.length > 0) {
                    const criticalStr = criticalPeople.join(', ');
                    const existingAssignment = getAssignmentForDate(dateKey);
                    if (!existingAssignment) {
                        // No assignment exists, add the critical one
                        setAssignmentForDate(dateKey, criticalStr);
                        console.log(`Restored critical assignment for ${dateKey}: ${criticalStr}`);
                    } else {
                        // Assignment exists, merge critical people if not already present
                        const existing = existingAssignment.split(', ');
                        let needsUpdate = false;
                        criticalPeople.forEach(person => {
                            if (!existing.includes(person)) {
                                existing.push(person);
                                needsUpdate = true;
                            }
                        });
                        if (needsUpdate) {
                            setAssignmentForDate(dateKey, existing.join(', '));
                            console.log(`Merged critical assignment for ${dateKey}: ${existing.join(', ')}`);
                        }
                    }
                }
            });
            
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            
            currentMonthYear.textContent = 
                currentDate.toLocaleDateString('el-GR', { month: 'long', year: 'numeric' });
            
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            const daysInMonth = lastDay.getDate();
            // Convert Sunday (0) to 6, Monday (1) to 0, etc. for Monday-first calendar
            let startingDayOfWeek = firstDay.getDay();
            startingDayOfWeek = startingDayOfWeek === 0 ? 6 : startingDayOfWeek - 1;
            
            const grid = calendarGrid;
            grid.innerHTML = '';
            
            // Day headers - Monday first
            const dayHeaders = ['Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ', 'Κυρ'];
            dayHeaders.forEach(header => {
                const headerDiv = document.createElement('div');
                headerDiv.className = 'calendar-day-header';
                headerDiv.textContent = header;
                grid.appendChild(headerDiv);
            });
            
            // Empty cells for days before month starts
            for (let i = 0; i < startingDayOfWeek; i++) {
                const emptyDiv = document.createElement('div');
                grid.appendChild(emptyDiv);
            }
            
            // Days of the month
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month, day);
                const dayType = getDayType(date);
                const isToday = date.getTime() === today.getTime();
                const key = formatDateKey(date);
                // Get assignment from the correct day-type-specific document
                const assignment = getAssignmentForDate(key);
                
                const dayDiv = document.createElement('div');
                // dayType is determined by getDayType() which handles:
                // - normal-day: green background (#E8F5E9)
                // - semi-normal-day: yellow background (#FFF9C4) - Fridays or days before holidays/weekends
                // - weekend-holiday: orange background (#FFE0B2) - weekends and regular holidays
                // - special-holiday: purple background (#E1BEE7) - special holidays
                // Note: December 30th is treated as normal-day (green) unless it's Friday or weekend
                
                // CRITICAL: Special holidays must always have purple color, even if they're also weekends/holidays
                // Remove conflicting day type classes and ensure special-holiday class is applied
                const isSpecial = isSpecialHoliday(date);
                if (isSpecial) {
                    // For special holidays, only use special-holiday class (purple color)
                    dayDiv.className = `calendar-day special-holiday ${isToday ? 'today' : ''}`;
                } else {
                    // For non-special holidays, use the normal dayType
                    dayDiv.className = `calendar-day ${dayType} ${isToday ? 'today' : ''}`;
                }
                
                // Set special holiday background and border
                if (isSpecial) {
                    // Set background and border for special holidays
                    dayDiv.style.background = '#E1BEE7';
                    dayDiv.style.borderColor = '#9C27B0';
                    // Also add a data attribute for CSS targeting if needed
                    dayDiv.setAttribute('data-special-holiday', 'true');
                }
                
                // Get holiday name (special holiday first, then Orthodox/Cyprus holiday)
                const holidayName = getOrthodoxHolidayName(date);
                
                // Parse assignment and display each person on a separate line (no commas)
                let displayAssignmentHtml = '';
                if (assignment) {
                    // Ensure assignment is a string (it might be an object if data wasn't flattened correctly)
                    const assignmentStr = typeof assignment === 'string' ? assignment : String(assignment);
                    // Split by comma first, then extract person-group info from each part
                    const parts = assignmentStr.split(',').map(p => p.trim()).filter(p => p);
                    const personGroups = [];
                    
                    parts.forEach(part => {
                        // Try to match "Name (Ομάδα X)" pattern
                        const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                        if (match) {
                            // Remove any leading/trailing commas from the name
                            const name = match[1].trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '');
                            personGroups.push({
                                name: name,
                                group: match[2].trim(),
                                fullString: part
                            });
                        } else {
                            // If no group pattern, check if it's just a name
                            // Try to extract group info if it exists elsewhere in the string
                            const groupMatch = part.match(/\(Ομάδα\s*(\d+)\)/);
                            if (groupMatch) {
                                let name = part.replace(/\s*\(Ομάδα\s*\d+\)\s*/, '').trim();
                                name = name.replace(/^,+\s*/, '').replace(/\s*,+$/, ''); // Remove leading/trailing commas
                                personGroups.push({
                                    name: name,
                                    group: groupMatch[1],
                                    fullString: part
                                });
                            } else {
                                // Just a name without group info - remove commas
                                let name = part.replace(/^,+\s*/, '').replace(/\s*,+$/, '');
                                personGroups.push({
                                    name: name,
                                    group: null,
                                    fullString: part
                                });
                            }
                        }
                    });
                    
                    // Check if this date has critical assignments
                    const criticalPeople = criticalAssignments[key] || [];
                    
                    // Create a container div for all persons - each on separate line
                    displayAssignmentHtml = '<div class="duty-person-container">';
                    personGroups.forEach(({ name, group, fullString }) => {
                        // Check if this person-group combination is in critical assignments
                        const isCritical = criticalPeople.some(cp => {
                            if (group) {
                                return cp === fullString || (cp.includes(name) && cp.includes(`(Ομάδα ${group})`));
                            } else {
                                return cp.includes(name);
                            }
                        });
                        
                        // Check for skip/swap reason
                        const reason = getAssignmentReason(key, parseInt(group || 0), name);
                        let indicatorIcon = '';
                        let indicatorTitle = '';
                        let isSwapped = false;
                        if (reason) {
                            if (reason.type === 'skip') {
                                indicatorIcon = '<i class="fas fa-arrow-right text-warning" title="Παραλείφθηκε"></i> ';
                                indicatorTitle = reason.reason;
                            } else if (reason.type === 'swap') {
                                indicatorIcon = '<i class="fas fa-exchange-alt text-info" title="Αλλαγή" style="font-size: 0.9em;"></i> ';
                                indicatorTitle = reason.reason;
                                isSwapped = true;
                            }
                        }
                        
                        // Check if person has conflict on this date
                        let conflictIcon = '';
                        let conflictTitle = '';
                        const hasConflict = hasConsecutiveDuty(key, name, parseInt(group || 0));
                        if (hasConflict) {
                            // Make conflict icon highly visible - larger, with background color and border
                            conflictIcon = '<i class="fas fa-exclamation-triangle" style="color: #dc3545; font-size: 1.2em; background-color: #fff3cd; padding: 3px 5px; border-radius: 4px; border: 2px solid #dc3545; display: inline-block; min-width: 20px; text-align: center;" title="Σύγκρουση"></i> ';
                            const date = new Date(key + 'T00:00:00');
                            const dayBefore = new Date(date);
                            dayBefore.setDate(dayBefore.getDate() - 1);
                            const dayAfter = new Date(date);
                            dayAfter.setDate(dayAfter.getDate() + 1);
                            const dayBeforeKey = formatDateKey(dayBefore);
                            const dayAfterKey = formatDateKey(dayAfter);
                            
                            let conflictDetails = [];
                            if (hasDutyOnDay(dayBeforeKey, name, parseInt(group || 0))) {
                                const beforeDateStr = dayBefore.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                conflictDetails.push(`Συνεχόμενη ημέρα: ${beforeDateStr}`);
                            }
                            if (hasDutyOnDay(dayAfterKey, name, parseInt(group || 0))) {
                                const afterDateStr = dayAfter.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                conflictDetails.push(`Συνεχόμενη ημέρα: ${afterDateStr}`);
                            }
                            if (conflictDetails.length > 0) {
                                const currentDateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                conflictTitle = `Σύγκρουση - Ημερομηνία επηρεασμένη: ${currentDateStr}, ${conflictDetails.join(', ')}`;
                            } else {
                                conflictTitle = 'Σύγκρουση';
                            }
                        }
                        
                        // Apply styling: critical assignments get red, swapped assignments get round border with color coding
                        let styleClass = 'duty-person';
                        let swapPairStyle = '';
                        if (isCritical) {
                            styleClass = 'duty-person-critical';
                        } else if (isSwapped) {
                            styleClass = 'duty-person-swapped';
                            // Get swap pair ID and apply color
                            if (reason && reason.swapPairId !== null && reason.swapPairId !== undefined) {
                                // Ensure swapPairId is a number (Firestore might return it as string)
                                const swapPairId = typeof reason.swapPairId === 'number' ? reason.swapPairId : parseInt(reason.swapPairId);
                                if (!isNaN(swapPairId)) {
                                    // Generate colors for swap pairs (same as in runNormalSwapLogic)
                                    const swapColors = [
                                        { border: '#FF1744', bg: 'rgba(255, 23, 68, 0.15)' }, // Bright Red
                                        { border: '#00E676', bg: 'rgba(0, 230, 118, 0.15)' }, // Bright Green
                                        { border: '#FFD600', bg: 'rgba(255, 214, 0, 0.15)' }, // Bright Yellow
                                        { border: '#00B0FF', bg: 'rgba(0, 176, 255, 0.15)' }, // Bright Blue
                                        { border: '#D500F9', bg: 'rgba(213, 0, 249, 0.15)' }, // Bright Purple
                                        { border: '#FF6D00', bg: 'rgba(255, 109, 0, 0.15)' }, // Bright Orange
                                        { border: '#00E5FF', bg: 'rgba(0, 229, 255, 0.15)' }, // Bright Cyan
                                        { border: '#FF4081', bg: 'rgba(255, 64, 129, 0.15)' }  // Bright Pink
                                    ];
                                    const swapColor = swapColors[swapPairId % swapColors.length];
                                    swapPairStyle = `border: 2px solid ${swapColor.border}; background-color: ${swapColor.bg};`;
                                }
                            }
                        }
                        
                        // Display name with indicator icon and conflict icon
                        const combinedTitle = indicatorTitle || conflictTitle || '';
                        // For swapped people, the icon and name are already in the round border, so don't add extra flex styling
                        if (isSwapped) {
                            displayAssignmentHtml += `<div class="${styleClass}" style="${swapPairStyle}" title="${combinedTitle}">${indicatorIcon}${name}</div>`;
                        } else {
                        displayAssignmentHtml += `<div class="${styleClass}" style="display: flex; align-items: center; gap: 4px;" title="${combinedTitle}">${indicatorIcon}${name}${conflictIcon}</div>`;
                        }
                    });
                    
                    // Also check for people who were swapped out (have swap reason but not in current assignment)
                    // This ensures both people involved in a swap are marked
                    if (assignmentReasons[key]) {
                        for (const groupNumStr in assignmentReasons[key]) {
                            const groupNumForReason = parseInt(groupNumStr);
                            if (isNaN(groupNumForReason)) continue;
                            
                            for (const personName in assignmentReasons[key][groupNumForReason]) {
                                const reason = assignmentReasons[key][groupNumForReason][personName];
                                
                                // Only show swap reasons for people not already displayed
                                if (reason && reason.type === 'swap') {
                                    // Check if this person is already in the displayed assignment
                                    const alreadyDisplayed = personGroups.some(({ name, group }) => 
                                        name === personName && parseInt(group || 0) === groupNumForReason
                                    );
                                    
                                    if (!alreadyDisplayed) {
                                        // This person was swapped out but is not in current assignment - show them with swap indicator
                                        const indicatorIcon = '<i class="fas fa-exchange-alt text-info" title="Αλλαγή" style="font-size: 0.9em;"></i> ';
                                        const styleClass = 'duty-person-swapped';
                                        const title = reason.reason || 'Αλλαγή';
                                        
                                        // Apply color based on swap pair ID
                                        let swapPairStyle = '';
                                        if (reason.swapPairId !== null && reason.swapPairId !== undefined) {
                                            // Ensure swapPairId is a number (Firestore might return it as string)
                                            const swapPairId = typeof reason.swapPairId === 'number' ? reason.swapPairId : parseInt(reason.swapPairId);
                                            if (!isNaN(swapPairId)) {
                                                const swapColors = [
                                                    { border: '#FF1744', bg: 'rgba(255, 23, 68, 0.15)' }, // Bright Red
                                                    { border: '#00E676', bg: 'rgba(0, 230, 118, 0.15)' }, // Bright Green
                                                    { border: '#FFD600', bg: 'rgba(255, 214, 0, 0.15)' }, // Bright Yellow
                                                    { border: '#00B0FF', bg: 'rgba(0, 176, 255, 0.15)' }, // Bright Blue
                                                    { border: '#D500F9', bg: 'rgba(213, 0, 249, 0.15)' }, // Bright Purple
                                                    { border: '#FF6D00', bg: 'rgba(255, 109, 0, 0.15)' }, // Bright Orange
                                                    { border: '#00E5FF', bg: 'rgba(0, 229, 255, 0.15)' }, // Bright Cyan
                                                    { border: '#FF4081', bg: 'rgba(255, 64, 129, 0.15)' }  // Bright Pink
                                                ];
                                                const swapColor = swapColors[swapPairId % swapColors.length];
                                                swapPairStyle = `border: 2px solid ${swapColor.border}; background-color: ${swapColor.bg};`;
                                            }
                                        }
                                        
                                        displayAssignmentHtml += `<div class="${styleClass}" style="${swapPairStyle}" title="${title}">${indicatorIcon}${personName}</div>`;
                                    }
                                }
                            }
                        }
                    }
                    
                    displayAssignmentHtml += '</div>';
                }
                
                dayDiv.innerHTML = `
                    <div class="day-number">${day}</div>
                    ${holidayName ? `<div class="orthodox-holiday-name">${holidayName}</div>` : ''}
                    ${displayAssignmentHtml}
                `;
                
                // Add click handler AFTER setting innerHTML to ensure it's not removed
                dayDiv.style.cursor = 'pointer';
                dayDiv.setAttribute('data-date', key); // Store date key for debugging
                dayDiv.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    try {
                        showDayDetails(date);
                    } catch (error) {
                        console.error('Error showing day details:', error);
                        alert('Σφάλμα κατά το άνοιγμα των λεπτομερειών ημέρας: ' + error.message);
                    }
                });
                
                grid.appendChild(dayDiv);
            }
        }

        // Get day type label
        function getDayTypeLabel(dayType) {
            switch(dayType) {
                case 'special-holiday': return 'Ειδική';
                case 'normal-day': return 'Καθημερινή';
                case 'semi-normal-day': return 'Ημιαργία';
                case 'weekend-holiday': return 'Σαββατοκύριακο/Αργία';
                default: return '';
            }
        }
        
        // Helper function to check if two dates are in the same week
        // Week starts on Monday (ISO 8601 standard)
        // Helper function to check if a date is in the week after next (not next week, but the one after)
        function isWeekAfterNext(date1, date2) {
            const week1Start = getWeekStart(date1);
            const week2Start = getWeekStart(date2);
            
            // Calculate difference in weeks
            const diffInMs = week2Start - week1Start;
            const diffInWeeks = Math.floor(diffInMs / (7 * 24 * 60 * 60 * 1000));
            
            // Week after next means exactly 2 weeks later
            return diffInWeeks === 2;
        }
        
        // Helper function to ask user permission for conflicts, swaps, or skips
        function askPermissionForConflict(type, personName, dateStr, reason, swapPerson = null, swapDateStr = null) {
            let message = '';
            
            if (type === 'skip') {
                message = `Το άτομο ${personName} έχει σύγκρουση στις ${dateStr}.\n\nΛόγος: ${reason}\n\nΝα παραλειφθεί αυτό το άτομο;`;
            } else if (type === 'swap') {
                if (swapPerson && swapDateStr) {
                    message = `Το άτομο ${personName} έχει σύγκρουση στις ${dateStr}.\n\nΛόγος: ${reason}\n\nΒρέθηκε άτομο ${swapPerson} για αλλαγή στις ${swapDateStr}.\n\nΝα προχωρήσει η αλλαγή;`;
                } else {
                    message = `Το άτομο ${personName} έχει σύγκρουση στις ${dateStr}.\n\nΛόγος: ${reason}\n\nΝα προχωρήσει η αλλαγή;`;
                }
            } else if (type === 'conflict') {
                message = `Το άτομο ${personName} έχει σύγκρουση στις ${dateStr}.\n\nΛόγος: ${reason}\n\nΝα προχωρήσει η ανάθεση παρά τη σύγκρουση;`;
            }
            
            return confirm(message);
        }
        
        // Check if two dates are in the same month
        function isSameMonth(date1, date2) {
            const d1 = new Date(date1);
            const d2 = new Date(date2);
            return d1.getFullYear() === d2.getFullYear() && d1.getMonth() === d2.getMonth();
        }
        
        function isSameWeek(date1, date2) {
            const d1 = new Date(date1);
            const d2 = new Date(date2);
            
            // Get Monday of the week for each date
            const monday1 = new Date(d1);
            const dayOfWeek1 = d1.getDay();
            const diff1 = dayOfWeek1 === 0 ? -6 : 1 - dayOfWeek1; // If Sunday, go back 6 days, else go to Monday
            monday1.setDate(d1.getDate() + diff1);
            monday1.setHours(0, 0, 0, 0);
            
            const monday2 = new Date(d2);
            const dayOfWeek2 = d2.getDay();
            const diff2 = dayOfWeek2 === 0 ? -6 : 1 - dayOfWeek2;
            monday2.setDate(d2.getDate() + diff2);
            monday2.setHours(0, 0, 0, 0);
            
            return monday1.getTime() === monday2.getTime();
        }
        
        // Helper function to get week start (Monday) for a date
        function getWeekStart(date) {
            const d = new Date(date);
            const dayOfWeek = d.getDay();
            const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
            d.setDate(d.getDate() + diff);
            d.setHours(0, 0, 0, 0);
            return d;
        }
        
        // Helper function to calculate rotation position based on days since start date
        // Uses calculationSteps.startDate if available, otherwise defaults to February 2026
        // Returns the rotation position (0-based index) for a given date and day type
        function getRotationPosition(date, dayTypeCategory, groupNum) {
            // Use the actual start date from calculationSteps if available, otherwise default to February 2026
            let initialMonth;
            if (calculationSteps && calculationSteps.startDate) {
                initialMonth = new Date(calculationSteps.startDate);
                initialMonth.setHours(0, 0, 0, 0);
            } else {
                initialMonth = new Date(2026, 1, 1); // February 2026 (month 1 = February, 0-indexed)
            }
            
            const targetDate = new Date(date);
            targetDate.setHours(0, 0, 0, 0);
            
            // Count how many days of this type have occurred since the start date
            // Start counting from 0 so the first day maps to index 0 (first person)
            let count = 0;
            const currentDate = new Date(initialMonth);
            
            while (currentDate <= targetDate) {
                const dayType = getDayType(currentDate);
                let typeCategory = 'normal';
                
                if (dayType === 'special-holiday') {
                    typeCategory = 'special';
                } else if (dayType === 'semi-normal-day') {
                    typeCategory = 'semi';
                } else if (dayType === 'weekend-holiday') {
                    typeCategory = 'weekend';
                }
                
                if (typeCategory === dayTypeCategory) {
                    // Only increment count after we've found a matching day type
                    // This ensures the first day of this type gets count = 0 (maps to first person)
                    count++;
                }
                
                // Move to next day
                currentDate.setDate(currentDate.getDate() + 1);
            }
            
            // Subtract 1 from count so the first day maps to 0 (first person), not 1 (second person)
            // If count is 0 (no matching days found), return 0
            return Math.max(0, count - 1);
        }
        
        // Helper function to store assignment reason
        function storeAssignmentReason(dateKey, groupNum, personName, type, reason, swappedWith = null, swapPairId = null) {
            if (!assignmentReasons[dateKey]) {
                assignmentReasons[dateKey] = {};
            }
            if (!assignmentReasons[dateKey][groupNum]) {
                assignmentReasons[dateKey][groupNum] = {};
            }
            assignmentReasons[dateKey][groupNum][personName] = {
                type: type, // 'skip' or 'swap'
                reason: reason,
                swappedWith: swappedWith,
                swapPairId: swapPairId // For color coding swap pairs
            };
        }
        
        // Helper function to get assignment reason
        function getAssignmentReason(dateKey, groupNum, personName) {
            return assignmentReasons[dateKey]?.[groupNum]?.[personName] || null;
        }

        // Previous month
        function previousMonth() {
            currentDate.setMonth(currentDate.getMonth() - 1);
            renderCalendar();
        }

        // Next month
        function nextMonth() {
            currentDate.setMonth(currentDate.getMonth() + 1);
            renderCalendar();
        }

        // Check if a person has duty on a specific day
        function hasDutyOnDay(dayKey, person, groupNum) {
            // Determine which document to check based on day type
            const date = new Date(dayKey + 'T00:00:00');
            if (isNaN(date.getTime())) return false;
            
            const dayType = getDayType(date);
            let assignment = null;
            
            if (dayType === 'special-holiday') {
                assignment = specialHolidayAssignments[dayKey];
            } else if (dayType === 'weekend-holiday') {
                assignment = weekendAssignments[dayKey];
            } else if (dayType === 'semi-normal-day') {
                assignment = semiNormalAssignments[dayKey];
            } else if (dayType === 'normal-day') {
                assignment = normalDayAssignments[dayKey];
            }
            
            // Also check legacy dutyAssignments for backward compatibility
            if (!assignment) {
                assignment = dutyAssignments[dayKey];
            }
            
            if (!assignment) return false;
            
            // Ensure assignment is a string
            const assignmentStr = typeof assignment === 'string' ? assignment : String(assignment);
            const personGroupStr = `${person} (Ομάδα ${groupNum})`;
            return assignmentStr.includes(personGroupStr);
        }

        // Check if a person has duty on consecutive days (day before or day after)
        // Enhanced version that can check against simulated assignments (for preview)
        // Enhanced conflict rules (all combinations checked):
        // - Normal ↔ Semi-normal (before and after)
        // - Normal ↔ Weekend (before and after)
        // - Normal ↔ Special (before and after)
        // - Semi-normal ↔ Weekend (before and after)
        // - Semi-normal ↔ Special (before and after)
        function hasConsecutiveDuty(dayKey, person, groupNum, simulatedAssignments = null) {
            const date = new Date(dayKey + 'T00:00:00');
            const currentDayType = getDayType(date);
            
            // Get day type category for current day
            let currentTypeCategory = 'normal';
            if (currentDayType === 'special-holiday') {
                currentTypeCategory = 'special';
            } else if (currentDayType === 'semi-normal-day') {
                currentTypeCategory = 'semi';
            } else if (currentDayType === 'weekend-holiday') {
                currentTypeCategory = 'weekend';
            }
            
            // Helper function to check if two day types conflict
            const hasConflict = (type1, type2) => {
                // Normal conflicts with: semi, weekend, special
                if (type1 === 'normal' && (type2 === 'semi' || type2 === 'weekend' || type2 === 'special')) return true;
                if ((type1 === 'semi' || type1 === 'weekend' || type1 === 'special') && type2 === 'normal') return true;
                
                // Semi conflicts with: weekend, special
                if (type1 === 'semi' && (type2 === 'weekend' || type2 === 'special')) return true;
                if ((type1 === 'weekend' || type1 === 'special') && type2 === 'semi') return true;
                
                return false;
            };
            
            // Check day before
            const dayBefore = new Date(date);
            dayBefore.setDate(dayBefore.getDate() - 1);
            const dayBeforeKey = formatDateKey(dayBefore);
            
            // Check if person has duty on day before (check simulated assignments if provided)
            let hasDutyBefore = false;
            if (simulatedAssignments) {
                // Check simulated assignments first
                const beforeMonthKey = `${dayBefore.getFullYear()}-${dayBefore.getMonth()}`;
                const beforeDayType = getDayType(dayBefore);
                let beforeTypeCategory = 'normal';
                if (beforeDayType === 'special-holiday') {
                    beforeTypeCategory = 'special';
                    hasDutyBefore = simulatedAssignments.special?.[beforeMonthKey]?.[groupNum]?.has(person) || false;
                } else if (beforeDayType === 'semi-normal-day') {
                    beforeTypeCategory = 'semi';
                    hasDutyBefore = simulatedAssignments.semi?.[dayBeforeKey]?.[groupNum] === person;
                } else if (beforeDayType === 'weekend-holiday') {
                    beforeTypeCategory = 'weekend';
                    hasDutyBefore = simulatedAssignments.weekend?.[dayBeforeKey]?.[groupNum] === person;
                } else {
                    beforeTypeCategory = 'normal';
                    hasDutyBefore = simulatedAssignments.normal?.[dayBeforeKey]?.[groupNum] === person;
                }
            } else {
                // Check permanent assignments
                hasDutyBefore = hasDutyOnDay(dayBeforeKey, person, groupNum);
            }
            
            if (hasDutyBefore) {
                const beforeDayType = getDayType(dayBefore);
                let beforeTypeCategory = 'normal';
                if (beforeDayType === 'special-holiday') {
                    beforeTypeCategory = 'special';
                } else if (beforeDayType === 'semi-normal-day') {
                    beforeTypeCategory = 'semi';
                } else if (beforeDayType === 'weekend-holiday') {
                    beforeTypeCategory = 'weekend';
                }
                
                // Check all conflict combinations
                if (hasConflict(currentTypeCategory, beforeTypeCategory)) {
                    return true;
                }
            }
            
            // IMPORTANT: Also check day after if it's already been assigned OR if it will be assigned based on rotation
            // This handles cases where higher priority day types (semi, weekend, special) are assigned before lower priority (normal)
            // For example: Friday (semi-normal, Priority 3) is assigned before Thursday (normal, Priority 4)
            // When processing Thursday, we need to check if person already has duty on Friday
            // ALSO: In preview mode, check if person will be assigned to day after based on rotation (even if not assigned yet)
            const dayAfter = new Date(date);
            dayAfter.setDate(dayAfter.getDate() + 1);
            const dayAfterKey = formatDateKey(dayAfter);
            
            // Check if person has duty on day after (check simulated assignments if provided)
            let hasDutyAfter = false;
            if (simulatedAssignments) {
                // Check simulated assignments first
                const afterMonthKey = `${dayAfter.getFullYear()}-${dayAfter.getMonth()}`;
                const afterDayType = getDayType(dayAfter);
                let afterTypeCategory = 'normal';
                if (afterDayType === 'special-holiday') {
                    afterTypeCategory = 'special';
                    hasDutyAfter = simulatedAssignments.special?.[afterMonthKey]?.[groupNum]?.has(person) || false;
                } else if (afterDayType === 'semi-normal-day') {
                    afterTypeCategory = 'semi';
                    hasDutyAfter = simulatedAssignments.semi?.[dayAfterKey]?.[groupNum] === person;
                } else if (afterDayType === 'weekend-holiday') {
                    afterTypeCategory = 'weekend';
                    hasDutyAfter = simulatedAssignments.weekend?.[dayAfterKey]?.[groupNum] === person;
                } else {
                    afterTypeCategory = 'normal';
                    // Check if already assigned in simulated assignments
                    hasDutyAfter = simulatedAssignments.normal?.[dayAfterKey]?.[groupNum] === person;
                    
                    // If not assigned yet, check if person will be assigned based on rotation
                    // This is important for preview mode when processing days in chronological order
                    if (!hasDutyAfter && afterDayType === 'normal-day') {
                        // Check if day after is in the calculation range
                        const calculationStartDate = calculationSteps?.startDate;
                        const calculationEndDate = calculationSteps?.endDate;
                        if (calculationStartDate && calculationEndDate && dayAfter >= calculationStartDate && dayAfter <= calculationEndDate) {
                            // Get group data to check rotation
                            const groupData = groups[groupNum] || { normal: [] };
                            const groupPeople = groupData.normal || [];
                            if (groupPeople.length > 0) {
                                const rotationDays = groupPeople.length;
                                
                                // Check if we have the current rotation position from the preview
                                // This is passed via simulatedAssignments.normalRotationPositions
                                let rotationPosition;
                                if (simulatedAssignments?.normalRotationPositions?.[groupNum] !== undefined) {
                                    // Use the current rotation position from preview (continues from previous day)
                                    rotationPosition = simulatedAssignments.normalRotationPositions[groupNum] % rotationDays;
                                } else {
                                    // Fallback: calculate rotation position for day after
                                    rotationPosition = getRotationPosition(dayAfter, 'normal', groupNum) % rotationDays;
                                }
                                
                                const expectedPerson = groupPeople[rotationPosition];
                                
                                // If this person is expected to be assigned to day after, it's a conflict
                                if (expectedPerson === person && !isPersonMissingOnDate(person, groupNum, dayAfter)) {
                                    hasDutyAfter = true;
                                }
                            }
                        }
                    }
                }
            } else {
                // Check permanent assignments
                const dayAfterAssigned = dutyAssignments[dayAfterKey] || 
                                         normalDayAssignments[dayAfterKey] ||
                                         semiNormalAssignments[dayAfterKey] ||
                                         weekendAssignments[dayAfterKey] ||
                                         specialHolidayAssignments[dayAfterKey];
                hasDutyAfter = dayAfterAssigned && hasDutyOnDay(dayAfterKey, person, groupNum);
            }
            
            // Check day after if it's already assigned OR will be assigned based on rotation
            if (hasDutyAfter) {
                const afterDayType = getDayType(dayAfter);
                let afterTypeCategory = 'normal';
                if (afterDayType === 'special-holiday') {
                    afterTypeCategory = 'special';
                } else if (afterDayType === 'semi-normal-day') {
                    afterTypeCategory = 'semi';
                } else if (afterDayType === 'weekend-holiday') {
                    afterTypeCategory = 'weekend';
                }
                
                // Check all conflict combinations
                if (hasConflict(currentTypeCategory, afterTypeCategory)) {
                    return true;
                }
            }
            
            return false;
        }


        // Check if person should be skipped from weekend/holiday duty due to special holiday duty
        // Logic:
        // 1. Find last weekend/holiday duty for the person
        // 2. Calculate what the next weekend/holiday duty should be (based on N-day rotation)
        // 3. Check if there's a special holiday duty between last weekend duty and the calculated next weekend duty
        // 4. If yes, skip the calculated next weekend duty
        // 5. Count N weekends from the day AFTER the skipped weekend
        // 6. If current day is the skipped weekend, return true to skip it
        function hadSpecialHolidayDutyBefore(dayKey, person, groupNum) {
            const date = new Date(dayKey + 'T00:00:00');
            const dayOfWeek = date.getDay(); // 0=Sunday, 6=Saturday
            const currentDayType = getDayType(date);
            
            // Only apply this rule if current day is:
            // - A weekend (Saturday or Sunday)
            // - OR a holiday (weekend-holiday type, but not special holiday)
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6; // Sunday or Saturday
            const isHoliday = currentDayType === 'weekend-holiday' && !isSpecialHoliday(date);
            
            if (!isWeekend && !isHoliday) {
                return false;
            }
            
            // Get group data to find rotation days
            const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [] };
            const groupPeople = groupData.weekend || [];
            if (groupPeople.length === 0) return false;
            
            const rotationDays = groupPeople.length;
            
            // Find last weekend/holiday duty for this person
            let lastWeekendDutyKey = null;
            let lastWeekendDutyDate = null;
            
            // Check manually entered last duties first
            const lastDuties = groupData.lastDuties?.[person];
            if (lastDuties && lastDuties.weekend) {
                lastWeekendDutyDate = new Date(lastDuties.weekend + 'T00:00:00');
                lastWeekendDutyKey = formatDateKey(lastWeekendDutyDate);
            }
            
            // Also check actual assignments (use the more recent one)
            const checkDate = new Date(date);
            for (let i = 1; i <= 365; i++) { // Look back up to 1 year
                checkDate.setDate(checkDate.getDate() - 1);
                const checkKey = formatDateKey(checkDate);
                const checkDayType = getDayType(checkDate);
                const isCheckWeekend = checkDate.getDay() === 0 || checkDate.getDay() === 6;
                const isCheckHoliday = checkDayType === 'weekend-holiday' && !isSpecialHoliday(checkDate);
                
                if ((isCheckWeekend || isCheckHoliday) && hasDutyOnDay(checkKey, person, groupNum)) {
                    const checkDateCopy = new Date(checkDate);
                    if (!lastWeekendDutyDate || checkDateCopy > lastWeekendDutyDate) {
                        lastWeekendDutyDate = checkDateCopy;
                        lastWeekendDutyKey = checkKey;
                    }
                    break; // Found the most recent one
                }
            }
            
            if (!lastWeekendDutyKey || !lastWeekendDutyDate) {
                return false; // No previous weekend duty found
            }
            
            // Calculate what the next weekend/holiday duty should be (N weekends after last duty)
            let nextWeekendDutyDate = new Date(lastWeekendDutyDate);
            nextWeekendDutyDate.setDate(nextWeekendDutyDate.getDate() + 1); // Start from day after last duty
            let weekendsCounted = 0;
            let daysChecked = 0;
            const maxDaysToCheck = 365; // Don't check more than 1 year ahead
            
            while (weekendsCounted < rotationDays && daysChecked < maxDaysToCheck) {
                const checkDayType = getDayType(nextWeekendDutyDate);
                const isCheckWeekend = nextWeekendDutyDate.getDay() === 0 || nextWeekendDutyDate.getDay() === 6;
                const isCheckHoliday = checkDayType === 'weekend-holiday' && !isSpecialHoliday(nextWeekendDutyDate);
                
                if (isCheckWeekend || isCheckHoliday) {
                    weekendsCounted++;
                }
                
                if (weekendsCounted < rotationDays) {
                    nextWeekendDutyDate.setDate(nextWeekendDutyDate.getDate() + 1);
                    daysChecked++;
                }
            }
            
            if (weekendsCounted < rotationDays) {
                return false; // Couldn't find enough weekends
            }
            
            const nextWeekendDutyKey = formatDateKey(nextWeekendDutyDate);
            
            // Check if current day is the calculated next weekend duty
            if (dayKey !== nextWeekendDutyKey) {
                // Current day is not the calculated next weekend duty
                return false;
            }
            
            // Current day IS the calculated next weekend duty
            // Check if there's a special holiday duty between last weekend duty and this day
            let specialHolidayBetween = null;
            const checkSpecialDate = new Date(lastWeekendDutyDate);
            checkSpecialDate.setDate(checkSpecialDate.getDate() + 1);
            while (checkSpecialDate < date) {
                if (isSpecialHoliday(checkSpecialDate) && hasDutyOnDay(formatDateKey(checkSpecialDate), person, groupNum)) {
                    specialHolidayBetween = new Date(checkSpecialDate);
                    break;
                }
                checkSpecialDate.setDate(checkSpecialDate.getDate() + 1);
            }
            
            if (!specialHolidayBetween) {
                return false; // No special holiday between last and next weekend duty
            }
            
            // There is a special holiday between last weekend duty and this day
            // Skip this day (the calculated next weekend duty)
            return true;
        }

        // Check if person had duty on consecutive weekend/holiday days
        // If so, skip them from the next weekend/holiday
        // DISABLED: This logic was causing incorrect swaps on 01/02/26, 08/02/26, and 26/02/2026
        // TODO: Re-implement with corrected logic if needed
        function hasConsecutiveWeekendHolidayDuty(dayKey, person, groupNum) {
            // Temporarily disabled to prevent incorrect swaps
            return false;
        }

        // Check if person had duty on consecutive special holidays
        // If so, skip them from the next special holiday
        function hasConsecutiveSpecialHolidayDuty(dayKey, person, groupNum) {
            const date = new Date(dayKey + 'T00:00:00');
            
            // Only apply this rule if current day is a special holiday
            if (!isSpecialHoliday(date)) {
                return false;
            }
            
            // Check if person had duty on any previous special holiday
            // Look back up to 30 days to catch all special holidays
            for (let i = 1; i <= 30; i++) {
                const checkDate = new Date(date);
                checkDate.setDate(checkDate.getDate() - i);
                const checkKey = formatDateKey(checkDate);
                
                // If we find a special holiday where person had duty, it's consecutive
                // This prevents assigning the same person to multiple special holidays in a row
                if (isSpecialHoliday(checkDate) && hasDutyOnDay(checkKey, person, groupNum)) {
                    return true;
                }
            }
            
            return false;
        }

        // Check if person has special holiday duty in a given month
        function hasSpecialHolidayDutyInMonth(person, groupNum, month, year) {
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            const checkDate = new Date(firstDay);
            
            while (checkDate <= lastDay) {
                if (isSpecialHoliday(checkDate) && hasDutyOnDay(formatDateKey(checkDate), person, groupNum)) {
                    return true;
                }
                checkDate.setDate(checkDate.getDate() + 1);
            }
            return false;
        }

        // Helper function to get a person from next month's rotation when conflicts occur at end of month
        // This temporarily calculates the next month to find the correct person according to rotation logic
        // For normal days, follows swap logic: Monday↔Wednesday, Tuesday↔Thursday
        function getPersonFromNextMonth(dayKey, dayTypeCategory, groupNum, currentMonth, currentYear, rotationDays, groupPeople, currentRotationPosition = null) {
            const date = new Date(dayKey + 'T00:00:00');
            
            // For semi-normal days and normal days, allow cross-month swaps throughout the entire month
            // For other day types (weekend, special), only check in last 3 days
            if (dayTypeCategory !== 'semi' && dayTypeCategory !== 'normal') {
            const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
            const daysUntilEndOfMonth = lastDayOfMonth.getDate() - date.getDate();
            
            // Only use next month logic if we're in the last 3 days of the month
            if (daysUntilEndOfMonth > 3) {
                return null;
                }
            }
            
            // Calculate next month
            const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
            const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;
            
            // Get first and last day of next month
            const firstDayOfNextMonth = new Date(nextYear, nextMonth, 1);
            const lastDayOfNextMonth = new Date(nextYear, nextMonth + 1, 0);
            
            // For normal days, follow swap logic: Monday↔Wednesday, Tuesday↔Thursday
            if (dayTypeCategory === 'normal') {
                const currentDayOfWeek = date.getDay(); // 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday
                
                // Determine swap day pairs: Monday↔Wednesday (1↔3), Tuesday↔Thursday (2↔4)
                // Logic: Tuesday tries next Tuesday first, then nearest Thursday
                //        Thursday tries next Thursday first, then nearest Tuesday
                let targetDayOfWeek = null;
                let alternativeDayOfWeek = null;
                let tryTargetFirst = false; // Flag to indicate if we should try target day first
                
                if (currentDayOfWeek === 1) { // Monday
                    targetDayOfWeek = 1; // Next Monday
                    alternativeDayOfWeek = 3; // Wednesday (preferred for swap)
                } else if (currentDayOfWeek === 2) { // Tuesday
                    targetDayOfWeek = 2; // Next Tuesday (try FIRST)
                    alternativeDayOfWeek = 4; // Thursday (then nearest)
                    tryTargetFirst = true;
                } else if (currentDayOfWeek === 3) { // Wednesday
                    targetDayOfWeek = 3; // Next Wednesday
                    alternativeDayOfWeek = 1; // Monday (preferred for swap)
                } else if (currentDayOfWeek === 4) { // Thursday
                    targetDayOfWeek = 4; // Next Thursday (try FIRST)
                    alternativeDayOfWeek = 2; // Tuesday (then nearest)
                    tryTargetFirst = true;
                }
                
                // Try to find swap day in next month following the swap logic
                let swapDayInNextMonth = null;
                
                if (tryTargetFirst && targetDayOfWeek !== null) {
                    // For Tuesday/Thursday: PRIORITY 1 - Try same day of week first (next Tuesday/Thursday)
                    const checkDate = new Date(firstDayOfNextMonth);
                    while (checkDate <= lastDayOfNextMonth) {
                        const checkDayType = getDayType(checkDate);
                        if (checkDayType === 'normal-day' && checkDate.getDay() === targetDayOfWeek) {
                            swapDayInNextMonth = new Date(checkDate);
                            break;
                        }
                        checkDate.setDate(checkDate.getDate() + 1);
                    }
                    
                    // PRIORITY 2: If same day not found, try alternative (nearest Thursday/Tuesday)
                    if (!swapDayInNextMonth && alternativeDayOfWeek !== null) {
                        const checkDate = new Date(firstDayOfNextMonth);
                        while (checkDate <= lastDayOfNextMonth) {
                            const checkDayType = getDayType(checkDate);
                            if (checkDayType === 'normal-day' && checkDate.getDay() === alternativeDayOfWeek) {
                                swapDayInNextMonth = new Date(checkDate);
                                break;
                            }
                            checkDate.setDate(checkDate.getDate() + 1);
                        }
                    }
                } else if (alternativeDayOfWeek !== null) {
                    // For Monday/Wednesday: PRIORITY 1 - Try alternative day of week first (e.g., Wednesday for Monday)
                    const checkDate = new Date(firstDayOfNextMonth);
                    while (checkDate <= lastDayOfNextMonth) {
                        const checkDayType = getDayType(checkDate);
                        if (checkDayType === 'normal-day' && checkDate.getDay() === alternativeDayOfWeek) {
                            swapDayInNextMonth = new Date(checkDate);
                            break;
                        }
                        checkDate.setDate(checkDate.getDate() + 1);
                    }
                    
                    // PRIORITY 2: If alternative not found, try same day of week (e.g., next Monday for Monday)
                    if (!swapDayInNextMonth && targetDayOfWeek !== null) {
                        const checkDate = new Date(firstDayOfNextMonth);
                        while (checkDate <= lastDayOfNextMonth) {
                            const checkDayType = getDayType(checkDate);
                            if (checkDayType === 'normal-day' && checkDate.getDay() === targetDayOfWeek) {
                                swapDayInNextMonth = new Date(checkDate);
                                break;
                            }
                            checkDate.setDate(checkDate.getDate() + 1);
                        }
                    }
                }
                
                // If no swap day found in next month, fall back to first normal day
                if (!swapDayInNextMonth) {
                    const checkDate = new Date(firstDayOfNextMonth);
                    while (checkDate <= lastDayOfNextMonth) {
                        const checkDayType = getDayType(checkDate);
                        if (checkDayType === 'normal-day') {
                            swapDayInNextMonth = new Date(checkDate);
                            break;
                        }
                        checkDate.setDate(checkDate.getDate() + 1);
                    }
                }
                
                if (!swapDayInNextMonth) {
                    return null;
                }
                
                // Calculate rotation position for the swap day in next month
                // Rotation continues globally from current month
                let nextMonthRotationPosition;
                if (currentRotationPosition !== null && currentRotationPosition !== undefined) {
                    // Count how many normal days are between current day and swap day in next month
                    // This ensures we get the correct rotation position
                    const swapDayKey = formatDateKey(swapDayInNextMonth);
                    const swapRotationPosition = getRotationPosition(swapDayInNextMonth, 'normal', groupNum) % rotationDays;
                    nextMonthRotationPosition = swapRotationPosition;
                } else {
                    // Fallback: calculate from start date
                    nextMonthRotationPosition = getRotationPosition(swapDayInNextMonth, 'normal', groupNum) % rotationDays;
                }
                
                const nextMonthPerson = groupPeople[nextMonthRotationPosition];
                
                // Check if this person from next month has conflicts on the current day
                if (nextMonthPerson && !isPersonMissingOnDate(nextMonthPerson, groupNum, date)) {
                    const hasConflict = hasConsecutiveDuty(dayKey, nextMonthPerson, groupNum);
                    
                    if (!hasConflict) {
                        const swapDayKey = formatDateKey(swapDayInNextMonth);
                        const swapDayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][swapDayInNextMonth.getDay()];
                        console.log(`[END OF MONTH SWAP] Using person from next month: ${nextMonthPerson} for ${dayKey} (swap day: ${swapDayKey} - ${swapDayName}, rotation position: ${nextMonthRotationPosition})`);
                        // Return both person and swap day key so we can track where they should be assigned in next month
                        return { person: nextMonthPerson, swapDayKey: swapDayKey };
                    }
                }
                
                return null;
            }
            
            // For other day types (weekend, semi, special), use original logic
            // Find first day of this type in next month
            let firstDayOfTypeInNextMonth = null;
            const checkDate = new Date(firstDayOfNextMonth);
            
            while (checkDate <= lastDayOfNextMonth) {
                const checkDayType = getDayType(checkDate);
                let checkTypeCategory = 'normal';
                if (checkDayType === 'special-holiday') {
                    checkTypeCategory = 'special';
                } else if (checkDayType === 'semi-normal-day') {
                    checkTypeCategory = 'semi';
                } else if (checkDayType === 'weekend-holiday') {
                    checkTypeCategory = 'weekend';
                }
                
                if (checkTypeCategory === dayTypeCategory) {
                    firstDayOfTypeInNextMonth = new Date(checkDate);
                    break;
                }
                checkDate.setDate(checkDate.getDate() + 1);
            }
            
            if (!firstDayOfTypeInNextMonth) {
                return null;
            }
            
            // Calculate rotation position for first day of this type in next month
            // For weekends, rotation continues globally from current month
            // For special and semi, use direct rotation calculation
            let nextMonthRotationPosition;
            
            if (dayTypeCategory === 'weekend') {
                // Rotation continues globally - if we have current rotation position, advance it
                // Otherwise calculate from start date
                if (currentRotationPosition !== null && currentRotationPosition !== undefined) {
                    // Advance rotation position by 1 (for the current day we're processing)
                    // This gives us the position for the first day in next month
                    nextMonthRotationPosition = (currentRotationPosition + 1) % rotationDays;
                } else {
                    // Fallback: calculate from start date
                    nextMonthRotationPosition = getRotationPosition(firstDayOfTypeInNextMonth, dayTypeCategory, groupNum) % rotationDays;
                }
            } else {
                // For special and semi, use direct calculation
                nextMonthRotationPosition = getRotationPosition(firstDayOfTypeInNextMonth, dayTypeCategory, groupNum) % rotationDays;
            }
            
            const nextMonthPerson = groupPeople[nextMonthRotationPosition];
            
            // Check if this person from next month has conflicts on the current day
            if (nextMonthPerson && !isPersonMissingOnDate(nextMonthPerson, groupNum, date)) {
                const hasConflict = hasConsecutiveDuty(dayKey, nextMonthPerson, groupNum);
                
                // Also check if they have special holiday in current month (for weekends)
                let hasSpecialInCurrentMonth = false;
                if (dayTypeCategory === 'weekend') {
                    hasSpecialInCurrentMonth = hasSpecialHolidayDutyInMonth(nextMonthPerson, groupNum, currentMonth, currentYear);
                }
                
                if (!hasConflict && !hasSpecialInCurrentMonth) {
                    console.log(`[END OF MONTH] Using person from next month: ${nextMonthPerson} for ${dayKey} (rotation position: ${nextMonthRotationPosition}, end of month conflict resolution)`);
                    // Return both person and swap day key (first day of type in next month)
                    const firstDayKey = formatDateKey(firstDayOfTypeInNextMonth);
                    return { person: nextMonthPerson, swapDayKey: firstDayKey };
                }
            }
            
            return null;
        }

        // Count days of a specific type since last duty for a person
        // startDate is optional - if provided, will also check assignments before this date
        function countDaysSinceLastDuty(dayKey, person, groupNum, dayTypeCategory, allDaysByType, startDate = null) {
            const daysOfType = allDaysByType[dayTypeCategory];
            const currentIndex = daysOfType.indexOf(dayKey);
            
            if (currentIndex === -1) {
                return Infinity; // Current day not in this type
            }
            
            // Find last duty day for this person in this day type (before current day)
            let lastDutyIndex = -1;
            for (let i = currentIndex - 1; i >= 0; i--) {
                if (hasDutyOnDay(daysOfType[i], person, groupNum)) {
                    lastDutyIndex = i;
                    break;
                }
            }
            
            // Check intended assignments - these count for rotation even if person was skipped due to conflicts
            // This ensures N-day rotation counts from the intended day, not the actual assignment day
            // IMPORTANT: For weekends skipped due to special holiday, we need to count from the NEXT weekend after the skipped one
            let intendedDutyIndex = -1;
            
            for (let i = currentIndex - 1; i >= 0; i--) {
                const checkDayKey = daysOfType[i];
                // Check if this person had an intended assignment on this day
                if (intendedAssignments[checkDayKey] && 
                    intendedAssignments[checkDayKey][groupNum] === person) {
                    intendedDutyIndex = i;
                    
                    // If this is a weekend/holiday day that was skipped due to special holiday,
                    // we need to count from the NEXT weekend/holiday day after it (not from the skipped one)
                    if (dayTypeCategory === 'weekend' && i + 1 < daysOfType.length) {
                        // The next day in the daysOfType array is the next weekend/holiday day
                        // Count from the day AFTER that next weekend (start counting tomorrow)
                        const nextWeekendIndex = i + 1;
                        if (nextWeekendIndex < currentIndex) {
                            // Start counting from the day after the next weekend
                            return currentIndex - nextWeekendIndex - 1;
                        }
                    }
                    break;
                }
            }
            
            // Use intended assignment if it's more recent than actual assignment
            // This ensures rotation counts from when person SHOULD have been assigned, not when they actually were
            if (intendedDutyIndex !== -1 && (lastDutyIndex === -1 || intendedDutyIndex > lastDutyIndex)) {
                // Count from the day AFTER the intended assignment (start counting tomorrow)
                // If intended duty was at index i, we start counting from index i+1
                // So days passed = currentIndex - (intendedDutyIndex + 1) = currentIndex - intendedDutyIndex - 1
                return currentIndex - intendedDutyIndex - 1;
            }
            
            // Check lastDuties data first (manually entered last duties)
            const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [], lastDuties: {} };
            const lastDuties = groupData.lastDuties?.[person];
            if (lastDuties) {
                const lastDutyDateStr = lastDuties[dayTypeCategory];
                if (lastDutyDateStr) {
                    const lastDutyDate = new Date(lastDutyDateStr + 'T00:00:00');
                    const currentDate = new Date(dayKey + 'T00:00:00');
                    
                    // Count days of the same type between last duty and current day
                    let sameTypeDays = 0;
                    const tempDate = new Date(lastDutyDate);
                    tempDate.setDate(tempDate.getDate() + 1);
                    while (tempDate < currentDate) {
                        const tempDayType = getDayType(tempDate);
                        let tempTypeCategory = 'normal';
                        if (tempDayType === 'special-holiday') {
                            tempTypeCategory = 'special';
                        } else if (tempDayType === 'semi-normal-day') {
                            tempTypeCategory = 'semi';
                        } else if (tempDayType === 'weekend-holiday') {
                            tempTypeCategory = 'weekend';
                        }
                        if (tempTypeCategory === dayTypeCategory) {
                            sameTypeDays++;
                        }
                        tempDate.setDate(tempDate.getDate() + 1);
                    }
                    
                    // If we found a last duty date, use it (unless we found a more recent one in assignments)
                    if (lastDutyIndex === -1 || (lastDutyDate > new Date(daysOfType[lastDutyIndex] + 'T00:00:00'))) {
                        return sameTypeDays;
                    }
                }
            }
            
            // If startDate is provided, also check existing assignments before the start date
            if (startDate && lastDutyIndex === -1) {
                const currentDate = new Date(dayKey + 'T00:00:00');
                const checkDate = new Date(startDate);
                checkDate.setDate(checkDate.getDate() - 1); // Day before start date
                
                // Look backwards from start date to find last duty
                let daysBack = 0;
                const maxDaysBack = 365; // Check up to 1 year back
                
                while (daysBack < maxDaysBack && checkDate >= new Date(2000, 0, 1)) { // Don't go before year 2000
                    const checkKey = formatDateKey(checkDate);
                    const checkDayType = getDayType(checkDate);
                    let checkTypeCategory = 'normal';
                    
                    if (checkDayType === 'special-holiday') {
                        checkTypeCategory = 'special';
                    } else if (checkDayType === 'semi-normal-day') {
                        checkTypeCategory = 'semi';
                    } else if (checkDayType === 'weekend-holiday') {
                        checkTypeCategory = 'weekend';
                    }
                    
                    // Only count if it's the same day type category
                    if (checkTypeCategory === dayTypeCategory && hasDutyOnDay(checkKey, person, groupNum)) {
                        // Found a previous duty - calculate days between
                        const daysBetween = Math.floor((currentDate - checkDate) / (1000 * 60 * 60 * 24));
                        // Count only days of the same type between them
                        let sameTypeDays = 0;
                        const tempDate = new Date(checkDate);
                        tempDate.setDate(tempDate.getDate() + 1);
                        while (tempDate < currentDate) {
                            const tempDayType = getDayType(tempDate);
                            let tempTypeCategory = 'normal';
                            if (tempDayType === 'special-holiday') {
                                tempTypeCategory = 'special';
                            } else if (tempDayType === 'semi-normal-day') {
                                tempTypeCategory = 'semi';
                            } else if (tempDayType === 'weekend-holiday') {
                                tempTypeCategory = 'weekend';
                            }
                            if (tempTypeCategory === dayTypeCategory) {
                                sameTypeDays++;
                            }
                            tempDate.setDate(tempDate.getDate() + 1);
                        }
                        return sameTypeDays;
                    }
                    
                    checkDate.setDate(checkDate.getDate() - 1);
                    daysBack++;
                }
            }
            
            if (lastDutyIndex === -1) {
                return Infinity; // Never had duty of this type
            }
            
            // Count how many days of this type between last duty and current day
            // If last duty was at index i, we start counting from index i+1 (tomorrow)
            // So days passed = currentIndex - (lastDutyIndex + 1) = currentIndex - lastDutyIndex - 1
            return currentIndex - lastDutyIndex - 1;
        }

        // Open calculate duties modal
        function openCalculateDutiesModal() {
            // Set default to current month
            const currentYear = currentDate.getFullYear();
            const currentMonth = String(currentDate.getMonth() + 1).padStart(2, '0');
            const startMonthInput = document.getElementById('calculateStartMonth');
            const endMonthInput = document.getElementById('calculateEndMonth');
            const preserveCheckbox = document.getElementById('preserveExistingAssignments');
            
            if (startMonthInput) {
                startMonthInput.value = `${currentYear}-${currentMonth}`;
            }
            if (endMonthInput) {
                endMonthInput.value = '';
            }
            if (preserveCheckbox) {
                preserveCheckbox.checked = true;
            }
            
            // Add event listener to button as backup (remove old listeners first)
            const calculateButton = document.getElementById('calculateDutiesButton');
            if (calculateButton) {
                // Clone button to remove all event listeners
                const newButton = calculateButton.cloneNode(true);
                calculateButton.parentNode.replaceChild(newButton, calculateButton);
                
                // Add new event listener
                newButton.addEventListener('click', function(e) {
                    e.preventDefault();
                    calculateDutiesForSelectedMonths();
                });
            }
            
            const modal = new bootstrap.Modal(document.getElementById('calculateDutiesModal'));
            modal.show();
        }

        // Calculate duties for selected months
        function calculateDutiesForSelectedMonths() {
            try {
                const startMonthInput = document.getElementById('calculateStartMonth');
                const endMonthInput = document.getElementById('calculateEndMonth');
                const preserveCheckbox = document.getElementById('preserveExistingAssignments');
                
                if (!startMonthInput || !preserveCheckbox) {
                    alert('Σφάλμα: Δεν βρέθηκαν τα απαραίτητα στοιχεία της φόρμας');
                    console.error('Missing form elements:', { startMonthInput, endMonthInput, preserveCheckbox });
                    return;
                }
                
                const startMonth = startMonthInput.value;
                const endMonth = endMonthInput ? endMonthInput.value : '';
                const preserveExisting = preserveCheckbox.checked;
                
                if (!startMonth) {
                    alert('Παρακαλώ επιλέξτε τουλάχιστον τον μήνα έναρξης');
                    return;
                }
                
                // Parse start date
                const [startYear, startMonthNum] = startMonth.split('-').map(Number);
                const startDate = new Date(startYear, startMonthNum - 1, 1);
                
                // Parse end date (or use start month if not specified)
                let endDate;
                if (endMonth) {
                    const [endYear, endMonthNum] = endMonth.split('-').map(Number);
                    endDate = new Date(endYear, endMonthNum, 0); // Last day of the month
                } else {
                    endDate = new Date(startYear, startMonthNum, 0); // Last day of start month
                }
                
                // Store calculation parameters for step-by-step process
                calculationSteps.startDate = startDate;
                calculationSteps.endDate = endDate;
                calculationSteps.preserveExisting = preserveExisting;
                calculationSteps.currentStep = 1;
                
                // Close month selection modal
                const monthModal = bootstrap.Modal.getInstance(document.getElementById('calculateDutiesModal'));
                if (monthModal) {
                    monthModal.hide();
                }
                
                // Start step-by-step calculation process
                showStepByStepCalculation();
            } catch (error) {
                console.error('Error in calculateDutiesForSelectedMonths:', error);
                alert('Σφάλμα κατά τον υπολογισμό: ' + error.message);
            }
        }
        
        // Show step-by-step calculation modal
        function showStepByStepCalculation() {
            calculationSteps.currentStep = 1;
            renderCurrentStep();
            const modal = new bootstrap.Modal(document.getElementById('stepByStepCalculationModal'));
            modal.show();
        }

        // Render current step content
        function renderCurrentStep() {
            const stepContent = document.getElementById('stepContent');
            const stepNumber = document.getElementById('currentStepNumber');
            const backButton = document.getElementById('backButton');
            const nextButton = document.getElementById('nextButton');
            const calculateButton = document.getElementById('calculateButton');
            
            stepNumber.textContent = calculationSteps.currentStep;
            
            // Show/hide navigation buttons
            backButton.style.display = calculationSteps.currentStep > 1 ? 'inline-block' : 'none';
            // Step 4 uses "Next" button to save pre-logic and run swap logic, not "Save" button
            nextButton.style.display = calculationSteps.currentStep <= calculationSteps.totalSteps ? 'inline-block' : 'none';
            calculateButton.style.display = 'none'; // Never show calculate button - Step 4 uses Next instead
            
            // Render step content
            switch(calculationSteps.currentStep) {
                case 1:
                    renderStep1_SpecialHolidays();
                    break;
                case 2:
                    renderStep2_Weekends();
                    break;
                case 3:
                    renderStep3_SemiNormal();
                    break;
                case 4:
                    renderStep4_Normal();
                    break;
            }
        }

        // Step 1: Check and show special holidays
        function renderStep1_SpecialHolidays() {
            const stepContent = document.getElementById('stepContent');
            const startDate = calculationSteps.startDate;
            const endDate = calculationSteps.endDate;
            
            // Build day type lists
            const dayTypeLists = {
                special: [],
                weekend: [],
                semi: [],
                normal: []
            };
            
            const dateIterator = new Date(startDate);
            while (dateIterator <= endDate) {
                const dayType = getDayType(dateIterator);
                const key = formatDateKey(dateIterator);
                let typeCategory = 'normal';
                
                if (dayType === 'special-holiday') {
                    typeCategory = 'special';
                } else if (dayType === 'semi-normal-day') {
                    typeCategory = 'semi';
                } else if (dayType === 'weekend-holiday') {
                    typeCategory = 'weekend';
                }
                
                dayTypeLists[typeCategory].push(key);
                dateIterator.setDate(dateIterator.getDate() + 1);
            }
            
            calculationSteps.dayTypeLists = dayTypeLists;
            
            // Check for special holidays
            const specialHolidays = dayTypeLists.special;
            
            let html = '<div class="step-content">';
            html += '<h6 class="mb-3"><i class="fas fa-star text-warning me-2"></i>Βήμα 1: Ειδικές Αργίες</h6>';
            
            if (specialHolidays.length === 0) {
                html += '<div class="alert alert-info">';
                html += '<i class="fas fa-info-circle me-2"></i>';
                html += 'Δεν βρέθηκαν ειδικές αργίες στην επιλεγμένη περίοδο.';
                html += '</div>';
            } else {
                html += '<div class="alert alert-success">';
                html += `<i class="fas fa-check-circle me-2"></i>Βρέθηκαν <strong>${specialHolidays.length}</strong> ειδικές αργίες στην επιλεγμένη περίοδο.`;
                html += '</div>';
                
                html += '<div class="table-responsive mt-3">';
                html += '<table class="table table-bordered table-hover">';
                html += '<thead class="table-warning">';
                html += '<tr>';
                html += '<th>Ημερομηνία</th>';
                html += '<th>Όνομα Αργίας</th>';
                html += '<th>Ομάδα 1<br><small>ΕΠΙΚΕΦΑΛΗΣ-ΑΥΜ</small></th>';
                html += '<th>Ομάδα 2<br><small>ΜΗΧΑΝΙΚΟΣ-ΟΠΛΟΥΡΓΟΣ-ΟΔΗΓΟΣ</small></th>';
                html += '<th>Ομάδα 3<br><small>ΤΕΧΝΙΚΟΣ Ε/Π AW139</small></th>';
                html += '<th>Ομάδα 4<br><small>ΤΕΧΝΙΚΟΣ ΕΠΙΓΕΙΩΝ ΜΕΣΩΝ</small></th>';
                html += '</tr>';
                html += '</thead>';
                html += '<tbody>';
                
                // Sort special holidays by date
                const sortedSpecial = [...specialHolidays].sort();
                
                // Store assignments and rotation positions for saving when Next is pressed
                const tempSpecialAssignments = {}; // dateKey -> { groupNum -> personName }
                const lastSpecialRotationPositions = {}; // groupNum -> last rotation position
                
                sortedSpecial.forEach((dateKey, specialIndex) => {
                    const date = new Date(dateKey + 'T00:00:00');
                    const dateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const dayName = getGreekDayName(date);
                    
                    // Get holiday name
                    let holidayName = '';
                    const year = date.getFullYear();
                    const month = date.getMonth() + 1;
                    const day = date.getDate();
                    
                    // Check recurring holidays
                    for (const holidayDef of recurringSpecialHolidays) {
                        if (holidayDef.type === 'fixed' && holidayDef.month === month && holidayDef.day === day) {
                            holidayName = holidayDef.name;
                            break;
                        } else if (holidayDef.type === 'easter-relative') {
                            const orthodoxHolidays = calculateOrthodoxHolidays(year);
                            const easterDate = orthodoxHolidays.easterSunday;
                            const holidayDate = new Date(easterDate);
                            holidayDate.setDate(holidayDate.getDate() + (holidayDef.offset || 0));
                            if (formatDateKey(holidayDate) === dateKey) {
                                holidayName = holidayDef.name;
                                break;
                            }
                        }
                    }
                    
                    html += '<tr>';
                    html += `<td><strong>${dateStr}</strong><br><small class="text-muted">${dayName}</small></td>`;
                    html += `<td>${holidayName || 'Ειδική Αργία'}</td>`;
                    
                    // Calculate who will be assigned for each group based on rotation order
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [] };
                        const groupPeople = groupData.special || [];
                        
                        if (groupPeople.length === 0) {
                            html += '<td class="text-muted">-</td>';
                        } else {
                            // Use rotation order based on days since start date
                                const rotationDays = groupPeople.length;
                            // If start date is February 2026, always start from first person (position 0)
                            const isFebruary2026 = calculationSteps.startDate && 
                                calculationSteps.startDate.getFullYear() === 2026 && 
                                calculationSteps.startDate.getMonth() === 1; // Month 1 = February (0-indexed)
                            
                            let rotationPosition;
                            if (isFebruary2026 && specialIndex === 0) {
                                // First special holiday in February 2026 starts from position 0
                                rotationPosition = 0;
                            } else {
                                rotationPosition = getRotationPosition(date, 'special', groupNum) % rotationDays;
                            }
                            
                            let assignedPerson = groupPeople[rotationPosition];
                            
                            // Check if assigned person is missing, if so find next in rotation
                            if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date)) {
                                // Find next person in rotation who is not missing
                                for (let offset = 1; offset < rotationDays; offset++) {
                                    const nextIndex = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[nextIndex];
                                    if (candidate && !isPersonMissingOnDate(candidate, groupNum, date)) {
                                        assignedPerson = candidate;
                                        rotationPosition = nextIndex;
                                        break;
                                    }
                                }
                            }
                            
                            // Store assignment for saving
                            if (assignedPerson) {
                                if (!tempSpecialAssignments[dateKey]) {
                                    tempSpecialAssignments[dateKey] = {};
                                }
                                tempSpecialAssignments[dateKey][groupNum] = assignedPerson;
                                
                                // Track last rotation position for this group
                                // Advance position by 1 for next time (or wrap around)
                                const nextRotationPosition = (rotationPosition + 1) % rotationDays;
                                lastSpecialRotationPositions[groupNum] = nextRotationPosition;
                            }
                            
                            // Get last duty date and days since for display
                            let lastDutyInfo = '';
                            let daysCountInfo = '';
                            if (assignedPerson) {
                                const daysSince = countDaysSinceLastDuty(dateKey, assignedPerson, groupNum, 'special', dayTypeLists, startDate);
                                    const dutyDates = getLastAndNextDutyDates(assignedPerson, groupNum, 'special', groupPeople.length);
                                    lastDutyInfo = dutyDates.lastDuty !== 'Δεν έχει' ? `<br><small class="text-muted">Τελευταία: ${dutyDates.lastDuty}</small>` : '';
                                
                                // Show days counted in parentheses
                                if (daysSince !== null && daysSince !== Infinity) {
                                    daysCountInfo = ` <span class="text-info">(${daysSince}/${rotationDays} ημέρες)</span>`;
                                } else if (daysSince === Infinity) {
                                    daysCountInfo = ' <span class="text-success">(πρώτη φορά)</span>';
                                }
                            }
                            
                            html += `<td>${assignedPerson || '-'}${daysCountInfo}${lastDutyInfo}</td>`;
                        }
                    }
                    
                    html += '</tr>';
                });
                
                // Store assignments and rotation positions in calculationSteps for saving when Next is pressed
                calculationSteps.tempSpecialAssignments = tempSpecialAssignments;
                calculationSteps.lastSpecialRotationPositions = lastSpecialRotationPositions;
                
                html += '</tbody>';
                html += '</table>';
                html += '</div>';
            }
            
            html += '</div>';
            stepContent.innerHTML = html;
        }

        // Navigation functions
        async function goToNextStep() {
            // If moving from Step 1 (Special Holidays), save assignments to Firestore
            if (calculationSteps.currentStep === 1) {
                await saveStep1_SpecialHolidays();
                calculationSteps.currentStep++;
                renderCurrentStep();
                return;
            }
            
            // If moving from Step 2 (Weekends), save assignments and run skip logic
            // NOTE: Step 3 will be rendered after OK is pressed in the modal
            if (calculationSteps.currentStep === 2) {
                await saveStep2_Weekends();
                // Don't increment step here - it will be done when OK is pressed in modal
                return;
            }
            
            // If moving from Step 3 (Semi-Normal), save assignments and run swap logic
            // NOTE: Step 4 will be rendered after OK is pressed in the modal
            if (calculationSteps.currentStep === 3) {
                await saveStep3_SemiNormal();
                // Don't increment step here - it will be done when OK is pressed in modal
                return;
            }
            
            // If moving from Step 4 (Normal), save assignments and run swap logic
            // NOTE: Final save will happen after OK is pressed in the modal
            if (calculationSteps.currentStep === 4) {
                console.log('[STEP 4] Next button pressed, calling saveStep4_Normal()');
                try {
                    await saveStep4_Normal();
                    console.log('[STEP 4] saveStep4_Normal() completed');
                } catch (error) {
                    console.error('[STEP 4] Error in saveStep4_Normal():', error);
                }
                // Don't increment step here - it will be done when OK is pressed in modal
                return;
            }
            
            // For any other step, just increment and render
            if (calculationSteps.currentStep < calculationSteps.totalSteps) {
                calculationSteps.currentStep++;
                renderCurrentStep();
            }
        }
        
        // Save Step 1 (Special Holidays) assignments to Firestore
        async function saveStep1_SpecialHolidays() {
            try {
                if (!window.db) {
                    console.log('Firebase not ready, skipping Step 1 save');
                    return;
                }
                
                const db = window.db || firebase.firestore();
                const user = window.auth?.currentUser;
                
                if (!user) {
                    console.log('User not authenticated, skipping Step 1 save');
                    return;
                }
                
                const tempSpecialAssignments = calculationSteps.tempSpecialAssignments || {};
                const lastSpecialRotationPositions = calculationSteps.lastSpecialRotationPositions || {};
                
                // Save special holiday assignments to Firestore
                if (Object.keys(tempSpecialAssignments).length > 0) {
                    // Organize by month
                    const organizedSpecial = organizeAssignmentsByMonth(tempSpecialAssignments);
                    const sanitizedSpecial = sanitizeForFirestore(organizedSpecial);
                    
                    await db.collection('dutyShifts').doc('specialHolidayAssignments').set({
                        ...sanitizedSpecial,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Saved Step 1 special holiday assignments to Firestore:', Object.keys(tempSpecialAssignments).length, 'dates');
                    
                    // Also update local memory
                    Object.assign(specialHolidayAssignments, tempSpecialAssignments);
                }
                
                // Save last rotation positions for special holidays
                if (Object.keys(lastSpecialRotationPositions).length > 0) {
                    // Update lastRotationPositions for special holidays
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        if (lastSpecialRotationPositions[groupNum] !== undefined) {
                            lastRotationPositions.special[groupNum] = lastSpecialRotationPositions[groupNum];
                        }
                    }
                    
                    // Save to Firestore
                    const sanitizedPositions = sanitizeForFirestore(lastRotationPositions);
                    await db.collection('dutyShifts').doc('lastRotationPositions').set({
                        ...sanitizedPositions,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Saved Step 1 last rotation positions for special holidays to Firestore:', lastSpecialRotationPositions);
                }
            } catch (error) {
                console.error('Error saving Step 1 (Special Holidays) to Firestore:', error);
            }
        }
        
        // Save Step 2 (Weekends) assignments to Firestore and run skip logic
        async function saveStep2_Weekends() {
            try {
                if (!window.db) {
                    console.log('Firebase not ready, skipping Step 2 save');
                    return;
                }
                
                const db = window.db || firebase.firestore();
                const user = window.auth?.currentUser;
                
                if (!user) {
                    console.log('User not authenticated, skipping Step 2 save');
                    return;
                }
                
                const tempWeekendAssignments = calculationSteps.tempWeekendAssignments || {};
                const lastWeekendRotationPositions = calculationSteps.lastWeekendRotationPositions || {};
                
                // First, save weekend assignments to assignments document (pre-skip)
                if (Object.keys(tempWeekendAssignments).length > 0) {
                    // Convert to format: dateKey -> "Person (Ομάδα 1), Person (Ομάδα 2), ..."
                    const formattedAssignments = {};
                    for (const dateKey in tempWeekendAssignments) {
                        const groups = tempWeekendAssignments[dateKey];
                        const parts = [];
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            if (groups[groupNum]) {
                                parts.push(`${groups[groupNum]} (Ομάδα ${groupNum})`);
                            }
                        }
                        if (parts.length > 0) {
                            formattedAssignments[dateKey] = parts.join(', ');
                        }
                    }
                    
                    // Save to assignments document (pre-skip) - merge with existing data
                    const organizedAssignments = organizeAssignmentsByMonth(formattedAssignments);
                    const sanitizedAssignments = sanitizeForFirestore(organizedAssignments);
                    
                    // Load existing assignments to merge
                    const existingAssignmentsDoc = await db.collection('dutyShifts').doc('assignments').get();
                    let existingAssignments = {};
                    if (existingAssignmentsDoc.exists) {
                        const existingData = existingAssignmentsDoc.data();
                        // Remove metadata fields
                        delete existingData.lastUpdated;
                        delete existingData.updatedBy;
                        existingAssignments = existingData || {};
                    }
                    
                    // Deep merge: merge at month level, then at date level
                    const mergedAssignments = { ...existingAssignments };
                    for (const monthKey in sanitizedAssignments) {
                        if (!mergedAssignments[monthKey]) {
                            mergedAssignments[monthKey] = {};
                        }
                        // Merge date assignments within this month
                        mergedAssignments[monthKey] = { ...mergedAssignments[monthKey], ...sanitizedAssignments[monthKey] };
                    }
                    
                    await db.collection('dutyShifts').doc('assignments').set({
                        ...mergedAssignments,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Saved Step 2 weekend assignments (pre-skip) to assignments document (merged with existing):', Object.keys(tempWeekendAssignments).length, 'dates');
                    
                    // Also update local memory
                    Object.assign(weekendAssignments, formattedAssignments);
                }
                
                // Save last rotation positions for weekends
                if (Object.keys(lastWeekendRotationPositions).length > 0) {
                    // Update lastRotationPositions for weekends
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        if (lastWeekendRotationPositions[groupNum] !== undefined) {
                            lastRotationPositions.weekend[groupNum] = lastWeekendRotationPositions[groupNum];
                        }
                    }
                    
                    // Save to Firestore
                    const sanitizedPositions = sanitizeForFirestore(lastRotationPositions);
                    await db.collection('dutyShifts').doc('lastRotationPositions').set({
                        ...sanitizedPositions,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Saved Step 2 last rotation positions for weekends to Firestore:', lastWeekendRotationPositions);
                }
                
                // Now run skip logic and show popup
                await runWeekendSkipLogic();
            } catch (error) {
                console.error('Error saving Step 2 (Weekends) to Firestore:', error);
            }
        }
        
        // Run skip logic for weekends and show popup with results
        async function runWeekendSkipLogic() {
            try {
                const dayTypeLists = calculationSteps.dayTypeLists || { weekend: [], special: [] };
                const weekendHolidays = dayTypeLists.weekend || [];
                const specialHolidays = dayTypeLists.special || [];
                
                // Load special holiday assignments from Step 1 saved data (tempSpecialAssignments)
                // Use tempSpecialAssignments directly instead of reading from global specialHolidayAssignments
                const tempSpecialAssignments = calculationSteps.tempSpecialAssignments || {};
                const simulatedSpecialAssignments = {}; // monthKey -> { groupNum -> Set of person names }
                const sortedSpecial = [...specialHolidays].sort();
                
                sortedSpecial.forEach((dateKey) => {
                    const date = new Date(dateKey + 'T00:00:00');
                    const month = date.getMonth();
                    const year = date.getFullYear();
                    const monthKey = `${year}-${month}`;
                    
                    if (!simulatedSpecialAssignments[monthKey]) {
                        simulatedSpecialAssignments[monthKey] = {};
                    }
                    
                    // Check tempSpecialAssignments first (from Step 1), then fall back to specialHolidayAssignments
                    let assignment = null;
                    if (tempSpecialAssignments[dateKey]) {
                        // tempSpecialAssignments is in format: { dateKey: { groupNum: personName } }
                        // Convert to string format for parsing
                        const groups = tempSpecialAssignments[dateKey];
                        const parts = [];
                        for (const groupNum in groups) {
                            const personName = groups[groupNum];
                            if (personName) {
                                parts.push(`${personName} (Ομάδα ${groupNum})`);
                            }
                        }
                        assignment = parts.join(', ');
                    } else {
                        // Fall back to global specialHolidayAssignments (for backward compatibility)
                        assignment = specialHolidayAssignments[dateKey];
                    }
                    
                    if (assignment) {
                        // Ensure assignment is a string (it might be an object if data wasn't flattened correctly)
                        const assignmentStr = typeof assignment === 'string' ? assignment : String(assignment);
                        const parts = assignmentStr.split(',').map(p => p.trim());
                        parts.forEach(part => {
                            const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)$/);
                            if (match) {
                                const personName = match[1].trim();
                                const groupNum = parseInt(match[2]);
                                if (!simulatedSpecialAssignments[monthKey][groupNum]) {
                                    simulatedSpecialAssignments[monthKey][groupNum] = new Set();
                                }
                                simulatedSpecialAssignments[monthKey][groupNum].add(personName);
                            }
                        });
                    }
                });
                
                // Track skipped people and replacements
                const skippedPeople = []; // Array of { date, groupNum, skippedPerson, replacementPerson }
                const sortedWeekends = [...weekendHolidays].sort();
                const skippedInMonth = {}; // monthKey -> { groupNum -> Set of person names }
                const updatedAssignments = {}; // dateKey -> { groupNum -> personName }
                
                // Load current weekend assignments from preview (tempWeekendAssignments)
                const tempWeekendAssignments = calculationSteps.tempWeekendAssignments || {};
                for (const dateKey in tempWeekendAssignments) {
                    const groups = tempWeekendAssignments[dateKey];
                    updatedAssignments[dateKey] = { ...groups };
                }
                
                // Run skip logic
                sortedWeekends.forEach((dateKey) => {
                    const date = new Date(dateKey + 'T00:00:00');
                    const month = date.getMonth();
                    const year = date.getFullYear();
                    const monthKey = `${year}-${month}`;
                    
                    if (!skippedInMonth[monthKey]) {
                        skippedInMonth[monthKey] = {};
                    }
                    
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        const groupData = groups[groupNum] || { weekend: [] };
                        const groupPeople = groupData.weekend || [];
                        
                        if (groupPeople.length === 0) continue;
                        
                        if (!skippedInMonth[monthKey][groupNum]) {
                            skippedInMonth[monthKey][groupNum] = new Set();
                        }
                        
                        const currentPerson = updatedAssignments[dateKey]?.[groupNum];
                        if (!currentPerson) continue;
                        
                        // Check if person has special holiday in same month
                        const hasSpecialHoliday = simulatedSpecialAssignments[monthKey]?.[groupNum]?.has(currentPerson) || false;
                        const wasSkipped = skippedInMonth[monthKey][groupNum].has(currentPerson);
                        
                        if (hasSpecialHoliday || wasSkipped) {
                            skippedInMonth[monthKey][groupNum].add(currentPerson);
                            
                            // Find replacement
                            const rotationDays = groupPeople.length;
                            const currentIndex = groupPeople.indexOf(currentPerson);
                            let replacementPerson = null;
                            
                            for (let offset = 1; offset < rotationDays; offset++) {
                                const nextIndex = (currentIndex + offset) % rotationDays;
                                const candidate = groupPeople[nextIndex];
                                
                                if (!candidate || isPersonMissingOnDate(candidate, groupNum, date)) {
                                    continue;
                                }
                                
                                const candidateHasSpecial = simulatedSpecialAssignments[monthKey]?.[groupNum]?.has(candidate) || false;
                                const candidateWasSkipped = skippedInMonth[monthKey][groupNum].has(candidate);
                                
                                if (!candidateHasSpecial && !candidateWasSkipped) {
                                    replacementPerson = candidate;
                                    break;
                                }
                            }
                            
                            if (replacementPerson) {
                                skippedPeople.push({
                                    date: dateKey,
                                    dateStr: date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                                    groupNum: groupNum,
                                    skippedPerson: currentPerson,
                                    replacementPerson: replacementPerson
                                });
                                
                                // Update assignment
                                updatedAssignments[dateKey][groupNum] = replacementPerson;
                            }
                        }
                    }
                });
                
                // Store final assignments (after skip logic) for saving when OK is pressed
                calculationSteps.finalWeekendAssignments = updatedAssignments;
                
                // Show popup with results (will save when OK is pressed)
                showWeekendSkipResults(skippedPeople, updatedAssignments);
            } catch (error) {
                console.error('Error running weekend skip logic:', error);
            }
        }
        
        // Show popup with weekend skip results
        function showWeekendSkipResults(skippedPeople, updatedAssignments) {
            let message = '';
            
            if (skippedPeople.length === 0) {
                message = '<div class="alert alert-success"><i class="fas fa-check-circle me-2"></i><strong>Κανένας δεν παραλείφθηκε!</strong><br>Όλοι οι άνθρωποι που είχαν ειδική αργία τον ίδιο μήνα παραλείφθηκαν σωστά.</div>';
            } else {
                message = '<div class="alert alert-info"><i class="fas fa-info-circle me-2"></i><strong>Παραλείφθηκαν ' + skippedPeople.length + ' άτομα:</strong><br><br>';
                message += '<table class="table table-sm table-bordered">';
                message += '<thead><tr><th>Ημερομηνία</th><th>Ομάδα</th><th>Παραλείφθηκε</th><th>Αντικαταστάθηκε από</th></tr></thead><tbody>';
                
                skippedPeople.forEach(item => {
                    const groupName = getGroupName(item.groupNum);
                    message += `<tr><td>${item.dateStr}</td><td>${groupName}</td><td><strong>${item.skippedPerson}</strong></td><td><strong>${item.replacementPerson}</strong></td></tr>`;
                });
                
                message += '</tbody></table></div>';
            }
            
            // Create and show modal
            const modalHtml = `
                <div class="modal fade" id="weekendSkipResultsModal" tabindex="-1">
                    <div class="modal-dialog modal-lg">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title"><i class="fas fa-exchange-alt me-2"></i>Αποτελέσματα Παραλείψεων Σαββατοκύριακων</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                ${message}
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-primary" id="weekendSkipOkButton" data-bs-dismiss="modal">OK</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Remove existing modal if any
            const existingModal = document.getElementById('weekendSkipResultsModal');
            if (existingModal) {
                existingModal.remove();
            }
            
            // Add modal to body
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            
            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('weekendSkipResultsModal'));
            modal.show();
            
            // When OK is pressed, save final assignments and proceed to Step 3
            const okButton = document.getElementById('weekendSkipOkButton');
            if (okButton) {
                okButton.addEventListener('click', async function() {
                    await saveFinalWeekendAssignments(updatedAssignments);
                    // Proceed to Step 3
                    calculationSteps.currentStep = 3;
                    renderCurrentStep();
                });
            }
        }
        
        // Save final weekend assignments (after skip logic) to weekendAssignments document
        async function saveFinalWeekendAssignments(updatedAssignments) {
            try {
                if (!window.db) {
                    console.log('Firebase not ready, skipping final weekend assignments save');
                    return;
                }
                
                const db = window.db || firebase.firestore();
                const user = window.auth?.currentUser;
                
                if (!user) {
                    console.log('User not authenticated, skipping final weekend assignments save');
                    return;
                }
                
                if (Object.keys(updatedAssignments).length > 0) {
                    const formattedAssignments = {};
                    for (const dateKey in updatedAssignments) {
                        const groups = updatedAssignments[dateKey];
                        const parts = [];
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            if (groups[groupNum]) {
                                parts.push(`${groups[groupNum]} (Ομάδα ${groupNum})`);
                            }
                        }
                        if (parts.length > 0) {
                            formattedAssignments[dateKey] = parts.join(', ');
                        }
                    }
                    
                    const organizedWeekend = organizeAssignmentsByMonth(formattedAssignments);
                    const sanitizedWeekend = sanitizeForFirestore(organizedWeekend);
                    
                    await db.collection('dutyShifts').doc('weekendAssignments').set({
                        ...sanitizedWeekend,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Saved Step 2 final weekend assignments (after skip logic) to weekendAssignments document');
                    
                    // Update local memory
                    Object.assign(weekendAssignments, formattedAssignments);
                }
            } catch (error) {
                console.error('Error saving final weekend assignments:', error);
            }
        }
        
        // Save Step 3 (Semi-Normal) assignments to Firestore and run swap logic
        async function saveStep3_SemiNormal() {
            try {
                if (!window.db) {
                    console.log('Firebase not ready, skipping Step 3 save');
                    return;
                }
                
                const db = window.db || firebase.firestore();
                const user = window.auth?.currentUser;
                
                if (!user) {
                    console.log('User not authenticated, skipping Step 3 save');
                    return;
                }
                
                const tempSemiAssignments = calculationSteps.tempSemiAssignments || {};
                const lastSemiRotationPositions = calculationSteps.lastSemiRotationPositions || {};
                
                // First, save semi-normal assignments to assignments document (pre-logic)
                if (Object.keys(tempSemiAssignments).length > 0) {
                    // Convert to format: dateKey -> "Person (Ομάδα 1), Person (Ομάδα 2), ..."
                    const formattedAssignments = {};
                    for (const dateKey in tempSemiAssignments) {
                        const groups = tempSemiAssignments[dateKey];
                        const parts = [];
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            if (groups[groupNum]) {
                                parts.push(`${groups[groupNum]} (Ομάδα ${groupNum})`);
                            }
                        }
                        if (parts.length > 0) {
                            formattedAssignments[dateKey] = parts.join(', ');
                        }
                    }
                    
                    // Save to assignments document (pre-logic) - merge with existing data
                    const organizedAssignments = organizeAssignmentsByMonth(formattedAssignments);
                    const sanitizedAssignments = sanitizeForFirestore(organizedAssignments);
                    
                    // Load existing assignments to merge
                    const existingAssignmentsDoc = await db.collection('dutyShifts').doc('assignments').get();
                    let existingAssignments = {};
                    if (existingAssignmentsDoc.exists) {
                        const existingData = existingAssignmentsDoc.data();
                        // Remove metadata fields
                        delete existingData.lastUpdated;
                        delete existingData.updatedBy;
                        existingAssignments = existingData || {};
                    }
                    
                    // Deep merge: merge at month level, then at date level
                    const mergedAssignments = { ...existingAssignments };
                    for (const monthKey in sanitizedAssignments) {
                        if (!mergedAssignments[monthKey]) {
                            mergedAssignments[monthKey] = {};
                        }
                        // Merge date assignments within this month
                        mergedAssignments[monthKey] = { ...mergedAssignments[monthKey], ...sanitizedAssignments[monthKey] };
                    }
                    
                    await db.collection('dutyShifts').doc('assignments').set({
                        ...mergedAssignments,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Saved Step 3 semi-normal assignments (pre-logic) to assignments document (merged with existing):', Object.keys(tempSemiAssignments).length, 'dates');
                    
                    // Also update local memory
                    Object.assign(semiNormalAssignments, formattedAssignments);
                }
                
                // Save last rotation positions for semi-normal
                if (Object.keys(lastSemiRotationPositions).length > 0) {
                    // Update lastRotationPositions for semi-normal
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        if (lastSemiRotationPositions[groupNum] !== undefined) {
                            lastRotationPositions.semi[groupNum] = lastSemiRotationPositions[groupNum];
                        }
                    }
                    
                    // Save to Firestore
                    const sanitizedPositions = sanitizeForFirestore(lastRotationPositions);
                    await db.collection('dutyShifts').doc('lastRotationPositions').set({
                        ...sanitizedPositions,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Saved Step 3 last rotation positions for semi-normal to Firestore:', lastSemiRotationPositions);
                }
                
                // Now run swap logic and show popup
                await runSemiNormalSwapLogic();
            } catch (error) {
                console.error('Error saving Step 3 (Semi-Normal) to Firestore:', error);
            }
        }
        
        // Run swap logic for semi-normal days and show popup with results
        async function runSemiNormalSwapLogic() {
            try {
                const dayTypeLists = calculationSteps.dayTypeLists || { semi: [], special: [], weekend: [] };
                const semiNormalDays = dayTypeLists.semi || [];
                const specialHolidays = dayTypeLists.special || [];
                const weekendHolidays = dayTypeLists.weekend || [];
                
                // Load special holiday assignments from Step 1 saved data (tempSpecialAssignments)
                const tempSpecialAssignments = calculationSteps.tempSpecialAssignments || {};
                const simulatedSpecialAssignments = {}; // monthKey -> { groupNum -> Set of person names }
                const sortedSpecial = [...specialHolidays].sort();
                
                sortedSpecial.forEach((dateKey) => {
                    const date = new Date(dateKey + 'T00:00:00');
                    const month = date.getMonth();
                    const year = date.getFullYear();
                    const monthKey = `${year}-${month}`;
                    
                    if (!simulatedSpecialAssignments[monthKey]) {
                        simulatedSpecialAssignments[monthKey] = {};
                    }
                    
                    // Check tempSpecialAssignments first (from Step 1), then fall back to specialHolidayAssignments
                    let assignment = null;
                    if (tempSpecialAssignments[dateKey]) {
                        // tempSpecialAssignments is in format: { dateKey: { groupNum: personName } }
                        // Convert to string format for parsing
                        const groups = tempSpecialAssignments[dateKey];
                        const parts = [];
                        for (const groupNum in groups) {
                            const personName = groups[groupNum];
                            if (personName) {
                                parts.push(`${personName} (Ομάδα ${groupNum})`);
                            }
                        }
                        assignment = parts.join(', ');
                    } else {
                        // Fall back to global specialHolidayAssignments (for backward compatibility)
                        assignment = specialHolidayAssignments[dateKey];
                    }
                    
                    if (assignment) {
                        // Ensure assignment is a string (it might be an object if data wasn't flattened correctly)
                        const assignmentStr = typeof assignment === 'string' ? assignment : String(assignment);
                        const parts = assignmentStr.split(',').map(p => p.trim());
                        parts.forEach(part => {
                            const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)$/);
                            if (match) {
                                const personName = match[1].trim();
                                const groupNum = parseInt(match[2]);
                                if (!simulatedSpecialAssignments[monthKey][groupNum]) {
                                    simulatedSpecialAssignments[monthKey][groupNum] = new Set();
                                }
                                simulatedSpecialAssignments[monthKey][groupNum].add(personName);
                            }
                        });
                    }
                });
                
                // Load weekend assignments from Step 2 final results (finalWeekendAssignments)
                // Use finalWeekendAssignments directly instead of reading from global weekendAssignments
                const finalWeekendAssignments = calculationSteps.finalWeekendAssignments || {};
                const simulatedWeekendAssignments = {}; // dateKey -> { groupNum -> person name }
                
                // finalWeekendAssignments is in format: { dateKey: { groupNum: personName } }
                for (const dateKey in finalWeekendAssignments) {
                    const groups = finalWeekendAssignments[dateKey];
                    if (groups && typeof groups === 'object') {
                        simulatedWeekendAssignments[dateKey] = { ...groups };
                    }
                }
                
                // Also check global weekendAssignments for any dates not in finalWeekendAssignments (backward compatibility)
                for (const dateKey in weekendAssignments) {
                    if (!simulatedWeekendAssignments[dateKey]) {
                        const assignment = weekendAssignments[dateKey];
                        if (assignment) {
                            // Ensure assignment is a string (it might be an object if data wasn't flattened correctly)
                            const assignmentStr = typeof assignment === 'string' ? assignment : String(assignment);
                            const parts = assignmentStr.split(',').map(p => p.trim());
                            parts.forEach(part => {
                                const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)$/);
                                if (match) {
                                    const personName = match[1].trim();
                                    const groupNum = parseInt(match[2]);
                                    if (!simulatedWeekendAssignments[dateKey]) {
                                        simulatedWeekendAssignments[dateKey] = {};
                                    }
                                    simulatedWeekendAssignments[dateKey][groupNum] = personName;
                                }
                            });
                        }
                    }
                }
                
                // Track swapped people and replacements
                const swappedPeople = []; // Array of { date, groupNum, conflictedPerson, swappedPerson, swapDate }
                const sortedSemi = [...semiNormalDays].sort();
                const updatedAssignments = {}; // dateKey -> { groupNum -> personName }
                
                // Track swap pairs for color coding
                // Find maximum existing swapPairId to ensure unique IDs
                let maxSwapPairId = -1;
                for (const dateKey in assignmentReasons) {
                    for (const groupNumStr in assignmentReasons[dateKey]) {
                        for (const personName in assignmentReasons[dateKey][groupNumStr]) {
                            const reason = assignmentReasons[dateKey][groupNumStr][personName];
                            if (reason && reason.swapPairId !== null && reason.swapPairId !== undefined) {
                                const id = typeof reason.swapPairId === 'number' ? reason.swapPairId : parseInt(reason.swapPairId);
                                if (!isNaN(id) && id > maxSwapPairId) {
                                    maxSwapPairId = id;
                                }
                            }
                        }
                    }
                }
                let swapPairCounter = maxSwapPairId + 1; // Start from max + 1 to ensure uniqueness
                const swapColors = [
                    { border: '#FF1744', bg: 'rgba(255, 23, 68, 0.15)' }, // Bright Red
                    { border: '#00E676', bg: 'rgba(0, 230, 118, 0.15)' }, // Bright Green
                    { border: '#FFD600', bg: 'rgba(255, 214, 0, 0.15)' }, // Bright Yellow
                    { border: '#00B0FF', bg: 'rgba(0, 176, 255, 0.15)' }, // Bright Blue
                    { border: '#D500F9', bg: 'rgba(213, 0, 249, 0.15)' }, // Bright Purple
                    { border: '#FF6D00', bg: 'rgba(255, 109, 0, 0.15)' }, // Bright Orange
                    { border: '#00E5FF', bg: 'rgba(0, 229, 255, 0.15)' }, // Bright Cyan
                    { border: '#FF4081', bg: 'rgba(255, 64, 129, 0.15)' }  // Bright Pink
                ];
                
                // Load current semi-normal assignments from preview (tempSemiAssignments)
                const tempSemiAssignments = calculationSteps.tempSemiAssignments || {};
                for (const dateKey in tempSemiAssignments) {
                    const groups = tempSemiAssignments[dateKey];
                    updatedAssignments[dateKey] = { ...groups };
                }
                
                // Run swap logic (check for consecutive conflicts with weekend or special holiday)
                sortedSemi.forEach((dateKey) => {
                    const date = new Date(dateKey + 'T00:00:00');
                    const month = date.getMonth();
                    const year = date.getFullYear();
                    const monthKey = `${year}-${month}`;
                    
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        const groupData = groups[groupNum] || { semi: [] };
                        const groupPeople = groupData.semi || [];
                        
                        if (groupPeople.length === 0) continue;
                        
                        const currentPerson = updatedAssignments[dateKey]?.[groupNum];
                        if (!currentPerson) continue;
                        
                        // Check for consecutive conflicts with weekend or special holiday
                        const dayBefore = new Date(date);
                        dayBefore.setDate(dayBefore.getDate() - 1);
                        const dayAfter = new Date(date);
                        dayAfter.setDate(dayAfter.getDate() + 1);
                        
                        const dayBeforeKey = formatDateKey(dayBefore);
                        const dayAfterKey = formatDateKey(dayAfter);
                        
                        const beforeType = getDayType(dayBefore);
                        const afterType = getDayType(dayAfter);
                        
                        let hasConsecutiveConflict = false;
                        
                        // Check day before
                        if (beforeType === 'weekend-holiday' || beforeType === 'special-holiday') {
                            const personBefore = simulatedWeekendAssignments[dayBeforeKey]?.[groupNum] || 
                                               (beforeType === 'special-holiday' ? 
                                                (simulatedSpecialAssignments[`${dayBefore.getFullYear()}-${dayBefore.getMonth()}`]?.[groupNum]?.has(currentPerson) ? currentPerson : null) : null);
                            if (personBefore === currentPerson) {
                                hasConsecutiveConflict = true;
                            }
                        }
                        
                        // Check day after
                        if (!hasConsecutiveConflict && (afterType === 'weekend-holiday' || afterType === 'special-holiday')) {
                            const personAfter = simulatedWeekendAssignments[dayAfterKey]?.[groupNum] || 
                                               (afterType === 'special-holiday' ? 
                                                (simulatedSpecialAssignments[`${dayAfter.getFullYear()}-${dayAfter.getMonth()}`]?.[groupNum]?.has(currentPerson) ? currentPerson : null) : null);
                            if (personAfter === currentPerson) {
                                hasConsecutiveConflict = true;
                            }
                        }
                        
                        if (hasConsecutiveConflict) {
                            // Find a person to swap with (not just replace)
                            // Need to find where the swapped person is assigned and swap both
                            const rotationDays = groupPeople.length;
                            const currentIndex = groupPeople.indexOf(currentPerson);
                            let swapCandidate = null;
                            let swapDateKey = null;
                            
                            // First, find a candidate who doesn't have conflict on current day
                            for (let offset = 1; offset < rotationDays; offset++) {
                                const nextIndex = (currentIndex + offset) % rotationDays;
                                const candidate = groupPeople[nextIndex];
                                
                                if (!candidate || isPersonMissingOnDate(candidate, groupNum, date)) {
                                    continue;
                                }
                                
                                // Check if candidate has consecutive conflict on current day
                                let candidateHasConflict = false;
                                const candidateBefore = simulatedWeekendAssignments[dayBeforeKey]?.[groupNum] || 
                                                       (beforeType === 'special-holiday' ? 
                                                        (simulatedSpecialAssignments[`${dayBefore.getFullYear()}-${dayBefore.getMonth()}`]?.[groupNum]?.has(candidate) ? candidate : null) : null);
                                const candidateAfter = simulatedWeekendAssignments[dayAfterKey]?.[groupNum] || 
                                                      (afterType === 'special-holiday' ? 
                                                       (simulatedSpecialAssignments[`${dayAfter.getFullYear()}-${dayAfter.getMonth()}`]?.[groupNum]?.has(candidate) ? candidate : null) : null);
                                
                                if (candidateBefore === candidate || candidateAfter === candidate) {
                                    candidateHasConflict = true;
                                }
                                
                                if (!candidateHasConflict) {
                                    // Found a candidate - now find where they are assigned
                                    for (const checkDateKey in updatedAssignments) {
                                        if (updatedAssignments[checkDateKey]?.[groupNum] === candidate) {
                                            const checkDate = new Date(checkDateKey + 'T00:00:00');
                                            const checkDayType = getDayType(checkDate);
                                            
                                            // Must be a semi-normal day
                                            if (checkDayType === 'semi-normal-day') {
                                                // Check if conflicted person can be assigned to candidate's day
                                                const checkDayBefore = new Date(checkDate);
                                                checkDayBefore.setDate(checkDayBefore.getDate() - 1);
                                                const checkDayAfter = new Date(checkDate);
                                                checkDayAfter.setDate(checkDayAfter.getDate() + 1);
                                                
                                                const checkDayBeforeKey = formatDateKey(checkDayBefore);
                                                const checkDayAfterKey = formatDateKey(checkDayAfter);
                                                
                                                const checkBeforeType = getDayType(checkDayBefore);
                                                const checkAfterType = getDayType(checkDayAfter);
                                                
                                                let conflictedPersonCanSwap = true;
                                                
                                                // Check if conflicted person has conflict on candidate's day
                                                if (checkBeforeType === 'weekend-holiday' || checkBeforeType === 'special-holiday') {
                                                    const personBefore = simulatedWeekendAssignments[checkDayBeforeKey]?.[groupNum] || 
                                                                       (checkBeforeType === 'special-holiday' ? 
                                                                        (simulatedSpecialAssignments[`${checkDayBefore.getFullYear()}-${checkDayBefore.getMonth()}`]?.[groupNum]?.has(currentPerson) ? currentPerson : null) : null);
                                                    if (personBefore === currentPerson) {
                                                        conflictedPersonCanSwap = false;
                                                    }
                                                }
                                                
                                                if (conflictedPersonCanSwap && (checkAfterType === 'weekend-holiday' || checkAfterType === 'special-holiday')) {
                                                    const personAfter = simulatedWeekendAssignments[checkDayAfterKey]?.[groupNum] || 
                                                                       (checkAfterType === 'special-holiday' ? 
                                                                        (simulatedSpecialAssignments[`${checkDayAfter.getFullYear()}-${checkDayAfter.getMonth()}`]?.[groupNum]?.has(currentPerson) ? currentPerson : null) : null);
                                                    if (personAfter === currentPerson) {
                                                        conflictedPersonCanSwap = false;
                                                    }
                                                }
                                                
                                                // Also check if conflicted person is missing on candidate's day
                                                if (conflictedPersonCanSwap && isPersonMissingOnDate(currentPerson, groupNum, checkDate)) {
                                                    conflictedPersonCanSwap = false;
                                                }
                                                
                                                if (conflictedPersonCanSwap) {
                                                    swapCandidate = candidate;
                                                    swapDateKey = checkDateKey;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                    
                                    if (swapCandidate && swapDateKey) {
                                        break; // Found valid swap
                                    }
                                }
                            }
                            
                            if (swapCandidate && swapDateKey) {
                                // Generate unique swap pair ID for color coding
                                const swapPairId = swapPairCounter++;
                                
                                swappedPeople.push({
                                    date: dateKey,
                                    dateStr: date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                                    groupNum: groupNum,
                                    conflictedPerson: currentPerson,
                                    swappedPerson: swapCandidate,
                                    swapDate: swapDateKey,
                                    swapDateStr: new Date(swapDateKey + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                                    swapPairId: swapPairId
                                });
                                
                                // Perform the swap: conflicted person goes to swap date, swapped person goes to conflicted date
                                updatedAssignments[dateKey][groupNum] = swapCandidate;
                                updatedAssignments[swapDateKey][groupNum] = currentPerson;
                                
                                // Store assignment reasons for both swapped people with swap pair ID
                                const swapDateStr = new Date(swapDateKey + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                const currentDateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                storeAssignmentReason(dateKey, groupNum, swapCandidate, 'swap', `Αλλαγή με ${currentPerson} (${currentDateStr})`, currentPerson, swapPairId);
                                storeAssignmentReason(swapDateKey, groupNum, currentPerson, 'swap', `Αλλαγή με ${swapCandidate} (${swapDateStr})`, swapCandidate, swapPairId);
                                
                                // IMPORTANT: Stop processing this conflict - swap found, don't try cross-month swap
                                // Break out of the loop to prevent unnecessary swaps
                                break;
                            } else {
                                // No swap found in current month - try cross-month swap
                                // For semi-normal, check next month throughout the entire month (not just last 3 days)
                                // Calculate current rotation position for semi-normal
                                const currentRotationPosition = currentIndex;
                                
                                // Try to get person from next month
                                const nextMonthResult = getPersonFromNextMonth(dateKey, 'semi', groupNum, month, year, rotationDays, groupPeople, currentRotationPosition);
                                
                                if (nextMonthResult && nextMonthResult.person) {
                                    const nextMonthPerson = nextMonthResult.person;
                                    const swapDayKey = nextMonthResult.swapDayKey;
                                    
                                    // Check if next month person has conflict on current day
                                    let nextMonthPersonHasConflict = false;
                                    const nextPersonBefore = simulatedWeekendAssignments[dayBeforeKey]?.[groupNum] || 
                                                             (beforeType === 'special-holiday' ? 
                                                              (simulatedSpecialAssignments[`${dayBefore.getFullYear()}-${dayBefore.getMonth()}`]?.[groupNum]?.has(nextMonthPerson) ? nextMonthPerson : null) : null);
                                    const nextPersonAfter = simulatedWeekendAssignments[dayAfterKey]?.[groupNum] || 
                                                            (afterType === 'special-holiday' ? 
                                                             (simulatedSpecialAssignments[`${dayAfter.getFullYear()}-${dayAfter.getMonth()}`]?.[groupNum]?.has(nextMonthPerson) ? nextMonthPerson : null) : null);
                                    
                                    if (nextPersonBefore === nextMonthPerson || nextPersonAfter === nextMonthPerson) {
                                        nextMonthPersonHasConflict = true;
                                    }
                                    
                                    // Also check if next month person is missing on current day
                                    if (!nextMonthPersonHasConflict && isPersonMissingOnDate(nextMonthPerson, groupNum, date)) {
                                        nextMonthPersonHasConflict = true;
                                    }
                                    
                                    if (!nextMonthPersonHasConflict) {
                                        // Valid cross-month swap found
                                        // Generate unique swap pair ID for color coding
                                        const swapPairId = swapPairCounter++;
                                        
                                        swappedPeople.push({
                                            date: dateKey,
                                            dateStr: date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                                            groupNum: groupNum,
                                            conflictedPerson: currentPerson,
                                            swappedPerson: nextMonthPerson,
                                            swapDate: swapDayKey,
                                            swapDateStr: new Date(swapDayKey + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                                            swapPairId: swapPairId
                                        });
                                        
                                        // Assign next month person to current day
                                        updatedAssignments[dateKey][groupNum] = nextMonthPerson;
                                        
                                        // Save cross-month swap: conflicted person must be assigned to swapDayKey in next month
                                        if (!crossMonthSwaps[swapDayKey]) {
                                            crossMonthSwaps[swapDayKey] = {};
                                        }
                                        crossMonthSwaps[swapDayKey][groupNum] = currentPerson;
                                        console.log(`[CROSS-MONTH SWAP SEMI] Person ${currentPerson} (had conflict on ${dateKey}) must be assigned to ${swapDayKey} (Group ${groupNum})`);
                                        
                                        // Store assignment reasons for BOTH people in cross-month swap with swap pair ID
                                        const swapDateStr = new Date(swapDayKey + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                        const currentDateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                        // Mark the person from next month who was swapped in (now assigned to current date)
                                        storeAssignmentReason(dateKey, groupNum, nextMonthPerson, 'swap', `Αλλαγή με ${currentPerson} (${currentDateStr} → ${swapDateStr})`, currentPerson, swapPairId);
                                        // Also mark the conflicted person who will be assigned to next month (cross-month swap)
                                        // Note: This will be marked when the next month is calculated, but we can pre-mark it here
                                        storeAssignmentReason(swapDayKey, groupNum, currentPerson, 'swap', `Αλλαγή με ${nextMonthPerson} (${currentDateStr} → ${swapDateStr})`, nextMonthPerson, swapPairId);
                                        
                                        // IMPORTANT: Stop processing this conflict - swap found
                                        break;
                                        
                                        // IMPORTANT: Stop processing this conflict - swap found
                                        break;
                                    }
                                }
                            }
                        }
                    }
                });
                
                // Store final assignments (after swap logic) for saving when OK is pressed
                calculationSteps.finalSemiAssignments = updatedAssignments;
                
                // Show popup with results (will save when OK is pressed)
                showSemiNormalSwapResults(swappedPeople, updatedAssignments);
            } catch (error) {
                console.error('Error running semi-normal swap logic:', error);
            }
        }
        
        // Show popup with semi-normal swap results
        function showSemiNormalSwapResults(swappedPeople, updatedAssignments) {
            let message = '';
            
            if (swappedPeople.length === 0) {
                message = '<div class="alert alert-success"><i class="fas fa-check-circle me-2"></i><strong>Κανένας δεν αλλάχθηκε!</strong><br>Δεν βρέθηκαν συνεχόμενες ημέρες που να απαιτούν αλλαγή.</div>';
            } else {
                message = '<div class="alert alert-info"><i class="fas fa-info-circle me-2"></i><strong>Αλλάχθηκαν ' + swappedPeople.length + ' άτομα:</strong><br><br>';
                message += '<table class="table table-sm table-bordered">';
                message += '<thead><tr><th>Ημερομηνία</th><th>Ομάδα</th><th>Σύγκρουση</th><th>Αλλαγή με</th><th>Ημερομηνία Αλλαγής</th></tr></thead><tbody>';
                
                swappedPeople.forEach(item => {
                    const groupName = getGroupName(item.groupNum);
                    const conflictedPerson = item.conflictedPerson || item.skippedPerson;
                    const swapDateStr = item.swapDateStr || '-';
                    message += `<tr><td>${item.dateStr}</td><td>${groupName}</td><td><strong>${conflictedPerson}</strong></td><td><strong>${item.swappedPerson}</strong></td><td>${swapDateStr}</td></tr>`;
                });
                
                message += '</tbody></table></div>';
            }
            
            // Create and show modal
            const modalHtml = `
                <div class="modal fade" id="semiNormalSwapResultsModal" tabindex="-1">
                    <div class="modal-dialog modal-lg">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title"><i class="fas fa-exchange-alt me-2"></i>Αποτελέσματα Αλλαγών Ημιαργιών</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                ${message}
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-primary" id="semiNormalSwapOkButton" data-bs-dismiss="modal">OK</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Remove existing modal if any
            const existingModal = document.getElementById('semiNormalSwapResultsModal');
            if (existingModal) {
                existingModal.remove();
            }
            
            // Add modal to body
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            
            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('semiNormalSwapResultsModal'));
            modal.show();
            
            // When OK is pressed, save final assignments and proceed to Step 4
            const okButton = document.getElementById('semiNormalSwapOkButton');
            if (okButton) {
                okButton.addEventListener('click', async function() {
                    await saveFinalSemiNormalAssignments(updatedAssignments);
                    // Proceed to Step 4
                    calculationSteps.currentStep = 4;
                    renderCurrentStep();
                });
            }
        }
        
        // Save final semi-normal assignments (after swap logic) to semiNormalAssignments document
        async function saveFinalSemiNormalAssignments(updatedAssignments) {
            try {
                if (!window.db) {
                    console.log('Firebase not ready, skipping final semi-normal assignments save');
                    return;
                }
                
                const db = window.db || firebase.firestore();
                const user = window.auth?.currentUser;
                
                if (!user) {
                    console.log('User not authenticated, skipping final semi-normal assignments save');
                    return;
                }
                
                if (Object.keys(updatedAssignments).length > 0) {
                    const formattedAssignments = {};
                    for (const dateKey in updatedAssignments) {
                        const groups = updatedAssignments[dateKey];
                        const parts = [];
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            if (groups[groupNum]) {
                                parts.push(`${groups[groupNum]} (Ομάδα ${groupNum})`);
                            }
                        }
                        if (parts.length > 0) {
                            formattedAssignments[dateKey] = parts.join(', ');
                        }
                    }
                    
                    const organizedSemi = organizeAssignmentsByMonth(formattedAssignments);
                    const sanitizedSemi = sanitizeForFirestore(organizedSemi);
                    
                    await db.collection('dutyShifts').doc('semiNormalAssignments').set({
                        ...sanitizedSemi,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Saved Step 3 final semi-normal assignments (after swap logic) to semiNormalAssignments document');
                    
                    // Update local memory
                    Object.assign(semiNormalAssignments, formattedAssignments);
                    
                    // Save assignment reasons to Firestore
                    try {
                        if (Object.keys(assignmentReasons).length > 0) {
                            const sanitizedReasons = sanitizeForFirestore(assignmentReasons);
                            await db.collection('dutyShifts').doc('assignmentReasons').set({
                                ...sanitizedReasons,
                                lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                                updatedBy: user.uid
                            });
                            console.log('Saved assignmentReasons to Firestore after semi-normal swaps');
                        }
                    } catch (error) {
                        console.error('Error saving assignmentReasons after semi-normal swaps:', error);
                    }
                }
            } catch (error) {
                console.error('Error saving final semi-normal assignments:', error);
            }
        }

        // Save Step 4 (Normal) assignments to Firestore and run swap logic
        async function saveStep4_Normal() {
            console.log('[STEP 4] saveStep4_Normal() called');
            try {
                if (!window.db) {
                    console.log('[STEP 4] Firebase not ready, skipping Step 4 save');
                    return;
                }
                
                const db = window.db || firebase.firestore();
                const user = window.auth?.currentUser;
                
                if (!user) {
                    console.log('[STEP 4] User not authenticated, skipping Step 4 save');
                    return;
                }
                
                const tempNormalAssignments = calculationSteps.tempNormalAssignments || {};
                const lastNormalRotationPositions = calculationSteps.lastNormalRotationPositions || {};
                
                console.log('[STEP 4] tempNormalAssignments keys:', Object.keys(tempNormalAssignments).length);
                console.log('[STEP 4] lastNormalRotationPositions:', lastNormalRotationPositions);
                
                // First, save normal assignments to assignments document (pre-logic)
                if (Object.keys(tempNormalAssignments).length > 0) {
                    // Convert to format: dateKey -> "Person (Ομάδα 1), Person (Ομάδα 2), ..."
                    const formattedAssignments = {};
                    for (const dateKey in tempNormalAssignments) {
                        const groups = tempNormalAssignments[dateKey];
                        const parts = [];
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            if (groups[groupNum]) {
                                parts.push(`${groups[groupNum]} (Ομάδα ${groupNum})`);
                            }
                        }
                        if (parts.length > 0) {
                            formattedAssignments[dateKey] = parts.join(', ');
                        }
                    }
                    
                    // Save to assignments document (pre-logic) - merge with existing data
                    const organizedAssignments = organizeAssignmentsByMonth(formattedAssignments);
                    const sanitizedAssignments = sanitizeForFirestore(organizedAssignments);
                    
                    // Load existing assignments to merge
                    const existingAssignmentsDoc = await db.collection('dutyShifts').doc('assignments').get();
                    let existingAssignments = {};
                    if (existingAssignmentsDoc.exists) {
                        const existingData = existingAssignmentsDoc.data();
                        // Remove metadata fields
                        delete existingData.lastUpdated;
                        delete existingData.updatedBy;
                        existingAssignments = existingData || {};
                    }
                    
                    // Deep merge: merge at month level, then at date level
                    const mergedAssignments = { ...existingAssignments };
                    for (const monthKey in sanitizedAssignments) {
                        if (!mergedAssignments[monthKey]) {
                            mergedAssignments[monthKey] = {};
                        }
                        // Merge date assignments within this month
                        mergedAssignments[monthKey] = { ...mergedAssignments[monthKey], ...sanitizedAssignments[monthKey] };
                    }
                    
                    await db.collection('dutyShifts').doc('assignments').set({
                        ...mergedAssignments,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Saved Step 4 normal assignments (pre-logic) to assignments document (merged with existing):', Object.keys(tempNormalAssignments).length, 'dates');
                    
                    // DO NOT update normalDayAssignments here - wait until after swap logic completes
                    // This prevents the calendar from showing pre-logic assignments
                    // Object.assign(normalDayAssignments, formattedAssignments);
                }
                
                // Save last rotation positions for normal days
                if (Object.keys(lastNormalRotationPositions).length > 0) {
                    // Update lastRotationPositions for normal days
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        if (lastNormalRotationPositions[groupNum] !== undefined) {
                            lastRotationPositions.normal[groupNum] = lastNormalRotationPositions[groupNum];
                        }
                    }
                    
                    // Save to Firestore
                    const sanitizedPositions = sanitizeForFirestore(lastRotationPositions);
                    await db.collection('dutyShifts').doc('lastRotationPositions').set({
                        ...sanitizedPositions,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Saved Step 4 last rotation positions for normal days to Firestore:', lastNormalRotationPositions);
                }
                
                // Now run swap logic and show popup
                console.log('[STEP 4] Calling runNormalSwapLogic()');
                await runNormalSwapLogic();
                console.log('[STEP 4] runNormalSwapLogic() completed');
            } catch (error) {
                console.error('[STEP 4] Error saving Step 4 (Normal) to Firestore:', error);
            }
        }
        
        // Run swap logic for normal days and show popup with results
        async function runNormalSwapLogic() {
            console.log('[STEP 4] runNormalSwapLogic() called');
            try {
                const dayTypeLists = calculationSteps.dayTypeLists || { normal: [], semi: [], special: [], weekend: [] };
                const normalDays = dayTypeLists.normal || [];
                const specialHolidays = dayTypeLists.special || [];
                const weekendHolidays = dayTypeLists.weekend || [];
                const semiNormalDays = dayTypeLists.semi || [];
                
                // Load special holiday assignments from Step 1 saved data (tempSpecialAssignments)
                const tempSpecialAssignments = calculationSteps.tempSpecialAssignments || {};
                const simulatedSpecialAssignments = {}; // monthKey -> { groupNum -> Set of person names }
                const sortedSpecial = [...specialHolidays].sort();
                
                sortedSpecial.forEach((dateKey) => {
                    const date = new Date(dateKey + 'T00:00:00');
                    const month = date.getMonth();
                    const year = date.getFullYear();
                    const monthKey = `${year}-${month}`;
                    
                    if (!simulatedSpecialAssignments[monthKey]) {
                        simulatedSpecialAssignments[monthKey] = {};
                    }
                    
                    // Check tempSpecialAssignments first (from Step 1), then fall back to specialHolidayAssignments
                    let assignment = null;
                    if (tempSpecialAssignments[dateKey]) {
                        // tempSpecialAssignments is in format: { dateKey: { groupNum: personName } }
                        // Convert to string format for parsing
                        const groups = tempSpecialAssignments[dateKey];
                        const parts = [];
                        for (const groupNum in groups) {
                            const personName = groups[groupNum];
                            if (personName) {
                                parts.push(`${personName} (Ομάδα ${groupNum})`);
                            }
                        }
                        assignment = parts.join(', ');
                    } else {
                        // Fall back to global specialHolidayAssignments (for backward compatibility)
                        assignment = specialHolidayAssignments[dateKey];
                    }
                    
                    if (assignment) {
                        // Ensure assignment is a string (it might be an object if data wasn't flattened correctly)
                        const assignmentStr = typeof assignment === 'string' ? assignment : String(assignment);
                        const parts = assignmentStr.split(',').map(p => p.trim());
                        parts.forEach(part => {
                            const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)$/);
                            if (match) {
                                const personName = match[1].trim();
                                const groupNum = parseInt(match[2]);
                                if (!simulatedSpecialAssignments[monthKey][groupNum]) {
                                    simulatedSpecialAssignments[monthKey][groupNum] = new Set();
                                }
                                simulatedSpecialAssignments[monthKey][groupNum].add(personName);
                            }
                        });
                    }
                });
                
                // Load weekend assignments from Step 2 final results (finalWeekendAssignments)
                const finalWeekendAssignments = calculationSteps.finalWeekendAssignments || {};
                const simulatedWeekendAssignments = {}; // dateKey -> { groupNum -> person name }
                
                // finalWeekendAssignments is in format: { dateKey: { groupNum: personName } }
                for (const dateKey in finalWeekendAssignments) {
                    const groups = finalWeekendAssignments[dateKey];
                    if (groups && typeof groups === 'object') {
                        simulatedWeekendAssignments[dateKey] = { ...groups };
                    }
                }
                
                // Also check global weekendAssignments for any dates not in finalWeekendAssignments (backward compatibility)
                for (const dateKey in weekendAssignments) {
                    if (!simulatedWeekendAssignments[dateKey]) {
                        const assignment = weekendAssignments[dateKey];
                        if (assignment) {
                            // Ensure assignment is a string (it might be an object if data wasn't flattened correctly)
                            const assignmentStr = typeof assignment === 'string' ? assignment : String(assignment);
                            const parts = assignmentStr.split(',').map(p => p.trim());
                            parts.forEach(part => {
                                const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)$/);
                                if (match) {
                                    const personName = match[1].trim();
                                    const groupNum = parseInt(match[2]);
                                    if (!simulatedWeekendAssignments[dateKey]) {
                                        simulatedWeekendAssignments[dateKey] = {};
                                    }
                                    simulatedWeekendAssignments[dateKey][groupNum] = personName;
                                }
                            });
                        }
                    }
                }
                
                // Load semi-normal assignments from Step 3 final results (finalSemiAssignments)
                const finalSemiAssignments = calculationSteps.finalSemiAssignments || {};
                const simulatedSemiAssignments = {}; // dateKey -> { groupNum -> person name }
                
                // finalSemiAssignments is in format: { dateKey: { groupNum: personName } }
                for (const dateKey in finalSemiAssignments) {
                    const groups = finalSemiAssignments[dateKey];
                    if (groups && typeof groups === 'object') {
                        simulatedSemiAssignments[dateKey] = { ...groups };
                    }
                }
                
                // Also check global semiNormalAssignments for any dates not in finalSemiAssignments (backward compatibility)
                for (const dateKey in semiNormalAssignments) {
                    if (!simulatedSemiAssignments[dateKey]) {
                        const assignment = semiNormalAssignments[dateKey];
                        if (assignment) {
                            // Ensure assignment is a string (it might be an object if data wasn't flattened correctly)
                            const assignmentStr = typeof assignment === 'string' ? assignment : String(assignment);
                            const parts = assignmentStr.split(',').map(p => p.trim());
                            parts.forEach(part => {
                                const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)$/);
                                if (match) {
                                    const personName = match[1].trim();
                                    const groupNum = parseInt(match[2]);
                                    if (!simulatedSemiAssignments[dateKey]) {
                                        simulatedSemiAssignments[dateKey] = {};
                                    }
                                    simulatedSemiAssignments[dateKey][groupNum] = personName;
                                }
                            });
                        }
                    }
                }
                
                // Track swapped people and replacements
                const swappedPeople = []; // Array of { date, groupNum, skippedPerson, swappedPerson }
                const sortedNormal = [...normalDays].sort();
                const updatedAssignments = {}; // dateKey -> { groupNum -> personName }
                
                // Track swap pairs for color coding: swapPairId -> { color, person1, person2, date1, date2 }
                // Find maximum existing swapPairId to ensure unique IDs
                let maxSwapPairId = -1;
                for (const dateKey in assignmentReasons) {
                    for (const groupNumStr in assignmentReasons[dateKey]) {
                        for (const personName in assignmentReasons[dateKey][groupNumStr]) {
                            const reason = assignmentReasons[dateKey][groupNumStr][personName];
                            if (reason && reason.swapPairId !== null && reason.swapPairId !== undefined) {
                                const id = typeof reason.swapPairId === 'number' ? reason.swapPairId : parseInt(reason.swapPairId);
                                if (!isNaN(id) && id > maxSwapPairId) {
                                    maxSwapPairId = id;
                                }
                            }
                        }
                    }
                }
                let swapPairCounter = maxSwapPairId + 1; // Start from max + 1 to ensure uniqueness
                const swapPairs = {}; // swapPairId -> { color, people: [{dateKey, groupNum, personName}, ...] }
                
                // Generate colors for swap pairs (different colors for each pair)
                const swapColors = [
                    { border: '#FF1744', bg: 'rgba(255, 23, 68, 0.15)' }, // Bright Red
                    { border: '#00E676', bg: 'rgba(0, 230, 118, 0.15)' }, // Bright Green
                    { border: '#FFD600', bg: 'rgba(255, 214, 0, 0.15)' }, // Bright Yellow
                    { border: '#00B0FF', bg: 'rgba(0, 176, 255, 0.15)' }, // Bright Blue
                    { border: '#D500F9', bg: 'rgba(213, 0, 249, 0.15)' }, // Bright Purple
                    { border: '#FF6D00', bg: 'rgba(255, 109, 0, 0.15)' }, // Bright Orange
                    { border: '#00E5FF', bg: 'rgba(0, 229, 255, 0.15)' }, // Bright Cyan
                    { border: '#FF4081', bg: 'rgba(255, 64, 129, 0.15)' }  // Bright Pink
                ];
                
                // Load current normal assignments from tempNormalAssignments
                const tempNormalAssignments = calculationSteps.tempNormalAssignments || {};
                for (const dateKey in tempNormalAssignments) {
                    const groups = tempNormalAssignments[dateKey];
                    updatedAssignments[dateKey] = { ...groups };
                }
                
                // Track people who have already been swapped to prevent re-swapping
                const swappedPeopleSet = new Set(); // Format: "dateKey:groupNum:personName"
                
                // Run swap logic (check for consecutive conflicts)
                sortedNormal.forEach((dateKey) => {
                    const date = new Date(dateKey + 'T00:00:00');
                    
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        const groupData = groups[groupNum] || { normal: [] };
                        const groupPeople = groupData.normal || [];
                        
                        if (groupPeople.length === 0) continue;
                        
                        const currentPerson = updatedAssignments[dateKey]?.[groupNum];
                        if (!currentPerson) continue;
                        
                        // Skip if this person has already been swapped (prevent re-swapping)
                        const swapKey = `${dateKey}:${groupNum}:${currentPerson}`;
                        if (swappedPeopleSet.has(swapKey)) {
                            continue; // Already swapped, skip
                        }
                        
                        // Check for consecutive conflicts using enhanced hasConsecutiveDuty
                        const simulatedAssignments = {
                            special: simulatedSpecialAssignments,
                            weekend: simulatedWeekendAssignments,
                            semi: simulatedSemiAssignments,
                            normal: updatedAssignments
                        };
                        
                        const hasConsecutiveConflict = hasConsecutiveDuty(dateKey, currentPerson, groupNum, simulatedAssignments);
                        
                        // Debug logging to help identify why conflicts aren't detected
                        if (hasConsecutiveConflict) {
                            console.log(`[SWAP DEBUG] Found conflict for ${currentPerson} on ${dateKey} (Group ${groupNum})`);
                        }
                        
                        if (hasConsecutiveConflict) {
                            const dayOfWeek = date.getDay(); // 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday
                            const month = date.getMonth();
                            const year = date.getFullYear();
                            
                            let swapDayKey = null;
                            let swapDayIndex = null;
                            let swapFound = false;
                            
                            // SEPARATE LOGIC: Monday/Wednesday vs Tuesday/Thursday
                            // Monday (1) or Wednesday (3) - Monday ↔ Wednesday logic
                            if (dayOfWeek === 1 || dayOfWeek === 3) {
                                const alternativeDayOfWeek = dayOfWeek === 1 ? 3 : 1; // Monday ↔ Wednesday
                                
                                // MONDAY/WEDNESDAY - Step 1: Try alternative day in same week
                                const sameWeekDate = new Date(date);
                                const daysToAdd = alternativeDayOfWeek - dayOfWeek;
                                sameWeekDate.setDate(date.getDate() + daysToAdd);
                                const sameWeekKey = formatDateKey(sameWeekDate);
                                
                                if (isSameWeek(date, sameWeekDate) && updatedAssignments[sameWeekKey]?.[groupNum]) {
                                    const swapCandidate = updatedAssignments[sameWeekKey][groupNum];
                                    if (!isPersonMissingOnDate(swapCandidate, groupNum, sameWeekDate) &&
                                        !hasConsecutiveDuty(sameWeekKey, swapCandidate, groupNum, simulatedAssignments) &&
                                        !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                        swapDayKey = sameWeekKey;
                                        swapDayIndex = normalDays.indexOf(sameWeekKey);
                                        swapFound = true;
                                    }
                                }
                                
                                // MONDAY/WEDNESDAY - Step 2: ONLY if Step 1 failed, try same day of week in same month
                                if (!swapFound) {
                                    const nextSameDay = new Date(year, month, date.getDate() + 7);
                                    if (nextSameDay.getMonth() === month) {
                                        const nextSameDayKey = formatDateKey(nextSameDay);
                                        if (updatedAssignments[nextSameDayKey]?.[groupNum]) {
                                            const swapCandidate = updatedAssignments[nextSameDayKey][groupNum];
                                            if (!isPersonMissingOnDate(swapCandidate, groupNum, nextSameDay) &&
                                                !hasConsecutiveDuty(nextSameDayKey, swapCandidate, groupNum, simulatedAssignments) &&
                                                !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                swapDayKey = nextSameDayKey;
                                                swapDayIndex = normalDays.indexOf(nextSameDayKey);
                                                swapFound = true;
                                            }
                                        }
                                    }
                                }
                                
                                // MONDAY/WEDNESDAY - Step 3: ONLY if Step 2 failed, try alternative day in week after next OR next month
                                if (!swapFound) {
                                    // Try week after next (2 weeks later) - alternative day
                                    const weekAfterNextDate = new Date(date);
                                    weekAfterNextDate.setDate(date.getDate() + 14);
                                    // Adjust to alternative day of week
                                    const currentDayOfWeek = weekAfterNextDate.getDay();
                                    const daysToAdjust = alternativeDayOfWeek - currentDayOfWeek;
                                    weekAfterNextDate.setDate(weekAfterNextDate.getDate() + daysToAdjust);
                                    const weekAfterNextKey = formatDateKey(weekAfterNextDate);
                                    
                                    if (isWeekAfterNext(date, weekAfterNextDate) && updatedAssignments[weekAfterNextKey]?.[groupNum]) {
                                        const swapCandidate = updatedAssignments[weekAfterNextKey][groupNum];
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, weekAfterNextDate) &&
                                            !hasConsecutiveDuty(weekAfterNextKey, swapCandidate, groupNum, simulatedAssignments) &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            swapDayKey = weekAfterNextKey;
                                            swapDayIndex = normalDays.indexOf(weekAfterNextKey);
                                            swapFound = true;
                                        }
                                    }
                                    
                                    // If still not found, try next month - alternative day
                                    if (!swapFound) {
                                        const nextMonthDate = new Date(year, month + 1, date.getDate());
                                        // Adjust to alternative day of week
                                        while (nextMonthDate.getDay() !== alternativeDayOfWeek && nextMonthDate.getDate() <= 31) {
                                            nextMonthDate.setDate(nextMonthDate.getDate() + 1);
                                        }
                                        if (nextMonthDate.getDate() <= 31) {
                                            const nextMonthKey = formatDateKey(nextMonthDate);
                                            if (normalDays.includes(nextMonthKey) && updatedAssignments[nextMonthKey]?.[groupNum]) {
                                                const swapCandidate = updatedAssignments[nextMonthKey][groupNum];
                                                if (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthDate) &&
                                                    !hasConsecutiveDuty(nextMonthKey, swapCandidate, groupNum, simulatedAssignments) &&
                                                    !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                    swapDayKey = nextMonthKey;
                                                    swapDayIndex = normalDays.indexOf(nextMonthKey);
                                                    swapFound = true;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            // TUESDAY/THURSDAY - Separate logic block
                            else if (dayOfWeek === 2 || dayOfWeek === 4) {
                                const alternativeDayOfWeek = dayOfWeek === 2 ? 4 : 2; // Tuesday ↔ Thursday
                                
                                // TUESDAY/THURSDAY - Step 1a: Try next same day of week in same month
                                const nextSameDay = new Date(year, month, date.getDate() + 7);
                                if (nextSameDay.getMonth() === month) {
                                    const nextSameDayKey = formatDateKey(nextSameDay);
                                    if (updatedAssignments[nextSameDayKey]?.[groupNum]) {
                                        const swapCandidate = updatedAssignments[nextSameDayKey][groupNum];
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, nextSameDay) &&
                                            !hasConsecutiveDuty(nextSameDayKey, swapCandidate, groupNum, simulatedAssignments) &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            swapDayKey = nextSameDayKey;
                                            swapDayIndex = normalDays.indexOf(nextSameDayKey);
                                            swapFound = true;
                                        }
                                    }
                                }
                                
                                // TUESDAY/THURSDAY - Step 1b: ONLY if Step 1a failed, try next same day of week in next month (cross-month)
                                if (!swapFound) {
                                    const nextMonthSameDay = new Date(year, month + 1, date.getDate());
                                    if (nextMonthSameDay.getDate() === date.getDate()) {
                                        const nextMonthKey = formatDateKey(nextMonthSameDay);
                                        if (normalDays.includes(nextMonthKey) && updatedAssignments[nextMonthKey]?.[groupNum]) {
                                            const swapCandidate = updatedAssignments[nextMonthKey][groupNum];
                                            if (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthSameDay) &&
                                                !hasConsecutiveDuty(nextMonthKey, swapCandidate, groupNum, simulatedAssignments) &&
                                                !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                swapDayKey = nextMonthKey;
                                                swapDayIndex = normalDays.indexOf(nextMonthKey);
                                                swapFound = true;
                                            }
                                        }
                                    }
                                }
                                
                                // TUESDAY/THURSDAY - Step 2: ONLY if Step 1 failed, try alternative day in same week
                                if (!swapFound) {
                                    const sameWeekDate = new Date(date);
                                    const daysToAdd = alternativeDayOfWeek - dayOfWeek;
                                    sameWeekDate.setDate(date.getDate() + daysToAdd);
                                    const sameWeekKey = formatDateKey(sameWeekDate);
                                    
                                    if (isSameWeek(date, sameWeekDate) && updatedAssignments[sameWeekKey]?.[groupNum]) {
                                        const swapCandidate = updatedAssignments[sameWeekKey][groupNum];
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, sameWeekDate) &&
                                            !hasConsecutiveDuty(sameWeekKey, swapCandidate, groupNum, simulatedAssignments) &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            swapDayKey = sameWeekKey;
                                            swapDayIndex = normalDays.indexOf(sameWeekKey);
                                            swapFound = true;
                                        }
                                    }
                                }
                                
                                // TUESDAY/THURSDAY - Step 3: ONLY if Step 2 failed, try next alternative day in same month
                                if (!swapFound) {
                                    // Find next occurrence of alternative day (Tuesday/Thursday) in same month
                                    let nextAlternativeDay = new Date(date);
                                    let daysToAdd = alternativeDayOfWeek - dayOfWeek;
                                    if (daysToAdd < 0) daysToAdd += 7; // If alternative is earlier in week, go to next week
                                    if (daysToAdd === 0) daysToAdd = 7; // If same day, go to next week
                                    nextAlternativeDay.setDate(date.getDate() + daysToAdd);
                                    
                                    if (nextAlternativeDay.getMonth() === month) {
                                        const nextAlternativeKey = formatDateKey(nextAlternativeDay);
                                        if (updatedAssignments[nextAlternativeKey]?.[groupNum]) {
                                            const swapCandidate = updatedAssignments[nextAlternativeKey][groupNum];
                                            if (!isPersonMissingOnDate(swapCandidate, groupNum, nextAlternativeDay) &&
                                                !hasConsecutiveDuty(nextAlternativeKey, swapCandidate, groupNum, simulatedAssignments) &&
                                                !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                swapDayKey = nextAlternativeKey;
                                                swapDayIndex = normalDays.indexOf(nextAlternativeKey);
                                                swapFound = true;
                                            }
                                        }
                                    }
                                }
                                
                                // TUESDAY/THURSDAY - Step 4: ONLY if Step 3 failed, try next alternative day in next month (cross-month)
                                if (!swapFound) {
                                    // Find next occurrence of alternative day in next month
                                    let nextMonthAlternative = new Date(year, month + 1, date.getDate());
                                    // Adjust to the correct day of week
                                    while (nextMonthAlternative.getDay() !== alternativeDayOfWeek && nextMonthAlternative.getDate() <= 31) {
                                        nextMonthAlternative.setDate(nextMonthAlternative.getDate() + 1);
                                    }
                                    
                                    if (nextMonthAlternative.getDate() > 0 && nextMonthAlternative.getDate() <= 31) {
                                        const nextMonthAltKey = formatDateKey(nextMonthAlternative);
                                        if (normalDays.includes(nextMonthAltKey) && updatedAssignments[nextMonthAltKey]?.[groupNum]) {
                                            const swapCandidate = updatedAssignments[nextMonthAltKey][groupNum];
                                            if (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthAlternative) &&
                                                !hasConsecutiveDuty(nextMonthAltKey, swapCandidate, groupNum, simulatedAssignments) &&
                                                !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                swapDayKey = nextMonthAltKey;
                                                swapDayIndex = normalDays.indexOf(nextMonthAltKey);
                                                swapFound = true;
                                            }
                                        }
                                    }
                                }
                            }
                            
                            // Perform swap if found - STOP after finding valid swap (don't continue to other steps)
                            if (swapFound && swapDayKey && swapDayIndex !== null && swapDayIndex >= 0) {
                                const swapCandidate = updatedAssignments[swapDayKey][groupNum];
                                
                                // Generate unique swap pair ID for color coding
                                const swapPairId = swapPairCounter++;
                                const swapColor = swapColors[swapPairId % swapColors.length];
                                
                                // Store swap pair information
                                swapPairs[swapPairId] = {
                                    color: swapColor,
                                    people: [
                                        { dateKey: dateKey, groupNum: groupNum, personName: currentPerson },
                                        { dateKey: swapDayKey, groupNum: groupNum, personName: swapCandidate }
                                    ]
                                };
                                
                                swappedPeople.push({
                                    date: dateKey,
                                    dateStr: date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                                    groupNum: groupNum,
                                    skippedPerson: currentPerson,
                                    swappedPerson: swapCandidate,
                                    swapDate: swapDayKey,
                                    swapDateStr: new Date(swapDayKey + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                                    swapPairId: swapPairId
                                });
                                
                                // Perform the swap: conflicted person goes to swap date, swapped person goes to conflicted date
                                updatedAssignments[dateKey][groupNum] = swapCandidate;
                                updatedAssignments[swapDayKey][groupNum] = currentPerson;
                                
                                // Store assignment reasons for BOTH people involved in the swap with swap pair ID
                                const swapDateStr = new Date(swapDayKey + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                const currentDateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                storeAssignmentReason(dateKey, groupNum, swapCandidate, 'swap', `Αλλαγή με ${currentPerson} (${currentDateStr})`, currentPerson, swapPairId);
                                storeAssignmentReason(swapDayKey, groupNum, currentPerson, 'swap', `Αλλαγή με ${swapCandidate} (${swapDateStr})`, swapCandidate, swapPairId);
                                
                                // Mark both people as swapped to prevent re-swapping
                                swappedPeopleSet.add(`${dateKey}:${groupNum}:${currentPerson}`);
                                swappedPeopleSet.add(`${swapDayKey}:${groupNum}:${swapCandidate}`);
                                
                                // IMPORTANT: Stop processing this conflict - swap found, don't try other steps
                                // Continue to next group/person - swap is complete
                                continue;
                            }
                        }
                    }
                });
                
                // Store final assignments (after swap logic) for saving when OK is pressed
                calculationSteps.finalNormalAssignments = updatedAssignments;
                
                // Merge preview swaps with actual swaps (remove duplicates)
                const previewSwaps = calculationSteps.previewNormalSwaps || [];
                const allSwappedPeople = [...swappedPeople];
                
                // Add preview swaps that aren't already in swappedPeople
                previewSwaps.forEach(previewSwap => {
                    const exists = allSwappedPeople.some(swap => 
                        swap.date === previewSwap.date && 
                        swap.groupNum === previewSwap.groupNum && 
                        swap.skippedPerson === previewSwap.skippedPerson
                    );
                    if (!exists) {
                        allSwappedPeople.push(previewSwap);
                    }
                });
                
                console.log('[STEP 4] Swap logic completed. Swapped people:', allSwappedPeople.length, '(Preview:', previewSwaps.length, ', Actual:', swappedPeople.length, ')');
                console.log('[STEP 4] Calling showNormalSwapResults()');
                
                // Show popup with results (will save when OK is pressed)
                showNormalSwapResults(allSwappedPeople, updatedAssignments);
            } catch (error) {
                console.error('[STEP 4] Error running normal swap logic:', error);
            }
        }
        
        // Show popup with normal swap results
        function showNormalSwapResults(swappedPeople, updatedAssignments) {
            console.log('[STEP 4] showNormalSwapResults() called with', swappedPeople.length, 'swapped people');
            let message = '';
            
            if (swappedPeople.length === 0) {
                message = '<div class="alert alert-success"><i class="fas fa-check-circle me-2"></i><strong>Κανένας δεν αλλάχθηκε!</strong><br>Δεν βρέθηκαν συνεχόμενες ημέρες που να απαιτούν αλλαγή.</div>';
            } else {
                message = '<div class="alert alert-info"><i class="fas fa-info-circle me-2"></i><strong>Αλλάχθηκαν ' + swappedPeople.length + ' άτομα:</strong><br><br>';
                message += '<table class="table table-sm table-bordered">';
                message += '<thead><tr><th>Ημερομηνία</th><th>Ομάδα</th><th>Παραλείφθηκε</th><th>Αντικαταστάθηκε από</th><th>Ημερομηνία Αλλαγής</th></tr></thead><tbody>';
                
                swappedPeople.forEach(item => {
                    const groupName = getGroupName(item.groupNum);
                    const swapDateStr = item.swapDateStr || item.dateStr;
                    message += `<tr><td>${item.dateStr}</td><td>${groupName}</td><td><strong>${item.skippedPerson}</strong></td><td><strong>${item.swappedPerson}</strong></td><td>${swapDateStr}</td></tr>`;
                });
                
                message += '</tbody></table></div>';
            }
            
            // Create and show modal
            const modalHtml = `
                <div class="modal fade" id="normalSwapResultsModal" tabindex="-1">
                    <div class="modal-dialog modal-lg">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title"><i class="fas fa-exchange-alt me-2"></i>Αποτελέσματα Αλλαγών Καθημερινών</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                ${message}
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-primary" id="normalSwapOkButton" data-bs-dismiss="modal">OK</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Remove existing modal if any
            const existingModal = document.getElementById('normalSwapResultsModal');
            if (existingModal) {
                existingModal.remove();
            }
            
            // Add modal to body
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            
            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('normalSwapResultsModal'));
            modal.show();
            
            // When OK is pressed, save final assignments and close modal
            const okButton = document.getElementById('normalSwapOkButton');
            if (okButton) {
                okButton.addEventListener('click', async function() {
                    await saveFinalNormalAssignments(updatedAssignments);
                    // Close the step-by-step calculation modal
                    const stepModal = bootstrap.Modal.getInstance(document.getElementById('stepByStepCalculationModal'));
                    if (stepModal) {
                        stepModal.hide();
                    }
                    // Reload calendar to show results
                    location.reload();
                });
            }
        }
        
        // Save final normal assignments (after swap logic) to normalDayAssignments document
        async function saveFinalNormalAssignments(updatedAssignments) {
            try {
                if (!window.db) {
                    console.log('Firebase not ready, skipping final normal assignments save');
                    return;
                }
                
                const db = window.db || firebase.firestore();
                const user = window.auth?.currentUser;
                
                if (!user) {
                    console.log('User not authenticated, skipping final normal assignments save');
                    return;
                }
                
                if (Object.keys(updatedAssignments).length > 0) {
                    const formattedAssignments = {};
                    for (const dateKey in updatedAssignments) {
                        const groups = updatedAssignments[dateKey];
                        const parts = [];
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            if (groups[groupNum]) {
                                parts.push(`${groups[groupNum]} (Ομάδα ${groupNum})`);
                            }
                        }
                        if (parts.length > 0) {
                            formattedAssignments[dateKey] = parts.join(', ');
                        }
                    }
                    
                    const organizedNormal = organizeAssignmentsByMonth(formattedAssignments);
                    const sanitizedNormal = sanitizeForFirestore(organizedNormal);
                    
                    await db.collection('dutyShifts').doc('normalDayAssignments').set({
                        ...sanitizedNormal,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Saved Step 4 final normal assignments (after swap logic) to normalDayAssignments document');
                    
                    // Update local memory
                    Object.assign(normalDayAssignments, formattedAssignments);
                    
                    // Save assignment reasons to Firestore
                    try {
                        if (Object.keys(assignmentReasons).length > 0) {
                            const sanitizedReasons = sanitizeForFirestore(assignmentReasons);
                            await db.collection('dutyShifts').doc('assignmentReasons').set({
                                ...sanitizedReasons,
                                lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                                updatedBy: user.uid
                            });
                            console.log('Saved assignmentReasons to Firestore after normal swaps');
                        }
                    } catch (error) {
                        console.error('Error saving assignmentReasons after normal swaps:', error);
                    }
                }
            } catch (error) {
                console.error('Error saving final normal assignments:', error);
            }
        }

        function goToPreviousStep() {
            if (calculationSteps.currentStep > 1) {
                calculationSteps.currentStep--;
                renderCurrentStep();
            }
        }

        // Cancel step-by-step calculation
        function cancelStepByStepCalculation() {
            const modal = bootstrap.Modal.getInstance(document.getElementById('stepByStepCalculationModal'));
            if (modal) {
                modal.hide();
            }
            // Remove backdrop if it exists
            const backdrop = document.querySelector('.modal-backdrop');
            if (backdrop) {
                backdrop.remove();
            }
            // Remove modal-open class from body
            document.body.classList.remove('modal-open');
            document.body.style.overflow = '';
            document.body.style.paddingRight = '';
        }

        // Execute final calculation
        async function executeCalculation() {
            let loadingAlert = null;
            try {
                const stepModal = bootstrap.Modal.getInstance(document.getElementById('stepByStepCalculationModal'));
                if (stepModal) {
                    stepModal.hide();
                }
                
                // Show loading indicator
                loadingAlert = document.createElement('div');
                loadingAlert.className = 'alert alert-info position-fixed top-50 start-50 translate-middle';
                loadingAlert.style.zIndex = '9999';
                loadingAlert.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Υπολογισμός και αποθήκευση...';
                document.body.appendChild(loadingAlert);
            
            // Execute the actual calculation
            const startDate = calculationSteps.startDate;
            const endDate = calculationSteps.endDate;
            const preserveExisting = calculationSteps.preserveExisting;
            
            // Clear assignments only for the selected date range if not preserving
            // BUT NEVER delete critical assignments (from last duties)
            if (!preserveExisting) {
                const dateIterator = new Date(startDate);
                while (dateIterator <= endDate) {
                    const key = formatDateKey(dateIterator);
                    // Check if this is a critical assignment - if so, preserve it
                    if (criticalAssignments[key] && criticalAssignments[key].length > 0) {
                        // This is a critical assignment - restore it if it was cleared
                        const criticalPeople = criticalAssignments[key];
                        dutyAssignments[key] = criticalPeople.join(', ');
                    } else {
                        // Not critical, safe to delete
                        delete dutyAssignments[key];
                            // Also delete from day-type-specific assignments
                            delete normalDayAssignments[key];
                            delete semiNormalAssignments[key];
                            delete weekendAssignments[key];
                            delete specialHolidayAssignments[key];
                    }
                    dateIterator.setDate(dateIterator.getDate() + 1);
                }
            }
            
            // Load temp assignments from Firestore (use preview logic results)
            let tempAssignments = calculationSteps.tempAssignments;
            console.log('[CALCULATE DEBUG] Checking for temp assignments in memory:', !!tempAssignments);
            
            if (!tempAssignments) {
                // Try to load from Firestore if not in memory
                if (loadingAlert && loadingAlert.parentNode) {
                    loadingAlert.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Φόρτωση προσωρινών υπολογισμών...';
                }
                try {
                    const db = window.db || firebase.firestore();
                    const tempDoc = await db.collection('dutyShifts').doc('tempAssignments').get();
                    if (tempDoc.exists) {
                        tempAssignments = tempDoc.data();
                        // Remove metadata
                        delete tempAssignments.lastUpdated;
                        delete tempAssignments.updatedBy;
                        console.log('[CALCULATE DEBUG] Loaded temp assignments from Firestore');
                        console.log('[CALCULATE DEBUG] Temp assignments keys:', Object.keys(tempAssignments));
                    } else {
                        console.warn('[CALCULATE DEBUG] No temp assignments document found in Firestore');
                    }
                } catch (error) {
                    console.error('[CALCULATE DEBUG] Error loading temp assignments:', error);
                }
            } else {
                console.log('[CALCULATE DEBUG] Using temp assignments from memory');
                console.log('[CALCULATE DEBUG] Temp assignments keys:', Object.keys(tempAssignments));
            }
            
            if (tempAssignments) {
                console.log('[CALCULATE DEBUG] Temp assignments found! Converting to permanent format...');
                console.log('[CALCULATE DEBUG] Normal assignments count:', Object.keys(tempAssignments.normal || {}).length);
                console.log('[CALCULATE DEBUG] Semi assignments count:', Object.keys(tempAssignments.semi || {}).length);
                console.log('[CALCULATE DEBUG] Weekend assignments count:', Object.keys(tempAssignments.weekend || {}).length);
                console.log('[CALCULATE DEBUG] Special assignments months:', Object.keys(tempAssignments.special || {}).length);
                // Convert temp assignments to permanent format
                // Special holidays: monthKey -> { groupNum -> [person names] }
                // Recalculate assignments per date using the same logic as preview
                const dateIterator = new Date(startDate);
                while (dateIterator <= endDate) {
                    const dateKey = formatDateKey(dateIterator);
                    if (getDayType(dateIterator) === 'special-holiday') {
                        const month = dateIterator.getMonth();
                        const year = dateIterator.getFullYear();
                        const monthKey = `${year}-${month}`;
                        
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            const groupData = groups[groupNum] || { special: [] };
                            const groupPeople = groupData.special || [];
                            
                            if (groupPeople.length > 0) {
                                // Check if this person is in the temp assignments for this month/group
                                const tempPeople = tempAssignments.special?.[monthKey]?.[groupNum] || [];
                                
                                // Use rotation to determine which person (same logic as preview)
                                const rotationDays = groupPeople.length;
                                const rotationPosition = getRotationPosition(dateIterator, 'special', groupNum) % rotationDays;
                                let assignedPerson = groupPeople[rotationPosition];
                                
                                // Check if assigned person is missing, if so find next in rotation
                                if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, dateIterator)) {
                                    for (let offset = 1; offset < rotationDays; offset++) {
                                        const nextIndex = (rotationPosition + offset) % rotationDays;
                                        const candidate = groupPeople[nextIndex];
                                        if (candidate && !isPersonMissingOnDate(candidate, groupNum, dateIterator)) {
                                            assignedPerson = candidate;
                                            break;
                                        }
                                    }
                                }
                                
                                // Only assign if person is in temp assignments (was calculated in preview)
                                if (assignedPerson && tempPeople.includes(assignedPerson)) {
                                    if (!specialHolidayAssignments[dateKey]) {
                                        specialHolidayAssignments[dateKey] = '';
                                    }
                                    const assignment = `${assignedPerson} (Ομάδα ${groupNum})`;
                                    if (!specialHolidayAssignments[dateKey].includes(assignment)) {
                                        specialHolidayAssignments[dateKey] = specialHolidayAssignments[dateKey] 
                                            ? `${specialHolidayAssignments[dateKey]}, ${assignment}`
                                            : assignment;
                                    }
                                }
                            }
                        }
                    }
                    dateIterator.setDate(dateIterator.getDate() + 1);
                }
                
                // Weekend assignments: dateKey -> { groupNum -> person }
                for (const dateKey in tempAssignments.weekend || {}) {
                    for (const groupNum in tempAssignments.weekend[dateKey] || {}) {
                        const person = tempAssignments.weekend[dateKey][groupNum];
                        if (person) {
                            if (!weekendAssignments[dateKey]) {
                                weekendAssignments[dateKey] = '';
                            }
                            const assignment = `${person} (Ομάδα ${groupNum})`;
                            if (!weekendAssignments[dateKey].includes(assignment)) {
                                weekendAssignments[dateKey] = weekendAssignments[dateKey]
                                    ? `${weekendAssignments[dateKey]}, ${assignment}`
                                    : assignment;
                            }
                        }
                    }
                }
                
                // Semi-normal assignments: dateKey -> { groupNum -> person }
                for (const dateKey in tempAssignments.semi || {}) {
                    for (const groupNum in tempAssignments.semi[dateKey] || {}) {
                        const person = tempAssignments.semi[dateKey][groupNum];
                        if (person) {
                            if (!semiNormalAssignments[dateKey]) {
                                semiNormalAssignments[dateKey] = '';
                            }
                            const assignment = `${person} (Ομάδα ${groupNum})`;
                            if (!semiNormalAssignments[dateKey].includes(assignment)) {
                                semiNormalAssignments[dateKey] = semiNormalAssignments[dateKey]
                                    ? `${semiNormalAssignments[dateKey]}, ${assignment}`
                                    : assignment;
                            }
                        }
                    }
                }
                
                // Normal day assignments: dateKey -> { groupNum -> person }
                for (const dateKey in tempAssignments.normal || {}) {
                    for (const groupNum in tempAssignments.normal[dateKey] || {}) {
                        const person = tempAssignments.normal[dateKey][groupNum];
                        if (person) {
                            if (!normalDayAssignments[dateKey]) {
                                normalDayAssignments[dateKey] = '';
                            }
                            const assignment = `${person} (Ομάδα ${groupNum})`;
                            if (!normalDayAssignments[dateKey].includes(assignment)) {
                                normalDayAssignments[dateKey] = normalDayAssignments[dateKey]
                                    ? `${normalDayAssignments[dateKey]}, ${assignment}`
                                    : assignment;
                            }
                        }
                    }
                }
                
                // Also update legacy dutyAssignments for backward compatibility
                for (const dateKey in normalDayAssignments) {
                    dutyAssignments[dateKey] = normalDayAssignments[dateKey];
                }
                for (const dateKey in semiNormalAssignments) {
                    if (dutyAssignments[dateKey]) {
                        dutyAssignments[dateKey] = `${dutyAssignments[dateKey]}, ${semiNormalAssignments[dateKey]}`;
                    } else {
                        dutyAssignments[dateKey] = semiNormalAssignments[dateKey];
                    }
                }
                for (const dateKey in weekendAssignments) {
                    if (dutyAssignments[dateKey]) {
                        dutyAssignments[dateKey] = `${dutyAssignments[dateKey]}, ${weekendAssignments[dateKey]}`;
                    } else {
                        dutyAssignments[dateKey] = weekendAssignments[dateKey];
                    }
                }
                for (const dateKey in specialHolidayAssignments) {
                    if (dutyAssignments[dateKey]) {
                        dutyAssignments[dateKey] = `${dutyAssignments[dateKey]}, ${specialHolidayAssignments[dateKey]}`;
                    } else {
                        dutyAssignments[dateKey] = specialHolidayAssignments[dateKey];
                    }
                }
                
                console.log('[CALCULATE DEBUG] Converted temp assignments to permanent format');
                console.log('[CALCULATE DEBUG] Final assignment counts:');
                console.log('[CALCULATE DEBUG] - normalDayAssignments:', Object.keys(normalDayAssignments).length);
                console.log('[CALCULATE DEBUG] - semiNormalAssignments:', Object.keys(semiNormalAssignments).length);
                console.log('[CALCULATE DEBUG] - weekendAssignments:', Object.keys(weekendAssignments).length);
                console.log('[CALCULATE DEBUG] - specialHolidayAssignments:', Object.keys(specialHolidayAssignments).length);
                console.log('[CALCULATE DEBUG] Sample normal assignments:', Object.keys(normalDayAssignments).slice(0, 3).map(key => ({ date: key, assignment: normalDayAssignments[key] })));
            } else {
                // No temp assignments found - this should not happen if preview was shown
                console.error('No temp assignments found! Please go through the preview steps first.');
                alert('Σφάλμα: Δεν βρέθηκαν προσωρινοί υπολογισμοί. Παρακαλώ πηγαίνετε πρώτα από τα βήματα προεπισκόπησης.');
                if (loadingAlert && loadingAlert.parentNode) {
                    document.body.removeChild(loadingAlert);
                }
                return;
            }
            
                // Save last rotation positions before saving assignments
                // This tracks where rotation left off for each day type and group (ignoring swaps)
                // The lastRotationPositions object is updated during calculation, so we just need to save it
                try {
                    if (!window.db) {
                        console.log('Firebase not ready, skipping lastRotationPositions save');
                    } else {
                        const db = window.db || firebase.firestore();
                        const user = window.auth?.currentUser;
                        if (user) {
                            const sanitizedPositions = sanitizeForFirestore(lastRotationPositions);
                            await db.collection('dutyShifts').doc('lastRotationPositions').set({
                                ...sanitizedPositions,
                                lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                                updatedBy: user.uid
                            });
                            console.log('Saved lastRotationPositions to Firestore:', lastRotationPositions);
                        }
                    }
                } catch (error) {
                    console.error('Error saving lastRotationPositions:', error);
                }
                
                // Save all assignments to Firebase
                if (loadingAlert && loadingAlert.parentNode) {
                    loadingAlert.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Αποθήκευση στο Firebase...';
                }
                await saveData();
                
                // Delete temporary assignments document after saving permanently
                try {
                    const db = window.db || firebase.firestore();
                    await db.collection('dutyShifts').doc('tempAssignments').delete();
                    console.log('Temp assignments deleted from Firestore');
                } catch (error) {
                    console.error('Error deleting temp assignments:', error);
                }
                
                // Clear temp assignments from memory
                calculationSteps.tempAssignments = null;
                
                // Reload data from Firebase to refresh the display
                if (loadingAlert && loadingAlert.parentNode) {
                    loadingAlert.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Φόρτωση δεδομένων...';
                }
                await loadData();
                
                // Refresh all UI components
                renderGroups();
                renderHolidays();
                renderRecurringHolidays();
            renderCalendar();
                updateStatistics();
                
                // Remove loading indicator
                if (loadingAlert && loadingAlert.parentNode) {
                    document.body.removeChild(loadingAlert);
                    loadingAlert = null;
                }
                
                // Show success message and close modal if still open
                const finalModal = bootstrap.Modal.getInstance(document.getElementById('stepByStepCalculationModal'));
                if (finalModal) {
                    finalModal.hide();
                }
                
                // Clean up modal backdrop and body classes to prevent page from becoming inactive
                setTimeout(() => {
                    const backdrop = document.querySelector('.modal-backdrop');
                    if (backdrop) {
                        backdrop.remove();
                    }
                    document.body.classList.remove('modal-open');
                    document.body.style.overflow = '';
                    document.body.style.paddingRight = '';
                }, 300);
                
                alert('Ο υπολογισμός ολοκληρώθηκε και αποθηκεύτηκε επιτυχώς!');
                
                // Additional cleanup after alert is dismissed
                setTimeout(() => {
                    const backdrop = document.querySelector('.modal-backdrop');
                    if (backdrop) {
                        backdrop.remove();
                    }
                    document.body.classList.remove('modal-open');
                    document.body.style.overflow = '';
                    document.body.style.paddingRight = '';
                }, 100);
            } catch (error) {
                console.error('Error in executeCalculation:', error);
                
                // Remove loading indicator if it exists
                if (loadingAlert && loadingAlert.parentNode) {
                    document.body.removeChild(loadingAlert);
                } else {
                    const existingAlert = document.querySelector('.alert.position-fixed');
                    if (existingAlert && existingAlert.parentNode) {
                        document.body.removeChild(existingAlert);
                    }
                }
                
                // Close modal if still open
                const errorModal = bootstrap.Modal.getInstance(document.getElementById('stepByStepCalculationModal'));
                if (errorModal) {
                    errorModal.hide();
                }
                
                alert('Σφάλμα κατά τον υπολογισμό: ' + error.message);
            }
        }

        // Step 2: Check and show weekends/holidays
        function renderStep2_Weekends() {
            const stepContent = document.getElementById('stepContent');
            const startDate = calculationSteps.startDate;
            const endDate = calculationSteps.endDate;
            const dayTypeLists = calculationSteps.dayTypeLists || { weekend: [], special: [] };
            
            // Check for weekends/holidays
            const weekendHolidays = dayTypeLists.weekend || [];
            const specialHolidays = dayTypeLists.special || [];
            
            // Load special holiday assignments from Step 1 (already saved to Firestore)
            // This creates a map: monthKey -> groupNum -> Set of people with special holidays
            const simulatedSpecialAssignments = {}; // monthKey -> { groupNum -> Set of person names }
            const sortedSpecial = [...specialHolidays].sort();
            
            // Load from saved special holiday assignments
            sortedSpecial.forEach((dateKey) => {
                const date = new Date(dateKey + 'T00:00:00');
                const month = date.getMonth();
                const year = date.getFullYear();
                const monthKey = `${year}-${month}`;
                
                if (!simulatedSpecialAssignments[monthKey]) {
                    simulatedSpecialAssignments[monthKey] = {};
                }
                
                // Get assignment from saved special holiday assignments
                const assignment = specialHolidayAssignments[dateKey];
                if (assignment) {
                    // Ensure assignment is a string (it might be an object if data wasn't flattened correctly)
                    const assignmentStr = typeof assignment === 'string' ? assignment : String(assignment);
                    // assignment is a string like "Person Name (Ομάδα 1), Person Name (Ομάδα 2), ..."
                    const parts = assignmentStr.split(',').map(p => p.trim());
                    parts.forEach(part => {
                        const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)$/);
                        if (match) {
                            const personName = match[1].trim();
                            const groupNum = parseInt(match[2]);
                            if (!simulatedSpecialAssignments[monthKey][groupNum]) {
                                simulatedSpecialAssignments[monthKey][groupNum] = new Set();
                            }
                            simulatedSpecialAssignments[monthKey][groupNum].add(personName);
                        }
                    });
                }
            });
            
            let html = '<div class="step-content">';
            html += '<h6 class="mb-3"><i class="fas fa-calendar-weekend text-info me-2"></i>Βήμα 2: Σαββατοκύριακα/Αργίες</h6>';
            
            if (weekendHolidays.length === 0) {
                html += '<div class="alert alert-info">';
                html += '<i class="fas fa-info-circle me-2"></i>';
                html += 'Δεν βρέθηκαν σαββατοκύριακα/αργίες στην επιλεγμένη περίοδο.';
                html += '</div>';
            } else {
                html += '<div class="alert alert-success">';
                html += `<i class="fas fa-check-circle me-2"></i>Βρέθηκαν <strong>${weekendHolidays.length}</strong> σαββατοκύριακα/αργίες στην επιλεγμένη περίοδο.`;
                html += '</div>';
                
                html += '<div class="table-responsive mt-3">';
                html += '<table class="table table-bordered table-hover">';
                html += '<thead class="table-info">';
                html += '<tr>';
                html += '<th>Ημερομηνία</th>';
                html += '<th>Όνομα Αργίας</th>';
                html += '<th>Ομάδα 1<br><small>ΕΠΙΚΕΦΑΛΗΣ-ΑΥΜ</small></th>';
                html += '<th>Ομάδα 2<br><small>ΜΗΧΑΝΙΚΟΣ-ΟΠΛΟΥΡΓΟΣ-ΟΔΗΓΟΣ</small></th>';
                html += '<th>Ομάδα 3<br><small>ΤΕΧΝΙΚΟΣ Ε/Π AW139</small></th>';
                html += '<th>Ομάδα 4<br><small>ΤΕΧΝΙΚΟΣ ΕΠΙΓΕΙΩΝ ΜΕΣΩΝ</small></th>';
                html += '</tr>';
                html += '</thead>';
                html += '<tbody>';
                
                // Sort weekends/holidays by date
                const sortedWeekends = [...weekendHolidays].sort();
                
                // Track skipped people per month (like the actual calculation)
                const skippedInMonth = {}; // monthKey -> { groupNum -> Set of person names }
                
                // Track current rotation position globally (continues across months)
                const globalWeekendRotationPosition = {}; // groupNum -> global position
                
                // Track weekend assignments as we process them (for consecutive day checking)
                const simulatedWeekendAssignments = {}; // dateKey -> { groupNum -> person name }
                
                sortedWeekends.forEach((dateKey, weekendIndex) => {
                    const date = new Date(dateKey + 'T00:00:00');
                    const dateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const dayName = getGreekDayName(date);
                    const month = date.getMonth();
                    const year = date.getFullYear();
                    const monthKey = `${year}-${month}`;
                    
                    // Initialize skipped set for this month if needed
                    if (!skippedInMonth[monthKey]) {
                        skippedInMonth[monthKey] = {};
                    }
                    
                    // Get holiday name
                    let holidayName = '';
                    const holidayNameAuto = getOrthodoxHolidayNameAuto(date);
                    if (holidayNameAuto) {
                        holidayName = holidayNameAuto;
                    } else if (date.getDay() === 0) {
                        holidayName = 'Κυριακή';
                    } else if (date.getDay() === 6) {
                        holidayName = 'Σάββατο';
                    } else {
                        holidayName = 'Αργία';
                    }
                    
                    html += '<tr>';
                    html += `<td><strong>${dateStr}</strong><br><small class="text-muted">${dayName}</small></td>`;
                    html += `<td>${holidayName || 'Αργία'}</td>`;
                    
                    // Calculate who will be assigned for each group based on rotation order
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [] };
                        const groupPeople = groupData.weekend || [];
                        
                        if (groupPeople.length === 0) {
                            html += '<td class="text-muted">-</td>';
                        } else {
                            // Initialize skipped set for this group and month if needed
                            if (!skippedInMonth[monthKey][groupNum]) {
                                skippedInMonth[monthKey][groupNum] = new Set();
                            }
                            const rotationDays = groupPeople.length;
                            if (globalWeekendRotationPosition[groupNum] === undefined) {
                                // If start date is February 2026, always start from first person (position 0)
                                const isFebruary2026 = calculationSteps.startDate && 
                                    calculationSteps.startDate.getFullYear() === 2026 && 
                                    calculationSteps.startDate.getMonth() === 1; // Month 1 = February (0-indexed)
                                
                                if (isFebruary2026) {
                                    // Always start from first person for February 2026
                                    globalWeekendRotationPosition[groupNum] = 0;
                                    console.log(`[PREVIEW ROTATION] Starting from first person (position 0) for group ${groupNum} weekend - February 2026`);
                                } else {
                                    // Initialize based on rotation count from start date
                                const daysSinceStart = getRotationPosition(date, 'weekend', groupNum);
                                globalWeekendRotationPosition[groupNum] = daysSinceStart % rotationDays;
                                }
                            }
                            
                            // PREVIEW MODE: Just show basic rotation WITHOUT skip logic
                            // Skip logic will run when Next is pressed
                            let rotationPosition = globalWeekendRotationPosition[groupNum] % rotationDays;
                            let assignedPerson = groupPeople[rotationPosition];
                            
                            // Check if assigned person is missing, if so find next in rotation
                            if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date)) {
                                // Find next person in rotation who is not missing
                                    for (let offset = 1; offset < rotationDays; offset++) {
                                        const nextIndex = (rotationPosition + offset) % rotationDays;
                                        const candidate = groupPeople[nextIndex];
                                    if (candidate && !isPersonMissingOnDate(candidate, groupNum, date)) {
                                            assignedPerson = candidate;
                                        rotationPosition = nextIndex;
                                            break;
                                        }
                                    }
                            }
                            
                            // Store assignment for saving
                            if (assignedPerson) {
                                if (!simulatedWeekendAssignments[dateKey]) {
                                    simulatedWeekendAssignments[dateKey] = {};
                                }
                                simulatedWeekendAssignments[dateKey][groupNum] = assignedPerson;
                                
                                // Track last rotation position for this group
                                // Advance position by 1 for next time (or wrap around)
                                const nextRotationPosition = (rotationPosition + 1) % rotationDays;
                                globalWeekendRotationPosition[groupNum] = nextRotationPosition;
                            } else {
                                // No person found, still advance rotation position
                                globalWeekendRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                            }
                            
                            // Get last duty date and days since for display
                            let lastDutyInfo = '';
                            let daysCountInfo = '';
                            if (assignedPerson) {
                                const daysSince = countDaysSinceLastDuty(dateKey, assignedPerson, groupNum, 'weekend', dayTypeLists, startDate);
                                    const dutyDates = getLastAndNextDutyDates(assignedPerson, groupNum, 'weekend', groupPeople.length);
                                    lastDutyInfo = dutyDates.lastDuty !== 'Δεν έχει' ? `<br><small class="text-muted">Τελευταία: ${dutyDates.lastDuty}</small>` : '';
                                
                                // Show days counted in parentheses
                                if (daysSince !== null && daysSince !== Infinity) {
                                    daysCountInfo = ` <span class="text-info">(${daysSince}/${rotationDays} ημέρες)</span>`;
                                } else if (daysSince === Infinity) {
                                    daysCountInfo = ' <span class="text-success">(πρώτη φορά)</span>';
                                }
                            }
                            
                            html += `<td>${assignedPerson || '-'}${daysCountInfo}${lastDutyInfo}</td>`;
                        }
                    }
                    
                    html += '</tr>';
                });
                
                // Store assignments and rotation positions in calculationSteps for saving when Next is pressed
                calculationSteps.tempWeekendAssignments = simulatedWeekendAssignments;
                calculationSteps.lastWeekendRotationPositions = {};
                for (let g = 1; g <= 4; g++) {
                    if (globalWeekendRotationPosition[g] !== undefined) {
                        calculationSteps.lastWeekendRotationPositions[g] = globalWeekendRotationPosition[g];
                    }
                }
                
                html += '</tbody>';
                html += '</table>';
                html += '</div>';
            }
            
            html += '</div>';
            stepContent.innerHTML = html;
        }

        function renderStep3_SemiNormal() {
            const stepContent = document.getElementById('stepContent');
            const startDate = calculationSteps.startDate;
            const endDate = calculationSteps.endDate;
            const dayTypeLists = calculationSteps.dayTypeLists || { semi: [], special: [], weekend: [] };
            
            // Check for semi-normal days
            const semiNormalDays = dayTypeLists.semi || [];
            const specialHolidays = dayTypeLists.special || [];
            const weekendHolidays = dayTypeLists.weekend || [];
            
            // First, simulate what special holidays will be assigned (from Step 1)
            const simulatedSpecialAssignments = {}; // monthKey -> { groupNum -> Set of person names }
            const sortedSpecial = [...specialHolidays].sort();
            
            sortedSpecial.forEach((dateKey, specialIndex) => {
                const date = new Date(dateKey + 'T00:00:00');
                const month = date.getMonth();
                const year = date.getFullYear();
                const monthKey = `${year}-${month}`;
                
                if (!simulatedSpecialAssignments[monthKey]) {
                    simulatedSpecialAssignments[monthKey] = {};
                }
                
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const groupData = groups[groupNum] || { special: [] };
                    const groupPeople = groupData.special || [];
                    
                    if (groupPeople.length > 0) {
                        const rotationDays = groupPeople.length;
                        const rotationPosition = getRotationPosition(date, 'special', groupNum) % rotationDays;
                        const person = groupPeople[rotationPosition];
                        
                        if (person && !isPersonMissingOnDate(person, groupNum, date)) {
                            if (!simulatedSpecialAssignments[monthKey][groupNum]) {
                                simulatedSpecialAssignments[monthKey][groupNum] = new Set();
                            }
                            simulatedSpecialAssignments[monthKey][groupNum].add(person);
                        }
                    }
                }
            });
            
            // Second, simulate what weekends will be assigned (from Step 2)
            const simulatedWeekendAssignments = {}; // dateKey -> { groupNum -> person name }
            const skippedInMonth = {}; // monthKey -> { groupNum -> Set of person names }
            const globalWeekendRotationPosition = {}; // groupNum -> global position (continues across months)
            const sortedWeekends = [...weekendHolidays].sort();
            
            sortedWeekends.forEach((dateKey, weekendIndex) => {
                const date = new Date(dateKey + 'T00:00:00');
                const month = date.getMonth();
                const year = date.getFullYear();
                const monthKey = `${year}-${month}`;
                
                if (!skippedInMonth[monthKey]) {
                    skippedInMonth[monthKey] = {};
                }
                
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const groupData = groups[groupNum] || { weekend: [] };
                    const groupPeople = groupData.weekend || [];
                    
                    if (groupPeople.length > 0) {
                        if (!skippedInMonth[monthKey][groupNum]) {
                            skippedInMonth[monthKey][groupNum] = new Set();
                        }
                        const rotationDays = groupPeople.length;
                        if (globalWeekendRotationPosition[groupNum] === undefined) {
                            // If start date is February 2026, always start from first person (position 0)
                            const isFebruary2026 = calculationSteps.startDate && 
                                calculationSteps.startDate.getFullYear() === 2026 && 
                                calculationSteps.startDate.getMonth() === 1; // Month 1 = February (0-indexed)
                            
                            if (isFebruary2026) {
                                // Always start from first person for February 2026
                                globalWeekendRotationPosition[groupNum] = 0;
                                console.log(`[PREVIEW ROTATION] Starting from first person (position 0) for group ${groupNum} weekend - February 2026`);
                            } else {
                                // Initialize based on rotation count from start date
                            const daysSinceStart = getRotationPosition(date, 'weekend', groupNum);
                            globalWeekendRotationPosition[groupNum] = daysSinceStart % rotationDays;
                            }
                        }
                        
                        // PREVIEW MODE: Just show basic rotation WITHOUT skip logic
                        // Skip logic will run when Next is pressed in Step 2
                        let rotationPosition = globalWeekendRotationPosition[groupNum] % rotationDays;
                        let assignedPerson = groupPeople[rotationPosition];
                        
                        // Check if assigned person is missing, if so find next in rotation
                        if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date)) {
                            // Find next person in rotation who is not missing
                                for (let offset = 1; offset < rotationDays; offset++) {
                                    const nextIndex = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[nextIndex];
                                if (candidate && !isPersonMissingOnDate(candidate, groupNum, date)) {
                                        assignedPerson = candidate;
                                    rotationPosition = nextIndex;
                                        break;
                                    }
                                }
                        }
                        
                        // Advance rotation position
                        if (assignedPerson) {
                                globalWeekendRotationPosition[groupNum] = rotationPosition + 1;
                        } else {
                            globalWeekendRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                        }
                        
                        if (assignedPerson) {
                            if (!simulatedWeekendAssignments[dateKey]) {
                                simulatedWeekendAssignments[dateKey] = {};
                            }
                            simulatedWeekendAssignments[dateKey][groupNum] = assignedPerson;
                        }
                    }
                }
            });
            
            let html = '<div class="step-content">';
            html += '<h6 class="mb-3"><i class="fas fa-calendar-day text-warning me-2"></i>Βήμα 3: Ημιαργίες</h6>';
            
            if (semiNormalDays.length === 0) {
                html += '<div class="alert alert-info">';
                html += '<i class="fas fa-info-circle me-2"></i>';
                html += 'Δεν βρέθηκαν ημιαργίες στην επιλεγμένη περίοδο.';
                html += '</div>';
            } else {
                html += '<div class="alert alert-success">';
                html += `<i class="fas fa-check-circle me-2"></i>Βρέθηκαν <strong>${semiNormalDays.length}</strong> ημιαργίες στην επιλεγμένη περίοδο.`;
                html += '</div>';
                
                html += '<div class="table-responsive mt-3">';
                html += '<table class="table table-bordered table-hover">';
                html += '<thead class="table-warning">';
                html += '<tr>';
                html += '<th>Ημερομηνία</th>';
                html += '<th>Ημέρα</th>';
                html += '<th>Ομάδα 1<br><small>ΕΠΙΚΕΦΑΛΗΣ-ΑΥΜ</small></th>';
                html += '<th>Ομάδα 2<br><small>ΜΗΧΑΝΙΚΟΣ-ΟΠΛΟΥΡΓΟΣ-ΟΔΗΓΟΣ</small></th>';
                html += '<th>Ομάδα 3<br><small>ΤΕΧΝΙΚΟΣ Ε/Π AW139</small></th>';
                html += '<th>Ομάδα 4<br><small>ΤΕΧΝΙΚΟΣ ΕΠΙΓΕΙΩΝ ΜΕΣΩΝ</small></th>';
                html += '</tr>';
                html += '</thead>';
                html += '<tbody>';
                
                // Sort semi-normal days by date
                const sortedSemi = [...semiNormalDays].sort();
                
                // Track assignments for swapping logic
                const semiAssignments = {}; // dateKey -> { groupNum -> person name }
                const globalSemiRotationPosition = {}; // groupNum -> global position (continues across months)
                // Track pending swaps: when Person A is swapped, Person B should be assigned to Person A's next day
                const pendingSwaps = {}; // monthKey -> { groupNum -> { skippedPerson, swapToPosition } }
                
                sortedSemi.forEach((dateKey, semiIndex) => {
                    const date = new Date(dateKey + 'T00:00:00');
                    const dateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const dayName = getGreekDayName(date);
                    const month = date.getMonth();
                    const year = date.getFullYear();
                    const monthKey = `${year}-${month}`;
                    
                    if (!pendingSwaps[monthKey]) {
                        pendingSwaps[monthKey] = {};
                    }
                    
                    html += '<tr>';
                    html += `<td><strong>${dateStr}</strong></td>`;
                    html += `<td>${dayName}</td>`;
                    
                    // Calculate who will be assigned for each group
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        const groupData = groups[groupNum] || { semi: [] };
                        const groupPeople = groupData.semi || [];
                        
                        if (groupPeople.length === 0) {
                            html += '<td class="text-muted">-</td>';
                        } else {
                            const rotationDays = groupPeople.length;
                            if (globalSemiRotationPosition[groupNum] === undefined) {
                                // If start date is February 2026, always start from first person (position 0)
                                const isFebruary2026 = calculationSteps.startDate && 
                                    calculationSteps.startDate.getFullYear() === 2026 && 
                                    calculationSteps.startDate.getMonth() === 1; // Month 1 = February (0-indexed)
                                
                                if (isFebruary2026) {
                                    // Always start from first person for February 2026
                                    globalSemiRotationPosition[groupNum] = 0;
                                    console.log(`[PREVIEW ROTATION] Starting from first person (position 0) for group ${groupNum} semi - February 2026`);
                                } else {
                                    // Initialize based on rotation count from start date
                                const daysSinceStart = getRotationPosition(date, 'semi', groupNum);
                                globalSemiRotationPosition[groupNum] = daysSinceStart % rotationDays;
                                }
                            }
                            
                            let rotationPosition = globalSemiRotationPosition[groupNum] % rotationDays;
                            let assignedPerson = groupPeople[rotationPosition];
                            
                            // Check if this day is a cross-month swap assignment (person swapped from previous month)
                            // Structure: crossMonthSwaps[dateKey][groupNum] = personName
                            let isCrossMonthSwapDay = false;
                            if (crossMonthSwaps[dateKey] && crossMonthSwaps[dateKey][groupNum]) {
                                // This person was swapped from previous month and must be assigned to this day
                                assignedPerson = crossMonthSwaps[dateKey][groupNum];
                                isCrossMonthSwapDay = true;
                                console.log(`[PREVIEW CROSS-MONTH SEMI] Assigning ${assignedPerson} to ${dateKey} (Group ${groupNum}, swapped from previous month)`);
                                // Remove from tracking since we're assigning them now (will be saved when calculation completes)
                                delete crossMonthSwaps[dateKey][groupNum];
                                // If no more groups for this date, remove the date entry
                                if (Object.keys(crossMonthSwaps[dateKey]).length === 0) {
                                    delete crossMonthSwaps[dateKey];
                                }
                            }
                            
                            // Check if there's a pending swap for this position
                            if (!isCrossMonthSwapDay && pendingSwaps[monthKey][groupNum] && pendingSwaps[monthKey][groupNum].swapToPosition === rotationPosition) {
                                // This is the position where the skipped person should be assigned (swapped person's original position)
                                assignedPerson = pendingSwaps[monthKey][groupNum].skippedPerson;
                                delete pendingSwaps[monthKey][groupNum];
                                // Advance rotation normally from this position
                                globalSemiRotationPosition[groupNum] = rotationPosition + 1;
                            } else if (!isCrossMonthSwapDay) {
                                // PREVIEW MODE: Just show basic rotation WITHOUT consecutive day swap logic
                                // Swap logic will run when Next is pressed
                                
                                // Check if assigned person is missing, if so find next in rotation
                                if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date)) {
                                    // Find next person in rotation who is not missing
                                    for (let offset = 1; offset < rotationDays; offset++) {
                                        const nextIndex = (rotationPosition + offset) % rotationDays;
                                        const candidate = groupPeople[nextIndex];
                                        if (candidate && !isPersonMissingOnDate(candidate, groupNum, date)) {
                                            assignedPerson = candidate;
                                            rotationPosition = nextIndex;
                                            break;
                                        }
                                    }
                                    }
                                    
                                // Advance rotation position
                                globalSemiRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                } else {
                                // For cross-month swap, advance from the assigned person's position
                                const assignedIndex = groupPeople.indexOf(assignedPerson);
                                if (assignedIndex !== -1) {
                                    globalSemiRotationPosition[groupNum] = (assignedIndex + 1) % rotationDays;
                                } else {
                                    globalSemiRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                }
                            }
                            
                            // Store assignment for potential future swaps
                            if (!semiAssignments[dateKey]) {
                                semiAssignments[dateKey] = {};
                            }
                            semiAssignments[dateKey][groupNum] = assignedPerson;
                            
                            // Get last duty date and days since for display
                            let lastDutyInfo = '';
                            let daysCountInfo = '';
                            if (assignedPerson) {
                                const daysSince = countDaysSinceLastDuty(dateKey, assignedPerson, groupNum, 'semi', dayTypeLists, startDate);
                                const dutyDates = getLastAndNextDutyDates(assignedPerson, groupNum, 'semi', groupPeople.length);
                                lastDutyInfo = dutyDates.lastDuty !== 'Δεν έχει' ? `<br><small class="text-muted">Τελευταία: ${dutyDates.lastDuty}</small>` : '';
                                
                                if (daysSince !== null && daysSince !== Infinity) {
                                    daysCountInfo = ` <span class="text-info">(${daysSince}/${rotationDays} ημέρες)</span>`;
                                } else if (daysSince === Infinity) {
                                    daysCountInfo = ' <span class="text-success">(πρώτη φορά)</span>';
                                }
                            }
                            
                            html += `<td>${assignedPerson || '-'}${daysCountInfo}${lastDutyInfo}</td>`;
                        }
                    }
                    
                    html += '</tr>';
                });
                
                // Store assignments and rotation positions in calculationSteps for saving when Next is pressed
                calculationSteps.tempSemiAssignments = semiAssignments;
                calculationSteps.lastSemiRotationPositions = {};
                for (let g = 1; g <= 4; g++) {
                    if (globalSemiRotationPosition[g] !== undefined) {
                        calculationSteps.lastSemiRotationPositions[g] = globalSemiRotationPosition[g];
                    }
                }
                
                html += '</tbody>';
                html += '</table>';
                html += '</div>';
            }
            
            html += '</div>';
            stepContent.innerHTML = html;
        }

        function renderStep4_Normal() {
            const stepContent = document.getElementById('stepContent');
            const startDate = calculationSteps.startDate;
            const endDate = calculationSteps.endDate;
            const dayTypeLists = calculationSteps.dayTypeLists || { normal: [], semi: [], special: [], weekend: [] };
            
            // Declare at function level to avoid scope issues
            const globalNormalRotationPosition = {}; // groupNum -> global position (continues across months)
            
            // Check for normal days
            const normalDays = dayTypeLists.normal || [];
            const semiNormalDays = dayTypeLists.semi || [];
            const specialHolidays = dayTypeLists.special || [];
            const weekendHolidays = dayTypeLists.weekend || [];
            
            // Use global crossMonthSwaps variable (loaded from Firestore/localStorage)
            // Structure: crossMonthSwaps[dateKey][groupNum] = personName
            
            // First, simulate Step 1 (special holidays)
            const simulatedSpecialAssignments = {}; // monthKey -> { groupNum -> Set of person names }
            const sortedSpecial = [...specialHolidays].sort();
            
            sortedSpecial.forEach((dateKey, specialIndex) => {
                const date = new Date(dateKey + 'T00:00:00');
                const month = date.getMonth();
                const year = date.getFullYear();
                const monthKey = `${year}-${month}`;
                
                if (!simulatedSpecialAssignments[monthKey]) {
                    simulatedSpecialAssignments[monthKey] = {};
                }
                
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const groupData = groups[groupNum] || { special: [] };
                    const groupPeople = groupData.special || [];
                    
                    if (groupPeople.length > 0) {
                        const rotationDays = groupPeople.length;
                        const rotationPosition = getRotationPosition(date, 'special', groupNum) % rotationDays;
                        const person = groupPeople[rotationPosition];
                        
                        if (person && !isPersonMissingOnDate(person, groupNum, date)) {
                            if (!simulatedSpecialAssignments[monthKey][groupNum]) {
                                simulatedSpecialAssignments[monthKey][groupNum] = new Set();
                            }
                            simulatedSpecialAssignments[monthKey][groupNum].add(person);
                        }
                    }
                }
            });
            
            // Second, simulate Step 2 (weekends)
            const simulatedWeekendAssignments = {}; // dateKey -> { groupNum -> person name }
            const skippedInMonth = {}; // monthKey -> { groupNum -> Set of person names }
            const globalWeekendRotationPosition = {}; // groupNum -> global position (continues across months)
            const sortedWeekends = [...weekendHolidays].sort();
            // Initialize simulatedSemiAssignments and normalAssignments for consecutive check (will be populated later)
            const simulatedSemiAssignments = {}; // dateKey -> { groupNum -> person name }
            const normalAssignments = {}; // dateKey -> { groupNum -> person name }
            
            sortedWeekends.forEach((dateKey, weekendIndex) => {
                const date = new Date(dateKey + 'T00:00:00');
                const month = date.getMonth();
                const year = date.getFullYear();
                const monthKey = `${year}-${month}`;
                
                if (!skippedInMonth[monthKey]) {
                    skippedInMonth[monthKey] = {};
                }
                
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const groupData = groups[groupNum] || { weekend: [] };
                    const groupPeople = groupData.weekend || [];
                    
                    if (groupPeople.length > 0) {
                        if (!skippedInMonth[monthKey][groupNum]) {
                            skippedInMonth[monthKey][groupNum] = new Set();
                        }
                        const rotationDays = groupPeople.length;
                        if (globalWeekendRotationPosition[groupNum] === undefined) {
                            // If start date is February 2026, always start from first person (position 0)
                            const isFebruary2026 = calculationSteps.startDate && 
                                calculationSteps.startDate.getFullYear() === 2026 && 
                                calculationSteps.startDate.getMonth() === 1; // Month 1 = February (0-indexed)
                            
                            if (isFebruary2026) {
                                // Always start from first person for February 2026
                                globalWeekendRotationPosition[groupNum] = 0;
                                console.log(`[PREVIEW ROTATION] Starting from first person (position 0) for group ${groupNum} weekend - February 2026`);
                            } else {
                                // Initialize based on rotation count from start date
                            const daysSinceStart = getRotationPosition(date, 'weekend', groupNum);
                            globalWeekendRotationPosition[groupNum] = daysSinceStart % rotationDays;
                            }
                        }
                        
                        let rotationPosition = globalWeekendRotationPosition[groupNum] % rotationDays;
                        // PREVIEW MODE: Just show basic rotation WITHOUT skip logic
                        // Skip logic will run when Next is pressed in Step 2
                        let assignedPerson = groupPeople[rotationPosition];
                        
                        // Check if assigned person is missing, if so find next in rotation
                        if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date)) {
                            // Find next person in rotation who is not missing
                                for (let offset = 1; offset < rotationDays; offset++) {
                                    const nextIndex = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[nextIndex];
                                if (candidate && !isPersonMissingOnDate(candidate, groupNum, date)) {
                                        assignedPerson = candidate;
                                    rotationPosition = nextIndex;
                                        break;
                                    }
                                }
                        }
                        
                        // Advance rotation position
                        if (assignedPerson) {
                                globalWeekendRotationPosition[groupNum] = rotationPosition + 1;
                        } else {
                            globalWeekendRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                        }
                        
                        // Store assignment for saving
                        if (assignedPerson) {
                            if (!simulatedWeekendAssignments[dateKey]) {
                                simulatedWeekendAssignments[dateKey] = {};
                            }
                            simulatedWeekendAssignments[dateKey][groupNum] = assignedPerson;
                        }
                    }
                }
            });
            
            // Third, load Step 3 (semi-normal days) from saved data
            // Load semi-normal assignments from saved data (after swap logic from Step 3)
            const sortedSemi = [...semiNormalDays].sort();
            
            sortedSemi.forEach((dateKey) => {
                const assignment = semiNormalAssignments[dateKey];
                if (assignment) {
                    const parts = assignment.split(',').map(p => p.trim());
                    parts.forEach(part => {
                        const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)$/);
                        if (match) {
                            const personName = match[1].trim();
                            const groupNum = parseInt(match[2]);
                            if (!simulatedSemiAssignments[dateKey]) {
                                simulatedSemiAssignments[dateKey] = {};
                            }
                            simulatedSemiAssignments[dateKey][groupNum] = personName;
                        }
                    });
                }
            });
            
            let html = '<div class="step-content">';
            html += '<h6 class="mb-3"><i class="fas fa-calendar-day text-primary me-2"></i>Βήμα 4: Καθημερινές</h6>';
            
            // Sort normal days by date (define at function scope so it's accessible for swap logic)
            const sortedNormal = [...normalDays].sort();
            
            if (normalDays.length === 0) {
                html += '<div class="alert alert-info">';
                html += '<i class="fas fa-info-circle me-2"></i>';
                html += 'Δεν βρέθηκαν καθημερινές ημέρες στην επιλεγμένη περίοδο.';
                html += '</div>';
            } else {
                html += '<div class="alert alert-success">';
                html += `<i class="fas fa-check-circle me-2"></i>Βρέθηκαν <strong>${normalDays.length}</strong> καθημερινές ημέρες στην επιλεγμένη περίοδο.`;
                html += '</div>';
                
                html += '<div class="table-responsive mt-3">';
                html += '<table class="table table-bordered table-hover">';
                html += '<thead class="table-primary">';
                html += '<tr>';
                html += '<th>Ημερομηνία</th>';
                html += '<th>Ημέρα</th>';
                html += '<th>Ομάδα 1<br><small>ΕΠΙΚΕΦΑΛΗΣ-ΑΥΜ</small></th>';
                html += '<th>Ομάδα 2<br><small>ΜΗΧΑΝΙΚΟΣ-ΟΠΛΟΥΡΓΟΣ-ΟΔΗΓΟΣ</small></th>';
                html += '<th>Ομάδα 3<br><small>ΤΕΧΝΙΚΟΣ Ε/Π AW139</small></th>';
                html += '<th>Ομάδα 4<br><small>ΤΕΧΝΙΚΟΣ ΕΠΙΓΕΙΩΝ ΜΕΣΩΝ</small></th>';
                html += '</tr>';
                html += '</thead>';
                html += '<tbody>';
                
                // First, build all assignments (before swap logic)
                // Track assignments and rotation
                // NOTE: normalAssignments is already defined at function level (line 7842), don't redeclare it here
                // const normalAssignments = {}; // REMOVED - use outer scope variable
                // Initialize from lastRotationPositions if available (for preview, we still track but don't save to global)
                // BUT: If start date is February 2026, always start from position 0 (first person) for all groups
                const isFebruary2026 = calculationSteps.startDate && 
                    calculationSteps.startDate.getFullYear() === 2026 && 
                    calculationSteps.startDate.getMonth() === 1; // Month 1 = February (0-indexed)
                
                if (!isFebruary2026) {
                    // Only load from Firestore if NOT February 2026
                for (let g = 1; g <= 4; g++) {
                    if (lastRotationPositions.normal[g] !== undefined) {
                        globalNormalRotationPosition[g] = lastRotationPositions.normal[g];
                        console.log(`[PREVIEW ROTATION] Initialized normal rotation position for group ${g} from Firestore: ${globalNormalRotationPosition[g]}`);
                    }
                    }
                } else {
                    console.log(`[PREVIEW ROTATION] February 2026 detected - will start all groups from position 0 (first person)`);
                }
                // Track pending swaps: when Person A is swapped, Person B should be assigned to Person A's next normal day
                const pendingNormalSwaps = {}; // monthKey -> { groupNum -> { skippedPerson, swapToPosition } }
                // Track which people have been assigned to which days (to prevent duplicate assignments after swaps)
                const assignedPeoplePreview = {}; // monthKey -> { groupNum -> Set of person names }
                // Track days that have been swapped (to use already-assigned person when we reach them)
                const swappedDaysPreview = {}; // dateKey -> { groupNum -> true }
                // Track which people have already been swapped (to prevent swapping them again on subsequent days)
                const swappedPeoplePreview = new Set(); // Set of person names who have already been swapped
                
                sortedNormal.forEach((dateKey, normalIndex) => {
                    const date = new Date(dateKey + 'T00:00:00');
                    const dateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const dayName = getGreekDayName(date);
                    const month = date.getMonth();
                    const year = date.getFullYear();
                    const monthKey = `${year}-${month}`;
                    
                    if (!pendingNormalSwaps[monthKey]) {
                        pendingNormalSwaps[monthKey] = {};
                    }
                    if (!assignedPeoplePreview[monthKey]) {
                        assignedPeoplePreview[monthKey] = {};
                    }
                    
                    html += '<tr>';
                    html += `<td><strong>${dateStr}</strong></td>`;
                    html += `<td>${dayName}</td>`;
                    
                    // Calculate who will be assigned for each group
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        const groupData = groups[groupNum] || { normal: [] };
                        const groupPeople = groupData.normal || [];
                        
                        if (groupPeople.length === 0) {
                            html += '<td class="text-muted">-</td>';
                        } else {
                            const rotationDays = groupPeople.length;
                            if (globalNormalRotationPosition[groupNum] === undefined) {
                                // If start date is February 2026, always start from first person (position 0)
                                const isFebruary2026 = calculationSteps.startDate && 
                                    calculationSteps.startDate.getFullYear() === 2026 && 
                                    calculationSteps.startDate.getMonth() === 1; // Month 1 = February (0-indexed)
                                
                                if (isFebruary2026) {
                                    // Always start from first person for February 2026
                                    globalNormalRotationPosition[groupNum] = 0;
                                    console.log(`[PREVIEW ROTATION] Starting from first person (position 0) for group ${groupNum} - February 2026`);
                                } else if (lastRotationPositions.normal[groupNum] !== undefined) {
                                    globalNormalRotationPosition[groupNum] = lastRotationPositions.normal[groupNum];
                                    console.log(`[PREVIEW ROTATION] Loaded normal rotation position for group ${groupNum} from Firestore: ${globalNormalRotationPosition[groupNum]}`);
                                } else {
                                    // Initialize based on rotation count from start date
                                    const daysSinceStart = getRotationPosition(date, 'normal', groupNum);
                                    globalNormalRotationPosition[groupNum] = daysSinceStart % rotationDays;
                                }
                            }
                            
                            let rotationPosition = globalNormalRotationPosition[groupNum] % rotationDays;
                            let assignedPerson = groupPeople[rotationPosition];
                            
                            // Initialize assigned people set for this group if needed
                            if (!assignedPeoplePreview[monthKey][groupNum]) {
                                assignedPeoplePreview[monthKey][groupNum] = new Set();
                            }
                            
                            // If assigned person was already assigned this month (due to swap), skip to next person
                            if (assignedPerson && assignedPeoplePreview[monthKey][groupNum].has(assignedPerson)) {
                                // This person was already assigned (swapped), find next available person in rotation
                                let foundReplacement = false;
                                for (let offset = 1; offset < rotationDays && !foundReplacement; offset++) {
                                    const nextIndex = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[nextIndex];
                                    
                                    if (!candidate || isPersonMissingOnDate(candidate, groupNum, date)) {
                                        continue;
                                    }
                                    
                                    // Check if candidate was already assigned this month
                                    if (assignedPeoplePreview[monthKey][groupNum].has(candidate)) {
                                        continue;
                                    }
                                    
                                    // Found available person
                                    assignedPerson = candidate;
                                    rotationPosition = nextIndex;
                                    foundReplacement = true;
                                }
                                
                                // If no replacement found, skip this day
                                if (!foundReplacement) {
                                    assignedPerson = null;
                                }
                            }
                            
                            // Check if there's a pending swap for this position
                            if (pendingNormalSwaps[monthKey][groupNum] && pendingNormalSwaps[monthKey][groupNum].swapToPosition === rotationPosition) {
                                // This is the position where the skipped person should be assigned
                                assignedPerson = pendingNormalSwaps[monthKey][groupNum].skippedPerson;
                                delete pendingNormalSwaps[monthKey][groupNum];
                                globalNormalRotationPosition[groupNum] = rotationPosition + 1;
                            } else {
                            // Check if this day is a cross-month swap assignment (person swapped from previous month)
                            // Structure: crossMonthSwaps[dateKey][groupNum] = personName
                            let isCrossMonthSwapDay = false;
                            if (crossMonthSwaps[dateKey] && crossMonthSwaps[dateKey][groupNum]) {
                                // This person was swapped from previous month and must be assigned to this day
                                assignedPerson = crossMonthSwaps[dateKey][groupNum];
                                isCrossMonthSwapDay = true;
                                console.log(`[PREVIEW CROSS-MONTH] Assigning ${assignedPerson} to ${dateKey} (Group ${groupNum}, swapped from previous month)`);
                                // Remove from tracking since we're assigning them now (will be saved when calculation completes)
                                delete crossMonthSwaps[dateKey][groupNum];
                                // If no more groups for this date, remove the date entry
                                if (Object.keys(crossMonthSwaps[dateKey]).length === 0) {
                                    delete crossMonthSwaps[dateKey];
                                }
                            }
                                
                                // PREVIEW MODE: Just show basic rotation WITHOUT swap logic
                                // Swap logic will run when Next is pressed
                                if (!isCrossMonthSwapDay) {
                                    // Check if assigned person is missing, if so find next in rotation
                                    if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date)) {
                                        // Find next person in rotation who is not missing
                                        for (let offset = 1; offset < rotationDays; offset++) {
                                            const nextIndex = (rotationPosition + offset) % rotationDays;
                                            const candidate = groupPeople[nextIndex];
                                            if (candidate && !isPersonMissingOnDate(candidate, groupNum, date)) {
                                                assignedPerson = candidate;
                                                rotationPosition = nextIndex;
                                                break;
                                            }
                                        }
                                    }
                                    
                                    // Check if assigned person has a conflict (will be swapped later)
                                    // If so, DO NOT assign anyone to this day - leave it for swap logic to handle
                                    // Also DO NOT assign the next person in rotation to this day
                                    if (assignedPerson && !isPersonMissingOnDate(assignedPerson, groupNum, date)) {
                                        // Build simulated assignments for conflict checking
                                    const simulatedAssignments = {
                                        special: simulatedSpecialAssignments,
                                        weekend: simulatedWeekendAssignments,
                                        semi: simulatedSemiAssignments,
                                            normal: normalAssignments,
                                            normalRotationPositions: globalNormalRotationPosition // Pass current rotation positions for conflict checking
                                        };
                                        
                                        // Check for consecutive conflict
                                        const hasConflict = hasConsecutiveDuty(dateKey, assignedPerson, groupNum, simulatedAssignments);
                                        
                                        if (hasConflict) {
                                            // Person has conflict - STORE THEM so swap logic can process them
                                            // The preview should show the exact rotation order (who would be assigned)
                                            // even if they have a conflict. Swap logic will handle swapping them.
                                            // DO NOT set to null - we need to know who has the conflict to swap them
                                            // Still advance rotation position so next person gets their correct turn
                                            globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                        } else {
                                            // No conflict - assign person and advance rotation
                                            globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                        }
                                    } else {
                                        // Person is missing or no person assigned - advance rotation position
                                        globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                    }
                                }
                                
                            }
                            
                            // Store assignment (before swap logic)
                            if (!normalAssignments[dateKey]) {
                                normalAssignments[dateKey] = {};
                            }
                            normalAssignments[dateKey][groupNum] = assignedPerson;
                            
                            // Track that this person has been assigned (to prevent duplicate assignment later)
                            if (assignedPerson && assignedPeoplePreview[monthKey] && assignedPeoplePreview[monthKey][groupNum]) {
                                assignedPeoplePreview[monthKey][groupNum].add(assignedPerson);
                            }
                            
                            // Get last duty date and days since for display
                            let lastDutyInfo = '';
                            let daysCountInfo = '';
                            if (assignedPerson) {
                                const daysSince = countDaysSinceLastDuty(dateKey, assignedPerson, groupNum, 'normal', dayTypeLists, startDate);
                                const dutyDates = getLastAndNextDutyDates(assignedPerson, groupNum, 'normal', groupPeople.length);
                                lastDutyInfo = dutyDates.lastDuty !== 'Δεν έχει' ? `<br><small class="text-muted">Τελευταία: ${dutyDates.lastDuty}</small>` : '';
                                
                                if (daysSince !== null && daysSince !== Infinity) {
                                    daysCountInfo = ` <span class="text-info">(${daysSince}/${rotationDays} ημέρες)</span>`;
                                } else if (daysSince === Infinity) {
                                    daysCountInfo = ' <span class="text-success">(πρώτη φορά)</span>';
                                }
                            }
                            
                            html += `<td>${assignedPerson || '-'}${daysCountInfo}${lastDutyInfo}</td>`;
                        }
                    }
                    
                    html += '</tr>';
                });
                
                html += '</tbody>';
                html += '</table>';
                html += '</div>';
            }
            
            html += '</div>';
            
            // NOW APPLY SWAP LOGIC IN PREVIEW (Monday-Wednesday and Tuesday-Thursday rules)
            // This ensures preview shows exactly what will be saved
            // Only apply swap logic if there are normal days
            // Track swaps for popup display
            const previewSwappedPeople = []; // Array of { date, groupNum, skippedPerson, swappedPerson, swapDate, swapDateStr }
            
            if (normalDays.length > 0 && sortedNormal) {
                const swappedPeopleSet = new Set(); // Format: "dateKey:groupNum:personName"
                
                // Apply swap logic to normalAssignments BEFORE displaying
                sortedNormal.forEach((dateKey) => {
                const date = new Date(dateKey + 'T00:00:00');
                
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const groupData = groups[groupNum] || { normal: [] };
                    const groupPeople = groupData.normal || [];
                    
                    if (groupPeople.length === 0) continue;
                    
                    const currentPerson = normalAssignments[dateKey]?.[groupNum];
                    if (!currentPerson) continue;
                    
                    // Skip if this person has already been swapped (prevent re-swapping)
                    const swapKey = `${dateKey}:${groupNum}:${currentPerson}`;
                    if (swappedPeopleSet.has(swapKey)) {
                        continue; // Already swapped, skip
                    }
                    
                    // Check for consecutive conflicts
                                            const simulatedAssignments = {
                                                special: simulatedSpecialAssignments,
                                                weekend: simulatedWeekendAssignments,
                                                semi: simulatedSemiAssignments,
                                                normal: normalAssignments,
                                                normalRotationPositions: globalNormalRotationPosition // Pass current rotation positions for conflict checking
                                            };
                                            
                    const hasConsecutiveConflict = hasConsecutiveDuty(dateKey, currentPerson, groupNum, simulatedAssignments);
                    
                    if (hasConsecutiveConflict) {
                        const dayOfWeek = date.getDay(); // 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday
                        const month = date.getMonth();
                        const year = date.getFullYear();
                        
                        let swapDayKey = null;
                        let swapFound = false;
                        
                        // SEPARATE LOGIC: Monday/Wednesday vs Tuesday/Thursday
                        // Monday (1) or Wednesday (3) - Monday ↔ Wednesday logic
                        if (dayOfWeek === 1 || dayOfWeek === 3) {
                            const alternativeDayOfWeek = dayOfWeek === 1 ? 3 : 1; // Monday ↔ Wednesday
                            
                            // MONDAY/WEDNESDAY - Step 1: Try alternative day in same week
                            const sameWeekDate = new Date(date);
                            const daysToAdd = alternativeDayOfWeek - dayOfWeek;
                            sameWeekDate.setDate(date.getDate() + daysToAdd);
                            const sameWeekKey = formatDateKey(sameWeekDate);
                            
                            if (isSameWeek(date, sameWeekDate) && normalAssignments[sameWeekKey]?.[groupNum]) {
                                const swapCandidate = normalAssignments[sameWeekKey][groupNum];
                                if (!isPersonMissingOnDate(swapCandidate, groupNum, sameWeekDate) &&
                                    !hasConsecutiveDuty(sameWeekKey, swapCandidate, groupNum, simulatedAssignments) &&
                                    !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                    swapDayKey = sameWeekKey;
                                                        swapFound = true;
                                }
                            }
                            
                            // MONDAY/WEDNESDAY - Step 2: ONLY if Step 1 failed, try same day of week in same month
                            if (!swapFound) {
                                const nextSameDay = new Date(year, month, date.getDate() + 7);
                                if (nextSameDay.getMonth() === month) {
                                    const nextSameDayKey = formatDateKey(nextSameDay);
                                    if (normalAssignments[nextSameDayKey]?.[groupNum]) {
                                        const swapCandidate = normalAssignments[nextSameDayKey][groupNum];
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, nextSameDay) &&
                                            !hasConsecutiveDuty(nextSameDayKey, swapCandidate, groupNum, simulatedAssignments) &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            swapDayKey = nextSameDayKey;
                                                            swapFound = true;
                                        }
                                    }
                                }
                            }
                            
                            // MONDAY/WEDNESDAY - Step 3: ONLY if Step 2 failed, try alternative day in week after next OR next month
                            if (!swapFound) {
                                // Try week after next (2 weeks later) - alternative day
                                const weekAfterNextDate = new Date(date);
                                weekAfterNextDate.setDate(date.getDate() + 14);
                                const currentDayOfWeek = weekAfterNextDate.getDay();
                                const daysToAdjust = alternativeDayOfWeek - currentDayOfWeek;
                                weekAfterNextDate.setDate(weekAfterNextDate.getDate() + daysToAdjust);
                                const weekAfterNextKey = formatDateKey(weekAfterNextDate);
                                
                                if (isWeekAfterNext(date, weekAfterNextDate) && normalAssignments[weekAfterNextKey]?.[groupNum]) {
                                    const swapCandidate = normalAssignments[weekAfterNextKey][groupNum];
                                    if (!isPersonMissingOnDate(swapCandidate, groupNum, weekAfterNextDate) &&
                                        !hasConsecutiveDuty(weekAfterNextKey, swapCandidate, groupNum, simulatedAssignments) &&
                                        !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                        swapDayKey = weekAfterNextKey;
                                                            swapFound = true;
                                    }
                                }
                                
                                // If still not found, try next month - alternative day
                                if (!swapFound) {
                                    const nextMonthDate = new Date(year, month + 1, date.getDate());
                                    while (nextMonthDate.getDay() !== alternativeDayOfWeek && nextMonthDate.getDate() <= 31) {
                                        nextMonthDate.setDate(nextMonthDate.getDate() + 1);
                                    }
                                    if (nextMonthDate.getDate() <= 31) {
                                        const nextMonthKey = formatDateKey(nextMonthDate);
                                        if (normalDays.includes(nextMonthKey) && normalAssignments[nextMonthKey]?.[groupNum]) {
                                            const swapCandidate = normalAssignments[nextMonthKey][groupNum];
                                            if (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthDate) &&
                                                !hasConsecutiveDuty(nextMonthKey, swapCandidate, groupNum, simulatedAssignments) &&
                                                !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                swapDayKey = nextMonthKey;
                                                            swapFound = true;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                        }
                        // TUESDAY/THURSDAY - Separate logic block
                        else if (dayOfWeek === 2 || dayOfWeek === 4) {
                            const alternativeDayOfWeek = dayOfWeek === 2 ? 4 : 2; // Tuesday ↔ Thursday
                            
                            // TUESDAY/THURSDAY - Step 1a: Try next same day of week in same month
                            const nextSameDay = new Date(year, month, date.getDate() + 7);
                            if (nextSameDay.getMonth() === month) {
                                const nextSameDayKey = formatDateKey(nextSameDay);
                                if (normalAssignments[nextSameDayKey]?.[groupNum]) {
                                    const swapCandidate = normalAssignments[nextSameDayKey][groupNum];
                                    if (!isPersonMissingOnDate(swapCandidate, groupNum, nextSameDay) &&
                                        !hasConsecutiveDuty(nextSameDayKey, swapCandidate, groupNum, simulatedAssignments) &&
                                        !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                        swapDayKey = nextSameDayKey;
                                        swapFound = true;
                                    }
                                }
                            }
                            
                            // TUESDAY/THURSDAY - Step 1b: ONLY if Step 1a failed, try next same day of week in next month (cross-month)
                            if (!swapFound) {
                                const nextMonthSameDay = new Date(year, month + 1, date.getDate());
                                if (nextMonthSameDay.getDate() === date.getDate()) {
                                    const nextMonthKey = formatDateKey(nextMonthSameDay);
                                    if (normalDays.includes(nextMonthKey) && normalAssignments[nextMonthKey]?.[groupNum]) {
                                        const swapCandidate = normalAssignments[nextMonthKey][groupNum];
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthSameDay) &&
                                            !hasConsecutiveDuty(nextMonthKey, swapCandidate, groupNum, simulatedAssignments) &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            swapDayKey = nextMonthKey;
                                            swapFound = true;
                                        }
                                    }
                                }
                            }
                            
                            // TUESDAY/THURSDAY - Step 2: ONLY if Step 1 failed, try alternative day in same week
                            if (!swapFound) {
                                const sameWeekDate = new Date(date);
                                const daysToAdd = alternativeDayOfWeek - dayOfWeek;
                                sameWeekDate.setDate(date.getDate() + daysToAdd);
                                const sameWeekKey = formatDateKey(sameWeekDate);
                                
                                if (isSameWeek(date, sameWeekDate) && normalAssignments[sameWeekKey]?.[groupNum]) {
                                    const swapCandidate = normalAssignments[sameWeekKey][groupNum];
                                    if (!isPersonMissingOnDate(swapCandidate, groupNum, sameWeekDate) &&
                                        !hasConsecutiveDuty(sameWeekKey, swapCandidate, groupNum, simulatedAssignments) &&
                                        !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                        swapDayKey = sameWeekKey;
                                        swapFound = true;
                                    }
                                }
                            }
                            
                            // TUESDAY/THURSDAY - Step 3: ONLY if Step 2 failed, try next alternative day in same month
                            if (!swapFound) {
                                let nextAlternativeDay = new Date(date);
                                let daysToAdd = alternativeDayOfWeek - dayOfWeek;
                                if (daysToAdd < 0) daysToAdd += 7;
                                if (daysToAdd === 0) daysToAdd = 7;
                                nextAlternativeDay.setDate(date.getDate() + daysToAdd);
                                
                                if (nextAlternativeDay.getMonth() === month) {
                                    const nextAlternativeKey = formatDateKey(nextAlternativeDay);
                                    if (normalAssignments[nextAlternativeKey]?.[groupNum]) {
                                        const swapCandidate = normalAssignments[nextAlternativeKey][groupNum];
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, nextAlternativeDay) &&
                                            !hasConsecutiveDuty(nextAlternativeKey, swapCandidate, groupNum, simulatedAssignments) &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            swapDayKey = nextAlternativeKey;
                                            swapFound = true;
                                        }
                                    }
                                }
                            }
                            
                            // TUESDAY/THURSDAY - Step 4: ONLY if Step 3 failed, try next alternative day in next month (cross-month)
                            if (!swapFound) {
                                let nextMonthAlternative = new Date(year, month + 1, date.getDate());
                                while (nextMonthAlternative.getDay() !== alternativeDayOfWeek && nextMonthAlternative.getDate() <= 31) {
                                    nextMonthAlternative.setDate(nextMonthAlternative.getDate() + 1);
                                }
                                
                                if (nextMonthAlternative.getDate() > 0 && nextMonthAlternative.getDate() <= 31) {
                                    const nextMonthAltKey = formatDateKey(nextMonthAlternative);
                                    if (normalDays.includes(nextMonthAltKey) && normalAssignments[nextMonthAltKey]?.[groupNum]) {
                                        const swapCandidate = normalAssignments[nextMonthAltKey][groupNum];
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthAlternative) &&
                                            !hasConsecutiveDuty(nextMonthAltKey, swapCandidate, groupNum, simulatedAssignments) &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            swapDayKey = nextMonthAltKey;
                                            swapFound = true;
                                        }
                                    }
                                }
                            }
                        }
                        
                        // Perform swap if found
                        if (swapFound && swapDayKey) {
                            const swapCandidate = normalAssignments[swapDayKey][groupNum];
                            
                            // Track swap for popup display
                            previewSwappedPeople.push({
                                date: dateKey,
                                dateStr: date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                                groupNum: groupNum,
                                skippedPerson: currentPerson,
                                swappedPerson: swapCandidate,
                                swapDate: swapDayKey,
                                swapDateStr: new Date(swapDayKey + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                            });
                            
                            // Perform the swap
                            normalAssignments[dateKey][groupNum] = swapCandidate;
                            normalAssignments[swapDayKey][groupNum] = currentPerson;
                            
                            // Mark both people as swapped to prevent re-swapping
                            swappedPeopleSet.add(`${dateKey}:${groupNum}:${currentPerson}`);
                            swappedPeopleSet.add(`${swapDayKey}:${groupNum}:${swapCandidate}`);
                        }
                    }
                }
                });
            }
            
            stepContent.innerHTML = html;
            
            // Now regenerate HTML with swapped assignments (only if there are normal days)
            if (normalDays.length > 0 && sortedNormal) {
                // Find the table body and update it (after HTML is set)
                const tableBody = stepContent.querySelector('tbody');
                if (tableBody) {
                    // Clear existing rows
                    tableBody.innerHTML = '';
                    
                    // Regenerate rows with swapped assignments
                    sortedNormal.forEach((dateKey, normalIndex) => {
                        const date = new Date(dateKey + 'T00:00:00');
                        const dateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        const dayName = getGreekDayName(date);
                        
                        let rowHtml = '<tr>';
                        rowHtml += `<td><strong>${dateStr}</strong></td>`;
                        rowHtml += `<td>${dayName}</td>`;
                        
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            const groupData = groups[groupNum] || { normal: [] };
                            const groupPeople = groupData.normal || [];
                            const rotationDays = groupPeople.length;
                            
                            if (groupPeople.length === 0) {
                                rowHtml += '<td class="text-muted">-</td>';
                            } else {
                                const assignedPerson = normalAssignments[dateKey]?.[groupNum];
                            
                            // Get last duty date and days since for display
                            let lastDutyInfo = '';
                            let daysCountInfo = '';
                            if (assignedPerson) {
                                const daysSince = countDaysSinceLastDuty(dateKey, assignedPerson, groupNum, 'normal', dayTypeLists, startDate);
                                const dutyDates = getLastAndNextDutyDates(assignedPerson, groupNum, 'normal', groupPeople.length);
                                lastDutyInfo = dutyDates.lastDuty !== 'Δεν έχει' ? `<br><small class="text-muted">Τελευταία: ${dutyDates.lastDuty}</small>` : '';
                                
                                if (daysSince !== null && daysSince !== Infinity) {
                                    daysCountInfo = ` <span class="text-info">(${daysSince}/${rotationDays} ημέρες)</span>`;
                                } else if (daysSince === Infinity) {
                                    daysCountInfo = ' <span class="text-success">(πρώτη φορά)</span>';
                                }
                            }
                            
                                rowHtml += `<td>${assignedPerson || '-'}${daysCountInfo}${lastDutyInfo}</td>`;
                        }
                    }
                    
                        rowHtml += '</tr>';
                        tableBody.innerHTML += rowHtml;
                });
                }
            }
            
            // Store preview assignments and save them temporarily to Firestore
            // Convert Sets to arrays for serialization
            const tempSpecialAssignments = {};
            for (const monthKey in simulatedSpecialAssignments) {
                tempSpecialAssignments[monthKey] = {};
                for (const groupNum in simulatedSpecialAssignments[monthKey]) {
                    tempSpecialAssignments[monthKey][groupNum] = Array.from(simulatedSpecialAssignments[monthKey][groupNum]);
                }
            }
            
            // Debug: Log assignment counts
            const normalCount = Object.keys(normalAssignments).length;
            const semiCount = Object.keys(simulatedSemiAssignments).length;
            const weekendCount = Object.keys(simulatedWeekendAssignments).length;
            const specialCount = Object.keys(tempSpecialAssignments).length;
            console.log('[PREVIEW DEBUG] Assignment counts - Normal:', normalCount, 'Semi:', semiCount, 'Weekend:', weekendCount, 'Special months:', specialCount);
            
            // Store all preview assignments in calculationSteps for later use
            calculationSteps.tempAssignments = {
                special: tempSpecialAssignments,
                weekend: simulatedWeekendAssignments,
                semi: simulatedSemiAssignments,
                normal: normalAssignments,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString()
            };
            
            // Store normal assignments and rotation positions for saving when Next is pressed
            calculationSteps.tempNormalAssignments = normalAssignments;
            calculationSteps.lastNormalRotationPositions = {};
            for (let g = 1; g <= 4; g++) {
                if (globalNormalRotationPosition[g] !== undefined) {
                    calculationSteps.lastNormalRotationPositions[g] = globalNormalRotationPosition[g];
                }
            }
            
            // Store preview swaps so they can be shown in popup (will be merged with runNormalSwapLogic results)
            calculationSteps.previewNormalSwaps = previewSwappedPeople;
            
            console.log('[PREVIEW DEBUG] Stored temp assignments in calculationSteps.tempAssignments');
            console.log('[PREVIEW DEBUG] Sample normal assignments:', Object.keys(normalAssignments).slice(0, 5).map(key => ({ date: key, groups: Object.keys(normalAssignments[key] || {}) })));
            
            // Save temporarily to Firestore (async, don't wait)
            saveTempAssignmentsToFirestore(calculationSteps.tempAssignments).then(() => {
                console.log('[PREVIEW DEBUG] Temp assignments saved to Firestore successfully');
            }).catch(error => {
                console.error('[PREVIEW DEBUG] Error saving temp assignments to Firestore:', error);
            });
        }
        
        // Function to save temporary assignments to Firestore
        async function saveTempAssignmentsToFirestore(tempAssignments) {
            try {
                if (!window.db) {
                    console.log('Firebase not ready, skipping temp save');
                    return;
                }
                
                const db = window.db || firebase.firestore();
                const user = window.auth?.currentUser;
                
                if (!user) {
                    console.log('User not authenticated, skipping temp save');
                    return;
                }
                
                const sanitized = sanitizeForFirestore(tempAssignments);
                await db.collection('dutyShifts').doc('tempAssignments').set({
                    ...sanitized,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: user.uid
                });
                console.log('[TEMP SAVE DEBUG] Temp assignments saved to Firestore successfully');
                console.log('[TEMP SAVE DEBUG] Saved data structure:', {
                    normal: Object.keys(tempAssignments.normal || {}).length + ' dates',
                    semi: Object.keys(tempAssignments.semi || {}).length + ' dates',
                    weekend: Object.keys(tempAssignments.weekend || {}).length + ' dates',
                    special: Object.keys(tempAssignments.special || {}).length + ' months'
                });
            } catch (error) {
                console.error('Error saving temp assignments:', error);
            }
        }
        
        // Expose to window for compatibility
        if (typeof window !== 'undefined') {
            window.calculateDutiesForSelectedMonths = calculateDutiesForSelectedMonths;
        }

        // Helper function to add/remove person from day assignment
        function assignPersonToDay(dayKey, person, groupNum) {
            const existingAssignment = getAssignmentForDate(dayKey);
            const personGroupStr = `${person} (Ομάδα ${groupNum})`;
            
            if (existingAssignment) {
                // Ensure existingAssignment is a string
                const assignmentStr = typeof existingAssignment === 'string' ? existingAssignment : String(existingAssignment);
                if (!assignmentStr.includes(personGroupStr)) {
                    // Add to existing assignment
                    setAssignmentForDate(dayKey, assignmentStr + `, ${personGroupStr}`);
                } else {
                    // Replace existing assignment for this group
                    const parts = assignmentStr.split(',').map(p => p.trim()).filter(p => p);
                    const filtered = parts.filter(p => !p.includes(`(Ομάδα ${groupNum})`));
                    filtered.push(personGroupStr);
                    setAssignmentForDate(dayKey, filtered.join(', '));
                }
            } else {
                // Create new assignment
                setAssignmentForDate(dayKey, personGroupStr);
            }
            
            // Clear intended assignment if person is now actually assigned on this day
            // This ensures we don't double-count when person actually gets assigned
            if (intendedAssignments[dayKey] && intendedAssignments[dayKey][groupNum] === person) {
                delete intendedAssignments[dayKey][groupNum];
                if (Object.keys(intendedAssignments[dayKey]).length === 0) {
                    delete intendedAssignments[dayKey];
                }
            }
        }

        function removePersonFromDay(dayKey, person, groupNum) {
            const existingAssignment = getAssignmentForDate(dayKey);
            if (!existingAssignment) return;
            
            const parts = existingAssignment.split(',').map(p => p.trim()).filter(p => p);
            const filtered = parts.filter(p => {
                const match = p.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                if (match && parseInt(match[2]) === groupNum) {
                    return match[1].trim() !== person;
                }
                return true;
            });
            
            if (filtered.length === 0) {
                deleteAssignmentForDate(dayKey);
            } else {
                setAssignmentForDate(dayKey, filtered.join(', '));
            }
        }

        // Helper function to check if person can take a day (no conflicts)
        function canPersonTakeDay(dayKey, person, groupNum, dayTypeCategory) {
            const dayDate = new Date(dayKey + 'T00:00:00');
            
            // Skip if person is missing on this date
            if (isPersonMissingOnDate(person, groupNum, dayDate)) return false;
            
            const priorityLevel = dayTypeCategory === 'special' ? 1 : 
                                (dayTypeCategory === 'weekend' ? 2 : 
                                (dayTypeCategory === 'semi' ? 3 : 4));
            
            const hasConsecutive = hasConsecutiveDuty(dayKey, person, groupNum);
            const hadSpecialBefore = hadSpecialHolidayDutyBefore(dayKey, person, groupNum);
            const hasConsecutiveWeekend = hasConsecutiveWeekendHolidayDuty(dayKey, person, groupNum);
            const hasConsecutiveSpecial = hasConsecutiveSpecialHolidayDuty(dayKey, person, groupNum);
            
            const strictConflict = (priorityLevel <= 2) && (hasConsecutiveSpecial || hasConsecutiveWeekend);
            const generalConflict = hasConsecutive || hadSpecialBefore;
            
            return !strictConflict && !generalConflict;
        }

        // Helper to find last duty key for a person
        function findLastDutyKeyForPerson(person, groupNum, dayTypeCategory, dayTypeLists, startDate, currentDayKey) {
            const days = dayTypeLists[dayTypeCategory];
            const sortedDays = [...days].sort();
            const currentDayIndex = sortedDays.indexOf(currentDayKey);
            
            // Look backwards from current day to find last assignment
            for (let i = currentDayIndex - 1; i >= 0; i--) {
                const dayKey = sortedDays[i];
                const assignment = dutyAssignments[dayKey] || '';
                if (assignment) {
                    const parts = assignment.split(',').map(p => p.trim());
                    for (const part of parts) {
                        const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                        if (match && parseInt(match[2]) === groupNum && match[1].trim() === person) {
                            return dayKey;
                        }
                    }
                }
            }
            
            // Check last duties from person data
            const groupData = groups[groupNum] || {};
            const personData = groupData.lastDuties && groupData.lastDuties[person];
            if (personData) {
                let lastDutyKey = null;
                if (dayTypeCategory === 'special' && personData.special) {
                    lastDutyKey = formatDateKey(new Date(personData.special));
                } else if (dayTypeCategory === 'weekend' && personData.weekend) {
                    lastDutyKey = formatDateKey(new Date(personData.weekend));
                } else if (dayTypeCategory === 'semi' && personData.semi) {
                    lastDutyKey = formatDateKey(new Date(personData.semi));
                } else if (dayTypeCategory === 'normal' && personData.normal) {
                    lastDutyKey = formatDateKey(new Date(personData.normal));
                }
                
                if (lastDutyKey && sortedDays.includes(lastDutyKey)) {
                    return lastDutyKey;
                }
            }
            
            return null;
        }

        // Helper function to find person's original day in rotation based on N-day rotation
        function findPersonOriginalDayInRotation(person, dayTypeCategory, groupNum, dayTypeLists, startDate, currentDayKey) {
            const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [] };
            let groupPeople;
            if (dayTypeCategory === 'special') {
                groupPeople = groupData.special || [];
            } else if (dayTypeCategory === 'weekend') {
                groupPeople = groupData.weekend || [];
            } else if (dayTypeCategory === 'semi') {
                groupPeople = groupData.semi || [];
            } else {
                groupPeople = groupData.normal || [];
            }
            
            const personIndex = groupPeople.indexOf(person);
            if (personIndex === -1) return null;
            
            const days = dayTypeLists[dayTypeCategory];
            const sortedDays = [...days].sort();
            const currentDayIndex = sortedDays.indexOf(currentDayKey);
            
            // Calculate when this person should be assigned based on rotation
            const rotationDays = groupPeople.length;
            
            // Find the last duty date for this person
            const lastDutyKey = findLastDutyKeyForPerson(person, groupNum, dayTypeCategory, dayTypeLists, startDate, currentDayKey);
            
            // If person has never had duty, they should be assigned on their rotation position
            if (!lastDutyKey) {
                // Find first day where this person should be assigned
                for (let i = 0; i < sortedDays.length; i++) {
                    if (i % rotationDays === personIndex) {
                        return sortedDays[i];
                    }
                }
                return null;
            }
            
            // Find the next day where this person should be assigned (N days after last duty)
            const lastDutyIndex = sortedDays.indexOf(lastDutyKey);
            if (lastDutyIndex === -1) return null;
            
            // Find the day that is N positions after last duty
            const nextDutyIndex = lastDutyIndex + rotationDays;
            if (nextDutyIndex < sortedDays.length) {
                return sortedDays[nextDutyIndex];
            }
            
            return null;
        }

        // Helper function to find and assign person to next available day (cascade)
        function findAndAssignNextAvailableDay(person, skipDay, dayTypeCategory, groupNum, dayTypeLists, sortedDays, startDate) {
            const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [] };
            
            // Find next available day after skipDay
            const skipIndex = sortedDays.indexOf(skipDay);
            if (skipIndex === -1) return false; // Day not found
            
            for (let i = skipIndex + 1; i < sortedDays.length; i++) {
                const dayKey = sortedDays[i];
                const dayDate = new Date(dayKey + 'T00:00:00');
                
                // Skip if person is missing on this date
                if (isPersonMissingOnDate(person, groupNum, dayDate)) continue;
                
                // Skip critical assignments
                const isCritical = criticalAssignments[dayKey] && 
                                criticalAssignments[dayKey].some(a => a.includes(`(Ομάδα ${groupNum})`));
                if (isCritical) continue;
                
                // Check if person can take this day (no conflicts)
                if (canPersonTakeDay(dayKey, person, groupNum, dayTypeCategory)) {
                    // Check if this day already has someone assigned for this group
                    const currentAssignment = dutyAssignments[dayKey] || '';
                    let currentPersonForGroup = null;
                    
                    if (currentAssignment) {
                        const parts = currentAssignment.split(',').map(p => p.trim());
                        for (const part of parts) {
                            const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                            if (match && parseInt(match[2]) === groupNum) {
                                currentPersonForGroup = match[1].trim();
                                break;
                            }
                        }
                    }
                    
                    if (currentPersonForGroup && currentPersonForGroup !== person) {
                        // Day already has someone - cascade: move that person forward
                        removePersonFromDay(dayKey, currentPersonForGroup, groupNum);
                        assignPersonToDay(dayKey, person, groupNum);
                        
                        // IMPORTANT: Re-check that this assignment doesn't create consecutive days
                        // Check day after to ensure we don't create consecutive days
                        const dayAfter = new Date(dayDate);
                        dayAfter.setDate(dayAfter.getDate() + 1);
                        const dayAfterKey = formatDateKey(dayAfter);
                        
                        // Check if person has duty the day after (would create consecutive days)
                        if (hasDutyOnDay(dayAfterKey, person, groupNum)) {
                            // This creates consecutive days - undo and try next day
                            removePersonFromDay(dayKey, person, groupNum);
                            assignPersonToDay(dayKey, currentPersonForGroup, groupNum); // Restore original
                            continue; // Try next day
                        }
                        
                        // Recursively find next day for the displaced person
                        findAndAssignNextAvailableDay(currentPersonForGroup, dayKey, dayTypeCategory, groupNum, dayTypeLists, sortedDays, startDate);
                    } else {
                        // Day is free - assign person here
                        assignPersonToDay(dayKey, person, groupNum);
                        
                        // IMPORTANT: Re-check that this assignment doesn't create consecutive days
                        const dayAfter = new Date(dayDate);
                        dayAfter.setDate(dayAfter.getDate() + 1);
                        const dayAfterKey = formatDateKey(dayAfter);
                        
                        // Check if person has duty the day after (would create consecutive days)
                        if (hasDutyOnDay(dayAfterKey, person, groupNum)) {
                            // This creates consecutive days - undo and try next day
                            removePersonFromDay(dayKey, person, groupNum);
                            continue; // Try next day
                        }
                    }
                    
                    return true; // Found and assigned
                }
            }
            
            return false; // No available day found
        }

        // DELETED: processCascadingSwaps and assignDutiesForDayType - unused functions removed

        // Store current day being edited
        let currentEditingDayKey = null;
        let currentEditingDayDate = null;

        // Show day details
        function showDayDetails(date) {
            try {
                const key = formatDateKey(date);
                // Use getAssignmentForDate to get the final assignment after swap logic
                const assignment = getAssignmentForDate(key);
                const dayType = getDayType(date);
                
                // Store selected date for manual assignment
                selectedDateForDuty = date;
                currentEditingDayKey = key;
                currentEditingDayDate = date;
                
                const modalElement = document.getElementById('dayDetailsModal');
                if (!modalElement) {
                    console.error('dayDetailsModal element not found');
                    alert('Το modal δεν βρέθηκε. Παρακαλώ ανανεώστε τη σελίδα.');
                    return;
                }
                
                const modal = new bootstrap.Modal(modalElement);
                const titleElement = document.getElementById('dayDetailsTitle');
                if (titleElement) {
                    titleElement.textContent = formatDate(date);
                }
            
            let content = `
                <div class="mb-3">
                    <strong>Τύπος Ημέρας:</strong> ${getDayTypeLabel(dayType)}
                </div>
            `;
            
            if (isSpecialHoliday(date)) {
                const holidayName = getOrthodoxHolidayName(date);
                const displayName = holidayName || 'Ειδική Αργία';
                
                content += `
                    <div class="alert alert-warning" style="background: #FFE082; border-color: #FFC107;">
                        <i class="fas fa-star me-2"></i>
                        <strong>Ειδική Αργία:</strong> ${displayName}
                    </div>
                `;
            } else if (isOrthodoxOrCyprusHoliday(date)) {
                const holidayName = getOrthodoxHolidayNameAuto(date);
                content += `
                    <div class="alert alert-info">
                        <i class="fas fa-church me-2"></i>
                        <strong>Ορθόδοξη/Κυπριακή Αργία:</strong> ${holidayName || 'Αργία'}
                    </div>
                `;
            } else if (isHoliday(date)) {
                const holiday = holidays.find(h => h.date === key);
                content += `
                    <div class="alert alert-info">
                        <i class="fas fa-calendar-times me-2"></i>
                        <strong>Αργία:</strong> ${holiday ? holiday.name : 'Αργία'}
                    </div>
                `;
            }
            
            // Extract person-group combinations - ensure one per group (1-4)
            const personGroups = [];
            const groupsFound = new Set();
            
            if (assignment) {
                // Split by comma first, then extract person-group info
                const parts = assignment.split(',').map(p => p.trim()).filter(p => p);
                
                parts.forEach(part => {
                    // Try to match "Name (Ομάδα X)" pattern
                    const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                    if (match) {
                        const name = match[1].trim().replace(/^,+\s*/, '').replace(/\s*,+$/, ''); // Remove leading/trailing commas
                        const group = parseInt(match[2]);
                        if (!groupsFound.has(group)) {
                            personGroups.push({
                                name: name,
                                group: group,
                                fullString: part
                            });
                            groupsFound.add(group);
                        }
                    } else {
                        // Try to extract group info if it exists elsewhere in the string
                        const groupMatch = part.match(/\(Ομάδα\s*(\d+)\)/);
                        if (groupMatch) {
                            const group = parseInt(groupMatch[1]);
                            const name = part.replace(/\s*\(Ομάδα\s*\d+\)\s*/, '').trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '');
                            if (!groupsFound.has(group)) {
                                personGroups.push({
                                    name: name,
                                    group: group,
                                    fullString: part
                                });
                                groupsFound.add(group);
                            }
                        }
                    }
                });
            }
            
            // Ensure we have one person per group (1-4), even if not assigned
            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                if (!groupsFound.has(groupNum)) {
                    personGroups.push({
                        name: '',
                        group: groupNum,
                        fullString: ''
                    });
                }
            }
            
            // Sort by group number
            personGroups.sort((a, b) => a.group - b.group);
            
            // Check critical assignments
            const criticalPeople = criticalAssignments[key] || [];
            
            // Create editable dropdown fields for each group
            content += `
                <div class="mb-3">
                    <strong><i class="fas fa-user-shield me-2"></i>Σε Υπηρεσία:</strong>
                    <div id="dutyPersonsContainer" class="mt-2">
            `;
            
            personGroups.forEach((person, index) => {
                const isCritical = person.name && criticalPeople.some(cp => {
                    if (person.group) {
                        return cp === person.fullString || (cp.includes(person.name) && cp.includes(`(Ομάδα ${person.group})`));
                    } else {
                        return cp.includes(person.name);
                    }
                });
                
                // Get skip/swap reason
                const reason = person.name ? getAssignmentReason(key, person.group, person.name) : null;
                let reasonBadge = '';
                if (reason) {
                    if (reason.type === 'skip') {
                        reasonBadge = `<span class="badge bg-warning ms-2" title="${reason.reason}"><i class="fas fa-arrow-right me-1"></i>Παραλείφθηκε</span>`;
                    } else if (reason.type === 'swap') {
                        reasonBadge = `<span class="badge bg-info ms-2" title="${reason.reason}"><i class="fas fa-exchange-alt me-1"></i>Αλλαγή${reason.swappedWith ? ` με ${reason.swappedWith}` : ''}</span>`;
                    }
                }
                
                const groupName = person.group ? getGroupName(person.group) : 'Άγνωστη Ομάδα';
                const criticalClass = isCritical ? 'border-danger bg-light' : '';
                const criticalLabel = isCritical ? '<span class="badge bg-danger ms-2"><i class="fas fa-lock me-1"></i>Κρίσιμη (Απόβαση)</span>' : '';
                const disabledAttr = isCritical ? 'disabled' : '';
                const disabledTitle = isCritical ? 'title="Αυτή η ανάθεση είναι κρίσιμη και δεν μπορεί να αλλάξει"' : '';
                
                // Add reason display below the person name
                const reasonDisplay = reason ? `<div class="mt-1 small text-muted"><i class="fas fa-info-circle me-1"></i><strong>Λόγος:</strong> ${reason.reason}</div>` : '';
                
                // Get all people from this group for dropdown
                const groupData = groups[person.group] || {};
                const allPeopleInGroup = new Set();
                ['special', 'weekend', 'semi', 'normal'].forEach(listType => {
                    if (groupData[listType]) {
                        groupData[listType].forEach(p => allPeopleInGroup.add(p));
                    }
                });
                const peopleList = Array.from(allPeopleInGroup).sort();
                
                // Build dropdown options
                let peopleOptions = '<option value="">-- Επιλέξτε Άτομο --</option>';
                peopleOptions += peopleList.map(p => 
                    `<option value="${p}" ${p === person.name ? 'selected' : ''}>${p}</option>`
                ).join('');
                
                content += `
                    <div class="mb-2 p-2 border rounded ${criticalClass}" ${disabledTitle}>
                        <label class="form-label small text-muted">Ομάδα ${person.group}: ${groupName}${criticalLabel}${reasonBadge}</label>
                        <select class="form-select duty-person-select" 
                                data-index="${index}" 
                                data-group="${person.group}" 
                                data-original-name="${person.name || ''}"
                                data-is-critical="${isCritical ? 'true' : 'false'}"
                                ${disabledAttr}>
                            ${peopleOptions}
                        </select>
                        ${reasonDisplay}
                        ${isCritical ? '<small class="text-muted d-block mt-1"><i class="fas fa-info-circle me-1"></i>Αυτή η ανάθεση προέρχεται από τις ημερομηνίες τελευταίας υπηρεσίας και δεν μπορεί να αλλάξει.</small>' : ''}
                    </div>
                `;
            });
            
            content += `
                    </div>
                </div>
            `;
            
            // Collect all swap details for this date
            const swapDetails = [];
            if (assignmentReasons[key]) {
                for (const groupNumStr in assignmentReasons[key]) {
                    const groupNum = parseInt(groupNumStr);
                    if (isNaN(groupNum)) continue;
                    
                    for (const personName in assignmentReasons[key][groupNum]) {
                        const reason = assignmentReasons[key][groupNum][personName];
                        if (reason && reason.type === 'swap') {
                            // Find the other person in the swap pair
                            let swappedWithPerson = reason.swappedWith || 'Άγνωστο';
                            let swapDate = null;
                            
                            // Search for the other person in the swap pair by swapPairId
                            if (reason.swapPairId !== null && reason.swapPairId !== undefined) {
                                for (const otherDateKey in assignmentReasons) {
                                    for (const otherGroupNumStr in assignmentReasons[otherDateKey]) {
                                        const otherGroupNum = parseInt(otherGroupNumStr);
                                        if (isNaN(otherGroupNum)) continue;
                                        
                                        for (const otherPersonName in assignmentReasons[otherDateKey][otherGroupNum]) {
                                            const otherReason = assignmentReasons[otherDateKey][otherGroupNum][otherPersonName];
                                            if (otherReason && 
                                                otherReason.type === 'swap' && 
                                                otherReason.swapPairId === reason.swapPairId &&
                                                (otherDateKey !== key || otherGroupNum !== groupNum || otherPersonName !== personName)) {
                                                swappedWithPerson = otherPersonName;
                                                swapDate = otherDateKey;
                                                break;
                                            }
                                        }
                                        if (swapDate) break;
                                    }
                                    if (swapDate) break;
                                }
                            }
                            
                            swapDetails.push({
                                groupNum: groupNum,
                                personName: personName,
                                swappedWith: swappedWithPerson,
                                swapDate: swapDate,
                                reason: reason.reason,
                                swapPairId: reason.swapPairId
                            });
                        }
                    }
                }
            }
            
            // Display swap details if any
            if (swapDetails.length > 0) {
                content += `
                    <div class="mt-3 mb-3">
                        <strong><i class="fas fa-exchange-alt me-2"></i>Λεπτομέρειες Αλλαγών:</strong>
                        <div class="mt-2">
                `;
                
                swapDetails.forEach((swap, index) => {
                    const swapColors = [
                        { border: '#FF1744', bg: 'rgba(255, 23, 68, 0.15)' }, // Bright Red
                        { border: '#00E676', bg: 'rgba(0, 230, 118, 0.15)' }, // Bright Green
                        { border: '#FFD600', bg: 'rgba(255, 214, 0, 0.15)' }, // Bright Yellow
                        { border: '#00B0FF', bg: 'rgba(0, 176, 255, 0.15)' }, // Bright Blue
                        { border: '#D500F9', bg: 'rgba(213, 0, 249, 0.15)' }, // Bright Purple
                        { border: '#FF6D00', bg: 'rgba(255, 109, 0, 0.15)' }, // Bright Orange
                        { border: '#00E5FF', bg: 'rgba(0, 229, 255, 0.15)' }, // Bright Cyan
                        { border: '#FF4081', bg: 'rgba(255, 64, 129, 0.15)' }  // Bright Pink
                    ];
                    const swapPairId = typeof swap.swapPairId === 'number' ? swap.swapPairId : parseInt(swap.swapPairId);
                    const swapColor = !isNaN(swapPairId) ? swapColors[swapPairId % swapColors.length] : swapColors[0];
                    const swapDateStr = swap.swapDate ? new Date(swap.swapDate + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Άγνωστη';
                    
                    content += `
                        <div class="p-2 mb-2 border rounded" style="border-color: ${swapColor.border} !important; background-color: ${swapColor.bg};">
                            <div class="d-flex align-items-center mb-1">
                                <i class="fas fa-exchange-alt me-2" style="color: ${swapColor.border};"></i>
                                <strong>Ομάδα ${swap.groupNum}:</strong>
                            </div>
                            <div class="ms-4 small">
                                <div><strong>${swap.personName}</strong> <i class="fas fa-arrow-right mx-1"></i> <strong>${swap.swappedWith}</strong></div>
                                <div class="text-muted mt-1">
                                    <i class="fas fa-calendar-alt me-1"></i>Ημερομηνία αλλαγής: ${swapDateStr}
                                </div>
                                ${swap.reason ? `<div class="text-muted mt-1"><i class="fas fa-info-circle me-1"></i>${swap.reason}</div>` : ''}
                            </div>
                        </div>
                    `;
                });
                
                content += `
                        </div>
                    </div>
                `;
            }
            
                document.getElementById('dayDetailsContent').innerHTML = content;
                
                // Buttons are now in the modal footer, no need to show/hide them
                modal.show();
            } catch (error) {
                console.error('Error in showDayDetails:', error);
                alert('Σφάλμα: ' + error.message);
            }
        }
        
        // Functions removed - no longer needed as we show all 4 groups with dropdowns
        
        // Save day assignments
        function saveDayAssignments() {
            if (!currentEditingDayKey) return;
            
            const container = document.getElementById('dutyPersonsContainer');
            const selects = container.querySelectorAll('.duty-person-select');
            const newAssignments = [];
            
            // Get original critical assignments
            const originalCritical = criticalAssignments[currentEditingDayKey] || [];
            const originalCriticalPeople = new Set();
            originalCritical.forEach(cp => {
                const match = cp.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                if (match) {
                    const name = match[1].trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '');
                    const group = parseInt(match[2]);
                    originalCriticalPeople.add(`${name}|${group}`);
                }
            });
            
            selects.forEach(select => {
                const isCritical = select.dataset.isCritical === 'true';
                const personName = select.value.trim();
                const group = select.dataset.group;
                
                // If critical, use the original value (don't allow changes)
                if (isCritical) {
                    const originalName = select.dataset.originalName;
                    if (originalName && group) {
                        newAssignments.push(`${originalName} (Ομάδα ${group})`);
                    }
                } else if (personName && group) {
                    // Non-critical assignments can be changed
                    newAssignments.push(`${personName} (Ομάδα ${group})`);
                }
            });
            
            // Update dutyAssignments
            if (newAssignments.length > 0) {
                dutyAssignments[currentEditingDayKey] = newAssignments.join(', ');
            } else {
                delete dutyAssignments[currentEditingDayKey];
            }
            
            // Preserve all original critical assignments
            const newCritical = [];
            newAssignments.forEach(newAssignment => {
                const match = newAssignment.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                if (match) {
                    const name = match[1].trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '');
                    const group = parseInt(match[2]);
                    if (originalCriticalPeople.has(`${name}|${group}`)) {
                        newCritical.push(newAssignment);
                    }
                }
            });
            
            if (newCritical.length > 0) {
                criticalAssignments[currentEditingDayKey] = newCritical;
            } else {
                delete criticalAssignments[currentEditingDayKey];
            }
            
            saveData();
            renderCalendar();
            
            // Close modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('dayDetailsModal'));
            if (modal) {
                modal.hide();
            }
            
            alert('Οι αλλαγές αποθηκεύτηκαν επιτυχώς!');
        }

        // Open assign duty modal from day details
        function openAssignDutyModal() {
            // Close day details modal
            const dayDetailsModal = bootstrap.Modal.getInstance(document.getElementById('dayDetailsModal'));
            if (dayDetailsModal) {
                dayDetailsModal.hide();
            }
            
            openAssignDutyModalForDate(selectedDateForDuty);
        }

        // Open assign duty modal for a specific date (or current date if not specified)
        function openAssignDutyModalForDate(date = null) {
            // Clear previous event listeners
            const groupSelect = document.getElementById('assignDutyGroup');
            const newGroupSelect = groupSelect.cloneNode(true);
            groupSelect.parentNode.replaceChild(newGroupSelect, groupSelect);
            
            // Set date in assign modal
            const dateInput = document.getElementById('assignDutyDate');
            if (date) {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                dateInput.value = `${year}-${month}-${day}`;
                selectedDateForDuty = date;
            } else {
                // Use today's date
                const today = new Date();
                const year = today.getFullYear();
                const month = String(today.getMonth() + 1).padStart(2, '0');
                const day = String(today.getDate()).padStart(2, '0');
                dateInput.value = `${year}-${month}-${day}`;
                selectedDateForDuty = today;
            }
            
            // Reset form
            document.getElementById('assignDutyGroup').value = '';
            document.getElementById('assignDutyPerson').innerHTML = '<option value="">Επιλέξτε Άτομο</option>';
            
            // Update person dropdown when group changes
            document.getElementById('assignDutyGroup').addEventListener('change', function() {
                updatePersonDropdown();
            });
            
            // Open modal
            const modal = new bootstrap.Modal(document.getElementById('assignDutyModal'));
            modal.show();
        }

        // Update person dropdown based on selected group
        function updatePersonDropdown() {
            const groupSelect = document.getElementById('assignDutyGroup');
            const personSelect = document.getElementById('assignDutyPerson');
            const selectedGroup = parseInt(groupSelect.value);
            
            personSelect.innerHTML = '<option value="">Επιλέξτε Άτομο</option>';
            
            if (selectedGroup && groups[selectedGroup]) {
                const groupData = groups[selectedGroup];
                const specialList = groupData.special || [];
                const weekendList = groupData.weekend || [];
                const semiList = groupData.semi || [];
                const normalList = groupData.normal || [];
                // Combine all lists, removing duplicates
                const allPeople = [...new Set([...specialList, ...weekendList, ...semiList, ...normalList])];
                
                if (allPeople.length > 0) {
                    allPeople.forEach(person => {
                        const option = document.createElement('option');
                        option.value = person;
                        option.textContent = person;
                        personSelect.appendChild(option);
                    });
                }
            }
        }

        // Save manual duty assignment
        function saveManualDuty() {
            const date = document.getElementById('assignDutyDate').value;
            const groupNum = parseInt(document.getElementById('assignDutyGroup').value);
            const person = document.getElementById('assignDutyPerson').value.trim();
            
            if (!date) {
                alert('Παρακαλώ επιλέξτε ημερομηνία');
                return;
            }
            
            if (!groupNum || !person) {
                alert('Παρακαλώ επιλέξτε ομάδα και άτομο');
                return;
            }
            
            const dateKey = formatDateKey(new Date(date + 'T00:00:00'));
            
            // Check if assignment already exists
            if (dutyAssignments[dateKey]) {
                // Update existing assignment
                const existing = dutyAssignments[dateKey];
                // Ensure existing is a string
                const existingStr = typeof existing === 'string' ? existing : String(existing || '');
                // Remove old assignment for this group if exists
                const updated = existingStr.split(', ').filter(a => !a.includes(`Ομάδα ${groupNum}`));
                updated.push(`${person} (Ομάδα ${groupNum})`);
                dutyAssignments[dateKey] = updated.join(', ');
            } else {
                // Create new assignment
                dutyAssignments[dateKey] = `${person} (Ομάδα ${groupNum})`;
            }
            
            saveData();
            renderCalendar();
            
            const modal = bootstrap.Modal.getInstance(document.getElementById('assignDutyModal'));
            modal.hide();
            
            alert('Η ανάθεση υπηρεσίας αποθηκεύτηκε επιτυχώς!');
        }

        // Remove duty assignment
        function removeDutyAssignment() {
            if (!selectedDateForDuty) return;
            
            if (!confirm('Είστε σίγουροι ότι θέλετε να αφαιρέσετε την ανάθεση υπηρεσίας για αυτή την ημέρα;')) {
                return;
            }
            
            const key = formatDateKey(selectedDateForDuty);
            delete dutyAssignments[key];
            
            saveData();
            renderCalendar();
            
            const modal = bootstrap.Modal.getInstance(document.getElementById('dayDetailsModal'));
            modal.hide();
            
            alert('Η ανάθεση υπηρεσίας αφαιρέθηκε επιτυχώς!');
        }

        // Check if person is missing on a specific date
        function isPersonMissingOnDate(person, groupNum, date) {
            const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {} };
            const missingPeriods = groupData.missingPeriods?.[person] || [];
            if (missingPeriods.length === 0) return false;
            
            const checkDate = new Date(date);
            checkDate.setHours(0, 0, 0, 0);
            
            return missingPeriods.some(period => {
                const start = new Date(period.start + 'T00:00:00');
                const end = new Date(period.end + 'T00:00:00');
                return checkDate >= start && checkDate <= end;
            });
        }

        // Open missing period modal
        let currentMissingPeriodGroup = null;
        let currentMissingPeriodPerson = null;
        
        function openMissingPeriodModal(groupNum, person) {
            currentMissingPeriodGroup = groupNum;
            currentMissingPeriodPerson = person;
            
            document.getElementById('missingPeriodPersonName').textContent = person;
            document.getElementById('missingPeriodStart').value = '';
            document.getElementById('missingPeriodEnd').value = '';
            
            renderMissingPeriodsList();
            
            const modal = new bootstrap.Modal(document.getElementById('missingPeriodModal'));
            modal.show();
        }

        // Render missing periods list
        function renderMissingPeriodsList() {
            const container = document.getElementById('missingPeriodsList');
            const groupData = groups[currentMissingPeriodGroup] || { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {} };
            const missingPeriods = groupData.missingPeriods?.[currentMissingPeriodPerson] || [];
            
            if (missingPeriods.length === 0) {
                container.innerHTML = '<p class="text-muted text-center small">Δεν υπάρχουν καταχωρημένες περιόδοι απουσίας</p>';
                return;
            }
            
            container.innerHTML = missingPeriods.map((period, index) => {
                const startDate = new Date(period.start + 'T00:00:00');
                const endDate = new Date(period.end + 'T00:00:00');
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const isActive = today >= startDate && today <= endDate;
                const isPast = today > endDate;
                const isFuture = today < startDate;
                
                let statusBadge = '';
                if (isActive) statusBadge = '<span class="badge bg-warning ms-2">Ενεργή</span>';
                else if (isPast) statusBadge = '<span class="badge bg-secondary ms-2">Παρελθούσα</span>';
                else if (isFuture) statusBadge = '<span class="badge bg-info ms-2">Μελλοντική</span>';
                
                return `
                    <div class="card mb-2">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-center">
                                <div>
                                    <strong>${formatDate(startDate)}</strong> - <strong>${formatDate(endDate)}</strong>
                                    ${statusBadge}
                                </div>
                                <button class="btn btn-sm btn-outline-danger" onclick="removeMissingPeriod(${index})">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Add missing period
        function addMissingPeriod() {
            const start = document.getElementById('missingPeriodStart').value;
            const end = document.getElementById('missingPeriodEnd').value;
            
            if (!start || !end) {
                alert('Παρακαλώ συμπληρώστε και τις δύο ημερομηνίες');
                return;
            }
            
            const startDate = new Date(start + 'T00:00:00');
            const endDate = new Date(end + 'T00:00:00');
            
            if (endDate < startDate) {
                alert('Η ημερομηνία λήξης πρέπει να είναι μετά την ημερομηνία έναρξης');
                return;
            }
            
            const groupData = groups[currentMissingPeriodGroup] || { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {} };
            if (!groupData.missingPeriods) groupData.missingPeriods = {};
            if (!groupData.missingPeriods[currentMissingPeriodPerson]) {
                groupData.missingPeriods[currentMissingPeriodPerson] = [];
            }
            
            groupData.missingPeriods[currentMissingPeriodPerson].push({
                start: start,
                end: end
            });
            
            // Sort periods by start date
            groupData.missingPeriods[currentMissingPeriodPerson].sort((a, b) => {
                return new Date(a.start) - new Date(b.start);
            });
            
            document.getElementById('missingPeriodStart').value = '';
            document.getElementById('missingPeriodEnd').value = '';
            
            saveData();
            renderMissingPeriodsList();
            renderGroups();
        }

        // Remove missing period
        function removeMissingPeriod(index) {
            if (!confirm('Είστε σίγουροι ότι θέλετε να αφαιρέσετε αυτή την περίοδο απουσίας;')) {
                return;
            }
            
            const groupData = groups[currentMissingPeriodGroup] || { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {} };
            if (groupData.missingPeriods && groupData.missingPeriods[currentMissingPeriodPerson]) {
                groupData.missingPeriods[currentMissingPeriodPerson].splice(index, 1);
                if (groupData.missingPeriods[currentMissingPeriodPerson].length === 0) {
                    delete groupData.missingPeriods[currentMissingPeriodPerson];
                }
            }
            
            saveData();
            renderMissingPeriodsList();
            renderGroups();
        }

        // Toggle list collapse/expand
        function toggleListCollapse(listId, chevronId) {
            const listElement = document.getElementById(listId);
            const chevronElement = document.getElementById(chevronId);
            
            if (listElement && chevronElement) {
                // Check current state BEFORE toggling
                const isCurrentlyShown = listElement.classList.contains('show');
                
                // Toggle Bootstrap collapse
                const bsCollapse = new bootstrap.Collapse(listElement, {
                    toggle: true
                });
                
                // Update chevron icon based on what the state WILL BE (opposite of current)
                if (isCurrentlyShown) {
                    // Currently shown, will be hidden - show down arrow
                    chevronElement.classList.remove('fa-chevron-up');
                    chevronElement.classList.add('fa-chevron-down');
                } else {
                    // Currently hidden, will be shown - show up arrow
                    chevronElement.classList.remove('fa-chevron-down');
                    chevronElement.classList.add('fa-chevron-up');
                }
            }
        }
        
        // Expose to window for onclick handlers
        if (typeof window !== 'undefined') {
            window.toggleListCollapse = toggleListCollapse;
        }

        // Update statistics
        function updateStatistics() {
            let totalPeople = 0;
            let totalRotation = 0;
            let groupCount = 0;
            
            for (let i = 1; i <= 4; i++) {
                const groupData = groups[i] || { special: [], weekend: [], semi: [], normal: [], lastDuties: {} };
                const specialList = groupData.special || [];
                const weekendList = groupData.weekend || [];
                const semiList = groupData.semi || [];
                const normalList = groupData.normal || [];
                // Count unique people across all lists
                const uniquePeople = new Set([...specialList, ...weekendList, ...semiList, ...normalList]);
                const peopleCount = uniquePeople.size;
                
                if (peopleCount > 0) {
                    totalPeople += peopleCount;
                    totalRotation += peopleCount;
                    groupCount++;
                }
            }
            
            document.getElementById('totalPeople').textContent = totalPeople;
            document.getElementById('avgRotation').textContent = 
                groupCount > 0 ? Math.round(totalRotation / groupCount) : 0;
        }

        // Helper function to get consecutive duty dates for detailed violation messages
        function getConsecutiveDutyDates(dayKey, person, groupNum) {
            const consecutiveDates = [];
            const date = new Date(dayKey + 'T00:00:00');
            
            // Check day before
            const dayBefore = new Date(date);
            dayBefore.setDate(dayBefore.getDate() - 1);
            const dayBeforeKey = formatDateKey(dayBefore);
            if (hasDutyOnDay(dayBeforeKey, person, groupNum)) {
                consecutiveDates.push(dayBeforeKey);
            }
            
            // Check day after
            const dayAfter = new Date(date);
            dayAfter.setDate(dayAfter.getDate() + 1);
            const dayAfterKey = formatDateKey(dayAfter);
            if (dutyAssignments[dayAfterKey] && hasDutyOnDay(dayAfterKey, person, groupNum)) {
                consecutiveDates.push(dayAfterKey);
            }
            
            return consecutiveDates;
        }
        
        // Helper function to get the special holiday date that caused a weekend skip
        function getSpecialHolidayBeforeDate(dayKey, person, groupNum) {
            const date = new Date(dayKey + 'T00:00:00');
            
            // Get group data to find rotation days
            const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [] };
            const groupPeople = groupData.weekend || [];
            if (groupPeople.length === 0) return null;
            
            // Find last weekend/holiday duty for this person
            let lastWeekendDutyDate = null;
            
            // Check manually entered last duties first
            const lastDuties = groupData.lastDuties?.[person];
            if (lastDuties && lastDuties.weekend) {
                lastWeekendDutyDate = new Date(lastDuties.weekend + 'T00:00:00');
            }
            
            // Also check actual assignments (use the more recent one)
            const checkDate = new Date(date);
            for (let i = 1; i <= 365; i++) {
                checkDate.setDate(checkDate.getDate() - 1);
                const checkKey = formatDateKey(checkDate);
                const checkDayType = getDayType(checkDate);
                const isCheckWeekend = checkDate.getDay() === 0 || checkDate.getDay() === 6;
                const isCheckHoliday = checkDayType === 'weekend-holiday' && !isSpecialHoliday(checkDate);
                
                if ((isCheckWeekend || isCheckHoliday) && hasDutyOnDay(checkKey, person, groupNum)) {
                    const checkDateCopy = new Date(checkDate);
                    if (!lastWeekendDutyDate || checkDateCopy > lastWeekendDutyDate) {
                        lastWeekendDutyDate = checkDateCopy;
                    }
                    break;
                }
            }
            
            if (!lastWeekendDutyDate) return null;
            
            // Check if there's a special holiday between last weekend duty and current day
            const checkSpecialDate = new Date(lastWeekendDutyDate);
            checkSpecialDate.setDate(checkSpecialDate.getDate() + 1);
            while (checkSpecialDate < date) {
                if (isSpecialHoliday(checkSpecialDate) && hasDutyOnDay(formatDateKey(checkSpecialDate), person, groupNum)) {
                    return formatDateKey(checkSpecialDate);
                }
                checkSpecialDate.setDate(checkSpecialDate.getDate() + 1);
            }
            
            return null;
        }
        
        // Helper function to get missing period for a person on a specific date
        function getPersonMissingPeriod(person, groupNum, date) {
            const groupData = groups[groupNum] || {};
            const personData = groupData.missingPeriods?.[person];
            if (!personData || !Array.isArray(personData)) return null;
            
            for (const period of personData) {
                const startDate = new Date(period.start + 'T00:00:00');
                const endDate = new Date(period.end + 'T00:00:00');
                if (date >= startDate && date <= endDate) {
                    return {
                        start: startDate,
                        end: endDate
                    };
                }
            }
            return null;
        }
        
        // Analyze rotation violations
        function analyzeRotationViolations() {
            const violations = [];
            
            // Get dates only for the current month being viewed
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            const daysInMonth = lastDay.getDate();
            
            // Build list of dates for current month
            const allDates = [];
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month, day);
                allDates.push(formatDateKey(date));
            }
            
            // For each date, check each group
            for (const dayKey of allDates) {
                const date = new Date(dayKey + 'T00:00:00');
                const dayType = getDayType(date);
                
                // Determine day type category
                let dayTypeCategory = 'normal';
                if (dayType === 'special-holiday') {
                    dayTypeCategory = 'special';
                } else if (dayType === 'weekend-holiday') {
                    dayTypeCategory = 'weekend';
                } else if (dayType === 'semi-normal-day') {
                    dayTypeCategory = 'semi';
                }
                
                // Check each group
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const groupData = groups[groupNum];
                    if (!groupData) continue;
                    
                    // Get the appropriate list for this day type
                    let groupPeople;
                    if (dayTypeCategory === 'special') {
                        groupPeople = groupData.special || [];
                    } else if (dayTypeCategory === 'weekend') {
                        groupPeople = groupData.weekend || [];
                    } else if (dayTypeCategory === 'semi') {
                        groupPeople = groupData.semi || [];
                    } else {
                        groupPeople = groupData.normal || [];
                    }
                    
                    if (groupPeople.length === 0) continue;
                    
                    // Get who is actually assigned (from correct day-type document)
                    const assignment = getAssignmentForDate(dayKey) || '';
                    let assignedPerson = null;
                    if (assignment) {
                        const parts = assignment.split(',').map(p => p.trim()).filter(p => p);
                        for (const part of parts) {
                            const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                            if (match && parseInt(match[2]) === groupNum) {
                                assignedPerson = match[1].trim();
                                break;
                            }
                        }
                    }
                    
                    // Skip if no one is assigned (shouldn't happen, but handle it)
                    if (!assignedPerson) continue;
                    
                    // Determine who SHOULD be assigned based on strict rotation order from February 2026
                    const rotationDays = groupPeople.length;
                    
                    // Calculate rotation position based on days since February 2026
                    const rotationPosition = getRotationPosition(date, dayTypeCategory, groupNum) % rotationDays;
                    let expectedPerson = groupPeople[rotationPosition];
                    
                    // If expected person is missing, find next in rotation
                    if (expectedPerson && isPersonMissingOnDate(expectedPerson, groupNum, date)) {
                        for (let offset = 1; offset < rotationDays; offset++) {
                            const nextIndex = (rotationPosition + offset) % rotationDays;
                            const candidate = groupPeople[nextIndex];
                            if (candidate && !isPersonMissingOnDate(candidate, groupNum, date)) {
                                expectedPerson = candidate;
                            break;
                        }
                    }
                    }
                    
                    let violationReason = '';
                    
                    // Compare assigned vs expected
                    if (expectedPerson && assignedPerson !== expectedPerson) {
                        // Check if expected person is in the list
                        const expectedIndex = groupPeople.indexOf(expectedPerson);
                        const assignedIndex = groupPeople.indexOf(assignedPerson);
                        
                        if (assignedIndex === -1) {
                            violationReason = 'Το άτομο που ανέθεται δεν είναι στη λίστα περιστροφής';
                        } else if (expectedIndex === -1) {
                            // Expected person not in list (shouldn't happen)
                            continue;
                        } else {
                            // Check why expected person was skipped - use the SAME logic as the calculation
                            const isMissing = isPersonMissingOnDate(expectedPerson, groupNum, date);
                            
                            // Get detailed information about conflicts based on day type
                            let conflictDetails = [];
                            let hasLegitimateConflict = false;
                            
                            // Check if person is missing
                            if (isMissing) {
                                hasLegitimateConflict = true;
                                const missingPeriod = getPersonMissingPeriod(expectedPerson, groupNum, date);
                                if (missingPeriod) {
                                    const startStr = missingPeriod.start.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                    const endStr = missingPeriod.end.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                    conflictDetails.push(`Άτομο λείπει: ${startStr} - ${endStr}`);
                                } else {
                                    conflictDetails.push(`Άτομο λείπει`);
                                }
                            }
                            
                            // Check conflicts based on day type (matching calculation logic)
                            if (dayTypeCategory === 'weekend') {
                                // For weekends: check if person has special holiday in the same month
                                if (hasSpecialHolidayDutyInMonth(expectedPerson, groupNum, month, year)) {
                                    hasLegitimateConflict = true;
                                    // Find which special holiday in this month
                                    const firstDay = new Date(year, month, 1);
                                    const lastDay = new Date(year, month + 1, 0);
                                    const checkDate = new Date(firstDay);
                                    while (checkDate <= lastDay) {
                                        if (isSpecialHoliday(checkDate) && hasDutyOnDay(formatDateKey(checkDate), expectedPerson, groupNum)) {
                                            const specialDateStr = checkDate.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                            const holidayName = getOrthodoxHolidayNameAuto(checkDate) || 'Ειδική Αργία';
                                            conflictDetails.push(`Έχει ειδική αργία: ${holidayName} (${specialDateStr})`);
                                            break;
                                        }
                                        checkDate.setDate(checkDate.getDate() + 1);
                                    }
                                }
                            } else if (dayTypeCategory === 'semi') {
                                // For semi-normal: check if expected person has consecutive weekend or special holiday
                                const dayBefore = new Date(date);
                                dayBefore.setDate(dayBefore.getDate() - 1);
                                const dayAfter = new Date(date);
                                dayAfter.setDate(dayAfter.getDate() + 1);
                                
                                const dayBeforeKey = formatDateKey(dayBefore);
                                const dayAfterKey = formatDateKey(dayAfter);
                                
                                const beforeType = getDayType(dayBefore);
                                const afterType = getDayType(dayAfter);
                                
                                // Check day before
                                if (beforeType === 'weekend-holiday' || beforeType === 'special-holiday') {
                                    if (hasDutyOnDay(dayBeforeKey, expectedPerson, groupNum)) {
                                        hasLegitimateConflict = true;
                                        const currentDateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                        const beforeDateStr = dayBefore.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                        const beforeTypeName = beforeType === 'special-holiday' ? 'Ειδική Αργία' : 'Σαββατοκύριακο/Αργία';
                                        conflictDetails.push(`Ημερομηνία επηρεασμένη: ${currentDateStr}, Συνεχόμενη ${beforeTypeName}: ${beforeDateStr}`);
                                    }
                                }
                                
                                // Check day after
                                if (afterType === 'weekend-holiday' || afterType === 'special-holiday') {
                                    if (hasDutyOnDay(dayAfterKey, expectedPerson, groupNum)) {
                                        hasLegitimateConflict = true;
                                        const currentDateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                        const afterDateStr = dayAfter.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                        const afterTypeName = afterType === 'special-holiday' ? 'Ειδική Αργία' : 'Σαββατοκύριακο/Αργία';
                                        conflictDetails.push(`Ημερομηνία επηρεασμένη: ${currentDateStr}, Συνεχόμενη ${afterTypeName}: ${afterDateStr}`);
                                    }
                                }
                                
                                // Also check if assigned person was swapped (has consecutive conflict)
                                if (!hasLegitimateConflict) {
                                    if (beforeType === 'weekend-holiday' || beforeType === 'special-holiday') {
                                        if (hasDutyOnDay(dayBeforeKey, assignedPerson, groupNum)) {
                                            // Assigned person has conflict, so they were swapped
                                            hasLegitimateConflict = true;
                                            const currentDateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                            const beforeDateStr = dayBefore.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                            const beforeTypeName = beforeType === 'special-holiday' ? 'Ειδική Αργία' : 'Σαββατοκύριακο/Αργία';
                                            conflictDetails.push(`Ημερομηνία επηρεασμένη: ${currentDateStr}, Το ανέθετο άτομο έχει συνεχόμενη ${beforeTypeName}: ${beforeDateStr}`);
                                        }
                                    }
                                    if (afterType === 'weekend-holiday' || afterType === 'special-holiday') {
                                        if (hasDutyOnDay(dayAfterKey, assignedPerson, groupNum)) {
                                            hasLegitimateConflict = true;
                                            const currentDateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                            const afterDateStr = dayAfter.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                            const afterTypeName = afterType === 'special-holiday' ? 'Ειδική Αργία' : 'Σαββατοκύριακο/Αργία';
                                            conflictDetails.push(`Ημερομηνία επηρεασμένη: ${currentDateStr}, Το ανέθετο άτομο έχει συνεχόμενη ${afterTypeName}: ${afterDateStr}`);
                                        }
                                    }
                                }
                            } else if (dayTypeCategory === 'normal') {
                                // For normal: check if expected person has consecutive semi-normal day
                                const dayAfter = new Date(date);
                                dayAfter.setDate(dayAfter.getDate() + 1);
                                const dayAfterKey = formatDateKey(dayAfter);
                                const afterType = getDayType(dayAfter);
                                
                                // Check day after (normal day before semi-normal)
                                if (afterType === 'semi-normal-day') {
                                    if (hasDutyOnDay(dayAfterKey, expectedPerson, groupNum)) {
                                        hasLegitimateConflict = true;
                                        const currentDateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                        const afterDateStr = dayAfter.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                        conflictDetails.push(`Ημερομηνία επηρεασμένη: ${currentDateStr}, Συνεχόμενη Ημιαργία: ${afterDateStr}`);
                                    }
                                }
                                
                                // Also check if assigned person was swapped (has consecutive semi-normal)
                                if (!hasLegitimateConflict) {
                                    if (afterType === 'semi-normal-day') {
                                        if (hasDutyOnDay(dayAfterKey, assignedPerson, groupNum)) {
                                            // Assigned person has conflict, so they were swapped
                                            hasLegitimateConflict = true;
                                            const currentDateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                            const afterDateStr = dayAfter.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                            conflictDetails.push(`Ημερομηνία επηρεασμένη: ${currentDateStr}, Το ανέθετο άτομο έχει συνεχόμενη Ημιαργία: ${afterDateStr}`);
                                        }
                                    }
                                }
                            }
                            
                            // Only show violation if there's a legitimate conflict
                            if (hasLegitimateConflict) {
                            // Build detailed violation reason
                            if (isMissing) {
                                violationReason = 'Άτομο λείπει την ημερομηνία';
                                if (conflictDetails.length > 0) {
                                    violationReason += ` (${conflictDetails.join('; ')})`;
                                }
                                } else if (dayTypeCategory === 'weekend') {
                                    violationReason = 'Παράλειψη λόγω ειδικής αργίας στον ίδιο μήνα';
                                if (conflictDetails.length > 0) {
                                    violationReason += ` (${conflictDetails.join('; ')})`;
                                }
                                } else if (dayTypeCategory === 'semi') {
                                    const currentDateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                    violationReason = `Αλλαγή λόγω συνεχόμενης Σαββατοκύριακου/Αργίας ή Ειδικής Αργίας - Ημερομηνία επηρεασμένη: ${currentDateStr}`;
                                if (conflictDetails.length > 0) {
                                    violationReason += ` (${conflictDetails.join('; ')})`;
                                }
                                } else if (dayTypeCategory === 'normal') {
                                    const currentDateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                    violationReason = `Αλλαγή λόγω συνεχόμενης Ημιαργίας - Ημερομηνία επηρεασμένη: ${currentDateStr}`;
                                if (conflictDetails.length > 0) {
                                    violationReason += ` (${conflictDetails.join('; ')})`;
                                }
                                } else {
                                    violationReason = 'Αλλαγή λόγω συγκρούσεων';
                                if (conflictDetails.length > 0) {
                                    violationReason += ` (${conflictDetails.join('; ')})`;
                                }
                                }
                            } else {
                                // No legitimate conflict found - don't show as violation
                                // This means the assignment follows the rotation order correctly
                                continue; // Skip adding this to violations
                            }
                        }
                        
                        // Check if there's a swap and get the swap date
                        const assignmentReason = getAssignmentReason(dayKey, groupNum, assignedPerson);
                        let swapDateInfo = '';
                        if (assignmentReason && assignmentReason.type === 'swap' && assignmentReason.swappedWith) {
                            // Find the swap date by checking which date has the swapped person (swappedWith)
                            // Check current month first
                            const allDatesInMonth = [];
                            for (let d = 1; d <= daysInMonth; d++) {
                                allDatesInMonth.push(formatDateKey(new Date(year, month, d)));
                            }
                            
                            let swapDateFound = false;
                            // Look for the date where swappedWith person is assigned
                            for (const checkDateKey of allDatesInMonth) {
                                const checkAssignment = getAssignmentForDate(checkDateKey) || '';
                                if (checkAssignment.includes(`${assignmentReason.swappedWith} (Ομάδα ${groupNum})`)) {
                                    const swapDate = new Date(checkDateKey + 'T00:00:00');
                                    const swapDateStr = swapDate.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                    swapDateInfo = `, Ημερομηνία αλλαγής: ${swapDateStr}`;
                                    swapDateFound = true;
                                    break;
                                }
                            }
                            
                            // If not found in current month, check previous and next month
                            if (!swapDateFound) {
                                const prevMonth = new Date(year, month - 1, 1);
                                const nextMonth = new Date(year, month + 1, 1);
                                const lastDayPrev = new Date(year, month, 0);
                                const lastDayNext = new Date(year, month + 2, 0);
                                
                                // Check previous month
                                for (let d = 1; d <= lastDayPrev.getDate(); d++) {
                                    const checkDate = new Date(year, month - 1, d);
                                    const checkDateKey = formatDateKey(checkDate);
                                    const checkAssignment = getAssignmentForDate(checkDateKey) || '';
                                    if (checkAssignment.includes(`${assignmentReason.swappedWith} (Ομάδα ${groupNum})`)) {
                                        const swapDateStr = checkDate.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                        const currentDateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                        swapDateInfo = `, Ημερομηνία επηρεασμένη: ${currentDateStr}, Ημερομηνία αλλαγής: ${swapDateStr}`;
                                        swapDateFound = true;
                                        break;
                                    }
                                }
                                
                                // Check next month if still not found
                                if (!swapDateFound) {
                                    for (let d = 1; d <= lastDayNext.getDate(); d++) {
                                        const checkDate = new Date(year, month + 1, d);
                                        const checkDateKey = formatDateKey(checkDate);
                                        const checkAssignment = getAssignmentForDate(checkDateKey) || '';
                                        if (checkAssignment.includes(`${assignmentReason.swappedWith} (Ομάδα ${groupNum})`)) {
                                            const swapDateStr = checkDate.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                                            swapDateInfo = `, Ημερομηνία αλλαγής: ${swapDateStr}`;
                                            swapDateFound = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                        
                        violations.push({
                            date: dayKey,
                            dateFormatted: date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                            group: groupNum,
                            groupName: getGroupName(groupNum),
                            assignedPerson: assignedPerson,
                            expectedPerson: expectedPerson,
                            reason: violationReason + swapDateInfo,
                            dayType: getDayTypeLabel(dayType)
                        });
                    }
                }
            }
            
            // Display violations in modal
            displayRotationViolations(violations);
        }
        
        // Display rotation violations in modal
        function displayRotationViolations(violations) {
            const tableBody = document.getElementById('rotationViolationsTableBody');
            const noViolationsMsg = document.getElementById('noViolationsMessage');
            
            if (!tableBody) return;
            
            tableBody.innerHTML = '';
            
            if (violations.length === 0) {
                tableBody.parentElement.parentElement.style.display = 'none';
                if (noViolationsMsg) noViolationsMsg.style.display = 'block';
            } else {
                tableBody.parentElement.parentElement.style.display = 'table';
                if (noViolationsMsg) noViolationsMsg.style.display = 'none';
                
                violations.forEach(violation => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${violation.dateFormatted}</td>
                        <td><span class="badge bg-primary">${violation.groupName}</span></td>
                        <td><strong>${violation.assignedPerson}</strong></td>
                        <td><strong class="text-danger">${violation.expectedPerson}</strong></td>
                        <td><small>${violation.reason}</small></td>
                    `;
                    tableBody.appendChild(row);
                });
            }
            
            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('rotationViolationsModal'));
            modal.show();
        }

        // Print rotation order lists and rankings
        function printRotationAndRankings() {
            // Create a new window for printing
            const printWindow = window.open('', '_blank', 'width=800,height=600');
            
            // Get all people for rankings
            const allPeople = getAllPeople();
            const sortedByRanking = [...allPeople].sort((a, b) => {
                const rankA = rankings[a] || 9999;
                const rankB = rankings[b] || 9999;
                return rankA - rankB;
            });
            
            // Build HTML content
            let html = `
<!DOCTYPE html>
<html lang="el">
<head>
    <meta charset="UTF-8">
    <title>Σειρές Περιστροφής & Ιεραρχία</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            padding: 20px;
            font-size: 12px;
        }
        h1 {
            text-align: center;
            color: #333;
            margin-bottom: 30px;
        }
        h2 {
            color: #555;
            border-bottom: 2px solid #007bff;
            padding-bottom: 5px;
            margin-top: 30px;
        }
        h3 {
            color: #666;
            margin-top: 20px;
            margin-bottom: 10px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: #007bff;
            color: white;
            font-weight: bold;
        }
        tr:nth-child(even) {
            background-color: #f2f2f2;
        }
        .group-section {
            margin-bottom: 30px;
            page-break-inside: avoid;
        }
        .list-section {
            margin-left: 20px;
            margin-bottom: 15px;
        }
        .list-item {
            padding: 3px 0;
        }
        .ranking-number {
            font-weight: bold;
            color: #007bff;
            margin-right: 10px;
        }
        @media print {
            body {
                padding: 10px;
            }
            .group-section {
                page-break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    <h1>Σειρές Περιστροφής & Ιεραρχία Υπηρεσιών</h1>
    <p style="text-align: center; color: #666;">Ημερομηνία εκτύπωσης: ${new Date().toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
    
    <h2>Σειρές Περιστροφής ανά Ομάδα</h2>
`;
            
            // Add rotation lists for each group
            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [] };
                const groupName = getGroupName(groupNum);
                
                html += `
    <div class="group-section">
        <h3>Ομάδα ${groupNum}: ${groupName}</h3>
`;
                
                // List types with Greek names
                const listTypes = [
                    { key: 'special', name: 'Ειδικές Αργίες' },
                    { key: 'weekend', name: 'Σαββατοκύριακα/Αργίες' },
                    { key: 'semi', name: 'Ημιαργίες' },
                    { key: 'normal', name: 'Καθημερινές' }
                ];
                
                listTypes.forEach(listType => {
                    const list = groupData[listType.key] || [];
                    if (list.length > 0) {
                        html += `
        <div class="list-section">
            <strong>${listType.name}:</strong>
            <ol style="margin: 5px 0; padding-left: 25px;">
`;
                        list.forEach((person, index) => {
                            html += `                <li class="list-item">${person}</li>\n`;
                        });
                        html += `            </ol>
        </div>
`;
                    } else {
                        html += `
        <div class="list-section">
            <strong>${listType.name}:</strong> <span style="color: #999;">(Κενή λίστα)</span>
        </div>
`;
                    }
                });
                
                html += `    </div>
`;
            }
            
            // Add rankings section
            html += `
    <h2>Ιεραρχία (Rankings)</h2>
    <table>
        <thead>
            <tr>
                <th style="width: 80px;">Κατάταξη</th>
                <th>Όνομα</th>
                <th>Ομάδα</th>
            </tr>
        </thead>
        <tbody>
`;
            
            sortedByRanking.forEach((person, index) => {
                const rank = rankings[person] || null;
                const personGroup = getPersonGroup(person);
                const groupName = personGroup ? getGroupName(personGroup) : '-';
                
                html += `            <tr>
                <td><span class="ranking-number">${rank !== null ? rank : '-'}</span></td>
                <td>${person}</td>
                <td>${groupName}</td>
            </tr>
`;
            });
            
            html += `        </tbody>
    </table>
    
    <div style="margin-top: 40px; text-align: center; color: #666; font-size: 10px;">
        <p>Αυτό το έγγραφο δημιουργήθηκε από το σύστημα Διαχείρισης Υπηρεσιών</p>
    </div>
</body>
</html>
`;
            
            // Write content and trigger print
            printWindow.document.write(html);
            printWindow.document.close();
            
            // Wait for content to load, then trigger print
            printWindow.onload = function() {
                setTimeout(() => {
                    printWindow.print();
                }, 250);
            };
        }
