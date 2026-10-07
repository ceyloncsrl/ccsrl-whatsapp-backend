import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

// In-memory OTP storage with 15-minute expiration
const otpStore = new Map();

// Hostinger Webmail Configuration
export const ADMIN_NOTIFICATION_EMAIL = process.env.ADMIN_EMAIL || 'ceyloncsrl@gmail.com';
const SENDER_EMAIL = process.env.SMTP_FROM || `"CCSRL European Legal Platform" <${process.env.SMTP_USER || 'info@ccsrl.ro'}>`;

// Configure Transporter (Hostinger Webmail info@ccsrl.ro)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.hostinger.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true, // 465 SSL
  auth: {
    user: process.env.SMTP_USER || 'info@ccsrl.ro',
    pass: process.env.SMTP_PASS || 'Ceyloncsrl2003@'
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Common CSS & Header Template Helper
function getEmailHeader(title = 'Official Consular & Legal Notice') {
  return `
    <div style="background: linear-gradient(135deg, #002B7F 0%, #001A4D 100%); color: #ffffff; padding: 28px 24px; text-align: center; border-radius: 12px 12px 0 0;">
      <div style="display: flex; justify-content: center; height: 4px; margin-bottom: 14px;">
        <span style="background: #002B7F; width: 33.33%; height: 4px;"></span>
        <span style="background: #FCD116; width: 33.33%; height: 4px;"></span>
        <span style="background: #CE1126; width: 33.33%; height: 4px;"></span>
      </div>
      <div style="font-size: 22px; font-weight: 800; letter-spacing: 1.5px; font-family: 'Segoe UI', Arial, sans-serif;">CCSRL EUROPEAN LEGAL</div>
      <div style="font-size: 11px; color: #FCD116; text-transform: uppercase; margin-top: 4px; font-weight: 700; letter-spacing: 1px;">Bucharest Consular &amp; Immigration Affairs</div>
      <div style="font-size: 14px; font-weight: 600; color: #e2e8f0; margin-top: 8px;">${title}</div>
    </div>
  `;
}

function getEmailFooter() {
  return `
    <div style="background: #f8fafc; padding: 20px 24px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; border-radius: 0 0 12px 12px; font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6;">
      <div style="font-weight: 700; color: #1e293b; margin-bottom: 4px;">CCSRL Legal Consultation &amp; Immigration Counsel</div>
      <div>Strada Buzești 50-52, Sector 1, Bucharest 011015, Romania</div>
      <div>Bucharest Legal Helpline: <strong>+40 728 744 478</strong> | Official Inquiries: <strong>info@ccsrl.ro</strong></div>
      <div style="margin-top: 8px; color: #94a3b8; font-size: 10px;">&copy; 2026 CCSRL European Legal Platform. All statutory rights reserved. GDPR &amp; EU Directive 2004/38/EC Compliant.</div>
    </div>
  `;
}

/**
 * Helper to safely dispatch email
 */
export async function sendMailSafe(to, subject, html, bccAdmin = false) {
  if (!to || !to.includes('@')) {
    console.warn(`⚠️ Skipped email dispatch: Invalid recipient address "${to}"`);
    return { success: false, error: 'Invalid recipient email' };
  }

  try {
    const mailOptions = {
      from: SENDER_EMAIL,
      to: to.trim().toLowerCase(),
      subject,
      html
    };

    if (bccAdmin && to.toLowerCase() !== ADMIN_NOTIFICATION_EMAIL.toLowerCase()) {
      mailOptions.bcc = ADMIN_NOTIFICATION_EMAIL;
    }

    const info = await transporter.sendMail(mailOptions);
    console.log(`✉️ [HOSTINGER WEBMAIL] Dispatched to ${to} | Subject: "${subject}" | MessageId: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`❌ [HOSTINGER SMTP ERROR] Failed sending to ${to}:`, err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 1. Generate 6-digit OTP code and store with 15 min expiry
 */
export function generateOtp(email) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 mins
  otpStore.set(email.toLowerCase().trim(), { code, expiresAt });
  return code;
}

/**
 * Verify OTP code
 */
export function verifyOtp(email, code) {
  const entry = otpStore.get(email.toLowerCase().trim());
  if (!entry) return { valid: false, message: 'No OTP code requested for this email.' };
  if (Date.now() > entry.expiresAt) {
    otpStore.delete(email.toLowerCase().trim());
    return { valid: false, message: 'Verification code has expired. Please request a new one.' };
  }
  if (entry.code !== String(code).trim()) {
    return { valid: false, message: 'Invalid verification code. Please check your email.' };
  }
  otpStore.delete(email.toLowerCase().trim());
  return { valid: true };
}

/**
 * 2. Send Welcome Registration Email to User (and Admin copy to ceyloncsrl@gmail.com)
 */
export async function sendWelcomeRegistrationEmail(userData, caseId) {
  const clientName = `${userData.firstName || userData.first_name || 'Valued Client'} ${userData.lastName || userData.last_name || ''}`.trim();
  const userEmail = (userData.email || '').trim();
  const userPhone = userData.phone || userData.foreignPhone || '+40 728 744 478';
  const visaProgram = userData.visaType || userData.visa_type || 'Family Reunification (D/VF)';
  const registrationChannel = userData.sub ? 'Google Single Sign-On (OAuth 2.0)' : 'Online Client Portal';
  const isCaseActive = Boolean(caseId && String(caseId).startsWith('CASE-'));
  const displayCaseId = isCaseActive ? caseId : 'Pending Stage 01 Submission';

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #f1f5f9; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 14px; box-shadow: 0 10px 30px rgba(0,0,0,0.07); border: 1px solid #e2e8f0; overflow: hidden;">
        ${getEmailHeader(isCaseActive ? 'Official Case Dossier Active' : 'Account Registered – Complete Stage 01')}
        
        <div style="padding: 32px 26px; color: #1e293b; line-height: 1.6;">
          <div style="display: inline-block; background: ${isCaseActive ? '#ecfdf5' : '#eff6ff'}; border: 1px solid ${isCaseActive ? '#a7f3d0' : '#bfdbfe'}; color: ${isCaseActive ? '#065f46' : '#1e40af'}; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 20px; text-transform: uppercase; margin-bottom: 12px;">
            ${isCaseActive ? '✓ Official Dossier Active' : '✓ Account Verified'}
          </div>
          
          <div style="font-size: 20px; font-weight: 800; color: #0f172a; margin-bottom: 10px;">
            Welcome to CCSRL, ${clientName}!
          </div>
          
          <p style="font-size: 14px; color: #475569; margin: 0 0 18px; line-height: 1.6;">
            ${isCaseActive 
              ? `Your official Romanian legal case file <strong>${caseId}</strong> is now live in our European consular management system (Cloudflare D1). Our Bucharest legal counsel has received your Stage 01 statutory documents.`
              : `Your account on the <strong>CCSRL European Legal Platform</strong> has been successfully created. Please sign in to your Client Portal and submit your <strong>Stage 01 Required Documents</strong> to officially activate your Case Dossier ID.`
            }
          </p>

          <!-- Highlight Box: Case ID & Dossier Summary -->
          <div style="background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%); border: 1px solid #bae6fd; border-radius: 12px; padding: 20px; margin: 20px 0;">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 800; color: #0369a1; letter-spacing: 0.8px;">${isCaseActive ? 'Your Unique Case Reference Dossier ID' : 'Dossier Activation Status'}</div>
            <div style="font-size: ${isCaseActive ? '26px' : '20px'}; font-weight: 900; color: #002B7F; font-family: monospace; letter-spacing: 1px; margin: 6px 0 14px;">${displayCaseId}</div>
            
            <table style="width: 100%; font-size: 13px; border-collapse: collapse; border-top: 1px solid #bae6fd; padding-top: 10px;">
              <tr>
                <td style="padding: 5px 0; color: #64748b; width: 42%;">Client Full Name:</td>
                <td style="padding: 5px 0; font-weight: 700; color: #0f172a;">${clientName}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #64748b;">Registered Email:</td>
                <td style="padding: 5px 0; font-weight: 700; color: #0284c7;">${userEmail}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #64748b;">Primary Contact Phone:</td>
                <td style="padding: 5px 0; font-weight: 700; color: #16a34a;">${userPhone}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #64748b;">Visa / Legal Program:</td>
                <td style="padding: 5px 0; font-weight: 700; color: #b45309;">${visaProgram}</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #64748b;">Primary Jurisdiction:</td>
                <td style="padding: 5px 0; font-weight: 700; color: #1e293b;">IGI Bucharest, Romania</td>
              </tr>
              <tr>
                <td style="padding: 5px 0; color: #64748b;">Assigned Legal Counsel:</td>
                <td style="padding: 5px 0; font-weight: 700; color: #002B7F;">Elena Radu (Senior European Legal Counsel)</td>
              </tr>
            </table>
          </div>

          <!-- Next Steps -->
          <div style="margin: 22px 0;">
            <div style="font-size: 14px; font-weight: 800; color: #0f172a; margin-bottom: 10px;">Next Steps on Your Immigration Roadmap:</div>
            <ol style="margin: 0; padding-left: 20px; font-size: 13px; color: #475569; line-height: 1.7;">
              <li><strong>Sign In to your Client Portal</strong> using your registered email/phone or 1-click Google Sign-In.</li>
              <li><strong>Upload Stage 01 Required Documents</strong> (Passport scan, Police clearance, Civil certificates) for legal compliance audit.</li>
              <li><strong>Track Real-Time Progress</strong> across all 10 milestones of your Romanian immigration dossier.</li>
            </ol>
          </div>

          <!-- Access Button -->
          <div style="text-align: center; margin: 28px 0 16px;">
            <a href="https://ccsrl.ro/client-portal" style="display: inline-block; background: #002B7F; color: #ffffff; padding: 13px 36px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 14px; letter-spacing: 0.5px; box-shadow: 0 4px 12px rgba(0,43,127,0.25);">
              Access Client Portal &rarr;
            </a>
          </div>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 16px; margin-top: 22px; font-size: 12px; color: #64748b;">
            💡 <strong>Need Direct Assistance?</strong> Contact our Bucharest legal team directly via WhatsApp or Phone at <strong>+40 728 744 478</strong> or email <strong>info@ccsrl.ro</strong>.
          </div>
        </div>
        ${getEmailFooter()}
      </div>
    </body>
    </html>
  `;

  const subject = isCaseActive
    ? `[CCSRL] Case Dossier Initialized (${caseId}) - Stage 01 Under Review`
    : `[CCSRL] Welcome to CCSRL Portal - Complete Stage 01 to Activate Case File`;

  return await sendMailSafe(userEmail, subject, html, true);
}

/**
 * 2b. Send Admin New User Registration Alert to ceyloncsrl@gmail.com with Full Particulars
 */
export async function sendAdminRegistrationAlert(userData, caseId) {
  const clientName = `${userData.firstName || userData.first_name || 'Client'} ${userData.lastName || userData.last_name || ''}`.trim();
  const time = new Date().toLocaleString('en-US', { timeZone: 'Europe/Bucharest', dateStyle: 'full', timeStyle: 'short' });
  const registrationChannel = userData.sub ? 'Google OAuth 2.0 Single Sign-On' : 'Client Web Portal Form';

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #0b1329; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 660px; margin: 0 auto; background: #ffffff; border-radius: 14px; box-shadow: 0 15px 35px rgba(0,0,0,0.4); border: 1px solid #334155; overflow: hidden;">
        
        <!-- Admin Header -->
        <div style="background: linear-gradient(135deg, #002B7F 0%, #001A4D 100%); color: #ffffff; padding: 24px 28px; text-align: left;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
            <span style="background: #FCD116; color: #001A4D; padding: 3px 10px; font-size: 11px; font-weight: 800; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px;">
              ADMIN DOSSIER ALERT
            </span>
            <span style="font-size: 11px; color: #93c5fd; font-family: monospace;">${registrationChannel}</span>
          </div>
          <h2 style="margin: 8px 0 4px; font-size: 22px; color: #ffffff;">🚨 New Client Dossier Registered</h2>
          <div style="font-size: 12px; color: #bfdbfe;">
            Case ID: <strong style="color: #FCD116; font-family: monospace;">${caseId}</strong> | Bucharest Time: <strong>${time}</strong>
          </div>
        </div>

        <div style="padding: 26px; color: #1e293b; font-size: 13px; line-height: 1.6;">

          <!-- SECTION 1: ACCOUNT & CONTACT DETAILS -->
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 20px; margin-bottom: 18px;">
            <div style="font-size: 11px; font-weight: 800; color: #002B7F; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
              1. Account, Contact &amp; Case Dossier Particulars
            </div>
            <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
              <tr>
                <td style="padding: 4px 0; color: #64748b; width: 40%;">Case Reference ID:</td>
                <td style="font-weight: 800; color: #002B7F; font-family: monospace; font-size: 14px;">${caseId}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Full Client Name:</td>
                <td style="font-weight: 700; color: #0f172a;">${clientName}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #64748b;">First (Given) Name:</td>
                <td style="font-weight: 600;">${userData.firstName || userData.first_name || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Last (Family) Name:</td>
                <td style="font-weight: 600;">${userData.lastName || userData.last_name || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Email Address:</td>
                <td style="font-weight: 700; color: #0284c7;">
                  <a href="mailto:${userData.email}" style="color: #0284c7; text-decoration: none;">${userData.email || 'N/A'}</a>
                </td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Primary Phone / WhatsApp:</td>
                <td style="font-weight: 700; color: #16a34a;">${userData.phone || userData.foreignPhone || 'N/A'}</td>
              </tr>
              ${userData.foreignPhone ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Foreign / Direct Mobile:</td>
                <td>${userData.foreignPhone}</td>
              </tr>` : ''}
              ${userData.romanianPhone ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Romanian Contact Phone:</td>
                <td>${userData.romanianPhone}</td>
              </tr>` : ''}
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Registration Mode:</td>
                <td><span style="background: #e0f2fe; color: #0369a1; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">${registrationChannel}</span></td>
              </tr>
            </table>
          </div>

          <!-- SECTION 2: IDENTITY & TRAVEL PARTICULARS -->
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 20px; margin-bottom: 18px;">
            <div style="font-size: 11px; font-weight: 800; color: #002B7F; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
              2. Passport, Identity &amp; Travel Documentation
            </div>
            <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
              <tr>
                <td style="padding: 4px 0; color: #64748b; width: 40%;">Passport Number:</td>
                <td style="font-weight: 800; font-family: monospace; color: #0f172a;">${userData.passportNumber || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Passport Issue Date:</td>
                <td>${userData.passportIssueDate || 'N/A'}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Passport Expiry Date:</td>
                <td>${userData.passportExpiry || 'N/A'}</td>
              </tr>
              ${userData.nicNumber ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">NIC / National ID:</td>
                <td style="font-family: monospace; font-weight: 600;">${userData.nicNumber}</td>
              </tr>` : ''}
              ${userData.birthLocation ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Place of Birth:</td>
                <td>${userData.birthLocation}</td>
              </tr>` : ''}
              ${userData.dateOfBirth ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Date of Birth:</td>
                <td>${userData.dateOfBirth}</td>
              </tr>` : ''}
              ${userData.trcCnpNumber ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">TRC / CNP (Permis No):</td>
                <td style="font-family: monospace; font-weight: 700; color: #7c3aed;">${userData.trcCnpNumber}</td>
              </tr>` : ''}
              ${userData.trcValid15Months ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">TRC 15-Month Validity:</td>
                <td>${userData.trcValid15Months}</td>
              </tr>` : ''}
            </table>
          </div>

          <!-- SECTION 3: PROGRAM & RESIDENTIAL LOCATION -->
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 20px; margin-bottom: 18px;">
            <div style="font-size: 11px; font-weight: 800; color: #002B7F; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
              3. Visa Program &amp; Residential Particulars
            </div>
            <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
              <tr>
                <td style="padding: 4px 0; color: #64748b; width: 40%;">Visa Category:</td>
                <td style="font-weight: 700; color: #b45309;">${userData.visaType || 'Family Reunification (D/VF)'}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Country of Origin:</td>
                <td>${userData.country || 'Sri Lanka'}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Target City in Romania:</td>
                <td style="font-weight: 700;">${userData.romaniaCity || 'Bucharest'}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Sri Lankan / Home Address:</td>
                <td>${userData.sriLankanAddress || 'Sri Lanka'}</td>
              </tr>
              ${userData.romanianAddress ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Romanian Residential Address:</td>
                <td>${userData.romanianAddress}</td>
              </tr>` : ''}
              ${userData.arrivedDate ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Arrival Date in Romania:</td>
                <td>${userData.arrivedDate}</td>
              </tr>` : ''}
            </table>
          </div>

          <!-- SECTION 4: FAMILY & SPONSORSHIP DETAILS -->
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px 20px; margin-bottom: 22px;">
            <div style="font-size: 11px; font-weight: 800; color: #002B7F; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px;">
              4. Family, Spouse &amp; Sponsorship Particulars
            </div>
            <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
              <tr>
                <td style="padding: 4px 0; color: #64748b; width: 40%;">Marital Status:</td>
                <td style="font-weight: 700;">${userData.hasSpouse === 'Yes' ? 'Married (Spouse Included)' : (userData.isDivorced === 'Yes' ? 'Divorced' : 'Single')}</td>
              </tr>
              ${userData.hasSpouse === 'Yes' ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Spouse Full Name:</td>
                <td style="font-weight: 700; color: #0f172a;">${userData.spouseName || 'N/A'}</td>
              </tr>
              ${userData.spousePassport ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Spouse Passport:</td>
                <td style="font-family: monospace; font-weight: 700;">${userData.spousePassport}</td>
              </tr>` : ''}
              ${userData.spousePassportIssue || userData.spousePassportExpiry ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Spouse Passport Issue/Expiry:</td>
                <td>${userData.spousePassportIssue || 'N/A'} - ${userData.spousePassportExpiry || 'N/A'}</td>
              </tr>` : ''}
              ${userData.spouseBirthLocation ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Spouse Birth Place:</td>
                <td>${userData.spouseBirthLocation}</td>
              </tr>` : ''}
              ${userData.spouseMother ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Spouse Mother's Name:</td>
                <td>${userData.spouseMother}</td>
              </tr>` : ''}
              ${userData.spouseFather ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Spouse Father's Name:</td>
                <td>${userData.spouseFather}</td>
              </tr>` : ''}
              ` : ''}
              ${userData.fatherName ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Client Father's Name:</td>
                <td>${userData.fatherName}</td>
              </tr>` : ''}
              ${userData.motherName ? `
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Client Mother's Name:</td>
                <td>${userData.motherName}</td>
              </tr>` : ''}
              <tr>
                <td style="padding: 4px 0; color: #64748b;">Number of Children:</td>
                <td><strong>${userData.childrenCount || 0}</strong></td>
              </tr>
            </table>
          </div>

          <!-- ACTION BUTTONS -->
          <div style="text-align: center; margin-top: 24px; padding-top: 14px; border-top: 1px solid #e2e8f0;">
            <a href="https://ccsrl.ro/admin-portal" style="display: inline-block; background: #002B7F; color: #ffffff; padding: 12px 28px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 13px; margin: 4px;">
              Open Dossier in Admin CRM &rarr;
            </a>
            ${userData.email ? `
            <a href="mailto:${userData.email}" style="display: inline-block; background: #0284c7; color: #ffffff; padding: 12px 24px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 13px; margin: 4px;">
              Direct Email Client &rarr;
            </a>` : ''}
          </div>
        </div>
        ${getEmailFooter()}
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(ADMIN_NOTIFICATION_EMAIL, `🚨 [NEW REGISTRATION] ${clientName} (${caseId}) - Full Client Particulars`, html);
}

/**
 * 3. Send Login Security Alert Email to User
 */
export async function sendLoginAlertEmail(userEmail, userName = 'Client') {
  const time = new Date().toLocaleString('en-US', { timeZone: 'Europe/Bucharest', dateStyle: 'medium', timeStyle: 'short' });
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #f1f5f9; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; overflow: hidden;">
        ${getEmailHeader('Security & Portal Access Notice')}
        <div style="padding: 30px 24px; color: #1e293b; line-height: 1.6;">
          <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">Hello ${userName},</div>
          <p style="font-size: 13px; color: #475569; margin: 0 0 16px;">
            This is a security confirmation that your CCSRL Client Portal account was just accessed successfully.
          </p>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; font-size: 12px; color: #334155; margin: 16px 0;">
            <div style="margin-bottom: 4px;"><strong>Account:</strong> ${userEmail}</div>
            <div style="margin-bottom: 4px;"><strong>Time (Bucharest EET):</strong> ${time}</div>
            <div><strong>Security Status:</strong> Authenticated Session Active</div>
          </div>

          <p style="font-size: 12px; color: #64748b;">
            If you did not perform this login, please immediately reset your account password or contact our emergency legal helpline at <strong>+40 728 744 478</strong>.
          </p>
        </div>
        ${getEmailFooter()}
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(userEmail, `[CCSRL Security] Portal Sign-In Notification`, html);
}

/**
 * 3b. Send Admin User Login Alert to ceyloncsrl@gmail.com
 */
export async function sendAdminLoginAlert(userData, caseData) {
  const clientName = `${userData.first_name || userData.firstName || 'Client'} ${userData.last_name || userData.lastName || ''}`.trim();
  const time = new Date().toLocaleString('en-US', { timeZone: 'Europe/Bucharest', dateStyle: 'full', timeStyle: 'short' });
  const caseId = userData.case_id || userData.caseId || caseData?.case_id || 'N/A';

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #0f172a; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border: 1px solid #334155; overflow: hidden;">
        <div style="background: #1e293b; color: #ffffff; padding: 18px 24px; text-align: left;">
          <span style="background: #38bdf8; color: #082f49; padding: 3px 8px; font-size: 10px; font-weight: 800; border-radius: 4px; text-transform: uppercase;">USER ACTIVITY</span>
          <h2 style="margin: 6px 0 2px; font-size: 18px;">🔐 Client Logged In to Portal</h2>
          <div style="font-size: 12px; color: #94a3b8;">Case: <strong>${caseId}</strong> | Time: ${time} (Bucharest)</div>
        </div>

        <div style="padding: 24px; color: #1e293b; font-size: 13px; line-height: 1.6;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
              <tr><td style="padding: 4px 0; color: #64748b; width: 40%;">Client Name:</td><td style="font-weight: 700;">${clientName}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Client Email:</td><td style="font-weight: 700; color: #0284c7;">${userData.email}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Phone:</td><td>${userData.phone || caseData?.phone || 'N/A'}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Case Dossier:</td><td style="font-family: monospace; font-weight: 700;">${caseId}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Current Stage:</td><td>Stage 0${caseData?.current_stage_number || 1}</td></tr>
            </table>
          </div>

          <div style="text-align: center; margin-top: 16px;">
            <a href="https://ccsrl.ro/admin-portal" style="display: inline-block; background: #002B7F; color: #ffffff; padding: 10px 22px; border-radius: 6px; font-weight: 700; text-decoration: none; font-size: 12px;">
              View Case in CRM &rarr;
            </a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(ADMIN_NOTIFICATION_EMAIL, `[USER LOGIN] ${clientName} (${caseId}) signed into Client Portal`, html);
}

/**
 * 3c. Send Admin Client Profile Update Alert to ceyloncsrl@gmail.com
 */
export async function sendAdminProfileUpdateAlert(userData, caseId) {
  const clientName = `${userData.firstName || userData.clientName || 'Client'} ${userData.lastName || ''}`.trim();
  const time = new Date().toLocaleString('en-US', { timeZone: 'Europe/Bucharest', dateStyle: 'full', timeStyle: 'short' });

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #0f172a; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border: 1px solid #334155; overflow: hidden;">
        <div style="background: #2563eb; color: #ffffff; padding: 20px 24px; text-align: left;">
          <span style="background: #FCD116; color: #001A4D; padding: 3px 8px; font-size: 10px; font-weight: 800; border-radius: 4px; text-transform: uppercase;">PROFILE UPDATE</span>
          <h2 style="margin: 8px 0 2px; font-size: 20px;">📝 Client Updated Profile Particulars</h2>
          <div style="font-size: 12px; color: #bfdbfe;">Case: <strong>${caseId}</strong> | Time: ${time}</div>
        </div>

        <div style="padding: 24px; color: #1e293b; font-size: 13px; line-height: 1.6;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
            <div style="font-size: 11px; font-weight: 800; color: #1e40af; text-transform: uppercase; margin-bottom: 10px;">Updated Client Particulars</div>
            <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
              <tr><td style="padding: 4px 0; color: #64748b; width: 40%;">Full Name:</td><td style="font-weight: 700;">${clientName}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Email Address:</td><td style="font-weight: 700; color: #0284c7;">${userData.email || 'N/A'}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Phone / WhatsApp:</td><td style="font-weight: 700;">${userData.phone || userData.foreignPhone || 'N/A'}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Passport Number:</td><td style="font-family: monospace; font-weight: 700;">${userData.passportNumber || 'N/A'}</td></tr>
              ${userData.passportExpiry ? `<tr><td style="padding: 4px 0; color: #64748b;">Passport Expiry:</td><td>${userData.passportExpiry}</td></tr>` : ''}
              ${userData.trcCnpNumber ? `<tr><td style="padding: 4px 0; color: #64748b;">TRC/CNP Number:</td><td style="font-family: monospace;">${userData.trcCnpNumber}</td></tr>` : ''}
              ${userData.romaniaCity ? `<tr><td style="padding: 4px 0; color: #64748b;">Target Romania City:</td><td>${userData.romaniaCity}</td></tr>` : ''}
              ${userData.sriLankanAddress ? `<tr><td style="padding: 4px 0; color: #64748b;">Sri Lankan Address:</td><td>${userData.sriLankanAddress}</td></tr>` : ''}
              ${userData.spouseName ? `<tr><td style="padding: 4px 0; color: #64748b;">Spouse Name:</td><td style="font-weight: 700;">${userData.spouseName}</td></tr>` : ''}
              ${userData.spousePassport ? `<tr><td style="padding: 4px 0; color: #64748b;">Spouse Passport:</td><td style="font-family: monospace;">${userData.spousePassport}</td></tr>` : ''}
            </table>
          </div>

          <div style="text-align: center; margin-top: 18px;">
            <a href="https://ccsrl.ro/admin-portal" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 10px 24px; border-radius: 6px; font-weight: 700; text-decoration: none; font-size: 12px;">
              Review Case in CRM &rarr;
            </a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(ADMIN_NOTIFICATION_EMAIL, `[PROFILE UPDATE] ${clientName} (${caseId}) updated particulars`, html);
}


/**
 * 4. Send Password Reset Email with 6-digit OTP Code
 */
export async function sendPasswordResetEmail(email, code, clientName = 'Client') {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #f1f5f9; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; overflow: hidden;">
        ${getEmailHeader('Password Recovery Security Code')}
        <div style="padding: 30px 24px; color: #1e293b; line-height: 1.6;">
          <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">Hello ${clientName},</div>
          <p style="font-size: 13px; color: #475569; margin: 0 0 16px;">
            We received a request to reset your password for the CCSRL Client Portal. Use the 6-digit security code below to complete your password reset:
          </p>

          <div style="background: #f1f5f9; border: 2px dashed #002B7F; border-radius: 10px; padding: 20px; text-align: center; margin: 20px 0;">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #64748b; margin-bottom: 6px; letter-spacing: 1px;">Your 6-Digit Verification Code</div>
            <div style="font-size: 36px; font-weight: 900; letter-spacing: 8px; color: #002B7F; font-family: monospace;">${code}</div>
            <div style="font-size: 11px; color: #94a3b8; margin-top: 6px;">⏱️ Valid for 15 minutes</div>
          </div>

          <p style="font-size: 12px; color: #64748b; margin: 16px 0 0;">
            If you did not request this password reset, please disregard this email. Your account remains completely secure.
          </p>
        </div>
        ${getEmailFooter()}
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(email, `[CCSRL Security] Password Reset OTP Code: ${code}`, html);
}

/**
 * 5. Send Inquiry Received Confirmation Email to Applicant
 */
export async function sendInquiryReceivedEmail(inquiryData) {
  const customerName = inquiryData.customerName || inquiryData.name || 'Applicant';
  const inqId = inquiryData.id || `INQ-2026-${Date.now().toString().slice(-4)}`;
  const visaType = inquiryData.visaType || 'Romanian Immigration & Visa Consultation';

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #f1f5f9; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; overflow: hidden;">
        ${getEmailHeader('Inquiry Received & Under Legal Review')}
        <div style="padding: 30px 24px; color: #1e293b; line-height: 1.6;">
          <div style="font-size: 18px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">Hello ${customerName},</div>
          <p style="font-size: 14px; color: #475569; margin: 0 0 16px;">
            Thank you for contacting <strong>CCSRL European Legal Platform</strong>. We have received your inquiry and registered your reference ticket in our Bucharest legal registry.
          </p>

          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 18px; margin: 20px 0;">
            <div style="font-size: 10px; text-transform: uppercase; font-weight: 700; color: #15803d; letter-spacing: 0.5px;">Inquiry Reference ID</div>
            <div style="font-size: 22px; font-weight: 900; color: #16a34a; font-family: monospace; margin: 4px 0 12px;">${inqId}</div>
            
            <div style="border-top: 1px solid #dcfce7; padding-top: 10px; font-size: 13px; color: #334155;">
              <div style="margin-bottom: 4px;"><strong>Visa Program:</strong> ${visaType}</div>
              <div style="margin-bottom: 4px;"><strong>Preferred Contact:</strong> ${inquiryData.preferredContact || 'WhatsApp / Email'}</div>
              <div><strong>Assigned Counsel:</strong> Elena Radu (Senior Immigration Counsel)</div>
            </div>
          </div>

          <p style="font-size: 13px; color: #475569;">
            Our legal team in Bucharest is reviewing your submission against current <strong>2026 IGI Romanian Immigration Regulations</strong>. We will reach out to you within 24 business hours.
          </p>

          <div style="background: #f8fafc; border-left: 4px solid #002B7F; padding: 12px 16px; margin: 20px 0; font-size: 12px; color: #475569;">
            <strong>Immediate Legal Assistance:</strong><br/>
            Direct Bucharest WhatsApp Helpline: <a href="https://wa.me/40728744478" style="color: #002B7F; font-weight: 700; text-decoration: none;">+40 728 744 478</a>
          </div>
        </div>
        ${getEmailFooter()}
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(inquiryData.email, `[CCSRL] Inquiry Received [${inqId}]: ${visaType}`, html, true);
}

/**
 * 5b. Send Admin New Inquiry Alert to ceyloncsrl@gmail.com
 */
export async function sendAdminInquiryAlert(inquiryData) {
  const customerName = inquiryData.customerName || inquiryData.name || 'Applicant';
  const inqId = inquiryData.id || `INQ-2026-${Date.now().toString().slice(-4)}`;
  const time = new Date().toLocaleString('en-US', { timeZone: 'Europe/Bucharest', dateStyle: 'full', timeStyle: 'short' });

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #0f172a; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border: 1px solid #334155; overflow: hidden;">
        <div style="background: #0f766e; color: #ffffff; padding: 20px 24px; text-align: left;">
          <span style="background: #FCD116; color: #001A4D; padding: 3px 8px; font-size: 10px; font-weight: 800; border-radius: 4px; text-transform: uppercase;">CRM LEAD ALERT</span>
          <h2 style="margin: 8px 0 2px; font-size: 20px;">📩 New Client Inquiry Submitted</h2>
          <div style="font-size: 12px; color: #ccfbf1;">Ticket ID: <strong>${inqId}</strong> | Time: ${time}</div>
        </div>

        <div style="padding: 24px; color: #1e293b; font-size: 13px; line-height: 1.6;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
              <tr><td style="padding: 4px 0; color: #64748b; width: 40%;">Lead Name:</td><td style="font-weight: 700;">${customerName}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Email Address:</td><td style="font-weight: 700; color: #0f766e;">${inquiryData.email || 'N/A'}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Phone / WhatsApp:</td><td style="font-weight: 700;">${inquiryData.phone || inquiryData.whatsapp || 'N/A'}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Requested Visa:</td><td style="font-weight: 700; color: #b45309;">${inquiryData.visaType || 'General Consultation'}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Contact Preference:</td><td>${inquiryData.preferredContact || 'WhatsApp'}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Consultation Mode:</td><td>${inquiryData.consultationMode || 'Video Call'}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Preferred Schedule:</td><td>${inquiryData.preferredDate || 'Upcoming'} at ${inquiryData.preferredTime || '15:00'}</td></tr>
            </table>
          </div>

          ${inquiryData.message ? `
            <div style="background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 14px; margin-bottom: 16px;">
              <div style="font-size: 11px; font-weight: 700; color: #0f766e; text-transform: uppercase; margin-bottom: 4px;">Customer Message / Notes:</div>
              <div style="font-size: 13px; color: #134e48; font-style: italic;">"${inquiryData.message}"</div>
            </div>
          ` : ''}

          <div style="text-align: center; margin-top: 18px;">
            <a href="https://ccsrl.ro/admin-portal" style="display: inline-block; background: #0f766e; color: #ffffff; padding: 10px 24px; border-radius: 6px; font-weight: 700; text-decoration: none; font-size: 12px;">
              Reply to Lead in CRM &rarr;
            </a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(ADMIN_NOTIFICATION_EMAIL, `[LEAD ALERT] New Inquiry from ${customerName} (${inqId})`, html);
}

/**
 * 6. Send Stage Application / Document Submission Email to Client
 */
export async function sendStageSubmissionEmail(clientEmail, clientName, caseId, stageNumber, stageTitle, filesCount = 1) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #f1f5f9; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; overflow: hidden;">
        ${getEmailHeader(`Stage 0${stageNumber} Documents Submitted`)}
        <div style="padding: 30px 24px; color: #1e293b; line-height: 1.6;">
          <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">Hello ${clientName},</div>
          <p style="font-size: 13px; color: #475569; margin: 0 0 16px;">
            We confirm that your uploaded document(s) for <strong>Stage 0${stageNumber} – ${stageTitle || 'Milestone Application'}</strong> have been successfully received by our Bucharest legal team.
          </p>

          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 18px; font-size: 12px; color: #334155; margin: 16px 0;">
            <div style="margin-bottom: 4px;"><strong>Case Dossier ID:</strong> ${caseId}</div>
            <div style="margin-bottom: 4px;"><strong>Milestone Stage:</strong> Stage 0${stageNumber} (${stageTitle || ''})</div>
            <div style="margin-bottom: 4px;"><strong>Files Received:</strong> ${filesCount} File(s) Uploaded</div>
            <div><strong>Status:</strong> <span style="color: #d97706; font-weight: 700;">Under Legal Review</span></div>
          </div>

          <p style="font-size: 12px; color: #64748b;">
            Your assigned legal counsel is examining the uploaded files for sworn translation and apostille compliance. You will receive an immediate notification once approved.
          </p>

          <div style="text-align: center; margin: 22px 0 10px;">
            <a href="https://ccsrl.ro/client-portal" style="display: inline-block; background: #002B7F; color: #ffffff; padding: 10px 26px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 12px;">
              Track Case Progress &rarr;
            </a>
          </div>
        </div>
        ${getEmailFooter()}
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(clientEmail, `[CCSRL Case ${caseId}] Stage 0${stageNumber} Documents Under Review`, html, true);
}

/**
 * 6b. Send Admin Stage Submission Alert to ceyloncsrl@gmail.com
 */
export async function sendAdminStageSubmissionAlert(clientEmail, clientName, caseId, stageNumber, stageTitle, filesCount = 1) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #0f172a; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border: 1px solid #334155; overflow: hidden;">
        <div style="background: #d97706; color: #ffffff; padding: 20px 24px; text-align: left;">
          <span style="background: #ffffff; color: #92400e; padding: 3px 8px; font-size: 10px; font-weight: 800; border-radius: 4px; text-transform: uppercase;">STAGE UPLOAD ALERT</span>
          <h2 style="margin: 8px 0 2px; font-size: 20px;">📁 Client Submitted Stage 0${stageNumber} Files</h2>
          <div style="font-size: 12px; color: #fef3c7;">Case: <strong>${caseId}</strong> (${clientName})</div>
        </div>

        <div style="padding: 24px; color: #1e293b; font-size: 13px; line-height: 1.6;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            <div><strong>Client Name:</strong> ${clientName}</div>
            <div><strong>Client Email:</strong> ${clientEmail}</div>
            <div><strong>Case ID:</strong> ${caseId}</div>
            <div><strong>Stage Number:</strong> Stage 0${stageNumber} (${stageTitle || 'Milestone'})</div>
            <div><strong>Files Uploaded:</strong> ${filesCount}</div>
          </div>

          <p style="font-size: 12px; color: #64748b;">
            Action Required: Please review the uploaded documents in the Admin Document Verification Vault to Approve or Request Revision.
          </p>

          <div style="text-align: center; margin-top: 18px;">
            <a href="https://ccsrl.ro/admin-portal" style="display: inline-block; background: #d97706; color: #ffffff; padding: 10px 24px; border-radius: 6px; font-weight: 700; text-decoration: none; font-size: 12px;">
              Review Files in Admin Vault &rarr;
            </a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(ADMIN_NOTIFICATION_EMAIL, `[STAGE UPLOAD] Case ${caseId}: Stage 0${stageNumber} Submitted by ${clientName}`, html);
}

/**
 * 7. Send Stage Approval Email
 */
export async function sendStageApprovalEmail(clientEmail, clientName, caseId, stageNumber, stageTitle, nextStageNumber, nextStageTitle) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #f1f5f9; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; overflow: hidden;">
        ${getEmailHeader(`🎉 Stage 0${stageNumber} Officially Approved`)}
        <div style="padding: 30px 24px; color: #1e293b; line-height: 1.6;">
          <div style="font-size: 18px; font-weight: 700; color: #16a34a; margin-bottom: 8px;">Congratulations, ${clientName}!</div>
          <p style="font-size: 14px; color: #475569; margin: 0 0 16px;">
            Your submission for <strong>Stage 0${stageNumber} – ${stageTitle}</strong> has satisfied all Romanian statutory requirements and has been <strong>OFFICIALLY APPROVED</strong> by your legal counsel.
          </p>

          <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 10px; padding: 18px; margin: 20px 0;">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #16a34a;">Milestone Status Update</div>
            <div style="font-size: 18px; font-weight: 800; color: #15803d; margin: 4px 0 12px;">Stage 0${stageNumber}: COMPLETED &amp; VERIFIED ✓</div>
            
            ${nextStageNumber ? `
              <div style="border-top: 1px solid #bbf7d0; padding-top: 10px; font-size: 13px; color: #166534;">
                <strong>Next Unlocked Milestone:</strong> Stage 0${nextStageNumber} – ${nextStageTitle || 'Next Step'}
              </div>
            ` : ''}
          </div>

          <p style="font-size: 13px; color: #475569;">
            Please access your client portal now to proceed with the next milestone instructions.
          </p>

          <div style="text-align: center; margin: 24px 0 12px;">
            <a href="https://ccsrl.ro/client-portal" style="display: inline-block; background: #16a34a; color: #ffffff; padding: 12px 32px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 13px;">
              Open Stage 0${nextStageNumber || stageNumber} in Portal &rarr;
            </a>
          </div>
        </div>
        ${getEmailFooter()}
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(clientEmail, `[CCSRL Case ${caseId}] Stage 0${stageNumber} Approved! Milestone Complete`, html, false);
}

/**
 * 8. Send Stage Rejection / Action Required Email
 */
export async function sendStageRejectionEmail(clientEmail, clientName, caseId, stageNumber, stageTitle, reasonNotes) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #f1f5f9; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; overflow: hidden;">
        ${getEmailHeader(`Action Required: Stage 0${stageNumber} Revision`)}
        <div style="padding: 30px 24px; color: #1e293b; line-height: 1.6;">
          <div style="font-size: 16px; font-weight: 700; color: #b91c1c; margin-bottom: 8px;">Hello ${clientName},</div>
          <p style="font-size: 13px; color: #475569; margin: 0 0 16px;">
            Upon reviewing your submission for <strong>Stage 0${stageNumber} (${stageTitle})</strong>, our legal counsel noted that some adjustments or document re-uploads are necessary before we can proceed.
          </p>

          <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 18px; margin: 20px 0;">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #dc2626; margin-bottom: 4px;">Counsel Instructions &amp; Required Revisions</div>
            <div style="font-size: 13px; color: #991b1b; white-space: pre-line; line-height: 1.5; font-weight: 500;">
              ${reasonNotes || 'Please re-upload clear, high-resolution scanned copies of the specified statutory certificates.'}
            </div>
          </div>

          <p style="font-size: 13px; color: #475569;">
            Please log in to your portal and re-submit the required documents so we can complete this stage promptly without delays.
          </p>

          <div style="text-align: center; margin: 24px 0 12px;">
            <a href="https://ccsrl.ro/client-portal" style="display: inline-block; background: #dc2626; color: #ffffff; padding: 12px 30px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 13px;">
              Re-Upload Documents in Portal &rarr;
            </a>
          </div>
        </div>
        ${getEmailFooter()}
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(clientEmail, `[CCSRL Action Required] Case ${caseId}: Revision Needed for Stage 0${stageNumber}`, html, false);
}

/**
 * 9. Send Document Issued Email
 */
export async function sendDocumentIssuedEmail(clientEmail, clientName, docName, stageNumber, note) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #f1f5f9; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; overflow: hidden;">
        ${getEmailHeader('Official Document Issued & Ready for Download')}
        <div style="padding: 30px 24px; color: #1e293b; line-height: 1.6;">
          <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">Hello ${clientName},</div>
          <p style="font-size: 13px; color: #475569; margin: 0 0 16px;">
            An official legal document has been generated, certified, and uploaded to your secure dossier repository.
          </p>

          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 16px 18px; margin: 18px 0;">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 700; color: #15803d; margin-bottom: 4px;">Document Available for Download</div>
            <div style="font-size: 16px; font-weight: 800; color: #166534;">📄 ${docName}</div>
            ${stageNumber ? `<div style="font-size: 12px; color: #15803d; margin-top: 4px;">Category: Stage 0${stageNumber}</div>` : ''}
            ${note ? `<div style="margin-top: 8px; font-size: 12px; color: #334155; border-top: 1px solid #dcfce7; padding-top: 6px;"><strong>Counsel Note:</strong> ${note}</div>` : ''}
          </div>

          <div style="text-align: center; margin: 24px 0 12px;">
            <a href="https://ccsrl.ro/client-portal" style="display: inline-block; background: #002B7F; color: #ffffff; padding: 12px 30px; border-radius: 8px; font-weight: 700; text-decoration: none; font-size: 13px;">
              Download Document in Portal &rarr;
            </a>
          </div>
        </div>
        ${getEmailFooter()}
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(clientEmail, `[CCSRL Document Issued] ${docName} Ready for Download`, html, true);
}

