// Scanner functionality for the web app
class Scanner {
    constructor() {
        this.html5QrcodeScanner = null;
        this.isScanning = false;
        this.init();
    }

    init() {
        // Check if HTML5 QR Code library is available
        if (typeof Html5Qrcode === 'undefined') {
            console.error('HTML5 QR Code library not loaded');
            return;
        }
    }

    async toggleCamera() {
        const cameraContainer = document.getElementById('cameraContainer');
        const toggleButton = document.getElementById('toggleCameraBtn');

        if (!this.isScanning) {
            await this.startCamera();
        } else {
            await this.stopCamera();
        }
    }

    async startCamera() {
        const cameraContainer = document.getElementById('cameraContainer');
        const toggleButton = document.getElementById('toggleCameraBtn');

        try {
            // Clear any existing scanner
            if (this.html5QrcodeScanner) {
                await this.html5QrcodeScanner.clear();
                this.html5QrcodeScanner = null;
            }

            // iOS detection
            const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

            // Create scanner configuration
            const config = this.createScannerConfig(isIOS);

            // Create scanner instance
            this.html5QrcodeScanner = new Html5Qrcode("reader", {
                verbose: false,
                experimentalFeatures: {
                    useBarCodeDetectorIfSupported: true
                }
            });

            // Proactively request camera permission
            try {
                await navigator.mediaDevices.getUserMedia({ video: true });
            } catch (permError) {
                window.app.showAlert('Camera permission denied. Please allow camera access in your browser settings.', 'error');
                return;
            }

            // Start camera with no constraints for maximum compatibility
            await this.html5QrcodeScanner.start(
                {},
                config,
                (decodedText) => {
                    this.onScanSuccess(decodedText);
                },
                (error) => {
                    this.onScanError(error, isIOS);
                }
            );

            this.isScanning = true;
            cameraContainer.style.display = 'block';
            toggleButton.innerHTML = '<i class="fas fa-camera"></i> Stop Scanner';
            toggleButton.classList.remove('btn-primary');
            toggleButton.classList.add('btn-danger');

            // Show iOS user message
            if (isIOS) {
                setTimeout(() => {
                    window.app.showAlert("Note: On iPhone/iPad, only QR codes are supported in the web app. If scanning does not work, use the Camera app to scan the QR code and paste it here.", 'info');
                }, 500);
            }

        } catch (error) {
            console.error('Camera Error:', error);
            this.handleCameraError(error);
        }
    }

    async stopCamera() {
        const cameraContainer = document.getElementById('cameraContainer');
        const toggleButton = document.getElementById('toggleCameraBtn');

        try {
            if (this.html5QrcodeScanner) {
                await this.html5QrcodeScanner.stop();
                await this.html5QrcodeScanner.clear();
                this.html5QrcodeScanner = null;
            }

            this.isScanning = false;
            cameraContainer.style.display = 'none';
            toggleButton.innerHTML = '<i class="fas fa-camera"></i> Start Scanner';
            toggleButton.classList.remove('btn-danger');
            toggleButton.classList.add('btn-primary');

            // Clear the reader element
            const reader = document.getElementById('reader');
            if (reader) {
                reader.innerHTML = '';
            }
        } catch (error) {
            console.error('Error stopping camera:', error);
            window.app.showAlert('Error stopping camera. Please refresh the page and try again.', 'error');
        }
    }

