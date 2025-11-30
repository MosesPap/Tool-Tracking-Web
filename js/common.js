// ============================================
// COMMON.JS - Shared Functions for All Pages
// ============================================

// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyDmI0v_pVt_qFJlsqmw8QlIOi-4VLjyn54",
    authDomain: "tool-tracking-system-15e84.firebaseapp.com",
    projectId: "tool-tracking-system-15e84",
    storageBucket: "tool-tracking-system-15e84.firebasestorage.app",
    messagingSenderId: "813615362050",
    appId: "1:813615362050:web:1fa435f0b725dd1f8cb71b"
};

// Initialize Firebase (only if not already initialized)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Make Firebase instances globally accessible so all pages use the same instances
// This ensures LOCAL persistence works correctly across page navigations
window.auth = auth;
window.db = db;
window.storage = storage;

// Configure Firebase Auth
auth.useDeviceLanguage();

// Set persistence with error handling for IndexedDB issues
// Check if IndexedDB is available and functional before setting LOCAL persistence
(function() {
    let persistenceType = firebase.auth.Auth.Persistence.LOCAL; // Try LOCAL first
    
    // Check if IndexedDB is available
    if (typeof window === 'undefined' || !window.indexedDB || window.indexedDB === null) {
        persistenceType = firebase.auth.Auth.Persistence.SESSION;
        console.log('[COMMON] IndexedDB not available, using SESSION persistence');
    }
    
    // Set persistence with error handling
    auth.setPersistence(persistenceType).catch((error) => {
        // If LOCAL persistence fails (e.g., IndexedDB error), fall back to SESSION
        if (persistenceType === firebase.auth.Auth.Persistence.LOCAL) {
            console.warn('[COMMON] LOCAL persistence failed, falling back to SESSION:', error.message);
            return auth.setPersistence(firebase.auth.Auth.Persistence.SESSION).catch((fallbackError) => {
                console.error('[COMMON] Failed to set SESSION persistence:', fallbackError);
            });
        }
        console.error('[COMMON] Failed to set persistence:', error);
    });
})();

// Suppress Firebase IndexedDB warnings by intercepting console.warn
if (typeof window !== 'undefined' && window.console) {
    const originalWarn = console.warn;
    console.warn = function(...args) {
        // Filter out Firebase IndexedDB warnings
        const message = args.join(' ');
        if (message.includes('IndexedDB') && message.includes('app/idb-get')) {
            // Suppress this specific warning - it's non-critical
            return;
        }
        // Call original warn for other messages
        originalWarn.apply(console, args);
    };
}

// Set custom error messages for unverified emails
auth.onAuthStateChanged(function(user) {
    if (user && !user.emailVerified) {
        auth.signOut();
    }
});

// ============================================
// Global Variables (Shared State)
// ============================================
let html5QrCode = null;
let bulkScanMode = false;
let bulkScannedTools = [];
let bulkProcessingCodes = new Set();
let bulkRecentlyProcessed = new Map();
let isOnline = navigator.onLine;
let indexedDB = null;
let selectedWorkLocation = null;
let previousOutToolsCount = 0;
let previousOutToolsData = [];

// ============================================
// Authentication Functions
// ============================================

// Save technician data to Firestore
async function saveTechnicianToFirestore(user) {
    try {
        const technicianDoc = await db.collection('technicians').doc(user.uid).get();
        
        let technicianData = {
            email: user.email,
            lastSignIn: firebase.firestore.FieldValue.serverTimestamp()
        };
        
        if (technicianDoc.exists) {
            const existingData = technicianDoc.data();
            technicianData = {
                ...existingData,
                ...technicianData
            };
        } else {
            const fullName = user.displayName || user.email;
            technicianData = {
                fullName: fullName,
                email: user.email,
                isAdmin: false,
                lastSignIn: firebase.firestore.FieldValue.serverTimestamp()
            };
        }
        
        await db.collection('technicians').doc(user.uid).set(technicianData, { merge: true });
        localStorage.setItem('fullName', technicianData.fullName || user.email);
        
        console.log('Technician data saved to Firestore');
    } catch (error) {
        console.error('Error saving technician data:', error);
    }
}

