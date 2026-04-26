---
id: plan
title: "Plan — Issue #4: Conexión QR bajo demanda"
date: 2026-04-25
status: active
tags: [plan, qr-code, whatsapp-web, baileys, dashboard, state-machine]
author: descartes
input: ../analyze/diagnosis.md
---

# Plan — Issue #4: Conexión QR bajo demanda

## Hipótesis

Si implementamos boot condicional, QR bajo demanda, y manejo correcto de DisconnectReason, el simulador replicará el flujo de WhatsApp Web y evitará que Meta detecte automatización por ciclos de QR sin intervención humana.

## Observaciones de la evidencia

Antes de planificar, verifiqué el código fuente contra el diagnóstico. Tres puntos merecen mención:

1. **`/api/session/reconnect` actual hace `disconnect(clearAuth=true)`** — borra creds siempre. Para el estado REPLACED ("Usar aquí") necesitamos `disconnect(clearAuth=false)`. El plan separa los endpoints.
2. **`DisconnectReason` en el mock de tests** solo define `loggedOut: 401`. Los tests nuevos necesitarán los códigos reales: 401, 408, 428, 440, 500, 503, 515, 403, 411.
3. **El discriminador QR vs red para 408** — el diagnóstico propone `isPairing`. Verificado que `this.qrCode !== undefined` es más preciso: si hay QR activo al momento del 408, es timeout de QR; si no, es timeout de red. Esto es lo que usará el plan.

---

## Fase 1: Session — Estado interno y boot condicional

**Entrada:** diagnosis.md verificado, `src/baileys/session.ts` actual (196 líneas)
**Salida:** `BaileysSession` con estado de dashboard, `hasCredentials()`, manejo completo de DisconnectReason, sin cambios en routes ni HTML

### Cambios en `src/baileys/session.ts`

- [ ] 1.1 Agregar tipo `DashboardState` como union literal:
  ```typescript
  type DashboardState = 'idle' | 'pairing_qr' | 'qr_expired' | 'connecting' | 'connected' | 'replaced' | 'error';
  ```
- [ ] 1.2 Agregar campos privados:
  - `dashboardState: DashboardState` — inicializado en `'idle'`
  - `statusMessage: string` — inicializado en `''`
  - `isPairing: boolean` — inicializado en `false` (true cuando connect() se invoca sin creds)
- [ ] 1.3 Agregar método público `hasCredentials(): boolean` — verifica `existsSync(path.join(this.config.authDir, 'creds.json'))`. Import `existsSync` de `node:fs` y `path` de `node:path`.
- [ ] 1.4 Agregar método público `dashboardStatus(): { state: DashboardState; statusMessage: string }` — retorna `{ state: this.dashboardState, statusMessage: this.statusMessage }`.
- [ ] 1.5 Modificar `connect()`:
  - Antes de crear socket: si `!this.hasCredentials()`, setear `this.isPairing = true` y `this.dashboardState = 'pairing_qr'`
  - Si `this.hasCredentials()`, setear `this.isPairing = false` y `this.dashboardState = 'connecting'`
  - Setear `this.statusMessage` según el caso: `'Esperando escaneo de código QR…'` o `'Conectando a WhatsApp…'`
- [ ] 1.6 Modificar `handleConnectionUpdate` — bloque `qr`:
  - Mantener `this.qrCode = qr`
  - Setear `this.dashboardState = 'pairing_qr'`, `this.statusMessage = 'Escanea el código QR con WhatsApp'`
- [ ] 1.7 Modificar `handleConnectionUpdate` — bloque `connection === 'open'`:
  - Agregar: `this.isPairing = false`, `this.dashboardState = 'connected'`, `this.statusMessage = ''`
