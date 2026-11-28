/**
 * Pedidos salvos em disco (`dados/pedidos.json`) enquanto estão na fila ou rodando.
 * Se o bot cair, atualizar ou o computador desligar, ao voltar ele refaz o que ficou pela metade.
 * Um pedido que derrubou o bot duas vezes é abandonado (com aviso), para não entrar num ciclo de quedas.
 *
 * O arquivo tem o conteúdo das mensagens (para baixar a mídia de novo): fica só no computador do bot,
 * como a pasta `sessao/`. Nunca publique a pasta `dados/`.
 */
import { BufferJSON, type WAMessage } from '@whiskeysockets/baileys';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Command } from './commands.js';

export type PendingJob = {
  id: string;
  command: Command;
  text: string;
  message: WAMessage;
  /** Quando a mensagem foi enviada (ms). */
  sentAt: number;
  /** Quantas vezes o pedido já começou (sobe a cada reinício do bot com ele pendente). */
  attempts: number;
};

/** Só o necessário da mensagem: chave, conteúdo, horário e nome. */
export function slimMessage(message: WAMessage): WAMessage {
  return {
    key: message.key,
    message: message.message,
    messageTimestamp: Number(String(message.messageTimestamp ?? 0)) || 0,
    pushName: message.pushName,
  };
}

export class PendingStore {
  private readonly jobs = new Map<string, PendingJob>();
  readonly file: string;

  constructor(dir: string) {
    this.file = join(dir, 'pedidos.json');
  }

  /** Lê os pedidos que ficaram de antes. Arquivo ausente ou quebrado = nenhum. */
  load(): PendingJob[] {
    try {
      const list = JSON.parse(readFileSync(this.file, 'utf8'), BufferJSON.reviver) as PendingJob[];
      for (const job of list) if (job?.id && job.message?.key) this.jobs.set(job.id, job);
    } catch { /* nenhum pedido salvo */ }
    return [...this.jobs.values()];
  }

  get size(): number { return this.jobs.size; }

  save(job: PendingJob): void { this.jobs.set(job.id, job); this.flush(); }

  remove(id: string): void { if (this.jobs.delete(id)) this.flush(); }

  /** Grava de forma atômica (arquivo temporário + renomear): uma queda no meio não corrompe o arquivo. */
  private flush(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temp = `${this.file}.tmp`;
      writeFileSync(temp, JSON.stringify([...this.jobs.values()], BufferJSON.replacer));
      renameSync(temp, this.file);
    } catch { /* sem disco: segue sem persistir */ }
  }
}
