<p align="center">
  <img src="docs/banner.svg" alt="Figurinhas com som: bot de WhatsApp que transforma vídeo em figurinha animada com áudio" width="100%">
</p>

<h1 align="center">Figurinhas com som para WhatsApp 🔊</h1>

<p align="center">
  <b>Bot de WhatsApp que transforma qualquer vídeo em figurinha animada com som.</b><br>
  Até de um <b>link do YouTube, TikTok ou Instagram</b>, começando no <b>segundo exato</b> que você quiser.<br>
  <i>WhatsApp sound sticker bot: turn any video (or YouTube/TikTok/Instagram link) into an animated sticker with audio. <a href="#english">English below</a>.</i>
</p>

<p align="center">
  <a href="https://github.com/coelhobugado/whatsapp-figurinhas-com-som/actions/workflows/test.yml"><img src="https://github.com/coelhobugado/whatsapp-figurinhas-com-som/actions/workflows/test.yml/badge.svg" alt="testes"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licen%C3%A7a-MIT-green" alt="Licença MIT"></a>
  <img src="https://img.shields.io/badge/node-%E2%89%A522.12-339933?logo=node.js&logoColor=white" alt="Node.js 22.12+">
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/FFmpeg-007808?logo=ffmpeg&logoColor=white" alt="FFmpeg">
</p>

---

<p align="center">
  <img src="docs/exemplo-lhama.webp" alt="Figurinha animada de uma lhama, gerada pelo bot a partir do curta Caminandes" width="256"><br>
  <sub>Figurinha de verdade, gerada pelo bot em 3,6 s com <code>!som 1:10-1:14</code>. 🔊 <a href="https://github.com/coelhobugado/whatsapp-figurinhas-com-som/raw/main/docs/exemplo-lhama.mp4"><b>Baixe o vídeo com som</b></a> (165 KB; o GitHub não toca som em imagens).<br>
  Cena do curta <a href="https://studio.blender.org/projects/caminandes/">Caminandes: Llama Drama</a> © Blender Foundation, <a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>.</sub>
</p>

## O que é

Mande um vídeo, ou só o link dele, com `!som`, e receba de volta uma **figurinha animada que toca o áudio**:

```
você:  !som 0:42 https://youtube.com/watch?v=…
bot:   ⏳ … 🔊  [figurinha animada do trecho 0:42–0:52, com som]
```

O bot roda no seu computador ou servidor, conectado a um número de WhatsApp como um "aparelho conectado". Qualquer pessoa (ou só quem você liberar) manda o vídeo ou o link para esse número e recebe a figurinha com áudio de volta, no privado ou em grupos.

> **E o WhatsApp oficial?** Em novembro de 2026 o WhatsApp começou a liberar, aos poucos e para poucas pessoas, a criação de figurinhas com som a partir de um vídeo da galeria. O bot funciona para **todo mundo, já**, e faz o que o app não faz: figurinha direto de **link** (sem baixar o vídeo), escolha do **trecho exato** de vídeos longos e uso **em grupo**, sem ninguém sair da conversa.

## Recursos

