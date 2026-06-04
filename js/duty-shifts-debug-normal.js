// ============================================================================
// Καθημερινές (normal) — debug Βήμα 4
// ============================================================================
(function () {
    const STORAGE_KEY = 'dutyNormalDebug';
    const DUTY = 'normal';

    const REASON_LABELS = {
        UNAVAILABLE_REPLACEMENT: 'Αντικατάσταση λόγω απουσίας/απενεργοποίησης την ημέρα',
        RETURN_NO_MISSED_NORMAL: 'Δεν βρέθηκε καθημερινή (baseline) στην περίοδο απουσίας',
        RETURN_NO_SLOT: 'Δεν βρέθηκε ελεύθερη καθημερινή για επανένταξη',
        RETURN_DEFERRED: 'Αναβλήθηκε για επόμενο μήνα υπολογισμού',
        RETURN_SHIFT_FAILED: 'Αποτυχία αλυσίδας shift',
        RETURN_APPLIED: 'Επανένταξη μετά από 3 καθημερινές (track Δε/Τε ή Τρ/Πε)',
        RETURN_NEVER_PLANNED: 'Απουσία σε καθημερινή χωρίς return-from-missing'
    };

    const state = {
        enabled: false,
        unavailableReplacements: [],
        returnPlans: [],
        filter: { dateKey: null, groupNum: null, personName: null }
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

    function setEnabled(on) {
        state.enabled = !!on;
        try {
            if (on) localStorage.setItem(STORAGE_KEY, '1');
            else localStorage.removeItem(STORAGE_KEY);
        } catch (_) {}
    }

    function clear() {
        state.unavailableReplacements = [];
        state.returnPlans = [];
    }

    function reasonLabels(codes) {
        return (codes || []).map((c) => REASON_LABELS[c] || c).join('; ');
    }

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function recordUnavailableReplacement(rec) {
        if (!isEnabled()) return;
        state.unavailableReplacements.push({ ...rec, t: Date.now() });
    }

    function recordReturnFromMissingPlan(rec) {
        if (!isEnabled()) return;
        const key = `${rec.groupNum}|${normPerson(rec.personName)}|${rec.pEndKey || ''}`;
        const idx = state.returnPlans.findIndex((p) => p.id === key);
        const row = { id: key, ...rec, t: Date.now() };
        if (idx >= 0) state.returnPlans[idx] = row;
        else state.returnPlans.push(row);
    }

    function finalizeMissedNormalAbsences(ctx) {
        if (!isEnabled() || !ctx) return;
        const { sortedNormal, pureBaselineByDate, assignmentsByDate, calcStartKey, calcEndKey } = ctx;
        if (!Array.isArray(sortedNormal) || typeof groups === 'undefined') return;
        for (let groupNum = 1; groupNum <= 4; groupNum++) {
            const g = groups[groupNum];
            const missingMap = g?.missingPeriods || {};
            for (const personName of Object.keys(missingMap || {})) {
                const periods = Array.isArray(missingMap[personName]) ? missingMap[personName] : [];
                for (const period of periods) {
                    const pEndKey =
                        typeof inputValueToDateKey === 'function' ? inputValueToDateKey(period?.end) : null;
                    if (!pEndKey) continue;
                    const id = `${groupNum}|${normPerson(personName)}|${pEndKey}`;
                    if (state.returnPlans.some((p) => p.id === id)) continue;
                    let missed = null;
                    for (const dk of sortedNormal) {
                        if (calcStartKey && dk < calcStartKey) continue;
                        if (calcEndKey && dk > calcEndKey) continue;
                        const baseline = pureBaselineByDate?.[dk]?.[groupNum] || null;
                        if (baseline && normPerson(baseline) === normPerson(personName)) {
                            missed = dk;
                            break;
                        }
                    }
                    if (!missed) continue;
                    const assigned = assignmentsByDate?.[missed]?.[groupNum] || null;
                    if (assigned && normPerson(assigned) !== normPerson(personName)) continue;
                    recordReturnFromMissingPlan({
                        personName,
                        groupNum,
                        pEndKey,
                        firstMissedKey: missed,
                        targetKey: null,
                        status: 'unresolved',
                        reasonCode: 'RETURN_NEVER_PLANNED',
                        message: 'Υπήρχε baseline καθημερινή αλλά δεν προγραμματίστηκε return-from-missing στο preview'
                    });
                }
            }
        }
    }

    function renderPanel() {
        const dkEl = document.getElementById('dutyNormalDebugFilterDate');
        const gnEl = document.getElementById('dutyNormalDebugFilterGroup');
        const pnEl = document.getElementById('dutyNormalDebugFilterPerson');
        state.filter = {
            dateKey: dkEl?.value?.trim() || null,
            groupNum: gnEl?.value ? parseInt(gnEl.value, 10) : null,
            personName: pnEl?.value?.trim() || null
        };
        const f = state.filter;
        const matchPerson = (name) => !f.personName || normPerson(name) === normPerson(f.personName);
        const matchGroup = (g) => f.groupNum == null || Number(f.groupNum) === Number(g);
        const matchDate = (dk) => !f.dateKey || dk === f.dateKey;

        let body = '<h6 class="mb-2"><i class="fas fa-user-clock me-1"></i>Return-from-missing (καθημερινές)</h6>';
        const plans = state.returnPlans.filter(
            (p) => matchGroup(p.groupNum) && matchPerson(p.personName) && (!f.dateKey || matchDate(p.firstMissedKey) || matchDate(p.targetKey))
        );
        if (!plans.length) {
            body += '<p class="text-muted small mb-3">Δεν υπάρχουν καταχωρήσεις return-from-missing.</p>';
        } else {
            body +=
                '<div class="table-responsive mb-4"><table class="table table-sm table-bordered"><thead class="table-warning"><tr>';
            body +=
                '<th>Άτομο</th><th>Ομ.</th><th>Χάθηκε</th><th>Στόχος</th><th>Κατάσταση</th><th>Λόγος</th></tr></thead><tbody>';
            plans.forEach((p) => {
                body += `<tr><td>${escapeHtml(p.personName)}</td><td>${p.groupNum}</td>`;
                body += `<td>${escapeHtml(p.firstMissedKey || '—')}</td><td>${escapeHtml(p.targetKey || '—')}</td>`;
                body += `<td>${escapeHtml(p.status || '—')}</td>`;
                body += `<td><small>${escapeHtml(reasonLabels([p.reasonCode]))}${p.message ? '<br>' + escapeHtml(p.message) : ''}</small></td></tr>`;
            });
            body += '</tbody></table></div>';
        }

        body += '<h6 class="mb-2"><i class="fas fa-exchange-alt me-1"></i>Αντικαταστάσεις απουσίας (preview)</h6>';
        const reps = state.unavailableReplacements.filter(
            (r) => matchGroup(r.groupNum) && matchDate(r.dateKey) && (matchPerson(r.skippedPerson) || matchPerson(r.replacement))
        );
        if (!reps.length) {
            body += '<p class="text-muted small">Δεν καταγράφηκαν αντικαταστάσεις στο preview.</p>';
        } else {
            body +=
                '<div class="table-responsive"><table class="table table-sm table-bordered"><thead class="table-light"><tr>';
            body += '<th>Ημ.</th><th>Ομ.</th><th>Απόντας (baseline)</th><th>Αντικαταστάτης</th><th>Σειρά</th></tr></thead><tbody>';
            reps.forEach((r) => {
                body += `<tr><td>${escapeHtml(r.dateKey)}</td><td>${r.groupNum}</td>`;
                body += `<td>${escapeHtml(r.skippedPerson || '—')}</td><td>${escapeHtml(r.replacement || '—')}</td>`;
                body += `<td>${escapeHtml(r.rotationPerson || '—')}</td></tr>`;
            });
            body += '</tbody></table></div>';
        }

        const modalId = 'dutyNormalDebugModal';
        let el = document.getElementById(modalId);
        if (!el) {
            document.body.insertAdjacentHTML(
                'beforeend',
                `<div class="modal fade" id="${modalId}" tabindex="-1"><div class="modal-dialog modal-xl modal-dialog-scrollable">
                <div class="modal-content"><div class="modal-header bg-primary-subtle">
                <h5 class="modal-title"><i class="fas fa-bug me-2"></i>Debug καθημερινών</h5>
                <button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
                <div class="modal-body" id="dutyNormalDebugModalBody"></div>
                <div class="modal-footer">
                <button type="button" class="btn btn-outline-secondary btn-sm" id="dutyNormalDebugExportBtn">Εξαγωγή JSON</button>
                <button type="button" class="btn btn-outline-danger btn-sm" id="dutyNormalDebugClearBtn">Καθαρισμός</button>
                <button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Κλείσιμο</button>
                </div></div></div></div>`
            );
            el = document.getElementById(modalId);
            document.getElementById('dutyNormalDebugExportBtn').onclick = () => {
                const blob = new Blob(
                    [JSON.stringify({ returnPlans: state.returnPlans, unavailableReplacements: state.unavailableReplacements }, null, 2)],
                    { type: 'application/json' }
                );
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `duty-normal-debug-${Date.now()}.json`;
                a.click();
            };
            document.getElementById('dutyNormalDebugClearBtn').onclick = () => {
                clear();
                renderPanel();
            };
        }
        document.getElementById('dutyNormalDebugModalBody').innerHTML =
            `<div class="row g-2 mb-3">
            <div class="col-md-4"><label class="form-label small">Ημερομηνία</label>
            <input type="text" class="form-control form-control-sm" id="dutyNormalDebugFilterDate" placeholder="2026-06-19"></div>
            <div class="col-md-2"><label class="form-label small">Ομάδα</label>
            <input type="number" min="1" max="4" class="form-control form-control-sm" id="dutyNormalDebugFilterGroup"></div>
            <div class="col-md-4"><label class="form-label small">Όνομα</label>
            <input type="text" class="form-control form-control-sm" id="dutyNormalDebugFilterPerson"></div>
            <div class="col-md-2 d-flex align-items-end"><button type="button" class="btn btn-primary btn-sm w-100" id="dutyNormalDebugRefilterBtn">Φίλτρο</button></div>
            </div>` + body;
        document.getElementById('dutyNormalDebugRefilterBtn').onclick = () => renderPanel();
        bootstrap.Modal.getOrCreateInstance(el).show();
    }

    function getDebugToolbarHtml() {
        const checked = isEnabled() ? ' checked' : '';
        return `<div class="card border-primary mb-3 duty-normal-debug-toolbar">
            <div class="card-body py-2">
                <div class="d-flex flex-wrap align-items-center gap-3">
                    <div class="form-check mb-0">
                        <input class="form-check-input" type="checkbox" id="dutyNormalDebugCheckbox"${checked}>
                        <label class="form-check-label" for="dutyNormalDebugCheckbox">
                            <i class="fas fa-bug me-1"></i>Αναλυτικό debug (καθημερινές)
                        </label>
                    </div>
                    <button type="button" class="btn btn-outline-primary btn-sm" id="dutyNormalDebugViewBtn">
                        <i class="fas fa-list me-1"></i>Προβολή log
                    </button>
                    <span class="text-muted small">Αντικατάσταση την ημέρα απουσίας + return-from-missing (Δε/Τε, Τρ/Πε). Βήμα 4.</span>
                </div>
            </div>
        </div>`;
    }

    function wireToolbar() {
        const cb = document.getElementById('dutyNormalDebugCheckbox');
        const btn = document.getElementById('dutyNormalDebugViewBtn');
        if (cb) {
            cb.checked = isEnabled();
            cb.onchange = () => {
                setEnabled(cb.checked);
                if (cb.checked) clear();
            };
        }
        if (btn) btn.onclick = () => renderPanel();
    }

    window.dutyNormalDebug = {
        isEnabled,
        setEnabled,
        clear,
        recordUnavailableReplacement,
        recordReturnFromMissingPlan,
        finalizeMissedNormalAbsences,
        REASON_LABELS,
        renderPanel,
        getDebugToolbarHtml,
        wireToolbar
    };
})();
