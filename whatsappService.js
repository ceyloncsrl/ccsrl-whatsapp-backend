import makeWASocket, { 
  DisconnectReason, 
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Auth session directory path
const SESSION_DIR = path.join(__dirname, 'auth_session');

let sock = null;
let qrCodeDataURL = null;
let isConnected = false;
let connectionState = 'connecting'; // 'connecting', 'qr_ready', 'connected', 'disconnected'
let isInitializing = false;

// Admin Phone Number (+40 728 744 478)
export const ADMIN_PHONE = process.env.ADMIN_WHATSAPP_NUMBER || '40728744478';

/**
 * Format phone number into clean WhatsApp JID
 * E.g. "+40 728 744 478" -> "40728744478@s.whatsapp.net"
 * E.g. "0771234567" -> "94771234567@s.whatsapp.net"
 * E.g. "+94 77 123 4567" -> "94771234567@s.whatsapp.net"
 * E.g. "771234567" -> "94771234567@s.whatsapp.net"
 */
export function formatToWhatsAppJid(phone) {
  if (!phone) return null;
  let clean = String(phone).replace(/[^0-9]/g, '');
  if (!clean) return null;

  // Strip international 00 prefix
  if (clean.startsWith('00')) {
    clean = clean.substring(2);
  }

  // Handle specific Romanian Admin Number (+40 728 744 478)
  if (clean === '0728744478' || clean === '728744478' || clean === '40728744478') {
    return '40728744478@s.whatsapp.net';
  }

  // Handle Romanian numbers starting with 0728 or 07x with 10 digits
  if (clean.length === 10 && clean.startsWith('0728')) {
    clean = '40' + clean.substring(1);
  }
  // Handle Sri Lanka local format starting with 0 (e.g. 0771234567, 071..., 076... -> 94771234567)
  else if (clean.length === 10 && clean.startsWith('0')) {
    clean = '94' + clean.substring(1);
  }
  // Handle 9-digit Sri Lankan mobile without leading 0 (e.g. 771234567 -> 94771234567)
  else if (clean.length === 9 && clean.startsWith('7')) {
    clean = '94' + clean;
  }

  return `${clean}@s.whatsapp.net`;
}

/**
 * Initialize WhatsApp Baileys Engine
 */
export async function initWhatsApp(forceReset = false) {
  if (isInitializing && !forceReset) return;
  isInitializing = true;

  try {
    if (sock) {
      try {
        sock.ev.removeAllListeners();
        sock.end();
      } catch (e) {}
      sock = null;
    }

    if (forceReset && fs.existsSync(SESSION_DIR)) {
      try {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      } catch (e) {
        console.warn('[WhatsApp] Session clear warning:', e.message);
      }
    }

    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version, isLatest } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307], isLatest: true }));

    console.log(`[WhatsApp] Starting WhatsApp Engine (Baileys v${version.join('.')}, isLatest: ${isLatest})...`);
    connectionState = 'connecting';

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: true,
      browser: ['CCSRL Romania Portal', 'Chrome', '1.0.0'],
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          qrCodeDataURL = await QRCode.toDataURL(qr, { margin: 2, scale: 6 });
          connectionState = 'qr_ready';
          isConnected = false;
          console.log('[WhatsApp] 📷 New QR Code Generated. Ready for Admin QR Scan.');
        } catch (qrErr) {
          console.error('[WhatsApp] QR Generation Error:', qrErr);
        }
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;
        isConnected = false;
        connectionState = 'disconnected';
        qrCodeDataURL = null;
        isInitializing = false;
        console.log(`[WhatsApp] Connection closed (status: ${statusCode}). Reconnect: ${shouldReconnect}`);

        if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || statusCode === 403) {
          console.log('[WhatsApp] Session expired or logged out. Resetting auth session to emit fresh QR code...');
          if (fs.existsSync(SESSION_DIR)) {
            try {
              fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            } catch (e) {}
          }
          setTimeout(() => initWhatsApp(true), 1500);
        } else if (shouldReconnect) {
          setTimeout(() => initWhatsApp(false), 4000);
        }
      } else if (connection === 'open') {
        isConnected = true;
        connectionState = 'connected';
        qrCodeDataURL = null;
        isInitializing = false;
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ WhatsApp Gateway Connected Successfully!');
        console.log(`📱 Linked Sender & Admin Number: +40 728 744 478`);
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      }
    });

  } catch (err) {
    console.error('[WhatsApp] Initialization Error:', err);
    isInitializing = false;
  }
}

