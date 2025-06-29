// Main App Controller
class ToolTrackingApp {
    constructor() {
        this.currentScreen = 'loading';
        this.currentUser = null;
        this.technicianName = '';
        this.outToolsCount = 0;
        this.html5QrcodeScanner = null;
        this.isScanning = false;
        this.isInitialized = false;
        
        this.init();
    }

    init() {
        try {
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
        } catch (error) {
            console.error('App initialization error:', error);
            this.showErrorScreen('Failed to initialize application. Please refresh the page.');
        }
    }

    initFirebase() {
        try {
            // Check if Firebase is available
            if (typeof firebase === 'undefined') {
                throw new Error('Firebase is not loaded');
            }

            // Use config from config.js if available, otherwise use default
            const config = typeof firebaseConfig !== 'undefined' ? firebaseConfig : {
                apiKey: "AIzaSyBltucXfxN3xzOxX5s8s7Kv8yCBa5azxzU",
                authDomain: "tool-tracking-system-15e84.firebaseapp.com",
                projectId: "tool-tracking-system-15e84",
                storageBucket: "tool-tracking-system-15e84.firebasestorage.app",
                messagingSenderId: "813615362050",
                appId: "1:813615362050:web:1fa435f0b725dd1f8cb71b"
            };

            // Initialize Firebase
            firebase.initializeApp(config);
            
            // Initialize services
            this.auth = firebase.auth();
            this.db = firebase.firestore();
            
            console.log('Firebase initialized successfully');
        } catch (error) {
            console.error('Firebase initialization error:', error);
            throw new Error('Failed to initialize Firebase: ' + error.message);
        }
    }

    setupEventListeners() {
        try {
            // Login form
            const loginForm = document.getElementById('loginForm');
            if (loginForm) {
                loginForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.handleLogin();
                });
            }

            // Signup form
            const signupForm = document.getElementById('signupForm');
            if (signupForm) {
                signupForm.addEventListener('submit', (e) => {
                    e.preventDefault();
                    this.handleSignup();
                });
            }

            // Password toggles
            const togglePassword = document.getElementById('togglePassword');
            if (togglePassword) {
                togglePassword.addEventListener('click', () => {
                    this.togglePasswordVisibility('password');
                });
            }

            const toggleSignupPassword = document.getElementById('toggleSignupPassword');
            if (toggleSignupPassword) {
                toggleSignupPassword.addEventListener('click', () => {
                    this.togglePasswordVisibility('signupPassword');
                });
            }

            const toggleSignupConfirmPassword = document.getElementById('toggleSignupConfirmPassword');
            if (toggleSignupConfirmPassword) {
                toggleSignupConfirmPassword.addEventListener('click', () => {
                    this.togglePasswordVisibility('signupConfirmPassword');
                });
            }

            // Navigation buttons
            const createAccountBtn = document.getElementById('createAccountBtn');
            if (createAccountBtn) {
                createAccountBtn.addEventListener('click', () => {
                    this.showScreen('signup');
                });
            }

            const backToLogin = document.getElementById('backToLogin');
            if (backToLogin) {
                backToLogin.addEventListener('click', () => {
                    this.showScreen('login');
                });
            }

            const adminBtn = document.getElementById('adminBtn');
            if (adminBtn) {
                adminBtn.addEventListener('click', () => {
                    this.showAdminLogin();
                });
            }