    createScannerConfig(isIOS) {
        if (isIOS) {
            // iOS-specific configuration
            return {
                fps: 10,
                qrbox: { width: 300, height: 300 },
                aspectRatio: 1.0,
                formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
                videoConstraints: {
                    facingMode: { exact: "environment" },
                    width: { min: 320, ideal: 640, max: 1280 },
                    height: { min: 240, ideal: 480, max: 720 }
                }
            };
        } else {
            // Android/Desktop configuration with full barcode support
            return {
                fps: 10,
                qrbox: { width: 250, height: 250 },
                aspectRatio: 1.0,
                formatsToSupport: [
                    Html5QrcodeSupportedFormats.QR_CODE,
                    Html5QrcodeSupportedFormats.CODE_128,
                    Html5QrcodeSupportedFormats.CODE_39,
                    Html5QrcodeSupportedFormats.EAN_13,
                    Html5QrcodeSupportedFormats.EAN_8,
                    Html5QrcodeSupportedFormats.UPC_A,
                    Html5QrcodeSupportedFormats.UPC_E,
                    Html5QrcodeSupportedFormats.ITF,
                    Html5QrcodeSupportedFormats.AZTEC,
                    Html5QrcodeSupportedFormats.DATA_MATRIX,
                    Html5QrcodeSupportedFormats.CODABAR,
                    Html5QrcodeSupportedFormats.PDF_417
                ],
                videoConstraints: {
                    facingMode: { exact: "environment" },
                    width: { min: 320, ideal: 640, max: 1280 },
                    height: { min: 240, ideal: 480, max: 720 },
                    advanced: [
                        {
                            focusMode: "continuous",
                            exposureMode: "continuous",
                            whiteBalanceMode: "continuous"
                        }
                    ]
                }
            };
        }
    }

    onScanSuccess(decodedText) {
        console.log('Scanned:', decodedText);
        
        // Update the input field with the scanned code
        const toolCodeInput = document.getElementById('toolCode');
        if (toolCodeInput) {
            toolCodeInput.value = decodedText;
            
            // Trigger input event to enable the tool details button
            const inputEvent = new Event('input', { bubbles: true });
            toolCodeInput.dispatchEvent(inputEvent);
        }

        // Enable tool details button
        const toolDetailsBtn = document.getElementById('toolDetailsBtn');
        if (toolDetailsBtn) {
            toolDetailsBtn.disabled = false;
        }

        // Show success message
        window.app.showAlert(`Successfully scanned: ${decodedText}`, 'success');

        // Optional: Auto-stop camera after successful scan
        // setTimeout(() => this.stopCamera(), 1000);
    }

    onScanError(error, isIOS) {
        console.log('Scan error:', error);
        
        // On iOS, if scanning fails, suggest manual entry
        if (isIOS) {
            const toolDetailsBtn = document.getElementById('toolDetailsBtn');
            if (toolDetailsBtn) {
                toolDetailsBtn.disabled = false;
            }
        }
    }

    handleCameraError(error) {
        let errorMessage = 'Error accessing camera. Please try again.';

        if (error.name === 'NotAllowedError') {
            errorMessage = 'Camera access was denied. Please enable camera permissions in your browser settings.';
        } else if (error.name === 'NotFoundError') {
            errorMessage = 'No camera found on your device. Please make sure your camera is connected and working.';
        } else if (error.name === 'NotReadableError') {
            errorMessage = 'Your camera might be in use by another application. Please close other apps using the camera.';
        } else if (error.name === 'OverconstrainedError') {
            errorMessage = 'Camera constraints not met. Please try refreshing the page.';
        } else if (error.name === 'TypeError') {
            errorMessage = 'Camera not supported on this device. Please use a device with a camera.';
        }

        window.app.showAlert(errorMessage, 'error');
    }

    // Manual entry validation
    validateManualEntry(toolCode) {
        if (!toolCode || toolCode.trim() === '') {
            window.app.showAlert('Please enter a tool code', 'error');
            return false;
        }

        // Basic validation - tool code should be alphanumeric and reasonable length
        const trimmedCode = toolCode.trim();
        if (trimmedCode.length < 3 || trimmedCode.length > 50) {
            window.app.showAlert('Tool code should be between 3 and 50 characters', 'error');
            return false;
        }

        // Check for valid characters (alphanumeric, hyphens, underscores)
        const validPattern = /^[a-zA-Z0-9\-_]+$/;
        if (!validPattern.test(trimmedCode)) {
            window.app.showAlert('Tool code should only contain letters, numbers, hyphens, and underscores', 'error');
            return false;
        }

        return true;
    }

