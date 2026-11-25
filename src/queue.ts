/**
 * Fila de pedidos: um por vez (a conversão já usa vários núcleos), com limite total
 * e no máximo um pedido por pessoa esperando, para ninguém travar o bot sozinho.
 */
export type Enqueued = { status: 'queued'; position: number } | { status: 'full' } | { status: 'duplicate' };

export class JobQueue {
  private chain: Promise<void> = Promise.resolve();
  private readonly owners = new Map<string, number>();
  private waiting = 0;

  constructor(private readonly maxPending = 5, private readonly timeoutMs = 3 * 60_000,
    private readonly onError: (error: unknown) => void = error => console.error(error)) {}

  get size(): number { return this.waiting; }

  /** `owner` identifica quem pediu (ex.: chat + remetente). `position` 1 = começa agora. */
  add(owner: string, job: () => Promise<void>): Enqueued {
    if (this.owners.has(owner)) return { status: 'duplicate' };
    if (this.waiting >= this.maxPending) return { status: 'full' };
    this.waiting++;
    this.owners.set(owner, (this.owners.get(owner) ?? 0) + 1);
    const position = this.waiting;
    this.chain = this.chain
      .then(() => withTimeout(job(), this.timeoutMs))
      .catch(this.onError)
      .finally(() => { this.waiting--; this.owners.delete(owner); });
    return { status: 'queued', position };
  }

  /** Espera tudo que está na fila terminar (para desligar sem cortar um envio no meio). */
  idle(): Promise<void> { return this.chain; }
}

export class TimeoutError extends Error {}

export function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`Passou de ${Math.round(ms / 1000)} s.`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
