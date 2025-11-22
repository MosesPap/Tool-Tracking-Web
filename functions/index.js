const functions = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

// Initialize Firebase Admin
admin.initializeApp();

// Create email transporter function (reads from Firestore)
function createTransporter(emailAccount, emailAppPassword) {
  // Use Firestore settings if available, otherwise fall back to environment variables
  // Note: functions.config() is deprecated and will be removed in March 2026
  const user = emailAccount || process.env.EMAIL_USER;
  const pass = emailAppPassword || process.env.EMAIL_PASSWORD;
  
  if (!user || !pass) {
    throw new Error('Email configuration not found. Please configure email settings in Admin Settings.');
  }
  
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: user,
      pass: pass,
    },
  });
}

const CRON_TO_MINUTES = {
  '* * * * *': 1,
  '*/5 * * * *': 5,
  '*/10 * * * *': 10,
  '*/15 * * * *': 15,
  '*/30 * * * *': 30,
  '0 * * * *': 60,
  '0 */2 * * *': 120,
  '0 */6 * * *': 360,
  '0 9 * * *': 1440
};

function getFrequencyMinutes(cronExpression = '* * * * *') {
  return CRON_TO_MINUTES[cronExpression] || 1;
}

function getCurrentNicosiaDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Nicosia' }));
}