- 🔊 **Figurinha com som**: a partir de vídeo de celular, GIF ou vídeo mandado como documento.
- 🔗 **Direto do link**: YouTube, TikTok ou Instagram, sem baixar nada no celular.
- ⏱️ **Trecho exato**: `!som 0:42` ou `!som 0:42-0:47`, até de vídeos de horas (só o pedaço é baixado). Link do YouTube com tempo (`?t=42`) já começa no ponto certo.
- 🖱️ **Instalação de 1 clique** no Windows: instala o que falta e abre o QR no navegador.
- ⚡ **Rápido**: ~3–8 s por figurinha, mesmo com vídeo 1080p pesado ([veja como](#como-ficou-rápido)).
- 🖼️ **Sem bordas pretas**: preenche o quadrado 512×512 cortando o centro, ou `inteiro` para manter a imagem toda com fundo transparente.
- 🏷️ **Nome do pacote personalizado** ("Criada por …") gravado na figurinha.
- 🛟 **Nunca deixa ninguém sem resposta**: se o som falhar, manda a versão sem som e explica o motivo (vídeo sem áudio, áudio mudo, recusa do WhatsApp…).
- 🧵 **Fila justa**: um pedido por pessoa de cada vez, posição na fila e limite de tempo por pedido.
- 🔒 **Privado**: a conversão é local, com FFmpeg, e os vídeos não passam por serviços de conversão. Links são baixados da própria plataforma (no TikTok, uma das fontes de reserva usa o site SSSTik).
- 🙂 Também faz figurinhas comuns (sem som) de foto, vídeo e GIF.

## Comandos

| Comando | O que faz |
|---|---|
| `!som` (ou `!fs`) | Figurinha animada **com som**. Mande o vídeo com essa legenda ou responda a um vídeo com `!som`. |
| `!som <link>` | O mesmo, a partir de um link de **YouTube, TikTok ou Instagram**. |
| `!som 0:42 <link>` | Começa no **0:42** e usa até 10 s. `!som 0:42-0:47` usa só esse pedaço. Também vale com vídeo enviado. |
| `!fig` (ou `!f`, `!s`) | Figurinha comum, sem som, de foto, vídeo, GIF ou link (aceita o trecho também). |
| `!ajuda` | Lista os comandos. |

- Formatos de tempo aceitos: `42`, `42s`, `0:42`, `1:02:03`. No YouTube, o link de "Compartilhar › Começar em" (`?t=42`) já define o início.
- Também dá para **responder** a uma mensagem que tenha o link ou o vídeo com o comando.
- `!som inteiro` / `!fig inteiro`: mantém a imagem toda (bordas transparentes) em vez de cortar.
- Reações do bot: ⏳ processando · 🔊 saiu com som · ✅ saiu sem som · ❌ erro.
- Limites: até **10 segundos** por figurinha; vídeo enviado de até **16 MB** (por link, vídeos maiores funcionam: só o trecho é baixado).

## Instalação

### Jeito fácil (1 clique)

**Windows**

1. Nesta página, clique em **Code › Download ZIP** e extraia a pasta.
2. Dê dois cliques em **`INICIAR-WINDOWS.bat`**.
   - Se o Windows avisar "O Windows protegeu o computador", clique em **Mais informações › Executar assim mesmo**.
3. Ele instala sozinho o que faltar (Node.js e FFmpeg, pelo `winget`), pergunta o nome que vai aparecer nas figurinhas e liga o bot.
4. O navegador abre com um **QR code**. No celular do bot: **WhatsApp › Configurações › Aparelhos conectados › Conectar um aparelho** e escaneie.

Nas próximas vezes, é só dar dois cliques no mesmo arquivo. Para desligar, feche a janela preta.

**macOS / Linux**

Baixe o ZIP (ou `git clone`), abra o Terminal na pasta e rode:

```bash
bash iniciar-mac-linux.sh
```

Ele confere Node.js e FFmpeg (instala pelo Homebrew ou `apt` quando dá), instala as dependências, cria o `.env` e liga o bot.

### Jeito manual (para desenvolvedores)

**Requisitos**

- [Node.js](https://nodejs.org) 22.12 ou mais novo
- [FFmpeg](https://ffmpeg.org) e ffprobe no PATH, com `libwebp`, `libopus` e `libx264` (o bot confere ao iniciar):
  - **Windows**: `winget install Gyan.FFmpeg` (ou o build "full" do [gyan.dev](https://www.gyan.dev/ffmpeg/builds/))
  - **Linux**: `sudo apt install ffmpeg`
  - **macOS**: `brew install ffmpeg`
- Um número de WhatsApp para o bot (de preferência separado do seu).

**Rodando**

```bash
git clone https://github.com/coelhobugado/whatsapp-figurinhas-com-som.git
cd whatsapp-figurinhas-com-som
npm install
cp .env.example .env      # no Windows: copy .env.example .env
npm start
```

Na primeira vez aparece um **QR** no terminal e também como imagem em **http://localhost:3999**. No celular do bot: **Configurações › Aparelhos conectados › Conectar um aparelho** e escaneie. A sessão fica salva em `sessao/`; nas próximas vezes o bot conecta sozinho.

Pronto: mande um vídeo com a legenda `!som` para o número do bot.

## Configuração (`.env`)

| Variável | Padrão | Para quê |
|---|---|---|
| `ALLOWED_NUMBERS` | vazio (todos) | Números que podem usar o bot (só dígitos, com DDI e DDD, separados por vírgula). Ex.: `5511999998888`. Número brasileiro sem o 55, ou com/sem o 9 da frente, também é reconhecido. |
| `STICKER_PACK_NAME` | `Criada por Dexter` | Nome que aparece ao tocar na figurinha. |
| `STICKER_PUBLISHER` | vazio | Autor mostrado ao lado do nome. |
| `AUTH_DIR` | `./sessao` | Onde a sessão do WhatsApp é salva. |
| `QR_PORT` | `3999` | Porta da página local do QR. |
| `MAX_PENDING` | `5` | Quantos pedidos podem esperar na fila. |
| `FFMPEG_PATH`, `FFPROBE_PATH` | PATH | Caminho do FFmpeg, se não estiver no PATH. |
| `YTDLP_PATH` | PATH | `yt-dlp` opcional, usado como reserva se as bibliotecas JS falharem. |
| `DEBUG` | `false` | Mostra cada mensagem recebida e o tempo de cada etapa (sem conteúdo nem números). |
| `LOG_LEVEL` | `silent` | Logs internos do Baileys. |

## Como funciona

```mermaid
flowchart LR
  A[Vídeo + !som] --> B[Baixa a mídia]
  B --> C[Decodifica 1x<br/>512 px · 15 qps]
  B --> D[Extrai o áudio<br/>Ogg/Opus]
  C --> E[Estima o tamanho<br/>com amostras]
  E --> F[Codifica o WebP<br/>≤ 500 KB]
  F --> G[Upload figurinha]
  D --> H[Upload áudio<br/>+ sidecar]
  G --> I[Mensagem de<br/>figurinha com som]
  H --> I
```

### Como ficou rápido

O que mais pesa é codificar o WebP animado (2–5 s por tentativa num vídeo pesado), e vídeo de celular raramente cabe em 500 KB na primeira qualidade. Em vez de tentar qualidade por qualidade, o bot:

1. **Decodifica o vídeo uma única vez** para um intermediário de 512 px a 15 quadros/s (só os primeiros 10 s), enquanto extrai o áudio em paralelo.
2. **Estima o tamanho** de cada degrau de qualidade com amostras de ~1,5 s (começo, meio e fim), em duas rodadas de amostras paralelas.
3. **Codifica uma vez**, direto no melhor degrau que deve caber. Se a estimativa errar, desce um degrau.

| Vídeo de teste | Ingênuo (tentativa por tentativa) | Este bot |
|---|---|---|
| 1080×1920, 12 s, muito movimento | ~22 s | **~7 s** |
| 720×1280, 4 s | — | **~3,5 s** |

Meça no seu computador com `npm run bench -- seu-video.mp4`.

O áudio sai em **Ogg/Opus mono 48 kHz**, o formato das mensagens de voz, que toca em todos os aparelhos. Leva um fade de 20 ms no começo e 120 ms no fim para não estalar quando a figurinha repete. Áudio totalmente mudo é detectado.

### A figurinha com som no protocolo

A figurinha e o áudio sobem como mídias separadas. O áudio recebe um `streamingSidecar` (HMAC-SHA256 de cada bloco de 64 KiB do arquivo cifrado, truncado em 10 bytes). A mensagem vai assim:

```
Message
 └─ 134 FutureProofMessage
      └─ 1 Message
           └─ 26 StickerMessage (WebP animado)
                └─ 26 AudioMessage (Ogg/Opus + streamingSidecar)
```

O campo 134 e o `StickerMessage.26` não existem no protobuf do [Baileys](https://github.com/WhiskeySockets/Baileys). O bot troca `proto.Message.encode` por uma versão que monta esses bytes só nas mensagens marcadas; todas as outras mensagens saem idênticas (há teste para isso). Detalhes em [`src/sound-sticker.ts`](src/sound-sticker.ts).

## Estrutura

| Arquivo | Papel |
|---|---|
| [`src/bot.ts`](src/bot.ts) | Conexão, comandos, fila, mensagens de erro |
| [`src/convert.ts`](src/convert.ts) | Vídeo → WebP animado + áudio, com a estimativa de tamanho |
| [`src/sound-sticker.ts`](src/sound-sticker.ts) | Monta e envia a figurinha com som |
| [`src/webp.ts`](src/webp.ts) | Lê o WebP e grava o nome do pacote (EXIF) |
| [`src/link-download.ts`](src/link-download.ts) | Baixa vídeos de TikTok/Instagram/YouTube pelo link, com fontes de reserva |
| [`src/commands.ts`](src/commands.ts) | Comandos e localização da mídia (inclusive citada) |
| [`src/queue.ts`](src/queue.ts) | Fila com limite por pessoa e tempo máximo |
| [`src/qr-page.ts`](src/qr-page.ts) | Página local com o QR de vinculação |

```bash
npm run converter -- video.mp4 [--inteiro] [--trecho 0:42-0:47]   # gera saida/video.webp e saida/video.ogg, sem WhatsApp
npm run bench -- video.mp4                   # mede o tempo de cada etapa
npm run check                                # tipos + testes (os testes usam o FFmpeg)
```

## Perguntas frequentes

**Como fazer figurinha com som no WhatsApp?**
Rode este bot, mande um vídeo (ou um link do YouTube, TikTok ou Instagram) para o número dele com `!som` e use a figurinha que voltar: dá para reencaminhá-la para outras conversas.

**O WhatsApp já não faz isso sozinho?**
Está começando: desde novembro de 2026 o WhatsApp libera aos poucos, para algumas pessoas, a criação de figurinha com som a partir de um vídeo da galeria. O bot funciona para todo mundo agora e faz o que o app não faz: figurinha direto de link, escolha do trecho exato de vídeos longos e uso em grupo.

**Como faço figurinha de um momento específico de um vídeo do YouTube?**
Mande `!som 1:23 <link>` (começa em 1:23 e usa até 10 s) ou `!som 1:23-1:28 <link>` (só esse pedaço). Ou, no YouTube, use **Compartilhar › Começar em** e mande o link com `!som`. Só o trecho é baixado, então funciona até com vídeos de horas.

**Funciona em grupo?**
Sim. Qualquer participante pode mandar `!som` com um vídeo ou respondendo a um vídeo do grupo (respeitando `ALLOWED_NUMBERS`, se configurado).

**Por que a figurinha chegou sem som?**
O bot responde com o motivo: o vídeo não tinha áudio, o áudio era mudo, ou o WhatsApp recusou a versão com som. Nesse caso ele manda a versão sem som para você não ficar sem nada.

**Posso usar no meu número pessoal?**
Pode, mas é mais seguro usar um número separado. Se usar o seu, os comandos que você digitar em qualquer conversa também serão atendidos.

**Precisa deixar o computador ligado?**
Sim, o bot precisa estar rodando para responder. Para ficar 24 h, rode num servidor ou VPS (Node.js + FFmpeg).

## Solução de problemas

| Sintoma | O que fazer |
|---|---|
| "O FFmpeg instalado não tem o encoder…" | Instale um build completo do FFmpeg (veja Requisitos). |
| QR não aparece | Abra http://localhost:3999 no navegador. |
| O `INICIAR-WINDOWS.bat` diz que não achou o FFmpeg logo depois de instalar | Feche a janela e abra o arquivo de novo (o Windows só enxerga programas novos numa janela nova). |
| "Não entendi o tempo…" | Use `!som 0:42` ou `!som 0:42-0:47` (minutos:segundos). |
| Bot não responde | Rode com `DEBUG=true` e veja se as mensagens chegam; confira `ALLOWED_NUMBERS`. |
| "Outra cópia do bot abriu esta mesma sessão" | Só pode haver um bot rodando por sessão. Feche o outro. |
| "O celular desconectou o bot" | Apague a pasta `sessao/` e escaneie o QR de novo. |

## Avisos

- **Formato não oficial.** A estrutura da figurinha com som vem de engenharia reversa do aplicativo; uma atualização do WhatsApp pode fazê-la chegar sem som. O bot então manda a versão sem som.
- **Cliente não oficial.** O [Baileys](https://github.com/WhiskeySockets/Baileys) conecta como "aparelho conectado". Automação no WhatsApp pode levar ao bloqueio do número, principalmente com muitas mensagens ou respostas a desconhecidos. Use com moderação e por sua conta e risco. Este projeto não tem relação com o WhatsApp nem com a Meta.
- A pasta `sessao/` equivale a estar logado na conta. Ela está no `.gitignore`: **nunca publique**.

---

<a id="english"></a>

## English

**WhatsApp sound sticker bot.** Send a video with the caption `!som` and get back an **animated sticker that plays the video's audio**. Built with Node.js, TypeScript, [Baileys](https://github.com/WhiskeySockets/Baileys) and FFmpeg.

- Turns phone videos, GIFs, videos sent as documents and **YouTube/TikTok/Instagram links** into WhatsApp **stickers with sound** (audio stickers).
- Pick the exact moment: `!som 0:42 <link>` or `!som 0:42-0:47 <link>`; only that clip is downloaded, so it works with hour-long videos. YouTube `?t=` links start at that time.
- One-click setup on Windows (`INICIAR-WINDOWS.bat` installs Node.js and FFmpeg via winget and opens the QR code in the browser); `iniciar-mac-linux.sh` for macOS/Linux.
- Fast: ~3–8 s per sticker. The video is decoded once, the WebP quality level is picked by sampling, and the audio is extracted in parallel.
- Fills the 512×512 square (center crop) or keeps the whole frame with transparent borders (`!som inteiro`).
- Custom sticker pack name, per-user fair queue, friendly error messages, silent-audio detection, graceful fallback to a regular sticker.
- Conversion runs locally; no third-party conversion service. Links are fetched from the platforms themselves (one TikTok fallback uses SSSTik).

**Quick start:** install Node.js 22.12+ and FFmpeg (with libwebp, libopus, libx264), then:

```bash
npm install && cp .env.example .env && npm start
```

Scan the QR code (terminal or http://localhost:3999) from **Settings › Linked devices** on the bot's phone. Commands: `!som` (sticker with sound), `!fig` (regular sticker), `!ajuda` (help).

**How the sound sticker is sent:** the WebP and an Ogg/Opus voice-note-style audio are uploaded separately. The audio gets a `streamingSidecar`, and the message is wrapped as `Message.134 (FutureProofMessage) › Message.26 (StickerMessage) › StickerMessage.26 (AudioMessage)`. These fields are not in Baileys' protobuf, so the bot patches `proto.Message.encode` only for marked messages. The format was reverse engineered and may break with WhatsApp updates; this project is not affiliated with WhatsApp or Meta. Use at your own risk.

## Licença

[MIT](LICENSE) © 2026 Gabriel Fonseca Silva

Os arquivos de exemplo `docs/exemplo-lhama.webp` e `docs/exemplo-lhama.mp4` são um trecho de 4 s do curta [Caminandes: Llama Drama](https://studio.blender.org/projects/caminandes/) (Pablo Vazquez, Beorn Leonard e Francesco Siddi; música e som de Jan Morgenstern), © Blender Foundation, sob [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Eles continuam sob essa licença, não sob a MIT.