/**
 * 10. Direct Email Composer from Admin CRM to Client (via info@ccsrl.ro with BCC to ceyloncsrl@gmail.com)
 */
export async function sendDirectClientEmail({ to, clientName = 'Client', subject, messageText, caseId = '', adminSenderName = 'Elena Radu (Senior Legal Counsel)' }) {
  const formattedMsg = (messageText || '').replace(/\n/g, '<br/>');

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #f1f5f9; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); border: 1px solid #e2e8f0; overflow: hidden;">
        ${getEmailHeader(subject || 'Official Legal Communication')}
        <div style="padding: 30px 24px; color: #1e293b; line-height: 1.6;">
          <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-bottom: 8px;">Dear ${clientName},</div>
          
          ${caseId ? `
            <div style="background: #f8fafc; border-left: 3px solid #002B7F; padding: 8px 12px; font-size: 11px; color: #475569; margin-bottom: 16px;">
              <strong>Reference Dossier:</strong> ${caseId}
            </div>
          ` : ''}

          <div style="font-size: 14px; color: #334155; line-height: 1.7; margin: 16px 0;">
            ${formattedMsg}
          </div>

          <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 24px; font-size: 12px; color: #64748b;">
            <div><strong>Sincerely,</strong></div>
            <div style="font-weight: 700; color: #002B7F; font-size: 13px; margin-top: 2px;">${adminSenderName}</div>
            <div>CCSRL Bucharest Immigration &amp; Consular Affairs</div>
          </div>
        </div>
        ${getEmailFooter()}
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(to, subject || `[CCSRL Legal Notice] Case ${caseId || 'Communication'}`, html, true);
}