async function processDailyToolNotifications(triggerSource = 'http') {
  console.log(`[${triggerSource}] Checking if it's time to send daily tool notification emails...`);

  // Get settings from Firestore
  const settingsDoc = await admin.firestore()
    .collection('settings')
    .doc('admin')
    .get();

  if (!settingsDoc.exists) {
    console.log('Settings document not found. Skipping email notifications.');
    return { status: 'no-settings' };
  }

  const settings = settingsDoc.data();
  const emailNotificationTime = settings.emailNotificationTime || '09:00';
  const emailToleranceWindow = settings.emailToleranceWindow !== undefined ? settings.emailToleranceWindow : 1;
  const emailCheckFrequencyCron = settings.emailCheckFrequency || '* * * * *';
  const frequencyMinutes = getFrequencyMinutes(emailCheckFrequencyCron);

  const now = getCurrentNicosiaDate();

  // Frequency gate: only perform check if enough minutes passed
  if (frequencyMinutes > 1 && settings.lastEmailCheckTime) {
    const lastCheckDate = settings.lastEmailCheckTime.toDate();
    const diffMinutes = (now.getTime() - lastCheckDate.getTime()) / 60000;

    if (diffMinutes < frequencyMinutes) {
      console.log(`Frequency is ${frequencyMinutes} minute(s). Last check was ${diffMinutes.toFixed(2)} minute(s) ago. Skipping.`);
      return { status: 'skipped-frequency', diffMinutes };
    }
  }

  // Update last check timestamp so future invocations respect the interval
  await settingsDoc.ref.update({
    lastEmailCheckTime: admin.firestore.FieldValue.serverTimestamp()
  });

  // Get email configuration from Firestore (with fallback to environment variables)
  const emailAccount = settings.emailAccount;
  const emailAppPassword = settings.emailAppPassword;
  const emailFrom = settings.emailFrom || process.env.EMAIL_FROM || 'noreply@tooltracking.com';
  
  // Get email templates from Firestore (with defaults)
  const emailSubjectUser = settings.emailSubjectUser || 'Tool Tracking Reminder: {count} Tool(s) Checked Out';
  const emailSubjectAdmin = settings.emailSubjectAdmin || 'Daily Tool Status Report: {count} Tool(s) Currently OUT';
  const emailBodyUser = settings.emailBodyUser || null; // Will use default if null
  const emailBodyAdmin = settings.emailBodyAdmin || null; // Will use default if null;
  
  // Get table configuration from Firestore (with defaults)
  const userTableColumns = settings.userTableColumns || {
    toolName: true,
    partNumber: true,
    checkoutDate: true,
    location: false,
    owner: false,
    calDueDate: false
  };
  const adminTableColumns = settings.adminTableColumns || {
    toolName: true,
    partNumber: true,
    technician: true,
    checkoutDate: true,
    location: false,
    owner: false,
    calDueDate: false
  };
  const tableHeaderColor = settings.tableHeaderColor || '#FF9800';
  
  // Create transporter with Firestore settings
  let transporter;
  try {
    transporter = createTransporter(emailAccount, emailAppPassword);
  } catch (error) {
    console.error('Error creating email transporter:', error);
    console.log('Skipping email notifications due to configuration error.');
    return { status: 'config-error', error: error.message };
  }

  // Convert to Nicosia timezone - get hours and minutes separately to avoid "24:XX" bug
  const currentHour = parseInt(now.toLocaleString('en-US', { 
    hour: 'numeric',
    hour12: false
  }));
  
  const currentMinute = parseInt(now.toLocaleString('en-US', { 
    minute: 'numeric'
  }));
  
  const [hours, minutes] = emailNotificationTime.split(':');
  const notificationHour = parseInt(hours);
  const notificationMinute = parseInt(minutes);

  // Only send if current time matches (within tolerance window)
const formattedNotificationTime = `${String(notificationHour).padStart(2, '0')}:${String(notificationMinute).padStart(2, '0')}`;
  const formattedCurrentTime = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}`;

  if (currentHour !== notificationHour) {
    console.log(`Scheduled time is ${formattedNotificationTime}, current time is ${formattedCurrentTime}. Hours don't match. Skipping.`);
    return { status: 'skipped-hour' };
  }

  const minuteDifference = Math.abs(currentMinute - notificationMinute);
  if (minuteDifference > emailToleranceWindow) {
    console.log(`Scheduled time is ${formattedNotificationTime}, current time is ${formattedCurrentTime}. Difference ${minuteDifference} minute(s) exceeds tolerance (${emailToleranceWindow}). Skipping.`);
    return { status: 'skipped-minute', minuteDifference };
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
    
    // Still send summary to admins (with empty tools list)
    if (adminEmails.length > 0) {
      try {
        await sendAdminSummaryEmail(
          transporter,
          emailFrom,
          adminEmails,
          [],
          emailSubjectAdmin,
          emailBodyAdmin,
          adminTableColumns,
          tableHeaderColor
        );
      } catch (error) {
        console.error('Error sending admin summary email:', error);
      }
    }
    return { status: 'no-out-tools' };
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
  const allAdminEmails = [];
  
  techniciansSnapshot.forEach(doc => {
    const techData = doc.data();
    const fullName = techData.fullName || '';
    const email = techData.email || '';
    const isAdmin = techData.isAdmin || false;
    
    if (fullName && email) {
      technicianEmailMap.set(fullName, email);
      
      // Collect all admin emails
      if (isAdmin) {
        allAdminEmails.push({ email, fullName });
      }
    }
  });

  // Send emails to users with OUT tools
  const emailPromises = [];
  const usersWithOutTools = new Set();
  
  for (const [technicianName, tools] of userToolsMap.entries()) {
    const userEmail = technicianEmailMap.get(technicianName);
    if (userEmail) {
      emailPromises.push(sendUserNotificationEmail(
        transporter,
        emailFrom,
        userEmail,
        technicianName,
        tools,
        emailSubjectUser,
        emailBodyUser,
        userTableColumns,
        tableHeaderColor
      ));
      usersWithOutTools.add(userEmail); // Track users who got tool notifications
    } else {
      console.log(`No email found for technician: ${technicianName}`);
    }
  }

  // Send admin summary email to ALL administrators (they should receive both user email for their tools AND admin summary for all tools)
  const adminEmailsForSummary = allAdminEmails.map(admin => admin.email);

  console.log(`Found ${allAdminEmails.length} total administrator(s)`);
  console.log(`Sending summary to ${adminEmailsForSummary.length} administrator(s) (all admins receive admin summary)`);

  // Send summary email to ALL administrators (admins receive both user email and admin summary)
  if (adminEmailsForSummary.length > 0) {
    emailPromises.push(sendAdminSummaryEmail(
      transporter,
      emailFrom,
      adminEmailsForSummary,
      outTools,
      emailSubjectAdmin,
      emailBodyAdmin,
      adminTableColumns,
      tableHeaderColor
    ));
  }

  // Wait for all emails to be sent
  await Promise.all(emailPromises);

  console.log('Daily tool notification emails sent successfully!');
  return { status: 'sent', usersNotified: userToolsMap.size, adminsNotified: adminEmailsForSummary.length };
}

