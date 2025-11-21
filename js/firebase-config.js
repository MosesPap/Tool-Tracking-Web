// Firebase Configuration
const firebaseConfig = {
    apiKey: "AIzaSyDmI0v_pVt_qFJlsqmw8QlIOi-4VLjyn54",
    authDomain: "tool-tracking-system-15e84.firebaseapp.com",
    projectId: "tool-tracking-system-15e84",
    storageBucket: "tool-tracking-system-15e84.firebasestorage.app",
    messagingSenderId: "813615362050",
    appId: "1:813615362050:web:1fa435f0b725dd1f8cb71b"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

// Firebase services
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();

// Configure Firebase Auth
auth.useDeviceLanguage();
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

// Set custom error messages for unverified emails
auth.onAuthStateChanged(function(user) {
    if (user && !user.emailVerified) {
        // Force sign out if user is not verified
        auth.signOut();
    }
});