- [ ] 1.8 Reescribir `handleConnectionUpdate` — bloque `connection === 'close'`:
  - Extraer `statusCode` como antes
  - Agregar import de todos los `DisconnectReason` codes necesarios del enum de Baileys
  - Implementar switch/if-else por categoría:
    - **408 con QR activo** (`statusCode === 408 && this.qrCode !== undefined`): `dashboardState = 'qr_expired'`, `statusMessage = 'El código QR expiró — haz click en Recargar'`, `this.qrCode = undefined`, `this.isPairing = false`, NO auto-reconnect
    - **401 (loggedOut) y 500 (badSession)**: borrar `auth_info_baileys/` con `rmSync(this.config.authDir, { recursive: true, force: true })`, `dashboardState = 'idle'`, `statusMessage = 'Sesión cerrada — vincula un dispositivo'`, `this.qrCode = undefined`, `this.isPairing = false`, NO auto-reconnect
    - **440 (connectionReplaced)**: `dashboardState = 'replaced'`, `statusMessage = 'WhatsApp se abrió en otro dispositivo'`, `this.qrCode = undefined`, NO auto-reconnect
    - **428 (connectionClosed), 503 (unavailableService), 408 sin QR**: auto-reconnect con backoff existente, `dashboardState = 'connecting'`, `statusMessage = 'Reconectando…'`
    - **515 (restartRequired)**: auto-reconnect inmediato (backoff = 0 o 1s), `dashboardState = 'connecting'`, `statusMessage = 'Reiniciando conexión…'`
    - **403 (forbidden), 411 (multideviceMismatch)**: `dashboardState = 'error'`, `statusMessage` descriptivo del error, NO auto-reconnect
    - **Default** (códigos no mapeados): auto-reconnect con backoff si < MAX_RECONNECT_ATTEMPTS
- [ ] 1.9 Modificar `disconnect()`: resetear `this.dashboardState = 'idle'`, `this.statusMessage = ''`, `this.isPairing = false`

### Tests — `src/__tests__/baileys/session.test.ts`

- [ ] 1.10 Ampliar el mock de `DisconnectReason` en `vi.mock('@whiskeysockets/baileys')` para incluir todos los códigos: `loggedOut: 401`, `badSession: 500`, `connectionReplaced: 440`, `connectionClosed: 428`, `unavailableService: 503`, `timedOut: 408`, `restartRequired: 515`, `forbidden: 403`, `multideviceMismatch: 411`
- [ ] 1.11 Test: `hasCredentials()` retorna `false` cuando no existe `creds.json` — mockear `existsSync` con `vi.mock('node:fs')` para retornar false
- [ ] 1.12 Test: `hasCredentials()` retorna `true` cuando existe `creds.json` — mockear `existsSync` para retornar true
- [ ] 1.13 Test: `connect()` sin creds setea `dashboardState = 'pairing_qr'` y `isPairing = true` — usar `hasCredentials` mockeado
- [ ] 1.14 Test: `connect()` con creds setea `dashboardState = 'connecting'` y `isPairing = false`
- [ ] 1.15 Test: `connection='open'` → `dashboardState = 'connected'`, `isPairing = false`
- [ ] 1.16 Test: close con 408 + QR activo → `dashboardState = 'qr_expired'`, NO se programa reconnect
- [ ] 1.17 Test: close con 408 sin QR → `dashboardState = 'connecting'`, SÍ se programa reconnect
- [ ] 1.18 Test: close con 401 → `dashboardState = 'idle'`, `rmSync` llamado con authDir, NO reconnect
- [ ] 1.19 Test: close con 500 → `dashboardState = 'idle'`, `rmSync` llamado con authDir, NO reconnect
- [ ] 1.20 Test: close con 440 → `dashboardState = 'replaced'`, NO reconnect
- [ ] 1.21 Test: close con 428 → `dashboardState = 'connecting'`, SÍ reconnect
- [ ] 1.22 Test: close con 503 → `dashboardState = 'connecting'`, SÍ reconnect
- [ ] 1.23 Test: close con 515 → `dashboardState = 'connecting'`, SÍ reconnect
- [ ] 1.24 Test: close con 403 → `dashboardState = 'error'`, NO reconnect
- [ ] 1.25 Ejecutar `npm test` — todos los tests pasan (nuevos y existentes)

