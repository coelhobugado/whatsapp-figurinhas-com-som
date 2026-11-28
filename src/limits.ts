/**
 * Proteção contra flood.
 *
 * - `RateLimiter`: no máximo N ações por chave (pessoa, grupo) numa janela de tempo.
 * - `Pacer`: ritmo de envio de mensagens do bot. Responder rápido demais a muita gente é o que faz o
 *   WhatsApp bloquear números de bot; o Pacer segura o envio sem perder nada (na ordem de chegada).
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  /** Registra uma ação de `key`. Devolve false se passou do limite (a ação não é contada). */
  hit(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter(t => t > now - this.windowMs);
    if (recent.length >= this.limit) { this.hits.set(key, recent); return false; }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.prune(now);
    return true;
  }

  private prune(now: number): void {
    for (const [key, times] of this.hits) if (!times.some(t => t > now - this.windowMs)) this.hits.delete(key);
  }
}

/** Balde de fichas: até `burst` mensagens de uma vez e depois `perMinute` por minuto. */
export class Pacer {
  private tokens: number;
  private last: number;
  private readonly waiters: (() => void)[] = [];
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly perMinute: number, private readonly burst: number, private readonly clock = () => Date.now()) {
    this.tokens = burst;
    this.last = clock();
  }

  private refill(): void {
    const now = this.clock();
    this.tokens = Math.min(this.burst, this.tokens + (now - this.last) * this.perMinute / 60_000);
    this.last = now;
  }

  /** Pega uma ficha só se tiver agora (para avisos que podem ser descartados). */
  tryTake(): boolean {
    this.refill();
    if (this.waiters.length || this.tokens < 1) return false;
    this.tokens--;
    return true;
  }

  /** Espera a vez de enviar (na ordem de chegada). */
  wait(): Promise<void> {
    if (this.tryTake()) return Promise.resolve();
    return new Promise(resolve => { this.waiters.push(resolve); this.schedule(); });
  }

  get queued(): number { return this.waiters.length; }

  private schedule(): void {
    if (this.timer) return;
    const ms = Math.max(10, (1 - this.tokens) * 60_000 / this.perMinute);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.refill();
      while (this.waiters.length && this.tokens >= 1) { this.tokens--; this.waiters.shift()!(); }
      if (this.waiters.length) this.schedule();
    }, ms);
  }
}
