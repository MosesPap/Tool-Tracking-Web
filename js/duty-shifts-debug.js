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
        PHASE_SKIPPED: 'Η φάση δεν εφαρμόστηκε'
    };

    const state = {
        enabled: false,
        entries: [],
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
                    slot.skippedPerson
                ]
                    .filter(Boolean)
                    .map(normPerson);
                if (!hay.includes(n)) return false;
            }
        }
        return true;
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
        slot.outcome = outcome || {};
        state.entries.push(slot);
        state.currentSlot = null;
    }

    function clear() {
        state.entries = [];
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

    function renderPanel() {
        readFilterFromDom();
        const entries = state.entries.filter((e) => matchesFilter(e.dateKey, e.groupNum, e.meta?.baseline));
        let body = '';
        if (!entries.length) {
            body = '<p class="text-muted mb-0">Δεν υπάρχουν εγγραφές (ενεργοποιήστε debug, τρέξτε Βήμα 2 και πατήστε Επόμενο για skip logic).</p>';
        } else {
            body = '<div class="accordion" id="dutyWeekendDebugAccordion">';
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
                    · <strong>Πριν:</strong> ${escapeHtml(m.currentPerson || '—')}
                    · <strong>Μετά:</strong> ${escapeHtml(String(finalP))}</p>`;
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
                const blob = new Blob([JSON.stringify(state.entries, null, 2)], { type: 'application/json' });
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
                    <span class="text-muted small">Καταγράφει γιατί δεν ανατίθεται αντικαταστάτης όταν κάποιος απουσιάζει. Δεν αφορά ειδικές αργίες.</span>
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
        }
    };
})();
