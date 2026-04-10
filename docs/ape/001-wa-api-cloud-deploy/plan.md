# Plan: Desplegar wa_api en Compute Engine

> APE State: **PLAN** (v4 — actualizado 2026-04-09)  
> Análisis: [analyze/01-hosting-options.md](analyze/01-hosting-options.md),
>           [analyze/02-security-and-dashboard-access.md](analyze/02-security-and-dashboard-access.md),
>           [analyze/03-shared-vm-vs-vm-per-sim.md](analyze/03-shared-vm-vs-vm-per-sim.md)

---

## Alcance

Desplegar wa_api en GCP con una **VM compartida** que aloja N simuladores como
contenedores Docker independientes. Caddy sirve como reverse proxy multi-dominio.

**Despliegue inicial:** s1 (con devtunnel + webhook), luego s2 (solo outbound).

Al terminar:

- 1 VM (`wa-sim-cacsi`) corriendo en `us-central1-a`
- 2 simuladores como contenedores Docker independientes
- HTTPS vía Caddy multi-dominio (`wa-api-s1.cacsi.dev`, `wa-api-s2.cacsi.dev`)
- Dashboards protegidos (solo SSH tunnel)
- APIs protegidos por Bearer token
- s1 con webhook vía devtunnel, s2 sin webhook
- Backup manual a GCS
- Scripts parametrizados — agregar un simulador = 1 comando

## Instancias planificadas

| SimId | Subdominio | Número | Puerto | Webhook | Estado |
|:-----:|-----------|--------|:------:|:-------:|--------|
| 1 | `wa-api-s1.cacsi.dev` | 51933182642 | 3001 | ✅ Sí (devtunnel → help_api) | Desplegar primero |
| 2 | `wa-api-s2.cacsi.dev` | 51933152391 | 3002 | ❌ No (solo outbound) | Desplegar segundo |

## Cambios de código previos al deploy

**`CALLBACK_URL`, `VERIFY_TOKEN`, `APP_SECRET` opcionales** (fidelidad con Meta):
- `config.ts` — de `requireEnv()` a `process.env[] || undefined`
- `main.ts` — dispatch webhook solo si `callbackUrl && appSecret` están presentes
- `app.ts` — registrar ruta `/webhook` solo si `verifyToken` está presente

Si `CALLBACK_URL` está ausente o vacío, los mensajes entrantes se reciben pero
no se reenvían. Silencioso, sin error — exacto como hace Meta sin webhook registrado.

**Estado: ✅ ya completado** — build limpio, 88 tests pasando.

## Arquitectura en la VM

```
/opt/wa-api/                        ← directorio raíz en la VM
├── caddy/
│   ├── docker-compose.yml          ← Caddy (1 instancia, multi-dominio)
│   └── Caddyfile                   ← regenerado por 03-deploy.ps1
├── s1/
│   ├── docker-compose.yml          ← wa-api-s1 (solo este sim)
│   ├── .env.production             ← config de s1 (PORT=3001)
│   ├── auth_info_baileys/          ← credenciales Baileys s1
│   └── media/                      ← media s1
├── s2/
│   ├── docker-compose.yml          ← wa-api-s2 (solo este sim)
│   ├── .env.production             ← config de s2 (PORT=3002)
│   ├── auth_info_baileys/          ← credenciales Baileys s2
│   └── media/                      ← media s2
└── src.tar.gz                      ← código fuente (compartido entre sims)
```

Cada simulador tiene su propio docker-compose — deployar s1 **no toca** s2.
Caddy es compartido pero un `caddy reload` toma <1s sin cortar conexiones.

Todos los contenedores comparten una red Docker (`wa-net`) para que Caddy
pueda rutear a cada simulador por nombre de contenedor.

## Estructura de archivos (repo)

```
wa_api/
├── .env.production.s1             # Config s1 (gitignored)
├── .env.production.s2             # Config s2 (gitignored)
└── infra/
    ├── Dockerfile                 # Build multi-stage Node 20 Alpine
    ├── .env.production.example    # Template de referencia
    ├── devtunnel.md               # Guía de devtunnel
    ├── scripts/
    │   ├── config.ps1             # Constantes + Resolve-SimulatorNames
    │   ├── 01-create-vm.ps1       # Crea VM + IP + firewall (sin SimId)
    │   ├── 02-setup-vm.ps1        # Instala Docker (sin SimId)
    │   ├── 03-deploy.ps1          # -SimId → deploy simulador a la VM
    │   ├── 04-ssh-tunnel.ps1      # -SimId → tunnel al puerto del sim
    │   └── 05-backup.ps1          # -SimId → backup → GCS
    └── README.md                  # Guía completa de operaciones
```

