<#
.SYNOPSIS
  Abre SSH tunnel para acceder al dashboard de un simulador wa_api.
.DESCRIPTION
  Expone el puerto del simulador como localhost:300N.
  Abrir http://localhost:300N/dashboard en el browser para vincular número.
  Cerrar con Ctrl+C cuando termines.
.PARAMETER SimId
  Identificador numérico del simulador (1, 2, 3...).
.EXAMPLE
  .\04-ssh-tunnel.ps1 -SimId 1
#>

param(
  [Parameter(Mandatory)]
  [int]$SimId
)

. "$PSScriptRoot\config.ps1"

$names = Resolve-SimulatorNames -SimId $SimId
$port  = $names.Port

Write-Host "=== 04-ssh-tunnel.ps1 (SimId=$SimId) ===" -ForegroundColor Cyan
Write-Host ''
Write-Host "Abriendo tunnel SSH a ${VmName}..." -ForegroundColor Yellow
Write-Host "  Dashboard: http://localhost:${port}/dashboard" -ForegroundColor Green
Write-Host "  Health:    http://localhost:${port}/health" -ForegroundColor Green
Write-Host ''
Write-Host 'Presiona Ctrl+C para cerrar el tunnel.' -ForegroundColor DarkGray
Write-Host ''

gcloud compute ssh "${SshUser}@${VmName}" `
  --project $GcpProject `
  --zone $GcpZone `
  -- -L ${port}:localhost:${port} -N
