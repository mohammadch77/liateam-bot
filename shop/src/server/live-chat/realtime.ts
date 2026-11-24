import 'server-only';
import { EventEmitter } from 'node:events';
import type { ChatEventEnvelope } from '@/lib/live-chat/types';

type Listener = (envelope: ChatEventEnvelope) => void;

const globalKey = '__avinaLiveChatBus__';
type BusHolder = { [globalKey]?: EventEmitter };

function getBus(): EventEmitter {
  const g = globalThis as unknown as BusHolder;
  if (!g[globalKey]) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(500);
    g[globalKey] = emitter;
  }
  return g[globalKey]!;
}

export const liveChatBus = {
  publishToStaff(event: ChatEventEnvelope['event'], payload: Record<string, unknown>, conversationId?: string) {
    const envelope: ChatEventEnvelope = { event, conversationId, payload, ts: Date.now() };
    getBus().emit('staff', envelope);
  },

  publishToVisitor(
    visitorToken: string,
    event: ChatEventEnvelope['event'],
    payload: Record<string, unknown>,
    conversationId?: string,
  ) {
    const envelope: ChatEventEnvelope = { event, conversationId, payload, ts: Date.now() };
    getBus().emit(`visitor:${visitorToken}`, envelope);
  },

  publishBoth(
    visitorToken: string,
    event: ChatEventEnvelope['event'],
    payload: Record<string, unknown>,
    conversationId?: string,
  ) {
    const envelope: ChatEventEnvelope = { event, conversationId, payload, ts: Date.now() };
    const bus = getBus();
    bus.emit('staff', envelope);
    bus.emit(`visitor:${visitorToken}`, envelope);
  },

  subscribe(channel: string, listener: Listener): () => void {
    const bus = getBus();
    bus.on(channel, listener);
    return () => {
      bus.off(channel, listener);
    };
  },
};

/**
 * Create a Server-Sent Events (SSE) Response subscribed to a realtime channel.
 * Sets X-Accel-Buffering: no so Nginx forwards events immediately without buffering.
 */
export function createSseResponse(channel: string, signal: AbortSignal): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const sendRaw = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const onEvent: Listener = (envelope) => {
        sendRaw(`event: ${envelope.event}\ndata: ${JSON.stringify(envelope)}\n\n`);
      };

      const unsubscribe = liveChatBus.subscribe(channel, onEvent);
      const heartbeat = setInterval(() => {
        sendRaw(`: ping ${Date.now()}\n\n`);
      }, 20_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      signal.addEventListener('abort', cleanup, { once: true });

      // Tell client to retry quickly on disconnect and send initial connected event
      sendRaw(`retry: 3000\nevent: connected\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