/**
 * Send WhatsApp text message
 */
export async function sendWhatsAppMessage(targetPhone, message) {
  try {
    if (!sock || !isConnected) {
      console.warn(`[WhatsApp] ⚠️ Cannot send message to ${targetPhone}: WhatsApp is NOT connected yet.`);
      return { success: false, error: 'WhatsApp not connected' };
    }

    const targetJid = formatToWhatsAppJid(targetPhone);
    if (!targetJid) {
      console.warn(`[WhatsApp] ⚠️ Invalid phone number format: "${targetPhone}"`);
      return { success: false, error: 'Invalid phone number' };
    }

    const cleanNum = targetJid.split('@')[0];

    // Verify WhatsApp registration and fetch exact canonical JID
    let resolvedJid = targetJid;
    try {
      const exists = await sock.onWhatsApp(cleanNum);
      if (exists && exists.length > 0 && exists[0].exists) {
        resolvedJid = exists[0].jid;
        console.log(`[WhatsApp] 🎯 Verified WhatsApp User: ${cleanNum} -> ${resolvedJid}`);
      }
    } catch (probeErr) {
      console.warn('[WhatsApp] onWhatsApp check notice:', probeErr.message);
    }

    console.log(`[WhatsApp] 📤 Dispatching message to ${resolvedJid}...`);
    const sentMsg = await sock.sendMessage(resolvedJid, { text: message });
    console.log(`[WhatsApp] ✅ Message successfully sent! MsgId: ${sentMsg?.key?.id || 'OK'}`);
    return { success: true, jid: targetJid, msgId: sentMsg?.key?.id };
  } catch (err) {
    console.error(`[WhatsApp] ❌ Error sending message to ${targetPhone}:`, err?.message || err);
    return { success: false, error: err?.message || 'Send error' };
  }
}

/**
 * Get current WhatsApp status and QR data URL
 */
export function getWhatsAppStatus() {
  return {
    isConnected,
    state: connectionState,
    qrCode: qrCodeDataURL,
    adminPhone: '+40 728 744 478',
    sessionActive: fs.existsSync(path.join(SESSION_DIR, 'creds.json'))
  };
}

/**
 * Disconnect / Logout WhatsApp Session
 */
export async function logoutWhatsApp() {
  try {
    if (sock) {
      try {
        sock.ev.removeAllListeners();
        await sock.logout().catch(() => {});
        sock.end();
      } catch (e) {}
      sock = null;
    }
    isConnected = false;
    connectionState = 'connecting';
    qrCodeDataURL = null;
    isInitializing = false;

    if (fs.existsSync(SESSION_DIR)) {
      try {
        fs.rmSync(SESSION_DIR, { recursive: true, force: true });
      } catch (e) {}
    }
    console.log('[WhatsApp] Logged out & session cleared. Initializing fresh QR generation...');
    setTimeout(() => initWhatsApp(true), 1000);
    return { success: true };
  } catch (err) {
    console.error('[WhatsApp] Logout error:', err);
    return { success: false, error: err.message };
  }
}

// =========================================================================
// 5 STATUTORY IMMIGRATION NOTIFICATION HOOKS WITH PREMIUM RICH TEMPLATES
// =========================================================================

/**
 * 1. User Register -> Send Rich Alert to Admin WhatsApp (+40 728 744 478)
 */
