# Wendy Chat Relay

A private, secure, and ephemeral chat relay for OpenClaw.

## Features
- **OpenClaw 3.0 Protocol Support**: Handles the `connect.challenge` and `chat.send` protocol logic.
- **Ephemeral Multi-Key Authentication**: Supports multiple temporary access keys. Keys are destroyed immediately upon disconnection.
- **Admin APIs**: Secure endpoints to refresh and retrieve active keys.
- **Cloudflare Tunnel Ready**: Built-in support for HTTPS/WSS environments.

## Setup
1. `npm install`
2. Configure `GATEWAY_TOKEN` and `GATEWAY_PASSWORD` in `server.js` (or use environment variables).
3. `node server.js`

## Security
This relay is designed to be used as a secure gateway to your local OpenClaw instance.
