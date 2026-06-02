// ============================================================================
// DUTY-SHIFTS-DEBUG.JS — Αναλυτικό debug μόνο για ΣΚ & δημόσιες αργίες (weekend)
// (όχι ειδικές αργίες — special-holiday / Step 1)
// ============================================================================

(function () {
    const STORAGE_KEY = 'dutyWeekendDebug';

    const REASON_LABELS = {
        ACCEPTED: 'Επιλέχθηκε',
        MISSING_ON_DATE: 'Απουσία ή απενεργοποίηση την ημέρα της υπηρεσίας',
        DISABLED_FOR_DUTY: 'Απενεργοποιημένος για ΣΚ/αργία',
        NOT_IN_WEEKEND_LIST: 'Δεν είναι στη λίστα weekend της ομάδας',
        HAS_SPECIAL_SAME_MONTH: 'Έχει ειδική αργία τον ίδιο μήνα (από Step 1 / Firebase)',
        ALREADY_ASSIGNED_WEEKEND_MONTH: 'Έχει ήδη ανατεθεί ΣΚ/αργία τον ίδιο μήνα',
        WEEKEND_5_DAY_GAP: 'Άλλη ανάθεση ΣΚ εντός 5 ημερών (preview)',
        RETURN_FROM_MISSING_ALREADY: 'Ήδη τοποθετήθηκε via return-from-missing',
        SWAP_NO_OTHER_DATE: 'Δεν βρέθηκε άλλη ημέρα ΣΚ/αργίας στον ίδιο μήνα για ανταλλαγή',
        SWAP_PARTNER_MISSING_HERE: 'Ο πιθανός partner απουσιάζει την ημέρα της απουσίας',
        SWAP_SELF_MISSING_THERE: 'Ο απόντας δεν μπορεί να πάει στην άλλη ημέρα (ακόμα απουσία)',
        NO_CURRENT_PERSON: 'Κενή θέση — δεν υπάρχει ανατεθειμένος στο temp (skip logic παραλείπει)',
        ALL_CANDIDATES_EXHAUSTED: 'Κανένας επιλέξιμος στη σειρά weekend',
        GROUP_NOT_RECALCULATED: 'Η ομάδα δεν επανυπολογίστηκε (διατήρηση παλιάς ανάθεσης)',
        STILL_MISSING_AFTER_LOGIC: 'Μένει ο απόντας — δεν βρέθηκε αντικαταστάτης',
        UNCHANGED: 'Χωρίς αλλαγή (ήδη επιλέξιμος)',
        PHASE_SKIPPED: 'Η φάση δεν εφαρμόστηκε',
        RETURN_NOT_ON_WEEKEND_LIST: 'Δεν είναι στη λίστα weekend — δεν επιλέγεται return-from-missing',
        RETURN_PERIOD_OUT_OF_RANGE: 'Η απουσία δεν τελειώνει εντός περιόδου υπολογισμού / προηγ. μήνα',
        RETURN_NO_MISSED_WEEKEND: 'Δεν βρέθηκε ΣΚ/αργία που θα έπρεπε να είχε (baseline) στην περίοδο απουσίας',
        RETURN_TARGET_OUT_OF_CALC_RANGE: 'Ο υπολογισμένος στόχος ΣΚ είναι εκτός επιλεγμένων μηνών',
        RETURN_TARGET_BUSY: 'Η ημέρα-στόχος ΣΚ είναι ήδη δεσμευμένη για άλλον return-from-missing',
        RETURN_PLANNED: 'Προγραμματίστηκε ανάθεση σε άλλη ημέρα ΣΚ/αργίας (ίδιος μήνας)',
        RETURN_NO_SAME_MONTH_SLOT: 'Δεν βρέθηκε ελεύθερο ΣΚ στον ίδιο μήνα όπου ο απόντας είναι διαθέσιμος',
        RETURN_TOO_SOON_AFTER_ABSENCE_END:
            'Σάββατο/Κυριακή εντός 2 ημερολογιακών ημερών από τη λήξη απουσίας — αποκλείεται ως στόχος',
        RETURN_APPLIED: 'Τοποθετήθηκε στην προγραμματισμένη ημέρα ΣΚ/αργίας',
        RETURN_FAILED_STILL_MISSING_ON_TARGET: 'Προγραμματίστηκε αλλά απουσιάζει και την ημέρα-στόχο',
        RETURN_FAILED_NOT_IN_LIST: 'Προγραμματίστηκε αλλά δεν βρέθηκε στη λίστα weekend την ημέρα-στόχο',
        RETURN_NEVER_PLANNED: 'Απουσία σε ΣΚ/αργία χωρίς κανένα προγραμματισμένο return-from-missing',
        SWAP_MOVES_ABSENT_TO: 'Με ανταλλαγή ημερομηνιών ο απόντας πηγαίνει σε άλλη ημέρα ΣΚ'
    };

    const state = {
        enabled: false,
        entries: [],
        absentPlacements: [],
        absentByKey: {},
        filter: { dateKey: null, groupNum: null, personName: null },
        currentSlot: null
    };

    function normPerson(s) {
        return typeof normalizePersonKey === 'function' ? normalizePersonKey(s) : String(s || '').trim();
    }

    function isEnabled() {
        try {
            if (state.enabled) return true;
            if (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY) === '1') return true;
        } catch (_) {}
        return false;
    }

    function matchesFilter(dateKey, groupNum, personName) {
        const f = state.filter || {};
        if (f.dateKey && f.dateKey !== dateKey) return false;
        if (f.groupNum != null && Number(f.groupNum) !== Number(groupNum)) return false;
        if (f.personName) {
            const n = normPerson(f.personName);
            if (personName && normPerson(personName) !== n) {
                const slot = state.currentSlot;
                if (!slot) return false;
                const hay = [
                    slot.baseline,
                    slot.rotationPerson,
                    slot.currentPerson,
                    slot.finalPerson,
                    slot.skippedPerson,
                    slot.outcome?.replacementOnDate,
                    slot.outcome?.absentPersonPlan?.targetDateKey
                        ? null
                        : slot.outcome?.absentPersonPlan?.personName
                ]
                    .filter(Boolean)
                    .map(normPerson);
                if (!hay.includes(n)) return false;
            }
        }
        return true;
    }

    function absentKey(groupNum, personName, absenceEndKey) {
        return `${groupNum}|${normPerson(personName)}|${absenceEndKey || ''}`;
    }

    function findPlanForPerson(groupNum, personName) {
        const n = normPerson(personName);
        if (!n) return null;
        return (
            state.absentPlacements.find(
                (p) => Number(p.groupNum) === Number(groupNum) && normPerson(p.personName) === n
            ) || null
        );
    }

    function isWeekendReturnTooSoonAfterAbsenceEnd(absenceEndKey, candidateWeekendKey) {
        if (!absenceEndKey || !candidateWeekendKey) return false;
        const a = new Date(absenceEndKey + 'T00:00:00');
        const b = new Date(candidateWeekendKey + 'T00:00:00');
        if (isNaN(a.getTime()) || isNaN(b.getTime())) return false;
        const daysAfter = Math.round((b - a) / (1000 * 60 * 60 * 24));
        if (daysAfter <= 0 || daysAfter > 2) return false;
        const dow = b.getDay();
        return dow === 0 || dow === 6;
    }

    function scanAlternateWeekendDates(ctx) {
        const {
            personName,
            groupNum,
            sortedWeekends,
            calcStartKey,
            calcEndKey,
            assignedWeekendInMonth,
            simulatedSpecialMonthSet,
            absenceEndKey
        } = ctx;
        const rows = [];
        if (!sortedWeekends || !personName) return rows;
        for (const dk of sortedWeekends) {
            if (calcStartKey && dk < calcStartKey) continue;
            if (calcEndKey && dk > calcEndKey) continue;
            const d = new Date(dk + 'T00:00:00');
            const codes = [];
            if (absenceEndKey && isWeekendReturnTooSoonAfterAbsenceEnd(absenceEndKey, dk)) {
                codes.push('RETURN_TOO_SOON_AFTER_ABSENCE_END');
            }
            if (typeof isPersonMissingOnDate === 'function' && isPersonMissingOnDate(personName, groupNum, d, 'weekend')) {
                codes.push('MISSING_ON_DATE');
            }
            if (assignedWeekendInMonth && assignedWeekendInMonth.has(personName)) {
                codes.push('ALREADY_ASSIGNED_WEEKEND_MONTH');
            }
            if (simulatedSpecialMonthSet && simulatedSpecialMonthSet.has(personName)) {
                codes.push('HAS_SPECIAL_SAME_MONTH');
            }
            rows.push({
                dateKey: dk,
                accepted: codes.length === 0,
                reasonCodes: codes.length ? codes : ['ACCEPTED']
            });
        }
        return rows;
    }

    /**
     * Καταγραφή: πού θα ανατεθεί ο απόντας (return-from-missing) ή γιατί όχι.
     */
    function recordAbsentPlacement(rec) {
        if (!isEnabled()) return null;
        const key = rec.id || absentKey(rec.groupNum, rec.personName, rec.absenceEndKey);
        let row = state.absentByKey[key];
        if (!row) {
            row = { id: key, t: Date.now(), missedOnDateKeys: [] };
            state.absentByKey[key] = row;
            state.absentPlacements.push(row);
        }
        Object.assign(row, rec);
        if (rec.missedOnDateKey) {
            const mk = rec.missedOnDateKey;
            if (!row.missedOnDateKeys.includes(mk)) row.missedOnDateKeys.push(mk);
        }
        return row;
    }

    function noteMissedWeekendForAbsent(groupNum, personName, absenceEndKey, missedDateKey, replacementOnMissedDate) {
        if (!isEnabled()) return;
        const row = state.absentByKey[absentKey(groupNum, personName, absenceEndKey)] || findPlanForPerson(groupNum, personName);
        if (row) {
            if (missedDateKey && !row.missedOnDateKeys.includes(missedDateKey)) {
                row.missedOnDateKeys.push(missedDateKey);
            }
            if (replacementOnMissedDate != null) {
                row.replacementOnMissedDate = replacementOnMissedDate;
            }
        } else {
            recordAbsentPlacement({
                groupNum,
                personName,
                absenceEndKey,
                missedOnDateKey: missedDateKey,
                replacementOnMissedDate,
                status: 'unresolved',
                reasonCode: 'RETURN_NEVER_PLANNED',
                message: 'Απουσία σε ΣΚ/αργία χωρίς προγραμματισμένη μελλοντική ανάθεση (return-from-missing).'
            });
        }
    }

    function refreshAbsentReplacementsFromPreview(weekendAssignments, weekendRotationBaseline) {
        if (!isEnabled()) return;
        for (const row of state.absentPlacements) {
            const missed =
                row.missedOnDateKeys && row.missedOnDateKeys.length
                    ? row.missedOnDateKeys
                    : row.missedOnDateKey
                      ? [row.missedOnDateKey]
                      : [];
            for (const dk of missed) {
                const g = row.groupNum;
                const baseline = weekendRotationBaseline?.[dk]?.[g];
                if (!baseline || normPerson(baseline) !== normPerson(row.personName)) continue;
                const assigned = weekendAssignments?.[dk]?.[g];
                if (!assigned || normPerson(assigned) === normPerson(baseline)) continue;
                row.replacementOnMissedDate = assigned;
            }
        }
    }

    function finalizeMissedWeekendAbsences(ctx) {
        if (!isEnabled()) return;
        const {
            sortedWeekends,
            baselineWeekendByDate,
            calcStartKey,
            calcEndKey,
            returnFromMissingWeekendTargets,
            assignedWeekendInMonthPreview,
            simulatedSpecialAssignments,
            simulatedWeekendAssignments,
            weekendRotationPersons
        } = ctx;
        const unresolved = new Set();
        for (const dk of sortedWeekends || []) {
            if (calcStartKey && dk < calcStartKey) continue;
            if (calcEndKey && dk > calcEndKey) continue;
            const d = new Date(dk + 'T00:00:00');
            const monthKey =
                typeof getMonthKeyFromDate === 'function'
                    ? getMonthKeyFromDate(d)
                    : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            for (let g = 1; g <= 4; g++) {
                const base = baselineWeekendByDate?.[dk]?.[g];
                if (!base) continue;
                if (typeof isPersonMissingOnDate !== 'function' || !isPersonMissingOnDate(base, g, d, 'weekend')) {
                    continue;
                }
                const replFromPreview =
                    simulatedWeekendAssignments?.[dk]?.[g] &&
                    normPerson(simulatedWeekendAssignments[dk][g]) !== normPerson(base)
                        ? simulatedWeekendAssignments[dk][g]
                        : weekendRotationPersons?.[dk]?.[g] &&
                            simulatedWeekendAssignments?.[dk]?.[g] &&
                            normPerson(simulatedWeekendAssignments[dk][g]) !==
                                normPerson(weekendRotationPersons[dk][g])
                          ? simulatedWeekendAssignments[dk][g]
                          : null;
                const plan = findPlanForPerson(g, base);
                if (plan && plan.targetDateKey) {
                    noteMissedWeekendForAbsent(g, base, plan.absenceEndKey, dk, replFromPreview);
                    continue;
                }
                if (plan && (plan.status === 'skipped' || plan.reasonCode === 'RETURN_NO_MISSED_WEEKEND')) {
                    noteMissedWeekendForAbsent(g, base, plan.absenceEndKey, dk, replFromPreview);
                    if (plan.status === 'skipped') {
                        plan.status = 'failed';
                        plan.reasonCode = 'RETURN_MISSED_BASELINE_NOT_PLANNED';
                        plan.message =
                            (plan.message || '') +
                            ` Εντοπίστηκε χαμένο ΣΚ ${dk} (baseline) αλλά δεν προγραμματίστηκε ανάθεση — διορθώθηκε η ανίχνευση.`;
                    }
                    continue;
                }
                const uKey = `${g}|${normPerson(base)}|${dk}`;
                if (unresolved.has(uKey)) continue;
                unresolved.add(uKey);
                const alt = scanAlternateWeekendDates({
                    personName: base,
                    groupNum: g,
                    sortedWeekends,
                    calcStartKey,
                    calcEndKey,
                    assignedWeekendInMonth: assignedWeekendInMonthPreview?.[monthKey]?.[g] || null,
                    simulatedSpecialMonthSet: simulatedSpecialAssignments?.[monthKey]?.[g] || null
                });
                recordAbsentPlacement({
                    groupNum: g,
                    personName: base,
                    missedOnDateKey: dk,
                    status: 'unresolved',
                    reasonCode: 'RETURN_NEVER_PLANNED',
                    message:
                        'Ήταν baseline (απουσία) αυτή την ημέρα αλλά δεν δημιουργήθηκε στόχος return-from-missing — δεν θα ανατεθεί αλλού αυτόματα.',
                    alternateDateScan: alt
                });
            }
        }
        for (const row of state.absentPlacements) {
            if (row.status !== 'planned' || !row.targetDateKey) continue;
            const tgt = returnFromMissingWeekendTargets?.[row.targetDateKey]?.[row.groupNum];
            if (!tgt || normPerson(tgt.personName) !== normPerson(row.personName)) {
                row.status = 'failed';
                row.reasonCode = row.reasonCode || 'RETURN_TARGET_BUSY';
                row.message =
                    (row.message || '') +
                    ' Ο στόχος ΣΚ δεν δεσμεύτηκε τελικά (πιθανή σύγκρουση slot).';
            }
        }
    }

    function dayKindLabel(date) {
        if (!date || isNaN(date.getTime())) return 'ΣΚ/αργία';
        if (typeof isSpecialHoliday === 'function' && isSpecialHoliday(date)) return 'ειδική (εκτός scope)';
        const dow = date.getDay();
        if (dow === 0) return 'Κυριακή';
        if (dow === 6) return 'Σάββατο';
        return 'Δημόσια αργία';
    }

    function getCandidateRejectionReasons(candidate, ctx) {
        const reasons = [];
        if (!candidate) {
            reasons.push('NOT_IN_WEEKEND_LIST');
            return reasons;
        }
        const {
            groupNum,
            date,
            dateKey,
            monthKey,
            groupPeople,
            assignedWeekendInMonth,
            simulatedSpecialMonthSet,
            assignedPeoplePreviewWeekend,
            reservedReturnFromMissing
        } = ctx;

        if (Array.isArray(groupPeople) && groupPeople.length && !groupPeople.includes(candidate)) {
            reasons.push('NOT_IN_WEEKEND_LIST');
        }
        if (typeof isPersonMissingOnDate === 'function' && isPersonMissingOnDate(candidate, groupNum, date, 'weekend')) {
            reasons.push('MISSING_ON_DATE');
        } else if (
            typeof isPersonDisabledForDuty === 'function' &&
            isPersonDisabledForDuty(candidate, groupNum, 'weekend', date)
        ) {
            reasons.push('DISABLED_FOR_DUTY');
        }
        if (simulatedSpecialMonthSet && simulatedSpecialMonthSet.has(candidate)) {
            reasons.push('HAS_SPECIAL_SAME_MONTH');
        }
        if (assignedWeekendInMonth && assignedWeekendInMonth.has(candidate)) {
            reasons.push('ALREADY_ASSIGNED_WEEKEND_MONTH');
        }
        if (assignedPeoplePreviewWeekend && assignedPeoplePreviewWeekend[candidate]) {
            const lastKey = assignedPeoplePreviewWeekend[candidate];
            const lastDate = new Date(lastKey + 'T00:00:00');
            const currentDate = new Date(dateKey + 'T00:00:00');
            const daysDiff = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
            if (daysDiff <= 5 && daysDiff > 0) reasons.push('WEEKEND_5_DAY_GAP');
        }
        if (reservedReturnFromMissing && reservedReturnFromMissing.has(candidate)) {
            reasons.push('RETURN_FROM_MISSING_ALREADY');
        }
        return reasons;
    }

    function scanRotationCandidates(ctx) {
        const {
            groupPeople,
            startIndex,
            maxOffset,
            includeStartOffset = 1
        } = ctx;
        const rows = [];
        const len = groupPeople.length;
        if (!len) return rows;
        const start = startIndex >= 0 ? startIndex : 0;
        const limit = maxOffset != null ? maxOffset : len;
        for (let offset = includeStartOffset; offset < limit; offset++) {
            const idx = (start + offset) % len;
            const candidate = groupPeople[idx];
            const rejections = getCandidateRejectionReasons(candidate, ctx);
            rows.push({
                candidate,
                index: idx,
                offset,
                accepted: rejections.length === 0,
                reasonCodes: rejections.length ? rejections : ['ACCEPTED']
            });
        }
        return rows;
    }

    function scanSwapPartners(ctx) {
        const {
            dateKey,
            monthKey,
            groupNum,
            date,
            currentPerson,
            sortedWeekends,
            updatedAssignments
        } = ctx;
        const rows = [];
        if (!sortedWeekends || !date) return rows;
        for (const otherDateKey of sortedWeekends) {
            if (otherDateKey === dateKey) continue;
            const otherDate = new Date(otherDateKey + 'T00:00:00');
            const otherMonthKey =
                typeof getMonthKeyFromDate === 'function'
                    ? getMonthKeyFromDate(otherDate)
                    : `${otherDate.getFullYear()}-${String(otherDate.getMonth() + 1).padStart(2, '0')}`;
            if (otherMonthKey !== monthKey) continue;
            const personOnOther = updatedAssignments?.[otherDateKey]?.[groupNum];
            const row = { otherDateKey, personOnOther, accepted: false, reasonCodes: [] };
            if (!personOnOther || personOnOther === currentPerson) {
                row.reasonCodes.push('SWAP_NO_OTHER_DATE');
            } else if (
                typeof isPersonMissingOnDate === 'function' &&
                isPersonMissingOnDate(personOnOther, groupNum, date, 'weekend')
            ) {
                row.reasonCodes.push('SWAP_PARTNER_MISSING_HERE');
            } else if (
                typeof isPersonMissingOnDate === 'function' &&
                isPersonMissingOnDate(currentPerson, groupNum, otherDate, 'weekend')
            ) {
                row.reasonCodes.push('SWAP_SELF_MISSING_THERE');
            } else {
                row.accepted = true;
                row.reasonCodes.push('ACCEPTED');
            }
            rows.push(row);
        }
        if (!rows.length) rows.push({ otherDateKey: null, personOnOther: null, accepted: false, reasonCodes: ['SWAP_NO_OTHER_DATE'] });
        return rows;
    }

    function startSlot(stage, dateKey, groupNum, meta) {
        if (!isEnabled()) return;
        if (!matchesFilter(dateKey, groupNum, meta?.baseline || meta?.rotationPerson)) return;
        state.currentSlot = {
            stage,
            dateKey,
            groupNum,
            meta: meta || {},
            steps: [],
            candidates: [],
            swapPartners: []
        };
    }

    function logStep(step, message, data) {
        if (!isEnabled() || !state.currentSlot) return;
        state.currentSlot.steps.push({ step, message, data: data || null, t: Date.now() });
    }

    function recordCandidateScan(phase, ctx, picked) {
        if (!isEnabled() || !state.currentSlot) return;
        const rows = scanRotationCandidates(ctx);
        state.currentSlot.candidates.push({ phase, picked: picked || null, rows });
    }

    function recordSwapScan(phase, ctx, picked) {
        if (!isEnabled() || !state.currentSlot) return;
        const rows = scanSwapPartners(ctx);
        state.currentSlot.swapPartners.push({ phase, picked: picked || null, rows });
    }

    function endSlot(outcome) {
        if (!isEnabled() || !state.currentSlot) return;
        const slot = state.currentSlot;
        const oc = outcome || {};
        const skipped = oc.skippedPerson || slot.meta?.rotationPerson;
        if (skipped) {
            const plan = findPlanForPerson(slot.groupNum, skipped);
            if (plan) {
                oc.absentPersonPlan = {
                    personName: plan.personName,
                    targetDateKey: plan.targetDateKey,
                    status: plan.status,
                    reasonCode: plan.reasonCode,
                    message: plan.message,
                    isBackwardAssignment: plan.isBackwardAssignment
                };
            }
        }
        slot.outcome = oc;
        state.entries.push(slot);
        state.currentSlot = null;
    }

    function clear() {
        state.entries = [];
        state.absentPlacements = [];
        state.absentByKey = {};
        state.currentSlot = null;
    }

    function setEnabled(on) {
        state.enabled = !!on;
        try {
            if (on) localStorage.setItem(STORAGE_KEY, '1');
            else localStorage.removeItem(STORAGE_KEY);
        } catch (_) {}
    }

    function readFilterFromDom() {
        const dk = document.getElementById('dutyWeekendDebugFilterDate');
        const gn = document.getElementById('dutyWeekendDebugFilterGroup');
        const pn = document.getElementById('dutyWeekendDebugFilterPerson');
        state.filter = {
            dateKey: dk && dk.value ? dk.value.trim() : null,
            groupNum: gn && gn.value ? parseInt(gn.value, 10) : null,
            personName: pn && pn.value ? pn.value.trim() : null
        };
    }

    function reasonLabels(codes) {
        return (codes || []).map((c) => REASON_LABELS[c] || c).join('; ');
    }

    function renderAbsentPlacementsSection() {
        const f = state.filter || {};
        const rows = state.absentPlacements.filter((p) => {
            if (f.groupNum != null && Number(p.groupNum) !== Number(f.groupNum)) return false;
            if (f.personName && normPerson(p.personName) !== normPerson(f.personName)) return false;
            if (f.dateKey) {
                const dk = f.dateKey;
                const hit =
                    p.targetDateKey === dk ||
                    (p.missedOnDateKeys || []).includes(dk) ||
                    p.missedOnDateKey === dk;
                if (!hit) return false;
            }
            return true;
        });
        if (!rows.length) {
            return '<p class="text-muted small mb-3">Δεν υπάρχουν καταχωρήσεις απούντων (return-from-missing / απλή απουσία).</p>';
        }
        let html =
            '<h6 class="mb-2"><i class="fas fa-user-clock me-1"></i>Απόντες — ανάθεση σε άλλο ΣΚ / δημόσια αργία</h6>';
        html +=
            '<p class="small text-muted">Εδώ φαίνεται <strong>πού προγραμματίστηκε</strong> να πάει ο απόντας (όχι μόνο ποιος τον αντικατέστησε την ημέρα της απουσίας).</p>';
        html +=
            '<div class="table-responsive mb-4"><table class="table table-sm table-bordered"><thead class="table-warning"><tr>';
        html +=
            '<th>Άτομο</th><th>Ομ.</th><th>Απουσία</th><th>Χάθηκε ΣΚ</th><th>Αντικ. εκεί</th><th>Στόχος ΣΚ</th><th>Κατάσταση</th><th>Λόγος</th></tr></thead><tbody>';
        rows.forEach((p) => {
            const missed = (p.missedOnDateKeys && p.missedOnDateKeys.length
                ? p.missedOnDateKeys.join(', ')
                : p.missedOnDateKey) || '—';
            const stClass =
                p.status === 'applied' || p.status === 'planned'
                    ? 'table-success'
                    : p.status === 'failed' || p.status === 'unresolved'
                      ? 'table-danger'
                      : '';
            html += `<tr class="${stClass}">`;
            html += `<td>${escapeHtml(p.personName)}</td><td>${p.groupNum}</td>`;
            html += `<td>${escapeHtml(p.missingRangeStr || p.absenceEndKey || '—')}</td>`;
            html += `<td><small>${escapeHtml(missed)}</small></td>`;
            html += `<td>${escapeHtml(p.replacementOnMissedDate || '—')}</td>`;
            html += `<td>${escapeHtml(p.targetDateKey || '—')}${p.isBackwardAssignment ? ' <span class="badge bg-secondary">πίσω</span>' : ''}</td>`;
            html += `<td>${escapeHtml(p.status || '—')}</td>`;
            html += `<td><small>${escapeHtml(reasonLabels([p.reasonCode]))}${p.message ? '<br>' + escapeHtml(p.message) : ''}</small></td>`;
            html += '</tr>';
            if (p.alternateDateScan && p.alternateDateScan.length) {
                html += `<tr><td colspan="8" class="bg-light"><small><strong>Άλλες ημέρες ΣΚ στην περίοδο:</strong></small>`;
                html +=
                    '<table class="table table-sm mb-0 mt-1"><thead><tr><th>Ημερομηνία</th><th>Θα μπορούσε;</th></tr></thead><tbody>';
                p.alternateDateScan.forEach((a) => {
                    html += `<tr class="${a.accepted ? 'table-success' : ''}"><td>${escapeHtml(a.dateKey)}</td><td>${escapeHtml(reasonLabels(a.reasonCodes))}</td></tr>`;
                });
                html += '</tbody></table></td></tr>';
            }
        });
        html += '</tbody></table></div>';
        return html;
    }

    function renderPanel() {
        readFilterFromDom();
        const entries = state.entries.filter((e) => matchesFilter(e.dateKey, e.groupNum, e.meta?.baseline));
        let body = renderAbsentPlacementsSection();
        if (!entries.length && !state.absentPlacements.length) {
            body =
                '<p class="text-muted mb-0">Δεν υπάρχουν εγγραφές (ενεργοποιήστε debug, τρέξτε Βήμα 2 και πατήστε Επόμενο για skip logic).</p>';
        } else if (!entries.length) {
            body += '<p class="text-muted small">Δεν υπάρχουν εγγραφές ανά ημέρα/ομάδα — δείτε πίνακα απούντων πάνω.</p>';
        }
        if (entries.length) {
            body += '<hr class="my-3"><h6 class="mb-2">Ανά ημέρα και ομάδα</h6>';
            body += '<div class="accordion" id="dutyWeekendDebugAccordion">';
            entries.forEach((entry, i) => {
                const date = new Date(entry.dateKey + 'T00:00:00');
                const dateStr = isNaN(date.getTime())
                    ? entry.dateKey
                    : date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const kind = dayKindLabel(date);
                const oc = entry.outcome || {};
                const finalP = oc.finalPerson != null ? oc.finalPerson : '—';
                const empty = oc.emptyReason ? `<span class="badge bg-danger ms-2">${escapeHtml(reasonLabels([oc.emptyReason]))}</span>` : '';
                body += `<div class="accordion-item">
                    <h2 class="accordion-header">
                        <button class="accordion-button ${i > 0 ? 'collapsed' : ''}" type="button" data-bs-toggle="collapse" data-bs-target="#dutyWkdDbg${i}">
                            ${escapeHtml(dateStr)} · Ομάδα ${entry.groupNum} · ${escapeHtml(kind)} · ${escapeHtml(entry.stage)} ${empty}
                        </button>
                    </h2>
                    <div id="dutyWkdDbg${i}" class="accordion-collapse collapse ${i === 0 ? 'show' : ''}" data-bs-parent="#dutyWeekendDebugAccordion">
                        <div class="accordion-body small">`;
                const m = entry.meta || {};
                body += `<p><strong>Baseline σειράς:</strong> ${escapeHtml(m.rotationPerson || m.baseline || '—')}
                    · <strong>Αντικαταστάτης εδώ:</strong> ${escapeHtml(oc.replacementOnDate || (finalP && finalP !== (m.rotationPerson || '') ? String(finalP) : '—'))}
                    · <strong>Τελική ανάθεση:</strong> ${escapeHtml(String(finalP))}</p>`;
                if (oc.absentPersonPlan) {
                    const ap = oc.absentPersonPlan;
                    body += `<div class="alert alert-info py-2 mb-2"><strong>Απόντας (${escapeHtml(ap.personName)}):</strong> `;
                    if (ap.targetDateKey) {
                        body += `προγραμματίστηκε για ΣΚ/αργία <code>${escapeHtml(ap.targetDateKey)}</code> `;
                        body += `(<em>${escapeHtml(ap.status)}</em>) — ${escapeHtml(reasonLabels([ap.reasonCode]))}`;
                        if (ap.message) body += `<br><small>${escapeHtml(ap.message)}</small>`;
                    } else {
                        body += `δεν προγραμματίστηκε αλλού — ${escapeHtml(reasonLabels([ap.reasonCode]))}`;
                    }
                    body += '</div>';
                } else if (oc.skippedPerson && oc.emptyReason) {
                    body += `<div class="alert alert-danger py-2 mb-2"><strong>Απόντας ${escapeHtml(oc.skippedPerson)}:</strong> δεν ανατέθηκε αλλού· ${escapeHtml(reasonLabels([oc.emptyReason]))}</div>`;
                }
                if (oc.swapAbsentToDateKey) {
                    body += `<p class="mb-2"><strong>Ανταλλαγή:</strong> ο απόντας <code>${escapeHtml(oc.skippedPerson)}</code> μεταφέρεται στην <code>${escapeHtml(oc.swapAbsentToDateKey)}</code>.</p>`;
                }
                if (entry.steps.length) {
                    body += '<p class="mb-1"><strong>Βήματα</strong></p><ul class="mb-2">';
                    entry.steps.forEach((s) => {
                        body += `<li><code>${escapeHtml(s.step)}</code> — ${escapeHtml(s.message)}</li>`;
                    });
                    body += '</ul>';
                }
                entry.swapPartners.forEach((sp) => {
                    body += `<p class="mb-1"><strong>Ανταλλαγή ημερομηνίας (${escapeHtml(sp.phase)})</strong>${sp.picked ? ` → ${escapeHtml(sp.picked)}` : ''}</p>`;
                    body += '<table class="table table-sm table-bordered mb-2"><thead><tr><th>Άλλη ημέρα</th><th>Άτομο εκεί</th><th>Αποτέλεσμα</th></tr></thead><tbody>';
                    sp.rows.forEach((r) => {
                        body += `<tr class="${r.accepted ? 'table-success' : ''}"><td>${escapeHtml(r.otherDateKey || '—')}</td><td>${escapeHtml(r.personOnOther || '—')}</td><td>${escapeHtml(reasonLabels(r.reasonCodes))}</td></tr>`;
                    });
                    body += '</tbody></table>';
                });
                entry.candidates.forEach((cs) => {
                    body += `<p class="mb-1"><strong>Σάρωση σειράς (${escapeHtml(cs.phase)})</strong>${cs.picked ? ` → επιλογή: <strong>${escapeHtml(cs.picked)}</strong>` : ' → κανένας'}</p>`;
                    body += '<table class="table table-sm table-bordered mb-2"><thead><tr><th>#</th><th>Άτομο</th><th>Αποτέλεσμα</th></tr></thead><tbody>';
                    cs.rows.forEach((r) => {
                        body += `<tr class="${r.accepted ? 'table-success' : ''}"><td>${r.offset}</td><td>${escapeHtml(r.candidate || '—')}</td><td>${escapeHtml(reasonLabels(r.reasonCodes))}</td></tr>`;
                    });
                    body += '</tbody></table>';
                });
                body += '</div></div></div>';
            });
            body += '</div>';
        }

        const modalId = 'dutyWeekendDebugModal';
        let el = document.getElementById(modalId);
        if (!el) {
            document.body.insertAdjacentHTML(
                'beforeend',
                `<div class="modal fade" id="${modalId}" tabindex="-1">
                    <div class="modal-dialog modal-xl modal-dialog-scrollable">
                        <div class="modal-content">
                            <div class="modal-header bg-warning-subtle">
                                <h5 class="modal-title"><i class="fas fa-bug me-2"></i>Debug ΣΚ &amp; δημόσιες αργίες</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body" id="dutyWeekendDebugModalBody"></div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-outline-secondary btn-sm" id="dutyWeekendDebugExportBtn">Εξαγωγή JSON</button>
                                <button type="button" class="btn btn-outline-danger btn-sm" id="dutyWeekendDebugClearBtn">Καθαρισμός</button>
                                <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Κλείσιμο</button>
                            </div>
                        </div>
                    </div>
                </div>`
            );
            el = document.getElementById(modalId);
            document.getElementById('dutyWeekendDebugExportBtn').addEventListener('click', () => {
                const blob = new Blob(
                    [JSON.stringify({ absentPlacements: state.absentPlacements, slots: state.entries }, null, 2)],
                    { type: 'application/json' }
                );
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `duty-weekend-debug-${Date.now()}.json`;
                a.click();
            });
            document.getElementById('dutyWeekendDebugClearBtn').addEventListener('click', () => {
                clear();
                renderPanel();
            });
        }
        document.getElementById('dutyWeekendDebugModalBody').innerHTML =
            `<div class="row g-2 mb-3">
                <div class="col-md-4"><label class="form-label small">Ημερομηνία (YYYY-MM-DD)</label>
                <input type="text" class="form-control form-control-sm" id="dutyWeekendDebugFilterDate" placeholder="π.χ. 2026-03-15"></div>
                <div class="col-md-2"><label class="form-label small">Ομάδα</label>
                <input type="number" min="1" max="4" class="form-control form-control-sm" id="dutyWeekendDebugFilterGroup"></div>
                <div class="col-md-4"><label class="form-label small">Όνομα απούντα</label>
                <input type="text" class="form-control form-control-sm" id="dutyWeekendDebugFilterPerson"></div>
                <div class="col-md-2 d-flex align-items-end">
                <button type="button" class="btn btn-primary btn-sm w-100" id="dutyWeekendDebugRefilterBtn">Φίλτρο</button></div>
            </div>` +
            body;
        const f = state.filter;
        if (f.dateKey) document.getElementById('dutyWeekendDebugFilterDate').value = f.dateKey;
        if (f.groupNum != null) document.getElementById('dutyWeekendDebugFilterGroup').value = f.groupNum;
        if (f.personName) document.getElementById('dutyWeekendDebugFilterPerson').value = f.personName;
        document.getElementById('dutyWeekendDebugRefilterBtn').onclick = () => renderPanel();

        bootstrap.Modal.getOrCreateInstance(el).show();
    }

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function getDebugToolbarHtml() {
        const checked = isEnabled() ? ' checked' : '';
        return `<div class="card border-warning mb-3 duty-weekend-debug-toolbar">
            <div class="card-body py-2">
                <div class="d-flex flex-wrap align-items-center gap-3">
                    <div class="form-check mb-0">
                        <input class="form-check-input" type="checkbox" id="dutyWeekendDebugCheckbox"${checked}>
                        <label class="form-check-label" for="dutyWeekendDebugCheckbox">
                            <i class="fas fa-bug me-1"></i>Αναλυτικό debug (μόνο ΣΚ &amp; δημόσιες αργίες)
                        </label>
                    </div>
                    <button type="button" class="btn btn-outline-warning btn-sm" id="dutyWeekendDebugViewBtn">
                        <i class="fas fa-list me-1"></i>Προβολή log
                    </button>
                    <span class="text-muted small">Καταγράφει αντικαταστάτη την ημέρα της απουσίας <strong>και</strong> πού (αν) ανατίθεται ο απόντας σε άλλο ΣΚ/αργία. Δεν αφορά ειδικές αργίες.</span>
                </div>
            </div>
        </div>`;
    }

    function wireToolbar() {
        const cb = document.getElementById('dutyWeekendDebugCheckbox');
        const btn = document.getElementById('dutyWeekendDebugViewBtn');
        if (cb) {
            cb.checked = isEnabled();
            cb.onchange = () => {
                setEnabled(cb.checked);
                if (cb.checked) clear();
            };
        }
        if (btn) btn.onclick = () => renderPanel();
    }

    window.dutyWeekendDebug = {
        isEnabled,
        setEnabled,
        clear,
        startSlot,
        logStep,
        recordCandidateScan,
        recordSwapScan,
        endSlot,
        recordAbsentPlacement,
        noteMissedWeekendForAbsent,
        refreshAbsentReplacementsFromPreview,
        finalizeMissedWeekendAbsences,
        findPlanForPerson,
        scanAlternateWeekendDates,
        getCandidateRejectionReasons,
        scanRotationCandidates,
        scanSwapPartners,
        reasonLabels,
        REASON_LABELS,
        renderPanel,
        getDebugToolbarHtml,
        wireToolbar,
        get entries() {
            return state.entries;
        },
        get absentPlacements() {
            return state.absentPlacements;
        }
    };
})();
