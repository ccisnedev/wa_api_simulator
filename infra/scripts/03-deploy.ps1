<#
.SYNOPSIS
  Despliega (o actualiza) un simulador wa_api en la VM compartida.
.DESCRIPTION
  Copia el código fuente, genera el docker-compose para el simulador,
  regenera el Caddyfile multi-dominio y recarga Caddy.
  Sirve tanto para el primer deploy como para actualizaciones.
.PARAMETER SimId
  Identificador numérico del simulador (1, 2, 3...).
.EXAMPLE
  .\03-deploy.ps1 -SimId 1
#>

param(
  [Parameter(Mandatory)]
  [int]$SimId
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\config.ps1"

$names     = Resolve-SimulatorNames -SimId $SimId
$LocalRoot = Resolve-Path (Join-Path $PSScriptRoot '..' '..')  # wa_api/
$EnvPath   = Join-Path $LocalRoot $names.EnvFile

Write-Host "=== 03-deploy.ps1 (SimId=$SimId) ===" -ForegroundColor Cyan
Write-Host "Container : $($names.Container)"
Write-Host "Puerto    : $($names.Port)"
Write-Host "Subdominio: $($names.Subdomain)"
Write-Host ''

# ── Verificar que existe el .env del simulador ──
if (-not (Test-Path $EnvPath)) {
  Write-Host "  ERROR: No existe $($names.EnvFile) en $LocalRoot" -ForegroundColor Red
  Write-Host "  Crea el archivo con las variables de entorno antes de deployar." -ForegroundColor Red
  exit 1
}

function Invoke-VmSsh {
  param([string]$Command)
  gcloud compute ssh "${SshUser}@${VmName}" `
    --project $GcpProject `
    --zone $GcpZone `
    --command $Command
}

# ── 1. Crear tarball del código fuente ──
Write-Host '[1/6] Creando tarball...' -ForegroundColor Yellow
$TarFile = Join-Path $env:TEMP 'wa-api-deploy.tar.gz'
Push-Location $LocalRoot
tar -czf $TarFile `
  --exclude='node_modules' `
  --exclude='auth_info_baileys' `
  --exclude='dist' `
  --exclude='.env' `
  --exclude='.env.production*' `
  --exclude='state.json' `
  --exclude='.dev' `
  .
Pop-Location
Write-Host '  Tarball creado' -ForegroundColor Green

# ── 2. Copiar archivos a la VM ──
Write-Host '[2/6] Copiando a la VM...' -ForegroundColor Yellow

Invoke-VmSsh "mkdir -p $($names.RemoteSimDir)/auth_info_baileys $($names.RemoteSimDir)/media"

gcloud compute scp $TarFile `
  "${SshUser}@${VmName}:$($names.RemoteSimDir)/deploy.tar.gz" `
  --project $GcpProject `
  --zone $GcpZone

gcloud compute scp $EnvPath `
  "${SshUser}@${VmName}:$($names.RemoteSimDir)/.env.production" `
  --project $GcpProject `
  --zone $GcpZone

Remove-Item $TarFile -Force
Write-Host '  Archivos copiados' -ForegroundColor Green

# ── 3. Extraer y generar docker-compose del simulador ──
Write-Host '[3/6] Extrayendo y configurando...' -ForegroundColor Yellow

$SimCompose = @"
services:
  $($names.Container):
    build:
      context: .
      dockerfile: infra/Dockerfile
    container_name: $($names.Container)
    restart: always
    env_file: .env.production
    volumes:
      - ./auth_info_baileys:/app/auth_info_baileys
      - ./media:/app/media
    networks:
      - $DockerNet
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:$($names.Port)/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

networks:
  ${DockerNet}:
    external: true
"@

Invoke-VmSsh @"
cd $($names.RemoteSimDir) && \
tar -xzf deploy.tar.gz && \
rm deploy.tar.gz && \
cat > docker-compose.yml << 'COMPEOF'
$SimCompose
COMPEOF
"@

Write-Host '  Configurado' -ForegroundColor Green

# ── 4. Build y deploy del simulador ──
Write-Host '[4/6] Building y desplegando container...' -ForegroundColor Yellow
Invoke-VmSsh "cd $($names.RemoteSimDir) && docker compose build && docker compose up -d"

Write-Host "  $($names.Container) desplegado" -ForegroundColor Green

# ── 5. Regenerar Caddyfile con todos los simuladores desplegados ──
Write-Host '[5/6] Regenerando Caddyfile...' -ForegroundColor Yellow

# Descubrir todos los sN/ que existan en la VM y generar bloques Caddy
# Cada directorio sN tiene un .env.production con PORT=300N
$CaddyGenScript = @'
CADDYFILE=""
for simdir in /opt/wa-api/s*/; do
  [ -d "$simdir" ] || continue
  simid=$(basename "$simdir" | sed 's/^s//')
  port=$((3000 + simid))
  container="wa-api-s${simid}"
  subdomain="wa-api-s${simid}.DOMAIN_PLACEHOLDER"

  CADDYFILE="${CADDYFILE}
${subdomain} {
  handle /dashboard* {
    respond 403
  }
  handle /api/session/* {
    respond 403
  }
  handle {
    reverse_proxy ${container}:${port}
  }
}
"
done

echo "$CADDYFILE" > /opt/wa-api/caddy/Caddyfile
'@

$CaddyGenScript = $CaddyGenScript -replace 'DOMAIN_PLACEHOLDER', $Domain
Invoke-VmSsh $CaddyGenScript

# Recargar Caddy sin downtime
Invoke-VmSsh 'docker exec caddy caddy reload --config /etc/caddy/Caddyfile'

Write-Host '  Caddyfile regenerado y Caddy recargado' -ForegroundColor Green

# ── 6. Health check ──
Write-Host '[6/6] Verificando health...' -ForegroundColor Yellow
Invoke-VmSsh "sleep 5 && curl -sf http://localhost:$($names.Port)/health || echo 'HEALTH CHECK FAILED'"

Write-Host ''
Write-Host '  SIGUIENTE PASO:' -ForegroundColor Cyan
Write-Host "  1. Ejecutar .\04-ssh-tunnel.ps1 -SimId $SimId para vincular número (QR scan)"
Write-Host "  2. Verificar HTTPS: curl https://$($names.Subdomain)/health"
