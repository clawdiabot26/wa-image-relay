import express from 'express'
import multer from 'multer'
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from 'baileys'
import { readFile, writeFile, access } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import QRCode from 'qrcode'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 8087
const AUTH_DIR = path.join(__dirname, 'auth')
const PASSWORD_FILE = path.join(__dirname, '.password')

// ─── Password helpers ───────────────────────────────────────
function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(plain, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(plain, stored) {
  const [salt, hash] = stored.split(':')
  const check = scryptSync(plain, salt, 64).toString('hex')
  return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'))
}

async function isPasswordSet() {
  try { await access(PASSWORD_FILE); return true } catch { return false }
}

async function getStoredPassword() {
  return (await readFile(PASSWORD_FILE, 'utf-8')).trim()
}

async function setPassword(plain) {
  await writeFile(PASSWORD_FILE, hashPassword(plain), 'utf-8')
}

// ─── Session tokens (in-memory, survive page reload via cookie) ──
const sessions = new Map() // token -> { expires }
const SESSION_TTL = 24 * 60 * 60 * 1000 // 24h

function createSession() {
  const token = randomBytes(32).toString('hex')
  sessions.set(token, { expires: Date.now() + SESSION_TTL })
  return token
}

function isValidSession(token) {
  if (!token) return false
  const s = sessions.get(token)
  if (!s) return false
  if (Date.now() > s.expires) { sessions.delete(token); return false }
  return true
}

// Clean expired sessions periodically
setInterval(() => {
  for (const [token, s] of sessions) {
    if (Date.now() > s.expires) sessions.delete(token)
  }
}, 60 * 60 * 1000)

// ─── State ──────────────────────────────────────────────────
let sock = null
let qrDataUrl = null
let isConnected = false
let myJid = null

// ─── Express setup ──────────────────────────────────────────
const app = express()
app.use(express.json())
const upload = multer({ 
  dest: '/tmp/wa-relay-uploads/',
  limits: { fileSize: 50 * 1024 * 1024 }
})

// ─── Auth middleware ────────────────────────────────────────
function getToken(req) {
  return req.headers['x-session-token'] || req.query._token || null
}

async function requireAuth(req, res, next) {
  const hasPassword = await isPasswordSet()
  if (!hasPassword) {
    // No password set yet — allow through (setup page will handle)
    return next()
  }
  const token = getToken(req)
  if (isValidSession(token)) return next()
  return res.status(401).json({ error: 'Não autenticado', needsAuth: true })
}

// ─── Auth API ───────────────────────────────────────────────

// Check if password is configured
app.get('/api/auth/status', async (req, res) => {
  const hasPassword = await isPasswordSet()
  const token = getToken(req)
  const authenticated = isValidSession(token)
  res.json({ hasPassword, authenticated })
})

// Set password (first time only)
app.post('/api/auth/setup', async (req, res) => {
  const hasPassword = await isPasswordSet()
  if (hasPassword) {
    return res.status(400).json({ error: 'Senha já definida' })
  }
  const { password } = req.body
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Senha deve ter no mínimo 4 caracteres' })
  }
  await setPassword(password)
  const token = createSession()
  res.json({ success: true, token })
})

// Login
app.post('/api/auth/login', async (req, res) => {
  const hasPassword = await isPasswordSet()
  if (!hasPassword) {
    return res.status(400).json({ error: 'Senha ainda não definida' })
  }
  const { password } = req.body
  if (!password) {
    return res.status(400).json({ error: 'Senha obrigatória' })
  }
  try {
    const stored = await getStoredPassword()
    if (!verifyPassword(password, stored)) {
      return res.status(401).json({ error: 'Senha incorreta' })
    }
    const token = createSession()
    res.json({ success: true, token })
  } catch {
    return res.status(401).json({ error: 'Senha incorreta' })
  }
})

// Logout
app.post('/api/auth/logout', (req, res) => {
  const token = getToken(req)
  if (token) sessions.delete(token)
  res.json({ success: true })
})

// ─── Protected routes ───────────────────────────────────────

// Serve static ONLY the index.html (login page handles auth in frontend)
app.use(express.static(path.join(__dirname, 'public')))

// Protected API routes
app.get('/api/status', requireAuth, (req, res) => {
  res.json({ 
    connected: isConnected, 
    qr: !isConnected ? qrDataUrl : null,
    jid: myJid 
  })
})

app.post('/api/send', requireAuth, upload.single('file'), async (req, res) => {
  if (!isConnected || !sock || !myJid) {
    return res.status(503).json({ error: 'WhatsApp not connected' })
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  try {
    const buffer = await readFile(req.file.path)
    const mime = req.file.mimetype
    const caption = req.body.caption || ''
    
    let message
    if (mime.startsWith('image/')) {
      message = { image: buffer, caption: caption || undefined, mimetype: mime }
    } else if (mime.startsWith('video/')) {
      message = { video: buffer, caption: caption || undefined, mimetype: mime }
    } else if (mime.startsWith('audio/')) {
      message = { audio: buffer, mimetype: mime, ptt: false }
    } else {
      message = { 
        document: buffer, 
        mimetype: mime, 
        fileName: req.file.originalname,
        caption: caption || undefined
      }
    }
    
    await sock.sendMessage(myJid, message)
    res.json({ success: true, sentTo: myJid, type: mime })
  } catch (err) {
    console.error('Send error:', err)
    res.status(500).json({ error: err.message })
  }
})

// ─── WhatsApp ───────────────────────────────────────────────
async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()
  
  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    browser: ['WA File Relay', 'Chrome', '120.0'],
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    markOnlineOnConnect: false,
    fireInitQueries: false,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    
    if (qr) {
      console.log('[WA] QR code received')
      qrDataUrl = await QRCode.toDataURL(qr, { width: 300 })
    }
    
    if (connection === 'open') {
      isConnected = true
      myJid = sock.user?.id
      qrDataUrl = null
      console.log(`[WA] Connected as ${myJid}`)
    }
    
    if (connection === 'close') {
      isConnected = false
      const reason = lastDisconnect?.error?.output?.statusCode
      console.log(`[WA] Disconnected, reason: ${reason}`)
      
      if (reason !== DisconnectReason.loggedOut) {
        console.log('[WA] Reconnecting...')
        setTimeout(startWhatsApp, 3000)
      } else {
        console.log('[WA] Logged out, scan QR again')
        const { execSync } = await import('child_process')
        execSync(`rm -rf ${AUTH_DIR}`)
        setTimeout(startWhatsApp, 1000)
      }
    }
  })
}

app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`)
  startWhatsApp()
})
