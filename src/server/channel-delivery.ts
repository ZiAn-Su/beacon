// Channel fan-out: deliver a posted channel message into every *other* member
// agent's terminal, the same way a 1:1 /reply does (typed into the ConPTY,
// spawning an idle agent on demand). The poster is skipped; non-agent runtimes
// ignore it and pick the message up by polling channel-inbox.
//
// The framing tells the receiving agent it's group traffic — which channel, who
// spoke, and to reply with post_channel / answer_channel rather than as a 1:1.
// English only (src/** stays ASCII); the sender's display name is data and is
// passed through verbatim.
import * as store from '../core/store';
import { writeToPty } from './pty';
import type { ChannelMessage } from '../core/types';

function senderName(fromSessionId: string | null): string {
  if (!fromSessionId) return 'the human guardian';
  const s = store.getSession(fromSessionId);
  if (!s) return `agent ${fromSessionId.slice(0, 8)}`;
  return s.title || s.task || `agent ${fromSessionId.slice(0, 8)}`;
}

function channelDeliveryLine(
  m: {
    channelId: string;
    channelName: string;
    fromSessionId: string | null;
    kind: 'chat' | 'ask' | 'answer';
    askId: string | null;
    toSessionId: string | null;
    text: string;
  },
  recipientId: string,
): string {
  const who = senderName(m.fromSessionId);
  // @directed framing: the addressed member is told it's for them; everyone else
  // sees it's aimed at that member (still broadcast — the room stays transparent).
  let addressed = '';
  if (m.toSessionId) {
    addressed =
      m.toSessionId === recipientId
        ? ' (addressed to YOU)'
        : ` (addressed to ${senderName(m.toSessionId)})`;
  }
  if (m.kind === 'ask' && m.askId) {
    return (
      `[Beacon channel #${m.channelName} | ${who} ASKS${addressed}] ${m.text} ` +
      `(answer the group with the answer_channel tool: channel_id=${m.channelId} ask_id=${m.askId})`
    );
  }
  if (m.kind === 'answer') {
    return `[Beacon channel #${m.channelName} | ${who} answered] ${m.text}`;
  }
  return (
    `[Beacon channel #${m.channelName} | ${who}${addressed}] ${m.text} ` +
    `(reply to the group with the post_channel tool: channel_id=${m.channelId} — this is a group channel, not a 1:1)`
  );
}

/** Push a freshly-posted channel message to its other members' terminals. */
export function fanOutChannelMessage(m: ChannelMessage): void {
  const channel = store.getChannel(m.channelId);
  if (!channel) return;
  for (const pid of store.listParticipants(m.channelId)) {
    if (pid === m.fromSessionId) continue;
    const line = channelDeliveryLine(
      {
        channelId: m.channelId,
        channelName: channel.name,
        fromSessionId: m.fromSessionId,
        kind: m.kind,
        askId: m.askId,
        toSessionId: m.toSessionId,
        text: m.text,
      },
      pid,
    );
    // writeToPty spawns an idle agent on demand; true means it reached a live
    // terminal — record that as a delivery receipt (false for non-agent runtimes).
    if (writeToPty(pid, line)) store.markChannelDelivered(m.channelId, pid);
  }
}
