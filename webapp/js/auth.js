// Authentication and security management
class AuthManager {
    constructor() {
        this.currentUser = null;
        this.technicianName = '';
        this.isAuthenticated = false;
        this.sessionTimeout = 30 * 60 * 1000; // 30 minutes
        this.sessionTimer = null;
        this.init();
    }

    init() {
        this.setupAuthStateListener();
        this.setupSessionManagement();
        this.setupSecurityHeaders();
    }

    setupAuthStateListener() {
        // Listen for authentication state changes
        firebase.auth().onAuthStateChanged((user) => {
            if (user) {
                this.currentUser = user;
                this.isAuthenticated = true;
                this.loadTechnicianData(user.uid);
                this.startSessionTimer();
            } else {
                this.currentUser = null;
                this.isAuthenticated = false;
                this.technicianName = '';
                this.stopSessionTimer();
                this.clearSessionData();
            }
        });
    }

    setupSessionManagement() {
        // Check for existing session on page load
        const keepSignedIn = localStorage.getItem('keepSignedIn') === 'true';
        const lastActivity = localStorage.getItem('lastActivity');
        
        if (keepSignedIn && lastActivity) {
            const timeSinceLastActivity = Date.now() - parseInt(lastActivity);
            if (timeSinceLastActivity < this.sessionTimeout) {
                // Session is still valid
                this.updateLastActivity();
            } else {
                // Session expired
                this.clearSessionData();
                this.logout();
            }
        }

        // Update activity timestamp on user interaction
        ['click', 'keypress', 'scroll', 'mousemove'].forEach(event => {
            document.addEventListener(event, () => {
                this.updateLastActivity();
            }, { passive: true });
        });
    }

    setupSecurityHeaders() {
        // Add security headers if possible
        if (typeof window !== 'undefined') {
            // Set CSP headers if supported
            const meta = document.createElement('meta');
            meta.httpEquiv = 'Content-Security-Policy';
            meta.content = "default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: https:;";
            document.head.appendChild(meta);
        }
    }

    async loadTechnicianData(uid) {
        try {
            const technicianDoc = await firebase.firestore()
                .collection('technicians')
                .doc(uid)
                .get();

            if (technicianDoc.exists) {
                const data = technicianDoc.data();
                this.technicianName = data.fullName || 'Technician';
                localStorage.setItem('technicianName', this.technicianName);
            }
        } catch (error) {
            console.error('Error loading technician data:', error);
        }
    }

