# Firebase Functions Setup - Next Steps

✅ **Completed Automatically:**
- Firebase CLI installed
- Functions dependencies installed
- Firebase configuration files created
- Cloud Function code ready

## Next Steps (Requires Manual Interaction):

### 1. Login to Firebase

Run this command in your terminal:

```powershell
firebase login
```

This will open a browser window for you to authenticate with Google.

### 2. Link Your Firebase Project

After logging in, run:

```powershell
firebase use --add
```

Select your Firebase project from the list (e.g., "tooltracking-xxxxx").

### 3. Configure Email Credentials

You have three options:

#### Option A: Gmail (Quick Setup)
```powershell
firebase functions:config:set email.user="460avionicsteam@gmail.com"
firebase functions:config:set email.password="ecig xdwp cvcl nlae"
firebase functions:config:set email.from="noreply@tooltracking.com"
```

To get a Gmail App Password:
1. Go to Google Account → Security
2. Enable 2-Step Verification
3. Go to App passwords
4. Generate a new app password for "Mail"
5. Use that password in the command above

#### Option B: SendGrid (Recommended for Production)
```powershell
firebase functions:config:set email.user="apikey"
firebase functions:config:set email.password="your-sendgrid-api-key"
firebase functions:config:set email.from="noreply@tooltracking.com"
```

Get SendGrid API key:
1. Sign up at https://sendgrid.com
2. Create an API key
3. Use it in the command above

#### Option C: Other SMTP Service
Edit `functions/index.js` and update the transporter configuration.

### 4. Deploy the Cloud Function

After configuring email credentials, deploy:

```powershell
firebase deploy --only functions
```

This will upload and activate the email notification function.

### 5. Configure in Admin Settings

1. Go to your web app's Administrator Settings
2. Set "Daily Email Notification Time" (e.g., 09:00)
3. Click Update

**Note:** Administrator emails are automatically fetched from technicians with `isAdmin = true` in the database. No need to manually configure admin emails!

## Verify Setup

After deployment, you can:

1. **Check function logs:**
   ```powershell
   firebase functions:log
   ```

2. **Test the function manually:**
   ```powershell
   firebase functions:shell
   ```
   Then type:
   ```javascript
   sendDailyToolNotifications()
   ```

## How It Works

- The function runs **every hour**
- It checks if the current time matches your configured notification time
- When matched, it:
  - Finds all tools with status "OUT"
  - Fetches all technicians from the database
  - Sends emails to users with their checked-out tools
  - Automatically identifies administrators (where `isAdmin = true`) and sends them a summary email with all OUT tools

## Troubleshooting

**Firebase login not working?**
- Make sure you have a Google account with access to the Firebase project
- Try `firebase logout` then `firebase login` again

**Email not sending?**
- Check function logs: `firebase functions:log`
- Verify email credentials are correct
- Check your email service provider's dashboard

**Function not running?**
- Verify the deployment was successful
- Check the Firebase Console → Functions section
- Ensure the notification time is set in Admin Settings

## Need Help?

See the full documentation in `EMAIL_NOTIFICATIONS_SETUP.md`

---

## Quick Command Summary

```powershell
# 1. Login
firebase login

# 2. Select project
firebase use --add

# 3. Configure email (Gmail example)
firebase functions:config:set email.user="your-email@gmail.com"
firebase functions:config:set email.password="your-app-password"
firebase functions:config:set email.from="noreply@tooltracking.com"

# 4. Deploy
firebase deploy --only functions

# 5. Check logs
firebase functions:log
```

That's it! Your automated email notifications will be ready to go.

