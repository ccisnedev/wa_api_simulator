# Alerta: Bloqueo temporal de WhatsApp

> **Severidad:** Alta — puede causar pérdida permanente de sesión.  
> **Aplica a:** Cualquier instancia de wa_api desplegada con Baileys.

---

## Qué es

WhatsApp detecta comportamiento automatizado y bloquea temporalmente la cuenta vinculada. El bloqueo se manifiesta como un `statusCode=401` persistente con `error=Connection Failure` en los logs de Baileys. La sesión queda invalidada y requiere re-escaneo de QR una vez que el bloqueo se levante.

---

## Síntomas

| Señal | Detalle |
|---|---|
| `statusCode=401 error=Connection Failure` | Baileys no puede autenticar la sesión |
| `Logged out — scan QR again via dashboard` | El simulador detecta el logout |
| Crash en `sendRawMessage` con `Error: Connection Closed` | Baileys intenta operar sobre conexión muerta |
| Container en loop de restart | Docker reinicia el proceso, que inmediatamente falla de nuevo |

---

## Causas confirmadas (incidente 2026-04-08)

### 1. Envío a JID inválido

El simulador construye `phoneNumber@s.whatsapp.net` para todos los destinatarios. Pero WhatsApp ahora usa **LIDs** (Linked IDs) como `remoteJid` en mensajes entrantes. Si el sistema recibe un LID (ej: `48915483205670`) y luego intenta enviar a `48915483205670@s.whatsapp.net`, el JID es inválido. El formato correcto para un LID es `lid@lid`.

**Impacto:** WhatsApp interpreta envíos a JIDs inválidos como comportamiento sospechoso.

### 2. Reconexiones rápidas repetidas

Baileys tiene retry automático con backoff, pero en un container Docker con `restart: unless-stopped`, cada crash genera un nuevo proceso que inicia una conexión completamente nueva. En el incidente, se observaron **3+ conexiones en ~20 minutos** antes del bloqueo.

**Impacto:** Múltiples conexiones nuevas desde la misma cuenta en poco tiempo activan las defensas anti-automatización de WhatsApp.

### 3. Loop de restart post-bloqueo (agravante)

Una vez bloqueado, el container sigue en ciclo: arrancar → conectar → 401 → crash → restart (~35 seg/ciclo). Cada intento es un hit adicional contra los servidores de WhatsApp, lo que **extiende la duración del bloqueo**.

---

## Protocolo de respuesta

### Acción inmediata: DETENER el container

```bash
docker stop wa-api-s2   # o el sim afectado
```

**No dejarlo en loop de restart.** Cada intento de conexión fallido empeora el bloqueo.

### Esperar antes de reiniciar

| Tipo de bloqueo | Espera recomendada |
|---|---|
| Primer bloqueo temporal | 30 minutos mínimo |
| Bloqueo recurrente | 2–4 horas |
| Bloqueo persistente (>24h) | La cuenta puede estar baneada — usar otro número |

### Reiniciar con precauciones

1. Limpiar credenciales de sesión antes de reiniciar:
   ```bash
   docker exec wa-api-sN rm -rf /app/auth_info_baileys/*
   ```
2. Iniciar el container:
   ```bash
   docker start wa-api-sN
   ```
3. Escanear QR rápidamente (dentro de los primeros 60 seg).
4. **No enviar mensajes** durante al menos 5 minutos después de vincular.

---

## Lecciones aprendidas

### L1 — No enviar a JIDs no verificados

Antes de enviar un mensaje, validar que el JID es un formato válido:
- Número de teléfono: `{phone}@s.whatsapp.net`
- LID: `{lid}@lid`
- Grupo: `{group}@g.us`

> **Bug pendiente:** El simulador no resuelve LIDs. Ver issue `002-fix-lid-mapping`.

### L2 — Agregar delay entre envíos de múltiples sims

No disparar mensajes desde 2+ sims al mismo destinatario en ráfaga. Agregar un mínimo de 5 segundos entre envíos de diferentes sims.

### L3 — No exponer el container a restarts automáticos sin circuit breaker

El `restart: unless-stopped` de Docker es peligroso cuando el fallo es un bloqueo externo. Implementar una de estas opciones:

- **Opción A:** Usar `restart: on-failure` con `max_retries: 3` en docker-compose.
- **Opción B:** Detectar `statusCode=401` en la app y entrar en modo "sleep" (no reintentar conexión) en lugar de crashear.

### L4 — Monitorear antes de enviar

Después de vincular una sesión, verificar que el health check devuelve `"status": "connected"` y esperar un período de estabilización antes de enviar mensajes.

### L5 — Usar templates para pruebas, no text messages

Los templates de WhatsApp no requieren ventana de 24 horas y tienen validación más robusta. Para pruebas iniciales, siempre preferir templates sobre mensajes de texto.

---

## Referencia rápida

```
¿El container está en loop de restart?
  └─ SÍ → docker stop wa-api-sN → esperar 30 min → reiniciar con QR limpio
  └─ NO → revisar logs con: docker logs wa-api-sN --tail 20

¿El log dice statusCode=401?
  └─ SÍ → bloqueo temporal. DETENER container. Esperar.
  └─ NO → otro error. Revisar Troubleshooting en README.
```