### Naming por SimId

`config.ps1 → Resolve-SimulatorNames`:

| SimId | Container | Puerto | Subdominio | .env |
|:-----:|-----------|:------:|-----------|------|
| 1 | `wa-api-s1` | 3001 | `wa-api-s1.cacsi.dev` | `.env.production.s1` |
| 2 | `wa-api-s2` | 3002 | `wa-api-s2.cacsi.dev` | `.env.production.s2` |
| N | `wa-api-sN` | 300N | `wa-api-sN.cacsi.dev` | `.env.production.sN` |

VM fija: `wa-sim-cacsi`, IP: `wa-sim-cacsi-ip` — no dependen de SimId.

---

## Pasos

### Paso 1 — Cambios de código (webhook opcional) ✅

Ya completado. Build limpio, 88 tests pasando.

### Paso 2 — Dockerfile ✅

Ya existe (`wa_api/infra/Dockerfile`). Multi-stage Node 20 Alpine.
Sin cambios — el `PORT` viene del `.env`, no hardcodeado.

### Paso 3 — Archivos .env por instancia ✅

`.env.production.s1` y `.env.production.s2` ya existen.
Agregar `PORT=300N` en cada uno (`PORT=3001` en s1, `PORT=3002` en s2).

### Paso 4 — Reescribir scripts para VM compartida

**`config.ps1`** — constantes compartidas:
- `$VmName = 'wa-sim-cacsi'` (fijo, sin SimId)
- `$IpName = 'wa-sim-cacsi-ip'` (fijo)
- `Resolve-SimulatorNames -SimId N` → resuelve Container, Port, Subdomain, EnvFile

**`01-create-vm.ps1`** (sin `-SimId`):
1. Reservar IP estática `wa-sim-cacsi-ip`
2. Crear VM `wa-sim-cacsi` (e2-small, debian-12, 10 GB)
3. Crear firewall rules (80, 443 — idempotentes)
4. Mostrar IP para DNS

**`02-setup-vm.ps1`** (sin `-SimId`):
1. Instalar Docker + Docker Compose
2. Crear `/opt/wa-api/caddy/`
3. Crear red Docker `wa-net`
4. Desplegar Caddy (docker-compose con solo el servicio caddy, puertos 80/443)

**`03-deploy.ps1 -SimId N`** (deploy de un simulador):
1. Verificar que `.env.production.sN` existe localmente
2. Crear tarball del código fuente (excluye node_modules, auth_info, .env, dist)
3. SCP tarball + `.env.production.sN` → VM `/opt/wa-api/sN/`
4. Generar `docker-compose.yml` para el sim (build, env_file, volumes, red wa-net)
5. `docker compose build && docker compose up -d` en `/opt/wa-api/sN/`
6. Regenerar Caddyfile (escanea todos los `/opt/wa-api/s*/` que existan)
7. `docker exec caddy caddy reload` (recarga sin downtime)
8. Health check: `curl localhost:300N/health`

**`04-ssh-tunnel.ps1 -SimId N`**:
1. Abre tunnel SSH (`-L 300N:localhost:300N`)
2. Dashboard en `http://localhost:300N/dashboard`

**`05-backup.ps1 -SimId N`**:
1. Crear bucket GCS si no existe
2. Comprimir `/opt/wa-api/sN/auth_info_baileys/` + `state.json` en la VM
3. Subir a GCS con timestamp

### Paso 5 — README de infra

Actualizar `wa_api/infra/README.md`:
- Quickstart: `01-create-vm` → `02-setup-vm` → `03-deploy -SimId 1`
- Agregar simulador: solo `03-deploy -SimId N` + DNS A record
- Operaciones: logs, restart, backup por SimId
- Costos actualizados (~$13.25 total, independiente de N sims)

