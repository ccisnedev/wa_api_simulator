<#
.SYNOPSIS
  Envía un mensaje de prueba desde cada simulador wa_api.
.DESCRIPTION
  Usa la API compatible con WhatsApp Cloud API para enviar un mensaje
  desde cada simulador desplegado. Por defecto usa template (bypasea ventana 24h).
  Con -UseText envía texto libre (requiere ventana abierta).
.PARAMETER To
  Número de destino con código de país (sin +). Ej: 51903429745
.PARAMETER UseText
  Envía texto libre en vez de template. Requiere respuesta reciente del destino.
.EXAMPLE
  .\test-send-message.ps1 -To 51903429745
  .\test-send-message.ps1 -To 51903429745 -UseText
#>

param(
  [Parameter(Mandatory)]
  [string]$To,

  [switch]$UseText
)

$ErrorActionPreference = 'Stop'

# ── Simuladores configurados ──
$simulators = @(
  @{
    Name           = 'wa-api-s1'
    BaseUrl        = 'https://wa-api-s1.cacsi.dev'
    PhoneNumberId  = 'sim_pnid_001'
    AccessToken    = 'b29a59664a87c806d4204d1ab26578d6b60bd130ca485048d49aa5e6036c3120'
  },
  @{
    Name           = 'wa-api-s2'
    BaseUrl        = 'https://wa-api-s2.cacsi.dev'
    PhoneNumberId  = 'sim_pnid_002'
    AccessToken    = '7143576a8ae693477a6b472f4db2fe6f5702641402efc89121191ac5715f8477'
  }
)

foreach ($sim in $simulators) {
  $url = "$($sim.BaseUrl)/$($sim.PhoneNumberId)/messages"

  if ($UseText) {
    $body = @{
      messaging_product = 'whatsapp'
      to                = $To
      type              = 'text'
      text              = @{ body = "Hola desde $($sim.Name)" }
    } | ConvertTo-Json -Depth 3
  }
  else {
    # Template bypasea la ventana de 24h — ideal para tests
    $body = @{
      messaging_product = 'whatsapp'
      to                = $To
      type              = 'template'
      template          = @{
        name       = 'reopen_conversation'
        language   = @{ code = 'es' }
        components = @(
          @{
            type       = 'body'
            parameters = @(
              @{ type = 'text'; text = $sim.Name }
            )
          }
        )
      }
    } | ConvertTo-Json -Depth 5
  }

  $msgType = if ($UseText) { 'texto' } else { 'template' }
  Write-Host "[$($sim.Name)] Enviando $msgType a $To..." -ForegroundColor Yellow

  try {
    $response = Invoke-RestMethod -Uri $url -Method Post `
      -Headers @{ Authorization = "Bearer $($sim.AccessToken)" } `
      -ContentType 'application/json' `
      -Body $body

    $messageId = $response.messages[0].id
    Write-Host "  OK — message_id: $messageId" -ForegroundColor Green
  }
  catch {
    $status = $_.Exception.Response.StatusCode.value__
    $detail = $_.ErrorDetails.Message
    Write-Host "  ERROR ($status): $detail" -ForegroundColor Red
  }

  Write-Host ''
}
