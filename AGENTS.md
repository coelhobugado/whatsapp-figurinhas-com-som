# AGENTS.md — guia para assistentes de IA

> Este arquivo é para **você, IA** (Claude, ChatGPT, Copilot, Cursor etc.).
> O `README.md` é para humanos. Aqui está o que você precisa saber para **mexer no projeto**
> e para **explicar ao seu usuário** como instalar, usar e alterar o bot, em linguagem simples.

---

## 1. O projeto em uma frase

Bot de WhatsApp (Node.js + TypeScript + Baileys + FFmpeg) que recebe um vídeo com a legenda `!som`
e devolve uma **figurinha animada que toca o áudio do vídeo**. Também faz figurinha comum (`!fig`).
Os dois aceitam link de TikTok/Instagram/YouTube no lugar do vídeo (`!som <link>`, `!fig <link>`).

Roda no computador do usuário, conectado a um número de WhatsApp como "aparelho conectado" (via QR code).

## 2. Como falar com o usuário

O usuário típico **não é programador**. Ele quer o bot funcionando e talvez mudar o nome da figurinha.

- Fale em **português do Brasil**, frases curtas, sem jargão. Diga "terminal", não "shell"; "pasta", não "diretório".
- Dê **um passo de cada vez** e peça para ele confirmar o que apareceu na tela antes do próximo.
- Mostre comandos em blocos de código prontos para copiar. Diga **onde** digitar (terminal, dentro da pasta do projeto).
- Pergunte o **sistema operacional** (Windows, macOS, Linux) antes de passar comandos de instalação.
- Quando algo der errado, peça a **mensagem exata** do terminal (sem números de telefone) e use a tabela da seção 7.
- Avise dos riscos uma vez, sem sermão: é cliente **não oficial** do WhatsApp; o número pode ser bloqueado se abusar. Recomende um **número separado**.

### Explicação pronta (adapte)

> "Esse programa fica rodando no seu computador e se conecta a um número de WhatsApp, como o WhatsApp Web.
> Quando alguém manda um vídeo para esse número com a palavra `!som`, ele transforma o vídeo em uma figurinha
> que toca o som e manda de volta. Para funcionar, o computador precisa ficar ligado com o programa aberto."

## 3. Roteiro de instalação para guiar o usuário

**Caminho mais fácil (recomende primeiro):**

- **Windows:** baixar o ZIP do GitHub (**Code › Download ZIP**), extrair e dar dois cliques em `INICIAR-WINDOWS.bat`.
  Ele instala Node.js e FFmpeg pelo `winget` se faltarem, roda `npm ci`, cria o `.env` (perguntando o nome das figurinhas)
  e liga o bot abrindo o QR no navegador. Se o Windows mostrar "O Windows protegeu o computador":
  **Mais informações › Executar assim mesmo**. Se disser que não achou o FFmpeg logo após instalar: fechar e abrir de novo.
- **macOS/Linux:** `bash iniciar-mac-linux.sh` na pasta do projeto (usa Homebrew/apt quando possível).
- Os dois aceitam um modo de teste que prepara tudo sem ligar o bot: `scripts/iniciar.ps1 -SoPreparar` / `bash iniciar-mac-linux.sh --so-preparar`.

**Caminho manual (se o fácil falhar):**

1. **Instalar Node.js 22.12 ou mais novo** — https://nodejs.org (versão LTS). Conferir: `node -v`.
2. **Instalar FFmpeg** (precisa ter `libwebp`, `libopus`, `libx264`; o bot confere ao iniciar):
   - Windows: `winget install Gyan.FFmpeg` (depois **fechar e abrir o terminal** de novo)
   - macOS: `brew install ffmpeg`
   - Linux: `sudo apt install ffmpeg`
   - Conferir: `ffmpeg -version`
