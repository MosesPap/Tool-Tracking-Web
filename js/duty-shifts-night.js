// ============================================================================
// DUTY-SHIFTS-NIGHT.JS — Νυχτερινές υπηρεσίες (ομάδες 3 & 4, καθημερινές Πέμπτες)
// ============================================================================

(function () {
    const NIGHT_GROUPS = [3, 4];

    function normPerson(s) {
        return typeof normalizePersonKey === 'function' ? normalizePersonKey(s) : String(s || '').trim();
    }

    function getSortedNightDays(dayTypeLists) {
        const lists = dayTypeLists || {};
        const raw = lists.night && lists.night.length
            ? lists.night
            : (lists.normal || []).filter((dk) => typeof isNightThursdayDateKey === 'function' && isNightThursdayDateKey(dk));
        return [...raw].sort();
    }

    /** monthKey -> groupNum -> Set(personName) με ημιαργία Πέμπτη στον μήνα */
    function buildPersonsWithSemiThursdayByMonth(semiAssignments, sortedSemi) {
        const out = {};
        for (const dateKey of sortedSemi || []) {
            const d = new Date(dateKey + 'T00:00:00');
            if (isNaN(d.getTime()) || d.getDay() !== 4) continue;
            const monthKey = getMonthKeyFromDate(d);
            const gmap = semiAssignments?.[dateKey];
            if (!gmap || typeof gmap !== 'object') continue;
            for (const groupNum of NIGHT_GROUPS) {
                const p = gmap[groupNum] || gmap[String(groupNum)];
                if (!p) continue;
                if (!out[monthKey]) out[monthKey] = {};
                if (!out[monthKey][groupNum]) out[monthKey][groupNum] = new Set();
                out[monthKey][groupNum].add(p);
            }
        }
        return out;
    }

    function personHasSemiThursdayInMonth(personName, groupNum, monthKey, semiByMonth) {
        const set = semiByMonth?.[monthKey]?.[groupNum];
        if (!set) return false;
        const target = normPerson(personName);
        for (const p of set) {
            if (normPerson(p) === target) return true;
        }
        return false;
    }

    function loadSimulatedContextForNight() {
        const dayTypeLists = calculationSteps.dayTypeLists || {};
        const specialHolidays = dayTypeLists.special || [];
        const weekendHolidays = dayTypeLists.weekend || [];
        const semiDays = dayTypeLists.semi || [];

        const simulatedSpecial = {};
        (specialHolidays || []).forEach((dateKey) => {
            const date = new Date(dateKey + 'T00:00:00');
            const monthKey = getMonthKeyFromDate(date);
            if (!simulatedSpecial[monthKey]) simulatedSpecial[monthKey] = {};
            const gmap = extractGroupAssignmentsMap(specialHolidayAssignments?.[dateKey]) ||
                calculationSteps.tempSpecialAssignments?.[dateKey];
            if (!gmap) return;
            for (let g = 1; g <= 4; g++) {
                if (!gmap[g]) continue;
                if (!simulatedSpecial[monthKey][g]) simulatedSpecial[monthKey][g] = new Set();
                simulatedSpecial[monthKey][g].add(gmap[g]);
            }
        });

        const simulatedWeekend = {};
        const finalWeekend = calculationSteps.finalWeekendAssignments || {};
        for (const dateKey of Object.keys(finalWeekend)) {
            simulatedWeekend[dateKey] = { ...finalWeekend[dateKey] };
        }
        for (const dateKey of weekendHolidays) {
            if (simulatedWeekend[dateKey]) continue;
            const gmap = extractGroupAssignmentsMap(weekendAssignments?.[dateKey]);
            if (gmap) simulatedWeekend[dateKey] = { ...gmap };
        }

        const simulatedSemi = {};
        const finalSemi = calculationSteps.finalSemiAssignments || {};
        for (const dateKey of Object.keys(finalSemi)) {
            simulatedSemi[dateKey] = { ...finalSemi[dateKey] };
        }
        for (const dateKey of semiDays) {
            if (simulatedSemi[dateKey]) continue;
            const raw = semiNormalAssignments?.[dateKey];
            const gmap = extractGroupAssignmentsMap(raw);
            if (gmap) simulatedSemi[dateKey] = { ...gmap };
        }

        return { simulatedSpecial, simulatedWeekend, simulatedSemi };
    }

    function initNightRotationIndex(groupNum, date, groupPeople) {
        const rotationDays = groupPeople.length;
        if (rotationDays === 0) return 0;
        const lastPersonName =
            typeof getRotationSeedPersonForMonthStart === 'function'
                ? getRotationSeedPersonForMonthStart('night', date, groupNum)
                : getLastRotationPersonForDate('night', date, groupNum);
        const lastIdx = groupPeople.indexOf(lastPersonName);
        if (lastPersonName && lastIdx >= 0) return (lastIdx + 1) % rotationDays;
        return 0;
    }

    function pickNightAssignee(groupPeople, startIdx, groupNum, date, monthKey, semiByMonth) {
        const rotationDays = groupPeople.length;
        if (!rotationDays) return { person: null, nextIdx: startIdx };
        for (let off = 0; off < rotationDays; off++) {
            const idx = (startIdx + off) % rotationDays;
            const cand = groupPeople[idx];
            if (!cand) continue;
            if (personHasSemiThursdayInMonth(cand, groupNum, monthKey, semiByMonth)) continue;
            if (typeof isPersonMissingOnDate === 'function' && isPersonMissingOnDate(cand, groupNum, date, 'normal')) continue;
            return { person: cand, nextIdx: (idx + 1) % rotationDays };
        }
        return { person: null, nextIdx: (startIdx + 1) % rotationDays };
    }

    function buildNightAssignmentsPreview() {
        const dayTypeLists = calculationSteps.dayTypeLists || {};
        const sortedNight = getSortedNightDays(dayTypeLists);
        const sortedSemi = [...(dayTypeLists.semi || [])].sort();
        const ctx = loadSimulatedContextForNight();
        const semiByMonth = buildPersonsWithSemiThursdayByMonth(
            calculationSteps.finalSemiAssignments || {},
            sortedSemi
        );

        const baseline = {};
        const finalAssignments = {};
        const globalNightRotation = {};

        if (typeof seedPreservedDutyAssignmentsIntoTemp === 'function') {
            seedPreservedDutyAssignmentsIntoTemp(finalAssignments, nightAssignments, sortedNight);
        }

        for (const dateKey of sortedNight) {
            const date = new Date(dateKey + 'T00:00:00');
            if (isNaN(date.getTime())) continue;
            const monthKey = getMonthKeyFromDate(date);

            for (const groupNum of NIGHT_GROUPS) {
                if (typeof shouldRecalculateDutyGroup === 'function' && !shouldRecalculateDutyGroup(groupNum)) {
                    const preserved = extractGroupAssignmentsMap(nightAssignments?.[dateKey])?.[groupNum];
                    if (preserved) {
                        if (!finalAssignments[dateKey]) finalAssignments[dateKey] = {};
                        finalAssignments[dateKey][groupNum] = preserved;
                    }
                    continue;
                }

                const groupData =
                    (typeof groupsForDuty === 'function' ? groupsForDuty(groupNum, dateKey) : groups[groupNum]) || {};
                const groupPeople =
                    typeof getSortedGroupListForRotation === 'function'
                        ? getSortedGroupListForRotation(groupNum, 'night')
                        : groupData.night || [];
                if (!groupPeople.length) continue;

                if (globalNightRotation[groupNum] === undefined) {
                    globalNightRotation[groupNum] = initNightRotationIndex(groupNum, date, groupPeople);
                }

                const startIdx = globalNightRotation[groupNum] % groupPeople.length;
                const picked = pickNightAssignee(groupPeople, startIdx, groupNum, date, monthKey, semiByMonth);
                globalNightRotation[groupNum] = picked.nextIdx;

                if (!baseline[dateKey]) baseline[dateKey] = {};
                baseline[dateKey][groupNum] = picked.person || null;

                if (picked.person) {
                    if (!finalAssignments[dateKey]) finalAssignments[dateKey] = {};
                    finalAssignments[dateKey][groupNum] = picked.person;
                }
            }
        }

        return {
            sortedNight,
            baseline,
            finalAssignments,
            globalNightRotation,
            semiByMonth,
            ...ctx
        };
    }

    function tryNightThursdaySwapCandidate(dateKey, candidateKey, groupNum, currentPerson, assignments, simulated) {
        if (!candidateKey || candidateKey === dateKey) return null;
        if (typeof isNightThursdayDateKey !== 'function' || !isNightThursdayDateKey(candidateKey)) return null;
        const d = new Date(candidateKey + 'T00:00:00');
        if (isNaN(d.getTime()) || getDayType(d) !== 'normal-day') return null;

        const swapCandidate = assignments[candidateKey]?.[groupNum];
        if (!swapCandidate) return null;
        if (typeof isPersonMissingOnDate === 'function' && isPersonMissingOnDate(swapCandidate, groupNum, d, 'normal')) return null;
        if (typeof hasConsecutiveDuty === 'function') {
            if (hasConsecutiveDuty(candidateKey, swapCandidate, groupNum, simulated)) return null;
            if (hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulated)) return null;
            if (hasConsecutiveDuty(candidateKey, currentPerson, groupNum, simulated)) return null;
            if (hasConsecutiveDuty(dateKey, currentPerson, groupNum, simulated)) return null;
        }
        return { swapCandidate, candidateKey };
    }

    function runNightConflictSwaps(preview) {
        const { sortedNight, finalAssignments, simulatedSpecial, simulatedWeekend, simulatedSemi } = preview;
        const swappedPeopleSet = new Set();
        const swappedPeople = [];

        const normalForSim = {};
        const fn = calculationSteps.finalNormalAssignments || calculationSteps.tempNormalAssignments || {};
        for (const dk of Object.keys(fn)) {
            if (fn[dk] && typeof fn[dk] === 'object') normalForSim[dk] = { ...fn[dk] };
        }
        for (const nightKey of sortedNight) {
            const wed = new Date(nightKey + 'T00:00:00');
            if (isNaN(wed.getTime())) continue;
            wed.setDate(wed.getDate() - 1);
            const wedKey = typeof formatDateKey === 'function' ? formatDateKey(wed) : null;
            if (!wedKey || normalForSim[wedKey]) continue;
            const gmap =
                typeof extractGroupAssignmentsMap === 'function'
                    ? extractGroupAssignmentsMap(normalDayAssignments?.[wedKey])
                    : null;
            if (gmap) normalForSim[wedKey] = { ...gmap };
        }

        const simulated = {
            special: simulatedSpecial,
            weekend: simulatedWeekend,
            semi: simulatedSemi,
            normal: normalForSim,
            night: finalAssignments
        };

        for (const dateKey of sortedNight) {
            if (typeof setDutyCalcContextDateKey === 'function') setDutyCalcContextDateKey(dateKey);
            const date = new Date(dateKey + 'T00:00:00');
            const month = date.getMonth();
            const year = date.getFullYear();

            for (const groupNum of NIGHT_GROUPS) {
                if (typeof shouldRecalculateDutyGroup === 'function' && !shouldRecalculateDutyGroup(groupNum)) continue;
                const currentPerson = finalAssignments[dateKey]?.[groupNum];
                if (!currentPerson) continue;

                const swapKey = `${dateKey}:${groupNum}:${currentPerson}`;
                if (swappedPeopleSet.has(swapKey)) continue;

                if (typeof hasConsecutiveDuty !== 'function') continue;
                const hasConflict = hasConsecutiveDuty(dateKey, currentPerson, groupNum, simulated);
                if (!hasConflict) continue;

                let swapFound = false;
                let swapDayKey = null;
                let swapCandidate = null;

                for (const candidateKey of sortedNight) {
                    if (candidateKey === dateKey) continue;
                    const cd = new Date(candidateKey + 'T00:00:00');
                    if (cd.getMonth() !== month || cd.getFullYear() !== year) continue;
                    const result = tryNightThursdaySwapCandidate(
                        dateKey,
                        candidateKey,
                        groupNum,
                        currentPerson,
                        finalAssignments,
                        simulated
                    );
                    if (result) {
                        swapDayKey = result.candidateKey;
                        swapCandidate = result.swapCandidate;
                        swapFound = true;
                        break;
                    }
                }

                if (!swapFound || !swapDayKey || !swapCandidate) continue;

                if (!finalAssignments[dateKey]) finalAssignments[dateKey] = {};
                if (!finalAssignments[swapDayKey]) finalAssignments[swapDayKey] = {};
                finalAssignments[dateKey][groupNum] = swapCandidate;
                finalAssignments[swapDayKey][groupNum] = currentPerson;

                const reason = `Ανταλλαγή νυχτερινής Πέμπτης λόγω σύγκρουσης με άλλη υπηρεσία.`;
                if (typeof storeAssignmentReason === 'function') {
                    storeAssignmentReason(dateKey, groupNum, swapCandidate, 'swap', reason, currentPerson);
                    storeAssignmentReason(swapDayKey, groupNum, currentPerson, 'swap', reason, swapCandidate);
                }

                swappedPeopleSet.add(`${dateKey}:${groupNum}:${currentPerson}`);
                swappedPeopleSet.add(`${swapDayKey}:${groupNum}:${swapCandidate}`);
                swappedPeople.push({
                    date: dateKey,
                    groupNum,
                    skippedPerson: currentPerson,
                    swappedPerson: swapCandidate,
                    swapDate: swapDayKey
                });
            }
        }

        return swappedPeople;
    }

    async function renderStep4_Night() {
        const stepContent = document.getElementById('stepContent');
        if (!stepContent) return;

        stepContent.innerHTML =
            '<div class="alert alert-info"><i class="fas fa-spinner fa-spin me-2"></i>Υπολογισμός νυχτερινών (Πέμπτες)...</div>';

        const preview = buildNightAssignmentsPreview();
        const swappedPeople = runNightConflictSwaps(preview);
        const { sortedNight, baseline, finalAssignments } = preview;

        calculationSteps.tempNightBaselineAssignments = baseline;
        calculationSteps.tempNightAssignments = finalAssignments;
        calculationSteps.finalNightAssignments = finalAssignments;
        calculationSteps.previewNightSwaps = swappedPeople;

        const startDate = calculationSteps.startDate;
        const endDate = calculationSteps.endDate;
        const periodLabel = typeof buildPeriodLabel === 'function' ? buildPeriodLabel(startDate, endDate) : '';

        let html = '<div class="step-content">';
        html += `<h6 class="mb-3"><i class="fas fa-moon me-2"></i>Νυχτερινές — Περίοδος: ${periodLabel}</h6>`;
        html +=
            '<div class="alert alert-secondary small mb-3">Καθημερινές <strong>Πέμπτες</strong> για ομάδες 3 & 4. Άτομα με ημιαργία Πέμπτη στον μήνα παραλείπονται στη σειρά νυχτερινών.</div>';

        if (!sortedNight.length) {
            html += '<div class="alert alert-info">Δεν υπάρχουν καθημερινές Πέμπτες στην περίοδο.</div></div>';
            stepContent.innerHTML = html;
            return;
        }

        html += '<div class="table-responsive"><table class="table table-bordered table-sm"><thead><tr><th>Ημερομηνία</th><th>Ημέρα</th>';
        for (let g = 1; g <= 4; g++) {
            html += `<th>${typeof getGroupName === 'function' ? getGroupName(g) : 'Ομάδα ' + g}</th>`;
        }
        html += '</tr></thead><tbody>';

        for (const dateKey of sortedNight) {
            const d = new Date(dateKey + 'T00:00:00');
            const dateStr = d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const dayName = typeof getGreekDayName === 'function' ? getGreekDayName(d) : '';
            html += `<tr><td><strong>${dateStr}</strong></td><td>${dayName}</td>`;
            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                if (groupNum !== 3 && groupNum !== 4) {
                    html += '<td class="text-muted">—</td>';
                    continue;
                }
                const base = baseline[dateKey]?.[groupNum] || '-';
                const fin = finalAssignments[dateKey]?.[groupNum] || '-';
                const cell =
                    typeof buildBaselineComputedCellHtml === 'function'
                        ? buildBaselineComputedCellHtml(base, fin)
                        : `${base} → ${fin}`;
                html += `<td>${cell}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody></table></div></div>';
        stepContent.innerHTML = html;
    }

    async function saveStep4_Night() {
        const updatedAssignments = calculationSteps.finalNightAssignments || calculationSteps.tempNightAssignments || {};
        showNightSwapResults(calculationSteps.previewNightSwaps || [], updatedAssignments);
    }

    function showNightSwapResults(swappedPeople, updatedAssignments) {
        const changes = swappedPeople || [];
        let rowsHtml = '';
        if (!changes.length) {
            rowsHtml = '<tr><td colspan="5" class="text-muted">Δεν εντοπίστηκαν ανταλλαγές νυχτερινών.</td></tr>';
        } else {
            rowsHtml = changes
                .map((c) => {
                    const d1 = new Date(c.date + 'T00:00:00').toLocaleDateString('el-GR');
                    const d2 = new Date(c.swapDate + 'T00:00:00').toLocaleDateString('el-GR');
                    return `<tr><td>${d1}</td><td>Ομάδα ${c.groupNum}</td><td>${c.skippedPerson}</td><td>${c.swappedPerson}</td><td>${d2}</td></tr>`;
                })
                .join('');
        }

        const modalHtml = `
            <div class="modal fade" id="nightSwapResultsModal" tabindex="-1">
                <div class="modal-dialog modal-lg modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header py-2">
                            <h5 class="modal-title"><i class="fas fa-moon me-2"></i>Αποτελέσματα Νυχτερινών</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="table-responsive">
                                <table class="table table-sm table-bordered">
                                    <thead><tr><th>Ημερομηνία</th><th>Ομάδα</th><th>Πριν</th><th>Μετά</th><th>Ανταλλαγή με</th></tr></thead>
                                    <tbody>${rowsHtml}</tbody>
                                </table>
                            </div>
                        </div>
                        <div class="modal-footer py-2">
                            <button type="button" class="btn btn-primary" id="nightSwapOkButton">OK</button>
                        </div>
                    </div>
                </div>
            </div>`;

        const existing = document.getElementById('nightSwapResultsModal');
        if (existing) existing.remove();
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        const modal = new bootstrap.Modal(document.getElementById('nightSwapResultsModal'));
        modal.show();

        const okButton = document.getElementById('nightSwapOkButton');
        if (okButton) {
            okButton.addEventListener('click', async function () {
                okButton.disabled = true;
                if (typeof setStepFooterBusy === 'function') setStepFooterBusy(true);
                try {
                    await saveFinalNightAssignments(updatedAssignments);
                    calculationSteps.currentStep = 5;
                    if (typeof renderCurrentStep === 'function') renderCurrentStep();
                    const m = bootstrap.Modal.getInstance(document.getElementById('nightSwapResultsModal'));
                    if (m) m.hide();
                } finally {
                    if (typeof setStepFooterBusy === 'function') setStepFooterBusy(false);
                    okButton.disabled = false;
                }
            });
        }
    }

    async function saveFinalNightAssignments(updatedAssignments) {
        if (!window.db || !window.auth?.currentUser) return;
        const db = window.db;
        const user = window.auth.currentUser;

        const baseline = calculationSteps.tempNightBaselineAssignments || {};
        if (Object.keys(baseline).length > 0) {
            const formattedBaseline = formatNightAssignmentsToStringMap(baseline, [3, 4]);
            const organizedBaseline = organizeAssignmentsByMonth(formattedBaseline);
            await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'rotationBaselineNightAssignments', organizedBaseline);
            Object.assign(rotationBaselineNightAssignments, formattedBaseline);
        }

        if (Object.keys(updatedAssignments).length > 0) {
            const formattedFinal = formatNightAssignmentsToStringMap(updatedAssignments, [3, 4]);
            let merged = formattedFinal;
            if (typeof mergeFormattedAssignmentsWithExistingStore === 'function' && typeof getCalculationRecalcGroupSet === 'function') {
                const recalcSet = getCalculationRecalcGroupSet();
                if (recalcSet) {
                    merged = mergeFormattedAssignmentsWithExistingStore(formattedFinal, nightAssignments, recalcSet);
                }
            }
            const organized = organizeAssignmentsByMonth(merged);
            await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'nightAssignments', organized);
            Object.assign(nightAssignments, merged);

            const lastByMonth = {};
            for (const dateKey of Object.keys(updatedAssignments).sort()) {
                const d = new Date(dateKey + 'T00:00:00');
                if (isNaN(d.getTime())) continue;
                const monthKey = getMonthKeyFromDate(d);
                const gmap = updatedAssignments[dateKey];
                for (const groupNum of NIGHT_GROUPS) {
                    if (!gmap?.[groupNum]) continue;
                    if (!lastByMonth[monthKey]) lastByMonth[monthKey] = {};
                    lastByMonth[monthKey][groupNum] = gmap[groupNum];
                }
            }
            for (const monthKey of Object.keys(lastByMonth)) {
                for (const groupNum of NIGHT_GROUPS) {
                    if (lastByMonth[monthKey][groupNum] !== undefined) {
                        setLastRotationPersonForMonth('night', monthKey, groupNum, lastByMonth[monthKey][groupNum]);
                    }
                }
            }
            const sanitized = sanitizeForFirestore(lastRotationPositions);
            await db.collection('dutyShifts').doc('lastRotationPositions').set({
                ...sanitized,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                updatedBy: user.uid
            });
        }
    }

    /** Μορφοποίηση μόνο για συγκεκριμένες ομάδες (3 & 4). */
    function formatNightAssignmentsToStringMap(byDate, groupNums) {
        const allowed = new Set(groupNums || NIGHT_GROUPS);
        const out = {};
        for (const dateKey of Object.keys(byDate || {})) {
            const gmap = byDate[dateKey];
            if (!gmap) continue;
            const parts = [];
            for (const g of allowed) {
                if (gmap[g]) parts.push(`${gmap[g]} (Ομάδα ${g})`);
            }
            if (parts.length) out[dateKey] = parts.join(', ');
        }
        return out;
    }

    window.renderStep4_Night = renderStep4_Night;
    window.saveStep4_Night = saveStep4_Night;
})();
