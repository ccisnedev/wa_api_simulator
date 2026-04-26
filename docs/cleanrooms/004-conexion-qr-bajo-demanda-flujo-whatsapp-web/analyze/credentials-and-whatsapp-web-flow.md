---
id: credentials-and-whatsapp-web-flow
title: "Evidencia: qué son credenciales en Baileys y cómo funciona el flujo de WhatsApp Web"
date: 2026-04-25
status: active
tags: [baileys, credentials, whatsapp-web, qr-code, evidence]
author: socrates
---

# Evidencia: Credenciales en Baileys y Flujo de WhatsApp Web

## 1. ¿Qué son "credenciales existentes" en Baileys?

### Fuente: código de Baileys (`use-multi-file-auth-state.ts`)

La función `useMultiFileAuthState` determina si hay sesión previa con una sola línea:

```typescript
const creds: AuthenticationCreds = (await readData('creds.json')) || initAuthCreds()
```

- Si `creds.json` existe → carga las credenciales almacenadas
- Si `creds.json` NO existe → crea credenciales frescas con `initAuthCreds()`

**"Credenciales existentes" = el archivo `creds.json` existe en el directorio `auth_info_baileys/`.**

### Fuente: README de Baileys

> "so if valid credentials are available -- it'll connect without QR"

Cuando `creds.json` tiene las claves de cifrado (noiseKey, signedIdentityKey, etc.) y el campo `me` con el JID del teléfono, Baileys intenta reconectar usando esas claves en lugar de generar QR.

### Evidencia material: instancias en GCP

| Campo | S1 (activa) | S2 (bloqueada) |
|-------|------------|----------------|
| `creds.json` tamaño | 3089 bytes | 2914 bytes |
| `registered` | `false` | `false` |
| `me` | `51933182642:1@s.whatsapp.net` | `51933152391:1@s.whatsapp.net` |
| `account` presente | sí | sí |
| Archivos en directorio | ~850+ (pre-keys, sync-keys, lid-mappings) | ~850+ (estructura idéntica) |

**Hallazgo clave:** No se puede distinguir "credenciales válidas" de "credenciales invalidadas" a nivel de filesystem. Ambas instancias tienen la misma estructura. La única forma de saber si la sesión es válida es intentar conectar — si Meta invalidó la sesión, Baileys recibirá `statusCode=401` (loggedOut).

### Implicación para el diseño

La decisión de arranque debe ser:
- `creds.json` EXISTE → intentar `connect()`. Si falla con 401, transicionar a modo "vincular dispositivo"
- `creds.json` NO EXISTE → modo "vincular dispositivo" desde el inicio

## 2. Flujo de WhatsApp Web para vincular dispositivos

### Comportamiento observado

1. **Abrir web.whatsapp.com** sin sesión almacenada
2. Se muestra pantalla de QR con instrucciones para escanear
3. El QR se refresca cada ~20 segundos automáticamente
4. Después de ~5 QR sin escaneo (~100 segundos), el QR expira
5. Se muestra botón verde: **"Click to reload QR code"**
6. Si el usuario clickea → nuevo ciclo de QR (nueva conexión WebSocket)
7. **No hay generación infinita de QR** — se detiene y espera acción del usuario

### Con sesión almacenada

1. WhatsApp Web intenta reconectar automáticamente (muestra spinner)
2. Si la sesión es válida → conecta directo (sin QR)
3. Si la sesión fue revocada → muestra pantalla de QR (nuevo vinculamiento necesario)

### Comportamiento de Baileys (implementación)

- Baileys emite `connection.update` con campo `qr` cada ~20 segundos
- Cada QR es un string que representa los datos de pairing
- Después de varias emisiones sin escaneo, Baileys cierra la conexión
- Esto dispara `connection: 'close'` con un statusCode (típicamente `408` o `428`)
- El cierre por timeout de QR NO es lo mismo que una desconexión de sesión activa

## 3. Causa del bloqueo de S2

**Confirmado por el usuario:** El QR estuvo reintentando durante mucho tiempo antes de que finalmente se conectara. Este es el patrón que disparó la detección de Meta.

**Patrón peligroso (actual):**
```
Boot → connect() → QR generado → timeout → auto-reconnect → QR generado → timeout → auto-reconnect → ... (horas/días)
```

**Patrón seguro (WhatsApp Web):**
```
Boot → sin credenciales → esperar acción del usuario → usuario clickea "Vincular" → QR generado → timeout → "Recargar QR" → esperar acción del usuario
```

La diferencia crítica: WhatsApp Web **nunca genera QR sin intervención humana**. Cada ciclo de QR requiere una acción explícita del usuario.

## 4. El campo `registered` (aclaración)

El campo `registered: false` en ambas instancias NO indica que las credenciales son inválidas. Este campo es específico del flujo de **Pairing Code** (vinculación por número de teléfono, sin QR). En el flujo de QR, este campo no tiene relevancia para determinar el estado de la sesión.

## Referencias

- [Baileys `use-multi-file-auth-state.ts`](https://github.com/WhiskeySockets/Baileys/blob/master/src/Utils/use-multi-file-auth-state.ts)
- [Baileys README — Saving & Restoring Sessions](https://github.com/WhiskeySockets/Baileys#saving--restoring-sessions)
- [WhatsApp FAQ — About linked devices](https://faq.whatsapp.com/378279804439436)
- [WhatsApp FAQ — How to link a device](https://faq.whatsapp.com/1317564962315842)
- [GCP VM `/opt/wa-api/s1/auth_info_baileys/`] — inspección directa
- [GCP VM `/opt/wa-api/s2/auth_info_baileys/`] — inspección directa
