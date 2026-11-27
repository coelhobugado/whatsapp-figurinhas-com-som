# Como instalar e executar o projeto

Este tutorial analisa as dependências e mostra como iniciar o bot `whatsapp-figurinhas-com-som` no Windows, macOS ou Linux.

> **Importante:** o bot é feito em **Node.js e TypeScript**, não em Python. `.venv` não é necessário para executar o bot. Ele pode ser usado opcionalmente para instalar a ferramenta `yt-dlp` de reserva, sem instalar pacotes Python no sistema; para executar o projeto, os requisitos principais continuam sendo Node.js, npm e FFmpeg.

## 1. Dependências necessárias

| Dependência | Obrigatória? | Para que serve |
|---|---|---|
| Node.js **22.12 ou mais recente** | Sim | Executa o bot e as ferramentas TypeScript. O npm é instalado junto com o Node.js. A versão mínima também está definida em `package.json`. |
| npm | Sim | Instala os pacotes registrados em `package-lock.json`. Use `npm ci` para instalar as versões travadas pelo projeto. |
| FFmpeg e ffprobe | Sim | Convertem os vídeos, geram as figurinhas WebP animadas e extraem o áudio. O bot verifica essas ferramentas ao iniciar. |
| Encoders do FFmpeg `libwebp_anim`, `libwebp`, `libopus` e `libx264` | Sim | São usados na geração da figurinha, no áudio Ogg/Opus e no processamento de trechos de vídeo. Um FFmpeg sem algum deles não atende ao projeto. |
| `yt-dlp` | Não | Alternativa opcional para baixar links quando os extratores JavaScript não funcionarem. Configure `YTDLP_PATH` se o executável não estiver no `PATH`. |
| Python e `.venv` | Não | Não são dependências do bot Node.js. Opcionalmente, o `.venv` pode conter o executável `yt-dlp` usado como alternativa para links de vídeo. |

### Pacotes npm do projeto

Os pacotes de execução estão em `dependencies` no `package.json`; os de desenvolvimento ficam em `devDependencies`.

- **WhatsApp:** `@whiskeysockets/baileys` conecta a conta como aparelho conectado.
- **Links de vídeo:** `@tobyg74/tiktok-api-dl`, `instagram-url-direct` e `youtubei.js` tentam obter vídeos do TikTok, Instagram e YouTube. Os sites podem mudar e quebrar os extratores.
- **QR e logs:** `qrcode`, `qrcode-terminal` e `pino`.
- **Execução TypeScript:** `tsx`.
- **Desenvolvimento:** `typescript`, `@types/node`, `@types/qrcode` e `@types/qrcode-terminal`.

Não é necessário instalar esses pacotes um a um: `npm ci` lê `package-lock.json` e instala as dependências do projeto.
O `yt-dlp` não vem junto com os pacotes npm. É uma alternativa opcional, especialmente útil quando o extrator integrado do YouTube não encontra um formato compatível.

## 2. Instale os pré-requisitos

Abra um terminal e instale Node.js 22.12+ e FFmpeg. Se já estiverem instalados, confira as versões:

```bash
node -v
npm -v
ffmpeg -version
ffprobe -version
```

`node -v` deve mostrar `v22.12.0` ou uma versão mais recente. O `ffmpeg` e o `ffprobe` precisam estar disponíveis no `PATH`.

### Windows

