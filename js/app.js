// Main App Controller
class ToolTrackingApp {
    constructor() {
        this.currentScreen = 'loading';
        this.currentUser = null;
        this.technicianName = '';
        this.html5QrcodeScanner = null;
        this.isScanning = false;
        
        this.init();
    }

    init() {
        // Initialize Firebase
        this.initFirebase();
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Check for existing session
        this.checkExistingSession();
        
        // Hide loading screen after initialization
        setTimeout(() => {
            this.hideLoadingScreen();
        }, 2000);
    }

    initFirebase() {
        // Firebase configuration - using actual project settings
        const firebaseConfig = {
            apiKey: "AIzaSyBltucXfxN3xzOxX5s8s7Kv8yCBa5azxzU",
            authDomain: "tool-tracking-system-15e84.firebaseapp.com",
            projectId: "tool-tracking-system-15e84",
            storageBucket: "tool-tracking-system-15e84.firebasestorage.app",
            messagingSenderId: "813615362050",
            appId: "1:813615362050:web:1fa435f0b725dd1f8cb71b" // Replace this with your actual web app ID from Firebase Console
        };

        // Initialize Firebase
        firebase.initializeApp(firebaseConfig);
        
        // Initialize services
        this.auth = firebase.auth();
        this.db = firebase.firestore();
    }