**Verificación:**
- `dashboardStatus()` retorna el estado correcto después de cada evento
- `rmSync` solo se llama en 401 y 500
- Auto-reconnect solo ocurre en 428, 503, 408(sin QR), 515, y códigos no mapeados
- Tests existentes (7 tests en session.test.ts) siguen pasando sin modificación

**Riesgos:**
- Mockear `existsSync` puede interferir con otros mocks de Baileys que usan el filesystem → mitigar con `vi.mock` scoped al test
- El timer de `setTimeout` para reconnect necesita `vi.useFakeTimers` para ser verificable → usar `vi.spyOn(global, 'setTimeout')` para verificar que se llama (o no)

---

## Fase 2: Boot condicional en main.ts

**Entrada:** Fase 1 completa — `BaileysSession.hasCredentials()` disponible
**Salida:** Server arranca en modo IDLE cuando no hay creds, connect() solo si hay creds

### Cambios en `src/main.ts`

- [ ] 2.1 Reemplazar el bloque de la línea 69-73:
  ```typescript
  // Antes:
  session.connect().then(...)

  // Después:
  if (session.hasCredentials()) {
    session.connect().then(() => {
      logger.info('Baileys session connection initiated');
    }).catch((err) => {
      logger.error(err, 'Failed to initiate Baileys connection');
    });
  } else {
    logger.info('No credentials found — waiting for QR linking via dashboard');
  }
  ```
- [ ] 2.2 Ejecutar `npm test` — todos los tests pasan
- [ ] 2.3 Verificación manual: arrancar server sin `auth_info_baileys/` → log muestra "No credentials found", no hay error, dashboard accesible

**Verificación:** Server arranca limpiamente en ambos escenarios. No hay cambios en tests porque main.ts no tiene test unitario (es el entry point).

**Riesgos:** Ninguno significativo — cambio mínimo y aditivo.

---

## Fase 3: Dashboard API — Nuevos estados y endpoints

**Entrada:** Fase 2 completa — `BaileysSession` expone `dashboardStatus()` y `statusMessage`
**Salida:** API retorna 6 estados, endpoint de vinculación no borra creds

### Cambios en `src/routes/dashboard.route.ts`

- [ ] 3.1 Ampliar interface `DashboardSession`:
  ```typescript
  export interface DashboardSession extends SessionStatusProvider {
    currentQR(): string | undefined;
    disconnect(clearAuth?: boolean): Promise<void>;
    connect(): Promise<void>;
    dashboardStatus(): { state: string; statusMessage: string };
  }
  ```
- [ ] 3.2 Reescribir handler `GET /api/session/status` para usar `dashboardStatus()`:
  ```typescript
  router.get('/api/session/status', async (_req, res) => {
    const { state, statusMessage } = session.dashboardStatus();
    const base: Record<string, any> = { status: state, statusMessage };

    if (state === 'connected') {
      base.phone = session.phoneNumber();
    }
    if (state === 'pairing_qr') {
      const qr = session.currentQR();
      if (qr) {
        base.qr = qr;
        base.qrDataUrl = await QRCode.toDataURL(qr, { width: 260 });
      }
    }
    res.json(base);
  });
  ```
- [ ] 3.3 Modificar `POST /api/session/reconnect` — NO borrar creds (es para "Vincular" o "Usar aquí"):
  ```typescript
  router.post('/api/session/reconnect', async (_req, res) => {
    await session.disconnect(false);  // <-- cambio: false en vez de true
    await session.connect();
    res.json({ ok: true });
  });
  ```
  - Logout (`POST /api/session/logout`) ya usa `disconnect(true)` — no cambia.
- [ ] 3.4 Verificar que el endpoint `/api/session/logout` sigue funcionando (ya existe, no cambia)

### Tests — `src/__tests__/routes/dashboard.test.ts`