            const forgotPassword = document.getElementById('forgotPassword');
            if (forgotPassword) {
                forgotPassword.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.showForgotPassword();
                });
            }

            // Main navigation
            const scanBtn = document.getElementById('scanBtn');
            if (scanBtn) {
                scanBtn.addEventListener('click', () => {
                    this.showScreen('scanner');
                });
            }

            const registerBtn = document.getElementById('registerBtn');
            if (registerBtn) {
                registerBtn.onclick = () => this.showScreen('registerScreen');
            }

            const previousOutBtn = document.getElementById('previousOutBtn');
            if (previousOutBtn) {
                previousOutBtn.onclick = () => this.showScreen('previousOutScreen');
            }

            const myToolsBtn = document.getElementById('myToolsBtn');
            if (myToolsBtn) {
                myToolsBtn.onclick = () => this.showScreen('myToolsScreen');
            }

            const searchBtn = document.getElementById('searchBtn');
            if (searchBtn) {
                searchBtn.onclick = () => this.showScreen('searchScreen');
            }

            const checkupBtn = document.getElementById('checkupBtn');
            if (checkupBtn) {
                checkupBtn.addEventListener('click', () => {
                    this.showScreen('checkup');
                });
            }

            const myAccountBtn = document.getElementById('myAccountBtn');
            if (myAccountBtn) {
                myAccountBtn.addEventListener('click', () => {
                    this.showScreen('myAccount');
                });
            }

            const logoutBtn = document.getElementById('logoutBtn');
            if (logoutBtn) {
                logoutBtn.onclick = () => this.handleLogout();
            }

            // Back buttons
            const backToMain = document.getElementById('backToMain');
            if (backToMain) {
                backToMain.addEventListener('click', () => {
                    this.showScreen('toolScannerMenu');
                });
            }

            const backToMainFromRegister = document.getElementById('backToMainFromRegister');
            if (backToMainFromRegister) {
                backToMainFromRegister.addEventListener('click', () => {
                    this.showScreen('toolScannerMenu');
                });
            }

            const backToMainFromSearch = document.getElementById('backToMainFromSearch');
            if (backToMainFromSearch) {
                backToMainFromSearch.addEventListener('click', () => {
                    this.showScreen('toolScannerMenu');
                });
            }

            const backToMainFromPrevious = document.getElementById('backToMainFromPrevious');
            if (backToMainFromPrevious) {
                backToMainFromPrevious.addEventListener('click', () => {
                    this.showScreen('toolScannerMenu');
                });
            }

            const backToMainFromMyTools = document.getElementById('backToMainFromMyTools');
            if (backToMainFromMyTools) {
                backToMainFromMyTools.addEventListener('click', () => {
                    this.showScreen('toolScannerMenu');
                });
            }

            const backToMainFromAccount = document.getElementById('backToMainFromAccount');
            if (backToMainFromAccount) {
                backToMainFromAccount.addEventListener('click', () => {
                    this.showScreen('toolScannerMenu');
                });
            }

            // Scanner functionality
            const toggleCameraBtn = document.getElementById('toggleCameraBtn');
            if (toggleCameraBtn) {
                toggleCameraBtn.addEventListener('click', () => {
                    this.toggleCamera();
                });
            }

            const toolCode = document.getElementById('toolCode');
            if (toolCode) {
                toolCode.addEventListener('input', (e) => {
                    const toolDetailsBtn = document.getElementById('toolDetailsBtn');
                    if (toolDetailsBtn) {
                        toolDetailsBtn.disabled = e.target.value.trim() === '';
                    }
                });
            }

            const toolDetailsBtn = document.getElementById('toolDetailsBtn');
            if (toolDetailsBtn) {
                toolDetailsBtn.addEventListener('click', () => {
                    this.getToolDetails();
                });
            }

            // Register functionality
            const registerToolBtn = document.getElementById('registerToolBtn');
            if (registerToolBtn) {
                registerToolBtn.addEventListener('click', () => {
                    this.registerTool();
                });
            }

            // Search functionality
            document.querySelectorAll('.search-chip').forEach(chip => {
                chip.addEventListener('click', (e) => {
                    this.setSearchType(e.target.dataset.type);
                });
            });

            const searchQuery = document.getElementById('searchQuery');
            if (searchQuery) {
                searchQuery.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this.performSearch();
                    }
                });
            }

            // Tool details modal
            const checkoutBtn = document.getElementById('checkoutBtn');
            if (checkoutBtn) {
                checkoutBtn.addEventListener('click', () => {
                    this.checkoutTool();
                });
            }

            const checkinBtn = document.getElementById('checkinBtn');
            if (checkinBtn) {
                checkinBtn.addEventListener('click', () => {
                    this.checkinTool();
                });
            }

            // Menu buttons
            const refreshBtn = document.getElementById('refreshBtn');
            if (refreshBtn) {
                refreshBtn.onclick = () => this.refreshMenu();
            }

            console.log('Event listeners setup completed');
        } catch (error) {
            console.error('Error setting up event listeners:', error);
        }
    }

    checkExistingSession() {
        const keepSignedIn = localStorage.getItem('keepSignedIn') === 'true';
        const user = this.auth.currentUser;

        if (keepSignedIn && user) {
            this.technicianName = localStorage.getItem('technicianName') || 'Technician';
            this.currentUser = user;
            this.showScreen('toolScannerMenu');
            this.updateMenuUsername();
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

                // Show ToolScanner menu screen instead of main screen
                this.showScreen('toolScannerMenu');
                this.updateMenuUsername();
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

    async handleSignup() {
        const fullName = document.getElementById('signupFullName').value.trim();
        const email = document.getElementById('signupEmail').value.trim();
        const password = document.getElementById('signupPassword').value;
        const confirmPassword = document.getElementById('signupConfirmPassword').value;

        // Validation
        if (!fullName || !email || !password || !confirmPassword) {
            this.showSignupAlert('Please fill in all fields', 'error');
            return;
        }

        if (password !== confirmPassword) {
            this.showSignupAlert('Passwords do not match', 'error');
            return;
        }

        if (password.length < 6) {
            this.showSignupAlert('Password must be at least 6 characters long', 'error');
            return;
        }

        const signupBtn = document.querySelector('#signupForm .btn-success');
        const btnText = signupBtn.querySelector('.btn-text');
        const btnLoading = signupBtn.querySelector('.btn-loading');

        try {
            // Show loading state
            btnText.classList.add('d-none');
            btnLoading.classList.remove('d-none');
            signupBtn.disabled = true;

            // Create user account
            const userCredential = await this.auth.createUserWithEmailAndPassword(email, password);
            const user = userCredential.user;

            // Create technician document in Firestore
            await this.db.collection('technicians').doc(user.uid).set({
                fullName: fullName,
                email: email,
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });

            this.showAlert('Account created successfully! Please log in.', 'success');
            this.showScreen('login');
            
            // Clear signup form
            document.getElementById('signupForm').reset();
            
        } catch (error) {
            console.error('Signup error:', error);
            let errorMessage = 'Account creation failed. Please try again.';
            
            if (error.code === 'auth/email-already-in-use') {
                errorMessage = 'An account with this email already exists.';
            } else if (error.code === 'auth/weak-password') {
                errorMessage = 'Password is too weak.';
            } else if (error.code === 'auth/invalid-email') {
                errorMessage = 'Invalid email format.';
            }
            
            this.showSignupAlert(errorMessage, 'error');
        } finally {
            // Reset loading state
            btnText.classList.remove('d-none');
            btnLoading.classList.add('d-none');
            signupBtn.disabled = false;
        }
    }

    showSignupAlert(message, type = 'error') {
        const alertBox = document.getElementById('signupAlert');
        alertBox.textContent = message;
        alertBox.className = `alert alert-${type === 'error' ? 'danger' : 'success'}`;
        alertBox.classList.remove('d-none');
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            alertBox.classList.add('d-none');
        }, 5000);
    }

    updateMenuUsername() {
        const menuUsername = document.getElementById('menuUsername');
        if (menuUsername) {
            menuUsername.textContent = this.technicianName;
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

    showScreen(screenId) {
        document.querySelectorAll('.app-screen, .screen').forEach(el => el.style.display = 'none');
        const screen = document.getElementById(screenId + 'Screen') || document.getElementById(screenId);
        if (screen) {
            screen.style.display = 'block';
            if (screenId === 'toolScannerMenu') {
                screen.classList.remove('fade-in');
                void screen.offsetWidth; // trigger reflow
                screen.classList.add('fade-in');
            }
            this.currentScreen = screenId;
            this.loadScreenData(screenId);
        }
    }

    loadScreenData(screenName) {
        switch (screenName) {
            case 'main':
                this.loadPreviousOutCount();
                break;
            case 'toolScannerMenu':
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
            
            // Update main screen badge
            const badge = document.getElementById('previousOutCount');
            if (badge) {
                badge.textContent = count;
                badge.style.display = count > 0 ? 'inline' : 'none';
            }
            
            // Update menu badge
            const menuBadge = document.getElementById('outToolsCount');
            if (menuBadge) {
                menuBadge.textContent = count;
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
        
        // Show login screen by default
        this.showScreen('login');
    }

    showErrorScreen(message) {
        const loadingScreen = document.getElementById('loadingScreen');
        if (loadingScreen) {
            loadingScreen.innerHTML = `
                <div class="loading-content">
                    <div class="text-light mb-3">
                        <i class="fas fa-exclamation-triangle fa-3x"></i>
                    </div>
                    <h4 class="text-light">Error</h4>
                    <p class="text-light">${message}</p>
                    <button class="btn btn-light mt-3" onclick="location.reload()">Retry</button>
                </div>
            `;
        }
    }

    togglePasswordVisibility(inputType) {
        const passwordInput = document.getElementById(inputType);
        const toggleBtn = document.getElementById(`toggle${inputType.charAt(0).toUpperCase() + inputType.slice(1)}`);
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

    refreshMenu() {
        // Simulate refresh (fetch new data in real app)
        this.outToolsCount = Math.floor(Math.random() * 20) + 1;
        this.showMenu();
    }

    showMenu() {
        this.showScreen('toolScannerMenu');
        document.getElementById('menuUsername').textContent = this.technicianName;
        document.getElementById('outToolsCount').textContent = this.outToolsCount;
    }

    navigateTo(path) {
        history.pushState({}, '', path);
        this.route(path);
    }

    route(path) {
        switch (path) {
            case '/login':
                this.showScreen('login');
                break;
            case '/toolscannermenu':
                this.showScreen('toolScannerMenu');
                break;
            case '/register':
                this.showScreen('registerScreen');
                break;
            case '/search':
                this.showScreen('searchScreen');
                break;
            case '/mytools':
                this.showScreen('myToolsScreen');
                break;
            case '/previousout':
                this.showScreen('previousOutScreen');
                break;
            case '/signup':
                this.showScreen('signup');
                break;
            default:
                this.showScreen('login');
        }
    }
}

// Listen for browser navigation
window.addEventListener('popstate', () => {
    app.route(location.pathname);
});

// On page load, route to the correct screen
window.addEventListener('DOMContentLoaded', () => {
    app.route(location.pathname);
});

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.app = new ToolTrackingApp();
}); 