// Full name validation
function validateFullName(input) {
    const value = input.value;
    const validationDiv = input.id === 'signUpFullName' ? 
        document.getElementById('fullNameValidation') : 
        document.getElementById('accountNameValidation');
    
    if (!validationDiv) return;
    
    const cleanedValue = value.replace(/[^A-Za-z ]/g, '');
    if (cleanedValue !== value) {
        input.value = cleanedValue;
    }
    
    if (!cleanedValue.trim()) {
        validationDiv.textContent = '';
        validationDiv.className = 'form-text text-muted';
        return;
    }
    
    if (!/^[A-Za-z ]+$/.test(cleanedValue)) {
        validationDiv.textContent = 'Only English letters and spaces are allowed';
        validationDiv.className = 'form-text text-danger';
        return;
    }
    
    if (cleanedValue.trim().length < 2) {
        validationDiv.textContent = 'Name must be at least 2 characters long';
        validationDiv.className = 'form-text text-warning';
        return;
    }
    
    const words = cleanedValue.trim().split(' ').filter(word => word.length > 0);
    if (words.length < 2) {
        validationDiv.textContent = 'Please enter both first and last name';
        validationDiv.className = 'form-text text-warning';
        return;
    }
    
    validationDiv.textContent = '✓ Valid name format';
    validationDiv.className = 'form-text text-success';
}

// Format full name
function formatFullName(input) {
    const value = input.value.trim();
    if (!value) return;
    
    const formattedName = value
        .split(' ')
        .filter(word => word.length > 0)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    
    input.value = formattedName;
    
    const validationDiv = input.id === 'signUpFullName' ? 
        document.getElementById('fullNameValidation') : 
        document.getElementById('accountNameValidation');
    if (validationDiv && formattedName && /^([A-Z][a-z]+)( [A-Z][a-z]+)+$/.test(formattedName)) {
        validationDiv.textContent = '✓ Name formatted correctly';
        validationDiv.className = 'form-text text-success';
    }
}

// Logout function
function logout() {
    auth.signOut();
    if (html5QrCode) {
        html5QrCode.clear();
    }
    localStorage.removeItem('fullName');
    window.location.href = 'index.html';
}

// ============================================
// Utility Functions
// ============================================

// Update online status
function updateOnlineStatus() {
    isOnline = navigator.onLine;
    const statusElement = document.getElementById('onlineStatus');
    
    if (statusElement) {
        if (isOnline) {
            statusElement.className = 'status-dot';
            if (typeof syncOfflineTools === 'function') {
                syncOfflineTools();
            }
        } else {
            statusElement.className = 'status-dot offline';
        }
    }
}

