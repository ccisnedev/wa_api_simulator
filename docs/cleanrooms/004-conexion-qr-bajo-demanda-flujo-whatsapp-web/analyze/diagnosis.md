---
id: diagnosis
title: "Diagnóstico: Conexión QR bajo demanda — flujo WhatsApp Web"
date: 2026-04-25
status: completed
tags: [diagnosis, qr-code, whatsapp-web, baileys, dashboard, state-machine]
author: socrates
---

# Diagnóstico: Conexión QR bajo demanda — flujo WhatsApp Web

## Problema

Al iniciar el servidor wa_api, `session.connect()` se ejecuta incondicionalmente (main.ts L69). Si no hay sesión válida, Baileys genera QR codes. Si nadie escanea, el auto-reconnect reinicia el ciclo de QR indefinidamente. Meta detectó este patrón como automatización y bloqueó la cuenta s2.

**Causa raíz:** el auto-reconnect no distingue entre "reconexión de sesión activa" (legítimo) y "reintento de QR pairing" (peligroso). Ambos ejecutan el mismo `connect()` → auto-reconnect loop.

## Decisiones tomadas

### D1: "Credenciales existentes" = `creds.json` presente

Baileys usa `useMultiFileAuthState` que verifica una sola condición:
```typescript
const creds = (await readData('creds.json')) || initAuthCreds()
```
Verificado con evidencia material: las instancias s1 (activa) y s2 (bloqueada) son indistinguibles en el filesystem. La validez solo se puede determinar intentando conectar.

- `creds.json` presente → intentar `connect()` automáticamente
- `creds.json` ausente → modo IDLE, esperar acción del usuario

### D2: Credenciales terminales (401, 500) se borran

WhatsApp Web borra datos locales al recibir sesión invalidada. Baileys' README implica no reconectar en logout. Conservar creds inválidas causa un ciclo innecesario en el próximo boot.

- `loggedOut` (401): borrar `auth_info_baileys/`, transición a IDLE
- `badSession` (500): mismo tratamiento — sesión corrupta irrecuperable

### D3: QR solo bajo demanda del usuario

WhatsApp Web nunca genera QR sin intervención humana. Cada ciclo de QR requiere un click explícito. El servidor de WhatsApp provee ~5 refs de QR por conexión (~140 segundos). Baileys ya impone ese límite. El fix: no auto-reconectar cuando el close ocurrió con QR activo.

### D4: connectionReplaced (440) no borra credenciales

La sesión sigue válida — otro cliente la tomó. Mostrar mensaje + botón "Usar aquí".

### D5: receivedPendingNotifications no se expone al dashboard

El sync es transparente para el operador del simulador. "Conectado" desde `connection='open'`.

## Máquina de estados del dashboard

### Estados

| Estado | Condición | UI |
|--------|-----------|-----|
| **IDLE** | Sin `creds.json` o creds borradas | Badge rojo "Desconectado" + botón "Vincular dispositivo" |
| **PAIRING_QR** | `connect()` emitió QR | Badge amarillo "Vinculando" + imagen QR + instrucciones |
| **QR_EXPIRED** | 408 con QR activo | Badge amarillo "QR expirado" + botón "Recargar QR" |
| **CONNECTING** | `connect()` con creds, esperando respuesta | Badge amarillo "Conectando" + spinner |
| **CONNECTED** | `connection='open'` | Badge verde "Conectado" + teléfono + botón "Cerrar sesión" |
| **REPLACED** | 440 | Badge naranja "Reemplazado" + botón "Usar aquí" |

### Transiciones

| Desde | Evento | Hacia | Acción |
|-------|--------|-------|--------|
| — | Boot sin `creds.json` | IDLE | Nada |
| — | Boot con `creds.json` | CONNECTING | `connect()` |
| IDLE | Click "Vincular" | PAIRING_QR | `connect()` |
| PAIRING_QR | QR escaneado OK | CONNECTED | — |
| PAIRING_QR | 408 (refs agotados) | QR_EXPIRED | Detener socket |
| QR_EXPIRED | Click "Recargar" | PAIRING_QR | `connect()` |
| CONNECTING | `connection='open'` | CONNECTED | — |
| CONNECTING | 401 / 500 | IDLE | Borrar creds |
| CONNECTING | 440 | REPLACED | Mostrar mensaje |
| CONNECTED | 428 / 408(sin QR) / 503 | CONNECTING | Auto-reconnect con backoff |
| CONNECTED | 401 / 500 | IDLE | Borrar creds |
| CONNECTED | 440 | REPLACED | Mostrar mensaje |
| REPLACED | Click "Usar aquí" | CONNECTING | `connect()` |

