---
id: retrospective
title: "Retrospectiva — Issue #4: Conexión QR bajo demanda"
date: 2026-04-25
status: completed
author: basho
---

# Retrospectiva — Issue #4: Conexión QR bajo demanda

## Qué se implementó

1. **BaileysSession refactorizado** — campos `isPairing`, `dashboardState`, `statusMessage`; método `hasCredentials()`; handler de `connection='close'` categorizado por DisconnectReason (6 categorías: QR timeout, terminal, conflicto, transitorio, fatal, restart)
2. **Boot condicional en main.ts** — `session.connect()` solo si `creds.json` existe
3. **Dashboard API actualizada** — 7 estados en `/api/session/status`, `statusMessage` en cada respuesta, corrección crítica: `reconnect` usa `disconnect(false)` en vez de `disconnect(true)`
4. **Dashboard frontend** — 7 estados visuales (IDLE, PAIRING_QR, QR_EXPIRED, CONNECTING, CONNECTED, REPLACED, ERROR), spinner CSS, botones contextuales, mensajes honestos en español

## Cómo verificar

1. `npm test` — 110 tests pasan (1 fallo pre-existente en config.test.ts)
2. `npx tsc --noEmit` — compilación limpia
3. Test manual sin creds: borrar `auth_info_baileys/`, `npm run dev`, dashboard muestra IDLE con botón "Vincular dispositivo"
4. Test manual con creds: `npm run dev` con creds existentes, dashboard muestra CONNECTING → CONNECTED

## Limitaciones conocidas

- **Test manual 4.9 pendiente** — requiere conexión real a WhatsApp (QR → escaneo → expiración)
- **Pairing Code no implementado** — vinculación alternativa por número de teléfono queda fuera de scope
- **Rate limiting** — no hay límite de intentos de vinculación desde el dashboard
- **El fallo en config.test.ts es pre-existente** — no introducido por estos cambios

## Qué salió bien

- El plan de 5 fases fue mecánico — cada paso tenía entrada/salida clara
- La corrección de `disconnect(true)` → `disconnect(false)` en reconnect fue detectada en la fase de planificación (DESCARTES), no en ejecución
- El mock expandido de `DisconnectReason` en tests permite cubrir todos los códigos
- Cero dependencias nuevas

## Qué se desvió del plan

- Nada significativo. Todas las fases se ejecutaron según el plan.
- El paso 2.3 (verificación manual sin creds) se pospone a la verificación del usuario.

## Qué sorprendió

- El import de `rmSync` en `disconnect()` usaba `await import('node:fs')` dinámico, pero `handleConnectionUpdate` es síncrono — se resolvió importando `rmSync` estáticamente al inicio del archivo.
- `app.test.ts` también usaba `DashboardSession` como tipo del mock — requirió agregar los nuevos métodos ahí también.

## Issues derivados

- **config.test.ts fallo pre-existente**: el test "throws for each missing required variable" falla — no relacionado con issue #4, pero debería investigarse.
- **Pairing Code**: flujo alternativo de vinculación por número de teléfono — puede ser issue separado si se necesita.
- **Rate limiting en dashboard**: prevenir abuso de intentos de vinculación repetidos.
