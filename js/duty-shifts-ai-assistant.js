// ============================================================================
// DUTY-SHIFTS-AI-ASSISTANT.JS - Free local manual-based assistant
// ============================================================================
(function () {
    const MANUAL_SECTIONS = [
        {
            id: 'manual-alternate-replacement',
            title: 'Αντικατάσταση Επιλαχών (βήμα-βήμα)',
            keywords:
                'επιλαχών επιλαχοντα επιλαχόντα επιλαχόντες επιλαχώντα αντικατάσταση επιλαχόντα αντικατάσταση επιλαχών χειροκίνητη αντικατάσταση επιλαχών Ενέργειες Ατόμου αναζήτηση ατόμου αναζητηση ατομου person actions',
            content:
                'Για αντικατάσταση επιλαχών: 1) «Ενέργειες Ατόμου»: κλικ στο άτομο στη λίστα ομάδας *ή* πεδίο «Αναζήτηση ατόμου…», επιλογή αποτελέσματος (ή Enter στο πρώτο). 2) «Αντικατάσταση Επιλαχών». 3) Ημερομηνία (υπάρχει ανάθεση εκείνη την ημέρα, το άτομο ανατεθειμένο στην ομάδα του). 4) «Εφαρμογή». Ο επιλαχών: επόμενο διαθέσιμο στη λίστα τύπου ημέρας, κυκλικά. Έλεγχος διαδοχικών· δεν είναι επιστροφή από απουσία. Λεπτομέρειες: DUTY_SHIFTS_MANUAL.md §5.3–§5.4.'
        },
        {
            id: 'calendar-basics',
            title: 'Ημερολόγιο: βασική χρήση',
            content:
                'Πλοήγηση μήνα με βελάκια ή επιλογέα μήνα. Το Κλείδωμα μήνα αποτρέπει εκκίνηση υπολογισμού για τον μήνα. Το Μόνο απόντες/απενεργ. δείχνει μόνο μη διαθέσιμους και με hover εμφανίζεται πλήρης λίστα.'
        },
        {
            id: 'person-actions',
            title: 'Ενέργειες ατόμου',
            content:
                '«Ενέργειες Ατόμου»: κλικ στο άτομο στη λίστα ομάδας *ή* «Αναζήτηση ατόμου…» → επιλογή από αποτελέσματα (ή Enter στο πρώτο). Modal: Επεξεργασία, Αντικατάσταση Επιλαχών (§5.4), Απενεργοποίηση, Περίοδοι απουσίας, Αλλαγή ομάδας, Διαγραφή.'
        },
        {
            id: 'calculation-run',
            title: 'Πώς κάνω υπολογισμό υπηρεσιών',
            keywords:
                'υπολογισμος υπολογισω υπηρεσιες υπολογισμος υπηρεσιων εκκινηση υπολογισμου βηματα special weekend semi normal',
            content:
                'Από «Υπολογισμός Υπηρεσιών» επιλέγετε διάστημα και ξεκινάτε υπολογισμό. Η ροή τρέχει σε 4 βήματα (special, weekend, semi, normal), εμφανίζει αποτελέσματα ανά βήμα και αποθηκεύει τις αναθέσεις.'
        },
        {
            id: 'calculation-isolated-groups',
            title: 'Υπολογισμός χωρίς αλλαγή στις άλλες ομάδες',
            keywords:
                'χωρις να αλλαξουν οι αλλες ομαδες μονο επιλεγμενες ομαδες επιλογη ομαδων strip manual override preserve existing επανυπολογισμος ομαδων',
            content:
                'Στο modal «Υπολογισμός Υπηρεσιών» επιλέγετε συγκεκριμένες ομάδες. Ο επανυπολογισμός αγνοεί χειροκίνητες παρεμβάσεις μόνο για τις επιλεγμένες ομάδες, ενώ οι υπόλοιπες ομάδες μένουν ως έχουν. Αν δεν επιλεγεί ομάδα, οι χειροκίνητες αντικαταστάσεις διατηρούνται.'
        },
        {
            id: 'missing-disabled',
            title: 'Απουσίες και απενεργοποιήσεις',
            content:
                'Οι απουσίες καταχωρούνται ως εύρος ημερομηνιών με λόγο. Οι απενεργοποιήσεις μπορούν να είναι ειδικές/συνολικές ανά duty category. Υπάρχουν προειδοποιήσεις για buffer ημέρες πριν/μετά από περίοδο απουσίας.'
        },
        {
            id: 'calculation-flow',
            title: 'Υπολογισμός υπηρεσιών (βήματα)',
            keywords:
                'υπολογισμος υπηρεσιων υπολογισω υπηρεσιες βηματα calculation flow special weekend semi normal',
            content:
                'Ο υπολογισμός τρέχει σε 4 βήματα: special, weekend, semi, normal. Κάθε βήμα εμφανίζει αποτελέσματα και αποθηκεύει προσωρινά assignments. Υπάρχει υποστήριξη multi-month συνέχειας.'
        },
        {
            id: 'normal-swap-default',
            title: 'Swap καθημερινών: προεπιλογή',
            content:
                'Προεπιλογή: Monday↔Wednesday και Tuesday↔Thursday για επίλυση συγκρούσεων. Η εγκυρότητα ελέγχει νέες συγκρούσεις, missing, disabled και buffer-day περιορισμούς.'
        },
        {
            id: 'normal-swap-settings',
            title: 'Ρυθμίσεις swap ανά ομάδα',
            content:
                'Από Ρυθμίσεις μπορείτε να εξαιρέσετε ομάδες από τη λογική Mon/Wed Tue/Thu. Για εξαιρούμενες ομάδες εφαρμόζεται swap στην πιο κοντινή έγκυρη ημέρα. Η επιλογή αποθηκεύεται μόνιμα μέχρι αλλαγή.'
        },
        {
            id: 'analysis',
            title: 'Έλεγχος αναθέσεων',
            content:
                'Το Έλεγχος Αναθέσεων Υπηρεσιών εμφανίζει assigned vs expected, conflicts, reason και assignment type. Χρησιμοποιείται για verification πριν οριστικοποίηση ή export.'
        },
        {
            id: 'excel-print',
            title: 'Excel και εκτύπωση',
            content:
                'Η Δημιουργία Excel παρέχει επιλογή μήνα και preview. Η Εκτύπωση Σειρών και Ιεραρχίας δίνει σελίδες ανά duty type και ξεχωριστή ιεραρχία με ενδείξεις disabled/missing όπου ισχύει.'
        },
        {
            id: 'holidays',
            title: 'Αργίες',
            content:
                'Υποστηρίζονται απλές αργίες, ειδικές αργίες και recurring αργίες. Οι ρυθμίσεις αργιών επηρεάζουν day type classification και τη ροή ανάθεσης.'
        },
        {
            id: 'manual-reference',
            title: 'Πηγή γνώσης',
            content:
                'Πλήρες εγχειρίδιο: DUTY_SHIFTS_MANUAL.md στη ρίζα του project. Ο βοηθός κάνει retrieval από ενότητες του εγχειριδίου για πρακτικές οδηγίες χρήσης.'
        }
    ];

    const SUGGESTIONS = [
        'Πώς μπορώ να κάνω αντικατάσταση επιλαχόντα;',
        'Πώς κάνω υπολογισμό πολλών μηνών;',
        'Τι κάνει το Κλείδωμα μήνα;',
        'Πώς λειτουργεί το swap καθημερινών;',
        'Πώς εξαιρώ ομάδα από Mon/Wed Tue/Thu;',
        'Πώς επηρεάζουν οι απουσίες τις αναθέσεις;',
        'Πώς ελέγχω ότι οι αναθέσεις είναι σωστές;'
    ];

    function escapeHtml(value) {
        const s = value === null || value === undefined ? '' : String(value);
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function getDutyShiftsAIModalEl() {
        return document.getElementById('dutyShiftsAIAssistantModal');
    }

    function getDutyShiftsAIInputEl() {
        const modal = getDutyShiftsAIModalEl();
        if (modal) {
            const byData = modal.querySelector('[data-duty-shifts-ai-input]');
            if (byData) return byData;
        }
        return document.getElementById('dutyShiftsAIQuestionInput');
    }

    function getDutyShiftsAIAnswerEl() {
        const modal = getDutyShiftsAIModalEl();
        if (modal) {
            const byData = modal.querySelector('[data-duty-shifts-ai-answer]');
            if (byData) return byData;
        }
        return document.getElementById('dutyShiftsAIAnswer');
    }

    let _dutyShiftsAIModalWired = false;
    function wireDutyShiftsAIModalEvents() {
        if (_dutyShiftsAIModalWired) return;
        const modal = getDutyShiftsAIModalEl();
        if (!modal) return;
        _dutyShiftsAIModalWired = true;

        modal.addEventListener(
            'click',
            function (e) {
                const askBtn = e.target.closest('[data-duty-shifts-ai-ask]');
                if (askBtn && modal.contains(askBtn)) {
                    e.preventDefault();
                    window.askDutyShiftsAIAssistant();
                    return;
                }
                const sugBtn = e.target.closest('[data-duty-shifts-ai-suggestion-idx]');
                if (sugBtn && modal.contains(sugBtn)) {
                    e.preventDefault();
                    const idx = parseInt(sugBtn.getAttribute('data-duty-shifts-ai-suggestion-idx'), 10);
                    if (!Number.isFinite(idx) || idx < 0 || idx >= SUGGESTIONS.length) return;
                    const input = getDutyShiftsAIInputEl();
                    if (input) input.value = SUGGESTIONS[idx];
                    window.askDutyShiftsAIAssistant();
                }
            },
            false
        );

        modal.addEventListener(
            'keydown',
            function (e) {
                if (e.key !== 'Enter') return;
                const input = getDutyShiftsAIInputEl();
                if (!input || e.target !== input) return;
                e.preventDefault();
                e.stopPropagation();
                window.askDutyShiftsAIAssistant();
            },
            true
        );
    }

    function normalizeGreek(str) {
        try {
            return String(str || '')
                .normalize('NFD')
                .replace(/\p{M}/gu, '')
                .toLowerCase();
        } catch (_) {
            return String(str || '').toLowerCase();
        }
    }

    function tokenize(text) {
        const raw = normalizeGreek(text).replace(/[^a-z0-9α-ω\s]/gi, ' ');
        return raw
            .split(/\s+/)
            .map((x) => x.trim())
            .filter((x) => x.length > 1);
    }

    function expandQueryTokens(qTokens, questionNorm) {
        const extra = new Set(qTokens);
        if (questionNorm.includes('επιλαχ') || questionNorm.includes('antikatastash') || questionNorm.includes('antikatastasi')) {
            'επιλαχων επιλαχοντα επιλαχοντες επιλαχωντα αντικατασταση επιλαχων αντικατασταση επιλαχοντα εφαρμογη ενεργειες ατομου'.split(' ').forEach((w) => extra.add(w));
        }
        if ((questionNorm.includes('υπολογ') && questionNorm.includes('υπηρεσι')) || questionNorm.includes('calculation')) {
            'υπολογισμος υπολογισω υπηρεσιες βηματα special weekend semi normal'.split(' ').forEach((w) => extra.add(w));
        }
        if (questionNorm.includes('ομαδ') && (questionNorm.includes('αλλ') || questionNorm.includes('χωρις'))) {
            'χωρις αλλαξουν αλλες ομαδες επιλογη ομαδων μονο επιλεγμενες'.split(' ').forEach((w) => extra.add(w));
        }
        return [...extra];
    }

    function wantsAlternateReplacementAnswer(questionNorm) {
        if (!questionNorm || questionNorm.length < 4) return false;
        if (questionNorm.includes('επιλαχ')) return true;
        if (questionNorm.includes('αντικατασταση') && questionNorm.includes('επιλαχ')) return true;
        if (questionNorm.includes('αντικατασταση') && questionNorm.includes('επιλαχον')) return true;
        return false;
    }

    function wantsCalculationAnswer(questionNorm) {
        if (!questionNorm || questionNorm.length < 4) return false;
        return questionNorm.includes('υπολογ') && questionNorm.includes('υπηρεσι');
    }

    function wantsIsolatedGroupsCalculationAnswer(questionNorm) {
        if (!questionNorm || questionNorm.length < 4) return false;
        const asksCalc = questionNorm.includes('υπολογ') && questionNorm.includes('υπηρεσι');
        const asksGroups = questionNorm.includes('ομαδ');
        const asksIsolation =
            questionNorm.includes('χωρις') ||
            questionNorm.includes('αλλες') ||
            questionNorm.includes('αλλοιω');
        return asksCalc && asksGroups && asksIsolation;
    }

    function scoreSection(section, qTokens) {
        const kw = section.keywords ? ` ${section.keywords}` : '';
        const sTokens = tokenize(`${section.title} ${section.content}${kw}`);
        if (qTokens.length === 0 || sTokens.length === 0) return 0;
        const sSet = new Set(sTokens);
        let score = 0;
        for (const t of qTokens) {
            if (sSet.has(t)) score += t.length > 4 ? 2 : 1;
        }
        const qText = qTokens.join(' ');
        const titleN = normalizeGreek(section.title);
        if (qText.length > 4 && titleN.includes(qText)) score += 5;
        return score;
    }

    function buildAnswer(question) {
        const qRaw = String(question || '').trim();
        const qNorm = normalizeGreek(qRaw);
        let qTokens = tokenize(qRaw);
        qTokens = expandQueryTokens(qTokens, qNorm);
        if (qTokens.length === 0) {
            return 'Γράψτε μια πιο συγκεκριμένη ερώτηση (π.χ. "πώς δουλεύει το swap καθημερινών;").';
        }
        const altSection = MANUAL_SECTIONS.find((s) => s.id === 'manual-alternate-replacement');
        const calcSection = MANUAL_SECTIONS.find((s) => s.id === 'calculation-run');
        const calcIsolatedSection = MANUAL_SECTIONS.find((s) => s.id === 'calculation-isolated-groups');
        const ranked = MANUAL_SECTIONS.map((s) => ({ s, score: scoreSection(s, qTokens) })).sort((a, b) => b.score - a.score);

        let top = [];
        if (wantsIsolatedGroupsCalculationAnswer(qNorm) && calcIsolatedSection) {
            top.push({ s: calcIsolatedSection, score: 999 });
            if (calcSection) top.push({ s: calcSection, score: 998 });
            const rest = ranked
                .filter((x) => x.s.id !== 'calculation-isolated-groups' && x.s.id !== 'calculation-run' && x.score > 0)
                .slice(0, 1);
            top = top.concat(rest);
        } else if (wantsCalculationAnswer(qNorm) && calcSection) {
            top.push({ s: calcSection, score: 999 });
            const rest = ranked.filter((x) => x.s.id !== 'calculation-run' && x.score > 0).slice(0, 2);
            top = top.concat(rest);
        } else if (wantsAlternateReplacementAnswer(qNorm) && altSection) {
            top.push({ s: altSection, score: 999 });
            const rest = ranked.filter((x) => x.s.id !== 'manual-alternate-replacement' && x.score > 0).slice(0, 2);
            top = top.concat(rest);
        } else {
            top = ranked.filter((x) => x.score > 0).slice(0, 3);
        }

        if (top.length === 0) {
            return 'Δεν βρήκα σαφή αντιστοίχιση στο εγχειρίδιο. Δοκιμάστε με λέξεις-κλειδιά όπως "υπολογισμός", "swap", "απουσία", "επιλαχών", "κλείδωμα μήνα", "ιεραρχία".';
        }
        const lines = [
            `<div><strong>Ερώτηση:</strong> ${escapeHtml(qRaw)}</div>`,
            '<hr class="my-2">',
            '<div><strong>Προτεινόμενη απάντηση από εγχειρίδιο:</strong></div>'
        ];
        top.forEach((x, idx) => {
            lines.push(
                `<div class="mt-2"><span class="badge bg-primary me-1">${idx + 1}</span><strong>${escapeHtml(x.s.title)}</strong><br><span>${escapeHtml(x.s.content)}</span></div>`
            );
        });
        lines.push('<div class="mt-3 text-muted"><small>Πηγή: DUTY_SHIFTS_MANUAL.md</small></div>');
        return lines.join('');
    }

    function renderSuggestions() {
        const box = document.getElementById('dutyShiftsAISuggestions');
        if (!box) return;
        box.innerHTML = SUGGESTIONS.map(
            (q, idx) =>
                `<button type="button" class="btn btn-sm btn-outline-secondary" data-duty-shifts-ai-suggestion-idx="${idx}">${escapeHtml(q)}</button>`
        ).join('');
    }

    window.useDutyShiftsAISuggestion = function useDutyShiftsAISuggestion(q) {
        const input = getDutyShiftsAIInputEl();
        if (!input) return;
        input.value = String(q || '');
        window.askDutyShiftsAIAssistant();
    };

    window.openDutyShiftsAIAssistantModal = function openDutyShiftsAIAssistantModal() {
        wireDutyShiftsAIModalEvents();
        renderSuggestions();
        const modalEl = getDutyShiftsAIModalEl();
        if (!modalEl || typeof bootstrap === 'undefined' || !bootstrap.Modal) return;
        const m = bootstrap.Modal.getOrCreateInstance(modalEl);
        m.show();
        setTimeout(() => {
            const input = getDutyShiftsAIInputEl();
            if (input) input.focus();
        }, 120);
    };

    window.handleDutyShiftsAIAssistantKeydown = function handleDutyShiftsAIAssistantKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            window.askDutyShiftsAIAssistant();
        }
    };

    window.askDutyShiftsAIAssistant = function askDutyShiftsAIAssistant() {
        wireDutyShiftsAIModalEvents();
        const run = () => {
            const input = getDutyShiftsAIInputEl();
            const answerEl = getDutyShiftsAIAnswerEl();
            if (!input || !answerEl) return;
            const q = String(input.value || '').trim();
            answerEl.innerHTML = buildAnswer(q);
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(run);
        } else {
            run();
        }
    };

    wireDutyShiftsAIModalEvents();
})();