export async function notifyAdminOnRegistration(userData = {}) {
  const name = userData.fullName || `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.name || userData.clientName || 'New Client';
  const phone = userData.phone || userData.foreignPhone || userData.romanianPhone || userData.whatsapp || 'Not provided';
  const email = userData.email || 'Not provided';
  const userId = userData.userId || userData.id || 'UID-Pending';
  const caseId = userData.caseId || userData.case_id || 'Pending Stage 01';
  const program = userData.visaType || userData.program || 'Romania Immigration Program';
  const country = userData.country || userData.sriLankanAddress ? 'Sri Lanka' : 'International';
  const timeStr = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  const message = 
`🏛️ *CCSRL ROMANIA IMMIGRATION PLATFORM*
🔔 *NEW CLIENT REGISTRATION ALERT*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *Applicant Information*:
• *Full Name*: ${name}
• *Permanent User ID*: ${userId}
• *Case Dossier ID*: ${caseId}
• *WhatsApp / Contact*: ${phone}
• *Email Address*: ${email}
• *Selected Visa Program*: ${program}
• *Country of Origin*: ${country}
• *Registration Timestamp*: ${timeStr}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *Account Status*: Created & Active
⚖️ *Required Action*:
Please log in to the CCSRL Admin CRM / Customer 360 desk to conduct statutory initial screening and client profiling.

🔗 *Admin CRM Desk*: http://localhost:3000
_CCSRL Romania Legal & Immigration Bureau_`;

  console.log(`[WhatsApp] 📢 Dispatching Registration Alert for ${name} (${userId}) to Admin...`);
  return sendWhatsAppMessage(ADMIN_PHONE, message);
}

/**
 * 2. Stage Applied / Submitted -> Send Rich Alert to Admin WhatsApp (+40 728 744 478)
 */
export async function notifyAdminOnStageSubmission(submissionData = {}) {
  const name = submissionData.userName || submissionData.clientName || `${submissionData.firstName || ''} ${submissionData.lastName || ''}`.trim() || 'Client';
  const userId = submissionData.userId || 'UID-2026';
  const caseId = submissionData.caseId || submissionData.case_id || 'CASE-2026';
  const phone = submissionData.userPhone || submissionData.phone || submissionData.foreignPhone || 'Not provided';
  const program = submissionData.visaType || submissionData.program || 'Romania Immigration Dossier';
  const stageNum = Number(submissionData.stageNumber || 1);
  const stageTitle = submissionData.stageTitle || `Stage 0${stageNum}`;
  const docCount = submissionData.docCount || submissionData.documents?.length || 1;
  const docNames = submissionData.documentsList || (Array.isArray(submissionData.documents) ? submissionData.documents.map(d => `• ${d.name || d.fileName || 'Document'}`).join('\n') : '• Statutory Checklist Documents');
  const timeStr = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  const message = 
`🏛️ *CCSRL ROMANIA IMMIGRATION PLATFORM*
📥 *NEW STAGE SUBMISSION RECEIVED* 📋

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 *Case & Client Reference*:
• *User ID*: ${userId}
• *Client Name*: ${name}
• *Case ID*: ${caseId}
• *WhatsApp / Phone*: ${phone}
• *Visa Category*: ${program}

📑 *Submission Particulars*:
• *Milestone*: Stage 0${stageNum} – ${stageTitle}
• *Files Uploaded*: ${docCount} Document(s)
• *Submission Date*: ${timeStr}

📄 *Uploaded File Checklist*:
${docNames}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚖️ *Compliance Review Required*:
Please log in to the Admin Dossier Manager to audit document legalities, attestations, and approve the milestone or request rectifications.

🔗 *Admin Dossier Manager*: http://localhost:3000
_CCSRL Romania Legal & Immigration Bureau_`;

  console.log(`[WhatsApp] 📢 Dispatching Stage 0${stageNum} Submission Alert for ${name} (${caseId}) to Admin...`);
  return sendWhatsAppMessage(ADMIN_PHONE, message);
}

/**
 * 3. Stage Approved -> Send Rich Notification to User's WhatsApp
 */
export async function notifyUserStageApproved(targetOrPhone, userNameArg, stageNumberArg, stageTitleArg, nextStageNumArg, nextStageTitleArg, caseIdArg, userIdArg) {
  let targetPhone, userName, stageNum, stageTitle, nextStageNum, nextStageTitle, caseId, userId;

  if (typeof targetOrPhone === 'object' && targetOrPhone !== null) {
    targetPhone = targetOrPhone.phone || targetOrPhone.foreignPhone || targetOrPhone.whatsapp || targetOrPhone.romanianPhone;
    userName = targetOrPhone.userName || targetOrPhone.clientName || targetOrPhone.name || 'Valued Client';
    stageNum = Number(targetOrPhone.stageNumber || 1);
    stageTitle = targetOrPhone.stageTitle || `Stage 0${stageNum}`;
    nextStageNum = Number(targetOrPhone.nextStageNumber || stageNum + 1);
    nextStageTitle = targetOrPhone.nextStageTitle || `Stage 0${nextStageNum}`;
    caseId = targetOrPhone.caseId || 'CASE-2026';
    userId = targetOrPhone.userId || 'UID-2026';
  } else {
    targetPhone = targetOrPhone;
    userName = userNameArg || 'Valued Client';
    stageNum = Number(stageNumberArg || 1);
    stageTitle = stageTitleArg || `Stage 0${stageNum}`;
    nextStageNum = Number(nextStageNumArg || stageNum + 1);
    nextStageTitle = nextStageTitleArg || `Stage 0${nextStageNum}`;
    caseId = caseIdArg || '';
    userId = userIdArg || '';
  }

  if (!targetPhone) {
    console.warn('[WhatsApp] ⚠️ Cannot send Stage Approval: User phone is missing.');
    return { success: false, error: 'User phone missing' };
  }

  const timeStr = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  const message = 
`🏛️ *CCSRL ROMANIA IMMIGRATION PLATFORM*
✅ *STAGE COMPLIANCE APPROVAL NOTICE*

Dear *${userName}*,

Congratulations! Your submission for *Stage 0${stageNum}: ${stageTitle}* has been officially *APPROVED* by the Romanian Legal & Immigration Compliance Directorate.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 *Case Reference*: ${caseId || 'Active Dossier'}
${userId ? `🆔 *User ID*: ${userId}\n` : ''}🔓 *Next Active Milestone*: Stage 0${nextStageNum} – ${nextStageTitle}
⏰ *Approval Timestamp*: ${timeStr}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *Next Steps*:
The next stage has been successfully unlocked on your portal. Please log in to review the upcoming statutory guidelines, payment or notarization requirements, and proceed.

🔗 *Client Portal*: http://localhost:3000

Thank you for your trust and continuous cooperation.
_CCSRL Romania Legal & Immigration Bureau_
🌐 _Bucharest, Romania | Colombo, Sri Lanka_`;

  console.log(`[WhatsApp] 📤 Dispatching Stage 0${stageNum} Approval Notice to Client at ${targetPhone}...`);
  return sendWhatsAppMessage(targetPhone, message);
}

/**
 * 4. Stage Rejected / Action Required -> Send Rich Alert to User's WhatsApp
 */
export async function notifyUserStageRejected(targetOrPhone, userNameArg, stageNumberArg, stageTitleArg, reasonArg, caseIdArg, userIdArg) {
  let targetPhone, userName, stageNum, stageTitle, reason, caseId, userId;

  if (typeof targetOrPhone === 'object' && targetOrPhone !== null) {
    targetPhone = targetOrPhone.phone || targetOrPhone.foreignPhone || targetOrPhone.whatsapp || targetOrPhone.romanianPhone;
    userName = targetOrPhone.userName || targetOrPhone.clientName || targetOrPhone.name || 'Valued Client';
    stageNum = Number(targetOrPhone.stageNumber || 1);
    stageTitle = targetOrPhone.stageTitle || `Stage 0${stageNum}`;
    reason = targetOrPhone.reason || targetOrPhone.note || 'Document corrections or compliance updates required.';
    caseId = targetOrPhone.caseId || 'CASE-2026';
    userId = targetOrPhone.userId || '';
  } else {
    targetPhone = targetOrPhone;
    userName = userNameArg || 'Valued Client';
    stageNum = Number(stageNumberArg || 1);
    stageTitle = stageTitleArg || `Stage 0${stageNum}`;
    reason = reasonArg || 'Document corrections or compliance updates required.';
    caseId = caseIdArg || '';
    userId = userIdArg || '';
  }

  if (!targetPhone) {
    console.warn('[WhatsApp] ⚠️ Cannot send Stage Rejection: User phone is missing.');
    return { success: false, error: 'User phone missing' };
  }

  const message = 
`🏛️ *CCSRL ROMANIA IMMIGRATION PLATFORM*
⚠️ *STAGE ACTION REQUIRED / COMPLIANCE NOTICE*

Dear *${userName}*,

Your submission for *Stage 0${stageNum}: ${stageTitle}* requires your immediate attention and rectification before we proceed with official Romanian statutory authorities.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 *Case Reference*: ${caseId || 'Active Dossier'}
${userId ? `🆔 *User ID*: ${userId}\n` : ''}📝 *Compliance Officer Instructions*:
"${reason}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *Required Action*:
Please log in to your Client Portal, review the officer remarks above, replace or update the requested items, and re-submit for expedited verification.

🔗 *Client Portal*: http://localhost:3000

If you require legal assistance, message your dedicated legal counsel via the portal.
_CCSRL Romania Legal & Immigration Bureau_`;

  console.log(`[WhatsApp] 📤 Dispatching Stage 0${stageNum} Action Required Notice to Client at ${targetPhone}...`);
  return sendWhatsAppMessage(targetPhone, message);
}

/**
 * 5. Document Re-upload Request -> Send Rich Alert to User's WhatsApp
 */
export async function notifyUserDocReupload(targetOrPhone, userNameArg, docTitleArg, stageNumberArg, reasonArg, caseIdArg, userIdArg) {
  let targetPhone, userName, docTitle, stageNum, reason, caseId, userId;

  if (typeof targetOrPhone === 'object' && targetOrPhone !== null) {
    targetPhone = targetOrPhone.phone || targetOrPhone.foreignPhone || targetOrPhone.whatsapp || targetOrPhone.romanianPhone;
    userName = targetOrPhone.userName || targetOrPhone.clientName || targetOrPhone.name || 'Valued Client';
    docTitle = targetOrPhone.docTitle || targetOrPhone.docName || targetOrPhone.name || 'Statutory Checklist Document';
    stageNum = Number(targetOrPhone.stageNumber || 1);
    reason = targetOrPhone.reason || targetOrPhone.note || 'Document unclear, blurred, cropped, or expired.';
    caseId = targetOrPhone.caseId || 'CASE-2026';
    userId = targetOrPhone.userId || '';
  } else {
    targetPhone = targetOrPhone;
    userName = userNameArg || 'Valued Client';
    docTitle = docTitleArg || 'Statutory Checklist Document';
    stageNum = Number(stageNumberArg || 1);
    reason = reasonArg || 'Document unclear, blurred, cropped, or expired.';
    caseId = caseIdArg || '';
    userId = userIdArg || '';
  }

  if (!targetPhone) {
    console.warn('[WhatsApp] ⚠️ Cannot send Doc Reupload: User phone is missing.');
    return { success: false, error: 'User phone missing' };
  }

  const message = 
`🏛️ *CCSRL ROMANIA IMMIGRATION PLATFORM*
⚠️ *DOCUMENT RE-UPLOAD REQUEST* 📑

Dear *${userName}*,

During our legal compliance audit, an issue was identified with the following document in your dossier:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 *Case Reference*: ${caseId || 'Active Dossier'}
${userId ? `🆔 *User ID*: ${userId}\n` : ''}📑 *Document*: *${docTitle}*
🏷️ *Milestone*: Stage 0${stageNum}
📝 *Reason / Requirement*:
"${reason}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 *Required Action*:
Please log in to your Client Portal, navigate to the Document Manager / Stage 0${stageNum} section, and upload a fresh, high-resolution original scan.

🔗 *Client Portal*: http://localhost:3000

_CCSRL Romania Document Verification Desk_`;

  console.log(`[WhatsApp] 📤 Dispatching Document Re-upload Notice for "${docTitle}" to Client at ${targetPhone}...`);
  return sendWhatsAppMessage(targetPhone, message);
}

/**
 * 6. New Inquiry / Consultation Alert -> Send to Admin WhatsApp (+40 728 744 478)
 */
export async function notifyAdminOnInquiry(inquiryData = {}) {
  const name = inquiryData.name || inquiryData.customerName || inquiryData.fullName || 'Prospective Client';
  const phone = inquiryData.phone || inquiryData.whatsapp || inquiryData.foreignPhone || 'Not provided';
  const email = inquiryData.email || 'Not provided';
  const visaType = inquiryData.visaType || inquiryData.visaCategory || inquiryData.service || 'General Inquiry';
  const messageText = inquiryData.message || inquiryData.notes || 'Inquiry received via CCSRL web portal.';
  const inqId = inquiryData.id || 'INQ-New';
  const timeStr = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  const message = 
`🏛️ *CCSRL ROMANIA IMMIGRATION PLATFORM*
🔔 *NEW LEAD / INQUIRY RECEIVED* 📥

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *Applicant Particulars*:
• *Full Name*: ${name}
• *Inquiry Reference*: ${inqId}
• *WhatsApp / Phone*: ${phone}
• *Email Address*: ${email}
• *Visa Category*: ${visaType}
• *Submission Date*: ${timeStr}

📝 *Inquiry Message / Request*:
"${messageText}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚖️ *Assigned Directorate*: CCSRL Client CRM Desk
Please review and initiate client contact.

🔗 *Admin Inquiry CRM*: http://localhost:3000
_CCSRL Romania Legal & Immigration Bureau_`;

  console.log(`[WhatsApp] 📢 Dispatching Inquiry Alert for ${name} (${inqId}) to Admin...`);
  return sendWhatsAppMessage(ADMIN_PHONE, message);
}

/**
 * 7. Inquiry Confirmation -> Send to Client's WhatsApp
 */
export async function notifyUserOnInquiry(inquiryData = {}) {
  const phone = inquiryData.phone || inquiryData.whatsapp || inquiryData.foreignPhone;
  if (!phone) return { success: false, error: 'User phone missing' };

  const name = inquiryData.name || inquiryData.customerName || inquiryData.fullName || 'Valued Client';
  const visaType = inquiryData.visaType || inquiryData.visaCategory || inquiryData.service || 'Romania Immigration Program';
  const inqId = inquiryData.id || 'INQ-New';

  const message = 
`🏛️ *CCSRL ROMANIA IMMIGRATION PLATFORM*
✅ *INQUIRY CONFIRMATION & ACKNOWLEDGEMENT*

Dear *${name}*,

Thank you for contacting the **CCSRL Romania Legal & Immigration Bureau** regarding *${visaType}* (Ref: ${inqId}).

Our legal compliance officers and case specialists have received your inquiry and will contact you via WhatsApp / Phone or Email within 1 business day to discuss your eligibility and visa pathway.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏢 *Headquarters*: Str. Grigore Alexandrescu, Sector 1, Bucharest, Romania
🌐 *Website*: https://ccsrl.ro
📞 *Direct Legal Desk*: +40 728 744 478
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

_CCSRL Romania Immigration & Relocation Services_`;

  console.log(`[WhatsApp] 📤 Dispatching Inquiry Acknowledgement to Client at ${phone}...`);
  return sendWhatsAppMessage(phone, message);
}

/**
 * 8. User Welcome -> Send to Client's WhatsApp on Registration
 */
export async function notifyUserWelcomeRegistration(userData = {}) {
  const phone = userData.phone || userData.foreignPhone || userData.romanianPhone || userData.whatsapp;
  if (!phone) return { success: false, error: 'User phone missing' };

  const name = `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.name || 'Valued Client';
  const userId = userData.userId || userData.id || '';
  const program = userData.visaType || 'Romania Immigration Standard';

  const message = 
`🏛️ *WELCOME TO CCSRL ROMANIA IMMIGRATION PLATFORM*

Dear *${name}*,

Welcome to the official legal portal of **CCSRL Romania**! Your client account has been successfully initialized.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🆔 *Lifetime User ID*: ${userId || 'Active'}
📋 *Registered Visa Track*: ${program}
🔐 *Access Dashboard*: http://localhost:3000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You can now log in to complete your Stage 01 document dossier submission, upload required affidavits, and track real-time immigration clearance milestones.

If you have any questions, feel free to reply directly to this official WhatsApp desk.

_CCSRL Romania Legal Bureau_
🌐 _Bucharest, Romania | Colombo, Sri Lanka_`;

  console.log(`[WhatsApp] 📤 Dispatching Welcome WhatsApp message to Client at ${phone}...`);
  return sendWhatsAppMessage(phone, message);
}

