---
id: plan
title: "Plan — Issue #4: Conexión QR bajo demanda — flujo WhatsApp Web"
date: 2026-04-25
status: draft
tags: [plan, qr-code, whatsapp-web, baileys, dashboard, state-machine]
author: descartes
---

# Plan — Issue #4: Conexión QR bajo demanda

## Hipótesis

Si implementamos boot condicional, QR bajo demanda, y manejo correcto de DisconnectReason por categoría, el simulador replicará el flujo de WhatsApp Web y evitará que Meta detecte automatización por generación de QR sin intervención humana.

---

## Fase 1: Session — Estado interno y manejo de disconnect

**Entrada:** diagnosis.md, `src/baileys/session.ts` actual  
**Salida:** `BaileysSession` con `isPairing`, `hasCredentials()`, manejo de disconnect por categoría  
**Archivos:** `src/baileys/session.ts`, tests

- [x] 1.1 Agregar campo privado `isPairing: boolean = false` a `BaileysSession`
- [x] 1.2 Agregar campo privado `dashboardState: string = 'idle'` con valores: `'idle'|'pairing_qr'|'qr_expired'|'connecting'|'connected'|'replaced'|'error'`
- [x] 1.3 Agregar campo privado `statusMessage: string = ''`
- [x] 1.4 Agregar método público `hasCredentials(): boolean` — verifica existencia de `<authDir>/creds.json` con `existsSync`
- [x] 1.5 Agregar métodos públicos `getDashboardStatus(): string` y `getStatusMessage(): string`
- [x] 1.6 Modificar `connect()`:
  - Si `!hasCredentials()` → `isPairing = true`, `dashboardState = 'pairing_qr'`
  - Si `hasCredentials()` → `isPairing = false`, `dashboardState = 'connecting'`
- [x] 1.7 Modificar handler de evento `qr` en `handleConnectionUpdate`:
  - Setear `dashboardState = 'pairing_qr'` (ya seteaba `connected = false`)
- [x] 1.8 Modificar handler de `connection='open'`:
  - `isPairing = false`, `dashboardState = 'connected'`, `statusMessage = ''`
- [x] 1.9 Refactorizar handler de `connection='close'` por categoría de DisconnectReason:
  - **QR timeout** (408 + `isPairing`): `dashboardState = 'qr_expired'`, `statusMessage = 'El código QR expiró'`, NO auto-reconnect, limpiar QR
  - **Terminal** (401, 500): borrar directorio `auth_info_baileys/` con `rmSync({recursive:true,force:true})`, `dashboardState = 'idle'`, `statusMessage = 'Sesión cerrada por WhatsApp'`, `isPairing = false`, NO auto-reconnect
  - **Conflicto** (440): `dashboardState = 'replaced'`, `statusMessage = 'WhatsApp está abierto en otro dispositivo'`, NO auto-reconnect
  - **Transitorio** (428, 503, 408 sin `isPairing`): `dashboardState = 'connecting'`, auto-reconnect con backoff existente
  - **Fatal** (403, 411): `dashboardState = 'error'`, `statusMessage` descriptivo, NO auto-reconnect
  - **Restart** (515): auto-restart inmediato
- [x] 1.10 Escribir tests unitarios para `hasCredentials()`:
  - Test con `creds.json` existente → `true`
  - Test sin `creds.json` → `false`
- [x] 1.11 Escribir tests unitarios para `handleConnectionUpdate` por cada categoría:
  - Test 408 + isPairing → qr_expired, no reconnect
  - Test 408 + !isPairing → connecting, sí reconnect
  - Test 401 → idle, creds borradas
  - Test 500 → idle, creds borradas
  - Test 440 → replaced, no reconnect
  - Test 428 → connecting, sí reconnect
  - Test 503 → connecting, sí reconnect
- [x] 1.12 Ejecutar `npm test` — todos los tests pasan (1 fallo pre-existente en config.test.ts, no relacionado)

**Verificación pseudocódigo:**
```
// Test: QR timeout no auto-reconecta
session.isPairing = true
session.handleClose(408)
assert session.dashboardState == 'qr_expired'
assert session.reconnectAttempts == 0  // no se intentó

// Test: 401 borra creds
session.handleClose(401)
assert !existsSync('auth_info_baileys/creds.json')
assert session.dashboardState == 'idle'

// Test: 408 sin QR sí reconecta
session.isPairing = false  
session.handleClose(408)
assert session.dashboardState == 'connecting'
assert session.reconnectAttempts > 0
```

**Riesgos:**
- 408 discriminado por `isPairing` puede fallar si la red cae durante pairing — aceptable, el usuario recarga QR
- `rmSync` de auth dir es destructivo — pero es exactamente lo que 401/500 requieren

---

## Fase 2: main.ts — Boot condicional

**Entrada:** Fase 1 completa (`hasCredentials()` disponible)  
**Salida:** Server arranca sin `connect()` cuando no hay creds  
**Archivos:** `src/main.ts`

