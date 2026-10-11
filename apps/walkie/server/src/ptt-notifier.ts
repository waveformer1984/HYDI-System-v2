import type { PushSender } from './apns.js';
import type { Logger } from './floor.js';
import type { PttPushToken, Store } from './store/types.js';

/**
 * Wakes iPhones that joined a channel through Apple's PushToTalk framework
 * (Milestone 3). A suspended or locked iPhone does not hold the LiveKit
 * connection, so when someone is granted the turn, every *other* member with
 * a PTT token gets a `pushtotalk` push. iOS then wakes the app, shows the
 * speaker in the system UI and activates audio. Removed members get a
 * `leave` push so iOS drops the channel.
 *
 * Payloads carry only the speaker's display name and ids, never audio.
 * They pass through Apple's push service.
 */
export class PttNotifier {
  constructor(
    private readonly store: Store,
    private readonly sender: PushSender,
    private readonly log: Logger,
  ) {}

  /** Fire-and-forget: never delays the grant it reports. */
  speakerStarted(channelId: string, speaker: { userId: string; displayName: string }, leaseId: string): Promise<void> {
    return this.fanOut(channelId, (t) => t.userId !== speaker.userId, {
      activeSpeaker: speaker.displayName,
      speakerUserId: speaker.userId,
      channelId,
      leaseId,
    });
  }

  /** Tell the given members' devices to leave the channel. Pass tokens read *before* removing the membership. */
  async leave(channelId: string, tokens: PttPushToken[]): Promise<void> {
    await Promise.all(tokens.map((t) => this.send(channelId, t, { leave: true, channelId })));
  }

  private async fanOut(channelId: string, include: (t: PttPushToken) => boolean, payload: Record<string, unknown>) {
    let tokens: PttPushToken[];
    try {
      tokens = (await this.store.listPttTokens(channelId)).filter(include);
    } catch (err) {
      this.log.error({ channelId, err: err instanceof Error ? err.message : 'Unknown error' }, 'ptt: listing tokens failed');
      return;
    }
    await Promise.all(tokens.map((t) => this.send(channelId, t, payload)));
  }

  private async send(channelId: string, t: PttPushToken, payload: Record<string, unknown>) {
    try {
      const r = await this.sender.sendPushToTalk(t.token, t.environment, payload);
      if (r.ok) return;
      if (r.unregistered) {
        await this.store.deletePttTokenValue(t.token);
        this.log.info({ channelId, userId: t.userId, status: r.status, reason: r.reason }, 'ptt: token rejected by APNs, deleted');
      } else {
        this.log.warn({ channelId, userId: t.userId, status: r.status, reason: r.reason }, 'ptt: push failed');
      }
    } catch (err) {
      this.log.warn({ channelId, userId: t.userId, err: err instanceof Error ? err.message : 'Unknown error' }, 'ptt: push error');
    }
  }
}
