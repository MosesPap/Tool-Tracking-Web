const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// Initialize Firebase Admin
admin.initializeApp();

// Configure email transporter (using Gmail as example - you can use other services)
// You'll need to set these environment variables in Firebase Functions config
const transporter = nodemailer.createTransport({
  service: 'gmail', // or use SMTP settings for other providers
  auth: {
    user: functions.config().email?.user || process.env.EMAIL_USER,
    pass: functions.config().email?.password || process.env.EMAIL_PASSWORD,
  },
});

/**
 * Scheduled function to send daily email notifications
 * This runs every hour and checks if it's time to send emails based on settings
 * To change the frequency, update the cron expression below
 * Format: minute hour day month dayOfWeek
 * Example: "0 * * * *" = Every hour at minute 0
 */
exports.sendDailyToolNotifications = functions.pubsub
  .schedule('* * * * *') // Run every hour at minute 0
  .timeZone('Asia/Nicosia') // Nicosia, Cyprus timezone (EET/EEST)
  .onRun(async (context) => {
    console.log('Checking if it\'s time to send daily tool notification emails...');

    try {
      // Get settings from Firestore
      const settingsDoc = await admin.firestore()
        .collection('settings')
        .doc('admin')
        .get();

      if (!settingsDoc.exists) {
        console.log('Settings document not found. Skipping email notifications.');
        return null;
      }

      const settings = settingsDoc.data();
      const emailNotificationTime = settings.emailNotificationTime || '09:00';

      // Check if we should send emails at this time
      const now = new Date();
      const [hours, minutes] = emailNotificationTime.split(':');
      const notificationHour = parseInt(hours);
      const notificationMinute = parseInt(minutes);

      // Only send if current time matches (within 5 minutes tolerance)
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      
      if (currentHour !== notificationHour || Math.abs(currentMinute - notificationMinute) >1 ) {
        console.log(`Scheduled time is ${emailNotificationTime}, current time is ${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}. Skipping.`);
        return null;
      }

      console.log(`Time matches! Sending email notifications at ${emailNotificationTime}...`);

      // Get all tools with status "OUT"
      const outToolsSnapshot = await admin.firestore()
        .collection('tools')
        .where('status', '==', 'OUT')
        .get();

      if (outToolsSnapshot.empty) {
        console.log('No tools with OUT status found.');
        
        // Get admin emails from technicians collection
        const techniciansSnapshot = await admin.firestore()
          .collection('technicians')
          .get();
        
        const adminEmails = [];
        techniciansSnapshot.forEach(doc => {
          const techData = doc.data();
          const email = techData.email || '';
          const isAdmin = techData.isAdmin || false;
          
          if (email && isAdmin) {
            adminEmails.push(email);
          }
        });
        
        // Still send summary to admins
        if (adminEmails.length > 0) {
          await sendAdminSummaryEmail(adminEmails, []);
        }
        return null;
      }

      const outTools = [];
      const userToolsMap = new Map(); // Map of user email -> array of tools

      outToolsSnapshot.forEach(doc => {
        const tool = {
          id: doc.id,
          ...doc.data(),
        };
        outTools.push(tool);

        // Get technician email (user who has the tool)
        const technician = tool.technician || '';
        if (technician) {
          if (!userToolsMap.has(technician)) {
            userToolsMap.set(technician, []);
          }
          userToolsMap.get(technician).push(tool);
        }
      });

      console.log(`Found ${outTools.length} tools with OUT status`);
      console.log(`Found ${userToolsMap.size} unique users with OUT tools`);

      // Get user emails and admin emails from technicians collection
      const techniciansSnapshot = await admin.firestore()
        .collection('technicians')
        .get();

      const technicianEmailMap = new Map();
      const adminEmails = [];
      
      techniciansSnapshot.forEach(doc => {
        const techData = doc.data();
        const fullName = techData.fullName || '';
        const email = techData.email || '';
        const isAdmin = techData.isAdmin || false;
        
        if (fullName && email) {
          technicianEmailMap.set(fullName, email);
          
          // Collect admin emails
          if (isAdmin) {
            adminEmails.push(email);
          }
        }
      });

      console.log(`Found ${adminEmails.length} administrator(s) for summary email`);

      // Send emails to users with OUT tools
      const emailPromises = [];
      for (const [technicianName, tools] of userToolsMap.entries()) {
        const userEmail = technicianEmailMap.get(technicianName);
        if (userEmail) {
          emailPromises.push(sendUserNotificationEmail(userEmail, technicianName, tools));
        } else {
          console.log(`No email found for technician: ${technicianName}`);
        }
      }

      // Send summary email to administrators
      if (adminEmails.length > 0) {
        emailPromises.push(sendAdminSummaryEmail(adminEmails, outTools));
      }

      // Wait for all emails to be sent
      await Promise.all(emailPromises);

      console.log('Daily tool notification emails sent successfully!');
      return null;
    } catch (error) {
      console.error('Error sending daily tool notifications:', error);
      throw error;
    }
  });

