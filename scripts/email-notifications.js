/**
 * Email Notification Service for ProtoForge Payouts
 * Sends notifications when payouts are initiated and cleared
 */

const nodemailer = require('nodemailer');

// Configure email transporter (use your SMTP provider)
const transporter = nodemailer.createTransporter({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});

// Client email mappings
const CLIENT_EMAILS = {
  galactic_bytes: 'finance@galacticbytes.com',
  detailer_bot: 'admin@detailerbot.com',
  lipi_v2: 'team@lipiv2.com',
  protogrance_aromatics: 'billing@protogrance.com',
  rezonate: 'payments@rezonate.io',
  waveformer_studio: 'finance@waveformer.studio'
};

/**
 * Send payout initiated notification
 */
async function sendPayoutInitiatedEmail(projectCode, amount, transferId, transactionCount) {
  const to = CLIENT_EMAILS[projectCode] || `${projectCode}@protoforge.dev`;
  const projectName = projectCode.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  const mailOptions = {
    from: '"ProtoForge Finance" <finance@protoforge.dev>',
    to: to,
    subject: `💰 ProtoForge Payout Initiated - $${amount.toFixed(2)}`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .header h1 { color: #00d4ff; margin: 0; font-size: 24px; }
    .content { background: #f8f9fa; padding: 30px; }
    .amount { font-size: 32px; color: #00ff88; font-weight: bold; text-align: center; margin: 20px 0; }
    .details { background: #fff; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .details-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
    .details-row:last-child { border-bottom: none; }
    .cta { text-align: center; margin: 30px 0; }
    .cta a { display: inline-block; background: linear-gradient(135deg, #00d4ff, #7b2cbf); color: #fff; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; }
    .footer { text-align: center; padding: 20px; color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ProtoForge</h1>
      <p style="color: #888; margin: 10px 0 0 0;">Payout Notification</p>
    </div>
    
    <div class="content">
      <p>Hello ${projectName} Team,</p>
      
      <p>Good news! Your ProtoForge payout has been initiated and is on its way to your bank account.</p>
      
      <div class="amount">$${amount.toFixed(2)}</div>
      
      <div class="details">
        <div class="details-row">
          <span>Project</span>
          <strong>${projectName}</strong>
        </div>
        <div class="details-row">
          <span>Transfer ID</span>
          <code>${transferId}</code>
        </div>
        <div class="details-row">
          <span>Transactions</span>
          <strong>${transactionCount}</strong>
        </div>
        <div class="details-row">
          <span>Expected Arrival</span>
          <strong>1-2 business days</strong>
        </div>
      </div>
      
      <div class="cta">
        <a href="https://protoforge.dev/dashboard/${projectCode}">View Dashboard</a>
      </div>
      
      <p style="margin-top: 30px; padding: 15px; background: #fff3cd; border-radius: 6px; color: #856404;">
        <strong>📧 Next:</strong> You'll receive another email when the funds arrive in your account.
      </p>
    </div>
    
    <div class="footer">
      <p>ProtoForge Finance Team</p>
      <p><a href="mailto:support@protoforge.dev">support@protoforge.dev</a></p>
      <p style="margin-top: 20px;">This is an automated notification. Please do not reply directly to this email.</p>
    </div>
  </div>
</body>
</html>
    `,
    text: `
ProtoForge Payout Initiated

Hello ${projectName} Team,

Your ProtoForge payout has been initiated.

Amount: $${amount.toFixed(2)}
Project: ${projectName}
Transfer ID: ${transferId}
Transactions: ${transactionCount}
Expected Arrival: 1-2 business days

View your dashboard: https://protoforge.dev/dashboard/${projectCode}

You'll receive another email when the funds arrive.

ProtoForge Finance Team
support@protoforge.dev
    `
  };
  
  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Payout initiated email sent to ${to}`);
    return { success: true, messageId: mailOptions.messageId };
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send payout cleared/completed notification
 */
async function sendPayoutClearedEmail(projectCode, amount, transferId) {
  const to = CLIENT_EMAILS[projectCode] || `${projectCode}@protoforge.dev`;
  const projectName = projectCode.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  const mailOptions = {
    from: '"ProtoForge Finance" <finance@protoforge.dev>',
    to: to,
    subject: `✅ ProtoForge Payout Deposited - $${amount.toFixed(2)}`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #00ff88 0%, #00d4ff 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .header h1 { color: #fff; margin: 0; font-size: 24px; }
    .content { background: #f8f9fa; padding: 30px; }
    .amount { font-size: 36px; color: #00ff88; font-weight: bold; text-align: center; margin: 20px 0; }
    .success-box { background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 8px; text-align: center; margin: 20px 0; }
    .success-box h2 { color: #155724; margin: 0; }
    .details { background: #fff; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .details-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #eee; }
    .cta { text-align: center; margin: 30px 0; }
    .cta a { display: inline-block; background: linear-gradient(135deg, #00d4ff, #7b2cbf); color: #fff; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: 600; }
    .footer { text-align: center; padding: 20px; color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>✓ PAYOUT COMPLETE</h1>
    </div>
    
    <div class="content">
      <p>Hello ${projectName} Team,</p>
      
      <div class="success-box">
        <h2>Your funds have arrived!</h2>
        <p style="margin: 10px 0 0 0; color: #155724;">The payout has been successfully deposited to your bank account.</p>
      </div>
      
      <div class="amount">$${amount.toFixed(2)}</div>
      
      <div class="details">
        <div class="details-row">
          <span>Project</span>
          <strong>${projectName}</strong>
        </div>
        <div class="details-row">
          <span>Transfer ID</span>
          <code>${transferId}</code>
        </div>
        <div class="details-row">
          <span>Status</span>
          <strong style="color: #00ff88;">DEPOSITED</strong>
        </div>
      </div>
      
      <div class="cta">
        <a href="https://protoforge.dev/dashboard/${projectCode}">View Dashboard</a>
      </div>
      
      <p style="text-align: center; color: #666;">Thank you for being a ProtoForge partner.</p>
    </div>
    
    <div class="footer">
      <p>ProtoForge Finance Team</p>
      <p><a href="mailto:support@protoforge.dev">support@protoforge.dev</a></p>
    </div>
  </div>
</body>
</html>
    `,
    text: `
✅ ProtoForge Payout Deposited

Hello ${projectName} Team,

Your funds have arrived!

Amount: $${amount.toFixed(2)}
Project: ${projectName}
Transfer ID: ${transferId}
Status: DEPOSITED

The payout has been successfully deposited to your bank account.

View your dashboard: https://protoforge.dev/dashboard/${projectCode}

Thank you for being a ProtoForge partner.

ProtoForge Finance Team
    `
  };
  
  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Payout cleared email sent to ${to}`);
    return { success: true, messageId: mailOptions.messageId };
  } catch (error) {
    console.error(`❌ Failed to send email to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send monthly summary email
 */
async function sendMonthlySummaryEmail(projectCode, month, summary) {
  const to = CLIENT_EMAILS[projectCode] || `${projectCode}@protoforge.dev`;
  const projectName = projectCode.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  
  const mailOptions = {
    from: '"ProtoForge Finance" <finance@protoforge.dev>',
    to: to,
    subject: `📊 ProtoForge Monthly Summary - ${month}`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px; text-align: center; border-radius: 8px 8px 0 0; }
    .header h1 { color: #00d4ff; margin: 0; }
    .content { background: #f8f9fa; padding: 30px; }
    .summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0; }
    .summary-box { background: #fff; padding: 20px; border-radius: 8px; text-align: center; }
    .summary-box h3 { margin: 0 0 10px 0; color: #888; font-size: 14px; }
    .summary-box .value { font-size: 24px; font-weight: bold; color: #333; }
    .footer { text-align: center; padding: 20px; color: #888; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Monthly Summary</h1>
      <p style="color: #888; margin: 10px 0 0 0;">${month}</p>
    </div>
    
    <div class="content">
      <p>Hello ${projectName} Team,</p>
      
      <p>Here's your financial summary for ${month}:</p>
      
      <div class="summary-grid">
        <div class="summary-box">
          <h3>Gross Revenue</h3>
          <div class="value">$${summary.gross.toFixed(2)}</div>
        </div>
        <div class="summary-box">
          <h3>Net Revenue</h3>
          <div class="value" style="color: #00ff88;">$${summary.net.toFixed(2)}</div>
        </div>
        <div class="summary-box">
          <h3>Transactions</h3>
          <div class="value">${summary.transaction_count}</div>
        </div>
        <div class="summary-box">
          <h3>Average Transaction</h3>
          <div class="value">$${(summary.gross / summary.transaction_count).toFixed(2)}</div>
        </div>
      </div>
    </div>
    
    <div class="footer">
      <p>ProtoForge Finance Team</p>
    </div>
  </div>
</body>
</html>
    `
  };
  
  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ Monthly summary sent to ${to}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Failed to send summary to ${to}:`, error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  sendPayoutInitiatedEmail,
  sendPayoutClearedEmail,
  sendMonthlySummaryEmail,
  CLIENT_EMAILS
};
