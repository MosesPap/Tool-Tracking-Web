        // ============================================================================
        // DUTY-SHIFTS-UI.JS - User Interface & Rendering
        // ============================================================================

        // When true, after the current child modal closes we reopen the Person Actions (Ενεργειες Ατόμου) modal
        let reopenPersonActionsModalWhenClosed = false;
        let reopenPersonActionsAfterTransferFlow = false;

        function reopenPersonActionsModalIfNeeded() {
            if (reopenPersonActionsModalWhenClosed) {
                reopenPersonActionsModalWhenClosed = false;
                // Refresh and show Person Actions for the current person (correct when opened from disable/missing list)
                const groupNum = currentPersonActionsGroup;
                const personName = currentPersonActionsName;
                let index = currentPersonActionsIndex;
                let listType = currentPersonActionsListType;
                if (index == null || index < 0 || !listType) {
                    const groupData = groups[groupNum] || {};
                    ['special', 'weekend', 'semi', 'normal'].forEach(lt => {
                        const list = groupData[lt] || [];
                        const idx = list.indexOf(personName);
                        if (idx >= 0) {
                            index = idx;
                            listType = lt;
                        }
                    });
                    if (index == null || index < 0) index = 0;
                    if (!listType) listType = 'normal';
                }
                openPersonActionsModal(groupNum, personName, index, listType);
            }
        }

        let _personActionsReopenListenersWired = false;
        function wirePersonActionsReopenListeners() {
            if (_personActionsReopenListenersWired) return;
            _personActionsReopenListenersWired = true;
            const missingEl = document.getElementById('missingPeriodModal');
            if (missingEl) missingEl.addEventListener('hidden.bs.modal', reopenPersonActionsModalIfNeeded);
            const addPersonEl = document.getElementById('addPersonModal');
            if (addPersonEl) addPersonEl.addEventListener('hidden.bs.modal', reopenPersonActionsModalIfNeeded);
            const transferPosEl = document.getElementById('transferPositionModal');
            if (transferPosEl) transferPosEl.addEventListener('hidden.bs.modal', function () {
                if (reopenPersonActionsAfterTransferFlow) {
                    reopenPersonActionsAfterTransferFlow = false;
                    const m = new bootstrap.Modal(document.getElementById('personActionsModal'));
                    m.show();
                }
            });
            const disableSettingsEl = document.getElementById('disableSettingsModal');
            if (disableSettingsEl) disableSettingsEl.addEventListener('hidden.bs.modal', reopenPersonActionsModalIfNeeded);
        }

        // Centered confirm modal (replaces browser confirm for absence-period removal etc.)
        let _confirmModalOkWired = false;
        function showConfirmModal(options) {
            const titleEl = document.getElementById('confirmModalTitleText');
            const bodyEl = document.getElementById('confirmModalBody');
            const modalEl = document.getElementById('confirmModal');
            const okBtn = document.getElementById('confirmModalOkButton');
            if (!titleEl || !bodyEl || !modalEl || !okBtn) return;
            if (options.title != null) titleEl.textContent = options.title;
            if (options.message != null) bodyEl.textContent = options.message;
            window.__confirmModalOnConfirm = options.onConfirm || null;
            if (!_confirmModalOkWired) {
                _confirmModalOkWired = true;
                okBtn.addEventListener('click', function () {
                    if (typeof window.__confirmModalOnConfirm === 'function') {
                        window.__confirmModalOnConfirm();
                        window.__confirmModalOnConfirm = null;
                    }
                    const m = bootstrap.Modal.getInstance(modalEl);
                    if (m) m.hide();
                });
            }
            const modal = new bootstrap.Modal(modalEl);
            modal.show();
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
                ? `<span class="badge bg-secondary ms-2" title="${escapeHtml(disabledTitle)}"><i class="fas fa-user-slash me-1"></i>Απενεργοποιημένος</span>`
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
            
            const disabledCardClass = isDisabledForThisList ? ' person-name-card-disabled' : '';
            personDiv.innerHTML = `
                <div class="person-name-card${disabledCardClass}" onclick="openPersonActionsModal(${groupNum}, '${person.replace(/'/g, "\\'")}', ${index}, '${listType}')">
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
            // When "complete disable" is on, show all four type toggles as checked (person disabled for all). When off, show each type from saved state.
            if (st.all) {
                if (spEl) spEl.checked = true;
                if (weEl) weEl.checked = true;
                if (seEl) seEl.checked = true;
                if (noEl) noEl.checked = true;
            } else {
                if (spEl) spEl.checked = !!st.special;
                if (weEl) weEl.checked = !!st.weekend;
                if (seEl) seEl.checked = !!st.semi;
                if (noEl) noEl.checked = !!st.normal;
            }

            // If "all" is on, disable individual toggles (user can only turn "all" off to then set types individually)
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
                    if (on) {
                        // Complete disable ON: set all four type toggles to checked (disabled for all four duty types)
                        if (spEl) spEl.checked = true;
                        if (weEl) weEl.checked = true;
                        if (seEl) seEl.checked = true;
                        if (noEl) noEl.checked = true;
                    } else {
                        // Complete disable OFF: set all four to unchecked (enabled for all); user can then toggle individual types
                        if (spEl) spEl.checked = false;
                        if (weEl) weEl.checked = false;
                        if (seEl) seEl.checked = false;
                        if (noEl) noEl.checked = false;
                    }
                };
            }

            wirePersonActionsReopenListeners();
            reopenPersonActionsModalWhenClosed = true;
            const actionsModal = bootstrap.Modal.getInstance(document.getElementById('personActionsModal'));
            if (actionsModal) actionsModal.hide();
            const modal = new bootstrap.Modal(document.getElementById('disableSettingsModal'));
            modal.show();
        }
        function saveDisableSettings() {
            reopenPersonActionsModalWhenClosed = false;
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
            // Show Person Actions for the person we just edited (same as Cancel/close path)
            openPersonActionsModal(
                currentPersonActionsGroup,
                currentPersonActionsName,
                currentPersonActionsIndex != null ? currentPersonActionsIndex : 0,
                currentPersonActionsListType || 'normal'
            );
        }
        function openMissingDisabledPeopleModal() {
            const container = document.getElementById('missingDisabledPeopleList');
            if (!container) return;
            
            container.innerHTML = '';
            
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            let hasAnyPeople = false;
            
            // Iterate through all groups
            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                const groupData = groups[groupNum] || { special: [], weekend: [], semi: [], normal: [], lastDuties: {}, missingPeriods: {}, disabledPersons: {} };
                const allPeople = new Set();
                
                // Collect all people from all lists
                ['special', 'weekend', 'semi', 'normal'].forEach(listType => {
                    const list = groupData[listType] || [];
                    list.forEach(person => allPeople.add(person));
                });
                
                // Check for disabled people
                const disabledPeople = [];
                const disabledPersons = groupData.disabledPersons || {};
                allPeople.forEach(person => {
                    const disabledState = getDisabledState(groupNum, person);
                    if (disabledState.all || disabledState.special || disabledState.weekend || disabledState.semi || disabledState.normal) {
                        disabledPeople.push({ person, state: disabledState });
                    }
                });
                
                // Check for missing people
                const missingPeople = [];
                const missingPeriods = groupData.missingPeriods || {};
                allPeople.forEach(person => {
                    const periods = missingPeriods[person] || [];
                    const activePeriods = periods.filter(period => {
                        const start = new Date(period.start + 'T00:00:00');
                        const end = new Date(period.end + 'T00:00:00');
                        return today <= end; // Show if period hasn't ended yet
                    });
                    if (activePeriods.length > 0) {
                        missingPeople.push({ person, periods: activePeriods });
                    }
                });
                
                if (disabledPeople.length === 0 && missingPeople.length === 0) continue;
                
                hasAnyPeople = true;
                
                // Create group section
                const groupSection = document.createElement('div');
                groupSection.className = 'mb-4';
                groupSection.innerHTML = `
                    <h5 class="mb-3">
                        <i class="fas fa-users me-2"></i>${getGroupName(groupNum)}
                        <span class="badge bg-secondary ms-2">${disabledPeople.length + missingPeople.length} άτομα</span>
                    </h5>
                `;
                
                const peopleList = document.createElement('div');
                peopleList.className = 'list-group';
                
                // Add disabled people
                disabledPeople.forEach(({ person, state }) => {
                    const disabledTypes = [];
                    if (state.all) disabledTypes.push('Όλες');
                    if (state.special) disabledTypes.push('Ειδικές');
                    if (state.weekend) disabledTypes.push('Σαββατοκύριακα');
                    if (state.semi) disabledTypes.push('Ημιαργίες');
                    if (state.normal) disabledTypes.push('Καθημερινές');
                    
                    const item = document.createElement('div');
                    item.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center';
                    item.style.cursor = 'pointer';
                    item.innerHTML = `
                        <div class="flex-grow-1">
                            <strong>${person}</strong>
                            <span class="badge bg-danger ms-2">Απενεργοποιημένο</span>
                            <div class="text-muted small mt-1">
                                <i class="fas fa-info-circle me-1"></i>${disabledTypes.join(', ')}
                            </div>
                        </div>
                        <button class="btn btn-sm btn-outline-primary" onclick="editPersonStatus(${groupNum}, '${person.replace(/'/g, "\\'")}')">
                            <i class="fas fa-edit me-1"></i>Επεξεργασία
                        </button>
                    `;
                    peopleList.appendChild(item);
                });
                
                // Add missing people
                missingPeople.forEach(({ person, periods }) => {
                    const periodTexts = periods.map(period => {
                        const start = new Date(period.start + 'T00:00:00');
                        const end = new Date(period.end + 'T00:00:00');
                        const startStr = start.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        const endStr = end.toLocaleDateString('el-GR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                        const isActive = today >= start && today <= end;
                        const reason = (period.reason || '').trim();
                        const reasonText = reason ? ` - ${reason}` : '';
                        return `${startStr} - ${endStr}${isActive ? ' (Ενεργό)' : ' (Μέλλον)'}${reasonText}`;
                    }).join(', ');
                    
                    // Get all unique reasons for this person
                    const reasons = periods.map(p => (p.reason || '').trim()).filter(r => r.length > 0);
                    const uniqueReasons = [...new Set(reasons)];
                    const reasonDisplay = uniqueReasons.length > 0 ? uniqueReasons.join(', ') : 'Απουσία';
                    
                    const item = document.createElement('div');
                    item.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center';
                    item.style.cursor = 'pointer';
                    item.innerHTML = `
                        <div class="flex-grow-1">
                            <strong>${person}</strong>
                            <span class="badge bg-warning text-dark ms-2">${escapeHtml(reasonDisplay)}</span>
                            <div class="text-muted small mt-1">
                                <i class="fas fa-calendar-times me-1"></i>${periodTexts}
                            </div>
                        </div>
                        <button class="btn btn-sm btn-outline-primary" onclick="editPersonStatus(${groupNum}, '${person.replace(/'/g, "\\'")}')">
                            <i class="fas fa-edit me-1"></i>Επεξεργασία
                        </button>
                    `;
                    peopleList.appendChild(item);
                });
                
                groupSection.appendChild(peopleList);
                container.appendChild(groupSection);
            }
            
            if (!hasAnyPeople) {
                container.innerHTML = `
                    <div class="alert alert-success">
                        <i class="fas fa-check-circle me-2"></i>
                        <strong>Καμία εγγραφή!</strong> Δεν υπάρχουν απενεργοποιημένα ή απουσιάζοντα άτομα.
                    </div>
                `;
            }
            
            const modal = new bootstrap.Modal(document.getElementById('missingDisabledPeopleModal'));
            modal.show();
        }
        function editPersonStatus(groupNum, personName) {
            // Close the missing/disabled modal
            const missingModal = bootstrap.Modal.getInstance(document.getElementById('missingDisabledPeopleModal'));
            if (missingModal) missingModal.hide();
            
            // Check if person is disabled
            const disabledState = getDisabledState(groupNum, personName);
            const isDisabled = disabledState.all || disabledState.special || disabledState.weekend || disabledState.semi || disabledState.normal;
            
            // Check if person has missing periods
            const groupData = groups[groupNum] || {};
            const missingPeriods = groupData.missingPeriods?.[personName] || [];
            const hasMissingPeriods = missingPeriods.length > 0;
            
            if (isDisabled) {
                // Person is disabled - open disable settings modal (set full context so return goes to this person)
                currentPersonActionsGroup = groupNum;
                currentPersonActionsName = personName;
                let foundIndex = -1;
                let foundListType = null;
                ['special', 'weekend', 'semi', 'normal'].forEach(listType => {
                    const list = (groups[groupNum] || {})[listType] || [];
                    const idx = list.indexOf(personName);
                    if (idx >= 0 && foundIndex < 0) {
                        foundIndex = idx;
                        foundListType = listType;
                    }
                });
                currentPersonActionsIndex = foundIndex >= 0 ? foundIndex : 0;
                currentPersonActionsListType = foundListType || 'normal';
                openDisableSettingsFromActions();
            } else if (hasMissingPeriods) {
                // Person has missing periods - open missing period management (set full context so return goes to this person)
                currentPersonActionsGroup = groupNum;
                currentPersonActionsName = personName;
                let foundIndex = -1;
                let foundListType = null;
                ['special', 'weekend', 'semi', 'normal'].forEach(listType => {
                    const list = (groups[groupNum] || {})[listType] || [];
                    const idx = list.indexOf(personName);
                    if (idx >= 0 && foundIndex < 0) {
                        foundIndex = idx;
                        foundListType = listType;
                    }
                });
                currentPersonActionsIndex = foundIndex >= 0 ? foundIndex : 0;
                currentPersonActionsListType = foundListType || 'normal';
                openMissingPeriodModal(groupNum, personName);
            } else {
                // Neither disabled nor missing - open person actions modal
                const groupData = groups[groupNum] || {};
                let foundIndex = -1;
                let foundListType = null;
                
                ['special', 'weekend', 'semi', 'normal'].forEach(listType => {
                    const list = groupData[listType] || [];
                    const index = list.indexOf(personName);
                    if (index >= 0 && foundIndex < 0) {
                        foundIndex = index;
                        foundListType = listType;
                    }
                });
                
                if (foundIndex >= 0 && foundListType) {
                    currentPersonActionsIndex = foundIndex;
                    currentPersonActionsListType = foundListType;
                    openPersonActionsModal(groupNum, personName, foundIndex, foundListType);
                } else {
                    alert(`Το άτομο "${personName}" δεν βρέθηκε στις λίστες της ομάδας ${getGroupName(groupNum)}.`);
                }
            }
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
        function openEditPersonFromActions() {
            wirePersonActionsReopenListeners();
            reopenPersonActionsModalWhenClosed = true;
            const modal = bootstrap.Modal.getInstance(document.getElementById('personActionsModal'));
            modal.hide();
            editPerson(currentPersonActionsGroup, currentPersonActionsName);
        }
        function openMissingPeriodFromActions() {
            wirePersonActionsReopenListeners();
            reopenPersonActionsModalWhenClosed = true;
            const modal = bootstrap.Modal.getInstance(document.getElementById('personActionsModal'));
            modal.hide();
            openMissingPeriodModal(currentPersonActionsGroup, currentPersonActionsName);
        }
        function openTransferFromActions() {
            wirePersonActionsReopenListeners();
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
            const { fromGroup, index, listType, reopenActionsOnCancel } = pendingTransferTargetGroup;

            const modal = bootstrap.Modal.getInstance(document.getElementById('transferTargetGroupModal'));
            if (modal) modal.hide();

            if (reopenActionsOnCancel) reopenPersonActionsAfterTransferFlow = true;
            pendingTransferTargetGroup = null;

            if (!toGroup || toGroup === fromGroup || ![1, 2, 3, 4].includes(toGroup)) {
                alert('Μη έγκυρη επιλογή ομάδας');
                return;
            }

            transferPerson(fromGroup, index, toGroup, listType);
        }
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
        function getPersonDetails(personName) {
            for (let groupNum = 1; groupNum <= 4; groupNum++) {
                const group = groups[groupNum];
                if (group) {
                    const listTypes = ['special', 'weekend', 'semi', 'normal'];
                    for (const listType of listTypes) {
                        if (Array.isArray(group[listType])) {
                            const index = group[listType].indexOf(personName);
                            if (index >= 0) {
                                return { groupNum, index, listType };
                            }
                        }
                    }
                }
            }
            return null;
        }
        function filterPeopleSearch() {
            const input = document.getElementById('personSearchInput');
            const dropdown = document.getElementById('peopleSearchDropdown');
            if (!input || !dropdown) return;

            const searchTerm = (input.value || '').trim().toLowerCase();
            const allPeople = getAllPeople();
            
            let filtered;
            if (searchTerm.length === 0) {
                // Show all people when search is empty
                filtered = allPeople;
            } else {
                // Filter and prioritize: exact matches first, then starts with, then contains
                filtered = allPeople.map(person => {
                    const personLower = person.toLowerCase();
                    let score = 0;
                    if (personLower === searchTerm) {
                        score = 3; // Exact match
                    } else if (personLower.startsWith(searchTerm)) {
                        score = 2; // Starts with
                    } else if (personLower.includes(searchTerm)) {
                        score = 1; // Contains
                    } else {
                        return null; // No match
                    }
                    return { person, score };
                })
                .filter(item => item !== null)
                .sort((a, b) => b.score - a.score) // Sort by relevance
                .map(item => item.person)
                .slice(0, 50); // Limit to 50 results for better performance
            }

            if (filtered.length === 0) {
                dropdown.innerHTML = '<div class="dropdown-item-text text-muted">Δεν βρέθηκαν αποτελέσματα</div>';
                dropdown.style.display = 'block';
                return;
            }

            dropdown.innerHTML = filtered.map((person, index) => {
                const details = getPersonDetails(person);
                const groupName = details ? getGroupName(details.groupNum) : '';
                const escapedPerson = person.replace(/'/g, "\\'").replace(/"/g, '&quot;');
                return `
                    <a href="#" class="dropdown-item" data-person-name="${escapedPerson}" onclick="selectPersonFromSearch('${escapedPerson}'); return false;">
                        <div class="d-flex justify-content-between align-items-center">
                            <span><strong>${escapeHtml(person)}</strong></span>
                            ${groupName ? `<small class="text-muted">${groupName}</small>` : ''}
                        </div>
                    </a>
                `;
            }).join('');
            dropdown.style.display = 'block';
        }
        function showPeopleSearchDropdown() {
            const input = document.getElementById('personSearchInput');
            const dropdown = document.getElementById('peopleSearchDropdown');
            if (!input || !dropdown) return;
            
            // Always show dropdown with filtered/all people
            filterPeopleSearch();
        }
        function hidePeopleSearchDropdown() {
            const dropdown = document.getElementById('peopleSearchDropdown');
            if (dropdown) {
                dropdown.style.display = 'none';
            }
        }
        function selectPersonFromSearch(personName) {
            const input = document.getElementById('personSearchInput');
            const dropdown = document.getElementById('peopleSearchDropdown');
            
            if (input) input.value = '';
            if (dropdown) dropdown.style.display = 'none';

            const details = getPersonDetails(personName);
            if (details) {
                openPersonActionsModal(details.groupNum, personName, details.index, details.listType);
            } else {
                alert(`Το άτομο "${personName}" δεν βρέθηκε στις λίστες.`);
            }
        }
        function handlePersonSearchKeydown(event) {
            const dropdown = document.getElementById('peopleSearchDropdown');
            if (!dropdown) return;

            if (event.key === 'Escape') {
                hidePeopleSearchDropdown();
                const input = document.getElementById('personSearchInput');
                if (input) input.blur();
                return;
            }

            if (event.key === 'Enter') {
                event.preventDefault();
                const activeItem = dropdown.querySelector('.dropdown-item.active') || dropdown.querySelector('.dropdown-item');
                if (activeItem) {
                    const personName = activeItem.getAttribute('data-person-name') || activeItem.querySelector('strong')?.textContent?.trim();
                    if (personName) {
                        selectPersonFromSearch(personName);
                    }
                }
                return;
            }

            // Arrow key navigation
            const items = Array.from(dropdown.querySelectorAll('.dropdown-item'));
            if (items.length === 0) return;

            let currentIndex = items.findIndex(item => item.classList.contains('active'));
            
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                items.forEach(item => item.classList.remove('active'));
                const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
                items[nextIndex].classList.add('active');
                items[nextIndex].scrollIntoView({ block: 'nearest' });
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                items.forEach(item => item.classList.remove('active'));
                const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
                items[prevIndex].classList.add('active');
                items[prevIndex].scrollIntoView({ block: 'nearest' });
            }
        }
        // Expose person search functions to window for HTML handlers (data.js loads first and does not define these)
        if (typeof window !== 'undefined') {
            window.filterPeopleSearch = filterPeopleSearch;
            window.showPeopleSearchDropdown = showPeopleSearchDropdown;
            window.hidePeopleSearchDropdown = hidePeopleSearchDropdown;
            window.selectPersonFromSearch = selectPersonFromSearch;
            window.handlePersonSearchKeydown = handlePersonSearchKeydown;
        }
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
        function addHoliday() {
            document.getElementById('holidayDate').value = '';
            document.getElementById('holidayName').value = '';
            const modal = new bootstrap.Modal(document.getElementById('addHolidayModal'));
            modal.show();
        }
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
        function removeHoliday(index) {
            if (confirm('Είστε σίγουροι ότι θέλετε να αφαιρέσετε αυτή την αργία;')) {
                holidays.splice(index, 1);
                saveData();
                renderHolidays();
                renderCalendar();
            }
        }
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
        // Note: initializeDefaultSpecialHolidays, loadRecurringHolidaysConfig, and saveRecurringHolidaysConfig 
        // are now defined in duty-shifts-data.js
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
        function addSpecialHoliday() {
            document.getElementById('specialHolidayDate').value = '';
            document.getElementById('specialHolidayName').value = '';
            const modal = new bootstrap.Modal(document.getElementById('addSpecialHolidayModal'));
            modal.show();
        }
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
        function removeSpecialHoliday(index) {
            if (confirm('Είστε σίγουροι ότι θέλετε να αφαιρέσετε αυτή την ειδική αργία;')) {
                specialHolidays.splice(index, 1);
                saveData();
                renderCalendar();
            }
        }
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
        function renderCalendar() {
            const calendarGrid = document.getElementById('calendarGrid');
            const currentMonthYear = document.getElementById('currentMonthYear');
            
            if (!calendarGrid || !currentMonthYear) {
                console.error('Calendar elements not found');
                return;
            }

            _attachCalendarMonthPickerClick();
            
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
                
                // Parse assignment, sort by hierarchy (lower rank = higher = first), then display with numbering
                let displayAssignmentHtml = '';
                if (assignment) {
                    const assignmentStr = typeof assignment === 'string' ? assignment : String(assignment);
                    const parts = assignmentStr.split(',').map(p => p.trim()).filter(p => p);
                    if (parts.length > 0) {
                        const dayTypeCategory = (dayType === 'special-holiday')
                            ? 'special'
                            : (dayType === 'weekend-holiday')
                                ? 'weekend'
                                : (dayType === 'semi-normal-day')
                                    ? 'semi'
                                    : 'normal';
                        const dateObj = new Date(key + 'T00:00:00');
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
                        const entries = [];
                        for (const part of parts) {
                            const m = part.match(/^(.+?)\s*\(Ομάδα\s*(\d+)\)\s*$/);
                            const nameOnly = part.replace(/\s*\(Ομάδα\s*\d+\)\s*/g, '').trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '');
                            const personName = m ? m[1].trim().replace(/^,+\s*/, '').replace(/\s*,+$/, '') : nameOnly;
                            const g = m ? parseInt(m[2], 10) : 0;
                            const rank = Number.isFinite(parseInt(rankings?.[personName], 10)) ? parseInt(rankings[personName], 10) : 9999;
                            let underline = false;
                            let isSwap = false;
                            let swapStyle = '';
                            if (personName && g >= 1 && g <= 4) {
                                const r = getAssignmentReason(key, g, personName);
                                if (r && r.type === 'swap') {
                                    isSwap = true;
                                    const pidRaw = r.swapPairId;
                                    const pid = typeof pidRaw === 'number' ? pidRaw : parseInt(pidRaw, 10);
                                    const c = swapColors[(isNaN(pid) ? 0 : pid) % swapColors.length];
                                    swapStyle = `border: 2px solid ${c.border}; background-color: ${c.bg};`;
                                }
                                if (r && r.type === 'skip') {
                                    underline = true;
                                } else if (r && r.type === 'shift') {
                                    underline = false;
                                } else if (!r) {
                                    const baselineStr = getRotationBaselineAssignmentForType(dayTypeCategory, key);
                                    const baselinePerson = parseAssignedPersonForGroupFromAssignment(baselineStr, g);
                                    if (baselinePerson && baselinePerson !== personName) {
                                        const shiftCheck = getAssignmentReason(key, g, personName);
                                        if (shiftCheck && shiftCheck.type === 'shift') {
                                            underline = false;
                                        } else {
                                            const isBaselineDisabledOrMissing = dayTypeCategory === 'normal' &&
                                                (isPersonDisabledForDuty(baselinePerson, g, dayTypeCategory) ||
                                                 isPersonMissingOnDate(baselinePerson, g, dateObj, dayTypeCategory));
                                            underline = !isBaselineDisabledOrMissing;
                                        }
                                    }
                                }
                            }
                            entries.push({ personName, nameOnly, rank, underline, isSwap, swapStyle, groupNum: g });
                        }
                        // Store hierarchy-ordered entries for popup (sorted by rank) - do this BEFORE sorting by group
                        const hierarchyOrderedEntries = [...entries].sort((a, b) => (a.rank - b.rank) || (a.personName || '').localeCompare(b.personName || ''));
                        const hierarchyData = JSON.stringify(hierarchyOrderedEntries.map(e => ({ name: e.nameOnly, rank: e.rank })));
                        // Sort by group order (1, 2, 3, 4) for display
                        const entriesByGroup = [...entries].sort((a, b) => {
                            const groupA = a.groupNum || 999;
                            const groupB = b.groupNum || 999;
                            return groupA - groupB;
                        });
                        
                        displayAssignmentHtml = '<div class="duty-person-container" data-hierarchy-order="' + escapeHtml(hierarchyData) + '">';
                        entriesByGroup.forEach((e, idx) => {
                            const cls = e.isSwap ? 'duty-person-swapped' : 'duty-person';
                            const groupDisplay = e.groupNum && e.groupNum >= 1 && e.groupNum <= 4 ? e.groupNum : '';
                            displayAssignmentHtml += `<div class="${cls}${e.underline ? ' duty-person-replacement' : ''}" ${e.swapStyle ? `style="${e.swapStyle}"` : ''}>${groupDisplay}. ${e.nameOnly}</div>`;
                        });
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
                
                // Add hover handler with 1 second delay for popup
                let hoverTimeout = null;
                const container = dayDiv.querySelector('.duty-person-container');
                if (container && container.getAttribute('data-hierarchy-order')) {
                    dayDiv.addEventListener('mouseenter', (e) => {
                        hoverTimeout = setTimeout(() => {
                            showHierarchyPopup(dayDiv, container);
                        }, 1000);
                    });
                    dayDiv.addEventListener('mouseleave', (e) => {
                        if (hoverTimeout) {
                            clearTimeout(hoverTimeout);
                            hoverTimeout = null;
                        }
                        hideHierarchyPopup();
                    });
                }
                
                frag.appendChild(dayDiv);
            }
            
            grid.appendChild(frag);
        }
        function showHierarchyPopup(dayDiv, container) {
            // Remove existing popup if any
            if (hierarchyPopup) {
                hierarchyPopup.remove();
            }
            
            const hierarchyData = container.getAttribute('data-hierarchy-order');
            if (!hierarchyData) return;
            
            try {
                const entries = JSON.parse(hierarchyData);
                if (!entries || entries.length === 0) return;
                
                // Create popup element
                hierarchyPopup = document.createElement('div');
                hierarchyPopup.className = 'hierarchy-popup';
                hierarchyPopup.innerHTML = '<div class="hierarchy-popup-content"><div class="hierarchy-popup-title">Ιεραρχική Σειρά</div><div class="hierarchy-popup-list">' +
                    entries.map((e, idx) => `<div class="hierarchy-popup-item">${idx + 1}. ${escapeHtml(e.name)}</div>`).join('') +
                    '</div></div>';
                
                document.body.appendChild(hierarchyPopup);
                
                // Position popup near the cell
                const rect = dayDiv.getBoundingClientRect();
                const popupRect = hierarchyPopup.getBoundingClientRect();
                const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
                const scrollY = window.pageYOffset || document.documentElement.scrollTop;
                
                // Position to the right of the cell, or left if not enough space
                let left = rect.right + 10;
                if (left + popupRect.width > window.innerWidth) {
                    left = rect.left - popupRect.width - 10;
                }
                
                // Position vertically centered on cell, or adjust if near edges
                let top = rect.top + (rect.height / 2) - (popupRect.height / 2);
                if (top < scrollY + 10) {
                    top = scrollY + 10;
                } else if (top + popupRect.height > scrollY + window.innerHeight - 10) {
                    top = scrollY + window.innerHeight - popupRect.height - 10;
                }
                
                hierarchyPopup.style.left = left + 'px';
                hierarchyPopup.style.top = top + 'px';
                
                // Trigger zoom animation
                setTimeout(() => {
                    if (hierarchyPopup) {
                        hierarchyPopup.classList.add('hierarchy-popup-visible');
                    }
                }, 10);
            } catch (error) {
                console.error('Error showing hierarchy popup:', error);
            }
        }
        function hideHierarchyPopup() {
            if (hierarchyPopup) {
                hierarchyPopup.classList.remove('hierarchy-popup-visible');
                setTimeout(() => {
                    if (hierarchyPopup) {
                        hierarchyPopup.remove();
                        hierarchyPopup = null;
                    }
                }, 300); // Wait for fade-out animation
            }
        }
        function getDayTypeLabel(dayType) {
            switch(dayType) {
                case 'special-holiday': return 'Ειδική';
                case 'normal-day': return 'Καθημερινή';
                case 'semi-normal-day': return 'Ημιαργία';
                case 'weekend-holiday': return 'Σαββατοκύριακο/Αργία';
                default: return '';
            }
        }
        function isWeekAfterNext(date1, date2) {
            const week1Start = getWeekStart(date1);
            const week2Start = getWeekStart(date2);
            
            // Calculate difference in weeks
            const diffInMs = week2Start - week1Start;
            const diffInWeeks = Math.floor(diffInMs / (7 * 24 * 60 * 60 * 1000));
            
            // Week after next means exactly 2 weeks later
            return diffInWeeks === 2;
        }
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
        function getWeekStart(date) {
            const d = new Date(date);
            const dayOfWeek = d.getDay();
            const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
            d.setDate(d.getDate() + diff);
            d.setHours(0, 0, 0, 0);
            return d;
        }
        function previousMonth() {
            currentDate.setDate(1);
            currentDate.setMonth(currentDate.getMonth() - 1);
            renderCalendar();
        }
        function nextMonth() {
            currentDate.setDate(1);
            currentDate.setMonth(currentDate.getMonth() + 1);
            renderCalendar();
        }

        // Greek month names for calendar month picker (el-GR long)
        const GREEK_MONTH_NAMES = (() => {
            const names = [];
            for (let m = 0; m < 12; m++) {
                names.push(new Date(2024, m, 1).toLocaleDateString('el-GR', { month: 'long' }));
            }
            return names;
        })();

        let _calendarMonthPickerAttached = false;
        function openCalendarMonthPicker() {
            const modalEl = document.getElementById('calendarMonthPickerModal');
            const yearEl = document.getElementById('calendarMonthPickerYear');
            const monthsEl = document.getElementById('calendarMonthPickerMonths');
            if (!modalEl || !yearEl || !monthsEl) return;

            let pickerYear = currentDate.getFullYear();
            function renderPickerMonths() {
                yearEl.textContent = pickerYear;
                monthsEl.innerHTML = '';
                GREEK_MONTH_NAMES.forEach((name, index) => {
                    const col = document.createElement('div');
                    col.className = 'col-4';
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'btn btn-outline-primary w-100';
                    btn.textContent = name;
                    btn.dataset.month = String(index);
                    btn.dataset.year = String(pickerYear);
                    btn.addEventListener('click', () => {
                        currentDate.setFullYear(pickerYear);
                        currentDate.setMonth(index);
                        currentDate.setDate(1);
                        const m = bootstrap.Modal.getInstance(modalEl);
                        if (m) m.hide();
                        renderCalendar();
                    });
                    col.appendChild(btn);
                    monthsEl.appendChild(col);
                });
            }

            document.getElementById('calendarMonthPickerPrevYear').onclick = () => {
                pickerYear--;
                renderPickerMonths();
            };
            document.getElementById('calendarMonthPickerNextYear').onclick = () => {
                pickerYear++;
                renderPickerMonths();
            };

            pickerYear = currentDate.getFullYear();
            renderPickerMonths();
            const modal = new bootstrap.Modal(modalEl);
            modal.show();
        }

        function _attachCalendarMonthPickerClick() {
            if (_calendarMonthPickerAttached) return;
            const currentMonthYear = document.getElementById('currentMonthYear');
            if (!currentMonthYear) return;
            _calendarMonthPickerAttached = true;
            currentMonthYear.addEventListener('click', openCalendarMonthPicker);
            currentMonthYear.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openCalendarMonthPicker();
                }
            });
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
        function showStepByStepCalculation() {
            calculationSteps.currentStep = 1;
            renderCurrentStep();
            const modal = new bootstrap.Modal(document.getElementById('stepByStepCalculationModal'));
            modal.show();
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
                
                // Get day type color for theme
                const dayTypeColor = getDayTypeColor(dayType);
                const rgbColor = `rgb(${dayTypeColor[0]}, ${dayTypeColor[1]}, ${dayTypeColor[2]})`;
                const hexColor = '#' + dayTypeColor.map(c => c.toString(16).padStart(2, '0')).join('').toUpperCase();
                const darkerShade = dayTypeColor.map(c => Math.max(0, c - 30));
                const darkerRgb = `rgb(${darkerShade[0]}, ${darkerShade[1]}, ${darkerShade[2]})`;

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
                
                // Apply day type color theme to modal header
                const modalHeader = modalElement.querySelector('.modal-header');
                if (modalHeader) {
                    modalHeader.style.background = `linear-gradient(135deg, ${rgbColor} 0%, ${darkerRgb} 100%)`;
                }
            
            let content = `
                <div class="mb-3">
                    <div class="day-type-label" style="background: linear-gradient(135deg, ${hexColor}15 0%, ${hexColor}25 100%); border: 2px solid ${hexColor}40;">
                        <i class="fas fa-calendar-check me-2" style="color: #000000;"></i><strong style="color: #000000;">Τύπος Ημέρας:</strong> <span style="color: #000000;">${getDayTypeLabel(dayType)}</span>
                    </div>
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
                    <div class="section-title" style="border-bottom-color: ${hexColor};">
                        <i class="fas fa-user-shield" style="color: #000000;"></i>
                        <span style="color: #000000; font-weight: 800;">Σε Υπηρεσία</span>
                    </div>
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
                        reasonBadge = `<span class="badge bg-warning ms-2" title="${displayReason}"><i class="fas fa-user-check me-1"></i>Αντικατάσταση</span>`;
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
                    ? `<div class="mt-1 reason-card small text-muted"><i class="fas fa-info-circle me-1"></i><strong>Λόγος:</strong> ${reasonDisplayText}</div>`
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
                    <div class="mb-3 border rounded duty-person-card ${criticalClass}" ${disabledTitle}>
                        <label class="form-label">Ομάδα ${person.group}: ${groupName}${criticalLabel}${reasonBadge}</label>
                        <select class="form-select duty-person-select" 
                                data-index="${index}" 
                                data-group="${person.group}" 
                                data-original-name="${person.name || ''}"
                                data-is-critical="${isCritical ? 'true' : 'false'}"
                                ${disabledAttr}>
                            ${peopleOptions}
                        </select>
                        ${reasonDisplay}
                        ${isCritical ? '<small class="text-muted d-block mt-2"><i class="fas fa-info-circle me-1"></i>Αυτή η ανάθεση προέρχεται από τις ημερομηνίες τελευταίας υπηρεσίας και δεν μπορεί να αλλάξει.</small>' : ''}
                    </div>
                `;
            });
            
            content += `
                    </div>
                </div>
            `;
            
            // Swap details section removed - information is already shown in individual group cards
            
                document.getElementById('dayDetailsContent').innerHTML = content;
                
                // Buttons are now in the modal footer, no need to show/hide them
                modal.show();
            } catch (error) {
                console.error('Error in showDayDetails:', error);
                alert('Σφάλμα: ' + error.message);
            }
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
            showConfirmModal({
                title: 'Επιβεβαίωση',
                message: 'Είστε σίγουροι ότι θέλετε να αφαιρέσετε αυτή την περίοδο απουσίας;',
                onConfirm: function () {
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
            });
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
        function updateStatistics() {
            let totalPeople = 0;
            const statIds = { 1: 'statAym', 2: 'statDta', 3: 'statAw139', 4: 'statEpigeia' };
            
            for (let i = 1; i <= 4; i++) {
                const groupData = groups[i] || { special: [], weekend: [], semi: [], normal: [], lastDuties: {} };
                const specialList = groupData.special || [];
                const weekendList = groupData.weekend || [];
                const semiList = groupData.semi || [];
                const normalList = groupData.normal || [];
                const uniquePeople = new Set([...specialList, ...weekendList, ...semiList, ...normalList]);
                const peopleCount = uniquePeople.size;
                totalPeople += peopleCount;
                
                const el = document.getElementById(statIds[i]);
                if (el) el.textContent = peopleCount;
            }
            
            const totalEl = document.getElementById('totalPeople');
            if (totalEl) totalEl.textContent = totalPeople;
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
            // Create a new window for printing
            const printWindow = window.open('', '_blank', 'width=800,height=600');
            
            // Get all people for rankings
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
            
            // Build HTML: one page per duty type (all 4 groups), then hierarchy page
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
            
            // One page per duty type: all four groups on that page
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
            
            // Hierarchy on its own page
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