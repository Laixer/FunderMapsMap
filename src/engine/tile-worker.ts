// Web Worker: fetches and converts 3D BAG tiles off the main thread, so panning never stalls on a big tile.
import { loadTile, transferables } from './tiles';

const scope = self as unknown as { onmessage: ((e: MessageEvent) => void) | null; postMessage: (msg: unknown, transfer?: Transferable[]) => void };
const running = new Map<number, AbortController>();

scope.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    running.get(msg.id)?.abort();
    return;
  }
  const abort = new AbortController();
  running.set(msg.id, abort);
  try {
    const tile = await loadTile(msg.url, msg.frame, abort.signal);
    scope.postMessage({ id: msg.id, tile }, transferables(tile));
  } catch (err) {
    scope.postMessage({ id: msg.id, error: abort.signal.aborted ? 'aborted' : String(err) });
  } finally {
    running.delete(msg.id);
  }
};