    async login(email, password, keepSignedIn = false) {
        try {
            // Validate input
            if (!this.validateEmail(email)) {
                throw new Error('Invalid email format');
            }

            if (!this.validatePassword(password)) {
                throw new Error('Password must be at least 6 characters long');
            }

            // Attempt login
            const userCredential = await firebase.auth().signInWithEmailAndPassword(email, password);
            const user = userCredential.user;

            // Verify user exists in technicians collection
            const technicianDoc = await firebase.firestore()
                .collection('technicians')
                .doc(user.uid)
                .get();

            if (!technicianDoc.exists) {
                await firebase.auth().signOut();
                throw new Error('No technician account found with this email');
            }

            // Set session preferences
            if (keepSignedIn) {
                localStorage.setItem('keepSignedIn', 'true');
            }

            this.updateLastActivity();
            return { success: true, user };

        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: this.getErrorMessage(error) };
        }
    }

    async logout() {
        try {
            await firebase.auth().signOut();
            this.clearSessionData();
            this.stopSessionTimer();
            return { success: true };
        } catch (error) {
            console.error('Logout error:', error);
            return { success: false, error: 'Logout failed' };
        }
    }

    async resetPassword(email) {
        try {
            if (!this.validateEmail(email)) {
                throw new Error('Invalid email format');
            }

            await firebase.auth().sendPasswordResetEmail(email);
            return { success: true };
        } catch (error) {
            console.error('Password reset error:', error);
            return { success: false, error: this.getErrorMessage(error) };
        }
    }

    async changePassword(currentPassword, newPassword) {
        try {
            if (!this.currentUser) {
                throw new Error('No user logged in');
            }

            if (!this.validatePassword(newPassword)) {
                throw new Error('New password must be at least 6 characters long');
            }

            // Re-authenticate user
            const credential = firebase.auth.EmailAuthProvider.credential(
                this.currentUser.email,
                currentPassword
            );
            await this.currentUser.reauthenticateWithCredential(credential);

            // Change password
            await this.currentUser.updatePassword(newPassword);
            return { success: true };
        } catch (error) {
            console.error('Password change error:', error);
            return { success: false, error: this.getErrorMessage(error) };
        }
    }

    validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    validatePassword(password) {
        return password && password.length >= 6;
    }

    getErrorMessage(error) {
        switch (error.code) {
            case 'auth/user-not-found':
                return 'No account found with this email';
            case 'auth/wrong-password':
                return 'Invalid password';
            case 'auth/invalid-email':
                return 'Invalid email format';
            case 'auth/weak-password':
                return 'Password is too weak';
            case 'auth/email-already-in-use':
                return 'Email is already registered';
            case 'auth/network-request-failed':
                return 'Network error. Please check your connection';
            case 'auth/too-many-requests':
                return 'Too many failed attempts. Please try again later';
            case 'auth/user-disabled':
                return 'Account has been disabled';
            case 'auth/operation-not-allowed':
                return 'This operation is not allowed';
            default:
                return error.message || 'An error occurred';
        }
    }

    updateLastActivity() {
        localStorage.setItem('lastActivity', Date.now().toString());
    }

    startSessionTimer() {
        this.stopSessionTimer(); // Clear any existing timer
        
        this.sessionTimer = setInterval(() => {
            const lastActivity = localStorage.getItem('lastActivity');
            if (lastActivity) {
                const timeSinceLastActivity = Date.now() - parseInt(lastActivity);
                if (timeSinceLastActivity >= this.sessionTimeout) {
                    this.handleSessionTimeout();
                }
            }
        }, 60000); // Check every minute
    }

    stopSessionTimer() {
        if (this.sessionTimer) {
            clearInterval(this.sessionTimer);
            this.sessionTimer = null;
        }
    }

    handleSessionTimeout() {
        this.showSessionTimeoutDialog();
    }

    showSessionTimeoutDialog() {
        // Create timeout dialog
        const dialog = document.createElement('div');
        dialog.className = 'modal fade';
        dialog.id = 'sessionTimeoutModal';
        dialog.innerHTML = `
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Session Expired</h5>
                    </div>
                    <div class="modal-body">
                        <p>Your session has expired due to inactivity. Please log in again to continue.</p>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-primary" onclick="window.authManager.handleSessionTimeoutAction()">
                            OK
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(dialog);
        
        const modal = new bootstrap.Modal(dialog);
        modal.show();

        // Remove dialog after it's hidden
        dialog.addEventListener('hidden.bs.modal', () => {
            document.body.removeChild(dialog);
        });
    }

    handleSessionTimeoutAction() {
        bootstrap.Modal.getInstance(document.getElementById('sessionTimeoutModal')).hide();
        this.logout();
        window.app.showScreen('login');
    }

    clearSessionData() {
        localStorage.removeItem('keepSignedIn');
        localStorage.removeItem('technicianName');
        localStorage.removeItem('lastActivity');
    }

    isUserAuthenticated() {
        return this.isAuthenticated && this.currentUser !== null;
    }

    getCurrentUser() {
        return this.currentUser;
    }

    getTechnicianName() {
        return this.technicianName;
    }

    // Security utilities
    sanitizeInput(input) {
        if (typeof input !== 'string') return input;
        
        // Remove potentially dangerous characters
        return input
            .replace(/[<>]/g, '') // Remove < and >
            .replace(/javascript:/gi, '') // Remove javascript: protocol
            .replace(/on\w+=/gi, '') // Remove event handlers
            .trim();
    }

    validateToolCode(toolCode) {
        if (!toolCode || typeof toolCode !== 'string') return false;
        
        // Allow alphanumeric characters, hyphens, and underscores
        const validPattern = /^[a-zA-Z0-9\-_]+$/;
        return validPattern.test(toolCode.trim()) && toolCode.length >= 3 && toolCode.length <= 50;
    }

    // Rate limiting for login attempts
    setupRateLimiting() {
        const loginAttempts = JSON.parse(localStorage.getItem('loginAttempts') || '[]');
        const now = Date.now();
        const windowStart = now - (15 * 60 * 1000); // 15 minutes

        // Remove old attempts
        const recentAttempts = loginAttempts.filter(attempt => attempt > windowStart);

        // Check if too many attempts
        if (recentAttempts.length >= 5) {
            const oldestAttempt = Math.min(...recentAttempts);
            const timeRemaining = Math.ceil((oldestAttempt + (15 * 60 * 1000) - now) / 1000 / 60);
            throw new Error(`Too many login attempts. Please try again in ${timeRemaining} minutes.`);
        }

        // Add current attempt
        recentAttempts.push(now);
        localStorage.setItem('loginAttempts', JSON.stringify(recentAttempts));
    }

    clearRateLimit() {
        localStorage.removeItem('loginAttempts');
    }
}

// Initialize auth manager
let authManager = null;

// Export auth functions for use in main app
window.AuthManager = {
    init: () => {
        if (!authManager) {
            authManager = new AuthManager();
        }
        return authManager;
    },
    
    login: (email, password, keepSignedIn) => {
        if (authManager) {
            return authManager.login(email, password, keepSignedIn);
        }
        return { success: false, error: 'Auth manager not initialized' };
    },
    
    logout: () => {
        if (authManager) {
            return authManager.logout();
        }
        return { success: false, error: 'Auth manager not initialized' };
    },
    
    resetPassword: (email) => {
        if (authManager) {
            return authManager.resetPassword(email);
        }
        return { success: false, error: 'Auth manager not initialized' };
    },
    
    isAuthenticated: () => {
        if (authManager) {
            return authManager.isUserAuthenticated();
        }
        return false;
    },
    
    getCurrentUser: () => {
        if (authManager) {
            return authManager.getCurrentUser();
        }
        return null;
    },
    
    getTechnicianName: () => {
        if (authManager) {
            return authManager.getTechnicianName();
        }
        return '';
    },
    
    sanitizeInput: (input) => {
        if (authManager) {
            return authManager.sanitizeInput(input);
        }
        return input;
    },
    
    validateToolCode: (toolCode) => {
        if (authManager) {
            return authManager.validateToolCode(toolCode);
        }
        return false;
    }
}; 