exports.sendDailyToolNotifications = functions.https.onRequest(async (req, res) => {
  try {
    const result = await processDailyToolNotifications('https');
    res.status(200).json({
      success: true,
      result
    });
  } catch (error) {
    console.error('Error sending daily tool notifications:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

/**
 * Send email notification to a user about their OUT tools
 */
async function sendUserNotificationEmail(transporter, emailFrom, userEmail, userName, tools, customSubject, customBody, tableColumns, headerColor) {
  // Build table headers based on configuration
  const headers = [];
  if (tableColumns.toolName) headers.push('<th style="background-color: ' + headerColor + '; color: white; padding: 12px; text-align: left;">Tool Name</th>');
  if (tableColumns.partNumber) headers.push('<th style="background-color: ' + headerColor + '; color: white; padding: 12px; text-align: left;">Part Number</th>');
  if (tableColumns.checkoutDate) headers.push('<th style="background-color: ' + headerColor + '; color: white; padding: 12px; text-align: left;">Checkout Date</th>');
  if (tableColumns.location) headers.push('<th style="background-color: ' + headerColor + '; color: white; padding: 12px; text-align: left;">Location</th>');
  if (tableColumns.owner) headers.push('<th style="background-color: ' + headerColor + '; color: white; padding: 12px; text-align: left;">Owner</th>');
  if (tableColumns.calDueDate) headers.push('<th style="background-color: ' + headerColor + '; color: white; padding: 12px; text-align: left;">Cal Due Date</th>');
  
  const toolList = tools.map(tool => {
    const toolName = tool.toolName || 'Unknown Tool';
    const partNumber = tool.partNumber || tool.id;
    const checkoutDate = tool.timestamp?.toDate 
      ? tool.timestamp.toDate().toLocaleDateString() 
      : 'N/A';
    const location = tool.location || 'N/A';
    const owner = tool.owner || 'N/A';
    const calDueDate = tool.calDueDate?.toDate 
      ? tool.calDueDate.toDate().toLocaleDateString() 
      : (tool.calDueDate || 'N/A');
    
    const cells = [];
    if (tableColumns.toolName) cells.push(`<td style="padding: 8px; border-bottom: 1px solid #ddd;">${toolName}</td>`);
    if (tableColumns.partNumber) cells.push(`<td style="padding: 8px; border-bottom: 1px solid #ddd;">${partNumber}</td>`);
    if (tableColumns.checkoutDate) cells.push(`<td style="padding: 8px; border-bottom: 1px solid #ddd;">${checkoutDate}</td>`);
    if (tableColumns.location) cells.push(`<td style="padding: 8px; border-bottom: 1px solid #ddd;">${location}</td>`);
    if (tableColumns.owner) cells.push(`<td style="padding: 8px; border-bottom: 1px solid #ddd;">${owner}</td>`);
    if (tableColumns.calDueDate) cells.push(`<td style="padding: 8px; border-bottom: 1px solid #ddd;">${calDueDate}</td>`);
    
    return `<tr>${cells.join('')}</tr>`;
  }).join('');

  // Use custom template or default
  let emailHtml;
  let subject;
  
  if (customBody) {
    // Use custom template with variable replacement
    const tableHtml = headers.length > 0 ? `
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <thead>
          <tr>
            ${headers.join('')}
          </tr>
        </thead>
        <tbody>
          ${toolList}
        </tbody>
      </table>
    ` : '<p>No columns selected for display.</p>';
    
    emailHtml = customBody
      .replace(/{userName}/g, userName)
      .replace(/{count}/g, tools.length.toString())
      .replace(/{toolList}/g, tableHtml);
  } else {
    // Use default template
    emailHtml = `
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
              ${headers.length > 0 ? `
              <table>
                <thead>
                  <tr>
                    ${headers.join('')}
                  </tr>
                </thead>
                <tbody>
                  ${toolList}
                </tbody>
              </table>
              ` : '<p>No tools to display.</p>'}
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
  }
  
  // Use custom subject or default
  if (customSubject) {
    subject = customSubject.replace(/{count}/g, tools.length.toString());
  } else {
    subject = `Tool Tracking Reminder: ${tools.length} Tool(s) Checked Out`;
  }

  const mailOptions = {
    from: emailFrom,
    to: userEmail,
    subject: subject,
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
async function sendAdminSummaryEmail(transporter, emailFrom, adminEmails, outTools, customSubject, customBody, tableColumns, headerColor) {
  // Build table headers based on configuration
  const headers = [];
  if (tableColumns.toolName) headers.push('<th style="background-color: ' + headerColor + '; color: white; padding: 12px; text-align: left;">Tool Name</th>');
  if (tableColumns.partNumber) headers.push('<th style="background-color: ' + headerColor + '; color: white; padding: 12px; text-align: left;">Part Number</th>');
  if (tableColumns.technician) headers.push('<th style="background-color: ' + headerColor + '; color: white; padding: 12px; text-align: left;">Technician</th>');
  if (tableColumns.checkoutDate) headers.push('<th style="background-color: ' + headerColor + '; color: white; padding: 12px; text-align: left;">Checkout Date</th>');
  if (tableColumns.location) headers.push('<th style="background-color: ' + headerColor + '; color: white; padding: 12px; text-align: left;">Location</th>');
  if (tableColumns.owner) headers.push('<th style="background-color: ' + headerColor + '; color: white; padding: 12px; text-align: left;">Owner</th>');
  if (tableColumns.calDueDate) headers.push('<th style="background-color: ' + headerColor + '; color: white; padding: 12px; text-align: left;">Cal Due Date</th>');
  
  const toolList = outTools.map(tool => {
    const toolName = tool.toolName || 'Unknown Tool';
    const partNumber = tool.partNumber || tool.id;
    const technician = tool.technician || 'N/A';
    const checkoutDate = tool.timestamp?.toDate 
      ? tool.timestamp.toDate().toLocaleDateString() 
      : 'N/A';
    const location = tool.location || 'N/A';
    const owner = tool.owner || 'N/A';
    const calDueDate = tool.calDueDate?.toDate 
      ? tool.calDueDate.toDate().toLocaleDateString() 
      : (tool.calDueDate || 'N/A');
    
    const cells = [];
    if (tableColumns.toolName) cells.push(`<td style="padding: 8px; border-bottom: 1px solid #ddd;">${toolName}</td>`);
    if (tableColumns.partNumber) cells.push(`<td style="padding: 8px; border-bottom: 1px solid #ddd;">${partNumber}</td>`);
    if (tableColumns.technician) cells.push(`<td style="padding: 8px; border-bottom: 1px solid #ddd;">${technician}</td>`);
    if (tableColumns.checkoutDate) cells.push(`<td style="padding: 8px; border-bottom: 1px solid #ddd;">${checkoutDate}</td>`);
    if (tableColumns.location) cells.push(`<td style="padding: 8px; border-bottom: 1px solid #ddd;">${location}</td>`);
    if (tableColumns.owner) cells.push(`<td style="padding: 8px; border-bottom: 1px solid #ddd;">${owner}</td>`);
    if (tableColumns.calDueDate) cells.push(`<td style="padding: 8px; border-bottom: 1px solid #ddd;">${calDueDate}</td>`);
    
    return `<tr>${cells.join('')}</tr>`;
  }).join('');

  // Use custom template or default
  let emailHtml;
  let subject;
  
  if (customBody) {
    // Use custom template with variable replacement
    const tableHtml = outTools.length > 0 && headers.length > 0 ? `
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <thead>
          <tr>
            ${headers.join('')}
          </tr>
        </thead>
        <tbody>
          ${toolList}
        </tbody>
      </table>
    ` : (outTools.length === 0 ? '<p>No tools are currently checked out.</p>' : '<p>No columns selected for display.</p>');
    
    emailHtml = customBody
      .replace(/{count}/g, outTools.length.toString())
      .replace(/{toolList}/g, tableHtml);
  } else {
    // Use default template
    emailHtml = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background-color: ${headerColor}; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background-color: #f9f9f9; }
            table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            th { background-color: ${headerColor}; color: white; padding: 12px; text-align: left; }
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
              ${outTools.length > 0 && headers.length > 0 ? `
                <table>
                  <thead>
                    <tr>
                      ${headers.join('')}
                    </tr>
                  </thead>
                  <tbody>
                    ${toolList}
                  </tbody>
                </table>
              ` : (outTools.length === 0 ? '<p>No tools are currently checked out.</p>' : '<p>No columns selected for display.</p>')}
              <p>Thank you!</p>
            </div>
            <div class="footer">
              <p>This is an automated message from the Tool Tracking System.</p>
            </div>
          </div>
        </body>
      </html>
    `;
  }
  
  // Use custom subject or default
  if (customSubject) {
    subject = customSubject.replace(/{count}/g, outTools.length.toString());
  } else {
    subject = `Daily Tool Status Report: ${outTools.length} Tool(s) Currently OUT`;
  }

  const mailOptions = {
    from: emailFrom,
    to: adminEmails.join(', '),
    subject: subject,
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

