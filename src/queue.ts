/**
 * Fila de pedidos justa entre conversas.
 *
 * - Faz até `parallel` figurinhas ao mesmo tempo (conforme os núcleos do computador).
 * - Reveza entre as conversas: um grupo com 10 pedidos não faz o privado de alguém esperar os 10.
 * - Nunca roda dois pedidos da mesma pessoa ao mesmo tempo.
 * - Limites: por pessoa, por conversa e no total, para ninguém travar o bot sozinho.
 * - Cada pedido tem um tempo máximo; erro ou demora num pedido não trava os outros.
 */
export type JobMeta = { id: string; chat: string; person: string };
export type RefusalReason = 'pessoa' | 'conversa' | 'cheia' | 'repetido';
export type AddResult =
  | { status: 'started' }
  | { status: 'waiting'; ahead: number }
  | { status: 'refused'; reason: RefusalReason };

export type FairQueueOptions = {
  /** Quantos pedidos rodam ao mesmo tempo. */
  parallel: number;
  /** Pedidos de uma pessoa (rodando + esperando). */
  perPerson: number;
  /** Pedidos de uma conversa (rodando + esperando). */
  perChat: number;
  /** Pedidos no total (rodando + esperando). */
  maxTotal: number;
  /** Tempo máximo de um pedido (rede de segurança: o pedido deve ter o próprio limite, menor). */
  timeoutMs: number;
  onError?: (error: unknown, job: JobMeta) => void;
};

type Waiting = { meta: JobMeta; run: () => Promise<void> };

export class FairQueue {
  /** Pedidos esperando, por conversa (ordem de chegada dentro da conversa). */
  private readonly waiting = new Map<string, Waiting[]>();
  /** Quantos pedidos de cada conversa já começaram desde que ela entrou na fila (a vez é de quem foi menos atendido). */
  private readonly served = new Map<string, number>();
  private readonly running = new Map<string, JobMeta>();
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly options: FairQueueOptions) {}

  get runningCount(): number { return this.running.size; }
  get waitingCount(): number { let n = 0; for (const list of this.waiting.values()) n += list.length; return n; }
  get size(): number { return this.runningCount + this.waitingCount; }

  private *all(): Generator<JobMeta> {
    yield* this.running.values();
    for (const list of this.waiting.values()) for (const job of list) yield job.meta;
  }

  has(id: string): boolean {
    for (const job of this.all()) if (job.id === id) return true;
    return false;
  }

  add(meta: JobMeta, run: () => Promise<void>): AddResult {
    let person = 0, chat = 0, total = 0;
    for (const job of this.all()) {
      if (job.id === meta.id) return { status: 'refused', reason: 'repetido' };
      if (job.person === meta.person) person++;
      if (job.chat === meta.chat) chat++;
      total++;
    }
    if (person >= this.options.perPerson) return { status: 'refused', reason: 'pessoa' };
    if (chat >= this.options.perChat) return { status: 'refused', reason: 'conversa' };
    if (total >= this.options.maxTotal) return { status: 'refused', reason: 'cheia' };

    const list = this.waiting.get(meta.chat);
    if (list) list.push({ meta, run });
    else this.waiting.set(meta.chat, [{ meta, run }]);
    this.pump();
    return this.running.has(meta.id) ? { status: 'started' } : { status: 'waiting', ahead: this.waitingCount - 1 };
  }

  /**
   * Próximo pedido: da conversa menos atendida até agora (empate: a que chegou antes), pulando quem já
   * está com um pedido rodando.
   */
  private next(): Waiting | undefined {
    const busy = new Set([...this.running.values()].map(job => job.person));
    let best: { chat: string; index: number; served: number } | undefined;
    for (const [chat, list] of this.waiting) {
      const index = list.findIndex(job => !busy.has(job.meta.person));
      if (index === -1) continue;
      const served = this.served.get(chat) ?? 0;
      if (!best || served < best.served) best = { chat, index, served };
    }
    if (!best) return undefined;
    const list = this.waiting.get(best.chat)!;
    const [job] = list.splice(best.index, 1);
    if (!list.length) this.waiting.delete(best.chat);
    this.served.set(best.chat, best.served + 1);
    return job;
  }

  /** Conversa sem nada na fila volta do zero na contagem de atendimentos. */
  private forget(chat: string): void {
    if (this.waiting.has(chat)) return;
    for (const job of this.running.values()) if (job.chat === chat) return;
    this.served.delete(chat);
  }

  private pump(): void {
    while (this.running.size < this.options.parallel) {
      const job = this.next();
      if (!job) break;
      this.running.set(job.meta.id, job.meta);
      withTimeout(Promise.resolve().then(job.run), this.options.timeoutMs)
        .catch(error => this.options.onError?.(error, job.meta))
        .finally(() => {
          this.running.delete(job.meta.id);
          this.forget(job.meta.chat);
          this.pump();
          if (!this.size) { const waiters = this.idleWaiters; this.idleWaiters = []; for (const resolve of waiters) resolve(); }
        });
    }
  }

  /** Espera tudo que está na fila terminar (para desligar ou atualizar sem cortar um envio no meio). */
  idle(): Promise<void> {
    if (!this.size) return Promise.resolve();
    return new Promise(resolve => this.idleWaiters.push(resolve));
  }
}

export class TimeoutError extends Error {}

export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`Passou de ${Math.round(ms / 1000)} s.`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