/**
 * Send email notification to a user about their OUT tools
 */
async function sendUserNotificationEmail(userEmail, userName, tools) {
  const toolList = tools.map(tool => {
    const toolName = tool.toolName || 'Unknown Tool';
    const partNumber = tool.partNumber || tool.id;
    const checkoutDate = tool.timestamp?.toDate 
      ? tool.timestamp.toDate().toLocaleDateString() 
      : 'N/A';
    
    return `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${toolName}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${partNumber}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${checkoutDate}</td>
      </tr>
    `;
  }).join('');

  const emailHtml = `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #FF9800; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th { background-color: #FF9800; color: white; padding: 12px; text-align: left; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Tool Tracking Reminder</h2>
          </div>
          <div class="content">
            <p>Hello ${userName},</p>
            <p>This is a reminder that you currently have <strong>${tools.length}</strong> tool(s) checked out:</p>
            <table>
              <thead>
                <tr>
                  <th>Tool Name</th>
                  <th>Part Number</th>
                  <th>Checkout Date</th>
                </tr>
              </thead>
              <tbody>
                ${toolList}
              </tbody>
            </table>
            <p>Please remember to check in these tools when you're done using them.</p>
            <p>Thank you!</p>
          </div>
          <div class="footer">
            <p>This is an automated message from the Tool Tracking System.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const mailOptions = {
    from: functions.config().email?.from || process.env.EMAIL_FROM || 'noreply@tooltracking.com',
    to: userEmail,
    subject: `Tool Tracking Reminder: ${tools.length} Tool(s) Checked Out`,
    html: emailHtml,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Email sent to user: ${userEmail}`);
  } catch (error) {
    console.error(`Error sending email to ${userEmail}:`, error);
    throw error;
  }
}

/**
 * Send summary email to administrators
 */
async function sendAdminSummaryEmail(adminEmails, outTools) {
  const toolList = outTools.map(tool => {
    const toolName = tool.toolName || 'Unknown Tool';
    const partNumber = tool.partNumber || tool.id;
    const technician = tool.technician || 'N/A';
    const checkoutDate = tool.timestamp?.toDate 
      ? tool.timestamp.toDate().toLocaleDateString() 
      : 'N/A';
    
    return `
      <tr>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${toolName}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${partNumber}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${technician}</td>
        <td style="padding: 8px; border-bottom: 1px solid #ddd;">${checkoutDate}</td>
      </tr>
    `;
  }).join('');

  const emailHtml = `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #FF9800; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; background-color: #f9f9f9; }
          table { width: 100%; border-collapse: collapse; margin: 20px 0; }
          th { background-color: #FF9800; color: white; padding: 12px; text-align: left; }
          .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>Daily Tool Status Report</h2>
          </div>
          <div class="content">
            <p>Hello Administrators,</p>
            <p>This is the daily summary of tools currently checked out:</p>
            <p><strong>Total Tools OUT: ${outTools.length}</strong></p>
            ${outTools.length > 0 ? `
              <table>
                <thead>
                  <tr>
                    <th>Tool Name</th>
                    <th>Part Number</th>
                    <th>Technician</th>
                    <th>Checkout Date</th>
                  </tr>
                </thead>
                <tbody>
                  ${toolList}
                </tbody>
              </table>
            ` : '<p>No tools are currently checked out.</p>'}
            <p>Thank you!</p>
          </div>
          <div class="footer">
            <p>This is an automated message from the Tool Tracking System.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  const mailOptions = {
    from: functions.config().email?.from || process.env.EMAIL_FROM || 'noreply@tooltracking.com',
    to: adminEmails.join(', '),
    subject: `Daily Tool Status Report: ${outTools.length} Tool(s) Currently OUT`,
    html: emailHtml,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`Summary email sent to administrators: ${adminEmails.join(', ')}`);
  } catch (error) {
    console.error('Error sending admin summary email:', error);
    throw error;
  }
}

