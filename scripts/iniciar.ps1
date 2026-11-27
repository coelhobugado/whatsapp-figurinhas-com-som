# Instalador e inicializador de 1 clique para Windows.
# Confere/instala Node.js e FFmpeg (via winget), instala as dependências, cria o .env e liga o bot.
# Uso normal: dar dois cliques em INICIAR-WINDOWS.bat. Para só preparar (sem ligar): -SoPreparar
param([switch]$SoPreparar)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location (Split-Path -Parent $PSScriptRoot)

function Escrever-Passo($texto) { Write-Host "`n>> $texto" -ForegroundColor Cyan }
function Escrever-Ok($texto) { Write-Host "   OK: $texto" -ForegroundColor Green }
function Escrever-Aviso($texto) { Write-Host "   $texto" -ForegroundColor Yellow }
function Parar-Com-Erro($texto) {
  Write-Host "`n$texto" -ForegroundColor Red
  if (-not $SoPreparar) { Read-Host "`nAperte Enter para fechar" | Out-Null }
  exit 1
}
function Atualizar-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Tem-Comando($nome) { [bool](Get-Command $nome -ErrorAction SilentlyContinue) }
function Instalar-Com-Winget($id, $nome) {
  if (-not (Tem-Comando 'winget')) {
    Parar-Com-Erro "Não encontrei o winget para instalar o $nome. Instale o $nome manualmente e rode de novo."
  }
  Escrever-Aviso "Instalando $nome (pode pedir permissão do Windows)..."
  winget install -e --id $id --accept-package-agreements --accept-source-agreements --silent
  Atualizar-Path
}
function Versao-Node {
  if (-not (Tem-Comando 'node')) { return $null }
  try { return [version]((node -v).TrimStart('v')) } catch { return $null }
}

Write-Host '=============================================' -ForegroundColor Green
Write-Host '   Figurinhas com som para WhatsApp' -ForegroundColor Green
Write-Host '=============================================' -ForegroundColor Green

# 1. Node.js 22.12+
Escrever-Passo 'Conferindo o Node.js'
$minimo = [version]'22.12.0'
$versao = Versao-Node
if (-not $versao -or $versao -lt $minimo) {
  if ($versao) { Escrever-Aviso "Node.js $versao é antigo (precisa de $minimo ou mais novo)." }
  Instalar-Com-Winget 'OpenJS.NodeJS.LTS' 'Node.js'
  $versao = Versao-Node
  if (-not $versao -or $versao -lt $minimo) {
    Parar-Com-Erro "Não consegui instalar o Node.js. Baixe a versão LTS em https://nodejs.org, instale e rode de novo."
  }
}
Escrever-Ok "Node.js $versao"

# 2. FFmpeg com os encoders necessários
Escrever-Passo 'Conferindo o FFmpeg'
function FFmpeg-Completo {
  if (-not (Tem-Comando 'ffmpeg') -or -not (Tem-Comando 'ffprobe')) { return $false }
  $encoders = (ffmpeg -hide_banner -encoders 2>$null) -join "`n"
  return ($encoders -match 'libwebp_anim') -and ($encoders -match 'libopus') -and ($encoders -match 'libx264')
}
if (-not (FFmpeg-Completo)) {
  Instalar-Com-Winget 'Gyan.FFmpeg' 'FFmpeg'
  if (-not (FFmpeg-Completo)) {
    Parar-Com-Erro "O FFmpeg não ficou disponível. Feche esta janela e abra o INICIAR-WINDOWS.bat de novo (o Windows às vezes só enxerga programas novos numa janela nova)."
  }
}
Escrever-Ok 'FFmpeg completo'

# 3. Dependências do projeto
Escrever-Passo 'Instalando as dependências do bot'
$precisaInstalar = -not (Test-Path 'node_modules') -or
  ((Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item 'node_modules').LastWriteTime)
if ($precisaInstalar) {
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { Parar-Com-Erro 'A instalação das dependências falhou. Confira sua internet e rode de novo.' }
  (Get-Item 'node_modules').LastWriteTime = Get-Date
}
Escrever-Ok 'dependências prontas'

# 4. Configuração
Escrever-Passo 'Conferindo a configuração (.env)'
if (-not (Test-Path '.env')) {
  Copy-Item '.env.example' '.env'
  if (-not $SoPreparar) {
    $nome = Read-Host '   Nome que vai aparecer nas figurinhas (Enter para "Criada por Dexter")'
    if ($nome.Trim()) {
      $conteudo = (Get-Content '.env' -Raw -Encoding UTF8) -replace '(?m)^STICKER_PACK_NAME=.*$', "STICKER_PACK_NAME=$($nome.Trim())"
      [IO.File]::WriteAllText((Join-Path (Get-Location) '.env'), $conteudo, (New-Object System.Text.UTF8Encoding $false))
    }
  }
  Escrever-Ok '.env criado (dá para mudar depois abrindo o arquivo .env no Bloco de Notas)'
} else {
  Escrever-Ok '.env já existe'
}

if ($SoPreparar) { Escrever-Ok 'tudo pronto (modo -SoPreparar: o bot não foi ligado)'; exit 0 }

# 5. Ligar o bot
Escrever-Passo 'Ligando o bot'
if (-not (Test-Path 'sessao\creds.json')) {
  Write-Host '   Na primeira vez, o navegador vai abrir com um QR code.' -ForegroundColor White
  Write-Host '   No celular do bot: WhatsApp > Configurações > Aparelhos conectados > Conectar um aparelho.' -ForegroundColor White
}
Write-Host '   Para desligar o bot, feche esta janela ou aperte Ctrl + C.' -ForegroundColor White
$env:ABRIR_QR = 'true'
npm start
if ($LASTEXITCODE -ne 0) { Read-Host "`nO bot parou com erro. Aperte Enter para fechar" | Out-Null }
