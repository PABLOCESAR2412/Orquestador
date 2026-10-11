# Copia los respaldos de Telo del VM a esta PC, por Tailscale.
#
# Uso manual:
#   .\copiar-respaldo-pc.ps1 -Servidor orquestador@NOMBRE-DEL-VM -Clave C:\Users\TU_USUARIO\.ssh\TU_CLAVE
#
# Guarda en %USERPROFILE%\Respaldos-Telo\respaldos (o en -Destino, si lo pasas).
# La primera vez conviene correrlo a mano, sin programarlo: acepta la huella del VM y confirma que la clave funciona.
# Para programarlo con el Programador de tareas, ver CLAUDE.md, seccion "Respaldos".

param(
    [Parameter(Mandatory = $true)] [string] $Servidor,
    [Parameter(Mandatory = $true)] [string] $Clave,
    [string] $Destino = (Join-Path $env:USERPROFILE "Respaldos-Telo")
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Clave)) { throw "No existe la clave SSH: $Clave" }
New-Item -ItemType Directory -Force -Path $Destino | Out-Null

# Sin preguntas (BatchMode): en el Programador de tareas no hay nadie para contestarlas.
# Si la carpeta respaldos ya existe en el destino, scp la sobrescribe archivo por archivo.
& scp -r -i $Clave -o BatchMode=yes -o ConnectTimeout=20 -o StrictHostKeyChecking=accept-new "${Servidor}:respaldos" $Destino
if ($LASTEXITCODE -ne 0) { throw "scp termino con codigo $LASTEXITCODE. Revisa Tailscale, la clave y que el VM tenga respaldos." }

$carpeta = Join-Path $Destino "respaldos"
$archivos = @(Get-ChildItem -LiteralPath $carpeta -File)
if ($archivos.Count -eq 0) { throw "La carpeta de respaldos del VM esta vacia." }
$megas = [math]::Round((($archivos | Measure-Object -Property Length -Sum).Sum) / 1MB, 1)
Write-Output "Respaldos copiados en $carpeta: $($archivos.Count) archivos, $megas MB."