/**
 * 9. Stage Submission Receipt -> Send to Client's WhatsApp
 */
export async function notifyUserStageSubmission(submissionData = {}) {
  const phone = submissionData.userPhone || submissionData.phone || submissionData.foreignPhone || submissionData.romanianPhone || submissionData.whatsapp;
  if (!phone) return { success: false, error: 'User phone missing' };

  const name = submissionData.userName || submissionData.clientName || 'Valued Client';
  const caseId = submissionData.caseId || 'Active Case';
  const userId = submissionData.userId || '';
  const stageNum = Number(submissionData.stageNumber || 1);
  const stageTitle = submissionData.stageTitle || `Stage 0${stageNum}`;
  const docNames = submissionData.documentsList || (Array.isArray(submissionData.documents) ? submissionData.documents.map(d => `• ${d.name || d.fileName || 'Document'}`).join('\n') : '• Statutory Submission Documents');
  const timeStr = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  const message = 
`🏛️ *CCSRL ROMANIA IMMIGRATION PLATFORM*
📥 *STAGE SUBMISSION RECEIPT & ACKNOWLEDGEMENT*

Dear *${name}*,

We have successfully received your submission for *Stage 0${stageNum}: ${stageTitle}*.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 *Case Reference*: ${caseId}
${userId ? `🆔 *User ID*: ${userId}\n` : ''}📑 *Milestone*: Stage 0${stageNum} – ${stageTitle}
⏰ *Submission Timestamp*: ${timeStr}

📄 *Received Documents*:
${docNames}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚖️ *Current Status*: Under Legal Review
Our European migration compliance team has initiated the verification of your submitted certificates. You will receive an instant notification as soon as verification is confirmed.

🔗 *Client Portal*: http://localhost:3000
_CCSRL Romania Legal & Immigration Bureau_`;

  console.log(`[WhatsApp] 📤 Dispatching Stage 0${stageNum} Submission Receipt to Client at ${phone}...`);
  return sendWhatsAppMessage(phone, message);
}

