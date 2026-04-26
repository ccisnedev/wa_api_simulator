---
id: disconnect-reasons-and-states
title: "Evidencia: DisconnectReason, ConnectionState y estados intermedios de Baileys"
date: 2026-04-25
status: active
tags: [baileys, disconnect-reason, connection-state, events]
author: socrates
---

# DisconnectReason, ConnectionState y Estados Intermedios

## 1. DisconnectReason — Todos los códigos

Fuente: [Baileys `Types/index.ts`](https://github.com/WhiskeySockets/Baileys/blob/master/src/Types/index.ts)

| Código | Nombre | Significado | ¿Auto-reconnect? |
|--------|--------|-------------|-------------------|
| 401 | `loggedOut` | Sesión revocada (desde teléfono o por Meta) | **NO** — sesión terminada |
| 403 | `forbidden` | Acceso prohibido | NO — posible ban |
| 408 | `connectionLost` / `timedOut` | Timeout de red o de QR | Depende del contexto* |
| 411 | `multideviceMismatch` | Versión de protocolo incompatible | NO — requiere actualización |
| 428 | `connectionClosed` | WebSocket cerrado por el servidor | SÍ — transitorio |
| 440 | `connectionReplaced` | Otra sesión reemplazó esta | NO — conflicto |
| 500 | `badSession` | Sesión corrupta | NO — requiere limpieza |
| 503 | `unavailableService` | Servicio no disponible temporalmente | SÍ — transitorio |
| 515 | `restartRequired` | Servidor requiere reinicio del cliente | SÍ — con restart |

*El código 408 se usa tanto para timeout de red como para timeout de QR. No se pueden distinguir por código solo — hay que usar contexto (¿había QR activo?).

## 2. ConnectionState — Interfaz completa

Fuente: [Baileys `Types/State.ts`](https://github.com/WhiskeySockets/Baileys/blob/master/src/Types/State.ts)

```typescript
type ConnectionState = {
    connection: 'open' | 'connecting' | 'close'
    lastDisconnect?: { error: Boom | Error; date: Date }
    isNewLogin?: boolean                    // ← true en primera conexión post-QR
    qr?: string                            // ← solo presente durante pairing
    receivedPendingNotifications?: boolean  // ← sync completado
    isOnline?: boolean                     // ← visible como "en línea"
}
```

### Campos relevantes para el diseño

- **`isNewLogin`**: Baileys lo pone `true` cuando es un vinculamiento nuevo (post-QR scan). Distingue reconexión de sesión existente vs. nueva vinculación.
- **`qr`**: Solo presente durante el flujo de pairing. Ausente durante reconexión de sesión válida.
- **`receivedPendingNotifications`**: Cuando pasa a `true` después de `connection='open'`, significa que el sync inicial completó. El "estado de carga" termina aquí.

## 3. Estados intermedios — ¿Existen en Baileys?

### No disponibles (multi-device)
- "Teléfono sin conexión" — **no existe**. En multi-device, cada dispositivo opera independientemente.
- "Batería baja" — **no existe** como evento en multi-device.
- "Haz clic para actualizar" — **no existe** como evento. El `restartRequired` (515) es lo más cercano.

### Disponibles
- **Syncing** (via `receivedPendingNotifications=false` + `connection='open'`): dispositivo conectado pero descargando historial.
- **Online/Offline** (via `isOnline`): si el cliente se muestra como activo.

## 4. Comportamiento actual de session.ts ante 401

El código actual (líneas 180-200) ya maneja el 401 correctamente:
- No intenta auto-reconnect
- Limpia el QR
- Loguea warning

Pero **NO borra las credenciales**. Las credenciales inválidas permanecen en el filesystem.

## Referencias

- [Baileys Types/index.ts — DisconnectReason](https://github.com/WhiskeySockets/Baileys/blob/master/src/Types/index.ts)
- [Baileys Types/State.ts — ConnectionState](https://github.com/WhiskeySockets/Baileys/blob/master/src/Types/State.ts)
- [Baileys Types/Events.ts — BaileysEventMap](https://github.com/WhiskeySockets/Baileys/blob/master/src/Types/Events.ts)