    setupEventListeners() {
        // Login form
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        // Password toggle
        document.getElementById('togglePassword').addEventListener('click', () => {
            this.togglePasswordVisibility();
        });

        // Navigation buttons
        document.getElementById('createAccountBtn').addEventListener('click', () => {
            this.showSignUpScreen();
        });

        document.getElementById('adminBtn').addEventListener('click', () => {
            this.showAdminLogin();
        });

        document.getElementById('forgotPassword').addEventListener('click', (e) => {
            e.preventDefault();
            this.showForgotPassword();
        });

        // Main navigation
        document.getElementById('scanBtn').addEventListener('click', () => {
            this.showScreen('scanner');
        });

        document.getElementById('registerBtn').addEventListener('click', () => {
            this.showScreen('register');
        });

        document.getElementById('searchBtn').addEventListener('click', () => {
            this.showScreen('search');
        });

        document.getElementById('previousOutBtn').addEventListener('click', () => {
            this.showScreen('previousOut');
        });

        document.getElementById('myToolsBtn').addEventListener('click', () => {
            this.showScreen('myTools');
        });

        document.getElementById('checkupBtn').addEventListener('click', () => {
            this.showScreen('checkup');
        });

        document.getElementById('myAccountBtn').addEventListener('click', () => {
            this.showScreen('myAccount');
        });

        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.handleLogout();
        });

        // Back buttons
        document.getElementById('backToMain').addEventListener('click', () => {
            this.showScreen('main');
        });

        document.getElementById('backToMainFromRegister').addEventListener('click', () => {
            this.showScreen('main');
        });

        document.getElementById('backToMainFromSearch').addEventListener('click', () => {
            this.showScreen('main');
        });

        document.getElementById('backToMainFromPrevious').addEventListener('click', () => {
            this.showScreen('main');
        });

        document.getElementById('backToMainFromMyTools').addEventListener('click', () => {
            this.showScreen('main');
        });

        document.getElementById('backToMainFromAccount').addEventListener('click', () => {
            this.showScreen('main');
        });

        // Scanner functionality
        document.getElementById('toggleCameraBtn').addEventListener('click', () => {
            this.toggleCamera();
        });

        document.getElementById('toolCode').addEventListener('input', (e) => {
            document.getElementById('toolDetailsBtn').disabled = e.target.value.trim() === '';
        });

        document.getElementById('toolDetailsBtn').addEventListener('click', () => {
            this.getToolDetails();
        });

        // Register functionality
        document.getElementById('registerToolBtn').addEventListener('click', () => {
            this.registerTool();
        });

        // Search functionality
        document.querySelectorAll('.search-chip').forEach(chip => {
            chip.addEventListener('click', (e) => {
                this.setSearchType(e.target.dataset.type);
            });
        });

        document.getElementById('searchQuery').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.performSearch();
            }
        });

        // Tool details modal
        document.getElementById('checkoutBtn').addEventListener('click', () => {
            this.checkoutTool();
        });

        document.getElementById('checkinBtn').addEventListener('click', () => {
            this.checkinTool();
        });
    }

    checkExistingSession() {
        const keepSignedIn = localStorage.getItem('keepSignedIn') === 'true';
        const user = this.auth.currentUser;

        if (keepSignedIn && user) {
            this.technicianName = localStorage.getItem('technicianName') || 'Technician';
            this.currentUser = user;
            this.showScreen('main');
            this.updateTechnicianName();
            this.loadPreviousOutCount();
        } else {
            this.showScreen('login');
        }
    }

    async handleLogin() {
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const keepSignedIn = document.getElementById('keepSignedIn').checked;

        if (!email || !password) {
            this.showAlert('Please fill in all fields', 'error');
            return;
        }

        const loginBtn = document.querySelector('#loginForm .btn-primary');
        const btnText = loginBtn.querySelector('.btn-text');
        const btnLoading = loginBtn.querySelector('.btn-loading');

        try {
            // Show loading state
            btnText.classList.add('d-none');
            btnLoading.classList.remove('d-none');
            loginBtn.disabled = true;

            // Sign in with Firebase
            const userCredential = await this.auth.signInWithEmailAndPassword(email, password);
            const user = userCredential.user;

            // Get technician name from Firestore
            const technicianDoc = await this.db.collection('technicians').doc(user.uid).get();
            
            if (technicianDoc.exists) {
                this.currentUser = user;
                this.technicianName = technicianDoc.data().fullName || 'Technician';
                
                // Save session data
                if (keepSignedIn) {
                    localStorage.setItem('keepSignedIn', 'true');
                    localStorage.setItem('technicianName', this.technicianName);
                }

                this.showScreen('main');
                this.updateTechnicianName();
                this.loadPreviousOutCount();
                this.showAlert('Login successful!', 'success');
            } else {
                this.showAlert('No account found with this email.', 'error');
            }
        } catch (error) {
            console.error('Login error:', error);
            let errorMessage = 'Login failed. Please try again.';
            
            if (error.code === 'auth/user-not-found') {
                errorMessage = 'No account found with this email.';
            } else if (error.code === 'auth/wrong-password') {
                errorMessage = 'Invalid password.';
            } else if (error.code === 'auth/network-request-failed') {
                errorMessage = 'Network error. Please check your connection.';
            }
            
            this.showAlert(errorMessage, 'error');
        } finally {
            // Reset loading state
            btnText.classList.remove('d-none');
            btnLoading.classList.add('d-none');
            loginBtn.disabled = false;
        }
    }

    handleLogout() {
        this.auth.signOut();
        localStorage.removeItem('keepSignedIn');
        localStorage.removeItem('technicianName');
        this.currentUser = null;
        this.technicianName = '';
        this.showScreen('login');
        this.showAlert('Logged out successfully', 'success');
    }

    showScreen(screenName) {
        // Hide all screens
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });

        // Show target screen
        const targetScreen = document.getElementById(screenName + 'Screen');
        if (targetScreen) {
            targetScreen.classList.add('active');
            this.currentScreen = screenName;
            
            // Load screen-specific data
            this.loadScreenData(screenName);
        }
    }

    loadScreenData(screenName) {
        switch (screenName) {
            case 'main':
                this.loadPreviousOutCount();
                break;
            case 'previousOut':
                this.loadPreviousOutTools();
                break;
            case 'myTools':
                this.loadMyTools();
                break;
            case 'myAccount':
                this.loadAccountInfo();
                break;
        }
    }

    updateTechnicianName() {
        const nameElement = document.getElementById('technicianName');
        if (nameElement) {
            nameElement.textContent = this.technicianName;
        }
    }

    async loadPreviousOutCount() {
        try {
            const snapshot = await this.db.collection('tools')
                .where('status', '==', 'OUT')
                .get();
            
            const count = snapshot.size;
            const badge = document.getElementById('previousOutCount');
            if (badge) {
                badge.textContent = count;
                badge.style.display = count > 0 ? 'inline' : 'none';
            }
        } catch (error) {
            console.error('Error loading previous out count:', error);
        }
    }

    async loadPreviousOutTools() {
        try {
            const snapshot = await this.db.collection('tools')
                .where('status', '==', 'OUT')
                .orderBy('timestamp', 'desc')
                .get();

            const tools = [];
            snapshot.forEach(doc => {
                tools.push({ id: doc.id, ...doc.data() });
            });

            this.displayTools(tools, 'previousOutContent');
        } catch (error) {
            console.error('Error loading previous out tools:', error);
            this.showAlert('Error loading tools', 'error');
        }
    }

    async loadMyTools() {
        try {
            const snapshot = await this.db.collection('tools')
                .where('technician', '==', this.technicianName)
                .orderBy('timestamp', 'desc')
                .get();

            const tools = [];
            snapshot.forEach(doc => {
                tools.push({ id: doc.id, ...doc.data() });
            });

            this.displayTools(tools, 'myToolsContent');
        } catch (error) {
            console.error('Error loading my tools:', error);
            this.showAlert('Error loading tools', 'error');
        }
    }

    displayTools(tools, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (tools.length === 0) {
            container.innerHTML = '<div class="text-center mt-4"><p>No tools found</p></div>';
            return;
        }

        const toolsHtml = tools.map((tool, index) => this.createToolCard(tool, index)).join('');
        container.innerHTML = toolsHtml;

        // Add click listeners to tool cards
        container.querySelectorAll('.tool-card').forEach((card, index) => {
            card.addEventListener('click', () => {
                this.showToolDetails(tools[index]);
            });
        });
    }

    createToolCard(tool, index) {
        const timestamp = tool.timestamp ? new Date(tool.timestamp.toDate()).toLocaleString() : 'Unknown';
        const status = tool.status || 'N/A';
        const statusClass = status.toLowerCase();
        
        return `
            <div class="tool-card ${statusClass}">
                <div class="tool-card-header">
                    <h6 class="tool-name">${index + 1}. ${tool.toolName || 'Unknown Tool'}</h6>
                    <span class="tool-date">${timestamp}</span>
                </div>
                <div class="tool-details">
                    <div class="tool-detail-item">
                        <div class="tool-detail-label">TID</div>
                        <div class="tool-detail-value">${tool.id || 'N/A'}</div>
                    </div>
                    <div class="tool-detail-item">
                        <div class="tool-detail-label">P/N</div>
                        <div class="tool-detail-value">${tool.partNumber || 'N/A'}</div>
                    </div>
                    <div class="tool-detail-item">
                        <div class="tool-detail-label">STS</div>
                        <div class="tool-status ${statusClass}">${status}</div>
                    </div>
                </div>
            </div>
        `;
    }

    showToolDetails(tool) {
        const modal = new bootstrap.Modal(document.getElementById('toolDetailsModal'));
        const content = document.getElementById('toolDetailsContent');
        const checkoutBtn = document.getElementById('checkoutBtn');
        const checkinBtn = document.getElementById('checkinBtn');

        const timestamp = tool.timestamp ? new Date(tool.timestamp.toDate()).toLocaleString() : 'Unknown';
        const status = tool.status || 'N/A';

        content.innerHTML = `
            <div class="row">
                <div class="col-md-6">
                    <p><strong>Tool ID:</strong> ${tool.id || 'N/A'}</p>
                    <p><strong>Tool Name:</strong> ${tool.toolName || 'Unknown'}</p>
                    <p><strong>Part Number:</strong> ${tool.partNumber || 'N/A'}</p>
                    <p><strong>Status:</strong> <span class="status-${status.toLowerCase()}">${status}</span></p>
                </div>
                <div class="col-md-6">
                    <p><strong>Last Updated:</strong> ${timestamp}</p>
                    <p><strong>Technician:</strong> ${tool.technician || 'N/A'}</p>
                    <p><strong>Location:</strong> ${tool.location || 'N/A'}</p>
                    <p><strong>Calibration Due:</strong> ${tool.calibrationDueDate || 'N/A'}</p>
                </div>
            </div>
        `;

        // Show/hide buttons based on status
        if (status === 'IN') {
            checkoutBtn.style.display = 'inline-block';
            checkinBtn.style.display = 'none';
        } else {
            checkoutBtn.style.display = 'none';
            checkinBtn.style.display = 'inline-block';
        }

        // Store current tool for checkout/checkin
        this.currentTool = tool;
        modal.show();
    }

    async checkoutTool() {
        if (!this.currentTool) return;

        try {
            await this.db.collection('tools').doc(this.currentTool.id).update({
                status: 'OUT',
                technician: this.technicianName,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            this.showAlert('Tool checked out successfully', 'success');
            bootstrap.Modal.getInstance(document.getElementById('toolDetailsModal')).hide();
            
            // Refresh data
            this.loadPreviousOutCount();
            if (this.currentScreen === 'previousOut') {
                this.loadPreviousOutTools();
            }
        } catch (error) {
            console.error('Error checking out tool:', error);
            this.showAlert('Error checking out tool', 'error');
        }
    }

    async checkinTool() {
        if (!this.currentTool) return;

        try {
            await this.db.collection('tools').doc(this.currentTool.id).update({
                status: 'IN',
                technician: '',
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            this.showAlert('Tool checked in successfully', 'success');
            bootstrap.Modal.getInstance(document.getElementById('toolDetailsModal')).hide();
            
            // Refresh data
            this.loadPreviousOutCount();
            if (this.currentScreen === 'previousOut') {
                this.loadPreviousOutTools();
            }
        } catch (error) {
            console.error('Error checking in tool:', error);
            this.showAlert('Error checking in tool', 'error');
        }
    }

    loadAccountInfo() {
        const accountName = document.getElementById('accountName');
        const accountEmail = document.getElementById('accountEmail');

        if (accountName) accountName.textContent = this.technicianName;
        if (accountEmail) accountEmail.textContent = this.currentUser?.email || 'N/A';
    }

    hideLoadingScreen() {
        const loadingScreen = document.getElementById('loadingScreen');
        if (loadingScreen) {
            loadingScreen.style.display = 'none';
        }
    }

    togglePasswordVisibility() {
        const passwordInput = document.getElementById('password');
        const toggleBtn = document.getElementById('togglePassword');
        const icon = toggleBtn.querySelector('i');

        if (passwordInput.type === 'password') {
            passwordInput.type = 'text';
            icon.className = 'fas fa-eye-slash';
        } else {
            passwordInput.type = 'password';
            icon.className = 'fas fa-eye';
        }
    }

    showAlert(message, type = 'info') {
        // Create alert element
        const alertDiv = document.createElement('div');
        alertDiv.className = `alert alert-${type === 'error' ? 'danger' : type} alert-dismissible fade show position-fixed`;
        alertDiv.style.cssText = 'top: 20px; right: 20px; z-index: 9999; min-width: 300px;';
        alertDiv.innerHTML = `
            ${message}
            <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
        `;

        document.body.appendChild(alertDiv);

        // Auto remove after 5 seconds
        setTimeout(() => {
            if (alertDiv.parentNode) {
                alertDiv.remove();
            }
        }, 5000);
    }

    showSignUpScreen() {
        this.showAlert('Sign up functionality not implemented in web version', 'info');
    }

    showAdminLogin() {
        this.showAlert('Admin functionality not available in web version', 'info');
    }

    showForgotPassword() {
        this.showAlert('Password reset functionality not implemented in web version', 'info');
    }

    setSearchType(type) {
        document.querySelectorAll('.search-chip').forEach(chip => {
            chip.classList.remove('active');
        });
        document.querySelector(`[data-type="${type}"]`).classList.add('active');
        this.currentSearchType = type;
    }

    async performSearch() {
        const query = document.getElementById('searchQuery').value.trim();
        const type = this.currentSearchType || 'partNumber';

        if (!query) {
            this.showAlert('Please enter a search term', 'error');
            return;
        }

        try {
            let snapshot;
            if (type === 'partNumber') {
                snapshot = await this.db.collection('tools')
                    .where('partNumber', '>=', query)
                    .where('partNumber', '<=', query + '\uf8ff')
                    .get();
            } else {
                snapshot = await this.db.collection('tools')
                    .where('toolName', '>=', query)
                    .where('toolName', '<=', query + '\uf8ff')
                    .get();
            }

            const tools = [];
            snapshot.forEach(doc => {
                tools.push({ id: doc.id, ...doc.data() });
            });

            this.displaySearchResults(tools);
        } catch (error) {
            console.error('Search error:', error);
            this.showAlert('Error performing search', 'error');
        }
    }

    displaySearchResults(tools) {
        const resultsContainer = document.getElementById('searchResults');
        
        if (tools.length === 0) {
            resultsContainer.innerHTML = '<div class="text-center mt-4"><p>No tools found</p></div>';
        } else {
            const toolsHtml = tools.map((tool, index) => this.createToolCard(tool, index)).join('');
            resultsContainer.innerHTML = toolsHtml;
        }

        resultsContainer.style.display = 'block';

        // Add click listeners to tool cards
        resultsContainer.querySelectorAll('.tool-card').forEach((card, index) => {
            card.addEventListener('click', () => {
                this.showToolDetails(tools[index]);
            });
        });
    }

    async registerTool() {
        const toolCode = document.getElementById('registerToolCode').value.trim();
        const technicianName = document.getElementById('technicianNameInput').value.trim();

        if (!toolCode || !technicianName) {
            this.showAlert('Please fill in all fields', 'error');
            return;
        }

        try {
            // Check if tool exists
            const toolDoc = await this.db.collection('tools').doc(toolCode).get();
            
            if (toolDoc.exists) {
                this.showAlert('Tool already exists', 'error');
                return;
            }

            // Create new tool
            await this.db.collection('tools').doc(toolCode).set({
                id: toolCode,
                toolName: 'New Tool',
                partNumber: toolCode,
                status: 'IN',
                technician: technicianName,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                location: 'Default Location'
            });

            this.showAlert('Tool registered successfully', 'success');
            document.getElementById('registerToolCode').value = '';
            document.getElementById('technicianNameInput').value = '';
        } catch (error) {
            console.error('Error registering tool:', error);
            this.showAlert('Error registering tool', 'error');
        }
    }

    async getToolDetails() {
        const toolCode = document.getElementById('toolCode').value.trim();
        
        if (!toolCode) {
            this.showAlert('Please scan or enter a tool code', 'error');
            return;
        }

        try {
            const toolDoc = await this.db.collection('tools').doc(toolCode).get();
            
            if (toolDoc.exists) {
                const tool = { id: toolDoc.id, ...toolDoc.data() };
                this.showToolDetails(tool);
            } else {
                this.showAlert('Tool not found', 'error');
            }
        } catch (error) {
            console.error('Error getting tool details:', error);
            this.showAlert('Error getting tool details', 'error');
        }
    }
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ToolTrackingApp();
}); 