#!/usr/bin/env bash
# Instala o que falta e liga o bot no macOS ou no Linux.
# Uso: abra o Terminal nesta pasta e rode:  bash iniciar-mac-linux.sh
# Para só preparar (sem ligar):            bash iniciar-mac-linux.sh --so-preparar
set -euo pipefail
cd "$(dirname "$0")"

passo() { printf '\n\033[36m>> %s\033[0m\n' "$1"; }
ok() { printf '   \033[32mOK: %s\033[0m\n' "$1"; }
erro() { printf '\n\033[31m%s\033[0m\n' "$1"; exit 1; }
tem() { command -v "$1" >/dev/null 2>&1; }

instalar() { # instalar <pacote-brew> <pacote-apt>
  if tem brew; then brew install "$1"
  elif tem apt-get; then sudo apt-get update && sudo apt-get install -y "$2"
  elif tem dnf; then sudo dnf install -y "$2"
  else erro "Não sei instalar $1 neste sistema. Instale manualmente e rode de novo."; fi
}

echo '============================================='
echo '   Figurinhas com som para WhatsApp'
echo '============================================='

passo 'Conferindo o Node.js'
versao_ok() { tem node && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)'; }
if ! versao_ok; then
  if tem brew; then brew install node; else
    erro "Precisa do Node.js 22.12 ou mais novo. Instale a versão LTS em https://nodejs.org (ou com nvm) e rode de novo."
  fi
  versao_ok || erro "O Node.js instalado ainda é antigo. Instale a versão LTS em https://nodejs.org."
fi
ok "Node.js $(node -v)"

passo 'Conferindo o FFmpeg'
ffmpeg_ok() { tem ffmpeg && tem ffprobe && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libwebp_anim && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libopus && ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libx264; }
if ! ffmpeg_ok; then instalar ffmpeg ffmpeg; fi
ffmpeg_ok || erro "O FFmpeg instalado não tem libwebp, libopus e libx264. Instale um FFmpeg completo."
ok 'FFmpeg completo'

passo 'Instalando as dependências do bot'
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  npm ci --no-audit --no-fund
  touch node_modules
fi
ok 'dependências prontas'

passo 'Conferindo a configuração (.env)'
if [ ! -f .env ]; then
  cp .env.example .env
  if [ "${1:-}" != "--so-preparar" ] && [ -t 0 ]; then
    read -r -p '   Nome que vai aparecer nas figurinhas (Enter para "Criada por Dexter"): ' nome
    if [ -n "${nome// }" ]; then
      node -e 'const fs=require("fs");fs.writeFileSync(".env",fs.readFileSync(".env","utf8").replace(/^STICKER_PACK_NAME=.*$/m,"STICKER_PACK_NAME="+process.argv[1]))' "$nome"
    fi
  fi
  ok '.env criado (dá para mudar depois editando o arquivo .env)'
else
  ok '.env já existe'
fi

if [ "${1:-}" = "--so-preparar" ]; then ok 'tudo pronto (o bot não foi ligado)'; exit 0; fi

passo 'Ligando o bot'
[ -f sessao/creds.json ] || echo '   Na primeira vez, o navegador vai abrir com um QR code. No celular do bot: WhatsApp > Configurações > Aparelhos conectados > Conectar um aparelho.'
echo '   Para desligar o bot, aperte Ctrl + C.'
ABRIR_QR=true npm start
