# wa_api — Infraestructura de despliegue

> Despliegue de wa_api en Google Cloud Compute Engine.  
> Una VM compartida aloja N simuladores como contenedores Docker independientes.

## Prerequisitos

- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) (`gcloud`) instalado y autenticado
- Proyecto GCP: `wa-api-simulator`
- DNS: acceso para crear A records en `cacsi.dev`
- `.env.production.sN` configurado en `wa_api/` por instancia (ver `.env.production.example`)

## Estructura

```
infra/
├── Dockerfile                    # Build multi-stage Node 20 Alpine
├── .env.production.example       # Template de variables de entorno
├── devtunnel.md                  # Guía de devtunnel para webhooks
├── scripts/
│   ├── config.ps1                # Constantes + Resolve-SimulatorNames
│   ├── 01-create-vm.ps1          # Crea VM + IP + firewall (una vez)
│   ├── 02-setup-vm.ps1           # Instala Docker + Caddy (una vez)
│   ├── 03-deploy.ps1 -SimId N    # Deploy simulador N
│   ├── 04-ssh-tunnel.ps1 -SimId N # Tunnel al dashboard del sim N
│   └── 05-backup.ps1 -SimId N    # Backup credenciales sim N → GCS
└── README.md
```

## Quickstart

### 1. Crear VM (una sola vez)

```powershell
cd wa_api/infra/scripts
.\01-create-vm.ps1
```

Output: IP estática. Crear A records para todos los subdominios → misma IP.

### 2. Setup VM (una sola vez)

```powershell
.\02-setup-vm.ps1
```

Instala Docker, crea red `wa-net` y despliega Caddy.

### 3. Configurar .env.production.sN

```powershell
cd wa_api
cp infra/.env.production.example .env.production.s1
# Editar: PHONE_NUMBER, ACCESS_TOKEN, PORT=3001
# CALLBACK_URL, VERIFY_TOKEN y APP_SECRET son opcionales — omitir para instancias solo outbound.
```

### 4. Deploy simulador

```powershell
cd wa_api/infra/scripts
.\03-deploy.ps1 -SimId 1
```

Copia código, build del container, regenera Caddyfile, recarga Caddy.

### 5. Vincular número (QR scan)

```powershell
.\04-ssh-tunnel.ps1 -SimId 1
```

1. Se abre un tunnel SSH que trae el puerto 3001 de la VM a tu PC
2. Abrir `http://localhost:3001/dashboard` en el browser
3. Escanear el QR con WhatsApp (Dispositivos vinculados → Vincular)
4. Esperar a que muestre "Connected"
5. Cerrar tunnel con Ctrl+C — wa_api sigue corriendo

### 6. Verificar

```powershell
# Health (público)
curl https://wa-api-s1.cacsi.dev/health

# Dashboard (debe dar 403)
curl https://wa-api-s1.cacsi.dev/dashboard

# API sin token (debe dar 401)
curl https://wa-api-s1.cacsi.dev/sim_pnid_001/messages

# API con token
curl -X POST https://wa-api-s1.cacsi.dev/sim_pnid_001/messages `
  -H "Authorization: Bearer <ACCESS_TOKEN>" `
  -H "Content-Type: application/json" `
  -d '{"messaging_product":"whatsapp","to":"51XXXXXXXXX","type":"text","text":{"body":"Hola"}}'
```

## Operaciones

### Redeploy (después de cambios)

```powershell
.\03-deploy.ps1 -SimId 1
```

### Backup de credenciales

```powershell
.\05-backup.ps1 -SimId 1
```

Sube `auth_info_baileys/` de ese sim a `gs://wa-sim-cacsi-backups/`.

### Ver logs

```powershell
gcloud compute ssh ccisnedev@wa-sim-cacsi `
  --project wa-api-simulator `
  --zone us-central1-a `
  --command "docker logs wa-api-s1 --tail 100 -f"
```

### Restart un simulador

```powershell
gcloud compute ssh ccisnedev@wa-sim-cacsi `
  --project wa-api-simulator `
  --zone us-central1-a `
  --command "cd /opt/wa-api/s1 && docker compose restart"
```

## Seguridad

| Capa | Protege | Mecanismo |
|------|---------|-----------|
| Firewall GCP | Solo puertos 80, 443, 22 | Tags `http-server`, `https-server` |
| Caddy | `/dashboard`, `/api/session/*` → 403 | Caddyfile (auto-generado) |
| Bearer token | API de mensajes/templates/media | Middleware `auth-token.ts` |
| SSH tunnel | Dashboard solo accesible vía tunnel | `gcloud compute ssh -L` |

## CALLBACK_URL (webhook)

wa_api envía webhooks de mensajes entrantes al `CALLBACK_URL` configurado.
**Es opcional** — si se omite, los mensajes entrantes se reciben pero no se reenvían (fidelidad con Meta).

| Entorno | CALLBACK_URL |
|---------|-------------|
| Dev (help_api en tu PC) | `https://{id}.devtunnels.ms/api/v1/ingress/webhook` |
| Producción | `https://help-api.cacsi.dev/api/v1/ingress/webhook` |

Para desarrollo con devtunnel ver [devtunnel.md](devtunnel.md).

## Costos

| Recurso | Costo/mes |
|---------|:---------:|
| VM e2-small | ~$12.23 |
| Disco 10 GB | ~$1.00 |
| IP estática | $0.00 |
| GCS backups | ~$0.02 |
| **Total (independiente de N sims)** | **~$13.25** |

## Agregar nuevo simulador

```powershell
# 1. Crear .env
cp infra/.env.production.example .env.production.sN
# Editar PHONE_NUMBER, ACCESS_TOKEN, PORT=300N. Webhook es opcional.

# 2. DNS
# Crear A record: wa-api-sN.cacsi.dev → misma IP de wa-sim-cacsi

# 3. Deploy
.\03-deploy.ps1 -SimId N
.\04-ssh-tunnel.ps1 -SimId N       # Escanear QR
```
