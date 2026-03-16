import express from 'express'
import multer from 'multer'
import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from 'baileys'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import QRCode from 'qrcode'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 8087
const AUTH_DIR = path.join(__dirname, 'auth')

// State
let sock = null
let qrDataUrl = null
let isConnected = false
let myJid = null

// Express setup
const app = express()
const upload = multer({ 
  dest: '/tmp/wa-relay-uploads/',
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
})

app.use(express.static(path.join(__dirname, 'public')))

// API: Get status
app.get('/api/status', (req, res) => {
  res.json({ 
    connected: isConnected, 
    qr: !isConnected ? qrDataUrl : null,
    jid: myJid 
  })
})

// API: Upload file (any type)
app.post('/api/send', upload.single('file'), async (req, res) => {
  if (!isConnected || !sock || !myJid) {
    return res.status(503).json({ error: 'WhatsApp not connected' })
  }
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' })
  }

  try {
    const buffer = await readFile(req.file.path)
    const mime = req.file.mimetype
    const caption = req.body.caption || ''
    
    // Determine message type
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
    
    // Send to self
    await sock.sendMessage(myJid, message)
    
    res.json({ success: true, sentTo: myJid, type: mime })
  } catch (err) {
    console.error('Send error:', err)
    res.status(500).json({ error: err.message })
  }
})

// Start WhatsApp connection
async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()
  
  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    browser: ['WA Image Relay', 'Chrome', '120.0'],
    generateHighQualityLinkPreview: false,
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
        // Clean auth and restart
        const { execSync } = await import('child_process')
        execSync(`rm -rf ${AUTH_DIR}`)
        setTimeout(startWhatsApp, 1000)
      }
    }
  })
}

// Start
app.listen(PORT, () => {
  console.log(`[Server] Running on port ${PORT}`)
  startWhatsApp()
})