/**
 * 10. Embassy Fee Payment Slip -> Alert Admin WhatsApp (+40 728 744 478)
 */
export async function notifyAdminOnPaymentSlip(paymentData = {}) {
  const name = paymentData.clientName || 'Client';
  const caseId = paymentData.caseId || 'CASE-2026';
  const userId = paymentData.userId || '';
  const refNo = paymentData.referenceNo || 'TXN-PAID';
  const stageNum = paymentData.stageNumber || 6;
  const timeStr = new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  const message = 
`🏛️ *CCSRL ROMANIA IMMIGRATION PLATFORM*
💰 *NEW EMBASSY FEE PAYMENT SLIP SUBMITTED* 🧾

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *Applicant*: ${name}
📁 *Case ID*: ${caseId}
${userId ? `🆔 *User ID*: ${userId}\n` : ''}📑 *Stage*: Stage 0${stageNum} – Embassy Certification Fees
💳 *Transaction Reference*: *${refNo}*
⏰ *Submission Date*: ${timeStr}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚖️ *Required Action*:
Please review the uploaded bank transfer slip / card receipt in Admin CRM Customer 360 and confirm payment approval to unlock consular appointments.

🔗 *Admin Customer 360*: http://localhost:3000
_CCSRL Romania Financial & Legal Directorate_`;

  console.log(`[WhatsApp] 📢 Dispatching Payment Slip Alert for ${name} (${caseId}) to Admin...`);
  return sendWhatsAppMessage(ADMIN_PHONE, message);
}