- [x] 2.1 Reemplazar `await session.connect()` (L69) por:
  ```typescript
  if (session.hasCredentials()) {
    await session.connect();
  } else {
    logger.info('No credentials found — waiting for device linking via dashboard');
  }
  ```
- [x] 2.2 Ejecutar `npm test` — todos los tests pasan
- [ ] 2.3 Verificación manual: arrancar sin creds → server inicia, no genera QR, log visible

**Verificación:** Server arranca sin errores en ambos escenarios. Sin creds: no hay output de QR ni intento de conexión.

---

## Fase 3: Dashboard API — Nuevos estados y corrección de reconnect

**Entrada:** Fase 2 completa  
**Salida:** API `/api/session/status` expone todos los estados, `reconnect` no borra creds  
**Archivos:** `src/routes/dashboard.route.ts`, tests

- [ ] 3.1 Extender `DashboardSession` interface: agregar `getDashboardStatus(): string` y `getStatusMessage(): string`
- [ ] 3.2 Modificar `GET /api/session/status` para usar `getDashboardStatus()`:
  ```
  idle         → { status: 'idle', statusMessage }
  pairing_qr   → { status: 'pairing_qr', qr, qrDataUrl, statusMessage }
  qr_expired   → { status: 'qr_expired', statusMessage }
  connecting    → { status: 'connecting', statusMessage }
  connected     → { status: 'connected', phone, statusMessage }
  replaced      → { status: 'replaced', statusMessage }
  error         → { status: 'error', statusMessage }
  ```
- [ ] 3.3 **CORRECCIÓN:** Modificar `POST /api/session/reconnect` — cambiar `disconnect(true)` a `disconnect(false)`. Este endpoint se reutiliza para "Vincular dispositivo", "Recargar QR" y "Usar aquí" — ninguno debe borrar creds
- [ ] 3.4 Actualizar tests de dashboard.route para los nuevos estados (`idle`, `pairing_qr`, `qr_expired`, `replaced`)
- [ ] 3.5 Ejecutar `npm test` — todos los tests pasan

**Verificación:** `curl /api/session/status` retorna el estado correcto según el `dashboardState` interno de la sesión.

**Riesgo:** Endpoints de logout y reconnect comparten la misma sesión — no hay race condition porque Express es single-thread por request.

---

## Fase 4: Dashboard Frontend — UI con todos los estados

**Entrada:** Fase 3 completa (API funcional con nuevos estados)  
**Salida:** `dashboard/index.html` con UI para todos los estados  
**Archivos:** `src/dashboard/index.html`

- [ ] 4.1 Estado IDLE: badge rojo "Desconectado", mensaje "No hay sesión vinculada", botón verde "Vincular dispositivo" → `POST /api/session/reconnect`
- [ ] 4.2 Estado PAIRING_QR: badge amarillo "Vinculando", imagen QR, texto "Abre WhatsApp > Dispositivos vinculados > Vincular dispositivo > Escanea el código QR"
- [ ] 4.3 Estado QR_EXPIRED: badge amarillo "QR expirado", mensaje "El código QR expiró", botón verde "Recargar QR" → `POST /api/session/reconnect`
- [ ] 4.4 Estado CONNECTING: badge amarillo "Conectando", spinner CSS animado, mensaje "Conectando a WhatsApp..."
- [ ] 4.5 Estado CONNECTED: badge verde "Conectado", número de teléfono, botón rojo "Cerrar sesión" → `POST /api/session/logout`
- [ ] 4.6 Estado REPLACED: badge naranja "Sesión reemplazada", mensaje "WhatsApp está abierto en otro dispositivo", botón verde "Usar aquí" → `POST /api/session/reconnect`
- [ ] 4.7 Estado ERROR: badge rojo "Error", `statusMessage` del servidor, sin botón de acción automática
- [ ] 4.8 Actualizar función de polling para manejar todos los `status` strings del API
- [ ] 4.9 Test manual end-to-end:
  - Arrancar sin creds → IDLE → click "Vincular" → PAIRING_QR → esperar ~140s → QR_EXPIRED → click "Recargar" → PAIRING_QR nuevo
  - Arrancar con creds → CONNECTING → CONNECTED
  - En CONNECTED → "Cerrar sesión" → IDLE

**Verificación:** Todos los estados son visibles y navegables. El flujo completo replica WhatsApp Web.

---

## Fase 5: Retrospectiva y validación final

**Entrada:** Fases 1-4 completas  
**Salida:** Suite verde, build OK, documentación de cierre

- [ ] 5.1 Ejecutar `npm test` — suite completa pasa
- [ ] 5.2 Ejecutar `npm run build` (o `npx tsc --noEmit`) — TypeScript compila sin errores
- [ ] 5.3 Revisión de regresión: verificar que instancia con creds existentes (simular s1) arranca y reconecta normalmente
- [ ] 5.4 Producir `retrospective.md`:
  - Qué salió bien
  - Qué se desvió del plan
  - Qué sorprendió
  - Issues derivados identificados
- [ ] 5.5 Producir validation report: qué se implementó, cómo verificar, limitaciones conocidas

**Verificación:** Todos los tests pasan, build limpio, retrospectiva documenta el ciclo.