// Show notification
function showNotification(message, type = 'info') {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type === 'error' ? 'danger' : type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'info'} alert-dismissible fade show`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    const appSection = document.getElementById('appSection') || document.body;
    if (appSection) {
        appSection.insertBefore(alertDiv, appSection.firstChild);
        
        setTimeout(() => {
            if (alertDiv.parentNode) {
                alertDiv.remove();
            }
        }, 5000);
    }
}

// IndexedDB operations
async function initIndexedDB() {
    return new Promise((resolve, reject) => {
        // Check if IndexedDB is available and not null
        if (typeof window === 'undefined' || !window.indexedDB || window.indexedDB === null) {
            console.log('IndexedDB is not available in this environment - skipping initialization');
            resolve(null); // Resolve with null instead of rejecting
            return;
        }
        
        try {
            const request = window.indexedDB.open('ToolTrackingDB', 1);
            
            request.onerror = () => {
                console.warn('IndexedDB open failed:', request.error);
                resolve(null); // Resolve with null instead of rejecting
            };
            
            request.onsuccess = () => {
                indexedDB = request.result;
                resolve(indexedDB);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains('offlineTools')) {
                    db.createObjectStore('offlineTools', { keyPath: 'id' });
                }
            };
        } catch (error) {
            console.warn('IndexedDB initialization error:', error);
            resolve(null); // Resolve with null instead of rejecting
        }
    });
}

async function getOfflineTools() {
    return new Promise((resolve, reject) => {
        if (!indexedDB) {
            resolve([]);
            return;
        }
        
        const transaction = indexedDB.transaction(['offlineTools'], 'readonly');
        const store = transaction.objectStore('offlineTools');
        const getAllRequest = store.getAll();
        
        getAllRequest.onsuccess = () => resolve(getAllRequest.result);
        getAllRequest.onerror = () => reject(getAllRequest.error);
    });
}

async function saveToolOffline(toolData) {
    return new Promise((resolve, reject) => {
        if (!indexedDB) {
            reject(new Error('Database not initialized'));
            return;
        }
        
        const transaction = indexedDB.transaction(['offlineTools'], 'readwrite');
        const store = transaction.objectStore('offlineTools');
        const addRequest = store.put(toolData);
        
        addRequest.onsuccess = () => resolve();
        addRequest.onerror = () => reject(addRequest.error);
    });
}

async function removeOfflineTool(toolId) {
    return new Promise((resolve, reject) => {
        if (!indexedDB) {
            resolve();
            return;
        }
        
        const transaction = indexedDB.transaction(['offlineTools'], 'readwrite');
        const store = transaction.objectStore('offlineTools');
        const deleteRequest = store.delete(toolId);
        
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
    });
}

// Sync offline tools
async function syncOfflineTools() {
    try {
        const offlineTools = await getOfflineTools();
        
        if (offlineTools.length === 0) {
            return;
        }
        
        for (const tool of offlineTools) {
            try {
                await db.collection('tools').doc(tool.id).set(tool.data);
                await removeOfflineTool(tool.id);
            } catch (error) {
                console.error(`Failed to sync tool ${tool.id}:`, error);
            }
        }
        
        if (typeof loadTools === 'function') {
            loadTools();
        }
        
        showNotification(`Successfully synced ${offlineTools.length} offline tools`, 'success');
    } catch (error) {
        console.error('Error syncing offline tools:', error);
        showNotification('Error syncing offline tools', 'error');
    }
}

// Update previous out tools count
async function updatePreviousOutToolsCount() {
    const user = auth.currentUser;
    if (!user) return;
    
    const fullName = localStorage.getItem('fullName') || user.email;
    
    try {
        const snapshot = await db.collection('tools')
            .where('technician', '==', fullName)
            .where('status', '==', 'OUT')
            .get();
        
        if (!snapshot.empty) {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            
            const previousTools = snapshot.docs.filter(doc => {
                const timestamp = doc.data().timestamp;
                if (timestamp && timestamp.toDate) {
                    const toolDate = timestamp.toDate();
                    const toolDateLocal = new Date(toolDate.getFullYear(), toolDate.getMonth(), toolDate.getDate());
                    return toolDateLocal < today;
                }
                return false;
            });
            
            previousOutToolsCount = previousTools.length;
            previousOutToolsData = previousTools.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
        } else {
            previousOutToolsCount = 0;
            previousOutToolsData = [];
        }
    } catch (error) {
        console.error('Error updating previous out tools count:', error);
    }
}

// Update logged in technician name display
function updateLoggedInTechnician() {
    const user = auth.currentUser;
    if (!user) return;
    const fullName = localStorage.getItem('fullName') || user.email;
    
    const registerScreenNameElem = document.getElementById('registerScreenName');
    if (registerScreenNameElem) {
        registerScreenNameElem.textContent = fullName;
    }
    
    const fullNameElem = document.getElementById('fullName');
    if (fullNameElem) {
        fullNameElem.textContent = fullName;
    }
    
    if (typeof updatePreviousOutToolsCount === 'function') {
        updatePreviousOutToolsCount();
    }
}

// Check authentication and redirect if needed
function checkAuthAndRedirect() {
    auth.onAuthStateChanged(function(user) {
        if (!user) {
            window.location.href = 'index.html';
        } else {
            updateLoggedInTechnician();
        }
    });
}

// Initialize common functionality on page load
document.addEventListener('DOMContentLoaded', async function() {
    // Initialize IndexedDB
    try {
        await initIndexedDB();
    } catch (error) {
        console.error('Error initializing IndexedDB:', error);
    }
    
    // Set up online/offline event listeners
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    
    // Initial status check
    updateOnlineStatus();
    
    // Register service worker
    if ('serviceWorker' in navigator) {
        try {
            const registration = await navigator.serviceWorker.register('/service-worker.js');
            console.log('Service Worker registered:', registration);
            
            navigator.serviceWorker.addEventListener('message', event => {
                if (event.data.type === 'OFFLINE_SYNC_COMPLETE') {
                    showNotification(`Synced ${event.data.syncedCount} offline tools`, 'success');
                }
            });
        } catch (error) {
            console.error('Service Worker registration failed:', error);
        }
    }
});

