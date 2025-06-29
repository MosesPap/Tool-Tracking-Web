// UI management and interactions
class UIManager {
    constructor() {
        this.currentScreen = 'login';
        this.screenHistory = [];
        this.animationsEnabled = true;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupResponsiveHandlers();
        this.setupKeyboardShortcuts();
        this.setupTouchGestures();
    }

    setupEventListeners() {
        // Screen transition events
        document.addEventListener('screenChange', (e) => {
            this.handleScreenChange(e.detail);
        });

        // Form submission events
        document.addEventListener('submit', (e) => {
            this.handleFormSubmission(e);
        });

        // Button click events
        document.addEventListener('click', (e) => {
            this.handleButtonClick(e);
        });

        // Input focus events
        document.addEventListener('focusin', (e) => {
            this.handleInputFocus(e);
        });

        // Input blur events
        document.addEventListener('focusout', (e) => {
            this.handleInputBlur(e);
        });
    }

    setupResponsiveHandlers() {
        // Handle window resize
        window.addEventListener('resize', () => {
            this.handleResize();
        });

        // Handle orientation change
        window.addEventListener('orientationchange', () => {
            setTimeout(() => {
                this.handleOrientationChange();
            }, 100);
        });

        // Check initial screen size
        this.handleResize();
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardShortcut(e);
        });
    }

    setupTouchGestures() {
        let startX = 0;
        let startY = 0;
        let isSwiping = false;

        document.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isSwiping = false;
        });

        document.addEventListener('touchmove', (e) => {
            if (!isSwiping) return;

            const deltaX = e.touches[0].clientX - startX;
            const deltaY = e.touches[0].clientY - startY;

            // Determine if this is a horizontal swipe
            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 50) {
                isSwiping = true;
                e.preventDefault();
            }
        });

        document.addEventListener('touchend', (e) => {
            if (!isSwiping) return;

            const deltaX = e.changedTouches[0].clientX - startX;
            const deltaY = e.changedTouches[0].clientY - startY;

            if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 100) {
                this.handleSwipe(deltaX > 0 ? 'right' : 'left');
            }
        });
    }

    // Screen Management
    showScreen(screenName, animate = true) {
        if (this.currentScreen === screenName) return;

        const previousScreen = this.currentScreen;
        this.currentScreen = screenName;

        // Hide all screens
        this.hideAllScreens();

        // Show target screen
        const targetScreen = document.getElementById(screenName + 'Screen');
        if (targetScreen) {
            targetScreen.classList.add('active');
            
            if (animate && this.animationsEnabled) {
                targetScreen.classList.add('fade-in');
                setTimeout(() => {
                    targetScreen.classList.remove('fade-in');
                }, 300);
            }

            // Update screen history
            this.screenHistory.push(previousScreen);
            if (this.screenHistory.length > 10) {
                this.screenHistory.shift();
            }

            // Trigger screen change event
            this.triggerScreenChangeEvent(screenName, previousScreen);

            // Load screen-specific content
            this.loadScreenContent(screenName);
        }
    }

    hideAllScreens() {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
    }

    goBack() {
        if (this.screenHistory.length > 0) {
            const previousScreen = this.screenHistory.pop();
            this.showScreen(previousScreen);
        }
    }

    // Content Loading
    loadScreenContent(screenName) {
        switch (screenName) {
            case 'main':
                this.loadMainScreenContent();
                break;
            case 'scanner':
                this.loadScannerScreenContent();
                break;
            case 'register':
                this.loadRegisterScreenContent();
                break;
            case 'search':
                this.loadSearchScreenContent();
                break;
            case 'previousOut':
                this.loadPreviousOutScreenContent();
                break;
            case 'myTools':
                this.loadMyToolsScreenContent();
                break;
            case 'myAccount':
                this.loadMyAccountScreenContent();
                break;
        }
    }

    loadMainScreenContent() {
        // Update technician name
        const technicianName = window.AuthManager.getTechnicianName();
        const nameElement = document.getElementById('technicianName');
        if (nameElement) {
            nameElement.textContent = technicianName;
        }

        // Load previous out count
        this.loadPreviousOutCount();
    }

    loadScannerScreenContent() {
        // Initialize scanner
        window.Scanner.init();
    }

    loadRegisterScreenContent() {
        // Clear form fields
        document.getElementById('registerToolCode').value = '';
        document.getElementById('technicianNameInput').value = '';
    }

    loadSearchScreenContent() {
        // Set default search type
        this.setSearchType('partNumber');
        
        // Clear search results
        const resultsContainer = document.getElementById('searchResults');
        if (resultsContainer) {
            resultsContainer.style.display = 'none';
        }
    }

    async loadPreviousOutScreenContent() {
        const result = await window.ToolManager.getPreviousOutTools();
        if (result.success) {
            this.displayTools(result.tools, 'previousOutContent');
        } else {
            this.showAlert('Error loading previous out tools', 'error');
        }
    }

    async loadMyToolsScreenContent() {
        const technicianName = window.AuthManager.getTechnicianName();
        const result = await window.ToolManager.getMyTools(technicianName);
        if (result.success) {
            this.displayTools(result.tools, 'myToolsContent');
        } else {
            this.showAlert('Error loading my tools', 'error');
        }
    }

    loadMyAccountScreenContent() {
        const technicianName = window.AuthManager.getTechnicianName();
        const currentUser = window.AuthManager.getCurrentUser();

        const accountName = document.getElementById('accountName');
        const accountEmail = document.getElementById('accountEmail');

        if (accountName) accountName.textContent = technicianName;
        if (accountEmail) accountEmail.textContent = currentUser?.email || 'N/A';
    }

    // Tool Display
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
        const timestamp = window.ToolManager.formatTimestamp(tool.timestamp);
        const status = tool.status || 'N/A';
        const statusClass = status.toLowerCase();
        const statusColor = window.ToolManager.getStatusColor(status);
        
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

        const timestamp = window.ToolManager.formatTimestamp(tool.timestamp);
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
        window.app.currentTool = tool;
        modal.show();
    }

    // Search Functionality
    setSearchType(type) {
        document.querySelectorAll('.search-chip').forEach(chip => {
            chip.classList.remove('active');
        });
        document.querySelector(`[data-type="${type}"]`).classList.add('active');
        window.app.currentSearchType = type;
    }

    async performSearch() {
        const query = document.getElementById('searchQuery').value.trim();
        const type = window.app.currentSearchType || 'partNumber';

        if (!query) {
            this.showAlert('Please enter a search term', 'error');
            return;
        }

        const result = await window.ToolManager.searchTools(query, type);
        if (result.success) {
            this.displaySearchResults(result.tools);
        } else {
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

    // Data Loading
    async loadPreviousOutCount() {
        const result = await window.ToolManager.getPreviousOutTools();
        if (result.success) {
            const count = result.tools.length;
            const badge = document.getElementById('previousOutCount');
            if (badge) {
                badge.textContent = count;
                badge.style.display = count > 0 ? 'inline' : 'none';
            }
        }
    }

    // Event Handlers
    handleScreenChange(detail) {
        console.log('Screen changed:', detail);
        // Additional screen change logic can be added here
    }

    handleFormSubmission(e) {
        // Add form validation and submission handling
        const form = e.target;
        if (form.id === 'loginForm') {
            e.preventDefault();
            window.app.handleLogin();
        }
    }

    handleButtonClick(e) {
        const button = e.target.closest('button');
        if (!button) return;

        // Add button click effects
        this.addButtonClickEffect(button);
    }

    handleInputFocus(e) {
        const input = e.target;
        input.parentElement.classList.add('focused');
    }

    handleInputBlur(e) {
        const input = e.target;
        input.parentElement.classList.remove('focused');
    }

    handleResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;

        // Update CSS custom properties for responsive design
        document.documentElement.style.setProperty('--viewport-width', `${width}px`);
        document.documentElement.style.setProperty('--viewport-height', `${height}px`);

        // Handle mobile-specific adjustments
        if (width < 768) {
            document.body.classList.add('mobile');
        } else {
            document.body.classList.remove('mobile');
        }
    }

    handleOrientationChange() {
        // Handle orientation change for mobile devices
        setTimeout(() => {
            this.handleResize();
        }, 100);
    }

    handleKeyboardShortcut(e) {
        // Add keyboard shortcuts
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case '1':
                    e.preventDefault();
                    this.showScreen('main');
                    break;
                case '2':
                    e.preventDefault();
                    this.showScreen('scanner');
                    break;
                case '3':
                    e.preventDefault();
                    this.showScreen('search');
                    break;
            }
        }

        // Escape key to go back
        if (e.key === 'Escape') {
            this.goBack();
        }
    }

    handleSwipe(direction) {
        // Handle swipe gestures for mobile
        if (direction === 'left' && this.currentScreen === 'main') {
            this.showScreen('scanner');
        } else if (direction === 'right' && this.currentScreen !== 'main') {
            this.goBack();
        }
    }

    // UI Effects
    addButtonClickEffect(button) {
        button.style.transform = 'scale(0.95)';
        setTimeout(() => {
            button.style.transform = '';
        }, 150);
    }

    showLoading(element) {
        if (element) {
            element.classList.add('loading');
            element.disabled = true;
        }
    }

    hideLoading(element) {
        if (element) {
            element.classList.remove('loading');
            element.disabled = false;
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

    // Utility Methods
    triggerScreenChangeEvent(newScreen, previousScreen) {
        const event = new CustomEvent('screenChange', {
            detail: {
                newScreen,
                previousScreen,
                timestamp: Date.now()
            }
        });
        document.dispatchEvent(event);
    }

    enableAnimations() {
        this.animationsEnabled = true;
    }

    disableAnimations() {
        this.animationsEnabled = false;
    }

    getCurrentScreen() {
        return this.currentScreen;
    }

    getScreenHistory() {
        return [...this.screenHistory];
    }
}

// Initialize UI manager
let uiManager = null;

// Export UI functions for use in main app
window.UIManager = {
    init: () => {
        if (!uiManager) {
            uiManager = new UIManager();
        }
        return uiManager;
    },
    
    showScreen: (screenName, animate) => {
        if (uiManager) {
            uiManager.showScreen(screenName, animate);
        }
    },
    
    goBack: () => {
        if (uiManager) {
            uiManager.goBack();
        }
    },
    
    showAlert: (message, type) => {
        if (uiManager) {
            uiManager.showAlert(message, type);
        }
    },
    
    showLoading: (element) => {
        if (uiManager) {
            uiManager.showLoading(element);
        }
    },
    
    hideLoading: (element) => {
        if (uiManager) {
            uiManager.hideLoading(element);
        }
    },
    
    getCurrentScreen: () => {
        if (uiManager) {
            return uiManager.getCurrentScreen();
        }
        return 'login';
    }
}; 