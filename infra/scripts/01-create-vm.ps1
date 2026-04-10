<#
.SYNOPSIS
  Crea la VM compartida, IP estática y firewall en GCP.
.DESCRIPTION
  Crea una sola VM que alojará todos los simuladores wa_api.
  Ejecutar una sola vez — los simuladores se despliegan con 03-deploy.ps1.
.EXAMPLE
  .\01-create-vm.ps1
#>

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\config.ps1"

Write-Host "=== 01-create-vm.ps1 ===" -ForegroundColor Cyan
Write-Host "Proyecto: $GcpProject"
Write-Host "VM      : $VmName"
Write-Host ''

# ── 1. Reservar IP estática ──
Write-Host '[1/4] Reservando IP estática...' -ForegroundColor Yellow
gcloud compute addresses create $IpName `
  --project $GcpProject `
  --region $GcpRegion

$StaticIp = gcloud compute addresses describe $IpName `
  --project $GcpProject `
  --region $GcpRegion `
  --format 'value(address)'

Write-Host "  IP reservada: $StaticIp" -ForegroundColor Green

# ── 2. Crear VM ──
Write-Host '[2/4] Creando VM...' -ForegroundColor Yellow
gcloud compute instances create $VmName `
  --project $GcpProject `
  --zone $GcpZone `
  --machine-type $Machine `
  --image $Image `
  --boot-disk-size $DiskSize `
  --boot-disk-type pd-balanced `
  --address $StaticIp `
  --tags=$('http-server,https-server') `
  --metadata startup-script='#!/bin/bash
echo "VM ready"'

Write-Host "  VM creada: $VmName" -ForegroundColor Green

# ── 3. Firewall rules (idempotentes) ──
Write-Host '[3/4] Configurando firewall...' -ForegroundColor Yellow

$existingHttp = gcloud compute firewall-rules list `
  --project $GcpProject `
  --filter "name=allow-http-wa-sim" `
  --format "value(name)" 2>$null

if (-not $existingHttp) {
  gcloud compute firewall-rules create allow-http-wa-sim `
    --project $GcpProject `
    --allow tcp:80 `
    --target-tags http-server `
    --description 'Allow HTTP for Caddy redirect'
}

$existingHttps = gcloud compute firewall-rules list `
  --project $GcpProject `
  --filter "name=allow-https-wa-sim" `
  --format "value(name)" 2>$null

if (-not $existingHttps) {
  gcloud compute firewall-rules create allow-https-wa-sim `
    --project $GcpProject `
    --allow tcp:443 `
    --target-tags https-server `
    --description 'Allow HTTPS for Caddy'
}

Write-Host '  Firewall configurado (80, 443)' -ForegroundColor Green

# ── 4. Resumen ──
Write-Host ''
Write-Host '[4/4] Resumen' -ForegroundColor Yellow
Write-Host "  VM      : $VmName ($GcpZone)" -ForegroundColor Green
Write-Host "  IP      : $StaticIp" -ForegroundColor Green
Write-Host "  Máquina : $Machine" -ForegroundColor Green
Write-Host "  Disco   : $DiskSize" -ForegroundColor Green
Write-Host ''
Write-Host '  SIGUIENTE PASO:' -ForegroundColor Cyan
Write-Host "  1. Crear DNS A records: wa-api-sN.$Domain -> $StaticIp"
Write-Host '  2. Ejecutar: .\02-setup-vm.ps1'
