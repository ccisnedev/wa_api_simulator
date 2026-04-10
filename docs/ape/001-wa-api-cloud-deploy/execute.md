# Execute: Desplegar wa_api en Compute Engine

> APE State: **EXECUTE**  
> Plan: [plan.md](plan.md) (v4 — VM compartida)

---

## Log de ejecución

### 2026-04-09

**Pasos 1–2 — ya completados en sesión anterior:**

- Paso 1: Código modificado (`config.ts`, `main.ts`, `app.ts`) — webhook opcional. Build limpio, 88 tests.
- Paso 2: `infra/Dockerfile` creado — multi-stage Node 20 Alpine.

**Paso 3 — .env files actualizados:**

- `.env.production.s1`: PORT=3001 (ya estaba)
- `.env.production.s2`: PORT cambiado de 3001 a 3002
- `.env.production.example`: PORT actualizado a 300N con comentario

**Paso 4 — Scripts reescritos para VM compartida:**

Cambio de arquitectura: de 1 VM por simulador a 1 VM compartida con N contenedores.
Análisis: [analyze/03-shared-vm-vs-vm-per-sim.md](analyze/03-shared-vm-vs-vm-per-sim.md)

- `config.ps1`: VM fija (`wa-sim-cacsi`), SimId resuelve Container, Port, Subdomain, RemoteSimDir
- `01-create-vm.ps1`: Sin -SimId. Crea 1 VM + 1 IP + firewall.
- `02-setup-vm.ps1`: Sin -SimId. Docker + red wa-net + Caddy vacío.
- `03-deploy.ps1 -SimId N`: Docker-compose por sim en /opt/wa-api/sN/, regenera Caddyfile, reload Caddy.
- `04-ssh-tunnel.ps1 -SimId N`: Tunnel al puerto 300N.
- `05-backup.ps1 -SimId N`: Backup de /opt/wa-api/sN/.

Archivos eliminados (obsoletos):
- `infra/docker-compose.prod.yml` — ahora generado por 03-deploy.ps1 en la VM
- `infra/caddy/Caddyfile` — ahora generado dinámicamente en la VM

**Paso 5 — README actualizado** para VM compartida.

**Paso 6 — Devtunnel creado** (`wa-api-callback`, puerto 8080).

**Paso 7 — Crear VM + setup:**

VM creada:
- Nombre: `wa-sim-cacsi`
- Zona: `us-central1-b` (us-central1-a no tenía capacidad → cambiado en config.ps1)
- IP estática: `35.239.9.221`
- Firewall: `allow-http-wa-sim` (80), `allow-https-wa-sim` (443)

Incidentes en 01-create-vm.ps1:
1. Tags `--tags http-server,https-server` se unían como un solo string en PowerShell → fix: `--tags=$('http-server,https-server')`
2. Zona `us-central1-a` sin capacidad → creada en `us-central1-b`

Setup VM (manual — 02-setup-vm.ps1 tenía bug de heredoc con `$DockerNet:`):
- Docker CE 29.4.0 + Compose 5.1.2 instalados
- Red `wa-net` creada
- Directorio `/opt/wa-api/caddy/` creado
- Caddy 2-alpine desplegado → **restart loop** (Caddyfile inválido, pendiente fix)

DNS configurado:
- `wa-api-s1.cacsi.dev` → `35.239.9.221` ✅
- `wa-api-s2.cacsi.dev` → `35.239.9.221` ✅

Caddy fix: Caddyfile formato single-line era inválido → reescrito multi-line, Caddy corriendo OK.

**Paso 8 — Deploy s1:**

1. Tarball creado (389 KB), excluye node_modules, auth_info_baileys, dist, .env*, state.json, .dev.
   - Incidente: `--exclude='media'` excluía también `src/media/media-store.ts` (bsdtar de Windows matchea parcial). Fix: quitar `media` del exclude — la carpeta raíz media/ es de runtime y está vacía en fuente.
2. SCP tarball + `.env.production.s1` → `/opt/wa-api/s1/`
3. Extracción OK en VM.
4. `docker-compose.yml` creado vía SSH para `wa-api-s1` (port 3001, network wa-net, healthcheck).
5. `docker compose build` — imagen `s1-wa-api-s1:latest` creada (~50s primer build).
6. `docker compose up -d` — contenedor `wa-api-s1` levantado y healthy.
7. Caddyfile actualizado con `wa-api-s1.cacsi.dev → wa-api-s1:3001`, Caddy recargado.
8. Health check: `https://wa-api-s1.cacsi.dev/health` → 200 ✅
9. Rutas bloqueadas: `/dashboard` → 403, `/api/session/*` → 403 ✅

**Paso 9 — Deploy s2:**

1. Mismo tarball reutilizado (389 KB).
2. SCP tarball + `.env.production.s2` → `/opt/wa-api/s2/`
3. Extracción OK en VM.
4. `docker-compose.yml` creado para `wa-api-s2` (port 3002, network wa-net, healthcheck).
5. `docker compose build` — instantáneo gracias al caché de Docker.
6. `docker compose up -d` — contenedor `wa-api-s2` levantado y healthy.
7. Caddyfile regenerado con s1 + s2, Caddy recargado.
8. Health check: `https://wa-api-s2.cacsi.dev/health` → 200 ✅
9. Rutas bloqueadas en s2: `/dashboard` → 403, `/api/session/*` → 403 ✅