### Tratamiento de DisconnectReason

| Categoría | Códigos | Acción | Borrar creds |
|-----------|---------|--------|:---:|
| Transitorio | 428, 503, 408(sin QR) | Auto-reconnect + spinner | No |
| Terminal | 401, 500 | IDLE + limpiar auth | **Sí** |
| Conflicto | 440 | REPLACED + botón | No |
| QR timeout | 408(con QR) | QR_EXPIRED + botón | No |
| Fatal | 403, 411 | Error + mensaje | No |
| Restart | 515 | Auto-restart | No |

## Componentes a modificar

### 1. `baileys/session.ts` — BaileysSession

- **Boot condicional:** verificar existencia de `creds.json` antes de llamar `connect()`
- **Estado interno:** agregar campo para rastrear si hay QR activo (`isPairing`)
- **handleConnectionUpdate:** usar `isPairing` para distinguir QR timeout de network close
- **Borrado de creds:** en 401 y 500, ejecutar `rmSync` del directorio auth
- **No auto-reconnect en pairing:** si `isPairing` y close → no reconectar

### 2. `main.ts` — Boot sequence

- Verificar existencia de `creds.json` antes de `session.connect()`
- Si no hay creds → no llamar `connect()`, server arranca en modo IDLE

### 3. `routes/dashboard.route.ts` — API endpoints

- Nuevo estado `idle` en `/api/session/status`
- Nuevo endpoint o reutilizar `reconnect` para "iniciar vinculación"
- Exponer nuevo campo `statusMessage` con mensajes descriptivos

### 4. `dashboard/index.html` — Frontend

- Nuevo estado IDLE con botón "Vincular dispositivo"
- Estado QR_EXPIRED con botón "Recargar QR"
- Estado REPLACED con botón "Usar aquí"
- Mensajes honestos según tabla de estados

## Constraintes

- No romper el flujo de instancias ya conectadas (s1) — el boot con creds existentes debe funcionar igual
- No introducir nuevas dependencias npm
- Mantener compatibilidad con los scripts de deploy existentes (`03-deploy.ps1`)
- Los tests existentes deben seguir pasando

## Riesgos

| Riesgo | Mitigación |
|--------|-----------|
| Romper reconexión de s1 en producción | Tests unitarios del handleConnectionUpdate con cada DisconnectReason |
| Race condition entre check de creds y connect | Verificar creds.json sincrónicamente antes de connect() |
| El 408 de QR y de red son el mismo código | Usar `this.qrCode !== undefined` como discriminador |

## Scope

### Entra
- Boot condicional basado en existencia de creds.json
- Dashboard con estados IDLE, PAIRING_QR, QR_EXPIRED, CONNECTING, CONNECTED, REPLACED
- Borrado de credenciales en 401/500
- No auto-reconnect durante pairing
- Mensajes honestos al usuario

### No entra
- Pairing Code (vinculación por número de teléfono) — flujo alternativo a QR
- Rate limiting de intentos de vinculación
- Métricas de conexión/desconexión
- Cambios en la infraestructura de deploy

## Referencias

- [credentials-and-whatsapp-web-flow.md](analyze/credentials-and-whatsapp-web-flow.md) — Evidencia sobre credenciales y flujo WA Web
- [disconnect-reasons-and-states.md](analyze/disconnect-reasons-and-states.md) — DisconnectReason, ConnectionState, estados intermedios
- [state-machine-and-messages.md](analyze/state-machine-and-messages.md) — Máquina de estados y mensajes al usuario
- [Baileys socket.ts](https://github.com/WhiskeySockets/Baileys/blob/master/src/Socket/socket.ts) — QR generation, connection lifecycle
- [Baileys example.ts](https://github.com/WhiskeySockets/Baileys/blob/master/Example/example.ts) — Patrón de reconnect