/**
 * 11. Send Admin Payment Slip Upload Alert to ceyloncsrl@gmail.com
 */
export async function sendAdminPaymentSlipAlert(clientEmail, clientName, caseId, stageNumber, referenceNo) {
  const time = new Date().toLocaleString('en-US', { timeZone: 'Europe/Bucharest', dateStyle: 'full', timeStyle: 'short' });

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #0f172a; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border: 1px solid #334155; overflow: hidden;">
        <div style="background: #059669; color: #ffffff; padding: 20px 24px; text-align: left;">
          <span style="background: #FCD116; color: #001A4D; padding: 3px 8px; font-size: 10px; font-weight: 800; border-radius: 4px; text-transform: uppercase;">PAYMENT PROOF SUBMITTED</span>
          <h2 style="margin: 8px 0 2px; font-size: 20px;">💳 Client Uploaded Embassy Payment Slip</h2>
          <div style="font-size: 12px; color: #a7f3d0;">Case: <strong>${caseId}</strong> | Reference: <strong>${referenceNo || 'TXN-SLIP'}</strong></div>
        </div>

        <div style="padding: 24px; color: #1e293b; font-size: 13px; line-height: 1.6;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px;">
            <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
              <tr><td style="padding: 4px 0; color: #64748b; width: 40%;">Client Name:</td><td style="font-weight: 700;">${clientName}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Client Email:</td><td style="font-weight: 700; color: #059669;">${clientEmail}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Case Dossier:</td><td style="font-family: monospace; font-weight: 700;">${caseId}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Milestone:</td><td>Stage 0${stageNumber || 6} (Embassy / Consular Legalization)</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Bank Reference No:</td><td style="font-family: monospace; font-weight: 700; color: #047857;">${referenceNo || 'N/A'}</td></tr>
              <tr><td style="padding: 4px 0; color: #64748b;">Submission Time:</td><td>${time}</td></tr>
            </table>
          </div>

          <div style="text-align: center; margin-top: 18px;">
            <a href="https://ccsrl.ro/admin-portal" style="display: inline-block; background: #059669; color: #ffffff; padding: 10px 24px; border-radius: 6px; font-weight: 700; text-decoration: none; font-size: 12px;">
              Verify Payment Slip in CRM &rarr;
            </a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(ADMIN_NOTIFICATION_EMAIL, `[PAYMENT SLIP] Case ${caseId}: Stage 0${stageNumber || 6} Proof Uploaded by ${clientName}`, html);
}

