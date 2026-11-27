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

## 4. Comandos do bot (o que o usuário final digita no WhatsApp)

| Comando | Apelidos | Faz |
|---|---|---|
| `!som` | `!fs`, `!figsom` | Figurinha animada **com som** (vídeo, GIF, vídeo como documento, ou link) |
| `!fig` | `!figurinha`, `!f`, `!s` | Figurinha comum, sem som (foto, vídeo, GIF, ou link) |
| `!ajuda` | `!help`, `!comandos` | Lista os comandos |

- Funciona mandando a mídia **com a legenda** ou **respondendo** a uma mídia/link com o comando.
- `inteiro` depois do comando (`!som inteiro`) mantém a imagem toda com bordas transparentes; o padrão corta o centro.
- Limites: primeiros **10 s** do vídeo, arquivo de até **16 MB**.
- Reações do bot: ⏳ processando · 🔊 saiu com som · ✅ saiu sem som · ❌ erro.

## 5. Configuração (`.env`) — mudanças que o usuário mais pede

| Pedido do usuário | O que mudar no `.env` |
|---|---|
| "Quero mudar o nome que aparece na figurinha" | `STICKER_PACK_NAME=Meu Nome` (e opcional `STICKER_PUBLISHER=`) |
| "Só eu / só meus amigos podem usar" | `ALLOWED_NUMBERS=5511999998888,5521988887777` (só dígitos, com 55 + DDD) |
| "A porta 3999 está ocupada" | `QR_PORT=4000` |
| "O FFmpeg não é encontrado" | `FFMPEG_PATH=` e `FFPROBE_PATH=` com o caminho completo do executável |
| "Quero ver o que está acontecendo" | `DEBUG=true` |
| "Fila enche rápido" | `MAX_PENDING=10` |

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
| `src/link-download.ts` | Pega o vídeo de links do TikTok/Instagram/YouTube para `!som`/`!fig`, com fontes de reserva (+ `yt-dlp` opcional). Só bibliotecas que falam direto com a plataforma (nada de API de terceiros) e FFmpeg limitado a HTTPS |
| `src/queue.ts` | Fila: um pedido por vez, um por pessoa, limite total, timeout de 3 min |
| `src/qr-page.ts` | Página local com o QR |
| `src/cli.ts` | `npm run converter -- video.mp4` — testa a conversão sem WhatsApp, grava em `saida/` |
| `scripts/bench.ts` | `npm run bench -- video.mp4` — mede tempo de cada etapa |
| `test/*.test.ts` | Testes (`node --test`), usam FFmpeg de verdade |

### Receitas comuns

- **Novo apelido de comando**: adicionar em `ALIASES` em `src/commands.ts` e, se fizer sentido, no `HELP_TEXT`.
- **Novo comando**: adicionar ao tipo `Command` e a `ALIASES` (`src/commands.ts`), tratar em `handle()` em `src/bot.ts`, atualizar `HELP_TEXT`, o `README.md` e um teste em `test/commands.test.ts`.
- **Mudar um texto que o bot responde**: as mensagens ficam em `src/bot.ts` (`friendlyError`, `trySoundSticker`, `handle`, `onMessage`) e `HELP_TEXT` em `src/commands.ts`.
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

## 8. Regras para a IA ao alterar o código

**Nunca:**
- Ler, mostrar, copiar ou subir o conteúdo de `sessao/` — ela **é o login da conta do WhatsApp**. Também tem números de telefone de terceiros.
- Mostrar ou publicar o `.env` real do usuário. Use o `.env.example` como referência.
- Commitar `sessao/`, `.env`, `saida/` (já estão no `.gitignore` — mantenha assim).
- Mexer no patch de `proto.Message.encode` em `src/sound-sticker.ts` sem rodar os testes: ele precisa deixar **todas as outras mensagens byte a byte iguais** (há teste para isso).
- Remover o fallback "manda sem som e explica o motivo". O usuário final nunca deve ficar sem resposta.
- Adicionar serviço externo de conversão: a conversão é local por princípio (privacidade).

**Sempre:**
- Manter textos para o usuário final em português, curtos e amigáveis.
- Usar `ConversionError` para erros cuja mensagem vai para o usuário e `ToolError`/`Error` para erros só de log.
- Rodar `npm run check` (tipos + testes; precisa de FFmpeg instalado) depois de alterar código.
- Atualizar `README.md`, `.env.example` e `HELP_TEXT` quando mudar comandos ou configuração.
- Seguir o estilo existente: TypeScript `strict`, ESM com imports terminando em `.js`, sem dependências novas sem necessidade.

## 9. Comandos de desenvolvimento

```bash
npm start                                  # roda o bot
npm run converter -- video.mp4 [--inteiro] # converte sem WhatsApp (saída em saida/)
npm run bench -- video.mp4                 # mede desempenho
npm run typecheck                          # só tipos
npm test                                   # só testes
npm run check                              # tipos + testes (o mesmo da CI)
```

Requisitos: Node ≥ 22.12, FFmpeg + ffprobe com libwebp, libopus, libx264. CI: `.github/workflows/test.yml` (Ubuntu, `npm run check`).
