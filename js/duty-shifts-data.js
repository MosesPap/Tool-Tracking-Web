        // ============================================================================
        // DUTY-SHIFTS-DATA.JS - Data Management & Utilities
        // ============================================================================


        // Data storage - each group has four order lists: special, weekend, semi, normal
        // Each person also has last duty dates for each type, missing periods, and priorities
        let groups = {
            1: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {}, disabledPersons: {} },
            2: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {}, disabledPersons: {} },
            3: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {}, disabledPersons: {} },
            4: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {}, disabledPersons: {} }
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
        // Rotation baseline (pure rotation order before missing/skip/swap) - saved for history/positioning logic
        let rotationBaselineSpecialAssignments = {};
        let rotationBaselineWeekendAssignments = {};
        let rotationBaselineSemiAssignments = {};
        let rotationBaselineNormalAssignments = {};
        // Cached: last baseline rotation person per monthKey/group for fast seeding fallback
        // rotationBaselineLastByType[dayType][monthKey][groupNum] = personName
        let rotationBaselineLastByType = { normal: {}, semi: {}, weekend: {}, special: {} };
        // Legacy: Keep dutyAssignments for backward compatibility during migration
        let dutyAssignments = {};
        
        // Track skip/swap reasons for each assignment
        // Structure: assignmentReasons[dateKey][groupNum][personName] = { type: 'skip'|'swap'|'shift', reason: '...', swappedWith: '...', swapPairId, meta? }
        let assignmentReasons = {};
        /** Ανοιχτές οφειλές ειδικής (απενεργ./απουσία) — αποθηκεύονται στο assignmentReasons doc. */
        let pendingSpecialDebts = [];
        /** Carry-over: replacement skipped once in month after manual alternate (per duty category). */
        let manualAlternateDeferCarry = { normal: {}, semi: {}, weekend: {}, special: {} };
        // Track critical assignments from last duties - these must NEVER be deleted
        // Format: { "2025-12-25": ["Person Name (Ομάδα 1)", ...], ... }
        let criticalAssignments = {};
        // REMOVED: crossMonthSwaps - cross-month swaps are no longer supported
        // Declare as empty object to prevent ReferenceError if any old code references it
        let crossMonthSwaps = {};
        // Track last rotation positions (normal rotation, ignoring swaps) for each day type and group.
        //
        // NEW (month-scoped) structure:
        // lastRotationPositions[dayType][monthKey][groupNum] = personName
        // where monthKey = `${year}-${month}` with month 01-12 (e.g. 2026-04 for April).
        //
        // LEGACY (flat) structure is still supported for backward compatibility:
        // lastRotationPositions[dayType][groupNum] = personName
        let lastRotationPositions = {
            normal: {},
            semi: {},
            weekend: {},
            special: {}
        };
        /** YYYY-MM -> true: month cannot start «Υπολογισμός Υπηρεσιών» until unlocked (Firestore doc monthCalculationLocks). */
        let monthCalculationLocks = {};

        function getMonthKeyFromDate(date) {
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        }

        function isMonthCalculationLocked(monthKey) {
            return !!(monthKey && typeof monthKey === 'string' && monthCalculationLocks && monthCalculationLocks[monthKey] === true);
        }

        function setMonthCalculationLocked(monthKey, locked) {
            if (!monthKey || typeof monthKey !== 'string' || !/^\d{4}-\d{2}$/.test(monthKey)) return;
            if (!monthCalculationLocks || typeof monthCalculationLocks !== 'object') monthCalculationLocks = {};
            if (locked) monthCalculationLocks[monthKey] = true;
            else delete monthCalculationLocks[monthKey];
        }

        // ============================================================================
        // Scheduled status changes (disabled / group / list order)
        // Recorded in last 10 days of month → effective 1st of next month.
        // Absences (missingPeriods) stay date-window based — unchanged.
        // ============================================================================
        const DUTY_STATUS_LIST_TYPES = ['special', 'weekend', 'semi', 'normal'];
        const PERSON_STATUS_SCHEDULE_EPOCH = '1970-01-01';
        let personStatusSchedule = { disabled: [], membership: [], listOrders: [], _seeded: false };
        /** When set, duty calc uses list/disabled state as of this YYYY-MM-DD. */
        let dutyCalcContextDateKey = null;

        function setDutyCalcContextDateKey(dateKey) {
            dutyCalcContextDateKey =
                dateKey && /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey)) ? String(dateKey) : null;
        }
        function clearDutyCalcContextDateKey() {
            dutyCalcContextDateKey = null;
        }
        function personScheduleKey(personName) {
            return typeof normalizePersonKey === 'function'
                ? normalizePersonKey(personName)
                : String(personName || '').trim();
        }
        function compareScheduleDateKeys(a, b) {
            return String(a || '').localeCompare(String(b || ''));
        }
        function dateFromDateKey(dateKey) {
            const d = new Date(String(dateKey) + 'T00:00:00');
            return isNaN(d.getTime()) ? null : d;
        }
        /** Επιτρέπονται μεταβολές λίστας/μεταφοράς/scheduled απενεργοποίησης όταν η ημερομηνία ανήκει στις τελευταίες 15 ημέρες του μήνα (τελευταίο δεκαπενθήμερο). */
        function isInStatusChangeWindow(asOfDate) {
            const d = asOfDate instanceof Date ? new Date(asOfDate) : new Date();
            if (isNaN(d.getTime())) return false;
            d.setHours(0, 0, 0, 0);
            const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
            const windowStart = Math.max(1, lastDay - 14);
            return d.getDate() >= windowStart;
        }
        /**
         * Αν η «ισχύς από» πέσει στο τελευταίο ημερολογιακό δεκαήμερο του μήνα της,
         * για υπολογισμούς μεταφέρεται στην 1η του επόμενου μήνα.
         * Εξαίρεση: όταν ο χρήστης επιλέξει ρητά τη σημερινή ημερομηνία,
         * η ισχύς παραμένει σήμερα ώστε η αλλαγή να φανεί άμεσα στο UI.
         */
        function normalizeStatusEffectiveFromDateKey(dateKey) {
            if (!dateKey || String(dateKey) === PERSON_STATUS_SCHEDULE_EPOCH) return dateKey;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey))) return dateKey;
            const d = dateFromDateKey(dateKey);
            if (!d) return dateKey;
            const todayKey = typeof formatDateKey === 'function' ? formatDateKey(new Date()) : null;
            if (todayKey && String(dateKey) === todayKey) {
                return dateKey;
            }
            const y = d.getFullYear();
            const m = d.getMonth();
            const day = d.getDate();
            const lastDay = new Date(y, m + 1, 0).getDate();
            const windowStart = Math.max(1, lastDay - 9);
            if (day >= windowStart) {
                const firstNext = new Date(y, m + 1, 1);
                return typeof formatDateKey === 'function' ? formatDateKey(firstNext) : dateKey;
            }
            return dateKey;
        }
        function sanitizePersonStatusScheduleEffectiveDates() {
            if (!personStatusSchedule || typeof normalizeStatusEffectiveFromDateKey !== 'function') return;
            for (const key of ['disabled', 'membership', 'listOrders']) {
                const arr = personStatusSchedule[key];
                if (!Array.isArray(arr)) continue;
                for (const e of arr) {
                    if (e && e.effectiveFrom && e.effectiveFrom !== PERSON_STATUS_SCHEDULE_EPOCH) {
                        const n = normalizeStatusEffectiveFromDateKey(e.effectiveFrom);
                        if (n !== e.effectiveFrom) e.effectiveFrom = n;
                    }
                }
            }
        }
        function getScheduledStatusEffectiveFrom(recordDate) {
            const d = recordDate instanceof Date ? new Date(recordDate) : new Date();
            d.setHours(0, 0, 0, 0);
            const firstNext = new Date(d.getFullYear(), d.getMonth() + 1, 1);
            return typeof formatDateKey === 'function' ? formatDateKey(firstNext) : null;
        }
        function getFirstOfCalendarMonthDateKey(asOfDate) {
            const d = asOfDate instanceof Date ? new Date(asOfDate) : new Date();
            if (isNaN(d.getTime())) return null;
            d.setHours(0, 0, 0, 0);
            return typeof formatDateKey === 'function'
                ? formatDateKey(new Date(d.getFullYear(), d.getMonth(), 1))
                : null;
        }
        /** Προεπιλογή: τελευταίο δεκαπενθήμερο → 1η επόμενου μήνα· αλλιώς → 1η τρέχοντος μήνα. */
        function getSuggestedStatusEffectiveFromDateKey(asOfDate) {
            const d = asOfDate instanceof Date ? new Date(asOfDate) : new Date();
            if (isNaN(d.getTime())) return getScheduledStatusEffectiveFrom(new Date());
            d.setHours(0, 0, 0, 0);
            if (isInStatusChangeWindow(d)) {
                return getScheduledStatusEffectiveFrom(d);
            }
            return getFirstOfCalendarMonthDateKey(d) || getScheduledStatusEffectiveFrom(d);
        }
        function formatScheduledStatusEffectiveLabel(effectiveFromKey) {
            const d = dateFromDateKey(effectiveFromKey);
            if (!d) return effectiveFromKey || '';
            return d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        }
        function emptyDisabledState() {
            return { all: false, special: false, weekend: false, semi: false, normal: false };
        }
        function normalizeDisabledState(raw) {
            if (raw === true) return { all: true, special: false, weekend: false, semi: false, normal: false };
            if (!raw || typeof raw !== 'object') return emptyDisabledState();
            return {
                all: !!raw.all,
                special: !!raw.special,
                weekend: !!raw.weekend,
                semi: !!raw.semi,
                normal: !!raw.normal
            };
        }
        function disabledStateIsActive(st) {
            return !!(st && (st.all || st.special || st.weekend || st.semi || st.normal));
        }
        function legacyDisabledStateFromGroups(groupNum, personName) {
            const g = groups?.[groupNum];
            const dp = g?.disabledPersons || {};
            const pk = personScheduleKey(personName);
            let raw = dp?.[personName];
            if (!raw && pk) raw = dp?.[pk];
            if (!raw && pk) {
                for (const k of Object.keys(dp)) {
                    if (personScheduleKey(k) === pk) {
                        raw = dp[k];
                        break;
                    }
                }
            }
            return normalizeDisabledState(raw);
        }
        function ensurePersonStatusScheduleSeeded() {
            if (personStatusSchedule._seeded) return;
            personStatusSchedule.disabled = Array.isArray(personStatusSchedule.disabled)
                ? personStatusSchedule.disabled
                : [];
            personStatusSchedule.membership = Array.isArray(personStatusSchedule.membership)
                ? personStatusSchedule.membership
                : [];
            personStatusSchedule.listOrders = Array.isArray(personStatusSchedule.listOrders)
                ? personStatusSchedule.listOrders
                : [];
            if (
                personStatusSchedule.disabled.length === 0 &&
                personStatusSchedule.membership.length === 0 &&
                personStatusSchedule.listOrders.length === 0
            ) {
                for (let g = 1; g <= 4; g++) {
                    const gd = groups[g];
                    if (!gd) continue;
                    for (const listType of DUTY_STATUS_LIST_TYPES) {
                        const list = (gd[listType] || []).slice();
                        if (list.length) {
                            personStatusSchedule.listOrders.push({
                                groupNum: g,
                                listType,
                                order: list,
                                effectiveFrom: PERSON_STATUS_SCHEDULE_EPOCH,
                                recordedAt: PERSON_STATUS_SCHEDULE_EPOCH
                            });
                        }
                        for (const person of list) {
                            const pk = personScheduleKey(person);
                            if (
                                !personStatusSchedule.membership.some(
                                    (e) => e.personKey === pk && e.effectiveFrom === PERSON_STATUS_SCHEDULE_EPOCH
                                )
                            ) {
                                personStatusSchedule.membership.push({
                                    personKey: pk,
                                    personName: person,
                                    groupNum: g,
                                    effectiveFrom: PERSON_STATUS_SCHEDULE_EPOCH,
                                    recordedAt: PERSON_STATUS_SCHEDULE_EPOCH
                                });
                            }
                        }
                    }
                    const dp = gd.disabledPersons || {};
                    for (const name of Object.keys(dp)) {
                        const st = normalizeDisabledState(dp[name]);
                        if (!disabledStateIsActive(st)) continue;
                        const pk = personScheduleKey(name);
                        personStatusSchedule.disabled.push({
                            personKey: pk,
                            personName: name,
                            groupNum: g,
                            state: st,
                            effectiveFrom: PERSON_STATUS_SCHEDULE_EPOCH,
                            recordedAt: PERSON_STATUS_SCHEDULE_EPOCH
                        });
                    }
                }
            }
            personStatusSchedule._seeded = true;
        }
        function getPersonHomeGroupAtDate(personName, dateKey) {
            ensurePersonStatusScheduleSeeded();
            const pk = personScheduleKey(personName);
            const dk = dateKey || dutyCalcContextDateKey || formatDateKey(new Date());
            const hits = personStatusSchedule.membership
                .filter((e) => e.personKey === pk && compareScheduleDateKeys(e.effectiveFrom, dk) <= 0)
                .sort((a, b) => compareScheduleDateKeys(b.effectiveFrom, a.effectiveFrom));
            if (hits.length) return hits[0].groupNum;
            for (let g = 1; g <= 4; g++) {
                for (const lt of DUTY_STATUS_LIST_TYPES) {
                    const list = groups[g]?.[lt] || [];
                    if (list.some((p) => personScheduleKey(p) === pk)) return g;
                }
            }
            return null;
        }
        function sameRotationListMembership(orderA, orderB) {
            if (!Array.isArray(orderA) || !Array.isArray(orderB) || orderA.length !== orderB.length) return false;
            const keysB = new Set(orderB.map((p) => personScheduleKey(p)));
            return orderA.every((p) => keysB.has(personScheduleKey(p)));
        }
        /** Rotation order = priority sort (same rule as renderGroups), not raw array insertion order. */
        function getSortedGroupListForRotation(groupNum, listType) {
            const g = groups[groupNum];
            if (!g) return [];
            const list = (g[listType] || []).slice();
            const priorities = g.priorities || {};
            list.sort((a, b) => {
                const priorityA = priorities[a]?.[listType] ?? 999;
                const priorityB = priorities[b]?.[listType] ?? 999;
                if (priorityA !== priorityB) return priorityA - priorityB;
                const dateA = g.lastDuties?.[a]?.[listType];
                const dateB = g.lastDuties?.[b]?.[listType];
                if (!dateA && !dateB) return 0;
                if (!dateA) return 1;
                if (!dateB) return -1;
                return new Date(dateB) - new Date(dateA);
            });
            return list;
        }
        function getListOrderAtDate(groupNum, listType, dateKey) {
            ensurePersonStatusScheduleSeeded();
            const dk = dateKey || dutyCalcContextDateKey || formatDateKey(new Date());
            const sortedCurrent = getSortedGroupListForRotation(groupNum, listType);
            const hits = personStatusSchedule.listOrders
                .filter(
                    (e) =>
                        e.groupNum === groupNum &&
                        e.listType === listType &&
                        compareScheduleDateKeys(e.effectiveFrom, dk) <= 0
                )
                .sort((a, b) => {
                    const byEff = compareScheduleDateKeys(b.effectiveFrom, a.effectiveFrom);
                    if (byEff !== 0) return byEff;
                    return compareScheduleDateKeys(b.recordedAt || '', a.recordedAt || '');
                });
            if (hits.length && Array.isArray(hits[0].order)) {
                const scheduled = hits[0].order.slice();
                // Live priorities / UI reorder win over stale seeded schedule when roster is unchanged.
                if (sameRotationListMembership(scheduled, sortedCurrent)) {
                    return sortedCurrent;
                }
                return scheduled;
            }
            return sortedCurrent;
        }
        /** Keep stored arrays aligned with priority order (Firestore groups doc + schedule snapshots). */
        function syncGroupListArraysFromPriorities(groupNum) {
            const g = groups[groupNum];
            if (!g) return;
            for (const listType of DUTY_STATUS_LIST_TYPES) {
                g[listType] = getSortedGroupListForRotation(groupNum, listType);
            }
        }
        function getGroupRotationListAtDate(groupNum, listType, dateKey) {
            const dk = dateKey || dutyCalcContextDateKey || formatDateKey(new Date());
            const order = getListOrderAtDate(groupNum, listType, dk);
            return order.filter((person) => getPersonHomeGroupAtDate(person, dk) === groupNum);
        }
        function groupsForDuty(groupNum, dateKey) {
            const g = groups[groupNum] || {
                special: [],
                weekend: [],
                semi: [],
                normal: [],
                lastDuties: {},
                missingPeriods: {},
                priorities: {},
                disabledPersons: {}
            };
            const dk =
                dateKey ||
                dutyCalcContextDateKey ||
                (typeof formatDateKey === 'function' ? formatDateKey(new Date()) : null);
            if (!dk) {
                return {
                    ...g,
                    special: getSortedGroupListForRotation(groupNum, 'special'),
                    weekend: getSortedGroupListForRotation(groupNum, 'weekend'),
                    semi: getSortedGroupListForRotation(groupNum, 'semi'),
                    normal: getSortedGroupListForRotation(groupNum, 'normal')
                };
            }
            return {
                ...g,
                special: getGroupRotationListAtDate(groupNum, 'special', dk),
                weekend: getGroupRotationListAtDate(groupNum, 'weekend', dk),
                semi: getGroupRotationListAtDate(groupNum, 'semi', dk),
                normal: getGroupRotationListAtDate(groupNum, 'normal', dk)
            };
        }
        function getDisabledStateAtDate(groupNum, personName, dateKey) {
            ensurePersonStatusScheduleSeeded();
            const pk = personScheduleKey(personName);
            const dk = dateKey || dutyCalcContextDateKey || formatDateKey(new Date());
            const hits = personStatusSchedule.disabled
                .filter(
                    (e) =>
                        e.groupNum === groupNum &&
                        e.personKey === pk &&
                        compareScheduleDateKeys(e.effectiveFrom, dk) <= 0
                )
                .sort((a, b) => compareScheduleDateKeys(b.effectiveFrom, a.effectiveFrom));
            if (hits.length) return normalizeDisabledState(hits[0].state);
            return legacyDisabledStateFromGroups(groupNum, personName);
        }
        function isPersonDisabledForDutyAtDate(person, groupNum, dutyCategory, dateKey) {
            const st = getDisabledStateAtDate(groupNum, person, dateKey);
            if (st.all) return true;
            if (!dutyCategory) {
                return !!(st.special || st.weekend || st.semi || st.normal);
            }
            let cat = dutyCategory;
            if (cat === 'special-holiday') cat = 'special';
            else if (cat === 'weekend-holiday') cat = 'weekend';
            else if (cat === 'semi-normal-day') cat = 'semi';
            else if (cat === 'normal-day') cat = 'normal';
            return !!st[cat];
        }
        function scheduleDisabledStateChange(groupNum, personName, state, effectiveFromKey) {
            ensurePersonStatusScheduleSeeded();
            const pk = personScheduleKey(personName);
            const st = normalizeDisabledState(state);
            const raw =
                effectiveFromKey ||
                (typeof getSuggestedStatusEffectiveFromDateKey === 'function'
                    ? getSuggestedStatusEffectiveFromDateKey(new Date())
                    : getScheduledStatusEffectiveFrom(new Date()));
            const eff = normalizeStatusEffectiveFromDateKey(raw);
            personStatusSchedule.disabled.push({
                personKey: pk,
                personName,
                groupNum,
                state: st,
                effectiveFrom: eff,
                recordedAt: formatDateKey(new Date())
            });
            return eff;
        }
        function scheduleMembershipChange(personName, toGroupNum, effectiveFromKey) {
            ensurePersonStatusScheduleSeeded();
            const raw =
                effectiveFromKey ||
                (typeof getSuggestedStatusEffectiveFromDateKey === 'function'
                    ? getSuggestedStatusEffectiveFromDateKey(new Date())
                    : getScheduledStatusEffectiveFrom(new Date()));
            const eff = normalizeStatusEffectiveFromDateKey(raw);
            const pk = personScheduleKey(personName);
            personStatusSchedule.membership.push({
                personKey: pk,
                personName,
                groupNum: toGroupNum,
                effectiveFrom: eff,
                recordedAt: formatDateKey(new Date())
            });
            return eff;
        }
        function scheduleListOrdersForGroup(groupNum, effectiveFrom) {
            ensurePersonStatusScheduleSeeded();
            syncGroupListArraysFromPriorities(groupNum);
            const eff = normalizeStatusEffectiveFromDateKey(
                effectiveFrom ||
                    (typeof getFirstOfCalendarMonthDateKey === 'function'
                        ? getFirstOfCalendarMonthDateKey(new Date())
                        : null) ||
                    getScheduledStatusEffectiveFrom(new Date())
            );
            const recordedAt = formatDateKey(new Date());
            const gd = groups[groupNum];
            if (!gd) return eff;
            for (const listType of DUTY_STATUS_LIST_TYPES) {
                const order = getSortedGroupListForRotation(groupNum, listType);
                personStatusSchedule.listOrders = personStatusSchedule.listOrders.filter(
                    (e) =>
                        !(
                            e.groupNum === groupNum &&
                            e.listType === listType &&
                            e.effectiveFrom === eff
                        )
                );
                personStatusSchedule.listOrders.push({
                    groupNum,
                    listType,
                    order,
                    effectiveFrom: eff,
                    recordedAt
                });
            }
            return eff;
        }
        window.setDutyCalcContextDateKey = setDutyCalcContextDateKey;
        window.clearDutyCalcContextDateKey = clearDutyCalcContextDateKey;
        window.groupsForDuty = groupsForDuty;
        window.getSortedGroupListForRotation = getSortedGroupListForRotation;
        window.syncGroupListArraysFromPriorities = syncGroupListArraysFromPriorities;
        window.scheduleListOrdersForGroup = scheduleListOrdersForGroup;
        function getPendingScheduledStatusSummary(personName, groupNum) {
            ensurePersonStatusScheduleSeeded();
            const todayKey = formatDateKey(new Date());
            const pk = personScheduleKey(personName);
            const eff = getScheduledStatusEffectiveFrom(new Date());
            const parts = [];
            const dis = personStatusSchedule.disabled
                .filter((e) => e.personKey === pk && e.groupNum === groupNum && compareScheduleDateKeys(e.effectiveFrom, todayKey) > 0)
                .sort((a, b) => compareScheduleDateKeys(a.effectiveFrom, b.effectiveFrom));
            if (dis.length) {
                const st = dis[0].state;
                parts.push(
                    disabledStateIsActive(st)
                        ? `Απενεργοποίηση από ${formatScheduledStatusEffectiveLabel(dis[0].effectiveFrom)}`
                        : `Ενεργοποίηση από ${formatScheduledStatusEffectiveLabel(dis[0].effectiveFrom)}`
                );
            }
            const mem = personStatusSchedule.membership
                .filter((e) => e.personKey === pk && compareScheduleDateKeys(e.effectiveFrom, todayKey) > 0)
                .sort((a, b) => compareScheduleDateKeys(a.effectiveFrom, b.effectiveFrom));
            if (mem.length) {
                parts.push(
                    `Ομάδα ${getGroupName ? getGroupName(mem[0].groupNum) : mem[0].groupNum} από ${formatScheduledStatusEffectiveLabel(mem[0].effectiveFrom)}`
                );
            }
            return parts.join(' · ');
        }

        function rebuildRotationBaselineLastByType() {
            const out = { normal: {}, semi: {}, weekend: {}, special: {} };

            const ingest = (dayType, flatDateMap) => {
                if (!flatDateMap || typeof flatDateMap !== 'object') return;
                const dateKeys = Object.keys(flatDateMap).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
                for (const dateKey of dateKeys) {
                    const d = new Date(dateKey + 'T00:00:00');
                    if (isNaN(d.getTime())) continue;
                    const monthKey = getMonthKeyFromDate(d);
                    if (!out[dayType][monthKey]) out[dayType][monthKey] = {};
                    const assignment = flatDateMap[dateKey];
                    if (!assignment) continue;
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        const person = parseAssignedPersonForGroupFromAssignment(assignment, groupNum);
                        if (person) out[dayType][monthKey][groupNum] = person; // sorted asc => last wins
                    }
                }
            };

            ingest('special', rotationBaselineSpecialAssignments);
            ingest('weekend', rotationBaselineWeekendAssignments);
            ingest('semi', rotationBaselineSemiAssignments);
            ingest('normal', rotationBaselineNormalAssignments);

            rotationBaselineLastByType = out;
        }

        // Convert dateKey -> {groupNum -> personName} into dateKey -> "Person (Ομάδα 1), Person (Ομάδα 2)..."
        function formatGroupAssignmentsToStringMap(assignmentsByDate) {
            const out = {};
            if (!assignmentsByDate || typeof assignmentsByDate !== 'object') return out;
            for (const dateKey of Object.keys(assignmentsByDate)) {
                const gmap = assignmentsByDate[dateKey];
                if (!gmap || typeof gmap !== 'object') continue;
                const parts = [];
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const person = gmap[groupNum];
                    if (person) parts.push(`${person} (Ομάδα ${groupNum})`);
                }
                if (parts.length) out[dateKey] = parts.join(', ');
            }
            return out;
        }

        function buildBaselineComputedCellHtml(baselinePerson, computedPerson, computedDaysCountInfo = '', computedLastDutyInfo = '') {
            const base = baselinePerson || '-';
            const comp = computedPerson || '-';
            const changed = base !== '-' && comp !== '-' && base !== comp;

            // If there is no change, show the name only once (no duplicate baseline/computed).
            if (!changed) {
                return `<div><strong>${base}</strong></div>`;
            }

            // If changed (swap/skip/missing replacement), show Baseline -> Computed clearly.
            return `
                <div class="small text-muted">Βασική Σειρά</div>
                <div><strong>${base}</strong></div>
                <div class="small text-primary mt-1">Αντικατάσταση</div>
                <div><strong>${comp}</strong></div>
            `;
        }

        function greekUpperNoTones(s) {
            return String(s || '')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .toUpperCase();
        }

        function dateToDateKey(date) {
            if (!date || isNaN(date.getTime())) return null;
            return formatDateKey(date);
        }

        function dateKeyToInputValue(dateKey) {
            if (!dateKey || typeof dateKey !== 'string') return '';
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return '';
            return dateKey;
        }

        function inputValueToDateKey(value) {
            if (!value) return null;
            const s = String(value).trim();
            if (!s) return null;
            if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
                const iso = new Date(s + 'T00:00:00');
                return isNaN(iso.getTime()) ? null : formatDateKey(iso);
            }
            const dmY = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (dmY) {
                const isoStr = `${dmY[3]}-${dmY[2].padStart(2, '0')}-${dmY[1].padStart(2, '0')}`;
                const dGr = new Date(isoStr + 'T00:00:00');
                return isNaN(dGr.getTime()) ? null : formatDateKey(dGr);
            }
            const d = new Date(s + 'T00:00:00');
            if (isNaN(d.getTime())) return null;
            return formatDateKey(d);
        }

        function shiftDate(date, days) {
            const d = new Date(date);
            d.setDate(d.getDate() + (days || 0));
            d.setHours(0, 0, 0, 0);
            return d;
        }

        function findPreviousDateKeyByDayType(beforeDate, desiredDayType, maxDaysBack = 3650) {
            const d = new Date(beforeDate);
            d.setHours(0, 0, 0, 0);
            for (let i = 0; i < maxDaysBack; i++) {
                const dt = getDayType(d);
                if (dt === desiredDayType) return formatDateKey(d);
                d.setDate(d.getDate() - 1);
            }
            return null;
        }

        function findNthPreviousSpecialHolidayDateKey(beforeDate, n = 3, maxDaysBack = 3650) {
            let count = 0;
            const d = new Date(beforeDate);
            d.setHours(0, 0, 0, 0);
            for (let i = 0; i < maxDaysBack; i++) {
                if (getDayType(d) === 'special-holiday') {
                    count++;
                    if (count === n) return formatDateKey(d);
                }
                d.setDate(d.getDate() - 1);
            }
            return null;
        }

        function getRotationBaselineAssignmentForType(type, dateKey) {
            if (type === 'special') return rotationBaselineSpecialAssignments?.[dateKey] || null;
            if (type === 'weekend') return rotationBaselineWeekendAssignments?.[dateKey] || null;
            if (type === 'semi') return rotationBaselineSemiAssignments?.[dateKey] || null;
            return rotationBaselineNormalAssignments?.[dateKey] || null;
        }

        function getFinalAssignmentForType(type, dateKey) {
            if (type === 'special') return specialHolidayAssignments?.[dateKey] || null;
            if (type === 'weekend') return weekendAssignments?.[dateKey] || null;
            if (type === 'semi') return semiNormalAssignments?.[dateKey] || null;
            return normalDayAssignments?.[dateKey] || null;
        }

        function findPersonBInGroupForTypeOnDate(type, dateKey, groupNum) {
            if (!dateKey) return { personB: null, sourceB: null };
            const baseline = getRotationBaselineAssignmentForType(type, dateKey);
            if (baseline) {
                const b = parseAssignedPersonForGroupFromAssignment(baseline, groupNum);
                if (b) return { personB: b, sourceB: 'baseline' };
            }
            const finalAssignment = getFinalAssignmentForType(type, dateKey);
            if (finalAssignment) {
                const b = parseAssignedPersonForGroupFromAssignment(finalAssignment, groupNum);
                if (b) return { personB: b, sourceB: 'final' };
            }
            const critical = getCriticalAssignmentForDate(dateKey);
            if (critical) {
                const b = parseAssignedPersonForGroupFromAssignment(critical, groupNum);
                if (b) return { personB: b, sourceB: 'critical' };
            }
            return { personB: null, sourceB: null };
        }

        let autoAddPersonData = null; // { personName, groupNum, arrivalDateKey, datesByType, placementByType }






        let autoAddReturnToModalAfterRankPicker = false;

        // Insert/overwrite person in rankings at desired rank, shifting others down if needed.




        function formatGreekMonthYear(date) {
            if (!date || isNaN(date.getTime())) return '';
            const month = greekUpperNoTones(date.toLocaleDateString('el-GR', { month: 'long' }));
            const year = date.getFullYear();
            return `${month} ${year}`;
        }

        function buildPeriodLabel(startDate, endDate) {
            if (!startDate || isNaN(startDate.getTime())) return '';
            if (!endDate || isNaN(endDate.getTime())) return formatGreekMonthYear(startDate);

            const startMY = formatGreekMonthYear(startDate);
            const endMY = formatGreekMonthYear(endDate);

            const sameYear = startDate.getFullYear() === endDate.getFullYear();
            const sameMonth = sameYear && startDate.getMonth() === endDate.getMonth();
            if (sameMonth) return startMY;

            const startMonth = greekUpperNoTones(startDate.toLocaleDateString('el-GR', { month: 'long' }));
            const endMonth = greekUpperNoTones(endDate.toLocaleDateString('el-GR', { month: 'long' }));

            if (sameYear) {
                return `${startMonth}-${endMonth} ${startDate.getFullYear()}`;
            }
            return `${startMY}-${endMY}`;
        }

        function isDateKeyInRange(dateKey, startDate, endDate) {
            if (!dateKey || typeof dateKey !== 'string') return false;
            if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
            const d = new Date(dateKey + 'T00:00:00');
            if (isNaN(d.getTime())) return false;
            return d >= startDate && d <= endDate;
        }

        function buildPreviewCalculationSummaryHtml({ title, items }) {
            const safeTitle = title || 'Σύνοψη Αλλαγών';
            const swaps = items.filter(i => i.kind === 'swap');
            const skips = items.filter(i => i.kind === 'skip');
            const missing = items.filter(i => i.kind === 'missing');
            const conflicts = items.filter(i => i.kind === 'conflict');

            const buildTable = (rows) => {
                if (!rows.length) {
                    return '<div class="text-muted small">-</div>';
                }
                let html = '<div class="table-responsive"><table class="table table-sm table-bordered mb-0">';
                html += '<thead class="table-light"><tr><th>Ημερομηνία</th><th>Υπηρεσία</th><th>Βασική Σειρά</th><th>Αντικατάσταση</th><th>Αιτία</th></tr></thead><tbody>';
                for (const r of rows) {
                    html += `<tr>
                        <td>${r.dateStr}</td>
                        <td>${r.groupName}</td>
                        <td><strong>${r.baseline || '-'}</strong></td>
                        <td><strong>${r.computed || '-'}</strong></td>
                        <td>${r.reason || ''}</td>
                    </tr>`;
                }
                html += '</tbody></table></div>';
                return html;
            };

            return `
                <div class="mt-4">
                    <h6 class="mb-2"><i class="fas fa-list-check me-2"></i>${safeTitle}</h6>
                    <div class="alert alert-light border mb-3">
                        <div class="d-flex flex-wrap gap-2">
                            <span class="badge bg-primary">Swaps: ${swaps.length}</span>
                            <span class="badge bg-warning text-dark">Skips (ειδική αργία): ${skips.length}</span>
                            <span class="badge bg-info text-dark">Missing αντικαταστάσεις: ${missing.length}</span>
                            <span class="badge bg-danger">Υπόλοιπες συγκρούσεις: ${conflicts.length}</span>
                        </div>
                    </div>

                    <div class="accordion" id="previewSummaryAccordion">
                        <div class="accordion-item">
                            <h2 class="accordion-header" id="prevSumHead1">
                                <button class="accordion-button" type="button" data-bs-toggle="collapse" data-bs-target="#prevSumBody1">
                                    Swaps
                                </button>
                            </h2>
                            <div id="prevSumBody1" class="accordion-collapse collapse show" data-bs-parent="#previewSummaryAccordion">
                                <div class="accordion-body">
                                    ${buildTable(swaps)}
                                </div>
                            </div>
                        </div>
                        <div class="accordion-item">
                            <h2 class="accordion-header" id="prevSumHead2">
                                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#prevSumBody2">
                                    Skips (ειδική αργία)
                                </button>
                            </h2>
                            <div id="prevSumBody2" class="accordion-collapse collapse" data-bs-parent="#previewSummaryAccordion">
                                <div class="accordion-body">
                                    ${buildTable(skips)}
                                </div>
                            </div>
                        </div>
                        <div class="accordion-item">
                            <h2 class="accordion-header" id="prevSumHead3">
                                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#prevSumBody3">
                                    Missing αντικαταστάσεις
                                </button>
                            </h2>
                            <div id="prevSumBody3" class="accordion-collapse collapse" data-bs-parent="#previewSummaryAccordion">
                                <div class="accordion-body">
                                    ${buildTable(missing)}
                                </div>
                            </div>
                        </div>
                        <div class="accordion-item">
                            <h2 class="accordion-header" id="prevSumHead4">
                                <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#prevSumBody4">
                                    Υπόλοιπες συγκρούσεις (μετά τις αλλαγές)
                                </button>
                            </h2>
                            <div id="prevSumBody4" class="accordion-collapse collapse" data-bs-parent="#previewSummaryAccordion">
                                <div class="accordion-body">
                                    ${buildTable(conflicts)}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        function getPreviousMonthKeyFromDate(date) {
            const d = new Date(date.getFullYear(), date.getMonth(), 1);
            d.setMonth(d.getMonth() - 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        }

        function isMonthKey(str) {
            return typeof str === 'string' && /^\d{4}-\d{1,2}$/.test(str);
        }

        // Returns the last rotation person that should seed the rotation for the given date's month.
        // IMPORTANT: When calculating month M, we read from previous month (M-1), not M.
        // If the immediate previous month doesn't exist, finds the most recent available month.
        function getPersonAssignedOnDateFromStore(dayTypeCategory, dateKey, groupNum) {
            const store = getAssignmentsForDayType(dayTypeCategory);
            const raw = store?.[dateKey];
            if (!raw) return null;
            const map = typeof extractGroupAssignmentsMap === 'function' ? extractGroupAssignmentsMap(raw) : null;
            if (!map || typeof map !== 'object') return null;
            return map[groupNum] || map[String(groupNum)] || null;
        }

        /** Last person in previous month for continuity (baseline after manual alternate, not replacement). */
        function getLastAssignmentContinuityPersonForPreviousMonth(dayTypeCategory, dateInCurrentMonth, groupNum) {
            const prevMonthKey = getPreviousMonthKeyFromDate(dateInCurrentMonth);
            const store = getAssignmentsForDayType(dayTypeCategory);
            if (!store || typeof store !== 'object') return null;
            let lastKey = null;
            for (const dk in store) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dk) || dk.substring(0, 7) !== prevMonthKey) continue;
                const assigned = getPersonAssignedOnDateFromStore(dayTypeCategory, dk, groupNum);
                if (!assigned) continue;
                if (!lastKey || dk > lastKey) lastKey = dk;
            }
            if (!lastKey) return null;
            const assigned = getPersonAssignedOnDateFromStore(dayTypeCategory, lastKey, groupNum);
            if (typeof getPersonForRotationContinuity === 'function') {
                return getPersonForRotationContinuity(lastKey, groupNum, assigned, store);
            }
            const manual = findManualAlternateReplacementForGroup(lastKey, groupNum);
            if (manual?.replacementPerson && manual?.baselinePerson) {
                const n = normRotPersonName;
                if (n(assigned) === n(manual.replacementPerson)) {
                    return resolvePersonInGroupRotationList(manual.baselinePerson, groupNum, dayTypeCategory);
                }
            }
            return assigned;
        }

        function correctLastRotationPersonForManualAlternate(dayType, date, groupNum, personName) {
            if (!personName) return personName;
            const latest =
                (typeof getManualAlternateDeferFromPreviousMonth === 'function'
                    ? getManualAlternateDeferFromPreviousMonth(dayType, date, groupNum)
                    : null) ||
                (typeof findLatestManualAlternateInPreviousMonth === 'function'
                    ? findLatestManualAlternateInPreviousMonth(dayType, date, groupNum)
                    : null);
            if (!latest?.replacementPerson || !latest?.baselinePerson) return personName;
            const n = normRotPersonName;
            if (n(personName) === n(latest.replacementPerson)) {
                return resolvePersonInGroupRotationList(latest.baselinePerson, groupNum, dayType);
            }
            return personName;
        }

        function getLastRotationPersonForDate(dayType, date, groupNum) {
            const byType = lastRotationPositions?.[dayType] || {};
            const prevMonthKey = getPreviousMonthKeyFromDate(date);
            let person = null;

            // Month-scoped format
            if (byType && typeof byType === 'object' && !Array.isArray(byType)) {
                const monthEntry = byType[prevMonthKey];
                if (monthEntry && typeof monthEntry === 'object' && !Array.isArray(monthEntry) && monthEntry[groupNum]) {
                    person = monthEntry[groupNum];
                }
            }

            // Legacy flat format fallback
            if (!person && byType && byType[groupNum]) {
                person = byType[groupNum];
            }

            // Baseline fallback: derive last rotation person from rotationBaseline docs (previous month)
            if (!person) {
                let baselineMonth = rotationBaselineLastByType?.[dayType]?.[prevMonthKey];
                if (baselineMonth && baselineMonth[groupNum]) {
                    person = baselineMonth[groupNum];
                }
            }

            if (!person) {
                const baselineByType = rotationBaselineLastByType?.[dayType];
                if (baselineByType && typeof baselineByType === 'object') {
                    const availableMonths = Object.keys(baselineByType)
                        .filter(k => isMonthKey(k))
                        .sort((a, b) => {
                            const [aYear, aMonth] = a.split('-').map(Number);
                            const [bYear, bMonth] = b.split('-').map(Number);
                            if (aYear !== bYear) return bYear - aYear;
                            return bMonth - aMonth;
                        });

                    const [targetYear, targetMonth] = prevMonthKey.split('-').map(Number);
                    for (const monthKey of availableMonths) {
                        const [year, month] = monthKey.split('-').map(Number);
                        if (year < targetYear || (year === targetYear && month <= targetMonth)) {
                            const baselineMonth = baselineByType[monthKey];
                            if (baselineMonth && baselineMonth[groupNum]) {
                                console.log(`[ROTATION FALLBACK] Using most recent available month ${monthKey} (instead of ${prevMonthKey}) for group ${groupNum}, person: ${baselineMonth[groupNum]}`);
                                person = baselineMonth[groupNum];
                                break;
                            }
                        }
                    }
                }
            }

            if (person) {
                return correctLastRotationPersonForManualAlternate(dayType, date, groupNum, person);
            }

            return getLastAssignmentContinuityPersonForPreviousMonth(dayType, date, groupNum);
        }

        // Baseline-only variant for Excel "ΑΝΑΠΛΗΡΩΜΑΤΙΚΟΙ": ignores swaps/final assignments.
        function getLastBaselineRotationPersonForDate(dayType, date, groupNum) {
            const prevMonthKey = getPreviousMonthKeyFromDate(date);
            let baselineMonth = rotationBaselineLastByType?.[dayType]?.[prevMonthKey];
            if (baselineMonth && baselineMonth[groupNum]) {
                return baselineMonth[groupNum];
            }

            // If immediate previous month not found, find the most recent available baseline month
            const baselineByType = rotationBaselineLastByType?.[dayType];
            if (baselineByType && typeof baselineByType === 'object') {
                const availableMonths = Object.keys(baselineByType)
                    .filter(k => isMonthKey(k))
                    .sort((a, b) => {
                        const [aYear, aMonth] = a.split('-').map(Number);
                        const [bYear, bMonth] = b.split('-').map(Number);
                        if (aYear !== bYear) return bYear - aYear;
                        return bMonth - aMonth;
                    });

                const [targetYear, targetMonth] = prevMonthKey.split('-').map(Number);
                for (const monthKey of availableMonths) {
                    const [year, month] = monthKey.split('-').map(Number);
                    if (year < targetYear || (year === targetYear && month <= targetMonth)) {
                        baselineMonth = baselineByType[monthKey];
                        if (baselineMonth && baselineMonth[groupNum]) {
                            return baselineMonth[groupNum];
                        }
                    }
                }
            }
            return null;
        }

        function setLastRotationPersonForMonth(dayType, monthKey, groupNum, personName) {
            if (!personName) return;
            if (!lastRotationPositions[dayType]) lastRotationPositions[dayType] = {};
            if (!lastRotationPositions[dayType][monthKey] || typeof lastRotationPositions[dayType][monthKey] !== 'object' || Array.isArray(lastRotationPositions[dayType][monthKey])) {
                lastRotationPositions[dayType][monthKey] = {};
            }
            lastRotationPositions[dayType][monthKey][groupNum] = personName;
        }

        /** Normalize person name for rotation comparisons (matches logic.js normalizePersonKey style). */
        function normRotPersonName(n) {
            return String(n || '').trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '').replace(/\s+/g, ' ');
        }

        function getAssignmentReasonsGroupMap(dateKey, groupNum) {
            const root = assignmentReasons?.[dateKey];
            if (!root || typeof root !== 'object') return null;
            return root[groupNum] || root[String(groupNum)] || null;
        }

        function resolvePersonInGroupRotationList(personName, groupNum, dayTypeCategory) {
            if (!personName) return personName;
            const list = groups[groupNum]?.[dayTypeCategory] || [];
            if (!Array.isArray(list) || list.length === 0) return personName;
            const n = normRotPersonName(personName);
            const found = list.find((p) => normRotPersonName(p) === n);
            return found || personName;
        }

        function isManualAlternateReasonEntry(r) {
            if (!r || r.type !== 'skip') return false;
            if (r.meta && r.meta.manualAlternateReplacement) return true;
            return String(r.reason || '').includes('Αντικατάσταση Επιλαχών');
        }

        function getDutyCategoryForDateKeyLocal(dateKey) {
            if (typeof getDutyCategoryForDateKey === 'function') {
                return getDutyCategoryForDateKey(dateKey);
            }
            const d = new Date(dateKey + 'T00:00:00');
            if (isNaN(d.getTime())) return 'normal';
            const dtType = getDayType(d);
            if (dtType === 'special-holiday') return 'special';
            if (dtType === 'weekend-holiday') return 'weekend';
            if (dtType === 'semi-normal-day') return 'semi';
            return 'normal';
        }

        function recordManualAlternateDeferCarry(dayTypeCategory, dateKey, groupNum, replacementPerson, baselinePerson) {
            if (!dayTypeCategory || !dateKey || !groupNum || !replacementPerson || !baselinePerson) return;
            const d = new Date(dateKey + 'T00:00:00');
            if (isNaN(d.getTime())) return;
            const monthKey = getMonthKeyFromDate(d);
            if (!manualAlternateDeferCarry[dayTypeCategory]) manualAlternateDeferCarry[dayTypeCategory] = {};
            if (!manualAlternateDeferCarry[dayTypeCategory][monthKey]) {
                manualAlternateDeferCarry[dayTypeCategory][monthKey] = {};
            }
            manualAlternateDeferCarry[dayTypeCategory][monthKey][groupNum] = {
                replacementPerson: resolvePersonInGroupRotationList(replacementPerson, groupNum, dayTypeCategory),
                baselinePerson: resolvePersonInGroupRotationList(baselinePerson, groupNum, dayTypeCategory),
                sourceDateKey: dateKey
            };
        }

        function getManualAlternateDeferFromPreviousMonth(dayTypeCategory, dateInCurrentMonth, groupNum) {
            if (!dateInCurrentMonth || !dayTypeCategory || !groupNum) return null;
            const prevMonthKey = getPreviousMonthKeyFromDate(dateInCurrentMonth);
            const fromCarry = manualAlternateDeferCarry?.[dayTypeCategory]?.[prevMonthKey]?.[groupNum];
            if (fromCarry?.replacementPerson) {
                return {
                    dateKey: fromCarry.sourceDateKey || null,
                    replacementPerson: fromCarry.replacementPerson,
                    baselinePerson: fromCarry.baselinePerson || null
                };
            }
            return findLatestManualAlternateInPreviousMonth(dayTypeCategory, dateInCurrentMonth, groupNum);
        }

        /**
         * Manual "Αντικατάσταση Επιλαχών": replacement holds the duty but baseline (swappedWith) owns the rotation slot.
         */
        function findManualAlternateReplacementForGroup(dateKey, groupNum) {
            const byGroup = getAssignmentReasonsGroupMap(dateKey, groupNum);
            if (!byGroup || typeof byGroup !== 'object') return null;
            for (const replKey in byGroup) {
                const r = byGroup[replKey];
                if (!isManualAlternateReasonEntry(r)) continue;
                const baselinePerson = r.swappedWith || null;
                if (!baselinePerson) continue;
                const cat = getDutyCategoryForDateKeyLocal(dateKey);
                return {
                    replacementPerson: resolvePersonInGroupRotationList(replKey, groupNum, cat),
                    baselinePerson: resolvePersonInGroupRotationList(baselinePerson, groupNum, cat)
                };
            }
            return null;
        }

        /** Latest manual alternate in the calendar month immediately before dateInCurrentMonth. */
        function findLatestManualAlternateInPreviousMonth(dayTypeCategory, dateInCurrentMonth, groupNum) {
            if (!dateInCurrentMonth || !dayTypeCategory) return null;
            const prevMonthKey = getPreviousMonthKeyFromDate(dateInCurrentMonth);
            const dateKeysToScan = new Set();
            for (const dk in assignmentReasons || {}) {
                if (/^\d{4}-\d{2}-\d{2}$/.test(dk) && dk.substring(0, 7) === prevMonthKey) dateKeysToScan.add(dk);
            }
            for (const store of [semiNormalAssignments, normalDayAssignments, weekendAssignments, specialHolidayAssignments]) {
                if (!store || typeof store !== 'object') continue;
                for (const dk in store) {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(dk) && dk.substring(0, 7) === prevMonthKey) dateKeysToScan.add(dk);
                }
            }
            const people = groups[groupNum]?.[dayTypeCategory] || [];
            const norm = normRotPersonName;
            const inRotationList = (p) => p && people.some((x) => norm(x) === norm(p));

            let latest = null;
            for (const dk of dateKeysToScan) {
                const d = new Date(dk + 'T00:00:00');
                if (isNaN(d.getTime())) continue;
                const manual = findManualAlternateReplacementForGroup(dk, groupNum);
                if (!manual) continue;
                if (!inRotationList(manual.baselinePerson) && !inRotationList(manual.replacementPerson)) continue;
                const assignedOnDate = getPersonAssignedOnDateFromStore(dayTypeCategory, dk, groupNum);
                const categoryMatches =
                    getDutyCategoryForDateKeyLocal(dk) === dayTypeCategory ||
                    !!assignedOnDate ||
                    inRotationList(manual.baselinePerson);
                if (!categoryMatches) continue;
                if (!latest || dk > latest.dateKey) {
                    latest = {
                        dateKey: dk,
                        replacementPerson: resolvePersonInGroupRotationList(manual.replacementPerson, groupNum, dayTypeCategory),
                        baselinePerson: resolvePersonInGroupRotationList(manual.baselinePerson, groupNum, dayTypeCategory)
                    };
                }
            }
            return latest;
        }

        /**
         * Defer state: in the month after manual alternate, skip replacement person once when rotation reaches them.
         * deferState[groupNum] = { person, skipOnCursorMatch: true }
         */
        function seedManualAlternateDeferFromPreviousMonth(deferState, dayTypeCategory, dateInMonth, groupNum) {
            if (!deferState || !dateInMonth) return;
            const latest = getManualAlternateDeferFromPreviousMonth(dayTypeCategory, dateInMonth, groupNum);
            if (latest?.replacementPerson) {
                deferState[groupNum] = {
                    person: resolvePersonInGroupRotationList(latest.replacementPerson, groupNum, dayTypeCategory),
                    skipOnCursorMatch: true
                };
            }
        }

        function specialDebtEntryKey(d) {
            if (!d || !d.personName || !d.groupNum || !d.owedFromDateKey) return '';
            const nk =
                typeof normalizePersonKey === 'function' ? normalizePersonKey(d.personName) : String(d.personName || '').trim();
            return `${d.groupNum}|${nk}|${d.owedFromDateKey}`;
        }

        function parseAssignmentReasonsDocData(data) {
            const raw = data && typeof data === 'object' ? { ...data } : {};
            delete raw.lastUpdated;
            delete raw.updatedBy;
            let pending = [];
            if (Array.isArray(raw.pendingSpecialDebts)) {
                pending = raw.pendingSpecialDebts.filter((d) => specialDebtEntryKey(d));
            }
            delete raw.pendingSpecialDebts;
            if (raw._manualAlternateDeferCarry && typeof raw._manualAlternateDeferCarry === 'object') {
                manualAlternateDeferCarry = raw._manualAlternateDeferCarry;
                delete raw._manualAlternateDeferCarry;
            }
            return { reasons: raw, pendingSpecialDebts: pending };
        }

        function getPendingSpecialDebts() {
            return Array.isArray(pendingSpecialDebts) ? pendingSpecialDebts.slice() : [];
        }

        /** Προσθήκη ανοιχτής οφειλής (idempotent). */
        function addPendingSpecialDebt(debt) {
            const k = specialDebtEntryKey(debt);
            if (!k) return;
            if (!Array.isArray(pendingSpecialDebts)) pendingSpecialDebts = [];
            if (pendingSpecialDebts.some((d) => specialDebtEntryKey(d) === k)) return;
            pendingSpecialDebts.push({
                personName: debt.personName,
                groupNum: debt.groupNum,
                owedFromDateKey: debt.owedFromDateKey,
                reason: debt.reason || 'special-skip'
            });
        }

        /** Συγχρονισμός pending από αποθηκευμένα baseline/τελικές/λόγους (όλες οι ημερομηνίες). */
        function syncPendingSpecialDebtsFromAllSavedData() {
            if (
                typeof DutyRotationEngine === 'undefined' ||
                typeof DutyRotationEngine.collectInferredSpecialDebtsFromSavedAssignments !== 'function'
            ) {
                return;
            }
            const inferred = DutyRotationEngine.collectInferredSpecialDebtsFromSavedAssignments(null, null);
            for (const d of inferred) {
                addPendingSpecialDebt(d);
            }
        }

        /** Μετά από runSpecialPhase: αφαίρεση εξοφλημένων, πρόσθεση νέων ανοιχτών. */
        function updatePendingSpecialDebtsAfterSpecialPhase(engineOut) {
            if (!engineOut) return;
            const repaid = new Set((engineOut.debtsRepaid || []).map((d) => specialDebtEntryKey(d)).filter(Boolean));
            const next = (pendingSpecialDebts || []).filter((d) => !repaid.has(specialDebtEntryKey(d)));
            const existing = new Set(next.map((d) => specialDebtEntryKey(d)).filter(Boolean));
            for (const d of engineOut.debtsRemaining || []) {
                const k = specialDebtEntryKey(d);
                if (!k || existing.has(k)) continue;
                next.push(d);
                existing.add(k);
            }
            pendingSpecialDebts = next;
            syncPendingSpecialDebtsFromAllSavedData();
        }

        function buildAssignmentReasonsSavePayload() {
            return {
                ...assignmentReasons,
                pendingSpecialDebts: pendingSpecialDebts || [],
                _manualAlternateDeferCarry: manualAlternateDeferCarry
            };
        }

        /** Rebuild carry-over map from saved reasons (e.g. after load or before calc). */
        function rebuildManualAlternateDeferCarryFromReasons() {
            const rebuilt = { normal: {}, semi: {}, weekend: {}, special: {} };
            for (const dk in assignmentReasons || {}) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
                const cat = getDutyCategoryForDateKeyLocal(dk);
                for (let g = 1; g <= 4; g++) {
                    const manual = findManualAlternateReplacementForGroup(dk, g);
                    if (!manual) continue;
                    const d = new Date(dk + 'T00:00:00');
                    if (isNaN(d.getTime())) continue;
                    const monthKey = getMonthKeyFromDate(d);
                    if (!rebuilt[cat][monthKey]) rebuilt[cat][monthKey] = {};
                    rebuilt[cat][monthKey][g] = {
                        replacementPerson: manual.replacementPerson,
                        baselinePerson: manual.baselinePerson,
                        sourceDateKey: dk
                    };
                }
            }
            for (const cat of ['normal', 'semi', 'weekend', 'special']) {
                const prev = manualAlternateDeferCarry[cat] || {};
                const next = rebuilt[cat] || {};
                manualAlternateDeferCarry[cat] = { ...prev, ...next };
            }
        }

        function seedManualAlternateDeferAllGroupsForMonthStart(deferState, dayTypeCategory, dateInMonth) {
            for (let g = 1; g <= 4; g++) {
                seedManualAlternateDeferFromPreviousMonth(deferState, dayTypeCategory, dateInMonth, g);
            }
        }

        function getBaselineStoreForDayType(dayTypeCategory) {
            if (dayTypeCategory === 'special') return rotationBaselineSpecialAssignments;
            if (dayTypeCategory === 'weekend') return rotationBaselineWeekendAssignments;
            if (dayTypeCategory === 'semi') return rotationBaselineSemiAssignments;
            return rotationBaselineNormalAssignments;
        }

        /** Sorted duty date keys in a calendar month (assignments + baseline + reasons). */
        function getSortedDutyDateKeysInCalendarMonth(monthKey, dayTypeCategory) {
            const keys = new Set();
            const addFrom = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                for (const dk in obj) {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(dk) && dk.substring(0, 7) === monthKey) keys.add(dk);
                }
            };
            addFrom(getAssignmentsForDayType(dayTypeCategory));
            addFrom(getBaselineStoreForDayType(dayTypeCategory));
            addFrom(assignmentReasons);
            return [...keys]
                .filter((dk) => getDutyCategoryForDateKeyLocal(dk) === dayTypeCategory)
                .sort();
        }

        /**
         * Rotation cursor (index of next assignee) at the start of dateInMonth's calendar month.
         * Simulates previous month baseline slots; manual alternate advances from baseline+1, not replacement.
         */
        function computeRotationPositionAtMonthStart(dayTypeCategory, dateInMonth, groupNum, groupPeople) {
            if (!dateInMonth || !Array.isArray(groupPeople) || groupPeople.length === 0) return 0;
            const len = groupPeople.length;
            const norm = normRotPersonName;
            const findIdx = (name) => {
                if (!name) return -1;
                return groupPeople.findIndex((p) => norm(p) === norm(name));
            };
            const prevMonthStart = new Date(dateInMonth.getFullYear(), dateInMonth.getMonth() - 1, 1);
            const prevMonthKey = getPreviousMonthKeyFromDate(dateInMonth);
            const prevManualAlternate = findLatestManualAlternateInPreviousMonth(dayTypeCategory, dateInMonth, groupNum);

            // Fast path: no manual alternate in previous month -> seed directly from previous month baseline continuity.
            // This avoids synthetic cursor drift and preserves exact baseline carry-over.
            if (!prevManualAlternate?.replacementPerson) {
                const lastContinuityPerson =
                    getLastAssignmentContinuityPersonForPreviousMonth(dayTypeCategory, dateInMonth, groupNum) ||
                    getLastRotationPersonForDate(dayTypeCategory, dateInMonth, groupNum) ||
                    getLastBaselineRotationPersonForDate(dayTypeCategory, dateInMonth, groupNum);
                const continuityIdx = findIdx(lastContinuityPerson);
                if (lastContinuityPerson && continuityIdx >= 0) {
                    return (continuityIdx + 1) % len;
                }
                return 0;
            }

            let cursor = 0;
            const seedBeforePrev =
                getLastBaselineRotationPersonForDate(dayTypeCategory, prevMonthStart, groupNum) ||
                getLastAssignmentContinuityPersonForPreviousMonth(dayTypeCategory, prevMonthStart, groupNum) ||
                correctLastRotationPersonForManualAlternate(
                    dayTypeCategory,
                    prevMonthStart,
                    groupNum,
                    getLastRotationPersonForDate(dayTypeCategory, prevMonthStart, groupNum)
                );
            const seedIdx = findIdx(seedBeforePrev);
            if (seedBeforePrev && seedIdx >= 0) cursor = (seedIdx + 1) % len;

            const dates = getSortedDutyDateKeysInCalendarMonth(prevMonthKey, dayTypeCategory);
            for (const dk of dates) {
                const manual = findManualAlternateReplacementForGroup(dk, groupNum);
                if (manual?.baselinePerson) {
                    const bi = findIdx(resolvePersonInGroupRotationList(manual.baselinePerson, groupNum, dayTypeCategory));
                    if (bi >= 0) {
                        cursor = (bi + 1) % len;
                        continue;
                    }
                }
                cursor = (cursor % len + 1) % len;
            }
            return cursor;
        }

        /** Refresh lastRotationPositions for a month/group from assignments (baseline continuity after manual alternate). */
        function refreshLastRotationContinuityForMonth(dayTypeCategory, monthKey, groupNum) {
            if (!monthKey || !groupNum) return;
            const store = getAssignmentsForDayType(dayTypeCategory);
            let lastKey = null;
            for (const dk in store || {}) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dk) || dk.substring(0, 7) !== monthKey) continue;
                if (getDutyCategoryForDateKeyLocal(dk) !== dayTypeCategory) continue;
                if (!getPersonAssignedOnDateFromStore(dayTypeCategory, dk, groupNum)) continue;
                if (!lastKey || dk > lastKey) lastKey = dk;
            }
            if (lastKey) {
                const assigned = getPersonAssignedOnDateFromStore(dayTypeCategory, lastKey, groupNum);
                let continuity = assigned;
                if (typeof getPersonForRotationContinuity === 'function') {
                    continuity = getPersonForRotationContinuity(lastKey, groupNum, assigned, store);
                } else {
                    const manual = findManualAlternateReplacementForGroup(lastKey, groupNum);
                    if (
                        manual?.baselinePerson &&
                        manual?.replacementPerson &&
                        normRotPersonName(assigned) === normRotPersonName(manual.replacementPerson)
                    ) {
                        continuity = resolvePersonInGroupRotationList(manual.baselinePerson, groupNum, dayTypeCategory);
                    }
                }
                if (continuity) {
                    setLastRotationPersonForMonth(dayTypeCategory, monthKey, groupNum, continuity);
                    return;
                }
            }
            const baselineLast = rotationBaselineLastByType?.[dayTypeCategory]?.[monthKey]?.[groupNum];
            if (baselineLast) {
                setLastRotationPersonForMonth(dayTypeCategory, monthKey, groupNum, baselineLast);
            }
        }

        /** Month-start seed person: last baseline slot holder before the next assignee. */
        function getRotationSeedPersonForMonthStart(dayTypeCategory, monthStartDate, groupNum) {
            const groupData = typeof groupsForDuty === 'function' ? groupsForDuty(groupNum) : groups[groupNum];
            const groupPeople = groupData?.[dayTypeCategory] || groups[groupNum]?.[dayTypeCategory] || [];
            if (groupPeople.length > 0) {
                const cursor = computeRotationPositionAtMonthStart(dayTypeCategory, monthStartDate, groupNum, groupPeople);
                if (Number.isFinite(cursor)) {
                    const len = groupPeople.length;
                    return groupPeople[(cursor - 1 + len) % len] || null;
                }
            }
            const fromBaseline = getLastBaselineRotationPersonForDate(dayTypeCategory, monthStartDate, groupNum);
            if (fromBaseline) return fromBaseline;
            const fromStored = getLastRotationPersonForDate(dayTypeCategory, monthStartDate, groupNum);
            if (fromStored) return fromStored;
            return getLastAssignmentContinuityPersonForPreviousMonth(dayTypeCategory, monthStartDate, groupNum);
        }

        /**
         * Expected rotation-slot holder for a date (accounts for manual alternate: D replaces A → continue A,B,C, then skip D once).
         */
        function computeExpectedRotationPersonForDate(dayTypeCategory, dateKey, groupNum) {
            try {
                const groupData = groups[groupNum] || {};
                const people = groupData[dayTypeCategory] || [];
                if (!Array.isArray(people) || people.length === 0) return null;
                const d0 = new Date(dateKey + 'T00:00:00');
                if (isNaN(d0.getTime())) return null;
                const year = d0.getFullYear();
                const month = d0.getMonth();
                const monthSeedDate = new Date(year, month, 1);
                const keys = [];
                const cur = new Date(year, month, 1);
                const endM = new Date(year, month + 1, 0);
                while (cur <= endM) {
                    const dk = formatDateKey(cur);
                    const isSpecial = Array.isArray(specialHolidays) && specialHolidays.some(h => h && h.date === dk);
                    const dtType = isSpecial ? 'special-holiday' : getDayType(cur);
                    let cat = 'normal';
                    if (dtType === 'special-holiday') cat = 'special';
                    else if (dtType === 'weekend-holiday') cat = 'weekend';
                    else if (dtType === 'semi-normal-day') cat = 'semi';
                    if (cat === dayTypeCategory) keys.push(dk);
                    cur.setDate(cur.getDate() + 1);
                }
                keys.sort();
                const targetIdx = keys.indexOf(dateKey);
                if (targetIdx < 0) return null;
                const seed = getRotationSeedPersonForMonthStart(dayTypeCategory, monthSeedDate, groupNum);
                let idx = 0;
                if (seed) {
                    const seedIdx = people.indexOf(seed);
                    if (seedIdx >= 0) idx = (seedIdx + 1) % people.length;
                }
                let deferSkip = null;
                let deferSkipOnCursor = false;
                const prevManual = findLatestManualAlternateInPreviousMonth(dayTypeCategory, monthSeedDate, groupNum);
                if (prevManual?.replacementPerson) {
                    deferSkip = prevManual.replacementPerson;
                    deferSkipOnCursor = true;
                }
                for (let i = 0; i < keys.length; i++) {
                    const dk = keys[i];
                    const manual = findManualAlternateReplacementForGroup(dk, groupNum);
                    const bIdx = manual ? people.indexOf(manual.baselinePerson) : -1;
                    if (manual && bIdx >= 0) {
                        if (i === targetIdx) return manual.baselinePerson;
                        idx = (bIdx + 1) % people.length;
                        continue;
                    }
                    if (i === targetIdx) {
                        while (
                            deferSkip &&
                            deferSkipOnCursor &&
                            people[idx] &&
                            normRotPersonName(people[idx]) === normRotPersonName(deferSkip)
                        ) {
                            idx = (idx + 1) % people.length;
                            deferSkip = null;
                            deferSkipOnCursor = false;
                        }
                        return people[idx] || null;
                    }
                    while (
                        deferSkip &&
                        deferSkipOnCursor &&
                        people[idx] &&
                        normRotPersonName(people[idx]) === normRotPersonName(deferSkip)
                    ) {
                        idx = (idx + 1) % people.length;
                        deferSkip = null;
                        deferSkipOnCursor = false;
                    }
                    idx = (idx + 1) % people.length;
                }
                return null;
            } catch (e) {
                return null;
            }
        }
        
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
                let assignment = null;
                
                if (dayType === 'special-holiday') {
                    assignment = specialHolidayAssignments[dateKey] || null;
                } else if (dayType === 'weekend-holiday') {
                    assignment = weekendAssignments[dateKey] || null;
                } else if (dayType === 'semi-normal-day') {
                    assignment = semiNormalAssignments[dateKey] || null;
                } else if (dayType === 'normal-day') {
                    assignment = normalDayAssignments[dateKey] || null;
                }
                
                // If assignment is an object (like { groupNum: personName }), convert to string format
                if (assignment && typeof assignment === 'object' && !Array.isArray(assignment)) {
                    const parts = [];
                    for (const groupNum in assignment) {
                        const personName = assignment[groupNum];
                        if (personName) {
                            parts.push(`${personName} (Ομάδα ${groupNum})`);
                        }
                    }
                    return parts.length > 0 ? parts.join(', ') : null;
                }
                
                return assignment;
            } catch (error) {
                console.error(`Error getting assignment for ${dateKey}:`, error);
            }
            // Fallback to legacy dutyAssignments
            const fallbackAssignment = dutyAssignments[dateKey] || null;
            // Also handle object format in fallback
            if (fallbackAssignment && typeof fallbackAssignment === 'object' && !Array.isArray(fallbackAssignment)) {
                const parts = [];
                for (const groupNum in fallbackAssignment) {
                    const personName = fallbackAssignment[groupNum];
                    if (personName) {
                        parts.push(`${personName} (Ομάδα ${groupNum})`);
                    }
                }
                return parts.length > 0 ? parts.join(', ') : null;
            }
            return fallbackAssignment;
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
        let currentDate = (() => { const d = new Date(); d.setDate(1); return d; })();
        let currentGroup = null;
        // Manual assignment feature removed; keep dayDetails selection state elsewhere if needed.
        
        // Step-by-step calculation state
        let calculationSteps = {
            currentStep: 1,
            totalSteps: 4,
            startDate: null,
            endDate: null,
            /** True when no groups selected for stripping overrides (keeps manual/swap/alternate). */
            preserveExisting: true,
            /** Group numbers 1–4: recalc ignores manual modal, mutual swap & αντικατάσταση επιλαχών for these groups. */
            stripManualOverrideGroups: [],
            dayTypeLists: null,
            /** Captured before month recalc clear; used to restore manual modal / mutual swap / alternate replacement. */
            dutyProtectionSnapshot: null,
            /** Full in-memory snapshot before partial month clear (restore on Ακύρωση). */
            cancelRestoreSnapshot: null
        };

        /** Groups selected for recalc. Null = καμία ομάδα — δεν τρέχει επανυπολογισμός. */
        function getCalculationRecalcGroupSet() {
            const arr = calculationSteps?.stripManualOverrideGroups;
            if (!Array.isArray(arr) || arr.length === 0) return null;
            const s = new Set(arr.map((x) => parseInt(x, 10)).filter((x) => x >= 1 && x <= 4));
            return s.size > 0 ? s : null;
        }

        function isDutyRecalculationActive() {
            return getCalculationRecalcGroupSet() !== null;
        }

        function shouldRecalculateDutyGroup(groupNum) {
            const s = getCalculationRecalcGroupSet();
            if (!s) return false;
            return s.has(groupNum);
        }

        function removeGroupsFromAssignmentValue(assignment, groupSet) {
            if (!groupSet || groupSet.size === 0) return assignment;
            if (!assignment) return undefined;
            if (typeof assignment === 'object' && !Array.isArray(assignment)) {
                const copy = { ...assignment };
                for (const g of groupSet) {
                    delete copy[g];
                    delete copy[String(g)];
                }
                return Object.keys(copy).length > 0 ? copy : undefined;
            }
            const map = extractGroupAssignmentsMap(assignment);
            for (const g of groupSet) delete map[g];
            const str = groupMapToAssignmentString(map);
            return str || undefined;
        }

        function seedPreservedDutyAssignmentsIntoTemp(tempByDate, existingByDate, dateKeys) {
            const recalcSet = getCalculationRecalcGroupSet();
            if (!recalcSet) return;
            const keys = Array.isArray(dateKeys) ? dateKeys : Object.keys(existingByDate || {});
            for (const dateKey of keys) {
                const map = extractGroupAssignmentsMap(existingByDate?.[dateKey]);
                for (let g = 1; g <= 4; g++) {
                    if (recalcSet.has(g) || !map[g]) continue;
                    if (!tempByDate[dateKey]) tempByDate[dateKey] = {};
                    tempByDate[dateKey][g] = map[g];
                }
            }
        }

        function mergeTempGroupAssignmentsIntoAssignmentStore(tempByDate, targetStore) {
            if (!tempByDate || !targetStore) return;
            const recalcSet = getCalculationRecalcGroupSet();
            if (!recalcSet) return;
            for (const dateKey of Object.keys(tempByDate)) {
                const tempMap = tempByDate[dateKey];
                if (!tempMap || typeof tempMap !== 'object') continue;
                const existingMap = extractGroupAssignmentsMap(targetStore[dateKey]);
                for (let g = 1; g <= 4; g++) {
                    if (!recalcSet.has(g)) continue;
                    if (tempMap[g]) existingMap[g] = tempMap[g];
                    else delete existingMap[g];
                }
                const str = groupMapToAssignmentString(existingMap);
                if (str) targetStore[dateKey] = existingMap;
                else delete targetStore[dateKey];
            }
        }

        function mergeFormattedAssignmentsWithExistingStore(formattedNew, existingStore, recalcGroupSet) {
            if (!recalcGroupSet || recalcGroupSet.size === 0) return formattedNew;
            const out = { ...formattedNew };
            for (const dateKey of Object.keys(formattedNew)) {
                const newMap = extractGroupAssignmentsMap(formattedNew[dateKey]);
                const existingMap = extractGroupAssignmentsMap(existingStore?.[dateKey]);
                const merged = { ...existingMap };
                for (const g of recalcGroupSet) {
                    if (newMap[g]) merged[g] = newMap[g];
                    else delete merged[g];
                }
                const str = groupMapToAssignmentString(merged);
                if (str) out[dateKey] = str;
                else delete out[dateKey];
            }
            for (const dateKey of Object.keys(existingStore || {})) {
                if (out[dateKey]) continue;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
                const existingMap = extractGroupAssignmentsMap(existingStore[dateKey]);
                let hasPreserved = false;
                for (let g = 1; g <= 4; g++) {
                    if (!recalcGroupSet.has(g) && existingMap[g]) hasPreserved = true;
                }
                if (hasPreserved) out[dateKey] = existingStore[dateKey];
            }
            return out;
        }

        function captureDutyShiftsCancelRestoreSnapshot(startDate, endDate) {
            if (!startDate || !endDate) return null;
            const snap = {
                normalDayAssignments: {},
                semiNormalAssignments: {},
                weekendAssignments: {},
                specialHolidayAssignments: {},
                rotationBaselineSpecialAssignments: {},
                rotationBaselineWeekendAssignments: {},
                rotationBaselineSemiAssignments: {},
                rotationBaselineNormalAssignments: {},
                assignmentReasons: {}
            };
            try {
                snap.lastRotationPositions = JSON.parse(JSON.stringify(lastRotationPositions || {}));
            } catch (_) {
                snap.lastRotationPositions = { normal: {}, semi: {}, weekend: {}, special: {} };
            }
            const storeMap = {
                normalDayAssignments,
                semiNormalAssignments,
                weekendAssignments,
                specialHolidayAssignments,
                rotationBaselineSpecialAssignments,
                rotationBaselineWeekendAssignments,
                rotationBaselineSemiAssignments,
                rotationBaselineNormalAssignments
            };
            const storeNames = Object.keys(storeMap);
            const di = new Date(startDate);
            const end = new Date(endDate);
            while (di <= end) {
                const dk = formatDateKey(di);
                for (const name of storeNames) {
                    const store = storeMap[name];
                    if (store && store[dk] !== undefined) {
                        try {
                            snap[name][dk] = JSON.parse(JSON.stringify(store[dk]));
                        } catch (_) {
                            snap[name][dk] = store[dk];
                        }
                    }
                }
                if (assignmentReasons[dk]) {
                    try {
                        snap.assignmentReasons[dk] = JSON.parse(JSON.stringify(assignmentReasons[dk]));
                    } catch (_) {
                        snap.assignmentReasons[dk] = assignmentReasons[dk];
                    }
                }
                di.setDate(di.getDate() + 1);
            }
            return snap;
        }

        function restoreDutyShiftsCancelRestoreSnapshot(snapshot) {
            if (!snapshot) return;
            const pairs = [
                [normalDayAssignments, snapshot.normalDayAssignments],
                [semiNormalAssignments, snapshot.semiNormalAssignments],
                [weekendAssignments, snapshot.weekendAssignments],
                [specialHolidayAssignments, snapshot.specialHolidayAssignments],
                [rotationBaselineSpecialAssignments, snapshot.rotationBaselineSpecialAssignments],
                [rotationBaselineWeekendAssignments, snapshot.rotationBaselineWeekendAssignments],
                [rotationBaselineSemiAssignments, snapshot.rotationBaselineSemiAssignments],
                [rotationBaselineNormalAssignments, snapshot.rotationBaselineNormalAssignments]
            ];
            for (const [store, frag] of pairs) {
                if (!store || !frag) continue;
                for (const dk of Object.keys(frag)) {
                    store[dk] = frag[dk];
                }
            }
            for (const dk of Object.keys(snapshot.assignmentReasons || {})) {
                assignmentReasons[dk] = snapshot.assignmentReasons[dk];
            }
            if (snapshot.lastRotationPositions) {
                try {
                    lastRotationPositions = JSON.parse(JSON.stringify(snapshot.lastRotationPositions));
                } catch (_) {}
            }
            if (typeof rebuildRotationBaselineLastByType === 'function') rebuildRotationBaselineLastByType();
        }

        window.getCalculationRecalcGroupSet = getCalculationRecalcGroupSet;
        window.isDutyRecalculationActive = isDutyRecalculationActive;
        window.shouldRecalculateDutyGroup = shouldRecalculateDutyGroup;
        window.seedPreservedDutyAssignmentsIntoTemp = seedPreservedDutyAssignmentsIntoTemp;
        window.mergeTempGroupAssignmentsIntoAssignmentStore = mergeTempGroupAssignmentsIntoAssignmentStore;
        window.mergeFormattedAssignmentsWithExistingStore = mergeFormattedAssignmentsWithExistingStore;
        window.captureDutyShiftsCancelRestoreSnapshot = captureDutyShiftsCancelRestoreSnapshot;
        window.restoreDutyShiftsCancelRestoreSnapshot = restoreDutyShiftsCancelRestoreSnapshot;
        window.removeGroupsFromAssignmentValue = removeGroupsFromAssignmentValue;

        function _stripOverrideGroupSetFromArray(stripGroupNums) {
            if (!Array.isArray(stripGroupNums) || stripGroupNums.length === 0) return null;
            const s = new Set(stripGroupNums.filter((g) => g >= 1 && g <= 4));
            return s.size > 0 ? s : null;
        }
        
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

        // Missing-period reasons (global list)
        let missingReasons = ['Κανονική Άδεια', 'Αναρρωτική Άδεια', 'Φύλλο Πορείας'];
        let missingReasonsModified = false;

        /**
         * Προτίμηση «Ευέλικτη ημερομηνία ισχύος»: ανά Firebase χρήστη στο Firestore.
         * Διαδρομή: dutyShifts/userPreferences/users/{uid}
         * Σύσταση κανόνα ασφαλείας: ανάγνωση/εγγραφή μόνο αν request.auth.uid == uid (και όποιοι άλλοι έλεγχοι έχετε για Duty Shifts).
         */
        const FLEXIBLE_STATUS_EFFECTIVE_LS_KEY = 'dutyShiftsFlexibleStatusEffectiveDates';
        let dutyShiftsUserPrefsFlexibleEffectiveDates = null;
        let dutyShiftsUserPrefsLoadedForUid = null;

        function readFlexibleStatusEffectiveFromLocalStorage() {
            try {
                const v = localStorage.getItem(FLEXIBLE_STATUS_EFFECTIVE_LS_KEY);
                return v === '1' || v === 'true';
            } catch (_) {
                return false;
            }
        }

        function isFlexibleStatusEffectiveDatesEnabled() {
            const uid = window.auth?.currentUser?.uid;
            if (
                uid &&
                dutyShiftsUserPrefsLoadedForUid === uid &&
                dutyShiftsUserPrefsFlexibleEffectiveDates !== null
            ) {
                return !!dutyShiftsUserPrefsFlexibleEffectiveDates;
            }
            return readFlexibleStatusEffectiveFromLocalStorage();
        }

        function resetDutyShiftsUserPreferencesSessionCache() {
            dutyShiftsUserPrefsFlexibleEffectiveDates = null;
            dutyShiftsUserPrefsLoadedForUid = null;
        }

        function applyDutyShiftsFlexiblePreferenceForUser(uid, valueFromFirestore) {
            dutyShiftsUserPrefsLoadedForUid = uid || null;
            if (typeof valueFromFirestore === 'boolean') {
                dutyShiftsUserPrefsFlexibleEffectiveDates = valueFromFirestore;
            } else {
                dutyShiftsUserPrefsFlexibleEffectiveDates = readFlexibleStatusEffectiveFromLocalStorage();
            }
            try {
                localStorage.setItem(
                    FLEXIBLE_STATUS_EFFECTIVE_LS_KEY,
                    dutyShiftsUserPrefsFlexibleEffectiveDates ? '1' : '0'
                );
            } catch (_) {}
        }

        async function loadDutyShiftsUserPreferences(user) {
            resetDutyShiftsUserPreferencesSessionCache();
            if (!user?.uid || !window.db) {
                dutyShiftsUserPrefsFlexibleEffectiveDates = readFlexibleStatusEffectiveFromLocalStorage();
                dutyShiftsUserPrefsLoadedForUid = null;
                return;
            }
            try {
                const db = window.db || firebase.firestore();
                const snap = await db
                    .collection('dutyShifts')
                    .doc('userPreferences')
                    .collection('users')
                    .doc(user.uid)
                    .get();
                if (snap.exists) {
                    const d = snap.data() || {};
                    if (typeof d.flexibleStatusEffectiveDates === 'boolean') {
                        applyDutyShiftsFlexiblePreferenceForUser(user.uid, d.flexibleStatusEffectiveDates);
                        return;
                    }
                }
                applyDutyShiftsFlexiblePreferenceForUser(user.uid, undefined);
            } catch (e) {
                console.warn('loadDutyShiftsUserPreferences:', e);
                applyDutyShiftsFlexiblePreferenceForUser(user.uid, undefined);
            }
        }

        async function saveDutyShiftsUserPreferenceFlexibleEffective(enabled) {
            const user = window.auth?.currentUser;
            const val = !!enabled;
            dutyShiftsUserPrefsFlexibleEffectiveDates = val;
            dutyShiftsUserPrefsLoadedForUid = user?.uid || null;
            try {
                localStorage.setItem(FLEXIBLE_STATUS_EFFECTIVE_LS_KEY, val ? '1' : '0');
            } catch (_) {}

            if (!user?.uid || !window.db) return;

            try {
                const db = window.db || firebase.firestore();
                await db
                    .collection('dutyShifts')
                    .doc('userPreferences')
                    .collection('users')
                    .doc(user.uid)
                    .set(
                        {
                            flexibleStatusEffectiveDates: val,
                            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                            updatedBy: user.uid
                        },
                        { merge: true }
                    );
            } catch (e) {
                console.error('saveDutyShiftsUserPreferenceFlexibleEffective:', e);
                alert(
                    'Η ρύθμιση αποθηκεύτηκε τοπικά στον browser, αλλά αποτυχία εγγραφής στο cloud. Ελέγξτε δικαιώματα Firestore ή τη σύνδεση.'
                );
            }
        }

        window.isFlexibleStatusEffectiveDatesEnabled = isFlexibleStatusEffectiveDatesEnabled;
        window.loadDutyShiftsUserPreferences = loadDutyShiftsUserPreferences;
        window.saveDutyShiftsUserPreferenceFlexibleEffective = saveDutyShiftsUserPreferenceFlexibleEffective;
        window.resetDutyShiftsUserPreferencesSessionCache = resetDutyShiftsUserPreferencesSessionCache;

        /**
         * Κοινές ρυθμίσεις εφαρμογής (όλοι οι χρήστες): dutyShifts/settings
         * — εξαιρέσεις ομάδων από λογική Δευ↔Τετ / Πέμ↔Τρι.
         */
        const NORMAL_WEEK_PAIR_SWAP_DISABLED_GROUPS_LS_KEY = 'dutyShiftsNormalWeekPairSwapDisabledGroups';
        let normalWeekPairSwapDisabledGroups = [];

        function sanitizeNormalWeekPairSwapDisabledGroups(groupsArr) {
            if (!Array.isArray(groupsArr)) return [];
            return groupsArr
                .map((x) => parseInt(x, 10))
                .filter((x) => Number.isFinite(x) && x >= 1 && x <= 4)
                .filter((x, i, a) => a.indexOf(x) === i)
                .sort((a, b) => a - b);
        }

        function readNormalWeekPairSwapDisabledGroupsFromLocalStorage() {
            try {
                const raw = localStorage.getItem(NORMAL_WEEK_PAIR_SWAP_DISABLED_GROUPS_LS_KEY);
                if (!raw) return [];
                return sanitizeNormalWeekPairSwapDisabledGroups(JSON.parse(raw));
            } catch (_) {
                return [];
            }
        }

        function applyNormalWeekPairSwapDisabledGroupsFromValue(groupsArr) {
            normalWeekPairSwapDisabledGroups = sanitizeNormalWeekPairSwapDisabledGroups(groupsArr);
            try {
                localStorage.setItem(
                    NORMAL_WEEK_PAIR_SWAP_DISABLED_GROUPS_LS_KEY,
                    JSON.stringify(normalWeekPairSwapDisabledGroups)
                );
            } catch (_) {}
        }

        function getNormalWeekPairSwapDisabledGroups() {
            return normalWeekPairSwapDisabledGroups.slice();
        }

        function setNormalWeekPairSwapDisabledGroups(groupsArr) {
            applyNormalWeekPairSwapDisabledGroupsFromValue(groupsArr);
        }

        function shouldApplyNormalWeekPairSwapLogicForGroup(groupNum) {
            return !normalWeekPairSwapDisabledGroups.includes(groupNum);
        }

        async function saveDutyShiftsAppSettingsNormalWeekPairDisabled(groupsArr) {
            const safe = sanitizeNormalWeekPairSwapDisabledGroups(groupsArr);
            applyNormalWeekPairSwapDisabledGroupsFromValue(safe);

            const user = window.auth?.currentUser;
            if (!user?.uid || !window.db) {
                console.warn('saveDutyShiftsAppSettingsNormalWeekPairDisabled: no auth/db');
                return false;
            }

            try {
                const db = window.db || firebase.firestore();
                await db
                    .collection('dutyShifts')
                    .doc('settings')
                    .set(
                        {
                            normalWeekPairSwapDisabledGroups: safe,
                            lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                            updatedBy: user.uid
                        },
                        { merge: true }
                    );
                return true;
            } catch (e) {
                console.error('saveDutyShiftsAppSettingsNormalWeekPairDisabled:', e);
                alert(
                    'Οι εξαιρέσεις ομάδων αποθηκεύτηκαν τοπικά, αλλά αποτυχία εγγραφής στο cloud. Ελέγξτε δικαιώματα Firestore ή τη σύνδεση.'
                );
                return false;
            }
        }

        async function migrateNormalWeekPairSwapDisabledGroupsFromLocalStorageIfNeeded() {
            const user = window.auth?.currentUser;
            if (!user?.uid || !window.db) return;
            const fromLs = readNormalWeekPairSwapDisabledGroupsFromLocalStorage();
            if (!fromLs.length) return;
            if (normalWeekPairSwapDisabledGroups.length) return;
            await saveDutyShiftsAppSettingsNormalWeekPairDisabled(fromLs);
        }

        window.getNormalWeekPairSwapDisabledGroups = getNormalWeekPairSwapDisabledGroups;
        window.setNormalWeekPairSwapDisabledGroups = setNormalWeekPairSwapDisabledGroups;
        window.shouldApplyNormalWeekPairSwapLogicForGroup = shouldApplyNormalWeekPairSwapLogicForGroup;
        window.saveDutyShiftsAppSettingsNormalWeekPairDisabled = saveDutyShiftsAppSettingsNormalWeekPairDisabled;

        // Track data loading to prevent duplicate loads
        let dataLastLoaded = null;
        let isLoadingData = false;
        const DATA_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache duration
        
        // Initialize (guard against duplicate initialization which can cause slow loads after refresh)
        let dutyShiftsInitStarted = false;
        let dutyShiftsAuthUnsubscribe = null;
        function startDutyShiftsAppInit() {
            if (dutyShiftsInitStarted) return;
            dutyShiftsInitStarted = true;
            restoreCalendarCellHeight();
            
            const tryAttach = () => {
                // Wait for Firebase to be ready (do NOT re-dispatch DOMContentLoaded)
                if (!(window.auth && window.db)) {
                    setTimeout(tryAttach, 250);
                    return;
                }
                
                // Attach auth listener once
                let authListenerUnsubscribed = false;
                dutyShiftsAuthUnsubscribe = window.auth.onAuthStateChanged(async function(user) {
                    if (authListenerUnsubscribed) return;
                    
                    if (user && user.emailVerified) {
                        const now = Date.now();
                        if (dataLastLoaded && (now - dataLastLoaded) < DATA_CACHE_DURATION && !isLoadingData) {
                            await loadDutyShiftsUserPreferences(user);
                            renderGroups();
                            renderHolidays();
                            renderRecurringHolidays();
                            renderCalendar();
                            updateStatistics();
                            return;
                        }
                        
                        isLoadingData = true;
                        await loadData();
                        await loadDutyShiftsUserPreferences(user);
                        dataLastLoaded = Date.now();
                        isLoadingData = false;
                        
                        // Render UI in next frame to reduce long main-thread blocking
                        requestAnimationFrame(() => {
                        renderGroups();
                        renderHolidays();
                        renderRecurringHolidays();
                        renderCalendar();
                        updateStatistics();
                        });
                    } else {
                        resetDutyShiftsUserPreferencesSessionCache();
                        // Not authenticated, use localStorage
                        loadDataFromLocalStorage();
                        requestAnimationFrame(() => {
                        renderGroups();
                        renderHolidays();
                        renderRecurringHolidays();
                        renderCalendar();
                        updateStatistics();
                        });
                    }
                });
                
                // Clean up listener when page is hidden/unloaded to prevent background reads
                document.addEventListener('visibilitychange', function() {
                    if (document.hidden) {
                        if (dutyShiftsAuthUnsubscribe && typeof dutyShiftsAuthUnsubscribe === 'function') {
                            dutyShiftsAuthUnsubscribe();
                            authListenerUnsubscribed = true;
                        }
                    }
                });
                
                window.addEventListener('beforeunload', function() {
                    if (dutyShiftsAuthUnsubscribe && typeof dutyShiftsAuthUnsubscribe === 'function') {
                        dutyShiftsAuthUnsubscribe();
                        authListenerUnsubscribed = true;
                    }
                });
            };
            
            tryAttach();
        }
        
        document.addEventListener('DOMContentLoaded', startDutyShiftsAppInit);

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
                
                // Fetch all Firestore documents in parallel to reduce load time.
                const dutyShifts = db.collection('dutyShifts');
                const [
                    groupsDoc,
                    holidaysDoc,
                    specialHolidaysDoc,
                    recurringDoc,
                    normalDayDoc,
                    semiNormalDoc,
                    weekendDoc,
                    specialHolidayDoc,
                    rotationBaselineSpecialDoc,
                    rotationBaselineWeekendDoc,
                    rotationBaselineSemiDoc,
                    rotationBaselineNormalDoc,
                    criticalAssignmentsDoc,
                    assignmentReasonsDoc,
                    lastRotationPositionsDoc,
                    rankingsDoc,
                    missingReasonsDoc,
                    monthCalculationLocksDoc,
                    personStatusScheduleDoc,
                    settingsDoc
                ] = await Promise.all([
                    dutyShifts.doc('groups').get(),
                    dutyShifts.doc('holidays').get(),
                    dutyShifts.doc('specialHolidays').get(),
                    dutyShifts.doc('recurringSpecialHolidays').get(),
                    dutyShifts.doc('normalDayAssignments').get(),
                    dutyShifts.doc('semiNormalAssignments').get(),
                    dutyShifts.doc('weekendAssignments').get(),
                    dutyShifts.doc('specialHolidayAssignments').get(),
                    dutyShifts.doc('rotationBaselineSpecialAssignments').get(),
                    dutyShifts.doc('rotationBaselineWeekendAssignments').get(),
                    dutyShifts.doc('rotationBaselineSemiAssignments').get(),
                    dutyShifts.doc('rotationBaselineNormalAssignments').get(),
                    dutyShifts.doc('criticalAssignments').get(),
                    dutyShifts.doc('assignmentReasons').get(),
                    dutyShifts.doc('lastRotationPositions').get(),
                    dutyShifts.doc('rankings').get(),
                    dutyShifts.doc('missingReasons').get(),
                    dutyShifts.doc('monthCalculationLocks').get(),
                    dutyShifts.doc('personStatusSchedule').get(),
                    dutyShifts.doc('settings').get()
                ]);
                
                // Load groups
                if (groupsDoc.exists) {
                    const data = groupsDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    groups = migrateGroupsFormat(data) || { 1: { regular: [], special: [] }, 2: { regular: [], special: [] }, 3: { regular: [], special: [] }, 4: { regular: [], special: [] } };
                    
                    // CRITICAL: Always ensure priorities/disabled objects exist and are properly initialized
                    for (let i = 1; i <= 4; i++) {
                        if (!groups[i]) {
                            groups[i] = { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {}, disabledPersons: {} };
                        }
                        if (!groups[i].priorities) {
                            groups[i].priorities = {};
                        }
                        if (!groups[i].disabledPersons) {
                            groups[i].disabledPersons = {};
                        }

                        // Migrate old boolean disabled flag to per-type object
                        for (const name of Object.keys(groups[i].disabledPersons || {})) {
                            if (groups[i].disabledPersons[name] === true) {
                                groups[i].disabledPersons[name] = { all: true, special: false, weekend: false, semi: false, normal: false };
                            }
                        }
                        
                        // Ensure all people in lists have priority entries (only if they don't already exist)
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

                if (personStatusScheduleDoc && personStatusScheduleDoc.exists) {
                    const sched = personStatusScheduleDoc.data() || {};
                    personStatusSchedule = {
                        disabled: Array.isArray(sched.disabled) ? sched.disabled : [],
                        membership: Array.isArray(sched.membership) ? sched.membership : [],
                        listOrders: Array.isArray(sched.listOrders) ? sched.listOrders : [],
                        _seeded: true
                    };
                }
                if (typeof ensurePersonStatusScheduleSeeded === 'function') {
                    ensurePersonStatusScheduleSeeded();
                }
                if (typeof sanitizePersonStatusScheduleEffectiveDates === 'function') {
                    sanitizePersonStatusScheduleEffectiveDates();
                }

                // Load missing reasons list (Firestore)
                // NOTE: If Firestore contains the old default seed list, migrate it to the new 3-item seed list.
                const DEFAULT_MISSING_REASONS = ['Κανονική Άδεια', 'Αναρρωτική Άδεια', 'Φύλλο Πορείας'];
                const LEGACY_MISSING_REASONS = ['Άδεια', 'Ασθένεια', 'Εκπαίδευση', 'Υπηρεσιακό'];
                if (missingReasonsDoc && missingReasonsDoc.exists) {
                    const data = missingReasonsDoc.data() || {};
                    if (Array.isArray(data.list) && data.list.length) {
                        const list = data.list.filter(Boolean).map(x => String(x).trim()).filter(Boolean);
                        const norm = (arr) => arr.map(s => String(s).trim()).filter(Boolean).map(s => s.toLowerCase()).sort().join('|');
                        const isLegacyOnly = norm(list) === norm(LEGACY_MISSING_REASONS);
                        if (isLegacyOnly) {
                            missingReasons = [...DEFAULT_MISSING_REASONS];
                            try {
                                await db.collection('dutyShifts').doc('missingReasons').set({
                                    list: missingReasons,
                                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                                    updatedBy: user.uid,
                                    _migratedFrom: 'legacy-defaults'
                                });
                            } catch (_) {
                                // ignore migration write errors
                            }
                        } else {
                            missingReasons = list;
                        }
                    }
                }
                
                // Load holidays
                if (holidaysDoc.exists) {
                    const data = holidaysDoc.data();
                    holidays = data.list || [];
                }
                
                // Load special holidays
                if (specialHolidaysDoc.exists) {
                    const data = specialHolidaysDoc.data();
                    specialHolidays = data.list || [];
                }
                
                // Load recurring holidays config (Firestore first, then localStorage fallback)
                if (recurringDoc.exists) {
                    const data = recurringDoc.data();
                    recurringSpecialHolidays = data.list || recurringSpecialHolidays;
                }
                const savedRecurring = localStorage.getItem('dutyShiftsRecurringHolidays');
                if (savedRecurring) {
                    try {
                        recurringSpecialHolidays = JSON.parse(savedRecurring);
                    } catch (e) {
                        // ignore parse errors
                    }
                }
                
                // Initialize default special holidays if they don't exist
                initializeDefaultSpecialHolidays();
                
                // Helper: check month-organized format (e.g., "February 2026" keys)
                const isMonthOrganizedDoc = (data) => Object.keys(data || {}).some(k => /^[A-Za-z]+\s+\d{4}$/.test(k) && typeof data[k] === 'object');
                
                // Load assignments from separate documents by day type
                if (normalDayDoc.exists) {
                    const data = normalDayDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    delete data._migratedFrom;
                    delete data._migrationDate;
                    normalDayAssignments = isMonthOrganizedDoc(data) ? flattenAssignmentsByMonth(data) : (data || {});
                }
                
                if (semiNormalDoc.exists) {
                    const data = semiNormalDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    delete data._migratedFrom;
                    delete data._migrationDate;
                    semiNormalAssignments = isMonthOrganizedDoc(data) ? flattenAssignmentsByMonth(data) : (data || {});
                }
                
                if (weekendDoc.exists) {
                    const data = weekendDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    delete data._migratedFrom;
                    delete data._migrationDate;
                    weekendAssignments = isMonthOrganizedDoc(data) ? flattenAssignmentsByMonth(data) : (data || {});
                }
                
                if (specialHolidayDoc.exists) {
                    const data = specialHolidayDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    delete data._migratedFrom;
                    delete data._migrationDate;
                    specialHolidayAssignments = isMonthOrganizedDoc(data) ? flattenAssignmentsByMonth(data) : (data || {});
                }

                // Load rotation baseline docs (pure rotation order, month-organized)
                if (rotationBaselineSpecialDoc.exists) {
                    const data = rotationBaselineSpecialDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    delete data._migratedFrom;
                    delete data._migrationDate;
                    rotationBaselineSpecialAssignments = isMonthOrganizedDoc(data) ? flattenAssignmentsByMonth(data) : (data || {});
                } else {
                    rotationBaselineSpecialAssignments = {};
                }
                if (rotationBaselineWeekendDoc.exists) {
                    const data = rotationBaselineWeekendDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    delete data._migratedFrom;
                    delete data._migrationDate;
                    rotationBaselineWeekendAssignments = isMonthOrganizedDoc(data) ? flattenAssignmentsByMonth(data) : (data || {});
                } else {
                    rotationBaselineWeekendAssignments = {};
                }
                if (rotationBaselineSemiDoc.exists) {
                    const data = rotationBaselineSemiDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    delete data._migratedFrom;
                    delete data._migrationDate;
                    rotationBaselineSemiAssignments = isMonthOrganizedDoc(data) ? flattenAssignmentsByMonth(data) : (data || {});
                } else {
                    rotationBaselineSemiAssignments = {};
                }
                if (rotationBaselineNormalDoc.exists) {
                    const data = rotationBaselineNormalDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    delete data._migratedFrom;
                    delete data._migrationDate;
                    rotationBaselineNormalAssignments = isMonthOrganizedDoc(data) ? flattenAssignmentsByMonth(data) : (data || {});
                } else {
                    rotationBaselineNormalAssignments = {};
                }

                // Deprecated: legacy dutyShifts/assignments is no longer loaded or merged.
                dutyAssignments = {};

                // Build cached baseline-last mapping for rotation seeding fallback
                rebuildRotationBaselineLastByType();
                
                // Load critical assignments (history only)
                if (criticalAssignmentsDoc.exists) {
                    const data = criticalAssignmentsDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    criticalAssignments = data || {};
                            } else {
                    criticalAssignments = {};
                }
                
                // Load assignment reasons (+ pending special debts)
                if (assignmentReasonsDoc.exists) {
                    const parsed = parseAssignmentReasonsDocData(assignmentReasonsDoc.data() || {});
                    assignmentReasons = parsed.reasons;
                    pendingSpecialDebts = parsed.pendingSpecialDebts;
                } else {
                    assignmentReasons = {};
                    pendingSpecialDebts = [];
                }
                if (typeof rebuildManualAlternateDeferCarryFromReasons === 'function') {
                    rebuildManualAlternateDeferCarryFromReasons();
                }
                if (typeof syncPendingSpecialDebtsFromAllSavedData === 'function') {
                    syncPendingSpecialDebtsFromAllSavedData();
                }

                // Load per-month calculation locks (κλείδωμα μήνα)
                monthCalculationLocks = {};
                if (monthCalculationLocksDoc && monthCalculationLocksDoc.exists) {
                    const rawLocks = monthCalculationLocksDoc.data() || {};
                    const L = rawLocks.locks && typeof rawLocks.locks === 'object' ? rawLocks.locks : rawLocks;
                    for (const k of Object.keys(L)) {
                        if (/^\d{4}-\d{2}$/.test(k) && L[k]) monthCalculationLocks[k] = true;
                    }
                }

                // Κοινές ρυθμίσεις: εξαιρέσεις ομάδων swap (Δευ↔Τετ / Πέμ↔Τρι)
                if (settingsDoc && settingsDoc.exists) {
                    const settingsData = settingsDoc.data() || {};
                    if (Array.isArray(settingsData.normalWeekPairSwapDisabledGroups)) {
                        applyNormalWeekPairSwapDisabledGroupsFromValue(settingsData.normalWeekPairSwapDisabledGroups);
                    } else {
                        applyNormalWeekPairSwapDisabledGroupsFromValue([]);
                    }
                } else {
                    applyNormalWeekPairSwapDisabledGroupsFromValue(readNormalWeekPairSwapDisabledGroupsFromLocalStorage());
                    migrateNormalWeekPairSwapDisabledGroupsFromLocalStorageIfNeeded().catch((e) => {
                        console.warn('migrateNormalWeekPairSwapDisabledGroupsFromLocalStorageIfNeeded:', e);
                    });
                }
                
                // Load last rotation positions
                if (lastRotationPositionsDoc.exists) {
                    const data = lastRotationPositionsDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    
                    const convertArrayToObject = (arr) => {
                        if (Array.isArray(arr)) {
                            const obj = {};
                            arr.forEach((value, index) => {
                                obj[index + 1] = value;
                            });
                            return obj;
                        }
                        return arr;
                    };
                    
                    const normalizeRotationType = (val) => {
                        if (!val || typeof val !== 'object') return {};
                        if (Array.isArray(val)) return convertArrayToObject(val);
                        const keys = Object.keys(val);
                        const hasMonthKeys = keys.some(k => isMonthKey(k));
                        if (hasMonthKeys) {
                            const out = {};
                            for (const mk of keys) out[mk] = convertArrayToObject(val[mk]);
                            return out;
                        }
                        return convertArrayToObject(val);
                    };
                    
                    if (data.normal) lastRotationPositions.normal = normalizeRotationType(data.normal);
                    if (data.semi) lastRotationPositions.semi = normalizeRotationType(data.semi);
                    if (data.weekend) lastRotationPositions.weekend = normalizeRotationType(data.weekend);
                    if (data.special) lastRotationPositions.special = normalizeRotationType(data.special);
                } else {
                    lastRotationPositions = { normal: {}, semi: {}, weekend: {}, special: {} };
                }
                
                // Load rankings
                if (rankingsDoc.exists) {
                    const data = rankingsDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    rankings = data || {};
                } else {
                    rankings = {};
                }
                
                // Reset rankingsModified flag after loading (rankings haven't been modified yet)
                rankingsModified = false;
                
                // IMPORTANT: Do not auto-rebuild/restore critical assignments into the schedule.
                // criticalAssignments are kept as history only and must not affect the current calendar.
                
                console.log('Data loaded from Firebase');
            } catch (error) {
                console.error('Error loading data from Firebase:', error);
                // Fallback to localStorage
                loadDataFromLocalStorage();
            }
        }

        // Refresh special-holiday baseline, last rotation positions, and saved assignments from Firebase.
        // Call this before calculating special holiday duty so we have the latest baseline and can avoid assigning someone already assigned on a previous special.
        async function refreshSpecialBaselineFromFirebase() {
            try {
                if (!window.db) return;
                const db = window.db || firebase.firestore();
                const user = window.auth?.currentUser;
                if (!user) return;

                const dutyShifts = db.collection('dutyShifts');
                const [rotationBaselineSpecialDoc, lastRotationPositionsDoc, specialHolidayAssignmentsDoc] = await Promise.all([
                    dutyShifts.doc('rotationBaselineSpecialAssignments').get(),
                    dutyShifts.doc('lastRotationPositions').get(),
                    dutyShifts.doc('specialHolidayAssignments').get()
                ]);

                const isMonthOrganizedDoc = (data) => Object.keys(data || {}).some(k => /^[A-Za-z]+\s+\d{4}$/.test(k) && typeof data[k] === 'object');

                if (specialHolidayAssignmentsDoc.exists) {
                    const data = specialHolidayAssignmentsDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    delete data._migratedFrom;
                    delete data._migrationDate;
                    specialHolidayAssignments = isMonthOrganizedDoc(data) ? flattenAssignmentsByMonth(data) : (data || {});
                } else {
                    specialHolidayAssignments = {};
                }

                if (rotationBaselineSpecialDoc.exists) {
                    const data = rotationBaselineSpecialDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    delete data._migratedFrom;
                    delete data._migrationDate;
                    rotationBaselineSpecialAssignments = isMonthOrganizedDoc(data) ? flattenAssignmentsByMonth(data) : (data || {});
                } else {
                    rotationBaselineSpecialAssignments = {};
                }

                if (lastRotationPositionsDoc.exists) {
                    const data = lastRotationPositionsDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    const convertArrayToObject = (arr) => {
                        if (Array.isArray(arr)) {
                            const obj = {};
                            arr.forEach((value, index) => {
                                obj[index + 1] = value;
                            });
                            return obj;
                        }
                        return arr;
                    };
                    const normalizeRotationType = (val) => {
                        if (!val || typeof val !== 'object') return {};
                        if (Array.isArray(val)) return convertArrayToObject(val);
                        const keys = Object.keys(val);
                        const hasMonthKeys = keys.some(k => isMonthKey(k));
                        if (hasMonthKeys) {
                            const out = {};
                            for (const mk of keys) out[mk] = convertArrayToObject(val[mk]);
                            return out;
                        }
                        return convertArrayToObject(val);
                    };
                    if (data.special) {
                        if (!lastRotationPositions.special) lastRotationPositions.special = {};
                        lastRotationPositions.special = normalizeRotationType(data.special);
                    }
                }

                rebuildRotationBaselineLastByType();
                console.log('Refreshed special-holiday baseline, last rotation positions, and specialHolidayAssignments from Firebase');
            } catch (error) {
                console.error('Error refreshing special baseline from Firebase:', error);
            }
        }

        // Rebuild criticalAssignments from lastDuties
        // This ensures manually entered dates are always protected, even if criticalAssignments wasn't saved
        // IMPORTANT: This function only updates in-memory data. It does NOT save to Firebase.
        // Saving should only happen when actual changes are made by the user.
        function rebuildCriticalAssignmentsFromLastDuties() {
            let rebuiltCount = 0;
            
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
                                }
                            } catch (error) {
                                console.error(`Error rebuilding critical assignment for ${dateStr}:`, error);
                            }
                        }
                    });
                });
            }
            
            // Only log if there were actual changes
            if (rebuiltCount > 0) {
                console.log(`Rebuilt ${rebuiltCount} critical history entries from lastDuties (in-memory only, not saved)`);
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
            const savedSchedule = localStorage.getItem('dutyShiftsPersonStatusSchedule');
            if (savedSchedule) {
                try {
                    const sched = JSON.parse(savedSchedule);
                    personStatusSchedule = {
                        disabled: Array.isArray(sched.disabled) ? sched.disabled : [],
                        membership: Array.isArray(sched.membership) ? sched.membership : [],
                        listOrders: Array.isArray(sched.listOrders) ? sched.listOrders : [],
                        _seeded: true
                    };
                } catch (_) {}
            }
            if (typeof ensurePersonStatusScheduleSeeded === 'function') {
                ensurePersonStatusScheduleSeeded();
            }
            if (typeof sanitizePersonStatusScheduleEffectiveDates === 'function') {
                sanitizePersonStatusScheduleEffectiveDates();
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
            
            // Deprecated: legacy dutyShiftsAssignments (dutyAssignments) is no longer used.
            dutyAssignments = {};
            
            // Load critical assignments
            const savedCriticalAssignments = localStorage.getItem('dutyShiftsCriticalAssignments');
            if (savedCriticalAssignments) {
                criticalAssignments = JSON.parse(savedCriticalAssignments);
            }
            
            // Load assignment reasons (swap/skip indicators)
            const savedAssignmentReasons = localStorage.getItem('dutyShiftsAssignmentReasons');
            if (savedAssignmentReasons) {
                try {
                    const parsedRaw = JSON.parse(savedAssignmentReasons);
                    if (parsedRaw && typeof parsedRaw === 'object') {
                        const parsed = parseAssignmentReasonsDocData(parsedRaw);
                        assignmentReasons = parsed.reasons;
                        pendingSpecialDebts = parsed.pendingSpecialDebts;
                    } else {
                        assignmentReasons = {};
                        pendingSpecialDebts = [];
                    }
                } catch (_) {
                    assignmentReasons = {};
                    pendingSpecialDebts = [];
                }
            } else {
                assignmentReasons = {};
                pendingSpecialDebts = [];
            }
            const savedDeferCarry = localStorage.getItem('dutyShiftsManualAlternateDeferCarry');
            if (savedDeferCarry) {
                try {
                    const parsedDefer = JSON.parse(savedDeferCarry);
                    if (parsedDefer && typeof parsedDefer === 'object') {
                        manualAlternateDeferCarry = parsedDefer;
                    }
                } catch (_) { /* ignore */ }
            }
            if (typeof rebuildManualAlternateDeferCarryFromReasons === 'function') {
                rebuildManualAlternateDeferCarryFromReasons();
            }

            applyNormalWeekPairSwapDisabledGroupsFromValue(readNormalWeekPairSwapDisabledGroupsFromLocalStorage());

            const savedMonthLocks = localStorage.getItem('dutyShiftsMonthCalculationLocks');
            monthCalculationLocks = {};
            if (savedMonthLocks) {
                try {
                    const parsed = JSON.parse(savedMonthLocks);
                    if (parsed && typeof parsed === 'object') {
                        for (const k of Object.keys(parsed)) {
                            if (/^\d{4}-\d{2}$/.test(k) && parsed[k]) monthCalculationLocks[k] = true;
                        }
                    }
                } catch (_) {
                    monthCalculationLocks = {};
                }
            }
            
            // Load last rotation positions from localStorage
            const savedLastRotationPositions = localStorage.getItem('dutyShiftsLastRotationPositions');
            if (savedLastRotationPositions) {
                try {
                    const parsed = JSON.parse(savedLastRotationPositions);
                    
                    // Helper function to convert array to object with 1-based keys
                    const convertArrayToObject = (arr) => {
                        if (Array.isArray(arr)) {
                            const obj = {};
                            arr.forEach((value, index) => {
                                obj[index + 1] = value; // Convert 0-based array index to 1-based group number
                            });
                            return obj;
                        }
                        return arr; // Already an object, return as-is
                    };
                    
                    // Normalize both legacy (flat) and new (month-scoped) formats from localStorage
                    const normalizeRotationTypeLocal = (val) => {
                        if (!val || typeof val !== 'object') return {};
                        if (Array.isArray(val)) return convertArrayToObject(val);
                        const keys = Object.keys(val);
                        const hasMonthKeys = keys.some(k => isMonthKey(k));
                        if (hasMonthKeys) {
                            const out = {};
                            for (const mk of keys) {
                                out[mk] = convertArrayToObject(val[mk]);
                            }
                            return out;
                        }
                        return convertArrayToObject(val);
                    };

                    if (parsed.normal) lastRotationPositions.normal = normalizeRotationTypeLocal(parsed.normal);
                    if (parsed.semi) lastRotationPositions.semi = normalizeRotationTypeLocal(parsed.semi);
                    if (parsed.weekend) lastRotationPositions.weekend = normalizeRotationTypeLocal(parsed.weekend);
                    if (parsed.special) lastRotationPositions.special = normalizeRotationTypeLocal(parsed.special);
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
            
            // IMPORTANT: Do not auto-rebuild/restore critical assignments into the schedule.
            // criticalAssignments are kept as history only and must not affect the current calendar.
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

        // Escape text for safe HTML interpolation (prevents breaking markup / XSS in dynamic strings)
        function escapeHtml(value) {
            const s = value === null || value === undefined ? '' : String(value);
            return s
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        // Merge month-organized assignment blocks into an existing Firestore doc without deleting older months.
        // This prevents the "only last calculated month exists" issue when recalculating month-by-month.
        async function mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, docId, monthOrganizedData) {
            if (!db || !user || !docId || !monthOrganizedData) return;
            try {
                const docRef = db.collection('dutyShifts').doc(docId);
                const existingDoc = await docRef.get();
                let existing = {};
                if (existingDoc.exists) {
                    existing = existingDoc.data() || {};
                    delete existing.lastUpdated;
                    delete existing.updatedBy;
                    delete existing._migratedFrom;
                    delete existing._migrationDate;
                }

                // Normalize existing doc into month-organized structure.
                // This prevents mixed formats (flat date keys + month blocks) which can cause missing/duplicate display
                // and can break flattening when flat values are objects.
                const monthKeyRegex = /^[A-Za-z]+\s+\d{4}$/; // e.g. "April 2026"
                const dateKeyRegex = /^\d{4}-\d{2}-\d{2}$/; // e.g. "2026-04-08"

                const normalizedExisting = {};
                for (const key in existing) {
                    const val = existing[key];
                    if (monthKeyRegex.test(key) && val && typeof val === 'object' && !Array.isArray(val)) {
                        normalizedExisting[key] = { ...val };
                        continue;
                    }
                    if (dateKeyRegex.test(key)) {
                        const monthName = getMonthNameFromDateKey(key);
                        if (monthName) {
                            if (!normalizedExisting[monthName]) normalizedExisting[monthName] = {};
                            normalizedExisting[monthName][key] = val;
                        }
                        continue;
                    }
                    // Ignore unknown keys (prevents accidental flattening issues)
                }

                const merged = { ...normalizedExisting };
                for (const monthKey in monthOrganizedData) {
                    const monthVal = monthOrganizedData[monthKey];
                    if (!monthKey || !monthVal || typeof monthVal !== 'object') continue;
                    merged[monthKey] = {
                        ...(merged[monthKey] || {}),
                        ...(monthVal || {})
                    };
                }

                const sanitized = sanitizeForFirestore(merged);
                await docRef.set({
                    ...sanitized,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: user.uid
                });
            } catch (error) {
                console.error(`Error merging/saving ${docId}:`, error);
            }
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
                    for (let gi = 1; gi <= 4; gi++) {
                        syncGroupListArraysFromPriorities(gi);
                    }
                    const sanitizedGroups = sanitizeForFirestore(groups);
                await db.collection('dutyShifts').doc('groups').set({
                        ...sanitizedGroups,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: user.uid
                });
                } catch (error) {
                    console.error('Error saving groups to Firestore:', error);
                }

                try {
                    ensurePersonStatusScheduleSeeded();
                    if (typeof sanitizePersonStatusScheduleEffectiveDates === 'function') {
                        sanitizePersonStatusScheduleEffectiveDates();
                    }
                    const schedPayload = {
                        disabled: personStatusSchedule.disabled || [],
                        membership: personStatusSchedule.membership || [],
                        listOrders: personStatusSchedule.listOrders || [],
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    };
                    await db.collection('dutyShifts').doc('personStatusSchedule').set(schedPayload);
                } catch (error) {
                    console.error('Error saving personStatusSchedule to Firestore:', error);
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

                // Save missing reasons list
                try {
                    const list = Array.isArray(missingReasons) ? missingReasons.filter(Boolean).map(x => String(x).trim()).filter(Boolean) : [];
                    await db.collection('dutyShifts').doc('missingReasons').set({
                        list,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    missingReasonsModified = false;
                } catch (error) {
                    console.error('Error saving missingReasons to Firestore:', error);
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
                    await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'normalDayAssignments', organizedNormal);
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
                    await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'semiNormalAssignments', organizedSemi);
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
                    await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'weekendAssignments', organizedWeekend);
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
                    await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'specialHolidayAssignments', organizedSpecial);
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
                    const sanitizedCritical = sanitizeForFirestore(criticalAssignments);
                await db.collection('dutyShifts').doc('criticalAssignments').set({
                        ...sanitizedCritical,
                    lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                    updatedBy: user.uid
                });
                } catch (error) {
                    console.error('Error saving criticalAssignments to Firestore:', error);
                }
                
                // Save assignment reasons (swap/skip indicators) separately
                try {
                    if (typeof syncPendingSpecialDebtsFromAllSavedData === 'function') {
                        syncPendingSpecialDebtsFromAllSavedData();
                    }
                    console.log('Saving assignmentReasons to Firestore:', Object.keys(assignmentReasons).length, 'dates');
                    if (Object.keys(assignmentReasons).length > 0) {
                        console.log('Sample assignmentReasons being saved:', Object.entries(assignmentReasons).slice(0, 3));
                    }
                    const reasonsPayload = buildAssignmentReasonsSavePayload();
                    const sanitizedReasons = sanitizeForFirestore(reasonsPayload);
                    await db.collection('dutyShifts').doc('assignmentReasons').set({
                        ...sanitizedReasons,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Assignment reasons saved to Firestore successfully');
                } catch (error) {
                    console.error('Error saving assignmentReasons to Firestore:', error);
                }

                // Save month calculation locks (YYYY-MM keys)
                try {
                    const locksOnly = {};
                    for (const k of Object.keys(monthCalculationLocks || {})) {
                        if (/^\d{4}-\d{2}$/.test(k) && monthCalculationLocks[k]) locksOnly[k] = true;
                    }
                    await db.collection('dutyShifts').doc('monthCalculationLocks').set({
                        locks: sanitizeForFirestore(locksOnly),
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                } catch (error) {
                    console.error('Error saving monthCalculationLocks to Firestore:', error);
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

        // Fallback: Save data to localStorage
        function saveDataToLocalStorage() {
            for (let gi = 1; gi <= 4; gi++) {
                syncGroupListArraysFromPriorities(gi);
            }
            localStorage.setItem('dutyShiftsGroups', JSON.stringify(groups));
            localStorage.setItem('dutyShiftsHolidays', JSON.stringify(holidays));
            localStorage.setItem('dutyShiftsSpecialHolidays', JSON.stringify(specialHolidays));
            // Save separate day-type assignments
            localStorage.setItem('dutyShiftsNormalDayAssignments', JSON.stringify(normalDayAssignments));
            localStorage.setItem('dutyShiftsSemiNormalAssignments', JSON.stringify(semiNormalAssignments));
            localStorage.setItem('dutyShiftsWeekendAssignments', JSON.stringify(weekendAssignments));
            localStorage.setItem('dutyShiftsSpecialHolidayAssignments', JSON.stringify(specialHolidayAssignments));
            // Deprecated: do not persist dutyAssignments
            localStorage.setItem('dutyShiftsCriticalAssignments', JSON.stringify(criticalAssignments));
            localStorage.setItem(
                'dutyShiftsAssignmentReasons',
                JSON.stringify(
                    typeof buildAssignmentReasonsSavePayload === 'function'
                        ? buildAssignmentReasonsSavePayload()
                        : { ...assignmentReasons, _manualAlternateDeferCarry: manualAlternateDeferCarry }
                )
            );
            localStorage.setItem('dutyShiftsManualAlternateDeferCarry', JSON.stringify(manualAlternateDeferCarry));
            localStorage.setItem('dutyShiftsLastRotationPositions', JSON.stringify(lastRotationPositions));
            localStorage.setItem('dutyShiftsRankings', JSON.stringify(rankings));
            const locksOnly = {};
            for (const k of Object.keys(monthCalculationLocks || {})) {
                if (/^\d{4}-\d{2}$/.test(k) && monthCalculationLocks[k]) locksOnly[k] = true;
            }
            localStorage.setItem('dutyShiftsMonthCalculationLocks', JSON.stringify(locksOnly));
            try {
                ensurePersonStatusScheduleSeeded();
                if (typeof sanitizePersonStatusScheduleEffectiveDates === 'function') {
                    sanitizePersonStatusScheduleEffectiveDates();
                }
                localStorage.setItem(
                    'dutyShiftsPersonStatusSchedule',
                    JSON.stringify({
                        disabled: personStatusSchedule.disabled || [],
                        membership: personStatusSchedule.membership || [],
                        listOrders: personStatusSchedule.listOrders || []
                    })
                );
            } catch (_) {}
        }

        // Firebase cleanup month picker (multi-select across years)
        let _firebaseCleanupSelectedMonths = new Set();
        let _firebaseCleanupPickerYear = new Date().getFullYear();

        function formatMonthKeyLabelEl(monthKey) {
            const parts = String(monthKey || '').split('-');
            if (parts.length < 2) return monthKey;
            const y = parseInt(parts[0], 10);
            const m = parseInt(parts[1], 10);
            if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return monthKey;
            return new Date(y, m - 1, 1).toLocaleDateString('el-GR', { month: 'long', year: 'numeric' });
        }

        function getFirebaseCleanupGreekMonthNames() {
            const names = [];
            for (let m = 0; m < 12; m++) {
                names.push(new Date(2024, m, 1).toLocaleDateString('el-GR', { month: 'long' }));
            }
            return names;
        }

        function monthKeyFromYearMonth(year, monthIndex) {
            return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
        }

        function updateFirebaseCleanupSelectionSummary() {
            const el = document.getElementById('firebaseCleanupSelectionSummary');
            if (!el) return;
            const keys = Array.from(_firebaseCleanupSelectedMonths).sort();
            if (keys.length === 0) {
                el.innerHTML = '<i class="fas fa-info-circle me-1"></i>Δεν έχει επιλεγεί μήνας.';
                return;
            }
            const labels = keys.map(formatMonthKeyLabelEl);
            const preview = labels.length <= 4
                ? labels.join(', ')
                : labels.slice(0, 3).join(', ') + ` … (+${labels.length - 3} ακόμη)`;
            el.innerHTML = `<i class="fas fa-check-circle me-1"></i><strong>${keys.length}</strong> μήνες: ${preview}`;
        }

        function renderFirebaseCleanupMonthPicker() {
            const yearEl = document.getElementById('firebaseCleanupYear');
            const monthsEl = document.getElementById('firebaseCleanupMonths');
            if (!yearEl || !monthsEl) return;
            yearEl.textContent = String(_firebaseCleanupPickerYear);
            monthsEl.innerHTML = '';
            const greekMonths = getFirebaseCleanupGreekMonthNames();
            greekMonths.forEach((name, index) => {
                const mk = monthKeyFromYearMonth(_firebaseCleanupPickerYear, index);
                const selected = _firebaseCleanupSelectedMonths.has(mk);
                const col = document.createElement('div');
                col.className = 'col-4 col-sm-3';
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = selected ? 'btn btn-danger w-100' : 'btn btn-outline-danger w-100';
                btn.textContent = name;
                btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
                btn.addEventListener('click', () => {
                    if (_firebaseCleanupSelectedMonths.has(mk)) {
                        _firebaseCleanupSelectedMonths.delete(mk);
                    } else {
                        _firebaseCleanupSelectedMonths.add(mk);
                    }
                    renderFirebaseCleanupMonthPicker();
                });
                col.appendChild(btn);
                monthsEl.appendChild(col);
            });
            updateFirebaseCleanupSelectionSummary();
        }

        function openFirebaseCleanupMonthPicker() {
            const modalEl = document.getElementById('firebaseCleanupMonthModal');
            if (!modalEl) return;
            _firebaseCleanupSelectedMonths = new Set();
            _firebaseCleanupPickerYear = (currentDate instanceof Date && !isNaN(currentDate.getTime()))
                ? currentDate.getFullYear()
                : new Date().getFullYear();

            const prevBtn = document.getElementById('firebaseCleanupPrevYear');
            const nextBtn = document.getElementById('firebaseCleanupNextYear');
            const selectAllBtn = document.getElementById('firebaseCleanupSelectAllYear');
            const clearBtn = document.getElementById('firebaseCleanupClearSelection');
            const confirmBtn = document.getElementById('firebaseCleanupConfirmBtn');

            if (prevBtn) {
                prevBtn.onclick = () => {
                    _firebaseCleanupPickerYear--;
                    renderFirebaseCleanupMonthPicker();
                };
            }
            if (nextBtn) {
                nextBtn.onclick = () => {
                    _firebaseCleanupPickerYear++;
                    renderFirebaseCleanupMonthPicker();
                };
            }
            if (selectAllBtn) {
                selectAllBtn.onclick = () => {
                    for (let m = 0; m < 12; m++) {
                        _firebaseCleanupSelectedMonths.add(monthKeyFromYearMonth(_firebaseCleanupPickerYear, m));
                    }
                    renderFirebaseCleanupMonthPicker();
                };
            }
            if (clearBtn) {
                clearBtn.onclick = () => {
                    _firebaseCleanupSelectedMonths.clear();
                    renderFirebaseCleanupMonthPicker();
                };
            }
            if (confirmBtn) {
                confirmBtn.onclick = () => {
                    void confirmFirebaseCleanupSelectedMonths();
                };
            }

            renderFirebaseCleanupMonthPicker();
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
        }

        async function stripTempAssignmentsFirestoreMonths(db, user, monthKeys) {
            if (!db || !user || !Array.isArray(monthKeys) || monthKeys.length === 0) return;
            const prefixSet = new Set(monthKeys);
            const snap = await db.collection('dutyShifts').doc('tempAssignments').get();
            if (!snap.exists) return;
            const data = snap.data() || {};
            delete data.lastUpdated;
            delete data.updatedBy;
            const out = { ...data };
            const dateInMonths = (dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk) && prefixSet.has(dk.substring(0, 7));
            for (const cat of ['normal', 'semi', 'weekend']) {
                if (!out[cat] || typeof out[cat] !== 'object') continue;
                const next = { ...out[cat] };
                for (const dk of Object.keys(next)) {
                    if (dateInMonths(dk)) delete next[dk];
                }
                out[cat] = next;
            }
            if (out.special && typeof out.special === 'object') {
                const next = { ...out.special };
                for (const k of Object.keys(next)) {
                    if (prefixSet.has(k)) delete next[k];
                }
                out.special = next;
            }
            const ts = firebase.firestore.FieldValue.serverTimestamp();
            const sanitized = sanitizeForFirestore(out);
            await db.collection('dutyShifts').doc('tempAssignments').set({
                ...sanitized,
                lastUpdated: ts,
                updatedBy: user.uid
            });
        }

        /** Delete duty data in Firestore + memory for selected YYYY-MM month keys (all groups). */
        async function clearDutyShiftsFirestoreDocsForMonths(monthKeys) {
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
            const keys = Array.isArray(monthKeys) ? [...new Set(monthKeys.filter((k) => /^\d{4}-\d{2}$/.test(k)))] : [];
            if (keys.length === 0) {
                alert('Επιλέξτε τουλάχιστον έναν μήνα.');
                return;
            }

            const labels = keys.map(formatMonthKeyLabelEl);
            const confirmText =
                'ΠΡΟΣΟΧΗ: Θα διαγραφούν ΟΛΕΣ οι υπηρεσίες για:\n\n' +
                labels.map((l) => '• ' + l).join('\n') +
                '\n\n(αναθέσεις, baseline, αιτίες, θέσεις περιστροφής — όλες οι ομάδες)\n\n' +
                'Δεν αλλάζουν ομάδες, λίστες, αργίες ή ιεραρχίες.\n\nΣυνέχεια;';
            if (!confirm(confirmText)) return;

            const loadingAlert = document.createElement('div');
            loadingAlert.className = 'alert alert-warning position-fixed top-50 start-50 translate-middle';
            loadingAlert.style.zIndex = '9999';
            loadingAlert.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Καθαρισμός υπηρεσιών...';
            document.body.appendChild(loadingAlert);

            try {
                if (typeof deleteSelectedMonthsFromDutyDocs === 'function') {
                    await deleteSelectedMonthsFromDutyDocs(db, user, keys, []);
                }
                await stripTempAssignmentsFirestoreMonths(db, user, keys);

                if (typeof clearSelectedMonthsInMemory === 'function') {
                    clearSelectedMonthsInMemory(keys, []);
                }

                const prefixSet = new Set(keys);
                const dateKeyInRange = (dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk) && prefixSet.has(dk.substring(0, 7));
                for (const dk of Object.keys(criticalAssignments || {})) {
                    if (dateKeyInRange(dk)) delete criticalAssignments[dk];
                }
                for (const dk of Object.keys(dutyAssignments || {})) {
                    if (dateKeyInRange(dk)) delete dutyAssignments[dk];
                }
                if (calculationSteps && calculationSteps.tempAssignments) {
                    calculationSteps.tempAssignments = null;
                }

                saveDataToLocalStorage();
                renderCalendar();
                updateStatistics();

                if (loadingAlert.parentNode) loadingAlert.parentNode.removeChild(loadingAlert);
                const modalEl = document.getElementById('firebaseCleanupMonthModal');
                if (modalEl) {
                    const m = bootstrap.Modal.getInstance(modalEl);
                    if (m) m.hide();
                }
                const infoTitle = document.getElementById('infoMessageModalTitleText');
                const infoBody = document.getElementById('infoMessageModalBody');
                if (infoTitle) infoTitle.textContent = 'Καθαρισμός Firebase';
                if (infoBody) {
                    infoBody.textContent = `Ο καθαρισμός ολοκληρώθηκε για ${keys.length} μήνα/ες.`;
                }
                bootstrap.Modal.getOrCreateInstance(document.getElementById('infoMessageModal')).show();
            } catch (error) {
                console.error('Error clearing duty months:', error);
                if (loadingAlert.parentNode) loadingAlert.parentNode.removeChild(loadingAlert);
                const infoTitle = document.getElementById('infoMessageModalTitleText');
                const infoBody = document.getElementById('infoMessageModalBody');
                if (infoTitle) infoTitle.textContent = 'Σφάλμα';
                if (infoBody) infoBody.textContent = 'Σφάλμα κατά τον καθαρισμό: ' + (error?.message || error);
                bootstrap.Modal.getOrCreateInstance(document.getElementById('infoMessageModal')).show();
            }
        }

        async function confirmFirebaseCleanupSelectedMonths() {
            const monthKeys = Array.from(_firebaseCleanupSelectedMonths).sort();
            if (monthKeys.length === 0) {
                alert('Επιλέξτε τουλάχιστον έναν μήνα.');
                return;
            }
            await clearDutyShiftsFirestoreDocsForMonths(monthKeys);
        }

        /** @deprecated Use openFirebaseCleanupMonthPicker — opens month selector. */
        function clearDutyShiftsFirestoreDocs() {
            openFirebaseCleanupMonthPicker();
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
                1: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {}, disabledPersons: {} },
                2: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {}, disabledPersons: {} },
                3: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {}, disabledPersons: {} },
                4: { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {}, disabledPersons: {} }
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
                    if (data[i].disabledPersons) migrated[i].disabledPersons = data[i].disabledPersons;
                } else if (data[i] && typeof data[i] === 'object') {
                    // ALWAYS preserve lastDuties, missingPeriods, and priorities if they exist
                    if (data[i].lastDuties) migrated[i].lastDuties = data[i].lastDuties;
                    if (data[i].missingPeriods) migrated[i].missingPeriods = data[i].missingPeriods;
                    if (data[i].priorities) migrated[i].priorities = data[i].priorities;
                    if (data[i].disabledPersons) migrated[i].disabledPersons = data[i].disabledPersons;
                    
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
                    if (data[i].disabledPersons) migrated[i].disabledPersons = data[i].disabledPersons;
                }
            }
            
            return migrated;
        }

        // Helper function to track which lists are currently open

        // Helper function to restore open lists after renderGroups

        // Render groups - shows 4 separate order lists per group
        // preserveOpenLists: if true, preserves currently open lists
        // forceOpenLists: array of list IDs that should be opened after render
        const groupListRenderRegistry = new Map(); // containerId -> { groupNum, type, list }


        // Helper function to get last duty date and calculate next duty date based on rotation order

        // Create person item with reorder controls

        // Drag and drop handlers
        let draggedElement = null;
        let dragOverElement = null;
        
        
        
        
        
        

        // Global variable to track if we're editing
        let isEditingPerson = false;
        let editingPersonName = null;
        
        // Global variables for person actions modal
        let currentPersonActionsGroup = null;
        let currentPersonActionsName = null;
        let currentPersonActionsIndex = null;
        let currentPersonActionsListType = null;
        
        // Pending "transfer to group" selection (from actions modal)
        let pendingTransferTargetGroup = null;

        // Add person

        // Edit person

        // Save person - adds to all 4 lists and stores last duty dates

        // Open person actions modal



        // Open modal to view and manage all missing/disabled people
        
        // Edit person status (opens disable settings for disabled people, missing period modal for missing people)




        // Short (single-label) reason to display in UI when someone is unavailable.
        // User preference:
        // - Disabled => "Απενεργοποιημένος"
        // - Missing period => the selected reason (e.g. "Κανονική Άδεια"), otherwise "Κώλυμα/Απουσία"


        // Normalize legacy/odd skip-reason strings for DISABLED persons so UI always shows:
        // "επειδή ήταν Απενεργοποιημένος ..." (and not "είχε Κώλυμα/Απουσία ... (Απενεργοποιημένος)")

        // Normalize legacy swap-reason strings so UI always shows the canonical:
        // "Έγινε η αλλαγή γιατι ο/η X είχε σύγκρουση ..., και ανατέθηκε ...".
        
        // Open edit person from actions modal
        
        // Open missing period modal from actions
        
        // Open transfer modal from actions

        // Open modal to select destination group (better UX than prompt())


        
        // Delete person from actions modal

        // Get all unique people across all groups

        // Get group number for a person (returns first group found)

        // Get person details (groupNum, index, listType) - returns first match found

        // Filter people search dropdown - shows all people initially, filters as you type

        // Show people search dropdown - always shows all people when focused

        // Hide people search dropdown

        // Select person from search dropdown and open actions modal

        // Handle keyboard events in person search

        // Open rankings management modal

        // Drag and drop variables for rankings
        let draggedRankingItem = null;
        let rankingScrollInterval = null;
        let currentMouseY = 0;
        // Track an in-progress manual ranking edit so we can safely commit it before saving
        let activeRankingEdit = null;











        // Edit ranking manually by clicking on person's name

        // Save rankings to Firestore




        // Remove person from specific list

        // Move person up or down in list

        // Toggle transfer dropdown

        // Global variables for transfer
        let transferData = {
            person: null,
            fromGroup: null,
            toGroup: null,
            lastDuties: null,
            missingPeriods: null,
            positions: {}, // { listType: { referencePerson: string, position: 'above'|'below'|'end' } }
            auto: null // { year, month, matchesByType, chosenByType, ranksByType }
        };

        // Undo support for last group transfer
        let lastTransferUndo = null; // { person, fromGroup, toGroup, fromSnapshot, toSnapshot, createdAt }

        function deepClonePlain(obj) {
            if (!obj) return obj;
            if (typeof structuredClone === 'function') {
                try { return structuredClone(obj); } catch (_) {}
            }
            return JSON.parse(JSON.stringify(obj));
        }

        function ensureTransferUndoToastExists() {
            if (document.getElementById('transferUndoToast')) return;
            const html = `
                <div class="toast-container position-fixed bottom-0 end-0 p-3" style="z-index: 11000;">
                    <div id="transferUndoToast" class="toast align-items-center text-bg-dark border-0" role="alert" aria-live="assertive" aria-atomic="true">
                        <div class="d-flex">
                            <div class="toast-body" id="transferUndoToastBody">Έγινε μεταφορά.</div>
                            <div class="d-flex align-items-center gap-2 me-2">
                                <button type="button" class="btn btn-sm btn-warning" id="transferUndoToastButton">Αναίρεση</button>
                                <button type="button" class="btn-close btn-close-white me-1 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', html);
        }

        function showTransferUndoToast() {
            if (!lastTransferUndo) return;
            ensureTransferUndoToastExists();
            const toastEl = document.getElementById('transferUndoToast');
            const bodyEl = document.getElementById('transferUndoToastBody');
            const btnEl = document.getElementById('transferUndoToastButton');
            if (!toastEl || !bodyEl || !btnEl) return;

            const p = lastTransferUndo.person || '';
            const fromName = getGroupName(lastTransferUndo.fromGroup);
            const toName = getGroupName(lastTransferUndo.toGroup);
            bodyEl.innerHTML = `<strong>Μεταφορά:</strong> ${p}<br><small class="text-white-50">${fromName} → ${toName}</small>`;

            // Re-bind click handler each time (safe)
            const newBtn = btnEl.cloneNode(true);
            btnEl.parentNode.replaceChild(newBtn, btnEl);
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                undoLastGroupTransfer();
                const toast = bootstrap.Toast.getInstance(toastEl) || new bootstrap.Toast(toastEl);
                toast.hide();
            });

            // Keep visible until user clicks Undo or closes it.
            const toast = bootstrap.Toast.getInstance(toastEl) || new bootstrap.Toast(toastEl, { autohide: false });
            toast.show();
        }

        function undoLastGroupTransfer() {
            if (!lastTransferUndo) {
                alert('Δεν υπάρχει μεταφορά για αναίρεση.');
                return;
            }
            const { fromGroup, toGroup, fromSnapshot, toSnapshot } = lastTransferUndo;
            if (!fromSnapshot || !toSnapshot) {
                alert('Δεν υπάρχουν αποθηκευμένα δεδομένα για αναίρεση.');
                return;
            }
            groups[fromGroup] = deepClonePlain(fromSnapshot);
            groups[toGroup] = deepClonePlain(toSnapshot);
            saveData();
            renderGroups();
            updateStatistics();
            lastTransferUndo = null;
        }

        // Transfer person to another group - opens positioning modal

        // Open transfer position modal


        // Prefer rotation baseline assignments (pure rotation) when available.
        // Falls back to final assignments for that date.
        function getRotationBaselineAssignmentForDate(dateKey) {
            try {
                const d = new Date(dateKey + 'T00:00:00');
                if (isNaN(d.getTime())) return null;
                const cat = getDayTypeCategoryFromDayType(getDayType(d));
                if (cat === 'special') return rotationBaselineSpecialAssignments?.[dateKey] || null;
                if (cat === 'weekend') return rotationBaselineWeekendAssignments?.[dateKey] || null;
                if (cat === 'semi') return rotationBaselineSemiAssignments?.[dateKey] || null;
                return rotationBaselineNormalAssignments?.[dateKey] || null;
            } catch (_) {
                return null;
            }
        }

        // criticalAssignments is stored as: { "YYYY-MM-DD": ["Name (Ομάδα 1)", "Name (Ομάδα 2)", ...], ... }
        // Use it as a last-resort source for same-day matching during group transfer auto-positioning.
        function getCriticalAssignmentForDate(dateKey) {
            const v = criticalAssignments?.[dateKey];
            if (!v) return null;
            if (typeof v === 'string') return v;
            if (Array.isArray(v)) return v.filter(Boolean).join(', ');
            return null;
        }

        function parseAssignedPersonForGroupFromAssignment(assignmentStr, groupNum) {
            if (!assignmentStr) return null;
            const parts = String(assignmentStr).split(',').map(p => p.trim()).filter(Boolean);
            for (const part of parts) {
                const m = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                if (m && parseInt(m[2], 10) === groupNum) return m[1].trim();
            }
            return null;
        }

        /** Duty category string for a date key: special | weekend | semi | normal (matches getAssignmentForDate routing). */
        function getDutyCategoryForDateKey(dateKey) {
            const d = new Date(dateKey + 'T00:00:00');
            if (isNaN(d.getTime())) return 'normal';
            const dayType = getDayType(d);
            if (typeof isSpecialHoliday === 'function' && isSpecialHoliday(d)) return 'special';
            if (dayType === 'special-holiday') return 'special';
            if (dayType === 'weekend-holiday') return 'weekend';
            if (dayType === 'semi-normal-day') return 'semi';
            return 'normal';
        }

        /**
         * Find another calendar day (same duty category store) where personName is assigned for groupNum.
         * Excludes excludeDateKey (the day being edited).
         * Only searches the same calendar month (YYYY-MM) as excludeDateKey so mutual swap from the day modal
         * does not pair with an old duty (e.g. February) when editing April.
         */
        function findOtherDateKeyForPersonInGroupDutyCategory(personName, groupNum, excludeDateKey, dayTypeCategory) {
            if (!personName || !Number.isFinite(groupNum) || groupNum < 1) return null;
            const map = getAssignmentsForDayType(dayTypeCategory);
            if (!map || typeof map !== 'object') return null;
            const norm = (s) => (typeof normalizePersonKey === 'function' ? normalizePersonKey(s) : String(s || '').trim());
            const target = norm(personName);
            const monthPrefix =
                excludeDateKey && /^\d{4}-\d{2}-\d{2}$/.test(String(excludeDateKey))
                    ? String(excludeDateKey).substring(0, 7)
                    : null;
            let keys = Object.keys(map).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
            if (monthPrefix) {
                keys = keys.filter((k) => k.startsWith(monthPrefix + '-'));
            }
            keys.sort();
            const matches = [];
            for (const dk of keys) {
                if (dk === excludeDateKey) continue;
                const raw = typeof getAssignmentForDate === 'function' ? getAssignmentForDate(dk) : null;
                if (!raw) continue;
                const str = typeof raw === 'string' ? raw : String(raw);
                const assigned = parseAssignedPersonForGroupFromAssignment(str, groupNum);
                if (assigned && norm(assigned) === target) matches.push(dk);
            }
            if (matches.length === 0) return null;
            if (matches.length === 1) return matches[0];
            const t0 = new Date(excludeDateKey + 'T00:00:00').getTime();
            if (isNaN(t0)) return matches[0];
            matches.sort(
                (a, b) =>
                    Math.abs(new Date(a + 'T00:00:00').getTime() - t0) -
                    Math.abs(new Date(b + 'T00:00:00').getTime() - t0)
            );
            return matches[0];
        }

        /** Build canonical assignment string from group → name map (groups 1–4 in order). */
        function groupMapToAssignmentString(map) {
            const parts = [];
            for (let g = 1; g <= 4; g++) {
                const nm = map && map[g];
                if (nm != null && String(nm).trim()) {
                    parts.push(`${String(nm).trim()} (Ομάδα ${g})`);
                }
            }
            return parts.join(', ');
        }

        /**
         * Replace who holds groupNum using a parsed group map (handles object-shaped assignments and odd spacing).
         * Omits the group slot if newPersonName is empty.
         */
        function replaceAssignedPersonForGroupInAssignmentString(assignmentStr, groupNum, newPersonName) {
            const g = Number.isFinite(groupNum) ? groupNum : parseInt(groupNum, 10);
            if (!Number.isFinite(g) || g < 1 || g > 4) {
                return groupMapToAssignmentString(extractGroupAssignmentsMap(assignmentStr));
            }
            const map = extractGroupAssignmentsMap(assignmentStr);
            if (newPersonName != null && String(newPersonName).trim()) {
                map[g] = String(newPersonName).trim();
            } else {
                delete map[g];
            }
            return groupMapToAssignmentString(map);
        }

        /** True if this person+group is a locked critical (Απόβαση) assignment on that date. */
        function isPersonGroupCriticalAssignment(dateKey, personName, groupNum) {
            const list = criticalAssignments?.[dateKey];
            if (!Array.isArray(list) || !personName || !Number.isFinite(groupNum)) return false;
            const n = typeof normalizePersonKey === 'function' ? normalizePersonKey(personName) : String(personName || '').trim();
            for (const entry of list) {
                const m = String(entry).match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                if (m && parseInt(m[2], 10) === groupNum) {
                    const name = m[1].trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '');
                    const nn = typeof normalizePersonKey === 'function' ? normalizePersonKey(name) : name.trim();
                    if (nn === n) return true;
                }
            }
            return false;
        }

        // Helper: normalize an "assignment" value to a { groupNum -> personName } map.
        // Supports:
        // - string: "Name (Ομάδα 1), Name (Ομάδα 2)..."
        // - array: ["Name (Ομάδα 1)", ...]
        // - object: { "1": "Name", "2": "Name" } or { 1: "Name", ... }
        function extractGroupAssignmentsMap(assignment) {
            const out = {};
            if (!assignment) return out;

            if (typeof assignment === 'object' && !Array.isArray(assignment)) {
                for (const k of Object.keys(assignment)) {
                    const g = parseInt(k, 10);
                    if (!(g >= 1 && g <= 4)) continue;
                    const v = assignment[k];
                    if (typeof v === 'string' && v.trim()) out[g] = v.trim();
                }
                return out;
            }

            const str = Array.isArray(assignment)
                ? assignment.filter(Boolean).join(', ')
                : String(assignment);

            const parts = str.split(',').map(p => p.trim()).filter(Boolean);
            for (const part of parts) {
                const m = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                if (!m) continue;
                const person = m[1].trim();
                const g = parseInt(m[2], 10);
                if (person && g >= 1 && g <= 4) out[g] = person;
            }
            return out;
        }

        /** Reasons from day modal, mutual swap, αντικατάσταση επιλαχών, or baseline-preserving manual assign — do not overwrite on month recalc. */
        function isProtectedManualDutyReasonEntry(r) {
            return !!(
                r &&
                r.meta &&
                (r.meta.manualDayModal ||
                    r.meta.manualAlternateReplacement ||
                    r.meta.mutualTwoDaySwap ||
                    r.meta.preserveBaseline)
            );
        }

        function hasProtectedManualDutyReasonOnDateGroup(dateKey, groupNum) {
            const gmap = assignmentReasons?.[dateKey]?.[groupNum];
            if (!gmap || typeof gmap !== 'object') return false;
            for (const pk in gmap) {
                if (isProtectedManualDutyReasonEntry(gmap[pk])) return true;
            }
            return false;
        }

        function _monthKeySetFromRangeArray(monthKeys) {
            return new Set(Array.isArray(monthKeys) ? monthKeys : []);
        }

        /**
         * Capture assigned persons + reason fragments for dates/groups with protected manual reasons.
         * Includes mutual two-day swap partner dates even if outside the selected month range.
         */
        function captureManualDutyProtectionSnapshot(startDate, endDate) {
            const snapshot = { slots: {}, reasonsFragments: {} };
            if (!startDate || !endDate) return snapshot;

            const collectDate = (dk) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) return;
                for (let g = 1; g <= 4; g++) {
                    if (!hasProtectedManualDutyReasonOnDateGroup(dk, g)) continue;
                    if (!snapshot.slots[dk]) snapshot.slots[dk] = {};
                    const str = typeof getAssignmentForDate === 'function' ? getAssignmentForDate(dk) : null;
                    const person = typeof parseAssignedPersonForGroupFromAssignment === 'function'
                        ? parseAssignedPersonForGroupFromAssignment(str, g)
                        : null;
                    if (person) snapshot.slots[dk][g] = person;
                    if (!snapshot.reasonsFragments[dk]) snapshot.reasonsFragments[dk] = {};
                    const srcG = assignmentReasons?.[dk]?.[g];
                    if (srcG && typeof srcG === 'object') {
                        try {
                            snapshot.reasonsFragments[dk][g] = JSON.parse(JSON.stringify(srcG));
                        } catch (_) {
                            snapshot.reasonsFragments[dk][g] = srcG;
                        }
                    }
                }
            };

            const di = new Date(startDate);
            while (di <= endDate) {
                collectDate(formatDateKey(di));
                di.setDate(di.getDate() + 1);
            }

            const pending = [];
            for (const dk of Object.keys(snapshot.reasonsFragments)) {
                const frag = snapshot.reasonsFragments[dk];
                for (const gn of Object.keys(frag)) {
                    const gmap = frag[gn];
                    if (!gmap || typeof gmap !== 'object') continue;
                    for (const pk in gmap) {
                        const r = gmap[pk];
                        const other = r?.meta?.otherDateKey;
                        if (r?.meta?.mutualTwoDaySwap && other && /^\d{4}-\d{2}-\d{2}$/.test(String(other))) {
                            pending.push(String(other));
                        }
                    }
                }
            }
            for (const otherDk of [...new Set(pending)]) {
                collectDate(otherDk);
            }

            return snapshot;
        }

        /** Restore reasons only for dates in cleared months (after clearSelectedMonthsInMemory). stripGroupNums: skip these groups (pure rotation for them). */
        function restoreManualDutyProtectionReasonsAfterClear(snapshot, monthKeysForRange, stripGroupNums) {
            if (!snapshot?.reasonsFragments) return;
            const stripSet = _stripOverrideGroupSetFromArray(stripGroupNums);
            const clearedMonths = _monthKeySetFromRangeArray(monthKeysForRange);
            for (const dk of Object.keys(snapshot.reasonsFragments)) {
                const mk = dk.substring(0, 7);
                if (clearedMonths.size > 0 && !clearedMonths.has(mk)) continue;
                const frag = snapshot.reasonsFragments[dk];
                if (!assignmentReasons[dk]) assignmentReasons[dk] = {};
                for (const gStr of Object.keys(frag)) {
                    const gNum = parseInt(gStr, 10);
                    if (stripSet && stripSet.has(gNum)) continue;
                    try {
                        assignmentReasons[dk][gStr] = JSON.parse(JSON.stringify(frag[gStr]));
                    } catch (_) {
                        assignmentReasons[dk][gStr] = frag[gStr];
                    }
                }
            }
        }

        /** Re-apply protected reason rows at end of execute (preview may have touched assignmentReasons). */
        function mergeManualDutyProtectionReasonsFinal(snapshot, stripGroupNums) {
            if (!snapshot?.reasonsFragments) return;
            const stripSet = _stripOverrideGroupSetFromArray(stripGroupNums);
            for (const dk of Object.keys(snapshot.reasonsFragments)) {
                const frag = snapshot.reasonsFragments[dk];
                if (!assignmentReasons[dk]) assignmentReasons[dk] = {};
                for (const gStr of Object.keys(frag)) {
                    const gNum = parseInt(gStr, 10);
                    if (stripSet && stripSet.has(gNum)) continue;
                    try {
                        assignmentReasons[dk][gStr] = JSON.parse(JSON.stringify(frag[gStr]));
                    } catch (_) {
                        assignmentReasons[dk][gStr] = frag[gStr];
                    }
                }
            }
        }

        /** Merge protected group slots over calculated assignments for each affected date. */
        function applyManualDutyProtectionAssignmentOverlay(snapshot, stripGroupNums) {
            if (!snapshot?.slots) return;
            const stripSet = _stripOverrideGroupSetFromArray(stripGroupNums);
            for (const dk of Object.keys(snapshot.slots)) {
                const prot = snapshot.slots[dk];
                const curStr = typeof getAssignmentForDate === 'function' ? (getAssignmentForDate(dk) || '') : '';
                const map = typeof extractGroupAssignmentsMap === 'function' ? extractGroupAssignmentsMap(curStr) : {};
                for (const gStr of Object.keys(prot)) {
                    const g = parseInt(gStr, 10);
                    if (stripSet && stripSet.has(g)) continue;
                    const person = prot[gStr];
                    if (person && g >= 1 && g <= 4) map[g] = String(person).trim();
                }
                const newStr = typeof groupMapToAssignmentString === 'function' ? groupMapToAssignmentString(map) : '';
                if (newStr && typeof setAssignmentForDate === 'function') {
                    setAssignmentForDate(dk, newStr);
                }
            }
        }

        // Transfer auto-positioning reference date selection (per duty type):
        // 1) Find the LAST date in the reference month where Person A appears in the *baseline rotation* (for that duty type).
        // 2) If none, search previous months (month-by-month backwards) for the most recent baseline date.
        // 3) If still none, search criticalAssignments history.
        //
        // Then, on that same dateKey, find Person B for the destination group (baseline -> final -> critical) and use rankings to place A.


        // Apply auto positions to transferData.positions (only if not already explicitly set).


        // Render positioning lists for transfer

        // Set transfer position for a list type

        // Complete the transfer with selected positions

        // Close dropdowns when clicking outside
        document.addEventListener('click', function(event) {
            if (!event.target.closest('.transfer-dropdown')) {
                document.querySelectorAll('.transfer-dropdown-content').forEach(dropdown => {
                    dropdown.classList.remove('show');
                });
            }
        });

        // Add holiday

        // Save holiday

        // Remove holiday

        // Render holidays

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

        // Add special holiday

        // Save special holiday

        // Remove special holiday (kept for backward compatibility, but not used in UI)

        // Toggle recurring holiday fields based on type

        // Render recurring holidays configuration

        // Add recurring holiday

        // Save recurring holiday

        // Remove recurring holiday

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

        // Convert month key (YYYY-MM) to month name (e.g., "December 2026") for matching Firestore month-organized keys
        function getMonthNameFromMonthKey(monthKey) {
            try {
                const [year, month] = monthKey.split('-').map(Number);
                if (!year || !month || month < 1 || month > 12) return null;
                const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                    'July', 'August', 'September', 'October', 'November', 'December'];
                return `${monthNames[month - 1]} ${year}`;
            } catch (error) {
                return null;
            }
        }

        // Delete/clear selected month(s). If groupNums (1–4) provided, only those groups are removed; other groups stay.
        async function deleteSelectedMonthsFromDutyDocs(db, user, monthKeys, groupNums) {
            if (!db || !user || !Array.isArray(monthKeys) || monthKeys.length === 0) return;
            const monthKeyRegex = /^[A-Za-z]+\s+\d{4}$/;
            const dateKeyRegex = /^\d{4}-\d{2}-\d{2}$/;
            const monthNamesToDelete = new Set(monthKeys.map(mk => getMonthNameFromMonthKey(mk)).filter(Boolean));
            const monthKeySet = new Set(monthKeys);
            const groupSet = _stripOverrideGroupSetFromArray(groupNums);
            const dutyShifts = db.collection('dutyShifts');

            const monthOrganizedDocIds = [
                'specialHolidayAssignments',
                'weekendAssignments',
                'semiNormalAssignments',
                'normalDayAssignments',
                'rotationBaselineSpecialAssignments',
                'rotationBaselineWeekendAssignments',
                'rotationBaselineSemiAssignments',
                'rotationBaselineNormalAssignments'
            ];

            const docIdsToRead = [...monthOrganizedDocIds, 'assignmentReasons', 'lastRotationPositions'];
            const snaps = await Promise.all(docIdsToRead.map(id => dutyShifts.doc(id).get()));

            const writePromises = [];
            const ts = firebase.firestore.FieldValue.serverTimestamp();
            const meta = { lastUpdated: ts, updatedBy: user.uid };

            monthOrganizedDocIds.forEach((docId, i) => {
                const snap = snaps[i];
                if (!snap || !snap.exists) return;
                try {
                    const data = snap.data() || {};
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    delete data._migratedFrom;
                    delete data._migrationDate;
                    const normalized = {};
                    for (const key in data) {
                        const val = data[key];
                        if (monthKeyRegex.test(key) && val && typeof val === 'object' && !Array.isArray(val)) {
                            if (!monthNamesToDelete.has(key)) {
                                normalized[key] = { ...val };
                                continue;
                            }
                            if (!groupSet) continue;
                            const monthBlock = { ...val };
                            for (const dk in monthBlock) {
                                if (!dateKeyRegex.test(dk) || !monthKeySet.has(dk.substring(0, 7))) continue;
                                const stripped = removeGroupsFromAssignmentValue(monthBlock[dk], groupSet);
                                if (stripped !== undefined) monthBlock[dk] = stripped;
                                else delete monthBlock[dk];
                            }
                            if (Object.keys(monthBlock).length > 0) normalized[key] = monthBlock;
                            continue;
                        }
                        if (dateKeyRegex.test(key)) {
                            const monthName = getMonthNameFromDateKey(key);
                            const mk = key.substring(0, 7);
                            if (monthName && monthNamesToDelete.has(monthName) && monthKeySet.has(mk)) {
                                if (!groupSet) continue;
                                if (!normalized[monthName]) normalized[monthName] = {};
                                const stripped = removeGroupsFromAssignmentValue(val, groupSet);
                                if (stripped !== undefined) normalized[monthName][key] = stripped;
                            } else if (monthName && !monthNamesToDelete.has(monthName)) {
                                if (!normalized[monthName]) normalized[monthName] = {};
                                normalized[monthName][key] = val;
                            }
                            continue;
                        }
                    }
                    const sanitized = sanitizeForFirestore(normalized);
                    writePromises.push(dutyShifts.doc(docId).set({ ...sanitized, ...meta }));
                } catch (err) {
                    console.error(`Error preparing delete for ${docId}:`, err);
                }
            });

            const assignmentReasonsSnap = snaps[monthOrganizedDocIds.length];
            if (assignmentReasonsSnap && assignmentReasonsSnap.exists) {
                try {
                    const data = assignmentReasonsSnap.data() || {};
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    const filtered = {};
                    for (const key in data) {
                        if (dateKeyRegex.test(key)) {
                            const mk = key.substring(0, 7);
                            if (monthKeySet.has(mk)) {
                                if (!groupSet) continue;
                                const frag = data[key];
                                if (!frag || typeof frag !== 'object') continue;
                                const outFrag = {};
                                for (const gStr of Object.keys(frag)) {
                                    const gNum = parseInt(gStr, 10);
                                    if (groupSet.has(gNum)) continue;
                                    outFrag[gStr] = frag[gStr];
                                }
                                if (Object.keys(outFrag).length > 0) filtered[key] = outFrag;
                                continue;
                            }
                        }
                        filtered[key] = data[key];
                    }
                    const sanitized = sanitizeForFirestore(filtered);
                    writePromises.push(dutyShifts.doc('assignmentReasons').set({ ...sanitized, ...meta }));
                } catch (err) {
                    console.error('Error preparing delete for assignmentReasons:', err);
                }
            }

            const lastRotSnap = snaps[docIdsToRead.length - 1];
            if (lastRotSnap && lastRotSnap.exists) {
                try {
                    const data = lastRotSnap.data() || {};
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    const out = { normal: {}, semi: {}, weekend: {}, special: {} };
                    for (const dayType of ['normal', 'semi', 'weekend', 'special']) {
                        const byType = data[dayType];
                        if (!byType || typeof byType !== 'object') continue;
                        for (const k in byType) {
                            if (!monthKeySet.has(k)) {
                                out[dayType][k] = byType[k];
                                continue;
                            }
                            if (!groupSet) continue;
                            const block = byType[k];
                            if (block && typeof block === 'object' && !Array.isArray(block)) {
                                const copy = { ...block };
                                for (const g of groupSet) {
                                    delete copy[g];
                                    delete copy[String(g)];
                                }
                                if (Object.keys(copy).length > 0) out[dayType][k] = copy;
                            }
                        }
                    }
                    const sanitized = sanitizeForFirestore(out);
                    writePromises.push(dutyShifts.doc('lastRotationPositions').set({ ...sanitized, ...meta }));
                } catch (err) {
                    console.error('Error preparing delete for lastRotationPositions:', err);
                }
            }

            if (writePromises.length > 0) {
                await Promise.all(writePromises);
            }
        }

        function clearSelectedMonthsInMemory(monthKeys, groupNums) {
            if (!Array.isArray(monthKeys) || monthKeys.length === 0) return;
            const prefixSet = new Set(monthKeys);
            const groupSet = _stripOverrideGroupSetFromArray(groupNums);
            const dateKeyInRange = (dateKey) => {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
                return prefixSet.has(dateKey.substring(0, 7));
            };
            const stripFromStore = (obj) => {
                if (!obj || typeof obj !== 'object') return;
                for (const key of Object.keys(obj)) {
                    if (!dateKeyInRange(key)) continue;
                    if (!groupSet) {
                        delete obj[key];
                        continue;
                    }
                    const stripped = removeGroupsFromAssignmentValue(obj[key], groupSet);
                    if (stripped !== undefined) obj[key] = stripped;
                    else delete obj[key];
                }
            };
            stripFromStore(specialHolidayAssignments);
            stripFromStore(weekendAssignments);
            stripFromStore(semiNormalAssignments);
            stripFromStore(normalDayAssignments);
            stripFromStore(rotationBaselineSpecialAssignments);
            stripFromStore(rotationBaselineWeekendAssignments);
            stripFromStore(rotationBaselineSemiAssignments);
            stripFromStore(rotationBaselineNormalAssignments);
            if (!groupSet) {
                for (const key of Object.keys(assignmentReasons || {})) {
                    if (dateKeyInRange(key)) delete assignmentReasons[key];
                }
            } else {
                for (const key of Object.keys(assignmentReasons || {})) {
                    if (!dateKeyInRange(key)) continue;
                    const frag = assignmentReasons[key];
                    if (!frag || typeof frag !== 'object') continue;
                    for (const gStr of Object.keys(frag)) {
                        const gNum = parseInt(gStr, 10);
                        if (groupSet.has(gNum)) delete frag[gStr];
                    }
                    if (Object.keys(frag).length === 0) delete assignmentReasons[key];
                }
            }
            for (const dayType of ['normal', 'semi', 'weekend', 'special']) {
                const byType = lastRotationPositions[dayType];
                if (!byType || typeof byType !== 'object') continue;
                for (const mk of monthKeys) {
                    if (!byType[mk] || typeof byType[mk] !== 'object') continue;
                    if (!groupSet) {
                        delete byType[mk];
                        continue;
                    }
                    const block = { ...byType[mk] };
                    for (const g of groupSet) {
                        delete block[g];
                        delete block[String(g)];
                    }
                    if (Object.keys(block).length > 0) byType[mk] = block;
                    else delete byType[mk];
                }
            }
            if (!groupSet) {
                for (const dk of Object.keys(criticalAssignments || {})) {
                    if (dateKeyInRange(dk)) delete criticalAssignments[dk];
                }
                for (const dk of Object.keys(dutyAssignments || {})) {
                    if (dateKeyInRange(dk)) delete dutyAssignments[dk];
                }
            }
            if (typeof rebuildRotationBaselineLastByType === 'function') rebuildRotationBaselineLastByType();
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

        // Greek article for day name in accusative:
        // - "το Σάββατο"
        // - "την Κυριακή/Δευτέρα/..."
        function getGreekDayAccusativeArticle(date) {
            try {
                return date && typeof date.getDay === 'function' && date.getDay() === 6 ? 'το' : 'την';
            } catch (_) {
                return 'την';
            }
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

        function mapDayTypeToRotationType(dayType) {
            if (dayType === 'special-holiday') return 'special';
            if (dayType === 'weekend-holiday') return 'weekend';
            if (dayType === 'semi-normal-day') return 'semi';
            return 'normal';
        }

        /** Sorted YYYY-MM-DD keys in month for a duty rotation type (normal/semi/weekend/special). */
        function collectDayKeysForRotationTypeInMonth(year, month, rotationType) {
            const keys = [];
            const lastDay = new Date(year, month + 1, 0);
            const d = new Date(year, month, 1);
            while (d <= lastDay) {
                const dk = formatDateKey(d);
                if (mapDayTypeToRotationType(getDayType(d)) === rotationType) keys.push(dk);
                d.setDate(d.getDate() + 1);
            }
            return keys.sort();
        }

        /**
         * Simulate pure rotation slots through the month (ignores swaps & return-from-missing shifts).
         * Matches pureNormalRotationByDate / Excel «αρχική σειρά» semantics.
         */
        function simulatePureRotationLastSlotForMonth(rotationType, year, month, groupNum, groupData) {
            const rawList = (groupData?.[rotationType] || []).filter(Boolean);
            if (!rawList.length) return '';

            const normName = (s) => String(s || '').trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '').replace(/\s+/g, ' ');
            const dayKeys = collectDayKeysForRotationTypeInMonth(year, month, rotationType);
            if (!dayKeys.length) return '';

            const firstDay = new Date(year, month, 1);
            const seed =
                typeof getLastBaselineRotationPersonForDate === 'function'
                    ? getLastBaselineRotationPersonForDate(rotationType, firstDay, groupNum)
                    : null;
            let cursor = 0;
            if (seed) {
                const si = rawList.findIndex((p) => normName(p) === normName(seed));
                if (si >= 0) cursor = (si + 1) % rawList.length;
            }

            let deferSkip = null;
            let deferSkipOnCursor = false;
            if (typeof findLatestManualAlternateInPreviousMonth === 'function') {
                const prevManual = findLatestManualAlternateInPreviousMonth(rotationType, firstDay, groupNum);
                if (prevManual?.replacementPerson) {
                    deferSkip =
                        typeof resolvePersonInGroupRotationList === 'function'
                            ? resolvePersonInGroupRotationList(prevManual.replacementPerson, groupNum, rotationType)
                            : prevManual.replacementPerson;
                    deferSkipOnCursor = true;
                }
            }

            let lastSlot = seed ? normName(seed) : '';

            for (const dk of dayKeys) {
                if (typeof findManualAlternateReplacementForGroup === 'function') {
                    const manual = findManualAlternateReplacementForGroup(dk, groupNum);
                    if (manual?.baselinePerson) {
                        lastSlot = normName(manual.baselinePerson);
                        const bIdx = rawList.findIndex((p) => normName(p) === normName(manual.baselinePerson));
                        if (bIdx >= 0) cursor = (bIdx + 1) % rawList.length;
                        continue;
                    }
                }

                while (
                    deferSkip &&
                    deferSkipOnCursor &&
                    rawList[cursor] &&
                    normName(rawList[cursor]) === normName(deferSkip)
                ) {
                    cursor = (cursor + 1) % rawList.length;
                    deferSkip = null;
                    deferSkipOnCursor = false;
                }

                const slotPerson = rawList[cursor];
                if (slotPerson) lastSlot = normName(slotPerson);
                cursor = (cursor + 1) % rawList.length;
            }

            return lastSlot;
        }

        function getAssignedPersonNameForGroupFromAssignment(assignment, groupNum) {
            try {
                // Support object format: { "1": "Name", "2": "Name", ... }
                if (assignment && typeof assignment === 'object' && !Array.isArray(assignment)) {
                    const direct = assignment[groupNum] ?? assignment[String(groupNum)];
                    return direct
                        ? String(direct).trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '')
                        : '';
                }
                const persons = extractAllPersonNames(assignment);
                const match = persons.find(p => p.group === groupNum);
                return match
                    ? (match.name || '').trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '')
                    : '';
            } catch (_) {
                return '';
            }
        }

        function getNextTwoRotationPeopleForCurrentMonth({ year, month, daysInMonth, groupNum, groupData, dutyAssignments }) {
            const lastAssigned = { normal: '', semi: '', weekend: '', special: '' };
            const normName = (s) => String(s || '').trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '').replace(/\s+/g, ' ');
            const firstDayOfNextMonth = new Date(year, month + 1, 1);
            const lastDayOfNextMonth = new Date(year, month + 2, 0);
            const nextMonthStartKey = formatDateKey(firstDayOfNextMonth);
            const nextMonthEndKey = formatDateKey(lastDayOfNextMonth);

            const isDisabledForType = (personName, dutyType) => {
                const dp = groupData?.disabledPersons?.[personName];
                if (!dp || typeof dp !== 'object') return false;
                return !!(dp.all || dp[dutyType]);
            };
            const isMissingWholeNextMonth = (personName) => {
                const periods = groupData?.missingPeriods?.[personName];
                if (!Array.isArray(periods) || periods.length === 0) return false;
                for (const p of periods) {
                    const pStartKey = inputValueToDateKey(p?.start);
                    const pEndKey = inputValueToDateKey(p?.end);
                    if (!pStartKey || !pEndKey) continue;
                    // Full coverage check: period fully contains the whole next month range.
                    if (pStartKey <= nextMonthStartKey && pEndKey >= nextMonthEndKey) {
                        return true;
                    }
                }
                return false;
            };

            // Pure rotation simulation (αρχική σειρά): αγνοεί ανταλλαγές σύγκρουσης και μετατοπίσεις
            // return-from-missing που αλλάζουν τις τελικές αναθέσεις αλλά όχι τη θέση slot περιστροφής.
            for (const t of ['normal', 'semi', 'weekend', 'special']) {
                const simulated = simulatePureRotationLastSlotForMonth(t, year, month, groupNum, groupData);
                if (simulated) lastAssigned[t] = simulated;

                // Αντικατάσταση επιλαχών στην τελευταία ημέρα τύπου: ο αντικαταστάτης κλείνει τη σειρά.
                if (t !== 'special') {
                    const typeDayKeys = collectDayKeysForRotationTypeInMonth(year, month, t);
                    if (typeDayKeys.length) {
                        const lastTypeKey = typeDayKeys[typeDayKeys.length - 1];
                        const manualAlt = findManualAlternateReplacementForGroup(lastTypeKey, groupNum);
                        if (manualAlt?.replacementPerson && manualAlt?.baselinePerson) {
                            const actualAssignment =
                                (typeof getAssignmentForDate === 'function' ? getAssignmentForDate(lastTypeKey) : null) ??
                                (dutyAssignments?.[lastTypeKey] || '');
                            const actualPerson = getAssignedPersonNameForGroupFromAssignment(actualAssignment, groupNum);
                            if (
                                actualPerson &&
                                normName(actualPerson) === normName(manualAlt.replacementPerson) &&
                                normName(manualAlt.baselinePerson) !== normName(manualAlt.replacementPerson)
                            ) {
                                lastAssigned[t] = normName(manualAlt.replacementPerson);
                            }
                        } else {
                            // Απουσία/απενεργοποίηση ολόκληρου επόμενου μήνα στην τελευταία ημέρα τύπου.
                            const baseline =
                                typeof getRotationBaselineAssignmentForDate === 'function'
                                    ? getRotationBaselineAssignmentForDate(lastTypeKey)
                                    : null;
                            const baselineMap = baseline ? extractGroupAssignmentsMap(baseline) : null;
                            const baselinePerson = baselineMap?.[groupNum] || '';
                            const actualAssignment =
                                (typeof getAssignmentForDate === 'function' ? getAssignmentForDate(lastTypeKey) : null) ??
                                (dutyAssignments?.[lastTypeKey] || '');
                            const actualPerson = getAssignedPersonNameForGroupFromAssignment(actualAssignment, groupNum);
                            if (
                                baselinePerson &&
                                actualPerson &&
                                normName(actualPerson) !== normName(baselinePerson) &&
                                (isDisabledForType(baselinePerson, t) || isMissingWholeNextMonth(baselinePerson))
                            ) {
                                lastAssigned[t] = normName(actualPerson);
                            }
                        }
                    }
                }
            }

            const getMissingReasonOverRange = (personName, rangeStartKey, rangeEndKey) => {
                const periods = groupData?.missingPeriods?.[personName];
                if (!Array.isArray(periods) || periods.length === 0) return '';
                if (!rangeStartKey || !rangeEndKey) return '';
                for (const p of periods) {
                    const pStartKey = inputValueToDateKey(p?.start);
                    const pEndKey = inputValueToDateKey(p?.end);
                    if (!pStartKey || !pEndKey) continue;
                    // Overlap check: [pStart,pEnd] intersects [rangeStart,rangeEnd]
                    if (!(pEndKey < rangeStartKey || pStartKey > rangeEndKey)) {
                        const reason = (p?.reason || '').toString().trim();
                        return reason || 'Κώλυμα/Απουσία';
                    }
                }
                return '';
            };
            const getMissingReasonOverNextMonth = (personName) => getMissingReasonOverRange(personName, nextMonthStartKey, nextMonthEndKey);

            const nextTwoForType = (type) => {
                const rawList = (groupData?.[type] || []).filter(Boolean);
                if (rawList.length === 0) return ['', ''];

                const eligible = (p) => !isDisabledForType(p, type) && !isMissingWholeNextMonth(p);
                const eligibleCount = rawList.filter(eligible).length;
                if (eligibleCount === 0) return ['', ''];

                const last = lastAssigned[type];
                let startIdx = 0;
                const lastIdx = last ? rawList.findIndex(p => normName(p) === normName(last)) : -1;
                if (lastIdx >= 0) startIdx = (lastIdx + 1) % rawList.length;

                const picks = [];
                let cursor = startIdx;
                let checked = 0;
                const maxChecks = rawList.length * 2; // enough to wrap and still pick 2 (or same when single eligible)
                while (checked < maxChecks && picks.length < 2) {
                    const candidate = rawList[cursor];
                    if (eligible(candidate)) {
                        if (picks.length === 0 || candidate !== picks[0] || eligibleCount === 1) {
                            picks.push(candidate);
                        }
                    }
                    cursor = (cursor + 1) % rawList.length;
                    checked++;
                }

                return [picks[0] || '', picks[1] || ''];
            };

            // Special: show next 3 even if disabled/missing; annotate only if unavailable during the actual month
            // of the next upcoming special-holiday duty dates (which can be far later than next month).
            const nextThreeForSpecial = () => {
                const rawList = (groupData?.special || []).filter(Boolean);
                if (rawList.length === 0) return { names: ['', '', ''], notes: ['', '', ''] };
                const last = lastAssigned.special;
                let startIdx = 0;
                if (last) {
                    const idx = rawList.findIndex(p => normName(p) === normName(last));
                    if (idx >= 0) startIdx = idx + 1;
                }
                const findNextSpecialDates = (count = 3, maxDays = 3650) => {
                    const out = [];
                    const start = new Date(year, month + 1, 1); // start scanning after current month
                    for (let i = 0; i < maxDays && out.length < count; i++) {
                        const d = new Date(start);
                        d.setDate(start.getDate() + i);
                        if (getDayType(d) === 'special-holiday') out.push(d);
                    }
                    return out;
                };
                const specialDates = findNextSpecialDates(3, 3650);
                const getMonthRangeKeys = (dateObj) => {
                    if (!dateObj || isNaN(dateObj.getTime())) return { startKey: '', endKey: '' };
                    const start = new Date(dateObj.getFullYear(), dateObj.getMonth(), 1);
                    const end = new Date(dateObj.getFullYear(), dateObj.getMonth() + 1, 0);
                    return { startKey: formatDateKey(start), endKey: formatDateKey(end) };
                };
                const outNames = [];
                const outNotes = [];
                for (let i = 0; i < 3; i++) {
                    const name = rawList[(startIdx + i) % rawList.length] || '';
                    let note = '';
                    if (name) {
                        if (isDisabledForType(name, 'special')) {
                            note = 'ΕΚΤΟΣ ΥΠΗΡΕΣΙΑΣ';
                        } else {
                            const { startKey, endKey } = getMonthRangeKeys(specialDates[i]);
                            const r = getMissingReasonOverRange(name, startKey, endKey);
                            if (r) note = r;
                        }
                    }
                    outNames.push(name);
                    outNotes.push(note);
                }
                return { names: outNames, notes: outNotes };
            };
            const specialNext = nextThreeForSpecial();

            return {
                lastAssigned,
                next: {
                    normal: nextTwoForType('normal'),
                    semi: nextTwoForType('semi'),
                    weekend: nextTwoForType('weekend'),
                    special: specialNext.names
                },
                nextNotes: {
                    // Only used for ΕΙΔΙΚΕΣ ΑΡΓΙΕΣ (3 rows). Other categories keep blank notes.
                    special: specialNext.notes
                }
            };
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

        // Excel export month selection (separate from calendar currentDate)
        let _excelExportDate = null; // Date object set to 1st of selected month

        // Open a Greek month picker for Excel export
        function openExcelMonthPicker() {
            const modalEl = document.getElementById('excelMonthPickerModal');
            const yearEl = document.getElementById('excelMonthPickerYear');
            const monthsEl = document.getElementById('excelMonthPickerMonths');
            if (!modalEl || !yearEl || !monthsEl) return;

            const greekMonthNames = (() => {
                const names = [];
                for (let m = 0; m < 12; m++) {
                    names.push(new Date(2024, m, 1).toLocaleDateString('el-GR', { month: 'long' }));
                }
                return names;
            })();

            const base = (_excelExportDate instanceof Date && !isNaN(_excelExportDate.getTime())) ? _excelExportDate : currentDate;
            let pickerYear = base.getFullYear();

            const renderPickerMonths = () => {
                yearEl.textContent = pickerYear;
                monthsEl.innerHTML = '';
                greekMonthNames.forEach((name, index) => {
                    const col = document.createElement('div');
                    col.className = 'col-4';
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn btn-outline-success w-100';
                    btn.textContent = name;
                    btn.addEventListener('click', () => {
                        _excelExportDate = new Date(pickerYear, index, 1);
                        const m = bootstrap.Modal.getInstance(modalEl);
                        if (m) m.hide();
                        showExcelPreview(_excelExportDate);
                    });
                    col.appendChild(btn);
                    monthsEl.appendChild(col);
                });
            };

            const prevBtn = document.getElementById('excelMonthPickerPrevYear');
            const nextBtn = document.getElementById('excelMonthPickerNextYear');
            if (prevBtn) prevBtn.onclick = () => { pickerYear--; renderPickerMonths(); };
            if (nextBtn) nextBtn.onclick = () => { pickerYear++; renderPickerMonths(); };

            renderPickerMonths();
            const modal = new bootstrap.Modal(modalEl);
            modal.show();
        }

        // Show Excel preview before generating files
        function showExcelPreview(selectedMonthDate = null) {
            const base = (selectedMonthDate instanceof Date && !isNaN(selectedMonthDate.getTime()))
                ? new Date(selectedMonthDate.getFullYear(), selectedMonthDate.getMonth(), 1)
                : ((_excelExportDate instanceof Date && !isNaN(_excelExportDate.getTime()))
                    ? new Date(_excelExportDate.getFullYear(), _excelExportDate.getMonth(), 1)
                    : new Date(currentDate.getFullYear(), currentDate.getMonth(), 1));
            _excelExportDate = base;
            const year = base.getFullYear();
            const month = base.getMonth();
            const monthName = getGreekMonthName(base);
            
            // Get all days of the month
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            const daysInMonth = lastDay.getDate();
            
            const previewContent = document.getElementById('excelPreviewContent');
            previewContent.innerHTML = '';
            
            let hasAnyGroup = false;
            const typeMeta = {
                normal: { label: 'Καθημερινές', dayType: 'normal-day' },
                semi: { label: 'Ημιαργίες', dayType: 'semi-normal-day' },
                weekend: { label: 'Αργίες', dayType: 'weekend-holiday' },
                special: { label: 'Ειδικές Αργίες', dayType: 'special-holiday' }
            };
            const typeOrder = ['normal', 'semi', 'weekend', 'special'];
            const toTypeKey = (dayType) => (dayType === 'special-holiday' ? 'special' : dayType === 'weekend-holiday' ? 'weekend' : dayType === 'semi-normal-day' ? 'semi' : 'normal');
            const normName = (s) => String(s || '').trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '').replace(/\s+/g, ' ');
            const hashColor = (seed) => {
                let h = 0;
                const str = String(seed || '');
                for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i);
                const palette = ['#8e44ad', '#d35400', '#2980b9', '#16a085', '#c0392b', '#2c3e50', '#7f8c8d', '#27ae60'];
                return palette[Math.abs(h) % palette.length];
            };
            const swapPairLabelByKey = new Map();
            let nextSwapPairLabelNo = 1;
            const getSwapPairLabelNo = (pairKey) => {
                const k = String(pairKey || '').trim();
                if (!k) return null;
                if (!swapPairLabelByKey.has(k)) {
                    swapPairLabelByKey.set(k, nextSwapPairLabelNo++);
                }
                return swapPairLabelByKey.get(k);
            };
            const getOrderNo = (groupData, type, personName) => {
                const list = (groupData?.[type] || []).map(normName);
                const idx = list.findIndex(n => n === normName(personName));
                return idx >= 0 ? idx + 1 : null;
            };
            const getMissingPeriodsOverMonth = (groupData, personName, mStart, mEnd) => {
                const periods = groupData?.missingPeriods?.[personName];
                if (!Array.isArray(periods) || periods.length === 0) return [];
                const out = [];
                for (const p of periods) {
                    const sKey = inputValueToDateKey(p?.start);
                    const eKey = inputValueToDateKey(p?.end);
                    if (!sKey || !eKey) continue;
                    if (eKey < mStart || sKey > mEnd) continue;
                    out.push({
                        start: sKey,
                        end: eKey,
                        reason: (p?.reason || '').toString().trim()
                    });
                }
                return out;
            };
            const getReasonForAssigned = (dateKey, groupNum, personName) => {
                const gmap = assignmentReasons?.[dateKey]?.[groupNum];
                if (!gmap || typeof gmap !== 'object') return null;
                const target = normName(personName);
                for (const p of Object.keys(gmap)) {
                    if (normName(p) === target) return gmap[p];
                }
                return null;
            };
            
            // Generate preview for each group
            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                const groupName = getGroupName(groupNum);
                const groupData = groups[groupNum];
                
                // Skip if group has no people
                if (!groupData || (!groupData.special?.length && !groupData.weekend?.length && !groupData.semi?.length && !groupData.normal?.length)) {
                    continue;
                }
                
                hasAnyGroup = true;
                const rotationInfo = getNextTwoRotationPeopleForCurrentMonth({
                    year,
                    month,
                    daysInMonth,
                    groupNum,
                    groupData,
                    dutyAssignments
                });
                const monthStartKey = formatDateKey(firstDay);
                const monthEndKey = formatDateKey(lastDay);
                const allPeople = Array.from(new Set([
                    ...(groupData.normal || []),
                    ...(groupData.semi || []),
                    ...(groupData.weekend || []),
                    ...(groupData.special || [])
                ]));
                const disabledPeople = allPeople.filter((person) => {
                    const dp = groupData?.disabledPersons?.[person];
                    if (!dp || typeof dp !== 'object') return false;
                    return !!(dp.all || dp.normal || dp.semi || dp.weekend || dp.special);
                });
                const missingPeople = allPeople
                    .map((person) => ({ person, periods: getMissingPeriodsOverMonth(groupData, person, monthStartKey, monthEndKey) }))
                    .filter(item => item.periods.length > 0);
                
                // Create preview table for this group
                const groupPreview = document.createElement('div');
                groupPreview.className = 'mb-4 p-3 border rounded bg-white';
                const renderAlternateRows = (type, names, notes = []) => {
                    const t = typeMeta[type];
                    const count = type === 'special' ? 3 : 2;
                    const rows = [];
                    for (let i = 0; i < count; i++) {
                        const nm = names?.[i] || '';
                        const orderNo = nm ? getOrderNo(groupData, type, nm) : null;
                        const leftText = nm ? `#${orderNo || '-'} ${escapeHtml(nm)}` : '-';
                        const rightText = type === 'special' ? (notes?.[i] || '') : '';
                        rows.push(`
                            <tr>
                                <td style="padding:4px 6px;"><span class="fw-semibold">${leftText}</span></td>
                                <td style="padding:4px 6px; color:#6c757d; font-size:11px;">${escapeHtml(rightText)}</td>
                            </tr>
                        `);
                    }
                    return `
                        <div class="mb-2 border rounded overflow-hidden">
                            <div class="fw-bold text-white px-2 py-1" style="background:#428BCA;">${t.label.toUpperCase()}</div>
                            <table class="table table-sm mb-0">
                                <tbody>${rows.join('')}</tbody>
                            </table>
                        </div>
                    `;
                };
                const disabledHtml = disabledPeople.length === 0
                    ? '<div class="text-muted small">Δεν υπάρχουν.</div>'
                    : disabledPeople.map((person) => {
                        const dp = groupData?.disabledPersons?.[person] || {};
                        const reasons = [];
                        if (dp.all) reasons.push('Όλα');
                        else {
                            if (dp.normal) reasons.push('Καθημερινές');
                            if (dp.semi) reasons.push('Ημιαργίες');
                            if (dp.weekend) reasons.push('Αργίες');
                            if (dp.special) reasons.push('Ειδικές Αργίες');
                        }
                        const orderText = typeOrder
                            .map(t => `#${getOrderNo(groupData, t, person) || '-'} ${typeMeta[t].label}`)
                            .join(' | ');
                        return `<div class="small mb-1"><strong>${escapeHtml(person)}</strong> — ${escapeHtml(reasons.join(', ') || 'Άγνωστο')}<br><span class="text-muted">${escapeHtml(orderText)}</span></div>`;
                    }).join('');
                const missingHtml = missingPeople.length === 0
                    ? '<div class="text-muted small">Δεν υπάρχουν.</div>'
                    : missingPeople.map(({ person, periods }) => {
                        const ranges = periods.map((p) => {
                            const s = new Date(p.start + 'T00:00:00');
                            const e = new Date(p.end + 'T00:00:00');
                            const rr = `${formatDate(s)} - ${formatDate(e)}`;
                            return p.reason ? `${rr} (${p.reason})` : rr;
                        }).join(' | ');
                        const orderText = typeOrder
                            .map(t => `#${getOrderNo(groupData, t, person) || '-'} ${typeMeta[t].label}`)
                            .join(' | ');
                        return `<div class="small mb-1"><strong>${escapeHtml(person)}</strong> — ${escapeHtml(ranges)}<br><span class="text-muted">${escapeHtml(orderText)}</span></div>`;
                    }).join('');
                groupPreview.innerHTML = `
                    <h5 class="mb-3" style="color: #428BCA;">
                        <i class="fas fa-users me-2"></i>${groupName} - ${monthName} ${year}
                    </h5>
                    <div class="row g-3">
                        <div class="col-lg-8">
                            <div class="table-responsive">
                                <table class="table table-bordered" style="font-size: 12px;">
                                    <thead>
                                        <tr style="background-color: #428BCA; color: white;">
                                            <th style="width: 13%; text-align: center; padding: 8px;">ΗΜΕΡ.</th>
                                            <th style="width: 15%; text-align: center; padding: 8px;">ΗΜΕΡΑ</th>
                                            <th style="width: 52%; text-align: center; padding: 8px;">ΟΝΟΜΑΤΕΠΩΝΥΜΟ</th>
                                            <th style="width: 20%; text-align: center; padding: 8px;">ΑΛΛΑΓΗ</th>
                                        </tr>
                                    </thead>
                                    <tbody id="previewGroup${groupNum}">
                                        <!-- Rows will be inserted here -->
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div class="col-lg-4">
                            <div class="border rounded p-2 bg-light">
                                <div class="fw-bold text-center mb-2">ΑΝΑΠΛΗΡΩΜΑΤΙΚΟΙ (όπως στο τελικό Excel)</div>
                                ${renderAlternateRows('normal', rotationInfo.next.normal)}
                                ${renderAlternateRows('semi', rotationInfo.next.semi)}
                                ${renderAlternateRows('weekend', rotationInfo.next.weekend)}
                                ${renderAlternateRows('special', rotationInfo.next.special, rotationInfo.nextNotes?.special || [])}
                            </div>
                        </div>
                    </div>
                    <div class="row g-3 mt-1">
                        <div class="col-lg-6">
                            <div class="border rounded p-2 h-100">
                                <div class="fw-bold text-danger mb-2">Απενεργοποιημένοι</div>
                                ${disabledHtml}
                            </div>
                        </div>
                        <div class="col-lg-6">
                            <div class="border rounded p-2 h-100">
                                <div class="fw-bold text-warning mb-2">Απουσιάζοντες (${monthName} ${year})</div>
                                ${missingHtml}
                            </div>
                        </div>
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
                    
                    // Get assignment for this group (supports object or string formats)
                    const assignment = (typeof getAssignmentForDate === 'function' ? getAssignmentForDate(dayKey) : null) ?? (dutyAssignments?.[dayKey] || '');
                    const personName = getAssignedPersonNameForGroupFromAssignment(assignment, groupNum);
                    const typeKey = toTypeKey(dayType);
                    const orderNo = personName ? getOrderNo(groupData, typeKey, personName) : null;
                    const reasonObj = personName ? getReasonForAssigned(dayKey, groupNum, personName) : null;
                    const pairKey = reasonObj?.swapPairId || `${reasonObj?.type || ''}:${reasonObj?.swappedWith || ''}:${dayKey}:${groupNum}`;
                    const swapColor = reasonObj ? hashColor(pairKey) : null;
                    
                    // Format date as DD/MM/YYYY
                    const dateStr = `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;
                    
                    // Get color for this day type
                    const color = getDayTypeColor(dayType);
                    const rgbColor = `rgb(${color[0]}, ${color[1]}, ${color[2]})`;
                    
                    const row = document.createElement('tr');
                    row.style.height = '22px';
                    const swapNo = reasonObj?.type === 'swap' ? getSwapPairLabelNo(pairKey) : null;
                    const markerText = !reasonObj
                        ? ''
                        : (reasonObj.type === 'swap' ? `Ανταλλαγή #${swapNo || '-'}`
                            : reasonObj.type === 'skip' ? 'Αντικατάσταση'
                            : reasonObj.type === 'shift' ? 'Μετακίνηση'
                            : 'Χειροκίνητη αλλαγή');
                    const markerStyle = swapColor
                        ? `border-left: 5px solid ${swapColor}; border-right: 5px solid ${swapColor};`
                        : '';
                    row.innerHTML = `
                        <td style="padding: 4px; border: 1px solid #ddd; background-color: ${rgbColor} !important;">${dateStr}</td>
                        <td style="padding: 4px; border: 1px solid #ddd; background-color: ${rgbColor} !important;">${dayName}</td>
                        <td style="padding: 4px; border: 1px solid #ddd; background-color: ${rgbColor} !important; ${markerStyle}">
                            ${personName ? `<span class="fw-semibold me-1">#${orderNo || '-'}</span>${escapeHtml(personName)}` : ''}
                        </td>
                        <td style="padding: 4px; border: 1px solid #ddd; background-color: ${rgbColor} !important; color:${swapColor || '#6c757d'}; font-size:11px;">
                            ${escapeHtml(markerText)}
                        </td>
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
                        Δεν υπάρχουν ομάδες με άτομα για να δημιουργηθεί το Excel αρχείο.
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
                const base = (_excelExportDate instanceof Date && !isNaN(_excelExportDate.getTime()))
                    ? _excelExportDate
                    : currentDate;
                const year = base.getFullYear();
                const month = base.getMonth();
                const monthName = getGreekMonthName(base);
                
                // Get all days of the month
                const firstDay = new Date(year, month, 1);
                const lastDay = new Date(year, month + 1, 0);
                const daysInMonth = lastDay.getDate();
                
                // Show loading message
                const loadingAlert = document.createElement('div');
                loadingAlert.className = 'alert alert-info position-fixed top-50 start-50 translate-middle';
                loadingAlert.style.zIndex = '9999';
                loadingAlert.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Δημιουργία Excel αρχείου...';
                document.body.appendChild(loadingAlert);
                
                // Check if ExcelJS is available, otherwise fall back to SheetJS
                const useExcelJS = typeof ExcelJS !== 'undefined';

                // Keep Greek characters in filenames; only remove illegal/control chars.
                const sanitizeFilenameComponent = (value) => {
                    return (value ?? '')
                        .toString()
                        .normalize('NFC')
                        // Remove ASCII control chars (includes \n \r \t)
                        .replace(/[\x00-\x1F\x7F]/g, '')
                        // Remove Windows forbidden filename chars
                        .replace(/[\\/:*?"<>|]/g, '_')
                        // Replace any other weird chars (keep unicode letters/numbers, space, underscore, dash, dot)
                        .replace(/[^\p{L}\p{N} _.\-]/gu, '_')
                        .trim()
                        .replace(/\s+/g, '_')
                        .replace(/_+/g, '_')
                        .replace(/^_+|_+$/g, '');
                };

                const buildExcelFilename = (monthName, year) => {
                    const prefix = 'ΥΠΗΡΕΣΙΑ';
                    const safeMonth = sanitizeFilenameComponent(monthName);
                    return `${prefix}_${safeMonth}_${year}.xlsx`;
                };
                const buildExcelPrintoutFilename = (monthName, year) => {
                    const prefix = 'ΥΠΗΡΕΣΙΑ';
                    const safeMonth = sanitizeFilenameComponent(monthName);
                    return `${prefix}_${safeMonth}_${year}_Printout.xlsx`;
                };
                const safeSheetName = (name, maxLen = 31) => {
                    const s = (name ?? '').toString().replace(/[\\/*?:\[\]]/g, '_').trim();
                    return s.slice(0, maxLen) || 'Sheet';
                };

                const getGreekMonthAbbrev = (date) => {
                    const abbr = ['ΙΑΝ', 'ΦΕΒ', 'ΜΑΡ', 'ΑΠΡ', 'ΜΑΙ', 'ΙΟΥΝ', 'ΙΟΥΛ', 'ΑΥΓ', 'ΣΕΠ', 'ΟΚΤ', 'ΝΟΕ', 'ΔΕΚ'];
                    return abbr[date.getMonth()];
                };

                // IMPORTANT: Folder name must match the selected export month (not the calendar's currentDate)
                const monthFolderName = `${getGreekMonthAbbrev(base)} ${String(year).slice(-2)}`;

                const excelMime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

                const downloadBytes = (fileName, bytes) => {
                    const blob = new Blob([bytes], { type: excelMime });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = fileName;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                };

                const downloadBlob = (fileName, blob, mimeType) => {
                    const safeBlob = blob instanceof Blob ? blob : new Blob([blob], { type: mimeType || 'application/octet-stream' });
                    const url = URL.createObjectURL(safeBlob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = fileName;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                };

                // Use showSaveFilePicker so the user can choose where to save. This avoids the "Can't open this
                // folder because it contains system files" error that showDirectoryPicker causes on many PCs
                // for folders like Documents, Downloads, Desktop. The save file picker still lets the user pick
                // the folder (by navigating in the dialog) and the filename.
                let monthDirHandle = null;
                let baseDirHandle = null;

                const pickOrCreateMonthFolder = async () => {
                    // Ask once for a base folder, then create/use "<MMM> <YY>" inside it.
                    // If the user cancels (or the browser blocks it), we simply fall back to per-file Save As.
                    try {
                        if (typeof window.showDirectoryPicker !== 'function') return null;
                        if (!baseDirHandle) {
                            baseDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                        }
                        monthDirHandle = await baseDirHandle.getDirectoryHandle(monthFolderName, { create: true });
                        return monthDirHandle;
                    } catch (e) {
                        if (e?.name === 'AbortError') return null;
                        console.warn('Folder picker failed (will use Save As fallback):', e);
                        return null;
                    }
                };

                const saveExcelWithSaveFilePicker = async (fileName, bytes) => {
                    try {
                        if (typeof window.showSaveFilePicker === 'function') {
                            const handle = await window.showSaveFilePicker({
                                suggestedName: fileName,
                                types: [{ description: 'Excel workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }]
                            });
                            const writable = await handle.createWritable();
                            await writable.write(new Blob([bytes], { type: excelMime }));
                            await writable.close();
                            return { saved: true, cancelled: false };
                        }
                    } catch (e) {
                        if (e.name === 'AbortError') return { saved: false, cancelled: true };
                        console.warn('Save file picker failed:', e);
                    }
                    return { saved: false, cancelled: false };
                };

                const saveBytesToMonthFolder = async (fileName, bytes) => {
                    if (!monthDirHandle) return false;
                    try {
                        const fileHandle = await monthDirHandle.getFileHandle(fileName, { create: true });
                        const writable = await fileHandle.createWritable();
                        await writable.write(new Blob([bytes], { type: excelMime }));
                        await writable.close();
                        return true;
                    } catch (e) {
                        console.warn('Failed saving to folder, falling back to download:', e);
                        return false;
                    }
                };
                
                const groupNumbersToProcess = [];
                for (let g = 1; g <= 4; g++) {
                    const gd = groups[g];
                    if (gd && (gd.special?.length || gd.weekend?.length || gd.semi?.length || gd.normal?.length)) {
                        groupNumbersToProcess.push(g);
                    }
                }
                if (groupNumbersToProcess.length === 0) {
                    if (loadingAlert.parentNode) loadingAlert.remove();
                    alert('Δεν υπάρχουν ομάδες με άτομα για να δημιουργηθεί το Excel αρχείο.');
                    return;
                }

                let fileWasSaved = false;
                let saveCancelled = false;

                if (useExcelJS) {
                    // If possible, save into a "<MMM> <YY>" subfolder inside a user-picked base folder
                    await pickOrCreateMonthFolder();

                    const buildExcelJSWorkbook = ({ printout = false } = {}) => {
                        const workbook = new ExcelJS.Workbook();
                        const palette = printout ? {
                            titleFill: 'FF404040',
                            titleFont: 'FFFFFFFF',
                            headerFill: 'FF404040',
                            headerFont: 'FFFFFFFF',
                            day: {
                                'normal-day':      { fill: 'FFFFFFFF', font: 'FF000000' }, // white / black
                                'semi-normal-day': { fill: 'FFAEAEAE', font: 'FF000000' }, // requested printout grey / black
                                'weekend-holiday': { fill: 'FF7B7B7B', font: 'FFFFFFFF' }, // requested printout dark grey / white
                                'special-holiday': { fill: 'FF404040', font: 'FFFFFFFF' }, // dark grey / white
                                'special':         { fill: 'FF404040', font: 'FFFFFFFF' }  // dark grey / white
                            },
                            right: {
                                normal:  { fill: 'FFFFFFFF', font: 'FF000000' },
                                semi:    { fill: 'FFAEAEAE', font: 'FF000000' },
                                weekend: { fill: 'FF7B7B7B', font: 'FFFFFFFF' },
                                special: { fill: 'FF404040', font: 'FFFFFFFF' }
                            }
                        } : {
                            titleFill: 'FF428BCA',
                            titleFont: 'FFFFFFFF',
                            headerFill: 'FF428BCA',
                            headerFont: 'FFFFFFFF',
                            day: null,
                            right: null
                        };

                        for (const groupNum of groupNumbersToProcess) {
                            const groupName = getGroupName(groupNum);
                            const groupData = groups[groupNum];
                            const worksheet = workbook.addWorksheet(safeSheetName(groupName));

                        // Page setup: A4, landscape, custom margins, fit all columns on one page
                        worksheet.pageSetup = {
                            paperSize: 9,            // A4
                            orientation: 'landscape',
                            margins: {
                                left:   0.12,        // ≈ 0.3 cm
                                right:  0.12,        // ≈ 0.3 cm
                                top:    0.12,        // ≈ 0.3 cm
                                bottom: 0.12,        // ≈ 0.3 cm
                                header: 0.20,        // ≈ 0.5 cm
                                footer: 0.20         // ≈ 0.5 cm
                            },
                            fitToWidth: 1,
                            fitToHeight: 0
                        };
                        
                        // Helper function to format date as "10 ΔΕΚ 2026"
                        const formatDateGreekAbbr = (date) => {
                            const day = date.getDate();
                            const monthAbbr = ['ΙΑΝ', 'ΦΕΒ', 'ΜΑΡ', 'ΑΠΡ', 'ΜΑΪ', 'ΙΟΥΝ', 'ΙΟΥΛ', 'ΑΥΓ', 'ΣΕΠ', 'ΟΚΤ', 'ΝΟΕ', 'ΔΕΚ'];
                            const month = monthAbbr[date.getMonth()];
                            const year = date.getFullYear();
                            return `${day} ${month} ${year}`;
                        };
                        
                        const today = new Date();
                        const formattedDate = formatDateGreekAbbr(today);
                        
                        // Set I1 cell with header information
                        const i1Cell = worksheet.getCell('I1');
                        i1Cell.value = `55 ΣΜ. ΜΑΧΗΣ\nΜΣΑ\nΤΜ. ΠΡΟΣΩΠΙΚΟΥ\nΤΙΜΗ, ${formattedDate}`;
                        i1Cell.font = { 
                            name: 'Arial', 
                            bold: true, 
                            size: 12
                        };
                        i1Cell.alignment = { 
                            horizontal: 'left', 
                            vertical: 'top',
                            wrapText: true
                        };
                        worksheet.getRow(1).height = 80;
                        
                        // Set title in row 2 - merge cells A2 through I2
                        worksheet.mergeCells('A2:I2');
                        const titleCell = worksheet.getCell('A2');
                        titleCell.value = `ΥΠΗΡΕΣΙΑ ${groupName} ΜΗΝΟΣ ${monthName.toUpperCase()} ${year}`;
                        titleCell.font = { 
                            name: 'Arial', 
                            bold: true, 
                            size: 16,
                            color: { argb: palette.titleFont }
                        };
                        titleCell.alignment = { 
                            horizontal: 'center', 
                            vertical: 'middle' 
                        };
                        titleCell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: palette.titleFill }
                        };
                        // Add borders to title cell
                        titleCell.border = {
                            top: { style: 'thick' },
                            left: { style: 'thick' },
                            bottom: { style: 'thick' },
                            right: { style: 'thick' }
                        };
                        worksheet.getRow(2).height = 30;
                        
                        // Empty row
                        worksheet.getRow(3).height = 5;
                        
                        // Header row
                        const headerRow = worksheet.getRow(4);
                        headerRow.getCell(1).value = 'ΗΜΕΡ.';
                        headerRow.getCell(2).value = 'ΗΜΕΡΑ';
                        headerRow.getCell(3).value = 'ΟΝΟΜΑΤΕΠΩΝΥΜΟ';
                        headerRow.getCell(4).value = 'ΑΛΛΑΓΕΣ';
                        
                        // Style each header cell individually
                        ['A4', 'B4', 'C4', 'D4'].forEach(cellRef => {
                            const cell = worksheet.getCell(cellRef);
                            cell.font = { 
                                name: 'Arial', 
                                bold: true, 
                                size: 16,
                                color: { argb: palette.headerFont }
                            };
                            cell.fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: palette.headerFill }
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
                        worksheet.getCell('A4').border.left = { style: 'thick' };
                        worksheet.getCell('D4').border.right = { style: 'thick' };
                        headerRow.height = 30;
                        
                        // Set column widths
                        worksheet.getColumn(1).width = 14;
                        worksheet.getColumn(2).width = 17;
                        worksheet.getColumn(3).width = 57;
                        worksheet.getColumn(4).width = 56.5;   // ΑΛΛΑΓΕΣ column (D)
                        worksheet.getColumn(8).width = 53;  // right table (H)
                        worksheet.getColumn(9).width = 21;  // header info / notes (I)
                        
                        // Data rows
                        for (let day = 1; day <= daysInMonth; day++) {
                            const date = new Date(year, month, day);
                            const dayKey = formatDateKey(date);
                            const dayType = getDayType(date);
                            const dayName = getGreekDayNameUppercase(date); // Use uppercase
                            
                            // Get assignment for this group
                            const assignment = (typeof getAssignmentForDate === 'function' ? getAssignmentForDate(dayKey) : null) ?? (dutyAssignments?.[dayKey] || '');
                            const personName = getAssignedPersonNameForGroupFromAssignment(assignment, groupNum);
                            
                            // Format date as DD/MM/YYYY
                            const dateStr = `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;
                            
                            const row = worksheet.getRow(day + 4); // +4 for I1, title, empty, header rows
                            row.getCell(1).value = dateStr;
                            row.getCell(2).value = dayName;
                            row.getCell(3).value = personName;
                            row.getCell(4).value = ''; // ΑΛΛΑΓΕΣ column - empty for user to fill
                            
                            // Apply color based on day type
                            let hexColor = null;
                            let fontColor = 'FF000000';
                            if (palette.day) {
                                const mapped = palette.day[dayType] || palette.day['normal-day'];
                                hexColor = mapped.fill;
                                fontColor = mapped.font;
                            } else {
                                const color = getDayTypeColor(dayType);
                                hexColor = 'FF' + color.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
                                fontColor = 'FF000000';
                            }
                            
                            // Style each cell in the row
                            const isFirstDataRow = day === 1;
                            const isLastDataRow = day === daysInMonth;
                            
                            [1, 2, 3, 4].forEach(colNum => {
                                const cell = row.getCell(colNum);
                                cell.fill = {
                                    type: 'pattern',
                                    pattern: 'solid',
                                    fgColor: { argb: hexColor }
                                };
                                cell.font = { 
                                    name: 'Arial', 
                                    size: 14,
                                    color: { argb: fontColor }
                                };
                                cell.alignment = { 
                                    horizontal: (colNum === 1 || colNum === 2) ? 'center' : 'left', 
                                    vertical: 'middle' 
                                };
                                
                                // Add borders - thick on outside, thin on inside
                                const isFirstCol = colNum === 1;
                                const isLastCol = colNum === 4;
                                
                                cell.border = {
                                    top: isFirstDataRow ? { style: 'thick' } : { style: 'thin' },
                                    bottom: isLastDataRow ? { style: 'thick' } : { style: 'thin' },
                                    left: isFirstCol ? { style: 'thick' } : { style: 'thin' },
                                    right: isLastCol ? { style: 'thick' } : { style: 'thin' }
                                };
                            });
                            
                            row.height = 23;
                        }

                        // Add signature cells under the duty list (with one blank row before)
                        const lastDataRow = daysInMonth + 4; // Last row of duty data
                        const blankRow = worksheet.getRow(lastDataRow + 1);
                        blankRow.height = 5; // Blank row
                        
                        const sigRow1 = worksheet.getRow(lastDataRow + 2);
                        const sigRow2 = worksheet.getRow(lastDataRow + 3);
                        
                        // Column B: Signature cells
                        sigRow1.getCell(2).value = 'Ο';
                        sigRow2.getCell(2).value = 'ΣΥΝΤΑΞΑΣ';
                        
                        // Column H: Signature cells
                        sigRow1.getCell(8).value = 'ΕΘ-ΘΗ';
                        sigRow2.getCell(8).value = 'Ο';
                        const sigRow3 = worksheet.getRow(lastDataRow + 4);
                        sigRow3.getCell(8).value = 'ΔΚΤΗΣ';
                        
                        // Style signature cells (Ο ΣΥΝΤΑΞΑΣ, ΕΘ-ΘΗ, Ο ΔΚΤΗΣ): bold Arial 14
                        [sigRow1.getCell(2), sigRow2.getCell(2), sigRow1.getCell(8), sigRow2.getCell(8), sigRow3.getCell(8)].forEach(cell => {
                            cell.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF000000' } };
                            cell.alignment = { horizontal: 'center', vertical: 'middle' };
                        });
                        sigRow1.height = 25;
                        sigRow2.height = 25;
                        sigRow3.height = 25;

                        // Add "next on rotation" table on the RIGHT of the main duty list (as in the screenshot)
                        const rotationInfo = getNextTwoRotationPeopleForCurrentMonth({
                            year,
                            month,
                            daysInMonth,
                            groupNum,
                            groupData,
                            dutyAssignments
                        });
                        const rightCol = 8; // H (moved from I)
                        const rightNoteCol = 9; // I (notes for ειδικές αργίες)

                        const setBlockBorder = (r, isTop, isBottom) => {
                            const row = worksheet.getRow(r);
                            const leftCell = row.getCell(rightCol);
                            const rightCell = row.getCell(rightNoteCol);
                            const top = isTop ? { style: 'thick' } : { style: 'thin' };
                            const bottom = isBottom ? { style: 'thick' } : { style: 'thin' };
                            leftCell.border = { top, bottom, left: { style: 'thick' }, right: { style: 'thin' } };
                            rightCell.border = { top, bottom, left: { style: 'thin' }, right: { style: 'thick' } };
                        };

                        const fillHex = (rgbArr) => {
                            const hex = rgbArr.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
                            return 'FF' + hex;
                        };

                        const normalFill = palette.right ? palette.right.normal.fill : fillHex(getDayTypeColor('normal-day'));
                        const semiFill = palette.right ? palette.right.semi.fill : fillHex(getDayTypeColor('semi-normal-day'));
                        const weekendFill = palette.right ? palette.right.weekend.fill : fillHex(getDayTypeColor('weekend-holiday'));
                        // Use a vivid magenta for "ΕΙΔΙΚΕΣ ΑΡΓΙΕΣ" as shown in your screenshot
                        const specialFill = palette.right ? palette.right.special.fill : 'FFFF00FF';
                        const noteFillWhite = 'FFFFFFFF';
                        const specialNoteFill = palette.right ? palette.right.special.fill : noteFillWhite;
                        const specialNoteFont = palette.right ? palette.right.special.font : 'FF000000';

                        const writeRightRow = (rowNum, text, { col = rightCol, bold = false, center = false, fill = null, fontColor = 'FF000000', fontSize = 14, wrap = false } = {}) => {
                            const cell = worksheet.getRow(rowNum).getCell(col);
                            cell.value = text || '';
                            cell.font = { name: 'Arial', size: fontSize, bold: !!bold, color: { argb: fontColor } };
                            cell.alignment = { horizontal: center ? 'center' : 'left', vertical: 'middle', wrapText: !!wrap };
                            if (fill) {
                                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
                            }
                            worksheet.getRow(rowNum).height = 23;
                        };

                        // Layout (matching screenshot): start around row 5, stacked blocks with blank separators.
                        let rr = 5; // Row 5 in Excel (after I1, title, empty, header)
                        writeRightRow(rr, 'ΑΝΑΠΛΗΡΩΜΑΤΙΚΟΙ', { bold: true, center: true, fontColor: 'FF000000' });
                        setBlockBorder(rr, true, true);
                        rr += 2; // blank row between title and first block

                        const writeCategoryBlock = (title, fill, names, fontColor, { notes = null, count = 2, noteFill = noteFillWhite, noteFontColor = 'FF000000' } = {}) => {
                            writeRightRow(rr, title, { bold: true, center: true, fill, fontColor });
                            setBlockBorder(rr, true, false);
                            rr++;

                            writeRightRow(rr, names?.[0] || '', { fill, fontColor, col: rightCol });
                            writeRightRow(rr, notes?.[0] || '', { fill: noteFill, fontColor: noteFontColor, col: rightNoteCol, fontSize: 10, wrap: true });
                            setBlockBorder(rr, false, false);
                            rr++;

                            writeRightRow(rr, names?.[1] || '', { fill, fontColor, col: rightCol });
                            writeRightRow(rr, notes?.[1] || '', { fill: noteFill, fontColor: noteFontColor, col: rightNoteCol, fontSize: 10, wrap: true });
                            if (count === 2) {
                                setBlockBorder(rr, false, true);
                                rr += 2; // blank row between blocks
                                return;
                            }
                            setBlockBorder(rr, false, false);
                            rr++;

                            writeRightRow(rr, names?.[2] || '', { fill, fontColor, col: rightCol });
                            writeRightRow(rr, notes?.[2] || '', { fill: noteFill, fontColor: noteFontColor, col: rightNoteCol, fontSize: 10, wrap: true });
                            setBlockBorder(rr, false, true);
                            rr += 2; // blank row between blocks
                        };

                        const rightFontNormal = palette.right ? palette.right.normal.font : 'FF000000';
                        const rightFontSemi = palette.right ? palette.right.semi.font : 'FF000000';
                        const rightFontWeekend = palette.right ? palette.right.weekend.font : 'FF000000';
                        const rightFontSpecial = palette.right ? palette.right.special.font : 'FF000000';

                        writeCategoryBlock('ΚΑΘΗΜΕΡΙΝΕΣ', normalFill, rotationInfo.next.normal, rightFontNormal);
                        writeCategoryBlock('ΗΜΙΑΡΓΙΕΣ', semiFill, rotationInfo.next.semi, rightFontSemi);
                        writeCategoryBlock('ΑΡΓΙΕΣ', weekendFill, rotationInfo.next.weekend, rightFontWeekend);
                        writeCategoryBlock('ΕΙΔΙΚΕΣ ΑΡΓΙΕΣ', specialFill, rotationInfo.next.special, rightFontSpecial, {
                            notes: rotationInfo.nextNotes?.special || null,
                            count: 3,
                            noteFill: specialNoteFill,
                            noteFontColor: specialNoteFont
                        });
                    }
                        return workbook;
                    };

                    const fileName = buildExcelFilename(monthName, year);
                    const printoutFileName = buildExcelPrintoutFilename(monthName, year);

                    const workbookColor = buildExcelJSWorkbook({ printout: false });
                    const bufferColor = await workbookColor.xlsx.writeBuffer();
                    const workbookPrint = buildExcelJSWorkbook({ printout: true });
                    const bufferPrint = await workbookPrint.xlsx.writeBuffer();

                    // Save color version (keep naming), then printout
                    let savedColor = await saveBytesToMonthFolder(fileName, bufferColor);
                    if (!savedColor) {
                        const pickerResult = await saveExcelWithSaveFilePicker(fileName, bufferColor);
                        if (pickerResult.cancelled) saveCancelled = true;
                        else {
                            savedColor = pickerResult.saved;
                            if (!savedColor) downloadBytes(fileName, bufferColor);
                        }
                    }
                    if (savedColor) fileWasSaved = true;

                    if (!saveCancelled) {
                        let savedPrint = await saveBytesToMonthFolder(printoutFileName, bufferPrint);
                        if (!savedPrint) {
                            const pickerResult = await saveExcelWithSaveFilePicker(printoutFileName, bufferPrint);
                            if (!pickerResult.cancelled) {
                                savedPrint = pickerResult.saved;
                                if (!savedPrint) downloadBytes(printoutFileName, bufferPrint);
                            }
                        }
                        if (savedPrint) fileWasSaved = true;
                    }
                } else {
                    // If possible, save into a "<MMM> <YY>" subfolder inside a user-picked base folder
                    await pickOrCreateMonthFolder();

                    const buildSheetJSWorkbook = ({ printout = false } = {}) => {
                        const wb = XLSX.utils.book_new();
                        const palette = printout ? {
                            titleFill: '404040',
                            titleFont: 'FFFFFF',
                            headerFill: '404040',
                            headerFont: 'FFFFFF',
                            day: {
                                'normal-day':      { fill: 'FFFFFF', font: '000000' },
                                'semi-normal-day': { fill: 'AEAEAE', font: '000000' },
                                'weekend-holiday': { fill: '7B7B7B', font: 'FFFFFF' },
                                'special-holiday': { fill: '404040', font: 'FFFFFF' },
                                'special':         { fill: '404040', font: 'FFFFFF' }
                            },
                            right: {
                                normal:  { fill: 'FFFFFF', font: '000000' },
                                semi:    { fill: 'AEAEAE', font: '000000' },
                                weekend: { fill: '7B7B7B', font: 'FFFFFF' },
                                special: { fill: '404040', font: 'FFFFFF' }
                            }
                        } : null;

                        const formatDateGreekAbbrSheet = (date) => {
                            const day = date.getDate();
                            const monthAbbr = ['ΙΑΝ', 'ΦΕΒ', 'ΜΑΡ', 'ΑΠΡ', 'ΜΑΪ', 'ΙΟΥΝ', 'ΙΟΥΛ', 'ΑΥΓ', 'ΣΕΠ', 'ΟΚΤ', 'ΝΟΕ', 'ΔΕΚ'];
                            return `${day} ${monthAbbr[date.getMonth()]} ${date.getFullYear()}`;
                        };

                        for (const groupNum of groupNumbersToProcess) {
                            const groupName = getGroupName(groupNum);
                            const groupData = groups[groupNum];
                            const data = [];
                            const rowDayTypes = [];
                            const today = new Date();
                            const formattedDate = formatDateGreekAbbrSheet(today);
                            data.push(['', '', '', '', '', '', '', '', `55 ΣΜ. ΜΑΧΗΣ\nΜΣΑ\nΤΜ. ΠΡΟΣΩΠΙΚΟΥ\nΤΙΜΗ, ${formattedDate}`]);
                            rowDayTypes.push(null);
                            data.push([`ΥΠΗΡΕΣΙΑ ${groupName} ΜΗΝΟΣ ${monthName.toUpperCase()} ${year}`]);
                            rowDayTypes.push(null);
                            data.push([]);
                            rowDayTypes.push(null);
                            data.push(['ΗΜΕΡ.', 'ΗΜΕΡΑ', 'ΟΝΟΜΑΤΕΠΩΝΥΜΟ', 'ΑΛΛΑΓΕΣ']);
                            rowDayTypes.push(null);
                            for (let day = 1; day <= daysInMonth; day++) {
                                const date = new Date(year, month, day);
                                const dayKey = formatDateKey(date);
                                const dayType = getDayType(date);
                                const dayName = getGreekDayNameUppercase(date);
                                const assignment = (typeof getAssignmentForDate === 'function' ? getAssignmentForDate(dayKey) : null) ?? (dutyAssignments?.[dayKey] || '');
                                const personName = getAssignedPersonNameForGroupFromAssignment(assignment, groupNum);
                                const dateStr = `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;
                                data.push([dateStr, dayName, personName, '', '', '', '', '']);
                                rowDayTypes.push(dayType);
                            }
                            data.push(['', '', '', '', '', '', '', '']);
                            rowDayTypes.push(null);
                            data.push(['', 'Ο', '', '', '', '', '', '']);
                            data.push(['', 'ΣΥΝΤΑΞΑΣ', '', '', '', '', '', '']);
                            const sigRow1Idx = data.length - 2;
                            const sigRow2Idx = data.length - 1;
                            data[sigRow1Idx][7] = 'ΕΘ-ΘΗ';
                            data[sigRow2Idx][7] = 'Ο';
                            data.push(['', '', '', '', '', '', '', 'ΔΚΤΗΣ']);
                            rowDayTypes.push(null, null, null);

                            const rotationInfo = getNextTwoRotationPeopleForCurrentMonth({ year, month, daysInMonth, groupNum, groupData, dutyAssignments });
                            const rightRows = [
                                { row: 5, text: 'ΑΝΑΠΛΗΡΩΜΑΤΙΚΟΙ', kind: 'title' },
                                { row: 7, text: 'ΚΑΘΗΜΕΡΙΝΕΣ', kind: 'normalHeader' },
                                { row: 8, text: rotationInfo.next.normal[0] || '', kind: 'normal' },
                                { row: 9, text: rotationInfo.next.normal[1] || '', kind: 'normal' },
                                { row: 11, text: 'ΗΜΙΑΡΓΙΕΣ', kind: 'semiHeader' },
                                { row: 12, text: rotationInfo.next.semi[0] || '', kind: 'semi' },
                                { row: 13, text: rotationInfo.next.semi[1] || '', kind: 'semi' },
                                { row: 15, text: 'ΑΡΓΙΕΣ', kind: 'weekendHeader' },
                                { row: 16, text: rotationInfo.next.weekend[0] || '', kind: 'weekend' },
                                { row: 17, text: rotationInfo.next.weekend[1] || '', kind: 'weekend' },
                                { row: 19, text: 'ΕΙΔΙΚΕΣ ΑΡΓΙΕΣ', kind: 'specialHeader' },
                                { row: 20, text: rotationInfo.next.special[0] || '', kind: 'special' },
                                { row: 21, text: rotationInfo.next.special[1] || '', kind: 'special' },
                                { row: 22, text: rotationInfo.next.special[2] || '', kind: 'special' }
                            ];
                            const rightNotes = [
                                { row: 20, text: rotationInfo.nextNotes?.special?.[0] || '', kind: 'specialNote' },
                                { row: 21, text: rotationInfo.nextNotes?.special?.[1] || '', kind: 'specialNote' },
                                { row: 22, text: rotationInfo.nextNotes?.special?.[2] || '', kind: 'specialNote' }
                            ];

                            const ws = XLSX.utils.aoa_to_sheet(data);
                            ws['!cols'] = [{ wch: 14 }, { wch: 17 }, { wch: 57 }, { wch: 56.5 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 53 }, { wch: 21 }];
                            if (!ws['!merges']) ws['!merges'] = [];
                            ws['!merges'].push({ s: { r: 1, c: 0 }, e: { r: 1, c: 8 } });
                            ws['!rows'] = Array.from({ length: data.length }, () => ({ hpt: 23 }));
                            ws['!margins'] = { left: 0.12, right: 0.12, top: 0.12, bottom: 0.12, header: 0.20, footer: 0.20 };

                            const i1Cell = 'I1';
                            if (!ws[i1Cell]) ws[i1Cell] = { t: 's', v: data[0][8] || '' };
                            if (!ws[i1Cell].s) ws[i1Cell].s = {};
                            ws[i1Cell].s.font = { name: 'Arial', bold: true, sz: 12, color: { rgb: '000000' } };
                            ws[i1Cell].s.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };

                            const titleCell = 'A2';
                            if (!ws[titleCell]) ws[titleCell] = { t: 's', v: data[1][0] || '' };
                            if (!ws[titleCell].s) ws[titleCell].s = {};
                            ws[titleCell].s.font = { name: 'Arial', bold: true, sz: 16, color: { rgb: palette ? palette.titleFont : 'FFFFFF' } };
                            ws[titleCell].s.fill = { fgColor: { rgb: palette ? palette.titleFill : '428BCA' }, patternType: 'solid' };
                            ws[titleCell].s.alignment = { horizontal: 'center', vertical: 'center' };

                            const headerRow = 3;
                            ['A', 'B', 'C', 'D'].forEach((col, idx) => {
                                const cellRef = col + (headerRow + 1);
                                if (!ws[cellRef]) ws[cellRef] = { t: 's', v: data[headerRow][idx] || '' };
                                if (!ws[cellRef].s) ws[cellRef].s = {};
                                ws[cellRef].s.font = { name: 'Arial', bold: true, sz: 16, color: { rgb: palette ? palette.headerFont : 'FFFFFF' } };
                                ws[cellRef].s.fill = { fgColor: { rgb: palette ? palette.headerFill : '428BCA' }, patternType: 'solid' };
                                ws[cellRef].s.alignment = { horizontal: 'center', vertical: 'center' };
                            });

                            const dayTypeToRgb = (dayType) => getDayTypeColor(dayType).map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
                            const normalRgb = palette ? palette.right.normal.fill : dayTypeToRgb('normal-day');
                            const semiRgb = palette ? palette.right.semi.fill : dayTypeToRgb('semi-normal-day');
                            const weekendRgb = palette ? palette.right.weekend.fill : dayTypeToRgb('weekend-holiday');
                            const specialRgb = palette ? palette.right.special.fill : 'FF00FF';

                            const styleCell = (addr, { bold = false, center = false, fillRgb = null, fontRgb = '000000', sz = 14, wrap = false } = {}) => {
                                if (!ws[addr]) ws[addr] = { t: 's', v: '' };
                                if (!ws[addr].s) ws[addr].s = {};
                                ws[addr].s.font = { name: 'Arial', bold: !!bold, sz: sz, color: { rgb: fontRgb } };
                                ws[addr].s.alignment = { horizontal: center ? 'center' : 'left', vertical: 'center', wrapText: !!wrap };
                                if (fillRgb) ws[addr].s.fill = { fgColor: { rgb: fillRgb }, patternType: 'solid' };
                            };

                            rightRows.forEach(rr => {
                                const hAddr = 'H' + (rr.row + 1);
                                if (!ws[hAddr]) ws[hAddr] = { t: 's', v: rr.text || '' };
                                else ws[hAddr].v = rr.text || '';
                                const kind = rr.kind || '';
                                if (kind === 'title') styleCell(hAddr, { bold: true, center: true, fontRgb: '000000' });
                                else if (kind.startsWith('normal')) styleCell(hAddr, { bold: kind.endsWith('Header'), center: kind.endsWith('Header'), fillRgb: normalRgb, fontRgb: palette ? palette.right.normal.font : '000000' });
                                else if (kind.startsWith('semi')) styleCell(hAddr, { bold: kind.endsWith('Header'), center: kind.endsWith('Header'), fillRgb: semiRgb, fontRgb: palette ? palette.right.semi.font : '000000' });
                                else if (kind.startsWith('weekend')) styleCell(hAddr, { bold: kind.endsWith('Header'), center: kind.endsWith('Header'), fillRgb: weekendRgb, fontRgb: palette ? palette.right.weekend.font : '000000' });
                                else if (kind.startsWith('special')) styleCell(hAddr, { bold: kind.endsWith('Header'), center: kind.endsWith('Header'), fillRgb: specialRgb, fontRgb: palette ? palette.right.special.font : '000000' });
                            });
                            rightNotes.forEach(rr => {
                                const iAddr = 'I' + (rr.row + 1);
                                if (!ws[iAddr]) ws[iAddr] = { t: 's', v: rr.text || '' };
                                else ws[iAddr].v = rr.text || '';
                                styleCell(iAddr, {
                                    bold: false,
                                    center: false,
                                    fillRgb: palette ? palette.right.special.fill : 'FFFFFF',
                                    fontRgb: palette ? palette.right.special.font : '000000',
                                    sz: 10,
                                    wrap: true
                                });
                            });

                            // Signature cells (Ο ΣΥΝΤΑΞΑΣ, ΕΘ-ΘΗ, Ο ΔΚΤΗΣ): bold Arial 14
                            ['B', 'H'].forEach(col => {
                                [sigRow1Idx + 1, sigRow2Idx + 1].forEach(r1 => {
                                    const addr = col + r1;
                                    if (!ws[addr]) ws[addr] = { t: 's', v: '' };
                                    if (!ws[addr].s) ws[addr].s = {};
                                    ws[addr].s.font = { name: 'Arial', bold: true, sz: 14, color: { rgb: '000000' } };
                                    ws[addr].s.alignment = { horizontal: 'center', vertical: 'center' };
                                });
                            });
                            const sigRow3Addr = 'H' + (sigRow2Idx + 2);
                            if (!ws[sigRow3Addr]) ws[sigRow3Addr] = { t: 's', v: '' };
                            if (!ws[sigRow3Addr].s) ws[sigRow3Addr].s = {};
                            ws[sigRow3Addr].s.font = { name: 'Arial', bold: true, sz: 14, color: { rgb: '000000' } };
                            ws[sigRow3Addr].s.alignment = { horizontal: 'center', vertical: 'center' };
                            ws['!cols'][7] = { wch: 53 };  // column H

                            for (let rowIdx = 4; rowIdx < rowDayTypes.length; rowIdx++) {
                                const dayType = rowDayTypes[rowIdx];
                                if (!dayType) continue;
                                const fillRgb = palette ? (palette.day[dayType] || palette.day['normal-day']).fill : dayTypeToRgb(dayType);
                                const fontRgb = palette ? (palette.day[dayType] || palette.day['normal-day']).font : '000000';
                                const excelRow = rowIdx + 1;
                                ['A', 'B', 'C', 'D'].forEach((col, colIdx) => {
                                    const cellRef = col + excelRow;
                                    if (!ws[cellRef]) ws[cellRef] = { t: 's', v: data[rowIdx] ? (data[rowIdx][colIdx] || '') : '' };
                                    if (!ws[cellRef].s) ws[cellRef].s = {};
                                    ws[cellRef].s.fill = { fgColor: { rgb: fillRgb }, patternType: 'solid' };
                                    ws[cellRef].s.font = { name: 'Arial', sz: 14, color: { rgb: fontRgb } };
                                    ws[cellRef].s.alignment = { horizontal: (colIdx === 0 || colIdx === 1) ? 'center' : 'left', vertical: 'center' };
                                });
                            }

                            XLSX.utils.book_append_sheet(wb, ws, safeSheetName(groupName));
                        }

                        return wb;
                    };

                    const fileName = buildExcelFilename(monthName, year);
                    const printoutFileName = buildExcelPrintoutFilename(monthName, year);

                    const wbColor = buildSheetJSWorkbook({ printout: false });
                    const outColor = XLSX.write(wbColor, { bookType: 'xlsx', type: 'array' });
                    const wbPrint = buildSheetJSWorkbook({ printout: true });
                    const outPrint = XLSX.write(wbPrint, { bookType: 'xlsx', type: 'array' });

                    let savedColor = await saveBytesToMonthFolder(fileName, outColor);
                    if (!savedColor) {
                        const pickerResult = await saveExcelWithSaveFilePicker(fileName, outColor);
                        if (pickerResult.cancelled) saveCancelled = true;
                        else {
                            savedColor = pickerResult.saved;
                            if (!savedColor) downloadBytes(fileName, outColor);
                        }
                    }
                    if (savedColor) fileWasSaved = true;

                    if (!saveCancelled) {
                        let savedPrint = await saveBytesToMonthFolder(printoutFileName, outPrint);
                        if (!savedPrint) {
                            const pickerResult = await saveExcelWithSaveFilePicker(printoutFileName, outPrint);
                            if (!pickerResult.cancelled) {
                                savedPrint = pickerResult.saved;
                                if (!savedPrint) downloadBytes(printoutFileName, outPrint);
                            }
                        }
                        if (savedPrint) fileWasSaved = true;
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
                
                if (saveCancelled) {
                    // User cancelled the save dialog; no file saved, no alert
                } else if (fileWasSaved) {
                    alert(monthDirHandle
                        ? `Το Excel αρχείο (με ${groupNumbersToProcess.length} καρτέλες) αποθηκεύτηκε στον φάκελο "${monthFolderName}".`
                        : 'Το Excel αρχείο δημιουργήθηκε επιτυχώς (μία καρτέλα ανά ομάδα)!');
                }
            } catch (error) {
                console.error('Error generating Excel files:', error);
                alert('Σφάλμα κατά τη δημιουργία του Excel αρχείου: ' + error.message);
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
                        // If it's an object like { groupNum: personName }, return it directly
                        const persons = [];
                        for (const key of Object.keys(assignment)) {
                            const g = parseInt(key, 10);
                            const name = assignment[key];
                            if (!Number.isNaN(g) && name) {
                                persons.push({ name: String(name).trim(), group: g });
                            }
                        }
                        return persons;
                    }
                } else {
                    // Try to convert to string
                    assignmentStr = String(assignment);
                }
            }
            
            // Match all patterns like "Name (Ομάδα X)"
            // NOTE: do NOT use String.prototype.matchAll here (some WebViews lack it).
            const persons = [];
            const re = /([^(]+)\s*\(Ομάδα\s*(\d+)\)/g;
            let match;
            while ((match = re.exec(assignmentStr)) !== null) {
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

        // Apply custom calendar cell height from input and persist to localStorage
        const CALENDAR_CELL_HEIGHT_KEY = 'dutyShiftsCalendarCellHeight';
        function applyCalendarCellHeight() {
            const inp = document.getElementById('calendarCellHeight');
            if (!inp) return;
            let val = parseFloat(inp.value);
            if (isNaN(val) || val < 2) val = 2;
            if (val > 16) val = 16;
            inp.value = val;
            document.documentElement.style.setProperty('--calendar-cell-height', val + 'rem');
            try { localStorage.setItem(CALENDAR_CELL_HEIGHT_KEY, String(val)); } catch (_) {}
        }
        function restoreCalendarCellHeight() {
            try {
                const stored = localStorage.getItem(CALENDAR_CELL_HEIGHT_KEY);
                if (stored !== null) {
                    const val = parseFloat(stored);
                    if (!isNaN(val) && val >= 2 && val <= 16) {
                        document.documentElement.style.setProperty('--calendar-cell-height', val + 'rem');
                        const inp = document.getElementById('calendarCellHeight');
                        if (inp) inp.value = val;
                    }
                }
            } catch (_) {}
        }
        if (typeof window !== 'undefined') {
            window.applyCalendarCellHeight = applyCalendarCellHeight;
        }

        // Render calendar (hierarchy / calendar popups live in duty-shifts-ui.js)

        // Get day type label
        
        // Helper function to check if two dates are in the same week
        // Week starts on Monday (ISO 8601 standard)
        // Helper function to check if a date is in the week after next (not next week, but the one after)
        
        // Helper function to ask user permission for conflicts, swaps, or skips
        
        // Check if two dates are in the same month
        
        
        // Helper function to get week start (Monday) for a date
        
        // Helper function to calculate rotation position based on days since start date
        // Uses calculationSteps.startDate if available, otherwise defaults to February 2026
        // Returns the rotation position (0-based index) for a given date and day type
        
        // Helper function to store assignment reason



        // Build swap reason in Greek.


        // Return the adjacent day (before/after) that causes the consecutive-duty conflict.
        // Prefers the "after" day when both sides conflict (matches user expectation like Thu conflict with Fri -> show Fri).
        // Returns null if no adjacent conflict is detected.
        
        // Helper function to get assignment reason

        // Previous month

        // Next month

        // Check if a person has duty on a specific day

        // Check if a person has duty on consecutive days (day before or day after)
        // Enhanced version that can check against simulated assignments (for preview)
        // Enhanced conflict rules (all combinations checked):
        // - Normal ↔ Semi-normal (before and after)
        // - Normal ↔ Weekend (before and after)
        // - Normal ↔ Special (before and after)
        // - Semi-normal ↔ Weekend (before and after)
        // - Semi-normal ↔ Special (before and after)


        // Check if person should be skipped from weekend/holiday duty due to special holiday duty
        // Logic:
        // 1. Find last weekend/holiday duty for the person
        // 2. Calculate what the next weekend/holiday duty should be (based on N-day rotation)
        // 3. Check if there's a special holiday duty between last weekend duty and the calculated next weekend duty
        // 4. If yes, skip the calculated next weekend duty
        // 5. Count N weekends from the day AFTER the skipped weekend
        // 6. If current day is the skipped weekend, return true to skip it

        // Check if person had duty on consecutive weekend/holiday days
        // If so, skip them from the next weekend/holiday
        // DISABLED: This logic was causing incorrect swaps on 01/02/26, 08/02/26, and 26/02/2026
        // TODO: Re-implement with corrected logic if needed

        // Check if person had duty on consecutive special holidays
        // If so, skip them from the next special holiday

        // Check if person has special holiday duty in a given month

        // Helper function to get a person from next month's rotation when conflicts occur at end of month
        // This temporarily calculates the next month to find the correct person according to rotation logic
        // For normal days, follows swap logic: Monday↔Wednesday, Tuesday↔Thursday
        // REMOVED: getPersonFromNextMonth function - cross-month swaps are no longer supported
        function _removed_getPersonFromNextMonth(dayKey, dayTypeCategory, groupNum, currentMonth, currentYear, rotationDays, groupPeople, currentRotationPosition = null) {
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
                if (nextMonthPerson && !isPersonMissingOnDate(nextMonthPerson, groupNum, date, 'normal')) {
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
            if (nextMonthPerson && !isPersonMissingOnDate(nextMonthPerson, groupNum, date, dayTypeCategory)) {
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
            
            if (startMonthInput) {
                startMonthInput.value = `${currentYear}-${currentMonth}`;
            }
            for (let g = 1; g <= 4; g++) {
                const stripCb = document.getElementById(`calcStripManualOverridesG${g}`);
                if (stripCb) stripCb.checked = false;
                const lab = document.getElementById(`calcStripGroupLabel${g}`);
                if (lab && typeof getGroupName === 'function') {
                    try {
                        lab.textContent = getGroupName(g);
                    } catch (_) {
                        lab.textContent = `Ομάδα ${g}`;
                    }
                }
            }

            // Make month picker open when clicking anywhere on the month fields (label/container too)
            ensureMonthPickerClickTargets();
            
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

        let monthPickerClickTargetsInstalled = false;
        function ensureMonthPickerClickTargets() {
            if (monthPickerClickTargetsInstalled) return;
            monthPickerClickTargetsInstalled = true;

            const installFor = (inputId) => {
                const input = document.getElementById(inputId);
                if (!input) return;

                const openPicker = () => {
                    try {
                        input.focus({ preventScroll: true });
                    } catch (_) {
                        input.focus();
                    }
                    if (typeof input.showPicker === 'function') {
                        try {
                            input.showPicker();
                        } catch (_) {
                            // ignore (some browsers require user gesture; focus is still helpful)
                        }
                    }
                };

                // If the user clicks the input itself, try to open immediately.
                input.addEventListener('click', () => openPicker());
                // Some browsers open picker on focus; this makes it consistent.
                input.addEventListener('focus', () => {
                    if (typeof input.showPicker === 'function') {
                        try { input.showPicker(); } catch (_) {}
                    }
                });

                // Expand click target to the entire field block (label + help text + surrounding area)
                const container = input.closest('.mb-3') || input.parentElement;
                if (container) {
                    container.addEventListener('click', (e) => {
                        if (e.target === input) return;
                        openPicker();
                    });
                }
            };

            installFor('calculateStartMonth');
        }

        // Calculate duties for selected months
        
        // Show step-by-step calculation modal

        // Render current step content


        // Step 1: Check and show special holidays

        // Step 1 results modal: show baseline vs computed changes (missing replacements) for special holidays
        function showSpecialHolidayResultsAndProceed() {
            try {
                const dayTypeLists = calculationSteps.dayTypeLists || { special: [] };
                const specialHolidays = (dayTypeLists.special || []).slice().sort();
                const baselineByDate = calculationSteps.tempSpecialBaselineAssignments || {};
                const computedByDate = calculationSteps.tempSpecialAssignments || {};

                // Build rows where baseline != computed
                const changes = [];
                for (const dateKey of specialHolidays) {
                    const date = new Date(dateKey + 'T00:00:00');
                    if (isNaN(date.getTime())) continue;

                    // Holiday name (same logic as Step 1 table)
                    let holidayName = '';
                    const year = date.getFullYear();
                    const month = date.getMonth() + 1;
                    const day = date.getDate();
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

                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        const base = baselineByDate?.[dateKey]?.[groupNum] || null;
                        const comp = computedByDate?.[dateKey]?.[groupNum] || null;
                        if (!base || !comp) continue;
                        if (base === comp) continue;

                        let reason = '';
                        if (isPersonDisabledForDuty(base, groupNum, 'special') || isPersonMissingOnDate(base, groupNum, date, 'special')) {
                            // Keep the same style as other steps: show the first sentence (without "Ανατέθηκε...")
                            reason = buildUnavailableReplacementReason({
                                skippedPersonName: base,
                                replacementPersonName: comp,
                                dateObj: date,
                                groupNum,
                                dutyCategory: 'special'
                            }) || '';
                        } else {
                            reason = 'Αλλαγή (κανόνας/σύγκρουση)';
                        }

                        changes.push({
                            dateKey,
                            dateStr: date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                            dayName: getGreekDayName(date),
                            holidayName: holidayName || 'Ειδική Αργία',
                            groupNum,
                            groupName: getGroupName(groupNum),
                            baseline: base,
                            computed: comp,
                            reason
                        });
                    }
                }

                let message = '';
                if (changes.length === 0) {
                    message = '<div class="alert alert-success"><i class="fas fa-check-circle me-2"></i><strong>Καμία αλλαγή!</strong><br>Δεν βρέθηκαν αντικαταστάσεις λόγω κωλύματος στις ειδικές αργίες.</div>';
                } else {
                    message = `<div class="alert alert-info"><i class="fas fa-info-circle me-2"></i><strong>Βρέθηκαν ${changes.length} αντικαταστάσεις στις ειδικές αργίες:</strong></div>`;
                    message += '<div class="table-responsive"><table class="table table-sm table-bordered">';
                    message += '<thead><tr><th>Ημερομηνία</th><th>Υπηρεσία</th><th>Παραλείφθηκε</th><th>Αντικαταστάθηκε από</th><th>Ημερομηνία Αλλαγής</th><th>Λόγος</th></tr></thead><tbody>';
                    for (const c of changes) {
                        const service = getGroupName(c.groupNum);
                        message += `<tr>
                            <td>${c.dayName} ${c.dateStr}</td>
                            <td>${service}</td>
                            <td><strong>${c.baseline}</strong></td>
                            <td><strong>${c.computed}</strong></td>
                            <td>-</td>
                            <td>${c.reason}</td>
                        </tr>`;
                    }
                    message += '</tbody></table></div>';
                }

                const modalHtml = `
                    <div class="modal fade" id="specialHolidayResultsModal" tabindex="-1">
                    <div class="modal-dialog modal-xl modal-superwide">
                            <div class="modal-content results-modal-special">
                                <div class="modal-header results-header results-header-special">
                                    <h5 class="modal-title"><i class="fas fa-star me-2"></i>Αποτελέσματα Αλλαγών Ειδικών Αργιών</h5>
                                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                                </div>
                                <div class="modal-body">
                                    ${message}
                                </div>
                                <div class="modal-footer">
                                    <button type="button" class="btn btn-secondary" id="specialHolidayCancelButton" data-bs-dismiss="modal">Ακύρωση</button>
                                    <button type="button" class="btn btn-primary" id="specialHolidayOkButton">OK</button>
                                </div>
                            </div>
                        </div>
                    </div>
                `;

                const existingModal = document.getElementById('specialHolidayResultsModal');
                if (existingModal) existingModal.remove();
                document.body.insertAdjacentHTML('beforeend', modalHtml);

                const modal = new bootstrap.Modal(document.getElementById('specialHolidayResultsModal'));
                modal.show();

                const okButton = document.getElementById('specialHolidayOkButton');
                const cancelButton = document.getElementById('specialHolidayCancelButton');
                if (okButton) {
                    okButton.addEventListener('click', async function() {
                        const originalOkHtml = okButton.innerHTML;
                        okButton.disabled = true;
                        okButton.classList.add('is-saving');
                        if (cancelButton) cancelButton.disabled = true;
                        okButton.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Αποθήκευση...`;
                        setStepFooterBusy(true);
                        try {
                            await saveStep1_SpecialHolidays();
                            calculationSteps.currentStep = 2;
                            renderCurrentStep();
                            const m = bootstrap.Modal.getInstance(document.getElementById('specialHolidayResultsModal'));
                            if (m) m.hide();
                        } finally {
                            requestAnimationFrame(() => setStepFooterBusy(false));
                            okButton.innerHTML = originalOkHtml;
                            okButton.classList.remove('is-saving');
                            okButton.disabled = false;
                            if (cancelButton) cancelButton.disabled = false;
                        }
                    });
                }
            } catch (error) {
                console.error('Error showing special holiday results:', error);
                alert('Σφάλμα κατά την εμφάνιση αποτελεσμάτων ειδικών αργιών: ' + error.message);
            }
        }

        // Navigation functions
        
        // Save Step 1 (Special Holidays) assignments to Firestore
        
        // Save Step 2 (Weekends) assignments to Firestore and run skip logic
        
        // Run skip logic for weekends and show popup with results
        
        // Show popup with weekend skip results
        function showWeekendSkipResults(skippedPeople, updatedAssignments) {
            const findSwapOtherDateKey = (swapPairIdRaw, groupNum, currentDateKey) => {
                if (swapPairIdRaw === null || swapPairIdRaw === undefined) return null;
                const swapPairId = typeof swapPairIdRaw === 'number' ? swapPairIdRaw : parseInt(swapPairIdRaw);
                if (isNaN(swapPairId)) return null;
                for (const dk in assignmentReasons) {
                    if (dk === currentDateKey) continue;
                    const gmap = assignmentReasons?.[dk]?.[groupNum];
                    if (!gmap) continue;
                    for (const pn in gmap) {
                        const r = gmap[pn];
                        const rid = r?.swapPairId;
                        const nid = typeof rid === 'number' ? rid : parseInt(rid);
                        if (!isNaN(nid) && nid === swapPairId) return dk;
                    }
                }
                return null;
            };

            let message = '';
            
            const baselineByDate = calculationSteps.tempWeekendBaselineAssignments || {};
            const computedByDate = updatedAssignments || {};

            const rows = [];
            const dateKeys = Object.keys(computedByDate).sort();
            for (const dateKey of dateKeys) {
                const dateObj = new Date(dateKey + 'T00:00:00');
                if (isNaN(dateObj.getTime())) continue;
                const dateStr = dateObj.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const dayName = getGreekDayName(dateObj);
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const base = baselineByDate?.[dateKey]?.[groupNum] || null;
                    const comp = computedByDate?.[dateKey]?.[groupNum] || null;
                    if (!base || !comp) continue;
                    if (base === comp) continue;

                    const reasonObj = assignmentReasons?.[dateKey]?.[groupNum]?.[comp] || null;
                    const reasonText = reasonObj?.reason
                        ? String(reasonObj.type === 'swap' ? normalizeSwapReasonText(reasonObj.reason) : reasonObj.reason)
                        : '';
                    const derivedUnavailable = (isPersonDisabledForDuty(base, groupNum, 'weekend') || isPersonMissingOnDate(base, groupNum, dateObj, 'weekend'))
                        ? (reasonText || buildUnavailableReplacementReason({
                            skippedPersonName: base,
                            replacementPersonName: comp,
                            dateObj,
                            groupNum,
                            dutyCategory: 'weekend'
                        }))
                        : '';
                    // Ενιαίο μήνυμα όταν ο παραλειφθείς έχει ήδη ειδική αργία τον ίδιο μήνα (Σαββατοκύριακο).
                    let briefReason = '';
                    if (derivedUnavailable) {
                        briefReason = derivedUnavailable;
                    } else if (hasSpecialHolidayDutyInMonthCalcOrSaved(base, groupNum, dateObj.getMonth(), dateObj.getFullYear())) {
                        briefReason =
                            typeof buildSpecialHolidaySameMonthUnifiedMessage === 'function'
                                ? buildSpecialHolidaySameMonthUnifiedMessage(
                                      comp,
                                      dateKey,
                                      base,
                                      groupNum,
                                      dateObj.getFullYear(),
                                      dateObj.getMonth()
                                  ) || (reasonText ? reasonText.split('.').filter(Boolean)[0] : '')
                                : (reasonText ? reasonText.split('.').filter(Boolean)[0] : '');
                    } else if (reasonText) {
                        briefReason = reasonText.split('.').filter(Boolean)[0] || '';
                    } else {
                        briefReason = 'Αλλαγή';
                    }

                    // Weekend skip has no swap-date; keep '-' (but support future swapPairId logic if it appears)
                    const swapOtherKey = reasonObj?.type === 'swap'
                        ? findSwapOtherDateKey(reasonObj.swapPairId, groupNum, dateKey)
                        : null;
                    const swapDateStr = swapOtherKey
                        ? new Date(swapOtherKey + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : '-';

                    rows.push({
                        dateKey,
                        dayName,
                        dateStr,
                        groupNum,
                        service: getGroupName(groupNum),
                        skipped: base,
                        replacement: comp,
                        swapDateStr,
                        briefReason
                    });
                }
            }

            if (rows.length === 0) {
                message = '<div class="alert alert-success"><i class="fas fa-check-circle me-2"></i><strong>Καμία αλλαγή!</strong><br>Δεν βρέθηκαν αλλαγές στις αργίες.</div>';
            } else {
                message = '<div class="alert alert-info"><i class="fas fa-info-circle me-2"></i><strong>Αλλαγές: ' + rows.length + ' εγγραφές</strong></div>';
                message += '<div class="table-responsive"><table class="table table-sm table-bordered">';
                message += '<thead><tr><th>Ημερομηνία</th><th>Υπηρεσία</th><th>Παραλείφθηκε</th><th>Αντικαταστάθηκε από</th><th>Ημερομηνία Αλλαγής</th><th>Λόγος</th></tr></thead><tbody>';
                
                rows.forEach(r => {
                    message += `<tr>
                        <td>${r.dayName} ${r.dateStr}</td>
                        <td>${r.service}</td>
                        <td><strong>${r.skipped}</strong></td>
                        <td><strong>${r.replacement}</strong></td>
                        <td>${r.swapDateStr}</td>
                        <td>${r.briefReason}</td>
                    </tr>`;
                });
                
                message += '</tbody></table></div>';
            }
            
            // Create and show modal
            const modalHtml = `
                <div class="modal fade" id="weekendSkipResultsModal" tabindex="-1">
                    <div class="modal-dialog modal-xl modal-superwide">
                        <div class="modal-content results-modal-weekend">
                            <div class="modal-header results-header results-header-weekend">
                                <h5 class="modal-title"><i class="fas fa-exchange-alt me-2"></i>Αποτελέσματα Αλλαγών Παραλείψεων Σαββατοκύριακων</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                            </div>
                            <div class="modal-body">
                                ${message}
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-primary" id="weekendSkipOkButton">OK</button>
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
                    const originalOkHtml = okButton.innerHTML;
                    okButton.disabled = true;
                    okButton.classList.add('is-saving');
                    okButton.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Αποθήκευση...`;
                    setStepFooterBusy(true);
                    try {
                        await saveFinalWeekendAssignments(updatedAssignments);
                        // Proceed to Step 3
                        calculationSteps.currentStep = 3;
                        renderCurrentStep();
                        const m = bootstrap.Modal.getInstance(document.getElementById('weekendSkipResultsModal'));
                        if (m) m.hide();
                    } finally {
                        requestAnimationFrame(() => setStepFooterBusy(false));
                        okButton.innerHTML = originalOkHtml;
                        okButton.classList.remove('is-saving');
                        okButton.disabled = false;
                    }
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
                    
                    await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'weekendAssignments', organizedWeekend);
                    console.log('Saved Step 2 final weekend assignments (after skip logic) to weekendAssignments document');
                    
                    // Update local memory
                    Object.assign(weekendAssignments, formattedAssignments);
                    
                    // IMPORTANT: Update rotation positions based on FINAL assignments (after skip logic)
                    // This ensures that when Person A is replaced by Person B, next calculation starts from Person B's position
                    // Group assignments by month and find the last assigned person for each month/group
                    const finalWeekendRotationPositionsByMonth = {}; // monthKey -> { groupNum -> assignedPerson }
                    const sortedDateKeys = Object.keys(updatedAssignments).sort();
                    for (const dateKey of sortedDateKeys) {
                        const d = new Date(dateKey + 'T00:00:00');
                        if (isNaN(d.getTime())) continue;
                        const monthKey = getMonthKeyFromDate(d);
                        const groups = updatedAssignments[dateKey];
                        if (!groups) continue;
                        
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            const assignedPerson = groups[groupNum];
                            if (assignedPerson) {
                                if (!finalWeekendRotationPositionsByMonth[monthKey]) {
                                    finalWeekendRotationPositionsByMonth[monthKey] = {};
                                }
                                const personForRotation = typeof getPersonForRotationContinuity === 'function'
                                    ? getPersonForRotationContinuity(dateKey, groupNum, assignedPerson, updatedAssignments)
                                    : assignedPerson;
                                finalWeekendRotationPositionsByMonth[monthKey][groupNum] = personForRotation;
                            }
                        }
                    }
                    
                    // Update lastRotationPositions with final assigned persons (after skip logic)
                    if (Object.keys(finalWeekendRotationPositionsByMonth).length > 0) {
                        for (const monthKey in finalWeekendRotationPositionsByMonth) {
                            const groupsForMonth = finalWeekendRotationPositionsByMonth[monthKey] || {};
                            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                                if (groupsForMonth[groupNum] !== undefined) {
                                    setLastRotationPersonForMonth('weekend', monthKey, groupNum, groupsForMonth[groupNum]);
                                }
                            }
                        }
                        
                        // Save updated rotation positions to Firestore
                        try {
                            const sanitizedPositions = sanitizeForFirestore(lastRotationPositions);
                            await db.collection('dutyShifts').doc('lastRotationPositions').set({
                                ...sanitizedPositions,
                                lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                                updatedBy: user.uid
                            });
                            console.log('Updated last rotation positions for weekends (after skip logic) to Firestore:', finalWeekendRotationPositionsByMonth);
                        } catch (error) {
                            console.error('Error saving updated last rotation positions after weekend skip logic:', error);
                        }
                    }
                }
            } catch (error) {
                console.error('Error saving final weekend assignments:', error);
            }
        }
        
        // Save Step 3 (Semi-Normal) assignments to Firestore and run swap logic
        
        // Run swap logic for semi-normal days and show popup with results
        
        // Show popup with semi-normal swap results
        
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
                    
                    await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'semiNormalAssignments', organizedSemi);
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
                    
                    // IMPORTANT: Update rotation positions based on FINAL assignments (after swaps)
                    // This ensures that when Person A is replaced by Person B, next calculation starts from Person B's position
                    // Group assignments by month and find the last assigned person for each month/group (chronologically)
                    const finalSemiRotationPositionsByMonth = {}; // monthKey -> { groupNum -> assignedPerson }
                    const sortedDateKeys = Object.keys(updatedAssignments).sort();
                    for (const dateKey of sortedDateKeys) {
                        const d = new Date(dateKey + 'T00:00:00');
                        if (isNaN(d.getTime())) continue;
                        const monthKey = getMonthKeyFromDate(d);
                        const groups = updatedAssignments[dateKey];
                        if (!groups) continue;
                        
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            const assignedPerson = groups[groupNum];
                            if (assignedPerson) {
                                if (!finalSemiRotationPositionsByMonth[monthKey]) {
                                    finalSemiRotationPositionsByMonth[monthKey] = {};
                                }
                                // Store the last assigned person for this month/group (will be overwritten by later dates)
                                finalSemiRotationPositionsByMonth[monthKey][groupNum] = assignedPerson;
                            }
                        }
                    }
                    
                    // Update lastRotationPositions with final assigned persons (after swaps)
                    if (Object.keys(finalSemiRotationPositionsByMonth).length > 0) {
                        for (const monthKey in finalSemiRotationPositionsByMonth) {
                            const groupsForMonth = finalSemiRotationPositionsByMonth[monthKey] || {};
                            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                                if (groupsForMonth[groupNum] !== undefined) {
                                    setLastRotationPersonForMonth('semi', monthKey, groupNum, groupsForMonth[groupNum]);
                                }
                            }
                        }
                        
                        // Save updated rotation positions to Firestore
                        try {
                            const sanitizedPositions = sanitizeForFirestore(lastRotationPositions);
                            await db.collection('dutyShifts').doc('lastRotationPositions').set({
                                ...sanitizedPositions,
                                lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                                updatedBy: user.uid
                            });
                            console.log('Updated last rotation positions for semi-normal (after swaps) to Firestore:', finalSemiRotationPositionsByMonth);
                        } catch (error) {
                            console.error('Error saving updated last rotation positions after semi-normal swaps:', error);
                        }
                    }
                }
            } catch (error) {
                console.error('Error saving final semi-normal assignments:', error);
            }
        }

        // Save Step 4 (Normal) assignments to Firestore and run swap logic
        
        // Run swap logic for normal days and show popup with results
        
        // Show popup with normal swap results
        
        // Save final normal assignments (after swap logic) to normalDayAssignments document


        // Cancel step-by-step calculation

        // Execute final calculation

        // Step 2: Check and show weekends/holidays


        
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
        
        // Expose to window for compatibility (function is defined in duty-shifts-logic.js)
        // This will be set after logic.js loads

        // Helper function to add/remove person from day assignment


        // Helper function to check if person can take a day (no conflicts)
        function canPersonTakeDay(dayKey, person, groupNum, dayTypeCategory) {
            const dayDate = new Date(dayKey + 'T00:00:00');
            
            // Skip if person is missing on this date
            if (isPersonMissingOnDate(person, groupNum, dayDate, dayTypeCategory)) return false;
            
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
                const assignment = (typeof getAssignmentForDate === 'function' ? getAssignmentForDate(dayKey) : null) ?? (dutyAssignments?.[dayKey] || '');
                if (assignment) {
                    if (typeof assignment === 'object' && !Array.isArray(assignment)) {
                        const direct = assignment[groupNum] ?? assignment[String(groupNum)];
                        if (direct && String(direct).trim() === person) return dayKey;
                    } else {
                        const parts = String(assignment).split(',').map(p => p.trim());
                        for (const part of parts) {
                            const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                            if (match && parseInt(match[2]) === groupNum && match[1].trim() === person) {
                                return dayKey;
                            }
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
                if (isPersonMissingOnDate(person, groupNum, dayDate, dayTypeCategory)) continue;
                
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

        // Manual assignment feature removed (UI + handlers).

        // Check if person is unavailable on a specific date (missing period OR disabled)
        // dutyCategory: 'special' | 'weekend' | 'semi' | 'normal' | null

        // When the rotation-selected person is missing, pick the next person in rotation
        // BUT also validate consecutive-duty conflicts (before/after) and cross-month (via hasConsecutiveDuty).
        // - startRotationPosition: the index of the rotation-selected person
        // - alreadyAssignedSet: optional Set or Object { personName -> dateKey } to prevent nearby duplicates (used in preview logic)
        // - exhaustive: if true, search through the entire rotation multiple times until finding someone eligible

        // Open missing period modal
        let currentMissingPeriodGroup = null;
        let currentMissingPeriodPerson = null;
        
        function openMissingPeriodModal(groupNum, person) {
            currentMissingPeriodGroup = groupNum;
            currentMissingPeriodPerson = person;
            
            document.getElementById('missingPeriodPersonName').textContent = person;
            document.getElementById('missingPeriodStart').value = '';
            document.getElementById('missingPeriodEnd').value = '';

            renderMissingReasonsSelect();
            
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
                const reason = (period.reason || '').trim();
                const reasonHtml = reason ? `<div class="mt-1"><small class="text-muted"><i class="fas fa-tag me-1"></i>${escapeHtml(reason)}</small></div>` : '';
                
                return `
                    <div class="card mb-2">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-center">
                                <div>
                                    <strong>${formatDate(startDate)}</strong> - <strong>${formatDate(endDate)}</strong>
                                    ${statusBadge}
                                    ${reasonHtml}
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
            const reason = (document.getElementById('missingPeriodReason')?.value || '').trim();
            
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
                end: end,
                reason: reason || null
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

        function renderMissingReasonsSelect() {
            const select = document.getElementById('missingPeriodReason');
            if (!select) return;
            const list = Array.isArray(missingReasons) ? missingReasons : [];
            const currentValue = (select.value || '').trim();
            const options = (list.length ? list : ['Άλλο']).map(r => String(r).trim()).filter(Boolean);
            select.innerHTML = options.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
            if (currentValue && options.includes(currentValue)) {
                select.value = currentValue;
            }
        }

        function openMissingReasonsModal() {
            renderMissingReasonsList();
            const modal = new bootstrap.Modal(document.getElementById('missingReasonsModal'));
            modal.show();
        }

        function renderMissingReasonsList() {
            const container = document.getElementById('missingReasonsList');
            if (!container) return;
            const list = Array.isArray(missingReasons) ? missingReasons : [];
            if (!list.length) {
                container.innerHTML = '<div class="text-muted small text-center">Δεν υπάρχουν λόγοι.</div>';
                return;
            }
            container.innerHTML = list.map((r, idx) => {
                const txt = String(r || '').trim();
                if (!txt) return '';
                return `
                    <div class="list-group-item d-flex justify-content-between align-items-center">
                        <span>${escapeHtml(txt)}</span>
                        <button class="btn btn-sm btn-outline-danger" onclick="removeMissingReason(${idx})"><i class="fas fa-trash"></i></button>
                    </div>
                `;
            }).join('');
        }

        function addMissingReason() {
            const input = document.getElementById('missingReasonNewText');
            const raw = (input?.value || '').trim();
            if (!raw) return;
            const list = Array.isArray(missingReasons) ? missingReasons : [];
            const exists = list.some(x => String(x).trim().toLowerCase() === raw.toLowerCase());
            if (exists) {
                input.value = '';
                return;
            }
            list.push(raw);
            missingReasons = list.filter(Boolean).map(x => String(x).trim()).filter(Boolean);
            missingReasonsModified = true;
            input.value = '';
            renderMissingReasonsList();
            renderMissingReasonsSelect();
            saveData();
        }

        function removeMissingReason(index) {
            const list = Array.isArray(missingReasons) ? [...missingReasons] : [];
            if (index < 0 || index >= list.length) return;
            list.splice(index, 1);
            missingReasons = list.filter(Boolean).map(x => String(x).trim()).filter(Boolean);
            missingReasonsModified = true;
            renderMissingReasonsList();
            renderMissingReasonsSelect();
            saveData();
        }

        // Remove missing period (uses centered confirm modal when showConfirmModal is available)
        function removeMissingPeriod(index) {
            const doRemove = function () {
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
            };
            if (typeof showConfirmModal === 'function') {
                showConfirmModal({
                    title: 'Επιβεβαίωση',
                    message: 'Είστε σίγουροι ότι θέλετε να αφαιρέσετε αυτή την περίοδο απουσίας;',
                    onConfirm: doRemove
                });
            } else {
                if (!confirm('Είστε σίγουροι ότι θέλετε να αφαιρέσετε αυτή την περίοδο απουσίας;')) return;
                doRemove();
            }
        }

        // Toggle list collapse/expand
        function toggleListCollapse(listId, chevronId) {
            const listElement = document.getElementById(listId);
            const chevronElement = document.getElementById(chevronId);
            
            if (listElement && chevronElement) {
                // Check current state BEFORE toggling
                const isCurrentlyShown = listElement.classList.contains('show');
                
                // Lazy populate list when opening (improves initial load performance a lot)
                if (!isCurrentlyShown) {
                    ensureGroupListPopulated(listId);
                }
                
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
        
        // Expose to window for onclick handlers (only functions defined in this file)
        if (typeof window !== 'undefined') {
            window.toggleListCollapse = toggleListCollapse;
        }

        // Update statistics (title bar: Σύνολο Ατόμων, ΑΥΜ, ΔΤΑ, AW139, Επίγεια)

        // Helper function to get consecutive duty dates for detailed violation messages
        
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
                        end: endDate,
                        reason: (period.reason || '').trim() || null
                    };
                }
            }
            return null;
        }

        // Helper: return the SPECIAL HOLIDAY dateKey (YYYY-MM-DD) in the same month for this group, if any.
        // Used for explaining weekend "skips" in the rotation-violations popup.
        function getSpecialHolidayDutyDateInMonth(person, groupNum, year, month) {
            try {
                const monthStart = new Date(year, month, 1);
                const monthEnd = new Date(year, month + 1, 0);
                const personGroupStr = `${person} (Ομάδα ${groupNum})`;
                const d = new Date(monthStart);
                while (d <= monthEnd) {
                    if (getDayType(d) === 'special-holiday') {
                        const key = formatDateKey(d);
                        const a = getAssignmentForDate(key);
                        if (a && String(a).includes(personGroupStr)) {
                            return key;
                        }
                    }
                    d.setDate(d.getDate() + 1);
                }
            } catch (e) {
                // ignore
            }
            return null;
        }

        /** Ημερομηνία ως D/M/YYYY (π.χ. 13/4/2026) για ενιαία μηνύματα UI. */
        function formatDateKeyAsGreekDMY(dateKey) {
            if (!dateKey || typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return '';
            const d = new Date(dateKey + 'T00:00:00');
            if (isNaN(d.getTime())) return '';
            return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
        }

        /**
         * Ενιαίο μήνυμα: αντικατάσταση (π.χ. Σαββατοκύριακο) επειδή ο άλλος έχει ήδη ειδική αργία τον ίδιο μήνα.
         * replacementPersonName = αυτός που τοποθετείται, skippedPersonName = αυτός με την ειδική.
         */
        function buildSpecialHolidaySameMonthUnifiedMessage(replacementPersonName, placementDateKey, skippedPersonName, skippedGroupNum, dutyYear, dutyMonthIndex0) {
            const rep = String(replacementPersonName || '').trim();
            const sk = String(skippedPersonName || '').trim();
            const placeStr = formatDateKeyAsGreekDMY(placementDateKey);
            const g = parseInt(skippedGroupNum, 10);
            const specialKey =
                Number.isFinite(g) && sk
                    ? (typeof getSpecialHolidayDutyDateKeyForPersonInMonthCalcOrSaved === 'function'
                          ? getSpecialHolidayDutyDateKeyForPersonInMonthCalcOrSaved(sk, g, dutyYear, dutyMonthIndex0)
                          : typeof getSpecialHolidayDutyDateInMonth === 'function'
                            ? getSpecialHolidayDutyDateInMonth(sk, g, dutyYear, dutyMonthIndex0)
                            : null)
                    : null;
            const specialStr = specialKey ? formatDateKeyAsGreekDMY(specialKey) : null;
            if (!rep || !placeStr || !sk) return '';
            if (specialStr) {
                return `Ο/Η ${rep} τοποθετήθηκε στις ${placeStr} γιατί ο/η ${sk} έχει ειδική αργία στις ${specialStr}.`;
            }
            return `Ο/Η ${rep} τοποθετήθηκε στις ${placeStr} γιατί ο/η ${sk} έχει ειδική αργία στον ίδιο μήνα.`;
        }

        /**
         * Ενιαίο μήνυμα αλλαγής ημιαργίας: συνεχόμενη υπηρεσία με αργία (Σαββατοκύριακο/ειδική γειτονική ημέρα).
         * changerName (Α) = αυτός που ανταλλάσσει, conflictedName (Β) = αυτός με τη σύγκρουση,
         * conflictDateKey = ημερομηνία ημιαργίας με σύγκρουση, placementDateKey = ημερομηνία όπου τοποθετείται ο Β (θέση του Α).
         */
        function buildSemiConsecutiveHolidaySwapUnifiedMessage(changerName, conflictedName, conflictDateKey, placementDateKey) {
            const a = String(changerName || '').trim();
            const b = String(conflictedName || '').trim();
            if (!a || !b || !conflictDateKey || !placementDateKey) return '';
            const conflictDateStr = formatDateKeyAsGreekDMY(conflictDateKey);
            const placementDateStr = formatDateKeyAsGreekDMY(placementDateKey);
            if (!conflictDateStr || !placementDateStr) return '';
            const conflictD = new Date(conflictDateKey + 'T00:00:00');
            const placementD = new Date(placementDateKey + 'T00:00:00');
            const conflictDayName =
                !isNaN(conflictD.getTime()) && typeof getGreekDayName === 'function' ? getGreekDayName(conflictD) : '';
            const placementDayName =
                !isNaN(placementD.getTime()) && typeof getGreekDayName === 'function' ? getGreekDayName(placementD) : '';
            return (
                `Ο/Η ${a} άλλαξε τον/την ${b} στις ${conflictDateStr} ημέρα ${conflictDayName} ` +
                `γιατί ο/η ${b} είχε συνεχόμενη υπηρεσία με Αργία. ` +
                `Ο/Η ${b} τοποθετήθηκε στις ${placementDateStr} ημέρα ${placementDayName}.`
            );
        }

        /**
         * Ενιαίο μήνυμα αλλαγής καθημερινής: συνεχόμενη υπηρεσία με Ημιαργία ή Αργία (γειτονική ημέρα).
         * conflictWithLabel: «Ημιαργία» | «Αργία»
         */
        /**
         * Ενιαίο μήνυμα όταν επιστρέφει από απουσία (πρόωρη/μετατοπισμένη ανάθεση): ο επιστρέφων αντικατέστησε κάποιον
         * επειδή είχε baseline υπηρεσία αλλά θα απουσιάζει στην περίοδο απουσίας.
         */
        function buildReturnFromMissingPlacementUnifiedMessage({
            returningPersonName,
            displacedPersonName,
            placementDateKey,
            baselineDateKey,
            missingStartKey,
            missingEndKey,
            reasonOfMissing
        }) {
            const rep = String(returningPersonName || '').trim();
            const displaced = String(displacedPersonName || '').trim();
            if (!rep || !displaced || !placementDateKey || !baselineDateKey) return '';
            const placementD = new Date(placementDateKey + 'T00:00:00');
            const baselineD = new Date(baselineDateKey + 'T00:00:00');
            if (isNaN(placementD.getTime()) || isNaN(baselineD.getTime())) return '';
            const placementDateStr =
                typeof formatDateKeyAsGreekDMY === 'function'
                    ? formatDateKeyAsGreekDMY(placementDateKey)
                    : placementD.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const baselineDateStr =
                typeof formatDateKeyAsGreekDMY === 'function'
                    ? formatDateKeyAsGreekDMY(baselineDateKey)
                    : baselineD.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const placementDayName =
                typeof getGreekDayName === 'function' ? getGreekDayName(placementD) : '';
            const baselineDayName = typeof getGreekDayName === 'function' ? getGreekDayName(baselineD) : '';
            const formatRangePart = (startKey, endKey) => {
                if (!startKey || !endKey) return '';
                const s =
                    typeof formatDateKeyAsGreekDMY === 'function' ? formatDateKeyAsGreekDMY(startKey) : startKey;
                const e =
                    typeof formatDateKeyAsGreekDMY === 'function' ? formatDateKeyAsGreekDMY(endKey) : endKey;
                return `${s} - ${e}`;
            };
            const missingRangeStr = formatRangePart(missingStartKey, missingEndKey);
            const reasonPart = String(reasonOfMissing || '').trim() || '(δεν αναφέρεται λόγος)';
            return (
                `Ο/Η ${rep} αντικατέστησε τον/την ${displaced} στις ${placementDateStr} ημέρα ${placementDayName} ` +
                `επειδή ο/η ${rep} είχε υπηρεσία στις ${baselineDateStr} ημέρα ${baselineDayName} ` +
                `αλλά θα απουσιάζει από ${missingRangeStr} λόγω ${reasonPart}.`
            );
        }

        /**
         * Χειροκίνητη ανάθεση από modal ημέρας: αλλάζει μόνο την τελική ανάθεση, όχι τη βασική σειρά περιστροφής.
         */
        function buildManualDutyAssignmentPreserveBaselineMessage({
            assignedPersonName,
            displacedPersonName,
            baselinePersonName,
            dateObj
        }) {
            const assigned = String(assignedPersonName || '').trim();
            const displaced = String(displacedPersonName || '').trim();
            const baseline = String(baselinePersonName || '').trim();
            if (!assigned || !displaced || !dateObj || isNaN(dateObj.getTime())) return '';
            const dateStr = dateObj.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const dayName = typeof getGreekDayName === 'function' ? getGreekDayName(dateObj) : '';
            const baselineClause = baseline
                ? ` Η βασική σειρά παραμένει (ο/η ${baseline}).`
                : ' Η βασική σειρά περιστροφής δεν αλλάζει.';
            return (
                `Ο/Η ${assigned} ανατέθηκε χειροκίνητα στη θέση του/την ${displaced} στις ${dateStr}` +
                (dayName ? ` ημέρα ${dayName}` : '') +
                `.${baselineClause}`
            );
        }

        /**
         * Ενιαίο μήνυμα αντικατάστασης: απουσία (π.χ. Φύλλο Πορείας) ή απενεργοποίηση.
         */
        function buildUnavailableReplacementUnifiedMessage({ replacementPersonName, skippedPersonName, dateObj, groupNum, dutyCategory = null }) {
            const rep = String(replacementPersonName || '').trim();
            const sk = String(skippedPersonName || '').trim();
            if (!rep || !sk || !dateObj || isNaN(dateObj.getTime())) return '';
            const dateKey =
                typeof formatDateKey === 'function' ? formatDateKey(dateObj) : null;
            const dateStr =
                dateKey && typeof formatDateKeyAsGreekDMY === 'function'
                    ? formatDateKeyAsGreekDMY(dateKey)
                    : dateObj.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const dayName =
                typeof getGreekDayName === 'function' ? getGreekDayName(dateObj) : '';
            const reasonShort =
                typeof getUnavailableReasonShort === 'function'
                    ? getUnavailableReasonShort(sk, groupNum, dateObj, dutyCategory)
                    : 'Κώλυμα/Απουσία';
            const statusClause =
                reasonShort === 'Απενεργοποιημένος' ? 'Απενεργοποιήθηκε' : `είχε ${reasonShort}`;
            return (
                `Ο/Η ${rep} αντικατέστησε τον/την ${sk} στις ${dateStr} ημέρα ${dayName} ` +
                `επειδή ο/η ${sk} ${statusClause}.`
            );
        }

        function buildNormalConsecutiveDutySwapUnifiedMessage(changerName, conflictedName, conflictDateKey, placementDateKey, conflictWithLabel) {
            const a = String(changerName || '').trim();
            const b = String(conflictedName || '').trim();
            const withLabel = String(conflictWithLabel || '').trim() || 'Αργία';
            if (!a || !b || !conflictDateKey || !placementDateKey) return '';
            const conflictDateStr = formatDateKeyAsGreekDMY(conflictDateKey);
            const placementDateStr = formatDateKeyAsGreekDMY(placementDateKey);
            if (!conflictDateStr || !placementDateStr) return '';
            const conflictD = new Date(conflictDateKey + 'T00:00:00');
            const placementD = new Date(placementDateKey + 'T00:00:00');
            const conflictDayName =
                !isNaN(conflictD.getTime()) && typeof getGreekDayName === 'function' ? getGreekDayName(conflictD) : '';
            const placementDayName =
                !isNaN(placementD.getTime()) && typeof getGreekDayName === 'function' ? getGreekDayName(placementD) : '';
            return (
                `Ο/Η ${a} άλλαξε τον/την ${b} στις ${conflictDateStr} ημέρα ${conflictDayName} ` +
                `γιατί ο/η ${b} είχε συνεχόμενη υπηρεσία με ${withLabel}. ` +
                `Ο/Η ${b} τοποθετήθηκε στις ${placementDateStr} ημέρα ${placementDayName}.`
            );
        }
        
        // Analyze rotation violations
        function analyzeRotationViolations() {
            const violations = [];
            const seenSwapPairs = new Set(); // dayType|group|swapPairId -> dedupe swap rows
            const seenViolations = new Set(); // dateKey|groupNum|assignedPerson -> dedupe all violations

            const extractShortReasonFromSavedText = (reasonText) => {
                const t = String(reasonText || '');
                if (!t) return '';
                if (t.includes('Απενεργοποιήθηκε') || t.includes('Απενεργοποιημένος')) return 'Απενεργοποιημένος';
                // Match common missing reasons explicitly
                if (t.includes('Κανονική Άδεια')) return 'Κανονική Άδεια';
                if (t.includes('Αναρρωτική Άδεια')) return 'Αναρρωτική Άδεια';
                if (t.includes('Φύλλο Πορείας')) return 'Φύλλο Πορείας';
                if (t.toLowerCase().includes('ειδική αργία')) return 'Ειδική αργία στον ίδιο μήνα';
                if (t.toLowerCase().includes('κώλυμα') || t.toLowerCase().includes('απουσία')) return 'Κώλυμα/Απουσία';
                return 'Παράλειψη';
            };
            
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

            // NEW APPROACH: Iterate directly through assignment reasons for the current month
            // This ensures each assignment reason is processed exactly once, eliminating duplicates
            const viewMonthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`; // YYYY-MM
            
            // First, collect all assignment reasons for the current month
            for (const dateKey in assignmentReasons) {
                // Only process dates in the viewed month
                if (!dateKey.startsWith(viewMonthPrefix + '-')) continue;
                
                const date = new Date(dateKey + 'T00:00:00');
                if (isNaN(date.getTime())) continue;
                
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
                
                const dateReasons = assignmentReasons[dateKey];
                if (!dateReasons) continue;
                
                // For each group in this date
                for (const groupNumStr in dateReasons) {
                    const groupReasons = dateReasons[groupNumStr];
                    if (!groupReasons) continue;
                    const groupNum = parseInt(groupNumStr);
                    if (!groupNum || groupNum < 1 || groupNum > 4) continue;
                    
                    // For each person with an assignment reason
                    for (const personName in groupReasons) {
                        const reason = groupReasons[personName];
                        if (!reason || (reason.type !== 'skip' && reason.type !== 'swap')) continue;
                        
                        // Skip cross-month swaps here (they're handled separately)
                        if (reason.meta?.isCrossMonth) continue;
                        
                        // Deduplicate: check if we've already added a violation for this date+group+assignedPerson
                        const violationKey = `${dateKey}|${groupNum}|${personName}`;
                        if (seenViolations.has(violationKey)) {
                            continue; // Skip duplicate entry
                        }
                        seenViolations.add(violationKey);
                        
                        // Handle swap pair deduplication
                        if (reason.type === 'swap' && reason.swapPairId !== null && reason.swapPairId !== undefined) {
                            const k = `${dayTypeCategory}|${groupNum}|${reason.swapPairId}`;
                            if (seenSwapPairs.has(k)) continue; // only show one row per swap pair
                            seenSwapPairs.add(k);
                        }
                        
                        // Get the assigned person and expected person from the assignment reason
                        const assignedPerson = personName;
                        const expectedPerson = reason.swappedWith || null;
                        
                        if (!expectedPerson) continue; // Need to know who was replaced
                        
                        // Get group data for validation
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
                        
                        // Validate that both persons are in the list
                        const assignedIndex = groupPeople.indexOf(assignedPerson);
                        const expectedIndex = groupPeople.indexOf(expectedPerson);
                        
                        if (assignedIndex === -1 || expectedIndex === -1) continue;
                        
                        // Process the violation
                        const swapOrSkipReasonText = reason.type === 'skip'
                            ? normalizeSkipReasonText(reason.reason || '')
                            : (reason.type === 'swap'
                                ? normalizeSwapReasonText(reason.reason || '')
                                : (reason.reason || ''));
                        
                        // Get conflict details
                        const isDisabled = isPersonDisabledForDuty(expectedPerson, groupNum, dayTypeCategory);
                        const isMissingPeriod = !isDisabled && isPersonMissingOnDate(expectedPerson, groupNum, date, dayTypeCategory);
                        
                        let conflictDetails = [];
                        let hasLegitimateConflict = true; // Assignment reasons are always legitimate
                        
                        // Extract short reason for conflicts column
                        if (swapOrSkipReasonText) {
                            conflictDetails.push(extractShortReasonFromSavedText(swapOrSkipReasonText));
                        }
                        
                        if (isDisabled) {
                            conflictDetails.push('Απενεργοποιημένος');
                        }
                        
                        if (isMissingPeriod) {
                            conflictDetails.push(getUnavailableReasonShort(expectedPerson, groupNum, date, dayTypeCategory));
                        }
                        
                        // Determine skipped reason
                        let skippedReason = '';
                        if (isDisabled) {
                            skippedReason = 'Απενεργοποιημένος';
                        } else if (isMissingPeriod) {
                            skippedReason = getUnavailableReasonShort(expectedPerson, groupNum, date, dayTypeCategory);
                        } else if (reason.type === 'skip' && swapOrSkipReasonText) {
                            skippedReason = extractShortReasonFromSavedText(swapOrSkipReasonText);
                        } else if (reason.type === 'swap') {
                            skippedReason = 'Αλλαγή (swap)';
                        }
                        
                        const conflictSummary = conflictDetails.length > 0 ? conflictDetails.join(' | ') : '';
                        
                        violations.push({
                            date: dateKey,
                            dateFormatted: date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                            dateObj: date, // Store date object for sorting and day of week
                            dayTypeCategory: dayTypeCategory, // Store category for display
                            group: groupNum,
                            groupName: getGroupName(groupNum),
                            assignedPerson: assignedPerson,
                            expectedPerson: expectedPerson,
                            conflicts: conflictSummary,
                            swapReason: swapOrSkipReasonText,
                            skippedReason: skippedReason,
                            dayType: getDayTypeLabel(dayType),
                            reasonType: reason.type // Store 'skip' or 'swap' to determine Αντικατάσταση vs Αλλαγή
                        });
                    }
                }
            }
            
            // Also show cross-month swaps that fall INSIDE the viewed month.
            // Cross-month swaps are stored on the swap day key (often in the next month).
            // We intentionally keep the popup scoped to the current month, so:
            // - viewing Feb will NOT show March dates
            // - viewing March WILL show the March swap date row
            try {
                const viewMonthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`; // YYYY-MM
                const seenCrossMonth = new Set(); // dateKey|group|person

                for (const dateKey in assignmentReasons) {
                    // Only show rows for dates in the viewed month
                    if (!dateKey.startsWith(viewMonthPrefix + '-')) continue;
                    const dateReasons = assignmentReasons[dateKey];
                    if (!dateReasons) continue;

                    for (const groupNumStr in dateReasons) {
                        const groupReasons = dateReasons[groupNumStr];
                        if (!groupReasons) continue;
                        const groupNum = parseInt(groupNumStr);
                        if (!groupNum) continue;

                        for (const personName in groupReasons) {
                            const r = groupReasons[personName];
                            const meta = r?.meta;
                            if (!meta?.isCrossMonth) continue;

                            const originDayKey = meta.originDayKey;
                            const swapDayKey = meta.swapDayKey || dateKey;
                            const conflictDateKey = meta.conflictDateKey || originDayKey || dateKey;
                            // (dateKey is already within view month due to the filter above)

                            const uniqueKey = `${dateKey}|${groupNum}|${personName}`;
                            if (seenCrossMonth.has(uniqueKey)) continue;
                            seenCrossMonth.add(uniqueKey);
                            
                            // Use the same deduplication key format as main violation detection
                            const violationKey = `${dateKey}|${groupNum}|${personName}`;
                            if (seenViolations.has(violationKey)) continue; // already present via normal mismatch logic
                            seenViolations.add(violationKey);

                            const d = new Date(dateKey + 'T00:00:00');
                            const originStr = originDayKey ? new Date(originDayKey + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
                            const conflictStr = conflictDateKey ? new Date(conflictDateKey + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';

                            const dayTypeForCrossMonth = getDayType(d);
                            let dayTypeCategoryForCrossMonth = 'normal';
                            if (dayTypeForCrossMonth === 'special-holiday') {
                                dayTypeCategoryForCrossMonth = 'special';
                            } else if (dayTypeForCrossMonth === 'weekend-holiday') {
                                dayTypeCategoryForCrossMonth = 'weekend';
                            } else if (dayTypeForCrossMonth === 'semi-normal-day') {
                                dayTypeCategoryForCrossMonth = 'semi';
                            }
                            
                            violations.push({
                                date: dateKey,
                                dateFormatted: isNaN(d.getTime())
                                    ? dateKey
                                    : d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                                dateObj: d,
                                dayTypeCategory: dayTypeCategoryForCrossMonth,
                                group: groupNum,
                                groupName: getGroupName(groupNum),
                                assignedPerson: personName,
                                expectedPerson: r?.swappedWith || '(Swap)',
                                conflicts: `Από προηγούμενο μήνα: ${originStr} | Σύγκρουση: ${conflictStr}`,
                                swapReason: r?.reason || '',
                                skippedReason: '',
                                dayType: getDayTypeLabel(dayTypeForCrossMonth),
                                reasonType: r?.type || 'swap' // Cross-month swaps are typically swaps
                            });
                        }
                    }
                }
            } catch (e) {
                console.warn('Error collecting cross-month swap entries for violations popup:', e);
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
                
                // Sort violations by date in ascending order
                violations.sort((a, b) => {
                    const dateA = a.dateObj || new Date(a.date + 'T00:00:00');
                    const dateB = b.dateObj || new Date(b.date + 'T00:00:00');
                    return dateA.getTime() - dateB.getTime();
                });
                
                violations.forEach(violation => {
                    const row = document.createElement('tr');
                    
                    // Get date object
                    const dateObj = violation.dateObj || new Date(violation.date + 'T00:00:00');
                    
                    // Get day of week
                    const dayOfWeek = getGreekDayName(dateObj);
                    
                    // Get duty type label based on category
                    let dutyTypeLabel = '';
                    if (violation.dayTypeCategory === 'special') {
                        dutyTypeLabel = 'Ειδική Αργία';
                    } else if (violation.dayTypeCategory === 'weekend') {
                        dutyTypeLabel = 'Σαββατοκύριακο/Αργία';
                    } else if (violation.dayTypeCategory === 'semi') {
                        dutyTypeLabel = 'Ημιαργία';
                    } else {
                        dutyTypeLabel = 'Καθημερινή';
                    }
                    
                    // Format date with day of week and duty type below
                    const dateHtml = `
                        <div>${violation.dateFormatted}</div>
                        <div style="font-size: 0.85em; color: #666; margin-top: 2px;">${dayOfWeek}</div>
                        <div style="font-size: 0.8em; color: #888; margin-top: 1px;">${dutyTypeLabel}</div>
                    `;
                    
                    // Remove duplicates from conflicts column (split by | and deduplicate)
                    let conflictsDisplay = violation.conflicts || '-';
                    if (conflictsDisplay !== '-') {
                        const conflictParts = conflictsDisplay.split('|').map(c => c.trim()).filter(c => c);
                        const uniqueConflicts = [...new Set(conflictParts)];
                        conflictsDisplay = uniqueConflicts.join(' | ') || '-';
                    }
                    
                    // Remove text in parentheses from reason
                    let reasonText = violation.swapReason || '-';
                    if (reasonText !== '-') {
                        // Remove text in parentheses at the end (e.g., "text. (Reason)" -> "text.")
                        reasonText = reasonText.replace(/\s*\([^)]*\)\s*$/, '');
                    }
                    
                    // Determine assignment type: "Αντικατάσταση" for skip, "Αλλαγή" for swap
                    const assignmentType = violation.reasonType === 'skip' ? 'Αντικατάσταση' : 'Αλλαγή';
                    
                    row.innerHTML = `
                        <td>${dateHtml}</td>
                        <td><span class="badge bg-primary">${violation.groupName}</span></td>
                        <td><strong>${violation.assignedPerson}</strong></td>
                        <td><strong class="text-danger">${violation.expectedPerson}</strong></td>
                        <td><small>${escapeHtml(conflictsDisplay)}</small></td>
                        <td><small>${escapeHtml(reasonText)}</small></td>
                        <td><small>${escapeHtml(assignmentType)}</small></td>
                    `;
                    tableBody.appendChild(row);
                });
            }
            
            // Show modal
            const modal = new bootstrap.Modal(document.getElementById('rotationViolationsModal'));
            modal.show();
        }

        // Print rotation order lists and rankings: one page per duty type (all 4 groups), then hierarchy
        function printRotationAndRankings() {
            const printWindow = window.open('', '_blank', 'width=800,height=600');
            const allPeople = getAllPeople();
            const sortedByRanking = [...allPeople].sort((a, b) => {
                const rankA = rankings[a] || 9999;
                const rankB = rankings[b] || 9999;
                return rankA - rankB;
            });
            const listTypes = [
                { key: 'special', name: 'Ειδικές Αργίες' },
                { key: 'weekend', name: 'Σαββατοκύριακα/Αργίες' },
                { key: 'semi', name: 'Ημιαργίες' },
                { key: 'normal', name: 'Καθημερινές' }
            ];
            let html = `
<!DOCTYPE html>
<html lang="el">
<head>
    <meta charset="UTF-8">
    <title>Σειρές Περιστροφής & Ιεραρχία</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
        h1 { text-align: center; color: #333; margin-bottom: 10px; }
        h2 { color: #555; border-bottom: 2px solid #007bff; padding-bottom: 5px; margin-top: 0; margin-bottom: 15px; }
        h3 { color: #666; margin-top: 0; margin-bottom: 8px; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #007bff; color: white; font-weight: bold; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        .print-page { page-break-after: always; page-break-inside: avoid; }
        .print-page:last-of-type { page-break-after: auto; }
        .groups-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px 30px; }
        .group-section { page-break-inside: avoid; }
        .group-section ol { margin: 5px 0; padding-left: 25px; }
        .list-item { padding: 2px 0; }
        .ranking-number { font-weight: bold; color: #007bff; margin-right: 10px; }
        .empty-list { color: #999; font-style: italic; }
        @page { margin: 1.5cm; }
        @media print {
            body { padding: 1.5cm; margin: 0; }
            .print-page { page-break-after: always; padding-top: 1.5cm; }
            .print-page:last-of-type { page-break-after: auto; }
        }
    </style>
</head>
<body>
    <h1>Σειρές Περιστροφής & Ιεραρχία Υπηρεσιών</h1>
    <p style="text-align: center; color: #666; margin-bottom: 25px;">Ημερομηνία εκτύπωσης: ${new Date().toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
`;
            listTypes.forEach(listType => {
                html += `
    <div class="print-page">
        <h2>${listType.name}</h2>
        <div class="groups-grid">
`;
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [] };
                    const groupName = getGroupName(groupNum);
                    const list = groupData[listType.key] || [];
                    html += `
        <div class="group-section">
            <h3>Ομάδα ${groupNum}: ${groupName}</h3>
`;
                    if (list.length > 0) {
                        html += `            <ol>`;
                        list.forEach((person) => { html += `<li class="list-item">${person}</li>`; });
                        html += `</ol>`;
                    } else {
                        html += `            <span class="empty-list">(Κενή λίστα)</span>`;
                    }
                    html += `
        </div>`;
                }
                html += `
        </div>
    </div>
`;
            });
            html += `
    <div class="print-page">
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
            sortedByRanking.forEach((person) => {
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
            html += `            </tbody>
        </table>
        <div style="margin-top: 25px; text-align: center; color: #666; font-size: 10px;">Αυτό το έγγραφο δημιουργήθηκε από το σύστημα Διαχείρισης Υπηρεσιών</div>
    </div>
</body>
</html>
`;
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.onload = function() {
                setTimeout(() => { printWindow.print(); }, 250);
            };
        }
