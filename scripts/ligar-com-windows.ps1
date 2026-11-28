# Liga ou desliga o bot junto com o Windows: cria (ou apaga) um atalho na pasta "Inicializar" do usuário,
# que abre o INICIAR-WINDOWS.bat minimizado quando a pessoa entra no Windows.
# Uso normal: dois cliques em LIGAR-COM-O-WINDOWS.bat (cada vez alterna entre ligado e desligado).
# Opções: -Ligar, -Desligar (força um dos dois) e -SemPausa (não espera Enter no final).
param([switch]$Ligar, [switch]$Desligar, [switch]$SemPausa)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$raiz = Split-Path -Parent $PSScriptRoot
$atalho = Join-Path ([Environment]::GetFolderPath('Startup')) 'Bot de figurinhas com som.lnk'
$existe = Test-Path -LiteralPath $atalho

if ($Desligar -or ($existe -and -not $Ligar)) {
  if ($existe) { Remove-Item -LiteralPath $atalho -Force }
  Write-Host "`nPronto: o bot NÃO vai mais ligar sozinho com o Windows." -ForegroundColor Yellow
  Write-Host 'Para ligar de novo, dê dois cliques no LIGAR-COM-O-WINDOWS.bat.'
} else {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($atalho)
  $link.TargetPath = Join-Path $raiz 'INICIAR-WINDOWS.bat'
  $link.WorkingDirectory = $raiz
  $link.WindowStyle = 7  # minimizado
  $link.Description = 'Liga o bot de figurinhas com som para WhatsApp'
  $link.Save()
  Write-Host "`nPronto: o bot vai ligar sozinho (minimizado na barra de tarefas) toda vez que você entrar no Windows." -ForegroundColor Green
  Write-Host 'Para desfazer, dê dois cliques no LIGAR-COM-O-WINDOWS.bat de novo.'
}
if (-not $SemPausa) { Read-Host "`nAperte Enter para fechar" | Out-Null }
