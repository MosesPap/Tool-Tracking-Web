// ============================================================================
// DUTY-SHIFTS-ROTATION-ENGINE.JS - Pure rotation / assignment logic (no UI)
// Phase 1: core engine. Phase 3: special holidays (debt repayment first).
// ============================================================================

(function (global) {
    'use strict';

    const DUTY_TYPE_SPECIAL = 'special';

    function normName(s) {
        if (typeof normalizePersonKey === 'function') return normalizePersonKey(s);
        return String(s || '').trim();
    }

    function personKey(name) {
        if (typeof personScheduleKey === 'function') return personScheduleKey(name);
        return normName(name);
    }

    function stripGreekAccents(s) {
        if (typeof greekUpperNoTones === 'function') return greekUpperNoTones(s);
        return String(s || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase();
    }

    /** Ίδιο άτομο ανεξάρτητα από μικρές διαφορές ονόματος / θέσης στη σειρά. */
    function namesReferToSamePerson(a, b, groupNum) {
        if (!a || !b) return false;
        const ra = groupNum ? resolveInSpecialList(a, groupNum) : a;
        const rb = groupNum ? resolveInSpecialList(b, groupNum) : b;
        if (personKey(ra) === personKey(rb)) return true;
        if (normName(ra) === normName(rb)) return true;
        if (stripGreekAccents(ra) === stripGreekAccents(rb)) return true;
        const canon = getCanonicalSpecialOrder(groupNum);
        const ia = findPersonIndex(canon, ra, groupNum);
        const ib = findPersonIndex(canon, rb, groupNum);
        return ia >= 0 && ia === ib;
    }

    /**
     * Έχει ήδη υπηρετήσει ειδική πριν την currentDateKey:
     * 1) αναθέσεις της τρέχουσας περιόδου (out.assignments)
     * 2) αποθηκευμένες αναθέσεις Firebase (specialHolidayAssignments) — π.χ. αντικαταστάτης προηγ. μήνα
     */
    function hasServedSpecialEarlier(out, sortedSpecial, groupNum, personName, currentDateKey) {
        if (!personName || !currentDateKey) return false;

        if (out?.assignments) {
            for (const dk of sortedSpecial || []) {
                if (dk >= currentDateKey) break;
                const prev = out.assignments[dk]?.[groupNum];
                if (prev && namesReferToSamePerson(prev, personName, groupNum)) return true;
            }
        }

        if (typeof specialHolidayAssignments !== 'undefined') {
            const priorKeys = Object.keys(specialHolidayAssignments)
                .filter((dk) => dk < currentDateKey)
                .sort();
            for (const dk of priorKeys) {
                const d = new Date(dk + 'T00:00:00');
                if (!isNaN(d.getTime()) && typeof isSpecialHoliday === 'function' && !isSpecialHoliday(d)) {
                    continue;
                }
                const assigned = getFinalSpecialAssignee(groupNum, dk);
                if (assigned && namesReferToSamePerson(assigned, personName, groupNum)) return true;
            }
        }
        return false;
    }

    /** Σπόρος tracker με τελικούς ανατεθέντες από προηγούμενες ειδικές (Firestore). */
    function seedAssignedFromPriorSpecials(groupNum, firstDateKey, tracker) {
        if (!firstDateKey || typeof specialHolidayAssignments === 'undefined') return;
        const keys = Object.keys(specialHolidayAssignments)
            .filter((dk) => dk < firstDateKey)
            .sort();
        for (const dk of keys) {
            const d = new Date(dk + 'T00:00:00');
            if (!isNaN(d.getTime()) && typeof isSpecialHoliday === 'function' && !isSpecialHoliday(d)) {
                continue;
            }
            const assigned = getFinalSpecialAssignee(groupNum, dk);
            if (!assigned) continue;
            const order = getSpecialOrderForDate(groupNum, dk);
            markPersonAssignedThisPeriod(tracker, order, assigned, groupNum);
        }
    }

    function resolveInSpecialList(personName, groupNum) {
        if (!personName) return personName;
        if (typeof resolvePersonInGroupRotationList === 'function' && groupNum) {
            return resolvePersonInGroupRotationList(personName, groupNum, DUTY_TYPE_SPECIAL);
        }
        return personName;
    }

    function findPersonIndex(order, personName, groupNum) {
        if (!personName || !Array.isArray(order)) return -1;
        const candidates = [personName];
        if (groupNum) candidates.push(resolveInSpecialList(personName, groupNum));
        for (const candidate of candidates) {
            const t = normName(candidate);
            if (!t) continue;
            for (let i = 0; i < order.length; i++) {
                if (normName(order[i]) === t) return i;
            }
        }
        return -1;
    }

    function getCanonicalSpecialOrder(groupNum) {
        if (typeof getSortedGroupListForRotation === 'function') {
            const list = getSortedGroupListForRotation(groupNum, DUTY_TYPE_SPECIAL);
            if (Array.isArray(list) && list.length) return list.filter(Boolean);
        }
        const g = typeof groups !== 'undefined' ? groups[groupNum] : null;
        return (g?.special || []).filter(Boolean);
    }

    function getCanonicalIndex(groupNum, personName) {
        const canon = getCanonicalSpecialOrder(groupNum);
        return findPersonIndex(canon, personName, groupNum);
    }

    function getSpecialOrderForDate(groupNum, dateKey) {
        return getCanonicalSpecialOrder(groupNum);
    }

    function isPersonInSpecialRotationOnDate(personName, groupNum, dateKey) {
        if (!personName) return false;
        if (typeof getPersonHomeGroupAtDate === 'function') {
            return getPersonHomeGroupAtDate(personName, dateKey) === groupNum;
        }
        return true;
    }

    function getPriorSpecialAssignee(groupNum, dateKey) {
        if (typeof calculationSteps !== 'undefined') {
            const fromTemp = calculationSteps?.tempSpecialAssignments?.[dateKey]?.[groupNum];
            if (fromTemp) return fromTemp;
        }
        return getFinalSpecialAssignee(groupNum, dateKey);
    }

    function canServeSpecial(personName, groupNum, dateKey) {
        if (!personName) return false;
        const dateObj = new Date(dateKey + 'T00:00:00');
        if (isNaN(dateObj.getTime())) return false;
        if (typeof isPersonMissingOnDate === 'function' && isPersonMissingOnDate(personName, groupNum, dateObj, DUTY_TYPE_SPECIAL)) {
            return false;
        }
        if (typeof isPersonDisabledForDuty === 'function' && isPersonDisabledForDuty(personName, groupNum, DUTY_TYPE_SPECIAL, dateObj)) {
            return false;
        }
        return true;
    }

    function unavailableReason(personName, groupNum, dateKey) {
        const dateObj = new Date(dateKey + 'T00:00:00');
        if (typeof isPersonDisabledForDuty === 'function' && isPersonDisabledForDuty(personName, groupNum, DUTY_TYPE_SPECIAL, dateObj)) {
            return 'disabled';
        }
        if (typeof isPersonMissingOnDate === 'function' && isPersonMissingOnDate(personName, groupNum, dateObj, DUTY_TYPE_SPECIAL)) {
            return 'missing';
        }
        return 'unavailable';
    }

    function isPersonAssignedThisPeriod(ctx, order, personName, groupNum) {
        if (!personName) return false;
        // Πηγή αλήθειας: τελικές αναθέσεις προηγούμενων ειδικών στην ίδια περίοδο (όχι μόνο Sets).
        if (hasServedSpecialEarlier(ctx.out, ctx.sortedSpecial, groupNum, personName, ctx.currentDateKey)) {
            return true;
        }
        const assignedThisPeriod = ctx.assignedThisPeriod;
        const canonIdx = groupNum ? getCanonicalIndex(groupNum, personName) : -1;
        if (canonIdx >= 0 && assignedThisPeriod?.canonicalIndices?.has(canonIdx)) return true;
        const names = assignedThisPeriod?.names;
        if (!names || names.size === 0) return false;
        const targetIdx = findPersonIndex(order, personName, groupNum);
        for (const assignedNk of names) {
            if (normName(assignedNk) === normName(personName)) return true;
            if (targetIdx >= 0 && findPersonIndex(order, assignedNk, groupNum) === targetIdx) return true;
            if (canonIdx >= 0 && getCanonicalIndex(groupNum, assignedNk) === canonIdx) return true;
        }
        return false;
    }

    function markPersonAssignedThisPeriod(assignedThisPeriod, order, personName, groupNum) {
        if (!personName) return;
        if (!assignedThisPeriod.names) assignedThisPeriod.names = new Set();
        if (!assignedThisPeriod.canonicalIndices) assignedThisPeriod.canonicalIndices = new Set();
        assignedThisPeriod.names.add(normName(personName));
        const resolved = groupNum ? resolveInSpecialList(personName, groupNum) : personName;
        assignedThisPeriod.names.add(normName(resolved));
        const idx = findPersonIndex(order, resolved, groupNum);
        if (idx >= 0 && order[idx]) {
            assignedThisPeriod.names.add(normName(order[idx]));
        }
        const canonIdx = groupNum ? getCanonicalIndex(groupNum, resolved) : -1;
        if (canonIdx >= 0) assignedThisPeriod.canonicalIndices.add(canonIdx);
    }

    function createAssignedTracker() {
        return { names: new Set(), canonicalIndices: new Set() };
    }

    function isPersonAssignedSpecial(ctx, groupNum, order, personName) {
        return isPersonAssignedThisPeriod(ctx, order, personName, groupNum);
    }

    function markPersonAssignedSpecial(ctx, groupNum, order, personName) {
        markPersonAssignedThisPeriod(ctx.assignedThisPeriod, order, personName, groupNum);
    }

    function alreadyServedSpecialThisPeriod(ctx, groupNum, personName) {
        return hasServedSpecialEarlier(
            ctx.out,
            ctx.sortedSpecial,
            groupNum,
            personName,
            ctx.currentDateKey
        );
    }

    function commitSpecialAssignment(out, dateKey, groupNum, personName, ctx, order, pickOpts) {
        if (!personName) return null;
        let finalPerson = personName;
        if (alreadyServedSpecialThisPeriod(ctx, groupNum, finalPerson)) {
            const slotIdx = pickOpts?.slotIdx ?? 0;
            const debtKeys = pickOpts?.debtKeys || new Set();
            const alt = nextEligibleSpecial(ctx, order, slotIdx, groupNum, dateKey, debtKeys);
            if (alt) {
                console.warn(
                    `[SPECIAL ENGINE] Αποφυγή διπλής ανάθεσης ομάδα ${groupNum} στις ${dateKey}: ` +
                        `${finalPerson} → ${alt}`
                );
                finalPerson = alt;
            } else {
                console.error(
                    `[SPECIAL ENGINE] Διπλή ανάθεση ομάδα ${groupNum} στις ${dateKey}: ${finalPerson} (χωρίς εναλλακτικό)`
                );
            }
        }
        if (!out.assignments[dateKey]) out.assignments[dateKey] = {};
        out.assignments[dateKey][groupNum] = finalPerson;
        markPersonAssignedSpecial(ctx, groupNum, order, finalPerson);
        return finalPerson;
    }

    function getBaselinePersonForGroup(dateKey, groupNum) {
        const raw =
            typeof rotationBaselineSpecialAssignments !== 'undefined'
                ? rotationBaselineSpecialAssignments?.[dateKey]
                : null;
        if (!raw) return null;
        if (typeof raw === 'object' && !Array.isArray(raw) && typeof extractGroupAssignmentsMap === 'function') {
            return extractGroupAssignmentsMap(raw)[groupNum] || null;
        }
        if (typeof parseAssignedPersonForGroupFromAssignment === 'function') {
            return parseAssignedPersonForGroupFromAssignment(raw, groupNum);
        }
        return null;
    }

    /** Cursor index = next slot after replaying all prior special assignees on canonical order. */
    function resolveInitialSpecialCursor(groupNum, canon, firstDateKey, startDate) {
        const len = (canon || []).length;
        if (!len) return 0;

        const isFebruary2026 =
            startDate && startDate.getFullYear() === 2026 && startDate.getMonth() === 1;
        const isAprilStart = startDate && startDate.getMonth() === 3;
        if (isFebruary2026 || (isAprilStart && (groupNum === 1 || groupNum === 2))) {
            return 0;
        }

        const priorKeys = firstDateKey ? getSpecialHolidayDateKeysBefore(firstDateKey) : [];
        let cursor = 0;
        for (const dk of priorKeys) {
            const assigned = getPriorSpecialAssignee(groupNum, dk);
            if (!assigned) continue;
            const idx = findPersonIndex(canon, assigned, groupNum);
            if (idx >= 0) cursor = (idx + 1) % len;
        }
        return cursor;
    }

    function getSpecialHolidayDateKeysBefore(beforeDateKey) {
        if (typeof window !== 'undefined' && typeof window.getSpecialHolidayDateKeysBefore === 'function') {
            return window.getSpecialHolidayDateKeysBefore(beforeDateKey);
        }
        if (typeof specialHolidayAssignments === 'undefined') return [];
        return Object.keys(specialHolidayAssignments)
            .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk) && dk < beforeDateKey)
            .filter((dk) => {
                const d = new Date(dk + 'T00:00:00');
                return !isNaN(d.getTime()) && (!isSpecialHoliday || isSpecialHoliday(d));
            })
            .sort();
    }

    /** Baseline slot holder for a past special holiday (saved baseline or computed rotation). */
    function getExpectedSpecialSlotHolder(groupNum, dateKey) {
        const fromBaseline = getBaselinePersonForGroup(dateKey, groupNum);
        if (fromBaseline) return fromBaseline;
        if (typeof computeExpectedRotationPersonForDate === 'function') {
            return computeExpectedRotationPersonForDate(DUTY_TYPE_SPECIAL, dateKey, groupNum);
        }
        const order = getSpecialOrderForDate(groupNum, dateKey);
        if (!order.length || typeof getRotationPosition !== 'function') return null;
        const dateObj = new Date(dateKey + 'T00:00:00');
        if (isNaN(dateObj.getTime())) return null;
        const pos = getRotationPosition(dateObj, DUTY_TYPE_SPECIAL, groupNum) % order.length;
        return order[pos] || null;
    }

    function getFinalSpecialAssignee(groupNum, dateKey) {
        const fromTemp =
            typeof calculationSteps !== 'undefined'
                ? calculationSteps?.tempSpecialAssignments?.[dateKey]?.[groupNum]
                : null;
        if (fromTemp) return fromTemp;
        if (typeof specialHolidayAssignments === 'undefined') return null;
        const raw = specialHolidayAssignments[dateKey];
        if (!raw) return null;
        if (typeof parseAssignedPersonForGroupFromAssignment === 'function') {
            return parseAssignedPersonForGroupFromAssignment(raw, groupNum);
        }
        return null;
    }

    /** True if person already served a special between missedDateKey and range start (debt repaid). */
    function wasSpecialDebtAlreadyRepaid(groupNum, personName, missedDateKey, beforeDateKey) {
        if (typeof specialHolidayAssignments === 'undefined') return false;
        const nk = normName(personName);
        const keys = Object.keys(specialHolidayAssignments)
            .filter((dk) => dk > missedDateKey && (!beforeDateKey || dk < beforeDateKey))
            .sort();
        for (const dk of keys) {
            const d = new Date(dk + 'T00:00:00');
            if (isNaN(d.getTime())) continue;
            if (typeof isSpecialHoliday === 'function' && !isSpecialHoliday(d)) continue;
            const assigned = getFinalSpecialAssignee(groupNum, dk);
            if (assigned && normName(assigned) === nk) return true;
        }
        return false;
    }

    /**
     * Debts from special holidays missed before the calculation range.
     * Οφειλή μόνο αν ήταν το slot περιστροφής του ΚΑΙ ήταν απών/απενεργ. εκείνη την ημέρα.
     */
    function collectPriorMonthSpecialDebts(sortedSpecialDays, firstDateKeyInRange) {
        const debts = [];
        const sortedSpecialSet = new Set(sortedSpecialDays || []);
        const added = new Set();

        if (typeof groups === 'undefined') return debts;

        for (let groupNum = 1; groupNum <= 4; groupNum++) {
            const g = groups[groupNum];
            const missingMap = g?.missingPeriods || {};
            const specialList =
                typeof getSortedGroupListForRotation === 'function'
                    ? getSortedGroupListForRotation(groupNum, DUTY_TYPE_SPECIAL)
                    : g?.special || [];
            if (!specialList.length) continue;

            for (const personName of Object.keys(missingMap)) {
                if (!specialList.some((p) => normName(p) === normName(personName))) continue;
                const periods = Array.isArray(missingMap[personName]) ? missingMap[personName] : [];
                for (const period of periods) {
                    const pStartKey =
                        typeof inputValueToDateKey === 'function' ? inputValueToDateKey(period?.start) : null;
                    const pEndKey =
                        typeof inputValueToDateKey === 'function' ? inputValueToDateKey(period?.end) : null;
                    if (!pStartKey || !pEndKey) continue;

                    const dedupeKey = `${groupNum}|${normName(personName)}`;
                    if (added.has(dedupeKey)) break;

                    const pStart = new Date(pStartKey + 'T00:00:00');
                    const pEnd = new Date(pEndKey + 'T00:00:00');
                    if (isNaN(pStart.getTime()) || isNaN(pEnd.getTime())) continue;

                    let missedDateKey = null;
                    for (const d = new Date(pStart); d <= pEnd; d.setDate(d.getDate() + 1)) {
                        if (typeof isSpecialHoliday === 'function' && !isSpecialHoliday(d)) continue;
                        const dk = typeof formatDateKey === 'function' ? formatDateKey(d) : null;
                        if (!dk || sortedSpecialSet.has(dk)) continue;
                        missedDateKey = dk;
                        break;
                    }
                    if (!missedDateKey) continue;
                    if (firstDateKeyInRange && missedDateKey >= firstDateKeyInRange) continue;

                    const slotHolder = getExpectedSpecialSlotHolder(groupNum, missedDateKey);
                    if (!slotHolder || normName(slotHolder) !== normName(personName)) continue;
                    if (canServeSpecial(personName, groupNum, missedDateKey)) continue;

                    const finalOnMissed = getFinalSpecialAssignee(groupNum, missedDateKey);
                    if (finalOnMissed && normName(finalOnMissed) === normName(personName)) continue;
                    if (wasSpecialDebtAlreadyRepaid(groupNum, personName, missedDateKey, firstDateKeyInRange)) continue;

                    added.add(dedupeKey);
                    debts.push({
                        personName,
                        groupNum,
                        owedFromDateKey: missedDateKey,
                        reason: 'missing-prior-month'
                    });
                    break;
                }
            }
        }
        return debts;
    }

    function nextEligibleSpecial(ctx, order, startIdx, groupNum, dateKey, debtPersonKeys) {
        const len = order.length;
        if (!len) return null;
        for (let offset = 1; offset <= len * 2; offset++) {
            const idx = (startIdx + offset) % len;
            const candidate = order[idx];
            if (!candidate) continue;
            const nk = normName(candidate);
            if (debtPersonKeys.has(nk)) continue;
            if (isPersonAssignedThisPeriod(ctx, order, candidate, groupNum)) continue;
            if (!canServeSpecial(candidate, groupNum, dateKey)) continue;
            return candidate;
        }
        return null;
    }

    function sortDebtsForGroup(debts) {
        return debts.slice().sort((a, b) => {
            const byDate = (a.owedFromDateKey || '').localeCompare(b.owedFromDateKey || '');
            if (byDate !== 0) return byDate;
            return 0;
        });
    }

    /**
     * Καταναλώνει το επόμενο slot περιστροφής για μια ημερολογιακή ειδική.
     * Παραλείπει άτομα που έχουν ήδη ανατεθεί στην περίοδο (π.χ. Δ ως αντικαταστάτης στην #3
     * δεν ξαναμπαίνει displaced όταν εξοφλείται ο Β στην #4 — προχωρά στο slot του Ε).
     */
    function consumeNextRotationSlot(ctx, canon, cursor, groupNum, dateKey) {
        const len = canon.length;
        if (!len) return { slotPerson: null, cursor };
        let nextCursor = cursor;
        let skipped = 0;
        while (skipped < len * 2) {
            const slotPerson = canon[nextCursor % len];
            nextCursor++;
            if (!slotPerson) {
                skipped++;
                continue;
            }
            if (dateKey && !isPersonInSpecialRotationOnDate(slotPerson, groupNum, dateKey)) {
                skipped++;
                continue;
            }
            if (!isPersonAssignedThisPeriod(ctx, canon, slotPerson, groupNum)) {
                return { slotPerson, cursor: nextCursor };
            }
            skipped++;
        }
        const fallbackIdx = (nextCursor - 1 + len) % len;
        return { slotPerson: canon[fallbackIdx] || null, cursor: nextCursor };
    }

    function pushReason(out, entry) {
        if (!out.reasonEntries) out.reasonEntries = [];
        out.reasonEntries.push(entry);
    }

    /**
     * Special holidays: displaced cascade → debt repayment (consumes rotation slot) → normal rotation.
     * Debt repayment runs before normal rotation on each day; bumped slot holder goes to displaced queue.
     */
    function runSpecialPhase(options) {
        const opts = options || {};
        const sortedSpecial = (opts.sortedSpecialDays || []).slice().sort();
        const startDate = opts.startDate || null;
        const preservedAssignments = opts.preservedAssignments || {};
        const shouldRecalculateGroup =
            typeof opts.shouldRecalculateGroup === 'function' ? opts.shouldRecalculateGroup : () => true;

        const out = {
            assignments: {},
            slots: {},
            reasonEntries: [],
            cursorByGroup: {},
            simulatedByMonth: {},
            debtsRemaining: []
        };

        if (!sortedSpecial.length) return out;

        const firstDateKey = sortedSpecial[0];
        const priorDebts = collectPriorMonthSpecialDebts(sortedSpecial, firstDateKey);

        for (const dateKey of sortedSpecial) {
            for (let g = 1; g <= 4; g++) {
                if (shouldRecalculateGroup(g)) continue;
                const preserved = preservedAssignments[dateKey]?.[g];
                if (!preserved) continue;
                if (!out.assignments[dateKey]) out.assignments[dateKey] = {};
                out.assignments[dateKey][g] = preserved;
            }
        }

        const groupState = {};
        for (let groupNum = 1; groupNum <= 4; groupNum++) {
            const canon = getCanonicalSpecialOrder(groupNum);
            const assignedThisPeriod = createAssignedTracker();
            seedAssignedFromPriorSpecials(groupNum, firstDateKey, assignedThisPeriod);
            groupState[groupNum] = {
                canon,
                cursor: resolveInitialSpecialCursor(groupNum, canon, firstDateKey, startDate),
                debts: priorDebts.filter((d) => d.groupNum === groupNum),
                displaced: [],
                assignedThisPeriod
            };
        }

        // Αναθέσεις από Firestore (μη-επανυπολογιζόμενες ομάδες) μετράνε ως «ήδη υπηρέτησαν».
        for (const dateKey of sortedSpecial) {
            for (let g = 1; g <= 4; g++) {
                if (shouldRecalculateGroup(g)) continue;
                const preserved = preservedAssignments[dateKey]?.[g];
                if (!preserved || !groupState[g]) continue;
                const orderP = getSpecialOrderForDate(g, dateKey);
                if (!orderP.length) continue;
                markPersonAssignedSpecial(
                    {
                        out,
                        sortedSpecial,
                        currentDateKey: dateKey,
                        assignedThisPeriod: groupState[g].assignedThisPeriod
                    },
                    g,
                    orderP,
                    preserved
                );
            }
        }

        for (const dateKey of sortedSpecial) {
            const dateObj = new Date(dateKey + 'T00:00:00');
            const monthKey =
                typeof getMonthKeyFromDate === 'function' ? getMonthKeyFromDate(dateObj) : null;
            if (typeof setDutyCalcContextDateKey === 'function') {
                setDutyCalcContextDateKey(dateKey);
            }

            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                const preserved = preservedAssignments[dateKey]?.[groupNum];
                if (!shouldRecalculateGroup(groupNum) && preserved) {
                    if (!out.assignments[dateKey]) out.assignments[dateKey] = {};
                    if (!out.slots[dateKey]) out.slots[dateKey] = {};
                    out.assignments[dateKey][groupNum] = preserved;
                    out.slots[dateKey][groupNum] = preserved;
                    const orderPres = groupState[groupNum].canon || getCanonicalSpecialOrder(groupNum);
                    markPersonAssignedSpecial(
                        {
                            out,
                            sortedSpecial,
                            currentDateKey: dateKey,
                            assignedThisPeriod: groupState[groupNum].assignedThisPeriod
                        },
                        groupNum,
                        orderPres,
                        preserved
                    );
                    const pIdx = findPersonIndex(orderPres, preserved, groupNum);
                    if (pIdx >= 0 && orderPres.length) {
                        groupState[groupNum].cursor = (pIdx + 1) % orderPres.length;
                    }
                    if (monthKey) {
                        if (!out.simulatedByMonth[monthKey]) out.simulatedByMonth[monthKey] = {};
                        if (!out.simulatedByMonth[monthKey][groupNum]) out.simulatedByMonth[monthKey][groupNum] = new Set();
                        out.simulatedByMonth[monthKey][groupNum].add(preserved);
                    }
                    continue;
                }

                const order = groupState[groupNum].canon || getCanonicalSpecialOrder(groupNum);
                if (!order.length) continue;

                const st = groupState[groupNum];
                const len = order.length;
                const debtKeys = new Set(st.debts.map((d) => normName(d.personName)));
                const ctx = {
                    out,
                    sortedSpecial,
                    currentDateKey: dateKey,
                    assignedThisPeriod: st.assignedThisPeriod
                };

                let assigned = null;
                let slotPerson = null;
                let assignmentKind = null;

                // 1) Displaced cascade (slot already consumed when they were bumped)
                while (!assigned && st.displaced.length > 0) {
                    const displacedPerson = st.displaced[0];
                    if (
                        !canServeSpecial(displacedPerson, groupNum, dateKey) ||
                        alreadyServedSpecialThisPeriod(ctx, groupNum, displacedPerson)
                    ) {
                        st.displaced.shift();
                        continue;
                    }
                    assigned = st.displaced.shift();
                    slotPerson = assigned;
                    assigned = commitSpecialAssignment(out, dateKey, groupNum, assigned, ctx, order);
                    assignmentKind = 'displaced-cascade';
                    pushReason(out, {
                        dateKey,
                        groupNum,
                        personName: assigned,
                        type: 'skip',
                        reason: `Τοποθετήθηκε (cascade) — είχε μετακινηθεί από προηγούμενη ειδική.`,
                        swappedWith: null,
                        meta: { displacedCascade: true, dutyType: DUTY_TYPE_SPECIAL }
                    });
                }

                // 2) Debt repayment FIRST — consumes one rotation slot; slot holder → displaced
                if (!assigned && st.debts.length > 0) {
                    const sortedDebts = sortDebtsForGroup(st.debts);
                    for (let di = 0; di < sortedDebts.length; di++) {
                        const debt = sortedDebts[di];
                        if (!canServeSpecial(debt.personName, groupNum, dateKey)) continue;
                        if (alreadyServedSpecialThisPeriod(ctx, groupNum, debt.personName)) {
                            st.debts = st.debts.filter(
                                (d) =>
                                    normName(d.personName) !== normName(debt.personName) ||
                                    d.owedFromDateKey !== debt.owedFromDateKey
                            );
                            debtKeys.delete(normName(debt.personName));
                            continue;
                        }

                        const consumed = consumeNextRotationSlot(ctx, order, st.cursor, groupNum, dateKey);
                        slotPerson = consumed.slotPerson;
                        st.cursor = consumed.cursor;
                        if (!slotPerson) continue;
                        assigned = debt.personName;
                        assigned = commitSpecialAssignment(out, dateKey, groupNum, assigned, ctx, order, {
                            slotIdx: st.cursor % len,
                            debtKeys
                        });
                        st.debts = st.debts.filter(
                            (d) => normName(d.personName) !== normName(debt.personName) || d.owedFromDateKey !== debt.owedFromDateKey
                        );
                        debtKeys.delete(normName(debt.personName));
                        st.displaced.push(slotPerson);
                        assignmentKind = 'debt-repayment';

                        const reasonText = `Εξόφληση οφειλής ειδικής: ο/η ${assigned} (χρωστούσε από ${debt.owedFromDateKey}). Το slot περιστροφής ${slotPerson} μετακινήθηκε σε επόμενη ειδική.`;
                        pushReason(out, {
                            dateKey,
                            groupNum,
                            personName: assigned,
                            type: 'skip',
                            reason: reasonText,
                            swappedWith: slotPerson,
                            meta: {
                                returnFromMissing: true,
                                debtRepayment: true,
                                dutyType: DUTY_TYPE_SPECIAL,
                                owedFromDateKey: debt.owedFromDateKey,
                                displacedSlotPerson: slotPerson
                            }
                        });
                        break;
                    }
                }

                // 3) Normal rotation — consumeNextRotationSlot παραλείπει όσους έχουν ήδη υπηρετήσει
                // (στην περίοδο ή σε προηγούμενη ειδική με αντικατάσταση από Firebase)
                if (!assigned) {
                    const consumed = consumeNextRotationSlot(ctx, order, st.cursor, groupNum, dateKey);
                    slotPerson = consumed.slotPerson;
                    st.cursor = consumed.cursor;
                    const slotIdx = slotPerson ? findPersonIndex(order, slotPerson, groupNum) : 0;

                    const slotNk = normName(slotPerson);
                    const slotCanServe = slotPerson && canServeSpecial(slotPerson, groupNum, dateKey);
                    const slotAlreadyAssigned =
                        slotPerson && isPersonAssignedThisPeriod(ctx, order, slotPerson, groupNum);

                    if (slotCanServe && !slotAlreadyAssigned) {
                        assigned = slotPerson;
                        assignmentKind = 'rotation';
                    } else {
                        if (!slotCanServe) {
                            const why = unavailableReason(slotPerson, groupNum, dateKey);
                            if (!st.debts.some((d) => normName(d.personName) === slotNk)) {
                                st.debts.push({
                                    personName: slotPerson,
                                    groupNum,
                                    owedFromDateKey: dateKey,
                                    reason: why
                                });
                            }
                            debtKeys.add(slotNk);
                        }

                        const replacement = nextEligibleSpecial(
                            ctx,
                            order,
                            slotIdx,
                            groupNum,
                            dateKey,
                            debtKeys
                        );
                        if (replacement) {
                            assigned = replacement;
                            assigned = commitSpecialAssignment(out, dateKey, groupNum, replacement, ctx, order, {
                                slotIdx,
                                debtKeys
                            });
                            assignmentKind = slotAlreadyAssigned ? 'already-served-replacement' : 'unavailable-replacement';
                            const reasonText = slotAlreadyAssigned
                                ? `Βασική σειρά: ${slotPerson} (ήδη είχε ειδική). Αντικατάσταση: ${replacement}.`
                                : `Βασική σειρά: ${slotPerson} (${!slotCanServe ? unavailableReason(slotPerson, groupNum, dateKey) : 'απουσία'}). Αντικατάσταση: ${replacement}.`;
                            const unavailMeta =
                                !slotCanServe && !slotAlreadyAssigned
                                    ? {
                                          unavailableReplacement: true,
                                          replacementPersonName: replacement,
                                          skippedPersonName: slotPerson,
                                          dateKey,
                                          dutyCategory: DUTY_TYPE_SPECIAL
                                      }
                                    : {};
                            pushReason(out, {
                                dateKey,
                                groupNum,
                                personName: replacement,
                                type: 'skip',
                                reason: reasonText,
                                swappedWith: slotPerson,
                                meta: {
                                    baselinePerson: slotPerson,
                                    replacementType: slotAlreadyAssigned ? 'already-on-special' : 'next-in-baseline',
                                    missedDateKey: dateKey,
                                    dutyType: DUTY_TYPE_SPECIAL,
                                    ...unavailMeta
                                }
                            });
                            if (!slotCanServe && !slotAlreadyAssigned) {
                                // Person who missed slot is already in debts from above
                            }
                        }
                    }
                }

                if (!out.slots[dateKey]) out.slots[dateKey] = {};
                out.slots[dateKey][groupNum] = slotPerson || assigned || null;

                if (assigned) {
                    if (!out.assignments[dateKey]?.[groupNum]) {
                        assigned = commitSpecialAssignment(out, dateKey, groupNum, assigned, ctx, order, {
                            slotIdx: (st.cursor - 1 + len) % len,
                            debtKeys
                        });
                    }
                    if (monthKey) {
                        if (!out.simulatedByMonth[monthKey]) out.simulatedByMonth[monthKey] = {};
                        if (!out.simulatedByMonth[monthKey][groupNum]) out.simulatedByMonth[monthKey][groupNum] = new Set();
                        out.simulatedByMonth[monthKey][groupNum].add(assigned);
                    }
                } else if (assignmentKind) {
                    // slot consumed but no assignee
                }

                // Συγχρονισμός cursor μετά το slot που καταναλώθηκε (όχι cascade)
                if (slotPerson && assignmentKind && assignmentKind !== 'displaced-cascade') {
                    const slotIdx = findPersonIndex(order, slotPerson, groupNum);
                    if (slotIdx >= 0) st.cursor = (slotIdx + 1) % len;
                }
            }
        }

        for (let g = 1; g <= 4; g++) {
            out.cursorByGroup[g] = groupState[g].cursor;
            for (const d of groupState[g].debts) {
                out.debtsRemaining.push(d);
            }
        }

        return out;
    }

    const DutyRotationEngine = {
        runSpecialPhase,
        resolveInitialSpecialCursor,
        collectPriorMonthSpecialDebts,
        normName,
        canServeSpecial,
        namesReferToSamePerson
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DutyRotationEngine;
    }
    global.DutyRotationEngine = DutyRotationEngine;
})(typeof window !== 'undefined' ? window : globalThis);
