        // ============================================================================
        // DUTY-SHIFTS-LOGIC.JS - Calculation & Business Logic
        // ============================================================================


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
        function getDayTypeCategoryFromDayType(dayType) {
            if (dayType === 'special-holiday') return 'special';
            if (dayType === 'weekend-holiday') return 'weekend';
            if (dayType === 'semi-normal-day') return 'semi';
            return 'normal';
        }
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
        function buildSwapReasonGreek({ changedWithName, conflictedPersonName, conflictDateKey, newAssignmentDateKey, subjectName = null }) {
            const conflict = formatGreekDayDate(conflictDateKey);
            const assigned = formatGreekDayDate(newAssignmentDateKey);
            const conflictArt = getGreekDayAccusativeArticle(new Date(conflictDateKey + 'T00:00:00'));
            const assignedArt = getGreekDayAccusativeArticle(new Date(newAssignmentDateKey + 'T00:00:00'));
            // Canonical swap sentence (used everywhere: results, cell popup, violations)
            // NOTE: keep "γιατι" spelling to match user preference.
            return `Έγινε η αλλαγή γιατι ο/η ${conflictedPersonName} είχε σύγκρουση ${conflictArt} ${conflict.dayName} ${conflict.dateStr}, και ανατέθηκε ${assignedArt} ${assigned.dayName} ${assigned.dateStr}.`;
        }
        function buildSemiMissingSwapReasonGreek(conflictedPersonName, conflictDateKey, newAssignmentDateKey) {
            const conflict = formatGreekDayDate(conflictDateKey);
            const assigned = formatGreekDayDate(newAssignmentDateKey);
            const conflictArt = getGreekDayAccusativeArticle(new Date(conflictDateKey + 'T00:00:00'));
            const assignedArt = getGreekDayAccusativeArticle(new Date(newAssignmentDateKey + 'T00:00:00'));
            return `Έγινε η αλλαγή γιατι ο/η ${conflictedPersonName} είχε απουσία ${conflictArt} ${conflict.dayName} ${conflict.dateStr}, και ανατέθηκε ${assignedArt} ${assigned.dayName} ${assigned.dateStr}.`;
        }
        function buildSkipReasonGreek({ skippedPersonName, replacementPersonName, dateKey, monthKey = null }) {
            const d = formatGreekDayDate(dateKey);
            const dayArt = getGreekDayAccusativeArticle(new Date(dateKey + 'T00:00:00'));
            const monthPart = monthKey ? ` (${monthKey})` : '';
            return `Αντικατέστησε τον/την ${skippedPersonName} επειδή είχε κώλυμα${monthPart} ${dayArt} ${d.dayName} ${d.dateStr}. Ανατέθηκε ο/η ${replacementPersonName}.`;
        }
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
        function getAssignmentReason(dateKey, groupNum, personName) {
            const gmap = assignmentReasons[dateKey]?.[groupNum] || null;
            if (!gmap) return null;
            // Backward compatible: try exact key first, then normalized key.
            return gmap[personName] || gmap[normalizePersonKey(personName)] || null;
        }
        /** Find the other date in a swap pair (for rotation: the person on that date is the one who was swapped out of currentDateKey). */
        function findSwapOtherDateKey(swapPairIdRaw, groupNum, currentDateKey) {
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
        }
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
        function hasConsecutiveWeekendHolidayDuty(dayKey, person, groupNum) {
            // Temporarily disabled to prevent incorrect swaps
            return false;
        }
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
        
        // Expose to window for compatibility
        if (typeof window !== 'undefined') {
            window.calculateDutiesForSelectedMonths = calculateDutiesForSelectedMonths;
        }
        
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
                // Return-from-missing: persons replaced on a special date due to missing will be assigned on another special (same month first, else next)
                const returnFromMissingSpecial = []; // { personName, groupNum, missedDateKey }
                
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
                            const seedDateKey = formatDateKey(seedDate);
                            const seedMonthKey = getMonthKeyFromDate(seedDate);
                            const prevMonthKey = getPreviousMonthKeyFromDate(seedDate);
                            console.log(`[DEBUG ROTATION INIT] Group ${groupNum}: seedDate=${seedDateKey}, seedMonthKey=${seedMonthKey}, prevMonthKey=${prevMonthKey}`);
                            console.log(`[DEBUG ROTATION INIT] lastRotationPositions.special[${prevMonthKey}][${groupNum}]=`, lastRotationPositions?.special?.[prevMonthKey]?.[groupNum] || 'NOT FOUND');
                            console.log(`[DEBUG ROTATION INIT] rotationBaselineLastByType.special[${prevMonthKey}][${groupNum}]=`, rotationBaselineLastByType?.special?.[prevMonthKey]?.[groupNum] || 'NOT FOUND');
                            console.log(`[DEBUG ROTATION INIT] Available months in rotationBaselineLastByType.special:`, Object.keys(rotationBaselineLastByType?.special || {}));
                            console.log(`[DEBUG ROTATION INIT] Available months in lastRotationPositions.special:`, Object.keys(lastRotationPositions?.special || {}));
                            // #region agent log
                            fetch('http://127.0.0.1:7243/ingest/9c1664f2-0b77-41ea-b88a-7c7ef737e197',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'duty-shifts-logic.js:rotationInit',message:'special rotation init',data:{groupNum,seedDateKey,seedMonthKey,prevMonthKey,lastRotationPositionsSpecial:lastRotationPositions?.special?.[prevMonthKey]?.[groupNum]||null,rotationBaselineLastSpecial:rotationBaselineLastByType?.special?.[prevMonthKey]?.[groupNum]||null},hypothesisId:'H1',timestamp:Date.now(),sessionId:'debug-session'})}).catch(()=>{});
                            // #endregion
                            const lastPersonName = getLastRotationPersonForDate('special', seedDate, groupNum);
                            const lastPersonIndex = groupPeople.indexOf(lastPersonName);
                            console.log(`[DEBUG ROTATION INIT] getLastRotationPersonForDate returned: "${lastPersonName}", index in groupPeople: ${lastPersonIndex}, groupPeople.length=${groupPeople.length}`);
                            // #region agent log
                            fetch('http://127.0.0.1:7243/ingest/9c1664f2-0b77-41ea-b88a-7c7ef737e197',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'duty-shifts-logic.js:rotationInitResult',message:'getLastRotationPersonForDate result',data:{groupNum,lastPersonName,lastPersonIndex,groupPeopleLength:groupPeople.length,foundInList:lastPersonIndex>=0},hypothesisId:'H1',timestamp:Date.now(),sessionId:'debug-session'})}).catch(()=>{});
                            // #endregion
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
                                    // #region agent log
                                    fetch('http://127.0.0.1:7243/ingest/9c1664f2-0b77-41ea-b88a-7c7ef737e197',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'duty-shifts-logic.js:rotationFallback',message:'rotation fallback to calculation',data:{groupNum,lastPersonName,firstDateKey:formatDateKey(firstDate),daysSinceStart,calculatedPosition:globalSpecialRotationPosition[groupNum]},hypothesisId:'H2',timestamp:Date.now(),sessionId:'debug-session'})}).catch(()=>{});
                                    // #endregion
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
                    
                    // Calculate who will be assigned for each group based on rotation order (no HTML yet – table built after return-from-missing)
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

                            let assignedPerson = rotationPerson;
                            let wasReplaced = false;
                            let replacementIndex = null;
                            let wasDisabledOnlySkippedSpecial = false;
                            // DISABLED: When rotation person is disabled, whole baseline shifts – skip them, no replacement line.
                            const isRotationPersonDisabledSpecial = rotationPerson && isPersonDisabledForDuty(rotationPerson, groupNum, 'special');
                            if (isRotationPersonDisabledSpecial) {
                                let foundEligible = false;
                                for (let offset = 1; offset <= rotationDays * 2 && !foundEligible; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (isPersonDisabledForDuty(candidate, groupNum, 'special')) continue;
                                    if (isPersonMissingOnDate(candidate, groupNum, date, 'special')) continue;
                                    assignedPerson = candidate;
                                    replacementIndex = idx;
                                    wasReplaced = true;
                                    wasDisabledOnlySkippedSpecial = true;
                                    foundEligible = true;
                                    break;
                                }
                                if (!foundEligible) assignedPerson = null;
                            }
                            // Store baseline for UI: when disabled skip use assigned person so no swap line (same as normal; avoids next day showing as swap)
                            specialRotationPersons[dateKey][groupNum] = wasDisabledOnlySkippedSpecial && assignedPerson ? assignedPerson : rotationPerson;
                            // MISSING (not disabled): show replacement and store reason.
                            if (!isRotationPersonDisabledSpecial && assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date, 'special')) {
                                let foundReplacement = false;
                                for (let offset = 1; offset <= rotationDays * 2 && !foundReplacement; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (isPersonMissingOnDate(candidate, groupNum, date, 'special')) continue;
                                    // Do not use the same person to replace two missing people in this period
                                    const alreadyAssignedOnAnotherSpecial = sortedSpecial.some(dk => dk !== dateKey && tempSpecialAssignments[dk]?.[groupNum] === candidate);
                                    if (alreadyAssignedOnAnotherSpecial) continue;
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
                                        returnFromMissingSpecial.push({ personName: rotationPerson, groupNum, missedDateKey: dateKey });
                                        break;
                                }
                                if (!foundReplacement) assignedPerson = null;
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
                                
                                // Advance rotation position: when disabled we advance from replacement; when missing we advance from missing person so next date we try the next person in list (and detect if they are missing too)
                                if (wasReplaced && replacementIndex !== null) {
                                    if (wasDisabledOnlySkippedSpecial) {
                                        globalSpecialRotationPosition[groupNum] = (replacementIndex + 1) % rotationDays;
                                    } else {
                                        // Replaced due to missing: advance from missing person's position so we try the next person in list on the next special date
                                        globalSpecialRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                    }
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
                        }
                    }
                });
                
                // Return-from-missing for special: assign returning people in the next special duty as a replacement to the baseline rotation.
                // Each returning person takes the slot of the baseline (rotation) person on a target date; baseline is unchanged for display/continuation.
                // Target: same month first, else next available special.
                const usedReturnFromMissingSpecial = new Set();
                for (const entry of returnFromMissingSpecial) {
                    const { personName, groupNum, missedDateKey } = entry;
                    const missedDate = new Date(missedDateKey + 'T00:00:00');
                    const missedMonthKey = getMonthKeyFromDate(missedDate);
                    let targetKey = null;
                    const sameMonthSpecials = sortedSpecial.filter((dk) => {
                        const d = new Date(dk + 'T00:00:00');
                        return getMonthKeyFromDate(d) === missedMonthKey && dk !== missedDateKey;
                    });
                    // Prefer same-month specials (excluding the missed date). Only assign to a date when the person is NOT missing (they must be back).
                    for (const dk of sameMonthSpecials) {
                        if (usedReturnFromMissingSpecial.has(`${dk}:${groupNum}`)) continue;
                        const dateObj = new Date(dk + 'T00:00:00');
                        if (isPersonMissingOnDate(personName, groupNum, dateObj, 'special')) continue;
                        targetKey = dk;
                        break;
                    }
                    if (!targetKey) {
                        for (const dk of sortedSpecial) {
                            if (dk <= missedDateKey) continue;
                            if (usedReturnFromMissingSpecial.has(`${dk}:${groupNum}`)) continue;
                            const dateObj = new Date(dk + 'T00:00:00');
                            if (isPersonMissingOnDate(personName, groupNum, dateObj, 'special')) continue;
                            targetKey = dk;
                            break;
                        }
                    }
                    if (!targetKey) continue;
                    usedReturnFromMissingSpecial.add(`${targetKey}:${groupNum}`);
                    const displacedPerson = tempSpecialAssignments[targetKey]?.[groupNum] || null;
                    if (!tempSpecialAssignments[targetKey]) tempSpecialAssignments[targetKey] = {};
                    tempSpecialAssignments[targetKey][groupNum] = personName;
                    const reasonText = displacedPerson
                        ? `Επέστρεψε από απουσία· αντικατέστησε προσωρινά ${displacedPerson} στην ημερομηνία αυτή.`
                        : 'Επέστρεψε από απουσία.';
                    storeAssignmentReason(targetKey, groupNum, personName, 'skip', reasonText, displacedPerson, null, { returnFromMissing: true, missingEnd: missedDateKey });
                    const monthKeyT = getMonthKeyFromDate(new Date(targetKey + 'T00:00:00'));
                    if (simulatedSpecialAssignmentsForConflict[monthKeyT]?.[groupNum]) {
                        if (displacedPerson) simulatedSpecialAssignmentsForConflict[monthKeyT][groupNum].delete(displacedPerson);
                        simulatedSpecialAssignmentsForConflict[monthKeyT][groupNum].add(personName);
                    }
                }
                
                // Build preview table after return-from-missing so we show baseline vs αντικατάσταση (including return-from-missing)
                for (const dateKey of sortedSpecial) {
                    const date = new Date(dateKey + 'T00:00:00');
                    const dateStr = date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const dayName = getGreekDayName(date);
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
                    html += '<tr>';
                    html += `<td><strong>${dateStr}</strong></td>`;
                    html += `<td>${holidayName || 'Ειδική Αργία'}</td>`;
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        const groupData = groups[groupNum] || { special: [] };
                        const groupPeople = groupData.special || [];
                        if (groupPeople.length === 0) {
                            html += '<td class="text-muted">-</td>';
                        } else {
                            const rotationDays = groupPeople.length;
                            const baselinePersonForDisplaySpecial = specialRotationPersons[dateKey]?.[groupNum] ?? null;
                            const assignedPerson = tempSpecialAssignments[dateKey]?.[groupNum] ?? null;
                            let lastDutyInfo = '';
                            let daysCountInfo = '';
                            if (assignedPerson) {
                                const daysSince = countDaysSinceLastDuty(dateKey, assignedPerson, groupNum, 'special', dayTypeLists, startDate);
                                const dutyDates = getLastAndNextDutyDates(assignedPerson, groupNum, 'special', groupPeople.length);
                                lastDutyInfo = dutyDates.lastDuty !== 'Δεν έχει' ? `<br><small class="text-muted">Τελευταία: ${dutyDates.lastDuty}</small>` : '';
                                if (daysSince !== null && daysSince !== Infinity) {
                                    daysCountInfo = ` <span class="text-info">${daysSince}/${rotationDays} ημέρες</span>`;
                                } else if (daysSince === Infinity) {
                                    daysCountInfo = ' <span class="text-success">πρώτη φορά</span>';
                                }
                            }
                            html += `<td>${buildBaselineComputedCellHtml(baselinePersonForDisplaySpecial, assignedPerson, daysCountInfo, lastDutyInfo)}</td>`;
                        }
                    }
                    html += '</tr>';
                }
                
                // Store assignments and rotation positions in calculationSteps for saving when Next is pressed
                calculationSteps.tempSpecialAssignments = tempSpecialAssignments;
                // Store pure rotation baseline (rotation person per date) for saving to Firestore – so continuation uses baseline, not returner
                calculationSteps.tempSpecialBaselineAssignments = specialRotationPersons;

                // Store last rotation person for each group (overall, for end-of-range continuation)
                // Use BASELINE (rotation) person for the last date so that when return-from-missing placed A/B (displacing C/D), we continue from E next month
                calculationSteps.lastSpecialRotationPositions = {};
                for (let g = 1; g <= 4; g++) {
                    let lastBaselinePerson = null;
                    for (let i = sortedSpecial.length - 1; i >= 0; i--) {
                        const dateKey = sortedSpecial[i];
                        const baselinePerson = specialRotationPersons[dateKey]?.[g];
                        if (baselinePerson) {
                            lastBaselinePerson = baselinePerson;
                            break;
                        }
                    }
                    if (lastBaselinePerson) {
                        calculationSteps.lastSpecialRotationPositions[g] = lastBaselinePerson;
                        console.log(`[SPECIAL ROTATION] Storing last baseline (rotation) person ${lastBaselinePerson} for group ${g} for continuation`);
                    }
                }

                // Store last rotation person per month: use BASELINE (rotation) for last date in month so continuation is correct when return-from-missing is used
                const lastSpecialRotationPositionsByMonth = {}; // monthKey -> { groupNum -> baselinePerson }
                for (let i = sortedSpecial.length - 1; i >= 0; i--) {
                    const dateKey = sortedSpecial[i];
                    const d = new Date(dateKey + 'T00:00:00');
                    const monthKey = getMonthKeyFromDate(d);
                    if (!lastSpecialRotationPositionsByMonth[monthKey]) {
                        lastSpecialRotationPositionsByMonth[monthKey] = {};
                    }
                    for (let g = 1; g <= 4; g++) {
                        if (lastSpecialRotationPositionsByMonth[monthKey][g] !== undefined) continue;
                        const baselinePerson = specialRotationPersons[dateKey]?.[g];
                        if (baselinePerson) {
                            lastSpecialRotationPositionsByMonth[monthKey][g] = baselinePerson;
                            // #region agent log
                            fetch('http://127.0.0.1:7243/ingest/9c1664f2-0b77-41ea-b88a-7c7ef737e197',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'duty-shifts-logic.js:saveLastRotation',message:'saving last rotation person for month',data:{monthKey,groupNum:g,dateKey,baselinePerson,assignedPerson:tempSpecialAssignments[dateKey]?.[g]||null},hypothesisId:'H5',timestamp:Date.now(),sessionId:'debug-session'})}).catch(()=>{});
                            // #endregion
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
                        const compReason = getAssignmentReason(dateKey, groupNum, comp);
                        if (compReason && compReason.meta && compReason.meta.returnFromMissing) {
                            reason = (compReason.reason || 'Επέστρεψε από απουσία.').split('.').filter(Boolean)[0] || 'Επέστρεψε από απουσία';
                        } else if (isPersonDisabledForDuty(base, groupNum, 'special') || isPersonMissingOnDate(base, groupNum, date, 'special')) {
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
                                // #region agent log
                                fetch('http://127.0.0.1:7243/ingest/9c1664f2-0b77-41ea-b88a-7c7ef737e197',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'duty-shifts-logic.js:setLastRotationPerson',message:'calling setLastRotationPersonForMonth',data:{dayType:'special',monthKey,groupNum,personName:groupsForMonth[groupNum]},hypothesisId:'H5',timestamp:Date.now(),sessionId:'debug-session'})}).catch(()=>{});
                                // #endregion
                            }
                        }
                    }
                    
                    // Save to Firestore
                    const sanitizedPositions = sanitizeForFirestore(lastRotationPositions);
                    // #region agent log
                    fetch('http://127.0.0.1:7243/ingest/9c1664f2-0b77-41ea-b88a-7c7ef737e197',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'duty-shifts-logic.js:saveToFirestore',message:'saving lastRotationPositions to Firestore',data:{lastRotationPositionsSpecial:lastRotationPositions?.special||null,lastSpecialRotationPositionsByMonth},hypothesisId:'H5',timestamp:Date.now(),sessionId:'debug-session'})}).catch(()=>{});
                    // #endregion
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
        async function saveStep3_SemiNormal() {
            // Semi-normal baseline + swap already run when Step 3 was rendered (after OK on weekend).
            // Show results modal (like normal days); OK on modal advances to Step 4.
            const updatedAssignments = calculationSteps.finalSemiAssignments || calculationSteps.tempSemiAssignments || {};
            const swappedPeople = []; // modal builds rows from tempSemiBaselineAssignments vs finalSemiAssignments + assignmentReasons
            showSemiNormalSwapResults(swappedPeople, updatedAssignments);
        }
        async function runSemiNormalSwapLogic() {
            // Semi-normal baseline + conflict + swap now run in renderStep3_SemiNormal (after OK on weekend).
            return;
        }
        function _runSemiNormalSwapLogic_REMOVED() {
            try {
                const dayTypeLists = calculationSteps.dayTypeLists || { semi: [], special: [], weekend: [] };
                const semiNormalDays = dayTypeLists.semi || [];
                const specialHolidays = dayTypeLists.special || [];
                const weekendHolidays = dayTypeLists.weekend || [];
                
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
                            // STEP 1: Try forward swap with the next semi-normal day(s) in chronological order (SAME MONTH FIRST)
                            // Try the immediate next semi-normal day first; if swap would cause a conflict for either person,
                            // continue to the next semi-normal day, etc.
                            let swapCandidate = null;
                            let swapDateKey = null;

                            // First, try forward swaps within the same month
                            for (let j = semiIndex + 1; j < sortedSemi.length; j++) {
                                const candidateDateKey = sortedSemi[j];
                                const candidateDate = new Date(candidateDateKey + 'T00:00:00');
                                if (isNaN(candidateDate.getTime())) continue;

                                // Only try swaps within the same month
                                if (candidateDate.getMonth() !== month || candidateDate.getFullYear() !== year) {
                                    break; // Stop if we've moved to next month
                                }

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
                            
                            // STEP 2: If forward swap failed, try BACKWARD swap with previous semi-normal days in SAME MONTH
                            if (!swapCandidate || !swapDateKey) {
                                console.log(`[SEMI SWAP LOGIC] Forward swap failed for ${currentPerson} on ${dateKey}, trying BACKWARD swap in same month`);
                                for (let j = semiIndex - 1; j >= 0; j--) {
                                    const candidateDateKey = sortedSemi[j];
                                    const candidateDate = new Date(candidateDateKey + 'T00:00:00');
                                    if (isNaN(candidateDate.getTime())) continue;

                                    // Only try swaps within the same month
                                    if (candidateDate.getMonth() !== month || candidateDate.getFullYear() !== year) {
                                        break; // Stop if we've moved to previous month
                                    }

                                    // Candidate is the person currently assigned on the previous semi-normal day
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
                                        console.log(`[SEMI SWAP LOGIC] ✓ BACKWARD swap found: ${currentPerson} ↔ ${swapCandidate} (${dateKey} ↔ ${swapDateKey})`);
                                        break;
                                    }
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
                                
                                // If this is a BACKWARD swap (swapDateKey earlier than dateKey in same month),
                                // do a forward SHIFT across the intervening semi-normal days so that:
                                // - currentPerson moves backward to swapDateKey
                                // - the displaced person (swapCandidate) becomes the EXACT next semi-normal after swapDateKey
                                // - everyone in between shifts forward by one semi slot (no one gets "skipped")
                                const fromIndex = sortedSemi.indexOf(swapDateKey);
                                const toIndex = sortedSemi.indexOf(dateKey);
                                // Backward shift across the intervening semi days.
                                // Allow across month boundaries too (as long as both keys exist in sortedSemi for this run),
                                // so the displaced person is not lost in multi-month calculations.
                                const isBackwardWithinMonth = fromIndex >= 0 && toIndex >= 0 && fromIndex < toIndex;

                                // Use the ACTUAL conflict neighbor day (e.g. Fri) instead of the swap-execution day (e.g. Thu).
                                const conflictNeighborKey = getConsecutiveConflictNeighborDayKey(dateKey, currentPerson, groupNum, {
                                    special: simulatedSpecialAssignments,
                                    weekend: simulatedWeekendAssignments,
                                    semi: updatedAssignments,
                                    normal: null
                                }) || dateKey;

                                if (isBackwardWithinMonth) {
                                    // Backward shift: currentPerson moves backward to swapDateKey,
                                    // and everyone in between shifts forward by one slot.
                                    // The displaced person (originally at swapDateKey) becomes the EXACT next semi-normal after swapDateKey.
                                    const changes = []; // { dk, prevPerson, newPerson }
                                    let carry = currentPerson;
                                    
                                    // Get the displaced person BEFORE the shift (the person originally at swapDateKey)
                                    const displacedPersonOriginal = updatedAssignments[swapDateKey]?.[groupNum] || swapCandidate;
                                    
                                    // Perform the forward shift across all days from swapDateKey to dateKey (inclusive)
                                    for (let i = fromIndex; i <= toIndex; i++) {
                                        const dk = sortedSemi[i];
                                        if (!updatedAssignments[dk]) updatedAssignments[dk] = {};
                                        const prev = updatedAssignments[dk][groupNum] || null;
                                        updatedAssignments[dk][groupNum] = carry;
                                        changes.push({ dk, prevPerson: prev, newPerson: carry });
                                        carry = prev; // This becomes the person for the next iteration
                                        swappedSemiSet.add(`${dk}:${groupNum}`);
                                    }
                                    
                                    // After the shift loop, verify the displaced person is correctly assigned
                                    // The displaced person should be at fromIndex + 1 (the next semi-normal after swapDateKey)
                                    // This verification ensures no one gets skipped
                                    if (fromIndex + 1 < sortedSemi.length && displacedPersonOriginal) {
                                        const nextSemiKey = sortedSemi[fromIndex + 1];
                                        const assignedAtNext = updatedAssignments[nextSemiKey]?.[groupNum];
                                        
                                        // If the displaced person is not correctly assigned at the next semi-normal day,
                                        // ensure they are assigned there (this handles edge cases where the shift might miss them)
                                        if (assignedAtNext !== displacedPersonOriginal) {
                                            if (!updatedAssignments[nextSemiKey]) updatedAssignments[nextSemiKey] = {};
                                            // Only assign if that day doesn't already have someone (to avoid overwriting correct assignments)
                                            if (!updatedAssignments[nextSemiKey][groupNum] || updatedAssignments[nextSemiKey][groupNum] !== displacedPersonOriginal) {
                                                updatedAssignments[nextSemiKey][groupNum] = displacedPersonOriginal;
                                                swappedSemiSet.add(`${nextSemiKey}:${groupNum}`);
                                                // Store assignment reason for the displaced person
                                                storeAssignmentReason(
                                                    nextSemiKey,
                                                    groupNum,
                                                    displacedPersonOriginal,
                                                    'shift',
                                                    `Μετακίνηση (οπισθοδρομική ανταλλαγή) λόγω σύγκρουσης γειτονικής υπηρεσίας (${conflictNeighborKey}).`,
                                                    null,
                                                    swapPairId,
                                                    { backwardShift: true, originDayKey: dateKey, swapDayKey: swapDateKey, conflictDateKey: conflictNeighborKey, displacedPerson: true }
                                                );
                                            }
                                        }
                                    }

                                    // Store "shift" reasons for all moved assignments (keeps UI explanations consistent).
                                    for (const ch of changes) {
                                        if (!ch.newPerson) continue;
                                        storeAssignmentReason(
                                            ch.dk,
                                            groupNum,
                                            ch.newPerson,
                                            'shift',
                                            `Μετακίνηση (οπισθοδρομική ανταλλαγή) λόγω σύγκρουσης γειτονικής υπηρεσίας (${conflictNeighborKey}).`,
                                            ch.prevPerson || null,
                                            swapPairId,
                                            { backwardShift: true, originDayKey: dateKey, swapDayKey: swapDateKey, conflictDateKey: conflictNeighborKey }
                                        );
                                    }
                                } else {
                                    // Forward swap (or cross-month) keeps original swap behavior
                                    // Perform the swap: conflicted person goes to swap date, swapped person goes to conflicted date
                                    updatedAssignments[dateKey][groupNum] = swapCandidate;
                                    updatedAssignments[swapDateKey][groupNum] = currentPerson;

                                    // Mark both days as swapped in this run to prevent re-swapping loops
                                    swappedSemiSet.add(`${dateKey}:${groupNum}`);
                                    swappedSemiSet.add(`${swapDateKey}:${groupNum}`);
                                    
                                    // Store assignment reasons for both swapped people with swap pair ID
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
                                }
                                
                                // IMPORTANT: Stop processing this conflict - swap found, don't try cross-month swap
                                // Break out of the loop to prevent unnecessary swaps
                                break;
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

                    const reasonObj = getAssignmentReason(dateKey, groupNum, comp) || null;
                    if (reasonObj && reasonObj.type === 'shift') continue;
                    const isBaseDisabledOrMissing = isPersonDisabledForDuty(base, groupNum, 'semi') || isPersonMissingOnDate(base, groupNum, dateObj, 'semi');
                    // Same as normal: skip only if cascading shift (no reason and base missing/disabled => direct replacement has 'skip' on another row)
                    if (!reasonObj && isBaseDisabledOrMissing) {
                        continue;
                    }
                    if (!reasonObj && !isBaseDisabledOrMissing) {
                        const monthKey = `${dateObj.getFullYear()}-${dateObj.getMonth()}`;
                        let baselineWasReplaced = false;
                        for (const dk in assignmentReasons) {
                            if (dk >= dateKey) break;
                            const dkDate = new Date(dk + 'T00:00:00');
                            const dkMonthKey = `${dkDate.getFullYear()}-${dkDate.getMonth()}`;
                            if (dkMonthKey !== monthKey) continue;
                            const dkReason = assignmentReasons[dk]?.[groupNum]?.[base];
                            if (dkReason && dkReason.type === 'skip') {
                                baselineWasReplaced = true;
                                break;
                            }
                        }
                        if (baselineWasReplaced) continue;
                    }
                    const otherKey = reasonObj?.type === 'swap'
                        ? findSwapOtherDateKey(reasonObj.swapPairId, groupNum, dateKey)
                        : null;
                    if (reasonObj?.type === 'swap' && reasonObj.swapPairId != null && otherKey && dateKey > otherKey) continue;
                    const reasonText = reasonObj?.reason
                        ? String(reasonObj.type === 'swap' ? normalizeSwapReasonText(reasonObj.reason) : reasonObj.reason)
                        : '';
                    // Same logic as normal: when missing or disabled use "Αντικατέστησε ..." sentence (buildUnavailableReplacementReason)
                    let briefReason = isBaseDisabledOrMissing
                        ? (buildUnavailableReplacementReason({
                            skippedPersonName: base,
                            replacementPersonName: comp,
                            dateObj,
                            groupNum,
                            dutyCategory: 'semi'
                        }).split('.').filter(Boolean)[0] || '')
                        : (reasonText ? reasonText.split('.').filter(Boolean)[0] : 'Αλλαγή');

                    const swapDateStr = otherKey
                        ? new Date(otherKey + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : '-';
                    const otherDayName = otherKey ? getGreekDayName(new Date(otherKey + 'T00:00:00')) : '';
                    const dateStrDisplay = (reasonObj?.type === 'swap' && otherKey) ? `${dayName} ${dateStr} ↔ ${otherDayName} ${swapDateStr}` : null;

                    rows.push({
                        dateKey,
                        dayName,
                        dateStr,
                        dateStrDisplay,
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
                    const dateCol = r.dateStrDisplay != null ? r.dateStrDisplay : `${r.dayName} ${r.dateStr}`;
                    message += `<tr>
                        <td>${dateCol}</td>
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
                    // Snapshot original assignments so we can preserve rotation order after the inserted person's natural slot (log evidence: 19/02 had wrong person when using "remaining" pull).
                    const originalAssignments = {};
                    for (let j = idx; j < sortedNormalKeys.length; j++) {
                        const dk = sortedNormalKeys[j];
                        originalAssignments[dk] = assignmentsByDate?.[dk]?.[groupNum] || null;
                    }
                    let remaining = null;
                    const assignedInChain = new Set();
                    let carry = insertedPerson;
                    for (let i = idx; i < sortedNormalKeys.length; i++) {
                        const dk = sortedNormalKeys[i];
                        const cur = assignmentsByDate?.[dk]?.[groupNum] || null;
                        const dateObj = dateKeyToDate(dk);

                        let desired = carry;
                        // At the returning person's natural slot: put carry (displaced person) so rotation order is preserved; next day will get original(dk) below.
                        if (dk !== startKey && cur && normName(cur) === normName(insertedPerson)) {
                            desired = carry;
                        }
                        // Would assign the returning person again (past their natural slot): put the person who was originally on this day so rotation order is preserved.
                        else if (dk !== startKey && desired && normName(desired) === normName(insertedPerson)) {
                            desired = originalAssignments[dk] || desired;
                        }
                        // Would assign someone we already placed in this chain: use next from remaining (preserves rotation: 19/02 gets Person 8 for swap with conflicted, 24/02 gets Person 7).
                        else if (desired && assignedInChain.has(normName(desired))) {
                            if (remaining === null) {
                                remaining = [];
                                for (let j = i + 1; j < sortedNormalKeys.length; j++) {
                                    const p = originalAssignments[sortedNormalKeys[j]] || null;
                                    if (p) remaining.push(p);
                                }
                            }
                            desired = (remaining && remaining.length > 0) ? remaining.shift() : desired;
                        }
                        if (desired && isPersonMissingOnDate(desired, groupNum, dateObj, 'normal')) {
                            const startIdx = indexOfPersonInList(groupPeople, desired);
                            const replacement = startIdx >= 0 ? pickNextEligibleIgnoringConflicts(groupPeople, startIdx, groupNum, dateObj) : null;
                            desired = replacement || null;
                        }

                        if (!assignmentsByDate[dk]) assignmentsByDate[dk] = {};
                        assignmentsByDate[dk][groupNum] = desired;
                        changes.push({ dateKey: dk, prevPerson: cur, newPerson: desired });
                        if (desired) assignedInChain.add(normName(desired));
                        carry = cur;
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
                
                // Get global normal rotation positions
                const globalNormalRotationPosition = calculationSteps.lastNormalRotationPositions || {};

                // Apply "return-from-missing" reinsertion BEFORE swap logic, so swap logic can still resolve any new conflicts.
                // This modifies ONLY updatedAssignments (final schedule), not baseline rotation persons.
                try {
                    if (calcStartDate && calcEndDate && Array.isArray(sortedNormal) && sortedNormal.length > 0) {
                        const calcStartKey = formatDateKey(calcStartDate);
                        const calcEndKey = formatDateKey(calcEndDate);
                        const processed = new Set(); // "g|person|periodEnd"
                        // Allow periods that end in the month immediately before calc start (so return/reinsertion can fall in calculated month)
                        const prevMonthStart = new Date(calcStartDate.getFullYear(), calcStartDate.getMonth() - 1, 1);
                        const prevMonthEnd = new Date(calcStartDate.getFullYear(), calcStartDate.getMonth(), 0);
                        const prevMonthStartKey = formatDateKey(prevMonthStart);
                        const prevMonthEndKey = formatDateKey(prevMonthEnd);
                        const periodEndsInPrevMonth = (pEnd) => pEnd >= prevMonthStartKey && pEnd <= prevMonthEndKey;

                        // Process deferred return-from-missing: assign 3 normal days after return in current calculated month.
                        // If the person was already assigned (backward/forward) in a previous month for this same missing period, skip – don't re-assign in this month; they'll get their turn again in normal rotation.
                        const deferredList = calculationSteps.deferredReturnFromMissing || [];
                        calculationSteps.deferredReturnFromMissing = deferredList.filter((entry) => {
                            if (entry.returnKey < calcStartKey || entry.returnKey > calcEndKey) return true;
                            const personName = entry.personName, groupNum = entry.groupNum, returnKey = entry.returnKey, pEndKey = entry.pEndKey;
                            // Already placed in a previous month for this same missing period (pEndKey)? Skip deferred – no re-assign here.
                            for (const dk in assignmentReasons) {
                                if (dk >= returnKey) continue;
                                const reason = getAssignmentReason(dk, groupNum, personName);
                                if (reason && reason.meta?.returnFromMissing && reason.meta?.missingEnd === pEndKey) {
                                    return false; // remove from deferred – already assigned in a previous month
                                }
                            }
                            let track = entry.track;
                            if (!track) {
                                const thirdNorm = findThirdNormalOnOrAfter(sortedNormal, returnKey);
                                if (!thirdNorm) return true;
                                track = getTrackFromDow(dateKeyToDate(thirdNorm).getDay());
                            }
                            if (!track) return true;
                            const groupPeopleForReturn = (groups?.[groupNum]?.normal || []);
                            for (const dk of sortedNormal) {
                                if (dk < calcStartKey || dk > calcEndKey) continue;
                                const curAssigned = updatedAssignments?.[dk]?.[groupNum] || null;
                                if (!curAssigned || normName(curAssigned) !== normName(personName)) continue;
                                const dateObj = dateKeyToDate(dk);
                                const idxP = indexOfPersonInList(groupPeopleForReturn, personName);
                                const replacement = idxP >= 0 ? pickNextEligibleIgnoringConflicts(groupPeopleForReturn, idxP, groupNum, dateObj) : null;
                                if (!replacement) continue;
                                if (!updatedAssignments[dk]) updatedAssignments[dk] = {};
                                updatedAssignments[dk][groupNum] = replacement;
                                storeAssignmentReason(dk, groupNum, replacement, 'shift', '', personName, null, { returnFromMissing: true, clearedEarlyReturnAssignment: true, targetKey: null, missingEnd: pEndKey, preClearedForReinsertion: true });
                            }
                            const thirdNormalKey = findThirdNormalOnOrAfter(sortedNormal, returnKey);
                            if (!thirdNormalKey) return true;
                            let targetKey = findFirstMatchingTrackOnOrAfter(sortedNormal, thirdNormalKey, track);
                            const tryDeferred = (candidateKey) => {
                                if (!candidateKey) return false;
                                if (!canAssignPersonToNormalDay(candidateKey, personName, groupNum, updatedAssignments, globalNormalRotationPosition, simulatedSpecialAssignments, simulatedWeekendAssignments, simulatedSemiAssignments, { allowConsecutiveConflicts: true })) return false;
                                const groupPeople = (groups?.[groupNum]?.normal || []);
                                const chainOk = canShiftInsertFromDate(sortedNormal, candidateKey, groupNum, personName, groupPeople, updatedAssignments, globalNormalRotationPosition, simulatedSpecialAssignments, simulatedWeekendAssignments, simulatedSemiAssignments);
                                return chainOk.ok;
                            };
                            while (targetKey) {
                                if (targetKey > calcEndKey) break;
                                if (tryDeferred(targetKey)) break;
                                const nextThreshold = addDaysToDateKey(targetKey, 1);
                                targetKey = nextThreshold ? findFirstMatchingTrackOnOrAfter(sortedNormal, nextThreshold, track) : null;
                            }
                            if (!targetKey) return true;
                            const groupPeopleFinal = (groups?.[groupNum]?.normal || []);
                            const ins = applyShiftInsertFromDate(sortedNormal, targetKey, groupNum, personName, groupPeopleFinal, updatedAssignments);
                            if (!ins.ok) return true;
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
                                    storeAssignmentReason(dk, groupNum, replacement, 'shift', '', personName, null, { returnFromMissing: true, clearedEarlyReturnAssignment: true, targetKey, missingEnd: pEndKey });
                                }
                            } catch (_) {}
                            storeAssignmentReason(targetKey, groupNum, personName, 'skip', `Επέστρεψε από απουσία και επανεντάχθηκε στις καθημερινές μετά από 3 καθημερινές ημέρες (λογική ${track === 1 ? 'Δευτέρα/Τετάρτη' : 'Τρίτη/Πέμπτη'}).`, ins.originalAtTarget || null, null, { returnFromMissing: true, insertedByShift: true, missingEnd: pEndKey, fromDeferred: true });
                            try {
                                const chain = Array.isArray(ins.changes) ? ins.changes : [];
                                for (const ch of chain) {
                                    if (!ch || !ch.dateKey || ch.dateKey === targetKey) continue;
                                    const newP = ch.newPerson;
                                    if (!newP) continue;
                                    storeAssignmentReason(ch.dateKey, groupNum, newP, 'shift', '', ch.prevPerson || null, null, { returnFromMissing: true, shiftedByReturnFromMissing: true, anchorDateKey: targetKey, missingEnd: pEndKey });
                                }
                            } catch (_) {}
                            return false; // remove from deferred
                        });

                        const usedReturnFromMissingTargets = new Set(); // "dateKey:groupNum" already used by a previous return-from-missing in this run
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            const g = groups?.[groupNum];
                            const missingMap = g?.missingPeriods || {};
                            for (const personName of Object.keys(missingMap)) {
                                const periods = Array.isArray(missingMap[personName]) ? missingMap[personName] : [];
                                for (const period of periods) {
                                    const pStartKey = inputValueToDateKey(period?.start);
                                    const pEndKey = inputValueToDateKey(period?.end);
                                    if (!pStartKey || !pEndKey) continue;
                                    const endInRange = (pEndKey >= calcStartKey && pEndKey <= calcEndKey);
                                    const endInPrevMonth = periodEndsInPrevMonth(pEndKey);
                                    // Also accept when return day (day after period end) falls in calculation range
                                    const returnKeyForRange = addDaysToDateKey(pEndKey, 1);
                                    const returnInRange = returnKeyForRange && returnKeyForRange >= calcStartKey && returnKeyForRange <= calcEndKey;
                                    // Also accept when period overlaps the calculation range at all (handles format/edge cases)
                                    const periodOverlapsRange = (pStartKey <= calcEndKey && pEndKey >= calcStartKey);
                                    const acceptPeriod = endInRange || endInPrevMonth || returnInRange || periodOverlapsRange;
                                    // #region agent log
                                    if (!acceptPeriod) {
                                        const _log = {location:'returnFromMissing:range',message:'period skipped: end not in range',data:{groupNum,personName,pStartKey,pEndKey,calcStartKey,calcEndKey,endInRange,endInPrevMonth,returnKeyForRange,returnInRange,periodOverlapsRange},hypothesisId:'H1'};
                                        // Debug ingest disabled to avoid ERR_CONNECTION_REFUSED when local server not running
                                        console.log('[DEBUG returnFromMissing]', _log);
                                        continue;
                                    }
                                    // #endregion
                                    const dedupeKey = `${groupNum}|${personName}|${pEndKey}`;
                                    if (processed.has(dedupeKey)) {
                                        // #region agent log
                                        const _log = {location:'returnFromMissing:dedupe',message:'period skipped: dedupe',data:{groupNum,personName,pEndKey,dedupeKey},hypothesisId:'H1'};
                                        // Debug ingest disabled to avoid ERR_CONNECTION_REFUSED when local server not running
                                        console.log('[DEBUG returnFromMissing]', _log);
                                        // #endregion
                                        continue;
                                    }
                                    processed.add(dedupeKey);
                                    // #region agent log
                                    const _logAcc = {location:'returnFromMissing:accepted',message:'period accepted for reinsertion',data:{groupNum,personName,pStartKey,pEndKey,calcStartKey,calcEndKey},hypothesisId:'H1'};
                                    // Debug ingest disabled to avoid ERR_CONNECTION_REFUSED when local server not running
                                    console.log('[DEBUG returnFromMissing]', _logAcc);
                                    // #endregion

                                    const pEndDate = dateKeyToDate(pEndKey);
                                    if (isNaN(pEndDate.getTime())) continue;

                                    // Find first missed baseline normal duty in CALCULATED MONTH only (missing period ∩ calc range).
                                    // Use normalized name comparison so storage format (e.g. with/without rank) doesn't skip assignment.
                                    const overlapStartKey = maxDateKey(pStartKey, calcStartKey);
                                    const overlapEndKey = minDateKey(pEndKey, calcEndKey);
                                    let firstMissedKey = null;
                                    if (overlapStartKey && overlapEndKey && overlapStartKey <= overlapEndKey) {
                                        for (const dk of sortedNormal) {
                                            if (dk < overlapStartKey) continue;
                                            if (dk > overlapEndKey) break;
                                            const baselinePerson =
                                                baselineNormalByDate?.[dk]?.[groupNum] ||
                                                parseAssignedPersonForGroupFromAssignment(getRotationBaselineAssignmentForType('normal', dk), groupNum) ||
                                                null;
                                            if (baselinePerson && normName(baselinePerson) === normName(personName)) {
                                                firstMissedKey = dk;
                                                break;
                                            }
                                        }
                                    }
                                    // #region agent log
                                    const _logFm = {location:'returnFromMissing:firstMissed',message:'firstMissedKey result',data:{groupNum,personName,pEndKey,firstMissedKey:firstMissedKey||null},hypothesisId:'H2'};
                                    // Debug ingest disabled to avoid ERR_CONNECTION_REFUSED when local server not running
                                    console.log('[DEBUG returnFromMissing]', _logFm);
                                    // #endregion
                                    // Return day is end+1
                                    const returnKey = addDaysToDateKey(pEndKey, 1);
                                    if (!returnKey) continue;

                                    // Already placed for this same missing period (pEndKey) in a previous month? Skip – do not re-assign in this month; they get duty again on their normal rotation turn.
                                    let alreadyPlacedForThisPeriod = false;
                                    for (const dk in assignmentReasons) {
                                        if (dk >= returnKey) continue;
                                        const reason = getAssignmentReason(dk, groupNum, personName);
                                        if (reason && reason.meta?.returnFromMissing && reason.meta?.missingEnd === pEndKey) {
                                            alreadyPlacedForThisPeriod = true;
                                            break;
                                        }
                                    }
                                    if (alreadyPlacedForThisPeriod) continue;

                                    // If no baseline duty in calculated month during missing period, defer to next month if return is next month.
                                    if (!firstMissedKey) {
                                        if (returnKey > calcEndKey) {
                                            calculationSteps.deferredReturnFromMissing = calculationSteps.deferredReturnFromMissing || [];
                                            calculationSteps.deferredReturnFromMissing.push({ personName, groupNum, pEndKey, returnKey });
                                        }
                                        continue;
                                    }

                                    const track = getTrackFromDow(dateKeyToDate(firstMissedKey).getDay());
                                    if (!track) continue;

                                    // Pre-clear: remove the returning person from any normal-day slot in the calculation range
                                    // so that feasibility checks (canAssignPersonToNormalDay / canShiftInsertFromDate) do not
                                    // see them as already assigned (which can block finding a targetKey when rotation assigned
                                    // them at end of month and duplicate/consecutive logic would otherwise prevent reinsertion).
                                    const groupPeopleForReturn = (groups?.[groupNum]?.normal || []);
                                    for (const dk of sortedNormal) {
                                        if (dk < calcStartKey || dk > calcEndKey) continue;
                                        const curAssigned = updatedAssignments?.[dk]?.[groupNum] || null;
                                        if (!curAssigned || normName(curAssigned) !== normName(personName)) continue;
                                        const dateObj = dateKeyToDate(dk);
                                        const idxP = indexOfPersonInList(groupPeopleForReturn, personName);
                                        const replacement = idxP >= 0 ? pickNextEligibleIgnoringConflicts(groupPeopleForReturn, idxP, groupNum, dateObj) : null;
                                        if (!replacement) continue;
                                        if (!updatedAssignments[dk]) updatedAssignments[dk] = {};
                                        updatedAssignments[dk][groupNum] = replacement;
                                        storeAssignmentReason(
                                            dk,
                                            groupNum,
                                            replacement,
                                            'shift',
                                            '',
                                            personName,
                                            null,
                                            { returnFromMissing: true, clearedEarlyReturnAssignment: true, targetKey: null, missingEnd: pEndKey, preClearedForReinsertion: true }
                                        );
                                    }

                                    // Same month = CALCULATED month (not return month). Forward only possible when return is in calc month.
                                    const sameMonthStartKey = calcStartKey;
                                    const sameMonthEndKey = calcEndKey;
                                    const returnInCalcMonth = (returnKey >= calcStartKey && returnKey <= calcEndKey);

                                    // Count 3 normal days starting at returnKey (on-or-after), then find nearest track day on/after that (used for forward and for deferred).
                                    const thirdNormalKey = findThirdNormalOnOrAfter(sortedNormal, returnKey);
                                    const returnDate = dateKeyToDate(returnKey);

                                    const tryTargetKey = (candidateKey) => {
                                        if (!candidateKey) return false;
                                        if (usedReturnFromMissingTargets.has(`${candidateKey}:${groupNum}`)) return false;
                                        // #region agent log
                                        const dateObjForCandidate = dateKeyToDate(candidateKey);
                                        const isMissingOnCandidate = typeof isPersonMissingOnDate === 'function' && isPersonMissingOnDate(personName, groupNum, dateObjForCandidate, 'normal');
                                        const _logTc = {location:'tryTargetKey:check',message:'tryTargetKey candidate',data:{candidateKey,personName,groupNum,isMissingOnCandidate},hypothesisId:'H3,H4'};
                                        // Debug ingest disabled to avoid ERR_CONNECTION_REFUSED when local server not running
                                        console.log('[DEBUG returnFromMissing]', _logTc);
                                        // #endregion
                                        const okReturning = canAssignPersonToNormalDay(
                                            candidateKey,
                                            personName,
                                            groupNum,
                                            updatedAssignments,
                                            globalNormalRotationPosition,
                                            simulatedSpecialAssignments,
                                            simulatedWeekendAssignments,
                                            simulatedSemiAssignments,
                                            { allowConsecutiveConflicts: true }
                                        );
                                        // #region agent log
                                        const _logOk = {location:'tryTargetKey:okReturning',message:'canAssignPersonToNormalDay result',data:{candidateKey,personName,okReturning},hypothesisId:'H3,H4'};
                                        // Debug ingest disabled to avoid ERR_CONNECTION_REFUSED when local server not running
                                        console.log('[DEBUG returnFromMissing]', _logOk);
                                        // #endregion
                                        if (!okReturning) return false;
                                        const groupPeople = (groups?.[groupNum]?.normal || []);
                                        const chainOk = canShiftInsertFromDate(
                                            sortedNormal,
                                            candidateKey,
                                            groupNum,
                                            personName,
                                            groupPeople,
                                            updatedAssignments,
                                            globalNormalRotationPosition,
                                            simulatedSpecialAssignments,
                                            simulatedWeekendAssignments,
                                            simulatedSemiAssignments
                                        );
                                        // #region agent log
                                        const _logCh = {location:'tryTargetKey:chainOk',message:'canShiftInsertFromDate result',data:{candidateKey,personName,chainOk:chainOk.ok,reason:chainOk.reason||null,dateKey:chainOk.dateKey||null,person:chainOk.person||null},hypothesisId:'H3'};
                                        // Debug ingest disabled to avoid ERR_CONNECTION_REFUSED when local server not running
                                        console.log('[DEBUG returnFromMissing]', _logCh);
                                        // #endregion
                                        return chainOk.ok;
                                    };

                                    let targetKey = null;
                                    let isBackwardAssignment = false;

                                    // 1) Forward in same month: only when return is in calculated month (otherwise impossible).
                                    if (returnInCalcMonth && thirdNormalKey) {
                                        targetKey = findFirstMatchingTrackOnOrAfter(sortedNormal, thirdNormalKey, track);
                                        while (targetKey) {
                                            if (targetKey > sameMonthEndKey) break;
                                            if (tryTargetKey(targetKey)) break;
                                            const nextThreshold = addDaysToDateKey(targetKey, 1);
                                            targetKey = nextThreshold ? findFirstMatchingTrackOnOrAfter(sortedNormal, nextThreshold, track) : null;
                                        }
                                    }

                                    // 2) Backward swap in same month: use absence START (pStartKey) as reference – track days in calc month before pStartKey (latest first), avoiding the day before absence start.
                                    const dayBeforeStartKey = addDaysToDateKey(pStartKey, -1);
                                    if (!targetKey) {
                                        const backwardCandidates = [];
                                        for (const dk of sortedNormal) {
                                            if (dk < sameMonthStartKey || dk > sameMonthEndKey) continue;
                                            if (dk >= pStartKey) continue; // only before absence start
                                            if (dk === dayBeforeStartKey) continue; // avoid one day before missing start
                                            if (!trackMatches(dk, track)) continue;
                                            backwardCandidates.push(dk);
                                        }
                                        backwardCandidates.sort((a, b) => (b > a ? 1 : (a > b ? -1 : 0)));
                                        for (const candidate of backwardCandidates) {
                                            if (tryTargetKey(candidate)) {
                                                targetKey = candidate;
                                                isBackwardAssignment = true;
                                                break;
                                            }
                                        }
                                    }

                                    // 2b) Fallback: if still no slot (e.g. first person took the only backward candidate), try any track day in the month that is not yet used by another return-from-missing.
                                    if (!targetKey) {
                                        for (const dk of sortedNormal) {
                                            if (dk < sameMonthStartKey || dk > sameMonthEndKey) continue;
                                            if (!trackMatches(dk, track)) continue;
                                            if (tryTargetKey(dk)) {
                                                targetKey = dk;
                                                isBackwardAssignment = true;
                                                break;
                                            }
                                        }
                                    }

                                    // 3) If no slot in calculated month and return is next month: defer to next month calculation.
                                    if (!targetKey && returnKey > calcEndKey) {
                                        calculationSteps.deferredReturnFromMissing = calculationSteps.deferredReturnFromMissing || [];
                                        calculationSteps.deferredReturnFromMissing.push({ personName, groupNum, pEndKey, returnKey, track });
                                    }

                                    // #region agent log
                                    if (!targetKey) {
                                        const _logNt = {location:'returnFromMissing:noTarget',message:'no feasible targetKey after all phases',data:{groupNum,personName,returnKey,thirdNormalKey,sameMonthEndKey},hypothesisId:'H3'};
                                        // Debug ingest disabled to avoid ERR_CONNECTION_REFUSED when local server not running
                                        console.log('[DEBUG returnFromMissing]', _logNt);
                                    }
                                    // #endregion
                                    if (!targetKey) continue;

                                    // Apply shift insertion (follow rotation): everyone moves to the next normal day.
                                    const groupPeopleFinal = (groups?.[groupNum]?.normal || []);
                                    const ins = applyShiftInsertFromDate(sortedNormal, targetKey, groupNum, personName, groupPeopleFinal, updatedAssignments);
                                    // #region agent log
                                    const _logAp = {location:'returnFromMissing:apply',message:'applyShiftInsertFromDate result',data:{groupNum,personName,targetKey,insOk:ins.ok},hypothesisId:'H5'};
                                    // Debug ingest disabled to avoid ERR_CONNECTION_REFUSED when local server not running
                                    console.log('[DEBUG returnFromMissing]', _logAp);
                                    // #endregion
                                    if (!ins.ok) continue;
                                    usedReturnFromMissingTargets.add(`${targetKey}:${groupNum}`);

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

                                    const formatDDMMYYYY = (dateKey) => {
                                        const d = dateKeyToDate(dateKey);
                                        return (d.getDate() < 10 ? '0' : '') + d.getDate() + '/' + ((d.getMonth() + 1) < 10 ? '0' : '') + (d.getMonth() + 1) + '/' + d.getFullYear();
                                    };
                                    const missingRangeStr = formatDDMMYYYY(pStartKey) + ' - ' + formatDDMMYYYY(pEndKey);
                                    const reasonOfMissing = (period?.reason || '').trim() || '(δεν αναφέρεται λόγος)';
                                    const assignmentReasonText = `Τοποθετήθηκε σε υπηρεσία γιατί θα απουσιάζει (${missingRangeStr}) λόγω ${reasonOfMissing}`;
                                    storeAssignmentReason(
                                        targetKey,
                                        groupNum,
                                        personName,
                                        'skip',
                                        assignmentReasonText,
                                        ins.originalAtTarget || null,
                                        null,
                                        { returnFromMissing: true, insertedByShift: true, missingEnd: pEndKey, isBackwardAssignment }
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
                            
                            // Get calculation range dates for validation
                            const calcStartDateRaw = calculationSteps.startDate || null;
                            const calcEndDateRaw = calculationSteps.endDate || null;
                            const calcStartDate = (calcStartDateRaw instanceof Date) ? calcStartDateRaw : (calcStartDateRaw ? new Date(calcStartDateRaw) : null);
                            const calcEndDate = (calcEndDateRaw instanceof Date) ? calcEndDateRaw : (calcEndDateRaw ? new Date(calcEndDateRaw) : null);
                            
                            console.log(`[SWAP LOGIC] Starting swap logic for ${currentPerson} on ${dateKey} (Group ${groupNum}, Day: ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]})`);
                            
                            // Helper: try a backward candidate date (same month, before date). Uses saved assignments if candidateKey not in updatedAssignments. Returns { swapCandidate, candidateKey } or null.
                            const tryBackwardSwapCandidate = (candidateKey) => {
                                const d = new Date(candidateKey + 'T00:00:00');
                                if (isNaN(d.getTime()) || d >= date || d.getMonth() !== month || d.getFullYear() !== year) return null;
                                if (getDayType(d) !== 'normal-day') return null;
                                let swapCandidate = updatedAssignments[candidateKey]?.[groupNum];
                                if (!swapCandidate && typeof getAssignmentForDate === 'function') {
                                    const raw = getAssignmentForDate(candidateKey);
                                    swapCandidate = raw && typeof parseAssignedPersonForGroupFromAssignment === 'function'
                                        ? parseAssignedPersonForGroupFromAssignment(raw, groupNum) : null;
                                }
                                if (!swapCandidate) return null;
                                if (isPersonMissingOnDate(swapCandidate, groupNum, d, 'normal')) return null;
                                if (hasConsecutiveDuty(candidateKey, swapCandidate, groupNum, simulatedAssignments)) return null;
                                if (hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) return null;
                                if (!updatedAssignments[candidateKey]) {
                                    const raw = typeof getAssignmentForDate === 'function' ? getAssignmentForDate(candidateKey) : null;
                                    updatedAssignments[candidateKey] = raw && typeof extractGroupAssignmentsMap === 'function' ? extractGroupAssignmentsMap(raw) : {};
                                }
                                return { swapCandidate, candidateKey };
                            };
                            
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
                                let step2FailedNextMonth = false;
                                if (!swapFound) {
                                    console.log(`[SWAP LOGIC] MONDAY/WEDNESDAY - Step 2: Trying same day of week (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]}) in same month`);
                                    const nextSameDay = new Date(year, month, date.getDate() + 7);
                                    if (nextSameDay.getMonth() === month) {
                                        const nextSameDayKey = formatDateKey(nextSameDay);
                                        if (updatedAssignments[nextSameDayKey]?.[groupNum]) {
                                            const swapCandidate = updatedAssignments[nextSameDayKey][groupNum];
                                            console.log(`[SWAP LOGIC] Step 2: Found candidate ${swapCandidate} on ${nextSameDayKey}`);
                                            
                                            if (!isPersonMissingOnDate(swapCandidate, groupNum, nextSameDay, 'normal') &&
                                                !hasConsecutiveDuty(nextSameDayKey, swapCandidate, groupNum, simulatedAssignments) &&
                                                !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
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
                                        step2FailedNextMonth = true;
                                        console.log(`[SWAP LOGIC] ✗ Step 2 FAILED: Next same day is in next month (will try backward swap before cross-month)`);
                                    }
                                }
                                
                                // MONDAY/WEDNESDAY - Step 2b: Try BACKWARD – previous alternative day (Mon ↔ Wed). Loop weeks back in same month; use saved assignments if date not in range.
                                if (!swapFound) {
                                    const firstAltOffset = dayOfWeek > alternativeDayOfWeek ? (dayOfWeek - alternativeDayOfWeek) : (7 + dayOfWeek - alternativeDayOfWeek);
                                    console.log(`[SWAP LOGIC] MONDAY/WEDNESDAY - Step 2b: Trying BACKWARD previous/nearest alternative day (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][alternativeDayOfWeek]}) in SAME MONTH (offsets ${firstAltOffset}, ${firstAltOffset + 7}, ...)`);
                                    for (let offset = firstAltOffset; offset <= 28; offset += 7) {
                                        const prevAltDay = new Date(date);
                                        prevAltDay.setDate(date.getDate() - offset);
                                        if (prevAltDay.getMonth() !== month || prevAltDay.getFullYear() !== year) break;
                                        const prevAltKey = formatDateKey(prevAltDay);
                                        const result = tryBackwardSwapCandidate(prevAltKey);
                                        if (result) {
                                            swapDayKey = result.candidateKey;
                                            swapDayIndex = normalDays.indexOf(swapDayKey);
                                            if (swapDayIndex < 0) swapDayIndex = -1;
                                            swapFound = true;
                                            console.log(`[SWAP LOGIC] ✓ Step 2b SUCCESS: Swapping ${currentPerson} with ${result.swapCandidate} (${dateKey} ↔ ${swapDayKey})`);
                                            break;
                                        }
                                    }
                                }
                                // MONDAY/WEDNESDAY - Step 2c: Try BACKWARD – previous same day (Mon or Wed). Loop 7, 14, 21... days back; use saved assignments if date not in range.
                                if (!swapFound) {
                                    console.log(`[SWAP LOGIC] MONDAY/WEDNESDAY - Step 2c: Trying BACKWARD previous same day (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]}) in SAME MONTH (loop 7, 14, 21... days back)`);
                                    for (let offset = 7; offset <= 28; offset += 7) {
                                        const prevSameDay = new Date(date);
                                        prevSameDay.setDate(date.getDate() - offset);
                                        if (prevSameDay.getMonth() !== month || prevSameDay.getFullYear() !== year) break;
                                        const prevSameDayKey = formatDateKey(prevSameDay);
                                        const result = tryBackwardSwapCandidate(prevSameDayKey);
                                        if (result) {
                                            swapDayKey = result.candidateKey;
                                            swapDayIndex = normalDays.indexOf(swapDayKey);
                                            if (swapDayIndex < 0) swapDayIndex = -1;
                                            swapFound = true;
                                            console.log(`[SWAP LOGIC] ✓ Step 2c SUCCESS: Swapping ${currentPerson} with ${result.swapCandidate} (${dateKey} ↔ ${swapDayKey})`);
                                            break;
                                        }
                                    }
                                }
                                
                                // MONDAY/WEDNESDAY - Step 3: ONLY if Step 2c failed, try alternative day in week after next OR next month
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
                                    console.log(`[SWAP LOGIC] Step 1a: Found candidate ${swapCandidate} on ${nextSameDayKey} (in calculation range)`);
                                    
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
                                        if (!isPersonMissingOnDate(swapCandidate, groupNum, nextSameDay, 'normal') &&
                                            !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                            swapDayKey = nextSameDayKey;
                                            swapDayIndex = normalDays.indexOf(nextSameDayKey);
                                            swapFound = true;
                                            console.log(`[SWAP LOGIC] ✓ Step 1a SUCCESS: Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${nextSameDayKey})`);
                                        } else {
                                            console.log(`[SWAP LOGIC] ✗ Step 1a FAILED: Candidate ${swapCandidate} has conflict or is missing`);
                                        }
                                    }
                                } else if (nextSameDay.getMonth() !== month) {
                                    // Next same day is in next month - DON'T try cross-month yet!
                                    // Instead, mark that forward swap failed and we'll try backward swaps first
                                    console.log(`[SWAP LOGIC] Step 1a: Next same day is in NEXT MONTH - will try backward swaps first before cross-month`);
                                } else {
                                    console.log(`[SWAP LOGIC] ✗ Step 1a FAILED: Next same day ${nextSameDayKey} not in normalDays or no assignment found`);
                                }
                                
                                // TUESDAY/THURSDAY - Step 1b: Try BACKWARD – previous same day (Thu or Tue), then previous/nearest alternative. Loop weeks back in same month; use saved assignments if date not in range.
                                if (!swapFound) {
                                    console.log(`[SWAP LOGIC] TUESDAY/THURSDAY - Step 1b: Trying BACKWARD previous same day (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]}) in SAME MONTH (loop 7, 14, 21... days back)`);
                                    for (let offset = 7; offset <= 28; offset += 7) {
                                        const prevSameDay = new Date(date);
                                        prevSameDay.setDate(date.getDate() - offset);
                                        if (prevSameDay.getMonth() !== month || prevSameDay.getFullYear() !== year) break;
                                        const prevSameDayKey = formatDateKey(prevSameDay);
                                        const result = tryBackwardSwapCandidate(prevSameDayKey);
                                        if (result) {
                                            swapDayKey = result.candidateKey;
                                            swapDayIndex = normalDays.indexOf(swapDayKey);
                                            if (swapDayIndex < 0) swapDayIndex = -1;
                                            swapFound = true;
                                            console.log(`[SWAP LOGIC] ✓ Step 1b SUCCESS: Swapping ${currentPerson} with ${result.swapCandidate} (${dateKey} ↔ ${swapDayKey}) (${offset} days back)`);
                                            break;
                                        }
                                    }
                                }
                                // TUESDAY/THURSDAY - Step 1b-alt: If previous same day failed, try previous/nearest alternative day (Tue ↔ Thu) in same month
                                if (!swapFound) {
                                    const firstAltOffset = dayOfWeek > alternativeDayOfWeek ? (dayOfWeek - alternativeDayOfWeek) : (7 + dayOfWeek - alternativeDayOfWeek);
                                    console.log(`[SWAP LOGIC] TUESDAY/THURSDAY - Step 1b-alt: Trying BACKWARD previous/nearest alternative day (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][alternativeDayOfWeek]}) in SAME MONTH (offsets ${firstAltOffset}, ${firstAltOffset + 7}, ...)`);
                                    for (let offset = firstAltOffset; offset <= 28; offset += 7) {
                                        const prevAltDay = new Date(date);
                                        prevAltDay.setDate(date.getDate() - offset);
                                        if (prevAltDay.getMonth() !== month || prevAltDay.getFullYear() !== year) break;
                                        const prevAltKey = formatDateKey(prevAltDay);
                                        const result = tryBackwardSwapCandidate(prevAltKey);
                                        if (result) {
                                            swapDayKey = result.candidateKey;
                                            swapDayIndex = normalDays.indexOf(swapDayKey);
                                            if (swapDayIndex < 0) swapDayIndex = -1;
                                            swapFound = true;
                                            console.log(`[SWAP LOGIC] ✓ Step 1b-alt SUCCESS: Swapping ${currentPerson} with ${result.swapCandidate} (${dateKey} ↔ ${swapDayKey})`);
                                            break;
                                        }
                                    }
                                }
                                
                                // TUESDAY/THURSDAY - Step 2: ONLY if Step 1 failed, try alternative day in same week
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
                                        console.log(`[SWAP LOGIC] ✗ Step 3 FAILED: Next alternative day is in next month (will try backward swap first)`);
                                    }
                                }
                                
                                // TUESDAY/THURSDAY - Step 3a: ONLY if Step 3 failed, try BACKWARD swap with previous alternative day in SAME MONTH
                                // IMPORTANT: This runs BEFORE any cross-month attempts to keep swaps within current month when possible
                                if (!swapFound) {
                                    console.log(`[SWAP LOGIC] TUESDAY/THURSDAY - Step 3a: Trying BACKWARD swap with previous alternative day (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][alternativeDayOfWeek]}) in SAME MONTH`);
                                    // Calculate days to go back to previous alternative day
                                    // For Tuesday (2) -> Thursday (4): go back 5 days (to previous week's Thursday)
                                    // For Thursday (4) -> Tuesday (2): go back 2 days (to same week's Tuesday)
                                    const prevAlternativeDay = new Date(date);
                                    const daysToSubtract = dayOfWeek - alternativeDayOfWeek;
                                    if (daysToSubtract > 0) {
                                        // Same week: e.g., Thursday (4) -> Tuesday (2) = 2 days back
                                        prevAlternativeDay.setDate(date.getDate() - daysToSubtract);
                                    } else {
                                        // Previous week: e.g., Tuesday (2) -> Thursday (4) = 5 days back (7 - 2)
                                        prevAlternativeDay.setDate(date.getDate() - (7 + daysToSubtract));
                                    }
                                    
                                    // CRITICAL: Only allow backward swap if it's in the SAME MONTH
                                    const prevAlternativeKey = formatDateKey(prevAlternativeDay);
                                    console.log(`[SWAP LOGIC] Step 3a: Checking backward swap date ${prevAlternativeKey} (calculated from ${dateKey}, current month: ${month})`);
                                    
                                    if (prevAlternativeDay < date &&
                                        prevAlternativeDay.getMonth() === month && // MUST be in same month
                                        prevAlternativeDay.getFullYear() === year && // MUST be in same year
                                        normalDays.includes(prevAlternativeKey)) {
                                        const prevAlternativeType = getDayType(prevAlternativeDay);
                                        const swapCandidate = updatedAssignments[prevAlternativeKey]?.[groupNum];
                                        
                                        if (prevAlternativeType === 'normal-day' && swapCandidate) {
                                            console.log(`[SWAP LOGIC] Step 3a: Found candidate ${swapCandidate} on ${prevAlternativeKey} (previous alternative day, current assignment)`);
                                            
                                            if (!isPersonMissingOnDate(swapCandidate, groupNum, prevAlternativeDay, 'normal') &&
                                                !hasConsecutiveDuty(prevAlternativeKey, swapCandidate, groupNum, simulatedAssignments) &&
                                                !hasConsecutiveDuty(dateKey, swapCandidate, groupNum, simulatedAssignments)) {
                                                swapDayKey = prevAlternativeKey;
                                                swapDayIndex = normalDays.indexOf(prevAlternativeKey);
                                                swapFound = true;
                                                console.log(`[SWAP LOGIC] ✓ Step 3a SUCCESS: Swapping ${currentPerson} with ${swapCandidate} (${dateKey} ↔ ${prevAlternativeKey})`);
                                            } else {
                                                console.log(`[SWAP LOGIC] ✗ Step 3a FAILED: Candidate ${swapCandidate} has conflict or is missing`);
                                            }
                                        } else {
                                            console.log(`[SWAP LOGIC] ✗ Step 3a FAILED: No candidate found on ${prevAlternativeKey} or not a normal day (type: ${prevAlternativeType})`);
                                        }
                                    } else {
                                        const monthCheck = prevAlternativeDay.getMonth() === month ? 'OK' : `FAIL (different month: ${prevAlternativeDay.getMonth()} vs ${month})`;
                                        const yearCheck = prevAlternativeDay.getFullYear() === year ? 'OK' : `FAIL (different year: ${prevAlternativeDay.getFullYear()} vs ${year})`;
                                        console.log(`[SWAP LOGIC] ✗ Step 3a FAILED: Previous alternative day ${prevAlternativeKey} validation - Month: ${monthCheck}, Year: ${yearCheck}, In normalDays: ${normalDays.includes(prevAlternativeKey)}`);
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
                                
                                // Use the ACTUAL conflict neighbor day instead of the swap-execution day.
                                const conflictNeighborKey = getConsecutiveConflictNeighborDayKey(dateKey, currentPerson, groupNum, simulatedAssignments) || dateKey;

                                // Always perform a simple two-slot swap: conflicted person goes to swap date, swap candidate goes to conflicted date.
                                // (Previously a "backward shift" rotated the whole track and overwrote 24/02 and 26/02 with wrong assignments.)
                                updatedAssignments[dateKey][groupNum] = swapCandidate;
                                updatedAssignments[swapDayKey][groupNum] = currentPerson;
                                console.log('[SWAP SAVE DEBUG] After two-slot swap:', dateKey, 'Group', groupNum, '->', swapCandidate, '|', swapDayKey, '->', currentPerson, '| updatedAssignments sample:', { [dateKey]: updatedAssignments[dateKey]?.[groupNum], [swapDayKey]: updatedAssignments[swapDayKey]?.[groupNum] });
                                const isBackwardWithinMonth = false; // no track shift; swap only
                                const isCrossMonthSwap = dateKey.substring(0, 7) !== swapDayKey.substring(0, 7);
                                
                                // Store assignment reasons for BOTH people involved in the swap with swap pair ID
                                // Improved Greek reasons:
                                // Use the ACTUAL conflict neighbor day (e.g. Fri) instead of the swap-execution day (e.g. Thu).
                                const swapMeta = isCrossMonthSwap ? {
                                    isCrossMonth: true,
                                    originDayKey: dateKey,
                                    swapDayKey: swapDayKey,
                                    conflictDateKey: conflictNeighborKey
                                } : null;
                                // Only store classic "swap" reasons when we actually performed a swap.
                                // For backward shifts we already stored per-day "shift" reasons above.
                                if (!isBackwardWithinMonth) {
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
                                }
                                
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
                
                // Store final assignments (after swap logic) for saving when OK is pressed.
                // Use a deep copy so nothing can mutate the saved state before the user clicks OK.
                calculationSteps.finalNormalAssignments = JSON.parse(JSON.stringify(updatedAssignments));

                // CRITICAL for multi-month ranges:
                // The "executeCalculation()" flow persists assignments from calculationSteps.tempAssignments (or Firestore tempAssignments),
                // so ensure tempAssignments.normal reflects the FINAL normal schedule (including reinsertion + swaps).
                try {
                    if (!calculationSteps.tempAssignments || typeof calculationSteps.tempAssignments !== 'object') {
                        calculationSteps.tempAssignments = {
                            special: calculationSteps.tempAssignments?.special || calculationSteps.tempSpecialAssignments || {},
                            weekend: calculationSteps.tempAssignments?.weekend || calculationSteps.tempWeekendAssignments || {},
                            semi: calculationSteps.tempAssignments?.semi || calculationSteps.tempSemiAssignments || {},
                            normal: calculationSteps.finalNormalAssignments,
                            startDate: calculationSteps.startDate ? new Date(calculationSteps.startDate).toISOString() : null,
                            endDate: calculationSteps.endDate ? new Date(calculationSteps.endDate).toISOString() : null
                        };
                    } else {
                        calculationSteps.tempAssignments.normal = calculationSteps.finalNormalAssignments;
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
                
                // Show popup with results (will save when OK is pressed). Pass finalNormalAssignments so table and save use same frozen data.
                showNormalSwapResults(allSwappedPeople, calculationSteps.finalNormalAssignments);
            } catch (error) {
                console.error('[STEP 4] Error running normal swap logic:', error);
            }
        }
        function updateStep4TableWithFinalAssignments(finalAssignments) {
            const stepContent = document.getElementById('stepContent');
            if (!stepContent) return;
            const tableBody = stepContent.querySelector('tbody');
            if (!tableBody) return;
            const dayTypeLists = calculationSteps.dayTypeLists || { normal: [], semi: [], special: [], weekend: [] };
            const normalDays = dayTypeLists.normal || [];
            const sortedNormal = [...normalDays].sort();
            if (sortedNormal.length === 0) return;
            const baseline = calculationSteps.tempNormalBaselineAssignments || {};
            const startDate = calculationSteps.startDate;
            for (let normalIndex = 0; normalIndex < sortedNormal.length; normalIndex++) {
                const dateKey = sortedNormal[normalIndex];
                const row = tableBody.rows[normalIndex];
                if (!row || row.cells.length < 6) continue;
                const date = new Date(dateKey + 'T00:00:00');
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const groupData = groups?.[groupNum] || { normal: [] };
                    const groupPeople = groupData.normal || [];
                    const assignedPerson = finalAssignments?.[dateKey]?.[groupNum];
                    let daysCountInfo = '';
                    let lastDutyInfo = '';
                    if (assignedPerson && groupPeople.length) {
                        const daysSince = countDaysSinceLastDuty(dateKey, assignedPerson, groupNum, 'normal', dayTypeLists, startDate);
                        const dutyDates = getLastAndNextDutyDates(assignedPerson, groupNum, 'normal', groupPeople.length);
                        lastDutyInfo = dutyDates.lastDuty !== 'Δεν έχει' ? `<br><small class="text-muted">Τελευταία: ${dutyDates.lastDuty}</small>` : '';
                        if (daysSince !== null && daysSince !== Infinity) {
                            daysCountInfo = ` <span class="text-info">${daysSince}/${groupPeople.length} ημέρες</span>`;
                        } else if (daysSince === Infinity) {
                            daysCountInfo = ' <span class="text-success">πρώτη φορά</span>';
                        }
                    }
                    const baselinePerson = baseline?.[dateKey]?.[groupNum] || null;
                    const cellHtml = buildBaselineComputedCellHtml(baselinePerson, assignedPerson, daysCountInfo, lastDutyInfo);
                    const cellIndex = 1 + groupNum;
                    if (row.cells[cellIndex]) row.cells[cellIndex].innerHTML = cellHtml;
                }
            }
        }

        function showNormalSwapResults(swappedPeople, updatedAssignments) {
            updateStep4TableWithFinalAssignments(updatedAssignments);

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

                    // Never show a "change" row when the skipped person was disabled – we don't want disabled-skip as swap/replacement
                    if (isPersonDisabledForDuty(base, groupNum, 'normal')) continue;

                    const reasonObj = getAssignmentReason(dateKey, groupNum, comp) || null;
                    
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
                    let briefReason = reasonText
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

                    // When replacement is due to missing person (not disabled), show backward or forward assignment
                    const isMissingReinsertion = reasonObj?.meta?.returnFromMissing && reasonObj?.meta?.insertedByShift;
                    if (isMissingReinsertion && reasonObj.meta && 'isBackwardAssignment' in reasonObj.meta) {
                        briefReason += reasonObj.meta.isBackwardAssignment === true
                            ? ' (Προσαρμογή: προς τα πίσω)'
                            : ' (Προσαρμογή: προς τα εμπρός)';
                    }

                    const otherKey = reasonObj?.type === 'swap'
                        ? findSwapOtherDateKey(reasonObj.swapPairId, groupNum, dateKey)
                        : null;
                    const swapDateStr = otherKey
                        ? new Date(otherKey + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : '-';
                    // For swaps, "Skipped" must be the person who was actually swapped out of this date,
                    // i.e. the person now on the other date (swap partner). Baseline can be wrong due to rotation/return-from-missing.
                    const skippedPerson = (reasonObj?.type === 'swap' && otherKey && computedByDate?.[otherKey]?.[groupNum])
                        ? computedByDate[otherKey][groupNum]
                        : base;

                    rows.push({
                        dateKey,
                        dayName,
                        dateStr,
                        groupNum,
                        service: getGroupName(groupNum),
                        skipped: skippedPerson,
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
                        // Always save from the frozen final state (set right after swap logic) so nothing can overwrite it
                        const toSave = calculationSteps.finalNormalAssignments || updatedAssignments;
                        await saveFinalNormalAssignments(toSave);
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
                    // Debug: log what we're saving for swap-relevant dates (19 and 26 Feb 2026)
                    const d19 = updatedAssignments['2026-02-19'];
                    const d26 = updatedAssignments['2026-02-26'];
                    if (d19 || d26) {
                        console.log('[SAVE DEBUG] saveFinalNormalAssignments input for 2026-02-19:', d19, '2026-02-26:', d26);
                    }
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
                    if (formattedAssignments['2026-02-19'] || formattedAssignments['2026-02-26']) {
                        console.log('[SAVE DEBUG] formattedAssignments for 2026-02-19:', formattedAssignments['2026-02-19'], '2026-02-26:', formattedAssignments['2026-02-26']);
                    }
                    const organizedNormal = organizeAssignmentsByMonth(formattedAssignments);
                    const sanitizedNormal = sanitizeForFirestore(organizedNormal);
                    
                    await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'normalDayAssignments', organizedNormal);
                    console.log('Saved Step 4 final normal assignments (after swap logic) to normalDayAssignments document');
                    
                    // Update local memory
                    Object.assign(normalDayAssignments, formattedAssignments);
                    
                    // IMPORTANT: Update last normal rotation state from FINAL assignments (after return-from-missing and swap)
                    // so that next time we build the preview we start from the correct person and rotation stays consistent.
                    // When the person on a date got there by SWAP (conflict swap-in), use the SWAPPED-OUT person as "last"
                    // so next month we continue from the next person after the swapped-out person in rotation (still checking conflicts/missing/disabled).
                    const sortedDateKeys = Object.keys(updatedAssignments).sort();
                    const lastNormalRotationPositionsFromFinal = {};
                    const lastNormalRotationPositionsByMonthFromFinal = {};
                    for (const dateKey of sortedDateKeys) {
                        const d = new Date(dateKey + 'T00:00:00');
                        if (isNaN(d.getTime())) continue;
                        const monthKey = getMonthKeyFromDate(d);
                        const groups = updatedAssignments[dateKey];
                        if (!groups) continue;
                        for (let groupNum = 1; groupNum <= 4; groupNum++) {
                            const assignedPerson = groups[groupNum];
                            if (!assignedPerson) continue;
                            let personForRotation = assignedPerson;
                            const reason = getAssignmentReason(dateKey, groupNum, assignedPerson);
                            if (reason && reason.type === 'swap' && reason.swapPairId != null) {
                                const otherKey = findSwapOtherDateKey(reason.swapPairId, groupNum, dateKey);
                                const swappedOutPerson = otherKey ? (updatedAssignments[otherKey] || {})[groupNum] : null;
                                if (swappedOutPerson) {
                                    personForRotation = swappedOutPerson;
                                }
                            }
                            lastNormalRotationPositionsFromFinal[groupNum] = personForRotation;
                            if (!lastNormalRotationPositionsByMonthFromFinal[monthKey]) lastNormalRotationPositionsByMonthFromFinal[monthKey] = {};
                            lastNormalRotationPositionsByMonthFromFinal[monthKey][groupNum] = personForRotation;
                        }
                    }
                    if (Object.keys(lastNormalRotationPositionsFromFinal).length > 0) {
                        calculationSteps.lastNormalRotationPositions = lastNormalRotationPositionsFromFinal;
                    }
                    if (Object.keys(lastNormalRotationPositionsByMonthFromFinal).length > 0) {
                        calculationSteps.lastNormalRotationPositionsByMonth = lastNormalRotationPositionsByMonthFromFinal;
                        for (const monthKey in lastNormalRotationPositionsByMonthFromFinal) {
                            const groupsForMonth = lastNormalRotationPositionsByMonthFromFinal[monthKey] || {};
                            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                                if (groupsForMonth[groupNum] !== undefined) {
                                    setLastRotationPersonForMonth('normal', monthKey, groupNum, groupsForMonth[groupNum]);
                                }
                            }
                        }
                        try {
                            const sanitizedPositions = sanitizeForFirestore(lastRotationPositions);
                            await db.collection('dutyShifts').doc('lastRotationPositions').set({
                                ...sanitizedPositions,
                                lastUpdated: firebase.firestore.FieldValue.serverTimestamp(),
                                updatedBy: user.uid
                            });
                            console.log('Updated last rotation positions for normal (from final assignments after shift/swap) to Firestore');
                        } catch (err) {
                            console.error('Error saving lastRotationPositions after final normal save:', err);
                        }
                    }
                    
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
                
                // Track which people have been assigned to which days (to prevent nearby duplicate assignments)
                // Structure: monthKey -> { groupNum -> { personName -> dateKey } }
                // Only prevents duplicates if assigned within 5 days (too close)
                const assignedPeoplePreviewWeekend = {}; // monthKey -> { groupNum -> { personName -> dateKey } }
                // Track persons assigned via return-from-missing (backward/forward) so we don't assign them again when their turn comes
                const assignedByReturnFromMissingWeekend = {}; // groupNum -> Set of person names
                
                // Build baseline weekend (rotation-only) for return-from-missing check
                const baselineWeekendByDate = {};
                const baselineWeekendRotationPosition = {};
                for (const dk of sortedWeekends) {
                    const dt = new Date(dk + 'T00:00:00');
                    for (let g = 1; g <= 4; g++) {
                        const grp = groups[g] || { weekend: [] };
                        const people = grp.weekend || [];
                        if (people.length === 0) continue;
                        const rotLen = people.length;
                        if (baselineWeekendRotationPosition[g] === undefined) {
                            const isFeb2026 = calculationSteps.startDate && calculationSteps.startDate.getFullYear() === 2026 && calculationSteps.startDate.getMonth() === 1;
                            if (isFeb2026) baselineWeekendRotationPosition[g] = 0;
                            else {
                                const last = getLastRotationPersonForDate('weekend', dt, g);
                                const idx = people.indexOf(last);
                                if (last && idx >= 0) baselineWeekendRotationPosition[g] = (idx + 1) % rotLen;
                                else baselineWeekendRotationPosition[g] = getRotationPosition(dt, 'weekend', g) % rotLen;
                            }
                        }
                        const pos = baselineWeekendRotationPosition[g] % rotLen;
                        if (!baselineWeekendByDate[dk]) baselineWeekendByDate[dk] = {};
                        baselineWeekendByDate[dk][g] = people[pos];
                        baselineWeekendRotationPosition[g] = (pos + 1) % rotLen;
                    }
                }
                
                // Return-from-missing for weekend: first weekend on or after (period end + 3 calendar days), or backward to last weekend before period start
                const returnFromMissingWeekendTargets = {}; // dateKey -> { groupNum -> { personName, missingEnd, isBackwardAssignment } }
                const calcStartKeyW = (startDate && !isNaN(new Date(startDate).getTime())) ? formatDateKey(new Date(startDate)) : null;
                const calcEndKeyW = (endDate && !isNaN(new Date(endDate).getTime())) ? formatDateKey(new Date(endDate)) : null;
                const addDaysW = (dk, days) => {
                    if (!dk || typeof dk !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dk)) return null;
                    const d = new Date(dk + 'T00:00:00');
                    if (isNaN(d.getTime())) return null;
                    d.setDate(d.getDate() + (days || 0));
                    return formatDateKey(d);
                };
                const findFirstWeekendOnOrAfter = (sorted, thresholdKey) => {
                    for (const wk of sorted) {
                        if (wk >= thresholdKey) return wk;
                    }
                    return null;
                };
                const findLastWeekendBefore = (sorted, thresholdKey) => {
                    let lastWk = null;
                    for (const wk of sorted) {
                        if (wk >= thresholdKey) break;
                        lastWk = wk;
                    }
                    return lastWk;
                };
                const maxKeyW = (a, b) => (!a ? b : (!b ? a : (a > b ? a : b)));
                const minKeyW = (a, b) => (!a ? b : (!b ? a : (a < b ? a : b)));
                if (calcStartKeyW && calcEndKeyW && sortedWeekends.length > 0) {
                    const processedWeekendReturn = new Set();
                    const normW = (s) => (typeof normalizePersonKey === 'function' ? normalizePersonKey(s) : String(s || '').trim());
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        const g = groups[groupNum];
                        const missingMap = g?.missingPeriods || {};
                        const weekendList = g?.weekend || [];
                        for (const personName of Object.keys(missingMap)) {
                            if (!weekendList.some(p => normW(p) === normW(personName))) continue;
                            const periods = Array.isArray(missingMap[personName]) ? missingMap[personName] : [];
                            for (const period of periods) {
                                const pStartKey = inputValueToDateKey(period?.start);
                                const pEndKey = inputValueToDateKey(period?.end);
                                if (!pStartKey || !pEndKey) continue;
                                const pEndDate = new Date(pEndKey + 'T00:00:00');
                                const calcStartDateObj = calcStartKeyW ? new Date(calcStartKeyW + 'T00:00:00') : null;
                                const prevMonthStart = calcStartDateObj ? new Date(calcStartDateObj.getFullYear(), calcStartDateObj.getMonth() - 1, 1) : null;
                                const prevMonthStartKey = prevMonthStart ? formatDateKey(prevMonthStart) : null;
                                const prevMonthEnd = calcStartDateObj ? new Date(calcStartDateObj.getFullYear(), calcStartDateObj.getMonth(), 0) : null;
                                const prevMonthEndKey = prevMonthEnd ? formatDateKey(prevMonthEnd) : null;
                                const periodEndsInRange = (pEndKey >= calcStartKeyW && pEndKey <= calcEndKeyW);
                                const periodEndsInPrevMonth = (prevMonthStartKey && prevMonthEndKey && pEndKey >= prevMonthStartKey && pEndKey <= prevMonthEndKey);
                                if (!periodEndsInRange && !periodEndsInPrevMonth) continue;
                                const dedupeKey = `${groupNum}|${personName}|${pEndKey}`;
                                if (processedWeekendReturn.has(dedupeKey)) continue;
                                processedWeekendReturn.add(dedupeKey);
                                const scanStartKey = periodEndsInPrevMonth ? maxKeyW(prevMonthStartKey, pStartKey) : maxKeyW(calcStartKeyW, pStartKey);
                                const scanEndKey = periodEndsInPrevMonth ? pEndKey : minKeyW(pEndKey, calcEndKeyW);
                                if (!scanStartKey || !scanEndKey || scanStartKey > scanEndKey) continue;
                                let hadMissedWeekend = false;
                                if (periodEndsInRange) {
                                    for (const wk of sortedWeekends) {
                                        if (wk < scanStartKey) continue;
                                        if (wk > scanEndKey) break;
                                        const base = baselineWeekendByDate[wk]?.[groupNum];
                                        if (base && normW(base) === normW(personName)) {
                                            hadMissedWeekend = true;
                                            break;
                                        }
                                    }
                                } else {
                                    const periodStartDate = new Date(pStartKey + 'T00:00:00');
                                    const periodEndDate = new Date(pEndKey + 'T00:00:00');
                                    for (let checkDate = new Date(periodStartDate); checkDate <= periodEndDate; checkDate.setDate(checkDate.getDate() + 1)) {
                                        const checkDateKey = formatDateKey(checkDate);
                                        const dayType = getDayType(checkDate);
                                        if (dayType === 'weekend-holiday') {
                                            const rotationPos = getRotationPosition(checkDate, 'weekend', groupNum);
                                            const groupPeopleForCheck = g?.weekend || [];
                                            if (groupPeopleForCheck.length > 0) {
                                                const expectedPerson = groupPeopleForCheck[rotationPos % groupPeopleForCheck.length];
                                                if (expectedPerson && normW(expectedPerson) === normW(personName)) {
                                                    hadMissedWeekend = true;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                                if (!hadMissedWeekend) continue;
                                const dayAfterEnd = addDaysW(pEndKey, 1);
                                if (!dayAfterEnd) continue;
                                const thirdDayAfterEnd = addDaysW(pEndKey, 3);
                                if (!thirdDayAfterEnd) continue;
                                const returnMonthStart = new Date(pEndDate.getFullYear(), pEndDate.getMonth() + 1, 1);
                                const returnMonthStartKey = formatDateKey(returnMonthStart);
                                const returnMonthEnd = new Date(pEndDate.getFullYear(), pEndDate.getMonth() + 2, 0);
                                const returnMonthEndKey = formatDateKey(returnMonthEnd);
                                let hasWeekendInReturnMonth = false;
                                for (const wk of sortedWeekends) {
                                    if (wk >= returnMonthStartKey && wk <= returnMonthEndKey) {
                                        hasWeekendInReturnMonth = true;
                                        break;
                                    }
                                }
                                let targetWeekendKey = null;
                                let isBackwardAssignment = false;
                                if (hasWeekendInReturnMonth) {
                                    targetWeekendKey = findFirstWeekendOnOrAfter(sortedWeekends, thirdDayAfterEnd);
                                    if (targetWeekendKey && targetWeekendKey < returnMonthStartKey) {
                                        targetWeekendKey = findFirstWeekendOnOrAfter(sortedWeekends, returnMonthStartKey);
                                    }
                                }
                                if (!targetWeekendKey) {
                                    targetWeekendKey = findLastWeekendBefore(sortedWeekends, pStartKey);
                                    isBackwardAssignment = true;
                                }
                                if (!targetWeekendKey || targetWeekendKey < calcStartKeyW || targetWeekendKey > calcEndKeyW) continue;
                                // If this (date, group) is already taken by another return-from-missing, use next free weekend in range
                                let weekendIdx = sortedWeekends.indexOf(targetWeekendKey);
                                if (returnFromMissingWeekendTargets[targetWeekendKey]?.[groupNum]) {
                                    for (let i = weekendIdx + 1; i < sortedWeekends.length; i++) {
                                        const wk = sortedWeekends[i];
                                        if (wk < calcStartKeyW || wk > calcEndKeyW) break;
                                        if (!returnFromMissingWeekendTargets[wk]?.[groupNum]) { targetWeekendKey = wk; break; }
                                    }
                                    if (returnFromMissingWeekendTargets[targetWeekendKey]?.[groupNum]) {
                                        for (let i = weekendIdx - 1; i >= 0; i--) {
                                            const wk = sortedWeekends[i];
                                            if (wk < calcStartKeyW || wk > calcEndKeyW) continue;
                                            if (!returnFromMissingWeekendTargets[wk]?.[groupNum]) { targetWeekendKey = wk; break; }
                                        }
                                    }
                                }
                                if (returnFromMissingWeekendTargets[targetWeekendKey]?.[groupNum]) continue;
                                const formatDDMMYYYYW = (dk) => {
                                    const d = new Date(dk + 'T00:00:00');
                                    return (d.getDate() < 10 ? '0' : '') + d.getDate() + '/' + ((d.getMonth() + 1) < 10 ? '0' : '') + (d.getMonth() + 1) + '/' + d.getFullYear();
                                };
                                const missingRangeStrW = formatDDMMYYYYW(pStartKey) + ' - ' + formatDDMMYYYYW(pEndKey);
                                const reasonOfMissingW = (period?.reason || '').trim() || '(δεν αναφέρεται λόγος)';
                                if (!returnFromMissingWeekendTargets[targetWeekendKey]) returnFromMissingWeekendTargets[targetWeekendKey] = {};
                                returnFromMissingWeekendTargets[targetWeekendKey][groupNum] = { personName, missingEnd: pEndKey, isBackwardAssignment, missingRangeStr: missingRangeStrW, reasonOfMissing: reasonOfMissingW };
                            }
                        }
                    }
                }
                
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
                            // Return-from-missing: assign person to weekend after/before return (match by normalized name)
                            const designatedWeekend = returnFromMissingWeekendTargets[dateKey]?.[groupNum];
                            const normWeekend = (s) => (typeof normalizePersonKey === 'function' ? normalizePersonKey(s) : String(s || '').trim());
                            const matchingPerson = designatedWeekend && groupPeople.find(p => normWeekend(p) === normWeekend(designatedWeekend.personName));
                            if (designatedWeekend && matchingPerson && !isPersonMissingOnDate(matchingPerson, groupNum, date, 'weekend')) {
                                const assignedPerson = matchingPerson;
                                if (!assignedByReturnFromMissingWeekend[groupNum]) assignedByReturnFromMissingWeekend[groupNum] = new Set();
                                assignedByReturnFromMissingWeekend[groupNum].add(assignedPerson);
                                // Next slot goes to the displaced (baseline) person – set position to displaced person's index so we get F, A, B, C
                                const displacedPerson = baselineWeekendByDate[dateKey]?.[groupNum];
                                const originalIndex = displacedPerson != null ? groupPeople.indexOf(displacedPerson) : -1;
                                if (globalWeekendRotationPosition[groupNum] === undefined) globalWeekendRotationPosition[groupNum] = 0;
                                globalWeekendRotationPosition[groupNum] = (originalIndex >= 0 ? originalIndex : (groupPeople.indexOf(assignedPerson) + 1)) % groupPeople.length;
                                const reasonText = `Τοποθετήθηκε σε υπηρεσία γιατί θα απουσιάζει (${designatedWeekend.missingRangeStr || ''}) λόγω ${designatedWeekend.reasonOfMissing || '(δεν αναφέρεται λόγος)'}`;
                                storeAssignmentReason(dateKey, groupNum, assignedPerson, 'skip', reasonText, null, null, { returnFromMissing: true, insertedByShift: true, missingEnd: designatedWeekend.missingEnd, isBackwardAssignment: designatedWeekend.isBackwardAssignment });
                                if (!weekendRotationPersons[dateKey]) weekendRotationPersons[dateKey] = {};
                                weekendRotationPersons[dateKey][groupNum] = assignedPerson;
                                if (!assignedPeoplePreviewWeekend[monthKey][groupNum]) assignedPeoplePreviewWeekend[monthKey][groupNum] = {};
                                assignedPeoplePreviewWeekend[monthKey][groupNum][assignedPerson] = dateKey;
                                if (!simulatedWeekendAssignments[dateKey]) simulatedWeekendAssignments[dateKey] = {};
                                simulatedWeekendAssignments[dateKey][groupNum] = assignedPerson;
                                const lastDutyInfo = ''; const daysCountInfo = '';
                                html += `<td>${buildBaselineComputedCellHtml(assignedPerson, assignedPerson, daysCountInfo, lastDutyInfo)}</td>`;
                                continue;
                            }
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
                            let wasReplaced = false;
                            let replacementIndex = null;
                            
                            // Already assigned via return-from-missing (backward/forward): skip when their turn comes – they already had their duty
                            const wasAssignedByReturnFromMissingWeekend = rotationPerson && assignedByReturnFromMissingWeekend[groupNum]?.has(rotationPerson);
                            if (wasAssignedByReturnFromMissingWeekend) {
                                if (!assignedPeoplePreviewWeekend[monthKey][groupNum]) assignedPeoplePreviewWeekend[monthKey][groupNum] = {};
                                let foundEligible = false;
                                for (let offset = 1; offset <= rotationDays * 2 && !foundEligible; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (assignedByReturnFromMissingWeekend[groupNum]?.has(candidate)) continue;
                                    if (isPersonDisabledForDuty(candidate, groupNum, 'weekend')) continue;
                                    if (isPersonMissingOnDate(candidate, groupNum, date, 'weekend')) continue;
                                    if (assignedPeoplePreviewWeekend[monthKey][groupNum][candidate]) {
                                        const lastAssignmentDateKey = assignedPeoplePreviewWeekend[monthKey][groupNum][candidate];
                                        const lastDate = new Date(lastAssignmentDateKey + 'T00:00:00');
                                        const currentDate = new Date(dateKey + 'T00:00:00');
                                        const daysDiff = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
                                        if (daysDiff <= 5 && daysDiff > 0) continue;
                                    }
                                    assignedPerson = candidate;
                                    replacementIndex = idx;
                                    wasReplaced = true;
                                    foundEligible = true;
                                    weekendRotationPersons[dateKey][groupNum] = candidate;
                                    globalWeekendRotationPosition[groupNum] = (idx + 1) % rotationDays;
                                    break;
                                }
                                if (!foundEligible) assignedPerson = null;
                            }
                            // DISABLED: When rotation person is disabled, whole baseline shifts – skip them, no replacement line.
                            const isRotationPersonDisabledWeekend = !wasAssignedByReturnFromMissingWeekend && rotationPerson && isPersonDisabledForDuty(rotationPerson, groupNum, 'weekend');
                            if (isRotationPersonDisabledWeekend) {
                                if (!assignedPeoplePreviewWeekend[monthKey][groupNum]) {
                                    assignedPeoplePreviewWeekend[monthKey][groupNum] = {};
                                }
                                let foundEligible = false;
                                for (let offset = 1; offset <= rotationDays * 2 && !foundEligible; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (isPersonDisabledForDuty(candidate, groupNum, 'weekend')) continue;
                                    if (isPersonMissingOnDate(candidate, groupNum, date, 'weekend')) continue;
                                    if (assignedPeoplePreviewWeekend[monthKey][groupNum][candidate]) {
                                        const lastAssignmentDateKey = assignedPeoplePreviewWeekend[monthKey][groupNum][candidate];
                                        const lastDate = new Date(lastAssignmentDateKey + 'T00:00:00');
                                        const currentDate = new Date(dateKey + 'T00:00:00');
                                        const daysDiff = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
                                        if (daysDiff <= 5 && daysDiff > 0) continue;
                                    }
                                    assignedPerson = candidate;
                                    replacementIndex = idx;
                                    wasReplaced = true;
                                    foundEligible = true;
                                    weekendRotationPersons[dateKey][groupNum] = candidate;
                                    break;
                                }
                                if (!foundEligible) assignedPerson = null;
                            }
                            // MISSING (not disabled): show replacement and store reason.
                            if (!isRotationPersonDisabledWeekend && assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date, 'weekend')) {
                                if (!assignedPeoplePreviewWeekend[monthKey][groupNum]) {
                                    assignedPeoplePreviewWeekend[monthKey][groupNum] = {};
                                }
                                let foundReplacement = false;
                                for (let offset = 1; offset <= rotationDays * 2 && !foundReplacement; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (isPersonMissingOnDate(candidate, groupNum, date, 'weekend')) continue;
                                    if (assignedPeoplePreviewWeekend[monthKey][groupNum] && assignedPeoplePreviewWeekend[monthKey][groupNum][candidate]) {
                                        const lastAssignmentDateKey = assignedPeoplePreviewWeekend[monthKey][groupNum][candidate];
                                        const lastDate = new Date(lastAssignmentDateKey + 'T00:00:00');
                                        const currentDate = new Date(dateKey + 'T00:00:00');
                                        const daysDiff = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
                                        if (daysDiff <= 5 && daysDiff > 0) continue;
                                    }
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
                                if (!foundReplacement) assignedPerson = null;
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
                                
                                // Track that this person has been assigned (to prevent nearby duplicate assignments)
                                if (assignedPeoplePreviewWeekend[monthKey] && assignedPeoplePreviewWeekend[monthKey][groupNum]) {
                                    assignedPeoplePreviewWeekend[monthKey][groupNum][assignedPerson] = dateKey;
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
                            
                            // Use stored baseline (weekendRotationPersons) so when rotation person was disabled we show replacement only, not "Βασική Σειρά: disabled" + "Αντικατάσταση"
                            const baselinePersonForDisplay = weekendRotationPersons[dateKey]?.[groupNum] ?? rotationPerson;
                            html += `<td>${buildBaselineComputedCellHtml(baselinePersonForDisplay, displayPerson, daysCountInfo, lastDutyInfo)}</td>`;
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
        async function renderStep3_SemiNormal() {
            const stepContent = document.getElementById('stepContent');
            const startDate = calculationSteps.startDate;
            const endDate = calculationSteps.endDate;
            const dayTypeLists = calculationSteps.dayTypeLists || { semi: [], special: [], weekend: [] };
            const semiNormalDays = dayTypeLists.semi || [];
            const specialHolidays = dayTypeLists.special || [];
            const weekendHolidays = dayTypeLists.weekend || [];

            stepContent.innerHTML = '<div class="alert alert-info"><i class="fas fa-spinner fa-spin me-2"></i>Υπολογισμός ημιαργιών...</div>';

            // Load weekend assignments (Step 2 result)
            const simulatedWeekendAssignments = {}; // dateKey -> { groupNum -> person }
            const finalWeekend = calculationSteps.finalWeekendAssignments || {};
            for (const dateKey of Object.keys(finalWeekend)) {
                const g = finalWeekend[dateKey];
                if (g && typeof g === 'object') simulatedWeekendAssignments[dateKey] = { ...g };
            }
            for (const dateKey of [...(weekendHolidays || [])].sort()) {
                if (simulatedWeekendAssignments[dateKey]) continue;
                const a = weekendAssignments[dateKey];
                if (typeof a === 'string') {
                    a.split(',').map(p => p.trim()).forEach(part => {
                        const m = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)$/);
                        if (m) {
                            if (!simulatedWeekendAssignments[dateKey]) simulatedWeekendAssignments[dateKey] = {};
                            simulatedWeekendAssignments[dateKey][parseInt(m[2])] = m[1].trim();
                        }
                    });
                } else if (a && typeof a === 'object') {
                    simulatedWeekendAssignments[dateKey] = { ...a };
                }
            }

            // Load special holiday assignments (Step 1)
            const simulatedSpecialAssignments = {}; // monthKey -> { groupNum -> Set of person }
            (calculationSteps.tempSpecialAssignments && typeof calculationSteps.tempSpecialAssignments === 'object') && Object.keys(calculationSteps.tempSpecialAssignments).forEach(dateKey => {
                const date = new Date(dateKey + 'T00:00:00');
                if (isNaN(date.getTime())) return;
                const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
                if (!simulatedSpecialAssignments[monthKey]) simulatedSpecialAssignments[monthKey] = {};
                const gmap = calculationSteps.tempSpecialAssignments[dateKey];
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const p = gmap[groupNum];
                    if (!p) continue;
                    if (!simulatedSpecialAssignments[monthKey][groupNum]) simulatedSpecialAssignments[monthKey][groupNum] = new Set();
                    simulatedSpecialAssignments[monthKey][groupNum].add(p);
                }
            });
            (specialHolidays || []).forEach(dateKey => {
                const date = new Date(dateKey + 'T00:00:00');
                if (isNaN(date.getTime())) return;
                const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
                if (!simulatedSpecialAssignments[monthKey]) simulatedSpecialAssignments[monthKey] = {};
                const gmap = extractGroupAssignmentsMap(specialHolidayAssignments?.[dateKey]);
                if (!gmap) return;
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const p = gmap[groupNum];
                    if (!p) continue;
                    if (!simulatedSpecialAssignments[monthKey][groupNum]) simulatedSpecialAssignments[monthKey][groupNum] = new Set();
                    simulatedSpecialAssignments[monthKey][groupNum].add(p);
                }
            });

            const sortedSemi = [...(semiNormalDays || [])].sort();
            if (sortedSemi.length === 0) {
                stepContent.innerHTML = '<div class="step-content"><h6 class="mb-3">Ημιαργίες</h6><div class="alert alert-info">Δεν υπάρχουν ημιαργίες στην επιλεγμένη περίοδο.</div></div>';
                return;
            }

            // Precompute per-dateKey metadata and month indices (avoid repeated Date/getDayType/filter in loops)
            const semiMeta = {}; // dateKey -> { date, monthKey, keyBefore, keyAfter, typeBefore, typeAfter, monthKeyBefore, monthKeyAfter, dateStr, dayName }
            const monthKeyToIndices = {}; // monthKey -> number[] (indices in sortedSemi)
            for (let idx = 0; idx < sortedSemi.length; idx++) {
                const dateKey = sortedSemi[idx];
                const date = new Date(dateKey + 'T00:00:00');
                if (isNaN(date.getTime())) continue;
                const monthKey = getMonthKeyFromDate(date);
                const dayBefore = new Date(date);
                dayBefore.setDate(dayBefore.getDate() - 1);
                const dayAfter = new Date(date);
                dayAfter.setDate(dayAfter.getDate() + 1);
                const keyBefore = formatDateKey(dayBefore);
                const keyAfter = formatDateKey(dayAfter);
                if (!monthKeyToIndices[monthKey]) monthKeyToIndices[monthKey] = [];
                monthKeyToIndices[monthKey].push(idx);
                semiMeta[dateKey] = {
                    date,
                    monthKey,
                    keyBefore,
                    keyAfter,
                    typeBefore: getDayType(dayBefore),
                    typeAfter: getDayType(dayAfter),
                    monthKeyBefore: `${dayBefore.getFullYear()}-${dayBefore.getMonth()}`,
                    monthKeyAfter: `${dayAfter.getFullYear()}-${dayAfter.getMonth()}`,
                    dateStr: date.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                    dayName: getGreekDayName(date)
                };
            }

            // Rotation-only baseline (who would be assigned by rotation, no skip) – for return-from-missing displaced person
            const baselineSemiByDate = {};
            const baselineSemiRotationPosition = {};
            for (const dk of sortedSemi) {
                const dt = new Date(dk + 'T00:00:00');
                if (isNaN(dt.getTime())) continue;
                for (let g = 1; g <= 4; g++) {
                    const grp = groups[g] || { semi: [] };
                    const people = grp.semi || [];
                    if (people.length === 0) continue;
                    const rotLen = people.length;
                    if (baselineSemiRotationPosition[g] === undefined) {
                        const isFeb2026 = startDate && startDate.getFullYear() === 2026 && startDate.getMonth() === 1;
                        if (isFeb2026) baselineSemiRotationPosition[g] = 0;
                        else {
                            const last = getLastRotationPersonForDate('semi', dt, g);
                            const idx = people.indexOf(last);
                            baselineSemiRotationPosition[g] = (last && idx >= 0) ? (idx + 1) % rotLen : (getRotationPosition(dt, 'semi', g) % rotLen);
                        }
                    }
                    const pos = baselineSemiRotationPosition[g] % rotLen;
                    if (!baselineSemiByDate[dk]) baselineSemiByDate[dk] = {};
                    baselineSemiByDate[dk][g] = people[pos];
                    baselineSemiRotationPosition[g] = (pos + 1) % rotLen;
                }
            }

            const calcStartKey = (startDate && !isNaN(new Date(startDate).getTime())) ? formatDateKey(new Date(startDate)) : null;
            const calcEndKey = (endDate && !isNaN(new Date(endDate).getTime())) ? formatDateKey(new Date(endDate)) : null;
            const addDaysToDateKeyRun = (dk, days) => {
                if (!dk || typeof dk !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dk)) return null;
                const d = new Date(dk + 'T00:00:00');
                if (isNaN(d.getTime())) return null;
                d.setDate(d.getDate() + (days || 0));
                return formatDateKey(d);
            };
            const findFirstSemiOnOrAfterRun = (sorted, thresholdKey) => {
                for (const semiDk of sorted) { if (semiDk >= thresholdKey) return semiDk; }
                return null;
            };
            const findLastSemiBeforeRun = (sorted, thresholdKey) => {
                let lastSemi = null;
                for (const semiDk of sorted) {
                    if (semiDk >= thresholdKey) break;
                    lastSemi = semiDk;
                }
                return lastSemi;
            };
            const maxDateKeyRun = (a, b) => (!a ? b : (!b ? a : (a > b ? a : b)));
            const minDateKeyRun = (a, b) => (!a ? b : (!b ? a : (a < b ? a : b)));
            const normSemiRun = (s) => (typeof normalizePersonKey === 'function' ? normalizePersonKey(s) : String(s || '').trim());

            const returnFromMissingSemiTargetsRun = {};
            if (calcStartKey && calcEndKey && sortedSemi.length > 0) {
                const processedSemiReturnRun = new Set();
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const g = groups[groupNum];
                    const missingMap = g?.missingPeriods || {};
                    const semiList = g?.semi || [];
                    for (const personName of Object.keys(missingMap || {})) {
                        if (!semiList.some(p => normSemiRun(p) === normSemiRun(personName))) continue;
                        const periods = Array.isArray(missingMap[personName]) ? missingMap[personName] : [];
                        for (const period of periods) {
                            const pStartKey = inputValueToDateKey(period?.start);
                            const pEndKey = inputValueToDateKey(period?.end);
                            if (!pStartKey || !pEndKey) continue;
                            const pEndDate = new Date(pEndKey + 'T00:00:00');
                            const calcStartDateObj = calcStartKey ? new Date(calcStartKey + 'T00:00:00') : null;
                            const prevMonthStart = calcStartDateObj ? new Date(calcStartDateObj.getFullYear(), calcStartDateObj.getMonth() - 1, 1) : null;
                            const prevMonthStartKey = prevMonthStart ? formatDateKey(prevMonthStart) : null;
                            const prevMonthEnd = calcStartDateObj ? new Date(calcStartDateObj.getFullYear(), calcStartDateObj.getMonth(), 0) : null;
                            const prevMonthEndKey = prevMonthEnd ? formatDateKey(prevMonthEnd) : null;
                            const periodEndsInRange = (pEndKey >= calcStartKey && pEndKey <= calcEndKey);
                            const periodEndsInPrevMonth = (prevMonthStartKey && prevMonthEndKey && pEndKey >= prevMonthStartKey && pEndKey <= prevMonthEndKey);
                            if (!periodEndsInRange && !periodEndsInPrevMonth) continue;
                            const dedupeKey = `${groupNum}|${personName}|${pEndKey}`;
                            if (processedSemiReturnRun.has(dedupeKey)) continue;
                            processedSemiReturnRun.add(dedupeKey);
                            const monthStartKey = formatDateKey(new Date(pEndDate.getFullYear(), pEndDate.getMonth(), 1));
                            const scanStartKey = periodEndsInPrevMonth ? maxDateKeyRun(monthStartKey, pStartKey) : maxDateKeyRun(maxDateKeyRun(monthStartKey, pStartKey), calcStartKey);
                            const scanEndKey = periodEndsInPrevMonth ? pEndKey : minDateKeyRun(pEndKey, calcEndKey);
                            if (!scanStartKey || !scanEndKey || scanStartKey > scanEndKey) continue;
                            let hadMissedSemi = false;
                            if (periodEndsInRange) {
                                for (const dk of sortedSemi) {
                                    if (dk < scanStartKey) continue;
                                    if (dk > scanEndKey) break;
                                    const baseSemi = baselineSemiByDate[dk]?.[groupNum];
                                    if (baseSemi && normSemiRun(baseSemi) === normSemiRun(personName)) { hadMissedSemi = true; break; }
                                }
                            } else {
                                const periodStartDate = new Date(pStartKey + 'T00:00:00');
                                const periodEndDate = new Date(pEndKey + 'T00:00:00');
                                for (let checkDate = new Date(periodStartDate); checkDate <= periodEndDate; checkDate.setDate(checkDate.getDate() + 1)) {
                                    const checkDateKey = formatDateKey(checkDate);
                                    if (getDayType(checkDate) === 'semi-normal-day') {
                                        const rotationPos = getRotationPosition(checkDate, 'semi', groupNum);
                                        const groupPeopleForCheck = g?.semi || [];
                                        const expectedPerson = groupPeopleForCheck.length > 0 ? groupPeopleForCheck[rotationPos % groupPeopleForCheck.length] : null;
                                        if (expectedPerson && normSemiRun(expectedPerson) === normSemiRun(personName)) {
                                            hadMissedSemi = true;
                                            break;
                                        }
                                    }
                                }
                            }
                            if (!hadMissedSemi) continue;
                            // Forward: 3 consecutive days (any day) after return day, then assign to first appropriate semi-normal
                            const thirdDayAfterEnd = addDaysToDateKeyRun(pEndKey, 3);
                            if (!thirdDayAfterEnd) continue;
                            // Backward: avoid assigning one day before missing period starts
                            const dayBeforeStart = addDaysToDateKeyRun(pStartKey, -1);
                            let targetSemiKey = null;
                            // Prefer forward: first semi on or after (return day + 3)
                            const forwardTarget = findFirstSemiOnOrAfterRun(sortedSemi, thirdDayAfterEnd);
                            if (forwardTarget && forwardTarget >= calcStartKey && forwardTarget <= calcEndKey) {
                                targetSemiKey = forwardTarget;
                            } else {
                                // Backward: last semi before period start, but not the day before period start
                                let backwardCandidate = findLastSemiBeforeRun(sortedSemi, pStartKey);
                                if (backwardCandidate && dayBeforeStart && backwardCandidate === dayBeforeStart) {
                                    const idx = sortedSemi.indexOf(backwardCandidate);
                                    backwardCandidate = (idx > 0) ? sortedSemi[idx - 1] : null;
                                }
                                if (backwardCandidate && backwardCandidate >= calcStartKey && backwardCandidate <= calcEndKey) targetSemiKey = backwardCandidate;
                            }
                            if (!targetSemiKey || targetSemiKey < calcStartKey || targetSemiKey > calcEndKey) continue;
                            if (returnFromMissingSemiTargetsRun[targetSemiKey]?.[groupNum]) {
                                const semiIdx = sortedSemi.indexOf(targetSemiKey);
                                for (let i = semiIdx + 1; i < sortedSemi.length; i++) {
                                    const dk = sortedSemi[i];
                                    if (dk < calcStartKey || dk > calcEndKey) break;
                                    if (!returnFromMissingSemiTargetsRun[dk]?.[groupNum]) { targetSemiKey = dk; break; }
                                }
                                if (returnFromMissingSemiTargetsRun[targetSemiKey]?.[groupNum]) {
                                    for (let i = semiIdx - 1; i >= 0; i--) {
                                        const dk = sortedSemi[i];
                                        if (dk < calcStartKey || dk > calcEndKey) continue;
                                        if (!returnFromMissingSemiTargetsRun[dk]?.[groupNum]) { targetSemiKey = dk; break; }
                                    }
                                }
                            }
                            if (returnFromMissingSemiTargetsRun[targetSemiKey]?.[groupNum]) continue;
                            const formatDDMMYYYYSemiRun = (dk) => {
                                const d = new Date(dk + 'T00:00:00');
                                return (d.getDate() < 10 ? '0' : '') + d.getDate() + '/' + ((d.getMonth() + 1) < 10 ? '0' : '') + (d.getMonth() + 1) + '/' + d.getFullYear();
                            };
                            const missingRangeStrSemi = formatDDMMYYYYSemiRun(pStartKey) + ' - ' + formatDDMMYYYYSemiRun(pEndKey);
                            const reasonOfMissingSemi = (period?.reason || '').trim() || '(δεν αναφέρεται λόγος)';
                            if (!returnFromMissingSemiTargetsRun[targetSemiKey]) returnFromMissingSemiTargetsRun[targetSemiKey] = {};
                            returnFromMissingSemiTargetsRun[targetSemiKey][groupNum] = { personName, missingEnd: pEndKey, missingRangeStr: missingRangeStrSemi, reasonOfMissing: reasonOfMissingSemi };
                        }
                    }
                }
            }

            // 1) Build baseline by rotation order (per group); at return-from-missing targets place returning person and continue rotation from displaced
            const baseline = {}; // dateKey -> { groupNum -> person }
            const globalSemiPos = {}; // groupNum -> index (continues across semi days)
            for (const dateKey of sortedSemi) {
                const meta = semiMeta[dateKey];
                if (!meta) continue;
                const { date, monthKey } = meta;
                if (!baseline[dateKey]) baseline[dateKey] = {};
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const groupData = groups[groupNum] || { semi: [] };
                    const groupPeople = groupData.semi || [];
                    if (groupPeople.length === 0) continue;
                    const rotationDays = groupPeople.length;
                    const designated = returnFromMissingSemiTargetsRun[dateKey]?.[groupNum];
                    const designatedInList = designated && groupPeople.find(p => normSemiRun(p) === normSemiRun(designated.personName));
                    if (designated && designatedInList && !isPersonMissingOnDate(designated.personName, groupNum, date, 'semi')) {
                        baseline[dateKey][groupNum] = designatedInList;
                        const displacedPerson = baselineSemiByDate[dateKey]?.[groupNum];
                        const originalIndex = displacedPerson != null ? groupPeople.findIndex(p => normSemiRun(p) === normSemiRun(displacedPerson)) : -1;
                        const designatedIndex = groupPeople.findIndex(p => normSemiRun(p) === normSemiRun(designated.personName));
                        globalSemiPos[groupNum] = (originalIndex >= 0 ? originalIndex : (designatedIndex >= 0 ? designatedIndex + 1 : 0)) % rotationDays;
                        const semiReasonText = `Τοποθετήθηκε σε υπηρεσία γιατί θα απουσιάζει (${designated.missingRangeStr || ''}) λόγω ${designated.reasonOfMissing || '(δεν αναφέρεται λόγος)'}`;
                        storeAssignmentReason(dateKey, groupNum, designated.personName, 'skip', semiReasonText, null, null, { returnFromMissing: true, missingEnd: designated.missingEnd });
                        continue;
                    }
                    if (globalSemiPos[groupNum] === undefined) {
                        const isFeb2026 = startDate && startDate.getFullYear() === 2026 && startDate.getMonth() === 1;
                        if (isFeb2026) globalSemiPos[groupNum] = 0;
                        else {
                            const lastPerson = getLastRotationPersonForDate('semi', date, groupNum);
                            const idx = groupPeople.indexOf(lastPerson);
                            globalSemiPos[groupNum] = (lastPerson && idx >= 0) ? (idx + 1) % rotationDays : (getRotationPosition(date, 'semi', groupNum) % rotationDays);
                        }
                    }
                    const pos = globalSemiPos[groupNum] % rotationDays;
                    const person = groupPeople[pos];
                    let nextPos = (pos + 1) % rotationDays; // default: next slot goes to person after current pos
                    // DISABLED: When rotation person is disabled, whole baseline shifts – store eligible person, no replacement line.
                    if (person && isPersonDisabledForDuty(person, groupNum, 'semi')) {
                        let eligiblePerson = null;
                        let eligibleIndex = -1;
                        for (let offset = 1; offset <= rotationDays * 2; offset++) {
                            const idx = (pos + offset) % rotationDays;
                            const candidate = groupPeople[idx];
                            if (!candidate) continue;
                            if (isPersonDisabledForDuty(candidate, groupNum, 'semi')) continue;
                            if (isPersonMissingOnDate(candidate, groupNum, date, 'semi')) continue;
                            eligiblePerson = candidate;
                            eligibleIndex = idx;
                            break;
                        }
                        baseline[dateKey][groupNum] = eligiblePerson != null ? eligiblePerson : person;
                        if (eligibleIndex >= 0) nextPos = (eligibleIndex + 1) % rotationDays; // next semi goes to person after the one we assigned
                    } else if (person && isPersonMissingOnDate(person, groupNum, date, 'semi')) {
                        // MISSING: At the missing semi date assign the next person in rotation; next semi must go to person AFTER them (no double assignment)
                        let eligiblePerson = null;
                        let eligibleIndex = -1;
                        for (let offset = 1; offset <= rotationDays * 2; offset++) {
                            const idx = (pos + offset) % rotationDays;
                            const candidate = groupPeople[idx];
                            if (!candidate) continue;
                            if (isPersonDisabledForDuty(candidate, groupNum, 'semi')) continue;
                            if (isPersonMissingOnDate(candidate, groupNum, date, 'semi')) continue;
                            eligiblePerson = candidate;
                            eligibleIndex = idx;
                            break;
                        }
                        baseline[dateKey][groupNum] = eligiblePerson != null ? eligiblePerson : person;
                        if (eligibleIndex >= 0) nextPos = (eligibleIndex + 1) % rotationDays; // next semi goes to person after the one we assigned
                    } else {
                        baseline[dateKey][groupNum] = person;
                    }
                    globalSemiPos[groupNum] = nextPos;
                }
            }

            // 2) Defer Firebase saves until after all sync work (see step 4 block)

            // 3) Conflict check: person on semi has weekend or special on day before/after (uses precomputed semiMeta)
            const hasConflict = (semiDateKey, person, groupNum) => {
                const m = semiMeta[semiDateKey];
                if (!m) return false;
                if (m.typeBefore === 'weekend-holiday' && simulatedWeekendAssignments[m.keyBefore]?.[groupNum] === person) return true;
                if (m.typeBefore === 'special-holiday' && simulatedSpecialAssignments[m.monthKeyBefore]?.[groupNum]?.has(person)) return true;
                if (m.typeAfter === 'weekend-holiday' && simulatedWeekendAssignments[m.keyAfter]?.[groupNum] === person) return true;
                if (m.typeAfter === 'special-holiday' && simulatedSpecialAssignments[m.monthKeyAfter]?.[groupNum]?.has(person)) return true;
                return false;
            };

            const finalAssignments = {}; // dateKey -> { groupNum -> person }
            for (const dk of Object.keys(baseline)) {
                finalAssignments[dk] = { ...baseline[dk] };
            }
            const swapInfo = {}; // dateKey -> { groupNum -> { otherDateKey, otherDateStr } }
            const swappedSet = new Set(); // 'dateKey:groupNum' already swapped (skip when iterating)
            let semiSwapPairId = 0; // for assignmentReasons so results modal can show swap pairs

            const semiIndicesByMonth = monthKeyToIndices;
            for (let i = 0; i < sortedSemi.length; i++) {
                const dateKey = sortedSemi[i];
                const meta = semiMeta[dateKey];
                if (!meta) continue;
                const { monthKey } = meta;
                const indicesInMonth = semiIndicesByMonth[monthKey] || [];
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    if (swappedSet.has(`${dateKey}:${groupNum}`)) continue;
                    const person = finalAssignments[dateKey]?.[groupNum];
                    if (!person || !hasConflict(dateKey, person, groupNum)) continue;
                    let swapped = false;
                    for (let k = 0; k < indicesInMonth.length; k++) {
                        const j = indicesInMonth[k];
                        if (j <= i) continue;
                        const dk2 = sortedSemi[j];
                        if (swappedSet.has(`${dk2}:${groupNum}`)) continue;
                        const other = finalAssignments[dk2]?.[groupNum];
                        if (!other || other === person) continue;
                        if (hasConflict(dk2, other, groupNum)) continue;
                        finalAssignments[dateKey][groupNum] = other;
                        finalAssignments[dk2][groupNum] = person;
                        const m2 = semiMeta[dk2];
                        const otherStr = m2 ? m2.dateStr : new Date(dk2 + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        const dateStr = meta.dateStr;
                        if (!swapInfo[dateKey]) swapInfo[dateKey] = {};
                        swapInfo[dateKey][groupNum] = { otherDateKey: dk2, otherDateStr: otherStr };
                        if (!swapInfo[dk2]) swapInfo[dk2] = {};
                        swapInfo[dk2][groupNum] = { otherDateKey: dateKey, otherDateStr: dateStr };
                        swappedSet.add(`${dateKey}:${groupNum}`); swappedSet.add(`${dk2}:${groupNum}`);
                        semiSwapPairId++;
                        storeAssignmentReason(dateKey, groupNum, other, 'swap', buildSwapReasonGreek({ conflictedPersonName: person, conflictDateKey: dateKey, newAssignmentDateKey: dateKey }), person, semiSwapPairId);
                        storeAssignmentReason(dk2, groupNum, person, 'swap', buildSwapReasonGreek({ conflictedPersonName: person, conflictDateKey: dateKey, newAssignmentDateKey: dk2 }), other, semiSwapPairId);
                        swapped = true;
                        break;
                    }
                    if (swapped) continue;
                    for (let k = indicesInMonth.length - 1; k >= 0; k--) {
                        const j = indicesInMonth[k];
                        if (j >= i) continue;
                        const dk2 = sortedSemi[j];
                        if (swappedSet.has(`${dk2}:${groupNum}`)) continue;
                        const other = finalAssignments[dk2]?.[groupNum];
                        if (!other || other === person) continue;
                        if (hasConflict(dk2, other, groupNum)) continue;
                        finalAssignments[dateKey][groupNum] = other;
                        finalAssignments[dk2][groupNum] = person;
                        const m2 = semiMeta[dk2];
                        const otherStr = m2 ? m2.dateStr : new Date(dk2 + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        const dateStr = meta.dateStr;
                        if (!swapInfo[dateKey]) swapInfo[dateKey] = {};
                        swapInfo[dateKey][groupNum] = { otherDateKey: dk2, otherDateStr: otherStr };
                        if (!swapInfo[dk2]) swapInfo[dk2] = {};
                        swapInfo[dk2][groupNum] = { otherDateKey: dateKey, otherDateStr: dateStr };
                        swappedSet.add(`${dateKey}:${groupNum}`); swappedSet.add(`${dk2}:${groupNum}`);
                        semiSwapPairId++;
                        storeAssignmentReason(dateKey, groupNum, other, 'swap', buildSwapReasonGreek({ conflictedPersonName: person, conflictDateKey: dateKey, newAssignmentDateKey: dateKey }), person, semiSwapPairId);
                        storeAssignmentReason(dk2, groupNum, person, 'swap', buildSwapReasonGreek({ conflictedPersonName: person, conflictDateKey: dateKey, newAssignmentDateKey: dk2 }), other, semiSwapPairId);
                        swapped = true;
                        break;
                    }
                    // Cross-month swap as last resort when no same-month swap found
                    if (!swapped) {
                        for (let j = 0; j < sortedSemi.length; j++) {
                            if (j === i) continue;
                            const dk2 = sortedSemi[j];
                            const m2 = semiMeta[dk2];
                            if (m2 && m2.monthKey === monthKey) continue;
                            if (swappedSet.has(`${dk2}:${groupNum}`)) continue;
                            const other = finalAssignments[dk2]?.[groupNum];
                            if (!other || other === person) continue;
                            if (hasConflict(dk2, other, groupNum)) continue;
                            finalAssignments[dateKey][groupNum] = other;
                            finalAssignments[dk2][groupNum] = person;
                            const otherStr = m2 ? m2.dateStr : new Date(dk2 + 'T00:00:00').toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                            const dateStr = meta.dateStr;
                            if (!swapInfo[dateKey]) swapInfo[dateKey] = {};
                            swapInfo[dateKey][groupNum] = { otherDateKey: dk2, otherDateStr: otherStr };
                            if (!swapInfo[dk2]) swapInfo[dk2] = {};
                            swapInfo[dk2][groupNum] = { otherDateKey: dateKey, otherDateStr: dateStr };
                            swappedSet.add(`${dateKey}:${groupNum}`); swappedSet.add(`${dk2}:${groupNum}`);
                            semiSwapPairId++;
                            storeAssignmentReason(dateKey, groupNum, other, 'swap', buildSwapReasonGreek({ conflictedPersonName: person, conflictDateKey: dateKey, newAssignmentDateKey: dateKey }), person, semiSwapPairId);
                            storeAssignmentReason(dk2, groupNum, person, 'swap', buildSwapReasonGreek({ conflictedPersonName: person, conflictDateKey: dateKey, newAssignmentDateKey: dk2 }), other, semiSwapPairId);
                            break;
                        }
                    }
                }
            }

            // 4) Last rotation positions: use final assignments (after swaps) per month
            const lastSemiRotationPositionsByMonth = {};
            for (const dateKey of sortedSemi) {
                const m = semiMeta[dateKey];
                if (!m) continue;
                if (!lastSemiRotationPositionsByMonth[m.monthKey]) lastSemiRotationPositionsByMonth[m.monthKey] = {};
                const g = finalAssignments[dateKey];
                if (g) for (let groupNum = 1; groupNum <= 4; groupNum++) if (g[groupNum]) lastSemiRotationPositionsByMonth[m.monthKey][groupNum] = g[groupNum];
            }

            try {
                if (typeof window !== 'undefined' && window.db && window.auth?.currentUser) {
                    const db = window.db;
                    const user = window.auth.currentUser;
                    const formattedBaseline = formatGroupAssignmentsToStringMap(baseline);
                    const organizedBaseline = organizeAssignmentsByMonth(formattedBaseline);
                    const formattedFinal = formatGroupAssignmentsToStringMap(finalAssignments);
                    const organizedFinal = organizeAssignmentsByMonth(formattedFinal);
                    // Save baseline and final in parallel to reduce total wait
                    await Promise.all([
                        mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'rotationBaselineSemiAssignments', organizedBaseline),
                        (async () => {
                            await mergeAndSaveMonthOrganizedAssignmentsDoc(db, user, 'semiNormalAssignments', organizedFinal);
                            for (const monthKey in lastSemiRotationPositionsByMonth) {
                                const gmap = lastSemiRotationPositionsByMonth[monthKey];
                                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                                    if (gmap[groupNum] !== undefined) setLastRotationPersonForMonth('semi', monthKey, groupNum, gmap[groupNum]);
                                }
                            }
                            const sanitized = sanitizeForFirestore(lastRotationPositions);
                            await db.collection('dutyShifts').doc('lastRotationPositions').set({ ...sanitized, lastUpdated: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: user.uid });
                        })()
                    ]);
                    Object.assign(rotationBaselineSemiAssignments, formattedBaseline);
                    Object.assign(semiNormalAssignments, formattedFinal);
                }
            } catch (e) { console.error('Save semi:', e); }

            calculationSteps.tempSemiAssignments = finalAssignments;
            calculationSteps.tempSemiBaselineAssignments = baseline;
            calculationSteps.finalSemiAssignments = finalAssignments;
            calculationSteps.lastSemiRotationPositionsByMonth = lastSemiRotationPositionsByMonth;

            // 5) Build table: baseline vs final (use precomputed dateStr/dayName from semiMeta)
            const periodLabel = (startDate && endDate) ? `${startDate.toLocaleDateString('el-GR')} – ${endDate.toLocaleDateString('el-GR')}` : '';
            let html = '<div class="step-content"><h6 class="mb-3"><i class="fas fa-calendar-alt me-2"></i>Περίοδος: ' + periodLabel + '</h6>';
            html += '<div class="table-responsive"><table class="table table-bordered table-sm"><thead><tr><th>Ημερομηνία</th><th>Ημέρα</th>';
            for (let g = 1; g <= 4; g++) html += '<th>' + (getGroupName(g) || 'Ομάδα ' + g) + '</th>';
            html += '</tr></thead><tbody>';
            for (const dateKey of sortedSemi) {
                const m = semiMeta[dateKey];
                if (!m) continue;
                html += '<tr><td><strong>' + m.dateStr + '</strong></td><td>' + m.dayName + '</td>';
                for (let groupNum = 1; groupNum <= 4; groupNum++) {
                    const basePerson = baseline[dateKey]?.[groupNum] || '-';
                    const finalPerson = finalAssignments[dateKey]?.[groupNum] || '-';
                    html += '<td>' + buildBaselineComputedCellHtml(basePerson, finalPerson) + '</td>';
                }
                html += '</tr>';
            }
            html += '</tbody></table></div></div>';
            stepContent.innerHTML = html;
        }
        function _OLD_renderStep3_SemiNormal_REMOVED() {
            if (false) {
            const sortedWeekends = [];
            sortedWeekends.forEach((dateKey, weekendIndex) => {
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
                // Track which people have been assigned to which days (to prevent nearby duplicate assignments)
                // Structure: monthKey -> { groupNum -> { personName -> dateKey } }
                // Only prevents duplicates if assigned within 5 days (too close)
                const assignedPeoplePreviewSemi = {}; // monthKey -> { groupNum -> { personName -> dateKey } }
                // Track persons assigned via return-from-missing (backward/forward) so we don't assign them again when their turn comes
                const assignedByReturnFromMissingSemi = {}; // groupNum -> Set of person names
                
                // Return-from-missing for semi-normal: count 3 calendar days after period end, then first semi after that.
                // Only apply if the person had a semi-normal duty during the missing period that was replaced.
                const returnFromMissingSemiTargets = {}; // dateKey -> { groupNum -> { personName, missingEnd } }
                const calcStartDate = calculationSteps.startDate;
                const calcEndDate = calculationSteps.endDate;
                const calcStartKey = (calcStartDate && !isNaN(new Date(calcStartDate).getTime())) ? formatDateKey(new Date(calcStartDate)) : null;
                const calcEndKey = (calcEndDate && !isNaN(new Date(calcEndDate).getTime())) ? formatDateKey(new Date(calcEndDate)) : null;
                const addDaysToDateKeyLocal = (dk, days) => {
                    if (!dk || typeof dk !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dk)) return null;
                    const d = new Date(dk + 'T00:00:00');
                    if (isNaN(d.getTime())) return null;
                    d.setDate(d.getDate() + (days || 0));
                    return formatDateKey(d);
                };
                const findFirstSemiOnOrAfter = (sorted, thresholdKey) => {
                    for (const semiDk of sorted) {
                        if (semiDk >= thresholdKey) return semiDk;
                    }
                    return null;
                };
                const findLastSemiBefore = (sorted, thresholdKey) => {
                    let lastSemi = null;
                    for (const semiDk of sorted) {
                        if (semiDk >= thresholdKey) break;
                        lastSemi = semiDk;
                    }
                    return lastSemi;
                };
                const maxDateKeyLocal = (a, b) => (!a ? b : (!b ? a : (a > b ? a : b)));
                const minDateKeyLocal = (a, b) => (!a ? b : (!b ? a : (a < b ? a : b)));
                // Build baseline semi (rotation-only, no skip): who would be assigned on each semi day by rotation
                const baselineSemiByDate = {};
                const baselineSemiRotationPosition = {};
                for (const dk of sortedSemi) {
                    const dt = new Date(dk + 'T00:00:00');
                    for (let g = 1; g <= 4; g++) {
                        const grp = groups[g] || { semi: [] };
                        const people = grp.semi || [];
                        if (people.length === 0) continue;
                        const rotLen = people.length;
                        if (baselineSemiRotationPosition[g] === undefined) {
                            const isFeb2026 = calcStartDate && new Date(calcStartDate).getFullYear() === 2026 && new Date(calcStartDate).getMonth() === 1;
                            if (isFeb2026) baselineSemiRotationPosition[g] = 0;
                            else {
                                const last = getLastRotationPersonForDate('semi', dt, g);
                                const idx = people.indexOf(last);
                                if (last && idx >= 0) baselineSemiRotationPosition[g] = (idx + 1) % rotLen;
                                else baselineSemiRotationPosition[g] = getRotationPosition(dt, 'semi', g) % rotLen;
                            }
                        }
                        const pos = baselineSemiRotationPosition[g] % rotLen;
                        if (!baselineSemiByDate[dk]) baselineSemiByDate[dk] = {};
                        baselineSemiByDate[dk][g] = people[pos];
                        baselineSemiRotationPosition[g] = (pos + 1) % rotLen;
                    }
                }
                if (calcStartKey && calcEndKey && sortedSemi.length > 0) {
                    const processedSemiReturn = new Set();
                    const normSemi = (s) => (typeof normalizePersonKey === 'function' ? normalizePersonKey(s) : String(s || '').trim());
                    for (let groupNum = 1; groupNum <= 4; groupNum++) {
                        const g = groups[groupNum];
                        const missingMap = g?.missingPeriods || {};
                        const semiList = g?.semi || [];
                        for (const personName of Object.keys(missingMap)) {
                            if (!semiList.some(p => normSemi(p) === normSemi(personName))) continue;
                            const periods = Array.isArray(missingMap[personName]) ? missingMap[personName] : [];
                            for (const period of periods) {
                                const pStartKey = inputValueToDateKey(period?.start);
                                const pEndKey = inputValueToDateKey(period?.end);
                                if (!pStartKey || !pEndKey) continue;
                                // Allow periods that ended within calculation range OR in the month immediately before calcStartKey
                                // (e.g., if calculating March, also check periods ending in February)
                                const pEndDate = new Date(pEndKey + 'T00:00:00');
                                const calcStartDateObj = calcStartKey ? new Date(calcStartKey + 'T00:00:00') : null;
                                const prevMonthStart = calcStartDateObj ? new Date(calcStartDateObj.getFullYear(), calcStartDateObj.getMonth() - 1, 1) : null;
                                const prevMonthStartKey = prevMonthStart ? formatDateKey(prevMonthStart) : null;
                                const prevMonthEnd = calcStartDateObj ? new Date(calcStartDateObj.getFullYear(), calcStartDateObj.getMonth(), 0) : null;
                                const prevMonthEndKey = prevMonthEnd ? formatDateKey(prevMonthEnd) : null;
                                const periodEndsInRange = (pEndKey >= calcStartKey && pEndKey <= calcEndKey);
                                const periodEndsInPrevMonth = (prevMonthStartKey && prevMonthEndKey && pEndKey >= prevMonthStartKey && pEndKey <= prevMonthEndKey);
                                if (!periodEndsInRange && !periodEndsInPrevMonth) continue;
                                const dedupeKey = `${groupNum}|${personName}|${pEndKey}`;
                                if (processedSemiReturn.has(dedupeKey)) continue;
                                processedSemiReturn.add(dedupeKey);
                                const monthStartKey = formatDateKey(new Date(pEndDate.getFullYear(), pEndDate.getMonth(), 1));
                                // For scan window: if period ended in previous month, scan from period start to period end (within that month)
                                // If period ended in current range, scan from max(monthStart, periodStart, calcStart) to min(periodEnd, calcEnd)
                                const scanStartKey = periodEndsInPrevMonth 
                                    ? maxDateKeyLocal(monthStartKey, pStartKey)
                                    : maxDateKeyLocal(maxDateKeyLocal(monthStartKey, pStartKey), calcStartKey);
                                const scanEndKey = periodEndsInPrevMonth 
                                    ? pEndKey
                                    : minDateKeyLocal(pEndKey, calcEndKey);
                                if (!scanStartKey || !scanEndKey || scanStartKey > scanEndKey) continue;
                                // Check if they had a missed semi duty during the missing period
                                // We need to check semi days in the missing window, but baselineSemiByDate only has semi days in sortedSemi (current calculation range)
                                // For periods ending in previous month, we need to check if ANY semi day in that period would have been them by rotation
                                // Since we don't have baseline for previous month semi days, we'll check if the period overlaps with any semi day in sortedSemi
                                // OR we check if there's a semi day in the period window that would have been them
                                // Actually, for previous month periods, we can't use baselineSemiByDate because it only covers sortedSemi (current range)
                                // So we need to compute baseline for semi days in the period window if they're not in sortedSemi
                                // But wait - if the period is 25-28 Feb and there's a semi on 27 Feb, that semi day might not be in sortedSemi if we're calculating March
                                // So we need to check: did the period overlap with ANY semi day? And if so, would that person have been assigned by rotation?
                                // For simplicity, let's check: if period ended in previous month, assume they had a missed semi if the period overlaps with any semi day
                                // Actually, let's be more precise: check if there's a semi day in the period window (pStartKey to pEndKey) that exists
                                // For now, let's check if any semi day in sortedSemi falls within the period window (for periods ending in current range)
                                // For periods ending in previous month, we'll check if the period would have contained a semi day by checking the semi pattern
                                let hadMissedSemi = false;
                                if (periodEndsInRange) {
                                    // Period ended in current range - check baselineSemiByDate for semi days in scan window
                                    for (const dk of sortedSemi) {
                                        if (dk < scanStartKey) continue;
                                        if (dk > scanEndKey) break;
                                        const baseSemi = baselineSemiByDate[dk]?.[groupNum];
                                        if (baseSemi && normSemi(baseSemi) === normSemi(personName)) {
                                            hadMissedSemi = true;
                                            break;
                                        }
                                    }
                                } else {
                                    // Period ended in previous month - check if period overlaps with any semi day
                                    // We can't use baselineSemiByDate because those semi days aren't in sortedSemi
                                    // Instead, check if there's a semi day that falls within the period window
                                    // For this, we need to know what semi days exist - but we only have sortedSemi (current range)
                                    // So we'll assume: if the period is long enough and contains typical semi days, they likely had a missed semi
                                    // Actually, a better approach: check if the period window (pStartKey to pEndKey) would contain a semi day
                                    // by checking if getDayType for dates in that range includes semi-normal-day
                                    // But we don't have that info easily. For now, let's assume if period is >= 3 days, they likely had a missed semi
                                    // OR we can check: if period ended in previous month and threshold (end+4) falls in current range, assign them
                                    // Actually, the user's requirement is: "if they have seminormal duty during the missing period"
                                    // So we need to verify they had one. Since we don't have previous month semi days in sortedSemi,
                                    // we'll check: if period ended in previous month and threshold falls in current range, check if they would have been assigned
                                    // by rotation on any date in the period window that is a semi day
                                    // For simplicity, let's check if any date in the period window (pStartKey to pEndKey) is a semi-normal-day type
                                    // and if so, check if rotation would assign this person on that date
                                    const periodStartDate = new Date(pStartKey + 'T00:00:00');
                                    const periodEndDate = new Date(pEndKey + 'T00:00:00');
                                    for (let checkDate = new Date(periodStartDate); checkDate <= periodEndDate; checkDate.setDate(checkDate.getDate() + 1)) {
                                        const checkDateKey = formatDateKey(checkDate);
                                        const dayType = getDayType(checkDate);
                                        if (dayType === 'semi-normal-day') {
                                            // Check if rotation would assign this person on this date
                                            const rotationPos = getRotationPosition(checkDate, 'semi', groupNum);
                                            const groupPeopleForCheck = g?.semi || [];
                                            if (groupPeopleForCheck.length > 0) {
                                                const expectedPerson = groupPeopleForCheck[rotationPos % groupPeopleForCheck.length];
                                                if (expectedPerson && normSemi(expectedPerson) === normSemi(personName)) {
                                                    hadMissedSemi = true;
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }
                                if (!hadMissedSemi) continue;
                                
                                // Forward: 3 consecutive days (any day) after return day, then assign to first appropriate semi-normal
                                const thirdDayAfterEnd = addDaysToDateKeyLocal(pEndKey, 3);
                                if (!thirdDayAfterEnd) continue;
                                // Backward: avoid assigning one day before missing period starts
                                const dayBeforeStart = addDaysToDateKeyLocal(pStartKey, -1);
                                let targetSemiKey = null;
                                // Prefer forward: first semi on or after (return day + 3)
                                const forwardTarget = findFirstSemiOnOrAfter(sortedSemi, thirdDayAfterEnd);
                                if (forwardTarget && forwardTarget >= calcStartKey && forwardTarget <= calcEndKey) {
                                    targetSemiKey = forwardTarget;
                                } else {
                                    // Backward: last semi before period start, but not the day before period start
                                    let backwardCandidate = findLastSemiBefore(sortedSemi, pStartKey);
                                    if (backwardCandidate && dayBeforeStart && backwardCandidate === dayBeforeStart) {
                                        const idx = sortedSemi.indexOf(backwardCandidate);
                                        backwardCandidate = (idx > 0) ? sortedSemi[idx - 1] : null;
                                    }
                                    if (backwardCandidate && backwardCandidate >= calcStartKey && backwardCandidate <= calcEndKey) targetSemiKey = backwardCandidate;
                                }
                                
                                if (!targetSemiKey || targetSemiKey < calcStartKey || targetSemiKey > calcEndKey) continue;
                                if (returnFromMissingSemiTargets[targetSemiKey]?.[groupNum]) {
                                    const semiIdxLocal = sortedSemi.indexOf(targetSemiKey);
                                    for (let i = semiIdxLocal + 1; i < sortedSemi.length; i++) {
                                        const dk = sortedSemi[i];
                                        if (dk < calcStartKey || dk > calcEndKey) break;
                                        if (!returnFromMissingSemiTargets[dk]?.[groupNum]) { targetSemiKey = dk; break; }
                                    }
                                    if (returnFromMissingSemiTargets[targetSemiKey]?.[groupNum]) {
                                        for (let i = semiIdxLocal - 1; i >= 0; i--) {
                                            const dk = sortedSemi[i];
                                            if (dk < calcStartKey || dk > calcEndKey) continue;
                                            if (!returnFromMissingSemiTargets[dk]?.[groupNum]) { targetSemiKey = dk; break; }
                                        }
                                    }
                                }
                                if (returnFromMissingSemiTargets[targetSemiKey]?.[groupNum]) continue;
                                const formatDDMMYYYYSemi = (dk) => {
                                    const d = new Date(dk + 'T00:00:00');
                                    return (d.getDate() < 10 ? '0' : '') + d.getDate() + '/' + ((d.getMonth() + 1) < 10 ? '0' : '') + (d.getMonth() + 1) + '/' + d.getFullYear();
                                };
                                const missingRangeStrSemi = formatDDMMYYYYSemi(pStartKey) + ' - ' + formatDDMMYYYYSemi(pEndKey);
                                const reasonOfMissingSemi = (period?.reason || '').trim() || '(δεν αναφέρεται λόγος)';
                                if (!returnFromMissingSemiTargets[targetSemiKey]) returnFromMissingSemiTargets[targetSemiKey] = {};
                                returnFromMissingSemiTargets[targetSemiKey][groupNum] = { personName, missingEnd: pEndKey, missingRangeStr: missingRangeStrSemi, reasonOfMissing: reasonOfMissingSemi };
                            }
                        }
                    }
                }
                
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
                            const designated = returnFromMissingSemiTargets[dateKey]?.[groupNum];
                            if (designated && groupPeople.includes(designated.personName) && !isPersonMissingOnDate(designated.personName, groupNum, date, 'semi')) {
                                const assignedPerson = designated.personName;
                                if (!assignedByReturnFromMissingSemi[groupNum]) assignedByReturnFromMissingSemi[groupNum] = new Set();
                                assignedByReturnFromMissingSemi[groupNum].add(assignedPerson);
                                // Next slot goes to the displaced (baseline) person – set position to displaced person's index so we get F, A, B, C
                                const displacedPerson = baselineSemiByDate[dateKey]?.[groupNum];
                                const originalIndex = displacedPerson != null ? groupPeople.indexOf(displacedPerson) : -1;
                                if (globalSemiRotationPosition[groupNum] === undefined) globalSemiRotationPosition[groupNum] = 0;
                                globalSemiRotationPosition[groupNum] = (originalIndex >= 0 ? originalIndex : (groupPeople.indexOf(assignedPerson) + 1)) % rotationDays;
                                const semiReasonText = `Τοποθετήθηκε σε υπηρεσία γιατί θα απουσιάζει (${designated.missingRangeStr || ''}) λόγω ${designated.reasonOfMissing || '(δεν αναφέρεται λόγος)'}`;
                                storeAssignmentReason(dateKey, groupNum, assignedPerson, 'skip', semiReasonText, null, null, { returnFromMissing: true, missingEnd: designated.missingEnd });
                                if (!assignedPeoplePreviewSemi[monthKey][groupNum]) assignedPeoplePreviewSemi[monthKey][groupNum] = new Set();
                                assignedPeoplePreviewSemi[monthKey][groupNum].add(assignedPerson);
                                if (!semiAssignments[dateKey]) semiAssignments[dateKey] = {};
                                semiAssignments[dateKey][groupNum] = assignedPerson;
                                let lastDutyInfo = ''; let daysCountInfo = '';
                                if (assignedPerson) {
                                    const daysSince = countDaysSinceLastDuty(dateKey, assignedPerson, groupNum, 'semi', dayTypeLists, startDate);
                                    const dutyDates = getLastAndNextDutyDates(assignedPerson, groupNum, 'semi', groupPeople.length);
                                    lastDutyInfo = dutyDates.lastDuty !== 'Δεν έχει' ? `<br><small class="text-muted">Τελευταία: ${dutyDates.lastDuty}</small>` : '';
                                    if (daysSince !== null && daysSince !== Infinity) daysCountInfo = ` <span class="text-info">${daysSince}/${rotationDays} ημέρες</span>`;
                                    else if (daysSince === Infinity) daysCountInfo = ' <span class="text-success">πρώτη φορά</span>';
                                }
                                html += `<td>${buildBaselineComputedCellHtml(assignedPerson, assignedPerson, daysCountInfo, lastDutyInfo)}</td>`;
                            } else {
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
                            
                            let assignedPerson = rotationPerson;
                            let wasReplaced = false;
                            let replacementIndex = null;
                            let wasDisabledOnlySkippedSemi = false;
                            // Already assigned via return-from-missing (backward/forward): skip when their turn comes – they already had their duty
                            const wasAssignedByReturnFromMissingSemi = rotationPerson && assignedByReturnFromMissingSemi[groupNum]?.has(rotationPerson);
                            if (wasAssignedByReturnFromMissingSemi) {
                                if (!assignedPeoplePreviewSemi[monthKey][groupNum]) assignedPeoplePreviewSemi[monthKey][groupNum] = new Set();
                                let foundEligible = false;
                                for (let offset = 1; offset <= rotationDays * 2 && !foundEligible; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (assignedByReturnFromMissingSemi[groupNum]?.has(candidate)) continue;
                                    if (isPersonDisabledForDuty(candidate, groupNum, 'semi')) continue;
                                    if (isPersonMissingOnDate(candidate, groupNum, date, 'semi')) continue;
                                    if (assignedPeoplePreviewSemi[monthKey][groupNum] && assignedPeoplePreviewSemi[monthKey][groupNum][candidate]) {
                                        const lastAssignmentDateKey = assignedPeoplePreviewSemi[monthKey][groupNum][candidate];
                                        const lastDate = new Date(lastAssignmentDateKey + 'T00:00:00');
                                        const currentDate = new Date(dateKey + 'T00:00:00');
                                        const daysDiff = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
                                        if (daysDiff <= 5 && daysDiff > 0) continue;
                                    }
                                    assignedPerson = candidate;
                                    replacementIndex = idx;
                                    wasReplaced = true;
                                    wasDisabledOnlySkippedSemi = true;
                                    foundEligible = true;
                                    globalSemiRotationPosition[groupNum] = (idx + 1) % rotationDays;
                                    break;
                                }
                                if (!foundEligible) assignedPerson = null;
                            }
                            // DISABLED: When rotation person is disabled, whole baseline shifts – skip them, no replacement line. (Same treatment as special/weekend/normal.)
                            const isRotationPersonDisabledSemi = !wasAssignedByReturnFromMissingSemi && rotationPerson && isPersonDisabledForDuty(rotationPerson, groupNum, 'semi');
                            if (isRotationPersonDisabledSemi) {
                                if (!assignedPeoplePreviewSemi[monthKey][groupNum]) {
                                    assignedPeoplePreviewSemi[monthKey][groupNum] = {};
                                }
                                let foundEligible = false;
                                for (let offset = 1; offset <= rotationDays * 2 && !foundEligible; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (isPersonDisabledForDuty(candidate, groupNum, 'semi')) continue;
                                    if (isPersonMissingOnDate(candidate, groupNum, date, 'semi')) continue;
                                    if (assignedPeoplePreviewSemi[monthKey][groupNum] && assignedPeoplePreviewSemi[monthKey][groupNum][candidate]) {
                                        const lastAssignmentDateKey = assignedPeoplePreviewSemi[monthKey][groupNum][candidate];
                                        const lastDate = new Date(lastAssignmentDateKey + 'T00:00:00');
                                        const currentDate = new Date(dateKey + 'T00:00:00');
                                        const daysDiff = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
                                        if (daysDiff <= 5 && daysDiff > 0) continue;
                                    }
                                    assignedPerson = candidate;
                                    replacementIndex = idx;
                                    wasReplaced = true;
                                    wasDisabledOnlySkippedSemi = true;
                                    foundEligible = true;
                                    break;
                                }
                                if (!foundEligible) assignedPerson = null;
                            }
                            // Store baseline for UI: when disabled skip use assigned person so no swap line (same as normal; avoids next day showing as swap)
                            semiRotationPersons[dateKey][groupNum] = (wasDisabledOnlySkippedSemi && assignedPerson) ? assignedPerson : rotationPerson;
                            // MISSING (not disabled): show replacement and store reason.
                            if (!isRotationPersonDisabledSemi && assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date, 'semi')) {
                                if (!assignedPeoplePreviewSemi[monthKey][groupNum]) {
                                    assignedPeoplePreviewSemi[monthKey][groupNum] = {};
                                }
                                let foundReplacement = false;
                                for (let offset = 1; offset <= rotationDays * 2 && !foundReplacement; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (isPersonMissingOnDate(candidate, groupNum, date, 'semi')) continue;
                                    if (assignedPeoplePreviewSemi[monthKey][groupNum] && assignedPeoplePreviewSemi[monthKey][groupNum][candidate]) {
                                        const lastAssignmentDateKey = assignedPeoplePreviewSemi[monthKey][groupNum][candidate];
                                        const lastDate = new Date(lastAssignmentDateKey + 'T00:00:00');
                                        const currentDate = new Date(dateKey + 'T00:00:00');
                                        const daysDiff = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
                                        if (daysDiff <= 5 && daysDiff > 0) continue;
                                        }
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
                                if (!foundReplacement) assignedPerson = null;
                            }
                            
                            // Check if this day is a cross-month swap assignment (person swapped from previous month)
                            // Check if there's a pending swap for this position
                            if (pendingSwaps[monthKey][groupNum] && pendingSwaps[monthKey][groupNum].swapToPosition === rotationPosition) {
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
                            } else {
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
                                        // Check if candidate was already assigned recently (within 5 days) - prevent nearby duplicates
                                        if (assignedPeoplePreviewSemi[monthKey][groupNum] && assignedPeoplePreviewSemi[monthKey][groupNum][candidate]) {
                                            const lastAssignmentDateKey = assignedPeoplePreviewSemi[monthKey][groupNum][candidate];
                                            const lastDate = new Date(lastAssignmentDateKey + 'T00:00:00');
                                            const currentDate = new Date(dateKey + 'T00:00:00');
                                            const daysDiff = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
                                            // Only prevent if assigned within 5 days (too close)
                                            if (daysDiff <= 5 && daysDiff > 0) {
                                                continue; // Too close, skip this candidate
                                            }
                                            // If daysDiff > 5, allow duplicate (far enough apart, even if they replaced someone before)
                                        }
                                        
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
                            
                            // Use stored baseline (semiRotationPersons) so when rotation person was disabled we show replacement only, not as swap
                            const baselinePersonForDisplaySemi = semiRotationPersons[dateKey]?.[groupNum] ?? rotationPerson;
                            html += `<td>${buildBaselineComputedCellHtml(baselinePersonForDisplaySemi, assignedPerson, daysCountInfo, lastDutyInfo)}</td>`;
                            }
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

                            const month = date.getMonth();
                            const year = date.getFullYear();
                            const rotationDays = groupPeople.length;
                            const currentRotationPosition = groupPeople.indexOf(currentPerson);
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
            } catch (e) {}
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
                            let wasReplaced = false;
                            let replacementIndex = null;
                            if (assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date, 'normal')) {
                                // Simply skip disabled person and find next person in rotation who is NOT disabled/missing
                                let foundReplacement = false;
                                for (let offset = 1; offset <= rotationDays; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (!isPersonMissingOnDate(candidate, groupNum, date, 'normal')) {
                                        assignedPerson = candidate;
                                        replacementIndex = idx;
                                        wasReplaced = true;
                                        foundReplacement = true;
                                        break;
                                    }
                                }
                                // If no replacement found (everyone disabled), leave unassigned
                                if (!foundReplacement) {
                                    assignedPerson = null;
                                }
                            }
                            
                            // Advance rotation position from the person ACTUALLY assigned (not the skipped person)
                            // This ensures that when Person A is replaced by Person B, next normal day assigns Person C, not Person B again
                            if (assignedPerson) {
                                if (wasReplaced && replacementIndex !== null) {
                                    // Person was replaced - advance from replacement's position
                                    globalNormalRotationPosition[groupNum] = (replacementIndex + 1) % rotationDays;
                                } else {
                                    // No replacement - advance from assigned person's position
                                    const assignedIndex = groupPeople.indexOf(assignedPerson);
                                    if (assignedIndex !== -1) {
                                        globalNormalRotationPosition[groupNum] = (assignedIndex + 1) % rotationDays;
                                    } else {
                                        // Fallback: advance from rotation position
                                        globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                    }
                                }
                            } else {
                                // No person found, still advance rotation position
                                globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
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
                // Track which people have been assigned to which days (to prevent nearby duplicate assignments)
                // Structure: monthKey -> { groupNum -> { personName -> dateKey } }
                // Only prevents duplicates if assigned within 5 days (too close)
                const assignedPeoplePreview = {}; // monthKey -> { groupNum -> { personName -> dateKey } }
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
                        const dateKeyToDate = (dk) => new Date((dk || '') + 'T00:00:00');
                        const calcStartKey = formatDateKey(startDate);
                        const calcEndKey = formatDateKey(endDate);
                        const maxDateKey = (a, b) => (!a ? b : (!b ? a : (a > b ? a : b)));
                        const minDateKey = (a, b) => (!a ? b : (!b ? a : (a < b ? a : b)));
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
                                    
                                    // Check rotationBaselineNormalAssignments for this person's normal duties during missing period.
                                    // Use normalized name comparison so storage format doesn't skip replacement.
                                    const normP = (s) => (typeof normalizePersonKey === 'function' ? normalizePersonKey(s) : String(s || '').trim());
                                    const baselineDutiesToReplace = [];
                                    for (const dk of sortedNormal) {
                                        if (dk < checkStartKey) continue;
                                        if (dk > checkEndKey) break;
                                        
                                        const baselinePerson = 
                                            baselineNormalByDate?.[dk]?.[groupNum] ||
                                            parseAssignedPersonForGroupFromAssignment(getRotationBaselineAssignmentForType('normal', dk), groupNum) ||
                                            null;
                                        
                                        if (baselinePerson && normP(baselinePerson) === normP(personName)) {
                                            baselineDutiesToReplace.push(dk);
                                        }
                                    }
                                    
                                    // If person has baseline duties during missing period, replace them
                                    if (baselineDutiesToReplace.length > 0) {
                                        // Find the person's position in rotation (by normalized name)
                                        const personIndex = groupPeople.findIndex(p => normP(p) === normP(personName));
                                        if (personIndex < 0) continue; // Person not in rotation list
                                        
                                        // For each baseline duty date, find the next available person in rotation.
                                        // IMPORTANT: Advance "virtual" rotation across dates so we don't assign the same person on consecutive dates.
                                        let lastReplacementIndex = personIndex;
                                        for (const dk of baselineDutiesToReplace) {
                                            const dateObj = dateKeyToDate(dk);
                                            if (isNaN(dateObj.getTime())) continue;
                                            
                                            // Find next available person in rotation (starting from person after last replacement)
                                            let replacementPerson = null;
                                            for (let offset = 1; offset <= groupPeople.length * 2; offset++) {
                                                const idx = (lastReplacementIndex + offset) % groupPeople.length;
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
                                                lastReplacementIndex = groupPeople.indexOf(replacementPerson);
                                                
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
                                
                                // Check if person has baseline normal duties during calculation period. Use normalized name comparison.
                                const normPDisabled = (s) => (typeof normalizePersonKey === 'function' ? normalizePersonKey(s) : String(s || '').trim());
                                const baselineDutiesToReplace = [];
                                for (const dk of sortedNormal) {
                                    if (dk < calcStartKey) continue;
                                    if (dk > calcEndKey) break;
                                    
                                    const baselinePerson = 
                                        baselineNormalByDate?.[dk]?.[groupNum] ||
                                        parseAssignedPersonForGroupFromAssignment(getRotationBaselineAssignmentForType('normal', dk), groupNum) ||
                                        null;
                                    
                                    if (baselinePerson && normPDisabled(baselinePerson) === normPDisabled(personName)) {
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
                                    // Find the person's position in rotation (by normalized name)
                                    const personIndex = groupPeople.findIndex(p => normPDisabled(p) === normPDisabled(personName));
                                    if (personIndex < 0) continue; // Person not in rotation list
                                    
                                    // For each baseline duty date, find the next available person in rotation.
                                    // IMPORTANT: Advance "virtual" rotation across dates so we don't assign the same person on consecutive dates.
                                    let lastReplacementIndex = personIndex;
                                    for (const dk of baselineDutiesToReplace) {
                                        const dateObj = dateKeyToDate(dk);
                                        if (isNaN(dateObj.getTime())) continue;
                                        
                                        // Find next available person in rotation (starting from person after last replacement)
                                        let replacementPerson = null;
                                        for (let offset = 1; offset <= groupPeople.length * 2; offset++) {
                                            const idx = (lastReplacementIndex + offset) % groupPeople.length;
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
                                            lastReplacementIndex = groupPeople.indexOf(replacementPerson);
                                            
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
                            
                            // Use normal rotation
                            // Use rotationPerson (which may be a replacement from baselineNormalByDate if original was missing/disabled)
                            assignedPerson = rotationPerson;
                            
                            // Initialize assigned people tracking for this group if needed
                            if (!assignedPeoplePreview[monthKey][groupNum]) {
                                assignedPeoplePreview[monthKey][groupNum] = {};
                            }
                            
                            // DISABLED: When the rotation person is disabled, the whole baseline shifts up – skip them, assign next eligible, no replacement line.
                            // For missing people we keep the replacement behaviour (baseline -> replacement + reason).
                            let wasDisabledOnlySkippedInBaseline = false;
                            const isRotationPersonDisabled = originalRotationPerson && isPersonDisabledForDuty(originalRotationPerson, groupNum, 'normal');
                            if (isRotationPersonDisabled) {
                                let foundEligible = false;
                                for (let offset = 1; offset <= rotationDays * 2 && !foundEligible; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (isPersonMissingOnDate(candidate, groupNum, date, 'normal')) continue;
                                    if (assignedPeoplePreview[monthKey][groupNum] && assignedPeoplePreview[monthKey][groupNum][candidate]) {
                                        const lastAssignmentDateKey = assignedPeoplePreview[monthKey][groupNum][candidate];
                                        const lastDate = new Date(lastAssignmentDateKey + 'T00:00:00');
                                        const currentDate = new Date(dateKey + 'T00:00:00');
                                        const daysDiff = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
                                        if (daysDiff <= 5 && daysDiff > 0) continue;
                                    }
                                    assignedPerson = candidate;
                                    foundEligible = true;
                                    wasDisabledOnlySkippedInBaseline = true;
                                    break;
                                }
                                if (!foundEligible) assignedPerson = null;
                            }
                            
                            // Store baseline for UI: for disabled-only skip use assigned person; when baseline was replaced in pre-processing (next day after disabled skip) use rotationPerson so we don't show as swap; else original.
                            if (!normalRotationPersons[dateKey]) {
                                normalRotationPersons[dateKey] = {};
                            }
                            const baselineForDisplay = wasDisabledOnlySkippedInBaseline
                                ? (assignedPerson || originalRotationPerson)
                                : (wasReplacedFromBaseline ? rotationPerson : originalRotationPerson);
                            normalRotationPersons[dateKey][groupNum] = baselineForDisplay;
                            
                            // CRITICAL: Check if the rotation person is MISSING (not disabled-only) – show replacement and store reason.
                            // Disabled-only is already handled above (no replacement reason).
                            let wasDisabledPersonSkipped = false;
                            let replacementIndex = null;
                            if (!wasDisabledOnlySkippedInBaseline && assignedPerson && isPersonMissingOnDate(assignedPerson, groupNum, date, 'normal')) {
                                // Simply skip missing person and find next person in rotation who is NOT disabled/missing
                                let foundReplacement = false;
                                for (let offset = 1; offset <= rotationDays * 2 && !foundReplacement; offset++) {
                                    const idx = (rotationPosition + offset) % rotationDays;
                                    const candidate = groupPeople[idx];
                                    if (!candidate) continue;
                                    if (isPersonMissingOnDate(candidate, groupNum, date, 'normal')) continue;
                                    if (assignedPeoplePreview[monthKey][groupNum] && assignedPeoplePreview[monthKey][groupNum][candidate]) {
                                        const lastAssignmentDateKey = assignedPeoplePreview[monthKey][groupNum][candidate];
                                        const lastDate = new Date(lastAssignmentDateKey + 'T00:00:00');
                                        const currentDate = new Date(dateKey + 'T00:00:00');
                                        const daysDiff = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
                                        if (daysDiff <= 5 && daysDiff > 0) continue;
                                    }
                                    assignedPerson = candidate;
                                    replacementIndex = idx;
                                    foundReplacement = true;
                                    wasDisabledPersonSkipped = true;
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
                                if (!foundReplacement) assignedPerson = null;
                            }
                            
                            // If assigned person was already assigned recently (due to swap), skip to next person
                            // BUT: Skip this check if we just replaced a disabled person - swap logic will handle duplicates
                            // Check if assigned within 5 days (too close)
                            let wasReplacedDueToFiveDayRule = false;
                            if (!wasDisabledPersonSkipped && assignedPerson && !isPersonMissingOnDate(assignedPerson, groupNum, date, 'normal') && assignedPeoplePreview[monthKey][groupNum][assignedPerson]) {
                                const lastAssignmentDateKey = assignedPeoplePreview[monthKey][groupNum][assignedPerson];
                                const lastDate = new Date(lastAssignmentDateKey + 'T00:00:00');
                                const currentDate = new Date(dateKey + 'T00:00:00');
                                const daysDiff = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
                                // Only skip if assigned within 5 days (too close)
                                if (daysDiff <= 5 && daysDiff > 0) {
                                    // This person was already assigned recently (swapped), find next available person in rotation
                                    // Keep searching through entire rotation until we find someone not disabled and not already assigned recently
                                    let foundReplacement = false;
                                    for (let offset = 1; offset <= rotationDays * 2 && !foundReplacement; offset++) {
                                        const nextIndex = (rotationPosition + offset) % rotationDays;
                                        const candidate = groupPeople[nextIndex];
                                        
                                        if (!candidate) continue;
                                        if (isPersonMissingOnDate(candidate, groupNum, date, 'normal')) continue;
                                        // Check if candidate was assigned recently (within 5 days)
                                        if (assignedPeoplePreview[monthKey][groupNum][candidate]) {
                                            const candidateLastDateKey = assignedPeoplePreview[monthKey][groupNum][candidate];
                                            const candidateLastDate = new Date(candidateLastDateKey + 'T00:00:00');
                                            const candidateDaysDiff = Math.floor((currentDate - candidateLastDate) / (1000 * 60 * 60 * 24));
                                            if (candidateDaysDiff <= 5 && candidateDaysDiff > 0) {
                                                continue; // Too close
                                            }
                                        }
                                    
                                        // Found available person
                                        assignedPerson = candidate;
                                        foundReplacement = true;
                                        wasReplacedDueToFiveDayRule = true;
                                    }
                                    
                                    // If still no replacement found after checking everyone twice, leave unassigned
                                    // (This should be extremely rare - only if everyone is disabled or already assigned recently)
                                    if (!foundReplacement) {
                                        assignedPerson = null;
                                    }
                                }
                            }
                            // When we replaced due to 5-day rule, update stored baseline so we show one line (assigned person only), not "Βασική Σειρά: B, Αντικατάσταση: C"
                            if (wasReplacedDueToFiveDayRule && assignedPerson && normalRotationPersons[dateKey]) {
                                normalRotationPersons[dateKey][groupNum] = assignedPerson;
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
                                    // Check if candidate was already assigned recently (within 5 days) - prevent nearby duplicates
                                    if (assignedPeoplePreview[monthKey][groupNum] && assignedPeoplePreview[monthKey][groupNum][candidate]) {
                                        const lastAssignmentDateKey = assignedPeoplePreview[monthKey][groupNum][candidate];
                                        const lastDate = new Date(lastAssignmentDateKey + 'T00:00:00');
                                        const currentDate = new Date(dateKey + 'T00:00:00');
                                        const daysDiff = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
                                        // Only prevent if assigned within 5 days (too close)
                                        if (daysDiff <= 5 && daysDiff > 0) {
                                            continue; // Too close, skip this candidate
                                        }
                                        // If daysDiff > 5, allow duplicate (far enough apart, even if they replaced someone before)
                                    }
                                    
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
                            // IMPORTANT: Advance rotation position from the ASSIGNED person (replacement), not the skipped person
                            // This ensures that when Person A is replaced by Person B, next month starts from Person C (after Person B)
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
                                        // Advance rotation: disabled-only skip uses rotation+1; missing replacement uses replacementIndex+1; else assignedIndex+1
                                        if (wasDisabledOnlySkippedInBaseline) {
                                            globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                        } else if (wasDisabledPersonSkipped && replacementIndex !== null) {
                                            globalNormalRotationPosition[groupNum] = (replacementIndex + 1) % rotationDays;
                                        } else {
                                            const assignedIndex = groupPeople.indexOf(assignedPerson);
                                            if (assignedIndex !== -1) {
                                                globalNormalRotationPosition[groupNum] = (assignedIndex + 1) % rotationDays;
                                            } else {
                                                globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                            }
                                        }
                                    } else {
                                        // No conflict - advance rotation (disabled-only: rotation+1; missing replacement: replacementIndex+1; else assignedIndex+1)
                                        if (wasDisabledOnlySkippedInBaseline) {
                                            globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                        } else if (wasDisabledPersonSkipped && replacementIndex !== null) {
                                            globalNormalRotationPosition[groupNum] = (replacementIndex + 1) % rotationDays;
                                        } else {
                                            const assignedIndex = groupPeople.indexOf(assignedPerson);
                                            if (assignedIndex !== -1) {
                                                globalNormalRotationPosition[groupNum] = (assignedIndex + 1) % rotationDays;
                                            } else {
                                                globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
                                            }
                                        }
                                    }
                                } else {
                                    // Person is missing or no person assigned - advance rotation position from rotation position
                                    globalNormalRotationPosition[groupNum] = (rotationPosition + 1) % rotationDays;
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
                            
                            // Track that this person has been assigned (to prevent nearby duplicate assignments)
                            if (assignedPerson && assignedPeoplePreview[monthKey] && assignedPeoplePreview[monthKey][groupNum]) {
                                assignedPeoplePreview[monthKey][groupNum][assignedPerson] = dateKey;
                            }
                            
                            // CRITICAL: If assigned person differs from baseline (rotationPerson), check if this is a cascading shift
                            // Store a 'shift' reason to prevent this from showing as a swap in results/calendar
                            // Skip when wasDisabledOnlySkippedInBaseline (no replacement line – rotation just continued from next person)
                            if (!wasDisabledOnlySkippedInBaseline && assignedPerson && assignedPerson !== rotationPerson) {
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
                            
                            // Use stored baseline (normalRotationPersons) so when rotation person was disabled we show replacement only, not as swap.
                            // If baseline differs from assigned and baseline person is disabled for normal, show only assigned (no Βασική Σειρά + Αντικατάσταση).
                            let baselinePersonForDisplay = normalRotationPersons[dateKey]?.[groupNum] || originalRotationPerson;
                            if (baselinePersonForDisplay !== assignedPerson && assignedPerson && isPersonDisabledForDuty(baselinePersonForDisplay, groupNum, 'normal')) {
                                baselinePersonForDisplay = assignedPerson;
                            }
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
                            
                            // MONDAY/WEDNESDAY - Step 3: ONLY if Step 2 failed, try alternative day in week after next
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
                            
                        }
                        
                        // Perform swap if found
                        if (swapFound && swapDayKey) {
                            // Get swap candidate from normalAssignments
                            let swapCandidate = null;
                            if (normalAssignments[swapDayKey] && normalAssignments[swapDayKey][groupNum]) {
                                // Regular swap within calculation range
                                swapCandidate = normalAssignments[swapDayKey][groupNum];
                            }
                            
                            if (!swapCandidate) {
                                // Can't find candidate - skip this swap
                                console.warn(`[PREVIEW SWAP WARNING] Could not find swap candidate for swap ${swapDayKey} (Group ${groupNum})`);
                                continue; // Skip to next iteration
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
            // IMPORTANT: Find the last ASSIGNED person (after replacement), not the rotation person
            // This ensures that when Person A is replaced by Person B, next calculation starts from Person B's position
            // Use the normalAssignments (actual assigned persons) instead of normalRotationPersons
            for (let g = 1; g <= 4; g++) {
                const sortedNormalKeys = [...normalDays].sort();
                let lastAssignedPerson = null;
                for (let i = sortedNormalKeys.length - 1; i >= 0; i--) {
                    const dateKey = sortedNormalKeys[i];
                    if (normalAssignments[dateKey] && normalAssignments[dateKey][g]) {
                        lastAssignedPerson = normalAssignments[dateKey][g];
                        break;
                    }
                }
                if (lastAssignedPerson) {
                    calculationSteps.lastNormalRotationPositions[g] = lastAssignedPerson;
                    console.log(`[NORMAL ROTATION] Storing last assigned person ${lastAssignedPerson} for group ${g} (after replacement)`);
                }
            }

            // Store last rotation person per month (for correct recalculation of individual months)
            // IMPORTANT: Use the ASSIGNED person (after replacement), not the rotation person
            // This ensures that when Person A is replaced by Person B, next calculation starts from Person B's position
            const sortedNormalKeysForMonth = [...normalDays].sort();
            const lastNormalRotationPositionsByMonth = {}; // monthKey -> { groupNum -> assignedPerson }
            for (const dateKey of sortedNormalKeysForMonth) {
                const d = new Date(dateKey + 'T00:00:00');
                const monthKey = getMonthKeyFromDate(d);
                for (let g = 1; g <= 4; g++) {
                    // Use the assigned person (after replacement), not the rotation person
                    const assignedPerson = normalAssignments[dateKey]?.[g];
                    if (assignedPerson) {
                        if (!lastNormalRotationPositionsByMonth[monthKey]) {
                            lastNormalRotationPositionsByMonth[monthKey] = {};
                        }
                        lastNormalRotationPositionsByMonth[monthKey][g] = assignedPerson;
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
            
            // Helper to check if candidate was assigned recently (within 5 days)
            const isAssignedRecently = (candidate) => {
                if (!alreadyAssignedSet) return false;
                // Handle both Set (legacy) and Object (new structure)
                if (alreadyAssignedSet instanceof Set) {
                    return alreadyAssignedSet.has(candidate);
                } else if (typeof alreadyAssignedSet === 'object' && alreadyAssignedSet[candidate]) {
                    const lastAssignmentDateKey = alreadyAssignedSet[candidate];
                    const lastDate = new Date(lastAssignmentDateKey + 'T00:00:00');
                    const currentDate = new Date(dateKey + 'T00:00:00');
                    const daysDiff = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
                    // Only prevent if assigned within 5 days (too close)
                    return daysDiff <= 5 && daysDiff > 0;
                }
                return false;
            };
            
            if (exhaustive) {
                // Search through the entire rotation (potentially multiple times) until we find someone eligible
                // This ensures rotation continues assigning people even if many are disabled
                for (let totalOffset = 1; totalOffset <= rotationDays * 2; totalOffset++) {
                    const idx = (startRotationPosition + totalOffset) % rotationDays;
                    const candidate = groupPeople[idx];
                    if (!candidate) continue;
                    if (isAssignedRecently(candidate)) continue;
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
                    if (isAssignedRecently(candidate)) continue;
                    if (isPersonMissingOnDate(candidate, groupNum, date, dutyCategory)) continue;
                    if (simulatedAssignments && hasConsecutiveDuty(dateKey, candidate, groupNum, simulatedAssignments)) continue;
                    return { person: candidate, index: idx };
                }
                return null;
            }
        }
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