**Paso 10 — Vincular WhatsApp s1 (QR scan):**

Requisito: acceder al dashboard del contenedor desde la PC local para escanear el QR.

1. **Port mapping necesario**: el docker-compose original no exponía puertos al host de la VM (solo Caddy los alcanzaba via red Docker). Se agregó `ports: ["3001:3001"]` al docker-compose de s1 y se recreó el contenedor con `docker compose up -d --force-recreate`.

2. **SSH tunnel con PuTTY**: `gcloud compute ssh --ssh-flag="-L 3001:localhost:3001"` abre una ventana PuTTY con el port forwarding activo. Esto redirige `localhost:3001` (PC) → `localhost:3001` (VM) → `wa-api-s1:3001` (contenedor).
   - Incidente: `gcloud compute ssh -- -L 3001:localhost:3001 -N` no funciona (PLink no acepta flags después de `--`).
   - Incidente: `gcloud compute start-iap-tunnel` falló porque el puerto no estaba expuesto al host (antes de agregar `ports`).

3. `.env.production.s1` actualizado con `CALLBACK_URL=https://1dc17r35-8080.brs.devtunnels.ms/webhooks/whatsapp`, SCP'd a la VM, contenedor reiniciado.

4. Navegador → `http://localhost:3001/dashboard` → QR visible → escaneado → **CONNECTED** ✅
   - Número: `51933182642`

Estado actual de la VM:
```
NAMES       STATUS                    PORTS
wa-api-s1   Up (healthy)              0.0.0.0:3001->3001/tcp
wa-api-s2   Up (healthy)              3002/tcp (sin port mapping aún)
caddy       Up                        80, 443
```

**Paso 10b — Vincular WhatsApp s2 (QR scan):**

1. Port mapping agregado: `ports: ["3002:3002"]` al docker-compose de s2, `force-recreate`.
2. SSH tunnel: `gcloud compute ssh --ssh-flag="-L 3002:localhost:3002"`.
3. Navegador → `http://localhost:3002/dashboard` → QR visible → escaneado → **CONNECTED** ✅
   - Número: `51933152391`

**Paso 11 — Test de envío de mensajes:**

Script `test-send-message.ps1` creado para enviar desde ambos sims.

1. Primer intento con texto a `51903427845` → error `131026` (ventana 24h no abierta).
2. Descubrimiento: WhatsApp usa **LIDs** (Linked IDs) como `remoteJid` en mensajes entrantes.
   - `state.json` tenía `48915483205670` (un LID, no un número de teléfono).
   - `lid-mapping-48915483205670_reverse.json` → `"51903429745"` (el número real — el `51903427845` era un typo).
3. Cambiado a template `reopen_conversation` (bypasea ventana 24h).
4. s1 → `51903429745` con template → **200 OK** ✅ — mensaje recibido.
5. s2 → mismo destinatario → **502** — s2 ya había perdido sesión.

**Bug descubierto — LID mapping:**
- `session.ts` línea 139: construye `${phoneNumber}@s.whatsapp.net` sin verificar si es un LID.
- `main.ts`: `recordInbound(from)` almacena LIDs en vez de phones.
- `simulator-state.ts`: `isWithin24hWindow(phone)` busca por phone, pero la key es un LID → **mismatch**.
- Templates funcionan porque Baileys resuelve internamente.
- **Pendiente para issue separado:** `002-fix-lid-mapping`.

**Paso 12 — Incidente: bloqueo temporal de s2 por WhatsApp:**

Timeline:
1. s2 conectado OK tras QR scan.
2. ~3 min después: `statusCode=401 Stream Errored (conflict)` → Baileys desconectado.
3. Container crashea con `Error: Connection Closed`.
4. Docker reinicia → misma secuencia: conectar → 401 → crash → restart (~35 seg/ciclo).

Causas identificadas:
1. Envío a JID inválido (`48915483205670@s.whatsapp.net` en vez de `lid@lid`).
2. Reconexiones rápidas (3+ en ~20 min).
3. Loop de restart post-bloqueo agravó la situación.

Acción: `docker stop wa-api-s2` — detenido para frenar el loop.

Análisis completo documentado en [../../alerta-bloqueo.md](../../alerta-bloqueo.md).

**Correcciones aplicadas a scripts/archivos:**
- `03-deploy.ps1`: Removido `--exclude='media'` del tarball (bsdtar de Windows matcheaba `src/media/` por coincidencia parcial).
- Los docker-compose generados deben incluir `ports: ["300N:300N"]` para permitir SSH tunnel al dashboard.
- `docs/alerta-bloqueo.md`: Protocolo de respuesta ante bloqueos de WhatsApp.
- `README.md`: Link a alerta-bloqueo.md en sección Troubleshooting.

Estado final de la VM:
```
NAMES       STATUS
wa-api-s1   Up (healthy)    ← CONNECTED, número 51933182642
caddy       Up
wa-api-s2   Stopped         ← bloqueado, pendiente re-scan cuando se levante el bloqueo
```

**Pendiente:**
- Esperar levantamiento del bloqueo de s2, re-escanear QR.
- Issue `002-fix-lid-mapping` para resolver el bug de LIDs en wa_api.
- Cuando help_api esté en la nube, reemplazar CALLBACK_URL por `https://help-api.cacsi.dev/...`
