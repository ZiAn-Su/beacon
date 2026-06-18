// The ChatBackend seam.
//
// A "chat backend" is whatever carries agent<->human messages on the HUMAN side.
// The bundled React UI is the default backend (it talks to the gateway's north
// REST API + the WS event stream). This file documents the contract so an
// alternative backend — e.g. a Matrix/Element bridge — is a clean drop-in
// without touching the core or the MCP south side.
//
// A backend needs exactly two wires, both already provided by the core:
//
//   agent -> human   subscribe to `bus` ('session' | 'message') and mirror
//                    those events outward (into Matrix rooms, push, etc.)
//
//   human -> agent   call `store.reply(sessionId, text, askId?)` when the human
//                    sends/answers. Passing `askId` resolves a pending ask and
//                    unblocks the waiting agent.
//
// The only mapping a real backend maintains is session.id <-> its own channel
// identity (e.g. a Matrix room id). Everything else (state machine, ask
// blocking, history) stays in the core.
//
// See docs/matrix-backend.md for how a Matrix appservice would implement this.
import type { Session, Message } from '../core/types';

export interface ChatBackend {
  /** Human-readable name, e.g. "web", "matrix". */
  readonly name: string;

  /** Start mirroring. Implementations subscribe to the core `bus` here. */
  start(): Promise<void> | void;

  /** A session was created or changed (status, etc.). Reflect it on the human side. */
  onSession(session: Session): Promise<void> | void;

  /** A new agent->human (or echoed human) message. Render it on the human side. */
  onMessage(message: Message): Promise<void> | void;

  /** Tear down (close sockets, leave rooms). */
  stop?(): Promise<void> | void;
}

// Human -> agent flows back through the core directly:
//   import * as store from '../core/store';
//   store.reply(sessionId, text, askId);   // askId resolves a pending ask