- [ ] 3.5 Actualizar `createMockSession()` para incluir `dashboardStatus`:
  ```typescript
  function createMockSession(overrides: Partial<DashboardSession> = {}): DashboardSession {
    return {
      isConnected: () => false,
      phoneNumber: () => undefined,
      currentQR: () => undefined,
      disconnect: vi.fn(async () => {}),
      connect: vi.fn(async () => {}),
      dashboardStatus: () => ({ state: 'idle', statusMessage: '' }),
      ...overrides,
    };
  }
  ```
- [ ] 3.6 Test: status retorna `{ status: 'idle', statusMessage: '...' }` cuando `dashboardStatus()` retorna `state: 'idle'`
- [ ] 3.7 Test: status retorna `{ status: 'pairing_qr', qr, qrDataUrl, statusMessage }` cuando hay QR
- [ ] 3.8 Test: status retorna `{ status: 'qr_expired', statusMessage }` sin QR ni qrDataUrl
- [ ] 3.9 Test: status retorna `{ status: 'connected', phone, statusMessage }` con teléfono
- [ ] 3.10 Test: status retorna `{ status: 'replaced', statusMessage }` para estado reemplazado
- [ ] 3.11 Test: status retorna `{ status: 'connecting', statusMessage }` sin QR
- [ ] 3.12 Test: reconnect llama `disconnect(false)` (no `true`) y luego `connect()`
- [ ] 3.13 Test existente de logout sigue pasando (verifica `disconnect(true)`)
- [ ] 3.14 Ejecutar `npm test` — todos los tests pasan

**Verificación:**
- `curl /api/session/status` retorna el estado correcto según el estado interno de la sesión
- Reconnect no borra credenciales
- Logout sí borra credenciales
- Los 4 tests existentes de dashboard siguen pasando (posiblemente con ajuste del mock)

**Riesgos:**
- Los tests existentes de dashboard usan la lógica vieja (3 estados). Los tests 3.6-3.11 reemplazan la cobertura de los tests actuales. Verificar que los tests originales se actualizan, no se borran sin reemplazo.

---

## Fase 4: Dashboard Frontend — UI con todos los estados

**Entrada:** Fase 3 completa — API funcional con 6 estados
**Salida:** `src/dashboard/index.html` muestra todos los estados con botones y mensajes correctos

### Cambios en `src/dashboard/index.html`

- [ ] 4.1 Agregar clases CSS para nuevos estados:
  - `.status-pairing` (amarillo, reutilizar `.status-connecting`)
  - `.status-expired` (amarillo)
  - `.status-replaced` (naranja: `background: #ff9800`)
  - `.status-error` (rojo, reutilizar `.status-disconnected`)
  - `.status-idle` (rojo, reutilizar `.status-disconnected`)
- [ ] 4.2 Agregar contenedor para `statusMessage`:
  ```html
  <p id="status-message" class="info" style="display:none;"></p>
  ```
- [ ] 4.3 Renombrar botón "Reconectar" a "Vincular dispositivo" en estado IDLE, mantener texto dinámico según estado
- [ ] 4.4 Reescribir función `updateUI(data)` con switch sobre `data.status`:
  - **`idle`**: badge rojo "Desconectado", botón verde "Vincular dispositivo" (llama `doReconnect()`), mostrar statusMessage
  - **`pairing_qr`**: badge amarillo "Vinculando", imagen QR, texto statusMessage, sin botones
  - **`qr_expired`**: badge amarillo "QR expirado", botón verde "Recargar QR" (llama `doReconnect()`), mostrar statusMessage
  - **`connecting`**: badge amarillo "Conectando", spinner/texto "Conectando…", sin botones
  - **`connected`**: badge verde "Conectado", teléfono, botón rojo "Cerrar sesión" (llama `doLogout()`)
  - **`replaced`**: badge naranja "Reemplazado", botón verde "Usar aquí" (llama `doReconnect()`), mostrar statusMessage
  - **`error`**: badge rojo "Error", mostrar statusMessage, botón "Vincular dispositivo"
