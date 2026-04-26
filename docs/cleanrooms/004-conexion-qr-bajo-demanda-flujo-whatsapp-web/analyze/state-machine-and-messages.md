---
id: state-machine-and-messages
title: "Diseño: máquina de estados del dashboard y mensajes al usuario"
date: 2026-04-25
status: active
tags: [dashboard, state-machine, ux, messages, design]
author: socrates
---

# Máquina de Estados del Dashboard y Mensajes al Usuario

## 1. Hallazgo clave: Baileys ya limita los QR

El servidor de WhatsApp provee un número fijo de refs para QR (típicamente 5). El ciclo es:
- 1er QR: 60 segundos
- QRs siguientes: 20 segundos cada uno
- Total por ciclo: ~140 segundos
- Al agotar refs → `connection: 'close'` con `statusCode=408` y mensaje "QR refs attempts ended"

**Baileys ya impone un límite natural.** El problema actual es que nuestro auto-reconnect llama `connect()` de nuevo, iniciando un ciclo nuevo indefinidamente.

## 2. Tratamiento por DisconnectReason — Basado en WhatsApp Web

### Categoría A: Transitorios — auto-reconnect con backoff

| Código | Nombre | Mensaje dashboard |
|--------|--------|-------------------|
| 428 | `connectionClosed` | "Reconectando..." + spinner |
| 408 | `connectionLost` (sin QR activo) | "Conexión perdida. Reconectando..." + spinner |
| 503 | `unavailableService` | "Servicio no disponible. Reintentando..." + spinner |

### Categoría B: Terminales — borrar credenciales, mostrar QR screen

| Código | Nombre | Mensaje dashboard | Borrar creds |
|--------|--------|-------------------|-------------|
| 401 | `loggedOut` | "Sesión cerrada. Vincula un dispositivo nuevo." | **SÍ** |
| 500 | `badSession` | "Error de sesión. Se requiere nueva vinculación." | **SÍ** |

WhatsApp Web trata el 500 igual que el 401: sesión irrecuperable, borra datos, vuelve a pantalla de QR.

### Categoría C: Conflicto — notificar sin auto-reconnect

| Código | Nombre | Mensaje dashboard |
|--------|--------|-------------------|
| 440 | `connectionReplaced` | "WhatsApp está abierto en otro lugar. Presiona para usar aquí." |

WhatsApp Web muestra esta pantalla con un botón "Usar aquí". No borra credenciales porque la sesión sigue siendo válida — solo otro cliente la tomó.

### Categoría D: Requiere acción — no auto-reconnect

| Código | Nombre | Mensaje dashboard |
|--------|--------|-------------------|
| 403 | `forbidden` | "Acceso prohibido. Posible restricción de cuenta." |
| 411 | `multideviceMismatch` | "Versión incompatible. Actualiza el simulador." |
| 515 | `restartRequired` | "El servidor requiere reinicio." (auto-restart) |

### Categoría E: QR timeout — esperar acción del usuario

| Código | Nombre | Mensaje dashboard |
|--------|--------|-------------------|
| 408 | `timedOut` (con QR activo) | "Código QR expirado." + botón "Recargar QR" |

## 3. Estados del Dashboard — Máquina de estados completa

