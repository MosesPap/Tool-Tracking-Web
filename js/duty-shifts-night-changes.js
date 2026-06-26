// ============================================================================
// DUTY-SHIFTS-NIGHT-CHANGES.JS — Νυχτερινές με αλλαγές (ομάδες 3 & 4)
// Κανόνας Ν καθημερινών Πεμπτών + ανταλλαγές Δευτ/Τρί/Τετ εντός μήνα
// ============================================================================

(function () {
    const NIGHT_GROUPS = [3, 4];

    const THURSDAY_SPACING_SWAP_COLORS = [
        { border: '#FF1744', bg: 'rgba(255, 23, 68, 0.12)' },
        { border: '#00E676', bg: 'rgba(0, 230, 118, 0.12)' },
        { border: '#FFD600', bg: 'rgba(255, 214, 0, 0.12)' },
        { border: '#00B0FF', bg: 'rgba(0, 176, 255, 0.12)' },
        { border: '#D500F9', bg: 'rgba(213, 0, 249, 0.12)' },
        { border: '#FF6D00', bg: 'rgba(255, 109, 0, 0.12)' },
        { border: '#00E5FF', bg: 'rgba(0, 229, 255, 0.12)' },
        { border: '#FF4081', bg: 'rgba(255, 64, 129, 0.12)' }
    ];

    function thursdaySpacingSwapColorIndex(swapPairId) {
        const pid =
            typeof swapPairId === 'number' ? swapPairId : parseInt(swapPairId, 10);
        return isNaN(pid) ? 0 : Math.abs(pid) % THURSDAY_SPACING_SWAP_COLORS.length;
    }

    function hashThursdaySpacingPairKey(pairKey) {
        const s = String(pairKey || '');
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
        }
        return Math.abs(h) % THURSDAY_SPACING_SWAP_COLORS.length;
    }

    function buildThursdaySpacingPairFallbackKey(dateKey, groupNum, marker) {
        if (!dateKey || !groupNum) return null;
        const partnerKey = marker?.partnerDateKey;
        if (!partnerKey) return `${dateKey}|${groupNum}`;
        const keys = [dateKey, partnerKey].sort();
        return `${keys[0]}|${keys[1]}|${groupNum}`;
    }

    function getThursdaySpacingSwapColors(swapPairId, fallbackPairKey) {
        if (swapPairId != null && swapPairId !== '' && !isNaN(parseInt(swapPairId, 10))) {
            return THURSDAY_SPACING_SWAP_COLORS[thursdaySpacingSwapColorIndex(swapPairId)];
        }
        if (fallbackPairKey) {
            return THURSDAY_SPACING_SWAP_COLORS[hashThursdaySpacingPairKey(fallbackPairKey)];
        }
        return THURSDAY_SPACING_SWAP_COLORS[0];
    }

    function buildThursdaySpacingSwapFrameStyle(swapPairId, fallbackPairKey) {
        const c = getThursdaySpacingSwapColors(swapPairId, fallbackPairKey);
        return `border: 2px solid ${c.border}; background-color: ${c.bg}; color: ${c.border};`;
    }

    function resolveThursdaySpacingSwapPairId(dateKey, groupNum, personName) {
        if (!dateKey || !personName || !groupNum) return null;
        const reason =
            typeof getAssignmentReason === 'function' ? getAssignmentReason(dateKey, groupNum, personName) : null;
        if (reason?.meta?.thursdaySpacing && reason.swapPairId != null && reason.swapPairId !== undefined) {
            return reason.swapPairId;
        }
        const marker =
            typeof getThursdaySpacingMarker === 'function'
                ? getThursdaySpacingMarker(dateKey, groupNum, personName)
                : null;
        if (marker?.status === 'swap' && marker.swapPairId != null && marker.swapPairId !== undefined) {
            return marker.swapPairId;
        }
        if (marker?.status === 'swap' && marker.partnerDateKey) {
            const partnerReason =
                typeof getAssignmentReason === 'function'
                    ? getAssignmentReason(marker.partnerDateKey, groupNum, personName)
                    : null;
            if (
                partnerReason?.meta?.thursdaySpacing &&
                partnerReason.swapPairId != null &&
                partnerReason.swapPairId !== undefined
            ) {
                return partnerReason.swapPairId;
            }
            const partnerMarker =
                typeof getThursdaySpacingMarker === 'function'
                    ? getThursdaySpacingMarker(marker.partnerDateKey, groupNum, personName)
                    : null;
            if (partnerMarker?.swapPairId != null && partnerMarker.swapPairId !== undefined) {
                return partnerMarker.swapPairId;
            }
        }
        return null;
    }

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

    /** Δευτέρα (εβδομάδας ISO) που περιέχει την ημερομηνία. */
    function getMondayOfWeekContaining(dateKey) {
        const d = new Date(dateKey + 'T00:00:00');
        if (isNaN(d.getTime())) return null;
        const dow = d.getDay();
        const monday = new Date(d);
        monday.setDate(monday.getDate() - (dow === 0 ? 6 : dow - 1));
        return monday;
    }

    function buildSpacingPartnerDateKey(thursdayKey, weekOffset, dayOfWeek) {
        const monday = getMondayOfWeekContaining(thursdayKey);
        if (!monday || !Number.isFinite(weekOffset) || !dayOfWeek) return null;
        const target = new Date(monday);
        target.setDate(target.getDate() + weekOffset * 7 + (dayOfWeek - 1));
        return typeof formatDateKey === 'function' ? formatDateKey(target) : null;
    }

    /**
     * Σειρά προτεραιότητας εταίρων ανταλλαγής για κανόνα Ν (μόνο Δευ/Τρι/Τετ, εντός μήνα Πέμπτης).
     * 1–3: Τετ/Τρι/Δευ ίδιας εβδομάδας · 4: Δευ επόμενης · 5–6: Τρι/Τετ επόμενης
     * 7–9: Τετ/Τρι/Δευ προηγούμενης
     */
    function getThursdaySpacingPartnerCandidates(thursdayKey, normalDays) {
        const thuDate = new Date(thursdayKey + 'T00:00:00');
        if (isNaN(thuDate.getTime())) return [];
        const monthKey = typeof getMonthKeyFromDate === 'function' ? getMonthKeyFromDate(thuDate) : null;
        const normalSet = new Set(normalDays || []);
        const steps = [
            [0, 3],
            [0, 2],
            [0, 1],
            [1, 1],
            [1, 2],
            [1, 3],
            [-1, 3],
            [-1, 2],
            [-1, 1]
        ];
        const out = [];
        const seen = new Set();
        for (const [weekOffset, dow] of steps) {
            const dk = buildSpacingPartnerDateKey(thursdayKey, weekOffset, dow);
            if (!dk || seen.has(dk) || dk === thursdayKey) continue;
            seen.add(dk);
            if (!normalSet.has(dk)) continue;
            const d = new Date(dk + 'T00:00:00');
            if (isNaN(d.getTime()) || d.getDay() !== dow) continue;
            if (monthKey && typeof getMonthKeyFromDate === 'function' && getMonthKeyFromDate(d) !== monthKey) {
                continue;
            }
            if (typeof getDayType === 'function' && getDayType(d) !== 'normal-day') continue;
            out.push(dk);
        }
        return out;
    }

    /** Runtime τελευταίων Πεμπτών πριν την τρέχουσα (για έλεγχο Ν πριν το πέρασμα ανταλλαγών). */
    function buildRuntimeLastThuBefore(thursdayKey, assignments, normalDays) {
        const runtimeLastThu = {};
        const thursdays = (normalDays || [])
            .filter((dk) => typeof isNightThursdayDateKey === 'function' && isNightThursdayDateKey(dk))
            .sort();
        for (const dk of thursdays) {
            if (dk >= thursdayKey) break;
            for (const groupNum of NIGHT_GROUPS) {
                const p = assignments?.[dk]?.[groupNum] ?? assignments?.[dk]?.[String(groupNum)];
                if (p) runtimeLastThu[`${groupNum}:${normPerson(p)}`] = dk;
            }
        }
        return runtimeLastThu;
    }

    /**
     * Παράλειψη ανταλλαγής σύγκρουσης σε Πέμπτη — ο κανόνας Ν θα αφαιρέσει τον/την από την Πέμπτη.
     */
    function shouldSkipNormalConflictSwapForThursdaySpacing(dateKey, groupNum, person, assignments, normalDays) {
        if (typeof isNightChangesMode !== 'function' || !isNightChangesMode()) return false;
        if (typeof isNightChangesGroup === 'function' && !isNightChangesGroup(groupNum)) return false;
        if (typeof isNightThursdayDateKey === 'function' && !isNightThursdayDateKey(dateKey)) return false;
        if (!person) return false;
        const runtimeLastThu = buildRuntimeLastThuBefore(dateKey, assignments, normalDays);
        const spacing = personPassesThursdaySpacing(person, groupNum, dateKey, assignments, runtimeLastThu);
        return !spacing.eligible;
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

    function captureSkipReasonForSpacingPreserve(dateKey, groupNum, personName) {
        if (typeof getAssignmentReason !== 'function') return null;
        const existing = getAssignmentReason(dateKey, groupNum, personName);
        if (!existing || existing.type !== 'skip' || existing.meta?.thursdaySpacing) return null;
        return {
            type: existing.type,
            reason: existing.reason,
            swappedWith: existing.swappedWith,
            meta: existing.meta ? { ...existing.meta } : null
        };
    }

    function spacingMetaWithPreservedSkip(spacingMeta, fromDateKey, groupNum, fromPerson) {
        const preserved = captureSkipReasonForSpacingPreserve(fromDateKey, groupNum, fromPerson);
        if (!preserved) return spacingMeta;
        return { ...spacingMeta, preservedSkipReason: preserved };
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

                let person = getAssigneeOnDate(thursdayKey, groupNum, assignments);
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

                const partnerDays = getThursdaySpacingPartnerCandidates(thursdayKey, normalDays);
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
                    const spacingMetaBase = {
                        thursdaySpacing: true,
                        displacedPerson: person,
                        replacementPerson: partnerPerson,
                        thursdayDateKey: thursdayKey,
                        partnerDateKey: partnerKey,
                        nRequired: spacing.nRequired,
                        thursdaysSince: spacing.thursdaysSince,
                        lastThursday: spacing.lastThursday || null
                    };
                    const spacingMetaForThursday = spacingMetaWithPreservedSkip(
                        spacingMetaBase,
                        partnerKey,
                        groupNum,
                        partnerPerson
                    );
                    const spacingMetaForPartner = spacingMetaWithPreservedSkip(
                        spacingMetaBase,
                        thursdayKey,
                        groupNum,
                        person
                    );
                    const pairId =
                        typeof getNextSwapPairIdForAssignmentReasons === 'function'
                            ? getNextSwapPairIdForAssignmentReasons()
                            : null;
                    if (typeof storeAssignmentReason === 'function') {
                        storeAssignmentReason(
                            thursdayKey,
                            groupNum,
                            partnerPerson,
                            'swap',
                            reason,
                            person,
                            pairId,
                            spacingMetaForThursday
                        );
                        storeAssignmentReason(
                            partnerKey,
                            groupNum,
                            person,
                            'swap',
                            reason,
                            partnerPerson,
                            pairId,
                            spacingMetaForPartner
                        );
                    }

                    setSpacingMarker(markers, thursdayKey, groupNum, partnerPerson, {
                        status: 'swap',
                        partnerDateKey: partnerKey,
                        partnerPerson: person,
                        swapPairId: pairId,
                        nRequired: spacing.nRequired,
                        thursdaysSince: spacing.thursdaysSince,
                        reason
                    });
                    setSpacingMarker(markers, partnerKey, groupNum, person, {
                        status: 'swap',
                        partnerDateKey: thursdayKey,
                        partnerPerson: partnerPerson,
                        swapPairId: pairId,
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

    function formatThursdayHistoryDateLabel(dateKey) {
        if (!dateKey) return '—';
        const d = new Date(dateKey + 'T00:00:00');
        if (isNaN(d.getTime())) return String(dateKey);
        const dayName = typeof getGreekDayName === 'function' ? getGreekDayName(d) : '';
        const dateStr = d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return dayName ? `${dayName} ${dateStr}` : dateStr;
    }

    function extractNormalGroupAssignee(dateKey, groupNum) {
        if (typeof extractGroupAssignmentsMap !== 'function') return null;
        const gmap = extractGroupAssignmentsMap(
            typeof normalDayAssignments !== 'undefined' ? normalDayAssignments[dateKey] : null
        );
        return gmap?.[groupNum] || gmap?.[String(groupNum)] || null;
    }

    function resolveThursdaySpacingEventDetails(dateKey, groupNum, assignee) {
        if (!dateKey || !assignee || !groupNum) return { status: 'unknown' };
        const reason =
            typeof getAssignmentReason === 'function' ? getAssignmentReason(dateKey, groupNum, assignee) : null;
        const marker =
            typeof getThursdaySpacingMarker === 'function'
                ? getThursdaySpacingMarker(dateKey, groupNum, assignee)
                : null;

        if (reason?.type === 'swap' && reason.meta?.thursdaySpacing) {
            const partnerDateKey = reason.meta.partnerDateKey || null;
            const displaced =
                reason.meta.displacedPerson ||
                (reason.meta.replacementPerson && normPerson(reason.meta.replacementPerson) === normPerson(assignee)
                    ? reason.swappedWith
                    : reason.swappedWith) ||
                null;
            return {
                status: 'swap',
                displacedPerson: displaced,
                partnerPerson: reason.swappedWith || displaced,
                partnerDateKey,
                reasonText: reason.reason || marker?.reason || ''
            };
        }

        if (marker?.status === 'swap') {
            return {
                status: 'swap',
                displacedPerson: marker.partnerPerson || null,
                partnerPerson: marker.partnerPerson || null,
                partnerDateKey: marker.partnerDateKey || null,
                reasonText: marker.reason || ''
            };
        }

        if (marker?.status === 'ok') {
            return {
                status: 'ok',
                nRequired: marker.nRequired,
                thursdaysSince: marker.thursdaysSince,
                reasonText: ''
            };
        }

        if (reason?.meta?.thursdaySpacing) {
            return {
                status: 'swap',
                displacedPerson: reason.meta.displacedPerson || reason.swappedWith || null,
                partnerPerson: reason.swappedWith || null,
                partnerDateKey: reason.meta.partnerDateKey || null,
                reasonText: reason.reason || ''
            };
        }

        return { status: marker?.status === 'ok' ? 'ok' : 'plain' };
    }

    function collectThursdaySpacingSwapPairsFromStores() {
        const pairs = new Map();
        const addPair = (thursdayKey, groupNum, finalPerson, displacedPerson, partnerDateKey, reasonText) => {
            if (!thursdayKey || !groupNum || !finalPerson) return;
            const key = `${thursdayKey}|${groupNum}`;
            if (pairs.has(key)) return;
            pairs.set(key, {
                thursdayKey,
                groupNum,
                finalThursdayPerson: finalPerson,
                displacedFromThursday: displacedPerson || null,
                partnerDateKey: partnerDateKey || null,
                reasonText: reasonText || ''
            });
        };

        const markersStore =
            typeof thursdaySpacingMarkers !== 'undefined'
                ? thursdaySpacingMarkers
                : typeof window !== 'undefined'
                  ? window.thursdaySpacingMarkers
                  : null;
        if (markersStore && typeof markersStore === 'object') {
            for (const dateKey of Object.keys(markersStore)) {
                if (typeof isNightThursdayDateKey === 'function' && !isNightThursdayDateKey(dateKey)) continue;
                for (const groupStr of [3, 4, '3', '4']) {
                    const groupNum = parseInt(groupStr, 10);
                    const gmap = markersStore[dateKey]?.[groupNum] || markersStore[dateKey]?.[groupStr];
                    if (!gmap) continue;
                    for (const personName of Object.keys(gmap)) {
                        const m = gmap[personName];
                        if (!m || m.status !== 'swap') continue;
                        const assignee = extractNormalGroupAssignee(dateKey, groupNum) || personName;
                        addPair(
                            dateKey,
                            groupNum,
                            assignee,
                            m.partnerPerson || null,
                            m.partnerDateKey || null,
                            m.reason || ''
                        );
                    }
                }
            }
        }

        const reasonsStore = typeof assignmentReasons !== 'undefined' ? assignmentReasons : null;
        if (reasonsStore && typeof reasonsStore === 'object') {
            for (const dateKey of Object.keys(reasonsStore)) {
                if (typeof isNightThursdayDateKey === 'function' && !isNightThursdayDateKey(dateKey)) continue;
                for (const groupStr of Object.keys(reasonsStore[dateKey] || {})) {
                    const groupNum = parseInt(groupStr, 10);
                    if (groupNum !== 3 && groupNum !== 4) continue;
                    const gmap = reasonsStore[dateKey][groupStr];
                    for (const personName of Object.keys(gmap || {})) {
                        const r = gmap[personName];
                        if (!r?.meta?.thursdaySpacing) continue;
                        const assignee = extractNormalGroupAssignee(dateKey, groupNum) || personName;
                        addPair(
                            dateKey,
                            groupNum,
                            assignee,
                            r.meta.displacedPerson || r.swappedWith || null,
                            r.meta.partnerDateKey || null,
                            r.reason || ''
                        );
                    }
                }
            }
        }

        return [...pairs.values()].sort((a, b) => a.thursdayKey.localeCompare(b.thursdayKey));
    }

    /**
     * Ιστορικό καθημερινών Πεμπτών ομάδων 3 & 4 (μετά τις αλλαγές Ν Πεμπτών).
     * @returns {{ thursdayEvents: Array, personSummaries: Array, swapPairs: Array }}
     */
    function buildThursdaySpacingHistoryReport() {
        const thursdayEvents = [];
        const dateKeys = Object.keys(
            typeof normalDayAssignments !== 'undefined' ? normalDayAssignments : {}
        ).sort();

        for (const dateKey of dateKeys) {
            if (typeof isNightThursdayDateKey === 'function' && !isNightThursdayDateKey(dateKey)) continue;
            for (const groupNum of NIGHT_GROUPS) {
                const assignee = extractNormalGroupAssignee(dateKey, groupNum);
                if (!assignee) continue;
                const details = resolveThursdaySpacingEventDetails(dateKey, groupNum, assignee);
                thursdayEvents.push({
                    dateKey,
                    dateLabel: formatThursdayHistoryDateLabel(dateKey),
                    groupNum,
                    assignee,
                    status: details.status,
                    displacedPerson: details.displacedPerson || null,
                    partnerPerson: details.partnerPerson || null,
                    partnerDateKey: details.partnerDateKey || null,
                    partnerDateLabel: details.partnerDateKey
                        ? formatThursdayHistoryDateLabel(details.partnerDateKey)
                        : null,
                    nRequired: details.nRequired,
                    thursdaysSince: details.thursdaysSince,
                    reasonText: details.reasonText || ''
                });
            }
        }

        const swapPairs = collectThursdaySpacingSwapPairsFromStores();

        for (const sp of swapPairs) {
            const exists = thursdayEvents.some(
                (e) => e.dateKey === sp.thursdayKey && e.groupNum === sp.groupNum
            );
            if (exists) continue;
            const assignee = extractNormalGroupAssignee(sp.thursdayKey, sp.groupNum) || sp.finalThursdayPerson;
            thursdayEvents.push({
                dateKey: sp.thursdayKey,
                dateLabel: formatThursdayHistoryDateLabel(sp.thursdayKey),
                groupNum: sp.groupNum,
                assignee,
                status: 'swap',
                displacedPerson: sp.displacedFromThursday,
                partnerPerson: sp.displacedFromThursday,
                partnerDateKey: sp.partnerDateKey,
                partnerDateLabel: sp.partnerDateKey
                    ? formatThursdayHistoryDateLabel(sp.partnerDateKey)
                    : null,
                nRequired: null,
                thursdaysSince: null,
                reasonText: sp.reasonText || ''
            });
        }

        thursdayEvents.sort((a, b) => a.dateKey.localeCompare(b.dateKey));

        const lastByPerson = new Map();
        for (const ev of thursdayEvents) {
            const pk = `${ev.groupNum}:${normPerson(ev.assignee)}`;
            lastByPerson.set(pk, ev);
        }

        const personSummaries = [];
        for (const groupNum of NIGHT_GROUPS) {
            const list =
                typeof getSortedGroupListForRotation === 'function'
                    ? getSortedGroupListForRotation(groupNum, 'normal')
                    : (typeof groupsForDuty === 'function' ? groupsForDuty(groupNum) : groups?.[groupNum])
                          ?.normal || [];
            const seen = new Set();
            for (const person of list) {
                if (!person) continue;
                const pk = `${groupNum}:${normPerson(person)}`;
                if (seen.has(pk)) continue;
                seen.add(pk);
                const last = lastByPerson.get(pk) || null;
                personSummaries.push({
                    groupNum,
                    person,
                    lastThursdayKey: last?.dateKey || null,
                    lastThursdayLabel: last?.dateLabel || '—',
                    status: last?.status || 'none',
                    displacedPerson: last?.displacedPerson || null,
                    partnerDateKey: last?.partnerDateKey || null,
                    partnerDateLabel: last?.partnerDateLabel || null,
                    reasonText: last?.reasonText || '',
                    nRequired: last?.nRequired,
                    thursdaysSince: last?.thursdaysSince
                });
            }
        }

        personSummaries.sort((a, b) => {
            if (a.groupNum !== b.groupNum) return a.groupNum - b.groupNum;
            const listA =
                typeof getSortedGroupListForRotation === 'function'
                    ? getSortedGroupListForRotation(a.groupNum, 'normal')
                    : [];
            const ia = listA.indexOf(a.person);
            const ib = listA.indexOf(b.person);
            if (ia >= 0 && ib >= 0 && ia !== ib) return ia - ib;
            return String(a.person || '').localeCompare(String(b.person || ''), 'el');
        });

        const displacementByPerson = new Map();
        for (const sp of swapPairs) {
            if (!sp.displacedFromThursday) continue;
            const pk = `${sp.groupNum}:${normPerson(sp.displacedFromThursday)}`;
            const prev = displacementByPerson.get(pk);
            if (!prev || sp.thursdayKey > prev.thursdayKey) {
                displacementByPerson.set(pk, {
                    thursdayKey: sp.thursdayKey,
                    thursdayLabel: formatThursdayHistoryDateLabel(sp.thursdayKey),
                    replacedBy: sp.finalThursdayPerson || null,
                    partnerDateKey: sp.partnerDateKey || null,
                    partnerDateLabel: sp.partnerDateKey
                        ? formatThursdayHistoryDateLabel(sp.partnerDateKey)
                        : null,
                    reasonText: sp.reasonText || ''
                });
            }
        }
        for (const row of personSummaries) {
            row.lastDisplacement = displacementByPerson.get(`${row.groupNum}:${normPerson(row.person)}`) || null;
        }

        const thursdayCountByPerson = new Map();
        for (const ev of thursdayEvents) {
            const pk = `${ev.groupNum}:${normPerson(ev.assignee)}`;
            const existing = thursdayCountByPerson.get(pk);
            if (existing) {
                existing.count += 1;
            } else {
                thursdayCountByPerson.set(pk, {
                    groupNum: ev.groupNum,
                    person: ev.assignee,
                    count: 1
                });
            }
        }

        const personThursdayCounts = [];
        const countSeen = new Set();
        for (const groupNum of NIGHT_GROUPS) {
            const list =
                typeof getSortedGroupListForRotation === 'function'
                    ? getSortedGroupListForRotation(groupNum, 'normal')
                    : (typeof groupsForDuty === 'function' ? groupsForDuty(groupNum) : groups?.[groupNum])
                          ?.normal || [];
            for (const person of list) {
                if (!person) continue;
                const pk = `${groupNum}:${normPerson(person)}`;
                if (countSeen.has(pk)) continue;
                countSeen.add(pk);
                const fromEvents = thursdayCountByPerson.get(pk);
                personThursdayCounts.push({
                    groupNum,
                    person,
                    count: fromEvents?.count || 0
                });
            }
        }
        for (const [pk, entry] of thursdayCountByPerson) {
            if (countSeen.has(pk)) continue;
            countSeen.add(pk);
            personThursdayCounts.push(entry);
        }
        personThursdayCounts.sort((a, b) => {
            if (a.groupNum !== b.groupNum) return a.groupNum - b.groupNum;
            if (b.count !== a.count) return b.count - a.count;
            return String(a.person || '').localeCompare(String(b.person || ''), 'el');
        });

        return { thursdayEvents, personSummaries, swapPairs, personThursdayCounts };
    }

    function openThursdaySpacingHistoryModal() {
        if (typeof isNightChangesMode === 'function' && !isNightChangesMode()) {
            if (
                !confirm(
                    'Η λειτουργία «Νυχτερινές με αλλαγές» δεν είναι ενεργή. Να εμφανιστεί το ιστορικό από τα αποθηκευμένα δεδομένα οπωσδήποτε;'
                )
            ) {
                return;
            }
        }
        const report = buildThursdaySpacingHistoryReport();
        const tbodyPerson = document.getElementById('thursdaySpacingHistoryPersonBody');
        const tbodyChrono = document.getElementById('thursdaySpacingHistoryChronoBody');
        const tbodyCounts = document.getElementById('thursdaySpacingHistoryCountsBody');
        const emptyMsg = document.getElementById('thursdaySpacingHistoryEmpty');
        if (!tbodyPerson || !tbodyChrono || !tbodyCounts) return;

        const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s || '');
        const groupLabel = (g) =>
            typeof getGroupName === 'function' ? getGroupName(g) : `Ομάδα ${g}`;

        const statusBadge = (status, ev) => {
            if (status === 'ok') {
                const extra =
                    ev?.nRequired != null
                        ? ` (Ν=${ev.nRequired}${ev.thursdaysSince != null ? ', πέρασαν ' + ev.thursdaysSince : ''})`
                        : '';
                return `<span class="badge bg-success">OK${esc(extra)}</span>`;
            }
            if (status === 'swap') {
                return '<span class="badge bg-warning text-dark">Ανταλλαγή Ν</span>';
            }
            if (status === 'none') {
                return '<span class="badge bg-secondary">—</span>';
            }
            return '<span class="badge bg-light text-dark">Χωρίς σήμανση</span>';
        };

        tbodyPerson.innerHTML = '';
        for (const row of report.personSummaries) {
            const tr = document.createElement('tr');
            const swapCols =
                row.status === 'swap'
                    ? `<td>${esc(row.displacedPerson ? row.displacedPerson : '—')}</td>
                       <td>${esc(row.partnerDateLabel || '—')}</td>`
                    : `<td>—</td><td>—</td>`;
            const displacedCols = row.lastDisplacement
                ? `<td>${esc(row.lastDisplacement.thursdayLabel)}</td>
                   <td>${esc(row.lastDisplacement.replacedBy || '—')}</td>
                   <td>${esc(row.lastDisplacement.partnerDateLabel || '—')}</td>`
                : `<td>—</td><td>—</td><td>—</td>`;
            tr.innerHTML = `
                <td><span class="badge bg-primary">${esc(groupLabel(row.groupNum))}</span></td>
                <td><strong>${esc(row.person)}</strong></td>
                <td>${esc(row.lastThursdayLabel)}</td>
                <td>${statusBadge(row.status, row)}</td>
                ${swapCols}
                ${displacedCols}
            `;
            tbodyPerson.appendChild(tr);
        }

        tbodyChrono.innerHTML = '';
        for (const ev of report.thursdayEvents) {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${esc(ev.dateLabel)}</td>
                <td><span class="badge bg-primary">${esc(groupLabel(ev.groupNum))}</span></td>
                <td><strong>${esc(ev.assignee)}</strong></td>
                <td>${statusBadge(ev.status, ev)}</td>
                <td>${esc(ev.displacedPerson || '—')}</td>
                <td>${esc(ev.partnerDateLabel || '—')}</td>
            `;
            tbodyChrono.appendChild(tr);
        }

        tbodyCounts.innerHTML = '';
        for (const row of report.personThursdayCounts || []) {
            const tr = document.createElement('tr');
            const countClass = row.count > 0 ? 'fw-bold text-primary' : 'text-muted';
            tr.innerHTML = `
                <td><span class="badge bg-primary">${esc(groupLabel(row.groupNum))}</span></td>
                <td><strong>${esc(row.person)}</strong></td>
                <td class="text-center ${countClass}">${row.count}</td>
            `;
            tbodyCounts.appendChild(tr);
        }

        if (emptyMsg) {
            emptyMsg.style.display =
                report.thursdayEvents.length === 0 && report.personSummaries.every((p) => p.status === 'none')
                    ? 'block'
                    : 'none';
        }

        const modalEl = document.getElementById('thursdaySpacingHistoryModal');
        if (modalEl && typeof bootstrap !== 'undefined') {
            bootstrap.Modal.getOrCreateInstance(modalEl).show();
        }
    }

    window.runThursdaySpacingChangesPass = runThursdaySpacingChangesPass;
    window.buildThursdaySpacingSwapReason = buildThursdaySpacingSwapReason;
    window.countActiveNormalListSizeForThursday = countActiveNormalListSize;
    window.countNormalThursdaysSinceLast = countNormalThursdaysSinceLast;
    window.personPassesThursdaySpacing = personPassesThursdaySpacing;
    window.getThursdaySpacingPartnerCandidates = getThursdaySpacingPartnerCandidates;
    window.shouldSkipNormalConflictSwapForThursdaySpacing = shouldSkipNormalConflictSwapForThursdaySpacing;
    window.buildThursdaySpacingHistoryReport = buildThursdaySpacingHistoryReport;
    window.openThursdaySpacingHistoryModal = openThursdaySpacingHistoryModal;
    window.buildThursdaySpacingSwapFrameStyle = buildThursdaySpacingSwapFrameStyle;
    window.getThursdaySpacingSwapColors = getThursdaySpacingSwapColors;
    window.buildThursdaySpacingPairFallbackKey = buildThursdaySpacingPairFallbackKey;
    window.resolveThursdaySpacingSwapPairId = resolveThursdaySpacingSwapPairId;
})();
