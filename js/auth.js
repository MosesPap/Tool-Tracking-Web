// Authentication Functions

// Save technician to Firestore
async function saveTechnicianToFirestore(user) {
    try {
        const technicianDoc = await db.collection('technicians').doc(user.uid).get();
        if (technicianDoc.exists) {
            // Update existing technician
            await db.collection('technicians').doc(user.uid).update({
                lastSignIn: firebase.firestore.FieldValue.serverTimestamp()
            });
            const data = technicianDoc.data();
            if (data.fullName) {
                localStorage.setItem('fullName', data.fullName);
            }
        } else {
            // Create new technician
            await db.collection('technicians').doc(user.uid).set({
                fullName: user.displayName || user.email,
                email: user.email,
                isAdmin: false,
                lastSignIn: firebase.firestore.FieldValue.serverTimestamp(),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            localStorage.setItem('fullName', user.displayName || user.email);
        }
    } catch (error) {
        console.error('Error saving technician:', error);
    }
}

// Login function
async function login() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value.trim();
    const alertBox = document.getElementById('loginAlert');
    alertBox.classList.add('d-none');
    
    if (!email || !password) {
        alertBox.textContent = 'Please fill in all fields.';
        alertBox.classList.remove('d-none');
        return;
    }
    
    // Show loading state
    const loginBtn = document.getElementById('loginBtn');
    const originalText = loginBtn.textContent;
    loginBtn.textContent = 'Signing in...';
    loginBtn.disabled = true;
    
    try {
        // Check if this email exists in pending registrations (unverified)
        const pendingRegistrationDoc = await db.collection('pendingRegistrations').doc(email).get();
        if (pendingRegistrationDoc.exists) {
            // Try to sign in and reload user
            const userCredential = await auth.signInWithEmailAndPassword(email, password);
            await userCredential.user.reload();
            if (!userCredential.user.emailVerified) {
                await auth.signOut();
                throw new Error('Please verify your email address before signing in. Check your inbox for a verification email.');
            } else {
                // User is verified but still in pendingRegistrations, clean up
                const pendingData = pendingRegistrationDoc.data();
                await db.collection('technicians').doc(userCredential.user.uid).set({
                    fullName: pendingData.fullName,
                    email: email,
                    isAdmin: false,
                    lastSignIn: firebase.firestore.FieldValue.serverTimestamp(),
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                await db.collection('pendingRegistrations').doc(email).delete();
                localStorage.setItem('fullName', pendingData.fullName);
                // Redirect to menu
                window.location.href = 'index.html';
                return;
            }
        }
        
        // Attempt to sign in
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        // Reload user to get latest verification status
        await userCredential.user.reload();
        if (!userCredential.user.emailVerified) {
            await auth.signOut();
            throw new Error('Please verify your email address before signing in. Check your inbox for a verification email.');
        }
        
        // Check if this is the first verified login
        const pendingDoc = await db.collection('pendingRegistrations').doc(email).get();
        if (pendingDoc.exists) {
            const pendingData = pendingDoc.data();
            // This is the first verified login, create technician document
            await db.collection('technicians').doc(userCredential.user.uid).set({
                fullName: pendingData.fullName,
                email: email,
                isAdmin: false,
                lastSignIn: firebase.firestore.FieldValue.serverTimestamp(),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            // Remove from pending registrations
            await db.collection('pendingRegistrations').doc(email).delete();
            
            // Store full name in localStorage
            localStorage.setItem('fullName', pendingData.fullName);
        } else {
            // Regular login, update technician data
            await saveTechnicianToFirestore(userCredential.user);
        }
        
        // Success: redirect to menu
        window.location.href = 'index.html';
    } catch (error) {
        alertBox.textContent = error.message;
        alertBox.classList.remove('d-none');
    } finally {
        // Reset button state
        loginBtn.textContent = originalText;
        loginBtn.disabled = false;
    }
}

// Sign up function
async function signUp() {
    let fullName = document.getElementById('signUpFullName').value.trim();
    const email = document.getElementById('signUpEmail').value.trim();
    const password = document.getElementById('signUpPassword').value.trim();
    const confirmPassword = document.getElementById('signUpConfirmPassword').value.trim();
    const alertBox = document.getElementById('signUpAlert');
    alertBox.classList.add('d-none');

    // Final validation for full name format
    if (!fullName || !/^([A-Z][a-z]+)( [A-Z][a-z]+)+$/.test(fullName)) {
        alertBox.textContent = 'Please enter a valid full name with both first and last name (English letters only).';
        alertBox.classList.remove('d-none');
        return;
    }

    if (!fullName || !email || !password || !confirmPassword) {
        alertBox.textContent = 'Please fill in all fields.';
        alertBox.classList.remove('d-none');
        return;
    }
    if (password !== confirmPassword) {
        alertBox.textContent = 'Passwords do not match.';
        alertBox.classList.remove('d-none');
        return;
    }
    
    // Check if email already exists in pending registrations
    try {
        const pendingDoc = await db.collection('pendingRegistrations').doc(email).get();
        if (pendingDoc.exists) {
            alertBox.textContent = 'An account with this email is already pending verification. Please check your email or try again later.';
            alertBox.classList.remove('d-none');
            return;
        }
    } catch (error) {
        console.error('Error checking pending registrations:', error);
    }
    
    try {
        // Create Firebase Auth account
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        
        // Send email verification
        await userCredential.user.sendEmailVerification();
        
        // Store pending registration data
        await db.collection('pendingRegistrations').doc(email).set({
            fullName: fullName,
            email: email,
            uid: userCredential.user.uid,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            verified: false
        });
        
        // Sign out the user immediately to prevent access
        await auth.signOut();

        alertBox.classList.add('d-none');
        showLogin();
        alert('Account created! Please check your email and verify your account before signing in. You will not be able to sign in until you verify your email address.');
    } catch (error) {
        alertBox.textContent = error.message;
        alertBox.classList.remove('d-none');
    }
}

// Password reset function
async function resetPassword() {
    const email = document.getElementById('resetEmail').value.trim();
    const alertBox = document.getElementById('resetAlert');
    alertBox.classList.add('d-none');
    if (!email) {
        alertBox.textContent = 'Please enter your email.';
        alertBox.classList.remove('d-none');
        return;
    }
    try {
        await auth.sendPasswordResetEmail(email);
        alertBox.textContent = 'Password reset email sent!';
        alertBox.classList.remove('d-none');
    } catch (error) {
        alertBox.textContent = error.message;
        alertBox.classList.remove('d-none');
    }
}

// Google Sign-In function
async function signInWithGoogle() {
    const alertBox = document.getElementById('loginAlert');
    alertBox.classList.add('d-none');
    try {
        // Create Google Auth Provider and force account selection every time
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({
            prompt: 'select_account'
        });
        // Sign in with Google
        const result = await auth.signInWithPopup(provider);
        const user = result.user;
        
        // Verify that the user has a valid email
        if (!user.email || !user.emailVerified) {
            await auth.signOut();
            throw new Error('Please use a verified Google account with a valid email address');
        }
        
        // Check if this is the first time login for this Google account
        const technicianDoc = await db.collection('technicians').doc(user.uid).get();
        
        if (!technicianDoc.exists) {
            // First time login - create technician document
            await db.collection('technicians').doc(user.uid).set({
                fullName: user.displayName || user.email,
                email: user.email,
                isAdmin: false,
                lastSignIn: firebase.firestore.FieldValue.serverTimestamp(),
                createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            
            // Store full name in localStorage
            localStorage.setItem('fullName', user.displayName || user.email);
        } else {
            // Regular login - update technician data
            await saveTechnicianToFirestore(user);
        }
        
        // Success: redirect to menu
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Google Sign-In Error:', error);
        alertBox.textContent = error.message;
        alertBox.classList.remove('d-none');
    }
}

// Logout function
function logout() {
    auth.signOut();
    localStorage.removeItem('fullName');
    window.location.href = 'index.html';
}

// Show/Hide login/signup
function showSignUp() {
    document.getElementById('loginSection').classList.add('d-none');
    document.getElementById('signUpSection').classList.remove('d-none');
}

function showLogin() {
    document.getElementById('signUpSection').classList.add('d-none');
    document.getElementById('loginSection').classList.remove('d-none');
}

// Full name validation and formatting functions
function validateFullName(input) {
    const value = input.value;
    const validationDiv = input.id === 'signUpFullName' ? 
        document.getElementById('fullNameValidation') : 
        document.getElementById('accountNameValidation');
    
    // Remove any non-English letters and spaces immediately
    const cleanedValue = value.replace(/[^A-Za-z ]/g, '');
    if (cleanedValue !== value) {
        input.value = cleanedValue;
    }
    
    // Check if empty
    if (!cleanedValue.trim()) {
        validationDiv.textContent = '';
        validationDiv.className = 'form-text text-muted';
        return;
    }
    
    // Check if contains only valid characters
    if (!/^[A-Za-z ]+$/.test(cleanedValue)) {
        validationDiv.textContent = 'Only English letters and spaces are allowed';
        validationDiv.className = 'form-text text-danger';
        return;
    }
    
    // Check if has at least 2 characters
    if (cleanedValue.trim().length < 2) {
        validationDiv.textContent = 'Name must be at least 2 characters long';
        validationDiv.className = 'form-text text-warning';
        return;
    }
    
    // Check if has at least one space (first and last name)
    const words = cleanedValue.trim().split(' ').filter(word => word.length > 0);
    if (words.length < 2) {
        validationDiv.textContent = 'Please enter both first and last name';
        validationDiv.className = 'form-text text-warning';
        return;
    }
    
    // All validations passed
    validationDiv.textContent = '✓ Valid name format';
    validationDiv.className = 'form-text text-success';
}

function formatFullName(input) {
    const value = input.value.trim();
    if (!value) return;
    
    // Split into words, capitalize first letter of each word, lowercase the rest
    const formattedName = value
        .split(' ')
        .filter(word => word.length > 0)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
    
    input.value = formattedName;
    
    // Update validation message
    const validationDiv = input.id === 'signUpFullName' ? 
        document.getElementById('fullNameValidation') : 
        document.getElementById('accountNameValidation');
    if (formattedName && /^([A-Z][a-z]+)( [A-Z][a-z]+)+$/.test(formattedName)) {
        validationDiv.textContent = '✓ Name formatted correctly';
        validationDiv.className = 'form-text text-success';
    }
}

