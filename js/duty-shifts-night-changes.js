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
                typeof isPersonExcludedFromDuties === 'function' &&
                isPersonExcludedFromDuties(p, groupNum)
            ) {
                continue;
            }
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

        if (typeof extractGroupAssignmentsMap === 'function') {
            const normalMap = extractGroupAssignmentsMap(
                typeof normalDayAssignments !== 'undefined' ? normalDayAssignments[dateKey] : null
            );
            if (normalMap && normalMap[groupNum]) return normalMap[groupNum];
        }
        return null;
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

    /** Όταν δεν περνάει το Ν και δεν βρέθηκε καλύτερος εταίρος — εμφανής αποτυχία. */
    function buildThursdaySpacingFailReason(person, thursdayKey, spacing, proximityNote) {
        const thuDate = formatDateKeyElGR(thursdayKey);
        const lastThu = spacing?.lastThursday ? formatDateKeyElGR(spacing.lastThursday) : '—';
        const nReq = spacing?.nRequired ?? '?';
        const since = spacing?.thursdaysSince ?? '?';
        let text =
            `Κανόνας Ν Πεμπτών (Ν=${nReq}): Ο/Η ${person} παρέμεινε την Πέμπτη ${thuDate}, ` +
            `αλλά από την τελευταία του/της Πέμπτη (${lastThu}) είχαν περάσει μόνο ${since} ` +
            `καθημερινές Πέμπτες (απαιτούνται ${nReq}) και δεν βρέθηκε διαθέσιμος εταίρος ` +
            `που να περνάει πλήρως το Ν.`;
        if (proximityNote) {
            text += ` ${proximityNote}`;
        } else {
            text +=
                ' Κανένας υποψήφιος Δευ/Τρι/Τετ δεν ήταν πιο κοντά στο Ν από τον/την ίδιο/α.';
        }
        return text;
    }

    /**
     * Πόσο «κοντά» είναι κάποιος στο Ν (μεγαλύτερο = καλύτερο).
     * Χωρίς προηγούμενη Πέμπτη ή ήδη eligible → μέγιστο.
     */
    function thursdayNProximityScore(spacing) {
        if (!spacing) return -1;
        if (!spacing.lastThursday) return Number.POSITIVE_INFINITY;
        const since = Number(spacing.thursdaysSince);
        if (spacing.eligible) {
            return 1e9 + (Number.isFinite(since) ? since : 0);
        }
        return Number.isFinite(since) ? since : -1;
    }

    function formatNProximityLabel(spacing) {
        if (!spacing) return '—';
        if (!spacing.lastThursday) return 'χωρίς προηγούμενη Πέμπτη (μέγιστη ετοιμότητα)';
        if (spacing.eligible) {
            return `περνάει Ν (πέρασαν ${spacing.thursdaysSince}, Ν=${spacing.nRequired})`;
        }
        return `πέρασαν ${spacing.thursdaysSince} / Ν=${spacing.nRequired}`;
    }

    function buildThursdaySpacingProximitySwapReason(
        displacedPerson,
        replacementPerson,
        thursdayKey,
        partnerKey,
        displacedSpacing,
        replacementSpacing
    ) {
        const thuDate = formatDateKeyElGR(thursdayKey);
        const partnerDate = formatDateKeyElGR(partnerKey);
        const partnerDay = dayNameForDateKey(partnerKey);
        const partnerDayPart = partnerDay ? `${partnerDay} ` : '';
        const nReq = displacedSpacing?.nRequired ?? replacementSpacing?.nRequired ?? '?';
        return (
            `Κανόνας Ν Πεμπτών (Ν=${nReq}): Δεν βρέθηκε εταίρος που να περνάει πλήρως το Ν. ` +
            `Ο/Η ${displacedPerson} στην Πέμπτη ${thuDate} (${formatNProximityLabel(displacedSpacing)}) ` +
            `αντικαταστάθηκε από τον/την ${replacementPerson} που είναι πιο κοντά στο Ν ` +
            `(${formatNProximityLabel(replacementSpacing)})· ` +
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
            normal: assignments
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

    function formatPartnerCandidateDateLabel(dateKey) {
        if (!dateKey) return '—';
        const d = new Date(dateKey + 'T00:00:00');
        if (isNaN(d.getTime())) return String(dateKey);
        const dayName = typeof getGreekDayName === 'function' ? getGreekDayName(d) : '';
        const dateStr = d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        return dayName ? `${dayName} ${dateStr}` : dateStr;
    }

    /**
     * Ελέγχει όλους τους υποψήφιους εταίρους (Δευ/Τρι/Τετ).
     * selected = περνάει πλήρως Ν · selectedByProximity = πιο κοντά στο Ν από τον τρέχοντα.
     */
    function diagnoseThursdaySpacingPartnerCandidates(
        thursdayKey,
        groupNum,
        person,
        assignments,
        normalDays,
        runtimeLastThu,
        simulated,
        thursdayPersonSpacing
    ) {
        const partnerDays = getThursdaySpacingPartnerCandidates(thursdayKey, normalDays);
        const diagnostics = [];
        const softCandidates = [];
        const thuDate = new Date(thursdayKey + 'T00:00:00');
        const thursdayScore = thursdayNProximityScore(thursdayPersonSpacing);

        if (partnerDays.length === 0) {
            diagnostics.push({
                partnerKey: null,
                partnerDateLabel: '—',
                partnerPerson: null,
                rejected: true,
                reasonCode: 'no_candidates',
                reasonLabel:
                    'Δεν υπήρχαν υποψήφιες καθημερινές Δευτέρα/Τρίτη/Τετάρτη εντός του ίδιου μήνα με την Πέμπτη (ή δεν είναι στην περίοδο υπολογισμού).'
            });
            return {
                partnerDays,
                diagnostics,
                selected: null,
                selectedByProximity: null,
                thursdayScore
            };
        }

        for (let i = 0; i < partnerDays.length; i++) {
            const partnerKey = partnerDays[i];
            const partnerPerson =
                assignments[partnerKey]?.[groupNum] ?? assignments[partnerKey]?.[String(groupNum)];
            const entry = {
                order: i + 1,
                partnerKey,
                partnerDateLabel: formatPartnerCandidateDateLabel(partnerKey),
                partnerPerson: partnerPerson || null,
                rejected: true,
                reasonCode: '',
                reasonLabel: '',
                proximityScore: -1
            };

            if (!partnerPerson) {
                entry.reasonCode = 'no_assignee';
                entry.reasonLabel = 'Δεν υπάρχει ανάθεση στην ομάδα αυτή την ημέρα.';
                diagnostics.push(entry);
                continue;
            }

            if (normPerson(partnerPerson) === normPerson(person)) {
                entry.reasonCode = 'same_person';
                entry.reasonLabel = 'Ίδιο άτομο με αυτόν/αυτήν που είναι στην Πέμπτη.';
                diagnostics.push(entry);
                continue;
            }

            const partnerSpacing = personPassesThursdaySpacing(
                partnerPerson,
                groupNum,
                thursdayKey,
                assignments,
                runtimeLastThu
            );
            entry.partnerNRequired = partnerSpacing.nRequired;
            entry.partnerThursdaysSince = partnerSpacing.thursdaysSince;
            entry.partnerLastThursday = partnerSpacing.lastThursday || null;
            entry.proximityScore = thursdayNProximityScore(partnerSpacing);
            entry.proximityLabel = formatNProximityLabel(partnerSpacing);

            if (
                typeof isPersonMissingOnDate === 'function' &&
                !isNaN(thuDate.getTime()) &&
                isPersonMissingOnDate(partnerPerson, groupNum, thuDate, 'normal')
            ) {
                entry.reasonCode = 'partner_missing_on_thursday';
                entry.reasonLabel =
                    'Ο/Η ' +
                    partnerPerson +
                    ' απουσιάζει την Πέμπτη ' +
                    formatDateKeyElGR(thursdayKey) +
                    '.';
                diagnostics.push(entry);
                continue;
            }

            const partnerDate = new Date(partnerKey + 'T00:00:00');
            if (
                typeof isPersonMissingOnDate === 'function' &&
                !isNaN(partnerDate.getTime()) &&
                isPersonMissingOnDate(person, groupNum, partnerDate, 'normal')
            ) {
                entry.reasonCode = 'person_missing_on_partner';
                entry.reasonLabel =
                    'Ο/Η ' + person + ' απουσιάζει την ' + entry.partnerDateLabel + '.';
                diagnostics.push(entry);
                continue;
            }

            if (
                typeof isPersonDisabledForDuty === 'function' &&
                isPersonDisabledForDuty(person, groupNum, 'normal', partnerKey)
            ) {
                entry.reasonCode = 'person_disabled_on_partner';
                entry.reasonLabel =
                    'Ο/Η ' +
                    person +
                    ' είναι απενεργοποιημένος/η για καθημερινές την ' +
                    entry.partnerDateLabel +
                    '.';
                diagnostics.push(entry);
                continue;
            }

            if (
                typeof isPersonDisabledForDuty === 'function' &&
                isPersonDisabledForDuty(partnerPerson, groupNum, 'normal', thursdayKey)
            ) {
                entry.reasonCode = 'partner_disabled_on_thursday';
                entry.reasonLabel =
                    'Ο/Η ' +
                    partnerPerson +
                    ' είναι απενεργοποιημένος/η για καθημερινές την Πέμπτη.';
                diagnostics.push(entry);
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
                entry.reasonCode = 'consecutive_conflict';
                entry.reasonLabel =
                    'Η ανταλλαγή θα δημιουργούσε συνεχόμενη υπηρεσία ' +
                    '(έλεγχος για ' +
                    person +
                    ' / ' +
                    partnerPerson +
                    ' στις δύο ημερομηνίες).';
                diagnostics.push(entry);
                continue;
            }

            if (partnerSpacing.eligible) {
                entry.rejected = false;
                entry.reasonCode = 'ok';
                entry.reasonLabel = 'Κατάλληλος εταίρος (περνάει Ν) — γίνεται ανταλλαγή.';
                diagnostics.push(entry);
                return {
                    partnerDays,
                    diagnostics,
                    selected: entry,
                    selectedByProximity: null,
                    thursdayScore
                };
            }

            entry.reasonCode = 'partner_fails_n';
            entry.reasonLabel =
                'Ο/Η ' +
                partnerPerson +
                ' δεν περνάει πλήρως το Ν (' +
                entry.proximityLabel +
                ')· υποψήφιος για ανταλλαγή «πιο κοντά στο Ν».';
            entry.softEligible = true;
            diagnostics.push(entry);
            softCandidates.push(Object.assign({}, entry, { partnerSpacing: partnerSpacing }));
        }

        let selectedByProximity = null;
        for (let si = 0; si < softCandidates.length; si++) {
            const soft = softCandidates[si];
            if (!(soft.proximityScore > thursdayScore)) continue;
            if (
                !selectedByProximity ||
                soft.proximityScore > selectedByProximity.proximityScore ||
                (soft.proximityScore === selectedByProximity.proximityScore &&
                    soft.order < selectedByProximity.order)
            ) {
                selectedByProximity = soft;
            }
        }

        if (selectedByProximity) {
            for (let di = 0; di < diagnostics.length; di++) {
                const d = diagnostics[di];
                if (
                    d.partnerKey === selectedByProximity.partnerKey &&
                    normPerson(d.partnerPerson) === normPerson(selectedByProximity.partnerPerson)
                ) {
                    d.rejected = false;
                    d.reasonCode = 'ok_proximity';
                    d.reasonLabel =
                        'Επιλέχθηκε ως πιο κοντά στο Ν από τον/την ' +
                        person +
                        ' (' +
                        selectedByProximity.proximityLabel +
                        ' vs ' +
                        formatNProximityLabel(thursdayPersonSpacing) +
                        ').';
                    break;
                }
            }
        }

        return {
            partnerDays,
            diagnostics,
            selected: null,
            selectedByProximity: selectedByProximity,
            thursdayScore: thursdayScore,
            softCandidates: softCandidates
        };
    }

    /**
     * Πέρασμα Ν Πεμπτών — τρέχει ΜΕΤΑ την αρχική ανάθεση και τις υπάρχουσες ανταλλαγές.
     */
    function runThursdaySpacingChangesPass(finalNormalAssignments, dayTypeLists) {
        if (typeof isNightChangesMode !== 'function' || !isNightChangesMode()) {
            return {
                assignments: finalNormalAssignments,
                markers: {},
                spacingSwaps: [],
                spacingFails: []
            };
        }

        const assignments = JSON.parse(JSON.stringify(finalNormalAssignments || {}));
        const markers = {};
        const spacingSwaps = [];
        const spacingFails = [];
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

                const diagnosis = diagnoseThursdaySpacingPartnerCandidates(
                    thursdayKey,
                    groupNum,
                    person,
                    assignments,
                    normalDays,
                    runtimeLastThu,
                    simulated,
                    spacing
                );
                const selected = diagnosis.selected;
                const selectedByProximity =
                    !selected && diagnosis.selectedByProximity ? diagnosis.selectedByProximity : null;
                const swapChoice = selected || selectedByProximity || null;
                const isProximitySwap = !!(swapChoice && !selected && selectedByProximity);
                const candidateDiagnostics = diagnosis.diagnostics || [];

                if (swapChoice && swapChoice.partnerKey && swapChoice.partnerPerson) {
                    const partnerKey = swapChoice.partnerKey;
                    const partnerPerson = swapChoice.partnerPerson;
                    const partnerSpacing =
                        swapChoice.partnerSpacing ||
                        personPassesThursdaySpacing(
                            partnerPerson,
                            groupNum,
                            thursdayKey,
                            assignments,
                            runtimeLastThu
                        );

                    if (!assignments[thursdayKey]) assignments[thursdayKey] = {};
                    if (!assignments[partnerKey]) assignments[partnerKey] = {};
                    assignments[thursdayKey][groupNum] = partnerPerson;
                    assignments[partnerKey][groupNum] = person;

                    if (!simulated.normal[thursdayKey]) simulated.normal[thursdayKey] = {};
                    if (!simulated.normal[partnerKey]) simulated.normal[partnerKey] = {};
                    simulated.normal[thursdayKey][groupNum] = partnerPerson;
                    simulated.normal[partnerKey][groupNum] = person;

                    const reason = isProximitySwap
                        ? buildThursdaySpacingProximitySwapReason(
                              person,
                              partnerPerson,
                              thursdayKey,
                              partnerKey,
                              spacing,
                              partnerSpacing
                          )
                        : buildThursdaySpacingSwapReason(
                              person,
                              partnerPerson,
                              thursdayKey,
                              partnerKey,
                              spacing
                          );
                    const spacingMetaBase = {
                        thursdaySpacing: true,
                        thursdaySpacingProximity: isProximitySwap,
                        displacedPerson: person,
                        replacementPerson: partnerPerson,
                        thursdayDateKey: thursdayKey,
                        partnerDateKey: partnerKey,
                        nRequired: spacing.nRequired,
                        thursdaysSince: spacing.thursdaysSince,
                        lastThursday: spacing.lastThursday || null,
                        replacementNRequired: partnerSpacing.nRequired,
                        replacementThursdaysSince: partnerSpacing.thursdaysSince,
                        replacementLastThursday: partnerSpacing.lastThursday || null,
                        candidateDiagnostics
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
                        proximity: isProximitySwap,
                        partnerDateKey: partnerKey,
                        partnerPerson: person,
                        swapPairId: pairId,
                        nRequired: spacing.nRequired,
                        thursdaysSince: spacing.thursdaysSince,
                        reason,
                        candidateDiagnostics
                    });
                    setSpacingMarker(markers, partnerKey, groupNum, person, {
                        status: 'swap',
                        proximity: isProximitySwap,
                        partnerDateKey: thursdayKey,
                        partnerPerson: partnerPerson,
                        swapPairId: pairId,
                        nRequired: spacing.nRequired,
                        thursdaysSince: spacing.thursdaysSince,
                        reason,
                        candidateDiagnostics
                    });

                    spacingSwaps.push({
                        thursdayKey,
                        partnerKey,
                        groupNum,
                        thursdayPerson: partnerPerson,
                        partnerPerson: person,
                        displacedFromThursday: person,
                        proximity: isProximitySwap
                    });

                    if (isProximitySwap) {
                        spacingFails.push({
                            outcome: 'proximity_swap',
                            thursdayKey,
                            thursdayLabel: formatPartnerCandidateDateLabel(thursdayKey),
                            groupNum,
                            person,
                            replacedBy: partnerPerson,
                            partnerKey,
                            partnerLabel: formatPartnerCandidateDateLabel(partnerKey),
                            nRequired: spacing.nRequired,
                            thursdaysSince: spacing.thursdaysSince,
                            lastThursday: spacing.lastThursday || null,
                            lastThursdayLabel: spacing.lastThursday
                                ? formatPartnerCandidateDateLabel(spacing.lastThursday)
                                : '—',
                            reason,
                            candidateDiagnostics
                        });
                    }

                    runtimeLastThu[`${groupNum}:${normPerson(partnerPerson)}`] = thursdayKey;
                    continue;
                }

                const proximityNote =
                    Array.isArray(diagnosis.softCandidates) && diagnosis.softCandidates.length > 0
                        ? `Κανένας υποψήφιος Δευ/Τρι/Τετ δεν ήταν πιο κοντά στο Ν από τον/την ${person} (${formatNProximityLabel(spacing)}).`
                        : null;
                const failReason = buildThursdaySpacingFailReason(
                    person,
                    thursdayKey,
                    spacing,
                    proximityNote
                );
                console.warn(
                    `[THURSDAY SPACING] Δεν βρέθηκε ανταλλαγή για ${person} την ${thursdayKey} (Ομάδα ${groupNum}, Ν=${spacing.nRequired}, πέρασαν ${spacing.thursdaysSince})`,
                    candidateDiagnostics
                );
                setSpacingMarker(markers, thursdayKey, groupNum, person, {
                    status: 'fail',
                    nRequired: spacing.nRequired,
                    thursdaysSince: spacing.thursdaysSince,
                    lastThursday: spacing.lastThursday || null,
                    reason: failReason,
                    candidateDiagnostics
                });
                if (typeof storeAssignmentReason === 'function') {
                    const existing =
                        typeof getAssignmentReason === 'function'
                            ? getAssignmentReason(thursdayKey, groupNum, person)
                            : null;
                    if (!(existing && existing.type === 'swap')) {
                        const failMeta = {
                            thursdaySpacing: true,
                            thursdaySpacingFail: true,
                            nRequired: spacing.nRequired,
                            thursdaysSince: spacing.thursdaysSince,
                            lastThursday: spacing.lastThursday || null,
                            candidateDiagnostics
                        };
                        if (existing && existing.type === 'skip' && !existing.meta?.thursdaySpacingFail) {
                            failMeta.preservedSkipReason = {
                                type: existing.type,
                                reason: existing.reason,
                                swappedWith: existing.swappedWith,
                                meta: existing.meta ? { ...existing.meta } : null
                            };
                        }
                        storeAssignmentReason(
                            thursdayKey,
                            groupNum,
                            person,
                            'skip',
                            failReason,
                            null,
                            null,
                            failMeta
                        );
                    }
                }
                spacingFails.push({
                    outcome: 'fail',
                    thursdayKey,
                    thursdayLabel: formatPartnerCandidateDateLabel(thursdayKey),
                    groupNum,
                    person,
                    nRequired: spacing.nRequired,
                    thursdaysSince: spacing.thursdaysSince,
                    lastThursday: spacing.lastThursday || null,
                    lastThursdayLabel: spacing.lastThursday
                        ? formatPartnerCandidateDateLabel(spacing.lastThursday)
                        : '—',
                    reason: failReason,
                    candidateDiagnostics
                });
                runtimeLastThu[`${groupNum}:${normPerson(person)}`] = thursdayKey;
            }
        }

        if (typeof applyThursdaySpacingMarkers === 'function') {
            applyThursdaySpacingMarkers(markers, normalDays);
        }

        if (typeof calculationSteps !== 'undefined' && calculationSteps) {
            calculationSteps.thursdaySpacingFails = spacingFails;
        }

        return { assignments, markers, spacingSwaps, spacingFails };
    }

    function findPersonIndexInList(groupPeople, personName) {
        if (!Array.isArray(groupPeople) || !personName) return -1;
        const n = normPerson(personName);
        let idx = groupPeople.indexOf(personName);
        if (idx >= 0) return idx;
        return groupPeople.findIndex((p) => normPerson(p) === n);
    }

    function getNightGroupNormalPeople(groupNum, dateKey) {
        const gd =
            typeof groupsForDuty === 'function'
                ? groupsForDuty(groupNum, dateKey)
                : typeof groups !== 'undefined'
                  ? groups[groupNum]
                  : null;
        return (gd && gd.normal) || [];
    }

    function pickNextEligibleNormalPerson(groupPeople, fromIndex, groupNum, dateKey) {
        const rotationDays = groupPeople.length;
        if (!rotationDays) return { person: null, index: fromIndex };
        const date = new Date(dateKey + 'T00:00:00');
        for (let offset = 1; offset <= rotationDays * 2; offset++) {
            const idx = ((fromIndex + offset) % rotationDays + rotationDays) % rotationDays;
            const candidate = groupPeople[idx];
            if (!candidate) continue;
            if (
                typeof isPersonExcludedFromDuties === 'function' &&
                isPersonExcludedFromDuties(candidate, groupNum)
            ) {
                continue;
            }
            if (
                typeof isPersonDisabledForDuty === 'function' &&
                isPersonDisabledForDuty(candidate, groupNum, 'normal', dateKey)
            ) {
                continue;
            }
            if (
                typeof isPersonMissingOnDate === 'function' &&
                !isNaN(date.getTime()) &&
                isPersonMissingOnDate(candidate, groupNum, date, 'normal')
            ) {
                continue;
            }
            return { person: candidate, index: idx };
        }
        return { person: null, index: fromIndex };
    }

    function shouldFreezeNightResequenceDay(dateKey, groupNum, assignee) {
        if (!assignee) return false;
        const reason =
            typeof getAssignmentReason === 'function' ? getAssignmentReason(dateKey, groupNum, assignee) : null;
        if (!reason) return false;
        if (reason.meta?.manualAlternateReplacement || reason.meta?.preserveBaseline) return true;
        if (reason.type === 'swap' && reason.meta?.thursdaySpacing) return true;
        return false;
    }

    /**
     * Μετά από Ν-ανταλλαγές: ξαναγεμίζει τις επόμενες καθημερινές της ομάδας
     * με συνέχεια από το τελικό άτομο της ημέρας-αγκύρωσης (όχι από τον displaced).
     * Μόνο ομάδες 3 & 4.
     */
    function resequenceNightGroupNormalDaysAfterAnchor(
        assignments,
        normalDays,
        groupNum,
        afterDateKey,
        seedPerson
    ) {
        if (!NIGHT_GROUPS.includes(Number(groupNum))) return 0;
        if (typeof shouldRecalculateDutyGroup === 'function' && !shouldRecalculateDutyGroup(groupNum)) {
            return 0;
        }
        if (!afterDateKey || !seedPerson) return 0;

        const sortedDays = [...(normalDays || [])].filter((dk) => dk > afterDateKey).sort();
        if (!sortedDays.length) return 0;

        let lastPerson = seedPerson;
        let changes = 0;

        for (const dateKey of sortedDays) {
            const groupPeople = getNightGroupNormalPeople(groupNum, dateKey);
            if (!groupPeople.length) continue;

            const prev = getAssigneeOnDate(dateKey, groupNum, assignments);
            if (prev && shouldFreezeNightResequenceDay(dateKey, groupNum, prev)) {
                lastPerson = prev;
                continue;
            }

            let fromIndex = findPersonIndexInList(groupPeople, lastPerson);
            if (fromIndex < 0) fromIndex = 0;

            const next = pickNextEligibleNormalPerson(groupPeople, fromIndex, groupNum, dateKey);
            if (!next.person) continue;

            lastPerson = next.person;
            if (prev && normPerson(prev) === normPerson(next.person)) {
                continue;
            }

            if (!assignments[dateKey]) assignments[dateKey] = {};
            if (prev && typeof clearAssignmentReasonForPersonOnDate === 'function') {
                clearAssignmentReasonForPersonOnDate(dateKey, groupNum, prev);
            }
            assignments[dateKey][groupNum] = next.person;
            if (typeof storeAssignmentReason === 'function') {
                storeAssignmentReason(
                    dateKey,
                    groupNum,
                    next.person,
                    'shift',
                    `Αναδιάταξη ουράς μετά Ν Πέμπτης (συνέχεια μετά ${afterDateKey})`,
                    prev || null,
                    null,
                    {
                        thursdaySpacingResequence: true,
                        afterDateKey,
                        seedPerson
                    }
                );
            }
            changes += 1;
        }
        return changes;
    }

    /**
     * Ανά ομάδα Ν: αναδιάταξη μετά την τελευταία ημέρα που άγγιξε Ν-ανταλλαγή αυτού του γύρου.
     */
    function resequenceNightGroupsAfterSpacingSwaps(assignments, dayTypeLists, spacingSwaps) {
        if (!Array.isArray(spacingSwaps) || spacingSwaps.length === 0) return 0;
        const normalDays = [...(dayTypeLists?.normal || [])].sort();
        const perGroup = {};

        for (const swap of spacingSwaps) {
            const groupNum = parseInt(swap.groupNum, 10);
            if (!NIGHT_GROUPS.includes(groupNum)) continue;
            if (typeof isNightChangesGroup === 'function' && !isNightChangesGroup(groupNum)) continue;
            const thu = swap.thursdayKey;
            const partner = swap.partnerKey;
            if (!thu || !partner) continue;
            const afterKey = thu >= partner ? thu : partner;
            if (!perGroup[groupNum] || afterKey > perGroup[groupNum]) {
                perGroup[groupNum] = afterKey;
            }
        }

        let total = 0;
        for (const groupNumStr of Object.keys(perGroup)) {
            const groupNum = parseInt(groupNumStr, 10);
            const afterDateKey = perGroup[groupNum];
            const seedPerson = getAssigneeOnDate(afterDateKey, groupNum, assignments);
            if (!seedPerson) continue;
            const n = resequenceNightGroupNormalDaysAfterAnchor(
                assignments,
                normalDays,
                groupNum,
                afterDateKey,
                seedPerson
            );
            if (n > 0) {
                console.log(
                    `[THURSDAY SPACING] Resequence group ${groupNum} after ${afterDateKey} (seed=${seedPerson}): ${n} day(s)`
                );
            }
            total += n;
        }
        return total;
    }

    function fingerprintNightGroupAssignments(assignments, dayTypeLists) {
        const normalDays = [...(dayTypeLists?.normal || [])].sort();
        const parts = [];
        for (const dk of normalDays) {
            for (const groupNum of NIGHT_GROUPS) {
                const p = assignments?.[dk]?.[groupNum] || assignments?.[dk]?.[String(groupNum)] || '';
                parts.push(`${dk}|${groupNum}|${normPerson(p)}`);
            }
        }
        return parts.join(';');
    }

    /**
     * Επαναληπτικό: Ν πέρασμα → αναδιάταξη ουράς νυχτερινών → ξανά Ν μέχρι σταθεροποίηση.
     * Μόνο όταν isNightChangesMode (ομάδες 3 & 4).
     */
    function runThursdaySpacingChangesPassIterative(finalNormalAssignments, dayTypeLists) {
        if (typeof isNightChangesMode !== 'function' || !isNightChangesMode()) {
            return {
                assignments: finalNormalAssignments,
                markers: {},
                spacingSwaps: [],
                spacingFails: []
            };
        }

        const MAX_ITERS = 5;
        let assignments = JSON.parse(JSON.stringify(finalNormalAssignments || {}));
        let cumulativeSwaps = [];
        let lastResult = {
            assignments,
            markers: {},
            spacingSwaps: [],
            spacingFails: []
        };

        for (let iter = 1; iter <= MAX_ITERS; iter++) {
            const result = runThursdaySpacingChangesPass(assignments, dayTypeLists);
            lastResult = result;
            assignments = result.assignments;
            const swaps = result.spacingSwaps || [];

            console.log(
                `[THURSDAY SPACING] Iterative pass ${iter}/${MAX_ITERS}: swaps=${swaps.length}, fails=${(result.spacingFails || []).length}`
            );

            if (swaps.length === 0) {
                break;
            }

            cumulativeSwaps = cumulativeSwaps.concat(
                swaps.map((s) => ({
                    ...s,
                    iterativePass: iter
                }))
            );

            const fpBeforeReseq = fingerprintNightGroupAssignments(assignments, dayTypeLists);
            const changed = resequenceNightGroupsAfterSpacingSwaps(assignments, dayTypeLists, swaps);
            const fpAfterReseq = fingerprintNightGroupAssignments(assignments, dayTypeLists);

            if (changed === 0 || fpAfterReseq === fpBeforeReseq) {
                console.log(
                    `[THURSDAY SPACING] Iterative stabilize after pass ${iter} (resequence changes=${changed})`
                );
                break;
            }
            // Αλλιώς: νέο πέρασμα Ν στις Πέμπτες που άλλαξαν από την αναδιάταξη
        }

        if (typeof calculationSteps !== 'undefined' && calculationSteps) {
            calculationSteps.thursdaySpacingFails = lastResult.spacingFails || [];
            calculationSteps.thursdaySpacingIterativeSwaps = cumulativeSwaps;
        }

        return {
            assignments,
            markers: lastResult.markers || {},
            spacingSwaps: cumulativeSwaps.length ? cumulativeSwaps : lastResult.spacingSwaps || [],
            spacingFails: lastResult.spacingFails || []
        };
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
                proximity: !!reason.meta.thursdaySpacingProximity,
                thursdaySpacingProximity: !!reason.meta.thursdaySpacingProximity,
                displacedPerson: displaced,
                partnerPerson: reason.swappedWith || displaced,
                partnerDateKey,
                reasonText: reason.reason || marker?.reason || ''
            };
        }

        if (marker?.status === 'swap') {
            return {
                status: 'swap',
                proximity: !!marker.proximity,
                thursdaySpacingProximity: !!marker.proximity,
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

        if (marker?.status === 'fail' || reason?.meta?.thursdaySpacingFail) {
            return {
                status: 'fail',
                nRequired: marker?.nRequired ?? reason?.meta?.nRequired ?? null,
                thursdaysSince: marker?.thursdaysSince ?? reason?.meta?.thursdaysSince ?? null,
                lastThursday: marker?.lastThursday || reason?.meta?.lastThursday || null,
                reasonText: marker?.reason || reason?.reason || '',
                candidateDiagnostics:
                    marker?.candidateDiagnostics || reason?.meta?.candidateDiagnostics || []
            };
        }

        if (reason?.meta?.thursdaySpacing && !reason?.meta?.thursdaySpacingFail) {
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

        const personThursdayCounts = buildPersonThursdayCountsFromMap(thursdayCountByPerson);

        return { thursdayEvents, personSummaries, swapPairs, personThursdayCounts };
    }

    function monthKeyFromDateKey(dateKey) {
        if (!dateKey || typeof dateKey !== 'string') return null;
        const m = dateKey.match(/^(\d{4}-\d{2})/);
        return m ? m[1] : null;
    }

    function formatMonthKeyEl(monthKey) {
        if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return String(monthKey || '—');
        const d = new Date(`${monthKey}-01T00:00:00`);
        if (isNaN(d.getTime())) return monthKey;
        return d.toLocaleDateString('el-GR', { month: 'long', year: 'numeric' });
    }

    function buildPersonThursdayCountsFromMap(thursdayCountByPerson) {
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
        return personThursdayCounts;
    }

    /**
     * Μετράει Πέμπτες ανά άτομο, προαιρετικά φιλτραρισμένες σε μήνα ή περίοδο μηνών (YYYY-MM).
     */
    function buildPersonThursdayCountsForPeriod(thursdayEvents, fromMonth, toMonth) {
        let from = fromMonth && /^\d{4}-\d{2}$/.test(fromMonth) ? fromMonth : null;
        let to = toMonth && /^\d{4}-\d{2}$/.test(toMonth) ? toMonth : null;
        if (from && to && from > to) {
            const tmp = from;
            from = to;
            to = tmp;
        }
        if (from && !to) to = from;
        if (to && !from) from = to;

        const thursdayCountByPerson = new Map();
        let matchedEvents = 0;
        for (const ev of thursdayEvents || []) {
            const mk = monthKeyFromDateKey(ev.dateKey);
            if (from && to) {
                if (!mk || mk < from || mk > to) continue;
            }
            matchedEvents += 1;
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

        return {
            rows: buildPersonThursdayCountsFromMap(thursdayCountByPerson),
            matchedEvents,
            fromMonth: from,
            toMonth: to
        };
    }

    function getAvailableMonthKeysFromThursdayEvents(thursdayEvents) {
        const set = new Set();
        for (const ev of thursdayEvents || []) {
            const mk = monthKeyFromDateKey(ev.dateKey);
            if (mk) set.add(mk);
        }
        return [...set].sort();
    }

    function renderThursdaySpacingHistoryCountsTable(rows) {
        const tbodyCounts = document.getElementById('thursdaySpacingHistoryCountsBody');
        if (!tbodyCounts) return;
        const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s || '');
        const groupLabel = (g) =>
            typeof getGroupName === 'function' ? getGroupName(g) : `Ομάδα ${g}`;

        tbodyCounts.innerHTML = '';
        for (const row of rows || []) {
            const tr = document.createElement('tr');
            const countClass = row.count > 0 ? 'fw-bold text-primary' : 'text-muted';
            tr.innerHTML = `
                <td><span class="badge bg-primary">${esc(groupLabel(row.groupNum))}</span></td>
                <td><strong>${esc(row.person)}</strong></td>
                <td class="text-center ${countClass}">${row.count}</td>
            `;
            tbodyCounts.appendChild(tr);
        }
    }

    function applyThursdaySpacingHistoryCountsFilter() {
        const report = window._thursdaySpacingHistoryReportCache;
        if (!report) return;
        const fromEl = document.getElementById('thursdayCountsFromMonth');
        const toEl = document.getElementById('thursdayCountsToMonth');
        const hintEl = document.getElementById('thursdayCountsFilterHint');
        const from = fromEl?.value || '';
        const to = toEl?.value || '';
        const result = buildPersonThursdayCountsForPeriod(report.thursdayEvents, from, to);
        renderThursdaySpacingHistoryCountsTable(result.rows);

        if (hintEl) {
            if (!result.fromMonth && !result.toMonth) {
                hintEl.textContent = `Όλη η περίοδος · ${result.matchedEvents} Πέμπτες`;
            } else if (result.fromMonth === result.toMonth) {
                hintEl.textContent = `${formatMonthKeyEl(result.fromMonth)} · ${result.matchedEvents} Πέμπτες`;
            } else {
                hintEl.textContent =
                    `${formatMonthKeyEl(result.fromMonth)} – ${formatMonthKeyEl(result.toMonth)} · ` +
                    `${result.matchedEvents} Πέμπτες`;
            }
        }
    }

    function setupThursdaySpacingHistoryCountsFilter(report) {
        const fromEl = document.getElementById('thursdayCountsFromMonth');
        const toEl = document.getElementById('thursdayCountsToMonth');
        const applyBtn = document.getElementById('thursdayCountsApplyFilterBtn');
        const clearBtn = document.getElementById('thursdayCountsClearFilterBtn');
        if (!fromEl || !toEl) return;

        const months = getAvailableMonthKeysFromThursdayEvents(report?.thursdayEvents);
        const minMonth = months[0] || '';
        const maxMonth = months.length ? months[months.length - 1] : '';
        if (minMonth) {
            fromEl.min = minMonth;
            toEl.min = minMonth;
        } else {
            fromEl.removeAttribute('min');
            toEl.removeAttribute('min');
        }
        if (maxMonth) {
            fromEl.max = maxMonth;
            toEl.max = maxMonth;
        } else {
            fromEl.removeAttribute('max');
            toEl.removeAttribute('max');
        }

        if (!fromEl.dataset.bound) {
            fromEl.dataset.bound = '1';
            toEl.dataset.bound = '1';
            const onEnter = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    applyThursdaySpacingHistoryCountsFilter();
                }
            };
            fromEl.addEventListener('keydown', onEnter);
            toEl.addEventListener('keydown', onEnter);
            fromEl.addEventListener('change', applyThursdaySpacingHistoryCountsFilter);
            toEl.addEventListener('change', applyThursdaySpacingHistoryCountsFilter);
            if (applyBtn) {
                applyBtn.addEventListener('click', applyThursdaySpacingHistoryCountsFilter);
            }
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    fromEl.value = '';
                    toEl.value = '';
                    applyThursdaySpacingHistoryCountsFilter();
                });
            }
        }

        applyThursdaySpacingHistoryCountsFilter();
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
        window._thursdaySpacingHistoryReportCache = report;
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
                if (ev?.proximity || ev?.thursdaySpacingProximity) {
                    return '<span class="badge bg-warning text-dark">Ανταλλαγή Ν (κοντινότερος)</span>';
                }
                return '<span class="badge bg-warning text-dark">Ανταλλαγή Ν</span>';
            }
            if (status === 'fail') {
                const extra =
                    ev?.nRequired != null
                        ? ` (Ν=${ev.nRequired}${ev.thursdaysSince != null ? ', πέρασαν ' + ev.thursdaysSince : ''})`
                        : '';
                const tip = ev?.reasonText ? ` title="${esc(ev.reasonText)}"` : '';
                return `<span class="badge bg-danger"${tip}>Αποτυχία Ν${esc(extra)}</span>`;
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

        setupThursdaySpacingHistoryCountsFilter(report);

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

    /**
     * Συλλογή αποτυχιών Ν Πεμπτών (από τελευταίο υπολογισμό ή από αποθηκευμένα markers/reasons).
     */
    function collectThursdaySpacingFailReports() {
        if (
            typeof calculationSteps !== 'undefined' &&
            Array.isArray(calculationSteps?.thursdaySpacingFails) &&
            calculationSteps.thursdaySpacingFails.length > 0
        ) {
            return calculationSteps.thursdaySpacingFails.slice();
        }

        const fails = [];
        const markersStore =
            typeof thursdaySpacingMarkers !== 'undefined'
                ? thursdaySpacingMarkers
                : typeof window !== 'undefined'
                  ? window.thursdaySpacingMarkers
                  : null;
        const seen = new Set();

        const pushFail = (row) => {
            if (!row?.thursdayKey || !row?.groupNum || !row?.person) return;
            const key = `${row.thursdayKey}|${row.groupNum}|${normPerson(row.person)}`;
            if (seen.has(key)) return;
            seen.add(key);
            fails.push(row);
        };

        if (markersStore && typeof markersStore === 'object') {
            for (const dateKey of Object.keys(markersStore)) {
                if (typeof isNightThursdayDateKey === 'function' && !isNightThursdayDateKey(dateKey)) continue;
                for (const groupStr of [3, 4, '3', '4']) {
                    const groupNum = parseInt(groupStr, 10);
                    const gmap = markersStore[dateKey]?.[groupNum] || markersStore[dateKey]?.[groupStr];
                    if (!gmap) continue;
                    for (const personName of Object.keys(gmap)) {
                        const m = gmap[personName];
                        if (!m || (m.status !== 'fail' && !(m.status === 'swap' && m.proximity))) continue;
                        pushFail({
                            outcome: m.status === 'swap' ? 'proximity_swap' : 'fail',
                            thursdayKey: dateKey,
                            thursdayLabel: formatPartnerCandidateDateLabel(dateKey),
                            groupNum,
                            person: m.status === 'swap' ? m.partnerPerson || personName : personName,
                            replacedBy: m.status === 'swap' ? personName : null,
                            partnerKey: m.partnerDateKey || null,
                            partnerLabel: m.partnerDateKey
                                ? formatPartnerCandidateDateLabel(m.partnerDateKey)
                                : null,
                            nRequired: m.nRequired,
                            thursdaysSince: m.thursdaysSince,
                            lastThursday: m.lastThursday || null,
                            lastThursdayLabel: m.lastThursday
                                ? formatPartnerCandidateDateLabel(m.lastThursday)
                                : '—',
                            reason: m.reason || '',
                            candidateDiagnostics: Array.isArray(m.candidateDiagnostics)
                                ? m.candidateDiagnostics
                                : []
                        });
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
                        if (r?.meta?.thursdaySpacingFail) {
                            pushFail({
                                outcome: 'fail',
                                thursdayKey: dateKey,
                                thursdayLabel: formatPartnerCandidateDateLabel(dateKey),
                                groupNum,
                                person: personName,
                                nRequired: r.meta.nRequired,
                                thursdaysSince: r.meta.thursdaysSince,
                                lastThursday: r.meta.lastThursday || null,
                                lastThursdayLabel: r.meta.lastThursday
                                    ? formatPartnerCandidateDateLabel(r.meta.lastThursday)
                                    : '—',
                                reason: r.reason || '',
                                candidateDiagnostics: Array.isArray(r.meta.candidateDiagnostics)
                                    ? r.meta.candidateDiagnostics
                                    : []
                            });
                            continue;
                        }
                        if (r?.type === 'swap' && r?.meta?.thursdaySpacingProximity) {
                            const displaced = r.meta.displacedPerson || r.swappedWith || null;
                            const replacement =
                                r.meta.replacementPerson ||
                                (normPerson(personName) === normPerson(displaced) ? r.swappedWith : personName);
                            pushFail({
                                outcome: 'proximity_swap',
                                thursdayKey: dateKey,
                                thursdayLabel: formatPartnerCandidateDateLabel(dateKey),
                                groupNum,
                                person: displaced || personName,
                                replacedBy: replacement,
                                partnerKey: r.meta.partnerDateKey || null,
                                partnerLabel: r.meta.partnerDateKey
                                    ? formatPartnerCandidateDateLabel(r.meta.partnerDateKey)
                                    : null,
                                nRequired: r.meta.nRequired,
                                thursdaysSince: r.meta.thursdaysSince,
                                lastThursday: r.meta.lastThursday || null,
                                lastThursdayLabel: r.meta.lastThursday
                                    ? formatPartnerCandidateDateLabel(r.meta.lastThursday)
                                    : '—',
                                reason: r.reason || '',
                                candidateDiagnostics: Array.isArray(r.meta.candidateDiagnostics)
                                    ? r.meta.candidateDiagnostics
                                    : []
                            });
                        }
                    }
                }
            }
        }

        fails.sort((a, b) => {
            const byDate = String(a.thursdayKey || '').localeCompare(String(b.thursdayKey || ''));
            if (byDate !== 0) return byDate;
            return (a.groupNum || 0) - (b.groupNum || 0);
        });
        return fails;
    }

    function openThursdaySpacingFailReportModal() {
        const fails = collectThursdaySpacingFailReports();
        const body = document.getElementById('thursdaySpacingFailReportBody');
        const emptyMsg = document.getElementById('thursdaySpacingFailReportEmpty');
        const countBadge = document.getElementById('thursdaySpacingFailReportCount');
        if (!body) return;

        const esc = typeof escapeHtml === 'function' ? escapeHtml : (s) => String(s || '');
        const groupLabel = (g) =>
            typeof getGroupName === 'function' ? getGroupName(g) : `Ομάδα ${g}`;

        if (countBadge) {
            countBadge.textContent = String(fails.length);
            const hardFails = fails.filter((f) => f.outcome !== 'proximity_swap').length;
            countBadge.className =
                hardFails > 0
                    ? 'badge bg-danger ms-2'
                    : fails.length > 0
                      ? 'badge bg-warning text-dark ms-2'
                      : 'badge bg-secondary ms-2';
        }

        if (emptyMsg) {
            emptyMsg.style.display = fails.length === 0 ? 'block' : 'none';
        }

        body.innerHTML = '';
        if (fails.length === 0) {
            body.innerHTML =
                '<div class="alert alert-success mb-0"><i class="fas fa-check-circle me-2"></i>Δεν υπάρχουν αποθηκευμένες αποτυχίες εύρεσης εταίρου για κανόνα Ν Πεμπτών.</div>';
        } else {
            for (const fail of fails) {
                const isProximity = fail.outcome === 'proximity_swap';
                const card = document.createElement('div');
                card.className = isProximity
                    ? 'card mb-3 border-warning'
                    : 'card mb-3 border-danger';
                const diagRows = (fail.candidateDiagnostics || [])
                    .map((d) => {
                        const who = d.partnerPerson
                            ? esc(d.partnerPerson)
                            : '<span class="text-muted">—</span>';
                        let badge = '<span class="badge bg-danger">Απορρίφθηκε</span>';
                        if (!d.rejected) {
                            badge =
                                d.reasonCode === 'ok_proximity'
                                    ? '<span class="badge bg-warning text-dark">Κοντινότερος</span>'
                                    : '<span class="badge bg-success">OK</span>';
                        }
                        const ord = d.order != null ? `#${d.order}` : '';
                        return `<tr>
                            <td class="text-nowrap">${esc(ord)}</td>
                            <td>${esc(d.partnerDateLabel || d.partnerKey || '—')}</td>
                            <td>${who}</td>
                            <td>${badge}</td>
                            <td>${esc(d.reasonLabel || d.reasonCode || '—')}</td>
                        </tr>`;
                    })
                    .join('');
                const diagTable =
                    (fail.candidateDiagnostics || []).length > 0
                        ? `<div class="table-responsive mt-2">
                            <table class="table table-sm table-bordered mb-0">
                                <thead class="table-light">
                                    <tr>
                                        <th>Σειρά</th>
                                        <th>Υποψήφια ημέρα</th>
                                        <th>Άτομο εκεί</th>
                                        <th>Αποτέλεσμα</th>
                                        <th>Γιατί</th>
                                    </tr>
                                </thead>
                                <tbody>${diagRows}</tbody>
                            </table>
                           </div>`
                        : `<div class="alert alert-warning small mt-2 mb-0">
                            Δεν υπάρχουν λεπτομέρειες υποψηφίων για αυτή την αποτυχία
                            (παλιότερος υπολογισμός πριν την αποθήκευση διάγνωσης).
                           </div>`;

                const headerClass = isProximity
                    ? 'card-header bg-warning text-dark py-2'
                    : 'card-header bg-danger text-white py-2';
                const outcomeBadge = isProximity
                    ? '<span class="badge bg-dark ms-2">Αντικατάσταση κοντινότερου</span>'
                    : '<span class="badge bg-light text-dark ms-2">Αποτυχία</span>';
                const replacedLine = isProximity
                    ? `<div><strong>Αντικαταστάθηκε από:</strong> ${esc(fail.replacedBy || '—')} ` +
                      `(${esc(fail.partnerLabel || fail.partnerKey || '—')})</div>`
                    : '';

                card.innerHTML = `
                    <div class="${headerClass}">
                        <strong>${esc(fail.person)}</strong>
                        <span class="badge bg-light text-dark ms-2">${esc(groupLabel(fail.groupNum))}</span>
                        ${outcomeBadge}
                        <span class="ms-2">${esc(fail.thursdayLabel || fail.thursdayKey)}</span>
                    </div>
                    <div class="card-body py-2">
                        <div class="small mb-2">
                            <div><strong>Ν απαιτούμενο:</strong> ${esc(String(fail.nRequired ?? '—'))}</div>
                            <div><strong>Πέμπτες που πέρασαν:</strong> ${esc(String(fail.thursdaysSince ?? '—'))}</div>
                            <div><strong>Τελευταία Πέμπτη ατόμου:</strong> ${esc(fail.lastThursdayLabel || '—')}</div>
                            ${replacedLine}
                        </div>
                        <div class="small text-muted mb-2">${esc(fail.reason || '')}</div>
                        <div class="fw-semibold small mb-1">Έλεγχος υποψηφίων εταίρων (κατά σειρά προτεραιότητας)</div>
                        ${diagTable}
                    </div>
                `;
                body.appendChild(card);
            }
        }

        const modalEl = document.getElementById('thursdaySpacingFailReportModal');
        if (modalEl && typeof bootstrap !== 'undefined') {
            bootstrap.Modal.getOrCreateInstance(modalEl).show();
        }
    }

    window.runThursdaySpacingChangesPass = runThursdaySpacingChangesPass;
    window.runThursdaySpacingChangesPassIterative = runThursdaySpacingChangesPassIterative;
    window.resequenceNightGroupsAfterSpacingSwaps = resequenceNightGroupsAfterSpacingSwaps;
    window.buildThursdaySpacingSwapReason = buildThursdaySpacingSwapReason;
    window.countActiveNormalListSizeForThursday = countActiveNormalListSize;
    window.countNormalThursdaysSinceLast = countNormalThursdaysSinceLast;
    window.personPassesThursdaySpacing = personPassesThursdaySpacing;
    window.getThursdaySpacingPartnerCandidates = getThursdaySpacingPartnerCandidates;
    window.shouldSkipNormalConflictSwapForThursdaySpacing = shouldSkipNormalConflictSwapForThursdaySpacing;
    window.buildThursdaySpacingHistoryReport = buildThursdaySpacingHistoryReport;
    window.openThursdaySpacingHistoryModal = openThursdaySpacingHistoryModal;
    window.collectThursdaySpacingFailReports = collectThursdaySpacingFailReports;
    window.openThursdaySpacingFailReportModal = openThursdaySpacingFailReportModal;
    window.diagnoseThursdaySpacingPartnerCandidates = diagnoseThursdaySpacingPartnerCandidates;
    window.buildThursdaySpacingSwapFrameStyle = buildThursdaySpacingSwapFrameStyle;
    window.getThursdaySpacingSwapColors = getThursdaySpacingSwapColors;
    window.buildThursdaySpacingPairFallbackKey = buildThursdaySpacingPairFallbackKey;
    window.resolveThursdaySpacingSwapPairId = resolveThursdaySpacingSwapPairId;
})();