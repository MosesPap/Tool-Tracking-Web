// Tool management and data operations
class ToolManager {
    constructor() {
        this.db = firebase.firestore();
        this.currentTool = null;
        this.toolsCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    // Tool CRUD Operations
    async createTool(toolData) {
        try {
            // Validate tool data
            const validation = this.validateToolData(toolData);
            if (!validation.isValid) {
                throw new Error(validation.error);
            }

            // Sanitize data
            const sanitizedData = this.sanitizeToolData(toolData);

            // Check if tool already exists
            const existingTool = await this.db.collection('tools').doc(sanitizedData.id).get();
            if (existingTool.exists) {
                throw new Error('Tool with this ID already exists');
            }

            // Add timestamp and default values
            const toolToCreate = {
                ...sanitizedData,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: window.AuthManager.getCurrentUser()?.uid || 'unknown'
            };

            // Create tool
            await this.db.collection('tools').doc(sanitizedData.id).set(toolToCreate);

            // Clear cache
            this.clearCache();

            return { success: true, toolId: sanitizedData.id };
        } catch (error) {
            console.error('Error creating tool:', error);
            return { success: false, error: error.message };
        }
    }

    async getTool(toolId) {
        try {
            // Check cache first
            const cachedTool = this.getFromCache(toolId);
            if (cachedTool) {
                return { success: true, tool: cachedTool };
            }

            // Get from database
            const toolDoc = await this.db.collection('tools').doc(toolId).get();
            
            if (!toolDoc.exists) {
                return { success: false, error: 'Tool not found' };
            }

            const tool = { id: toolDoc.id, ...toolDoc.data() };
            
            // Cache the tool
            this.addToCache(toolId, tool);

            return { success: true, tool };
        } catch (error) {
            console.error('Error getting tool:', error);
            return { success: false, error: error.message };
        }
    }

    async updateTool(toolId, updateData) {
        try {
            // Validate update data
            const validation = this.validateUpdateData(updateData);
            if (!validation.isValid) {
                throw new Error(validation.error);
            }

            // Sanitize data
            const sanitizedData = this.sanitizeToolData(updateData);

            // Add update timestamp
            const toolToUpdate = {
                ...sanitizedData,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedBy: window.AuthManager.getCurrentUser()?.uid || 'unknown'
            };

            // Update tool
            await this.db.collection('tools').doc(toolId).update(toolToUpdate);

            // Clear cache
            this.clearCache();

            return { success: true };
        } catch (error) {
            console.error('Error updating tool:', error);
            return { success: false, error: error.message };
        }
    }

    async deleteTool(toolId) {
        try {
            // Check if tool exists
            const toolDoc = await this.db.collection('tools').doc(toolId).get();
            if (!toolDoc.exists) {
                throw new Error('Tool not found');
            }

            // Delete tool
            await this.db.collection('tools').doc(toolId).delete();

            // Clear cache
            this.clearCache();

            return { success: true };
        } catch (error) {
            console.error('Error deleting tool:', error);
            return { success: false, error: error.message };
        }
    }

    // Tool Status Operations
    async checkoutTool(toolId, technicianName) {
        try {
            // Validate inputs
            if (!toolId || !technicianName) {
                throw new Error('Tool ID and technician name are required');
            }

            // Get current tool
            const toolResult = await this.getTool(toolId);
            if (!toolResult.success) {
                throw new Error(toolResult.error);
            }

            const tool = toolResult.tool;

            // Check if tool can be checked out
            if (tool.status === 'OUT') {
                throw new Error('Tool is already checked out');
            }

            if (tool.status === 'BROKEN') {
                throw new Error('Cannot checkout broken tool');
            }

            if (tool.status === 'LOST') {
                throw new Error('Cannot checkout lost tool');
            }

            if (tool.status === 'CALIBRATION') {
                throw new Error('Cannot checkout tool under calibration');
            }

            // Check calibration due date
            if (tool.calibrationDueDate) {
                const dueDate = new Date(tool.calibrationDueDate);
                const today = new Date();
                if (dueDate < today) {
                    throw new Error('Tool calibration has expired');
                }
            }

            // Update tool status
            const updateData = {
                status: 'OUT',
                technician: technicianName,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                lastCheckout: firebase.firestore.FieldValue.serverTimestamp()
            };

            const updateResult = await this.updateTool(toolId, updateData);
            if (!updateResult.success) {
                throw new Error(updateResult.error);
            }

            // Create log entry
            await this.createLogEntry(toolId, 'CHECKOUT', technicianName, tool);

            return { success: true };
        } catch (error) {
            console.error('Error checking out tool:', error);
            return { success: false, error: error.message };
        }
    }

    async checkinTool(toolId) {
        try {
            // Validate inputs
            if (!toolId) {
                throw new Error('Tool ID is required');
            }

            // Get current tool
            const toolResult = await this.getTool(toolId);
            if (!toolResult.success) {
                throw new Error(toolResult.error);
            }

            const tool = toolResult.tool;

            // Check if tool can be checked in
            if (tool.status === 'IN') {
                throw new Error('Tool is already checked in');
            }

            // Update tool status
            const updateData = {
                status: 'IN',
                technician: '', // Clear technician field
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                lastCheckin: firebase.firestore.FieldValue.serverTimestamp()
            };

            const updateResult = await this.updateTool(toolId, updateData);
            if (!updateResult.success) {
                throw new Error(updateResult.error);
            }

            // Create log entry
            await this.createLogEntry(toolId, 'CHECKIN', tool.technician, tool);

            return { success: true };
        } catch (error) {
            console.error('Error checking in tool:', error);
            return { success: false, error: error.message };
        }
    }

    // Search Operations
    async searchTools(query, searchType = 'partNumber') {
        try {
            // Validate inputs
            if (!query || query.trim() === '') {
                throw new Error('Search query is required');
            }

            const trimmedQuery = query.trim();
            let snapshot;

            if (searchType === 'partNumber') {
                snapshot = await this.db.collection('tools')
                    .where('partNumber', '>=', trimmedQuery)
                    .where('partNumber', '<=', trimmedQuery + '\uf8ff')
                    .get();
            } else if (searchType === 'toolName') {
                snapshot = await this.db.collection('tools')
                    .where('toolName', '>=', trimmedQuery)
                    .where('toolName', '<=', trimmedQuery + '\uf8ff')
                    .get();
            } else {
                throw new Error('Invalid search type');
            }

            const tools = [];
            snapshot.forEach(doc => {
                tools.push({ id: doc.id, ...doc.data() });
            });

            // Remove duplicates by tool ID
            const uniqueTools = this.removeDuplicates(tools);

            return { success: true, tools: uniqueTools };
        } catch (error) {
            console.error('Error searching tools:', error);
            return { success: false, error: error.message };
        }
    }

    // Query Operations
    async getToolsByStatus(status) {
        try {
            const snapshot = await this.db.collection('tools')
                .where('status', '==', status)
                .orderBy('timestamp', 'desc')
                .get();

            const tools = [];
            snapshot.forEach(doc => {
                tools.push({ id: doc.id, ...doc.data() });
            });

            return { success: true, tools };
        } catch (error) {
            console.error('Error getting tools by status:', error);
            return { success: false, error: error.message };
        }
    }

    async getToolsByTechnician(technicianName) {
        try {
            const snapshot = await this.db.collection('tools')
                .where('technician', '==', technicianName)
                .orderBy('timestamp', 'desc')
                .get();

            const tools = [];
            snapshot.forEach(doc => {
                tools.push({ id: doc.id, ...doc.data() });
            });

            return { success: true, tools };
        } catch (error) {
            console.error('Error getting tools by technician:', error);
            return { success: false, error: error.message };
        }
    }

    async getPreviousOutTools() {
        return this.getToolsByStatus('OUT');
    }

    async getMyTools(technicianName) {
        return this.getToolsByTechnician(technicianName);
    }

    // Logging Operations
    async createLogEntry(toolId, action, technicianName, toolData) {
        try {
            const logEntry = {
                toolId: toolId,
                action: action,
                technicianName: technicianName,
                timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                toolData: {
                    toolName: toolData.toolName,
                    partNumber: toolData.partNumber,
                    status: toolData.status,
                    location: toolData.location,
                    calibrationDueDate: toolData.calibrationDueDate
                }
            };

            await this.db.collection('toolLogs').add(logEntry);
            return { success: true };
        } catch (error) {
            console.error('Error creating log entry:', error);
            return { success: false, error: error.message };
        }
    }

    async getToolHistory(toolId) {
        try {
            const snapshot = await this.db.collection('toolLogs')
                .where('toolId', '==', toolId)
                .orderBy('timestamp', 'desc')
                .limit(50)
                .get();

            const logs = [];
            snapshot.forEach(doc => {
                logs.push({ id: doc.id, ...doc.data() });
            });

            return { success: true, logs };
        } catch (error) {
            console.error('Error getting tool history:', error);
            return { success: false, error: error.message };
        }
    }

    // Validation Methods
    validateToolData(toolData) {
        if (!toolData.id || !window.AuthManager.validateToolCode(toolData.id)) {
            return { isValid: false, error: 'Invalid tool ID' };
        }

        if (!toolData.toolName || toolData.toolName.trim().length < 2) {
            return { isValid: false, error: 'Tool name must be at least 2 characters' };
        }

        if (!toolData.partNumber || toolData.partNumber.trim().length < 2) {
            return { isValid: false, error: 'Part number must be at least 2 characters' };
        }

        const validStatuses = ['IN', 'OUT', 'BROKEN', 'LOST', 'CALIBRATION'];
        if (toolData.status && !validStatuses.includes(toolData.status)) {
            return { isValid: false, error: 'Invalid status' };
        }

        return { isValid: true };
    }

    validateUpdateData(updateData) {
        // For updates, we only validate the fields that are being updated
        if (updateData.toolName && updateData.toolName.trim().length < 2) {
            return { isValid: false, error: 'Tool name must be at least 2 characters' };
        }

        if (updateData.partNumber && updateData.partNumber.trim().length < 2) {
            return { isValid: false, error: 'Part number must be at least 2 characters' };
        }

        const validStatuses = ['IN', 'OUT', 'BROKEN', 'LOST', 'CALIBRATION'];
        if (updateData.status && !validStatuses.includes(updateData.status)) {
            return { isValid: false, error: 'Invalid status' };
        }

        return { isValid: true };
    }

    // Sanitization Methods
    sanitizeToolData(toolData) {
        const sanitized = {};
        
        for (const [key, value] of Object.entries(toolData)) {
            if (typeof value === 'string') {
                sanitized[key] = window.AuthManager.sanitizeInput(value).trim();
            } else {
                sanitized[key] = value;
            }
        }

        return sanitized;
    }

    // Cache Management
    addToCache(key, data) {
        this.toolsCache.set(key, {
            data: data,
            timestamp: Date.now()
        });
    }

    getFromCache(key) {
        const cached = this.toolsCache.get(key);
        if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
            return cached.data;
        }
        return null;
    }