3. **Entrar na pasta do projeto** no terminal (`cd caminho/whatsapp-figurinhas-com-som`).
4. `npm install`
5. Criar o arquivo de configuração: `cp .env.example .env` (Windows: `copy .env.example .env`).
6. `npm start`
7. Vai aparecer um **QR code** no terminal (ou abrir http://localhost:3999). No celular do número do bot:
   **Configurações › Aparelhos conectados › Conectar um aparelho** e escanear.
8. Apareceu `Bot conectado.` → pronto. Testar mandando um vídeo com a legenda `!som` para o número do bot.

Para desligar: `Ctrl + C` no terminal. Nas próximas vezes basta `npm start` (a sessão fica salva em `sessao/`).

**Atualização:** o bot se atualiza sozinho ao abrir (antes de conectar) e depois a cada 6 horas (git `--ff-only` ou pacote
.tar.gz do GitHub, guardando o commit em `.versao`) e reabre pelo inicializador. Para desligar: digitar `atualizar off` na janela do bot, mandar `!atualizar off` pelo
WhatsApp (só o número do bot ou `ADMIN_NUMBERS`), ou `AUTO_UPDATE=false` no `.env`. Quem instalou antes dessa função precisa
atualizar à mão uma vez (baixar o ZIP de novo mantendo `sessao/` e `.env`, ou `git pull`).

## 4. Comandos do bot (o que o usuário final digita no WhatsApp)

| Comando | Apelidos | Faz |
|---|---|---|
| `!som` | `!fs`, `!figsom` | Figurinha animada **com som** (vídeo, GIF, vídeo como documento, ou link) |
| `!fig` | `!figurinha`, `!f`, `!s` | Figurinha comum, sem som (foto, vídeo, GIF, ou link) |
| `!ajuda` | `!help`, `!comandos` | Lista os comandos (para quem cuida do bot, inclui o `!atualizar`) |
| `!atualizar` | `!update` | **Só dono** (número do bot ou `ADMIN_NUMBERS`): atualiza agora; `off`/`on` desliga/liga a automática |
| `!erros` | `!erro`, `!logs` | **Só dono**: últimos erros; `!erros <ref>` mostra o detalhe técnico de um |

- Funciona mandando a mídia **com a legenda** ou **respondendo** a uma mídia/link com o comando.
- `inteiro` depois do comando (`!som inteiro`) mantém a imagem toda com bordas transparentes; o padrão corta o centro.
- **Trecho:** `!som 0:42 <link>` começa no 0:42 e usa até 10 s; `!som 0:42-0:47` usa só esse pedaço. Vale para link e para vídeo
  enviado. Formatos: `42`, `42s`, `0:42`, `1:02:03`. Link do YouTube com `?t=42` já começa ali. Por link, só o trecho é baixado
  quando o vídeo é grande (funciona com vídeos de horas). Código: `parseClip` em `src/commands.ts`, `startSeconds`/`maxSeconds`
  em `src/convert.ts`, `fetchClip` em `src/link-download.ts`.
- Limites: até **10 s** por figurinha; vídeo enviado de até **16 MB**.
- Reações do bot: 🕒 na fila · ⏳ processando · 🔊 saiu com som · ✅ saiu sem som · ❌ erro.
- Todo erro volta como uma frase curta + `(erro CÓDIGO · ref abc123)`. Para o usuário dono entender o que houve:
  `!erros abc123` no WhatsApp, `erros abc123` na janela do bot, ou a linha com essa `ref` em `dados/erros.jsonl`.
  A tabela de códigos está no README (seção "Fila, anti-flood e quedas").

## 5. Configuração (`.env`) — mudanças que o usuário mais pede

| Pedido do usuário | O que mudar no `.env` |
|---|---|
| "Quero mudar o nome que aparece na figurinha" | `STICKER_PACK_NAME=Meu Nome` (e opcional `STICKER_PUBLISHER=`) |
| "Só eu / só meus amigos podem usar" | `ALLOWED_NUMBERS=5511999998888,5521988887777` (só dígitos, com 55 + DDD; número brasileiro sem o 55 ou com/sem o 9 também é reconhecido, via `phoneVariants` em `src/commands.ts`). Com `DEBUG=true`, o log mostra por que alguém foi recusado |
| "A porta 3999 está ocupada" | `QR_PORT=4000` |
| "O FFmpeg não é encontrado" | `FFMPEG_PATH=` e `FFPROBE_PATH=` com o caminho completo do executável |
| "Quero ver o que está acontecendo" | `DEBUG=true` |
| "Fila enche rápido" | `MAX_PENDING=40` (e, num computador bom, `MAX_PARALLEL=3`) |
| "Quero que responda o que chegou com ele desligado há mais tempo" | `MAX_MESSAGE_AGE_MINUTES=600` |
| "Quero que ligue junto com o Windows" | Dois cliques em `LIGAR-COM-O-WINDOWS.bat` (de novo desfaz) |
| "Não quero que ele se atualize sozinho" | `AUTO_UPDATE=false` (ou digitar `atualizar off` na janela do bot) |
| "Quero usar o !atualizar do meu número" | `ADMIN_NUMBERS=5511999998888` (mesmo formato do `ALLOWED_NUMBERS`) |

Depois de mudar o `.env`, é preciso **parar (`Ctrl + C`) e rodar `npm start` de novo**.
Vazio em `ALLOWED_NUMBERS` = **qualquer pessoa** pode usar. O próprio número do bot sempre pode.

## 6. Mapa do código (para quando for alterar)

| Arquivo | Responsabilidade |
|---|---|
| `src/bot.ts` | Ponto de entrada. Lê `.env`, conecta no WhatsApp, recebe mensagens, fila, mensagens de erro amigáveis, reconexão |
| `src/commands.ts` | Lista de comandos/apelidos (`ALIASES`), texto do `!ajuda` (`HELP_TEXT`), achar mídia/link na mensagem ou na citada |
| `src/convert.ts` | Vídeo → WebP animado 512×512 (≤ 500 KB) + áudio Ogg/Opus. Escada de qualidade `LADDER` e estimativa por amostras |
| `src/ffmpeg.ts` | Roda FFmpeg/ffprobe sem shell, `checkTools()`, `ConversionError` (mensagem para usuário) vs `ToolError` (só log) |
| `src/sound-sticker.ts` | Monta e envia a figurinha com som (campos de protobuf não oficiais, patch em `proto.Message.encode`) |
| `src/webp.ts` | Lê WebP e grava o nome do pacote (EXIF) |
| `src/link-download.ts` | Pega o vídeo de links do TikTok/Instagram/YouTube para `!som`/`!fig`, com fontes de reserva (+ `yt-dlp` opcional). Bibliotecas que falam com a plataforma (exceção: a fonte de reserva `tiktok-api-dl v2` usa o site SSSTik) e FFmpeg limitado a HTTPS. Busca só o trecho pedido (`fetchClip`) quando o vídeo é grande |
| `src/queue.ts` | `FairQueue`: vários pedidos em paralelo, vez da conversa menos atendida, nunca dois da mesma pessoa juntos, limites por pessoa/conversa/total, tempo máximo |
| `src/limits.ts` | Anti-flood: `RateLimiter` (por pessoa/grupo) e `Pacer` (ritmo de envio, sem perder mensagens) |
| `src/errors.ts` | `classifyError` (erro → código curto + mensagem), `ErrorLog` (`dados/erros.jsonl`, `!erros`). Erros de usuário: `ConversionError`/`LinkError` com `code` |
| `src/terminal.ts` | Janela do bot, minimalista: `header` (limpa a tela), `log.online/ok/fail/warn/info/update/debug` (uma linha "HH:MM símbolo texto  detalhe"), `log.block` (status, erros), prompt `›` (`attachPrompt`). Cores só em terminal de verdade e sem `NO_COLOR`; sem emoji (o cmd antigo não mostra). Use `log.*` em vez de `console.log`. Cada uso aparece como "+55 ... (Nome) usou !som" (em grupo, com o nome do grupo) — números só na janela, nunca em `dados/` |
| `src/pending.ts` | Pedidos salvos em `dados/pedidos.json` para retomar depois de queda/atualização (abandona após 2 quedas: `TRAVOU`) |
| `scripts/ligar-com-windows.ps1` + `LIGAR-COM-O-WINDOWS.bat` | Atalho na pasta Inicializar do Windows (alterna ligado/desligado) |
| `src/qr-page.ts` | Página local com o QR |
| `src/updater.ts` | Atualização automática: `checkForUpdate()` (git ou pacote do GitHub), `installTarball`, `saveEnvSetting`. Nunca toca `.env`, `sessao/`, `saida/`, `node_modules/` |
| `scripts/iniciar-bot.mjs` | O que o `npm start` roda: abre `src/bot.ts` e o reabre quando ele sai com 75 (atualizou) ou 76 (atualizou e precisa de `npm ci`). JS puro, só módulos do Node |
| `src/cli.ts` | `npm run converter -- video.mp4 [--trecho 0:42-0:47]` — testa a conversão sem WhatsApp, grava em `saida/` |
| `INICIAR-WINDOWS.bat` + `scripts/iniciar.ps1` | Instalador/inicializador de 1 clique no Windows (winget, npm ci, .env, abre o QR) |
| `iniciar-mac-linux.sh` | O mesmo para macOS/Linux |
| `scripts/bench.ts` | `npm run bench -- video.mp4` — mede tempo de cada etapa |
| `test/*.test.ts` | Testes (`node --test`), usam FFmpeg de verdade |

### Receitas comuns

- **Novo apelido de comando**: adicionar em `ALIASES` em `src/commands.ts` e, se fizer sentido, no `HELP_TEXT`.
- **Novo comando**: adicionar ao tipo `Command` e a `ALIASES` (`src/commands.ts`), tratar em `handle()` em `src/bot.ts`, atualizar `HELP_TEXT`, o `README.md` e um teste em `test/commands.test.ts`.
- **Mudar um texto que o bot responde**: as mensagens de erro ficam em `classifyError` (`src/errors.ts`) e nas
  `ConversionError`/`LinkError`; as outras em `src/bot.ts` (`trySoundSticker`, `handle`, `onMessage`, `refusalNotice`) e `HELP_TEXT` em `src/commands.ts`.
- **Novo tipo de erro**: lançar `ConversionError(mensagem, 'CODIGO')` (ou `LinkError`) se a mensagem for para o usuário;
  para erros de sistema, ensinar `classifyError` a reconhecê-lo. Pôr o código na tabela do README e um caso em `test/resiliencia.test.ts`.
- **Mudar limites de figurinha** (10 s, 16 MB, 500 KB): constantes no topo de `src/convert.ts`. Os limites 512 px / 500 KB / 100 KB vêm do WhatsApp — **não aumente**, a figurinha passa a ser recusada.
- **Testar conversão sem WhatsApp**: `npm run converter -- video.mp4 [--inteiro]`.

## 7. Problemas comuns → o que dizer ao usuário

| Mensagem / sintoma | Causa | Solução para passar ao usuário |
|---|---|---|
| `O FFmpeg instalado não tem o encoder "..."` | FFmpeg incompleto | Instalar o build completo (Windows: `winget install Gyan.FFmpeg` ou "full" do gyan.dev) |
| `"ffmpeg" não foi encontrado` | Não instalado ou fora do PATH | Instalar; no Windows fechar e reabrir o terminal; ou usar `FFMPEG_PATH` no `.env` |
| `node` não reconhecido / erro de versão | Node ausente ou < 22.12 | Instalar Node LTS em nodejs.org |
| QR não aparece | Terminal não desenha | Abrir http://localhost:3999 |
| Bot não responde | Número não liberado, ou mensagem antiga (> 5 min) | Conferir `ALLOWED_NUMBERS`; rodar com `DEBUG=true` |
| `Outra cópia do bot abriu esta mesma sessão` | Dois bots abertos | Fechar o outro terminal |
| `O celular desconectou o bot` | Sessão removida no celular | Apagar a pasta `sessao/` e escanear de novo |
| `O WhatsApp recusou a conexão (403)` | Número possivelmente bloqueado | Não há conserto no código; usar outro número |
| Figurinha chegou sem som | Vídeo sem áudio, áudio mudo, ou WhatsApp recusou o formato | O bot já explica o motivo na conversa; é comportamento esperado |
| `!som <link>` / `!fig <link>` falha | Sites mudam e quebram os baixadores | Tentar de novo; instalar `yt-dlp` como reserva (`YTDLP_PATH`); atualizar dependências |
| `Atualização automática: há arquivos do bot modificados…` | Instalação pelo git com arquivos mudados | `git checkout .` para descartar, ou desligar a atualização e atualizar à mão |
| `Não consegui instalar as dependências novas` | `npm ci` falhou depois de atualizar | Conferir internet e rodar `npm install` na pasta |
| Usuário recebeu `erro XYZ · ref abc123` | Qualquer falha num pedido | `!erros abc123` mostra o detalhe técnico; tabela de códigos no README |
| `O bot caiu 5 vezes em 10 minutos` | Erro que se repete ao abrir | Ler o erro na tela e em `dados/erros.jsonl`; corrigir e abrir de novo |

## 8. Regras para a IA ao alterar o código

**Nunca:**
- Ler, mostrar, copiar ou subir o conteúdo de `sessao/` — ela **é o login da conta do WhatsApp**. Também tem números de telefone de terceiros.
- Publicar ou commitar `dados/`: `pedidos.json` tem o conteúdo das mensagens pendentes. (O `erros.jsonl` não tem telefones, mas fica junto.)
- Pôr número de telefone ou conteúdo de mensagem no registro de erros (`ErrorContext`).
- Mostrar ou publicar o `.env` real do usuário. Use o `.env.example` como referência.
- Commitar `sessao/`, `.env`, `saida/`, `dados/` (já estão no `.gitignore` — mantenha assim).
- Mexer no patch de `proto.Message.encode` em `src/sound-sticker.ts` sem rodar os testes: ele precisa deixar **todas as outras mensagens byte a byte iguais** (há teste para isso).
- Remover o fallback "manda sem som e explica o motivo". O usuário final nunca deve ficar sem resposta.
- Adicionar serviço externo de conversão: a conversão é local por princípio (privacidade).
- Fazer o atualizador (`src/updater.ts`) tocar em `.env`, `sessao/`, `saida/` ou `node_modules/`, ou baixar de outro lugar que não o GitHub do projeto.
- Usar dependências npm em `scripts/iniciar-bot.mjs`: ele roda enquanto o `npm ci` troca o `node_modules`.

**Sempre:**
- Manter textos para o usuário final em português, curtos e amigáveis.
- Usar `ConversionError` para erros cuja mensagem vai para o usuário e `ToolError`/`Error` para erros só de log.
- Rodar `npm run check` (tipos + testes; precisa de FFmpeg instalado) depois de alterar código.
- Atualizar `README.md`, `.env.example` e `HELP_TEXT` quando mudar comandos ou configuração.
- Seguir o estilo existente: TypeScript `strict`, ESM com imports terminando em `.js`, sem dependências novas sem necessidade.

## 9. Comandos de desenvolvimento

```bash
npm start                                  # roda o bot
npm run converter -- video.mp4 [--inteiro] [--trecho 0:42-0:47] # converte sem WhatsApp (saída em saida/)
npm run bench -- video.mp4                 # mede desempenho
npm run typecheck                          # só tipos
npm test                                   # só testes
npm run check                              # tipos + testes (o mesmo da CI)
```

Requisitos: Node ≥ 22.12, FFmpeg + ffprobe com libwebp, libopus, libx264. CI: `.github/workflows/test.yml` (Ubuntu, `npm run check`).
