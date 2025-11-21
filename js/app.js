let lastViewedCollectionName = null;
let lastViewedCollectionTools = [];

// Show My Tools by Collection screen
async function showMyToolsByCollection(collectionName) {
    lastViewedCollectionName = collectionName;
    document.getElementById('toolScannerMenu').style.display = 'none';
    document.getElementById('appSection').style.display = 'none';
    document.getElementById('myToolsByCollectionScreen').style.display = 'block';
    document.getElementById('collectionCheckupScreen').style.display = 'none';
    const title = document.getElementById('myToolsCollectionTitle');
    const list = document.getElementById('myToolsByCollectionList');
    title.textContent = collectionName;
    list.innerHTML = '<div class="text-center">Loading...</div>';
    try {
        // Get tools in this collection owned by user
        const user = auth.currentUser;
        const fullName = localStorage.getItem('fullName') || user.email;
        const snapshot = await db.collection('tools')
            .where('owner', '==', fullName)
            .where('collectionCode', '==', collectionName)
            .get();
        if (snapshot.empty) {
            list.innerHTML = '<div class="text-center text-danger">No tools found in this collection.</div>';
            lastViewedCollectionTools = [];
            return;
        }
        // Group tools by location
        const tools = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        lastViewedCollectionTools = tools;
        // ... existing code for rendering tools ...
        // (rest of your existing showMyToolsByCollection logic)
    } catch (e) {
        title.textContent = collectionName;
        list.innerHTML = '<div class="text-center text-danger">Error loading tools.</div>';
        lastViewedCollectionTools = [];
    }
}

// Collection Checkup logic
const collectionCheckupBtn = document.getElementById('collectionCheckupBtn');
if (collectionCheckupBtn) {
    collectionCheckupBtn.onclick = function() {
        showCollectionCheckupScreen();
    };
}

function showCollectionCheckupScreen() {
    document.getElementById('myToolsByCollectionScreen').style.display = 'none';
    document.getElementById('collectionCheckupScreen').style.display = 'block';
    const title = document.getElementById('checkupCollectionTitle');
    const list = document.getElementById('checkupToolsList');
    title.textContent = lastViewedCollectionName;
    if (!lastViewedCollectionTools.length) {
        list.innerHTML = '<div class="text-center text-danger">No tools found for checkup.</div>';
        return;
    }
    // Render tools with checkboxes
    let html = '<form id="checkupForm">';
    lastViewedCollectionTools.forEach((tool, idx) => {
        html += `<div class="form-check mb-2">
            <input class="form-check-input" type="checkbox" value="${tool.id}" id="checkupTool${idx}" checked>
            <label class="form-check-label" for="checkupTool${idx}">
                <b>${tool.toolName || 'Unknown Tool'}</b> (TID: ${tool.id}) - <span style="color:#888;">${tool.partNumber || ''}</span>
            </label>
        </div>`;
    });
    html += '</form>';
    list.innerHTML = html;
}

document.getElementById('backToMyToolsByCollectionBtn').onclick = function() {
    document.getElementById('collectionCheckupScreen').style.display = 'none';
    document.getElementById('myToolsByCollectionScreen').style.display = 'block';
};

document.getElementById('saveCheckupBtn').onclick = function() {
    const checked = Array.from(document.querySelectorAll('#checkupForm input[type=checkbox]:checked')).map(cb => cb.value);
    alert('Checked tools: ' + checked.join(', '));
    // Here you could save to Firestore or log as needed
}; 