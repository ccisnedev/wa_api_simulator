<#
.SYNOPSIS
  Configuración compartida para todos los scripts de infraestructura.
.DESCRIPTION
  Define constantes del proyecto y una función que resuelve nombres de recursos
  a partir del SimId. Todos los scripts hacen dot-source de este archivo.
  La VM es compartida — todos los simuladores corren en la misma máquina.
#>

# ── Constantes del proyecto (VM fija, sin SimId) ──
$Script:GcpProject = 'wa-api-simulator'
$Script:GcpZone    = 'us-central1-b'
$Script:GcpRegion  = 'us-central1'
$Script:SshUser    = 'ccisnedev'
$Script:Domain     = 'cacsi.dev'
$Script:Machine    = 'e2-small'
$Script:DiskSize   = '10GB'
$Script:Image      = 'projects/debian-cloud/global/images/family/debian-12'
$Script:RemoteDir  = '/opt/wa-api'
$Script:GcsBucket  = 'gs://wa-sim-cacsi-backups'
$Script:VmName     = 'wa-sim-cacsi'
$Script:IpName     = 'wa-sim-cacsi-ip'
$Script:DockerNet  = 'wa-net'

<#
.SYNOPSIS
  Resuelve nombres de recursos a partir del SimId.
.PARAMETER SimId
  Identificador numérico del simulador (1, 2, 3...).
.OUTPUTS
  Hashtable con Container, Port, Subdomain, EnvFile, RemoteSimDir.
#>
function Resolve-SimulatorNames {
  param(
    [Parameter(Mandatory)]
    [ValidateRange(1, 99)]
    [int]$SimId
  )

  @{
    Container    = "wa-api-s$SimId"
    Port         = 3000 + $SimId
    Subdomain    = "wa-api-s$SimId.$Script:Domain"
    EnvFile      = ".env.production.s$SimId"
    RemoteSimDir = "$Script:RemoteDir/s$SimId"
  }
}