### Paso 6 — Devtunnel para s1 ✅

Ya creado: `wa-api-callback` con puerto 8080.
Pendiente: obtener URL al encender, actualizar CALLBACK_URL en `.env.production.s1`.

### Paso 7 — Crear VM + setup

1. `.\01-create-vm.ps1` → anotar IP estática
2. Crear A records DNS:
   - `wa-api-s1.cacsi.dev` → IP
   - `wa-api-s2.cacsi.dev` → IP (misma)
3. `.\02-setup-vm.ps1`

### Paso 8 — Despliegue s1 (con webhook)

1. Encender devtunnel: `devtunnel host wa-api-callback`
2. Obtener URL → actualizar `CALLBACK_URL` en `.env.production.s1`
3. `.\03-deploy.ps1 -SimId 1`
4. `.\04-ssh-tunnel.ps1 -SimId 1` → escanear QR en dashboard
5. Verificar health: `curl https://wa-api-s1.cacsi.dev/health`
6. Probar outbound: enviar mensaje a un número real
7. Probar inbound: enviar mensaje desde WhatsApp → verificar webhook llega

### Paso 9 — Despliegue s2 (sin webhook)

1. `.\03-deploy.ps1 -SimId 2`
2. `.\04-ssh-tunnel.ps1 -SimId 2` → escanear QR en dashboard
3. Verificar health: `curl https://wa-api-s2.cacsi.dev/health`
4. Probar outbound: enviar mensaje a un número real
5. Confirmar que NO envía webhooks (no hay CALLBACK_URL)

---

## Guía: agregar un nuevo simulador

```
1. Crear .env.production.sN con PHONE_NUMBER, ACCESS_TOKEN, PORT=300N
2. Crear DNS A record: wa-api-sN.cacsi.dev → IP de wa-sim-cacsi
3. .\03-deploy.ps1 -SimId N
4. .\04-ssh-tunnel.ps1 -SimId N → escanear QR
```

Para actualizar código en una instancia existente:
```
.\03-deploy.ps1 -SimId N
```

---

## Costos

| Recurso | Costo/mes |
|---------|:---------:|
| VM e2-small (us-central1) | ~$12.23 |
| Disco balanced 10 GB | ~$1.00 |
| IP estática (en uso) | $0.00 |
| GCS bucket (backups, <1 GB) | ~$0.02 |
| **Total (independiente de N sims)** | **~$13.25** |

## Criterio de aceptación

### s1 (inbound + outbound)
- [ ] `curl https://wa-api-s1.cacsi.dev/health` → `200 { status: connected }`
- [ ] `curl https://wa-api-s1.cacsi.dev/dashboard` → `403`
- [ ] `curl -H "Authorization: Bearer wrong" .../{pnid}/messages` → `401`
- [ ] SSH tunnel + browser → dashboard muestra sesión conectada
- [ ] Outbound: enviar mensaje vía API, llega al teléfono
- [ ] Inbound: enviar WhatsApp al número, webhook llega a help_api (devtunnel)
- [ ] Backup en GCS contiene `auth_info_baileys/`

### Infraestructura parametrizada
- [ ] `.\01-create-vm.ps1 -SimId 2` crea VM y IP con nombres correctos
- [ ] `.\03-deploy.ps1 -SimId 2` genera Caddyfile con `wa-api-s2.cacsi.dev`
- [ ] wa_api sin `CALLBACK_URL` arranca correctamente (solo outbound)

---

## Riesgos del plan

| Riesgo | Mitigación |
|--------|-----------|
| DNS no propagado al probar | Esperar TTL o usar `--resolve` en curl |
| Let's Encrypt rate limit | TLS staging primero, cambiar a prod |
| `auth_info_baileys/` local no compatible con VM | Sesión nueva, QR fresh |
| Firewall bloquea WebSocket saliente | Default egress es abierto en GCE |
| Baileys rompe por update de protocolo | Monitorear repo, tener número de contingencia |

---

## No incluido en este plan

- Migración de `auth_info_baileys/` desde la máquina local (sesión nueva)
- Monitoring avanzado (Cloud Monitoring, alertas)
- CI/CD automático (GitHub Actions → deploy)
- Despliegue de s2 (se ejecuta cuando haya segundo número, mismos scripts)
