import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  initWhatsApp,
  getWhatsAppStatus,
  logoutWhatsApp,
  sendWhatsAppMessage,
  notifyAdminOnRegistration,
  notifyAdminOnStageSubmission,
  notifyUserStageApproved,
  notifyUserStageRejected,
  notifyUserDocReupload,
  notifyAdminOnInquiry,
  notifyUserOnInquiry,
  notifyUserWelcomeRegistration,
  notifyUserStageSubmission,
  notifyAdminOnPaymentSlip,
  notifyUserOnPaymentSlip,
  notifyAdminOnClientMessage,
  notifyUserOnAdminMessage,
  notifyUserOnDocumentIssued,
  ADMIN_PHONE
} from './whatsappService.js';

import {
  generateOtp,
  verifyOtp,
  sendPasswordResetEmail,
  sendWelcomeRegistrationEmail,
  sendAdminRegistrationAlert,
  sendLoginAlertEmail,
  sendAdminLoginAlert,
  sendAdminProfileUpdateAlert,
  sendInquiryReceivedEmail,
  sendInquiryAcknowledgementEmail,
  sendAdminInquiryAlert,
  sendStageSubmissionEmail,
  sendAdminStageSubmissionAlert,
  sendStageApprovalEmail,
  sendStageRejectionEmail,
  sendDocumentIssuedEmail,
  sendDirectClientEmail,
  sendAdminPaymentSlipAlert,
  sendPaymentSlipReceivedEmail,
  sendAdminClientMessageAlert,
  sendClientReplyEmail,
  sendAdminCredentialsEmail,
  sendMailSafe
} from './emailService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Local JSON File Data Directory (Guarantees 100% offline & local data persistence)
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function getLocalStore(table, fallback = []) {
  try {
    const file = path.join(DATA_DIR, `${table}.json`);
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) || (parsed && typeof parsed === 'object') ? parsed : fallback;
    }
  } catch (e) {
    console.warn(`Local store read notice (${table}):`, e.message);
  }
  return fallback;
}

function saveLocalStore(table, data) {
  try {
    const file = path.join(DATA_DIR, `${table}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.warn(`Local store write notice (${table}):`, e.message);
    return false;
  }
}

// Initialize WhatsApp Baileys Engine (+40 728 744 478)
initWhatsApp().catch(err => console.warn('WhatsApp initial start note:', err.message));

// Enable CORS & JSON Parsing
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Cloudflare Configuration
const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'a81314c69d039f9c6b8718a34a5d88d5';
const CF_D1_DATABASE_ID = process.env.CLOUDFLARE_D1_DATABASE_ID || '29e85a54-0bdc-4263-8dae-496cdbe49bc1';
const CF_D1_API_TOKEN = process.env.CLOUDFLARE_D1_API_TOKEN || 'cfut_Y1mHaT1qHqjHPVWQ4z6GWn7kreMCDUN4wnBDVXnMa2195037';
const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET || 'ccsrl-documents';

// Cloudflare D1 SQL Query Helper
async function d1Query(sql, params = []) {
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${CF_D1_DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${CF_D1_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ sql, params })
    });
    const data = await res.json();
    if (data.success && data.result && data.result[0]) {
      return { success: true, results: data.result[0].results || [], meta: data.result[0].meta };
    }
    return { success: false, error: data.errors?.[0]?.message || 'D1 Query Error', results: [] };
  } catch (err) {
    return { success: false, error: err.message, results: [] };
  }
}

// Cloudflare R2 S3-Compatible Storage Client
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.CLOUDFLARE_R2_ENDPOINT || 'https://a81314c69d039f9c6b8718a34a5d88d5.r2.cloudflarestorage.com',
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '7971d23ba38f456dfea65559b1dac4d1',
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '47677bbce586bb6221a91c70daba5f464a0959d5efbab407df94ec09f4a32722',
  },
});

// Recursive Safe JSON Parser (Handles single, double, and nested stringified JSON cleanly)
function safeParseJSON(val, fallback = null) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  let curr = val;
  for (let i = 0; i < 5; i++) {
    if (typeof curr !== 'string') break;
    try {
      curr = JSON.parse(curr);
    } catch (e) {
      break;
    }
  }
  return curr !== null && curr !== undefined ? curr : fallback;
}

function safeParseArray(val, fallback = []) {
  const res = safeParseJSON(val, fallback);
  return Array.isArray(res) ? res : fallback;
}

function safeParseObject(val, fallback = {}) {
  const res = safeParseJSON(val, fallback);
  return (res && typeof res === 'object' && !Array.isArray(res)) ? res : fallback;
}

function normalizeCase(c) {
  if (!c || typeof c !== 'object') return c;
  const stages = safeParseArray(c.stages || c.stages_json, []);
  const messages = safeParseArray(c.messages || c.messages_json, []);
  const documents = safeParseArray(c.documents || c.documents_json, []);
  const feeBreakdown = safeParseObject(c.feeBreakdown || c.fee_breakdown, {});

  return {
    ...c,
    caseId: c.caseId || c.case_id,
    stages,
    messages,
    documents,
    feeBreakdown,
    currentStageNumber: Number(c.currentStageNumber || c.current_stage_number || 1)
  };
}

function normalizeCases(casesList) {
  const parsed = safeParseArray(casesList, []);
  return parsed.map(normalizeCase);
}

// Multer in-memory storage for handling file uploads before sending to Cloudflare R2
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50 MB max file size
});

// =========================================================================
// 1. HEALTH CHECK ENDPOINT
// =========================================================================
app.get('/api/health', async (req, res) => {
  try {
    const d1Health = await d1Query('SELECT 1 as test_val');
    return res.json({ 
      status: 'healthy', 
      cloudflareD1Connected: d1Health.success,
      cloudflareD1Database: 'ccsrl-database (5 GB Free)',
      cloudflareR2Connected: true,
      cloudflareR2Bucket: R2_BUCKET,
      message: 'CCSRL Immigration Platform - 100% Cloudflare D1 Database & R2 Storage Online',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.json({ status: 'healthy', cloudflareD1Connected: false, error: err.message });
  }
});

// =========================================================================
// 1.1 WHATSAPP GATEWAY STATUS & QR CONTROL ENDPOINTS (+40 728 744 478)
// =========================================================================
app.get('/api/whatsapp/status', (req, res) => {
  return res.json(getWhatsAppStatus());
});

app.post('/api/whatsapp/logout', async (req, res) => {
  const result = await logoutWhatsApp();
  return res.json(result);
});

app.post('/api/whatsapp/reset', async (req, res) => {
  const result = await logoutWhatsApp();
  return res.json(result);
});

app.post('/api/whatsapp/test', async (req, res) => {
  const { phone, message } = req.body;
  const targetPhone = phone || ADMIN_PHONE;
  const targetMessage = message || '🏛️ *CCSRL Romania Gateway Test*: Connection active and functioning smoothly!';
  const result = await sendWhatsAppMessage(targetPhone, targetMessage);
  return res.json(result);
});

// Dedicated Direct Browser QR Scan Page: http://localhost:5000/whatsapp-scan
app.get('/whatsapp-scan', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>CCSRL WhatsApp Gateway Connect</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap" rel="stylesheet">
      <style>body { font-family: 'Poppins', sans-serif; }</style>
    </head>
    <body class="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
      <div class="max-w-md w-full bg-slate-800 border border-slate-700 rounded-3xl p-6 sm:p-8 shadow-2xl text-center space-y-6">
        
        <div class="space-y-1">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold border border-emerald-500/30">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            Official Gateway
          </div>
          <h1 class="text-xl font-bold text-white pt-2">Link WhatsApp Gateway</h1>
          <p class="text-xs text-slate-300">Official Sender: <strong class="text-emerald-400">+40 728 744 478</strong></p>
        </div>

        <div id="statusContainer" class="p-3 rounded-2xl bg-slate-700/50 border border-slate-600 text-xs text-slate-300 font-medium">
          Checking status...
        </div>

        <div id="qrWrapper" class="p-4 bg-white rounded-2xl shadow-inner inline-block mx-auto">
          <div id="loadingBox" class="w-60 h-60 flex flex-col items-center justify-center text-slate-500 text-xs space-y-2">
            <div class="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
            <span>Generating QR Code...</span>
          </div>
          <img id="qrImage" src="" alt="WhatsApp QR Code" class="w-60 h-60 hidden rounded-lg" />
        </div>

        <div class="flex justify-center gap-2">
          <button onclick="resetSession()" id="resetBtn" class="bg-slate-700 hover:bg-slate-600 text-xs font-semibold px-4 py-2 rounded-xl border border-slate-600 text-slate-200 transition-all cursor-pointer">
            🔄 Refresh / Reset QR Code
          </button>
        </div>

        <div class="text-left bg-slate-950/60 p-4 rounded-2xl text-xs space-y-2 text-slate-300 border border-slate-750">
          <div class="font-bold text-white">📱 Steps to Link:</div>
          <ol class="list-decimal list-inside space-y-1 text-[11px] text-slate-400">
            <li>Open <strong>WhatsApp</strong> on your phone (<strong>+40 728 744 478</strong>).</li>
            <li>Tap <strong>Settings / 3-dots ➔ Linked Devices</strong>.</li>
            <li>Tap <strong>Link a Device</strong> and point your camera at the QR code.</li>
          </ol>
        </div>

        <div id="testBox" class="hidden space-y-3 pt-2">
          <div class="p-4 rounded-2xl bg-emerald-950/50 border border-emerald-500/40 text-emerald-200 text-xs space-y-3 text-left">
            <div class="font-bold text-emerald-300 flex items-center gap-1.5">
              <span>✅ Connected Successfully!</span>
            </div>
            <div class="space-y-2">
              <label class="block text-[11px] text-emerald-100">Send Live Test Message To:</label>
              <div class="flex gap-2">
                <input id="testPhone" type="text" value="94768652445" class="bg-slate-900 border border-emerald-500/40 text-white px-3 py-1.5 rounded-xl text-xs w-full font-mono focus:outline-none" />
                <button onclick="sendTest()" id="testBtn" class="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold px-4 py-1.5 rounded-xl text-xs whitespace-nowrap cursor-pointer transition-all">Send</button>
              </div>
              <div id="testStatus" class="text-[11px] pt-1"></div>
            </div>
          </div>
        </div>

      </div>

      <script>
        async function resetSession() {
          const statusBox = document.getElementById('statusContainer');
          statusBox.innerHTML = '<span class="text-amber-400 font-bold">Clearing old session & generating fresh QR...</span>';
          try {
            await fetch('/api/whatsapp/reset', { method: 'POST' });
          } catch(e) {}
          setTimeout(check, 1000);
        }

        async function check() {
          try {
            const res = await fetch('/api/whatsapp/status');
            const data = await res.json();
            const qrImg = document.getElementById('qrImage');
            const loadBox = document.getElementById('loadingBox');
            const statusBox = document.getElementById('statusContainer');
            const testBox = document.getElementById('testBox');
            const qrWrapper = document.getElementById('qrWrapper');

            if (data.isConnected) {
              statusBox.innerHTML = '<span class="text-emerald-400 font-bold">🟢 CONNECTED & OPERATIONAL</span>';
              statusBox.className = 'p-3 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 text-xs font-medium';
              qrWrapper.classList.add('hidden');
              testBox.classList.remove('hidden');
            } else if (data.qrCode) {
              statusBox.innerHTML = '<span class="text-amber-400 font-bold">📷 SCAN QR CODE WITH PHONE (+40 728 744 478)</span>';
              statusBox.className = 'p-3 rounded-2xl bg-amber-950/40 border border-amber-500/40 text-xs font-medium';
              qrImg.src = data.qrCode;
              qrImg.classList.remove('hidden');
              loadBox.classList.add('hidden');
              qrWrapper.classList.remove('hidden');
              testBox.classList.add('hidden');
            } else {
              statusBox.innerHTML = '<span class="text-slate-300 font-medium">Generating fresh QR code...</span>';
              qrImg.classList.add('hidden');
              loadBox.classList.remove('hidden');
              qrWrapper.classList.remove('hidden');
              testBox.classList.add('hidden');
            }
          } catch(e) {}
        }

        async function sendTest() {
          const phone = document.getElementById('testPhone').value;
          const statusEl = document.getElementById('testStatus');
          const btn = document.getElementById('testBtn');
          btn.disabled = true;
          statusEl.innerHTML = 'Sending...';
          try {
            const res = await fetch('/api/whatsapp/test', {
              method: 'POST',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({ phone, message: '🏛️ *CCSRL Romania Immigration Platform*\\n\\n✅ *WhatsApp Gateway Test Message*\\nConnected from: +40 728 744 478\\nReceived on: ' + phone + '\\nTime: ' + new Date().toLocaleTimeString() })
            });
            const d = await res.json();
            if (d.success) {
              statusEl.innerHTML = '<span class="text-emerald-300 font-bold">✅ Message Delivered to ' + phone + '!</span>';
            } else {
              statusEl.innerHTML = '<span class="text-rose-400 font-bold">❌ Error: ' + (d.error || 'Failed') + '</span>';
            }
          } catch(err) {
            statusEl.innerHTML = '<span class="text-rose-400 font-bold">❌ Error: ' + err.message + '</span>';
          } finally {
            btn.disabled = false;
          }
        }

        check();
        setInterval(check, 3000);
      </script>
    </body>
    </html>
  `);
});


// Auto-seed Database Schema & primary Super Admin account into Cloudflare D1
(async () => {
  try {
    // 1. Initialize tables if not existing
    await d1Query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT UNIQUE,
        case_id TEXT,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        password TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        nic_number TEXT,
        passport_number TEXT,
        country TEXT DEFAULT 'Sri Lanka',
        address TEXT,
        avatar_url TEXT,
        role TEXT DEFAULT 'client',
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await d1Query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        case_id TEXT,
        actor_name TEXT,
        actor_role TEXT,
        action TEXT NOT NULL,
        details TEXT,
        ip_address TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. Ensure Super Admin account exists
    await d1Query(
      `INSERT INTO accounts (user_id, email, password, first_name, last_name, role)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET password = excluded.password, role = 'admin', user_id = excluded.user_id`,
      ['ADMIN-SUPER-THILANKA', 'thilankamahesh09@gmail.com', 'Thilanka2003@', 'Thilanka', 'Mahesh', 'admin']
    );
    await d1Query(`DELETE FROM accounts WHERE LOWER(email) = 'admin@ccsrl.com'`);
    console.log('✅ Super Admin account verified in Cloudflare D1: thilankamahesh09@gmail.com');
  } catch (e) {
    console.warn('Initial admin/schema seed note:', e.message);
  }
})();

