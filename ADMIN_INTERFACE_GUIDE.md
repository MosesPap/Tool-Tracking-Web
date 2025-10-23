# Tool Administrator Interface - Complete Guide

## 🎯 Overview

The Tool Administrator interface is a powerful, secure admin panel for managing the AMS Tool Tracking System. It provides comprehensive control over users, tools, settings, and analytics.

---

## 🚀 **Accessing the Admin Interface**

### **For Admin Users:**

1. **From Main App Menu:**
   - Login to the main app (`index.html`)
   - If you have admin privileges (`isAdmin: true` in Firestore)
   - You'll see a **"Tool Administrator"** button in the main menu
   - Click it to navigate to the admin interface

2. **Direct URL:**
   - Navigate to: `https://your-app.netlify.app/app/admin.html`
   - Or locally: `app/admin.html`

### **Login Methods:**

1. **Email & Password:**
   - Use your existing user credentials
   - Same email/password as the main app

2. **Google Sign-In:**
   - Click "Sign in with Google"
   - Use your Google account

### **Security:**

- ✅ Only users with `isAdmin: true` in Firestore `technicians` collection can access
- ✅ Non-admin users are automatically logged out with "Access Denied" message
- ✅ Session expires after 30 minutes of inactivity
- ✅ All admin operations are logged

---

## 📊 **Dashboard Features**

### **Statistics Cards (Top of Dashboard)**

1. **Total Tools** - Shows total number of tools in the system
2. **Tools Checked IN** - Count of tools currently checked in
3. **Tools Checked OUT** - Count of tools currently checked out
4. **Total Users** - Number of registered technicians

---

## ⚙️ **Settings Tab**

### **Admin Password Management**

- **Purpose:** Used for sensitive operations (e.g., deleting photos from all tools)
- **Location:** Stored in Firestore: `settings/admin` → `AdminPassword`
- **How to Update:**
  1. Enter new password in the text field
  2. Click "Update" button
  3. Confirmation message appears

### **Check-In Cooldown**

- **Purpose:** Time users must wait before checking in a tool after checkout
- **Default:** 15 minutes
- **Location:** Stored in Firestore: `settings/admin` → `CheckINCooldownMinutes`
- **How to Update:**
  1. Enter desired minutes (minimum 1)
  2. Click "Update" button
  3. Takes effect immediately

### **System Information**

- **Firebase Project ID:** Shows the current Firebase project
- **Last Settings Update:** Timestamp of last admin settings change

---

## 👥 **Users Tab**

### **User Management**

**Features:**
- View all registered technicians
- See user roles (Admin vs. User)
- Promote users to admin
- Demote admins to regular users
- Search users by name or email

**User Table Columns:**
1. **Name** - Full name of the technician
2. **Email** - User's email address
3. **Role** - Badge showing "Admin" (green) or "User" (gray)
4. **Actions** - Button to toggle admin status

### **Making a User Admin:**

1. Find the user in the list (use search if needed)
2. Click **"Make Admin"** button
3. Confirm the action
4. User immediately gains admin privileges
5. They'll see the "Tool Administrator" button on next login

### **Removing Admin Privileges:**

1. Find the admin user in the list
2. Click **"Remove Admin"** button
3. Confirm the action
4. User loses admin access immediately

### **Search Functionality:**

- Type in the search box to filter users
- Searches in: Name, Email
- Real-time filtering (no button needed)

---

## 🔧 **Tools Tab**

### **Tool Management**

**Features:**
- View recent tools (last 50 by default)
- See tool details (TID, Part Number, Status, Owner, Location)
- Delete tools from the system
- Search tools by any field

**Tool Card Information:**
- **Tool Name** - Name of the tool
- **TID** - Unique tool identifier
- **P/N** - Part number
- **Status** - IN (green) or OUT (red)
- **Owner** - Collection/Technician name
- **Location** - Current or last known location

### **Deleting a Tool:**

1. Click the **red trash icon** on the tool card
2. Confirm deletion (action cannot be undone)
3. Tool is permanently removed from Firestore
4. Statistics automatically update

### **Search Functionality:**

- Search by: Tool Name, TID, Part Number, Owner, Location
- Real-time filtering

---

## 📈 **Analytics Tab**

