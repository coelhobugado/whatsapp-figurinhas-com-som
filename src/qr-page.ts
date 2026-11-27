/**
 * Página local (só 127.0.0.1) que mostra o QR de vinculação como imagem e se atualiza sozinha.
 * Mais fácil de escanear do que o QR desenhado com caracteres no terminal.
 */
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import QRCode from 'qrcode';

type State = { qr?: string; connected: boolean };
const state: State = { connected: false };
let server: Server | undefined;

const PAGE = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Vincular bot</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f4f2;color:#1d1d1b;font:16px/1.5 system-ui,sans-serif}
  main{text-align:center;padding:24px;max-width:420px}
  #qr{background:#fff;padding:16px;border-radius:12px;display:inline-block;min-height:280px;min-width:280px}
  #qr svg{width:280px;height:280px;display:block}
  ol{text-align:left;padding-left:20px}
  .ok{font-size:22px;font-weight:600;color:#1a7f37}
</style></head><body><main>
<h1>Vincular o bot</h1>
<div id="qr">Aguardando QR…</div>
<ol><li>No celular do bot, abra o WhatsApp.</li><li>Vá em <b>Configurações › Aparelhos conectados › Conectar um aparelho</b>.</li><li>Aponte a câmera para o QR acima.</li></ol>
<p><small>O QR muda a cada ~20 s; esta página acompanha sozinha.</small></p>
</main><script>
async function tick(){
  try{
    const r=await fetch('/estado',{cache:'no-store'}); const s=await r.json();
    const box=document.getElementById('qr');
    if(s.connected){box.innerHTML='<p class="ok">✅ Conectado!</p><p>Pode fechar esta página.</p>';return;}
    if(s.svg&&box.dataset.qr!==s.qr){box.innerHTML=s.svg;box.dataset.qr=s.qr;}
  }catch{}
  setTimeout(tick,1500);
}
tick();
</script></body></html>`;

let opened = false;
/** Abre a página no navegador padrão (uma vez só). Usado pelo instalador de 1 clique. */
function openInBrowser(url: string): void {
  if (opened) return;
  opened = true;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref(); } catch { /* sem navegador: o QR continua no terminal */ }
}

export function startQrPage(port: number, options: { open?: boolean } = {}): void {
  if (options.open && !server) setTimeout(() => openInBrowser(`http://localhost:${port}`), 800);
  if (server) return;
  server = createServer(async (req, res) => {
    if (req.url === '/estado') {
      const svg = state.qr ? await QRCode.toString(state.qr, { type: 'svg', margin: 1, errorCorrectionLevel: 'L' }) : undefined;
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ connected: state.connected, qr: state.qr, svg }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(PAGE);
  });
  server.listen(port, '127.0.0.1', () => console.log(`QR também disponível em http://localhost:${port}`));
  server.on('error', error => console.error('Página do QR indisponível:', error.message));
}

export function setQr(qr: string): void { state.qr = qr; state.connected = false; }

/** Marca como conectado e desliga a página pouco depois (a página mostra "Conectado"). */
export function markConnected(): void {
  state.connected = true;
  state.qr = undefined;
  if (server) { const s = server; server = undefined; setTimeout(() => s.close(), 10_000).unref(); }
}