    // Get camera capabilities
    async getCameraCapabilities() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');
            
            console.log('Available cameras:', videoDevices);
            return videoDevices;
        } catch (error) {
            console.error('Error getting camera capabilities:', error);
            return [];
        }
    }

    // Check if camera is supported
    isCameraSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    // Get camera permissions
    async requestCameraPermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(track => track.stop());
            return true;
        } catch (error) {
            console.error('Camera permission denied:', error);
            return false;
        }
    }

    // Cleanup when leaving scanner screen
    cleanup() {
        if (this.isScanning) {
            this.stopCamera();
        }
    }

    async startCameraWithFallback(inputId) {
        const input = document.getElementById(inputId);
        if (!input) {
            window.app.showAlert('Input field not found for scanning', 'error');
            return;
        }
        // Always create a new scanner instance
        this.html5QrcodeScanner = new Html5Qrcode("reader");
        // Show the scanner UI
        const reader = document.getElementById('reader');
        if (reader) reader.style.display = 'block';
        const stopBtn = document.getElementById('stopScannerBtn');
        if (stopBtn) stopBtn.style.display = 'inline-block';
        const config = {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0,
            formatsToSupport: [
                Html5QrcodeSupportedFormats.QR_CODE,
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.CODE_39,
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.EAN_8,
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.UPC_E,
                Html5QrcodeSupportedFormats.ITF,
                Html5QrcodeSupportedFormats.AZTEC,
                Html5QrcodeSupportedFormats.DATA_MATRIX,
                Html5QrcodeSupportedFormats.CODABAR,
                Html5QrcodeSupportedFormats.PDF_417
            ]
        };
        try {
            await this.html5QrcodeScanner.start(
                { facingMode: "environment" },
                config,
                (decodedText) => {
                    input.value = decodedText;
                    const inputEvent = new Event('input', { bubbles: true });
                    input.dispatchEvent(inputEvent);
                    window.app.showAlert(`Successfully scanned: ${decodedText}`, 'success');
                    this.html5QrcodeScanner.stop().then(() => {
                        this.html5QrcodeScanner.clear();
                        if (reader) reader.style.display = 'none';
                        if (stopBtn) stopBtn.style.display = 'none';
                    });
                },
                (errorMessage) => { /* ignore scan errors */ }
            );
        } catch (err) {
            // If environment camera fails, try user camera
            try {
                await this.html5QrcodeScanner.start(
                    { facingMode: "user" },
                    config,
                    (decodedText) => {
                        input.value = decodedText;
                        const inputEvent = new Event('input', { bubbles: true });
                        input.dispatchEvent(inputEvent);
                        window.app.showAlert(`Successfully scanned: ${decodedText}`, 'success');
                        this.html5QrcodeScanner.stop().then(() => {
                            this.html5QrcodeScanner.clear();
                            if (reader) reader.style.display = 'none';
                            if (stopBtn) stopBtn.style.display = 'none';
                        });
                    },
                    (errorMessage) => { /* ignore scan errors */ }
                );
            } catch (err2) {
                window.app.showAlert('Camera error: ' + err2, 'error');
                if (reader) reader.style.display = 'none';
                if (stopBtn) stopBtn.style.display = 'none';
            }
        }
    }
}

// Initialize scanner when the module is loaded
let scanner = null;

// Export scanner functions for use in main app
window.Scanner = {
    init: () => {
        if (!scanner) {
            scanner = new Scanner();
        }
        return scanner;
    },
    
    toggleCamera: () => {
        if (scanner) {
            scanner.toggleCamera();
        }
    },
    
    cleanup: () => {
        if (scanner) {
            scanner.cleanup();
        }
    },
    
    validateManualEntry: (toolCode) => {
        if (scanner) {
            return scanner.validateManualEntry(toolCode);
        }
        return false;
    },
    // New: scan into any input field by ID
    startCameraForInput: (inputId) => {
        if (!scanner) scanner = new Scanner();
        scanner.startCameraWithFallback(inputId);
    }
}; 