/**
 * 11. Embassy Fee Payment Slip Receipt -> Send to Client's WhatsApp
 */
export async function notifyUserOnPaymentSlip(paymentData = {}) {
  const phone = paymentData.phone || paymentData.foreignPhone || paymentData.userPhone;
  if (!phone) return { success: false, error: 'User phone missing' };

  const name = paymentData.clientName || 'Valued Client';
  const caseId = paymentData.caseId || 'CASE-2026';
  const refNo = paymentData.referenceNo || 'TXN-PAID';
  const stageNum = paymentData.stageNumber || 6;

  const message = 
`🏛️ *CCSRL ROMANIA IMMIGRATION PLATFORM*
🧾 *PAYMENT RECEIPT ACKNOWLEDGEMENT*

Dear *${name}*,

Your Embassy Certification Fee payment receipt for *Stage 0${stageNum}* has been received.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📁 *Case ID*: ${caseId}
💳 *Transaction Reference*: *${refNo}*
📋 *Status*: Pending Financial & Legal Verification
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Our billing and legal counsel desk is confirming the transaction with the consular authority. Once verified, Stage 07 superlegalization directives will be unlocked immediately.

🔗 *Client Portal*: http://localhost:3000
_CCSRL Romania Legal Bureau_`;

  console.log(`[WhatsApp] 📤 Dispatching Payment Slip Acknowledgement to Client at ${phone}...`);
  return sendWhatsAppMessage(phone, message);
}

