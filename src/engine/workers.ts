// A small pool of tile workers (tile-worker.ts, bundled by Vite); one request per tile, cancellable.
import type { Frame, LoadedTile } from './tiles';

interface Pending { resolve: (t: LoadedTile) => void; reject: (e: Error) => void; worker: Worker }

export class TileWorkers {
  private workers: Worker[];
  private load: number[];
  private pending = new Map<number, Pending>();
  private next = 1;

  constructor(size: number) {
    this.workers = Array.from({ length: size }, () => new Worker(new URL('./tile-worker.ts', import.meta.url), { type: 'module' }));
    this.load = this.workers.map(() => 0);
    this.workers.forEach((w, i) => {
      w.onmessage = (e: MessageEvent) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        this.load[i]--;
        if (e.data.error) p.reject(new Error(e.data.error));
        else p.resolve(e.data.tile as LoadedTile);
      };
    });
  }

  /** returns the request id (for cancel) and the promise */
  request(url: string, frame: Frame, transform: number[] | null = null): { id: number; done: Promise<LoadedTile> } {
    const id = this.next++;
    const i = this.load.indexOf(Math.min(...this.load));
    const worker = this.workers[i];
    this.load[i]++;
    const done = new Promise<LoadedTile>((resolve, reject) => this.pending.set(id, { resolve, reject, worker }));
    worker.postMessage({ type: 'load', id, url, frame, transform });
    return { id, done };
  }

  cancel(id: number) {
    const p = this.pending.get(id);
    if (p) p.worker.postMessage({ type: 'cancel', id });
  }
}
