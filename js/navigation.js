// Navigation Functions

// Check authentication and redirect if needed
function checkAuth() {
    auth.onAuthStateChanged(function(user) {
        if (!user) {
            // Not logged in, show login
            const loginSection = document.getElementById('loginSection');
            const toolScannerMenu = document.getElementById('toolScannerMenu');
            if (loginSection) loginSection.classList.remove('d-none');
            if (toolScannerMenu) toolScannerMenu.style.display = 'none';
        } else {
            // Logged in, show menu
            const loginSection = document.getElementById('loginSection');
            const toolScannerMenu = document.getElementById('toolScannerMenu');
            if (loginSection) loginSection.classList.add('d-none');
            if (toolScannerMenu) toolScannerMenu.style.display = 'block';
            updateLoggedInTechnician();
        }
    });
}

// Update logged in technician display
function updateLoggedInTechnician() {
    const user = auth.currentUser;
    if (user) {
        const fullName = localStorage.getItem('fullName') || user.email;
        const fullNameElement = document.getElementById('fullName');
        if (fullNameElement) {
            fullNameElement.textContent = fullName;
        }
        
        // Check if user is admin
        db.collection('technicians').doc(user.uid).get().then(doc => {
            if (doc.exists) {
                const data = doc.data();
                const adminBtn = document.getElementById('menuAdminBtn');
                if (adminBtn && data.isAdmin) {
                    adminBtn.style.display = 'block';
                }
            }
        });
    }
}

// Navigate to different screens
function navigateToRegisterTools() {
    window.location.href = 'register-tools.html';
}

function navigateToMyTools() {
    window.location.href = 'my-tools.html';
}

function navigateToPreviousOut() {
    window.location.href = 'previous-out.html';
}

function navigateToToolsByLocation() {
    window.location.href = 'tools-by-location.html';
}

function navigateToAdmin() {
    window.location.href = 'admin.html';
}

// Setup menu button event listeners
function setupMenuButtons() {
    // Register Tools button
    const menuRegisterBtn = document.getElementById('menuRegisterBtn');
    if (menuRegisterBtn) {
        menuRegisterBtn.addEventListener('click', function() {
            navigateToRegisterTools();
        });
    }
    
    // My Tools button
    const menuMyToolsBtn = document.getElementById('menuMyToolsBtn');
    if (menuMyToolsBtn) {
        menuMyToolsBtn.addEventListener('click', function() {
            navigateToMyTools();
        });
    }
    
    // Previous Out Tools button
    const menuOutBtn = document.getElementById('menuOutBtn');
    if (menuOutBtn) {
        menuOutBtn.addEventListener('click', function() {
            navigateToPreviousOut();
        });
    }
    
    // Tools by Work Location button
    const menuWorkLocationBtn = document.getElementById('menuWorkLocationBtn');
    if (menuWorkLocationBtn) {
        menuWorkLocationBtn.addEventListener('click', function() {
            navigateToToolsByLocation();
        });
    }
    
    // Admin button
    const menuAdminBtn = document.getElementById('menuAdminBtn');
    if (menuAdminBtn) {
        menuAdminBtn.addEventListener('click', function() {
            navigateToAdmin();
        });
    }
    
    // Logout button
    const menuLogoutBtn = document.getElementById('menuLogoutBtn');
    if (menuLogoutBtn) {
        menuLogoutBtn.addEventListener('click', function() {
            logout();
        });
    }
}

// Initialize navigation when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    checkAuth();
    setupMenuButtons();
});