/**
 * 12. Case Message / Chat -> Alert Admin WhatsApp
 */
export async function notifyAdminOnClientMessage(msgData = {}) {
  const name = msgData.clientName || 'Client';
  const caseId = msgData.caseId || 'CASE-2026';
  const text = msgData.text || '';
  const subject = msgData.subject || 'Case Support Inquiry';

  const message = 
`🏛️ *CCSRL ROMANIA IMMIGRATION PLATFORM*
💬 *NEW CLIENT CASE MESSAGE RECEIVED* 📩

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *Client*: ${name}
📁 *Case Reference*: ${caseId}
📌 *Subject*: ${subject}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📝 *Message*:
"${text}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔗 *Reply via Admin Messages Hub*: http://localhost:3000
_CCSRL Legal Consultation Desk_`;

  return sendWhatsAppMessage(ADMIN_PHONE, message);
}

/**
 * 13. Case Message Reply -> Send to Client's WhatsApp
 */
export async function notifyUserOnAdminMessage(msgData = {}) {
  const phone = msgData.phone || msgData.foreignPhone || msgData.userPhone;
  if (!phone) return { success: false, error: 'User phone missing' };

  const name = msgData.clientName || 'Valued Client';
  const text = msgData.text || '';
  const sender = msgData.senderName || 'Elena Radu (Senior Legal Counsel)';

  const message = 
`🏛️ *CCSRL ROMANIA IMMIGRATION PLATFORM*
⚖️ *MESSAGE FROM YOUR LEGAL COUNSEL* 📜

Dear *${name}*,

You have received an official legal message regarding your Romanian immigration dossier from *${sender}*:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"${text}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You can reply directly in your Client Portal or respond to this WhatsApp desk.

🔗 *Client Portal*: http://localhost:3000
_CCSRL Romania Legal Bureau_`;

  return sendWhatsAppMessage(phone, message);
}

/**
 * 14. Document Issued -> Send to Client's WhatsApp
 */
export async function notifyUserOnDocumentIssued(docData = {}) {
  const phone = docData.phone || docData.foreignPhone || docData.userPhone;
  if (!phone) return { success: false, error: 'User phone missing' };

  const name = docData.clientName || 'Valued Client';
  const docName = docData.docName || docData.fileName || 'Official Immigration Document';
  const stageNum = docData.stageNumber || 'General';
  const note = docData.note ? `\n📝 *Counsel Note*: "${docData.note}"` : '';

  const message = 
`🏛️ *CCSRL ROMANIA IMMIGRATION PLATFORM*
📑 *OFFICIAL DOCUMENT ISSUED FOR DOWNLOAD* 📥

Dear *${name}*,

An official legal document has been generated and uploaded to your case file for *Stage 0${stageNum}*:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📄 *Document*: *${docName}*${note}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Please log in to your Client Portal to download and review the official certified document.

🔗 *Download Document*: http://localhost:3000
_CCSRL Romania Legal Bureau_`;

  return sendWhatsAppMessage(phone, message);
}