    clearCache() {
        this.toolsCache.clear();
    }

    // Utility Methods
    removeDuplicates(tools) {
        const seen = new Set();
        return tools.filter(tool => {
            const duplicate = seen.has(tool.id);
            seen.add(tool.id);
            return !duplicate;
        });
    }

    formatTimestamp(timestamp) {
        if (!timestamp) return 'Unknown';
        
        try {
            const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
            return date.toLocaleString('en-CY', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
            });
        } catch (error) {
            return 'Invalid Date';
        }
    }

    getStatusColor(status) {
        switch (status?.toUpperCase()) {
            case 'IN':
                return 'success';
            case 'OUT':
                return 'danger';
            case 'BROKEN':
                return 'warning';
            case 'LOST':
                return 'warning';
            case 'CALIBRATION':
                return 'info';
            default:
                return 'secondary';
        }
    }

    getStatusText(status) {
        return status?.toUpperCase() || 'N/A';
    }
}

// Initialize tool manager
let toolManager = null;

// Export tool functions for use in main app
window.ToolManager = {
    init: () => {
        if (!toolManager) {
            toolManager = new ToolManager();
        }
        return toolManager;
    },
    
    createTool: (toolData) => {
        if (toolManager) {
            return toolManager.createTool(toolData);
        }
        return { success: false, error: 'Tool manager not initialized' };
    },
    
    getTool: (toolId) => {
        if (toolManager) {
            return toolManager.getTool(toolId);
        }
        return { success: false, error: 'Tool manager not initialized' };
    },
    
    updateTool: (toolId, updateData) => {
        if (toolManager) {
            return toolManager.updateTool(toolId, updateData);
        }
        return { success: false, error: 'Tool manager not initialized' };
    },
    
    deleteTool: (toolId) => {
        if (toolManager) {
            return toolManager.deleteTool(toolId);
        }
        return { success: false, error: 'Tool manager not initialized' };
    },
    
    checkoutTool: (toolId, technicianName) => {
        if (toolManager) {
            return toolManager.checkoutTool(toolId, technicianName);
        }
        return { success: false, error: 'Tool manager not initialized' };
    },
    
    checkinTool: (toolId) => {
        if (toolManager) {
            return toolManager.checkinTool(toolId);
        }
        return { success: false, error: 'Tool manager not initialized' };
    },
    
    searchTools: (query, searchType) => {
        if (toolManager) {
            return toolManager.searchTools(query, searchType);
        }
        return { success: false, error: 'Tool manager not initialized' };
    },
    
    getToolsByStatus: (status) => {
        if (toolManager) {
            return toolManager.getToolsByStatus(status);
        }
        return { success: false, error: 'Tool manager not initialized' };
    },
    
    getToolsByTechnician: (technicianName) => {
        if (toolManager) {
            return toolManager.getToolsByTechnician(technicianName);
        }
        return { success: false, error: 'Tool manager not initialized' };
    },
    
    getPreviousOutTools: () => {
        if (toolManager) {
            return toolManager.getPreviousOutTools();
        }
        return { success: false, error: 'Tool manager not initialized' };
    },
    
    getMyTools: (technicianName) => {
        if (toolManager) {
            return toolManager.getMyTools(technicianName);
        }
        return { success: false, error: 'Tool manager not initialized' };
    },
    
    getToolHistory: (toolId) => {
        if (toolManager) {
            return toolManager.getToolHistory(toolId);
        }
        return { success: false, error: 'Tool manager not initialized' };
    },
    
    formatTimestamp: (timestamp) => {
        if (toolManager) {
            return toolManager.formatTimestamp(timestamp);
        }
        return 'Unknown';
    },
    
    getStatusColor: (status) => {
        if (toolManager) {
            return toolManager.getStatusColor(status);
        }
        return 'secondary';
    },
    
    getStatusText: (status) => {
        if (toolManager) {
            return toolManager.getStatusText(status);
        }
        return 'N/A';
    }
}; 