/**
 * 12. Send Admin Client Portal Message Alert to ceyloncsrl@gmail.com
 */
export async function sendAdminClientMessageAlert(clientEmail, clientName, caseId, messageText, subject) {
  const time = new Date().toLocaleString('en-US', { timeZone: 'Europe/Bucharest', dateStyle: 'full', timeStyle: 'short' });
  const formattedMsg = (messageText || '').replace(/\n/g, '<br/>');

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #0f172a; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border: 1px solid #334155; overflow: hidden;">
        <div style="background: #4338ca; color: #ffffff; padding: 20px 24px; text-align: left;">
          <span style="background: #FCD116; color: #001A4D; padding: 3px 8px; font-size: 10px; font-weight: 800; border-radius: 4px; text-transform: uppercase;">PORTAL MESSAGE</span>
          <h2 style="margin: 8px 0 2px; font-size: 20px;">💬 New Message from Client</h2>
          <div style="font-size: 12px; color: #c7d2fe;">Case: <strong>${caseId}</strong> (${clientName}) | Time: ${time}</div>
        </div>

        <div style="padding: 24px; color: #1e293b; font-size: 13px; line-height: 1.6;">
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px 16px; margin-bottom: 16px;">
            <div><strong>From:</strong> ${clientName} (${clientEmail})</div>
            <div><strong>Case Reference:</strong> ${caseId}</div>
            ${subject ? `<div><strong>Subject:</strong> ${subject}</div>` : ''}
          </div>

          <div style="background: #eef2ff; border-left: 4px solid #4338ca; padding: 14px 16px; border-radius: 4px; font-size: 13px; color: #312e81; margin-bottom: 18px;">
            ${formattedMsg}
          </div>

          <div style="text-align: center; margin-top: 18px;">
            <a href="https://ccsrl.ro/admin-portal" style="display: inline-block; background: #4338ca; color: #ffffff; padding: 10px 24px; border-radius: 6px; font-weight: 700; text-decoration: none; font-size: 12px;">
              Reply to Client in CRM &rarr;
            </a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(ADMIN_NOTIFICATION_EMAIL, `[CLIENT MESSAGE] Case ${caseId}: New Message from ${clientName}`, html);
}

