// ============================================================================
// DUTY-SHIFTS-NIGHT-CHANGES.JS — Νυχτερινές με αλλαγές (ομάδες 3 & 4)
// Κανόνας Ν καθημερινών Πεμπτών + ανταλλαγές Δευτ/Τρί/Τετ εντός μήνα
// ============================================================================

(function () {
    const NIGHT_GROUPS = [3, 4];

    function normPerson(s) {
        return typeof normalizePersonKey === 'function' ? normalizePersonKey(s) : String(s || '').trim();
    }

    function countActiveNormalListSize(groupNum, dateKey) {
        const gd =
            typeof groupsForDuty === 'function'
                ? groupsForDuty(groupNum, dateKey)
                : typeof groups !== 'undefined'
                  ? groups[groupNum]
                  : null;
        const list = (gd && gd.normal) || [];
        let count = 0;
        for (const p of list) {
            if (!p) continue;
            if (
                typeof isPersonDisabledForDuty === 'function' &&
                isPersonDisabledForDuty(p, groupNum, 'normal', dateKey)
            ) {
                continue;
            }
            count++;
        }
        return count;
    }

    function getAssigneeOnDate(dateKey, groupNum, currentAssignments) {
        const fromCurrent = currentAssignments?.[dateKey]?.[groupNum] ?? currentAssignments?.[dateKey]?.[String(groupNum)];
        if (fromCurrent) return fromCurrent;

        let merged = null;
        if (typeof extractGroupAssignmentsMap === 'function') {
            const normalMap = extractGroupAssignmentsMap(
                typeof normalDayAssignments !== 'undefined' ? normalDayAssignments[dateKey] : null
            );
            const nightMap = extractGroupAssignmentsMap(
                typeof nightAssignments !== 'undefined' ? nightAssignments[dateKey] : null
            );
            if (normalMap && normalMap[groupNum]) merged = normalMap[groupNum];
            else if (nightMap && nightMap[groupNum]) merged = nightMap[groupNum];
        }
        return merged || null;
    }

    function collectHistoricalThursdayDateKeys(beforeDateKey, currentAssignments) {
        const keys = new Set();
        const addFrom = (store) => {
            if (!store || typeof store !== 'object') return;
            for (const dk of Object.keys(store)) {
                if (dk >= beforeDateKey) continue;
                if (typeof isNightThursdayDateKey === 'function' && isNightThursdayDateKey(dk)) {
                    keys.add(dk);
                }
            }
        };
        addFrom(typeof normalDayAssignments !== 'undefined' ? normalDayAssignments : null);
        addFrom(typeof nightAssignments !== 'undefined' ? nightAssignments : null);
        addFrom(currentAssignments);
        return [...keys].sort();
    }

    function findLastThursdayForPerson(person, groupNum, beforeDateKey, currentAssignments, runtimeLastThu) {
        const pk = `${groupNum}:${normPerson(person)}`;
        if (runtimeLastThu && runtimeLastThu[pk]) return runtimeLastThu[pk];

        const thursdays = collectHistoricalThursdayDateKeys(beforeDateKey, currentAssignments);
        for (let i = thursdays.length - 1; i >= 0; i--) {
            const dk = thursdays[i];
            const assignee = getAssigneeOnDate(dk, groupNum, currentAssignments);
            if (assignee && normPerson(assignee) === normPerson(person)) return dk;
        }
        return null;
    }

    /** Καθημερινές Πέμπτες στο (lastDateKey, currentDateKey] */
    function countNormalThursdaysSinceLast(lastDateKey, currentDateKey) {
        if (!lastDateKey || !currentDateKey) return Infinity;
        if (lastDateKey >= currentDateKey) return 0;
        let count = 0;
        const d = new Date(lastDateKey + 'T00:00:00');
        if (isNaN(d.getTime())) return Infinity;
        d.setDate(d.getDate() + 1);
        const end = new Date(currentDateKey + 'T00:00:00');
        while (d <= end) {
            const key = typeof formatDateKey === 'function' ? formatDateKey(d) : null;
            if (key && typeof isNightThursdayDateKey === 'function' && isNightThursdayDateKey(key)) {
                count++;
            }
            d.setDate(d.getDate() + 1);
        }
        return count;
    }

    function personPassesThursdaySpacing(person, groupNum, thursdayDateKey, currentAssignments, runtimeLastThu) {
        const nRequired = countActiveNormalListSize(groupNum, thursdayDateKey);
        if (nRequired <= 0) {
            return { eligible: true, nRequired: 0, thursdaysSince: null, lastThursday: null };
        }
        const lastKey = findLastThursdayForPerson(person, groupNum, thursdayDateKey, currentAssignments, runtimeLastThu);
        if (!lastKey) {
            return { eligible: true, nRequired, thursdaysSince: null, lastThursday: null };
        }
        const thursdaysSince = countNormalThursdaysSinceLast(lastKey, thursdayDateKey);
        return {
            eligible: thursdaysSince >= nRequired,
            nRequired,
            thursdaysSince,
            lastThursday: lastKey
        };
    }

    function getMonTueWedKeysInMonth(monthKey, normalDays) {
        const out = [];
        for (const dk of normalDays || []) {
            if (!dk || typeof dk !== 'string') continue;
            const d = new Date(dk + 'T00:00:00');
            if (isNaN(d.getTime())) continue;
            if (typeof getMonthKeyFromDate === 'function' && getMonthKeyFromDate(d) !== monthKey) continue;
            const dow = d.getDay();
            if (dow === 1 || dow === 2 || dow === 3) out.push(dk);
        }
        return out.sort();
    }

    function formatDateKeyElGR(dateKey) {
        if (!dateKey) return '—';
        const d = new Date(dateKey + 'T00:00:00');
        if (isNaN(d.getTime())) return String(dateKey);
        return d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    function dayNameForDateKey(dateKey) {
        if (!dateKey) return '';
        const d = new Date(dateKey + 'T00:00:00');
        if (isNaN(d.getTime())) return '';
        return typeof getGreekDayName === 'function' ? getGreekDayName(d) : '';
    }

    /**
     * Λεπτομερής λόγος ανταλλαγής Πέμπτης (κανόνας Ν).
     * @param displacedPerson — αυτός που θα έβγαινε Πέμπτη (σειρά) αλλά δεν περνούσε Ν
     * @param replacementPerson — αυτός που μπήκε στην Πέμπτη
     */
    function buildThursdaySpacingSwapReason(
        displacedPerson,
        replacementPerson,
        thursdayKey,
        partnerKey,
        spacing
    ) {
        const thuDate = formatDateKeyElGR(thursdayKey);
        const partnerDate = formatDateKeyElGR(partnerKey);
        const partnerDay = dayNameForDateKey(partnerKey);
        const lastThu = spacing?.lastThursday ? formatDateKeyElGR(spacing.lastThursday) : '—';
        const nReq = spacing?.nRequired ?? '?';
        const since = spacing?.thursdaysSince ?? '?';
        const partnerDayPart = partnerDay ? `${partnerDay} ` : '';
        return (
            `Κανόνας Ν Πεμπτών (Ν=${nReq}): Ο/Η ${displacedPerson} θα έβγαινε την Πέμπτη ${thuDate} ` +
            `(σειρά καθημερινών), αλλά από την τελευταία του/της Πέμπτη (${lastThu}) ` +
            `είχαν περάσει μόνο ${since} καθημερινές Πέμπτες (απαιτούνται ${nReq}). ` +
            `Αντικαταστάστηκε από τον/την ${replacementPerson} (Πέμπτη ${thuDate})· ` +
            `ο/η ${displacedPerson} τοποθετήθηκε ${partnerDayPart}${partnerDate}.`
        );
    }

    function setSpacingMarker(markers, dateKey, groupNum, personName, data) {
        const name = normPerson(personName);
        if (!name) return;
        if (!markers[dateKey]) markers[dateKey] = {};
        if (!markers[dateKey][groupNum]) markers[dateKey][groupNum] = {};
        markers[dateKey][groupNum][name] = { ...data };
    }

    function buildSimulatedForSpacing(assignments, dayTypeLists) {
        const lists = dayTypeLists || {};
        const simulatedSpecial = {};
        const simulatedWeekend = {};
        const simulatedSemi = {};

        for (const dateKey of lists.special || []) {
            const gmap =
                typeof extractGroupAssignmentsMap === 'function'
                    ? extractGroupAssignmentsMap(
                          calculationSteps?.finalSpecialAssignments?.[dateKey] ||
                              calculationSteps?.tempSpecialAssignments?.[dateKey] ||
                              (typeof specialHolidayAssignments !== 'undefined'
                                  ? specialHolidayAssignments[dateKey]
                                  : null)
                      )
                    : null;
            if (gmap) {
                const d = new Date(dateKey + 'T00:00:00');
                const mk = typeof getMonthKeyFromDate === 'function' ? getMonthKeyFromDate(d) : null;
                if (mk) {
                    if (!simulatedSpecial[mk]) simulatedSpecial[mk] = {};
                    for (let g = 1; g <= 4; g++) {
                        if (!gmap[g]) continue;
                        if (!simulatedSpecial[mk][g]) simulatedSpecial[mk][g] = new Set();
                        simulatedSpecial[mk][g].add(gmap[g]);
                    }
                }
            }
        }

        for (const dateKey of lists.weekend || []) {
            const gmap =
                typeof extractGroupAssignmentsMap === 'function'
                    ? extractGroupAssignmentsMap(
                          calculationSteps?.finalWeekendAssignments?.[dateKey] ||
                              (typeof weekendAssignments !== 'undefined' ? weekendAssignments[dateKey] : null)
                      )
                    : null;
            if (gmap) simulatedWeekend[dateKey] = { ...gmap };
        }

        for (const dateKey of lists.semi || []) {
            const gmap =
                typeof extractGroupAssignmentsMap === 'function'
                    ? extractGroupAssignmentsMap(
                          calculationSteps?.finalSemiAssignments?.[dateKey] ||
                              (typeof semiNormalAssignments !== 'undefined' ? semiNormalAssignments[dateKey] : null)
                      )
                    : null;
            if (gmap) simulatedSemi[dateKey] = { ...gmap };
        }

        return {
            special: simulatedSpecial,
            weekend: simulatedWeekend,
            semi: simulatedSemi,
            normal: assignments,
            night: {}
        };
    }

    function swapPassesConsecutiveChecks(thursdayKey, partnerKey, groupNum, personA, personB, simulated) {
        if (typeof hasConsecutiveDuty !== 'function') return true;
        const thuDate = new Date(thursdayKey + 'T00:00:00');
        const partnerDate = new Date(partnerKey + 'T00:00:00');
        if (
            hasConsecutiveDuty(thursdayKey, personB, groupNum, simulated) ||
            hasConsecutiveDuty(partnerKey, personA, groupNum, simulated)
        ) {
            return false;
        }
        if (isNaN(thuDate.getTime()) || isNaN(partnerDate.getTime())) return false;
        return true;
    }

    function clearSpacingMarkersForDateKeys(dateKeys) {
        const store = typeof window !== 'undefined' ? window.thursdaySpacingMarkers : null;
        if (!store || typeof store !== 'object') return;
        for (const dk of dateKeys || []) {
            delete store[dk];
        }
    }

    /**
     * Πέρασμα Ν Πεμπτών — τρέχει ΜΕΤΑ την αρχική ανάθεση και τις υπάρχουσες ανταλλαγές.
     */
    function runThursdaySpacingChangesPass(finalNormalAssignments, dayTypeLists) {
        if (typeof isNightChangesMode !== 'function' || !isNightChangesMode()) {
            return {
                assignments: finalNormalAssignments,
                markers: {},
                spacingSwaps: []
            };
        }

        const assignments = JSON.parse(JSON.stringify(finalNormalAssignments || {}));
        const markers = {};
        const spacingSwaps = [];
        const normalDays = [...(dayTypeLists?.normal || [])].sort();
        const thursdayKeys = normalDays.filter(
            (dk) => typeof isNightThursdayDateKey === 'function' && isNightThursdayDateKey(dk)
        );
        const runtimeLastThu = {};
        const simulated = buildSimulatedForSpacing(assignments, dayTypeLists);

        clearSpacingMarkersForDateKeys(normalDays);

        for (const thursdayKey of thursdayKeys) {
            if (typeof setDutyCalcContextDateKey === 'function') setDutyCalcContextDateKey(thursdayKey);
            const thuDate = new Date(thursdayKey + 'T00:00:00');
            if (isNaN(thuDate.getTime())) continue;
            const monthKey = typeof getMonthKeyFromDate === 'function' ? getMonthKeyFromDate(thuDate) : null;

            for (const groupNum of NIGHT_GROUPS) {
                if (typeof shouldRecalculateDutyGroup === 'function' && !shouldRecalculateDutyGroup(groupNum)) {
                    const preserved = getAssigneeOnDate(thursdayKey, groupNum, assignments);
                    if (preserved) {
                        const check = personPassesThursdaySpacing(
                            preserved,
                            groupNum,
                            thursdayKey,
                            assignments,
                            runtimeLastThu
                        );
                        if (check.eligible) {
                            setSpacingMarker(markers, thursdayKey, groupNum, preserved, {
                                status: 'ok',
                                nRequired: check.nRequired,
                                thursdaysSince: check.thursdaysSince
                            });
                        }
                        const pk = `${groupNum}:${normPerson(preserved)}`;
                        runtimeLastThu[pk] = thursdayKey;
                    }
                    continue;
                }

                let person = assignments[thursdayKey]?.[groupNum];
                if (!person) continue;

                let spacing = personPassesThursdaySpacing(person, groupNum, thursdayKey, assignments, runtimeLastThu);

                if (spacing.eligible) {
                    setSpacingMarker(markers, thursdayKey, groupNum, person, {
                        status: 'ok',
                        nRequired: spacing.nRequired,
                        thursdaysSince: spacing.thursdaysSince
                    });
                    runtimeLastThu[`${groupNum}:${normPerson(person)}`] = thursdayKey;
                    continue;
                }

                const partnerDays = getMonTueWedKeysInMonth(monthKey, normalDays);
                let swapped = false;

                for (const partnerKey of partnerDays) {
                    const partnerPerson = assignments[partnerKey]?.[groupNum];
                    if (!partnerPerson || normPerson(partnerPerson) === normPerson(person)) continue;

                    const partnerSpacing = personPassesThursdaySpacing(
                        partnerPerson,
                        groupNum,
                        thursdayKey,
                        assignments,
                        runtimeLastThu
                    );
                    if (!partnerSpacing.eligible) continue;

                    if (
                        typeof isPersonMissingOnDate === 'function' &&
                        isPersonMissingOnDate(partnerPerson, groupNum, thuDate, 'normal')
                    ) {
                        continue;
                    }

                    const partnerDate = new Date(partnerKey + 'T00:00:00');
                    if (
                        typeof isPersonMissingOnDate === 'function' &&
                        isPersonMissingOnDate(person, groupNum, partnerDate, 'normal')
                    ) {
                        continue;
                    }

                    if (
                        typeof isPersonDisabledForDuty === 'function' &&
                        (isPersonDisabledForDuty(person, groupNum, 'normal', partnerKey) ||
                            isPersonDisabledForDuty(partnerPerson, groupNum, 'normal', thursdayKey))
                    ) {
                        continue;
                    }

                    if (
                        !swapPassesConsecutiveChecks(
                            thursdayKey,
                            partnerKey,
                            groupNum,
                            person,
                            partnerPerson,
                            simulated
                        )
                    ) {
                        continue;
                    }

                    if (!assignments[thursdayKey]) assignments[thursdayKey] = {};
                    if (!assignments[partnerKey]) assignments[partnerKey] = {};
                    assignments[thursdayKey][groupNum] = partnerPerson;
                    assignments[partnerKey][groupNum] = person;

                    if (!simulated.normal[thursdayKey]) simulated.normal[thursdayKey] = {};
                    if (!simulated.normal[partnerKey]) simulated.normal[partnerKey] = {};
                    simulated.normal[thursdayKey][groupNum] = partnerPerson;
                    simulated.normal[partnerKey][groupNum] = person;

                    const reason = buildThursdaySpacingSwapReason(
                        person,
                        partnerPerson,
                        thursdayKey,
                        partnerKey,
                        spacing
                    );
                    const spacingMeta = {
                        thursdaySpacing: true,
                        displacedPerson: person,
                        replacementPerson: partnerPerson,
                        thursdayDateKey: thursdayKey,
                        partnerDateKey: partnerKey,
                        nRequired: spacing.nRequired,
                        thursdaysSince: spacing.thursdaysSince,
                        lastThursday: spacing.lastThursday || null
                    };
                    if (typeof storeAssignmentReason === 'function') {
                        const pairId =
                            typeof getNextSwapPairIdForAssignmentReasons === 'function'
                                ? getNextSwapPairIdForAssignmentReasons()
                                : null;
                        storeAssignmentReason(
                            thursdayKey,
                            groupNum,
                            partnerPerson,
                            'swap',
                            reason,
                            person,
                            pairId,
                            spacingMeta
                        );
                        storeAssignmentReason(
                            partnerKey,
                            groupNum,
                            person,
                            'swap',
                            reason,
                            partnerPerson,
                            pairId,
                            spacingMeta
                        );
                    }

                    setSpacingMarker(markers, thursdayKey, groupNum, partnerPerson, {
                        status: 'swap',
                        partnerDateKey: partnerKey,
                        partnerPerson: person,
                        nRequired: spacing.nRequired,
                        thursdaysSince: spacing.thursdaysSince,
                        reason
                    });
                    setSpacingMarker(markers, partnerKey, groupNum, person, {
                        status: 'swap',
                        partnerDateKey: thursdayKey,
                        partnerPerson: partnerPerson,
                        nRequired: spacing.nRequired,
                        thursdaysSince: spacing.thursdaysSince,
                        reason
                    });

                    spacingSwaps.push({
                        thursdayKey,
                        partnerKey,
                        groupNum,
                        thursdayPerson: partnerPerson,
                        partnerPerson: person,
                        displacedFromThursday: person
                    });

                    runtimeLastThu[`${groupNum}:${normPerson(partnerPerson)}`] = thursdayKey;
                    swapped = true;
                    break;
                }

                if (!swapped) {
                    console.warn(
                        `[THURSDAY SPACING] Δεν βρέθηκε ανταλλαγή για ${person} την ${thursdayKey} (Ομάδα ${groupNum}, Ν=${spacing.nRequired}, πέρασαν ${spacing.thursdaysSince})`
                    );
                    runtimeLastThu[`${groupNum}:${normPerson(person)}`] = thursdayKey;
                }
            }
        }

        if (typeof applyThursdaySpacingMarkers === 'function') {
            applyThursdaySpacingMarkers(markers, normalDays);
        }

        return { assignments, markers, spacingSwaps };
    }

    window.runThursdaySpacingChangesPass = runThursdaySpacingChangesPass;
    window.buildThursdaySpacingSwapReason = buildThursdaySpacingSwapReason;
    window.countActiveNormalListSizeForThursday = countActiveNormalListSize;
    window.countNormalThursdaysSinceLast = countNormalThursdaysSinceLast;
})();
