# Email Notifications Setup Guide

This guide explains how to set up automatic daily email notifications for users with OUT tools and administrators.

## Features

- **Daily Email Notifications**: Automatically sends emails every day at a configurable time
- **User Notifications**: Users receive emails listing all tools they have checked out
- **Admin Summary**: Administrators receive a summary of all tools currently checked out
- **Configurable Time**: Set the notification time in Administrator Settings

## Setup Instructions

### 1. Install Firebase CLI

If you haven't already, install the Firebase CLI:

```bash
npm install -g firebase-tools
```

### 2. Initialize Firebase Functions

Navigate to your project root and initialize Firebase Functions:

```bash
firebase init functions
```

Select:
- Use an existing project (select your Firebase project)
- JavaScript
- Yes to ESLint
- Install dependencies now

### 3. Install Dependencies

Navigate to the `functions` directory and install dependencies:

```bash
cd functions
npm install
```

### 4. Configure Email Service

You need to set up email credentials. You can use Gmail, SendGrid, Mailgun, or any SMTP service.

#### Option A: Using Gmail

1. Enable "Less secure app access" in your Google Account settings, OR
2. Use an App Password (recommended):
   - Go to Google Account → Security → 2-Step Verification → App passwords
   - Generate an app password for "Mail"

#### Option B: Using SendGrid (Recommended for Production)

1. Sign up for a SendGrid account
2. Create an API key
3. Update the transporter configuration in `functions/index.js`

### 5. Set Environment Variables

Set your email credentials using Firebase Functions config:

```bash
firebase functions:config:set email.user="your-email@gmail.com"
firebase functions:config:set email.password="your-app-password"
firebase functions:config:set email.from="noreply@tooltracking.com"
```

Or for SendGrid:

```bash
firebase functions:config:set email.user="apikey"
firebase functions:config:set email.password="your-sendgrid-api-key"
firebase functions:config:set email.from="noreply@tooltracking.com"
```

### 6. Update SMTP Configuration (if not using Gmail)

If you're using a different email service, update the transporter in `functions/index.js`:

```javascript
const transporter = nodemailer.createTransport({
  host: 'smtp.sendgrid.net', // or your SMTP host
  port: 587,
  secure: false,
  auth: {
    user: functions.config().email?.user,
    pass: functions.config().email?.password,
  },
});
```

### 7. Deploy the Function

Deploy the Cloud Function:

```bash
firebase deploy --only functions
```

### 8. Configure Notification Time in Admin Settings

1. Log in as an administrator
2. Go to Administrator Settings
3. Set the "Daily Email Notification Time" (e.g., 09:00 for 9:00 AM)
4. Click "Update"

**Note:** Administrator emails are automatically fetched from the `technicians` collection where `isAdmin = true`. You don't need to manually configure administrator email addresses!

## How It Works

1. **Scheduled Execution**: The Cloud Function runs daily at the configured time
2. **Query Tools**: Fetches all tools with status "OUT" from the `tools` collection
3. **User Emails**: 
   - Groups tools by technician name
   - Looks up technician emails from the `technicians` collection
   - Sends personalized email to each user with their OUT tools
4. **Admin Summary**: 
   - Automatically identifies administrators from the `technicians` collection (where `isAdmin = true`)
   - Sends a summary email to all administrators
   - Includes all tools currently checked out

## Email Content

### User Email Includes:
- Greeting with user's name
- List of all tools checked out by that user
- Tool name, part number, and checkout date
- Reminder to check in tools when done

### Admin Email Includes:
- Summary of all tools currently checked out
- Table with tool name, part number, technician, and checkout date
- Total count of OUT tools

## Troubleshooting

### Emails Not Sending

1. **Check Function Logs**:
   ```bash
   firebase functions:log
   ```

2. **Verify Email Credentials**: Make sure your email credentials are correct
3. **Check Settings**: Verify the notification time is set correctly in admin settings
4. **Check Timezone**: The function uses 'America/New_York' timezone by default - update if needed

### Function Not Running

1. **Check Schedule**: The function is scheduled to run daily at 9:00 AM by default
2. **Verify Deployment**: Make sure the function was deployed successfully
3. **Check Firebase Console**: Go to Functions section in Firebase Console to verify the function exists

### Testing the Function

You can manually trigger the function for testing:

```bash
firebase functions:shell
```

Then in the shell:
```javascript
sendDailyToolNotifications()
```

## Customization

### Change Schedule

Edit the cron expression in `functions/index.js`:

```javascript
.schedule('0 9 * * *') // minute hour day month dayOfWeek
```

Examples:
- `'0 9 * * *'` - Every day at 9:00 AM
- `'0 17 * * *'` - Every day at 5:00 PM
- `'0 9 * * 1-5'` - Weekdays at 9:00 AM

### Change Timezone

Update the timezone in the schedule:

```javascript
.timeZone('America/New_York') // Change to your timezone
```

### Customize Email Templates

Edit the `sendUserNotificationEmail` and `sendAdminSummaryEmail` functions in `functions/index.js` to customize the email HTML and content.

## Security Notes

- Never commit email credentials to version control
- Use Firebase Functions config or environment variables for sensitive data
- Consider using SendGrid or similar service for production (better deliverability)
- Enable 2FA on email accounts used for sending

## Support

If you encounter issues, check:
1. Firebase Functions logs
2. Email service provider logs
3. Firestore security rules (function needs read access to `tools`, `technicians`, and `settings` collections)

