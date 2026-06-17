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

    function findPersonIndex(order, personName) {
        if (!personName || !Array.isArray(order)) return -1;
        const t = normName(personName);
        for (let i = 0; i < order.length; i++) {
            if (normName(order[i]) === t) return i;
        }
        return -1;
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
        if (typeof isPersonDisabledForDuty === 'function' && isPersonDisabledForDuty(personName, groupNum, DUTY_TYPE_SPECIAL)) {
            return false;
        }
        return true;
    }

    function unavailableReason(personName, groupNum, dateKey) {
        const dateObj = new Date(dateKey + 'T00:00:00');
        if (typeof isPersonDisabledForDuty === 'function' && isPersonDisabledForDuty(personName, groupNum, DUTY_TYPE_SPECIAL)) {
            return 'disabled';
        }
        if (typeof isPersonMissingOnDate === 'function' && isPersonMissingOnDate(personName, groupNum, dateObj, DUTY_TYPE_SPECIAL)) {
            return 'missing';
        }
        return 'unavailable';
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

        if (firstDateKey) {
            const continuitySlot = getLastSpecialContinuitySlotBefore(groupNum, firstDateKey);
            if (continuitySlot) {
                const contIdx = findPersonIndex(order, continuitySlot);
                if (contIdx >= 0) return (contIdx + 1) % len;
            }

            if (typeof getRotationSeedPersonForMonthStart === 'function') {
                const seedPerson = getRotationSeedPersonForMonthStart(
                    DUTY_TYPE_SPECIAL,
                    new Date(firstDateKey + 'T00:00:00'),
                    groupNum
                );
                const seedIdx = findPersonIndex(order, seedPerson);
                if (seedIdx >= 0) return (seedIdx + 1) % len;
            }
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

    function getAssigneeFromStoreRaw(raw, groupNum) {
        if (!raw) return null;
        if (typeof raw === 'object' && !Array.isArray(raw)) {
            const direct = raw[groupNum] || raw[String(groupNum)];
            if (direct) return direct;
        }
        if (typeof extractGroupAssignmentsMap === 'function') {
            const map = extractGroupAssignmentsMap(raw);
            const fromMap = map?.[groupNum] || map?.[String(groupNum)];
            if (fromMap) return fromMap;
        }
        if (typeof parseAssignedPersonForGroupFromAssignment === 'function') {
            return parseAssignedPersonForGroupFromAssignment(raw, groupNum);
        }
        return null;
    }

    function getFinalSpecialAssignee(groupNum, dateKey, store) {
        const src =
            store ||
            (typeof specialHolidayAssignments !== 'undefined' ? specialHolidayAssignments : null);
        if (!src) return null;
        return getAssigneeFromStoreRaw(src[dateKey], groupNum);
    }

    /** Τελευταίο καταναλωμένο slot περιστροφής πριν την περίοδο (όχι το display baseline). */
    function getLastSpecialContinuitySlotBefore(groupNum, firstDateKey) {
        const prevMonthKey = getPreviousMonthKeyFromDateKey(firstDateKey);
        const dateObj = new Date(firstDateKey + 'T00:00:00');

        if (typeof getLastRotationPersonForDate === 'function') {
            const stored = getLastRotationPersonForDate(DUTY_TYPE_SPECIAL, dateObj, groupNum);
            if (stored) return stored;
        }

        if (typeof assignmentReasons !== 'undefined' && prevMonthKey) {
            const reasonKeys = Object.keys(assignmentReasons || {})
                .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk) && dk < firstDateKey)
                .filter((dk) => dk.substring(0, 7) === prevMonthKey)
                .sort();
            if (reasonKeys.length) {
                const lastKey = reasonKeys[reasonKeys.length - 1];
                const gmap = assignmentReasons[lastKey]?.[groupNum];
                if (gmap && typeof gmap === 'object') {
                    for (const personKey of Object.keys(gmap)) {
                        const r = gmap[personKey];
                        const meta = r?.meta || {};
                        if (meta.lastConsumedSlotPerson) return meta.lastConsumedSlotPerson;
                        const chain = meta.skippedChain;
                        if (Array.isArray(chain) && chain.length) return chain[chain.length - 1];
                    }
                }
            }
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

    function registerSpecialDebt(st, debtKeys, personName, groupNum, dateKey) {
        const nk = normName(personName);
        if (!nk) return;
        if (!st.debts.some((d) => normName(d.personName) === nk)) {
            st.debts.push({
                personName,
                groupNum,
                owedFromDateKey: dateKey,
                reason: unavailableReason(personName, groupNum, dateKey)
            });
        }
        debtKeys.add(nk);
    }

    /**
     * Συνεχόμενα slot περιστροφής που δεν μπορούν να υπηρετήσουν (όχι ήδη ανατεθέντα).
     * Σταματά στο πρώτο που μπορεί ή που έχει ήδη ειδική στην περίοδο.
     */
    function collectConsecutiveUnavailableSlots(order, startIdx, groupNum, dateKey, assignedThisPeriod) {
        const len = order.length;
        const chain = [];
        for (let offset = 0; offset < len; offset++) {
            const idx = (startIdx + offset) % len;
            const person = order[idx];
            if (!person) break;
            const nk = normName(person);
            if (assignedThisPeriod.has(nk)) break;
            if (canServeSpecial(person, groupNum, dateKey)) break;
            chain.push({ person, idx });
        }
        return chain;
    }

    function buildUnavailableChainReasonText(chain, replacement, groupNum, dateKey) {
        if (!chain.length) return '';
        const names = chain.map((c) => c.person).join(', ');
        const reasons = [
            ...new Set(
                chain.map((c) => unavailableReason(c.person, groupNum, dateKey)).filter((r) => r && r !== 'unavailable')
            )
        ];
        const reasonSuffix = reasons.length ? ` (${reasons.join(', ')})` : '';
        if (chain.length === 1) {
            return `Βασική σειρά: ${chain[0].person}${reasonSuffix}. Αντικατάσταση: ${replacement}.`;
        }
        return `Βασική σειρά: ${names}${reasonSuffix} — συνεχόμενα μη διαθέσιμα. Αντικατάσταση: ${replacement}.`;
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
            if (assignedThisPeriod.has(nk)) continue;
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
    function consumeNextRotationSlot(order, cursor, assignedThisPeriod) {
        const len = order.length;
        if (!len) return { slotPerson: null, cursor };
        let nextCursor = cursor;
        let skipped = 0;
        while (skipped < len) {
            const slotPerson = order[nextCursor % len];
            nextCursor++;
            if (!assignedThisPeriod.has(normName(slotPerson))) {
                return { slotPerson, cursor: nextCursor };
            }
            skipped++;
        }
        const fallbackIdx = (nextCursor - 1 + len) % len;
        return { slotPerson: order[fallbackIdx] || null, cursor: nextCursor };
    }

    /** Προηγούμενος μήνας (YYYY-MM) από dateKey. */
    function getPreviousMonthKeyFromDateKey(dateKey) {
        const d = new Date(dateKey + 'T00:00:00');
        if (isNaN(d.getTime())) return null;
        if (typeof getPreviousMonthKeyFromDate === 'function') {
            return getPreviousMonthKeyFromDate(d);
        }
        const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
        return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
    }

    /**
     * Όσοι υπηρέτησαν ειδική πριν την περίοδο υπολογισμού — δεν ξαναμπαίνουν στο τρέχον lap.
     * Lap = οι τελευταίες N αναθέσεις (N = μήκος λίστας περιστροφής) πριν την πρώτη ημέρα.
     * Διαβάζει specialHolidayAssignments + πρόσθετα stores (temp κ.λπ.).
     */
    function seedAssignedThisPeriodFromPriorSpecials(groupNum, firstDateKey, assignedSet, extraStores, rotationLen) {
        if (!firstDateKey) return;

        const stores = [];
        if (typeof specialHolidayAssignments !== 'undefined') stores.push(specialHolidayAssignments);
        if (Array.isArray(extraStores)) {
            for (const s of extraStores) {
                if (s && typeof s === 'object') stores.push(s);
            }
        }

        const entries = [];
        const seenDatePerson = new Set();
        for (const store of stores) {
            for (const dk of Object.keys(store).sort()) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
                if (dk >= firstDateKey) continue;
                const assigned = getFinalSpecialAssignee(groupNum, dk, store);
                if (!assigned) continue;
                const dedupe = `${dk}|${normName(assigned)}`;
                if (seenDatePerson.has(dedupe)) continue;
                seenDatePerson.add(dedupe);
                entries.push({ dateKey: dk, person: assigned });
            }
        }
        entries.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

        const lapSize = Math.max(1, rotationLen || entries.length);
        const lapEntries = entries.slice(-lapSize);
        for (const { person } of lapEntries) {
            assignedSet.add(normName(person));
        }
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
        const priorAssignmentStores = opts.priorAssignmentStores || [];
        const shouldRecalculateGroup =
            typeof opts.shouldRecalculateGroup === 'function' ? opts.shouldRecalculateGroup : () => true;

        const out = {
            assignments: {},
            slots: {},
            slotContinuity: {},
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
                assignedThisPeriod: new Set()
            };
            seedAssignedThisPeriodFromPriorSpecials(
                groupNum,
                firstDateKey,
                groupState[groupNum].assignedThisPeriod,
                priorAssignmentStores,
                order0.length
            );
        }

        for (const dateKey of sortedSpecial) {
            const dateObj = new Date(dateKey + 'T00:00:00');
            const monthKey =
                typeof getMonthKeyFromDate === 'function' ? getMonthKeyFromDate(dateObj) : null;

            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                const preserved = preservedAssignments[dateKey]?.[groupNum];
                if (!shouldRecalculateGroup(groupNum) && preserved) {
                    if (!out.assignments[dateKey]) out.assignments[dateKey] = {};
                    if (!out.slots[dateKey]) out.slots[dateKey] = {};
                    out.assignments[dateKey][groupNum] = preserved;
                    out.slots[dateKey][groupNum] = preserved;
                    if (!out.slotContinuity[dateKey]) out.slotContinuity[dateKey] = {};
                    out.slotContinuity[dateKey][groupNum] = preserved;
                    groupState[groupNum].assignedThisPeriod.add(normName(preserved));
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
                let slotContinuityPerson = null;
                let assignmentKind = null;

                // 1) Displaced cascade (slot already consumed when they were bumped)
                if (st.displaced.length > 0) {
                    const displacedPerson = st.displaced[0];
                    if (canServeSpecial(displacedPerson, groupNum, dateKey)) {
                        assigned = st.displaced.shift();
                        slotPerson = assigned;
                        slotContinuityPerson = assigned;
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

                        const consumed = consumeNextRotationSlot(order, st.cursor, st.assignedThisPeriod);
                        slotPerson = consumed.slotPerson;
                        slotContinuityPerson = slotPerson;
                        st.cursor = consumed.cursor;
                        if (!slotPerson) continue;
                        assigned = debt.personName;
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
                    const slotIdx = st.cursor % len;
                    slotPerson = order[slotIdx];
                    const slotNk = normName(slotPerson);
                    const slotCanServe = canServeSpecial(slotPerson, groupNum, dateKey);
                    const slotAlreadyAssigned = st.assignedThisPeriod.has(slotNk);

                    if (slotCanServe && !slotAlreadyAssigned) {
                        assigned = slotPerson;
                        assignmentKind = 'rotation';
                        slotContinuityPerson = slotPerson;
                        st.cursor++;
                    } else {
                        const unavailableChain = collectConsecutiveUnavailableSlots(
                            order,
                            slotIdx,
                            groupNum,
                            dateKey,
                            st.assignedThisPeriod
                        );

                        if (unavailableChain.length > 0) {
                            st.cursor += unavailableChain.length;
                            slotPerson = unavailableChain[0].person;
                            slotContinuityPerson = unavailableChain[unavailableChain.length - 1].person;
                            for (const { person } of unavailableChain) {
                                registerSpecialDebt(st, debtKeys, person, groupNum, dateKey);
                            }
                            const lastIdx = unavailableChain[unavailableChain.length - 1].idx;
                            const replacement = nextEligibleSpecial(
                                order,
                                lastIdx,
                                groupNum,
                                dateKey,
                                st.assignedThisPeriod,
                                debtKeys
                            );
                            if (replacement) {
                                assigned = replacement;
                                assignmentKind = 'unavailable-replacement';
                                const reasonText = buildUnavailableChainReasonText(
                                    unavailableChain,
                                    replacement,
                                    groupNum,
                                    dateKey
                                );
                                pushReason(out, {
                                    dateKey,
                                    groupNum,
                                    personName: replacement,
                                    type: 'skip',
                                    reason: reasonText,
                                    swappedWith: slotPerson,
                                    meta: {
                                        baselinePerson: slotPerson,
                                        lastConsumedSlotPerson: slotContinuityPerson,
                                        replacementType: 'next-in-baseline',
                                        consecutiveUnavailable: unavailableChain.length > 1,
                                        skippedChain: unavailableChain.map((c) => c.person),
                                        missedDateKey: dateKey,
                                        dutyType: DUTY_TYPE_SPECIAL,
                                        unavailableReplacement: true,
                                        replacementPersonName: replacement,
                                        skippedPersonName: slotPerson,
                                        dutyCategory: DUTY_TYPE_SPECIAL
                                    }
                                });
                            }
                        } else {
                            st.cursor++;
                            slotContinuityPerson = slotPerson;
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
                                assignmentKind = 'already-served-replacement';
                                const reasonText = `Βασική σειρά: ${slotPerson} (ήδη είχε ειδική στην περίοδο/προηγούμενες αναθέσεις). Αντικατάσταση: ${replacement}.`;
                                pushReason(out, {
                                    dateKey,
                                    groupNum,
                                    personName: replacement,
                                    type: 'skip',
                                    reason: reasonText,
                                    swappedWith: slotPerson,
                                    meta: {
                                        baselinePerson: slotPerson,
                                        replacementType: 'already-on-special',
                                        missedDateKey: dateKey,
                                        dutyType: DUTY_TYPE_SPECIAL
                                    }
                                });
                            }
                        }
                    }
                }

                if (!out.slots[dateKey]) out.slots[dateKey] = {};
                out.slots[dateKey][groupNum] = slotPerson || assigned || null;
                if (!out.slotContinuity[dateKey]) out.slotContinuity[dateKey] = {};
                out.slotContinuity[dateKey][groupNum] =
                    slotContinuityPerson || slotPerson || assigned || null;

                if (assigned) {
                    if (!out.assignments[dateKey]) out.assignments[dateKey] = {};
                    out.assignments[dateKey][groupNum] = assigned;
                    st.assignedThisPeriod.add(normName(assigned));
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
