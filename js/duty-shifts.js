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
        // Track critical assignments from last duties - these must NEVER be deleted
        // Format: { "2025-12-25": ["Person Name (Ομάδα 1)", ...], ... }
        let criticalAssignments = {};
        // Track cross-month swaps: when a person is swapped from one month to next
        // Structure: crossMonthSwaps[dateKey][groupNum] = personName
        // Example: crossMonthSwaps["2026-03-05"][1] = "Person A" means Person A must be assigned to March 5, Group 1
        let crossMonthSwaps = {};
        // Track last rotation positions (normal rotation, ignoring swaps) for each day type and group.
        //
        // NEW (month-scoped) structure:
        // lastRotationPositions[dayType][monthKey][groupNum] = personName
        // where monthKey = `${year}-${month}` with month 0-11 (same convention used elsewhere in this file).
        //
        // LEGACY (flat) structure is still supported for backward compatibility:
        // lastRotationPositions[dayType][groupNum] = personName
        let lastRotationPositions = {
            normal: {},
            semi: {},
            weekend: {},
            special: {}
        };

        function getMonthKeyFromDate(date) {
            return `${date.getFullYear()}-${date.getMonth()}`;
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
            const d = new Date(String(value) + 'T00:00:00');
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

        function computeDefaultVirtualDatesForArrival(arrivalDateKey) {
            const arrivalDate = new Date(arrivalDateKey + 'T00:00:00');
            if (isNaN(arrivalDate.getTime())) return { normal: null, semi: null, weekend: null, special: null };

            const dayBefore = shiftDate(arrivalDate, -1);
            // Normal: last NORMAL DAY before arrival (not simply day-before)
            const normal = findPreviousDateKeyByDayType(dayBefore, 'normal-day', 3650);
            const semi = findPreviousDateKeyByDayType(dayBefore, 'semi-normal-day', 3650);
            const weekend = findPreviousDateKeyByDayType(dayBefore, 'weekend-holiday', 3650);
            const special = findNthPreviousSpecialHolidayDateKey(dayBefore, 3, 3650);
            return { normal, semi, weekend, special };
        }

        function buildAutoPlacementForNewPerson(personName, groupNum, datesByType, rankAOverride = null) {
            const rankA = Number.isFinite(parseInt(rankAOverride, 10)) ? parseInt(rankAOverride, 10) : getRankValue(personName);
            const out = {};
            ['special', 'weekend', 'semi', 'normal'].forEach(type => {
                const dateKey = datesByType?.[type] || null;
                const { personB, sourceB } = findPersonBInGroupForTypeOnDate(type, dateKey, groupNum);
                const rankB = personB ? getRankValue(personB) : null;
                const position = personB ? (rankA < rankB ? 'below' : 'above') : 'end';
                out[type] = { dateKey, personB, sourceB, rankA, rankB, position };
            });
            return out;
        }

        function getMaxRankValue() {
            try {
                const vals = Object.values(rankings || {}).map(v => parseInt(v, 10)).filter(n => Number.isFinite(n) && n > 0);
                return vals.length ? Math.max(...vals) : 0;
            } catch (_) {
                return 0;
            }
        }

        function getSortedRankingsList() {
            const entries = [];
            for (const name of Object.keys(rankings || {})) {
                const r = parseInt(rankings[name], 10);
                if (Number.isFinite(r) && r > 0) entries.push({ name, rank: r });
            }
            entries.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
            return entries;
        }

        function renderAutoAddRankingsPicker() {
            const body = document.getElementById('autoAddRankPickerBody');
            const search = document.getElementById('autoAddRankPickerSearch');
            const rankEl = document.getElementById('autoAddHierarchyRank');
            if (!body) return;

            const q = (search?.value || '').trim().toLowerCase();
            const selectedRank = parseInt(rankEl?.value || '', 10);

            const rows = getSortedRankingsList()
                .filter(e => !q || e.name.toLowerCase().includes(q))
                .slice(0, 600);

            body.innerHTML = rows.map(e => {
                const selected = Number.isFinite(selectedRank) && e.rank === selectedRank;
                return `<tr class="${selected ? 'rank-selected' : ''}" data-rank="${e.rank}">
                    <td><strong>${e.rank}</strong></td>
                    <td>${e.name}</td>
                </tr>`;
            }).join('') || `<tr><td colspan="2" class="text-muted text-center">Δεν βρέθηκαν αποτελέσματα</td></tr>`;

            body.querySelectorAll('tr[data-rank]').forEach(tr => {
                tr.addEventListener('click', () => {
                    const r = parseInt(tr.dataset.rank || '', 10);
                    if (rankEl && Number.isFinite(r)) {
                        rankEl.value = String(r);
                        rankEl.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    const pickerModal = bootstrap.Modal.getInstance(document.getElementById('autoAddRankPickerModal'));
                    if (pickerModal) pickerModal.hide();
                });
            });
        }

        let autoAddReturnToModalAfterRankPicker = false;
        function openAutoAddRankPickerModal() {
            const autoAddEl = document.getElementById('autoAddPersonModal');
            const pickerEl = document.getElementById('autoAddRankPickerModal');
            if (!pickerEl) return;

            // Hide auto-add modal so picker doesn't stack and hide content awkwardly
            const autoAddModal = bootstrap.Modal.getInstance(autoAddEl);
            if (autoAddModal) {
                autoAddReturnToModalAfterRankPicker = true;
                autoAddModal.hide();
            } else {
                autoAddReturnToModalAfterRankPicker = false;
            }

            // Reset search
            const search = document.getElementById('autoAddRankPickerSearch');
            if (search) search.value = '';
            renderAutoAddRankingsPicker();

            const pickerModal = new bootstrap.Modal(pickerEl);
            pickerModal.show();

            // On close, return to auto-add modal
            const onHidden = () => {
                pickerEl.removeEventListener('hidden.bs.modal', onHidden);
                if (autoAddReturnToModalAfterRankPicker && autoAddEl) {
                    const m = new bootstrap.Modal(autoAddEl);
                    m.show();
                    autoAddReturnToModalAfterRankPicker = false;
                }
            };
            pickerEl.addEventListener('hidden.bs.modal', onHidden);
        }

        // Insert/overwrite person in rankings at desired rank, shifting others down if needed.
        function insertPersonIntoRankings(personName, desiredRank) {
            const rank = parseInt(desiredRank, 10);
            if (!Number.isFinite(rank) || rank < 1) return;

            // Remove existing occurrence (if any)
            const current = parseInt(rankings?.[personName], 10);
            const hasCurrent = Number.isFinite(current) && current > 0;

            const updated = { ...(rankings || {}) };
            if (hasCurrent) delete updated[personName];

            // Shift everyone >= rank by +1
            Object.keys(updated).forEach(p => {
                const v = parseInt(updated[p], 10);
                if (Number.isFinite(v) && v >= rank) {
                    updated[p] = v + 1;
                }
            });

            updated[personName] = rank;
            rankings = updated;
            rankingsModified = true;
        }

        function renderAutoAddPersonTable() {
            const tbody = document.getElementById('autoAddVirtualDatesBody');
            if (!tbody || !autoAddPersonData) return;
            const { datesByType, placementByType } = autoAddPersonData;
            const rows = [
                { type: 'normal', label: 'Καθημερινές' },
                { type: 'semi', label: 'Ημιαργίες' },
                { type: 'weekend', label: 'Αργίες/ΣΚ' },
                { type: 'special', label: 'Ειδικές Αργίες (3η πριν)' }
            ];

            tbody.innerHTML = rows.map(r => {
                const p = placementByType?.[r.type] || {};
                const dateKey = datesByType?.[r.type] || null;
                const dateVal = dateKeyToInputValue(dateKey);
                const personB = p.personB || '-';
                const src = p.sourceB ? `(${p.sourceB})` : '';
                const ranks = p.personB ? `A:${p.rankA} / B:${p.rankB}` : `A:${p.rankA}`;
                const posText = p.position === 'end'
                    ? 'Στο τέλος'
                    : (p.position === 'above' ? `Πάνω από ${p.personB}` : `Κάτω από ${p.personB}`);

                return `<tr>
                    <td><strong>${r.label}</strong></td>
                    <td style="min-width: 180px;">
                        <input type="date" class="form-control form-control-sm autoAddTypeDate" data-type="${r.type}" value="${dateVal}">
                    </td>
                    <td><strong>${personB}</strong> <span class="text-muted small">${src}</span></td>
                    <td>${ranks}</td>
                    <td><strong>${posText}</strong></td>
                </tr>`;
            }).join('');

            // Bind change handlers (dates editable)
            tbody.querySelectorAll('input.autoAddTypeDate').forEach(inp => {
                inp.addEventListener('change', () => {
                    const type = inp.dataset.type;
                    const dk = inputValueToDateKey(inp.value);
                    autoAddPersonData.datesByType[type] = dk;
                    autoAddPersonData.placementByType = buildAutoPlacementForNewPerson(autoAddPersonData.personName, autoAddPersonData.groupNum, autoAddPersonData.datesByType);
                    renderAutoAddPersonTable();
                });
            });
        }

        function openAutoAddPersonModal(groupNum) {
            const modalEl = document.getElementById('autoAddPersonModal');
            if (!modalEl) {
                alert('Σφάλμα: Δεν βρέθηκε το παράθυρο Αυτόματης Προσθήκης.');
                return;
            }
            const nameEl = document.getElementById('autoAddPersonName');
            const groupEl = document.getElementById('autoAddTargetGroup');
            const arrivalEl = document.getElementById('autoAddArrivalDate');
            const rankEl = document.getElementById('autoAddHierarchyRank');
            const openRankPickerBtn = document.getElementById('autoAddOpenRankPickerBtn');
            const recomputeBtn = document.getElementById('autoAddRecomputeBtn');
            const applyBtn = document.getElementById('autoAddApplyBtn');

            if (groupEl) groupEl.value = String(groupNum);
            if (nameEl) nameEl.value = '';

            const today = new Date();
            const arrivalDefault = formatDateKey(today);
            if (arrivalEl) arrivalEl.value = arrivalDefault;

            // Default hierarchy rank = after last (max+1)
            const defaultRank = getMaxRankValue() + 1;
            if (rankEl) rankEl.value = String(defaultRank);

            autoAddPersonData = {
                personName: '',
                groupNum: parseInt(groupEl?.value || groupNum, 10),
                arrivalDateKey: arrivalDefault,
                datesByType: computeDefaultVirtualDatesForArrival(arrivalDefault),
                placementByType: {}
            };
            autoAddPersonData.rank = defaultRank;
            autoAddPersonData.placementByType = buildAutoPlacementForNewPerson('', autoAddPersonData.groupNum, autoAddPersonData.datesByType, autoAddPersonData.rank);
            renderAutoAddPersonTable();

            const refreshFromInputs = () => {
                const personName = (nameEl?.value || '').trim();
                const g = parseInt(groupEl?.value || groupNum, 10);
                const arrivalKey = inputValueToDateKey(arrivalEl?.value) || arrivalDefault;
                const r = parseInt(rankEl?.value || '', 10);
                autoAddPersonData.personName = personName;
                autoAddPersonData.groupNum = g;
                autoAddPersonData.arrivalDateKey = arrivalKey;
                autoAddPersonData.rank = Number.isFinite(r) && r > 0 ? r : null;
                autoAddPersonData.placementByType = buildAutoPlacementForNewPerson(personName, g, autoAddPersonData.datesByType, autoAddPersonData.rank);
                renderAutoAddPersonTable();
            };

            if (nameEl) nameEl.oninput = refreshFromInputs;
            if (groupEl) groupEl.onchange = () => {
                refreshFromInputs();
            };
            if (arrivalEl) arrivalEl.onchange = () => {
                const arrivalKey = inputValueToDateKey(arrivalEl.value);
                if (arrivalKey) {
                    autoAddPersonData.arrivalDateKey = arrivalKey;
                    autoAddPersonData.datesByType = computeDefaultVirtualDatesForArrival(arrivalKey);
                }
                refreshFromInputs();
            };
            if (rankEl) rankEl.oninput = refreshFromInputs;
            if (openRankPickerBtn) openRankPickerBtn.onclick = () => openAutoAddRankPickerModal();

            if (recomputeBtn) {
                recomputeBtn.onclick = () => {
                    const arrivalKey = inputValueToDateKey(arrivalEl?.value) || arrivalDefault;
                    autoAddPersonData.arrivalDateKey = arrivalKey;
                    autoAddPersonData.datesByType = computeDefaultVirtualDatesForArrival(arrivalKey);
                    refreshFromInputs();
                };
            }

            if (applyBtn) {
                applyBtn.onclick = () => applyAutoAddPerson();
            }

            const modal = new bootstrap.Modal(modalEl);
            modal.show();
        }

        function applyAutoAddPerson() {
            if (!autoAddPersonData) return;
            const personName = (autoAddPersonData.personName || '').trim();
            const groupNum = autoAddPersonData.groupNum;
            const arrivalDateKey = autoAddPersonData.arrivalDateKey;
            const datesByType = autoAddPersonData.datesByType || {};
            const placementByType = autoAddPersonData.placementByType || {};
            const rank = parseInt(autoAddPersonData.rank, 10);

            if (!personName) {
                alert('Παρακαλώ συμπληρώστε ονοματεπώνυμο.');
                return;
            }
            if (!arrivalDateKey) {
                alert('Παρακαλώ επιλέξτε ημερομηνία άφιξης.');
                return;
            }
            if (!Number.isFinite(rank) || rank < 1) {
                alert('Παρακαλώ συμπληρώστε έγκυρο αριθμό ιεραρχίας (>=1).');
                return;
            }

            // First: put person into hierarchy so placement is consistent system-wide
            insertPersonIntoRankings(personName, rank);

            // Prevent duplicates across groups
            for (let g = 1; g <= 4; g++) {
                const gd = groups[g];
                if (!gd) continue;
                const exists = ['special', 'weekend', 'semi', 'normal'].some(t => (gd[t] || []).includes(personName));
                if (exists) {
                    alert(`Το άτομο "${personName}" υπάρχει ήδη σε ομάδα.`);
                    return;
                }
            }

            if (!groups[groupNum]) {
                groups[groupNum] = { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {}, disabledPersons: {} };
            }
            if (!groups[groupNum].priorities) groups[groupNum].priorities = {};
            if (!groups[groupNum].lastDuties) groups[groupNum].lastDuties = {};
            if (!groups[groupNum].missingPeriods) groups[groupNum].missingPeriods = {};

            // Ensure per-person objects exist
            if (!groups[groupNum].priorities[personName]) groups[groupNum].priorities[personName] = {};
            if (!groups[groupNum].lastDuties[personName]) groups[groupNum].lastDuties[personName] = {};
            if (!groups[groupNum].missingPeriods[personName]) groups[groupNum].missingPeriods[personName] = [];

            const listTypes = ['special', 'weekend', 'semi', 'normal'];
            listTypes.forEach(type => {
                if (!groups[groupNum][type]) groups[groupNum][type] = [];
                const list = groups[groupNum][type];

                // Insert using suggested position relative to personB (transfer-like)
                const p = placementByType?.[type] || {};
                const personB = p.personB;
                const position = p.position || 'end';
                // Remove if exists (shouldn't)
                const existingIndex = list.indexOf(personName);
                if (existingIndex !== -1) list.splice(existingIndex, 1);

                if (position === 'end' || !personB) {
                    list.push(personName);
                } else {
                    const refIndex = list.indexOf(personB);
                    if (refIndex === -1) {
                        list.push(personName);
                    } else if (position === 'above') {
                        list.splice(refIndex, 0, personName);
                    } else {
                        list.splice(refIndex + 1, 0, personName);
                    }
                }

                // Re-number priorities to match the list order (priority drives ordering & badge)
                list.forEach((pn, idx) => {
                    if (!groups[groupNum].priorities[pn]) groups[groupNum].priorities[pn] = {};
                    groups[groupNum].priorities[pn][type] = idx + 1;
                });

                // Store virtual duty date into lastDuties for the new person (used by UI and some logic)
                if (datesByType?.[type]) {
                    groups[groupNum].lastDuties[personName][type] = datesByType[type];
                }
            });

            saveData();
            renderGroups();
            updateStatistics();

            const modal = bootstrap.Modal.getInstance(document.getElementById('autoAddPersonModal'));
            if (modal) modal.hide();
            alert(`Προστέθηκε το άτομο "${personName}" στην ${getGroupName(groupNum)} με αυτόματη τοποθέτηση.\nΆφιξη: ${arrivalDateKey}`);
        }

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
            return `${d.getFullYear()}-${d.getMonth()}`;
        }

        function isMonthKey(str) {
            return typeof str === 'string' && /^\d{4}-\d{1,2}$/.test(str);
        }

        // Returns the last rotation person that should seed the rotation for the given date's month.
        // IMPORTANT: When calculating month M, we read from previous month (M-1), not M.
        function getLastRotationPersonForDate(dayType, date, groupNum) {
            const byType = lastRotationPositions?.[dayType] || {};
            const prevMonthKey = getPreviousMonthKeyFromDate(date);

            // Month-scoped format
            if (byType && typeof byType === 'object' && !Array.isArray(byType)) {
                const monthEntry = byType[prevMonthKey];
                if (monthEntry && typeof monthEntry === 'object' && !Array.isArray(monthEntry) && monthEntry[groupNum]) {
                    return monthEntry[groupNum];
                }
            }

            // Legacy flat format fallback
            if (byType && byType[groupNum]) {
                return byType[groupNum];
            }

            // Baseline fallback: derive last rotation person from rotationBaseline docs (previous month)
            const baselineMonth = rotationBaselineLastByType?.[dayType]?.[prevMonthKey];
            if (baselineMonth && baselineMonth[groupNum]) {
                return baselineMonth[groupNum];
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
        let currentDate = new Date();
        let currentGroup = null;
        // Manual assignment feature removed; keep dayDetails selection state elsewhere if needed.
        
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

        // Missing-period reasons (global list)
        let missingReasons = ['Κανονική Άδεια', 'Αναρρωτική Άδεια', 'Φύλλο Πορείας'];
        let missingReasonsModified = false;

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
                        
                        // Render UI in next frame to reduce long main-thread blocking
                        requestAnimationFrame(() => {
                        renderGroups();
                        renderHolidays();
                        renderRecurringHolidays();
                        renderCalendar();
                        updateStatistics();
                        });
                    } else {
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
                    crossMonthSwapsDoc,
                    assignmentReasonsDoc,
                    lastRotationPositionsDoc,
                    rankingsDoc,
                    missingReasonsDoc
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
                    dutyShifts.doc('crossMonthSwaps').get(),
                    dutyShifts.doc('assignmentReasons').get(),
                    dutyShifts.doc('lastRotationPositions').get(),
                    dutyShifts.doc('rankings').get(),
                    dutyShifts.doc('missingReasons').get()
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
                
                // Load cross-month swaps from Firestore
                if (crossMonthSwapsDoc.exists) {
                    const data = crossMonthSwapsDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    crossMonthSwaps = data || {};
                } else {
                            crossMonthSwaps = {};
                }
                
                // Load assignment reasons
                if (assignmentReasonsDoc.exists) {
                    const data = assignmentReasonsDoc.data();
                    delete data.lastUpdated;
                    delete data.updatedBy;
                    assignmentReasons = data || {};
                } else {
                    assignmentReasons = {};
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
            // Deprecated: do not persist dutyAssignments
            localStorage.setItem('dutyShiftsCriticalAssignments', JSON.stringify(criticalAssignments));
            localStorage.setItem('dutyShiftsAssignmentReasons', JSON.stringify(assignmentReasons));
            localStorage.setItem('dutyShiftsCrossMonthSwaps', JSON.stringify(crossMonthSwaps));
            localStorage.setItem('dutyShiftsLastRotationPositions', JSON.stringify(lastRotationPositions));
            localStorage.setItem('dutyShiftsRankings', JSON.stringify(rankings));
        }

        // Clear selected dutyShifts documents in Firestore (wipe fields, keep only metadata)
        // This is a destructive action and intended for admin maintenance.
        async function clearDutyShiftsFirestoreDocs() {
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
                
                const confirmText =
                    'ΠΡΟΣΟΧΗ: Αυτό θα καθαρίσει (wipe) τα παρακάτω Firestore έγγραφα:\n' +
                    '- assignmentReasons\n- crossMonthSwaps\n- lastRotationPositions\n' +
                    '- normalDayAssignments\n- semiNormalAssignments\n- specialHolidayAssignments\n' +
                    '- tempAssignments\n- weekendAssignments\n\n' +
                    '- rotationBaselineSpecialAssignments\n- rotationBaselineWeekendAssignments\n- rotationBaselineSemiAssignments\n- rotationBaselineNormalAssignments\n\n' +
                    'Αυτό ΔΕΝ επηρεάζει τις ομάδες/λίστες (groups), αργίες, ή ιεραρχίες.\n\nΣυνέχεια;';

                if (!confirm(confirmText)) return;

                const loadingAlert = document.createElement('div');
                loadingAlert.className = 'alert alert-warning position-fixed top-50 start-50 translate-middle';
                loadingAlert.style.zIndex = '9999';
                loadingAlert.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Καθαρισμός Firestore εγγράφων...';
                document.body.appendChild(loadingAlert);

                const dutyShifts = db.collection('dutyShifts');
                const batch = db.batch();
                const ts = firebase.firestore.FieldValue.serverTimestamp();

                const docIds = [
                    'assignmentReasons',
                    'crossMonthSwaps',
                    'normalDayAssignments',
                    'semiNormalAssignments',
                    'specialHolidayAssignments',
                    'tempAssignments',
                    'weekendAssignments',
                    'rotationBaselineSpecialAssignments',
                    'rotationBaselineWeekendAssignments',
                    'rotationBaselineSemiAssignments',
                    'rotationBaselineNormalAssignments'
                ];

                for (const id of docIds) {
                    batch.set(dutyShifts.doc(id), { lastUpdated: ts, updatedBy: user.uid }, { merge: false });
                }

                // Keep explicit empty structure so code that reads it stays stable
                batch.set(
                    dutyShifts.doc('lastRotationPositions'),
                    { normal: {}, semi: {}, weekend: {}, special: {}, lastUpdated: ts, updatedBy: user.uid },
                    { merge: false }
                );

                await batch.commit();

                // Reset in-memory state (so UI updates immediately without refresh)
                assignmentReasons = {};
                dutyAssignments = {};
                crossMonthSwaps = {};
                lastRotationPositions = { normal: {}, semi: {}, weekend: {}, special: {} };
                normalDayAssignments = {};
                semiNormalAssignments = {};
                weekendAssignments = {};
                specialHolidayAssignments = {};
                rotationBaselineSpecialAssignments = {};
                rotationBaselineWeekendAssignments = {};
                rotationBaselineSemiAssignments = {};
                rotationBaselineNormalAssignments = {};
                rotationBaselineLastByType = { normal: {}, semi: {}, weekend: {}, special: {} };
                calculationSteps.tempAssignments = null;

                // Clear localStorage backups for these docs to prevent fallback re-populating them
                [
                    'dutyShiftsAssignmentReasons',
                    // 'dutyShiftsAssignments', // deprecated
                    'dutyShiftsCrossMonthSwaps',
                    'dutyShiftsLastRotationPositions',
                    'dutyShiftsNormalDayAssignments',
                    'dutyShiftsSemiNormalAssignments',
                    'dutyShiftsWeekendAssignments',
                    'dutyShiftsSpecialHolidayAssignments'
                ].forEach(k => localStorage.removeItem(k));

                renderCalendar();
                updateStatistics();

                if (loadingAlert && loadingAlert.parentNode) loadingAlert.parentNode.removeChild(loadingAlert);
                alert('Ο καθαρισμός ολοκληρώθηκε.');
            } catch (error) {
                console.error('Error clearing dutyShifts docs:', error);
                alert('Σφάλμα κατά τον καθαρισμό: ' + error.message);
            }
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
        const groupListRenderRegistry = new Map(); // containerId -> { groupNum, type, list }
        function ensureGroupListPopulated(containerId) {
            try {
                const el = document.getElementById(containerId);
                if (!el) return;
                if (el.dataset && el.dataset.populated === 'true') return;
                const meta = groupListRenderRegistry.get(containerId);
                if (!meta) return;
                
                const list = meta.list || [];
                el.innerHTML = '';
                if (!Array.isArray(list) || list.length === 0) {
                    el.innerHTML = '<p class="text-muted text-center small">Δεν υπάρχουν άτομα</p>';
                    el.dataset.populated = 'true';
                    return;
                }
                
                const frag = document.createDocumentFragment();
                list.forEach((person, index) => {
                    const personDiv = createPersonItem(meta.groupNum, person, index, meta.type, list);
                    frag.appendChild(personDiv);
                });
                el.appendChild(frag);
                el.dataset.populated = 'true';
            } catch (e) {
                console.error('Error populating group list:', containerId, e);
            }
        }

        function renderGroups(preserveOpenLists = true, forceOpenLists = []) {
            // Track open lists before rendering if preserveOpenLists is true
            const openLists = preserveOpenLists ? getOpenLists() : [];
            groupListRenderRegistry.clear();
            
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
                        // Lazy rendering for performance: populate only when expanded.
                        groupListRenderRegistry.set(containerId, { groupNum: i, type, list });
                        listContainer.dataset.populated = 'false';
                        // If list is already open (restoreOpenLists will show it), pre-populate now.
                        if (openLists.includes(containerId)) {
                            ensureGroupListPopulated(containerId);
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
            
            // Check if person is currently missing/disabled
            const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, disabledPersons: {} };
            const isDisabledForThisList = isPersonDisabledForDuty(person, groupNum, listType);
            const st = getDisabledState(groupNum, person);
            const missingPeriods = groupData.missingPeriods?.[person] || [];
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const isCurrentlyMissing = missingPeriods.some(period => {
                const start = new Date(period.start + 'T00:00:00');
                const end = new Date(period.end + 'T00:00:00');
                return today >= start && today <= end;
            });
            const disabledTitle = (() => {
                if (!st || (!st.all && !st.special && !st.weekend && !st.semi && !st.normal)) return '';
                if (st.all) return 'Απενεργοποίηση: Όλες οι υπηρεσίες';
                const parts = [];
                if (st.special) parts.push('Ειδικές Αργίες');
                if (st.weekend) parts.push('Σαββατοκύριακα/Αργίες');
                if (st.semi) parts.push('Ημιαργίες');
                if (st.normal) parts.push('Καθημερινές');
                return `Απενεργοποίηση: ${parts.join(', ')}`;
            })();
            const disabledBadge = isDisabledForThisList
                ? `<span class="badge bg-secondary ms-2" title="${escapeHtml(disabledTitle)}"><i class="fas fa-user-slash me-1"></i>OFF</span>`
                : '';
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
                            <span>${person}${disabledBadge}${missingBadge}</span>
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
        
        // Pending "transfer to group" selection (from actions modal)
        let pendingTransferTargetGroup = null;

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
            
            const groupData = groups[groupNumber] || { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {}, disabledPersons: {} };
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

            // Update disable settings button label (summary)
            try {
                const st = getDisabledState(groupNum, personName);
                const enabledTypes = ['special', 'weekend', 'semi', 'normal'].filter(t => !!st[t]);
                const isAll = !!st.all;
                const textEl = document.getElementById('toggleDisablePersonButtonText');
                if (textEl) {
                    textEl.textContent = isAll
                        ? 'Απενεργοποίηση (Πλήρης)'
                        : (enabledTypes.length ? `Απενεργοποίηση (${enabledTypes.length} τύποι)` : 'Απενεργοποίηση (Ρυθμίσεις)');
                }
            } catch (_) {}
            
            const modal = new bootstrap.Modal(document.getElementById('personActionsModal'));
            modal.show();
        }

        function openDisableSettingsFromActions() {
            if (!currentPersonActionsGroup || !currentPersonActionsName) return;
            const groupNum = currentPersonActionsGroup;
            const personName = currentPersonActionsName;
            document.getElementById('disableSettingsPersonName').textContent = personName;
            document.getElementById('disableSettingsGroupName').textContent = getGroupName(groupNum);

            const st = getDisabledState(groupNum, personName);
            const allEl = document.getElementById('disableAllSwitch');
            const spEl = document.getElementById('disableSpecialSwitch');
            const weEl = document.getElementById('disableWeekendSwitch');
            const seEl = document.getElementById('disableSemiSwitch');
            const noEl = document.getElementById('disableNormalSwitch');

            if (allEl) allEl.checked = !!st.all;
            if (spEl) spEl.checked = !!st.special;
            if (weEl) weEl.checked = !!st.weekend;
            if (seEl) seEl.checked = !!st.semi;
            if (noEl) noEl.checked = !!st.normal;

            // If "all" is on, disable individual toggles for clarity
            const setDisabled = (disabled) => {
                if (spEl) spEl.disabled = disabled;
                if (weEl) weEl.disabled = disabled;
                if (seEl) seEl.disabled = disabled;
                if (noEl) noEl.disabled = disabled;
            };
            setDisabled(!!st.all);

            if (allEl) {
                allEl.onchange = () => {
                    const on = !!allEl.checked;
                    setDisabled(on);
                };
            }

            const actionsModal = bootstrap.Modal.getInstance(document.getElementById('personActionsModal'));
            if (actionsModal) actionsModal.hide();
            const modal = new bootstrap.Modal(document.getElementById('disableSettingsModal'));
            modal.show();
        }

        function saveDisableSettings() {
            if (!currentPersonActionsGroup || !currentPersonActionsName) return;
            const groupNum = currentPersonActionsGroup;
            const personName = currentPersonActionsName;
            const g = groups[groupNum];
            if (!g) return;
            if (!g.disabledPersons) g.disabledPersons = {};

            const all = !!document.getElementById('disableAllSwitch')?.checked;
            const st = {
                all,
                special: all ? false : !!document.getElementById('disableSpecialSwitch')?.checked,
                weekend: all ? false : !!document.getElementById('disableWeekendSwitch')?.checked,
                semi: all ? false : !!document.getElementById('disableSemiSwitch')?.checked,
                normal: all ? false : !!document.getElementById('disableNormalSwitch')?.checked
            };

            const any = st.all || st.special || st.weekend || st.semi || st.normal;
            const keyName = (typeof normalizePersonKey === 'function') ? normalizePersonKey(personName) : String(personName || '').trim();
            if (!any) {
                // Remove any stored disabled entry for this person (defensive: raw + normalized + legacy variants).
                delete g.disabledPersons[personName];
                if (keyName) delete g.disabledPersons[keyName];
                if (keyName) {
                    for (const k of Object.keys(g.disabledPersons || {})) {
                        try {
                            if ((typeof normalizePersonKey === 'function' ? normalizePersonKey(k) : String(k || '').trim()) === keyName) {
                                delete g.disabledPersons[k];
                            }
                        } catch (_) {}
                    }
                }
            } else {
                // Store under a normalized key so availability checks never miss it due to spacing/commas differences.
                if (keyName) {
                    // Remove any other key variants for the same normalized name
                    for (const k of Object.keys(g.disabledPersons || {})) {
                        try {
                            const nk = (typeof normalizePersonKey === 'function') ? normalizePersonKey(k) : String(k || '').trim();
                            if (nk === keyName && k !== keyName) delete g.disabledPersons[k];
                        } catch (_) {}
                    }
                    g.disabledPersons[keyName] = st;
                } else {
                    g.disabledPersons[personName] = st;
                }
            }

            saveData();
            renderGroups();

            const modal = bootstrap.Modal.getInstance(document.getElementById('disableSettingsModal'));
            if (modal) modal.hide();
            const actionsModal = new bootstrap.Modal(document.getElementById('personActionsModal'));
            actionsModal.show();
        }

        function getDisabledState(groupNum, personName) {
            const g = groups?.[groupNum];
            const dp = g?.disabledPersons || {};
            const keyName = (typeof normalizePersonKey === 'function') ? normalizePersonKey(personName) : String(personName || '').trim();
            // Try exact key first, then normalized key.
            let raw = dp?.[personName];
            if (!raw && keyName) raw = dp?.[keyName];
            // If still not found, search by normalized key (handles legacy entries and weird whitespace/commas).
            if (!raw && keyName) {
                for (const k of Object.keys(dp || {})) {
                    try {
                        const nk = (typeof normalizePersonKey === 'function') ? normalizePersonKey(k) : String(k || '').trim();
                        if (nk === keyName) {
                            raw = dp[k];
                            break;
                        }
                    } catch (_) {}
                }
            }
            if (raw === true) return { all: true, special: false, weekend: false, semi: false, normal: false };
            if (!raw || typeof raw !== 'object') return { all: false, special: false, weekend: false, semi: false, normal: false };
            return {
                all: !!raw.all,
                special: !!raw.special,
                weekend: !!raw.weekend,
                semi: !!raw.semi,
                normal: !!raw.normal
            };
        }

        function isPersonDisabledForDuty(person, groupNum, dutyCategory) {
            const st = getDisabledState(groupNum, person);
            if (st.all) return true;
            if (!dutyCategory) {
                // If category is not specified, treat any per-type disabled as disabled for display/availability helpers.
                return !!(st.special || st.weekend || st.semi || st.normal);
            }
            // Accept both internal categories and day-type strings defensively
            let cat = dutyCategory;
            if (cat === 'special-holiday') cat = 'special';
            else if (cat === 'weekend-holiday') cat = 'weekend';
            else if (cat === 'semi-normal-day') cat = 'semi';
            else if (cat === 'normal-day') cat = 'normal';
            return !!st[cat];
        }

        function getDisabledReasonText(person, groupNum) {
            const st = getDisabledState(groupNum, person);
            if (st.all) return 'Απενεργοποιημένος (όλες οι υπηρεσίες)';
            const parts = [];
            if (st.special) parts.push('Ειδικές Αργίες');
            if (st.weekend) parts.push('Σαββατοκύριακα/Αργίες');
            if (st.semi) parts.push('Ημιαργίες');
            if (st.normal) parts.push('Καθημερινές');
            return parts.length ? `Απενεργοποιημένος (${parts.join(', ')})` : 'Απενεργοποιημένος';
        }

        // Short (single-label) reason to display in UI when someone is unavailable.
        // User preference:
        // - Disabled => "Απενεργοποιημένος"
        // - Missing period => the selected reason (e.g. "Κανονική Άδεια"), otherwise "Κώλυμα/Απουσία"
        function getUnavailableReasonShort(person, groupNum, dateObj, dutyCategory = null) {
            if (!person) return '';
            if (isPersonDisabledForDuty(person, groupNum, dutyCategory)) return 'Απενεργοποιημένος';
            const mp = getPersonMissingPeriod(person, groupNum, dateObj);
            if (mp) {
                const r = (mp.reason || '').trim();
                return r || 'Κώλυμα/Απουσία';
            }
            return 'Κώλυμα/Απουσία';
        }

        function buildUnavailableReplacementReason({ skippedPersonName, replacementPersonName, dateObj, groupNum, dutyCategory = null }) {
            const reasonShort = getUnavailableReasonShort(skippedPersonName, groupNum, dateObj, dutyCategory);
            const verb = reasonShort === 'Απενεργοποιημένος' ? 'ήταν' : 'είχε';
            const dayName = getGreekDayName(dateObj);
            const dayArt = getGreekDayAccusativeArticle(dateObj);
            const dateStr = dateObj.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
            return `Αντικατέστησε τον/την ${skippedPersonName} επειδή ${verb} ${reasonShort} ${dayArt} ${dayName} ${dateStr}. Ανατέθηκε ο/η ${replacementPersonName}.`;
        }

        // Normalize legacy/odd skip-reason strings for DISABLED persons so UI always shows:
        // "επειδή ήταν Απενεργοποιημένος ..." (and not "είχε Κώλυμα/Απουσία ... (Απενεργοποιημένος)")
        function normalizeSkipReasonText(reasonText) {
            const raw = String(reasonText || '').trim();
            if (!raw) return raw;
            if (!raw.includes('Απενεργοποιημένος')) return raw;

            // If it's already in the correct form, keep it.
            if (raw.includes('επειδή ήταν Απενεργοποιημένος')) return raw;

            // Try to rebuild the sentence from the parts we can parse.
            const skippedMatch = raw.match(/Αντικατέστησε\s+τον\/την\s+(.+?)\s+επειδή/i);
            const replacementMatch = raw.match(/Ανατέθηκε\s+ο\/η\s+(.+?)\s*\./i);
            const skipped = skippedMatch ? skippedMatch[1].trim() : null;
            const replacement = replacementMatch ? replacementMatch[1].trim() : null;

            let datePart = '';
            const idxTin = raw.indexOf('την ');
            const idxAssign = raw.indexOf('. Ανατέθηκε');
            if (idxTin >= 0 && idxAssign > idxTin) {
                datePart = raw.slice(idxTin + 3, idxAssign).trim();
            }

            if (skipped && replacement) {
                const tail = datePart ? ` την ${datePart}` : '';
                return `Αντικατέστησε τον/την ${skipped} επειδή ήταν Απενεργοποιημένος${tail}. Ανατέθηκε ο/η ${replacement}.`;
            }

            // Fallback: remove any "(Απενεργοποιημένος ...)" suffixes and force the key phrase.
            return raw
                .replace(/\s*\(Απενεργοποιημένος[^)]*\)\s*/g, ' ')
                .replace(/επειδή\s+είχε\s+[^.]*Απενεργοποιημένος/i, 'επειδή ήταν Απενεργοποιημένος')
                .replace(/επειδή\s+είχε\s+Κώλυμα\/Απουσία/gi, 'επειδή ήταν Απενεργοποιημένος')
                .replace(/\s+/g, ' ')
                .trim();
        }

        // Normalize legacy swap-reason strings so UI always shows the canonical:
        // "Έγινε η αλλαγή γιατι ο/η X είχε σύγκρουση ..., και ανατέθηκε ...".
        function normalizeSwapReasonText(reasonText) {
            const raw = String(reasonText || '').trim();
            if (!raw) return raw;
            if (raw.startsWith('Έγινε η αλλαγή γιατι ')) return raw;

            // Convert old "Αλλάχθηκε με <name> επειδή ..." -> canonical by stripping the "Αλλάχθηκε με <name>" part.
            // Support both accented and unaccented variants.
            const idxEpeidi = raw.indexOf('επειδή') >= 0 ? raw.indexOf('επειδή') : raw.indexOf('επειδη');
            const lowered = raw.toLowerCase();
            const looksLikeOldSwap = lowered.startsWith('αλλάχθηκε με') || lowered.startsWith('αλλαχθηκε με');
            if (looksLikeOldSwap && idxEpeidi >= 0) {
                const after = raw.slice(idxEpeidi + 'επειδή'.length).trim();
                // after typically starts with "ο/η <name> είχε σύγκρουση ..."
                return `Έγινε η αλλαγή γιατι ${after}`;
            }

            // If it already contains the canonical core, just ensure it starts correctly.
            if (raw.includes('είχε σύγκρουση') && raw.includes('ανατέθηκε')) {
                return raw.replace(/^Αλλάχθηκε με .*?επειδή\s+/i, 'Έγινε η αλλαγή γιατι ');
            }
            return raw;
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
            openTransferTargetGroupModal(
                currentPersonActionsGroup,
                currentPersonActionsIndex,
                currentPersonActionsListType,
                currentPersonActionsName,
                true
            );
        }

        // Open modal to select destination group (better UX than prompt())
        function openTransferTargetGroupModal(fromGroup, index, listType, personName, reopenActionsOnCancel = false) {
            const availableGroups = [1, 2, 3, 4].filter(g => g !== fromGroup);
            if (availableGroups.length === 0) {
                alert('Δεν υπάρχουν άλλες ομάδες για μεταφορά');
                return;
            }
            
            pendingTransferTargetGroup = { fromGroup, index, listType, personName, reopenActionsOnCancel: !!reopenActionsOnCancel };

            document.getElementById('transferSelectPersonName').textContent = personName || '';
            document.getElementById('transferSelectFromGroup').textContent = getGroupName(fromGroup);

            const select = document.getElementById('transferTargetGroupSelect');
            select.innerHTML = availableGroups
                .map(g => `<option value="${g}">Ομάδα ${g}: ${getGroupName(g)}</option>`)
                .join('');

            const modal = new bootstrap.Modal(document.getElementById('transferTargetGroupModal'));
            modal.show();
        }

        function cancelTransferTargetGroup() {
            const modal = bootstrap.Modal.getInstance(document.getElementById('transferTargetGroupModal'));
            if (modal) modal.hide();

            const reopen = pendingTransferTargetGroup?.reopenActionsOnCancel;
            pendingTransferTargetGroup = null;

            if (reopen) {
                const actionsModal = new bootstrap.Modal(document.getElementById('personActionsModal'));
                actionsModal.show();
            }
        }

        function confirmTransferTargetGroup() {
            if (!pendingTransferTargetGroup) return;

            const select = document.getElementById('transferTargetGroupSelect');
            const toGroup = parseInt(select.value, 10);
            const { fromGroup, index, listType } = pendingTransferTargetGroup;

            const modal = bootstrap.Modal.getInstance(document.getElementById('transferTargetGroupModal'));
            if (modal) modal.hide();

            pendingTransferTargetGroup = null;

            if (!toGroup || toGroup === fromGroup || ![1, 2, 3, 4].includes(toGroup)) {
                alert('Μη έγκυρη επιλογή ομάδας');
                return;
            }

            transferPerson(fromGroup, index, toGroup, listType);
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
                if (groups[currentPersonActionsGroup].disabledPersons) {
                    delete groups[currentPersonActionsGroup].disabledPersons[currentPersonActionsName];
                }
                if (groups[currentPersonActionsGroup].priorities) {
                    delete groups[currentPersonActionsGroup].priorities[currentPersonActionsName];
                }

                // Re-number priorities for ALL lists in this group (remove gaps, preserve order)
                normalizeGroupPriorities(currentPersonActionsGroup);

                // If person no longer exists in ANY group lists, also remove from hierarchy and close gaps
                if (!isPersonInAnyGroupLists(currentPersonActionsName)) {
                    if (rankings && rankings[currentPersonActionsName] !== undefined) {
                        delete rankings[currentPersonActionsName];
                    }
                    // Always normalize to close any numbering gaps, and persist to Firestore via saveData()
                    normalizeRankingsSequential();
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

            // IMPORTANT: Always show continuous numbering (1..N) with no gaps,
            // even if Firestore ranks have gaps (e.g. after deletions) or the modal reopens mid-scroll.
            // This does NOT change the order, only the displayed numbers (and what will be saved if user clicks Save).
            updateRankingsAfterMove();
            
            const modal = new bootstrap.Modal(document.getElementById('rankingsModal'));
            modal.show();

            // Reset scroll to top so the list starts from rank 1 visually.
            setTimeout(() => {
                const scroller = document.getElementById('rankingsListContainer');
                if (scroller) scroller.scrollTop = 0;
            }, 0);
        }

        // Drag and drop variables for rankings
        let draggedRankingItem = null;
        let rankingScrollInterval = null;
        let currentMouseY = 0;
        // Track an in-progress manual ranking edit so we can safely commit it before saving
        let activeRankingEdit = null;

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

                // Clear active edit tracking
                if (activeRankingEdit && activeRankingEdit.personName === personName) {
                    activeRankingEdit = null;
                }
            };
            
            // Track this edit so Save can force-commit it if the user clicks Save while editing
            activeRankingEdit = { personName, finishEdit, input };
            
            input.addEventListener('blur', finishEdit);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    finishEdit();
                    // Prevent the Enter key from triggering other actions
                    return;
                }
                if (e.key === 'Escape') {
                    e.preventDefault();
                    // Cancel: restore original number and exit edit mode
                    rankingNumberEl.textContent = String(currentRanking);
                    if (activeRankingEdit && activeRankingEdit.personName === personName) {
                        activeRankingEdit = null;
                    }
                }
            });
        }

        // Save rankings to Firestore
        function saveRankings() {
            // If the user is currently editing a ranking number, commit it first
            if (activeRankingEdit && typeof activeRankingEdit.finishEdit === 'function') {
                try {
                    activeRankingEdit.finishEdit();
                } catch (e) {
                    // If commit fails (validation), don't proceed with save
                    console.error('Failed to commit active ranking edit before saving:', e);
                    return;
                }
            }

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

        function normalizeGroupPriorities(groupNumber) {
            const g = groups?.[groupNumber];
            if (!g) return;
            if (!g.priorities) g.priorities = {};
            const types = ['special', 'weekend', 'semi', 'normal'];
            types.forEach(t => {
                const list = g[t] || [];
                list.forEach((personName, idx) => {
                    if (!g.priorities[personName]) g.priorities[personName] = {};
                    g.priorities[personName][t] = idx + 1;
                });
            });
        }

        function normalizeRankingsSequential() {
            // Preserve current ordering by rank, just remove gaps.
            // Also drop any rankings entries for people who no longer exist in any group lists.
            const all = new Set(getAllPeople());
            const entries = getSortedRankingsList().filter(e => all.has(e.name)); // already sorted ascending by rank
            const out = {};
            entries.forEach((e, idx) => {
                out[e.name] = idx + 1;
            });
            rankings = out;
            rankingsModified = true;
        }

        function isPersonInAnyGroupLists(personName) {
            for (let g = 1; g <= 4; g++) {
                const gd = groups?.[g];
                if (!gd) continue;
                if (['special', 'weekend', 'semi', 'normal'].some(t => (gd[t] || []).includes(personName))) {
                    return true;
                }
            }
            return false;
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

                // Also remove missingPeriods and priorities for that person in this group
                if (!stillInAnyList) {
                    if (groups[groupNumber].missingPeriods) {
                        delete groups[groupNumber].missingPeriods[person];
                    }
                    if (groups[groupNumber].priorities) {
                        delete groups[groupNumber].priorities[person];
                    }
                }

                // Re-number priorities for ALL lists in this group (remove gaps, preserve current order)
                normalizeGroupPriorities(groupNumber);

                // If person no longer exists in ANY group, also remove from hierarchy and close gaps
                if (!isPersonInAnyGroupLists(person)) {
                    if (rankings && rankings[person] !== undefined) delete rankings[person];
                    // Always normalize to close any numbering gaps, and persist to Firestore via saveData()
                    normalizeRankingsSequential();
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
            transferData.auto = null;
            
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
            
            // Auto-suggest positions based on the CURRENT month and rankings:
            // - Find dates in the current month where person A (fromGroup) had duty
            // - For each such date, find the person B (toGroup) who had duty on the SAME date
            // - Compare hierarchy (rankings): if A is higher rank -> place AFTER B, else place ABOVE B
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth(); // 0-11
            const matchesByType = findTransferMatchesBackwards(transferData.person, transferData.fromGroup, transferData.toGroup, year, month, 36);
            applyAutoTransferPositionsFromMatches(matchesByType);

            // Render preview + positioning UI (manual override still available)
            renderTransferAutoPreview(matchesByType);
            renderTransferPositionLists(matchesByType);
            
            const modal = new bootstrap.Modal(document.getElementById('transferPositionModal'));
            modal.show();
        }

        function getDayTypeCategoryFromDayType(dayType) {
            if (dayType === 'special-holiday') return 'special';
            if (dayType === 'weekend-holiday') return 'weekend';
            if (dayType === 'semi-normal-day') return 'semi';
            return 'normal';
        }

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

        // Transfer auto-positioning reference date selection (per duty type):
        // 1) Find the LAST date in the reference month where Person A appears in the *baseline rotation* (for that duty type).
        // 2) If none, search previous months (month-by-month backwards) for the most recent baseline date.
        // 3) If still none, search criticalAssignments history.
        //
        // Then, on that same dateKey, find Person B for the destination group (baseline -> final -> critical) and use rankings to place A.
        function findTransferMatchesBackwards(personA, fromGroup, toGroup, startYear, startMonth, maxMonthsBack = 24) {
            const matches = { special: [], weekend: [], semi: [], normal: [] };
            const types = ['special', 'weekend', 'semi', 'normal'];

            const monthLabelFor = (y, m) => new Date(y, m, 1).toLocaleDateString('el-GR', { month: 'long', year: 'numeric' });

            const findPersonBOnDate = (dayKey) => {
                const baseline = getRotationBaselineAssignmentForDate(dayKey);
                if (baseline) {
                    const b = parseAssignedPersonForGroupFromAssignment(baseline, toGroup);
                    if (b) return { personB: b, sourceB: 'baseline' };
                }
                const finalAssignment = getAssignmentForDate(dayKey);
                if (finalAssignment) {
                    const b = parseAssignedPersonForGroupFromAssignment(finalAssignment, toGroup);
                    if (b) return { personB: b, sourceB: 'final' };
                }
                const criticalAssignment = getCriticalAssignmentForDate(dayKey);
                if (criticalAssignment) {
                    const b = parseAssignedPersonForGroupFromAssignment(criticalAssignment, toGroup);
                    if (b) return { personB: b, sourceB: 'critical' };
                }
                return { personB: null, sourceB: null };
            };

            const findLastBaselineDateForA = (type) => {
                for (let back = 0; back < maxMonthsBack; back++) {
                    const monthStart = new Date(startYear, startMonth - back, 1);
                    const y = monthStart.getFullYear();
                    const m = monthStart.getMonth();
                    const firstDay = new Date(y, m, 1);
                    const lastDay = new Date(y, m + 1, 0);

                    for (let d = new Date(lastDay); d >= firstDay; d.setDate(d.getDate() - 1)) {
                        const cat = getDayTypeCategoryFromDayType(getDayType(d));
                        if (cat !== type) continue;
                        const dayKey = formatDateKey(d);
                        const baseline = getRotationBaselineAssignmentForDate(dayKey);
                        if (!baseline) continue;
                        const a = parseAssignedPersonForGroupFromAssignment(baseline, fromGroup);
                        if (a && a === personA) {
                            return {
                                dateKey: dayKey,
                                dateObj: new Date(d),
                                monthKey: `${y}-${m}`,
                                monthLabel: monthLabelFor(y, m),
                                sourceA: 'baseline'
                            };
                        }
                    }
                }
                return null;
            };

            const findLastCriticalDateForA = (type) => {
                for (let back = 0; back < maxMonthsBack; back++) {
                    const monthStart = new Date(startYear, startMonth - back, 1);
                    const y = monthStart.getFullYear();
                    const m = monthStart.getMonth();
                    const firstDay = new Date(y, m, 1);
                    const lastDay = new Date(y, m + 1, 0);

                    for (let d = new Date(lastDay); d >= firstDay; d.setDate(d.getDate() - 1)) {
                        const cat = getDayTypeCategoryFromDayType(getDayType(d));
                        if (cat !== type) continue;
                        const dayKey = formatDateKey(d);
                        const critical = getCriticalAssignmentForDate(dayKey);
                        if (!critical) continue;
                        const a = parseAssignedPersonForGroupFromAssignment(critical, fromGroup);
                        if (a && a === personA) {
                            return {
                                dateKey: dayKey,
                                dateObj: new Date(d),
                                monthKey: `${y}-${m}`,
                                monthLabel: monthLabelFor(y, m),
                                sourceA: 'critical'
                            };
                        }
                    }
                }
                return null;
            };

            for (const type of types) {
                let ref = findLastBaselineDateForA(type);
                if (!ref) ref = findLastCriticalDateForA(type);
                if (!ref) continue;

                const { personB, sourceB } = findPersonBOnDate(ref.dateKey);
                if (!personB) continue;

                matches[type].push({
                    dateKey: ref.dateKey,
                    dateStr: ref.dateObj.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                    dayName: getGreekDayName(ref.dateObj),
                    personB,
                    monthKey: ref.monthKey,
                    monthLabel: ref.monthLabel,
                    sourceA: ref.sourceA,
                    sourceB
                });
            }

            return matches;
        }

        function getRankValue(personName) {
            const v = rankings?.[personName];
            const n = parseInt(v, 10);
            return Number.isFinite(n) && n > 0 ? n : 9999;
        }

        // Apply auto positions to transferData.positions (only if not already explicitly set).
        function applyAutoTransferPositionsFromMatches(matchesByType) {
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const personA = transferData.person;
            const rankA = getRankValue(personA);

            const chosenByType = {};
            const ranksByType = {};

            ['special', 'weekend', 'semi', 'normal'].forEach(type => {
                // Choose the most recent match by dateKey
                const matches = (matchesByType?.[type] || []).slice().sort((a, b) => (a.dateKey || '').localeCompare(b.dateKey || ''));
                const chosen = matches.length ? matches[matches.length - 1] : null;
                chosenByType[type] = chosen;

                if (!chosen) {
                    ranksByType[type] = { rankA, rankB: null };
                    // Default if we have no evidence: end
                    if (!transferData.positions[type]) {
                        transferData.positions[type] = { referencePerson: null, position: 'end' };
                    }
                    return;
                }

                const personB = chosen.personB;
                const rankB = getRankValue(personB);
                ranksByType[type] = { rankA, rankB };

                // User rule:
                // - If A is higher ranking -> place AFTER B
                // - If A is lower ranking -> place ABOVE B
                // Ranking convention: smaller number = higher rank
                const position = rankA < rankB ? 'below' : 'above';

                // Only auto-set if not already set
                if (!transferData.positions[type]) {
                    transferData.positions[type] = { referencePerson: personB, position };
                }
            });

            transferData.auto = { year, month, matchesByType, chosenByType, ranksByType };
        }

        function renderTransferAutoPreview(matchesByType) {
            const el = document.getElementById('transferAutoPreview');
            if (!el) return;

            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const monthStr = new Date(year, month, 1).toLocaleDateString('el-GR', { month: 'long', year: 'numeric' });

            const rows = [
                { type: 'special', label: 'Ειδικές Αργίες' },
                { type: 'weekend', label: 'Σαββατοκύριακα/Αργίες' },
                { type: 'semi', label: 'Ημιαργίες' },
                { type: 'normal', label: 'Καθημερινές' }
            ].map(({ type, label }) => {
                const chosen = transferData.auto?.chosenByType?.[type] || null;
                const pos = transferData.positions?.[type] || null;
                const r = transferData.auto?.ranksByType?.[type] || {};
                const totalMatches = matchesByType?.[type]?.length || 0;

                const matchText = chosen
                    ? `${chosen.dayName} ${chosen.dateStr} — ${chosen.personB} (${chosen.monthLabel || chosen.monthKey || ''}, A:${chosen.sourceA || ''}, B:${chosen.sourceB || ''})`
                    : 'Δεν βρέθηκε κοινή υπηρεσία';

                let intended = 'Δεν έχει επιλεγεί';
                if (pos) {
                    if (pos.position === 'end') intended = 'Στο τέλος';
                    else if (pos.referencePerson) intended = `${pos.position === 'above' ? 'Πάνω από' : 'Κάτω από'} ${pos.referencePerson}`;
                }

                const rankText = chosen
                    ? `A:${r.rankA ?? ''} / B:${r.rankB ?? ''}`
                    : `A:${r.rankA ?? ''}`;

                return `<tr>
                    <td><strong>${label}</strong></td>
                    <td>${matchText}<div class="small text-muted">Matches: ${totalMatches}</div></td>
                    <td>${rankText}</td>
                    <td><strong>${intended}</strong></td>
                </tr>`;
            }).join('');

            el.innerHTML = `
                <div class="alert alert-light border">
                    <div class="mb-2">
                        <strong>Αυτόματη πρόταση τοποθέτησης (αφετηρία μήνας: ${monthStr})</strong>
                        <div class="text-muted small">Αν δεν υπάρχει κοινή υπηρεσία στον μήνα, γίνεται αναζήτηση σε προηγούμενους μήνες (baseline docs πρώτα). Μπορείτε να αλλάξετε χειροκίνητα παρακάτω.</div>
                    </div>
                    <div class="table-responsive">
                        <table class="table table-sm table-bordered mb-0">
                            <thead>
                                <tr>
                                    <th>Λίστα</th>
                                    <th>Κοινή υπηρεσία (Α &amp; Ομάδα προορισμού)</th>
                                    <th>Ιεραρχία</th>
                                    <th>Προτεινόμενη θέση</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>
                </div>
            `;
        }

        // Render positioning lists for transfer
        function renderTransferPositionLists(matchesByType) {
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
                const matchList = matchesByType?.[type] || [];
                // Show unique Bs for quick manual anchors
                const sameDayPeopleList = Array.from(new Set(matchList.map(m => m.personB))).filter(Boolean);
                
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
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const matchesByType = findTransferMatchesBackwards(transferData.person, transferData.fromGroup, transferData.toGroup, year, month, 36);
            // Update preview to reflect the intended positions after manual override
            renderTransferAutoPreview(matchesByType);
            renderTransferPositionLists(matchesByType);
        }

        // Complete the transfer with selected positions
        function completeTransfer() {
            // Snapshot for undo BEFORE any changes
            const undoFromGroup = transferData.fromGroup;
            const undoToGroup = transferData.toGroup;
            const undoPerson = transferData.person;
            const undoFromSnapshot = deepClonePlain(groups[undoFromGroup]);
            const undoToSnapshot = deepClonePlain(groups[undoToGroup]);

            // Remove from current group's all lists
            const allListTypes = ['special', 'weekend', 'semi', 'normal'];
            allListTypes.forEach(lt => {
                const currentList = groups[transferData.fromGroup][lt] || [];
                const currentIndex = currentList.indexOf(transferData.person);
                if (currentIndex !== -1) {
                    currentList.splice(currentIndex, 1);
                }
            });

            // Re-number priorities in source group lists to match their new order (prevents gaps / drift)
            try {
                if (groups[transferData.fromGroup]) {
                    if (!groups[transferData.fromGroup].priorities) groups[transferData.fromGroup].priorities = {};
                    allListTypes.forEach(listType => {
                        const list = groups[transferData.fromGroup][listType] || [];
                        list.forEach((personName, idx) => {
                            if (!groups[transferData.fromGroup].priorities[personName]) {
                                groups[transferData.fromGroup].priorities[personName] = {};
                            }
                            groups[transferData.fromGroup].priorities[personName][listType] = idx + 1;
                        });
                    });
                }
            } catch (_) {
                // non-fatal
            }
            
            // Initialize target group if needed
            if (!groups[transferData.toGroup]) {
                groups[transferData.toGroup] = { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, priorities: {}, disabledPersons: {} };
            }
            if (!groups[transferData.toGroup].priorities) groups[transferData.toGroup].priorities = {};
            
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

                // CRITICAL: priorities drive ordering (renderGroups sorts by priority).
                // After inserting, re-number priorities to match the list order so:
                // - The person is not pushed to the end (priority 999)
                // - The UI shows a number instead of "?"
                list.forEach((personName, idx) => {
                    if (!groups[transferData.toGroup].priorities[personName]) {
                        groups[transferData.toGroup].priorities[personName] = {};
                    }
                    groups[transferData.toGroup].priorities[personName][listType] = idx + 1;
                });
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

            // Store undo state and show undo button toast
            lastTransferUndo = {
                person: undoPerson,
                fromGroup: undoFromGroup,
                toGroup: undoToGroup,
                fromSnapshot: undoFromSnapshot,
                toSnapshot: undoToSnapshot,
                createdAt: Date.now()
            };
            showTransferUndoToast();
            
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

            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month, day);
                const dayKey = formatDateKey(date);
                const dayType = getDayType(date);
                const rotationType = mapDayTypeToRotationType(dayType);

                const assignment = (typeof getAssignmentForDate === 'function' ? getAssignmentForDate(dayKey) : null) ?? (dutyAssignments?.[dayKey] || '');
                const personName = getAssignedPersonNameForGroupFromAssignment(assignment, groupNum);
                if (personName) lastAssigned[rotationType] = personName;
            }

            const nextTwoForType = (type) => {
                const list = (groupData?.[type] || []).filter(Boolean);
                if (list.length === 0) return ['', ''];

                const last = lastAssigned[type];
                let startIdx = 0;
                if (last) {
                    const idx = list.indexOf(last);
                    startIdx = idx >= 0 ? (idx + 1) : 0;
                }

                const a = list[startIdx % list.length] || '';
                const b = list.length >= 2 ? (list[(startIdx + 1) % list.length] || '') : '';
                return [a, b];
            };

            return {
                lastAssigned,
                next: {
                    normal: nextTwoForType('normal'),
                    semi: nextTwoForType('semi'),
                    weekend: nextTwoForType('weekend'),
                    special: nextTwoForType('special')
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
                    
                    // Get assignment for this group (supports object or string formats)
                    const assignment = (typeof getAssignmentForDate === 'function' ? getAssignmentForDate(dayKey) : null) ?? (dutyAssignments?.[dayKey] || '');
                    const personName = getAssignedPersonNameForGroupFromAssignment(assignment, groupNum);
                    
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

                const buildExcelFilename = (groupName, monthName, year) => {
                    const prefix = 'ΥΠΗΡΕΣΙΑ';
                    const safeGroup = sanitizeFilenameComponent(groupName);
                    const safeMonth = sanitizeFilenameComponent(monthName);
                    return `${prefix}_${safeGroup}_${safeMonth}_${year}.xlsx`;
                };

                const getGreekMonthAbbrev = (date) => {
                    const abbr = ['ΙΑΝ', 'ΦΕΒ', 'ΜΑΡ', 'ΑΠΡ', 'ΜΑΙ', 'ΙΟΥΝ', 'ΙΟΥΛ', 'ΑΥΓ', 'ΣΕΠ', 'ΟΚΤ', 'ΝΟΕ', 'ΔΕΚ'];
                    return abbr[date.getMonth()];
                };

                const monthFolderName = `${getGreekMonthAbbrev(currentDate)} ${String(year).slice(-2)}`;

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

                // If supported (Chrome/Edge), ask user for a base folder and create a month subfolder (e.g. "ΙΑΝ 26")
                // Otherwise we fall back to normal browser downloads (cannot auto-create folders there).
                let monthDirHandle = null;
                if (typeof window.showDirectoryPicker === 'function') {
                    try {
                        const baseDir = await window.showDirectoryPicker({ mode: 'readwrite' });
                        monthDirHandle = await baseDir.getDirectoryHandle(monthFolderName, { create: true });
                    } catch (e) {
                        // user cancelled or not allowed; fallback to normal downloads
                        monthDirHandle = null;
                    }
                }

                // If folder saving isn't available/allowed, optionally package everything into a zip (so user gets a "folder-like" download).
                const zipAvailable = typeof JSZip !== 'undefined';
                const zip = (!monthDirHandle && zipAvailable) ? new JSZip() : null;
                const zipFolder = zip ? zip.folder(monthFolderName) : null;

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
                        
                        // Set title - merge cells A1 through E1
                        worksheet.mergeCells('A1:E1');
                        const titleCell = worksheet.getCell('A1');
                        titleCell.value = `ΥΠΗΡΕΣΙΑ ${groupName} ΜΗΝΟΣ ${monthName.toUpperCase()} ${year}`;
                        titleCell.font = { 
                            name: 'Arial', 
                            bold: true, 
                            size: 16
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
                        worksheet.getRow(1).height = 30;
                        
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
                                size: 16,
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
                        headerRow.height = 30;
                        
                        // Set column widths
                        worksheet.getColumn(1).width = 14;
                        worksheet.getColumn(2).width = 17;
                        worksheet.getColumn(3).width = 57;
                        worksheet.getColumn(4).width = 3;   // spacer column (D)
                        worksheet.getColumn(5).width = 48;  // right table (E)
                        
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
                                    size: 14
                                };
                                cell.alignment = { 
                                    horizontal: (colNum === 1 || colNum === 2) ? 'center' : 'left', 
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
                            
                            row.height = 30;
                        }

                        // Add "next on rotation" table on the RIGHT of the main duty list (as in the screenshot)
                        const rotationInfo = getNextTwoRotationPeopleForCurrentMonth({
                            year,
                            month,
                            daysInMonth,
                            groupNum,
                            groupData,
                            dutyAssignments
                        });
                        const rightCol = 5; // E

                        const setBlockBorder = (r, isTop, isBottom) => {
                            const cell = worksheet.getRow(r).getCell(rightCol);
                            cell.border = {
                                top: isTop ? { style: 'thick' } : { style: 'thin' },
                                bottom: isBottom ? { style: 'thick' } : { style: 'thin' },
                                left: { style: 'thick' },
                                right: { style: 'thick' }
                            };
                        };

                        const fillHex = (rgbArr) => {
                            const hex = rgbArr.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
                            return 'FF' + hex;
                        };

                        const normalFill = fillHex(getDayTypeColor('normal-day'));
                        const semiFill = fillHex(getDayTypeColor('semi-normal-day'));
                        const weekendFill = fillHex(getDayTypeColor('weekend-holiday'));
                        // Use a vivid magenta for "ΕΙΔΙΚΕΣ ΑΡΓΙΕΣ" as shown in your screenshot
                        const specialFill = 'FFFF00FF';

                        const writeRightRow = (rowNum, text, { bold = false, center = false, fill = null } = {}) => {
                            const cell = worksheet.getRow(rowNum).getCell(rightCol);
                            cell.value = text || '';
                            cell.font = { name: 'Arial', size: 14, bold: !!bold, color: { argb: 'FF000000' } };
                            cell.alignment = { horizontal: center ? 'center' : 'left', vertical: 'middle' };
                            if (fill) {
                                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
                            }
                            worksheet.getRow(rowNum).height = 30;
                        };

                        // Layout (matching screenshot): start around row 5, stacked blocks with blank separators.
                        let rr = 5;
                        writeRightRow(rr, 'ΑΝΑΠΛΗΡΩΜΑΤΙΚΟΙ', { bold: true, center: true });
                        setBlockBorder(rr, true, true);
                        rr += 2; // blank row between title and first block

                        const writeCategoryBlock = (title, fill, names) => {
                            writeRightRow(rr, title, { bold: true, center: true, fill });
                            setBlockBorder(rr, true, false);
                            rr++;

                            writeRightRow(rr, names?.[0] || '', { fill });
                            setBlockBorder(rr, false, false);
                            rr++;

                            writeRightRow(rr, names?.[1] || '', { fill });
                            setBlockBorder(rr, false, true);
                            rr += 2; // blank row between blocks
                        };

                        writeCategoryBlock('ΚΑΘΗΜΕΡΙΝΕΣ', normalFill, rotationInfo.next.normal);
                        writeCategoryBlock('ΗΜΙΑΡΓΙΕΣ', semiFill, rotationInfo.next.semi);
                        writeCategoryBlock('ΑΡΓΙΕΣ', weekendFill, rotationInfo.next.weekend);
                        writeCategoryBlock('ΕΙΔΙΚΕΣ ΑΡΓΙΕΣ', specialFill, rotationInfo.next.special);
                        
                        // Generate file name (keep Greek)
                        const fileName = buildExcelFilename(groupName, monthName, year);
                        
                        // Write file
                        const buffer = await workbook.xlsx.writeBuffer();
                        const saved = await saveBytesToMonthFolder(fileName, buffer);
                        if (!saved) {
                            if (zipFolder) zipFolder.file(fileName, buffer);
                            else downloadBytes(fileName, buffer);
                        }
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
                            
                            const assignment = (typeof getAssignmentForDate === 'function' ? getAssignmentForDate(dayKey) : null) ?? (dutyAssignments?.[dayKey] || '');
                            const personName = getAssignedPersonNameForGroupFromAssignment(assignment, groupNum);
                            
                            const dateStr = `${String(day).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;
                            // Add extra columns so we can place the right-side table in E
                            data.push([dateStr, dayName, personName, '', '']);
                            rowDayTypes.push(dayType);
                        }

                        // Add "next on rotation" table on the RIGHT of the main duty list (E–F)
                        const rotationInfo = getNextTwoRotationPeopleForCurrentMonth({
                            year,
                            month,
                            daysInMonth,
                            groupNum,
                            groupData,
                            dutyAssignments
                        });
                        // We will write values into column E and merge E:F for each row.
                        const rightRows = [
                            { row: 4, text: 'ΑΝΑΠΛΗΡΩΜΑΤΙΚΟΙ', kind: 'title' },
                            { row: 6, text: 'ΚΑΘΗΜΕΡΙΝΕΣ', kind: 'normalHeader' },
                            { row: 7, text: rotationInfo.next.normal[0] || '', kind: 'normal' },
                            { row: 8, text: rotationInfo.next.normal[1] || '', kind: 'normal' },
                            { row: 10, text: 'ΗΜΙΑΡΓΙΕΣ', kind: 'semiHeader' },
                            { row: 11, text: rotationInfo.next.semi[0] || '', kind: 'semi' },
                            { row: 12, text: rotationInfo.next.semi[1] || '', kind: 'semi' },
                            { row: 14, text: 'ΑΡΓΙΕΣ', kind: 'weekendHeader' },
                            { row: 15, text: rotationInfo.next.weekend[0] || '', kind: 'weekend' },
                            { row: 16, text: rotationInfo.next.weekend[1] || '', kind: 'weekend' },
                            { row: 18, text: 'ΕΙΔΙΚΕΣ ΑΡΓΙΕΣ', kind: 'specialHeader' },
                            { row: 19, text: rotationInfo.next.special[0] || '', kind: 'special' },
                            { row: 20, text: rotationInfo.next.special[1] || '', kind: 'special' }
                        ];
                        
                        const ws = XLSX.utils.aoa_to_sheet(data);
                        // Column widths: A14, B17, C57, E48 (D spacer)
                        ws['!cols'] = [
                            { wch: 14 }, // A
                            { wch: 17 }, // B
                            { wch: 57 }, // C
                            { wch: 3 },  // D spacer
                            { wch: 48 }  // E right table
                        ];
                        if (!ws['!merges']) ws['!merges'] = [];
                        // Title merge A1:E1
                        ws['!merges'].push({ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } });

                        // Row heights (30) for the whole produced sheet
                        ws['!rows'] = Array.from({ length: data.length }, () => ({ hpt: 30 }));
                        
                        // Style title row (row 1)
                        const titleCell = 'A1';
                        if (!ws[titleCell]) ws[titleCell] = { t: 's', v: data[0][0] || '' };
                        if (!ws[titleCell].s) ws[titleCell].s = {};
                        ws[titleCell].s.font = { name: 'Arial', bold: true, sz: 16, color: { rgb: 'FFFFFF' } };
                        ws[titleCell].s.fill = { fgColor: { rgb: '428BCA' }, patternType: 'solid' };
                        ws[titleCell].s.alignment = { horizontal: 'center', vertical: 'center' };
                        
                        // Style header row (row 3)
                        const headerRow = 2; // 0-indexed, so row 3 is index 2
                        ['A', 'B', 'C'].forEach((col, idx) => {
                            const cellRef = col + (headerRow + 1);
                            if (!ws[cellRef]) ws[cellRef] = { t: 's', v: data[headerRow][idx] || '' };
                            if (!ws[cellRef].s) ws[cellRef].s = {};
                            ws[cellRef].s.font = { name: 'Arial', bold: true, sz: 16, color: { rgb: 'FFFFFF' } };
                            ws[cellRef].s.fill = { fgColor: { rgb: '428BCA' }, patternType: 'solid' };
                            ws[cellRef].s.alignment = { horizontal: 'center', vertical: 'center' };
                        });

                        // Write and style the right-side table (SheetJS styling is best-effort)
                        const dayTypeToRgb = (dayType) => {
                            const c = getDayTypeColor(dayType);
                            return c.map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
                        };
                        const normalRgb = dayTypeToRgb('normal-day');
                        const semiRgb = dayTypeToRgb('semi-normal-day');
                        const weekendRgb = dayTypeToRgb('weekend-holiday');
                        const specialRgb = 'FF00FF'; // vivid magenta like screenshot

                        const styleCell = (addr, { bold = false, center = false, fillRgb = null } = {}) => {
                            if (!ws[addr]) ws[addr] = { t: 's', v: '' };
                            if (!ws[addr].s) ws[addr].s = {};
                            ws[addr].s.font = { name: 'Arial', bold: !!bold, sz: 14, color: { rgb: '000000' } };
                            ws[addr].s.alignment = { horizontal: center ? 'center' : 'left', vertical: 'center' };
                            if (fillRgb) ws[addr].s.fill = { fgColor: { rgb: fillRgb }, patternType: 'solid' };
                        };

                        rightRows.forEach(rr => {
                            const excelRow = rr.row + 1; // 1-based
                            const eAddr = 'E' + excelRow;
                            if (!ws[eAddr]) ws[eAddr] = { t: 's', v: rr.text || '' };
                            else ws[eAddr].v = rr.text || '';

                            const kind = rr.kind || '';
                            if (kind === 'title') {
                                styleCell(eAddr, { bold: true, center: true });
                            } else if (kind.startsWith('normal')) {
                                styleCell(eAddr, { bold: kind.endsWith('Header'), center: kind.endsWith('Header'), fillRgb: normalRgb });
                            } else if (kind.startsWith('semi')) {
                                styleCell(eAddr, { bold: kind.endsWith('Header'), center: kind.endsWith('Header'), fillRgb: semiRgb });
                            } else if (kind.startsWith('weekend')) {
                                styleCell(eAddr, { bold: kind.endsWith('Header'), center: kind.endsWith('Header'), fillRgb: weekendRgb });
                            } else if (kind.startsWith('special')) {
                                styleCell(eAddr, { bold: kind.endsWith('Header'), center: kind.endsWith('Header'), fillRgb: specialRgb });
                            }
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
                                ws[cellRef].s.font = { name: 'Arial', sz: 14 };
                                ws[cellRef].s.alignment = { horizontal: (colIdx === 0 || colIdx === 1) ? 'center' : 'left', vertical: 'center' };
                            });
                        }
                        
                        XLSX.utils.book_append_sheet(wb, ws, 'Υπηρεσίες');
                        const fileName = buildExcelFilename(groupName, monthName, year);
                        const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                        const saved = await saveBytesToMonthFolder(fileName, out);
                        if (!saved) {
                            if (zipFolder) zipFolder.file(fileName, out);
                            else downloadBytes(fileName, out);
                        }
                    }
                }

                // If we couldn't create a real folder, but we did collect files into a zip, download it once here.
                if (zipFolder && zip) {
                    const zipBlob = await zip.generateAsync({ type: 'blob' });
                    downloadBlob(`${monthFolderName}.zip`, zipBlob, 'application/zip');
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
                
                alert(monthDirHandle
                    ? `Τα Excel αρχεία αποθηκεύτηκαν στον φάκελο "${monthFolderName}".`
                    : (zipFolder
                        ? `Τα Excel αρχεία δημιουργήθηκαν ως "${monthFolderName}.zip" (περιέχει φάκελο "${monthFolderName}").`
                        : 'Τα Excel αρχεία δημιουργήθηκαν επιτυχώς!'));
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

        // Render calendar
        function renderCalendar() {
            const calendarGrid = document.getElementById('calendarGrid');
            const currentMonthYear = document.getElementById('currentMonthYear');
            
            if (!calendarGrid || !currentMonthYear) {
                console.error('Calendar elements not found');
                return;
            }
            
            // NOTE: criticalAssignments are treated as history only and must not be injected into the calendar.
            
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
            const frag = document.createDocumentFragment();
            
            // Precompute special holiday map to avoid repeated .find() calls
            const specialHolidayNameByDate = new Map((specialHolidays || []).map(h => [h.date, h.name]));
            const shouldShowHeavyIndicators = false; // performance: avoid conflict/reason checks in calendar view

            // Precompute: for current month, who has special-holiday duty (by group).
            // Used to underline weekend replacements when expected person is skipped due to special holiday in same month.
            const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
            const specialDutyInMonthByGroup = { 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set() };
            for (const dateKey in specialHolidayAssignments || {}) {
                if (!dateKey || !dateKey.startsWith(monthPrefix)) continue;
                const a = specialHolidayAssignments[dateKey];
                if (!a) continue;
                const str = typeof a === 'string' ? a : String(a);
                const parts = str.split(',').map(p => p.trim()).filter(Boolean);
                for (const part of parts) {
                    const m = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                    if (m) {
                        const name = m[1].trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '');
                        const g = parseInt(m[2], 10);
                        if (g >= 1 && g <= 4 && name) specialDutyInMonthByGroup[g].add(name);
                    }
                }
            }

            // Precompute: rotation-expected person per dateKey/group for this month, per day-type category.
            const monthExpectedByDateGroup = {}; // dateKey -> { groupNum: expectedPerson }
            const dayKeysByCategory = { special: [], weekend: [], semi: [], normal: [] };
            for (let d = 1; d <= daysInMonth; d++) {
                const dt = new Date(year, month, d);
                const dk = formatDateKey(dt);
                const isSpecial = specialHolidayNameByDate.has(dk);
                const dtType = isSpecial ? 'special-holiday' : getDayType(dt);
                let cat = 'normal';
                if (dtType === 'special-holiday') cat = 'special';
                else if (dtType === 'weekend-holiday') cat = 'weekend';
                else if (dtType === 'semi-normal-day') cat = 'semi';
                dayKeysByCategory[cat].push(dk);
            }
            const monthSeedDate = new Date(year, month, 1);
            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                const gdata = groups[groupNum] || {};
                for (const cat of ['special', 'weekend', 'semi', 'normal']) {
                    const people = gdata[cat] || [];
                    if (!Array.isArray(people) || people.length === 0) continue;
                    const seed = getLastRotationPersonForDate(cat, monthSeedDate, groupNum);
                    let idx = 0;
                    if (seed) {
                        const seedIdx = people.indexOf(seed);
                        if (seedIdx >= 0) idx = (seedIdx + 1) % people.length;
                    }
                    for (const dk of dayKeysByCategory[cat]) {
                        if (!monthExpectedByDateGroup[dk]) monthExpectedByDateGroup[dk] = {};
                        monthExpectedByDateGroup[dk][groupNum] = people[idx];
                        idx = (idx + 1) % people.length;
                    }
                }
            }
            
            // Day headers - Monday first
            const dayHeaders = ['Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ', 'Κυρ'];
            dayHeaders.forEach(header => {
                const headerDiv = document.createElement('div');
                headerDiv.className = 'calendar-day-header';
                headerDiv.textContent = header;
                frag.appendChild(headerDiv);
            });
            
            // Empty cells for days before month starts
            for (let i = 0; i < startingDayOfWeek; i++) {
                const emptyDiv = document.createElement('div');
                frag.appendChild(emptyDiv);
            }
            
            // Days of the month
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            for (let day = 1; day <= daysInMonth; day++) {
                const date = new Date(year, month, day);
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
                const isSpecial = specialHolidayNameByDate.has(key);
                const dayType = isSpecial ? 'special-holiday' : getDayType(date);
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
                const holidayName = specialHolidayNameByDate.get(key) || getOrthodoxHolidayNameAuto(date);
                
                // Parse assignment and display each person on a separate line (no commas)
                let displayAssignmentHtml = '';
                if (assignment) {
                    const assignmentStr = typeof assignment === 'string' ? assignment : String(assignment);
                    const parts = assignmentStr.split(',').map(p => p.trim()).filter(p => p);
                    if (parts.length > 0) {
                        displayAssignmentHtml = '<div class="duty-person-container">';
                        for (const part of parts) {
                            const m = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                            const nameOnly = part.replace(/\s*\(Ομάδα\s*\d+\)\s*/g, '').trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '');
                            let underline = false;
                            let isSwap = false;
                            let swapStyle = '';
                            if (m) {
                                const personName = m[1].trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '');
                                const g = parseInt(m[2], 10);
                                if (personName && g >= 1 && g <= 4) {
                                    const r = getAssignmentReason(key, g, personName);
                                    if (r && r.type === 'swap') {
                                        isSwap = true;
                                        // Colorize swap borders by swapPairId (matches earlier swap palette concept)
                                        const swapColors = [
                                            { border: '#FF1744', bg: 'rgba(255, 23, 68, 0.12)' },
                                            { border: '#00E676', bg: 'rgba(0, 230, 118, 0.12)' },
                                            { border: '#FFD600', bg: 'rgba(255, 214, 0, 0.12)' },
                                            { border: '#00B0FF', bg: 'rgba(0, 176, 255, 0.12)' },
                                            { border: '#D500F9', bg: 'rgba(213, 0, 249, 0.12)' },
                                            { border: '#FF6D00', bg: 'rgba(255, 109, 0, 0.12)' },
                                            { border: '#00E5FF', bg: 'rgba(0, 229, 255, 0.12)' },
                                            { border: '#FF4081', bg: 'rgba(255, 64, 129, 0.12)' }
                                        ];
                                        const pidRaw = r.swapPairId;
                                        const pid = typeof pidRaw === 'number' ? pidRaw : parseInt(pidRaw, 10);
                                        const c = swapColors[(isNaN(pid) ? 0 : pid) % swapColors.length];
                                        swapStyle = `border: 2px solid ${c.border}; background-color: ${c.bg};`;
                                    }
                                    if (r && r.type === 'skip') {
                                        // IMPORTANT: Underline is historical and must not depend on current missing/disabled state.
                                        // If we have a saved skip reason, always underline.
                                        underline = true;
                                    } else if (r && r.type === 'shift') {
                                        // Person was shifted forward due to reinsertion - do NOT underline them
                                        // Only the direct replacement should be underlined, not those who moved forward
                                        underline = false;
                                    } else if (!r) {
                                        // Fallback for older data: if baseline rotation differs from final assignment, underline.
                                        // BUT: Don't underline if this is a cascading shift (baseline person was disabled/missing)
                                        const dayTypeCategory = (dayType === 'special-holiday')
                                            ? 'special'
                                            : (dayType === 'weekend-holiday')
                                                ? 'weekend'
                                                : (dayType === 'semi-normal-day')
                                                    ? 'semi'
                                                    : 'normal';
                                        const baselineStr = getRotationBaselineAssignmentForType(dayTypeCategory, key);
                                        const baselinePerson = parseAssignedPersonForGroupFromAssignment(baselineStr, g);
                                        if (baselinePerson && baselinePerson !== personName) {
                                            // Double-check: if this person has a shift reason, don't underline
                                            const shiftCheck = getAssignmentReason(key, g, personName);
                                            if (shiftCheck && shiftCheck.type === 'shift') {
                                                underline = false;
                                            } else {
                                                // Check if baseline person was disabled/missing - if so, this is a cascading shift
                                                const dateObj = new Date(key + 'T00:00:00');
                                                const isBaselineDisabledOrMissing = dayTypeCategory === 'normal' && 
                                                    (isPersonDisabledForDuty(baselinePerson, g, dayTypeCategory) || 
                                                     isPersonMissingOnDate(baselinePerson, g, dateObj, dayTypeCategory));
                                                if (isBaselineDisabledOrMissing) {
                                                    // This is a cascading shift - don't underline
                                                    underline = false;
                                                } else {
                                                    // This is a real change - underline
                                                    underline = true;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            const cls = isSwap ? 'duty-person-swapped' : 'duty-person';
                            displayAssignmentHtml += `<div class="${cls}${underline ? ' duty-person-replacement' : ''}" ${swapStyle ? `style="${swapStyle}"` : ''}>${nameOnly}</div>`;
                        }
                        // Optional: show a small marker if there are reasons on this date (without heavy per-person checks)
                        if (shouldShowHeavyIndicators && assignmentReasons[key]) {
                            displayAssignmentHtml += `<div class="duty-person-swapped" title="Υπάρχουν λόγοι αλλαγής/παράλειψης">*</div>`;
                        }
                    displayAssignmentHtml += '</div>';
                    }
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
                
                frag.appendChild(dayDiv);
            }
            
            grid.appendChild(frag);
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
        function normalizePersonKey(personName) {
            return String(personName || '')
                .trim()
                .replace(/^,+\s*/, '')
                .replace(/\s*,+$/, '')
                .replace(/\s+/g, ' ');
        }

        function storeAssignmentReason(dateKey, groupNum, personName, type, reason, swappedWith = null, swapPairId = null, meta = null) {
            const keyName = normalizePersonKey(personName);
            if (!keyName) return;
            if (!assignmentReasons[dateKey]) {
                assignmentReasons[dateKey] = {};
            }
            if (!assignmentReasons[dateKey][groupNum]) {
                assignmentReasons[dateKey][groupNum] = {};
            }
            assignmentReasons[dateKey][groupNum][keyName] = {
                type: type, // 'skip' or 'swap'
                reason: reason,
                swappedWith: swappedWith,
                swapPairId: swapPairId, // For color coding swap pairs
                ...(meta ? { meta } : {})
            };
        }

        function formatGreekDayDate(dateKey) {
            const d = new Date(dateKey + 'T00:00:00');
            if (isNaN(d.getTime())) return { dayName: '', dateStr: dateKey };
            return {
                dayName: getGreekDayName(d),
                dateStr: d.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' })
            };
        }

        // Build swap reason in Greek.
        function buildSwapReasonGreek({ changedWithName, conflictedPersonName, conflictDateKey, newAssignmentDateKey, subjectName = null }) {
            const conflict = formatGreekDayDate(conflictDateKey);
            const assigned = formatGreekDayDate(newAssignmentDateKey);
            const conflictArt = getGreekDayAccusativeArticle(new Date(conflictDateKey + 'T00:00:00'));
            const assignedArt = getGreekDayAccusativeArticle(new Date(newAssignmentDateKey + 'T00:00:00'));
            // Canonical swap sentence (used everywhere: results, cell popup, violations)
            // NOTE: keep "γιατι" spelling to match user preference.
            return `Έγινε η αλλαγή γιατι ο/η ${conflictedPersonName} είχε σύγκρουση ${conflictArt} ${conflict.dayName} ${conflict.dateStr}, και ανατέθηκε ${assignedArt} ${assigned.dayName} ${assigned.dateStr}.`;
        }

        function buildSkipReasonGreek({ skippedPersonName, replacementPersonName, dateKey, monthKey = null }) {
            const d = formatGreekDayDate(dateKey);
            const dayArt = getGreekDayAccusativeArticle(new Date(dateKey + 'T00:00:00'));
            const monthPart = monthKey ? ` (${monthKey})` : '';
            return `Αντικατέστησε τον/την ${skippedPersonName} επειδή είχε κώλυμα${monthPart} ${dayArt} ${d.dayName} ${d.dateStr}. Ανατέθηκε ο/η ${replacementPersonName}.`;
        }

        // Return the adjacent day (before/after) that causes the consecutive-duty conflict.
        // Prefers the "after" day when both sides conflict (matches user expectation like Thu conflict with Fri -> show Fri).
        // Returns null if no adjacent conflict is detected.
        function getConsecutiveConflictNeighborDayKey(dayKey, person, groupNum, simulatedAssignments = null) {
            const date = new Date(dayKey + 'T00:00:00');
            if (isNaN(date.getTime())) return null;

            const currentDayType = getDayType(date);
            let currentTypeCategory = 'normal';
            if (currentDayType === 'special-holiday') currentTypeCategory = 'special';
            else if (currentDayType === 'semi-normal-day') currentTypeCategory = 'semi';
            else if (currentDayType === 'weekend-holiday') currentTypeCategory = 'weekend';

            const hasConflict = (type1, type2) => {
                if (type1 === 'normal' && (type2 === 'semi' || type2 === 'weekend' || type2 === 'special')) return true;
                if ((type1 === 'semi' || type1 === 'weekend' || type1 === 'special') && type2 === 'normal') return true;
                if (type1 === 'semi' && (type2 === 'weekend' || type2 === 'special')) return true;
                if ((type1 === 'weekend' || type1 === 'special') && type2 === 'semi') return true;
                return false;
            };

            const checkNeighbor = (neighborDate) => {
                const neighborKey = formatDateKey(neighborDate);
                const neighborType = getDayType(neighborDate);
                let neighborTypeCategory = 'normal';
                if (neighborType === 'special-holiday') neighborTypeCategory = 'special';
                else if (neighborType === 'semi-normal-day') neighborTypeCategory = 'semi';
                else if (neighborType === 'weekend-holiday') neighborTypeCategory = 'weekend';

                if (!hasConflict(currentTypeCategory, neighborTypeCategory)) return false;

                // Determine if person has duty on neighbor day (simulated preferred)
                if (simulatedAssignments) {
                    const neighborMonthKey = `${neighborDate.getFullYear()}-${neighborDate.getMonth()}`;
                    if (neighborTypeCategory === 'special') {
                        return simulatedAssignments.special?.[neighborMonthKey]?.[groupNum]?.has(person) || false;
                    }
                    if (neighborTypeCategory === 'weekend') {
                        return simulatedAssignments.weekend?.[neighborKey]?.[groupNum] === person;
                    }
                    if (neighborTypeCategory === 'semi') {
                        return simulatedAssignments.semi?.[neighborKey]?.[groupNum] === person;
                    }
                    // normal
                    return simulatedAssignments.normal?.[neighborKey]?.[groupNum] === person;
                }

                return hasDutyOnDay(neighborKey, person, groupNum);
            };

            const dayAfter = new Date(date);
            dayAfter.setDate(dayAfter.getDate() + 1);
            if (checkNeighbor(dayAfter)) return formatDateKey(dayAfter);

            const dayBefore = new Date(date);
            dayBefore.setDate(dayBefore.getDate() - 1);
            if (checkNeighbor(dayBefore)) return formatDateKey(dayBefore);

            return null;
        }
        
        // Helper function to get assignment reason
        function getAssignmentReason(dateKey, groupNum, personName) {
            const gmap = assignmentReasons[dateKey]?.[groupNum] || null;
            if (!gmap) return null;
            // Backward compatible: try exact key first, then normalized key.
            return gmap[personName] || gmap[normalizePersonKey(personName)] || null;
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
            // ALSO: If day after is in next month (beyond calculation range), temporarily calculate assignment based on rotation
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
                                
                                // Check if we have the current rotation position from the preview.
                                // This may be either:
                                // - a numeric index (legacy expectation), or
                                // - a personName (since we switched last rotation tracking to names)
                                let rotationPosition;
                                const rotationSeed = simulatedAssignments?.normalRotationPositions?.[groupNum];
                                if (rotationSeed !== undefined && rotationSeed !== null) {
                                    if (typeof rotationSeed === 'number') {
                                        rotationPosition = rotationSeed % rotationDays;
                                    } else if (typeof rotationSeed === 'string') {
                                        const idx = groupPeople.indexOf(rotationSeed);
                                        rotationPosition = idx >= 0 ? (idx + 1) % rotationDays : (getRotationPosition(dayAfter, 'normal', groupNum) % rotationDays);
                                    } else {
                                        rotationPosition = getRotationPosition(dayAfter, 'normal', groupNum) % rotationDays;
                                    }
                                } else {
                                    // Fallback: calculate rotation position for day after
                                    rotationPosition = getRotationPosition(dayAfter, 'normal', groupNum) % rotationDays;
                                }
                                
                                // Predict who would be assigned on dayAfter, but respect disabled/missing skips
                                let expectedPerson = null;
                                for (let off = 0; off < rotationDays; off++) {
                                    const idx = (rotationPosition + off) % rotationDays;
                                    const cand = groupPeople[idx];
                                    if (!cand) continue;
                                    if (isPersonMissingOnDate(cand, groupNum, dayAfter, 'normal')) continue;
                                    expectedPerson = cand;
                                    break;
                                }
                                
                                // If this person is expected to be assigned to day after, it's a conflict
                                if (expectedPerson === person && !isPersonMissingOnDate(person, groupNum, dayAfter, 'normal')) {
                                    hasDutyAfter = true;
                                }
                            }
                        } else if (calculationEndDate && dayAfter > calculationEndDate) {
                            // Day after is in next month (beyond calculation range) - temporarily calculate assignment
                            // This is similar to getPersonFromNextMonth logic but for conflict detection only
                            const groupData = groups[groupNum] || { normal: [] };
                            const groupPeople = groupData.normal || [];
                            if (groupPeople.length > 0) {
                                const rotationDays = groupPeople.length;
                                
                                // Calculate rotation position for day after in next month.
                                // Use the last rotation seed from current month if available (numeric or personName), otherwise calculate.
                                let rotationPosition;
                                const rotationSeed = simulatedAssignments?.normalRotationPositions?.[groupNum];
                                if (rotationSeed !== undefined && rotationSeed !== null) {
                                    if (typeof rotationSeed === 'number') {
                                        rotationPosition = (rotationSeed + 1) % rotationDays;
                                    } else if (typeof rotationSeed === 'string') {
                                        const idx = groupPeople.indexOf(rotationSeed);
                                        rotationPosition = idx >= 0 ? (idx + 1) % rotationDays : (getRotationPosition(dayAfter, 'normal', groupNum) % rotationDays);
                                    } else {
                                        rotationPosition = getRotationPosition(dayAfter, 'normal', groupNum) % rotationDays;
                                    }
                                } else {
                                    // Fallback: calculate rotation position for day after
                                    rotationPosition = getRotationPosition(dayAfter, 'normal', groupNum) % rotationDays;
                                }
                                
                                // Predict who would be assigned on dayAfter (next month), but respect disabled/missing skips
                                let expectedPerson = null;
                                for (let off = 0; off < rotationDays; off++) {
                                    const idx = (rotationPosition + off) % rotationDays;
                                    const cand = groupPeople[idx];
                                    if (!cand) continue;
                                    if (isPersonMissingOnDate(cand, groupNum, dayAfter, 'normal')) continue;
                                    expectedPerson = cand;
                                    break;
                                }
                                
                                // If this person is expected to be assigned to day after in next month, it's a conflict
                                if (expectedPerson === person && !isPersonMissingOnDate(person, groupNum, dayAfter, 'normal')) {
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
            const endMonthInput = document.getElementById('calculateEndMonth');
            const preserveCheckbox = document.getElementById('preserveExistingAssignments');
            
            if (startMonthInput) {
                startMonthInput.value = `${currentYear}-${currentMonth}`;
            }
            if (endMonthInput) {
                endMonthInput.value = '';
            }
            if (preserveCheckbox) {
                // Default view should be UNCHECKED
                preserveCheckbox.checked = false;
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
            installFor('calculateEndMonth');
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
            const stepTitleText = document.getElementById('stepByStepModalTitleText');
            const backButton = document.getElementById('backButton');
            const cancelButton = document.getElementById('stepCancelButton');
            const nextButton = document.getElementById('nextButton');
            const calculateButton = document.getElementById('calculateButton');
            const stepModalEl = document.getElementById('stepByStepCalculationModal');
            
            if (stepNumber) stepNumber.textContent = calculationSteps.currentStep;

            if (stepTitleText) {
                if (calculationSteps.currentStep === 1) stepTitleText.textContent = 'Υπολογισμός Υπηρεσιών Ειδικών Αργιών';
                else if (calculationSteps.currentStep === 2) stepTitleText.textContent = 'Υπολογισμός Υπηρεσιών Αργιών';
                else if (calculationSteps.currentStep === 3) stepTitleText.textContent = 'Υπολογισμός Υπηρεσιών Ημιαργιών';
                else if (calculationSteps.currentStep === 4) stepTitleText.textContent = 'Υπολογισμός Υπηρεσιών Καθημερινών';
                else stepTitleText.textContent = 'Υπολογισμός Υπηρεσιών';
            }

            // Apply per-step theme (Special/Weekend/Semi/Normal) to title bar, alerts, and table header fills.
            if (stepModalEl) {
                stepModalEl.classList.remove('calc-theme-special', 'calc-theme-weekend', 'calc-theme-semi', 'calc-theme-normal');
                if (calculationSteps.currentStep === 1) stepModalEl.classList.add('calc-theme-special');
                else if (calculationSteps.currentStep === 2) stepModalEl.classList.add('calc-theme-weekend');
                else if (calculationSteps.currentStep === 3) stepModalEl.classList.add('calc-theme-semi');
                else if (calculationSteps.currentStep === 4) stepModalEl.classList.add('calc-theme-normal');
            }
            
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

        function setStepFooterBusy(isBusy) {
            calculationSteps.isTransitioning = !!isBusy;
            const backButton = document.getElementById('backButton');
            const nextButton = document.getElementById('nextButton');
            const cancelButton = document.getElementById('stepCancelButton');
            const calculateButton = document.getElementById('calculateButton');

            const buttons = [backButton, nextButton, cancelButton, calculateButton].filter(Boolean);
            buttons.forEach(btn => {
                btn.disabled = !!isBusy;
                // Requirement: do not show command buttons until next step is calculated.
                btn.style.visibility = isBusy ? 'hidden' : 'visible';
            });
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
            
            const periodLabel = buildPeriodLabel(startDate, endDate);
            let html = '<div class="step-content">';
            html += `<h6 class="mb-3"><i class="fas fa-calendar-alt me-2"></i>Περίοδος: ${periodLabel}</h6>`;
            
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
                html += `<th>${getGroupName(1)}</th>`;
                html += `<th>${getGroupName(2)}</th>`;
                html += `<th>${getGroupName(3)}</th>`;
                html += `<th>${getGroupName(4)}</th>`;
                html += '</tr>';
                html += '</thead>';
                html += '<tbody>';
                
                // Sort special holidays by date
                const sortedSpecial = [...specialHolidays].sort();
                
                // Store assignments and rotation positions for saving when Next is pressed
                const tempSpecialAssignments = {}; // dateKey -> { groupNum -> personName }
                // Track rotation persons (who SHOULD be assigned according to rotation, before missing/skip)
                const specialRotationPersons = {}; // dateKey -> { groupNum -> rotationPerson }
                // For missing replacement: keep a simulated set of special assignments so hasConsecutiveDuty can validate neighbors.
                const simulatedSpecialAssignmentsForConflict = {}; // monthKey -> { groupNum -> Set(person) }
                
                // Initialize global rotation positions for special holidays (once per group, before processing dates)
                const globalSpecialRotationPosition = {}; // groupNum -> global position (continues across months)
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const groupData = groups[groupNum] || { special: [] };
                    const groupPeople = groupData.special || [];
                    
                    if (groupPeople.length > 0) {
                        const rotationDays = groupPeople.length;
                        // If start date is February 2026, always start from first person (position 0)
                        const isFebruary2026 = calculationSteps.startDate && 
                            calculationSteps.startDate.getFullYear() === 2026 && 
                            calculationSteps.startDate.getMonth() === 1; // Month 1 = February (0-indexed)
                        
                        if (isFebruary2026) {
                            // Always start from first person for February 2026
                            globalSpecialRotationPosition[groupNum] = 0;
                            console.log(`[SPECIAL ROTATION] Starting from first person (position 0) for group ${groupNum} - February 2026`);
                        } else {
                            // Continue from last person assigned in previous month (month-scoped; falls back to legacy)
                            const seedDate = sortedSpecial.length > 0 ? new Date(sortedSpecial[0] + 'T00:00:00') : new Date(startDate);
                            const lastPersonName = getLastRotationPersonForDate('special', seedDate, groupNum);
                            const lastPersonIndex = groupPeople.indexOf(lastPersonName);
                            if (lastPersonName && lastPersonIndex >= 0) {
                                // Found last person - start from next person
                                globalSpecialRotationPosition[groupNum] = (lastPersonIndex + 1) % rotationDays;
                                console.log(`[SPECIAL ROTATION] Continuing from last person ${lastPersonName} (index ${lastPersonIndex}) for group ${groupNum}, starting at position ${globalSpecialRotationPosition[groupNum]}`);
                            } else {
                                // Last person not found in list - use rotation calculation from first date
                                if (sortedSpecial.length > 0) {
                                    const firstDate = new Date(sortedSpecial[0] + 'T00:00:00');
                                    const daysSinceStart = getRotationPosition(firstDate, 'special', groupNum);
                                    globalSpecialRotationPosition[groupNum] = daysSinceStart % rotationDays;
                                    if (lastPersonName) {
                                        console.log(`[SPECIAL ROTATION] Last person ${lastPersonName} not found in group ${groupNum} list, using rotation calculation: position ${globalSpecialRotationPosition[groupNum]}`);
                                    }
                                } else {
                                    globalSpecialRotationPosition[groupNum] = 0;
                                }
                            }
                        }
                    }
                }
                
                sortedSpecial.forEach((dateKey, specialIndex) => {
                    const date = new Date(dateKey + 'T00:00:00');
                    const dateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const dayName = getGreekDayName(date);
                    const monthKeyForConflict = `${date.getFullYear()}-${date.getMonth()}`;
                    if (!simulatedSpecialAssignmentsForConflict[monthKeyForConflict]) {
                        simulatedSpecialAssignmentsForConflict[monthKeyForConflict] = {};
                    }
                    
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
                    html += `<td><strong>${dateStr}</strong></td>`;
                    html += `<td>${holidayName || 'Ειδική Αργία'}</td>`;
                    
                    // Calculate who will be assigned for each group based on rotation order
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [] };
                        const groupPeople = groupData.special || [];
                        
                        if (groupPeople.length === 0) {
                            html += '<td class="text-muted">-</td>';
                        } else {
                                const rotationDays = groupPeople.length;
                            // Use the global rotation position (initialized once per group)
                            let rotationPosition = globalSpecialRotationPosition[groupNum] % rotationDays;
                            
                            // IMPORTANT: Track the rotation person (who SHOULD be assigned according to rotation)
                            // This is the person BEFORE any missing logic
                            const rotationPerson = groupPeople[rotationPosition];
                            if (!specialRotationPersons[dateKey]) {
                                specialRotationPersons[dateKey] = {};
                            }
                            specialRotationPersons[dateKey][groupNum] = rotationPerson;

                            let assignedPerson = rotationPerson;
                            
                            // CRITICAL: Check if the rotation person is disabled/missing BEFORE any other logic.
                            // This ensures disabled people are ALWAYS skipped, even when rotation cycles back to them.
                            let wasReplaced = false;
                            let replacementIndex = null;
                            if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date, 'special')) {
                                // Simply skip disabled person and find next person in rotation who is NOT disabled/missing
                                // Keep going through rotation until we find someone eligible (check entire rotation twice to be thorough)
                                let foundReplacement = false;
                                for (let offset = 1; offset <= rotationDays * 2 && !foundReplacement; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (!isPersonMissingOnDate(candidate, groupNum, date, 'special')) {
                                        assignedPerson = candidate;
                                        replacementIndex = idx;
                                        wasReplaced = true;
                                        foundReplacement = true;
                                        storeAssignmentReason(
                                            dateKey,
                                            groupNum,
                                            assignedPerson,
                                            'skip',
                                            buildUnavailableReplacementReason({
                                                skippedPersonName: rotationPerson,
                                                replacementPersonName: assignedPerson,
                                                dateObj: date,
                                                groupNum,
                                                dutyCategory: 'special'
                                            }),
                                            rotationPerson,
                                            null
                                        );
                                        break;
                                    }
                                }
                                // If no replacement found after checking everyone twice (everyone disabled), leave unassigned
                                if (!foundReplacement) {
                                    assignedPerson = null;
                                }
                            }

                            // Step 1 is special-holidays only: preview reflects missing replacement only (no weekend skip logic here).
                            
                            // Store assignment for saving
                            if (assignedPerson) {
                                if (!tempSpecialAssignments[dateKey]) {
                                    tempSpecialAssignments[dateKey] = {};
                                }
                                tempSpecialAssignments[dateKey][groupNum] = assignedPerson;

                                // Track in simulated set for neighbor-conflict checking
                                if (!simulatedSpecialAssignmentsForConflict[monthKeyForConflict][groupNum]) {
                                    simulatedSpecialAssignmentsForConflict[monthKeyForConflict][groupNum] = new Set();
                                }
                                simulatedSpecialAssignmentsForConflict[monthKeyForConflict][groupNum].add(assignedPerson);
                                
                                // Advance rotation position from the person ACTUALLY assigned (not the skipped person)
                                // This ensures that when Person A is replaced by Person B, next special-duty assigns Person C, not Person B again
                                if (wasReplaced && replacementIndex !== null) {
                                    // Person was replaced - advance from replacement's position
                                    globalSpecialRotationPosition[groupNum] = (replacementIndex + 1) % rotationDays;
                                } else {
                                    // No replacement - advance from assigned person's position
                                    const assignedIndex = groupPeople.indexOf(assignedPerson);
                                    if (assignedIndex !== -1) {
                                        globalSpecialRotationPosition[groupNum] = (assignedIndex + 1) % rotationDays;
                                    } else {
                                        // Fallback: advance from rotation position
                                        globalSpecialRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                    }
                                }
                            } else {
                                // No person found, still advance rotation position
                                globalSpecialRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
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
                                    daysCountInfo = ` <span class="text-info">${daysSince}/${rotationDays} ημέρες</span>`;
                                } else if (daysSince === Infinity) {
                                    daysCountInfo = ' <span class="text-success">πρώτη φορά</span>';
                                }
                            }
                            
                            html += `<td>${buildBaselineComputedCellHtml(rotationPerson, assignedPerson, daysCountInfo, lastDutyInfo)}</td>`;
                        }
                    }
                    
                    html += '</tr>';
                });
                
                // Store assignments and rotation positions in calculationSteps for saving when Next is pressed
                calculationSteps.tempSpecialAssignments = tempSpecialAssignments;
                // Store pure rotation baseline (before missing replacement) for saving to Firestore
                calculationSteps.tempSpecialBaselineAssignments = specialRotationPersons;

                // Store last rotation person for each group (overall, for end-of-range continuation)
                // IMPORTANT: Use the ASSIGNED person (after replacement), not the rotation person
                // This ensures that when Person A is replaced by Person B, next calculation starts from Person B's position
                calculationSteps.lastSpecialRotationPositions = {};
                for (let g = 1; g <= 4; g++) {
                    let lastAssignedPerson = null;
                    for (let i = sortedSpecial.length - 1; i >= 0; i--) {
                        const dateKey = sortedSpecial[i];
                        if (tempSpecialAssignments[dateKey] && tempSpecialAssignments[dateKey][g]) {
                            lastAssignedPerson = tempSpecialAssignments[dateKey][g];
                            break;
                        }
                    }
                    if (lastAssignedPerson) {
                        calculationSteps.lastSpecialRotationPositions[g] = lastAssignedPerson;
                        console.log(`[SPECIAL ROTATION] Storing last assigned person ${lastAssignedPerson} for group ${g} (after replacement)`);
                    }
                }

                // Store last rotation person per month (for correct recalculation of individual months)
                // IMPORTANT: Use the ASSIGNED person (after replacement), not the rotation person
                // This ensures that when Person A is replaced by Person B, next calculation starts from Person B's position
                const lastSpecialRotationPositionsByMonth = {}; // monthKey -> { groupNum -> assignedPerson }
                for (const dateKey of sortedSpecial) {
                    const d = new Date(dateKey + 'T00:00:00');
                    const monthKey = getMonthKeyFromDate(d);
                    for (let g = 1; g <= 4; g++) {
                        // Use the assigned person (after replacement), not the rotation person
                        const assignedPerson = tempSpecialAssignments[dateKey]?.[g];
                        if (assignedPerson) {
                            if (!lastSpecialRotationPositionsByMonth[monthKey]) {
                                lastSpecialRotationPositionsByMonth[monthKey] = {};
                            }
                            lastSpecialRotationPositionsByMonth[monthKey][g] = assignedPerson;
                        }
                    }
                }
                calculationSteps.lastSpecialRotationPositionsByMonth = lastSpecialRotationPositionsByMonth;
                
                html += '</tbody>';
                html += '</table>';
                html += '</div>';
            }
            
            html += '</div>';
            stepContent.innerHTML = html;
        }

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
                            }).split('.').filter(Boolean)[0] || '';
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
        async function goToNextStep() {
            // If moving from Step 1 (Special Holidays), save assignments to Firestore
            if (calculationSteps.currentStep === 1) {
                // Show results window first; save + proceed only after OK
                showSpecialHolidayResultsAndProceed();
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
                const tempSpecialBaselineAssignments = calculationSteps.tempSpecialBaselineAssignments || {};
                const lastSpecialRotationPositionsByMonth = calculationSteps.lastSpecialRotationPositionsByMonth || {};
                
                // Save special holiday assignments to Firestore
                if (Object.keys(tempSpecialAssignments).length > 0) {
                    // Organize by month
                    const organizedSpecial = organizeAssignmentsByMonth(tempSpecialAssignments);
                    const sanitizedSpecial = sanitizeForFirestore(organizedSpecial);
                    
                    await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'specialHolidayAssignments', organizedSpecial);
                    console.log('Saved Step 1 special holiday assignments to Firestore:', Object.keys(tempSpecialAssignments).length, 'dates');
                    
                    // Also update local memory
                    Object.assign(specialHolidayAssignments, tempSpecialAssignments);
                }

                // Save special-holiday rotation baseline (pure rotation order) to Firestore
                if (Object.keys(tempSpecialBaselineAssignments).length > 0) {
                    const formattedBaseline = formatGroupAssignmentsToStringMap(tempSpecialBaselineAssignments);
                    const organizedBaseline = organizeAssignmentsByMonth(formattedBaseline);
                    await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'rotationBaselineSpecialAssignments', organizedBaseline);
                    Object.assign(rotationBaselineSpecialAssignments, formattedBaseline);
                }
                
                // Save last rotation positions for special holidays (per month)
                if (Object.keys(lastSpecialRotationPositionsByMonth).length > 0) {
                    for (const monthKey in lastSpecialRotationPositionsByMonth) {
                        const groupsForMonth = lastSpecialRotationPositionsByMonth[monthKey] || {};
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            if (groupsForMonth[groupNum] !== undefined) {
                                setLastRotationPersonForMonth('special', monthKey, groupNum, groupsForMonth[groupNum]);
                            }
                        }
                    }
                    
                    // Save to Firestore
                    const sanitizedPositions = sanitizeForFirestore(lastRotationPositions);
                    await db.collection('dutyShifts').doc('lastRotationPositions').set({
                        ...sanitizedPositions,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Saved Step 1 last rotation positions for special holidays (per month) to Firestore:', lastSpecialRotationPositionsByMonth);
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
                const tempWeekendBaselineAssignments = calculationSteps.tempWeekendBaselineAssignments || {};
                const lastWeekendRotationPositionsByMonth = calculationSteps.lastWeekendRotationPositionsByMonth || {};
                
                // Save weekend rotation baseline (pure rotation order) to Firestore
                if (Object.keys(tempWeekendBaselineAssignments).length > 0) {
                    const formattedBaseline = formatGroupAssignmentsToStringMap(tempWeekendBaselineAssignments);
                    const organizedBaseline = organizeAssignmentsByMonth(formattedBaseline);
                    await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'rotationBaselineWeekendAssignments', organizedBaseline);
                    Object.assign(rotationBaselineWeekendAssignments, formattedBaseline);
                }
                
                // NOTE: legacy dutyShifts/assignments is deprecated; we no longer save pre-skip snapshots there.
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
                    
                    // Update local memory (for preview and subsequent steps)
                    Object.assign(weekendAssignments, formattedAssignments);
                }
                
                // Save last rotation positions for weekends (per month)
                if (Object.keys(lastWeekendRotationPositionsByMonth).length > 0) {
                    for (const monthKey in lastWeekendRotationPositionsByMonth) {
                        const groupsForMonth = lastWeekendRotationPositionsByMonth[monthKey] || {};
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            if (groupsForMonth[groupNum] !== undefined) {
                                setLastRotationPersonForMonth('weekend', monthKey, groupNum, groupsForMonth[groupNum]);
                            }
                        }
                    }
                    
                    // Save to Firestore
                    const sanitizedPositions = sanitizeForFirestore(lastRotationPositions);
                    await db.collection('dutyShifts').doc('lastRotationPositions').set({
                        ...sanitizedPositions,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Saved Step 2 last rotation positions for weekends (per month) to Firestore:', lastWeekendRotationPositionsByMonth);
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
                                
                                if (!candidate || isPersonMissingOnDate(candidate, groupNum, date, 'weekend')) {
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

                                // Store skip reason on the ASSIGNED person so it shows in calendar/modal
                                // (calendar checks reasons by currently displayed person name)
                                const monthReason = hasSpecialHoliday
                                    ? 'ειδική αργία στον ίδιο μήνα'
                                    : 'ήταν ήδη παραλειφθεί αυτόν τον μήνα';
                                storeAssignmentReason(
                                    dateKey,
                                    groupNum,
                                    replacementPerson,
                                    'skip',
                                    `Αντικατέστησε τον/την ${currentPerson} επειδή είχε ${monthReason} ${getGreekDayAccusativeArticle(date)} ${getGreekDayName(date)} ${date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' })}. Ανατέθηκε ο/η ${replacementPerson}.`,
                                    currentPerson,
                                    null
                                );
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
                        ? (reasonText ? reasonText.split('.').filter(Boolean)[0] : buildUnavailableReplacementReason({
                            skippedPersonName: base,
                            replacementPersonName: comp,
                            dateObj,
                            groupNum,
                            dutyCategory: 'weekend'
                        }).split('.').filter(Boolean)[0])
                        : '';
                    // Prefer the saved reason sentence (first sentence) when available.
                    // This keeps the results window consistent with the requested style:
                    // "Αντικατέστησε τον/την ... επειδή είχε ειδική αργία στον ίδιο μήνα ..."
                    let briefReason = '';
                    if (derivedUnavailable) {
                        briefReason = derivedUnavailable;
                    } else if (reasonText) {
                        briefReason = reasonText.split('.').filter(Boolean)[0] || '';
                    } else if (hasSpecialHolidayDutyInMonth(base, groupNum, dateObj.getMonth(), dateObj.getFullYear())) {
                        // Fallback: no saved reason (older data) — still show the sentence style.
                        const dayArt = getGreekDayAccusativeArticle(dateObj);
                        const dayName = getGreekDayName(dateObj);
                        briefReason = `Αντικατέστησε τον/την ${base} επειδή είχε ειδική αργία στον ίδιο μήνα ${dayArt} ${dayName} ${dateStr}`;
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
                                // Store the last assigned person for this month/group (will be overwritten by later dates)
                                finalWeekendRotationPositionsByMonth[monthKey][groupNum] = assignedPerson;
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
                const tempSemiBaselineAssignments = calculationSteps.tempSemiBaselineAssignments || {};
                const lastSemiRotationPositionsByMonth = calculationSteps.lastSemiRotationPositionsByMonth || {};
                
                // Save semi-normal rotation baseline (pure rotation order) to Firestore
                if (Object.keys(tempSemiBaselineAssignments).length > 0) {
                    const formattedBaseline = formatGroupAssignmentsToStringMap(tempSemiBaselineAssignments);
                    const organizedBaseline = organizeAssignmentsByMonth(formattedBaseline);
                    await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'rotationBaselineSemiAssignments', organizedBaseline);
                    Object.assign(rotationBaselineSemiAssignments, formattedBaseline);
                }
                
                // NOTE: legacy dutyShifts/assignments is deprecated; we no longer save pre-logic snapshots there.
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
                    
                    // Update local memory (for preview and subsequent steps)
                    Object.assign(semiNormalAssignments, formattedAssignments);
                }
                
                // Save last rotation positions for semi-normal (per month)
                if (Object.keys(lastSemiRotationPositionsByMonth).length > 0) {
                    for (const monthKey in lastSemiRotationPositionsByMonth) {
                        const groupsForMonth = lastSemiRotationPositionsByMonth[monthKey] || {};
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            if (groupsForMonth[groupNum] !== undefined) {
                                setLastRotationPersonForMonth('semi', monthKey, groupNum, groupsForMonth[groupNum]);
                            }
                        }
                    }
                    
                    // Save to Firestore
                    const sanitizedPositions = sanitizeForFirestore(lastRotationPositions);
                    await db.collection('dutyShifts').doc('lastRotationPositions').set({
                        ...sanitizedPositions,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Saved Step 3 last rotation positions for semi-normal (per month) to Firestore:', lastSemiRotationPositionsByMonth);
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
                
                // Helper: check if a person would have a semi-normal consecutive conflict on a given semi-normal day
                // Conflict rules for semi-normal swaps: semi conflicts with weekend/special on day before/after.
                const hasSemiConsecutiveConflictForPerson = (semiDateKey, person, groupNum) => {
                    const semiDate = new Date(semiDateKey + 'T00:00:00');
                    if (isNaN(semiDate.getTime())) return false;
                    const dayType = getDayType(semiDate);
                    if (dayType !== 'semi-normal-day') return false;

                    const checkNeighbor = (neighborDate) => {
                        const neighborType = getDayType(neighborDate);
                        const neighborKey = formatDateKey(neighborDate);
                        if (neighborType === 'weekend-holiday') {
                            return simulatedWeekendAssignments[neighborKey]?.[groupNum] === person;
                        }
                        if (neighborType === 'special-holiday') {
                            const neighborMonthKey = `${neighborDate.getFullYear()}-${neighborDate.getMonth()}`;
                            return simulatedSpecialAssignments[neighborMonthKey]?.[groupNum]?.has(person) || false;
                        }
                        return false;
                    };

                    const dayBefore = new Date(semiDate);
                    dayBefore.setDate(dayBefore.getDate() - 1);
                    const dayAfter = new Date(semiDate);
                    dayAfter.setDate(dayAfter.getDate() + 1);

                    return checkNeighbor(dayBefore) || checkNeighbor(dayAfter);
                };

                // Prevent re-swapping the same semi-normal days repeatedly in one run
                const swappedSemiSet = new Set(); // `${dateKey}:${groupNum}`

                // Run swap logic (check for consecutive conflicts with weekend or special holiday)
                sortedSemi.forEach((dateKey, semiIndex) => {
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

                        // Skip if this date/group was already swapped in this run
                        if (swappedSemiSet.has(`${dateKey}:${groupNum}`)) {
                            continue;
                        }
                        
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
                            // NEW RULE: swap with the next semi-normal day(s) in chronological order.
                            // Try the immediate next semi-normal day first; if swap would cause a conflict for either person,
                            // continue to the next semi-normal day, etc.
                            let swapCandidate = null;
                            let swapDateKey = null;

                            for (let j = semiIndex + 1; j < sortedSemi.length; j++) {
                                const candidateDateKey = sortedSemi[j];
                                const candidateDate = new Date(candidateDateKey + 'T00:00:00');
                                if (isNaN(candidateDate.getTime())) continue;

                                // Candidate is the person currently assigned on the next semi-normal day
                                const candidatePerson = updatedAssignments[candidateDateKey]?.[groupNum];
                                if (!candidatePerson) continue;

                                // Avoid re-swapping a day already swapped in this run
                                if (swappedSemiSet.has(`${candidateDateKey}:${groupNum}`)) continue;

                                // Both must be available on their new dates
                                if (isPersonMissingOnDate(candidatePerson, groupNum, date, 'semi')) continue;
                                if (isPersonMissingOnDate(currentPerson, groupNum, candidateDate, 'semi')) continue;

                                // Validate: after swap, neither person has a semi consecutive conflict on their new semi day
                                const candidateWouldConflict = hasSemiConsecutiveConflictForPerson(dateKey, candidatePerson, groupNum);
                                const currentWouldConflict = hasSemiConsecutiveConflictForPerson(candidateDateKey, currentPerson, groupNum);

                                if (!candidateWouldConflict && !currentWouldConflict) {
                                    swapCandidate = candidatePerson;
                                    swapDateKey = candidateDateKey;
                                    break;
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

                                // Mark both days as swapped in this run to prevent re-swapping loops
                                swappedSemiSet.add(`${dateKey}:${groupNum}`);
                                swappedSemiSet.add(`${swapDateKey}:${groupNum}`);
                                
                                // Store assignment reasons for both swapped people with swap pair ID
                                // Use the ACTUAL conflict neighbor day (e.g. Fri) instead of the swap-execution day (e.g. Thu).
                                const conflictNeighborKey = getConsecutiveConflictNeighborDayKey(dateKey, currentPerson, groupNum, {
                                    special: simulatedSpecialAssignments,
                                    weekend: simulatedWeekendAssignments,
                                    semi: updatedAssignments,
                                    normal: null
                                }) || dateKey;
                                storeAssignmentReason(
                                    dateKey,
                                    groupNum,
                                    swapCandidate,
                                    'swap',
                                    buildSwapReasonGreek({
                                        changedWithName: currentPerson,
                                        conflictedPersonName: currentPerson,
                                        conflictDateKey: conflictNeighborKey,
                                        newAssignmentDateKey: swapDateKey,
                                        subjectName: swapCandidate
                                    }),
                                    currentPerson,
                                    swapPairId
                                );
                                storeAssignmentReason(
                                    swapDateKey,
                                    groupNum,
                                    currentPerson,
                                    'swap',
                                    buildSwapReasonGreek({
                                        changedWithName: swapCandidate,
                                        conflictedPersonName: currentPerson,
                                        conflictDateKey: conflictNeighborKey,
                                        newAssignmentDateKey: swapDateKey,
                                        subjectName: currentPerson
                                    }),
                                    swapCandidate,
                                    swapPairId
                                );
                                
                                // IMPORTANT: Stop processing this conflict - swap found, don't try cross-month swap
                                // Break out of the loop to prevent unnecessary swaps
                                break;
                            } else {
                                // No swap found in current month - try cross-month swap
                                // For semi-normal, check next month throughout the entire month (not just last 3 days)
                                // Calculate current rotation position for semi-normal
                                const rotationDays = groupPeople.length;
                                const currentIndex = groupPeople.indexOf(currentPerson);
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
                                    if (!nextMonthPersonHasConflict && isPersonMissingOnDate(nextMonthPerson, groupNum, date, 'semi')) {
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
                                        // Improved Greek reasons (cross-month):
                                        // Use the ACTUAL conflict neighbor day (e.g. Fri) instead of the swap-execution day.
                                        const conflictNeighborKey = getConsecutiveConflictNeighborDayKey(dateKey, currentPerson, groupNum, {
                                            special: simulatedSpecialAssignments,
                                            weekend: simulatedWeekendAssignments,
                                            semi: updatedAssignments,
                                            normal: null
                                        }) || dateKey;
                                        // Mark the person from next month who was swapped in (now assigned to current date)
                                        storeAssignmentReason(
                                            dateKey,
                                            groupNum,
                                            nextMonthPerson,
                                            'swap',
                                            buildSwapReasonGreek({
                                                changedWithName: currentPerson,
                                                conflictedPersonName: currentPerson,
                                                conflictDateKey: conflictNeighborKey,
                                                newAssignmentDateKey: swapDayKey,
                                                subjectName: nextMonthPerson
                                            }),
                                            currentPerson,
                                            swapPairId
                                        );
                                        // Also mark the conflicted person who will be assigned to next month (cross-month swap)
                                        storeAssignmentReason(
                                            swapDayKey,
                                            groupNum,
                                            currentPerson,
                                            'swap',
                                            buildSwapReasonGreek({
                                                changedWithName: nextMonthPerson,
                                                conflictedPersonName: currentPerson,
                                                conflictDateKey: conflictNeighborKey,
                                                newAssignmentDateKey: swapDayKey,
                                                subjectName: currentPerson
                                            }),
                                            nextMonthPerson,
                                            swapPairId
                                        );
                                        
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

            const baselineByDate = calculationSteps.tempSemiBaselineAssignments || {};
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
                    const briefReason = reasonText
                        ? reasonText.split('.').filter(Boolean)[0]
                        : ((isPersonDisabledForDuty(base, groupNum, 'semi') || isPersonMissingOnDate(base, groupNum, dateObj, 'semi'))
                            ? (buildUnavailableReplacementReason({
                                skippedPersonName: base,
                                replacementPersonName: comp,
                                dateObj,
                                groupNum,
                                dutyCategory: 'semi'
                            }).split('.').filter(Boolean)[0] || '')
                            : 'Αλλαγή');

                    const otherKey = reasonObj?.type === 'swap'
                        ? findSwapOtherDateKey(reasonObj.swapPairId, groupNum, dateKey)
                        : null;
                    const swapDateStr = otherKey
                        ? new Date(otherKey + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' })
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
                message = '<div class="alert alert-success"><i class="fas fa-check-circle me-2"></i><strong>Καμία αλλαγή!</strong><br>Δεν βρέθηκαν αλλαγές στις ημιαργίες.</div>';
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
                <div class="modal fade" id="semiNormalSwapResultsModal" tabindex="-1">
                    <div class="modal-dialog modal-xl modal-superwide">
                        <div class="modal-content results-modal-semi">
                            <div class="modal-header results-header results-header-semi">
                                <h5 class="modal-title"><i class="fas fa-exchange-alt me-2"></i>Αποτελέσματα Αλλαγών Ημιαργιών</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                            </div>
                            <div class="modal-body">
                                ${message}
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-primary" id="semiNormalSwapOkButton">OK</button>
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
                    const originalOkHtml = okButton.innerHTML;
                    okButton.disabled = true;
                    okButton.classList.add('is-saving');
                    okButton.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Αποθήκευση...`;
                    setStepFooterBusy(true);
                    try {
                        await saveFinalSemiNormalAssignments(updatedAssignments);
                        // Proceed to Step 4
                        calculationSteps.currentStep = 4;
                        renderCurrentStep();
                        const m = bootstrap.Modal.getInstance(document.getElementById('semiNormalSwapResultsModal'));
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
                const tempNormalBaselineAssignments = calculationSteps.tempNormalBaselineAssignments || {};
                const lastNormalRotationPositionsByMonth = calculationSteps.lastNormalRotationPositionsByMonth || {};
                
                console.log('[STEP 4] tempNormalAssignments keys:', Object.keys(tempNormalAssignments).length);
                console.log('[STEP 4] lastNormalRotationPositionsByMonth:', lastNormalRotationPositionsByMonth);
                
                // Save normal rotation baseline (pure rotation order) to Firestore
                if (Object.keys(tempNormalBaselineAssignments).length > 0) {
                    const formattedBaseline = formatGroupAssignmentsToStringMap(tempNormalBaselineAssignments);
                    const organizedBaseline = organizeAssignmentsByMonth(formattedBaseline);
                    await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'rotationBaselineNormalAssignments', organizedBaseline);
                    Object.assign(rotationBaselineNormalAssignments, formattedBaseline);
                }
                
                // NOTE: legacy dutyShifts/assignments is deprecated; we no longer save pre-logic snapshots there.
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
                    
                    // No Firestore write here (legacy assignments doc deprecated).
                }
                
                // Save last rotation positions for normal days (per month)
                if (Object.keys(lastNormalRotationPositionsByMonth).length > 0) {
                    for (const monthKey in lastNormalRotationPositionsByMonth) {
                        const groupsForMonth = lastNormalRotationPositionsByMonth[monthKey] || {};
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            if (groupsForMonth[groupNum] !== undefined) {
                                setLastRotationPersonForMonth('normal', monthKey, groupNum, groupsForMonth[groupNum]);
                            }
                        }
                    }
                    
                    // Save to Firestore
                    const sanitizedPositions = sanitizeForFirestore(lastRotationPositions);
                    await db.collection('dutyShifts').doc('lastRotationPositions').set({
                        ...sanitizedPositions,
                        lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                        updatedBy: user.uid
                    });
                    console.log('Saved Step 4 last rotation positions for normal days (per month) to Firestore:', lastNormalRotationPositionsByMonth);
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

                // "Return from missing" reinsertion for NORMAL days:
                // - Only matters in the month where the missing period ENDS.
                // - Detect if the person missed any NORMAL duty (baseline rotation) from month-start to missing-end (within the missing window).
                // - If yes: after return (end+1), count 3 NORMAL days, then re-insert on nearest matching track day:
                //   Mon/Wed track or Tue/Thu track (based on the missed baseline normal day).
                // - Do NOT change baseline rotation tracking (we only modify final assignments here).
                const calcStartDateRaw = calculationSteps.startDate || null;
                const calcEndDateRaw = calculationSteps.endDate || null;
                const calcStartDate = (calcStartDateRaw instanceof Date) ? calcStartDateRaw : (calcStartDateRaw ? new Date(calcStartDateRaw) : null);
                const calcEndDate = (calcEndDateRaw instanceof Date) ? calcEndDateRaw : (calcEndDateRaw ? new Date(calcEndDateRaw) : null);
                const baselineNormalByDate = calculationSteps.tempNormalBaselineAssignments || {};

                const isValidDateKey = (dk) => typeof dk === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dk);
                const dateKeyToDate = (dk) => new Date(dk + 'T00:00:00');
                const addDaysToDateKey = (dk, days) => {
                    if (!isValidDateKey(dk)) return null;
                    const d = dateKeyToDate(dk);
                    if (isNaN(d.getTime())) return null;
                    d.setDate(d.getDate() + (days || 0));
                    return formatDateKey(d);
                };
                const maxDateKey = (a, b) => (!a ? b : (!b ? a : (a > b ? a : b)));
                const minDateKey = (a, b) => (!a ? b : (!b ? a : (a < b ? a : b)));
                const getTrackFromDow = (dow) => {
                    // 1=Mon,2=Tue,3=Wed,4=Thu
                    if (dow === 1 || dow === 3) return 1;
                    if (dow === 2 || dow === 4) return 2;
                    return null;
                };
                const trackMatches = (dk, track) => {
                    const d = dateKeyToDate(dk);
                    const dow = d.getDay();
                    return track === 1 ? (dow === 1 || dow === 3) : (dow === 2 || dow === 4);
                };
                const findFirstNormalOnOrAfter = (sortedNormalKeys, thresholdKey) => {
                    for (const dk of sortedNormalKeys) {
                        if (dk >= thresholdKey) return dk;
                    }
                    return null;
                };
                const findThirdNormalOnOrAfter = (sortedNormalKeys, thresholdKey) => {
                    let count = 0;
                    for (const dk of sortedNormalKeys) {
                        if (dk < thresholdKey) continue;
                        count++;
                        if (count === 3) return dk;
                    }
                    return null;
                };
                const findFirstMatchingTrackOnOrAfter = (sortedNormalKeys, thresholdKey, track) => {
                    for (const dk of sortedNormalKeys) {
                        if (dk < thresholdKey) continue;
                        if (trackMatches(dk, track)) return dk;
                    }
                    return null;
                };
                const findFirstAssignedNormalDateForPersonAfter = (sortedNormalKeys, groupNum, personName, afterDateKey, assignmentsByDate) => {
                    for (const dk of sortedNormalKeys) {
                        if (afterDateKey && dk <= afterDateKey) continue;
                        const p = assignmentsByDate?.[dk]?.[groupNum] || null;
                        if (p === personName) return dk;
                    }
                    return null;
                };
                // For reinsertion/shift feasibility:
                // - We MUST NOT assign someone when they are missing/disabled on that date.
                // - We can allow consecutive-duty conflicts here because the existing normal swap logic runs AFTER reinsertion
                //   and will resolve conflicts (Monday/Wed, Tuesday/Thu logic + cross-month).
                const canAssignPersonToNormalDay = (dateKey, personName, groupNum, assignmentsByDate, globalRotationPositions, simulatedSpecial, simulatedWeekend, simulatedSemi, { allowConsecutiveConflicts = false } = {}) => {
                    if (!dateKey || !personName) return false;
                    const dateObj = dateKeyToDate(dateKey);
                    if (isNaN(dateObj.getTime())) return false;
                    if (isPersonMissingOnDate(personName, groupNum, dateObj, 'normal')) return false;
                    if (allowConsecutiveConflicts) return true;
                    const simulatedAssignments = {
                        special: simulatedSpecial,
                        weekend: simulatedWeekend,
                        semi: simulatedSemi,
                        normal: assignmentsByDate,
                        normalRotationPositions: globalRotationPositions
                    };
                    return !hasConsecutiveDuty(dateKey, personName, groupNum, simulatedAssignments);
                };
                const pickNextEligibleIgnoringConflicts = (groupPeople, startIdx, groupNum, dateObj) => {
                    if (!Array.isArray(groupPeople) || groupPeople.length === 0) return null;
                    const rotationDays = groupPeople.length;
                    for (let off = 1; off <= rotationDays; off++) {
                        const idx = (startIdx + off) % rotationDays;
                        const cand = groupPeople[idx];
                        if (!cand) continue;
                        if (isPersonMissingOnDate(cand, groupNum, dateObj, 'normal')) continue;
                        return cand;
                    }
                    return null;
                };

                const normName = (s) => (typeof normalizePersonKey === 'function' ? normalizePersonKey(s) : String(s || '').trim());
                const indexOfPersonInList = (list, personName) => {
                    if (!Array.isArray(list) || list.length === 0) return -1;
                    const target = normName(personName);
                    if (!target) return -1;
                    for (let i = 0; i < list.length; i++) {
                        if (normName(list[i]) === target) return i;
                    }
                    return -1;
                };

                const canShiftInsertFromDate = (sortedNormalKeys, startKey, groupNum, insertedPerson, groupPeople, assignmentsByDate, globalRotationPositions, simulatedSpecial, simulatedWeekend, simulatedSemi) => {
                    const idx = sortedNormalKeys.indexOf(startKey);
                    if (idx < 0) return { ok: false, reason: 'start-not-in-range' };
                    // Track proposed shifts so conflict checks see the new "normal" schedule (for already-shifted days).
                    const proposed = {};
                    const mergedAssignments = new Proxy(assignmentsByDate || {}, {
                        get: (t, p) => (Object.prototype.hasOwnProperty.call(proposed, p) ? proposed[p] : t[p])
                    });
                    let carry = insertedPerson;
                    for (let i = idx; i < sortedNormalKeys.length; i++) {
                        const dk = sortedNormalKeys[i];
                        const cur = assignmentsByDate?.[dk]?.[groupNum] || null; // original occupant before shift
                        let desired = carry;
                        const dateObj = dateKeyToDate(dk);

                        if (desired) {
                            // If the carried person is missing/disabled on this date, skip their turn and use the next eligible in rotation.
                            if (isPersonMissingOnDate(desired, groupNum, dateObj, 'normal')) {
                                const startIdx = indexOfPersonInList(groupPeople, desired);
                                const replacement = startIdx >= 0 ? pickNextEligibleIgnoringConflicts(groupPeople, startIdx, groupNum, dateObj) : null;
                                desired = replacement || null;
                            }

                            if (!desired) return { ok: false, reason: 'no-eligible', dateKey: dk };

                            const ok = canAssignPersonToNormalDay(
                                dk,
                                desired,
                                groupNum,
                                mergedAssignments,
                                globalRotationPositions,
                                simulatedSpecial,
                                simulatedWeekend,
                                simulatedSemi,
                                { allowConsecutiveConflicts: true }
                            );
                            if (!ok) return { ok: false, reason: 'unavailable', dateKey: dk, person: desired };
                        }
                        // Record the proposed assignment for dk before moving carry forward.
                        proposed[dk] = { ...(assignmentsByDate?.[dk] || {}) };
                        proposed[dk][groupNum] = desired;
                        // Move carry forward using ORIGINAL occupant (not proposed).
                        carry = cur;

                        // IMPORTANT: Avoid giving the returning person multiple normal duties in a long range.
                        // If the returning person already had a "natural" assignment later in the schedule,
                        // stop the shift chain as soon as we reach that original slot (we effectively replace it).
                        if (dk !== startKey && cur && normName(cur) === normName(insertedPerson)) {
                            break;
                        }
                    }
                    return { ok: true };
                };
                const applyShiftInsertFromDate = (sortedNormalKeys, startKey, groupNum, insertedPerson, groupPeople, assignmentsByDate) => {
                    const idx = sortedNormalKeys.indexOf(startKey);
                    if (idx < 0) return { ok: false, originalAtTarget: null };
                    const originalAtTarget = assignmentsByDate?.[startKey]?.[groupNum] || null;
                    const changes = []; // { dateKey, prevPerson, newPerson }
                    let carry = insertedPerson;
                    for (let i = idx; i < sortedNormalKeys.length; i++) {
                        const dk = sortedNormalKeys[i];
                        const cur = assignmentsByDate?.[dk]?.[groupNum] || null;
                        const dateObj = dateKeyToDate(dk);

                        let desired = carry;
                        if (desired && isPersonMissingOnDate(desired, groupNum, dateObj, 'normal')) {
                            const startIdx = indexOfPersonInList(groupPeople, desired);
                            const replacement = startIdx >= 0 ? pickNextEligibleIgnoringConflicts(groupPeople, startIdx, groupNum, dateObj) : null;
                            desired = replacement || null;
                        }

                        if (!assignmentsByDate[dk]) assignmentsByDate[dk] = {};
                        assignmentsByDate[dk][groupNum] = desired;
                        changes.push({ dateKey: dk, prevPerson: cur, newPerson: desired });
                        carry = cur;

                        // Stop the chain when we reach the returning person's next natural slot,
                        // so they don't end up assigned twice within the calculated range.
                        if (dk !== startKey && cur && normName(cur) === normName(insertedPerson)) {
                            break;
                        }
                    }
                    return { ok: true, originalAtTarget, changes };
                };
                
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
                
                // Get global normal rotation positions for cross-month swap calculations
                const globalNormalRotationPosition = calculationSteps.lastNormalRotationPositions || {};

                // Apply "return-from-missing" reinsertion BEFORE swap logic, so swap logic can still resolve any new conflicts.
                // This modifies ONLY updatedAssignments (final schedule), not baseline rotation persons.
                try {
                    if (calcStartDate && calcEndDate && Array.isArray(sortedNormal) && sortedNormal.length > 0) {
                        const calcStartKey = formatDateKey(calcStartDate);
                        const calcEndKey = formatDateKey(calcEndDate);
                        const processed = new Set(); // "g|person|periodEnd"

                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            const g = groups?.[groupNum];
                            const missingMap = g?.missingPeriods || {};
                            for (const personName of Object.keys(missingMap)) {
                                const periods = Array.isArray(missingMap[personName]) ? missingMap[personName] : [];
                                for (const period of periods) {
                                    const pStartKey = inputValueToDateKey(period?.start);
                                    const pEndKey = inputValueToDateKey(period?.end);
                                    if (!pStartKey || !pEndKey) continue;
                                    if (pEndKey < calcStartKey || pEndKey > calcEndKey) continue; // only handle when the end is within the calculated range

                                    const dedupeKey = `${groupNum}|${personName}|${pEndKey}`;
                                    if (processed.has(dedupeKey)) continue;
                                    processed.add(dedupeKey);

                                    const pEndDate = dateKeyToDate(pEndKey);
                                    if (isNaN(pEndDate.getTime())) continue;
                                    const monthStartKey = formatDateKey(new Date(pEndDate.getFullYear(), pEndDate.getMonth(), 1));

                                    // Only scan within missing window and within calculated range, but starting from month-start as requested.
                                    const scanStartKey = maxDateKey(maxDateKey(monthStartKey, pStartKey), calcStartKey);
                                    const scanEndKey = minDateKey(pEndKey, calcEndKey);
                                    if (!scanStartKey || !scanEndKey || scanStartKey > scanEndKey) continue;

                                    // Find first missed baseline normal duty date in scan window.
                                    let firstMissedKey = null;
                                    for (const dk of sortedNormal) {
                                        if (dk < scanStartKey) continue;
                                        if (dk > scanEndKey) break;
                                        // Prefer in-memory baseline map from Step 4 preview; fall back to saved baseline doc if missing.
                                        const baselinePerson =
                                            baselineNormalByDate?.[dk]?.[groupNum] ||
                                            parseAssignedPersonForGroupFromAssignment(getRotationBaselineAssignmentForType('normal', dk), groupNum) ||
                                            null;
                                        if (baselinePerson === personName) {
                                            firstMissedKey = dk;
                                            break;
                                        }
                                    }
                                    if (!firstMissedKey) continue;

                                    const track = getTrackFromDow(dateKeyToDate(firstMissedKey).getDay());
                                    if (!track) continue;

                                    // Return day is end+1
                                    const returnKey = addDaysToDateKey(pEndKey, 1);
                                    if (!returnKey) continue;

                                    // Count 3 normal days starting at returnKey (on-or-after), then find nearest track day on/after that.
                                    const thirdNormalKey = findThirdNormalOnOrAfter(sortedNormal, returnKey);
                                    if (!thirdNormalKey) continue;
                                    let targetKey = findFirstMatchingTrackOnOrAfter(sortedNormal, thirdNormalKey, track);
                                    if (!targetKey) continue;

                                    // Find a feasible targetKey:
                                    // - returning person must be assignable on targetKey
                                    // - AND the whole shift-forward chain must be conflict-free for everyone displaced.
                                    while (targetKey) {
                                        const okReturning = canAssignPersonToNormalDay(
                                            targetKey,
                                            personName,
                                            groupNum,
                                            updatedAssignments,
                                            globalNormalRotationPosition,
                                            simulatedSpecialAssignments,
                                            simulatedWeekendAssignments,
                                            simulatedSemiAssignments,
                                            { allowConsecutiveConflicts: true }
                                        );
                                        if (okReturning) {
                                            const groupPeople = (groups?.[groupNum]?.normal || []);
                                            const chainOk = canShiftInsertFromDate(
                                                sortedNormal,
                                                targetKey,
                                                groupNum,
                                                personName,
                                                groupPeople,
                                                updatedAssignments,
                                                globalNormalRotationPosition,
                                                simulatedSpecialAssignments,
                                                simulatedWeekendAssignments,
                                                simulatedSemiAssignments
                                            );
                                            if (chainOk.ok) break;
                                        }
                                        const nextThreshold = addDaysToDateKey(targetKey, 1);
                                        targetKey = nextThreshold ? findFirstMatchingTrackOnOrAfter(sortedNormal, nextThreshold, track) : null;
                                    }
                                    if (!targetKey) continue;

                                    // Apply shift insertion (follow rotation): everyone moves to the next normal day.
                                    const groupPeopleFinal = (groups?.[groupNum]?.normal || []);
                                    const ins = applyShiftInsertFromDate(sortedNormal, targetKey, groupNum, personName, groupPeopleFinal, updatedAssignments);
                                    if (!ins.ok) continue;

                                    // IMPORTANT: Enforce "after 3 normal days" by preventing any earlier normal-day assignment
                                    // of the returning person between returnKey (inclusive) and targetKey (exclusive).
                                    // This situation happens in multi-month ranges because the base rotation can assign them immediately after return.
                                    // We replace those early occurrences with the next eligible person in rotation and mark as internal 'shift'
                                    // so they won't be underlined and won't be shown as a swap.
                                    try {
                                        for (const dk of sortedNormal) {
                                            if (dk < returnKey) continue;
                                            if (dk >= targetKey) break;
                                            const curAssigned = updatedAssignments?.[dk]?.[groupNum] || null;
                                            if (!curAssigned || normName(curAssigned) !== normName(personName)) continue;

                                            const dateObj = dateKeyToDate(dk);
                                            const idxP = indexOfPersonInList(groupPeopleFinal, personName);
                                            const replacement = idxP >= 0 ? pickNextEligibleIgnoringConflicts(groupPeopleFinal, idxP, groupNum, dateObj) : null;
                                            if (!replacement) continue;

                                            updatedAssignments[dk][groupNum] = replacement;
                                            storeAssignmentReason(
                                                dk,
                                                groupNum,
                                                replacement,
                                                'shift',
                                                '',
                                                personName,
                                                null,
                                                { returnFromMissing: true, clearedEarlyReturnAssignment: true, targetKey, missingEnd: pEndKey }
                                            );
                                        }
                                    } catch (_) {}

                                    storeAssignmentReason(
                                        targetKey,
                                        groupNum,
                                        personName,
                                        'skip',
                                        `Επέστρεψε από απουσία και επανεντάχθηκε στις καθημερινές μετά από 3 καθημερινές ημέρες (λογική ${track === 1 ? 'Δευτέρα/Τετάρτη' : 'Τρίτη/Πέμπτη'}).`,
                                        ins.originalAtTarget || null,
                                        null,
                                        { returnFromMissing: true, insertedByShift: true, missingEnd: pEndKey }
                                    );

                                    // IMPORTANT: Do NOT underline / do NOT treat as swap the people that got pushed forward.
                                    // We store a lightweight 'shift' marker so the calendar does NOT fall back to "baseline mismatch => underline".
                                    // This stays silent in UI (see showDayDetails adjustments).
                                    try {
                                        const chain = Array.isArray(ins.changes) ? ins.changes : [];
                                        for (const ch of chain) {
                                            if (!ch || !ch.dateKey) continue;
                                            if (ch.dateKey === targetKey) continue; // only underline the returning person
                                            const newP = ch.newPerson;
                                            if (!newP) continue;
                                            storeAssignmentReason(
                                                ch.dateKey,
                                                groupNum,
                                                newP,
                                                'shift',
                                                '',
                                                ch.prevPerson || null,
                                                null,
                                                { returnFromMissing: true, shiftedByReturnFromMissing: true, anchorDateKey: targetKey, missingEnd: pEndKey }
                                            );
                                        }
                                    } catch (_) {}
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn('[STEP 4] Return-from-missing reinsertion (normal) failed:', e);
                }
                
                // Track people who have already been swapped to prevent re-swapping
                const swappedPeopleSet = new Set(); // Format: "dateKey:groupNum:personName"
                
                // OPTIMIZATION: First pass - identify all conflicts before processing swaps
                // This allows us to prioritize direct conflict-to-conflict swaps
                const conflictMap = new Map(); // Format: "dateKey:groupNum" -> { person, dayOfWeek }
                const simulatedAssignmentsForConflictDetection = {
                    special: simulatedSpecialAssignments,
                    weekend: simulatedWeekendAssignments,
                    semi: simulatedSemiAssignments,
                    normal: updatedAssignments,
                    normalRotationPositions: globalNormalRotationPosition
                };
                
                sortedNormal.forEach((dateKey) => {
                    const date = new Date(dateKey + 'T00:00:00');
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        const currentPerson = updatedAssignments[dateKey]?.[groupNum];
                        if (!currentPerson) continue;
                        
                        const hasConflict = hasConsecutiveDuty(dateKey, currentPerson, groupNum, simulatedAssignmentsForConflictDetection);
                        if (hasConflict) {
                            const conflictKey = `${dateKey}:${groupNum}`;
                            conflictMap.set(conflictKey, {
                                person: currentPerson,
                                dayOfWeek: date.getDay()
                            });
                        }
                    }
                });
                
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
                        // Include normalRotationPositions for cross-month conflict detection
                        const simulatedAssignments = {
                            special: simulatedSpecialAssignments,
                            weekend: simulatedWeekendAssignments,
                            semi: simulatedSemiAssignments,
                            normal: updatedAssignments,
                            normalRotationPositions: globalNormalRotationPosition // For cross-month conflict detection
                        };
                        
                        const hasConsecutiveConflict = hasConsecutiveDuty(dateKey, currentPerson, groupNum, simulatedAssignments);
                        
                        // Debug logging to help identify why conflicts aren't detected
                        if (hasConsecutiveConflict) {
                            console.log(`[SWAP DEBUG] Found conflict for ${currentPerson} on ${dateKey} (Group ${groupNum})`);
                        }
                        
                        // Declare swap variables in broader scope so they're accessible after the if block
                        let swapDayKey = null;
                        let swapDayIndex = null;
                        let swapFound = false;
                        
                        if (hasConsecutiveConflict) {
                            const dayOfWeek = date.getDay(); // 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday
                            const month = date.getMonth();
                            const year = date.getFullYear();
                            
                            console.log(`[SWAP LOGIC] Starting swap logic for ${currentPerson} on ${dateKey} (Group ${groupNum}, Day: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]})`);
                            
                            // SEPARATE LOGIC: Monday/Wednesday vs Tuesday/Thursday
                            // Monday (1) or Wednesday (3) - Monday ↔ Wednesday logic
                            if (dayOfWeek === 1 || dayOfWeek === 3) {
                                const alternativeDayOfWeek = dayOfWeek === 1 ? 3 : 1; // Monday ↔ Wednesday
                                
                                // MONDAY/WEDNESDAY - Step 1: Try alternative day in same week
                                console.log(`[SWAP LOGIC] MONDAY/WEDNESDAY - Step 1: Trying alternative day (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][alternativeDayOfWeek]}) in same week`);
                                const sameWeekDate = new Date(date);
                                const daysToAdd = alternativeDayOfWeek - dayOfWeek;
                                sameWeekDate.setDate(date.getDate() + daysToAdd);
                                const sameWeekKey = formatDateKey(sameWeekDate);
                                
                                if (isSameWeek(date, sameWeekDate) && updatedAssignments[sameWeekKey]?.[groupNum]) {
                                    const swapCandidate = updatedAssignments[sameWeekKey][groupNum];
                                    console.log(`[SWAP LOGIC] Step 1: Found candidate ${swapCandidate} on ${sameWeekKey}`);
                                    
                                    // IMPORTANT: Verify the current person actually has a real conflict (not a false positive)
                                    // Check if the conflict is between normal-normal days (which shouldn't conflict)
                                    const dayBefore = new Date(date);
                                    dayBefore.setDate(dayBefore.getDate() - 1);
                                    const dayAfter = new Date(date);
                                    dayAfter.setDate(dayAfter.getDate() + 1);
                                    const dayBeforeKey = formatDateKey(dayBefore);
                                    const dayAfterKey = formatDateKey(dayAfter);
                                    const beforeType = getDayType(dayBefore);
                                    const afterType = getDayType(dayAfter);
                                    
                                    // Check if current person has duty on day before or after
                                    let hasDutyBefore = false;
                                    let hasDutyAfter = false;
                                    if (simulatedAssignments) {
                                        const beforeMonthKey = `${dayBefore.getFullYear()}-${dayBefore.getMonth()}`;
                                        if (beforeType === 'special-holiday') {
                                            hasDutyBefore = simulatedAssignments.special?.[beforeMonthKey]?.[groupNum]?.has(currentPerson) || false;
                                        } else if (beforeType === 'semi-normal-day') {
                                            hasDutyBefore = simulatedAssignments.semi?.[dayBeforeKey]?.[groupNum] === currentPerson;
                                        } else if (beforeType === 'weekend-holiday') {
                                            hasDutyBefore = simulatedAssignments.weekend?.[dayBeforeKey]?.[groupNum] === currentPerson;
                                        } else if (beforeType === 'normal-day') {
                                            hasDutyBefore = simulatedAssignments.normal?.[dayBeforeKey]?.[groupNum] === currentPerson;
                                        }
                                        
                                        const afterMonthKey = `${dayAfter.getFullYear()}-${dayAfter.getMonth()}`;
                                        if (afterType === 'special-holiday') {
                                            hasDutyAfter = simulatedAssignments.special?.[afterMonthKey]?.[groupNum]?.has(currentPerson) || false;
                                        } else if (afterType === 'semi-normal-day') {
                                            hasDutyAfter = simulatedAssignments.semi?.[dayAfterKey]?.[groupNum] === currentPerson;
                                        } else if (afterType === 'weekend-holiday') {
                                            hasDutyAfter = simulatedAssignments.weekend?.[dayAfterKey]?.[groupNum] === currentPerson;
                                        } else if (afterType === 'normal-day') {
                                            hasDutyAfter = simulatedAssignments.normal?.[dayAfterKey]?.[groupNum] === currentPerson;
                                        }
                                    } else {
                                        hasDutyBefore = hasDutyOnDay(dayBeforeKey, currentPerson, groupNum);
                                        hasDutyAfter = hasDutyOnDay(dayAfterKey, currentPerson, groupNum);
                                    }
                                    
                                    // Only proceed if there's an actual conflict (not normal-normal)
                                    const hasRealConflict = (hasDutyBefore && beforeType !== 'normal-day') || 
                                                           (hasDutyAfter && afterType !== 'normal-day');
                                    
                                    if (!hasRealConflict) {
                                        console.log(`[SWAP LOGIC] ✗ Step 1 PREVENTED: Unnecessary swap - ${currentPerson} on ${dateKey} doesn't have a real conflict (both days are normal)`);
                                    } else {
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, sameWeekDate, 'normal') &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            swapDayKey = sameWeekKey;
                                            swapDayIndex = normalDays.indexOf(sameWeekKey);
                                            swapFound = true;
                                            console.log(`[SWAP LOGIC] ✓ Step 1 SUCCESS: Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${sameWeekKey})`);
                                        } else {
                                            console.log(`[SWAP LOGIC] ✗ Step 1 FAILED: Candidate ${swapCandidate} has conflict or is missing`);
                                        }
                                    }
                                } else {
                                    console.log(`[SWAP LOGIC] ✗ Step 1 FAILED: No candidate found on ${sameWeekKey} or not in same week`);
                                }
                                
                                // MONDAY/WEDNESDAY - Step 2: ONLY if Step 1 failed, try same day of week in same month
                                // OPTIMIZATION: Prioritize direct conflict-to-conflict swaps
                                if (!swapFound) {
                                    console.log(`[SWAP LOGIC] MONDAY/WEDNESDAY - Step 2: Trying same day of week (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]}) in same month`);
                                    const nextSameDay = new Date(year, month, date.getDate() + 7);
                                    if (nextSameDay.getMonth() === month) {
                                        const nextSameDayKey = formatDateKey(nextSameDay);
                                        if (updatedAssignments[nextSameDayKey]?.[groupNum]) {
                                            const swapCandidate = updatedAssignments[nextSameDayKey][groupNum];
                                            const candidateConflictKey = `${nextSameDayKey}:${groupNum}`;
                                            const candidateHasConflict = conflictMap.has(candidateConflictKey);
                                            
                                            console.log(`[SWAP LOGIC] Step 2: Found candidate ${swapCandidate} on ${nextSameDayKey}${candidateHasConflict ? ' (also has conflict - PRIORITY SWAP)' : ''}`);
                                            
                                            // Check if both have conflicts on same day type - prioritize this swap
                                            if (candidateHasConflict && !isPersonMissingOnDate(swapCandidate, groupNum, nextSameDay, 'normal') &&
                                                !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                // Direct conflict-to-conflict swap - both people have conflicts on same day type
                                                swapDayKey = nextSameDayKey;
                                                swapDayIndex = normalDays.indexOf(nextSameDayKey);
                                                swapFound = true;
                                                console.log(`[SWAP LOGIC] ✓ Step 2 SUCCESS (CONFLICT-TO-CONFLICT): Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${nextSameDayKey}) - both have conflicts`);
                                            } else if (!isPersonMissingOnDate(swapCandidate, groupNum, nextSameDay, 'normal') &&
                                                !hasConsecutiveDuty(nextSameDayKey, swapCandidate, groupNum, simulatedAssignments) &&
                                                !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                // Regular swap (candidate doesn't have conflict)
                                                swapDayKey = nextSameDayKey;
                                                swapDayIndex = normalDays.indexOf(nextSameDayKey);
                                                swapFound = true;
                                                console.log(`[SWAP LOGIC] ✓ Step 2 SUCCESS: Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${nextSameDayKey})`);
                                            } else {
                                                console.log(`[SWAP LOGIC] ✗ Step 2 FAILED: Candidate ${swapCandidate} has conflict or is missing`);
                                            }
                                        } else {
                                            console.log(`[SWAP LOGIC] ✗ Step 2 FAILED: No candidate found on ${nextSameDayKey}`);
                                        }
                                    } else {
                                        console.log(`[SWAP LOGIC] ✗ Step 2 FAILED: Next same day is in next month (will try in Step 3)`);
                                    }
                                }
                                
                                // MONDAY/WEDNESDAY - Step 3: ONLY if Step 2 failed, try alternative day in week after next OR next month
                                if (!swapFound) {
                                    console.log(`[SWAP LOGIC] MONDAY/WEDNESDAY - Step 3: Trying alternative day in week after next OR next month`);
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
                                        console.log(`[SWAP LOGIC] Step 3a: Found candidate ${swapCandidate} on ${weekAfterNextKey} (week after next)`);
                                        
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, weekAfterNextDate, 'normal') &&
                                            !hasConsecutiveDuty(weekAfterNextKey, swapCandidate, groupNum, simulatedAssignments) &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            swapDayKey = weekAfterNextKey;
                                            swapDayIndex = normalDays.indexOf(weekAfterNextKey);
                                            swapFound = true;
                                            console.log(`[SWAP LOGIC] ✓ Step 3a SUCCESS: Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${weekAfterNextKey})`);
                                        } else {
                                            console.log(`[SWAP LOGIC] ✗ Step 3a FAILED: Candidate ${swapCandidate} has conflict or is missing`);
                                        }
                                    } else {
                                        console.log(`[SWAP LOGIC] ✗ Step 3a FAILED: No candidate found on ${weekAfterNextKey} or not in week after next`);
                                    }
                                    
                                    // If still not found, try next month - alternative day (cross-month swap)
                                    if (!swapFound) {
                                        console.log(`[SWAP LOGIC] Step 3b: Trying NEXT MONTH - alternative day (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][alternativeDayOfWeek]})`);
                                        // Use getPersonFromNextMonth to calculate person from next month's rotation
                                        const rotationDays = groupPeople.length;
                                        const currentRotationPosition = globalNormalRotationPosition[groupNum];
                                        const nextMonthResult = getPersonFromNextMonth(dateKey, 'normal', groupNum, month, year, rotationDays, groupPeople, currentRotationPosition);
                                        
                                        if (nextMonthResult && nextMonthResult.person) {
                                            const swapCandidate = nextMonthResult.person;
                                            const nextMonthSwapDayKey = nextMonthResult.swapDayKey;
                                            console.log(`[SWAP LOGIC] Step 3b: Found candidate ${swapCandidate} from next month on ${nextMonthSwapDayKey}`);
                                            
                                            // Verify the swap day is the alternative day of week (not same day)
                                            const nextMonthSwapDate = new Date(nextMonthSwapDayKey + 'T00:00:00');
                                            if (nextMonthSwapDate.getDay() === alternativeDayOfWeek) {
                                                // Check if swap candidate is valid for current date
                                                if (!isPersonMissingOnDate(swapCandidate, groupNum, date, 'normal') &&
                                                    !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                    // Check if swap candidate is valid for next month swap day
                                                    if (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthSwapDate, 'normal') &&
                                                        !hasConsecutiveDuty(nextMonthSwapDayKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                        swapDayKey = nextMonthSwapDayKey;
                                                        swapDayIndex = normalDays.includes(nextMonthSwapDayKey) ? normalDays.indexOf(nextMonthSwapDayKey) : -1;
                                                        swapFound = true;
                                                        
                                                        // Store cross-month swap info
                                                        if (!crossMonthSwaps[nextMonthSwapDayKey]) {
                                                            crossMonthSwaps[nextMonthSwapDayKey] = {};
                                                        }
                                                        crossMonthSwaps[nextMonthSwapDayKey][groupNum] = currentPerson;
                                                        // Also store the swap candidate in a temporary location for the swap execution
                                                        if (!updatedAssignments[nextMonthSwapDayKey]) {
                                                            updatedAssignments[nextMonthSwapDayKey] = {};
                                                        }
                                                        updatedAssignments[nextMonthSwapDayKey][groupNum] = swapCandidate; // Store candidate for swap execution
                                                        console.log(`[SWAP LOGIC] ✓ Step 3b SUCCESS (CROSS-MONTH): Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${nextMonthSwapDayKey})`);
                                                        console.log(`[CROSS-MONTH SWAP NORMAL Step 3b] Person ${currentPerson} (had conflict on ${dateKey}) must be assigned to ${nextMonthSwapDayKey} (Group ${groupNum}), swap candidate: ${swapCandidate}`);
                                                    } else {
                                                        console.log(`[SWAP LOGIC] ✗ Step 3b FAILED: Candidate ${swapCandidate} has conflict on next month swap day ${nextMonthSwapDayKey}`);
                                                    }
                                                } else {
                                                    console.log(`[SWAP LOGIC] ✗ Step 3b FAILED: Candidate ${swapCandidate} has conflict on current date ${dateKey} or is missing`);
                                                }
                                            } else {
                                                console.log(`[SWAP LOGIC] ✗ Step 3b FAILED: Next month swap day ${nextMonthSwapDayKey} is not alternative day (expected ${alternativeDayOfWeek}, got ${nextMonthSwapDate.getDay()})`);
                                            }
                                        } else {
                                            console.log(`[SWAP LOGIC] ✗ Step 3b FAILED: Could not get person from next month`);
                                        }
                                    }
                                    
                                    // MONDAY/WEDNESDAY - Step 4a: ONLY if Step 3b failed, try next same day (Monday) in next month
                                    if (!swapFound) {
                                        console.log(`[SWAP LOGIC] MONDAY/WEDNESDAY - Step 4a: Trying NEXT MONTH - same day (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]})`);
                                        // Calculate next month
                                        const nextMonth = month === 11 ? 0 : month + 1;
                                        const nextYear = month === 11 ? year + 1 : year;
                                        
                                        // Find next same day of week in next month
                                        let nextSameDayInNextMonth = new Date(nextYear, nextMonth, date.getDate());
                                        // Adjust to same day of week
                                        while (nextSameDayInNextMonth.getDay() !== dayOfWeek && nextSameDayInNextMonth.getDate() <= 31) {
                                            nextSameDayInNextMonth.setDate(nextSameDayInNextMonth.getDate() + 1);
                                        }
                                        
                                        const nextSameDayKey = formatDateKey(nextSameDayInNextMonth);
                                        const nextSameDayType = getDayType(nextSameDayInNextMonth);
                                        
                                        if (nextSameDayType === 'normal-day' && nextSameDayInNextMonth.getMonth() === nextMonth) {
                                            // Use getPersonFromNextMonth to get person for this day
                                            const rotationDays = groupPeople.length;
                                            const currentRotationPosition = globalNormalRotationPosition[groupNum];
                                            const nextMonthResult = getPersonFromNextMonth(nextSameDayKey, 'normal', groupNum, month, year, rotationDays, groupPeople, currentRotationPosition);
                                            
                                            if (nextMonthResult && nextMonthResult.person) {
                                                const swapCandidate = nextMonthResult.person;
                                                const nextMonthSwapDayKey = nextMonthResult.swapDayKey;
                                                console.log(`[SWAP LOGIC] Step 4a: Found candidate ${swapCandidate} from next month on ${nextMonthSwapDayKey}`);
                                                
                                                // Verify the swap day is the same day of week
                                                const nextMonthSwapDate = new Date(nextMonthSwapDayKey + 'T00:00:00');
                                                if (nextMonthSwapDate.getDay() === dayOfWeek) {
                                                    // OPTIMIZATION: Check if candidate also has conflict (if swap day is in calculation range)
                                                    const candidateConflictKey = `${nextMonthSwapDayKey}:${groupNum}`;
                                                    const candidateHasConflict = normalDays.includes(nextMonthSwapDayKey) && conflictMap.has(candidateConflictKey);
                                                    
                                                    // Check if swap candidate is valid for current date
                                                    if (!isPersonMissingOnDate(swapCandidate, groupNum, date, 'normal') &&
                                                        !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                        // If candidate has conflict on swap day, prioritize this swap (direct conflict-to-conflict)
                                                        // Otherwise, check if candidate is valid for swap day
                                                        const isValidForSwapDay = candidateHasConflict || 
                                                            (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthSwapDate, 'normal') &&
                                                             !hasConsecutiveDuty(nextMonthSwapDayKey, swapCandidate, groupNum, simulatedAssignments));
                                                        
                                                        if (isValidForSwapDay) {
                                                            swapDayKey = nextMonthSwapDayKey;
                                                            swapDayIndex = normalDays.includes(nextMonthSwapDayKey) ? normalDays.indexOf(nextMonthSwapDayKey) : -1;
                                                            swapFound = true;
                                                            
                                                            // Store cross-month swap info
                                                            if (!crossMonthSwaps[nextMonthSwapDayKey]) {
                                                                crossMonthSwaps[nextMonthSwapDayKey] = {};
                                                            }
                                                            crossMonthSwaps[nextMonthSwapDayKey][groupNum] = currentPerson;
                                                            // Also store the swap candidate in a temporary location for the swap execution
                                                            if (!updatedAssignments[nextMonthSwapDayKey]) {
                                                                updatedAssignments[nextMonthSwapDayKey] = {};
                                                            }
                                                            updatedAssignments[nextMonthSwapDayKey][groupNum] = swapCandidate; // Store candidate for swap execution
                                                            const swapType = candidateHasConflict ? ' (CONFLICT-TO-CONFLICT)' : '';
                                                            console.log(`[SWAP LOGIC] ✓ Step 4a SUCCESS (CROSS-MONTH${swapType}): Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${nextMonthSwapDayKey})${candidateHasConflict ? ' - both have conflicts' : ''}`);
                                                            console.log(`[CROSS-MONTH SWAP NORMAL Step 4a] Person ${currentPerson} (had conflict on ${dateKey}) must be assigned to ${nextMonthSwapDayKey} (Group ${groupNum}), swap candidate: ${swapCandidate}`);
                                                        } else {
                                                            console.log(`[SWAP LOGIC] ✗ Step 4a FAILED: Candidate ${swapCandidate} has conflict on next month swap day ${nextMonthSwapDayKey}`);
                                                        }
                                                    } else {
                                                        console.log(`[SWAP LOGIC] ✗ Step 4a FAILED: Candidate ${swapCandidate} has conflict on current date ${dateKey} or is missing`);
                                                    }
                                                } else {
                                                    console.log(`[SWAP LOGIC] ✗ Step 4a FAILED: Next month swap day ${nextMonthSwapDayKey} is not same day (expected ${dayOfWeek}, got ${nextMonthSwapDate.getDay()})`);
                                                }
                                            } else {
                                                console.log(`[SWAP LOGIC] ✗ Step 4a FAILED: Could not get person from next month`);
                                            }
                                        } else {
                                            console.log(`[SWAP LOGIC] ✗ Step 4a FAILED: Next same day ${nextSameDayKey} is not a normal day or not in next month`);
                                        }
                                    }
                                    
                                    // MONDAY/WEDNESDAY - Step 4b: ONLY if Step 4a failed, try next alternative day (Wednesday) in next month
                                    if (!swapFound) {
                                        console.log(`[SWAP LOGIC] MONDAY/WEDNESDAY - Step 4b: Trying NEXT MONTH - next alternative day (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][alternativeDayOfWeek]}) - final attempt`);
                                        // Calculate next month
                                        const nextMonth = month === 11 ? 0 : month + 1;
                                        const nextYear = month === 11 ? year + 1 : year;
                                        
                                        // Find next alternative day of week in next month (after the first one we tried in Step 3b)
                                        let nextAlternativeDayInNextMonth = new Date(nextYear, nextMonth, date.getDate());
                                        // Adjust to alternative day of week
                                        while (nextAlternativeDayInNextMonth.getDay() !== alternativeDayOfWeek && nextAlternativeDayInNextMonth.getDate() <= 31) {
                                            nextAlternativeDayInNextMonth.setDate(nextAlternativeDayInNextMonth.getDate() + 1);
                                        }
                                        
                                        // If we found the first alternative day, try to find the next occurrence
                                        if (nextAlternativeDayInNextMonth.getDay() === alternativeDayOfWeek) {
                                            // Move to next week to find second occurrence
                                            nextAlternativeDayInNextMonth.setDate(nextAlternativeDayInNextMonth.getDate() + 7);
                                        }
                                        
                                        const nextAlternativeKey = formatDateKey(nextAlternativeDayInNextMonth);
                                        const nextAlternativeType = getDayType(nextAlternativeDayInNextMonth);
                                        
                                        if (nextAlternativeType === 'normal-day' && nextAlternativeDayInNextMonth.getMonth() === nextMonth) {
                                            // Use getPersonFromNextMonth to get person for this day
                                            const rotationDays = groupPeople.length;
                                            const currentRotationPosition = globalNormalRotationPosition[groupNum];
                                            const nextMonthResult = getPersonFromNextMonth(nextAlternativeKey, 'normal', groupNum, month, year, rotationDays, groupPeople, currentRotationPosition);
                                            
                                            if (nextMonthResult && nextMonthResult.person) {
                                                const swapCandidate = nextMonthResult.person;
                                                const nextMonthSwapDayKey = nextMonthResult.swapDayKey;
                                                console.log(`[SWAP LOGIC] Step 4b: Found candidate ${swapCandidate} from next month on ${nextMonthSwapDayKey}`);
                                                
                                                // Verify the swap day is the alternative day of week
                                                const nextMonthSwapDate = new Date(nextMonthSwapDayKey + 'T00:00:00');
                                                if (nextMonthSwapDate.getDay() === alternativeDayOfWeek) {
                                                    // Check if swap candidate is valid for current date
                                                    if (!isPersonMissingOnDate(swapCandidate, groupNum, date, 'normal') &&
                                                        !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                        // Check if swap candidate is valid for next month swap day
                                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthSwapDate, 'normal') &&
                                                            !hasConsecutiveDuty(nextMonthSwapDayKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                            swapDayKey = nextMonthSwapDayKey;
                                                            swapDayIndex = normalDays.includes(nextMonthSwapDayKey) ? normalDays.indexOf(nextMonthSwapDayKey) : -1;
                                                            swapFound = true;
                                                            
                                                            // Store cross-month swap info
                                                            if (!crossMonthSwaps[nextMonthSwapDayKey]) {
                                                                crossMonthSwaps[nextMonthSwapDayKey] = {};
                                                            }
                                                            crossMonthSwaps[nextMonthSwapDayKey][groupNum] = currentPerson;
                                                            // Also store the swap candidate in a temporary location for the swap execution
                                                            if (!updatedAssignments[nextMonthSwapDayKey]) {
                                                                updatedAssignments[nextMonthSwapDayKey] = {};
                                                            }
                                                            updatedAssignments[nextMonthSwapDayKey][groupNum] = swapCandidate; // Store candidate for swap execution
                                                            console.log(`[SWAP LOGIC] ✓ Step 4b SUCCESS (CROSS-MONTH): Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${nextMonthSwapDayKey})`);
                                                            console.log(`[CROSS-MONTH SWAP NORMAL Step 4b] Person ${currentPerson} (had conflict on ${dateKey}) must be assigned to ${nextMonthSwapDayKey} (Group ${groupNum}), swap candidate: ${swapCandidate}`);
                                                        } else {
                                                            console.log(`[SWAP LOGIC] ✗ Step 4b FAILED: Candidate ${swapCandidate} has conflict on next month swap day ${nextMonthSwapDayKey}`);
                                                        }
                                                    } else {
                                                        console.log(`[SWAP LOGIC] ✗ Step 4b FAILED: Candidate ${swapCandidate} has conflict on current date ${dateKey} or is missing`);
                                                    }
                                                } else {
                                                    console.log(`[SWAP LOGIC] ✗ Step 4b FAILED: Next month swap day ${nextMonthSwapDayKey} is not alternative day (expected ${alternativeDayOfWeek}, got ${nextMonthSwapDate.getDay()})`);
                                                }
                                            } else {
                                                console.log(`[SWAP LOGIC] ✗ Step 4b FAILED: Could not get person from next month`);
                                            }
                                        } else {
                                            console.log(`[SWAP LOGIC] ✗ Step 4b FAILED: Next alternative day ${nextAlternativeKey} is not a normal day or not in next month`);
                                        }
                                    }
                                }
                            }
                            // TUESDAY/THURSDAY - Separate logic block
                            else if (dayOfWeek === 2 || dayOfWeek === 4) {
                                const alternativeDayOfWeek = dayOfWeek === 2 ? 4 : 2; // Tuesday ↔ Thursday
                                
                                console.log(`[SWAP LOGIC] TUESDAY/THURSDAY - Step 1a: Trying next same day (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]}) - can be in same month or next month`);
                                // TUESDAY/THURSDAY - Step 1a: Try next same day of week (can be in same month or next month)
                                const nextSameDay = new Date(year, month, date.getDate() + 7);
                                const nextSameDayKey = formatDateKey(nextSameDay);
                                
                                // Check if next same day is in the calculation range (same month or next month)
                                if (normalDays.includes(nextSameDayKey) && updatedAssignments[nextSameDayKey]?.[groupNum]) {
                                    // Next same day is in calculation range - use it
                                    const swapCandidate = updatedAssignments[nextSameDayKey][groupNum];
                                    const candidateConflictKey = `${nextSameDayKey}:${groupNum}`;
                                    const candidateHasConflict = conflictMap.has(candidateConflictKey);
                                    
                                    console.log(`[SWAP LOGIC] Step 1a: Found candidate ${swapCandidate} on ${nextSameDayKey} (in calculation range)${candidateHasConflict ? ' (also has conflict - PRIORITY SWAP)' : ''}`);
                                    
                                    // IMPORTANT: Verify the current person actually has a real conflict (not a false positive)
                                    const dayBefore = new Date(date);
                                    dayBefore.setDate(dayBefore.getDate() - 1);
                                    const dayAfter = new Date(date);
                                    dayAfter.setDate(dayAfter.getDate() + 1);
                                    const dayBeforeKey = formatDateKey(dayBefore);
                                    const dayAfterKey = formatDateKey(dayAfter);
                                    const beforeType = getDayType(dayBefore);
                                    const afterType = getDayType(dayAfter);
                                    
                                    // Check if current person has duty on day before or after
                                    let hasDutyBefore = false;
                                    let hasDutyAfter = false;
                                    if (simulatedAssignments) {
                                        const beforeMonthKey = `${dayBefore.getFullYear()}-${dayBefore.getMonth()}`;
                                        if (beforeType === 'special-holiday') {
                                            hasDutyBefore = simulatedAssignments.special?.[beforeMonthKey]?.[groupNum]?.has(currentPerson) || false;
                                        } else if (beforeType === 'semi-normal-day') {
                                            hasDutyBefore = simulatedAssignments.semi?.[dayBeforeKey]?.[groupNum] === currentPerson;
                                        } else if (beforeType === 'weekend-holiday') {
                                            hasDutyBefore = simulatedAssignments.weekend?.[dayBeforeKey]?.[groupNum] === currentPerson;
                                        } else if (beforeType === 'normal-day') {
                                            hasDutyBefore = simulatedAssignments.normal?.[dayBeforeKey]?.[groupNum] === currentPerson;
                                        }
                                        
                                        const afterMonthKey = `${dayAfter.getFullYear()}-${dayAfter.getMonth()}`;
                                        if (afterType === 'special-holiday') {
                                            hasDutyAfter = simulatedAssignments.special?.[afterMonthKey]?.[groupNum]?.has(currentPerson) || false;
                                        } else if (afterType === 'semi-normal-day') {
                                            hasDutyAfter = simulatedAssignments.semi?.[dayAfterKey]?.[groupNum] === currentPerson;
                                        } else if (afterType === 'weekend-holiday') {
                                            hasDutyAfter = simulatedAssignments.weekend?.[dayAfterKey]?.[groupNum] === currentPerson;
                                        } else if (afterType === 'normal-day') {
                                            hasDutyAfter = simulatedAssignments.normal?.[dayAfterKey]?.[groupNum] === currentPerson;
                                        }
                                    } else {
                                        hasDutyBefore = hasDutyOnDay(dayBeforeKey, currentPerson, groupNum);
                                        hasDutyAfter = hasDutyOnDay(dayAfterKey, currentPerson, groupNum);
                                    }
                                    
                                    // Only proceed if there's an actual conflict (not normal-normal)
                                    const hasRealConflict = (hasDutyBefore && beforeType !== 'normal-day') || 
                                                           (hasDutyAfter && afterType !== 'normal-day');
                                    
                                    if (!hasRealConflict) {
                                        console.log(`[SWAP LOGIC] ✗ Step 1a PREVENTED: Unnecessary swap - ${currentPerson} on ${dateKey} doesn't have a real conflict (both days are normal)`);
                                    } else {
                                        // OPTIMIZATION: Prioritize direct conflict-to-conflict swaps
                                        if (candidateHasConflict && !isPersonMissingOnDate(swapCandidate, groupNum, nextSameDay, 'normal') &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            // Direct conflict-to-conflict swap - both people have conflicts on same day type
                                            swapDayKey = nextSameDayKey;
                                            swapDayIndex = normalDays.indexOf(nextSameDayKey);
                                            swapFound = true;
                                            console.log(`[SWAP LOGIC] ✓ Step 1a SUCCESS (CONFLICT-TO-CONFLICT): Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${nextSameDayKey}) - both have conflicts`);
                                        } else if (!isPersonMissingOnDate(swapCandidate, groupNum, nextSameDay, 'normal') &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            // Regular swap (candidate doesn't have conflict)
                                            swapDayKey = nextSameDayKey;
                                            swapDayIndex = normalDays.indexOf(nextSameDayKey);
                                            swapFound = true;
                                            console.log(`[SWAP LOGIC] ✓ Step 1a SUCCESS: Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${nextSameDayKey})`);
                                        } else {
                                            console.log(`[SWAP LOGIC] ✗ Step 1a FAILED: Candidate ${swapCandidate} has conflict or is missing`);
                                        }
                                    }
                                } else if (nextSameDay.getMonth() !== month) {
                                    // Next same day is in next month but not in calculation range - use getPersonFromNextMonth
                                    console.log(`[SWAP LOGIC] Step 1a: Next same day is in NEXT MONTH (not in calculation range) - calculating from next month rotation`);
                                    const rotationDays = groupPeople.length;
                                    const currentRotationPosition = globalNormalRotationPosition[groupNum];
                                    const nextMonthResult = getPersonFromNextMonth(dateKey, 'normal', groupNum, month, year, rotationDays, groupPeople, currentRotationPosition);
                                    
                                    if (nextMonthResult && nextMonthResult.person) {
                                        const swapCandidate = nextMonthResult.person;
                                        const nextMonthSwapDayKey = nextMonthResult.swapDayKey;
                                        console.log(`[SWAP LOGIC] Step 1a: Found candidate ${swapCandidate} from next month on ${nextMonthSwapDayKey}`);
                                        
                                        // Verify it's the same day of week (next Tuesday/Thursday)
                                        const nextMonthSwapDate = new Date(nextMonthSwapDayKey + 'T00:00:00');
                                        if (nextMonthSwapDate.getDay() === dayOfWeek) {
                                            // Check if swap candidate is valid for current date
                                            if (!isPersonMissingOnDate(swapCandidate, groupNum, date, 'normal') &&
                                                !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                // Check if swap candidate is valid for next month swap day
                                                if (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthSwapDate, 'normal') &&
                                                    !hasConsecutiveDuty(nextMonthSwapDayKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                    swapDayKey = nextMonthSwapDayKey;
                                                    swapDayIndex = -1; // Not in normalDays array
                                                    swapFound = true;
                                                    
                                                    // Store cross-month swap info AND the swap candidate for later use
                                                    if (!crossMonthSwaps[nextMonthSwapDayKey]) {
                                                        crossMonthSwaps[nextMonthSwapDayKey] = {};
                                                    }
                                                    crossMonthSwaps[nextMonthSwapDayKey][groupNum] = currentPerson;
                                                    // Also store the swap candidate in a temporary location for the swap execution
                                                    if (!updatedAssignments[swapDayKey]) {
                                                        updatedAssignments[swapDayKey] = {};
                                                    }
                                                    updatedAssignments[swapDayKey][groupNum] = swapCandidate; // Store candidate for swap execution
                                                    console.log(`[SWAP LOGIC] ✓ Step 1a SUCCESS (CROSS-MONTH): Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${nextMonthSwapDayKey})`);
                                                    console.log(`[CROSS-MONTH SWAP NORMAL Step 1a] Person ${currentPerson} (had conflict on ${dateKey}) must be assigned to ${nextMonthSwapDayKey} (Group ${groupNum}), swap candidate: ${swapCandidate}`);
                                                } else {
                                                    console.log(`[SWAP LOGIC] ✗ Step 1a FAILED: Candidate ${swapCandidate} has conflict on next month swap day ${nextMonthSwapDayKey}`);
                                                }
                                            } else {
                                                console.log(`[SWAP LOGIC] ✗ Step 1a FAILED: Candidate ${swapCandidate} has conflict on current date ${dateKey} or is missing`);
                                            }
                                        } else {
                                            console.log(`[SWAP LOGIC] ✗ Step 1a FAILED: Next month swap day ${nextMonthSwapDayKey} is not the same day of week (expected ${dayOfWeek}, got ${nextMonthSwapDate.getDay()})`);
                                        }
                                    } else {
                                        console.log(`[SWAP LOGIC] ✗ Step 1a FAILED: Could not get person from next month`);
                                    }
                                } else {
                                    console.log(`[SWAP LOGIC] ✗ Step 1a FAILED: Next same day ${nextSameDayKey} not in normalDays or no assignment found`);
                                }
                                
                                // TUESDAY/THURSDAY - Step 1b: ONLY if Step 1a failed, try next same day of week in next month (cross-month)
                                if (!swapFound) {
                                    console.log(`[SWAP LOGIC] TUESDAY/THURSDAY - Step 1b: Trying NEXT MONTH - same day (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]})`);
                                    // Use getPersonFromNextMonth to calculate person from next month's rotation
                                    // For Tuesday/Thursday, it will try next Tuesday/Thursday first, then alternative
                                    const rotationDays = groupPeople.length;
                                    const currentRotationPosition = globalNormalRotationPosition[groupNum];
                                    const nextMonthResult = getPersonFromNextMonth(dateKey, 'normal', groupNum, month, year, rotationDays, groupPeople, currentRotationPosition);
                                    
                                    if (nextMonthResult && nextMonthResult.person) {
                                        const swapCandidate = nextMonthResult.person;
                                        const nextMonthSwapDayKey = nextMonthResult.swapDayKey;
                                        console.log(`[SWAP LOGIC] Step 1b: Found candidate ${swapCandidate} from next month on ${nextMonthSwapDayKey}`);
                                        
                                        // Check if swap candidate is valid for current date
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, date, 'normal') &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            // Check if swap candidate is valid for next month swap day
                                            const nextMonthSwapDate = new Date(nextMonthSwapDayKey + 'T00:00:00');
                                            if (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthSwapDate, 'normal') &&
                                                !hasConsecutiveDuty(nextMonthSwapDayKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                swapDayKey = nextMonthSwapDayKey;
                                                swapDayIndex = normalDays.includes(nextMonthSwapDayKey) ? normalDays.indexOf(nextMonthSwapDayKey) : -1;
                                                swapFound = true;
                                                
                                                // Store cross-month swap info
                                                if (!crossMonthSwaps[nextMonthSwapDayKey]) {
                                                    crossMonthSwaps[nextMonthSwapDayKey] = {};
                                                }
                                                crossMonthSwaps[nextMonthSwapDayKey][groupNum] = currentPerson;
                                                console.log(`[SWAP LOGIC] ✓ Step 1b SUCCESS (CROSS-MONTH): Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${nextMonthSwapDayKey})`);
                                                console.log(`[CROSS-MONTH SWAP NORMAL] Person ${currentPerson} (had conflict on ${dateKey}) must be assigned to ${nextMonthSwapDayKey} (Group ${groupNum})`);
                                            } else {
                                                console.log(`[SWAP LOGIC] ✗ Step 1b FAILED: Candidate ${swapCandidate} has conflict on next month swap day ${nextMonthSwapDayKey}`);
                                            }
                                        } else {
                                            console.log(`[SWAP LOGIC] ✗ Step 1b FAILED: Candidate ${swapCandidate} has conflict on current date ${dateKey} or is missing`);
                                        }
                                    } else {
                                        console.log(`[SWAP LOGIC] ✗ Step 1b FAILED: Could not get person from next month`);
                                    }
                                }
                                
                                // TUESDAY/THURSDAY - Step 2: ONLY if Step 1 failed, try alternative day in same week
                                // Note: If alternative day is in next month, it will be handled by Step 3b (cross-month alternative)
                                if (!swapFound) {
                                    console.log(`[SWAP LOGIC] TUESDAY/THURSDAY - Step 2: Trying alternative day (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][alternativeDayOfWeek]}) in same week AND same month`);
                                    const sameWeekDate = new Date(date);
                                    const daysToAdd = alternativeDayOfWeek - dayOfWeek;
                                    sameWeekDate.setDate(date.getDate() + daysToAdd);
                                    
                                    // Only check if alternative day is in same week AND same month
                                    if (isSameWeek(date, sameWeekDate) && sameWeekDate.getMonth() === month) {
                                        const sameWeekKey = formatDateKey(sameWeekDate);
                                        if (updatedAssignments[sameWeekKey]?.[groupNum]) {
                                            const swapCandidate = updatedAssignments[sameWeekKey][groupNum];
                                            console.log(`[SWAP LOGIC] Step 2: Found candidate ${swapCandidate} on ${sameWeekKey}`);
                                            
                                            if (!isPersonMissingOnDate(swapCandidate, groupNum, sameWeekDate, 'normal') &&
                                                !hasConsecutiveDuty(sameWeekKey, swapCandidate, groupNum, simulatedAssignments) &&
                                                !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                swapDayKey = sameWeekKey;
                                                swapDayIndex = normalDays.indexOf(sameWeekKey);
                                                swapFound = true;
                                                console.log(`[SWAP LOGIC] ✓ Step 2 SUCCESS: Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${sameWeekKey})`);
                                            } else {
                                                console.log(`[SWAP LOGIC] ✗ Step 2 FAILED: Candidate ${swapCandidate} has conflict or is missing`);
                                            }
                                        } else {
                                            console.log(`[SWAP LOGIC] ✗ Step 2 FAILED: No candidate found on ${sameWeekKey}`);
                                        }
                                    } else {
                                        console.log(`[SWAP LOGIC] ✗ Step 2 FAILED: Alternative day ${formatDateKey(sameWeekDate)} not in same week or same month`);
                                    }
                                }
                                
                                // TUESDAY/THURSDAY - Step 3: ONLY if Step 2 failed, try next alternative day in same month
                                if (!swapFound) {
                                    console.log(`[SWAP LOGIC] TUESDAY/THURSDAY - Step 3: Trying next alternative day (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][alternativeDayOfWeek]}) in same month`);
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
                                            console.log(`[SWAP LOGIC] Step 3: Found candidate ${swapCandidate} on ${nextAlternativeKey}`);
                                            
                                            if (!isPersonMissingOnDate(swapCandidate, groupNum, nextAlternativeDay) &&
                                                !hasConsecutiveDuty(nextAlternativeKey, swapCandidate, groupNum, simulatedAssignments) &&
                                                !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                swapDayKey = nextAlternativeKey;
                                                swapDayIndex = normalDays.indexOf(nextAlternativeKey);
                                                swapFound = true;
                                                console.log(`[SWAP LOGIC] ✓ Step 3 SUCCESS: Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${nextAlternativeKey})`);
                                            } else {
                                                console.log(`[SWAP LOGIC] ✗ Step 3 FAILED: Candidate ${swapCandidate} has conflict or is missing`);
                                            }
                                        } else {
                                            console.log(`[SWAP LOGIC] ✗ Step 3 FAILED: No candidate found on ${nextAlternativeKey}`);
                                        }
                                    } else {
                                        console.log(`[SWAP LOGIC] ✗ Step 3 FAILED: Next alternative day is in next month (will try in Step 3b)`);
                                    }
                                }
                                
                                // TUESDAY/THURSDAY - Step 3b: ONLY if Step 3 failed, try next alternative day in next month (cross-month)
                                // This handles cases like Thursday 26/02/2026 → next Tuesday 05/03/2026
                                if (!swapFound) {
                                    console.log(`[SWAP LOGIC] TUESDAY/THURSDAY - Step 3b: Trying NEXT MONTH - alternative day (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][alternativeDayOfWeek]})`);
                                    // Use getPersonFromNextMonth to calculate person from next month's rotation
                                    // For Thursday, it will try next Tuesday in next month
                                    const rotationDays = groupPeople.length;
                                    const currentRotationPosition = globalNormalRotationPosition[groupNum];
                                    const nextMonthResult = getPersonFromNextMonth(dateKey, 'normal', groupNum, month, year, rotationDays, groupPeople, currentRotationPosition);
                                    
                                    if (nextMonthResult && nextMonthResult.person) {
                                        const swapCandidate = nextMonthResult.person;
                                        const nextMonthSwapDayKey = nextMonthResult.swapDayKey;
                                        console.log(`[SWAP LOGIC] Step 3b: Found candidate ${swapCandidate} from next month on ${nextMonthSwapDayKey}`);
                                        
                                        // Verify the swap day is the alternative day of week (not same day)
                                        const nextMonthSwapDate = new Date(nextMonthSwapDayKey + 'T00:00:00');
                                        if (nextMonthSwapDate.getDay() === alternativeDayOfWeek) {
                                            // Check if swap candidate is valid for current date
                                            if (!isPersonMissingOnDate(swapCandidate, groupNum, date) &&
                                                !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                // Check if swap candidate is valid for next month swap day
                                                if (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthSwapDate) &&
                                                    !hasConsecutiveDuty(nextMonthSwapDayKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                    swapDayKey = nextMonthSwapDayKey;
                                                    swapDayIndex = normalDays.includes(nextMonthSwapDayKey) ? normalDays.indexOf(nextMonthSwapDayKey) : -1;
                                                    swapFound = true;
                                                    
                                                    // Store cross-month swap info
                                                    if (!crossMonthSwaps[nextMonthSwapDayKey]) {
                                                        crossMonthSwaps[nextMonthSwapDayKey] = {};
                                                    }
                                                    crossMonthSwaps[nextMonthSwapDayKey][groupNum] = currentPerson;
                                                    console.log(`[SWAP LOGIC] ✓ Step 3b SUCCESS (CROSS-MONTH): Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${nextMonthSwapDayKey})`);
                                                    console.log(`[CROSS-MONTH SWAP NORMAL Step 3b] Person ${currentPerson} (had conflict on ${dateKey}) must be assigned to ${nextMonthSwapDayKey} (Group ${groupNum})`);
                                                } else {
                                                    console.log(`[SWAP LOGIC] ✗ Step 3b FAILED: Candidate ${swapCandidate} has conflict on next month swap day ${nextMonthSwapDayKey}`);
                                                }
                                            } else {
                                                console.log(`[SWAP LOGIC] ✗ Step 3b FAILED: Candidate ${swapCandidate} has conflict on current date ${dateKey} or is missing`);
                                            }
                                        } else {
                                            console.log(`[SWAP LOGIC] ✗ Step 3b FAILED: Next month swap day ${nextMonthSwapDayKey} is not alternative day (expected ${alternativeDayOfWeek}, got ${nextMonthSwapDate.getDay()})`);
                                        }
                                    } else {
                                        console.log(`[SWAP LOGIC] ✗ Step 3b FAILED: Could not get person from next month`);
                                    }
                                }
                                
                                // TUESDAY/THURSDAY - Step 4: ONLY if Step 3b failed, try next alternative day in next month (cross-month)
                                if (!swapFound) {
                                    console.log(`[SWAP LOGIC] TUESDAY/THURSDAY - Step 4: Trying NEXT MONTH - alternative day (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][alternativeDayOfWeek]}) - final attempt`);
                                    // Use getPersonFromNextMonth to calculate person from next month's rotation
                                    // For Tuesday/Thursday, it will try alternative day (Thursday/Tuesday) in next month
                                    const rotationDays = groupPeople.length;
                                    const currentRotationPosition = globalNormalRotationPosition[groupNum];
                                    const nextMonthResult = getPersonFromNextMonth(dateKey, 'normal', groupNum, month, year, rotationDays, groupPeople, currentRotationPosition);
                                    
                                    if (nextMonthResult && nextMonthResult.person) {
                                        const swapCandidate = nextMonthResult.person;
                                        const nextMonthSwapDayKey = nextMonthResult.swapDayKey;
                                        console.log(`[SWAP LOGIC] Step 4: Found candidate ${swapCandidate} from next month on ${nextMonthSwapDayKey}`);
                                        
                                        // Verify the swap day is the alternative day of week (not same day)
                                        const nextMonthSwapDate = new Date(nextMonthSwapDayKey + 'T00:00:00');
                                        if (nextMonthSwapDate.getDay() === alternativeDayOfWeek) {
                                            // Check if swap candidate is valid for current date
                                            if (!isPersonMissingOnDate(swapCandidate, groupNum, date) &&
                                                !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                // Check if swap candidate is valid for next month swap day
                                                if (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthSwapDate) &&
                                                    !hasConsecutiveDuty(nextMonthSwapDayKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                    swapDayKey = nextMonthSwapDayKey;
                                                    swapDayIndex = normalDays.includes(nextMonthSwapDayKey) ? normalDays.indexOf(nextMonthSwapDayKey) : -1;
                                                    swapFound = true;
                                                    
                                                    // Store cross-month swap info
                                                    if (!crossMonthSwaps[nextMonthSwapDayKey]) {
                                                        crossMonthSwaps[nextMonthSwapDayKey] = {};
                                                    }
                                                    crossMonthSwaps[nextMonthSwapDayKey][groupNum] = currentPerson;
                                                    console.log(`[SWAP LOGIC] ✓ Step 4 SUCCESS (CROSS-MONTH): Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${nextMonthSwapDayKey})`);
                                                    console.log(`[CROSS-MONTH SWAP NORMAL] Person ${currentPerson} (had conflict on ${dateKey}) must be assigned to ${nextMonthSwapDayKey} (Group ${groupNum})`);
                                                } else {
                                                    console.log(`[SWAP LOGIC] ✗ Step 4 FAILED: Candidate ${swapCandidate} has conflict on next month swap day ${nextMonthSwapDayKey}`);
                                                }
                                            } else {
                                                console.log(`[SWAP LOGIC] ✗ Step 4 FAILED: Candidate ${swapCandidate} has conflict on current date ${dateKey} or is missing`);
                                            }
                                        } else {
                                            console.log(`[SWAP LOGIC] ✗ Step 4 FAILED: Next month swap day ${nextMonthSwapDayKey} is not alternative day (expected ${alternativeDayOfWeek}, got ${nextMonthSwapDate.getDay()})`);
                                        }
                                    } else {
                                        console.log(`[SWAP LOGIC] ✗ Step 4 FAILED: Could not get person from next month`);
                                    }
                                }
                            }
                            
                            // Perform swap if found - STOP after finding valid swap (don't continue to other steps)
                            // Note: swapDayIndex can be -1 for cross-month swaps (not in normalDays array)
                            if (swapFound && swapDayKey) {
                                // Get swap candidate - for cross-month swaps, it should already be stored in updatedAssignments
                                const swapCandidate = updatedAssignments[swapDayKey]?.[groupNum];
                                
                                if (!swapCandidate) {
                                    // If we can't find the candidate, skip this swap
                                    console.warn(`[SWAP WARNING] Could not find swap candidate for ${swapDayKey} (Group ${groupNum})`);
                                    continue;
                                }
                                
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
                                // Improved Greek reasons:
                                // Use the ACTUAL conflict neighbor day (e.g. Fri) instead of the swap-execution day (e.g. Thu).
                                const conflictNeighborKey = getConsecutiveConflictNeighborDayKey(dateKey, currentPerson, groupNum, simulatedAssignments) || dateKey;
                                const isCrossMonthSwap = dateKey.substring(0, 7) !== swapDayKey.substring(0, 7);
                                const swapMeta = isCrossMonthSwap ? {
                                    isCrossMonth: true,
                                    originDayKey: dateKey,
                                    swapDayKey: swapDayKey,
                                    conflictDateKey: conflictNeighborKey
                                } : null;
                                storeAssignmentReason(
                                    dateKey,
                                    groupNum,
                                    swapCandidate,
                                    'swap',
                                    buildSwapReasonGreek({
                                        changedWithName: currentPerson,
                                        conflictedPersonName: currentPerson,
                                        conflictDateKey: conflictNeighborKey,
                                        newAssignmentDateKey: swapDayKey,
                                        subjectName: swapCandidate
                                    }),
                                    currentPerson,
                                    swapPairId,
                                    swapMeta
                                );
                                storeAssignmentReason(
                                    swapDayKey,
                                    groupNum,
                                    currentPerson,
                                    'swap',
                                    buildSwapReasonGreek({
                                        changedWithName: swapCandidate,
                                        conflictedPersonName: currentPerson,
                                        conflictDateKey: conflictNeighborKey,
                                        newAssignmentDateKey: swapDayKey,
                                        subjectName: currentPerson
                                    }),
                                    swapCandidate,
                                    swapPairId,
                                    swapMeta
                                );
                                
                                // Mark both people as swapped to prevent re-swapping
                                swappedPeopleSet.add(`${dateKey}:${groupNum}:${currentPerson}`);
                                swappedPeopleSet.add(`${swapDayKey}:${groupNum}:${swapCandidate}`);
                                
                                // IMPORTANT: Stop processing this conflict - swap found, don't try other steps
                                // Continue to next group/person - swap is complete
                                continue;
                            }
                        }
                        
                        // If we reach here, swap logic ran but didn't find a solution
                        // Log this for debugging
                        if (hasConsecutiveConflict && !swapFound) {
                            console.warn(`[SWAP WARNING] Could not find swap solution for ${currentPerson} on ${dateKey} (Group ${groupNum}). Conflict remains unresolved.`);
                        }
                    }
                });
                
                // Store final assignments (after swap logic) for saving when OK is pressed
                calculationSteps.finalNormalAssignments = updatedAssignments;

                // CRITICAL for multi-month ranges:
                // The "executeCalculation()" flow persists assignments from calculationSteps.tempAssignments (or Firestore tempAssignments),
                // so ensure tempAssignments.normal reflects the FINAL normal schedule (including reinsertion + swaps).
                try {
                    if (!calculationSteps.tempAssignments || typeof calculationSteps.tempAssignments !== 'object') {
                        calculationSteps.tempAssignments = {
                            special: calculationSteps.tempAssignments?.special || calculationSteps.tempSpecialAssignments || {},
                            weekend: calculationSteps.tempAssignments?.weekend || calculationSteps.tempWeekendAssignments || {},
                            semi: calculationSteps.tempAssignments?.semi || calculationSteps.tempSemiAssignments || {},
                            normal: updatedAssignments,
                            startDate: calculationSteps.startDate ? new Date(calculationSteps.startDate).toISOString() : null,
                            endDate: calculationSteps.endDate ? new Date(calculationSteps.endDate).toISOString() : null
                        };
                    } else {
                        calculationSteps.tempAssignments.normal = updatedAssignments;
                    }
                    // Best-effort: persist updated temp assignments so range-save uses the correct final normal schedule.
                    if (typeof saveTempAssignmentsToFirestore === 'function') {
                        saveTempAssignmentsToFirestore(calculationSteps.tempAssignments).catch(() => {});
                    }
                } catch (_) {}
                
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

            console.log('[STEP 4] showNormalSwapResults() called with', swappedPeople.length, 'swapped people');
            let message = '';
            
            const baselineByDate = calculationSteps.tempNormalBaselineAssignments || {};
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
                    
                    // IMPORTANT: Skip entries where the replacement has a 'shift' reason
                    // These are people who were shifted forward due to reinsertion, not direct replacements
                    // Only show direct replacements ('skip') and actual swaps ('swap')
                    if (reasonObj && reasonObj.type === 'shift') {
                        continue; // Skip this entry - person was shifted forward, not a direct replacement
                    }
                    
                    // Also skip if this is a cascading shift: if the replacement doesn't have a 'skip' or 'swap' reason,
                    // and the baseline person was disabled/missing, then this person was shifted forward, not a direct replacement
                    const isBaseDisabledOrMissing = isPersonDisabledForDuty(base, groupNum, 'normal') || isPersonMissingOnDate(base, groupNum, dateObj, 'normal');
                    if (!reasonObj && isBaseDisabledOrMissing) {
                        // This is a cascading shift - the baseline person was skipped, and this person moved forward
                        // Skip this entry - only show the direct replacement (who has a 'skip' reason)
                        continue;
                    }
                    
                    // Also skip if baseline person has a 'skip' reason on a previous date (they were replaced, causing cascading shifts)
                    // Check if baseline person was replaced on any previous date in this month
                    if (!reasonObj && !isBaseDisabledOrMissing) {
                        const monthKey = `${dateObj.getFullYear()}-${dateObj.getMonth()}`;
                        let baselineWasReplaced = false;
                        for (const dk in assignmentReasons) {
                            if (dk >= dateKey) break; // Only check previous dates
                            const dkDate = new Date(dk + 'T00:00:00');
                            const dkMonthKey = `${dkDate.getFullYear()}-${dkDate.getMonth()}`;
                            if (dkMonthKey !== monthKey) continue; // Only same month
                            const dkReason = assignmentReasons[dk]?.[groupNum]?.[base];
                            if (dkReason && dkReason.type === 'skip') {
                                baselineWasReplaced = true;
                                break;
                            }
                        }
                        if (baselineWasReplaced) {
                            // Baseline person was replaced earlier, causing this shift - skip it
                            continue;
                        }
                    }
                    
                    const reasonText = reasonObj?.reason
                        ? String(reasonObj.type === 'swap' ? normalizeSwapReasonText(reasonObj.reason) : reasonObj.reason)
                        : '';
                    const briefReason = reasonText
                        ? reasonText.split('.').filter(Boolean)[0]
                        : (isBaseDisabledOrMissing
                            ? (buildUnavailableReplacementReason({
                                skippedPersonName: base,
                                replacementPersonName: comp,
                                dateObj,
                                groupNum,
                                dutyCategory: 'normal'
                            }).split('.').filter(Boolean)[0] || '')
                            : 'Αλλαγή');

                    const otherKey = reasonObj?.type === 'swap'
                        ? findSwapOtherDateKey(reasonObj.swapPairId, groupNum, dateKey)
                        : null;
                    const swapDateStr = otherKey
                        ? new Date(otherKey + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' })
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
                message = '<div class="alert alert-success"><i class="fas fa-check-circle me-2"></i><strong>Καμία αλλαγή!</strong><br>Δεν βρέθηκαν αλλαγές στις καθημερινές.</div>';
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
                <div class="modal fade" id="normalSwapResultsModal" tabindex="-1">
                    <div class="modal-dialog modal-xl modal-superwide">
                        <div class="modal-content results-modal-normal">
                            <div class="modal-header results-header results-header-normal">
                                <h5 class="modal-title"><i class="fas fa-exchange-alt me-2"></i>Αποτελέσματα Αλλαγών Καθημερινών</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                            </div>
                            <div class="modal-body">
                                ${message}
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-primary" id="normalSwapOkButton">OK</button>
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
                    const originalOkHtml = okButton.innerHTML;
                    okButton.disabled = true;
                    okButton.classList.add('is-saving');
                    okButton.innerHTML = `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Αποθήκευση...`;
                    setStepFooterBusy(true);
                    try {
                        await saveFinalNormalAssignments(updatedAssignments);
                        // Close the step-by-step calculation modal
                        const stepModal = bootstrap.Modal.getInstance(document.getElementById('stepByStepCalculationModal'));
                        if (stepModal) {
                            stepModal.hide();
                        }
                        const m = bootstrap.Modal.getInstance(document.getElementById('normalSwapResultsModal'));
                        if (m) m.hide();
                        // Reload calendar to show results
                        location.reload();
                    } finally {
                        okButton.innerHTML = originalOkHtml;
                        okButton.classList.remove('is-saving');
                        okButton.disabled = false;
                    }
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
                    
                    await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'normalDayAssignments', organizedNormal);
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
                    
                    // IMPORTANT: Save cross-month swaps to Firestore after swap logic completes
                    try {
                        console.log('[STEP 4] Saving crossMonthSwaps to Firestore:', Object.keys(crossMonthSwaps).length, 'dates');
                        if (Object.keys(crossMonthSwaps).length > 0) {
                            const sanitizedCrossMonth = sanitizeForFirestore(crossMonthSwaps);
                            await db.collection('dutyShifts').doc('crossMonthSwaps').set({
                                ...sanitizedCrossMonth,
                                lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                                updatedBy: user.uid
                            });
                            console.log('[STEP 4] Saved crossMonthSwaps to Firestore successfully');
                        } else {
                            console.log('[STEP 4] No crossMonthSwaps to save');
                        }
                    } catch (error) {
                        console.error('[STEP 4] Error saving crossMonthSwaps to Firestore:', error);
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
            if (!preserveExisting) {
                const dateIterator = new Date(startDate);
                while (dateIterator <= endDate) {
                    const key = formatDateKey(dateIterator);
                    // Delete assignments for the selected date range
                        delete dutyAssignments[key];
                            // Also delete from day-type-specific assignments
                            delete normalDayAssignments[key];
                            delete semiNormalAssignments[key];
                            delete weekendAssignments[key];
                            delete specialHolidayAssignments[key];
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
                                const rotationPerson = assignedPerson; // remember who strict rotation picked (for reason text)
                                
                                // Check if assigned person is missing/disabled for special, if so find next in rotation
                                if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, dateIterator, 'special')) {
                                    // Simply skip disabled person and find next person in rotation who is NOT disabled/missing
                                    // Keep going through rotation until we find someone eligible (check entire rotation twice to be thorough)
                                    let foundReplacement = false;
                                    for (let offset = 1; offset <= rotationDays * 2 && !foundReplacement; offset++) {
                                        const idx = (rotationPosition + offset) % rotationDays;
                                        const candidate = groupPeople[idx];
                                        if (!candidate) continue;
                                        if (!isPersonMissingOnDate(candidate, groupNum, dateIterator, 'special')) {
                                            assignedPerson = candidate;
                                            foundReplacement = true;
                                            // Persist skip reason (history) for disabled/missing special-holiday replacements too.
                                            storeAssignmentReason(
                                                dateKey,
                                                groupNum,
                                                assignedPerson,
                                                'skip',
                                                buildUnavailableReplacementReason({
                                                    skippedPersonName: rotationPerson,
                                                    replacementPersonName: assignedPerson,
                                                    dateObj: new Date(dateIterator),
                                                    groupNum,
                                                    dutyCategory: 'special'
                                                }),
                                                rotationPerson,
                                                null
                                            );
                                            break;
                                        }
                                    }
                                    // If no replacement found after checking everyone twice (everyone disabled), leave unassigned
                                    if (!foundReplacement) {
                                        assignedPerson = null;
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
                // IMPORTANT: For multi-month calculations, prefer the FINAL Step 4 result if available
                // (includes return-from-missing reinsertion + swap logic), otherwise fall back to tempAssignments.normal.
                const normalSource = (calculationSteps && calculationSteps.finalNormalAssignments)
                    ? calculationSteps.finalNormalAssignments
                    : (tempAssignments.normal || {});
                for (const dateKey in normalSource) {
                    for (const groupNum in normalSource[dateKey] || {}) {
                        const person = normalSource[dateKey]?.[groupNum];
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
            } finally {
                // Always clear temp assignments when computation ends (success, early return, or error)
                calculationSteps.tempAssignments = null;

                try {
                    if (window.firebase && firebase.firestore) {
                        const db = window.db || firebase.firestore();
                        await db.collection('dutyShifts').doc('tempAssignments').delete();
                    }
                } catch (error) {
                    // Ignore cleanup errors (e.g. missing doc / offline) to avoid masking the real failure
                }
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
                
                // Prefer tempSpecialAssignments (canonical Step 1 preview format), fall back to specialHolidayAssignments
                const fromTemp = calculationSteps.tempSpecialAssignments?.[dateKey] || null; // { groupNum -> personName }
                const groupMap = fromTemp && typeof fromTemp === 'object'
                    ? fromTemp
                    : extractGroupAssignmentsMap(specialHolidayAssignments?.[dateKey]);

                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const personName = groupMap?.[groupNum];
                    if (!personName) continue;
                    if (!simulatedSpecialAssignments[monthKey][groupNum]) simulatedSpecialAssignments[monthKey][groupNum] = new Set();
                    simulatedSpecialAssignments[monthKey][groupNum].add(personName);
                }
            });
            
            const periodLabel = buildPeriodLabel(startDate, endDate);
            let html = '<div class="step-content">';
            html += `<h6 class="mb-3"><i class="fas fa-calendar-alt me-2"></i>Περίοδος: ${periodLabel}</h6>`;
            
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
                html += `<th>${getGroupName(1)}</th>`;
                html += `<th>${getGroupName(2)}</th>`;
                html += `<th>${getGroupName(3)}</th>`;
                html += `<th>${getGroupName(4)}</th>`;
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
                
                // IMPORTANT: Track rotation persons (who SHOULD be assigned according to rotation)
                // This is separate from assigned persons (who may have been swapped/skipped)
                const weekendRotationPersons = {}; // dateKey -> { groupNum -> rotationPerson }
                
                // Track which people have been assigned to which days (to prevent duplicate assignments after replacements)
                const assignedPeoplePreviewWeekend = {}; // monthKey -> { groupNum -> Set of person names }
                
                sortedWeekends.forEach((dateKey, weekendIndex) => {
                    const date = new Date(dateKey + 'T00:00:00');
                    const dateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const dayName = getGreekDayName(date);
                    const month = date.getMonth();
                    const year = date.getFullYear();
                    const monthKey = `${year}-${month}`;
                    
                    if (!assignedPeoplePreviewWeekend[monthKey]) {
                        assignedPeoplePreviewWeekend[monthKey] = {};
                    }
                    
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
                    html += `<td><strong>${dateStr}</strong></td>`;
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
                                    // Continue from last person assigned in previous month (month-scoped; falls back to legacy)
                                    const lastPersonName = getLastRotationPersonForDate('weekend', date, groupNum);
                                    const lastPersonIndex = groupPeople.indexOf(lastPersonName);
                                    if (lastPersonName && lastPersonIndex >= 0) {
                                        // Found last person - start from next person
                                        globalWeekendRotationPosition[groupNum] = (lastPersonIndex + 1) % rotationDays;
                                        console.log(`[WEEKEND ROTATION] Continuing from last person ${lastPersonName} (index ${lastPersonIndex}) for group ${groupNum}, starting at position ${globalWeekendRotationPosition[groupNum]}`);
                                    } else {
                                        // Last person not found in list - use rotation calculation
                                const daysSinceStart = getRotationPosition(date, 'weekend', groupNum);
                                globalWeekendRotationPosition[groupNum] = daysSinceStart % rotationDays;
                                        if (lastPersonName) {
                                            console.log(`[WEEKEND ROTATION] Last person ${lastPersonName} not found in group ${groupNum} list, using rotation calculation: position ${globalWeekendRotationPosition[groupNum]}`);
                                        }
                                    }
                                }
                            }
                            
                            // PREVIEW MODE: Just show basic rotation WITHOUT skip logic
                            // Skip logic will run when Next is pressed
                            let rotationPosition = globalWeekendRotationPosition[groupNum] % rotationDays;
                            
                            // IMPORTANT: Track the rotation person (who SHOULD be assigned according to rotation)
                            // This is the person BEFORE any skip/missing logic
                            const rotationPerson = groupPeople[rotationPosition];
                            
                            // Store rotation person for this date/group (before any skip logic)
                            if (!weekendRotationPersons[dateKey]) {
                                weekendRotationPersons[dateKey] = {};
                            }
                            weekendRotationPersons[dateKey][groupNum] = rotationPerson;
                            
                            let assignedPerson = rotationPerson;
                            
                            // CRITICAL: Check if the rotation person is disabled/missing BEFORE any other logic.
                            // This ensures disabled people are ALWAYS skipped, even when rotation cycles back to them.
                            let wasReplaced = false;
                            let replacementIndex = null;
                            if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date, 'weekend')) {
                                // Simply skip disabled person and find next person in rotation who is NOT disabled/missing
                                // Keep going through rotation until we find someone eligible (check entire rotation twice to be thorough)
                                // IMPORTANT: Also check if replacement was already assigned this month to prevent duplicate assignments
                                if (!assignedPeoplePreviewWeekend[monthKey][groupNum]) {
                                    assignedPeoplePreviewWeekend[monthKey][groupNum] = new Set();
                                }
                                let foundReplacement = false;
                                for (let offset = 1; offset <= rotationDays * 2 && !foundReplacement; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (isPersonMissingOnDate(candidate, groupNum, date, 'weekend')) continue;
                                    // Check if candidate was already assigned this month (to prevent duplicate assignments)
                                    if (assignedPeoplePreviewWeekend[monthKey][groupNum] && assignedPeoplePreviewWeekend[monthKey][groupNum].has(candidate)) continue;
                                    
                                    // Found eligible replacement
                                    assignedPerson = candidate;
                                    replacementIndex = idx;
                                    wasReplaced = true;
                                    foundReplacement = true;
                                    storeAssignmentReason(
                                        dateKey,
                                        groupNum,
                                        assignedPerson,
                                        'skip',
                                        buildUnavailableReplacementReason({
                                            skippedPersonName: rotationPerson,
                                            replacementPersonName: assignedPerson,
                                            dateObj: date,
                                            groupNum,
                                            dutyCategory: 'weekend'
                                        }),
                                        rotationPerson,
                                        null
                                    );
                                    break;
                                }
                                // If no replacement found after checking everyone twice (everyone disabled or already assigned), leave unassigned
                                if (!foundReplacement) {
                                    assignedPerson = null;
                                }
                            }

                            // PREVIEW DISPLAY: show the weekend skip changes (special holiday duty in same month),
                            // using the same replacement rules as runWeekendSkipLogic().
                            let displayPerson = assignedPerson;
                            if (displayPerson) {
                                const hasSpecialHoliday = simulatedSpecialAssignments[monthKey]?.[groupNum]?.has(displayPerson) || false;
                                const wasSkipped = skippedInMonth[monthKey][groupNum].has(displayPerson);
                                if (hasSpecialHoliday || wasSkipped) {
                                    skippedInMonth[monthKey][groupNum].add(displayPerson);
                                    const currentIndex = groupPeople.indexOf(displayPerson);
                                    let replacementPerson = null;
                                for (let offset = 1; offset < rotationDays; offset++) {
                                        const nextIndex = (currentIndex + offset) % rotationDays;
                                    const candidate = groupPeople[nextIndex];
                                        if (!candidate || isPersonMissingOnDate(candidate, groupNum, date, 'weekend')) continue;
                                    const candidateHasSpecial = simulatedSpecialAssignments[monthKey]?.[groupNum]?.has(candidate) || false;
                                    const candidateWasSkipped = skippedInMonth[monthKey][groupNum].has(candidate);
                                    if (!candidateHasSpecial && !candidateWasSkipped) {
                                            replacementPerson = candidate;
                                        break;
                                    }
                                }
                                    if (replacementPerson) displayPerson = replacementPerson;
                                }
                            }
                            
                            // Store assignment for saving
                            if (assignedPerson) {
                                if (!simulatedWeekendAssignments[dateKey]) {
                                    simulatedWeekendAssignments[dateKey] = {};
                                }
                                simulatedWeekendAssignments[dateKey][groupNum] = assignedPerson;
                                
                                // Track that this person has been assigned (to prevent duplicate assignment later)
                                if (assignedPeoplePreviewWeekend[monthKey] && assignedPeoplePreviewWeekend[monthKey][groupNum]) {
                                    assignedPeoplePreviewWeekend[monthKey][groupNum].add(assignedPerson);
                                }
                                
                                // Advance rotation position from the person ACTUALLY assigned (not the skipped person)
                                // This ensures that when Person A is replaced by Person B, next weekend assigns Person C, not Person B again
                                if (wasReplaced && replacementIndex !== null) {
                                    // Person was replaced - advance from replacement's position
                                    globalWeekendRotationPosition[groupNum] = (replacementIndex + 1) % rotationDays;
                                } else {
                                    // No replacement - advance from assigned person's position
                                    const assignedIndex = groupPeople.indexOf(assignedPerson);
                                    if (assignedIndex !== -1) {
                                        globalWeekendRotationPosition[groupNum] = (assignedIndex + 1) % rotationDays;
                                    } else {
                                        // Fallback: advance from rotation position
                                        globalWeekendRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                    }
                                }
                            } else {
                                // No person found, still advance rotation position
                                globalWeekendRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                            }
                            
                            // Get last duty date and days since for display
                            let lastDutyInfo = '';
                            let daysCountInfo = '';
                            if (displayPerson) {
                                const daysSince = countDaysSinceLastDuty(dateKey, displayPerson, groupNum, 'weekend', dayTypeLists, startDate);
                                    const dutyDates = getLastAndNextDutyDates(displayPerson, groupNum, 'weekend', groupPeople.length);
                                    lastDutyInfo = dutyDates.lastDuty !== 'Δεν έχει' ? `<br><small class="text-muted">Τελευταία: ${dutyDates.lastDuty}</small>` : '';
                                
                                // Show days counted in parentheses
                                if (daysSince !== null && daysSince !== Infinity) {
                                    daysCountInfo = ` <span class="text-info">${daysSince}/${rotationDays} ημέρες</span>`;
                                } else if (daysSince === Infinity) {
                                    daysCountInfo = ' <span class="text-success">πρώτη φορά</span>';
                                }
                            }
                            
                            html += `<td>${buildBaselineComputedCellHtml(rotationPerson, displayPerson, daysCountInfo, lastDutyInfo)}</td>`;
                        }
                    }
                    
                    html += '</tr>';
                });
                
                // Store assignments and rotation positions in calculationSteps for saving when Next is pressed
                calculationSteps.tempWeekendAssignments = simulatedWeekendAssignments;
                calculationSteps.tempWeekendBaselineAssignments = weekendRotationPersons;
                calculationSteps.lastWeekendRotationPositions = {};
                // IMPORTANT: Find the last ASSIGNED person (after replacement), not the rotation person
                // This ensures that when Person A is replaced by Person B, next calculation starts from Person B's position
                // Use the simulatedWeekendAssignments (actual assigned persons) instead of weekendRotationPersons
                for (let g = 1; g <= 4; g++) {
                    const sortedWeekendKeys = [...weekendHolidays].sort();
                    let lastAssignedPerson = null;
                    for (let i = sortedWeekendKeys.length - 1; i >= 0; i--) {
                        const dateKey = sortedWeekendKeys[i];
                        if (simulatedWeekendAssignments[dateKey] && simulatedWeekendAssignments[dateKey][g]) {
                            lastAssignedPerson = simulatedWeekendAssignments[dateKey][g];
                            break;
                        }
                    }
                    if (lastAssignedPerson) {
                        calculationSteps.lastWeekendRotationPositions[g] = lastAssignedPerson;
                        console.log(`[WEEKEND ROTATION] Storing last assigned person ${lastAssignedPerson} for group ${g} (after replacement)`);
                    }
                }

                // Store last rotation person per month (for correct recalculation of individual months)
                // IMPORTANT: Use the ASSIGNED person (after replacement), not the rotation person
                // This ensures that when Person A is replaced by Person B, next calculation starts from Person B's position
                const sortedWeekendKeysForMonth = [...weekendHolidays].sort();
                const lastWeekendRotationPositionsByMonth = {}; // monthKey -> { groupNum -> assignedPerson }
                for (const dateKey of sortedWeekendKeysForMonth) {
                    const d = new Date(dateKey + 'T00:00:00');
                    const monthKey = getMonthKeyFromDate(d);
                    for (let g = 1; g <= 4; g++) {
                        // Use the assigned person (after replacement), not the rotation person
                        const assignedPerson = simulatedWeekendAssignments[dateKey]?.[g];
                        if (assignedPerson) {
                            if (!lastWeekendRotationPositionsByMonth[monthKey]) {
                                lastWeekendRotationPositionsByMonth[monthKey] = {};
                            }
                            lastWeekendRotationPositionsByMonth[monthKey][g] = assignedPerson;
                        }
                    }
                }
                calculationSteps.lastWeekendRotationPositionsByMonth = lastWeekendRotationPositionsByMonth;
                
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
            
            // For Step 3 display-only swap preview we need these after initial table render.
            let sortedSemiForPreview = [];
            const semiAssignmentsForPreview = {}; // dateKey -> { groupNum -> person }
            const semiRotationPersonsForPreview = {}; // dateKey -> { groupNum -> rotation person }
            
            // First, load special holiday assignments from Step 1 saved data (already includes missing replacements)
            const simulatedSpecialAssignments = {}; // monthKey -> { groupNum -> Set of person names }
            const sortedSpecial = [...specialHolidays].sort();
            sortedSpecial.forEach((dateKey) => {
                const date = new Date(dateKey + 'T00:00:00');
                if (isNaN(date.getTime())) return;
                const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
                if (!simulatedSpecialAssignments[monthKey]) simulatedSpecialAssignments[monthKey] = {};

                // Prefer tempSpecialAssignments (canonical Step 1 preview format), fall back to specialHolidayAssignments
                const fromTemp = calculationSteps.tempSpecialAssignments?.[dateKey] || null; // { groupNum -> personName }
                const groupMap = fromTemp && typeof fromTemp === 'object'
                    ? fromTemp
                    : extractGroupAssignmentsMap(specialHolidayAssignments?.[dateKey]);
                
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const personName = groupMap?.[groupNum];
                    if (!personName) continue;
                    if (!simulatedSpecialAssignments[monthKey][groupNum]) simulatedSpecialAssignments[monthKey][groupNum] = new Set();
                    simulatedSpecialAssignments[monthKey][groupNum].add(personName);
                }
            });
            
            // Second, simulate what weekends will be assigned (from Step 2)
            const simulatedWeekendAssignments = {}; // dateKey -> { groupNum -> person name }
            // Prefer loading saved Step 2 weekend assignments (already includes skip logic)
            let hasSavedWeekendAssignments = false;
            for (const dateKey of [...weekendHolidays].sort()) {
                const assignment = weekendAssignments[dateKey];
                if (!assignment) continue;
                hasSavedWeekendAssignments = true;
                if (typeof assignment === 'string') {
                    const parts = assignment.split(',').map(p => p.trim());
                    parts.forEach(part => {
                        const match = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)$/);
                        if (!match) return;
                        const personName = match[1].trim();
                        const groupNum = parseInt(match[2]);
                        if (!simulatedWeekendAssignments[dateKey]) simulatedWeekendAssignments[dateKey] = {};
                        simulatedWeekendAssignments[dateKey][groupNum] = personName;
                    });
                } else if (typeof assignment === 'object' && !Array.isArray(assignment)) {
                    for (const groupNum in assignment) {
                        const personName = assignment[groupNum];
                        if (!personName) continue;
                        if (!simulatedWeekendAssignments[dateKey]) simulatedWeekendAssignments[dateKey] = {};
                        simulatedWeekendAssignments[dateKey][parseInt(groupNum)] = personName;
                    }
                }
            }

            // Fallback (first-time run): recalculate weekends from rotation (no skip logic here)
            const skippedInMonth = {}; // monthKey -> { groupNum -> Set of person names }
            const globalWeekendRotationPosition = {}; // groupNum -> global position (continues across months)
            // IMPORTANT: Track weekend rotation persons (who SHOULD be assigned according to rotation)
            // This is separate from assigned persons (who may have been swapped/skipped)
            const weekendRotationPersons = {}; // dateKey -> { groupNum -> rotationPerson }
            // Track which people have been assigned to which days (to prevent duplicate assignments after replacements)
            const assignedPeoplePreviewWeekend = {}; // monthKey -> { groupNum -> Set of person names }
            const sortedWeekends = [...weekendHolidays].sort();
            
            if (!hasSavedWeekendAssignments) sortedWeekends.forEach((dateKey, weekendIndex) => {
                const date = new Date(dateKey + 'T00:00:00');
                const month = date.getMonth();
                const year = date.getFullYear();
                const monthKey = `${year}-${month}`;
                
                if (!skippedInMonth[monthKey]) {
                    skippedInMonth[monthKey] = {};
                }
                if (!assignedPeoplePreviewWeekend[monthKey]) {
                    assignedPeoplePreviewWeekend[monthKey] = {};
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
                                // Continue from last person assigned in previous month (month-scoped; falls back to legacy)
                                const lastPersonName = getLastRotationPersonForDate('weekend', date, groupNum);
                                const lastPersonIndex = groupPeople.indexOf(lastPersonName);
                                if (lastPersonName && lastPersonIndex >= 0) {
                                    // Found last person - start from next person
                                    globalWeekendRotationPosition[groupNum] = (lastPersonIndex + 1) % rotationDays;
                                    console.log(`[WEEKEND ROTATION] Continuing from last person ${lastPersonName} (index ${lastPersonIndex}) for group ${groupNum}, starting at position ${globalWeekendRotationPosition[groupNum]}`);
                                } else {
                                    // Last person not found in list - use rotation calculation
                            const daysSinceStart = getRotationPosition(date, 'weekend', groupNum);
                            globalWeekendRotationPosition[groupNum] = daysSinceStart % rotationDays;
                                    if (lastPersonName) {
                                        console.log(`[WEEKEND ROTATION] Last person ${lastPersonName} not found in group ${groupNum} list, using rotation calculation: position ${globalWeekendRotationPosition[groupNum]}`);
                                    }
                                }
                            }
                        }
                        
                            // PREVIEW MODE: Just show basic rotation WITHOUT skip logic
                            // Skip logic will run when Next is pressed in Step 2
                        let rotationPosition = globalWeekendRotationPosition[groupNum] % rotationDays;
                            
                            // IMPORTANT: Track the rotation person (who SHOULD be assigned according to rotation)
                            // This is the person BEFORE any skip/missing logic
                            const rotationPerson = groupPeople[rotationPosition];
                            
                            // Store rotation person for this date/group (before any skip logic)
                            if (!weekendRotationPersons[dateKey]) {
                                weekendRotationPersons[dateKey] = {};
                            }
                            weekendRotationPersons[dateKey][groupNum] = rotationPerson;
                            
                            let assignedPerson = rotationPerson;
                            
                            // Check if assigned person is missing, if so find next in rotation
                                if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date, 'weekend')) {
                                const simulatedAssignments = {
                                    special: simulatedSpecialAssignments,
                                    weekend: simulatedWeekendAssignments
                                };
                                // Pass already assigned set to prevent duplicate assignments
                                const alreadyAssignedSet = assignedPeoplePreviewWeekend[monthKey] && assignedPeoplePreviewWeekend[monthKey][groupNum] 
                                    ? assignedPeoplePreviewWeekend[monthKey][groupNum] 
                                    : null;
                                const res = findNextEligiblePersonAfterMissing({
                                    dateKey,
                                    date,
                                    groupNum,
                                    groupPeople,
                                    startRotationPosition: rotationPosition,
                                        dutyCategory: 'weekend',
                                    simulatedAssignments,
                                    alreadyAssignedSet: alreadyAssignedSet,
                                    exhaustive: true
                                });
                                if (res) {
                                    assignedPerson = res.person;
                                }
                        }
                        
                        // Advance rotation position based on the person ACTUALLY assigned
                        // (skip disabled/missing without consuming their turn)
                        globalWeekendRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                        
                        if (assignedPerson) {
                            if (!simulatedWeekendAssignments[dateKey]) {
                                simulatedWeekendAssignments[dateKey] = {};
                            }
                            simulatedWeekendAssignments[dateKey][groupNum] = assignedPerson;
                            
                            // Track that this person has been assigned (to prevent duplicate assignment later)
                            if (assignedPeoplePreviewWeekend[monthKey] && assignedPeoplePreviewWeekend[monthKey][groupNum]) {
                                assignedPeoplePreviewWeekend[monthKey][groupNum].add(assignedPerson);
                            }
                        }
                    }
                }
            });
            
            const periodLabel = buildPeriodLabel(startDate, endDate);
            let html = '<div class="step-content">';
            html += `<h6 class="mb-3"><i class="fas fa-calendar-alt me-2"></i>Περίοδος: ${periodLabel}</h6>`;
            
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
                html += '<th>Όνομα Ημιαργίας</th>';
                html += `<th>${getGroupName(1)}</th>`;
                html += `<th>${getGroupName(2)}</th>`;
                html += `<th>${getGroupName(3)}</th>`;
                html += `<th>${getGroupName(4)}</th>`;
                html += '</tr>';
                html += '</thead>';
                html += '<tbody>';
                
                // Sort semi-normal days by date
                const sortedSemi = [...semiNormalDays].sort();
                sortedSemiForPreview = sortedSemi;
                
                // Track assignments for swapping logic
                const semiAssignments = semiAssignmentsForPreview; // dateKey -> { groupNum -> person name }
                const globalSemiRotationPosition = {}; // groupNum -> global position (continues across months)
                // IMPORTANT: Track semi-normal rotation persons (who SHOULD be assigned according to rotation)
                // This is separate from assigned persons (who may have been swapped)
                const semiRotationPersons = semiRotationPersonsForPreview; // dateKey -> { groupNum -> rotationPerson }
                // Track pending swaps: when Person A is swapped, Person B should be assigned to Person A's next day
                const pendingSwaps = {}; // monthKey -> { groupNum -> { skippedPerson, swapToPosition } }
                // Track which people have been assigned to which days (to prevent duplicate assignments after replacements)
                const assignedPeoplePreviewSemi = {}; // monthKey -> { groupNum -> Set of person names }
                
                sortedSemi.forEach((dateKey, semiIndex) => {
                    const date = new Date(dateKey + 'T00:00:00');
                    const dateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const dayName = getGreekDayName(date);
                    const month = date.getMonth();
                    const year = date.getFullYear();
                    const monthKey = `${year}-${month}`;
                    
                    if (!assignedPeoplePreviewSemi[monthKey]) {
                        assignedPeoplePreviewSemi[monthKey] = {};
                    }
                    
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
                                    // Continue from last person assigned in previous month (month-scoped; falls back to legacy)
                                    const lastPersonName = getLastRotationPersonForDate('semi', date, groupNum);
                                    const lastPersonIndex = groupPeople.indexOf(lastPersonName);
                                    if (lastPersonName && lastPersonIndex >= 0) {
                                        // Found last person - start from next person
                                        globalSemiRotationPosition[groupNum] = (lastPersonIndex + 1) % rotationDays;
                                        console.log(`[SEMI ROTATION] Continuing from last person ${lastPersonName} (index ${lastPersonIndex}) for group ${groupNum}, starting at position ${globalSemiRotationPosition[groupNum]}`);
                                    } else {
                                        // Last person not found in list - use rotation calculation
                                const daysSinceStart = getRotationPosition(date, 'semi', groupNum);
                                globalSemiRotationPosition[groupNum] = daysSinceStart % rotationDays;
                                        if (lastPersonName) {
                                            console.log(`[SEMI ROTATION] Last person ${lastPersonName} not found in group ${groupNum} list, using rotation calculation: position ${globalSemiRotationPosition[groupNum]}`);
                                        }
                                    }
                                }
                            }
                            
                            let rotationPosition = globalSemiRotationPosition[groupNum] % rotationDays;
                            
                            // IMPORTANT: Track the rotation person (who SHOULD be assigned according to rotation)
                            // This is the person BEFORE any swap/cross-month logic
                            const rotationPerson = groupPeople[rotationPosition];
                            
                            // Store rotation person for this date/group (before any swap logic)
                            if (!semiRotationPersons[dateKey]) {
                                semiRotationPersons[dateKey] = {};
                            }
                            semiRotationPersons[dateKey][groupNum] = rotationPerson;
                            
                            let assignedPerson = rotationPerson;
                            
                            // CRITICAL: Check if the rotation person is disabled/missing BEFORE cross-month/pending swap logic.
                            // This ensures disabled people are ALWAYS skipped, even when rotation cycles back to them.
                            let wasReplaced = false;
                            let replacementIndex = null;
                            if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date, 'semi')) {
                                // Simply skip disabled person and find next person in rotation who is NOT disabled/missing
                                // Keep going through rotation until we find someone eligible (check entire rotation twice to be thorough)
                                // IMPORTANT: Also check if replacement was already assigned this month to prevent duplicate assignments
                                if (!assignedPeoplePreviewSemi[monthKey][groupNum]) {
                                    assignedPeoplePreviewSemi[monthKey][groupNum] = new Set();
                                }
                                let foundReplacement = false;
                                for (let offset = 1; offset <= rotationDays * 2 && !foundReplacement; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (isPersonMissingOnDate(candidate, groupNum, date, 'semi')) continue;
                                    // Check if candidate was already assigned this month (to prevent duplicate assignments)
                                    if (assignedPeoplePreviewSemi[monthKey][groupNum] && assignedPeoplePreviewSemi[monthKey][groupNum].has(candidate)) continue;
                                    
                                    // Found eligible replacement
                                    assignedPerson = candidate;
                                    replacementIndex = idx;
                                    wasReplaced = true;
                                    foundReplacement = true;
                                    storeAssignmentReason(
                                        dateKey,
                                        groupNum,
                                        assignedPerson,
                                        'skip',
                                        buildUnavailableReplacementReason({
                                            skippedPersonName: rotationPerson,
                                            replacementPersonName: assignedPerson,
                                            dateObj: date,
                                            groupNum,
                                            dutyCategory: 'semi'
                                        }),
                                        rotationPerson,
                                        null
                                    );
                                    break;
                                }
                                // If no replacement found after checking everyone twice (everyone disabled or already assigned), leave unassigned
                                if (!foundReplacement) {
                                    assignedPerson = null;
                                }
                            }
                            
                            // Check if this day is a cross-month swap assignment (person swapped from previous month)
                            // Structure: crossMonthSwaps[dateKey][groupNum] = personName
                            let isCrossMonthSwapDay = false;
                            if (crossMonthSwaps[dateKey] && crossMonthSwaps[dateKey][groupNum]) {
                                // This person was swapped from previous month and must be assigned to this day
                                // BUT: still check if they're disabled/missing (defensive)
                                const crossMonthPerson = crossMonthSwaps[dateKey][groupNum];
                                if (!isPersonMissingOnDate(crossMonthPerson, groupNum, date, 'semi')) {
                                    assignedPerson = crossMonthPerson;
                                    isCrossMonthSwapDay = true;
                                    console.log(`[PREVIEW CROSS-MONTH SEMI] Assigning ${assignedPerson} to ${dateKey} (Group ${groupNum}, swapped from previous month)`);
                                    // Remove from tracking since we're assigning them now (will be saved when calculation completes)
                                    delete crossMonthSwaps[dateKey][groupNum];
                                    // If no more groups for this date, remove the date entry
                                    if (Object.keys(crossMonthSwaps[dateKey]).length === 0) {
                                        delete crossMonthSwaps[dateKey];
                                    }
                                } else {
                                    // Cross-month person is disabled/missing - skip them and remove from crossMonthSwaps
                                    delete crossMonthSwaps[dateKey][groupNum];
                                    if (Object.keys(crossMonthSwaps[dateKey]).length === 0) {
                                        delete crossMonthSwaps[dateKey];
                                    }
                                    assignedPerson = null;
                                }
                            }
                            
                            // Check if there's a pending swap for this position
                            if (!isCrossMonthSwapDay && pendingSwaps[monthKey][groupNum] && pendingSwaps[monthKey][groupNum].swapToPosition === rotationPosition) {
                                // This is the position where the skipped person should be assigned (swapped person's original position)
                                const pendingPerson = pendingSwaps[monthKey][groupNum].skippedPerson;
                                // BUT: still check if they're disabled/missing (defensive)
                                if (!isPersonMissingOnDate(pendingPerson, groupNum, date, 'semi')) {
                                    assignedPerson = pendingPerson;
                                    delete pendingSwaps[monthKey][groupNum];
                                    // Advance rotation normally from this position
                                    globalSemiRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                } else {
                                    // Pending swap person is disabled/missing - skip them
                                    delete pendingSwaps[monthKey][groupNum];
                                    assignedPerson = null;
                                }
                            } else if (!isCrossMonthSwapDay) {
                                // PREVIEW MODE: Just show basic rotation WITHOUT consecutive day swap logic
                                // Swap logic will run when Next is pressed
                                // NOTE: Disabled/missing check already happened above, so this is just a safety check
                                if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date, 'semi')) {
                                    // This should rarely happen (already checked above), but handle it defensively
                                    // Simply skip disabled person and find next person in rotation who is NOT disabled/missing
                                    // IMPORTANT: Also check if replacement was already assigned this month to prevent duplicate assignments
                                    if (!assignedPeoplePreviewSemi[monthKey][groupNum]) {
                                        assignedPeoplePreviewSemi[monthKey][groupNum] = new Set();
                                    }
                                    let foundReplacement = false;
                                    for (let offset = 1; offset <= rotationDays * 2 && !foundReplacement; offset++) {
                                        const idx = (rotationPosition + offset) % rotationDays;
                                        const candidate = groupPeople[idx];
                                        if (!candidate) continue;
                                        if (isPersonMissingOnDate(candidate, groupNum, date, 'semi')) continue;
                                        // Check if candidate was already assigned this month (to prevent duplicate assignments)
                                        if (assignedPeoplePreviewSemi[monthKey][groupNum] && assignedPeoplePreviewSemi[monthKey][groupNum].has(candidate)) continue;
                                        
                                        // Found eligible replacement
                                        assignedPerson = candidate;
                                        replacementIndex = idx;
                                        wasReplaced = true;
                                        foundReplacement = true;
                                        storeAssignmentReason(
                                            dateKey,
                                            groupNum,
                                            assignedPerson,
                                            'skip',
                                            buildUnavailableReplacementReason({
                                                skippedPersonName: rotationPerson,
                                                replacementPersonName: assignedPerson,
                                                dateObj: date,
                                                groupNum,
                                                dutyCategory: 'semi'
                                            }),
                                            rotationPerson,
                                            null
                                        );
                                        break;
                                    }
                                    // If no replacement found (everyone disabled or already assigned), leave unassigned
                                    if (!foundReplacement) {
                                        assignedPerson = null;
                                    }
                                    }
                                    
                                // Advance rotation position from the person ACTUALLY assigned (not the skipped person)
                                // This ensures that when Person A is replaced by Person B, next semi-duty assigns Person C, not Person B again
                                if (wasReplaced && replacementIndex !== null && assignedPerson) {
                                    // Person was replaced - advance from replacement's position
                                    globalSemiRotationPosition[groupNum] = (replacementIndex + 1) % rotationDays;
                                } else if (assignedPerson) {
                                    // No replacement - advance from assigned person's position
                                    const assignedIndex = groupPeople.indexOf(assignedPerson);
                                    if (assignedIndex !== -1) {
                                        globalSemiRotationPosition[groupNum] = (assignedIndex + 1) % rotationDays;
                                    } else {
                                        // Fallback: advance from rotation position
                                        globalSemiRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                    }
                                } else {
                                    // No one assigned - advance from rotation position
                                    globalSemiRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                }
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
                            
                            // Track that this person has been assigned (to prevent duplicate assignment later)
                            if (assignedPerson && assignedPeoplePreviewSemi[monthKey] && assignedPeoplePreviewSemi[monthKey][groupNum]) {
                                assignedPeoplePreviewSemi[monthKey][groupNum].add(assignedPerson);
                            }
                            
                            // Get last duty date and days since for display
                            let lastDutyInfo = '';
                            let daysCountInfo = '';
                            if (assignedPerson) {
                                const daysSince = countDaysSinceLastDuty(dateKey, assignedPerson, groupNum, 'semi', dayTypeLists, startDate);
                                const dutyDates = getLastAndNextDutyDates(assignedPerson, groupNum, 'semi', groupPeople.length);
                                lastDutyInfo = dutyDates.lastDuty !== 'Δεν έχει' ? `<br><small class="text-muted">Τελευταία: ${dutyDates.lastDuty}</small>` : '';
                                
                                if (daysSince !== null && daysSince !== Infinity) {
                                    daysCountInfo = ` <span class="text-info">${daysSince}/${rotationDays} ημέρες</span>`;
                                } else if (daysSince === Infinity) {
                                    daysCountInfo = ' <span class="text-success">πρώτη φορά</span>';
                                }
                            }
                            
                            html += `<td>${buildBaselineComputedCellHtml(rotationPerson, assignedPerson, daysCountInfo, lastDutyInfo)}</td>`;
                        }
                    }
                    
                    html += '</tr>';
                });
                
                // Store assignments and rotation positions in calculationSteps for saving when Next is pressed
                calculationSteps.tempSemiAssignments = semiAssignments;
                calculationSteps.tempSemiBaselineAssignments = semiRotationPersons;
                calculationSteps.lastSemiRotationPositions = {};
                // IMPORTANT: Find the last ASSIGNED person (after replacement), not the rotation person
                // This ensures that when Person A is replaced by Person B, next calculation starts from Person B's position
                // Use the semiAssignments (actual assigned persons) instead of semiRotationPersons
                for (let g = 1; g <= 4; g++) {
                    const sortedSemiKeys = [...semiNormalDays].sort();
                    let lastAssignedPerson = null;
                    for (let i = sortedSemiKeys.length - 1; i >= 0; i--) {
                        const dateKey = sortedSemiKeys[i];
                        if (semiAssignments[dateKey] && semiAssignments[dateKey][g]) {
                            lastAssignedPerson = semiAssignments[dateKey][g];
                            break;
                        }
                    }
                    if (lastAssignedPerson) {
                        calculationSteps.lastSemiRotationPositions[g] = lastAssignedPerson;
                        console.log(`[SEMI ROTATION] Storing last assigned person ${lastAssignedPerson} for group ${g} (after replacement)`);
                    }
                }

                // Store last rotation person per month (for correct recalculation of individual months)
                // IMPORTANT: Use the ASSIGNED person (after replacement), not the rotation person
                // This ensures that when Person A is replaced by Person B, next calculation starts from Person B's position
                const sortedSemiKeysForMonth = [...semiNormalDays].sort();
                const lastSemiRotationPositionsByMonth = {}; // monthKey -> { groupNum -> assignedPerson }
                for (const dateKey of sortedSemiKeysForMonth) {
                    const d = new Date(dateKey + 'T00:00:00');
                    const monthKey = getMonthKeyFromDate(d);
                    for (let g = 1; g <= 4; g++) {
                        // Use the assigned person (after replacement), not the rotation person
                        const assignedPerson = semiAssignments[dateKey]?.[g];
                        if (assignedPerson) {
                            if (!lastSemiRotationPositionsByMonth[monthKey]) {
                                lastSemiRotationPositionsByMonth[monthKey] = {};
                            }
                            lastSemiRotationPositionsByMonth[monthKey][g] = assignedPerson;
                        }
                    }
                }
                calculationSteps.lastSemiRotationPositionsByMonth = lastSemiRotationPositionsByMonth;
                
                html += '</tbody>';
                html += '</table>';
                html += '</div>';
            }
            
            html += '</div>';
            stepContent.innerHTML = html;

            // Step 3: show swaps/replacements in the calculation table (like Step 4), BEFORE pressing Continue.
            // This is display-only and does not alter what we save / what swap logic writes to Firestore.
            try {
                if (semiNormalDays.length > 0 && sortedSemiForPreview.length > 0) {
                    const previewSemiAssignments = {};
                    for (const dk of Object.keys(semiAssignmentsForPreview || {})) {
                        previewSemiAssignments[dk] = { ...(semiAssignmentsForPreview[dk] || {}) };
                    }

                    // Same helper as runSemiNormalSwapLogic: semi conflicts with weekend/special on neighbor days.
                    const hasSemiConsecutiveConflictForPerson = (semiDateKey, person, groupNum) => {
                        const semiDate = new Date(semiDateKey + 'T00:00:00');
                        if (isNaN(semiDate.getTime())) return false;
                        if (getDayType(semiDate) !== 'semi-normal-day') return false;

                        const checkNeighbor = (neighborDate) => {
                            const neighborType = getDayType(neighborDate);
                            const neighborKey = formatDateKey(neighborDate);
                            if (neighborType === 'weekend-holiday') {
                                return simulatedWeekendAssignments[neighborKey]?.[groupNum] === person;
                            }
                            if (neighborType === 'special-holiday') {
                                const neighborMonthKey = `${neighborDate.getFullYear()}-${neighborDate.getMonth()}`;
                                return simulatedSpecialAssignments[neighborMonthKey]?.[groupNum]?.has(person) || false;
                            }
                            return false;
                        };

                        const dayBefore = new Date(semiDate);
                        dayBefore.setDate(dayBefore.getDate() - 1);
                        const dayAfter = new Date(semiDate);
                        dayAfter.setDate(dayAfter.getDate() + 1);
                        return checkNeighbor(dayBefore) || checkNeighbor(dayAfter);
                    };

                    const swappedSemiSet = new Set(); // `${dateKey}:${groupNum}`

                    for (let semiIndex = 0; semiIndex < sortedSemiForPreview.length; semiIndex++) {
                        const dateKey = sortedSemiForPreview[semiIndex];
                        const date = new Date(dateKey + 'T00:00:00');
                        if (isNaN(date.getTime())) continue;

                        const dayBefore = new Date(date);
                        dayBefore.setDate(dayBefore.getDate() - 1);
                        const dayAfter = new Date(date);
                        dayAfter.setDate(dayAfter.getDate() + 1);
                        const dayBeforeKey = formatDateKey(dayBefore);
                        const dayAfterKey = formatDateKey(dayAfter);
                        const beforeType = getDayType(dayBefore);
                        const afterType = getDayType(dayAfter);

                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            const groupPeople = groups?.[groupNum]?.semi || [];
                            if (!groupPeople.length) continue;

                            const currentPerson = previewSemiAssignments?.[dateKey]?.[groupNum] || null;
                            if (!currentPerson) continue;
                            if (swappedSemiSet.has(`${dateKey}:${groupNum}`)) continue;

                            // Conflict detection same as runSemiNormalSwapLogic()
                            let hasConsecutiveConflict = false;
                            if (beforeType === 'weekend-holiday' || beforeType === 'special-holiday') {
                                const personBefore = simulatedWeekendAssignments[dayBeforeKey]?.[groupNum] ||
                                    (beforeType === 'special-holiday'
                                        ? (simulatedSpecialAssignments[`${dayBefore.getFullYear()}-${dayBefore.getMonth()}`]?.[groupNum]?.has(currentPerson) ? currentPerson : null)
                                        : null);
                                if (personBefore === currentPerson) hasConsecutiveConflict = true;
                            }
                            if (!hasConsecutiveConflict && (afterType === 'weekend-holiday' || afterType === 'special-holiday')) {
                                const personAfter = simulatedWeekendAssignments[dayAfterKey]?.[groupNum] ||
                                    (afterType === 'special-holiday'
                                        ? (simulatedSpecialAssignments[`${dayAfter.getFullYear()}-${dayAfter.getMonth()}`]?.[groupNum]?.has(currentPerson) ? currentPerson : null)
                                        : null);
                                if (personAfter === currentPerson) hasConsecutiveConflict = true;
                            }
                            if (!hasConsecutiveConflict) continue;

                            // Swap with next semi-normal day(s), validate both sides
                            let swapCandidate = null;
                            let swapDateKey = null;
                            for (let j = semiIndex + 1; j < sortedSemiForPreview.length; j++) {
                                const candidateDateKey = sortedSemiForPreview[j];
                                const candidateDate = new Date(candidateDateKey + 'T00:00:00');
                                if (isNaN(candidateDate.getTime())) continue;

                                const candidatePerson = previewSemiAssignments[candidateDateKey]?.[groupNum];
                                if (!candidatePerson) continue;
                                if (swappedSemiSet.has(`${candidateDateKey}:${groupNum}`)) continue;

                                if (isPersonMissingOnDate(candidatePerson, groupNum, date, 'semi')) continue;
                                if (isPersonMissingOnDate(currentPerson, groupNum, candidateDate, 'semi')) continue;

                                const candidateWouldConflict = hasSemiConsecutiveConflictForPerson(dateKey, candidatePerson, groupNum);
                                const currentWouldConflict = hasSemiConsecutiveConflictForPerson(candidateDateKey, currentPerson, groupNum);
                                if (!candidateWouldConflict && !currentWouldConflict) {
                                    swapCandidate = candidatePerson;
                                    swapDateKey = candidateDateKey;
                                    break;
                                }
                            }

                            if (swapCandidate && swapDateKey) {
                                previewSemiAssignments[dateKey][groupNum] = swapCandidate;
                                previewSemiAssignments[swapDateKey][groupNum] = currentPerson;
                                swappedSemiSet.add(`${dateKey}:${groupNum}`);
                                swappedSemiSet.add(`${swapDateKey}:${groupNum}`);
                                continue;
                            }

                            // Cross-month preview (safe: do not mutate real crossMonthSwaps)
                            const month = date.getMonth();
                            const year = date.getFullYear();
                            const rotationDays = groupPeople.length;
                            const currentRotationPosition = groupPeople.indexOf(currentPerson);
                            if (rotationDays > 0) {
                                const originalCrossMonth = crossMonthSwaps;
                                const crossMonthCopy = (typeof structuredClone === 'function')
                                    ? structuredClone(crossMonthSwaps || {})
                                    : JSON.parse(JSON.stringify(crossMonthSwaps || {}));
                                crossMonthSwaps = crossMonthCopy;
                                try {
                                    const nextMonthResult = getPersonFromNextMonth(dateKey, 'semi', groupNum, month, year, rotationDays, groupPeople, currentRotationPosition);
                                    if (nextMonthResult?.person) {
                                        previewSemiAssignments[dateKey][groupNum] = nextMonthResult.person;
                                    }
                                } finally {
                                    crossMonthSwaps = originalCrossMonth;
                                }
                            }
                        }
                    }

                    // Re-render the table body using baseline (rotation) vs computed (preview after swaps)
                    const tableBody = stepContent.querySelector('tbody');
                    if (tableBody) {
                        tableBody.innerHTML = '';
                        for (const dateKey of sortedSemiForPreview) {
                            const date = new Date(dateKey + 'T00:00:00');
                            if (isNaN(date.getTime())) continue;
                            const dateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                            const dayName = getGreekDayName(date);

                            let rowHtml = '<tr>';
                            rowHtml += `<td><strong>${dateStr}</strong></td>`;
                            rowHtml += `<td>${dayName}</td>`;

                            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                                const groupPeople = groups?.[groupNum]?.semi || [];
                                if (!groupPeople.length) {
                                    rowHtml += '<td class="text-muted">-</td>';
                                    continue;
                                }
                                const baselinePerson = semiRotationPersonsForPreview?.[dateKey]?.[groupNum] || null;
                                const computedPerson = previewSemiAssignments?.[dateKey]?.[groupNum] || null;
                                rowHtml += `<td>${buildBaselineComputedCellHtml(baselinePerson, computedPerson)}</td>`;
                            }

                            rowHtml += '</tr>';
                            tableBody.insertAdjacentHTML('beforeend', rowHtml);
                        }
                    }
                }
            } catch (e) {
                console.error('Step 3 preview swap rendering failed:', e);
            }
        }

        function renderStep4_Normal() {
            const stepContent = document.getElementById('stepContent');
            const startDate = calculationSteps.startDate;
            const endDate = calculationSteps.endDate;
            const dayTypeLists = calculationSteps.dayTypeLists || { normal: [], semi: [], special: [], weekend: [] };
            
            // Declare at function level to avoid scope issues
            const globalNormalRotationPosition = {}; // groupNum -> global position (continues across months)
            
            // Track baseline assignments for this preview to detect cascading shifts
            const baselineNormalByDate = {}; // dateKey -> { groupNum -> personName }
            
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
                        
                        if (person && !isPersonMissingOnDate(person, groupNum, date, 'special')) {
                            if (!simulatedSpecialAssignments[monthKey][groupNum]) {
                                simulatedSpecialAssignments[monthKey][groupNum] = new Set();
                            }
                            simulatedSpecialAssignments[monthKey][groupNum].add(person);
                        }
                    }
                }
            });
            
            // Second, load Step 2 (weekends) from saved Firestore data
            // IMPORTANT: Use actual weekend assignments saved in Firestore, not recalculated ones
            // This ensures the preview swap logic sees the same assignments as the actual Step 2
            const simulatedWeekendAssignments = {}; // dateKey -> { groupNum -> person name }
            const sortedWeekends = [...weekendHolidays].sort();
            
            // First, try to load from saved weekendAssignments (from Firestore)
            sortedWeekends.forEach((dateKey) => {
                const assignment = weekendAssignments[dateKey];
                if (assignment) {
                    // Handle both string format ("Person (Ομάδα 1), Person (Ομάδα 2)") and object format ({ groupNum: personName })
                    if (typeof assignment === 'string') {
                        const parts = assignment.split(',').map(p => p.trim());
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
                    } else if (typeof assignment === 'object' && !Array.isArray(assignment)) {
                        // Object format: { groupNum: personName }
                        for (const groupNum in assignment) {
                            const personName = assignment[groupNum];
                            if (personName) {
                                if (!simulatedWeekendAssignments[dateKey]) {
                                    simulatedWeekendAssignments[dateKey] = {};
                                }
                                simulatedWeekendAssignments[dateKey][parseInt(groupNum)] = personName;
                            }
                        }
                    }
                }
            });
            
            // Fallback: If no saved assignments found, recalculate (for first-time calculation)
            // This should rarely happen, but provides a fallback
            const hasSavedAssignments = Object.keys(simulatedWeekendAssignments).length > 0;
            if (!hasSavedAssignments) {
                console.log('[PREVIEW] No saved weekend assignments found, recalculating from rotation');
            const skippedInMonth = {}; // monthKey -> { groupNum -> Set of person names }
            const globalWeekendRotationPosition = {}; // groupNum -> global position (continues across months)
            
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
                        
                            // CRITICAL: Check if the rotation person is disabled/missing BEFORE any other logic.
                            // This ensures disabled people are ALWAYS skipped, even when rotation cycles back to them.
                            if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date, 'weekend')) {
                                // Simply skip disabled person and find next person in rotation who is NOT disabled/missing
                                let foundReplacement = false;
                                for (let offset = 1; offset <= rotationDays; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (!isPersonMissingOnDate(candidate, groupNum, date, 'weekend')) {
                                        assignedPerson = candidate;
                                        foundReplacement = true;
                                        // IMPORTANT: Do NOT advance rotationPosition to the replacement's index.
                                        // Rotation should continue from the original rotation person so skipping doesn't affect the sequence.
                                        break;
                                    }
                                }
                                // If no replacement found (everyone disabled), leave unassigned
                                if (!foundReplacement) {
                                    assignedPerson = null;
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
                        } else {
                console.log('[PREVIEW] Loaded weekend assignments from saved Firestore data:', Object.keys(simulatedWeekendAssignments).length, 'dates');
            }
            
            // Initialize simulatedSemiAssignments and normalAssignments for consecutive check (will be populated later)
            const simulatedSemiAssignments = {}; // dateKey -> { groupNum -> person name }
            const normalAssignments = {}; // dateKey -> { groupNum -> person name }
            
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
            
            const periodLabel = buildPeriodLabel(startDate, endDate);
            let html = '<div class="step-content">';
            html += `<h6 class="mb-3"><i class="fas fa-calendar-alt me-2"></i>Περίοδος: ${periodLabel}</h6>`;
            
            // Sort normal days by date (define at function scope so it's accessible for swap logic)
            const sortedNormal = [...normalDays].sort();
            
            // IMPORTANT: Track normal rotation persons (who SHOULD be assigned according to rotation)
            // This is separate from assigned persons (who may have been swapped)
            // Declare at function level so it's accessible throughout the function
            const normalRotationPersons = {}; // dateKey -> { groupNum -> rotationPerson }
            
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
                html += '<th>Όνομα Ημέρας</th>';
                html += `<th>${getGroupName(1)}</th>`;
                html += `<th>${getGroupName(2)}</th>`;
                html += `<th>${getGroupName(3)}</th>`;
                html += `<th>${getGroupName(4)}</th>`;
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
                
                // REMOVED: Don't pre-initialize globalNormalRotationPosition here
                // The correct initialization happens per-group inside the loop below (line 9594+)
                // where we properly convert person names to position indices
                if (isFebruary2026) {
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
                // NOTE: normalRotationPersons is already declared at function level (above), don't redeclare it here
                
                // NEW LOGIC: Pre-process missing/disabled persons and replace their baseline normal duties
                // Check rotationBaseline to see if missing/disabled persons have normal duties scheduled during their period
                // Replace them with the next available person and continue rotation from where it left off
                try {
                    if (startDate && endDate && Array.isArray(sortedNormal) && sortedNormal.length > 0) {
                        const calcStartKey = formatDateKey(startDate);
                        const calcEndKey = formatDateKey(endDate);
                        const processedMissingReplacements = new Set(); // "g|person|periodEnd" to avoid duplicate processing
                        
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            const g = groups?.[groupNum];
                            const missingMap = g?.missingPeriods || {};
                            const disabledMap = g?.disabledPersons || {};
                            const groupPeople = g?.normal || [];
                            
                            if (groupPeople.length === 0) continue;
                            
                            // Process missing periods
                            for (const personName of Object.keys(missingMap)) {
                                const periods = Array.isArray(missingMap[personName]) ? missingMap[personName] : [];
                                for (const period of periods) {
                                    const pStartKey = inputValueToDateKey(period?.start);
                                    const pEndKey = inputValueToDateKey(period?.end);
                                    if (!pStartKey || !pEndKey) continue;
                                    
                                    // Check if missing period overlaps with calculation period
                                    if (pEndKey < calcStartKey || pStartKey > calcEndKey) continue;
                                    
                                    const dedupeKey = `${groupNum}|${personName}|${pEndKey}`;
                                    if (processedMissingReplacements.has(dedupeKey)) continue;
                                    processedMissingReplacements.add(dedupeKey);
                                    
                                    // Determine the actual period to check (within calculation range)
                                    const checkStartKey = maxDateKey(pStartKey, calcStartKey);
                                    const checkEndKey = minDateKey(pEndKey, calcEndKey);
                                    if (!checkStartKey || !checkEndKey || checkStartKey > checkEndKey) continue;
                                    
                                    // Check rotationBaselineNormalAssignments for this person's normal duties during missing period
                                    const baselineDutiesToReplace = [];
                                    for (const dk of sortedNormal) {
                                        if (dk < checkStartKey) continue;
                                        if (dk > checkEndKey) break;
                                        
                                        // Check rotationBaseline to see if this person was scheduled for this date
                                        const baselinePerson = 
                                            baselineNormalByDate?.[dk]?.[groupNum] ||
                                            parseAssignedPersonForGroupFromAssignment(getRotationBaselineAssignmentForType('normal', dk), groupNum) ||
                                            null;
                                        
                                        if (baselinePerson === personName) {
                                            baselineDutiesToReplace.push(dk);
                                        }
                                    }
                                    
                                    // If person has baseline duties during missing period, replace them
                                    if (baselineDutiesToReplace.length > 0) {
                                        // Find the person's position in rotation
                                        const personIndex = groupPeople.indexOf(personName);
                                        if (personIndex < 0) continue; // Person not in rotation list
                                        
                                        // For each baseline duty date, find the next available person in rotation
                                        for (const dk of baselineDutiesToReplace) {
                                            const dateObj = dateKeyToDate(dk);
                                            if (isNaN(dateObj.getTime())) continue;
                                            
                                            // Find next available person in rotation (starting from person after missing person)
                                            let replacementPerson = null;
                                            for (let offset = 1; offset <= groupPeople.length * 2; offset++) {
                                                const idx = (personIndex + offset) % groupPeople.length;
                                                const candidate = groupPeople[idx];
                                                if (!candidate) continue;
                                                
                                                // Check if candidate is also missing/disabled on this date
                                                if (isPersonMissingOnDate(candidate, groupNum, dateObj, 'normal')) continue;
                                                
                                                // Check if candidate is disabled for normal duties
                                                if (isPersonDisabledForDuty(candidate, groupNum, 'normal')) continue;
                                                
                                                // Found eligible replacement
                                                replacementPerson = candidate;
                                                break;
                                            }
                                            
                                            if (replacementPerson) {
                                                // Store the replacement in baselineNormalByDate so it's used during calculation
                                                if (!baselineNormalByDate[dk]) {
                                                    baselineNormalByDate[dk] = {};
                                                }
                                                baselineNormalByDate[dk][groupNum] = replacementPerson;
                                                
                                                // Store assignment reason
                                                storeAssignmentReason(
                                                    dk,
                                                    groupNum,
                                                    replacementPerson,
                                                    'skip',
                                                    buildUnavailableReplacementReason({
                                                        skippedPersonName: personName,
                                                        replacementPersonName: replacementPerson,
                                                        dateObj: dateObj,
                                                        groupNum,
                                                        dutyCategory: 'normal'
                                                    }),
                                                    personName,
                                                    null
                                                );
                                                
                                                console.log(`[MISSING REPLACEMENT] Replaced ${personName} with ${replacementPerson} on ${dk} (Group ${groupNum}) - missing period`);
                                            }
                                        }
                                    }
                                }
                            }
                            
                            // Process disabled persons (check all disabled persons, not just periods)
                            for (const personName of Object.keys(disabledMap)) {
                                const disabledInfo = disabledMap[personName];
                                if (!disabledInfo) continue;
                                
                                // Check if person is disabled for normal duties
                                const isDisabledForNormal = disabledInfo === true || 
                                                           (typeof disabledInfo === 'object' && disabledInfo.normal === true);
                                
                                if (!isDisabledForNormal) continue;
                                
                                // Check if person has baseline normal duties during calculation period
                                const baselineDutiesToReplace = [];
                                for (const dk of sortedNormal) {
                                    if (dk < calcStartKey) continue;
                                    if (dk > calcEndKey) break;
                                    
                                    // Check rotationBaseline to see if this person was scheduled for this date
                                    const baselinePerson = 
                                        baselineNormalByDate?.[dk]?.[groupNum] ||
                                        parseAssignedPersonForGroupFromAssignment(getRotationBaselineAssignmentForType('normal', dk), groupNum) ||
                                        null;
                                    
                                    if (baselinePerson === personName) {
                                        // Check if person is still disabled on this date
                                        const dateObj = dateKeyToDate(dk);
                                        if (isNaN(dateObj.getTime())) continue;
                                        if (isPersonMissingOnDate(personName, groupNum, dateObj, 'normal')) {
                                            baselineDutiesToReplace.push(dk);
                                        }
                                    }
                                }
                                
                                // If person has baseline duties while disabled, replace them
                                if (baselineDutiesToReplace.length > 0) {
                                    // Find the person's position in rotation
                                    const personIndex = groupPeople.indexOf(personName);
                                    if (personIndex < 0) continue; // Person not in rotation list
                                    
                                    // For each baseline duty date, find the next available person in rotation
                                    for (const dk of baselineDutiesToReplace) {
                                        const dateObj = dateKeyToDate(dk);
                                        if (isNaN(dateObj.getTime())) continue;
                                        
                                        // Find next available person in rotation (starting from person after disabled person)
                                        let replacementPerson = null;
                                        for (let offset = 1; offset <= groupPeople.length * 2; offset++) {
                                            const idx = (personIndex + offset) % groupPeople.length;
                                            const candidate = groupPeople[idx];
                                            if (!candidate) continue;
                                            
                                            // Check if candidate is also missing/disabled on this date
                                            if (isPersonMissingOnDate(candidate, groupNum, dateObj, 'normal')) continue;
                                            
                                            // Check if candidate is disabled for normal duties
                                            if (isPersonDisabledForDuty(candidate, groupNum, 'normal')) continue;
                                            
                                            // Found eligible replacement
                                            replacementPerson = candidate;
                                            break;
                                        }
                                        
                                        if (replacementPerson) {
                                            // Store the replacement in baselineNormalByDate so it's used during calculation
                                            if (!baselineNormalByDate[dk]) {
                                                baselineNormalByDate[dk] = {};
                                            }
                                            baselineNormalByDate[dk][groupNum] = replacementPerson;
                                            
                                            // Store assignment reason
                                            storeAssignmentReason(
                                                dk,
                                                groupNum,
                                                replacementPerson,
                                                'skip',
                                                buildUnavailableReplacementReason({
                                                    skippedPersonName: personName,
                                                    replacementPersonName: replacementPerson,
                                                    dateObj: dateObj,
                                                    groupNum,
                                                    dutyCategory: 'normal'
                                                }),
                                                personName,
                                                null
                                            );
                                            
                                            console.log(`[DISABLED REPLACEMENT] Replaced ${personName} with ${replacementPerson} on ${dk} (Group ${groupNum}) - disabled`);
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn('[STEP 4] Pre-processing missing/disabled persons baseline replacement failed:', e);
                }
                
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
                                } else {
                                    // Continue from last person assigned in previous month (month-scoped; falls back to legacy)
                                    const lastPersonName = getLastRotationPersonForDate('normal', date, groupNum);
                                    const lastPersonIndex = groupPeople.indexOf(lastPersonName);
                                    if (lastPersonName && lastPersonIndex >= 0) {
                                        // Found last person - start from next person
                                        globalNormalRotationPosition[groupNum] = (lastPersonIndex + 1) % rotationDays;
                                        console.log(`[NORMAL ROTATION] Continuing from last person ${lastPersonName} (index ${lastPersonIndex}) for group ${groupNum}, starting at position ${globalNormalRotationPosition[groupNum]}`);
                                } else {
                                        // Last person not found in list - use rotation calculation from first date
                                        if (sortedNormal.length > 0) {
                                            const firstDate = new Date(sortedNormal[0] + 'T00:00:00');
                                            const daysSinceStart = getRotationPosition(firstDate, 'normal', groupNum);
                                            globalNormalRotationPosition[groupNum] = daysSinceStart % rotationDays;
                                            if (lastPersonName) {
                                                console.log(`[NORMAL ROTATION] Last person ${lastPersonName} not found in group ${groupNum} list, using rotation calculation: position ${globalNormalRotationPosition[groupNum]}`);
                                            }
                                        } else {
                                            globalNormalRotationPosition[groupNum] = 0;
                                        }
                                    }
                                }
                            }
                            
                            // IMPORTANT: Check cross-month swaps FIRST (before rotation calculation)
                            // If a person was swapped from previous month, assign them and skip the normal rotation person
                            let isCrossMonthSwapDay = false;
                            let assignedPerson = null;
                            let rotationAlreadyAdvanced = false; // Track if rotation was already advanced (e.g., by pending swap)
                            
                            // Ensure globalNormalRotationPosition is initialized
                            if (globalNormalRotationPosition[groupNum] === undefined) {
                                console.error(`[ERROR] globalNormalRotationPosition[${groupNum}] is undefined! This should have been initialized above.`);
                                // Fallback: initialize now
                                const isFebruary2026 = calculationSteps.startDate && 
                                    calculationSteps.startDate.getFullYear() === 2026 && 
                                    calculationSteps.startDate.getMonth() === 1;
                                if (isFebruary2026) {
                                    globalNormalRotationPosition[groupNum] = 0;
                                } else {
                                    const lastPersonName = getLastRotationPersonForDate('normal', date, groupNum);
                                    const lastPersonIndex = groupPeople.indexOf(lastPersonName);
                                    if (lastPersonName && lastPersonIndex >= 0) {
                                        globalNormalRotationPosition[groupNum] = (lastPersonIndex + 1) % rotationDays;
                                } else {
                                    // Last person not found in list - use rotation calculation from first date
                                    if (sortedNormal.length > 0) {
                                        const firstDate = new Date(sortedNormal[0] + 'T00:00:00');
                                        const daysSinceStart = getRotationPosition(firstDate, 'normal', groupNum);
                                        globalNormalRotationPosition[groupNum] = daysSinceStart % rotationDays;
                                    } else {
                                        globalNormalRotationPosition[groupNum] = 0;
                                    }
                                    }
                                }
                            }
                            
                            let rotationPosition = globalNormalRotationPosition[groupNum] % rotationDays;
                            
                            // IMPORTANT: Track the rotation person (who SHOULD be assigned according to rotation)
                            // This is the person BEFORE any swap/cross-month/missing logic
                            const originalRotationPerson = groupPeople[rotationPosition];
                            
                            // Check if this person was already replaced in baselineNormalByDate (due to missing/disabled pre-processing)
                            let rotationPerson = originalRotationPerson;
                            let wasReplacedFromBaseline = false;
                            if (baselineNormalByDate[dateKey] && baselineNormalByDate[dateKey][groupNum]) {
                                const replacedPerson = baselineNormalByDate[dateKey][groupNum];
                                // Only use replacement if it's different from the original rotation person
                                // (meaning the original person was missing/disabled and got replaced)
                                if (replacedPerson !== originalRotationPerson) {
                                    rotationPerson = replacedPerson;
                                    wasReplacedFromBaseline = true;
                                    // IMPORTANT: Rotation continues from where it left off - after the original rotation person
                                    // Example: If Person A (position 0) was replaced by Person D (position 3),
                                    // rotation should continue: D (replacement), then B (position 1), C (position 2), E (position 4), etc.
                                    // So we advance rotation position by 1 from the original position (not the replacement's position)
                                    // This is already handled below when we advance rotationPosition, so no need to change it here
                                }
                            }
                            
                            // Store ORIGINAL rotation person for baseline comparison (who SHOULD have been assigned according to pure rotation)
                            // This is used for displaying baseline vs computed in the UI
                            if (!normalRotationPersons[dateKey]) {
                                normalRotationPersons[dateKey] = {};
                            }
                            normalRotationPersons[dateKey][groupNum] = originalRotationPerson;
                            
                            if (crossMonthSwaps[dateKey] && crossMonthSwaps[dateKey][groupNum]) {
                                // This person was swapped from previous month and must be assigned to this day
                                const crossMonthPerson = crossMonthSwaps[dateKey][groupNum];
                                assignedPerson = crossMonthPerson;
                                isCrossMonthSwapDay = true;
                                console.log(`[PREVIEW CROSS-MONTH] Assigning ${crossMonthPerson} to ${dateKey} (Group ${groupNum}, swapped from previous month)`);
                                
                                // Check if the cross-month person is the same as the normal rotation person
                                const normalRotationPerson = groupPeople[rotationPosition];
                                if (normalRotationPerson === crossMonthPerson) {
                                    // The cross-month person IS the normal rotation person - just advance rotation
                                    // No need to skip anyone, just continue normally
                                    console.log(`[PREVIEW CROSS-MONTH] Cross-month person ${crossMonthPerson} matches normal rotation - no skip needed`);
                                    // IMPORTANT: Advance rotation position so next person gets their turn
                                    globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                } else {
                                    // The cross-month person is different from normal rotation person
                                    // Skip the person who would normally be assigned (they were swapped to previous month)
                                    // Advance rotation position by 1 to skip the normal person
                                    globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                    console.log(`[PREVIEW CROSS-MONTH] Skipping normal rotation person ${normalRotationPerson} (swapped to previous month)`);
                                }
                                
                                // IMPORTANT: Mark this person as assigned to prevent duplicate assignment
                                // Initialize assigned people set for this group if needed
                                if (!assignedPeoplePreview[monthKey][groupNum]) {
                                    assignedPeoplePreview[monthKey][groupNum] = new Set();
                                }
                                assignedPeoplePreview[monthKey][groupNum].add(crossMonthPerson);
                                
                                // Remove from tracking since we're assigning them now (will be saved when calculation completes)
                                delete crossMonthSwaps[dateKey][groupNum];
                                // If no more groups for this date, remove the date entry
                                if (Object.keys(crossMonthSwaps[dateKey]).length === 0) {
                                    delete crossMonthSwaps[dateKey];
                                }
                            } else {
                                // No cross-month swap - use normal rotation
                                // Use rotationPerson (which may be a replacement from baselineNormalByDate if original was missing/disabled)
                                assignedPerson = rotationPerson;
                                
                            // Initialize assigned people set for this group if needed
                            if (!assignedPeoplePreview[monthKey][groupNum]) {
                                assignedPeoplePreview[monthKey][groupNum] = new Set();
                            }
                            
                            // CRITICAL: Check if the rotation person is disabled/missing BEFORE any other logic.
                            // This ensures disabled people are ALWAYS skipped, even when rotation cycles back to them.
                            let wasDisabledPersonSkipped = false;
                            if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date, 'normal')) {
                                // Simply skip disabled person and find next person in rotation who is NOT disabled/missing
                                // Keep going through rotation until we find someone eligible (check entire rotation twice to be thorough)
                                // IMPORTANT: Also check if replacement was already assigned this month to prevent duplicate assignments
                                let foundReplacement = false;
                                for (let offset = 1; offset <= rotationDays * 2 && !foundReplacement; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (isPersonMissingOnDate(candidate, groupNum, date, 'normal')) continue;
                                    // Check if candidate was already assigned this month (to prevent duplicate assignments)
                                    if (assignedPeoplePreview[monthKey][groupNum] && assignedPeoplePreview[monthKey][groupNum].has(candidate)) continue;
                                    
                                    // Found eligible replacement
                                    assignedPerson = candidate;
                                    foundReplacement = true;
                                    wasDisabledPersonSkipped = true;
                                    // IMPORTANT: Do NOT advance rotationPosition to the replacement's index.
                                    // Rotation should continue from the original rotation person so skipping doesn't affect the sequence.
                                    storeAssignmentReason(
                                        dateKey,
                                        groupNum,
                                        assignedPerson,
                                        'skip',
                                        buildUnavailableReplacementReason({
                                            skippedPersonName: rotationPerson,
                                            replacementPersonName: assignedPerson,
                                            dateObj: date,
                                            groupNum,
                                            dutyCategory: 'normal'
                                        }),
                                        rotationPerson,
                                        null
                                    );
                                    break;
                                }
                                // If no replacement found after checking everyone twice (everyone disabled or already assigned), leave unassigned
                                if (!foundReplacement) {
                                    assignedPerson = null;
                                }
                            }
                            
                            // If assigned person was already assigned this month (due to swap), skip to next person
                            // BUT: Skip this check if we just replaced a disabled person - swap logic will handle duplicates
                            if (!wasDisabledPersonSkipped && assignedPerson && !isPersonMissingOnDate(assignedPerson, groupNum, date, 'normal') && assignedPeoplePreview[monthKey][groupNum].has(assignedPerson)) {
                                // This person was already assigned (swapped), find next available person in rotation
                                // Keep searching through entire rotation until we find someone not disabled and not already assigned
                                let foundReplacement = false;
                                for (let offset = 1; offset <= rotationDays * 2 && !foundReplacement; offset++) {
                                    const nextIndex = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[nextIndex];
                                    
                                    if (!candidate) continue;
                                    if (isPersonMissingOnDate(candidate, groupNum, date, 'normal')) continue;
                                    if (assignedPeoplePreview[monthKey][groupNum].has(candidate)) continue;
                                    
                                    // Found available person
                                    assignedPerson = candidate;
                                    foundReplacement = true;
                                }
                                
                                // If still no replacement found after checking everyone twice, leave unassigned
                                // (This should be extremely rare - only if everyone is disabled or already assigned)
                                if (!foundReplacement) {
                                    assignedPerson = null;
                                }
                            }
                            
                            // Check if there's a pending swap for this position
                            if (pendingNormalSwaps[monthKey][groupNum] && pendingNormalSwaps[monthKey][groupNum].swapToPosition === rotationPosition) {
                                // This is the position where the skipped person should be assigned
                                assignedPerson = pendingNormalSwaps[monthKey][groupNum].skippedPerson;
                                delete pendingNormalSwaps[monthKey][groupNum];
                                globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                rotationAlreadyAdvanced = true; // Mark that rotation was already advanced
                                }
                                
                                // PREVIEW MODE: Just show basic rotation WITHOUT swap logic
                                // Swap logic will run when Next is pressed
                                // NOTE: Disabled/missing check already happened above, so this is just a safety check
                                if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date, 'normal')) {
                                    // This should rarely happen (already checked above), but handle it defensively
                                    // Simply skip disabled person and find next person in rotation who is NOT disabled/missing
                                    // Keep going through rotation until we find someone eligible (check entire rotation twice to be thorough)
                                    // IMPORTANT: Also check if replacement was already assigned this month to prevent duplicate assignments
                                    let foundReplacement = false;
                                    for (let offset = 1; offset <= rotationDays * 2 && !foundReplacement; offset++) {
                                        const idx = (rotationPosition + offset) % rotationDays;
                                        const candidate = groupPeople[idx];
                                        if (!candidate) continue;
                                        if (isPersonMissingOnDate(candidate, groupNum, date, 'normal')) continue;
                                        // Check if candidate was already assigned this month (to prevent duplicate assignments)
                                        if (assignedPeoplePreview[monthKey][groupNum] && assignedPeoplePreview[monthKey][groupNum].has(candidate)) continue;
                                        
                                        // Found eligible replacement
                                        assignedPerson = candidate;
                                        foundReplacement = true;
                                        storeAssignmentReason(
                                            dateKey,
                                            groupNum,
                                            assignedPerson,
                                            'skip',
                                            buildUnavailableReplacementReason({
                                                skippedPersonName: rotationPerson,
                                                replacementPersonName: assignedPerson,
                                                dateObj: date,
                                                groupNum,
                                                dutyCategory: 'normal'
                                            }),
                                            rotationPerson,
                                            null
                                        );
                                        break;
                                    }
                                    // If no replacement found after checking everyone twice (everyone disabled or already assigned), leave unassigned
                                    if (!foundReplacement) {
                                        assignedPerson = null;
                                    }
                                }
                                    
                                    // Check if assigned person has a conflict (will be swapped later)
                                    // If so, DO NOT assign anyone to this day - leave it for swap logic to handle
                                    // Also DO NOT assign the next person in rotation to this day
                                    // IMPORTANT: Always advance rotation position from the ORIGINAL rotationPosition
                                    // (not from replacement's position) to maintain rotation sequence
                                    // BUT: Skip if rotation was already advanced (e.g., by pending swap)
                                    if (!rotationAlreadyAdvanced) {
                                        if (assignedPerson && !isPersonMissingOnDate(assignedPerson, groupNum, date, 'normal')) {
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
                                                // Still advance rotation position from ORIGINAL position so next person gets their correct turn
                                                globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                            } else {
                                                // No conflict - assign person and advance rotation from ORIGINAL position
                                                globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                            }
                                        } else {
                                            // Person is missing or no person assigned - advance rotation position from ORIGINAL position
                                            globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                        }
                                    }
                            }
                            
                            // Store baseline assignment for comparison (original rotation person, not replacement)
                            // Note: baselineNormalByDate may already have a replacement from pre-processing,
                            // but we want to show the original rotation person as baseline for display purposes
                            // So we store it separately in normalRotationPersons (which is already done above)
                            // and use originalRotationPerson for baseline display
                            
                            // Store assignment (before swap logic)
                            if (!normalAssignments[dateKey]) {
                                normalAssignments[dateKey] = {};
                            }
                            normalAssignments[dateKey][groupNum] = assignedPerson;
                            
                            // Track that this person has been assigned (to prevent duplicate assignment later)
                            if (assignedPerson && assignedPeoplePreview[monthKey] && assignedPeoplePreview[monthKey][groupNum]) {
                                assignedPeoplePreview[monthKey][groupNum].add(assignedPerson);
                            }
                            
                            // CRITICAL: If assigned person differs from baseline (rotationPerson), check if this is a cascading shift
                            // Store a 'shift' reason to prevent this from showing as a swap in results/calendar
                            if (assignedPerson && assignedPerson !== rotationPerson) {
                                const currentReason = getAssignmentReason(dateKey, groupNum, assignedPerson);
                                // Only store shift reason if there's no existing reason (skip/swap already handled)
                                if (!currentReason) {
                                    // Check if rotationPerson is currently disabled/missing (direct replacement case - already has 'skip' reason)
                                    const isRotationPersonDisabledOrMissing = isPersonDisabledForDuty(rotationPerson, groupNum, 'normal') || 
                                                                              isPersonMissingOnDate(rotationPerson, groupNum, date, 'normal');
                                    
                                    // If rotationPerson is not disabled/missing, check if previous day had a replacement (cascading shift)
                                    if (!isRotationPersonDisabledOrMissing) {
                                        // Check if any previous date in this month had a replacement for this group
                                        // This indicates a cascading shift where people moved forward
                                        let previousDayHadReplacement = false;
                                        for (const prevDateKey of sortedNormal) {
                                            if (prevDateKey >= dateKey) break; // Only check previous dates
                                            const prevDate = new Date(prevDateKey + 'T00:00:00');
                                            const prevMonthKeyCheck = `${prevDate.getFullYear()}-${prevDate.getMonth()}`;
                                            if (prevMonthKeyCheck !== monthKey) continue; // Only same month
                                            
                                            // Check if previous day had a 'skip' reason (someone was replaced)
                                            for (const personName in (assignmentReasons[prevDateKey]?.[groupNum] || {})) {
                                                const prevReason = assignmentReasons[prevDateKey][groupNum][personName];
                                                if (prevReason && prevReason.type === 'skip') {
                                                    previousDayHadReplacement = true;
                                                    break;
                                                }
                                            }
                                            if (previousDayHadReplacement) break;
                                        }
                                        
                                        if (previousDayHadReplacement) {
                                            // This is a cascading shift - store 'shift' reason to prevent showing as swap/underline
                                            storeAssignmentReason(
                                                dateKey,
                                                groupNum,
                                                assignedPerson,
                                                'shift',
                                                '',
                                                rotationPerson,
                                                null,
                                                { cascadingShift: true, originalBaseline: rotationPerson }
                                            );
                                        }
                                    }
                                }
                            }
                            
                            // Get last duty date and days since for display
                            let lastDutyInfo = '';
                            let daysCountInfo = '';
                            if (assignedPerson) {
                                const daysSince = countDaysSinceLastDuty(dateKey, assignedPerson, groupNum, 'normal', dayTypeLists, startDate);
                                const dutyDates = getLastAndNextDutyDates(assignedPerson, groupNum, 'normal', groupPeople.length);
                                lastDutyInfo = dutyDates.lastDuty !== 'Δεν έχει' ? `<br><small class="text-muted">Τελευταία: ${dutyDates.lastDuty}</small>` : '';
                                
                                if (daysSince !== null && daysSince !== Infinity) {
                                    daysCountInfo = ` <span class="text-info">${daysSince}/${rotationDays} ημέρες</span>`;
                                } else if (daysSince === Infinity) {
                                    daysCountInfo = ' <span class="text-success">πρώτη φορά</span>';
                                }
                            }
                            
                            // Use original rotation person for baseline display (from normalRotationPersons)
                            const baselinePersonForDisplay = normalRotationPersons[dateKey]?.[groupNum] || originalRotationPerson;
                            html += `<td>${buildBaselineComputedCellHtml(baselinePersonForDisplay, assignedPerson, daysCountInfo, lastDutyInfo)}</td>`;
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
            
            // Initialize swapPairCounter for preview swaps
            let maxSwapPairId = 0;
            for (const dateKey in assignmentReasons) {
                for (const groupNumStr in assignmentReasons[dateKey]) {
                    for (const personName in assignmentReasons[dateKey][groupNumStr]) {
                        const reason = assignmentReasons[dateKey][groupNumStr][personName];
                        if (reason && reason.swapPairId !== null && reason.swapPairId !== undefined) {
                            const swapPairId = typeof reason.swapPairId === 'number' ? reason.swapPairId : parseInt(reason.swapPairId);
                            if (!isNaN(swapPairId) && swapPairId > maxSwapPairId) {
                                maxSwapPairId = swapPairId;
                            }
                        }
                    }
                }
            }
            let previewSwapPairCounter = maxSwapPairId + 1; // Start from max + 1 to ensure uniqueness
            
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
                                
                                // IMPORTANT: Verify the current person actually has a real conflict (not a false positive)
                                const dayBefore = new Date(date);
                                dayBefore.setDate(dayBefore.getDate() - 1);
                                const dayAfter = new Date(date);
                                dayAfter.setDate(dayAfter.getDate() + 1);
                                const dayBeforeKey = formatDateKey(dayBefore);
                                const dayAfterKey = formatDateKey(dayAfter);
                                const beforeType = getDayType(dayBefore);
                                const afterType = getDayType(dayAfter);
                                
                                // Check if current person has duty on day before or after
                                let hasDutyBefore = false;
                                let hasDutyAfter = false;
                                if (simulatedAssignments) {
                                    const beforeMonthKey = `${dayBefore.getFullYear()}-${dayBefore.getMonth()}`;
                                    if (beforeType === 'special-holiday') {
                                        hasDutyBefore = simulatedAssignments.special?.[beforeMonthKey]?.[groupNum]?.has(currentPerson) || false;
                                    } else if (beforeType === 'semi-normal-day') {
                                        hasDutyBefore = simulatedAssignments.semi?.[dayBeforeKey]?.[groupNum] === currentPerson;
                                    } else if (beforeType === 'weekend-holiday') {
                                        hasDutyBefore = simulatedAssignments.weekend?.[dayBeforeKey]?.[groupNum] === currentPerson;
                                    } else if (beforeType === 'normal-day') {
                                        hasDutyBefore = simulatedAssignments.normal?.[dayBeforeKey]?.[groupNum] === currentPerson;
                                    }
                                    
                                    const afterMonthKey = `${dayAfter.getFullYear()}-${dayAfter.getMonth()}`;
                                    if (afterType === 'special-holiday') {
                                        hasDutyAfter = simulatedAssignments.special?.[afterMonthKey]?.[groupNum]?.has(currentPerson) || false;
                                    } else if (afterType === 'semi-normal-day') {
                                        hasDutyAfter = simulatedAssignments.semi?.[dayAfterKey]?.[groupNum] === currentPerson;
                                    } else if (afterType === 'weekend-holiday') {
                                        hasDutyAfter = simulatedAssignments.weekend?.[dayAfterKey]?.[groupNum] === currentPerson;
                                    } else if (afterType === 'normal-day') {
                                        hasDutyAfter = simulatedAssignments.normal?.[dayAfterKey]?.[groupNum] === currentPerson;
                                    }
                                } else {
                                    hasDutyBefore = hasDutyOnDay(dayBeforeKey, currentPerson, groupNum);
                                    hasDutyAfter = hasDutyOnDay(dayAfterKey, currentPerson, groupNum);
                                }
                                
                                // Only proceed if there's an actual conflict (not normal-normal)
                                const hasRealConflict = (hasDutyBefore && beforeType !== 'normal-day') || 
                                                       (hasDutyAfter && afterType !== 'normal-day');
                                
                                if (hasRealConflict && 
                                    !isPersonMissingOnDate(swapCandidate, groupNum, sameWeekDate, 'normal') &&
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
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, nextSameDay, 'normal') &&
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
                                    if (!isPersonMissingOnDate(swapCandidate, groupNum, weekAfterNextDate, 'normal') &&
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
                            
                            // TUESDAY/THURSDAY - Step 1a: Try next same day of week (can be in same month or next month)
                            const nextSameDay = new Date(year, month, date.getDate() + 7);
                            const nextSameDayKey = formatDateKey(nextSameDay);
                            
                            // Check if next same day is in the calculation range (same month or next month)
                            if (normalDays.includes(nextSameDayKey) && normalAssignments[nextSameDayKey]?.[groupNum]) {
                                // Next same day is in calculation range - use it
                                const swapCandidate = normalAssignments[nextSameDayKey][groupNum];
                                if (!isPersonMissingOnDate(swapCandidate, groupNum, nextSameDay, 'normal') &&
                                    !hasConsecutiveDuty(nextSameDayKey, swapCandidate, groupNum, simulatedAssignments) &&
                                    !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                    swapDayKey = nextSameDayKey;
                                    swapFound = true;
                                }
                            } else if (nextSameDay.getMonth() !== month) {
                                // Next same day is in next month but not in calculation range - use getPersonFromNextMonth
                                const rotationDays = groupPeople.length;
                                const currentRotationPosition = globalNormalRotationPosition[groupNum];
                                const nextMonthResult = getPersonFromNextMonth(dateKey, 'normal', groupNum, month, year, rotationDays, groupPeople, currentRotationPosition);
                                
                                if (nextMonthResult && nextMonthResult.person) {
                                    const swapCandidate = nextMonthResult.person;
                                    const nextMonthSwapDayKey = nextMonthResult.swapDayKey;
                                    
                                    // Verify it's the same day of week (next Tuesday/Thursday)
                                    const nextMonthSwapDate = new Date(nextMonthSwapDayKey + 'T00:00:00');
                                    if (nextMonthSwapDate.getDay() === dayOfWeek) {
                                        // Check if swap candidate is valid for current date
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, date, 'normal') &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            // Check if swap candidate is valid for next month swap day
                                            if (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthSwapDate, 'normal') &&
                                                !hasConsecutiveDuty(nextMonthSwapDayKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                swapDayKey = nextMonthSwapDayKey;
                                                swapFound = true;
                                                
                                                // Store cross-month swap info
                                                if (!crossMonthSwaps[nextMonthSwapDayKey]) {
                                                    crossMonthSwaps[nextMonthSwapDayKey] = {};
                                                }
                                                crossMonthSwaps[nextMonthSwapDayKey][groupNum] = currentPerson;
                                                console.log(`[PREVIEW CROSS-MONTH SWAP NORMAL Step 1a] Person ${currentPerson} (had conflict on ${dateKey}) must be assigned to ${nextMonthSwapDayKey} (Group ${groupNum})`);
                                            }
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
                                    if (!isPersonMissingOnDate(swapCandidate, groupNum, sameWeekDate, 'normal') &&
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
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, nextAlternativeDay, 'normal') &&
                                            !hasConsecutiveDuty(nextAlternativeKey, swapCandidate, groupNum, simulatedAssignments) &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            swapDayKey = nextAlternativeKey;
                                            swapFound = true;
                                        }
                                    }
                                }
                            }
                            
                            // TUESDAY/THURSDAY - Step 3b: ONLY if Step 3 failed, try next alternative day in next month (cross-month)
                            // This handles cases like Thursday 26/02/2026 → next Tuesday 05/03/2026
                            if (!swapFound) {
                                // Use getPersonFromNextMonth to calculate person from next month's rotation
                                // For Thursday, it will try next Tuesday in next month
                                const rotationDays = groupPeople.length;
                                const currentRotationPosition = globalNormalRotationPosition[groupNum];
                                const nextMonthResult = getPersonFromNextMonth(dateKey, 'normal', groupNum, month, year, rotationDays, groupPeople, currentRotationPosition);
                                
                                if (nextMonthResult && nextMonthResult.person) {
                                    const swapCandidate = nextMonthResult.person;
                                    const nextMonthSwapDayKey = nextMonthResult.swapDayKey;
                                    
                                    // Verify the swap day is the alternative day of week (not same day)
                                    const nextMonthSwapDate = new Date(nextMonthSwapDayKey + 'T00:00:00');
                                    if (nextMonthSwapDate.getDay() === alternativeDayOfWeek) {
                                        // Check if swap candidate is valid for current date
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, date, 'normal') &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            // Check if swap candidate is valid for next month swap day
                                            if (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthSwapDate, 'normal') &&
                                                !hasConsecutiveDuty(nextMonthSwapDayKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                swapDayKey = nextMonthSwapDayKey;
                                                swapFound = true;
                                                
                                                // Store cross-month swap info
                                                if (!crossMonthSwaps[nextMonthSwapDayKey]) {
                                                    crossMonthSwaps[nextMonthSwapDayKey] = {};
                                                }
                                                crossMonthSwaps[nextMonthSwapDayKey][groupNum] = currentPerson;
                                                console.log(`[PREVIEW CROSS-MONTH SWAP NORMAL Step 3b] Person ${currentPerson} (had conflict on ${dateKey}) must be assigned to ${nextMonthSwapDayKey} (Group ${groupNum})`);
                                            }
                                        }
                                    }
                                }
                            }
                            
                            // TUESDAY/THURSDAY - Step 4: ONLY if Step 3b failed, try next alternative day in next month (cross-month)
                            if (!swapFound) {
                                let nextMonthAlternative = new Date(year, month + 1, date.getDate());
                                while (nextMonthAlternative.getDay() !== alternativeDayOfWeek && nextMonthAlternative.getDate() <= 31) {
                                    nextMonthAlternative.setDate(nextMonthAlternative.getDate() + 1);
                                }
                                
                                if (nextMonthAlternative.getDate() > 0 && nextMonthAlternative.getDate() <= 31) {
                                    const nextMonthAltKey = formatDateKey(nextMonthAlternative);
                                    if (normalDays.includes(nextMonthAltKey) && normalAssignments[nextMonthAltKey]?.[groupNum]) {
                                        const swapCandidate = normalAssignments[nextMonthAltKey][groupNum];
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, nextMonthAlternative, 'normal') &&
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
                            // For cross-month swaps, swapCandidate might not be in normalAssignments yet
                            // Get it from the stored value or from getPersonFromNextMonth
                            let swapCandidate;
                            if (normalAssignments[swapDayKey] && normalAssignments[swapDayKey][groupNum]) {
                                // Regular swap within calculation range
                                swapCandidate = normalAssignments[swapDayKey][groupNum];
                                            } else {
                                // Cross-month swap - get candidate from getPersonFromNextMonth
                                const rotationDays = groupPeople.length;
                                const currentRotationPosition = globalNormalRotationPosition[groupNum];
                                const nextMonthResult = getPersonFromNextMonth(dateKey, 'normal', groupNum, month, year, rotationDays, groupPeople, currentRotationPosition);
                                if (nextMonthResult && nextMonthResult.person && nextMonthResult.swapDayKey === swapDayKey) {
                                    swapCandidate = nextMonthResult.person;
                                    // Store it in normalAssignments for the swap execution
                                    if (!normalAssignments[swapDayKey]) {
                                        normalAssignments[swapDayKey] = {};
                                    }
                                    normalAssignments[swapDayKey][groupNum] = swapCandidate;
                                        } else {
                                    // Can't find candidate - skip this swap
                                    console.warn(`[PREVIEW SWAP WARNING] Could not find swap candidate for cross-month swap ${swapDayKey} (Group ${groupNum})`);
                                    continue; // Skip to next iteration
                                }
                            }
                            
                            // Generate unique swap pair ID for color coding
                            const swapPairId = previewSwapPairCounter++;
                            
                            // Track swap for popup display
                            previewSwappedPeople.push({
                                date: dateKey,
                                dateStr: date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                                groupNum: groupNum,
                                skippedPerson: currentPerson,
                                swappedPerson: swapCandidate,
                                swapDate: swapDayKey,
                                swapDateStr: new Date(swapDayKey + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                                swapPairId: swapPairId
                            });
                            
                            // Perform the swap
                            normalAssignments[dateKey][groupNum] = swapCandidate;
                            normalAssignments[swapDayKey][groupNum] = currentPerson;
                            
                            // Store assignment reasons for BOTH people involved in the swap with swap pair ID
                                // Improved Greek reasons:
                                // Use the ACTUAL conflict neighbor day (e.g. Fri) instead of the swap-execution day (e.g. Thu).
                                const conflictNeighborKey = getConsecutiveConflictNeighborDayKey(dateKey, currentPerson, groupNum, simulatedAssignments) || dateKey;
                            const isCrossMonthSwap = dateKey.substring(0, 7) !== swapDayKey.substring(0, 7);
                            const swapMeta = isCrossMonthSwap ? {
                                isCrossMonth: true,
                                originDayKey: dateKey,
                                swapDayKey: swapDayKey,
                                conflictDateKey: conflictNeighborKey
                            } : null;
                            storeAssignmentReason(
                                dateKey,
                                groupNum,
                                swapCandidate,
                                'swap',
                                buildSwapReasonGreek({
                                    changedWithName: currentPerson,
                                    conflictedPersonName: currentPerson,
                                        conflictDateKey: conflictNeighborKey,
                                    newAssignmentDateKey: swapDayKey,
                                    subjectName: swapCandidate
                                }),
                                currentPerson,
                                swapPairId,
                                swapMeta
                            );
                            storeAssignmentReason(
                                swapDayKey,
                                groupNum,
                                currentPerson,
                                'swap',
                                buildSwapReasonGreek({
                                    changedWithName: swapCandidate,
                                    conflictedPersonName: currentPerson,
                                        conflictDateKey: conflictNeighborKey,
                                    newAssignmentDateKey: swapDayKey,
                                    subjectName: currentPerson
                                }),
                                swapCandidate,
                                swapPairId,
                                swapMeta
                            );
                            
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
                                    daysCountInfo = ` <span class="text-info">${daysSince}/${rotationDays} ημέρες</span>`;
                                } else if (daysSince === Infinity) {
                                    daysCountInfo = ' <span class="text-success">πρώτη φορά</span>';
                                }
                            }
                            
                                const baselinePerson = normalRotationPersons?.[dateKey]?.[groupNum] || null;
                                rowHtml += `<td>${buildBaselineComputedCellHtml(baselinePerson, assignedPerson, daysCountInfo, lastDutyInfo)}</td>`;
                        }
                    }
                    
                        rowHtml += '</tr>';
                        tableBody.innerHTML += rowHtml;
                });
                }
            }
            
            // (Intentionally no always-visible summary section in step modal)
            
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
            // Store baseline assignments for comparison in results window
            // Use normalRotationPersons (rotation person before any skips) as baseline
            calculationSteps.tempNormalBaselineAssignments = normalRotationPersons;
            calculationSteps.lastNormalRotationPositions = {};
            // IMPORTANT: Find the last ROTATION person (who should be assigned according to rotation)
            // NOT the assigned person (who may have been swapped)
            // Use the normalRotationPersons we tracked during processing
            for (let g = 1; g <= 4; g++) {
                const sortedNormalKeys = [...normalDays].sort();
                let lastRotationPerson = null;
                for (let i = sortedNormalKeys.length - 1; i >= 0; i--) {
                    const dateKey = sortedNormalKeys[i];
                    if (normalRotationPersons[dateKey] && normalRotationPersons[dateKey][g]) {
                        lastRotationPerson = normalRotationPersons[dateKey][g];
                        break;
                    }
                }
                if (lastRotationPerson) {
                    calculationSteps.lastNormalRotationPositions[g] = lastRotationPerson;
                    console.log(`[NORMAL ROTATION] Storing last rotation person ${lastRotationPerson} for group ${g} (not swapped person)`);
                }
            }

            // Store last rotation person per month (for correct recalculation of individual months)
            const sortedNormalKeysForMonth = [...normalDays].sort();
            const lastNormalRotationPositionsByMonth = {}; // monthKey -> { groupNum -> rotationPerson }
            for (const dateKey of sortedNormalKeysForMonth) {
                const d = new Date(dateKey + 'T00:00:00');
                const monthKey = getMonthKeyFromDate(d);
                for (let g = 1; g <= 4; g++) {
                    const rp = normalRotationPersons[dateKey]?.[g];
                    if (rp) {
                        if (!lastNormalRotationPositionsByMonth[monthKey]) {
                            lastNormalRotationPositionsByMonth[monthKey] = {};
                        }
                        lastNormalRotationPositionsByMonth[monthKey][g] = rp;
                    }
                }
            }
            calculationSteps.lastNormalRotationPositionsByMonth = lastNormalRotationPositionsByMonth;
            
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
        function showDayDetails(date) {
            try {
                const key = formatDateKey(date);
                // Use getAssignmentForDate to get the final assignment after swap logic
                const assignment = getAssignmentForDate(key);
                const dayType = getDayType(date);
                const year = date.getFullYear();
                const month = date.getMonth();
                
                // Day type category for expected-person derivation
                let dayTypeCategory = 'normal';
                if (isSpecialHoliday(date) || dayType === 'special-holiday') dayTypeCategory = 'special';
                else if (dayType === 'weekend-holiday') dayTypeCategory = 'weekend';
                else if (dayType === 'semi-normal-day') dayTypeCategory = 'semi';
                
                currentEditingDayKey = key;
                currentEditingDayDate = date;

                // Derive who SHOULD be assigned for this date/group, using month-scoped seeding from lastRotationPositions.
                const getExpectedPersonForDay = (groupNum) => {
                    try {
                        const groupData = groups[groupNum] || {};
                        const groupPeople = groupData[dayTypeCategory] || [];
                        if (!Array.isArray(groupPeople) || groupPeople.length === 0) return null;
                        
                        // Build list of this category's days in current month, sorted
                        const firstDay = new Date(year, month, 1);
                        const lastDay = new Date(year, month + 1, 0);
                        const keys = [];
                        const d = new Date(firstDay);
                        while (d <= lastDay) {
                            const dk = formatDateKey(d);
                            let cat = 'normal';
                            const dt = getDayType(d);
                            if (isSpecialHoliday(d) || dt === 'special-holiday') cat = 'special';
                            else if (dt === 'weekend-holiday') cat = 'weekend';
                            else if (dt === 'semi-normal-day') cat = 'semi';
                            if (cat === dayTypeCategory) keys.push(dk);
                            d.setDate(d.getDate() + 1);
                        }
                        keys.sort();
                        const idxInMonth = keys.indexOf(key);
                        if (idxInMonth < 0) return null;
                        
                        const seed = getLastRotationPersonForDate(dayTypeCategory, new Date(year, month, 1), groupNum);
                        let seedIdx = 0;
                        if (seed) {
                            const si = groupPeople.indexOf(seed);
                            if (si >= 0) seedIdx = (si + 1) % groupPeople.length;
                        }
                        return groupPeople[(seedIdx + idxInMonth) % groupPeople.length] || null;
                    } catch (e) {
                        return null;
                    }
                };
                
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
                
                // Get skip/swap reason (ignore internal 'shift' markers in the UI)
                let reason = person.name ? getAssignmentReason(key, person.group, person.name) : null;
                if (reason && reason.type === 'shift') {
                    reason = null;
                }
                let reasonBadge = '';
                if (reason) {
                    if (reason.type === 'skip') {
                        const displayReason = normalizeSkipReasonText(reason.reason);
                        reasonBadge = `<span class="badge bg-warning ms-2" title="${displayReason}"><i class="fas fa-arrow-right me-1"></i>Παραλείφθηκε</span>`;
                    } else if (reason.type === 'swap') {
                        const displayReason = normalizeSwapReasonText(reason.reason);
                        reasonBadge = `<span class="badge bg-info ms-2" title="${displayReason}"><i class="fas fa-exchange-alt me-1"></i>Αλλαγή${reason.swappedWith ? ` με ${reason.swappedWith}` : ''}</span>`;
                    }
                }
                
                const groupName = person.group ? getGroupName(person.group) : 'Άγνωστη Ομάδα';
                const criticalClass = isCritical ? 'border-danger bg-light' : '';
                const criticalLabel = isCritical ? '<span class="badge bg-danger ms-2"><i class="fas fa-lock me-1"></i>Κρίσιμη (Απόβαση)</span>' : '';
                const disabledAttr = isCritical ? 'disabled' : '';
                const disabledTitle = isCritical ? 'title="Αυτή η ανάθεση είναι κρίσιμη και δεν μπορεί να αλλάξει"' : '';
                
                // Add reason display below the person name.
                // If assignmentReasons is missing (common for missing-period replacements), derive the same reason logic as violations popup.
                let derivedReasonText = '';
                if (!reason && person.name && person.group) {
                    const expected = getExpectedPersonForDay(person.group);
                    if (expected && expected !== person.name) {
                        if (isPersonMissingOnDate(expected, person.group, date, dayTypeCategory)) {
                            if (isPersonDisabledForDuty(expected, person.group, dayTypeCategory)) {
                                derivedReasonText = buildUnavailableReplacementReason({
                                    skippedPersonName: expected,
                                    replacementPersonName: person.name,
                                    dateObj: date,
                                    groupNum: person.group,
                                    dutyCategory: dayTypeCategory
                                });
                            } else {
                                const missingReason = getUnavailableReasonShort(expected, person.group, date, dayTypeCategory);
                                derivedReasonText = `Αντικατέστησε τον/την ${expected} λόγω ${missingReason}.`;
                            }
                        } else if (dayTypeCategory === 'weekend' && hasSpecialHolidayDutyInMonth(expected, person.group, month, year)) {
                            const specialKey = getSpecialHolidayDutyDateInMonth(expected, person.group, year, month);
                            if (specialKey) {
                                const dd = new Date(specialKey + 'T00:00:00');
                                derivedReasonText = `Αντικατέστησε τον/την ${expected} λόγω ειδικής αργίας στον ίδιο μήνα (${getGreekDayName(dd)} ${dd.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' })}).`;
                            } else {
                                derivedReasonText = `Αντικατέστησε τον/την ${expected} λόγω ειδικής αργίας στον ίδιο μήνα.`;
                            }
                        }
                    }
                }
                const reasonDisplayText = reason
                    ? (reason.type === 'skip'
                        ? normalizeSkipReasonText(reason.reason)
                        : (reason.type === 'swap' ? normalizeSwapReasonText(reason.reason) : reason.reason))
                    : derivedReasonText;
                const reasonDisplay = (reason || derivedReasonText)
                    ? `<div class="mt-2 reason-card small text-muted"><i class="fas fa-info-circle me-1"></i><strong>Λόγος:</strong> ${reasonDisplayText}</div>`
                    : '';
                
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
                    <div class="mb-2 p-2 border rounded duty-person-card ${criticalClass}" ${disabledTitle}>
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
                        <div class="p-2 mb-2 border rounded swap-detail-card" style="border-color: ${swapColor.border} !important; background-color: ${swapColor.bg};">
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

        // Manual assignment feature removed (UI + handlers).

        // Check if person is unavailable on a specific date (missing period OR disabled)
        // dutyCategory: 'special' | 'weekend' | 'semi' | 'normal' | null
        function isPersonMissingOnDate(person, groupNum, date, dutyCategory = null) {
            const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, disabledPersons: {} };
            if (isPersonDisabledForDuty(person, groupNum, dutyCategory)) return true;
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

        // When the rotation-selected person is missing, pick the next person in rotation
        // BUT also validate consecutive-duty conflicts (before/after) and cross-month (via hasConsecutiveDuty).
        // - startRotationPosition: the index of the rotation-selected person
        // - alreadyAssignedSet: optional Set to prevent duplicates (used in preview normal logic)
        // - exhaustive: if true, search through the entire rotation multiple times until finding someone eligible
        function findNextEligiblePersonAfterMissing({
            dateKey,
            date,
            groupNum,
            groupPeople,
            startRotationPosition,
            dutyCategory = null,
            simulatedAssignments = null,
            alreadyAssignedSet = null,
            exhaustive = false
        }) {
            if (!Array.isArray(groupPeople) || groupPeople.length === 0) return null;
            const rotationDays = groupPeople.length;
            
            if (exhaustive) {
                // Search through the entire rotation (potentially multiple times) until we find someone eligible
                // This ensures rotation continues assigning people even if many are disabled
                for (let totalOffset = 1; totalOffset <= rotationDays * 2; totalOffset++) {
                    const idx = (startRotationPosition + totalOffset) % rotationDays;
                    const candidate = groupPeople[idx];
                    if (!candidate) continue;
                    if (alreadyAssignedSet && alreadyAssignedSet.has(candidate)) continue;
                    if (isPersonMissingOnDate(candidate, groupNum, date, dutyCategory)) continue;
                    if (simulatedAssignments && hasConsecutiveDuty(dateKey, candidate, groupNum, simulatedAssignments)) continue;
                    return { person: candidate, index: idx };
                }
                // If we've checked everyone twice and still no one is eligible, return null
                return null;
            } else {
                // Original behavior: search once through the rotation
                for (let offset = 1; offset < rotationDays; offset++) {
                    const idx = (startRotationPosition + offset) % rotationDays;
                    const candidate = groupPeople[idx];
                    if (!candidate) continue;
                    if (alreadyAssignedSet && alreadyAssignedSet.has(candidate)) continue;
                    if (isPersonMissingOnDate(candidate, groupNum, date, dutyCategory)) continue;
                    if (simulatedAssignments && hasConsecutiveDuty(dateKey, candidate, groupNum, simulatedAssignments)) continue;
                    return { person: candidate, index: idx };
                }
                return null;
            }
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
        
        // Analyze rotation violations
        function analyzeRotationViolations() {
            const violations = [];
            const seenSwapPairs = new Set(); // dayType|group|swapPairId -> dedupe swap rows
            const seenViolations = new Set(); // dateKey|groupNum|assignedPerson -> dedupe all violations

            const extractShortReasonFromSavedText = (reasonText) => {
                const t = String(reasonText || '');
                if (!t) return '';
                if (t.includes('Απενεργοποιημένος')) return 'Απενεργοποιημένος';
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
