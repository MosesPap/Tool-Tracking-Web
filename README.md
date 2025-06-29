# Tool Tracking Web App

A modern, responsive web application for tool tracking and management, designed to match the functionality and design of the Android app.

## Features

### 🔐 Authentication
- Secure login with Firebase Authentication
- Session management with auto-logout
- Password reset functionality
- "Keep me signed in" option

### 📱 Responsive Design
- Mobile-first design approach
- Works on all devices (desktop, tablet, mobile)
- Touch-friendly interface
- Portrait orientation optimized

### 🔍 Tool Management
- **Scan Tools**: QR code and barcode scanning
- **Register Tools**: Add new tools to the system
- **Search Tools**: Search by part number or tool name
- **Previous Out Tools**: View all checked-out tools
- **My Tools**: View tools assigned to current technician
- **Tool Details**: View and manage individual tools

### 📊 Tool Operations
- Check out tools to technicians
- Check in tools (clears technician field)
- View tool history and logs
- Status tracking (IN, OUT, BROKEN, LOST, CALIBRATION)
- Calibration due date tracking

### 🎨 UI/UX Features
- Modern Material Design-inspired interface
- Smooth animations and transitions
- Status-based color coding
- Floating shadow effects
- Responsive tool cards
- Search type chips with visual feedback

### 📱 PWA Support
- Installable as a web app
- Offline capability (basic)
- App-like experience
- Icon support for all platforms

## File Structure

```
webapp/
├── index.html          # Main HTML file
├── manifest.json       # PWA manifest
├── css/
│   └── styles.css      # Main stylesheet
├── js/
│   ├── app.js          # Main application logic
│   ├── auth.js         # Authentication management
│   ├── scanner.js      # QR/barcode scanning
│   ├── tools.js        # Tool management
│   └── ui.js           # UI interactions
└── README.md           # This file
```

## Setup Instructions

### Prerequisites
- Modern web browser with camera support
- Firebase project with Firestore database
- Web server (for HTTPS - required for camera access)

### 1. Firebase Configuration

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable Authentication (Email/Password)
3. Create Firestore database
4. Set up security rules for Firestore
5. Get your Firebase configuration

### 2. Update Firebase Config

Edit `js/app.js` and replace the Firebase configuration:

```javascript
const firebaseConfig = {
    apiKey: "your-api-key",
    authDomain: "your-auth-domain",
    projectId: "your-project-id",
    storageBucket: "your-storage-bucket",
    messagingSenderId: "your-messaging-sender-id",
    appId: "your-app-id"
};
```

### 3. Firestore Security Rules

Set up Firestore security rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow authenticated users to read/write tools
    match /tools/{toolId} {
      allow read, write: if request.auth != null;
    }
    
    // Allow authenticated users to read/write technicians
    match /technicians/{technicianId} {
      allow read, write: if request.auth != null;
    }
    
    // Allow authenticated users to read/write tool logs
    match /toolLogs/{logId} {
      allow read, write: if request.auth != null;
    }
    
    // Allow authenticated users to read/write settings
    match /settings/{settingId} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 4. Database Structure

The app expects the following Firestore collections:

#### `technicians`
```javascript
{
  fullName: "Technician Name",
  email: "technician@example.com",
  // other fields as needed
}
```

#### `tools`
```javascript
{
  id: "TOOL001",
  toolName: "Screwdriver Set",
  partNumber: "SD-001",
  status: "IN", // IN, OUT, BROKEN, LOST, CALIBRATION
  technician: "", // empty for IN status
  timestamp: Timestamp,
  location: "Workshop A",
  calibrationDueDate: "2024-12-31",
  // other fields as needed
}
```

#### `toolLogs`
```javascript
{
  toolId: "TOOL001",
  action: "CHECKOUT", // CHECKOUT, CHECKIN
  technicianName: "John Doe",
  timestamp: Timestamp,
  toolData: {
    toolName: "Screwdriver Set",
    partNumber: "SD-001",
    status: "OUT",
    location: "Workshop A",
    calibrationDueDate: "2024-12-31"
  }
}
```

#### `settings`
```javascript
{
  adminEmail: "admin@example.com",
  adminCode: "admin123",
  notificationTime: "13:00",
  CheckINCooldownMinutes: 30
}
```

### 5. Deploy to Web Server

1. Upload all files to your web server
2. Ensure HTTPS is enabled (required for camera access)
3. Set up proper CORS headers if needed

### 6. Install as PWA

1. Open the web app in a modern browser
2. Look for the install prompt or use browser menu
3. Install the app for app-like experience

## Usage

### Login
1. Enter your email and password
2. Check "Keep me signed in" if desired
3. Click "Login"

### Main Menu
The main screen provides access to all features:
- **Scan Tool**: Use camera to scan QR codes/barcodes
- **Register Tools**: Add new tools manually
- **Search Tools**: Find tools by part number or name
- **Previous Out**: View all checked-out tools
- **My Tools**: View your assigned tools
- **Checkup**: Tool collection management

### Scanning Tools
1. Click "Scan Tool"
2. Click "Start Scanner"
3. Allow camera permissions
4. Point camera at QR code or barcode
5. Tool details will appear automatically

### Searching Tools
1. Click "Search Tools"
2. Choose search type (Part Number or Tool Name)
3. Enter search term
4. Results will display as cards

### Tool Operations
- **Check Out**: Assign tool to technician
- **Check In**: Return tool (clears technician)
- **View Details**: See full tool information
- **View History**: See tool activity log

## Browser Support

### Fully Supported
- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

### Partially Supported
- Older browsers may work but with limited features
- Camera access requires HTTPS
- PWA features require modern browsers

## Mobile Support

### iOS
- Safari 13+ required
- Limited to QR codes only (web app limitation)
- Use Camera app to scan QR codes and paste manually

### Android
- Chrome 80+ recommended
- Full barcode support
- Native app-like experience

## Security Features

- Firebase Authentication
- Input sanitization
- XSS protection
- Session management
- Rate limiting for login attempts
- Secure data transmission (HTTPS required)

## Performance

- Lazy loading of content
- Efficient caching system
- Optimized images and assets
- Minimal network requests
- Responsive design for all screen sizes

## Troubleshooting

### Camera Not Working
- Ensure HTTPS is enabled
- Check browser permissions
- Try refreshing the page
- Use manual entry as fallback

### Login Issues
- Check internet connection
- Verify Firebase configuration
- Clear browser cache
- Check email/password

### Scanning Issues
- iOS: Use Camera app and paste manually
- Android: Ensure camera permissions
- Desktop: Use manual entry
- Check barcode/QR code quality

## Development

### Adding New Features
1. Edit appropriate JavaScript file
2. Update CSS for styling
3. Test on multiple devices
4. Update documentation

### Customization
- Colors: Edit CSS custom properties in `styles.css`
- Icons: Replace Font Awesome icons
- Layout: Modify HTML structure
- Functionality: Extend JavaScript classes

## License

This project is proprietary software. All rights reserved.

## Support

For technical support or questions:
- Check the troubleshooting section
- Review Firebase documentation
- Contact development team

## Version History

### v1.0.0
- Initial release
- Basic tool tracking functionality
- QR/barcode scanning
- Responsive design
- PWA support 