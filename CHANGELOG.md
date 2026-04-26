# Changelog
All notable changes to this project will be documented in this file.

The format loosely follows [Keep a Changelog](https://keepachangelog.com/)
and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-04-25

### Added
- On-demand QR linking via dashboard — WhatsApp Web flow (#4)
- Dashboard state machine: IDLE, PAIRING_QR, QR_EXPIRED, CONNECTING, CONNECTED, REPLACED, ERROR
- Conditional boot: server starts without `connect()` when no credentials exist
- `hasCredentials()`, `getDashboardStatus()`, `getStatusMessage()` methods on BaileysSession
- DisconnectReason handling by category (terminal, transient, conflict, QR timeout, fatal, restart)
- Spinner animation and contextual buttons per dashboard state

### Changed
- `POST /api/session/reconnect` uses `disconnect(false)` instead of `disconnect(true)` — no longer destroys credentials on reconnect
- `disconnect()` now resets `dashboardState`, `isPairing`, and `statusMessage`

### Fixed
- Infinite QR generation loop that caused Meta to block account s2
- Dashboard showing "Teléfono conectado" after logout (stale dashboardState)
- Error state now shows "Vincular dispositivo" button for user recovery
- `config.test.ts` asserting optional env vars are required

