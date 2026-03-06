# 📸 WA Image Relay

Web page with drag-and-drop / paste (Ctrl+V) image upload that sends files directly to your own WhatsApp (self-chat) via [Baileys](https://github.com/WhiskeySockets/Baileys).

![Dark mode UI](https://img.shields.io/badge/UI-dark%20mode-1a1a1a) ![Node.js](https://img.shields.io/badge/Node.js-22-green) ![Docker](https://img.shields.io/badge/Docker-ready-blue)

## Features

- 📷 Drag-and-drop, click, or paste (Ctrl+V) to upload
- 🖼️ Image, video, and file support (up to 50MB)
- 💬 Optional caption
- 📱 QR code pairing (scan with WhatsApp)
- 🌙 Dark mode UI
- 📜 Send history
- 🐳 Docker Compose ready

## Quick Start with Docker

```bash
docker-compose up -d
```

Open `http://localhost:8087` and scan the QR code with WhatsApp.

## Quick Start without Docker

```bash
npm install
node server.mjs
```

Open `http://localhost:8087` and scan the QR code.

## How It Works

1. Start the server → QR code appears on the web page
2. Scan the QR with WhatsApp (Menu ⋮ → Linked Devices → Link a Device)
3. Upload images/videos/files → they get sent to your own WhatsApp chat
4. Access them from any device where you're logged into WhatsApp

## Tech Stack

- **Backend:** Express + [Baileys](https://github.com/WhiskeySockets/Baileys) (WhatsApp Web API)
- **Frontend:** Vanilla HTML/CSS/JS (single file)
- **Upload:** Multer (50MB limit)
- **QR:** qrcode (generates QR as data URL)

## Configuration

| Env Variable | Default | Description |
|---|---|---|
| `PORT` | `8087` | Server port (not yet configurable, edit `server.mjs`) |

## Notes

- WhatsApp session is stored in `auth/` directory (Docker volume `wa-auth`)
- Session may expire — if disconnected, restart and scan QR again
- This is for personal use — sends to your own number only