O caminho mais fácil é usar o instalador do próprio projeto, na seção [Início rápido](#3-início-rápido).

Para instalar manualmente, instale o Node.js LTS em [nodejs.org](https://nodejs.org) e o FFmpeg completo pelo `winget`:

```powershell
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id Gyan.FFmpeg
```

Depois da instalação, feche e reabra o terminal para atualizar o `PATH`. Se o FFmpeg não estiver no `PATH`, configure `FFMPEG_PATH` e `FFPROBE_PATH` no arquivo `.env` com o caminho dos executáveis.

### macOS

Instale o [Homebrew](https://brew.sh) se ainda não estiver instalado e execute:

```bash
brew install node ffmpeg
```

### Linux (Debian ou Ubuntu)

Instale Node.js 22.12+ (por exemplo, pela versão LTS disponibilizada em [nodejs.org](https://nodejs.org) ou por um gerenciador de versões) e instale o FFmpeg:

```bash
sudo apt update
sudo apt install -y ffmpeg
```

Confira `node -v` depois de instalar: a versão dos repositórios da distribuição pode ser mais antiga que a exigida pelo projeto. Em distribuições com `dnf`, instale o FFmpeg com o gerenciador de pacotes correspondente; talvez seja necessário habilitar um repositório que forneça o pacote.

### Confira os encoders do FFmpeg

Este comando mostra os encoders disponíveis:

```bash
ffmpeg -hide_banner -encoders
```

Na lista, procure por `libwebp_anim`, `libwebp`, `libopus` e `libx264`. O bot faz essa verificação ao iniciar e informa se estiver faltando algum.

## 3. Início rápido

### Windows: inicializador de um clique

1. Abra a pasta do projeto (ela deve conter `INICIAR-WINDOWS.bat` e `package.json`).
2. Dê dois cliques em `INICIAR-WINDOWS.bat`.
3. O inicializador verifica/instala Node.js e FFmpeg pelo `winget`, instala os pacotes npm, cria `.env` se ainda não existir e inicia o bot.
4. Na primeira execução, escaneie o QR com o celular do número do bot. Se o QR não abrir no navegador, use o QR mostrado no terminal.

Se o Windows mostrar o aviso de proteção, confira que o arquivo veio do projeto e escolha **Mais informações > Executar assim mesmo**. Se o inicializador não encontrar o FFmpeg logo depois de instalá-lo, feche a janela e execute o `.bat` de novo para recarregar o `PATH`.

Para preparar os arquivos sem iniciar o bot, abra PowerShell na pasta do projeto e execute:

```powershell
.\scripts\iniciar.ps1 -SoPreparar
```

### macOS ou Linux: inicializador

No terminal, entre na pasta que contém `iniciar-mac-linux.sh` e execute:

```bash
bash iniciar-mac-linux.sh
```

O script confere os pré-requisitos, instala pacotes npm, cria `.env` se necessário e inicia o bot. Dependendo do sistema, poderá instalar FFmpeg por Homebrew, `apt` ou `dnf`.

Para apenas preparar o projeto, sem ligar o bot:

```bash
bash iniciar-mac-linux.sh --so-preparar
```

## 4. Instalação manual

### Obtenha os arquivos do projeto

Se ainda não tiver uma cópia local, clone o repositório e entre na pasta:

```bash
git clone https://github.com/coelhobugado/whatsapp-figurinhas-com-som.git
cd whatsapp-figurinhas-com-som
```

Se já baixou ou extraiu o projeto, abra o terminal **na pasta do projeto**, onde ficam `package.json` e `package-lock.json`.

### Instale as dependências e crie a configuração

Execute na pasta do projeto:

```bash
npm ci
```

Crie o arquivo `.env` a partir do exemplo. Escolha o comando conforme o terminal:

```bash
# macOS ou Linux (Bash)
cp .env.example .env
```

```powershell
# Windows (PowerShell)
Copy-Item .env.example .env
```

```bat
:: Windows (Prompt de Comando / cmd)
copy .env.example .env
```

Se `.env` já existir, não o sobrescreva: ele contém a configuração local atual. Edite-o com um editor de texto se quiser alterar os valores.

### Inicie o bot

```bash
npm start
```

Na primeira execução, o QR aparece no terminal e também pode ser exibido no navegador em <http://localhost:3999>. No celular que será usado pelo bot, abra **WhatsApp > Configurações > Aparelhos conectados > Conectar um aparelho** e escaneie o QR. A página continua disponível após o pareamento.

Quando o terminal informar `Bot conectado.`, envie um vídeo ao número do bot com a legenda `!som` para testar. Também é possível usar a interface web local:

### Gerar figurinhas pelo navegador

1. Abra <http://localhost:3999> enquanto o bot está em execução e conectado. Se alterou `QR_PORT`, use a porta definida no `.env`.
2. Informe um número de destino com DDI e DDD. O bot consulta se o número está registrado no WhatsApp antes de converter.
3. Escolha `!som` ou `!fig`, o enquadramento e, se necessário, o trecho de até 10 segundos.
4. Envie um vídeo ou GIF de até 16 MB, ou informe um link de vídeo do YouTube, TikTok ou Instagram. Em `!som`, pode escolher também um arquivo de áudio de até 16 MB (MP3, M4A, AAC, WAV, OGG/Opus ou FLAC); ele substitui o áudio do vídeo. O bot usa até 10 segundos, limitado à duração da animação. Áudio sozinho não gera figurinha, pois é necessário fornecer um vídeo/GIF para a parte visual.
5. Acompanhe o pedido na fila. O bot envia a figurinha ao número indicado e arquiva os arquivos em `saida/`; ao terminar, a página oferece os arquivos para baixar.

Por padrão, a interface só aceita a própria origem em `localhost`/`127.0.0.1`. No GitHub Codespaces, para usar o endereço encaminhado da aba **Ports**, adicione `ALLOW_CODESPACES_UI=true` ao `.env`, reinicie o bot e mantenha a porta como **Private**. A autorização vale apenas para a origem HTTPS do Codespace atual e para a porta `QR_PORT`; não torne essa porta pública. A mensagem de conclusão indica que o WhatsApp aceitou o envio, mas não confirma a entrega ao aparelho do destinatário. O bot e a conexão ativa com o WhatsApp precisam continuar em execução.

Para testar apenas os comandos do WhatsApp, mande o vídeo com a legenda `!som` ao número do bot.

Para parar, pressione `Ctrl+C` no terminal.

## 5. Instalar `yt-dlp` (opcional, recomendado para reserva do YouTube)

Quando o YouTube não fornecer um formato compatível ao extrator integrado, o bot tenta usar `yt-dlp`. Uma forma de instalá-lo sem alterar o Python do sistema é dentro do `.venv` do projeto.

**Linux ou macOS**

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade yt-dlp
```

**Windows (PowerShell)**

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade yt-dlp
```

Com o ambiente ativado, rode `npm start` no mesmo terminal. Alternativamente, defina `YTDLP_PATH` no `.env` para apontar ao executável instalado (`./.venv/bin/yt-dlp` no Linux/macOS ou `.\.venv\Scripts\yt-dlp.exe` no Windows). Confira com `yt-dlp --version`.

## 6. Ambiente virtual `.venv` (opcional, Python)

Esta seção é necessária apenas para criar um ambiente Python vazio para **outras ferramentas**. Para o `yt-dlp`, siga a seção anterior. O bot Node.js não usa o ambiente para instalar dependências; ativá-lo não substitui `npm ci`, não fornece Node.js e não instala FFmpeg.

Execute os comandos na pasta do projeto. É necessário ter Python 3 instalado. Confira com o comando apropriado ao sistema:

```bash
# macOS ou Linux
python3 --version
```

```powershell
# Windows
py --version
```

Crie o ambiente:

```bash
# macOS ou Linux
python3 -m venv .venv
```

```powershell
# Windows
py -m venv .venv
```

Ative-o de acordo com o terminal:

```bash
# macOS ou Linux (Bash)
source .venv/bin/activate
```

```powershell
# Windows (PowerShell)
.\.venv\Scripts\Activate.ps1
```

Se o PowerShell bloquear a ativação por política de execução, você pode ativar a política `RemoteSigned` apenas para seu usuário com `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`. Isso é necessário somente para usar o ambiente Python; não afeta a execução do bot Node.js.

```bat
:: Windows (Prompt de Comando / cmd)
.\.venv\Scripts\activate.bat
```

Quando estiver ativo, o terminal normalmente mostra `(.venv)` no início da linha. Para sair do ambiente Python:

```bash
deactivate
```

Esse ambiente pode permanecer desativado; para executar o bot, use os comandos Node.js da seção anterior. A criação de `.venv` é independente da instalação npm.

## 7. Configuração do `.env`

O arquivo `.env` é lido pelo comando `npm start`. As opções mais úteis são:

| Variável | Padrão | Descrição |
|---|---|---|
| `ALLOWED_NUMBERS` | vazio | Números autorizados, separados por vírgula e escritos com DDI e DDD. Vazio significa que qualquer pessoa que consiga enviar mensagem ao bot pode usá-lo; configure uma lista se quiser restringir o acesso. |
| `STICKER_PACK_NAME` | `Criada por Dexter` | Nome mostrado nos metadados da figurinha. |
| `STICKER_PUBLISHER` | vazio | Autor opcional mostrado na figurinha. |
| `AUTH_DIR` | `./sessao` | Pasta da sessão vinculada ao WhatsApp. Trate-a como credencial: não compartilhe nem publique. |
| `QR_PORT` | `3999` | Porta da página local do QR e da interface para gerar figurinhas. |
| `ALLOW_CODESPACES_UI` | `false` | Permite a origem encaminhada do Codespace atual; use apenas com a porta marcada como privada. |
| `MAX_PENDING` | `5` | Quantidade máxima de pedidos aguardando na fila. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | `PATH` | Caminhos dos executáveis se eles não estiverem no `PATH`. |
| `YTDLP_PATH` | `PATH` | Caminho opcional do executável `yt-dlp`, usado como alternativa para links. |
| `DEBUG` | `false` | Use `true` para mostrar informações de diagnóstico sem registrar conteúdo das mensagens. |
| `LOG_LEVEL` | `silent` | Nível dos logs internos do Baileys (`silent`, `warn`, `info` ou `debug`). |

Depois de editar `.env`, pare e inicie o bot novamente para aplicar as alterações.

## 8. Comandos úteis

| Comando | O que faz |
|---|---|
| `npm start` | Inicia o bot. |
| `npm run check` | Executa a checagem de tipos e os testes; os testes usam FFmpeg. |
| `npm run typecheck` | Executa somente a checagem de tipos TypeScript. |
| `npm test` | Executa os testes. |
| `npm run converter -- caminho/do/video.mp4` | Testa a conversão local sem conectar ao WhatsApp; grava os arquivos em `saida/`. |
| `npm run converter -- caminho/do/video.mp4 --trecho 0:42-0:47` | Converte apenas o trecho indicado, sem conectar ao WhatsApp. |
| `npm run bench -- caminho/do/video.mp4` | Mede o tempo das etapas de conversão. |

Para testar se a instalação está pronta, rode:

```bash
npm run check
```

### Arquivos gerados pelo bot

Ao processar uma mensagem, o bot também arquiva os resultados localmente:

- `!som`: `saida/com-som/` recebe o `.webp` e, quando a extração de áudio funciona, o `.ogg` correspondente. Os dois usam o mesmo nome-base.
- Outros comandos, como `!fig`: `saida/outros/` recebe o `.webp`.

O bot salva o resultado da conversão antes de tentar enviá-lo, então ele continua arquivado mesmo se o envio ao WhatsApp falhar. Se ocorrer erro de gravação, o bot registra a falha no terminal e ainda tenta enviar a figurinha. Não são guardados o vídeo original nem o telefone do remetente. Os arquivos não são apagados automaticamente: remova-os manualmente quando não precisar mais deles. O diretório `saida/` já está no `.gitignore`.

## 9. Persistência, privacidade e avisos

- Depois que o aparelho for vinculado, a sessão fica em `sessao/`; nas próximas inicializações o bot tenta conectar sem pedir outro QR. Não apague nem compartilhe essa pasta, a menos que queira remover a sessão e vincular o aparelho de novo.
- O `.env` e a sessão são arquivos locais e não devem ser enviados publicamente. Ambos estão no `.gitignore` do projeto.
- A conversão de mídia é feita localmente com FFmpeg. Para links, o projeto consulta as plataformas e seus extratores; esses serviços podem mudar.
- Baileys é um cliente não oficial do WhatsApp. Automação pode causar restrições ou bloqueio da conta; prefira um número separado e use com moderação. Este projeto não é afiliado à Meta ou ao WhatsApp.

## 10. Solução de problemas

| Problema | O que verificar |
|---|---|
| `node` não é reconhecido ou a versão é antiga | Instale Node.js 22.12+, feche e reabra o terminal e confira `node -v`. |
| `npm ci` falha | Confira a conexão com a internet, entre na pasta correta (a que contém `package-lock.json`) e tente novamente. |
| FFmpeg ou ffprobe não encontrado | Confira `ffmpeg -version` e `ffprobe -version`; instale FFmpeg ou configure `FFMPEG_PATH` e `FFPROBE_PATH` no `.env`. |
| FFmpeg não tem um encoder exigido | Instale um build completo e confira a presença de `libwebp_anim`, `libwebp`, `libopus` e `libx264` com `ffmpeg -hide_banner -encoders`. |
| "Origem da solicitação não autorizada" no Codespaces | Defina `ALLOW_CODESPACES_UI=true`, confira que a porta está **Private** na aba **Ports** e reinicie o bot. |
| QR ou interface não aparece no navegador | Abra <http://localhost:3999>. Se a porta estiver ocupada, defina outra em `QR_PORT` e reinicie; localmente, use `localhost` ou `127.0.0.1`. |
| O bot não responde | Aguarde a mensagem `Bot conectado.`, confira `ALLOWED_NUMBERS` e habilite `DEBUG=true` para diagnóstico. |
| Links de vídeo falham | O site pode ter alterado o formato. Tente novamente; `yt-dlp` é uma alternativa opcional. |
| Link do YouTube não baixa | Instale `yt-dlp` para habilitar o extrator de reserva, confirme que o vídeo é público e tente de novo. |
| Não sei se preciso ativar `.venv` | Não precisa. Esse ambiente é para Python; para o bot, instale as dependências com `npm ci` e execute `npm start`. |

Para mais detalhes sobre os comandos e recursos do bot, consulte o [README.md](./README.md).
