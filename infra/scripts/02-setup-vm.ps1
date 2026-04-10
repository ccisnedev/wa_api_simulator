<#
.SYNOPSIS
  Instala Docker y configura la VM compartida para alojar simuladores wa_api.
.DESCRIPTION
  Instala Docker, crea la red compartida y despliega Caddy.
  Ejecutar una sola vez después de 01-create-vm.ps1.
.EXAMPLE
  .\02-setup-vm.ps1
#>

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\config.ps1"

Write-Host "=== 02-setup-vm.ps1 ===" -ForegroundColor Cyan

function Invoke-VmSsh {
  param([string]$Command)
  gcloud compute ssh "${SshUser}@${VmName}" `
    --project $GcpProject `
    --zone $GcpZone `
    --command $Command
}

# ── 1. Instalar Docker ──
Write-Host '[1/4] Instalando Docker...' -ForegroundColor Yellow
Invoke-VmSsh @'
sudo apt-get update -qq && \
sudo apt-get install -y -qq ca-certificates curl gnupg && \
sudo install -m 0755 -d /etc/apt/keyrings && \
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
sudo chmod a+r /etc/apt/keyrings/docker.gpg && \
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo $VERSION_CODENAME) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null && \
sudo apt-get update -qq && \
sudo apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin && \
sudo usermod -aG docker $USER
'@

Write-Host '  Docker instalado' -ForegroundColor Green

# ── 2. Crear directorios ──
Write-Host '[2/4] Creando directorios...' -ForegroundColor Yellow
Invoke-VmSsh @"
sudo mkdir -p $RemoteDir/caddy && \
sudo chown -R `$USER:`$USER $RemoteDir
"@

Write-Host "  $RemoteDir/ preparado" -ForegroundColor Green

# ── 3. Crear red Docker compartida ──
Write-Host '[3/4] Creando red Docker...' -ForegroundColor Yellow
Invoke-VmSsh "docker network create $DockerNet 2>/dev/null || true"

Write-Host "  Red $DockerNet creada" -ForegroundColor Green

# ── 4. Desplegar Caddy ──
Write-Host '[4/4] Desplegando Caddy...' -ForegroundColor Yellow

# Caddyfile inicial — se regenera al deployar el primer simulador
$InitialCaddyfile = ':80 { respond "No simulators deployed" 503 }'

$CaddyCompose = @"
services:
  caddy:
    image: caddy:2-alpine
    container_name: caddy
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - $DockerNet

networks:
  ${DockerNet}:
    external: true

volumes:
  caddy_data:
  caddy_config:
"@

# Escapar $ para que bash no los interprete
$CaddyComposeEscaped = $CaddyCompose -replace '\$', '\$'

Invoke-VmSsh "cat > $RemoteDir/caddy/Caddyfile << 'CADDYEOF'
$InitialCaddyfile
CADDYEOF"

Invoke-VmSsh "cat > $RemoteDir/caddy/docker-compose.yml << 'COMPEOF'
$CaddyCompose
COMPEOF"

Invoke-VmSsh "cd $RemoteDir/caddy && docker compose up -d"

Write-Host '  Caddy desplegado' -ForegroundColor Green

# ── Verificar ──
Write-Host ''
Invoke-VmSsh 'docker --version && docker compose version'

Write-Host ''
Write-Host '  SIGUIENTE PASO:' -ForegroundColor Cyan
Write-Host '  1. Ejecutar: .\03-deploy.ps1 -SimId 1'
