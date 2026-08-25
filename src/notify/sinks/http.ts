import { SINK_HTTP_TIMEOUT_MS } from './types.js';

/** POST a JSON body to a sink endpoint, bounded by a fixed timeout. */
export async function postJson(url: string, body: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SINK_HTTP_TIMEOUT_MS);
  timer.unref?.();
  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