```
                          ┌─────────────────┐
                          │      IDLE        │ ← Boot sin credenciales
                          │                  │   "Vincular dispositivo"
                          │  [Botón: Vincular│   [Botón]
                          │   dispositivo]   │
                          └────────┬─────────┘
                                   │ usuario presiona botón
                                   ▼
                          ┌─────────────────┐
                          │   PAIRING_QR     │ ← QR visible, ~140s total
                          │                  │   "Escanea con WhatsApp"
                          │  [QR image]      │   [Imagen QR]
                          └────┬────┬────────┘
                    escaneo OK │    │ refs agotados (408)
                               │    ▼
                               │  ┌─────────────────┐
                               │  │   QR_EXPIRED     │
                               │  │                  │ "QR expirado"
                               │  │ [Botón: Recargar]│ [Botón]
                               │  └────────┬─────────┘
                               │           │ usuario presiona
                               │           │ (vuelve a PAIRING_QR)
                               ▼
┌──────────────┐        ┌─────────────────┐
│  CONNECTING  │◄───────│    CONNECTED    │ ← Sesión activa
│              │ close  │                 │   "Conectado · +51933182642"
│ "Conectando."│ 428/503│ [Botón: Cerrar  │
│ [Spinner]    │◄───────│  sesión]        │
└──────┬───────┘        └─────────────────┘
       │ open                    ▲
       └─────────────────────────┘

Boot con credenciales → CONNECTING (spinner) → CONNECTED o error
```

### Transiciones por evento

| Desde | Evento | Hacia | Acción |
|-------|--------|-------|--------|
| — | Boot sin `creds.json` | IDLE | Nada |
| — | Boot con `creds.json` | CONNECTING | `connect()` automático |
| IDLE | Click "Vincular" | PAIRING_QR | `connect()` |
| PAIRING_QR | QR escaneado OK | CONNECTED | — |
| PAIRING_QR | 408 (refs agotados) | QR_EXPIRED | Detener socket |
| QR_EXPIRED | Click "Recargar" | PAIRING_QR | `connect()` nuevo |
| CONNECTING | `connection='open'` | CONNECTED | — |
| CONNECTING | 401 / 500 | IDLE | Borrar `creds.json` |
| CONNECTING | 440 | REPLACED | Mostrar mensaje + botón |
| CONNECTED | 428 / 408 / 503 | CONNECTING | Auto-reconnect |
| CONNECTED | 401 / 500 | IDLE | Borrar `creds.json` |
| CONNECTED | 440 | REPLACED | Mostrar mensaje |
| REPLACED | Click "Usar aquí" | CONNECTING | `connect()` |

## 4. Mensajes honestos — lenguaje usuario

| Estado | Badge | Mensaje principal | Submensaje |
|--------|-------|-------------------|------------|
| IDLE | 🔴 Desconectado | — | "No hay sesión vinculada" |
| PAIRING_QR | 🟡 Vinculando | "Escanea el código QR con WhatsApp" | "Abre WhatsApp → Dispositivos vinculados → Vincular dispositivo" |
| QR_EXPIRED | 🟡 QR expirado | "El código QR expiró" | — |
| CONNECTING | 🟡 Conectando | "Conectando a WhatsApp..." | — |
| CONNECTED | 🟢 Conectado | "+51XXXXXXXXX" | — |
| REPLACED | 🟠 Reemplazado | "WhatsApp está abierto en otro lugar" | — |
| ERROR | 🔴 Error | (varía por tipo) | — |

## 5. receivedPendingNotifications — estado "sincronizando"

Después de `connection='open'` con sesión existente, Baileys emite:
1. `receivedPendingNotifications: false` → sincronizando historial
2. `receivedPendingNotifications: true` → listo

Para el dashboard del simulador, este estado es transparente. El operador no necesita saber que se están descargando mensajes históricos. Mostrar "Conectado" desde que `connection='open'` llega es suficiente. El sync ocurre en segundo plano.

La razón: esto no es WhatsApp Web donde el usuario ve sus chats cargando. Es un simulador de API — el operador solo necesita saber si puede enviar/recibir mensajes.

## Referencias

- [Baileys socket.ts — QR generation](https://github.com/WhiskeySockets/Baileys/blob/master/src/Socket/socket.ts) (líneas ~580-610)
- [Baileys example.ts — disconnect handling](https://github.com/WhiskeySockets/Baileys/blob/master/Example/example.ts)
- [Baileys Types/index.ts — DisconnectReason enum](https://github.com/WhiskeySockets/Baileys/blob/master/src/Types/index.ts)