/**
/**
 * 13. Send Administrative Onboarding & Credentials Email
 */
export async function sendAdminCredentialsEmail({ email, username, password, firstName, lastName, role, creatorName }) {
  const time = new Date().toLocaleString('en-US', { timeZone: 'Europe/Bucharest', dateStyle: 'full', timeStyle: 'short' });
  const fullName = `${firstName || ''} ${lastName || ''}`.trim() || 'Officer';
  const displayRole = role || 'Administrator';
  const adminIdentifier = username || email;

  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="background-color: #0f172a; margin: 0; padding: 24px 12px; font-family: 'Segoe UI', Arial, sans-serif;">
      <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.3); border: 1px solid #334155; overflow: hidden;">
        ${getEmailHeader('Administrative Officer Access Provisioned')}

        <div style="padding: 28px 24px; color: #1e293b; font-size: 14px; line-height: 1.6;">
          <h3 style="margin: 0 0 12px; color: #002B7F; font-size: 18px;">Welcome to CCSRL Legal Executive Panel</h3>
          
          <p style="margin: 0 0 16px; color: #475569;">
            Dear <strong>${fullName}</strong>,<br/>
            Your administrative credentials have been successfully provisioned for the <strong>CCSRL European Legal Platform</strong> with the designated security role of <strong>${displayRole}</strong>${creatorName ? ` by ${creatorName}` : ''}.
          </p>

          <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 18px; margin-bottom: 20px;">
            <div style="font-size: 11px; text-transform: uppercase; font-weight: 800; color: #002B7F; margin-bottom: 12px; letter-spacing: 0.5px;">🔐 Official Login Credentials</div>
            
            <table style="width: 100%; font-size: 13px; border-collapse: collapse;">
              <tr>
                <td style="padding: 6px 0; color: #64748b; width: 150px;">Portal Web Address:</td>
                <td style="padding: 6px 0; font-weight: 700; color: #002B7F;"><a href="https://ccsrl.ro/admin" style="color: #002B7F;">https://ccsrl.ro/admin</a></td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b;">Staff Email:</td>
                <td style="padding: 6px 0; font-family: monospace; font-weight: 700; color: #0f172a; font-size: 14px;">${email}</td>
              </tr>
              ${username && username !== email ? `
              <tr>
                <td style="padding: 6px 0; color: #64748b;">Username / ID:</td>
                <td style="padding: 6px 0; font-family: monospace; font-weight: 700; color: #0f172a; font-size: 14px;">${username}</td>
              </tr>` : ''}
              <tr>
                <td style="padding: 6px 0; color: #64748b;">Access Password:</td>
                <td style="padding: 6px 0; font-family: monospace; font-weight: 700; color: #b91c1c; font-size: 15px; background: #fef2f2; padding: 4px 8px; border-radius: 4px; display: inline-block;">${password}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b;">Assigned Role:</td>
                <td style="padding: 6px 0; font-weight: 700; color: #047857;">${displayRole}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b;">Provisioned On:</td>
                <td style="padding: 6px 0; color: #475569;">${time}</td>
              </tr>
            </table>
          </div>

          <div style="text-align: center; margin: 24px 0 16px;">
            <a href="https://ccsrl.ro/admin" style="display: inline-block; background: #002B7F; color: #ffffff; padding: 12px 32px; border-radius: 8px; font-weight: 800; text-decoration: none; font-size: 14px; letter-spacing: 0.5px; box-shadow: 0 4px 12px rgba(0,43,127,0.25);">
              Sign in to CCSRL Admin Control Panel &rarr;
            </a>
          </div>

          <div style="background: #fffbeb; border: 1px solid #fef3c7; border-radius: 6px; padding: 12px; font-size: 12px; color: #92400e; margin-top: 20px;">
            <strong>⚠️ Security Notice:</strong> Please keep these credentials confidential. You may use either your Email (<strong>${email}</strong>) or Username to log in.
          </div>
        </div>

        ${getEmailFooter()}
      </div>
    </body>
    </html>
  `;

  return await sendMailSafe(email, `🔐 CCSRL Administrative Access Granted – Officer Credentials (${displayRole})`, html, true);
}


