// Host side of script runs: one fresh worker per run, a time limit that pauses
// while pm.sendRequest calls are in flight, and request forwarding to Rust.

import ScriptWorker from './worker?worker';
import type { OutgoingRequest, SandboxResponse, ScriptContext, ScriptOutcome } from './sandbox';

export const SCRIPT_TIME_LIMIT_MS = 10_000;

export interface RunnerHooks {
  sendRequest(request: OutgoingRequest): Promise<SandboxResponse>;
}

function failure(ctx: ScriptContext, message: string, durationMs: number): ScriptOutcome {
  return {
    tests: [],
    logs: [{ level: 'error', message }],
    envChanges: {},
    locals: {},
    request: ctx.request,
    error: message,
    durationMs,
  };
}

export function runScript(code: string, ctx: ScriptContext, hooks: RunnerHooks, limitMs = SCRIPT_TIME_LIMIT_MS): Promise<ScriptOutcome> {
  return new Promise(resolve => {
    const started = Date.now();
    const worker = new ScriptWorker();
    let finished = false;
    let inFlight = 0;
    let budget = limitMs;
    let budgetStart = Date.now();
    let timer: number | undefined;

    const finish = (outcome: ScriptOutcome) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      worker.terminate();
      resolve(outcome);
    };
    const startClock = () => {
      budgetStart = Date.now();
      timer = window.setTimeout(
        () => finish(failure(ctx, `Script ran longer than ${limitMs / 1000} s and was stopped (check for endless loops)`, Date.now() - started)),
        budget,
      );
    };
    const pauseClock = () => {
      window.clearTimeout(timer);
      budget = Math.max(0, budget - (Date.now() - budgetStart));
    };

    worker.onmessage = async (event: MessageEvent) => {
      const msg = event.data as { type?: string; id?: number; request?: OutgoingRequest; outcome?: ScriptOutcome };
      if (msg?.type === 'done' && msg.outcome) {
        finish(msg.outcome);
      } else if (msg?.type === 'send' && typeof msg.id === 'number' && msg.request) {
        // Network time doesn't count against the script's time limit.
        if (inFlight++ === 0) pauseClock();
        try {
          const response = await hooks.sendRequest(msg.request);
          if (!finished) worker.postMessage({ type: 'sendResult', id: msg.id, response });
        } catch (e) {
          if (!finished) worker.postMessage({ type: 'sendResult', id: msg.id, error: e instanceof Error ? e.message : String(e) });
        } finally {
          if (--inFlight === 0 && !finished) startClock();
        }
      }
    };
    worker.onerror = event => {
      event.preventDefault();
      finish(failure(ctx, event.message || 'The script could not be run', Date.now() - started));
    };

    startClock();
    worker.postMessage({ type: 'run', code, ctx });
  });
}