### **Today's Activity**

Real-time statistics for the current day:
- **Check-Ins Today** - Number of tools checked in
- **Check-Outs Today** - Number of tools checked out
- **Active Users Today** - Unique users who registered tools

### **Most Active Users**

- Shows top 5 users by total tool count
- Ranked from highest to lowest
- Includes tool count for each user

### **Recent Activity Log**

- Shows last 20 tool registrations
- Information displayed:
  - Tool name and status (color-coded)
  - Technician who registered it
  - Location
  - Timestamp
- Sorted by most recent first

---

## 🔐 **Security Features**

### **Authentication & Authorization**

1. **Firebase Auth Integration:**
   - Same authentication as main app
   - Supports email/password and Google Sign-In

2. **Admin Check:**
   - On login: Checks `technicians/{uid}.isAdmin === true`
   - If false: Auto-logout with error message
   - If true: Loads dashboard

3. **Session Management:**
   - **Timeout:** 30 minutes of inactivity
   - **Activity Tracking:** Mouse, keyboard, scroll, touch events
   - **Auto-Logout:** User is logged out after timeout
   - **Warning:** Alert message before logout

4. **Route Protection:**
   - `auth.onAuthStateChanged` listener checks admin status
   - Non-admins can't access dashboard even with direct URL

---

## 🎨 **UI/UX Features**

### **Responsive Design**

- Works on desktop, tablet, and mobile
- Adaptive layouts for different screen sizes
- Touch-friendly buttons and controls

### **Visual Feedback**

- Loading spinners for async operations
- Success/error alerts with auto-dismiss
- Hover effects on interactive elements
- Color-coded status indicators

### **Navigation**

- **Main App Button:** Quick return to user interface
- **Logout Button:** Secure sign-out
- **Tab System:** Organized admin functions
- **Back Link:** Return to main app from login screen

---

## 🔄 **Integration with Main App**

### **Firestore Collections Used**

1. **`technicians`** - User data and admin flags
2. **`tools`** - Tool inventory and status
3. **`settings/admin`** - Admin password and cooldown settings

### **Shared Firebase Config**

Both `index.html` and `admin.html` use the same:
- Firebase project
- Authentication
- Firestore database
- Storage bucket

### **Admin Button Visibility**

In `index.html`:
```javascript
// Button is hidden by default
<button class="btn btn-info" id="menuAdminBtn" style="display: none;">
    <i class="fas fa-user-shield"></i> Tool Administrator
</button>

// Shown only when user has isAdmin: true
if (technicianData.isAdmin) {
    document.getElementById('menuAdminBtn').style.display = 'block';
}
```

---

## 📝 **Common Admin Tasks**

### **Task 1: Set Up Admin Password**

1. Login to admin interface
2. Go to **Settings** tab
3. Enter a strong password in "Admin Password" field
4. Click **Update**
5. Password is now active for sensitive operations

### **Task 2: Adjust Tool Check-In Cooldown**

1. Go to **Settings** tab
2. Change value in "Check-In Cooldown (Minutes)" field
3. Click **Update**
4. New cooldown applies immediately to all users

### **Task 3: Promote a User to Admin**

1. Go to **Users** tab
2. Find the user (use search if needed)
3. Click **"Make Admin"** button
4. Confirm the action
5. User can now access admin interface

### **Task 4: Remove a Tool**

1. Go to **Tools** tab
2. Find the tool (use search if needed)
3. Click the **trash icon**
4. Confirm deletion
5. Tool is permanently removed

### **Task 5: View System Analytics**

1. Go to **Analytics** tab
2. Check today's activity statistics
3. Review most active users
4. Scroll through recent activity log

---

## 🌐 **Deployment**

### **GitHub:**

File location: `app/admin.html`

```bash
# Add to Git
git add app/admin.html

# Commit
git commit -m "Add admin interface"

# Push
git push origin master
```

### **Netlify:**

- Auto-deploys when you push to GitHub
- No configuration needed
- Available at: `https://your-app.netlify.app/app/admin.html`

### **Optional: Create Redirect**

Create `netlify.toml` in project root:

```toml
[[redirects]]
  from = "/admin"
  to = "/app/admin.html"
  status = 200
```