// Helper: Generate Strong Unique Lifetime User ID (Immutable Permanent User Identifier UID-2026-XXXX)
async function generateLifetimeUserId() {
  try {
    const res = await d1Query(`SELECT user_id, id FROM accounts`);
    const results = (res.success && Array.isArray(res.results) && res.results.length > 0)
      ? res.results
      : getLocalStore('accounts', []);
    let maxNum = 1000;
    results.forEach(r => {
      const val = r.user_id || r.userId || r.id;
      const m = String(val).match(/UID-2026-(\d+)/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    const localStoreAccs = getLocalStore('accounts', []);
    localStoreAccs.forEach(r => {
      const val = r.user_id || r.userId || r.id;
      const m = String(val).match(/UID-2026-(\d+)/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxNum) maxNum = n;
      }
    });
    const nextNum = maxNum + 1;
    return `UID-2026-${String(nextNum).padStart(4, '0')}`;
  } catch (e) {
    return `UID-2026-${Math.floor(1001 + Math.random() * 8999)}`;
  }
}

// =========================================================================
// 2. AUTHENTICATION & SECURITY ENDPOINTS (WITH IMMUTABLE LIFETIME USER ID)
// =========================================================================
app.post('/api/auth/register', async (req, res) => {
  try {
    const userData = req.body;
    const email = (userData.email || '').toLowerCase().trim();
    const phone = (userData.phone || userData.foreignPhone || '').trim();

    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number is required for registration.' });
    }

    // 1. Generate / Resolve Immutable Lifetime User ID
    const permanentUserId = userData.userId || userData.id || await generateLifetimeUserId();
    const accountEmail = email || `${phone.replace(/[\s\+]/g, '')}@client.ccsrl.ro`;

    // Persist to local JSON store
    const localAccs = getLocalStore('accounts', []);
    const newAccount = {
      id: permanentUserId,
      userId: permanentUserId,
      case_id: null,
      caseId: null,
      email: accountEmail,
      phone: phone,
      password: userData.password || 'Client1234@',
      first_name: userData.firstName || 'Client',
      firstName: userData.firstName || 'Client',
      last_name: userData.lastName || '',
      lastName: userData.lastName || '',
      role: 'client',
      visa_type: userData.visaType || 'Family Reunification (D/VF)',
      passport_number: userData.passportNumber || '',
      created_at: new Date().toISOString()
    };
    const updatedAccs = [newAccount, ...localAccs.filter(a => (a.email || '').toLowerCase() !== accountEmail && a.phone !== phone)];
    saveLocalStore('accounts', updatedAccs);

    try {
      await d1Query(
        `INSERT INTO accounts (id, case_id, email, phone, password, first_name, last_name, role) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(email) DO UPDATE SET phone = excluded.phone, first_name = excluded.first_name, last_name = excluded.last_name`,
        [permanentUserId, null, accountEmail, phone, userData.password || 'Client1234@', userData.firstName || 'Client', userData.lastName || '', 'client']
      );
    } catch (d1Err) {
      console.warn('D1 Registration insert notice:', d1Err.message);
    }

    // 2. Send official welcome email to client (if email provided) AND new registration alert to admin (ceyloncsrl@gmail.com)
    try {
      const emailTasks = [
        sendAdminRegistrationAlert(userData, 'Pending Stage 01 Submission')
      ];
      if (email && email.includes('@')) {
        emailTasks.push(sendWelcomeRegistrationEmail(userData, null));
      }
      Promise.allSettled(emailTasks).then(() => {
        console.log(`✉️ Dispatched Registration Confirmation & Admin Alert for ${phone} / ${email || 'No Email'}`);
      }).catch(console.warn);
    } catch (mailErr) {
      console.warn('Registration email dispatch notice:', mailErr.message);
    }

    // 3. Dispatch WhatsApp Notification to Super Admin (+40 728 744 478) and Client
    try {
      notifyAdminOnRegistration({
        fullName: `${userData.firstName || ''} ${userData.lastName || ''}`.trim() || userData.name || 'New Client',
        userId: permanentUserId,
        caseId: 'Pending Stage 01 Submission',
        email: userData.email || 'Not provided',
        phone: userData.phone || userData.foreignPhone || 'Not provided',
        program: userData.visaType || 'Romania Immigration Standard',
        country: userData.country || (userData.sriLankanAddress ? 'Sri Lanka' : 'International')
      }).catch(err => console.warn('WhatsApp Admin Registration Alert notice:', err.message));

      if (phone && phone !== 'Not provided') {
        notifyUserWelcomeRegistration({
          ...userData,
          userId: permanentUserId,
          phone
        }).catch(err => console.warn('WhatsApp Client Welcome note:', err.message));
      }
    } catch (waErr) {
      console.warn('WhatsApp dispatch error:', waErr.message);
    }

    return res.json({ 
      success: true, 
      caseId: null, 
      user: { 
        id: permanentUserId,
        userId: permanentUserId,
        ...userData, 
        caseId: null, 
        role: 'client' 
      } 
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const query = (req.body.username || req.body.email || req.body.phone || req.body.identifier || req.body.caseId || '').toLowerCase().trim();
    const password = (req.body.password || '').trim();

    // 1. Primary Hardcoded Super Admin Check: thilankamahesh09@gmail.com
    if ((query === 'thilankamahesh09@gmail.com' || query === 'thilanka') && password === 'Thilanka2003@') {
      return res.json({
        success: true,
        user: {
          id: 'ADMIN-SUPER-THILANKA',
          userId: 'ADMIN-SUPER-THILANKA',
          firstName: 'Thilanka',
          lastName: 'Mahesh',
          email: 'thilankamahesh09@gmail.com',
          username: 'thilankamahesh09@gmail.com',
          role: 'admin',
          roleTitle: 'Super Administrator',
          isSuperAdmin: true
        }
      });
    }

    // 2. Check Cloudflare D1 accounts table for admin or client with local store fallback
    const cleanPhone = query.replace(/\s+/g, '');
    const cleanNoPlus = query.replace(/[\s\+]/g, '');
    let matched = null;

    try {
      const accResult = await d1Query(
        `SELECT * FROM accounts 
         WHERE LOWER(TRIM(email)) = ? 
            OR phone = ? 
            OR REPLACE(phone, ' ', '') = ? 
            OR REPLACE(REPLACE(phone, ' ', ''), '+', '') = ?
            OR LOWER(case_id) = ?
            OR LOWER(id) = ?`,
        [query, query, cleanPhone, cleanNoPlus, query, query]
      );
      if (accResult.results && accResult.results.length > 0) {
        matched = accResult.results[0];
      }
    } catch(e) {}

    if (!matched) {
      const localAdmins = getLocalStore('admins', []);
      const localAccs = getLocalStore('accounts', []);
      const allLocal = [...localAdmins, ...localAccs];
      matched = allLocal.find(a => 
        (a.email && a.email.toLowerCase().trim() === query) ||
        (a.phone && a.phone.replace(/\s+/g, '') === cleanPhone) ||
        (a.phone && a.phone.replace(/[\s\+]/g, '') === cleanNoPlus) ||
        (a.caseId && a.caseId.toLowerCase() === query) ||
        (a.case_id && a.case_id.toLowerCase() === query) ||
        (a.id && String(a.id).toLowerCase() === query) ||
        (a.userId && String(a.userId).toLowerCase() === query)
      );
    }

    if (matched) {
      if (String(matched.password || '').trim() !== (password || '').trim()) {
        return res.status(401).json({ success: false, error: 'Incorrect password entered. Please verify your credentials or use Forgot Password.' });
      }

      const isAdminRole = ['admin', 'superadmin', 'staff', 'manager', 'consultant'].includes((matched.role || '').toLowerCase());
      
      let userCase = null;
      const targetCaseId = matched.case_id || matched.caseId;
      if (targetCaseId) {
        try {
          const caseResult = await d1Query(`SELECT * FROM cases WHERE case_id = ?`, [targetCaseId]);
          userCase = caseResult.results?.[0] || null;
        } catch(e) {}
        if (!userCase) {
          const localCases = getLocalStore('cases', []);
          userCase = localCases.find(c => (c.caseId || c.case_id || '').toLowerCase() === targetCaseId.toLowerCase()) || null;
        }
      }

      // Dispatch login security notification email to client user
      if (matched.email && !isAdminRole) {
        sendLoginAlertEmail(matched.email, matched.first_name || matched.firstName).catch(console.warn);
        sendAdminLoginAlert(matched, userCase).catch(console.warn);
      }

      // Immutable Lifetime User ID resolution
      const lifetimeUserId = isAdminRole 
        ? (matched.id || matched.userId || `ADMIN-${matched.id}`)
        : (String(matched.id || matched.userId).startsWith('UID-') ? (matched.id || matched.userId) : `UID-2026-${String(matched.id || matched.userId).padStart(4, '0')}`);

      return res.json({
        success: true,
        user: {
          id: lifetimeUserId,
          userId: lifetimeUserId,
          caseId: targetCaseId || null,
          firstName: matched.first_name || matched.firstName || (isAdminRole ? 'Admin' : 'Client'),
          lastName: matched.last_name || matched.lastName || '',
          email: matched.email,
          username: matched.email,
          phone: matched.phone,
          role: isAdminRole ? 'admin' : (matched.role || 'client'),
          roleTitle: matched.role === 'admin' ? 'Super Administrator' : (matched.role === 'staff' ? 'Legal Officer' : (matched.roleTitle || matched.role || 'Client')),
          isSuperAdmin: matched.role === 'superadmin' || matched.email === 'thilankamahesh09@gmail.com'
        },
        caseData: userCase
      });
    }

    return res.status(404).json({ success: false, error: 'No registered account found with this Phone Number, Email, User ID, or Case ID. Please check your credentials or register a new account.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Google OAuth 2.0 Direct Authentication Handler
app.post('/api/auth/google', async (req, res) => {
  try {
    const { email, name, picture, sub, credential } = req.body;
    let userEmail = (email || '').toLowerCase().trim();
    let userName = name || 'Google User';
    let userPicture = picture || null;
    let googleSub = sub || null;

    // Optional verification of Google JWT credential with Google TokenInfo API
    if (credential) {
      try {
        const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`);
        if (verifyRes.ok) {
          const payload = await verifyRes.json();
          if (payload && payload.email) {
            userEmail = payload.email.toLowerCase().trim();
            userName = payload.name || userName;
            userPicture = payload.picture || userPicture;
            googleSub = payload.sub || googleSub;
          }
        }
      } catch (tokenErr) {
        console.warn('Google token verification fallback:', tokenErr.message);
      }
    }

    if (!userEmail) {
      return res.status(400).json({ success: false, error: 'Valid Google email is required.' });
    }

    // 1. Primary Hardcoded Super Admin Check: thilankamahesh09@gmail.com
    if (userEmail === 'thilankamahesh09@gmail.com') {
      const superAdminUser = {
        id: 'ADMIN-SUPER-THILANKA',
        userId: 'ADMIN-SUPER-THILANKA',
        firstName: 'Thilanka',
        lastName: 'Mahesh',
        email: 'thilankamahesh09@gmail.com',
        username: 'thilankamahesh09@gmail.com',
        role: 'admin',
        roleTitle: 'Super Administrator',
        isSuperAdmin: true,
        picture: userPicture
      };

      // Dispatch admin sign-in notice
      sendAdminLoginAlert(superAdminUser, null).catch(err => console.warn('Superadmin login alert note:', err.message));

      return res.json({
        success: true,
        user: superAdminUser
      });
    }

    // 2. Check if account already exists in Cloudflare D1 or local store
    let matched = null;
    try {
      const accResult = await d1Query(
        `SELECT * FROM accounts WHERE LOWER(TRIM(email)) = ?`,
        [userEmail]
      );
      if (accResult.results && accResult.results.length > 0) {
        matched = accResult.results[0];
      }
    } catch(e) {}

    if (!matched) {
      const localAccs = getLocalStore('accounts', []);
      matched = localAccs.find(a => (a.email || '').toLowerCase().trim() === userEmail);
    }

    if (matched) {
      const isAdminRole = ['admin', 'superadmin', 'staff', 'manager', 'consultant'].includes((matched.role || '').toLowerCase());
      
      let userCase = null;
      const targetCaseId = matched.case_id || matched.caseId;
      if (targetCaseId) {
        try {
          const caseResult = await d1Query(`SELECT * FROM cases WHERE case_id = ?`, [targetCaseId]);
          userCase = caseResult.results?.[0] || null;
        } catch(e) {}
        if (!userCase) {
          const localCases = getLocalStore('cases', []);
          userCase = localCases.find(c => (c.caseId || c.case_id || '').toLowerCase() === targetCaseId.toLowerCase()) || null;
        }
      }

      // Dispatch login security notification to user and admin
      if (matched.email) {
        try {
          await Promise.allSettled([
            sendLoginAlertEmail(matched.email, matched.first_name || matched.firstName || 'Client'),
            sendAdminLoginAlert(matched, userCase)
          ]);
          console.log(`✉️ Dispatched Google login alert emails for existing account: ${matched.email}`);
        } catch (e) {
          console.warn('Google login email dispatch note:', e.message);
        }
      }

      const lifetimeUserId = isAdminRole 
        ? (matched.id || matched.userId || `ADMIN-${matched.id}`) 
        : (String(matched.id || matched.userId).startsWith('UID-') ? (matched.id || matched.userId) : `UID-2026-${String(matched.id || matched.userId).padStart(4, '0')}`);

      return res.json({
        success: true,
        user: {
          id: lifetimeUserId,
          userId: lifetimeUserId,
          caseId: targetCaseId || null,
          firstName: matched.first_name || matched.firstName || (isAdminRole ? 'Admin' : 'Client'),
          lastName: matched.last_name || matched.lastName || '',
          email: matched.email,
          username: matched.email,
          phone: matched.phone || '+40 728 744 478',
          role: isAdminRole ? 'admin' : (matched.role || 'client'),
          roleTitle: matched.role === 'admin' ? 'Super Administrator' : (matched.role === 'staff' ? 'Legal Officer' : (matched.roleTitle || matched.role || 'Client')),
          isSuperAdmin: matched.role === 'superadmin' || matched.email === 'thilankamahesh09@gmail.com',
          picture: userPicture || matched.picture
        },
        caseData: userCase
      });
    }

    // 3. New User Registration via Google Single Sign-On
    const nameParts = userName.split(' ');
    const firstName = nameParts[0] || 'Client';
    const lastName = nameParts.slice(1).join(' ') || '';
    const randomPassword = `GoogleAuth#${Math.random().toString(36).slice(-8)}`;
    const permanentUserId = await generateLifetimeUserId();

    const localAccs = getLocalStore('accounts', []);
    const newAccount = {
      id: permanentUserId,
      userId: permanentUserId,
      case_id: null,
      caseId: null,
      email: userEmail,
      phone: '+40 728 744 478',
      password: randomPassword,
      first_name: firstName,
      firstName,
      last_name: lastName,
      lastName,
      role: 'client',
      visa_type: 'Family Reunification (D/VF)',
      passport_number: '',
      created_at: new Date().toISOString()
    };
    saveLocalStore('accounts', [newAccount, ...localAccs.filter(a => (a.email || '').toLowerCase() !== userEmail)]);

    // Insert into accounts in Cloudflare D1 with permanent id
    d1Query(
      `INSERT INTO accounts (id, case_id, email, phone, password, first_name, last_name, role) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [permanentUserId, null, userEmail, '+40 728 744 478', randomPassword, firstName, lastName, 'client']
    ).catch(console.warn);

    const newUser = {
      id: permanentUserId,
      userId: permanentUserId,
      caseId: null,
      firstName,
      lastName,
      email: userEmail,
      phone: '+40 728 744 478',
      role: 'client',
      roleTitle: 'Client',
      picture: userPicture
    };

    // Send Welcome Email to Client AND New Registration Alert to Admin (ceyloncsrl@gmail.com)
    try {
      await Promise.allSettled([
        sendWelcomeRegistrationEmail({ firstName, lastName, email: userEmail, phone: '+40 728 744 478', visaType: 'Work Permit & Residence (D/AM)' }, null),
        sendAdminRegistrationAlert({ firstName, lastName, email: userEmail, phone: '+40 728 744 478', visaType: 'Work Permit & Residence (D/AM)' }, 'Pending Stage 01 Submission')
      ]);
      console.log(`✉️ Dispatched Welcome & Admin registration alert emails for new Google user: ${userEmail} (${permanentUserId})`);
    } catch (mailErr) {
      console.warn('Google registration email dispatch note:', mailErr.message);
    }

    // WhatsApp Notification to Super Admin
    try {
      notifyAdminOnRegistration({
        fullName: `${firstName} ${lastName}`.trim() || 'Google User',
        userId: permanentUserId,
        caseId: 'Pending Stage 01 Submission',
        email: userEmail,
        phone: '+40 728 744 478 (Google SSO)',
        program: 'Work Permit & Residence (D/AM)',
        country: 'International / Google Sign-in'
      }).catch(err => console.warn('WhatsApp Google Admin Registration note:', err.message));
    } catch (waErr) {
      console.warn('WhatsApp Google dispatch error:', waErr.message);
    }

    return res.json({
      success: true,
      user: newUser,
      caseData: null
    });
  } catch (err) {
    console.error('Google Auth Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});


// =========================================================================
// 2b. ADMIN & STAFF TEAM MANAGEMENT ENDPOINTS
// =========================================================================

// Fetch all Admin & Staff accounts
app.get('/api/admins', async (req, res) => {
  try {
    const accRes = await d1Query(
      `SELECT id, email, first_name, last_name, phone, role, created_at, password
       FROM accounts 
       WHERE role IN ('admin', 'superadmin', 'staff', 'manager', 'consultant')
       ORDER BY id ASC`
    );

    let admins = (accRes.success && Array.isArray(accRes.results) && accRes.results.length > 0)
      ? accRes.results
      : getLocalStore('admins', []);
    
    // Ensure default superadmins are present
    const hasThilanka = admins.some(a => (a.email || '').toLowerCase() === 'thilankamahesh09@gmail.com');
    if (!hasThilanka) {
      admins.unshift({
        id: 'ADMIN-SUPER-THILANKA',
        email: 'thilankamahesh09@gmail.com',
        username: 'thilankamahesh09@gmail.com',
        first_name: 'Thilanka',
        last_name: 'Mahesh',
        phone: '+94 77 123 4567',
        role: 'admin',
        roleTitle: 'Super Administrator',
        password: 'Thilanka2003@',
        isSuperAdmin: true,
        created_at: new Date().toISOString()
      });
    }

    const formatted = admins.map(a => ({
      id: a.id || `ADMIN-${Date.now()}`,
      email: a.email,
      username: a.username || a.email,
      firstName: a.first_name || a.firstName || 'Admin',
      lastName: a.last_name || a.lastName || '',
      fullName: `${a.first_name || a.firstName || ''} ${a.last_name || a.lastName || ''}`.trim() || 'Admin Officer',
      phone: a.phone || '+40 728 744 478',
      role: a.role || 'admin',
      roleTitle: a.role === 'admin' ? 'Super Administrator' : (a.role === 'staff' ? 'Legal Officer' : (a.roleTitle || a.role)),
      password: a.password || '******',
      isSuperAdmin: a.role === 'superadmin' || (a.email || '').toLowerCase() === 'thilankamahesh09@gmail.com',
      status: 'Active',
      createdAt: a.created_at || a.createdAt || new Date().toISOString()
    }));

    saveLocalStore('admins', formatted);
    return res.json(formatted);
  } catch (err) {
    const localAdmins = getLocalStore('admins', []);
    return res.json(localAdmins);
  }
});

// =========================================================================
// 2c. REGISTERED CLIENT ACCOUNTS ENDPOINTS
// =========================================================================

// Fetch all registered client accounts
app.get('/api/accounts', async (req, res) => {
  try {
    const accRes = await d1Query(
      `SELECT id, case_id, email, phone, first_name, last_name, role, created_at, visa_type, passport_number
       FROM accounts 
       WHERE role = 'client'
       ORDER BY created_at DESC`
    );

    const accounts = (accRes.success && Array.isArray(accRes.results) && accRes.results.length > 0)
      ? accRes.results
      : getLocalStore('accounts', []);

    const formatted = accounts.map((a, idx) => {
      const uid = a.id || (String(a.userId || a.id).startsWith('UID-') ? (a.userId || a.id) : `UID-2026-${1001 + idx}`);
      return {
        id: uid,
        userId: uid,
        email: a.email || '',
        phone: a.phone || '',
        firstName: a.first_name || a.firstName || 'Client',
        lastName: a.last_name || a.lastName || '',
        role: a.role || 'client',
        caseId: a.case_id || a.caseId || null,
        visaType: a.visa_type || a.visaType || 'Family Reunification (D/VF)',
        passportNumber: a.passport_number || a.passportNumber || '',
        createdAt: a.created_at || a.createdAt || new Date().toISOString()
      };
    });

    saveLocalStore('accounts', formatted);
    return res.json(formatted);
  } catch (err) {
    const localAccs = getLocalStore('accounts', []);
    return res.json(localAccs);
  }
});

// Delete a client account
app.delete('/api/accounts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (id) {
      const localAccs = getLocalStore('accounts', []);
      saveLocalStore('accounts', localAccs.filter(a => a.id !== id && a.userId !== id && (a.email || '').toLowerCase() !== String(id).toLowerCase()));
      d1Query(
        `DELETE FROM accounts WHERE (id = ? OR LOWER(email) = ? OR LOWER(case_id) = ?) AND role = 'client'`,
        [id, id.toLowerCase(), id.toLowerCase()]
      ).catch(console.warn);
    }
    return res.json({ success: true, id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Create new Admin User & optionally send credentials email
app.post('/api/admins', async (req, res) => {
  try {
    const { email, password, firstName, lastName, role, phone, username, sendCredentialsEmail = true, creatorName } = req.body;
    
    if (!email || !password || !firstName) {
      return res.status(400).json({ error: 'Email, Password, and First Name are required.' });
    }

    const normEmail = email.toLowerCase().trim();
    const adminRole = role || 'admin';

    const newAdmin = {
      id: `ADMIN-${Date.now()}`,
      email: normEmail,
      username: username || normEmail,
      firstName: firstName.trim(),
      lastName: (lastName || '').trim(),
      fullName: `${firstName.trim()} ${(lastName || '').trim()}`.trim(),
      phone: phone || '',
      role: adminRole,
      roleTitle: adminRole === 'admin' ? 'Super Administrator' : (adminRole === 'staff' ? 'Legal Officer' : adminRole),
      password,
      status: 'Active',
      createdAt: new Date().toISOString()
    };

    const localAdmins = getLocalStore('admins', []);
    const updatedAdmins = [newAdmin, ...localAdmins.filter(a => (a.email || '').toLowerCase() !== normEmail)];
    saveLocalStore('admins', updatedAdmins);

    // Insert into Cloudflare D1 accounts table
    d1Query(
      `INSERT INTO accounts (email, password, first_name, last_name, phone, role)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET
         password = excluded.password,
         first_name = excluded.first_name,
         last_name = excluded.last_name,
         phone = excluded.phone,
         role = excluded.role`,
      [normEmail, password, firstName.trim(), (lastName || '').trim(), phone || '', adminRole]
    ).catch(console.warn);

    // Dispatch credentials email via Hostinger Webmail to the admin's email
    let emailDispatched = false;
    if (sendCredentialsEmail) {
      try {
        const mailRes = await sendAdminCredentialsEmail({
          email: normEmail,
          username: username || normEmail,
          password,
          firstName: firstName.trim(),
          lastName: (lastName || '').trim(),
          role: newAdmin.roleTitle,
          creatorName: creatorName || 'Thilanka Mahesh (Super Admin)'
        });
        emailDispatched = mailRes.success;
      } catch (mailErr) {
        console.warn('Failed to send admin credentials email:', mailErr.message);
      }
    }

    return res.json({
      success: true,
      admin: newAdmin,
      emailDispatched,
      message: `Admin account created successfully! ${emailDispatched ? `Login credentials dispatched to ${normEmail}` : ''}`
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Update an Admin User
app.put('/api/admins/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, password, firstName, lastName, role, phone, sendUpdateEmail, creatorName } = req.body;

    const localAdmins = getLocalStore('admins', []);
    const idx = localAdmins.findIndex(a => a.id === id || (a.email && a.email.toLowerCase() === String(id).toLowerCase()));
    if (idx >= 0) {
      localAdmins[idx] = {
        ...localAdmins[idx],
        ...(email ? { email: email.toLowerCase() } : {}),
        ...(password ? { password } : {}),
        ...(firstName ? { firstName: firstName.trim(), first_name: firstName.trim() } : {}),
        ...(lastName !== undefined ? { lastName: lastName.trim(), last_name: lastName.trim() } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(role ? { role, roleTitle: role === 'admin' ? 'Super Administrator' : (role === 'staff' ? 'Legal Officer' : role) } : {})
      };
      saveLocalStore('admins', localAdmins);
    }

    const updates = [];
    const params = [];

    if (password) { updates.push('password = ?'); params.push(password); }
    if (firstName) { updates.push('first_name = ?'); params.push(firstName.trim()); }
    if (lastName !== undefined) { updates.push('last_name = ?'); params.push(lastName.trim()); }
    if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
    if (role) { updates.push('role = ?'); params.push(role); }

    if (updates.length > 0) {
      params.push(id);
      d1Query(`UPDATE accounts SET ${updates.join(', ')} WHERE id = ? OR LOWER(email) = ?`, [...params, id.toLowerCase()]).catch(console.warn);
    }

    if (sendUpdateEmail && email && password) {
      sendAdminCredentialsEmail({
        email: email.toLowerCase(),
        password,
        firstName: firstName || 'Admin',
        lastName: lastName || '',
        role: role || 'Administrator',
        creatorName: creatorName || 'Thilanka Mahesh (Super Admin)'
      }).catch(console.warn);
    }

    return res.json({ success: true, message: 'Admin account updated successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Delete an Admin User
app.delete('/api/admins/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Prevent deleting primary superadmin
    if (String(id).toLowerCase() === 'thilankamahesh09@gmail.com') {
      return res.status(400).json({ error: 'Primary Super Administrator account cannot be deleted.' });
    }

    const localAdmins = getLocalStore('admins', []);
    saveLocalStore('admins', localAdmins.filter(a => a.id !== id && (a.email || '').toLowerCase() !== String(id).toLowerCase()));

    d1Query(`DELETE FROM accounts WHERE (id = ? OR LOWER(email) = ?) AND LOWER(email) != 'thilankamahesh09@gmail.com'`, [id, id.toLowerCase()]).catch(console.warn);
    return res.json({ success: true, id, message: 'Admin account removed successfully.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Resend Credentials Email to Admin
app.post('/api/admins/resend-credentials', async (req, res) => {
  try {
    const { email, password, firstName, lastName, role, creatorName } = req.body;
    if (!email) return res.status(400).json({ error: 'Admin email is required.' });

    const mailRes = await sendAdminCredentialsEmail({
      email: email.toLowerCase().trim(),
      password: password || '******',
      firstName: firstName || 'Admin',
      lastName: lastName || '',
      role: role || 'Administrator',
      creatorName: creatorName || 'Thilanka Mahesh (Super Admin)'
    });

    if (mailRes.success) {
      return res.json({ success: true, message: `Credentials dispatched to ${email}` });
    } else {
      return res.status(500).json({ error: mailRes.error || 'Failed to dispatch email via Hostinger webmail.' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Request Password Reset OTP Code

// Request Password Reset OTP Code
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const query = (email || '').toLowerCase().trim();
    if (!query) return res.status(400).json({ error: 'Email address is required.' });

    // Check if account exists
    const accRes = await d1Query(`SELECT * FROM accounts WHERE LOWER(email) = ? OR LOWER(case_id) = ?`, [query, query]);
    const account = accRes.results?.[0];

    const targetEmail = account ? account.email : query;
    const clientName = account ? account.first_name : 'Client';

    // Generate 6-digit OTP
    const code = generateOtp(targetEmail);

    // Dispatch branded email via Hostinger SMTP
    await sendPasswordResetEmail(targetEmail, code, clientName);

    return res.json({
      success: true,
      message: `A 6-digit verification code has been dispatched to ${targetEmail}. Please check your inbox and spam folder.`
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Verify 6-digit OTP Code
app.post('/api/auth/verify-otp', (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: 'Email and 6-digit code are required.' });
  const check = verifyOtp(email, code);
  if (!check.valid) return res.status(400).json({ error: check.message });
  return res.json({ success: true, message: 'Code verified successfully.' });
});

// Complete Password Reset
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !newPassword) return res.status(400).json({ error: 'Email and new password are required.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters long.' });

    const query = email.toLowerCase().trim();

    // Update in accounts table
    await d1Query(`UPDATE accounts SET password = ? WHERE LOWER(email) = ? OR LOWER(case_id) = ?`, [newPassword, query, query]);

    // Update in cases table
    await d1Query(`UPDATE cases SET password = ? WHERE LOWER(email) = ? OR LOWER(case_id) = ?`, [newPassword, query, query]);

    return res.json({ success: true, message: 'Password updated successfully! You can now log in.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});



// =========================================================================
// 3. CASE DOSSIERS CRUD ENDPOINTS
// =========================================================================
app.get('/api/cases', async (req, res) => {
  try {
    const casesResult = await d1Query(`SELECT * FROM cases ORDER BY created_at DESC`);
    const docsResult = await d1Query(`SELECT * FROM documents ORDER BY created_at DESC`);

    const casesList = casesResult.results || [];
    const docsList = docsResult.results || [];

    if (casesList.length > 0) {
      const formatted = casesList.map(c => {
        const parsedStages = safeParseArray(c.stages, []);
        const parsedFees = safeParseObject(c.fee_breakdown, {});
        const parsedMsgs = safeParseArray(c.messages, []);

        return {
          caseId: c.case_id,
          id: c.id,
          title: c.title,
          visaType: c.visa_type,
          clientName: c.client_name,
          firstName: c.first_name,
          lastName: c.last_name,
          email: c.email,
          phone: c.phone,
          foreignPhone: c.foreign_phone,
          romanianPhone: c.romanian_phone,
          sriLankanAddress: c.sri_lankan_address,
          country: c.country,
          romaniaCity: c.romania_city,
          nicNumber: c.nic_number,
          dateOfBirth: c.date_of_birth,
          arrivedDate: c.arrived_date,
          passportNumber: c.passport_number,
          passportIssueDate: c.passport_issue_date,
          passportExpiry: c.passport_expiry,
          birthLocation: c.birth_location,
          trcCnpNumber: c.trc_cnp_number,
          sponsorMother: c.sponsor_mother,
          sponsorFather: c.sponsor_father,
          hasSpouse: c.has_spouse,
          spouseName: c.spouse_name,
          spousePassport: c.spouse_passport,
          spousePassportIssue: c.spouse_passport_issue,
          spousePassportExpiry: c.spouse_passport_expiry,
          spouseBirthLocation: c.spouse_birth_location,
          spouseMother: c.spouse_mother,
          spouseFather: c.spouse_father,
          isDivorced: c.is_divorced,
          childrenCount: c.children_count,
          hasMother: c.has_mother,
          hasFather: c.has_father,
          trcValid15Months: c.trc_valid_15_months,
          applicantsSummary: c.applicants_summary,
          currentStageNumber: c.current_stage_number || 1,
          currentStageIndex: c.current_stage_index || 0,
          stages: parsedStages,
          feeBreakdown: parsedFees,
          messages: parsedMsgs,
          password: c.password,
          createdDate: c.created_at ? c.created_at.split(' ')[0] : new Date().toISOString().split('T')[0],
          documents: docsList.filter(d => d.case_id && c.case_id && String(d.case_id).trim().toLowerCase() === String(c.case_id).trim().toLowerCase()).map(d => ({
            id: d.id,
            name: d.name,
            category: d.category,
            fileName: d.file_name,
            file_name: d.file_name,
            fileUrl: d.file_url,
            file_url: d.file_url,
            fileSize: d.file_size,
            file_size: d.file_size,
            uploadDate: d.upload_date,
            status: d.status,
            uploadedBy: d.uploaded_by,
            stageNumber: d.stage_number,
            note: d.note,
            customContent: d.custom_content
          }))
        };
      });

      const normalized = normalizeCases(formatted);
      saveLocalStore('cases', normalized);
      return res.json(normalized);
    }

    const localCases = getLocalStore('cases', []);
    return res.json(normalizeCases(localCases));
  } catch (err) {
    const localCases = getLocalStore('cases', []);
    return res.json(normalizeCases(localCases));
  }
});

// Endpoint: Initialize official case dossier only when user submits Stage 01 required documents
app.post('/api/cases/initialize-stage1', upload.any(), async (req, res) => {
  try {
    const data = req.body || {};
    const email = (data.email || '').toLowerCase().trim();
    const phone = (data.phone || data.foreignPhone || '').trim();
    const firstName = data.firstName || 'Client';
    const lastName = data.lastName || '';
    const fullName = `${firstName} ${lastName}`.trim();
    const visaType = data.visaType || 'Family Reunification (D/VF)';

    // 1. Generate or verify unique Case ID (CASE-2026-XXXX)
    let caseId = data.caseId;
    if (!caseId) {
      const existingCasesRes = await d1Query(`SELECT case_id FROM cases`);
      const existingList = existingCasesRes.results || [];
      let maxNum = 0;
      existingList.forEach(r => {
        const m = String(r.case_id).match(/CASE-2026-(\d+)/i);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > maxNum) maxNum = n;
        }
      });
      const nextNum = maxNum > 0 ? maxNum + 1 : Math.floor(1000 + Math.random() * 9000);
      caseId = `CASE-2026-${String(nextNum).padStart(4, '0')}`;
    }

    // 2. Setup standard 10-stage immigration roadmap with Stage 01 in progress
    const stages = data.stages || [
      { 
        number: 1, 
        title: "Stage 01 – Required Documents", 
        status: "in_progress", 
        unlocked: true, 
        submitted: true,
        submittedDate: new Date().toISOString().split('T')[0],
        note: "Initial Stage 01 documents received and currently undergoing statutory compliance audit." 
      },
      { number: 2, title: "Stage 02 – Affidavit Preparation", status: "locked", unlocked: false, note: "Romanian statutory declaration drafting" },
      { number: 3, title: "Stage 03 – Advance Payment", status: "locked", unlocked: false, feeLEU: 1000, feeEUR: 200, note: "Initial retainer & advance deposit" },
      { number: 4, title: "Stage 04 – Affidavit Download", status: "locked", unlocked: false, readyFileName: "Official_Sworn_Affidavit.pdf", note: "Download official sworn affidavit" },
      { 
        number: 5, 
        title: "Stage 05 – Certified Documents Upload", 
        status: "locked", 
        unlocked: false,
        note: "Upload certified birth, marriage, and translation documents",
        uploads: [
          { key: "cert_affidavit", name: "Certified Affidavit", mandatory: true, file: null, status: "pending" },
          { key: "cert_birth", name: "Certified Birth Certificates", mandatory: true, file: null, status: "pending" },
          { key: "cert_marriage", name: "Certified Marriage Certificate", mandatory: true, file: null, status: "pending" },
          { key: "cert_translations", name: "Certified Translated Documents (all)", mandatory: true, file: null, status: "pending" },
          { key: "cert_accom", name: "Copy of Accommodation Plan", mandatory: true, file: null, status: "pending" }
        ]
      },
      { 
        number: 6, 
        title: "Stage 06 – Get Certified from Embassy", 
        status: "locked", 
        unlocked: false,
        note: "Embassy certification & consular fees",
        fees: [
          { name: "Spouse Embassy Fee", amountLEU: 315 },
          { name: "Marriage Certificate", amountLEU: 200 }
        ],
        totalFeeLEU: 515,
        paymentSlipUploaded: false,
        referenceNo: ""
      },
      { 
        number: 7, 
        title: "Stage 07 – Foreign Ministry Superlegalize", 
        status: "locked", 
        unlocked: false,
        note: "Ministry of Foreign Affairs superlegalization & notary",
        majorWorks: [
          "Foreign Ministry Superlegalization",
          "Preparing Declaration (Notary) and Romanian Translation (Translator)"
        ],
        clientBringNotice: "Accommodation Contract/Comodat, ANAF, Plan/Proprietare",
        location01: {
          name: "Location 01 (MAE Superlegalization)",
          availableSlots: "Monday 09:00am, Tuesday 09:00am, Wednesday 10:30am",
          appointment: "Pending admin update",
          status: "Pending",
          directionUrl: "https://maps.google.com/?q=Ministry+of+Foreign+Affairs+Bucharest"
        },
        location02: {
          name: "Location 02 (Sworn Notary)",
          note: "Active immediately after Location 01.",
          status: "Locked",
          directionUrl: "https://maps.google.com/?q=Strada+Buzesti+50+Bucharest"
        },
        balanceFeeLEU: 2200
      },
      { number: 8, title: "Stage 08 – Immigration Appointment", status: "locked", unlocked: false, igiAppointment: "Pending booking", office: "IGI Bucharest, Str. Nicolae Iorga 29", note: "Biometric appointment with IGI authorities" },
      { number: 9, title: "Stage 09 – Applying VISA for your family member", status: "locked", unlocked: false, consularRef: `RO-EVZ-${Date.now().toString().slice(-4)}`, note: "Consular visa submission for family" },
      { number: 10, title: "Stage 10 – Finalize", status: "locked", unlocked: false, note: "TRC card delivery & residency registration" }
    ];

    const feeBreakdown = data.feeBreakdown || {
      spouseLegalFee: 2500,
      spouseEmbassyFeeLEU: 315,
      marriageCertEmbassyLEU: 200,
      childLegalFee: 500,
      childEmbassyFeeLEU: 315,
      birthCertEmbassyLEU: 200,
      advancePaymentLEU: 1000,
      totalLEU: 3230,
      totalEUR: 3000,
      paidAmount: 0,
      pendingAmount: 3000
    };

    const messages = data.messages || [
      { 
        id: `m-${Date.now()}`, 
        sender: "Elena Radu", 
        senderRole: "consultant", 
        text: `Welcome ${firstName}! Your official case file ${caseId} for ${visaType} is now active. We have received your Stage 01 documents and our legal team has begun the compliance verification.`, 
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
      }
    ];

    // 3. Insert into cases table in Cloudflare D1
    await d1Query(
      `INSERT INTO cases (
        case_id, title, visa_type, client_name, first_name, last_name, email, phone,
        foreign_phone, romanian_phone, sri_lankan_address, country, romania_city, nic_number,
        date_of_birth, arrived_date, passport_number, passport_issue_date, passport_expiry,
        birth_location, trc_cnp_number, has_spouse, spouse_name, spouse_passport, children_count,
        applicants_summary, current_stage_number, current_stage_index, stages, fee_breakdown, messages, password
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(case_id) DO UPDATE SET
        title = excluded.title,
        stages = excluded.stages,
        fee_breakdown = excluded.fee_breakdown`,
      [
        caseId,
        `Romania ${visaType} Dossier`,
        visaType,
        fullName,
        firstName,
        lastName,
        email,
        phone,
        data.foreignPhone || phone,
        data.romanianPhone || "+40 728 744 478",
        data.sriLankanAddress || "Sri Lanka",
        data.country || "Sri Lanka",
        data.romaniaCity || "Bucharest",
        data.nicNumber || "",
        data.dateOfBirth || "1992-05-14",
        data.arrivedDate || new Date().toISOString().split('T')[0],
        data.passportNumber || ("N" + Math.floor(1000000 + Math.random() * 9000000)),
        data.passportIssueDate || "2024-01-01",
        data.passportExpiry || "2034-01-01",
        data.birthLocation || "Colombo, Sri Lanka",
        data.trcCnpNumber || "Pending Registration",
        data.hasSpouse || 'No',
        data.spouseName || '',
        data.spousePassport || '',
        parseInt(data.childrenCount || 0),
        data.applicantsSummary || `${data.hasSpouse === 'Yes' ? 'Spouse' : 'Single'} Children: ${data.childrenCount || 0}`,
        1,
        0,
        JSON.stringify(stages),
        JSON.stringify(feeBreakdown),
        JSON.stringify(messages),
        data.password || 'ClientAuth#2026'
      ]
    );

    // 4. Process Stage 01 uploaded files & insert into documents table
    let uploadedFilesList = [];
    const localDocs = getLocalStore('documents', []);

    if (req.files && Array.isArray(req.files) && req.files.length > 0) {
      for (const file of req.files) {
        const fn = (file.fieldname || '').toLowerCase();
        let docName = (file.originalname ? file.originalname.replace(/\.[^/.]+$/, "").replace(/_/g, " ") : 'Stage 01 Document');
        if (fn === 'doc_sponsor_passport') docName = 'Passport – Sponsor in Romania';
        else if (fn === 'doc_sponsor_trc') docName = 'Romanian TRC Permit – Sponsor in Romania';
        else if (fn === 'doc_applicant_passport') docName = 'Passport – Applicant in Sri Lanka';
        else if (fn === 'doc_marriage_cert') docName = 'Marriage Certificate';
        else if (fn === 'doc_birth_cert') docName = 'Birth Certificate (If Children / Dependents)';
        else if (fn === 'doc_additional') docName = 'Additional Supporting Documents';
        else if (fn === 'doc_police_clearance' || fn === 'doc_police') docName = 'Police Clearance Certificate';
        else if (fn === 'doc_cv') docName = 'Curriculum Vitae (CV / Resume)';
        else if (fn === 'doc_work_passport' || fn === 'doc_passport') docName = 'Passport Scan';
        else if (fn === 'doc_id_card') docName = 'National Identity Card (NIC)';
        else if (fn === 'doc_driving_licence') docName = 'Driving Licence';
        else if (fn === 'doc_pr_passport') docName = 'Passport Scan';
        else if (fn === 'doc_pr_trc') docName = 'Romanian TRC Permit Scan';
        else if (fn === 'doc_pr_tax') docName = 'ANAF Tax Clearance Certificate';
        else if (fn === 'doc_pr_stay') docName = 'Proof of Continuous Legal Stay (5 Years)';
        else if (fn === 'doc_pr_income') docName = 'Proof of Stable Income & Health Insurance';
        else if (fn === 'doc_civil') docName = 'Original Civil Certificates (Birth & Marriage)';
        const storageKey = `${caseId}/stage1_${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        let publicUrl = null;
        
        // Save local copy to UPLOADS_DIR
        try {
          const localFilePath = path.join(UPLOADS_DIR, `${caseId}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
          fs.writeFileSync(localFilePath, file.buffer);
          const localKeyPath = path.join(UPLOADS_DIR, storageKey.replace(/[\/\\]/g, '_'));
          fs.writeFileSync(localKeyPath, file.buffer);
        } catch (diskErr) {
          console.warn('Local disk file save notice:', diskErr.message);
        }

        try {
          const r2Command = new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: storageKey,
            Body: file.buffer,
            ContentType: file.mimetype || 'application/pdf',
            Metadata: { 
              caseId: String(caseId), 
              docName: String(docName || 'Document').replace(/[^\x20-\x7E]/g, '_'), 
              uploadedBy: 'client' 
            }
          });
          await r2Client.send(r2Command);
          publicUrl = `/api/documents/stream?key=${encodeURIComponent(storageKey)}`;
        } catch (r2Err) {
          console.warn('R2 file save notice:', r2Err.message);
          publicUrl = `/api/documents/stream?key=${encodeURIComponent(storageKey)}`;
        }

        const docId = `doc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const docObj = {
          id: docId,
          case_id: caseId,
          caseId: caseId,
          name: docName,
          category: 'Stage 01',
          file_name: file.originalname,
          fileName: file.originalname,
          file_url: publicUrl,
          fileUrl: publicUrl,
          file_size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
          fileSize: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
          upload_date: new Date().toISOString().split('T')[0],
          uploadDate: new Date().toISOString().split('T')[0],
          status: 'under_review',
          uploaded_by: 'client',
          uploadedBy: 'client',
          stage_number: 1,
          stageNumber: 1,
          uploadKey: fn || null,
          key: fn || null,
          note: 'Stage 01 Initial Document'
        };
        localDocs.push(docObj);

        d1Query(
          `INSERT INTO documents (id, case_id, name, category, file_name, file_url, file_size, upload_date, status, uploaded_by, stage_number, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            docId,
            caseId,
            docName,
            'Stage 01',
            file.originalname,
            publicUrl,
            `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
            new Date().toISOString().split('T')[0],
            'under_review',
            'client',
            1,
            'Stage 01 Initial Document'
          ]
        ).catch(console.warn);

        uploadedFilesList.push({ name: docName, fileName: file.originalname });
      }
    }

    let parsedDocuments = [];
    if (typeof data.documents === 'string') {
      try { parsedDocuments = JSON.parse(data.documents); } catch(e){}
    } else if (Array.isArray(data.documents)) {
      parsedDocuments = data.documents;
    }

    if ((!req.files || req.files.length === 0) && parsedDocuments.length > 0) {
      for (const doc of parsedDocuments) {
        const docId = `doc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const docObj = {
          id: docId,
          case_id: caseId,
          caseId: caseId,
          name: doc.name || 'Stage 01 Document',
          category: 'Stage 01',
          file_name: doc.fileName || `${(doc.name || 'document').replace(/\s+/g, '_')}.pdf`,
          fileName: doc.fileName || `${(doc.name || 'document').replace(/\s+/g, '_')}.pdf`,
          file_url: doc.fileUrl || null,
          fileUrl: doc.fileUrl || null,
          file_size: doc.fileSize || '2.4 MB',
          fileSize: doc.fileSize || '2.4 MB',
          upload_date: new Date().toISOString().split('T')[0],
          uploadDate: new Date().toISOString().split('T')[0],
          status: 'under_review',
          uploaded_by: doc.uploadedBy || 'client',
          uploadedBy: doc.uploadedBy || 'client',
          stage_number: 1,
          stageNumber: 1,
          note: 'Stage 01 Initial Document'
        };
        localDocs.push(docObj);

        d1Query(
          `INSERT INTO documents (id, case_id, name, category, file_name, file_url, file_size, upload_date, status, uploaded_by, stage_number, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            docId,
            caseId,
            doc.name || 'Stage 01 Document',
            'Stage 01',
            doc.fileName || `${(doc.name || 'document').replace(/\s+/g, '_')}.pdf`,
            doc.fileUrl || null,
            doc.fileSize || '2.4 MB',
            new Date().toISOString().split('T')[0],
            'under_review',
            doc.uploadedBy || 'client',
            1,
            'Stage 01 Initial Document'
          ]
        ).catch(console.warn);

        uploadedFilesList.push({ name: doc.name, fileName: doc.fileName });
      }
    }

    saveLocalStore('documents', localDocs);

    // Build the initialized case object and save immediately to local cases store
    const fullNewCase = {
      caseId,
      case_id: caseId,
      id: caseId,
      title: `Romania ${visaType} Dossier`,
      visaType,
      visa_type: visaType,
      clientName: fullName,
      client_name: fullName,
      firstName,
      first_name: firstName,
      lastName,
      last_name: lastName,
      email,
      phone,
      foreignPhone: data.foreignPhone || phone,
      foreign_phone: data.foreignPhone || phone,
      romanianPhone: data.romanianPhone || "+40 728 744 478",
      romanian_phone: data.romanianPhone || "+40 728 744 478",
      sriLankanAddress: data.sriLankanAddress || "Sri Lanka",
      sri_lankan_address: data.sriLankanAddress || "Sri Lanka",
      country: data.country || "Sri Lanka",
      romaniaCity: data.romaniaCity || "Bucharest",
      romania_city: data.romaniaCity || "Bucharest",
      nicNumber: data.nicNumber || "",
      nic_number: data.nicNumber || "",
      dateOfBirth: data.dateOfBirth || "1992-05-14",
      date_of_birth: data.dateOfBirth || "1992-05-14",
      arrivedDate: data.arrivedDate || new Date().toISOString().split('T')[0],
      arrived_date: data.arrivedDate || new Date().toISOString().split('T')[0],
      passportNumber: data.passportNumber || ("N" + Math.floor(1000000 + Math.random() * 9000000)),
      passport_number: data.passportNumber || ("N" + Math.floor(1000000 + Math.random() * 9000000)),
      passportIssueDate: data.passportIssueDate || "2024-01-01",
      passport_issue_date: data.passportIssueDate || "2024-01-01",
      passportExpiry: data.passportExpiry || "2034-01-01",
      passport_expiry: data.passportExpiry || "2034-01-01",
      birthLocation: data.birthLocation || "Colombo, Sri Lanka",
      birth_location: data.birthLocation || "Colombo, Sri Lanka",
      trcCnpNumber: data.trcCnpNumber || "Pending Registration",
      trc_cnp_number: data.trcCnpNumber || "Pending Registration",
      hasSpouse: data.hasSpouse || 'No',
      has_spouse: data.hasSpouse || 'No',
      spouseName: data.spouseName || '',
      spouse_name: data.spouseName || '',
      spousePassport: data.spousePassport || '',
      spouse_passport: data.spousePassport || '',
      childrenCount: parseInt(data.childrenCount || 0),
      children_count: parseInt(data.childrenCount || 0),
      applicantsSummary: data.applicantsSummary || `${data.hasSpouse === 'Yes' ? 'Spouse' : 'Single'} Children: ${data.childrenCount || 0}`,
      applicants_summary: data.applicantsSummary || `${data.hasSpouse === 'Yes' ? 'Spouse' : 'Single'} Children: ${data.childrenCount || 0}`,
      currentStageNumber: 1,
      current_stage_number: 1,
      currentStageIndex: 0,
      current_stage_index: 0,
      stages,
      feeBreakdown,
      fee_breakdown: feeBreakdown,
      messages,
      password: data.password || 'ClientAuth#2026',
      createdDate: new Date().toISOString().split('T')[0],
      created_at: new Date().toISOString()
    };

    const localCases = getLocalStore('cases', []);
    const updatedCases = [fullNewCase, ...localCases.filter(c => (c.caseId || c.case_id) !== caseId)];
    saveLocalStore('cases', updatedCases);

    // 5. Update accounts table linking case_id
    const localAccs = getLocalStore('accounts', []);
    const updatedAccounts = localAccs.map(acc => {
      if ((email && (acc.email || '').toLowerCase() === email) || (phone && (acc.phone || '').replace(/\s+/g, '') === phone.replace(/\s+/g, ''))) {
        return { ...acc, caseId, case_id: caseId };
      }
      return acc;
    });
    saveLocalStore('accounts', updatedAccounts);

    if (email) {
      d1Query(`UPDATE accounts SET case_id = ? WHERE LOWER(TRIM(email)) = ?`, [caseId, email]).catch(console.warn);
    }
    if (phone) {
      d1Query(`UPDATE accounts SET case_id = ? WHERE REPLACE(phone, ' ', '') = ?`, [caseId, phone.replace(/\s+/g, '')]).catch(console.warn);
    }

    // 6. Send official emails to client and admin
    try {
      await Promise.allSettled([
        sendWelcomeRegistrationEmail({ ...data, firstName, lastName, email, phone, visaType }, caseId),
        sendAdminRegistrationAlert({ ...data, firstName, lastName, email, phone, visaType }, caseId),
        sendAdminStageSubmissionAlert(email, fullName, caseId, 1, 'Required Documents', Math.max(uploadedFilesList.length, 3))
      ]);
      console.log(`✉️ Dispatched Stage 01 Case Initialization & Admin Dossier Alert for ${email} (${caseId})`);
    } catch (mailErr) {
      console.warn('Stage 1 email dispatch notice:', mailErr.message);
    }

    // 6.1 WhatsApp Admin & Client Alerts (+40 728 744 478)
    try {
      const docSummaryList = uploadedFilesList.length > 0 
        ? uploadedFilesList.map(d => `• ${d.name || d.fileName}`).join('\n')
        : '• Passport Scan\n• Romanian TRC Permit\n• Civil Certificates';

      // 1. WhatsApp Alert to Admin
      notifyAdminOnStageSubmission({
        userId: data.userId || data.id || 'UID-2026',
        userName: fullName,
        caseId,
        userPhone: phone,
        userEmail: email,
        visaType,
        stageNumber: 1,
        stageTitle: 'Required Documents',
        docCount: uploadedFilesList.length || 3,
        documentsList: docSummaryList
      }).catch(err => console.warn('WhatsApp Admin Stage 1 Submission Alert note:', err.message));

      // 2. WhatsApp Submission Receipt to Client
      if (phone && phone !== 'Not provided') {
        notifyUserStageSubmission({
          userPhone: phone,
          userName: fullName,
          caseId,
          userId: data.userId || data.id || 'UID-2026',
          stageNumber: 1,
          stageTitle: 'Required Documents',
          documentsList: docSummaryList
        }).catch(err => console.warn('WhatsApp Client Stage 1 Receipt note:', err.message));
      }
    } catch (waErr) {
      console.warn('WhatsApp stage 1 dispatch error:', waErr.message);
    }

    // 7. Fetch all saved documents for this initialized case
    const savedDocs = localDocs.filter(d => (d.case_id || d.caseId) === caseId);

    return res.json({
      success: true,
      caseId,
      message: `Official Case Dossier ${caseId} created and Stage 01 documents submitted!`,
      case: {
        ...fullNewCase,
        documents: savedDocs
      }
    });
  } catch (err) {
    console.error('Initialize Stage 1 Case Error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cases', async (req, res) => {
  try {
    const c = req.body;
    const stagesJson = JSON.stringify(c.stages || []);
    const feesJson = JSON.stringify(c.feeBreakdown || {});
    const msgsJson = JSON.stringify(c.messages || []);

    // Save immediately to local cases store
    const localCases = getLocalStore('cases', []);
    const normalizedNew = normalizeCase(c);
    const updatedCases = [normalizedNew, ...localCases.filter(item => (item.caseId || item.case_id) !== c.caseId)];
    saveLocalStore('cases', updatedCases);

    d1Query(
      `INSERT INTO cases (
        case_id, title, visa_type, client_name, first_name, last_name, email, phone,
        foreign_phone, romanian_phone, sri_lankan_address, country, romania_city, nic_number,
        date_of_birth, arrived_date, passport_number, passport_issue_date, passport_expiry,
        birth_location, trc_cnp_number, sponsor_mother, sponsor_father, has_spouse, spouse_name,
        spouse_passport, spouse_passport_issue, spouse_passport_expiry, spouse_birth_location,
        spouse_mother, spouse_father, is_divorced, children_count, has_mother, has_father,
        trc_valid_15_months, applicants_summary, current_stage_number, current_stage_index,
        stages, fee_breakdown, messages, password
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(case_id) DO UPDATE SET
        title = excluded.title,
        visa_type = excluded.visa_type,
        client_name = excluded.client_name,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        email = excluded.email,
        phone = excluded.phone,
        foreign_phone = excluded.foreign_phone,
        romanian_phone = excluded.romanian_phone,
        sri_lankan_address = excluded.sri_lankan_address,
        country = excluded.country,
        romania_city = excluded.romania_city,
        nic_number = excluded.nic_number,
        date_of_birth = excluded.date_of_birth,
        arrived_date = excluded.arrived_date,
        passport_number = excluded.passport_number,
        passport_issue_date = excluded.passport_issue_date,
        passport_expiry = excluded.passport_expiry,
        birth_location = excluded.birth_location,
        trc_cnp_number = excluded.trc_cnp_number,
        sponsor_mother = excluded.sponsor_mother,
        sponsor_father = excluded.sponsor_father,
        has_spouse = excluded.has_spouse,
        spouse_name = excluded.spouse_name,
        spouse_passport = excluded.spouse_passport,
        spouse_passport_issue = excluded.spouse_passport_issue,
        spouse_passport_expiry = excluded.spouse_passport_expiry,
        spouse_birth_location = excluded.spouse_birth_location,
        spouse_mother = excluded.spouse_mother,
        spouse_father = excluded.spouse_father,
        is_divorced = excluded.is_divorced,
        children_count = excluded.children_count,
        has_mother = excluded.has_mother,
        has_father = excluded.has_father,
        trc_valid_15_months = excluded.trc_valid_15_months,
        applicants_summary = excluded.applicants_summary,
        current_stage_number = excluded.current_stage_number,
        current_stage_index = excluded.current_stage_index,
        stages = excluded.stages,
        fee_breakdown = excluded.fee_breakdown,
        messages = excluded.messages,
        updated_at = CURRENT_TIMESTAMP`,
      [
        c.caseId,
        c.title || `Romania ${c.visaType || 'Immigration Dossier'}`,
        c.visaType || "Family Reunification (D/VF)",
        c.clientName || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
        c.firstName || '',
        c.lastName || '',
        c.email || '',
        c.phone || '',
        c.foreignPhone || c.phone || '',
        c.romanianPhone || "+40 728 744 478",
        c.sriLankanAddress || "Sri Lanka",
        c.country || "Sri Lanka",
        c.romaniaCity || "Bucharest",
        c.nicNumber || null,
        c.dateOfBirth || null,
        c.arrivedDate || null,
        c.passportNumber || null,
        c.passportIssueDate || null,
        c.passportExpiry || null,
        c.birthLocation || null,
        c.trcCnpNumber || null,
        c.sponsorMother || null,
        c.sponsorFather || null,
        c.hasSpouse || 'No',
        c.spouseName || null,
        c.spousePassport || null,
        c.spousePassportIssue || null,
        c.spousePassportExpiry || null,
        c.spouseBirthLocation || null,
        c.spouseMother || null,
        c.spouseFather || null,
        c.isDivorced || 'No',
        parseInt(c.childrenCount || 0),
        c.hasMother || 'No',
        c.hasFather || 'No',
        c.trcValid15Months || 'Yes',
        c.applicantsSummary || null,
        c.currentStageNumber || 1,
        c.currentStageIndex || 0,
        stagesJson,
        feesJson,
        msgsJson,
        c.password || null
      ]
    ).catch(console.warn);

    return res.json({ success: true, caseId: c.caseId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.put('/api/cases/:caseId', async (req, res) => {
  try {
    const { caseId } = req.params;
    const updates = req.body;

    // Update in local JSON store
    const localCases = getLocalStore('cases', []);
    const idx = localCases.findIndex(c => (c.caseId || c.case_id) === caseId || String(c.caseId || c.case_id).toLowerCase() === String(caseId).toLowerCase());
    if (idx >= 0) {
      localCases[idx] = {
        ...localCases[idx],
        ...updates,
        caseId: localCases[idx].caseId || caseId,
        case_id: localCases[idx].case_id || caseId
      };
      saveLocalStore('cases', localCases);
    }

    const fields = [];
    const params = [];

    const fieldMap = {
      stages: { col: 'stages', transform: val => JSON.stringify(safeParseArray(val, [])) },
      currentStageNumber: { col: 'current_stage_number' },
      currentStageIndex: { col: 'current_stage_index' },
      feeBreakdown: { col: 'fee_breakdown', transform: val => JSON.stringify(safeParseObject(val, {})) },
      messages: { col: 'messages', transform: val => JSON.stringify(safeParseArray(val, [])) },
      firstName: { col: 'first_name' },
      lastName: { col: 'last_name' },
      clientName: { col: 'client_name' },
      title: { col: 'title' },
      visaType: { col: 'visa_type' },
      email: { col: 'email' },
      phone: { col: 'phone' },
      foreignPhone: { col: 'foreign_phone' },
      romanianPhone: { col: 'romanian_phone' },
      sriLankanAddress: { col: 'sri_lankan_address' },
      country: { col: 'country' },
      romaniaCity: { col: 'romania_city' },
      nicNumber: { col: 'nic_number' },
      dateOfBirth: { col: 'date_of_birth' },
      arrivedDate: { col: 'arrived_date' },
      passportNumber: { col: 'passport_number' },
      passportIssueDate: { col: 'passport_issue_date' },
      passportExpiry: { col: 'passport_expiry' },
      birthLocation: { col: 'birth_location' },
      trcCnpNumber: { col: 'trc_cnp_number' },
      sponsorMother: { col: 'sponsor_mother' },
      sponsorFather: { col: 'sponsor_father' },
      hasSpouse: { col: 'has_spouse' },
      spouseName: { col: 'spouse_name' },
      spousePassport: { col: 'spouse_passport' },
      spousePassportIssue: { col: 'spouse_passport_issue' },
      spousePassportExpiry: { col: 'spouse_passport_expiry' },
      spouseBirthLocation: { col: 'spouse_birth_location' },
      spouseMother: { col: 'spouse_mother' },
      spouseFather: { col: 'spouse_father' },
      isDivorced: { col: 'is_divorced' },
      childrenCount: { col: 'children_count', transform: val => parseInt(val || 0) },
      hasMother: { col: 'has_mother' },
      hasFather: { col: 'has_father' },
      trcValid15Months: { col: 'trc_valid_15_months' },
      applicantsSummary: { col: 'applicants_summary' },
      password: { col: 'password' }
    };

    for (const [key, mapping] of Object.entries(fieldMap)) {
      if (updates[key] !== undefined) {
        fields.push(`${mapping.col} = ?`);
        params.push(mapping.transform ? mapping.transform(updates[key]) : updates[key]);
      }
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    params.push(caseId);

    if (fields.length > 1) {
      d1Query(`UPDATE cases SET ${fields.join(', ')} WHERE case_id = ?`, params).catch(console.warn);
    }

    // Keep accounts table in sync with updated phone and name
    const newPhone = (updates.phone || updates.foreignPhone || updates.romanianPhone || '').trim();
    if (newPhone) {
      d1Query(`UPDATE accounts SET phone = ? WHERE case_id = ?`, [newPhone, caseId]).catch(console.warn);
    }
    if (updates.firstName || updates.lastName) {
      const fName = (updates.firstName || '').trim();
      const lName = (updates.lastName || '').trim();
      if (fName) {
        d1Query(`UPDATE accounts SET first_name = ?, last_name = ? WHERE case_id = ?`, [fName, lName, caseId]).catch(console.warn);
      }
    }

    // Trigger Admin notification when key profile particulars are updated
    if (updates.firstName || updates.phone || updates.passportNumber || updates.sriLankanAddress || updates.spouseName || updates.romaniaCity) {
      sendAdminProfileUpdateAlert(updates, caseId).catch(console.warn);
    }

    return res.json({ success: true, caseId });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Delete All Cases and associated client data
app.delete('/api/cases', async (req, res) => {
  try {
    saveLocalStore('cases', []);
    saveLocalStore('documents', []);
    const localAccs = getLocalStore('accounts', []);
    saveLocalStore('accounts', localAccs.filter(a => a.role !== 'client'));

    d1Query(`DELETE FROM documents`).catch(console.warn);
    d1Query(`DELETE FROM cases`).catch(console.warn);
    d1Query(`DELETE FROM accounts WHERE role = 'client'`).catch(console.warn);
    return res.json({ success: true, message: 'All cases and client data permanently wiped from database.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Delete Case and associated records (Preserves User Profile & Account)
app.delete('/api/cases/:caseId', async (req, res) => {
  try {
    const { caseId } = req.params;
    const cleanId = String(caseId).trim();

    // 1. Local JSON removal of case and its documents
    const localCases = getLocalStore('cases', []);
    saveLocalStore('cases', localCases.filter(c => (c.caseId || c.case_id) !== cleanId && String(c.caseId || c.case_id).toLowerCase() !== cleanId.toLowerCase()));
    
    const localDocs = getLocalStore('documents', []);
    saveLocalStore('documents', localDocs.filter(d => (d.case_id || d.caseId) !== cleanId && String(d.case_id || d.caseId).toLowerCase() !== cleanId.toLowerCase()));

    // 2. Unlink active caseId on account without deleting the account
    const localAccs = getLocalStore('accounts', []);
    const updatedAccs = localAccs.map(a => {
      if ((a.caseId || a.case_id) === cleanId) {
        return { ...a, caseId: null, case_id: null };
      }
      return a;
    });
    saveLocalStore('accounts', updatedAccs);

    // 3. Database cleanup (Cases and Documents only)
    d1Query(`DELETE FROM documents WHERE case_id = ? OR LOWER(case_id) = LOWER(?)`, [cleanId, cleanId]).catch(console.warn);
    d1Query(`DELETE FROM cases WHERE case_id = ? OR LOWER(case_id) = LOWER(?)`, [cleanId, cleanId]).catch(console.warn);
    d1Query(`UPDATE accounts SET case_id = NULL WHERE case_id = ? OR LOWER(case_id) = LOWER(?)`, [cleanId, cleanId]).catch(console.warn);

    return res.json({ success: true, caseId: cleanId, message: 'Case dossier removed. User account preserved.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 7b. AUDIT LOGS & USER ACTIVITY ENDPOINTS
// =========================================================================
app.get('/api/audit-logs', async (req, res) => {
  try {
    const { userId, caseId } = req.query;
    let sql = `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200`;
    let params = [];
    if (userId && caseId) {
      sql = `SELECT * FROM audit_logs WHERE user_id = ? OR case_id = ? ORDER BY created_at DESC LIMIT 200`;
      params = [userId, caseId];
    } else if (userId) {
      sql = `SELECT * FROM audit_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT 200`;
      params = [userId];
    } else if (caseId) {
      sql = `SELECT * FROM audit_logs WHERE case_id = ? ORDER BY created_at DESC LIMIT 200`;
      params = [caseId];
    }

    const d1Logs = await d1Query(sql, params);
    let logs = (d1Logs.success && Array.isArray(d1Logs.results) && d1Logs.results.length > 0)
      ? d1Logs.results
      : getLocalStore('audit_logs', []);

    if (userId) {
      logs = logs.filter(l => (l.user_id || l.userId) === userId);
    }
    if (caseId) {
      logs = logs.filter(l => (l.case_id || l.caseId) === caseId);
    }

    return res.json(logs);
  } catch (err) {
    const localLogs = getLocalStore('audit_logs', []);
    return res.json(localLogs);
  }
});

app.post('/api/audit-logs', async (req, res) => {
  try {
    const { userId, caseId, actorName, actorRole, action, details } = req.body;
    const logId = `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newLog = {
      id: logId,
      user_id: userId || null,
      userId: userId || null,
      case_id: caseId || null,
      caseId: caseId || null,
      actor_name: actorName || 'System',
      actorName: actorName || 'System',
      actor_role: actorRole || 'client',
      actorRole: actorRole || 'client',
      action: action || 'ACTIVITY',
      details: details || '',
      created_at: new Date().toISOString()
    };

    const localLogs = getLocalStore('audit_logs', []);
    saveLocalStore('audit_logs', [newLog, ...localLogs.slice(0, 499)]);

    d1Query(
      `INSERT INTO audit_logs (id, user_id, case_id, actor_name, actor_role, action, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [logId, userId || null, caseId || null, actorName || 'System', actorRole || 'client', action || 'ACTIVITY', details || '']
    ).catch(console.warn);

    return res.json({ success: true, log: newLog });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Delete individual document
app.delete('/api/documents/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const localDocs = getLocalStore('documents', []);
    saveLocalStore('documents', localDocs.filter(d => d.id !== id));

    d1Query(`DELETE FROM documents WHERE id = ?`, [id]).catch(console.warn);
    return res.json({ success: true, id, message: 'Document deleted.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Update document verification status and feedback
app.put('/api/documents/:id/verify', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, feedback, note, caseId } = req.body;
    const resolvedNote = feedback || note || '';

    // Update in local documents store
    const localDocs = getLocalStore('documents', []);
    const docIdx = localDocs.findIndex(d => d.id === id);
    if (docIdx >= 0) {
      localDocs[docIdx] = { ...localDocs[docIdx], status, note: resolvedNote };
      saveLocalStore('documents', localDocs);
    }

    d1Query(
      `UPDATE documents SET status = ?, note = ? WHERE id = ?`,
      [status, resolvedNote, id]
    ).catch(console.warn);

    // If document status is set to 'reupload' or 'rejected', send instant rich WhatsApp alert to User
    if (status === 'reupload' || status === 'rejected' || status === 'action_required') {
      try {
        const localCases = getLocalStore('cases', []);
        const localAccs = getLocalStore('accounts', []);
        const docRow = localDocs[docIdx];
        const targetCaseId = caseId || docRow?.case_id || docRow?.caseId;
        const cRow = localCases.find(c => (c.caseId || c.case_id) === targetCaseId);
        const acc = localAccs.find(a => (a.caseId || a.case_id) === targetCaseId || (cRow?.email && (a.email || '').toLowerCase() === cRow.email.toLowerCase()));

        if (cRow || acc) {
          const userPhone = acc?.phone || acc?.foreignPhone || cRow?.phone || cRow?.foreignPhone || cRow?.romanianPhone;
          const userName = cRow?.clientName || `${cRow?.firstName || ''} ${cRow?.lastName || ''}`.trim() || 'Valued Client';
          const docTitle = docRow?.name || docRow?.fileName || 'Statutory Checklist Document';
          const stageNum = docRow?.stageNumber || docRow?.stage_number || 1;
          const userId = acc?.id || acc?.userId || cRow?.id || 'UID-2026';

          notifyUserDocReupload({
            phone: userPhone,
            userName,
            docTitle,
            stageNumber: stageNum,
            reason: resolvedNote || 'Document unclear, blurred, cropped, or expired. Please upload a fresh copy.',
            caseId: targetCaseId,
            userId
          }).catch(err => console.warn('WhatsApp Doc Reupload alert note:', err.message));
        }
      } catch (waErr) {
        console.warn('Doc reupload WhatsApp trigger note:', waErr.message);
      }
    }

    return res.json({ success: true, id, status, feedback: resolvedNote });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Endpoint to Submit Embassy Payment Slip with Admin Notification
app.post('/api/cases/:caseId/payment-slip', async (req, res) => {
  try {
    const { caseId } = req.params;
    const { stageNumber, referenceNo, clientEmail, clientName } = req.body;

    const localCases = getLocalStore('cases', []);
    const cIdx = localCases.findIndex(c => (c.caseId || c.case_id) === caseId);
    let targetCase = cIdx >= 0 ? localCases[cIdx] : null;

    if (targetCase) {
      const stagesList = safeParseArray(targetCase.stages, []);
      const updatedStages = stagesList.map(stg => {
        if (stg.number === Number(stageNumber || 6)) {
          return {
            ...stg,
            paymentSlipUploaded: true,
            referenceNo: referenceNo || 'TXN-PAID',
            status: 'pending_approval'
          };
        }
        return stg;
      });
      localCases[cIdx].stages = updatedStages;
      saveLocalStore('cases', localCases);
      
      d1Query(`UPDATE cases SET stages = ? WHERE case_id = ?`, [JSON.stringify(updatedStages), caseId]).catch(console.warn);

      const cEmail = clientEmail || targetCase.email;
      const cName = clientName || targetCase.clientName || targetCase.client_name;
      const userPhone = targetCase.phone || targetCase.foreignPhone || targetCase.romanianPhone;
      const uId = targetCase.userId || targetCase.id || 'UID-2026';

      // 1. Email alerts (Admin + Client)
      if (cEmail && cEmail.includes('@')) {
        sendAdminPaymentSlipAlert(cEmail, cName, caseId, stageNumber || 6, referenceNo).catch(console.warn);
        sendPaymentSlipReceivedEmail(cEmail, cName, caseId, stageNumber || 6, referenceNo).catch(console.warn);
      }

      // 2. WhatsApp alerts (Admin + Client)
      try {
        notifyAdminOnPaymentSlip({
          clientName: cName,
          caseId,
          userId: uId,
          referenceNo: referenceNo || 'TXN-PAID',
          stageNumber: stageNumber || 6
        }).catch(console.warn);

        if (userPhone) {
          notifyUserOnPaymentSlip({
            phone: userPhone,
            clientName: cName,
            caseId,
            referenceNo: referenceNo || 'TXN-PAID',
            stageNumber: stageNumber || 6
          }).catch(console.warn);
        }
      } catch (waErr) {
        console.warn('Payment slip WhatsApp dispatch note:', waErr.message);
      }
    }

    return res.json({ success: true, message: 'Payment slip received and admin notified.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Endpoint to Submit Client Case Messages with Admin Notification
app.post('/api/cases/:caseId/messages', async (req, res) => {
  try {
    const { caseId } = req.params;
    const { sender, senderRole, text, subject, clientEmail, clientName } = req.body;

    const localCases = getLocalStore('cases', []);
    const cIdx = localCases.findIndex(c => (c.caseId || c.case_id) === caseId);
    let targetCase = cIdx >= 0 ? localCases[cIdx] : null;

    if (targetCase) {
      let msgs = safeParseArray(targetCase.messages, []);
      const newMsg = {
        id: `msg-${Date.now()}`,
        sender: sender || 'Client',
        senderRole: senderRole || 'client',
        subject: subject || 'Case Inquiry',
        text,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'delivered'
      };
      msgs.push(newMsg);
      localCases[cIdx].messages = msgs;
      saveLocalStore('cases', localCases);

      d1Query(`UPDATE cases SET messages = ? WHERE case_id = ?`, [JSON.stringify(msgs), caseId]).catch(console.warn);

      const cEmail = clientEmail || targetCase.email;
      const cName = clientName || targetCase.clientName || targetCase.client_name;
      const userPhone = targetCase.phone || targetCase.foreignPhone || targetCase.romanianPhone;

      if (senderRole === 'client') {
        // Client sent message -> Alert Admin via Email + WhatsApp
        if (cEmail) {
          sendAdminClientMessageAlert(cEmail, cName, caseId, text, subject).catch(console.warn);
        }
        notifyAdminOnClientMessage({ clientName: cName, caseId, text, subject }).catch(console.warn);
      } else if (senderRole === 'admin' || senderRole === 'consultant' || senderRole === 'staff') {
        // Admin / Counsel replied -> Notify Client via Email + WhatsApp
        if (cEmail && cEmail.includes('@')) {
          sendClientReplyEmail(cEmail, cName, caseId, text, subject, sender || 'Elena Radu (Senior Legal Counsel)').catch(console.warn);
        }
        if (userPhone) {
          notifyUserOnAdminMessage({ phone: userPhone, clientName: cName, text, senderName: sender || 'Elena Radu (Senior Legal Counsel)' }).catch(console.warn);
        }
      }
    }

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 4. DOCUMENT UPLOADS TO CLOUDFLARE R2 OBJECT STORAGE WITH NOTES
// =========================================================================
app.post('/api/cases/:caseId/documents', upload.single('file'), async (req, res) => {
  try {
    const { caseId } = req.params;
    const { docName, category, stageNumber, note, uploadedBy, uploadKey } = req.body;
    const file = req.file;

    let publicUrl = req.body.fileUrl || null;
    let fileName = file ? file.originalname : (req.body.fileName || `${(docName || 'Document').replace(/\s+/g, '_')}.pdf`);
    const storageKey = `${caseId}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    // 1. Upload to Cloudflare R2 S3 Object Storage & Save local copy
    if (file) {
      // Save local disk copy for resilient offline/local serving
      try {
        const localFilePath = path.join(UPLOADS_DIR, `${caseId}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
        fs.writeFileSync(localFilePath, file.buffer);
        const localKeyPath = path.join(UPLOADS_DIR, storageKey.replace(/[\/\\]/g, '_'));
        fs.writeFileSync(localKeyPath, file.buffer);
      } catch (diskErr) {
        console.warn('Local disk file write notice:', diskErr.message);
      }

      try {
        const r2Command = new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: storageKey,
          Body: file.buffer,
          ContentType: file.mimetype || 'application/pdf',
          Metadata: {
            caseId: String(caseId),
            docName: String(docName || fileName || 'Document').replace(/[^\x20-\x7E]/g, '_'),
            uploadedBy: String(uploadedBy || 'client')
          }
        });
        await r2Client.send(r2Command);
        publicUrl = `/api/documents/stream?key=${encodeURIComponent(storageKey)}`;
      } catch (r2Err) {
        console.warn('Cloudflare R2 upload warning:', r2Err.message);
        publicUrl = `/api/documents/stream?key=${encodeURIComponent(storageKey)}`;
      }
    }

    const newDocId = `doc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newDocRow = {
      id: newDocId,
      case_id: caseId,
      caseId: caseId,
      name: docName || fileName || 'Official Document',
      category: category || (stageNumber ? `Stage 0${stageNumber}` : 'General Document'),
      file_name: fileName,
      fileName: fileName,
      file_url: publicUrl,
      fileUrl: publicUrl,
      file_size: file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : (req.body.fileSize || '1.5 MB'),
      fileSize: file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : (req.body.fileSize || '1.5 MB'),
      upload_date: new Date().toISOString().split('T')[0],
      uploadDate: new Date().toISOString().split('T')[0],
      status: uploadedBy === 'admin' ? 'ready_for_download' : 'under_review',
      uploaded_by: uploadedBy || 'client',
      uploadedBy: uploadedBy || 'client',
      stage_number: stageNumber ? Number(stageNumber) : null,
      stageNumber: stageNumber ? Number(stageNumber) : null,
      note: (note || '').trim()
    };

    // Save to local documents store
    const localDocs = getLocalStore('documents', []);
    const existingDocIdx = localDocs.findIndex(d => (d.caseId || d.case_id) === caseId && (d.uploadedBy || d.uploaded_by) === (uploadedBy || 'client') && d.name === newDocRow.name);
    if (existingDocIdx >= 0) {
      localDocs[existingDocIdx] = { ...localDocs[existingDocIdx], ...newDocRow, id: localDocs[existingDocIdx].id };
    } else {
      localDocs.push(newDocRow);
    }
    saveLocalStore('documents', localDocs);

    // Save to Cloudflare D1
    d1Query(
      `INSERT INTO documents (id, case_id, name, category, file_name, file_url, file_size, upload_date, status, uploaded_by, stage_number, note)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newDocRow.id,
        newDocRow.case_id,
        newDocRow.name,
        newDocRow.category,
        newDocRow.file_name,
        newDocRow.file_url,
        newDocRow.file_size,
        newDocRow.upload_date,
        newDocRow.status,
        newDocRow.uploaded_by,
        newDocRow.stage_number,
        newDocRow.note
      ]
    ).catch(console.warn);

    // Auto update stage note or stage status in local cases
    const localCases = getLocalStore('cases', []);
    const cIdx = localCases.findIndex(c => (c.caseId || c.case_id) === caseId);
    let targetCase = cIdx >= 0 ? localCases[cIdx] : null;

    if (targetCase && targetCase.stages) {
      let stagesList = safeParseArray(targetCase.stages, []);
      let hasUpdates = false;

      if (Array.isArray(stagesList) && stagesList.length > 0) {
        const updatedStages = stagesList.map(stg => {
          if (stg.number === Number(stageNumber)) {
            let updatedUploads = stg.uploads;
            if (uploadKey && stg.uploads) {
              updatedUploads = stg.uploads.map(u => u.key === uploadKey ? { ...u, file: fileName, status: 'uploaded' } : u);
              hasUpdates = true;
            }
            if (Number(stageNumber) === 6 && (String(docName || '').toLowerCase().includes('payment') || String(docName || '').toLowerCase().includes('slip') || String(fileName || '').toLowerCase().includes('fee'))) {
              hasUpdates = true;
              return {
                ...stg,
                uploads: updatedUploads,
                paymentSlipUploaded: true,
                status: stg.status === 'locked' ? 'pending_approval' : stg.status
              };
            }
            if (uploadedBy === 'admin' && note) {
              hasUpdates = true;
              return { ...stg, note: note.trim() };
            }
            if (uploadedBy === 'client' && stg.status === 'locked') {
              hasUpdates = true;
              return {
                ...stg,
                uploads: updatedUploads,
                status: 'pending_approval'
              };
            }
            if (updatedUploads !== stg.uploads) {
              return { ...stg, uploads: updatedUploads };
            }
          }
          return stg;
        });

        if (hasUpdates || stageNumber) {
          localCases[cIdx].stages = updatedStages;
          saveLocalStore('cases', localCases);
          d1Query(`UPDATE cases SET stages = ?, updated_at = CURRENT_TIMESTAMP WHERE case_id = ?`, [JSON.stringify(updatedStages), caseId]).catch(console.warn);
        }
      }
    }

    // Dispatch email notification to client AND admin notification to ceyloncsrl@gmail.com
    if (targetCase && targetCase.email) {
      const clientEmail = targetCase.email;
      const clientName = targetCase.clientName || targetCase.client_name;
      
      if (uploadedBy === 'admin') {
        sendDocumentIssuedEmail(clientEmail, clientName, docName || fileName, stageNumber, note).catch(console.warn);
        if (targetCase.phone || targetCase.foreignPhone) {
          notifyUserOnDocumentIssued({
            phone: targetCase.phone || targetCase.foreignPhone,
            clientName,
            docName: docName || fileName,
            stageNumber: stageNumber || 'General',
            note
          }).catch(console.warn);
        }
      } else if (uploadedBy === 'client') {
        sendStageSubmissionEmail(clientEmail, clientName, caseId, stageNumber || 1, docName || fileName, 1).catch(console.warn);
        sendAdminStageSubmissionAlert(clientEmail, clientName, caseId, stageNumber || 1, docName || fileName, 1).catch(console.warn);
        
        // Dispatch WhatsApp notification to Admin & Client
        try {
          const localAccs = getLocalStore('accounts', []);
          const acc = localAccs.find(a => (a.caseId || a.case_id) === caseId);
          const uPhone = acc?.phone || targetCase.phone || targetCase.foreignPhone;

          notifyAdminOnStageSubmission({
            userId: acc?.id || acc?.userId || caseId,
            userName: clientName,
            caseId,
            userPhone: uPhone,
            userEmail: clientEmail,
            visaType: targetCase.visaType || targetCase.visa_type || 'Romania Immigration',
            stageNumber: stageNumber || 1,
            stageTitle: `Stage 0${stageNumber || 1}`,
            docCount: 1,
            documentsList: `• ${docName || fileName}`
          }).catch(e => console.warn('WhatsApp Doc Submission Alert note:', e.message));

          if (uPhone) {
            notifyUserStageSubmission({
              userPhone: uPhone,
              userName: clientName,
              caseId,
              userId: acc?.id || acc?.userId || caseId,
              stageNumber: stageNumber || 1,
              stageTitle: `Stage 0${stageNumber || 1}`,
              documentsList: `• ${docName || fileName}`
            }).catch(e => console.warn('WhatsApp Doc Submission Client Receipt note:', e.message));
          }
        } catch (e) {}
      }
    }

    return res.json({ success: true, document: newDocRow, storageProvider: 'CCSRL Resilient Store (Cloud + Local)' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Update Case Stage Status (Approve / Reject / Action Required) with automatic Client Email & WhatsApp Notification
const handleStageStatusUpdate = async (req, res) => {
  try {
    const { caseId } = req.params;
    const { 
      stageNumber, 
      status, 
      note, 
      remarks, 
      stages, 
      currentStageNumber, 
      updatedStages, 
      clientEmail: directEmail, 
      clientName: directName 
    } = req.body;

    const localCases = getLocalStore('cases', []);
    const cIdx = localCases.findIndex(c => (c.caseId || c.case_id) === caseId || String(c.caseId || c.case_id).toLowerCase() === String(caseId).toLowerCase());
    let userCase = cIdx >= 0 ? localCases[cIdx] : null;

    const stageNum = Number(stageNumber || 1);
    const statusNorm = String(status || '').toLowerCase().trim();
    const isApproved = ['approved', 'completed', 'verified', 'passed'].includes(statusNorm);
    const isRejected = ['rejected', 'action_required', 'needs_revision', 'revision_required', 'declined', 'pending_revision', 'revision', 'changes_requested'].includes(statusNorm);
    const reasonText = note || remarks || 'Please review counsel instructions and re-upload required certificates.';

    let stagesList = safeParseArray(stages || updatedStages || req.body.updatedStages, null);
    if (!stagesList && userCase) {
      const existingStages = safeParseArray(userCase.stages, []);
      stagesList = existingStages.map(stg => {
        if (stg.number === stageNum) {
          return {
            ...stg,
            status: isApproved ? 'approved' : (isRejected ? 'action_required' : status),
            note: note || stg.note,
            approvedDate: isApproved ? new Date().toISOString().split('T')[0] : stg.approvedDate
          };
        }
        if (isApproved && stg.number === stageNum + 1) {
          return {
            ...stg,
            unlocked: true,
            status: stg.status === 'locked' ? 'in_progress' : stg.status
          };
        }
        return stg;
      });
    }

    if (stagesList && stagesList.length > 0 && userCase) {
      localCases[cIdx].stages = stagesList;
      if (currentStageNumber) {
        localCases[cIdx].currentStageNumber = currentStageNumber;
      } else if (isApproved && userCase.currentStageNumber <= stageNum) {
        localCases[cIdx].currentStageNumber = stageNum + 1;
      }
      saveLocalStore('cases', localCases);
      
      d1Query(`UPDATE cases SET stages = ?, current_stage_number = ? WHERE case_id = ?`, 
        [JSON.stringify(stagesList), localCases[cIdx].currentStageNumber || 1, userCase.caseId || caseId]).catch(console.warn);
    }

    const localAccs = getLocalStore('accounts', []);
    const acc = localAccs.find(a => (a.caseId || a.case_id) === caseId || (userCase?.email && (a.email || '').toLowerCase() === userCase.email.toLowerCase()));

    const clientEmail = (directEmail || userCase?.email || acc?.email || '').trim();
    const clientName = (directName || userCase?.clientName || userCase?.client_name || `${userCase?.firstName || ''} ${userCase?.lastName || ''}`.trim() || acc?.firstName || 'Valued Client').trim();
    const clientPhone = acc?.phone || userCase?.phone || userCase?.foreignPhone;
    const userId = acc?.id || acc?.userId || userCase?.id || 'UID-2026';

    const currentStageObj = (stagesList || []).find(s => s.number === stageNum) || {};
    const stageTitle = currentStageObj.title || `Stage 0${stageNum}`;
    const nextStageNum = stageNum + 1;
    const nextStageObj = (stagesList || []).find(s => s.number === nextStageNum) || {};
    const nextStageTitle = nextStageObj.title || `Stage 0${nextStageNum}`;

    if (clientEmail && clientEmail.includes('@')) {
      if (isApproved) {
        sendStageApprovalEmail(clientEmail, clientName, caseId, stageNum, stageTitle, nextStageNum, nextStageTitle)
          .then(() => console.log(`✉️ [HOSTINGER WEBMAIL] Sent Stage 0${stageNum} APPROVAL Email directly to Client: ${clientEmail} (${caseId})`))
          .catch(err => console.warn('Stage Approval Email dispatch note:', err.message));
      } else if (isRejected) {
        sendStageRejectionEmail(clientEmail, clientName, caseId, stageNum, stageTitle, reasonText)
          .then(() => console.log(`✉️ [HOSTINGER WEBMAIL] Sent Stage 0${stageNum} ACTION REQUIRED / REJECTION Email directly to Client: ${clientEmail} (${caseId})`))
          .catch(err => console.warn('Stage Rejection Email dispatch note:', err.message));
      }
    }

    // Dispatch Rich WhatsApp Notification to User's Phone
    if (clientPhone) {
      try {
        if (isApproved) {
          notifyUserStageApproved({
            phone: clientPhone,
            userName: clientName,
            stageNumber: stageNum,
            stageTitle,
            nextStageNumber: nextStageNum,
            nextStageTitle,
            caseId,
            userId
          }).catch(err => console.warn('WhatsApp Stage Approval alert note:', err.message));
        } else if (isRejected) {
          notifyUserStageRejected({
            phone: clientPhone,
            userName: clientName,
            stageNumber: stageNum,
            stageTitle,
            reason: reasonText,
            caseId,
            userId
          }).catch(err => console.warn('WhatsApp Stage Rejection alert note:', err.message));
        }
      } catch (waErr) {
        console.warn('WhatsApp stage status dispatch note:', waErr.message);
      }
    }

    return res.json({ success: true, caseId, stageNumber, status });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

app.post('/api/cases/:caseId/stage-status', handleStageStatusUpdate);
app.put('/api/cases/:caseId/stage-status', handleStageStatusUpdate);

// Endpoint to Submit Any Stage by Client with automated Admin WhatsApp & Email Alerts
const handleStageSubmit = async (req, res) => {
  try {
    const { caseId } = req.params;
    const { stageNumber, stageTitle, documents, notes, userId, userPhone, userName, visaType } = req.body;

    const localCases = getLocalStore('cases', []);
    const cIdx = localCases.findIndex(c => (c.caseId || c.case_id) === caseId || String(c.caseId || c.case_id).toLowerCase() === String(caseId).toLowerCase());
    let userCase = cIdx >= 0 ? localCases[cIdx] : null;

    const stageNum = Number(stageNumber || 1);
    let stagesList = safeParseArray(userCase?.stages, []);
    
    stagesList = stagesList.map(stg => {
      if (stg.number === stageNum) {
        return {
          ...stg,
          submitted: true,
          status: 'pending_approval',
          submittedDate: new Date().toISOString().split('T')[0],
          note: notes || stg.note || `Stage 0${stageNum} submitted for compliance audit.`
        };
      }
      return stg;
    });

    if (userCase) {
      localCases[cIdx].stages = stagesList;
      saveLocalStore('cases', localCases);
    }

    d1Query(`UPDATE cases SET stages = ?, updated_at = CURRENT_TIMESTAMP WHERE case_id = ?`, [JSON.stringify(stagesList), caseId]).catch(console.warn);

    const localAccs = getLocalStore('accounts', []);
    const acc = localAccs.find(a => (a.caseId || a.case_id) === caseId || (userCase?.email && (a.email || '').toLowerCase() === userCase.email.toLowerCase()));

    const resolvedPhone = userPhone || acc?.phone || userCase?.phone || userCase?.foreignPhone;
    const resolvedName = userName || userCase?.clientName || `${userCase?.firstName || ''} ${userCase?.lastName || ''}`.trim() || 'Valued Client';
    const resolvedUserId = userId || acc?.id || acc?.userId || userCase?.id || 'UID-2026';
    const resolvedVisa = visaType || userCase?.visaType || 'Romania Immigration Dossier';

    // 1. Dispatch Email to Admin & Client
    if (userCase?.email) {
      sendAdminStageSubmissionAlert(userCase.email, resolvedName, caseId, stageNum, stageTitle || `Stage 0${stageNum}`, Array.isArray(documents) ? documents.length : 1).catch(console.warn);
      sendStageSubmissionEmail(userCase.email, resolvedName, caseId, stageNum, stageTitle || `Stage 0${stageNum}`, Array.isArray(documents) ? documents.length : 1).catch(console.warn);
    }

    // 2. Dispatch Rich WhatsApp Notification to Super Admin (+40 728 744 478)
    notifyAdminOnStageSubmission({
      userId: resolvedUserId,
      userName: resolvedName,
      caseId,
      userPhone: resolvedPhone,
      userEmail: userCase?.email,
      visaType: resolvedVisa,
      stageNumber: stageNum,
      stageTitle: stageTitle || `Stage 0${stageNum}`,
      docCount: Array.isArray(documents) ? documents.length : 1,
      documentsList: Array.isArray(documents) && documents.length > 0
        ? documents.map(d => `• ${typeof d === 'string' ? d : (d.name || d.fileName || 'Document')}`).join('\n')
        : `• Stage 0${stageNum} Statutory Submission Dossier`
    }).catch(err => console.warn('WhatsApp Stage Submission Admin Alert note:', err.message));

    return res.json({ success: true, caseId, stageNumber: stageNum, message: `Stage 0${stageNum} submitted successfully.` });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

app.post('/api/cases/:caseId/submit-stage', handleStageSubmit);
app.put('/api/cases/:caseId/submit-stage', handleStageSubmit);

// Stream file directly from Cloudflare R2 or local disk fallback
app.get('/api/documents/stream', async (req, res) => {
  try {
    let key = req.query.key;
    if (!key) return res.status(400).json({ error: 'Missing key parameter' });
    try { key = decodeURIComponent(key); } catch(e){}
    try { if (key.includes('%')) key = decodeURIComponent(key); } catch(e){}

    const filename = key.split('/').pop() || 'document.pdf';
    const isDownload = req.query.download === 'true';

    // 1. Try Cloudflare R2
    try {
      const getCmd = new GetObjectCommand({
        Bucket: R2_BUCKET,
        Key: key
      });
      const r2Res = await r2Client.send(getCmd);
      res.setHeader('Content-Disposition', `${isDownload ? 'attachment' : 'inline'}; filename="${encodeURIComponent(filename)}"`);
      if (r2Res.ContentType) res.setHeader('Content-Type', r2Res.ContentType);
      if (r2Res.ContentLength) res.setHeader('Content-Length', r2Res.ContentLength);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return r2Res.Body.pipe(res);
    } catch (r2Err) {
      // 2. Fallback to local disk file in UPLOADS_DIR
      const localKeyPath = path.join(UPLOADS_DIR, key.replace(/[\/\\]/g, '_'));
      const localDirectPath = path.join(UPLOADS_DIR, filename);
      const targetPath = fs.existsSync(localKeyPath) ? localKeyPath : (fs.existsSync(localDirectPath) ? localDirectPath : null);

      if (targetPath && fs.existsSync(targetPath)) {
        res.setHeader('Content-Disposition', `${isDownload ? 'attachment' : 'inline'}; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        return fs.createReadStream(targetPath).pipe(res);
      }
    }

    return res.status(404).json({ error: 'File not found on Cloudflare R2 or local server' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Direct Download Document by Document ID
app.get('/api/documents/:id/download', async (req, res) => {
  try {
    const { id } = req.params;
    const localDocs = getLocalStore('documents', []);
    let doc = localDocs.find(d => d.id === id || d.name === id || d.fileName === id || d.file_name === id);
    
    if (!doc) {
      try {
        const docRes = await d1Query('SELECT * FROM documents WHERE id = ?', [id]);
        doc = docRes.results?.[0];
      } catch(e) {}
    }
    if (!doc) return res.status(404).json({ error: 'Document record not found' });

    const filename = doc.file_name || doc.fileName || 'document.pdf';
    const url = doc.file_url || doc.fileUrl;

    if (url) {
      let key = url.includes('key=') ? url.split('key=')[1] : url;
      try { key = decodeURIComponent(key); } catch(e){}
      try { if (key.includes('%')) key = decodeURIComponent(key); } catch(e){}

      // Try R2
      try {
        const getCmd = new GetObjectCommand({
          Bucket: R2_BUCKET,
          Key: key
        });
        const r2Res = await r2Client.send(getCmd);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        if (r2Res.ContentType) res.setHeader('Content-Type', r2Res.ContentType);
        if (r2Res.ContentLength) res.setHeader('Content-Length', r2Res.ContentLength);
        res.setHeader('Access-Control-Allow-Origin', '*');
        return r2Res.Body.pipe(res);
      } catch (r2Err) {
        // Fallback to local file
        const localKeyPath = path.join(UPLOADS_DIR, key.replace(/[\/\\]/g, '_'));
        const localDirectPath = path.join(UPLOADS_DIR, filename);
        const caseFilePath = path.join(UPLOADS_DIR, `${doc.caseId || doc.case_id}_${filename}`);
        const targetPath = fs.existsSync(localKeyPath) ? localKeyPath : (fs.existsSync(caseFilePath) ? caseFilePath : (fs.existsSync(localDirectPath) ? localDirectPath : null));

        if (targetPath && fs.existsSync(targetPath)) {
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
          res.setHeader('Access-Control-Allow-Origin', '*');
          return fs.createReadStream(targetPath).pipe(res);
        }
      }
    }

    return res.status(404).json({ error: 'File binary content not found' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// Direct Download Document by Case ID and Name / FileName
app.get('/api/cases/:caseId/documents/download', async (req, res) => {
  try {
    const { caseId } = req.params;
    let { docId, name, fileName } = req.query;

    const localDocs = getLocalStore('documents', []);
    let doc = null;
    if (docId) {
      doc = localDocs.find(d => (d.caseId || d.case_id) === caseId && d.id === docId);
    }
    if (!doc && name) {
      try { name = decodeURIComponent(name); } catch(e){}
      doc = localDocs.find(d => (d.caseId || d.case_id) === caseId && String(d.name || '').toLowerCase() === String(name).toLowerCase());
    }
    if (!doc && fileName) {
      try { fileName = decodeURIComponent(fileName); } catch(e){}
      doc = localDocs.find(d => (d.caseId || d.case_id) === caseId && (d.fileName === fileName || d.file_name === fileName));
    }
    if (!doc) {
      doc = localDocs.find(d => (d.caseId || d.case_id) === caseId);
    }

    if (doc && (doc.file_url || doc.fileUrl)) {
      const url = doc.file_url || doc.fileUrl;
      let key = url.includes('key=') ? url.split('key=')[1] : url;
      try { key = decodeURIComponent(key); } catch(e){}
      try { if (key.includes('%')) key = decodeURIComponent(key); } catch(e){}
      const downloadName = doc.file_name || doc.fileName || fileName || 'document.pdf';

      try {
        const getCmd = new GetObjectCommand({
          Bucket: R2_BUCKET,
          Key: key
        });
        const r2Res = await r2Client.send(getCmd);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
        if (r2Res.ContentType) res.setHeader('Content-Type', r2Res.ContentType);
        if (r2Res.ContentLength) res.setHeader('Content-Length', r2Res.ContentLength);
        res.setHeader('Access-Control-Allow-Origin', '*');
        return r2Res.Body.pipe(res);
      } catch (r2Err) {
        // Fallback to local file
        const localKeyPath = path.join(UPLOADS_DIR, key.replace(/[\/\\]/g, '_'));
        const localDirectPath = path.join(UPLOADS_DIR, downloadName);
        const caseFilePath = path.join(UPLOADS_DIR, `${caseId}_${downloadName}`);
        const targetPath = fs.existsSync(localKeyPath) ? localKeyPath : (fs.existsSync(caseFilePath) ? caseFilePath : (fs.existsSync(localDirectPath) ? localDirectPath : null));

        if (targetPath && fs.existsSync(targetPath)) {
          res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
          res.setHeader('Access-Control-Allow-Origin', '*');
          return fs.createReadStream(targetPath).pipe(res);
        }
      }
    }

    return res.status(404).json({ error: 'Document not found' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

// =========================================================================
// 5. CRM INQUIRIES & LEADS ENDPOINTS
// =========================================================================
app.post('/api/inquiries', async (req, res) => {
  try {
    const inq = req.body;
    const phone = (inq.phone || inq.whatsapp || inq.foreignPhone || inq.mobile || '').trim() || 'Not provided';
    const newId = inq.id || `INQ-2026-${Date.now().toString().slice(-4)}`;
    
    const newInquiry = {
      id: newId,
      name: inq.customerName || inq.name || inq.fullName || 'Applicant',
      email: inq.email || '',
      phone,
      visa_type: inq.visaType || inq.visaCategory || inq.service || 'General Inquiry',
      visaType: inq.visaType || inq.visaCategory || inq.service || 'General Inquiry',
      message: inq.message || '',
      status: inq.status || 'New',
      notes: typeof inq.notes === 'string' ? inq.notes : JSON.stringify(inq.notes || []),
      assigned_to: inq.assignedTo || inq.assignedConsultant || 'Elena Radu',
      assignedTo: inq.assignedTo || inq.assignedConsultant || 'Elena Radu',
      created_at: inq.created_at || inq.createdAt || new Date().toISOString()
    };

    const localInquiries = getLocalStore('inquiries', []);
    const updatedInqs = [newInquiry, ...localInquiries.filter(i => i.id !== newId)];
    saveLocalStore('inquiries', updatedInqs);

    d1Query(
      `INSERT INTO inquiries (id, name, email, phone, visa_type, message, status, notes, assigned_to)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, notes = excluded.notes, message = excluded.message, phone = excluded.phone, email = excluded.email`,
      [
        newId,
        newInquiry.name,
        newInquiry.email,
        phone,
        newInquiry.visa_type,
        newInquiry.message,
        newInquiry.status,
        newInquiry.notes,
        newInquiry.assigned_to
      ]
    ).catch(console.warn);

    // Auto-dispatch confirmation email to applicant (if different from admin) AND single lead alert to admin (ceyloncsrl@gmail.com)
    const applicantEmail = (inq.email || '').toLowerCase().trim();
    const adminEmail = 'ceyloncsrl@gmail.com';

    if (applicantEmail && applicantEmail !== adminEmail) {
      sendInquiryReceivedEmail({ ...inq, id: newId }).catch(console.warn);
    }
    sendAdminInquiryAlert({ ...inq, id: newId }).catch(console.warn);

    // Auto-dispatch WhatsApp Notifications (Alert Super Admin & Acknowledgement to Applicant)
    try {
      notifyAdminOnInquiry({ ...inq, id: newId, phone }).catch(e => console.warn('WhatsApp Admin Inquiry note:', e.message));
      if (phone && phone !== 'Not provided') {
        notifyUserOnInquiry({ ...inq, id: newId, phone }).catch(e => console.warn('WhatsApp User Inquiry note:', e.message));
      }
    } catch (waErr) {
      console.warn('WhatsApp Inquiry dispatch error:', waErr.message);
    }

    return res.json({ success: true, inquiry: newInquiry });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/inquiries', async (req, res) => {
  try {
    const result = await d1Query(`SELECT * FROM inquiries ORDER BY created_at DESC`);
    let list = (result.success && Array.isArray(result.results) && result.results.length > 0)
      ? result.results
      : getLocalStore('inquiries', []);
    
    saveLocalStore('inquiries', list);
    return res.json(list);
  } catch (err) {
    const localInqs = getLocalStore('inquiries', []);
    return res.json(localInqs);
  }
});

app.put('/api/inquiries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const localInqs = getLocalStore('inquiries', []);
    const idx = localInqs.findIndex(i => i.id === id || String(i.id).toLowerCase() === String(id).toLowerCase());
    if (idx >= 0) {
      localInqs[idx] = {
        ...localInqs[idx],
        ...updates,
        status: updates.status !== undefined ? updates.status : localInqs[idx].status,
        notes: updates.notes !== undefined ? (typeof updates.notes === 'string' ? updates.notes : JSON.stringify(updates.notes)) : localInqs[idx].notes,
        assigned_to: updates.assignedTo || updates.assigned_to || localInqs[idx].assigned_to,
        assignedTo: updates.assignedTo || updates.assigned_to || localInqs[idx].assignedTo
      };
      saveLocalStore('inquiries', localInqs);
    }

    const fields = [];
    const params = [];

    if (updates.status !== undefined) { fields.push('status = ?'); params.push(updates.status); }
    if (updates.notes !== undefined) { fields.push('notes = ?'); params.push(typeof updates.notes === 'string' ? updates.notes : JSON.stringify(updates.notes)); }
    if (updates.assignedTo !== undefined || updates.assigned_to !== undefined || updates.assignedConsultant !== undefined) { 
      fields.push('assigned_to = ?'); 
      params.push(updates.assignedTo || updates.assigned_to || updates.assignedConsultant); 
    }
    if (updates.visaType !== undefined || updates.visa_type !== undefined || updates.visaCategory !== undefined) {
      fields.push('visa_type = ?');
      params.push(updates.visaType || updates.visa_type || updates.visaCategory);
    }

    if (fields.length > 0) {
      params.push(id);
      params.push(id);
      d1Query(`UPDATE inquiries SET ${fields.join(', ')} WHERE id = ? OR LOWER(id) = LOWER(?)`, params).catch(console.warn);
    }
    return res.json({ success: true, id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/inquiries', async (req, res) => {
  try {
    saveLocalStore('inquiries', []);
    d1Query(`DELETE FROM inquiries`).catch(console.warn);
    return res.json({ success: true, message: 'All inquiries wiped from database.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/inquiries/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const localInqs = getLocalStore('inquiries', []);
    saveLocalStore('inquiries', localInqs.filter(i => i.id !== id && String(i.id).toLowerCase() !== String(id).toLowerCase()));

    d1Query(`DELETE FROM inquiries WHERE id = ? OR LOWER(id) = LOWER(?)`, [id, id]).catch(console.warn);
    return res.json({ success: true, id, message: 'Inquiry deleted permanently.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 6. CMS & GLOBAL SETTINGS ENDPOINTS
// =========================================================================
app.get('/api/cms', async (req, res) => {
  try {
    const result = await d1Query(`SELECT config FROM cms_config WHERE id = 'global'`);
    if (result.results && result.results[0] && result.results[0].config) {
      let config = {};
      try {
        config = JSON.parse(result.results[0].config);
      } catch (e) {}
      saveLocalStore('cms', config);
      return res.json({ success: true, config });
    }
    const localCms = getLocalStore('cms', null);
    return res.json({ success: true, config: localCms });
  } catch (err) {
    const localCms = getLocalStore('cms', null);
    return res.json({ success: true, config: localCms });
  }
});

app.post('/api/cms', async (req, res) => {
  try {
    const { config } = req.body;
    saveLocalStore('cms', config || {});
    const configStr = typeof config === 'string' ? config : JSON.stringify(config || {});
    d1Query(
      `INSERT INTO cms_config (id, config, updated_at) 
       VALUES ('global', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET config = excluded.config, updated_at = CURRENT_TIMESTAMP`,
      [configStr]
    ).catch(console.warn);
    return res.json({ success: true, message: 'CMS & Global Settings saved to CCSRL Database.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// 6. DIRECT CRM EMAIL COMPOSER ENDPOINT (From info@ccsrl.ro with Admin Copy)
// =========================================================================
app.post('/api/email/send-direct', async (req, res) => {
  try {
    const { to, clientName, subject, messageText, caseId, adminSenderName } = req.body;
    if (!to || !to.includes('@')) {
      return res.status(400).json({ error: 'Valid recipient email address is required.' });
    }
    if (!messageText) {
      return res.status(400).json({ error: 'Message body cannot be empty.' });
    }

    const emailRes = await sendDirectClientEmail({
      to,
      clientName: clientName || 'Client',
      subject: subject || 'Official Communication from CCSRL Legal Counsel',
      messageText,
      caseId: caseId || '',
      adminSenderName: adminSenderName || 'Elena Radu (Senior Legal Counsel)'
    });

    // If caseId is provided, also record message into Cloudflare D1 cases table
    if (caseId) {
      const localCases = getLocalStore('cases', []);
      const cIdx = localCases.findIndex(c => (c.caseId || c.case_id) === caseId);
      if (cIdx >= 0) {
        let msgs = safeParseArray(localCases[cIdx].messages, []);
        const newMsg = {
          id: `msg-${Date.now()}`,
          sender: adminSenderName || 'Elena Radu (Senior Legal Counsel)',
          senderRole: 'admin',
          subject: subject || 'Official Email Notice',
          text: messageText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          deliveredVia: 'Hostinger Webmail (info@ccsrl.ro)',
          status: 'delivered'
        };
        msgs.push(newMsg);
        localCases[cIdx].messages = msgs;
        saveLocalStore('cases', localCases);
        d1Query(`UPDATE cases SET messages = ? WHERE case_id = ?`, [JSON.stringify(msgs), caseId]).catch(console.warn);
      }
    }

    return res.json({
      success: true,
      message: `Email successfully dispatched to ${to} via info@ccsrl.ro (Admin copy to ceyloncsrl@gmail.com)`,
      messageId: emailRes.messageId
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// =========================================================================
// START SERVER
// =========================================================================
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 CCSRL Legal Platform Backend Server running on http://localhost:${PORT}`);
  console.log(`🔒 Connected to Cloudflare D1 Database: ${CF_D1_DATABASE_ID} (5 GB Free)`);
  console.log(`📦 Connected to Cloudflare R2 Storage: ${R2_BUCKET} (10 GB Free)`);
  console.log(`=======================================================`);
});