- [ ] 4.5 Agregar badge text en español según estado (textos hardcoded en HTML, no dependen del API)
- [ ] 4.6 Verificar que el polling sigue funcionando con los nuevos status strings — `setInterval(pollStatus, 2000)` no cambia

### Verificación manual

- [ ] 4.7 Arrancar sin creds → dashboard muestra "Desconectado" + botón "Vincular dispositivo"
- [ ] 4.8 Click "Vincular dispositivo" → transición a "Vinculando" + QR visible
- [ ] 4.9 Esperar ~140s sin escanear → transición a "QR expirado" + botón "Recargar QR"
- [ ] 4.10 Click "Recargar QR" → nuevo QR visible
- [ ] 4.11 Arrancar con creds válidas → "Conectando" → "Conectado" + teléfono + botón "Cerrar sesión"
- [ ] 4.12 Click "Cerrar sesión" → transición a "Desconectado" (IDLE)

**Verificación:** Todos los estados son visibles y navegables en el browser. El flujo completo IDLE → QR → EXPIRED → QR → CONNECTED → LOGOUT → IDLE funciona.

**Riesgos:**
- El HTML no tiene tests automatizados (es un SPA inline). La verificación es manual. Aceptable para un dashboard interno.

---

## Fase 5: Integración, validación y retrospectiva

**Entrada:** Fases 1-4 completas
**Salida:** Suite verde, build limpio, flujo validado end-to-end

- [ ] 5.1 Ejecutar `npm test` — suite completa pasa (los 16+ archivos de test)
- [ ] 5.2 Ejecutar `npx tsc --noEmit` — TypeScript compila sin errores
- [ ] 5.3 Test de integración manual: arrancar servidor fresco (sin `auth_info_baileys/`) → flujo QR completo → verificar estados en dashboard
- [ ] 5.4 Test de compatibilidad: copiar creds de s1 → arrancar → verificar que boot con creds funciona igual que antes (CONNECTING → CONNECTED)
- [ ] 5.5 Verificar que `POST /api/session/logout` borra creds y deja en IDLE
- [ ] 5.6 Verificar que `POST /api/session/reconnect` desde REPLACED no borra creds
- [ ] 5.7 Review de código: verificar que no hay `console.log` sueltos, que los imports son correctos, que no se introdujeron dependencias nuevas
- [ ] 5.8 Commit con mensaje: `feat(wa_api): QR bajo demanda, boot condicional, manejo de DisconnectReason (#4)`

**Verificación final:** El servidor es seguro para producción — no generará ciclos de QR sin intervención humana, no romperá instancias existentes con creds válidas.

---

## Resumen de archivos modificados

| Archivo | Fase | Tipo de cambio |
|---------|------|---------------|
| `src/baileys/session.ts` | 1 | Estado interno, hasCredentials(), handleConnectionUpdate reescrito |
| `src/__tests__/baileys/session.test.ts` | 1 | 15 tests nuevos para DisconnectReason y estados |
| `src/main.ts` | 2 | Boot condicional (3 líneas) |
| `src/routes/dashboard.route.ts` | 3 | Interface ampliada, status reescrito, reconnect corregido |
| `src/__tests__/routes/dashboard.test.ts` | 3 | Mock actualizado, 8 tests nuevos/actualizados |
| `src/dashboard/index.html` | 4 | CSS, updateUI() reescrita, textos en español |

## Dependencias entre fases

```
Fase 1 (session.ts + tests)
    ↓
Fase 2 (main.ts boot condicional)
    ↓
Fase 3 (dashboard API + tests)
    ↓
Fase 4 (dashboard HTML)
    ↓
Fase 5 (validación)
```

Cada fase es independientemente committable. Después de Fase 1, el server funciona igual que antes (el dashboard no consume los nuevos estados aún). Después de Fase 2, el server no genera QR loops. Las Fases 3 y 4 exponen la nueva funcionalidad al usuario.