Now accessible at: `https://your-app.netlify.app/admin`

---

## 🛠️ **Firestore Setup**

### **Required: Set `isAdmin` Field**

For each admin user in `technicians` collection:

```javascript
{
  fullName: "John Doe",
  email: "john@example.com",
  isAdmin: true  // ← Add this field
}
```

**How to set manually in Firebase Console:**

1. Open Firebase Console
2. Go to Firestore Database
3. Navigate to `technicians` collection
4. Select the user document
5. Click "Add field"
   - Field name: `isAdmin`
   - Type: `boolean`
   - Value: `true`
6. Save

### **Admin Settings Document**

Collection: `settings`  
Document: `admin`

```javascript
{
  AdminPassword: "your_password_here",
  CheckINCooldownMinutes: 15,
  lastUpdated: <timestamp>
}
```

**Note:** Created automatically when you update settings in admin interface.

---

## ⚡ **Performance**

- **Users Tab:** Loads all users (optimized for <1000 users)
- **Tools Tab:** Loads 50 most recent tools (configurable)
- **Analytics:** Efficient queries with Firestore indexes
- **Real-time:** No auto-refresh; manual refresh on each tab switch

---

## 🆘 **Troubleshooting**

### **"Access Denied" Error**

**Problem:** User can't access admin interface  
**Solution:** 
1. Check Firestore: `technicians/{uid}` has `isAdmin: true`
2. Logout and login again
3. Clear browser cache

### **"Tool Administrator" Button Not Showing**

**Problem:** Admin user doesn't see button in main menu  
**Solution:**
1. Verify `isAdmin: true` in Firestore
2. Logout and login to refresh
3. Check browser console for errors

### **Settings Not Saving**

**Problem:** Changes to admin password or cooldown not persisting  
**Solution:**
1. Check Firestore security rules allow writes to `settings` collection
2. Verify user is authenticated
3. Check browser console for errors

### **Session Expires Too Quickly**

**Problem:** Getting logged out frequently  
**Solution:**
- Current timeout is 30 minutes of **inactivity**
- Any mouse/keyboard activity resets the timer
- To change: Edit `sessionTimeout` value in `admin.html` (line ~1245)

---

## 🎯 **Best Practices**

### **Admin User Management**

✅ **DO:**
- Grant admin privileges only to trusted users
- Regularly review admin user list
- Use strong admin passwords
- Document who has admin access

❌ **DON'T:**
- Make all users admins
- Share admin passwords
- Leave inactive admins with privileges

### **Settings Management**

✅ **DO:**
- Test cooldown changes with a small value first
- Keep admin password secure and unique
- Document settings changes

❌ **DON'T:**
- Set cooldown to 0 (breaks countdown feature)
- Use same password as your account
- Change settings without testing

### **Tool Management**

✅ **DO:**
- Search before deleting to ensure correct tool
- Confirm tool ownership before deletion
- Keep backups of important tool data

❌ **DON'T:**
- Mass delete without verification
- Delete tools with active check-outs
- Delete tools without user notification

---

## 📱 **Mobile Experience**

- Fully responsive design
- Touch-optimized buttons
- Readable on small screens
- Scrollable tables and lists
- Mobile-friendly navigation

---

## 🔮 **Future Enhancements** (Potential)

- Bulk tool import/export
- Advanced analytics charts
- Email notifications for admin actions
- Audit log with rollback capability
- Custom role permissions (beyond admin/user)
- Tool maintenance scheduling
- Advanced reporting (PDF export)
- Multi-language support

---

## ✅ **Summary**

The Tool Administrator interface provides:

✅ **Secure Access** - Admin-only with Firebase authentication  
✅ **User Management** - Promote/demote admins easily  
✅ **Settings Control** - Manage passwords and cooldowns  
✅ **Tool Oversight** - View and manage all tools  
✅ **Analytics** - Real-time activity tracking  
✅ **Session Security** - Auto-logout on inactivity  
✅ **Responsive Design** - Works on all devices  
✅ **Easy Deployment** - Single HTML file, auto-deploys  

---

**Created:** October 22, 2025  
**Version:** 1.0  
**File:** `app/admin.html`  
**Integration:** Seamless with `app/index.html`


