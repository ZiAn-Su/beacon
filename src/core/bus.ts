// In-process event bus. The store emits here; any "chat backend" (the built-in
// web UI gateway, or a future Matrix bridge) subscribes to mirror agent->human
// events outward, and calls back into the store for human->agent replies.
import { EventEmitter } from 'node:events';
import type { Session, Message, Channel, ChannelMessage } from './types';

type Events = {
  session: (s: Session) => void;
  message: (m: Message) => void;
  sessionRemoved: (id: string) => void;
  channel: (c: Channel) => void;
  channelRemoved: (id: string) => void;
  channelMessage: (m: ChannelMessage) => void;
};

class TypedBus extends EventEmitter {
  emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): boolean {
    return super.emit(event, ...args);
  }
  on<K extends keyof Events>(event: K, listener: Events[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
}

export const bus = new TypedBus();
