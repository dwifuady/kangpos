// Web Worker that runs one before/after script. A worker has no DOM and no
// access to the app's Tauri bridge (it lives on the main window). We also take
// away direct network and storage APIs, so pm.sendRequest (answered by the
// host) is the only way out.

import { executeScript, type OutgoingRequest, type SandboxResponse, type ScriptContext } from './sandbox';

const BLOCKED = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'WebTransport',
  'EventSource',
  'importScripts',
  'indexedDB',
  'caches',
  'Worker',
  'SharedWorker',
  'BroadcastChannel',
];

for (const name of BLOCKED) {
  // Remove it from the global and from every prototype it may be inherited from.
  for (let target: object | null = self; target; target = Object.getPrototypeOf(target)) {
    if (!Object.getOwnPropertyDescriptor(target, name)) continue;
    try {
      Object.defineProperty(target, name, { value: undefined, writable: false, configurable: false });
    } catch {
      // Non-configurable on this engine: leave it, the next level may still be removable.
    }
  }
}

type HostMessage =
  | { type: 'run'; code: string; ctx: ScriptContext }
  | { type: 'sendResult'; id: number; response?: SandboxResponse; error?: string };

const waiting = new Map<number, { resolve: (r: SandboxResponse) => void; reject: (e: Error) => void }>();
let nextId = 1;

function sendRequest(request: OutgoingRequest): Promise<SandboxResponse> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    self.postMessage({ type: 'send', id, request });
  });
}

self.addEventListener('message', async (event: MessageEvent<HostMessage>) => {
  const msg = event.data;
  if (msg.type === 'sendResult') {
    const entry = waiting.get(msg.id);
    if (!entry) return;
    waiting.delete(msg.id);
    if (msg.response) entry.resolve(msg.response);
    else entry.reject(new Error(msg.error ?? 'Request failed'));
    return;
  }
  if (msg.type === 'run') {
    const outcome = await executeScript(msg.code, msg.ctx, { sendRequest });
    self.postMessage({ type: 'done', outcome });
  }
});
