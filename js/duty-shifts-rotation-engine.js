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
        const gd =
            typeof groupsForDuty === 'function'
                ? groupsForDuty(groupNum, dateKey)
                : typeof groups !== 'undefined'
                  ? groups[groupNum]
                  : null;
        return (gd?.special || []).filter(Boolean);
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

    /** Έχει ήδη ανατεθεί ειδική στην περίοδο (ονομα + θέση στη βασική σειρά priorities). */
    function isPersonAssignedThisPeriod(order, assignedThisPeriod, personName, groupNum) {
        if (!personName) return false;
        const canonIdx = groupNum ? getCanonicalIndex(groupNum, personName) : -1;
        if (canonIdx >= 0 && assignedThisPeriod.canonicalIndices?.has(canonIdx)) return true;
        const names = assignedThisPeriod.names;
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

    function isPersonAssignedSpecial(groupNum, assignedTracker, order, personName) {
        return isPersonAssignedThisPeriod(order, assignedTracker, personName, groupNum);
    }

    function markPersonAssignedSpecial(groupNum, assignedTracker, order, personName) {
        markPersonAssignedThisPeriod(assignedTracker, order, personName, groupNum);
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

    /** Cursor index = next slot in ORDER after last baseline / seed. */
    function resolveInitialSpecialCursor(groupNum, order, firstDateKey, startDate) {
        const len = order.length;
        if (!len) return 0;

        const isFebruary2026 =
            startDate && startDate.getFullYear() === 2026 && startDate.getMonth() === 1;
        const isAprilStart = startDate && startDate.getMonth() === 3;
        if (isFebruary2026 || (isAprilStart && (groupNum === 1 || groupNum === 2))) {
            return 0;
        }

        if (firstDateKey && typeof getRotationSeedPersonForMonthStart === 'function') {
            const seedPerson = getRotationSeedPersonForMonthStart(
                DUTY_TYPE_SPECIAL,
                new Date(firstDateKey + 'T00:00:00'),
                groupNum
            );
            const seedIdx = findPersonIndex(order, seedPerson, groupNum);
            if (seedIdx >= 0) return (seedIdx + 1) % len;
        }

        const baselineDateKeysBeforePeriod = firstDateKey
            ? Object.keys(
                  (typeof rotationBaselineSpecialAssignments !== 'undefined'
                      ? rotationBaselineSpecialAssignments
                      : {}) || {}
              )
                  .filter((dk) => dk < firstDateKey)
                  .sort()
                  .reverse()
            : [];
        if (baselineDateKeysBeforePeriod.length > 0) {
            const lastBaselinePerson = getBaselinePersonForGroup(baselineDateKeysBeforePeriod[0], groupNum);
            const idx = findPersonIndex(order, lastBaselinePerson, groupNum);
            if (idx >= 0) return (idx + 1) % len;
        }
        return 0;
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

    function nextEligibleSpecial(order, startIdx, groupNum, dateKey, assignedThisPeriod, debtPersonKeys) {
        const len = order.length;
        if (!len) return null;
        for (let offset = 1; offset <= len * 2; offset++) {
            const idx = (startIdx + offset) % len;
            const candidate = order[idx];
            if (!candidate) continue;
            const nk = normName(candidate);
            if (debtPersonKeys.has(nk)) continue;
            if (isPersonAssignedThisPeriod(order, assignedThisPeriod, candidate, groupNum)) continue;
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
    function consumeNextRotationSlot(order, cursor, assignedThisPeriod, groupNum) {
        const len = order.length;
        if (!len) return { slotPerson: null, cursor };
        let nextCursor = cursor;
        let skipped = 0;
        while (skipped < len) {
            const slotPerson = order[nextCursor % len];
            nextCursor++;
            if (!isPersonAssignedThisPeriod(order, assignedThisPeriod, slotPerson, groupNum)) {
                return { slotPerson, cursor: nextCursor };
            }
            skipped++;
        }
        const fallbackIdx = (nextCursor - 1 + len) % len;
        return { slotPerson: order[fallbackIdx] || null, cursor: nextCursor };
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

        const groupState = {};
        for (let groupNum = 1; groupNum <= 4; groupNum++) {
            const order0 = getSpecialOrderForDate(groupNum, firstDateKey);
            groupState[groupNum] = {
                cursor: resolveInitialSpecialCursor(groupNum, order0, firstDateKey, startDate),
                debts: priorDebts.filter((d) => d.groupNum === groupNum),
                displaced: [],
                assignedThisPeriod: createAssignedTracker()
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
                markPersonAssignedSpecial(g, groupState[g].assignedThisPeriod, orderP, preserved);
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
                    markPersonAssignedSpecial(
                        groupNum,
                        groupState[groupNum].assignedThisPeriod,
                        getSpecialOrderForDate(groupNum, dateKey),
                        preserved
                    );
                    if (monthKey) {
                        if (!out.simulatedByMonth[monthKey]) out.simulatedByMonth[monthKey] = {};
                        if (!out.simulatedByMonth[monthKey][groupNum]) out.simulatedByMonth[monthKey][groupNum] = new Set();
                        out.simulatedByMonth[monthKey][groupNum].add(preserved);
                    }
                    continue;
                }

                const order = getSpecialOrderForDate(groupNum, dateKey);
                if (!order.length) continue;

                const st = groupState[groupNum];
                const len = order.length;
                const debtKeys = new Set(st.debts.map((d) => normName(d.personName)));

                let assigned = null;
                let slotPerson = null;
                let assignmentKind = null;

                // 1) Displaced cascade (slot already consumed when they were bumped)
                if (st.displaced.length > 0) {
                    const displacedPerson = st.displaced[0];
                    if (canServeSpecial(displacedPerson, groupNum, dateKey)) {
                        assigned = st.displaced.shift();
                        slotPerson = assigned;
                        markPersonAssignedSpecial(groupNum, st.assignedThisPeriod, order, assigned);
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
                }

                // 2) Debt repayment FIRST — consumes one rotation slot; slot holder → displaced
                if (!assigned && st.debts.length > 0) {
                    const sortedDebts = sortDebtsForGroup(st.debts);
                    for (let di = 0; di < sortedDebts.length; di++) {
                        const debt = sortedDebts[di];
                        if (!canServeSpecial(debt.personName, groupNum, dateKey)) continue;

                        const consumed = consumeNextRotationSlot(order, st.cursor, st.assignedThisPeriod, groupNum);
                        slotPerson = consumed.slotPerson;
                        st.cursor = consumed.cursor;
                        if (!slotPerson) continue;
                        assigned = debt.personName;
                        markPersonAssignedSpecial(groupNum, st.assignedThisPeriod, order, assigned);
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

                // 3) Normal rotation
                if (!assigned) {
                    slotPerson = order[st.cursor % len];
                    const slotIdx = st.cursor % len;
                    st.cursor++;

                    const slotNk = normName(slotPerson);
                    const slotCanServe = canServeSpecial(slotPerson, groupNum, dateKey);
                    const slotAlreadyAssigned = isPersonAssignedThisPeriod(
                        order,
                        st.assignedThisPeriod,
                        slotPerson,
                        groupNum
                    );

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
                            order,
                            slotIdx,
                            groupNum,
                            dateKey,
                            st.assignedThisPeriod,
                            debtKeys
                        );
                        if (replacement) {
                            assigned = replacement;
                            markPersonAssignedSpecial(groupNum, st.assignedThisPeriod, order, replacement);
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
                    if (!out.assignments[dateKey]) out.assignments[dateKey] = {};
                    out.assignments[dateKey][groupNum] = assigned;
                    markPersonAssignedSpecial(groupNum, st.assignedThisPeriod, order, assigned);
                    if (monthKey) {
                        if (!out.simulatedByMonth[monthKey]) out.simulatedByMonth[monthKey] = {};
                        if (!out.simulatedByMonth[monthKey][groupNum]) out.simulatedByMonth[monthKey][groupNum] = new Set();
                        out.simulatedByMonth[monthKey][groupNum].add(assigned);
                    }
                } else if (assignmentKind) {
                    // slot consumed but no assignee
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
        canServeSpecial
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = DutyRotationEngine;
    }
    global.DutyRotationEngine = DutyRotationEngine;
})(typeof window !== 'undefined' ? window : globalThis);
