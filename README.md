# WA Image Relay

Upload de imagens/vídeos/arquivos via web que envia direto pro WhatsApp.

## Features

- 📸 Drag & drop de arquivos
- 📋 Paste (Ctrl+V) de imagens do clipboard
- 👀 Preview antes de enviar
- 💬 Legenda opcional
- 📜 Histórico de envios na sessão
- 🌙 Dark mode
- 📦 Aceita imagem, vídeo e arquivos até 50MB

## Stack

- **Express** — HTTP server
- **Baileys** — WhatsApp Web API (não-oficial)
- **Multer** — Upload handling
- **QRCode** — QR code generation para pareamento
- **Sharp** — Image processing

## Setup

```bash
npm install
node server.mjs
```

Na primeira execução, acesse `http://localhost:8087` e escaneie o QR code com o WhatsApp.

A sessão fica salva em `auth/` — nas próximas vezes conecta automaticamente.

## Uso

1. Abra a URL no browser
2. Arraste um arquivo ou cole uma imagem (Ctrl+V)
3. Opcionalmente adicione uma legenda
4. Clique em enviar
5. O arquivo aparece na conversa consigo mesmo no WhatsApp

## Config

- Porta padrão: `8087`
- Envia para o próprio número (self-chat)
- Limite de upload: 50MB
