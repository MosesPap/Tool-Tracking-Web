// ============================================================================
// DUTY-SHIFTS-AI-ASSISTANT.JS - Free local manual-based assistant
// ============================================================================
(function () {
    const MANUAL_SECTIONS = [
        {
            id: 'manual-alternate-replacement',
            title: 'Αντικατάσταση Επιλαχών (βήμα-βήμα)',
            keywords:
                'επιλαχών επιλαχοντα επιλαχόντα επιλαχόντες επιλαχώντα αντικατάσταση επιλαχόντα αντικατάσταση επιλαχών χειροκίνητη αντικατάσταση επιλαχών openAlternateReplacementFromActions alternate replacement manual alternate Ενέργειες Ατόμου person actions',
            content:
                'Για αντικατάσταση επιλαχών: 1) Κλικ στο άτομο στη λίστα ομάδας → «Ενέργειες Ατόμου». 2) «Αντικατάσταση Επιλαχών». 3) Επιλέξτε Ημερομηνία (πρέπει να υπάρχει ανάθεση εκείνη την ημέρα και το άτομο να είναι ανατεθειμένο στην ομάδα του). 4) «Εφαρμογή». Ο επιλαχών είναι το επόμενο διαθέσιμο άτομο στη λίστα του τύπου ημέρας (special/weekend/semi/normal), κυκλικά, εκτός απουσίας/απενεργοποίησης. Έλεγχος διαδοχικών συγκρούσεων· αν αποτύχει, δεν εφαρμόζεται. Δεν είναι επιστροφή από απουσία. Baseline περιστροφής κρατά τον παραλειφθέντα· για καθημερινές μπορεί reflow υπόλοιπου μήνα. Στον Υπολογισμό, επιλογή ομάδων μπορεί να αγνοήσει χειροκίνητες αντικαταστάσεις μόνο για αυτές. Λεπτομέρειες: DUTY_SHIFTS_MANUAL.md §5.4.'
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
                'Άνοιγμα από κλικ στο άτομο στη λίστα ομάδας. Modal «Ενέργειες Ατόμου»: Επεξεργασία, Αντικατάσταση Επιλαχών (§5.4 εγχειριδίου), Απενεργοποίηση, Περίοδοι απουσίας, Αλλαγή ομάδας, Διαγραφή.'
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
        return [...extra];
    }

    function wantsAlternateReplacementAnswer(questionNorm) {
        if (!questionNorm || questionNorm.length < 4) return false;
        if (questionNorm.includes('επιλαχ')) return true;
        if (questionNorm.includes('αντικατασταση') && questionNorm.includes('επιλαχ')) return true;
        if (questionNorm.includes('αντικατασταση') && questionNorm.includes('επιλαχον')) return true;
        return false;
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
        const ranked = MANUAL_SECTIONS.map((s) => ({ s, score: scoreSection(s, qTokens) })).sort((a, b) => b.score - a.score);

        let top = [];
        if (wantsAlternateReplacementAnswer(qNorm) && altSection) {
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
        box.innerHTML = SUGGESTIONS.map((q) =>
            `<button type="button" class="btn btn-sm btn-outline-secondary" onclick="useDutyShiftsAISuggestion('${escapeHtml(q).replace(/'/g, '&#39;')}')">${escapeHtml(q)}</button>`
        ).join('');
    }

    window.useDutyShiftsAISuggestion = function useDutyShiftsAISuggestion(q) {
        const input = document.getElementById('dutyShiftsAIQuestionInput');
        if (!input) return;
        input.value = q;
        window.askDutyShiftsAIAssistant();
    };

    window.openDutyShiftsAIAssistantModal = function openDutyShiftsAIAssistantModal() {
        renderSuggestions();
        const modalEl = document.getElementById('dutyShiftsAIAssistantModal');
        if (!modalEl) return;
        const m = new bootstrap.Modal(modalEl);
        m.show();
        setTimeout(() => {
            const input = document.getElementById('dutyShiftsAIQuestionInput');
            if (input) input.focus();
        }, 120);
    };

    window.handleDutyShiftsAIAssistantKeydown = function handleDutyShiftsAIAssistantKeydown(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            window.askDutyShiftsAIAssistant();
        }
    };

    window.askDutyShiftsAIAssistant = function askDutyShiftsAIAssistant() {
        const input = document.getElementById('dutyShiftsAIQuestionInput');
        const answerEl = document.getElementById('dutyShiftsAIAnswer');
        if (!input || !answerEl) return;
        const q = String(input.value || '').trim();
        answerEl.innerHTML = buildAnswer(q);
    };
})();
