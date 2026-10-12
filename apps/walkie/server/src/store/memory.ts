import { randomUUID } from 'node:crypto';
import type { AcquireResult, ApnsEnvironment, Channel, Lease, Member, Profile, PttPushToken, RedeemResult, Role, Store } from './types.js';
import { leaseIsLive } from './types.js';

/**
 * Single-process store for development and tests. Every method body runs
 * without an intervening await, so each call is atomic with respect to other
 * calls on the same event loop. It cannot coordinate several server
 * processes; config refuses it in production.
 */
export class MemoryStore implements Store {
  private profiles = new Map<string, Profile>();
  private channels = new Map<string, Channel>();
  private members = new Map<string, Map<string, { role: Role; joinedAt: number }>>();
  private blocks = new Map<string, Map<string, { blockedBy: string; blockedAt: number }>>();
  private invites = new Map<string, { channelId: string; expiresAt: number; maxUses: number; uses: number }>();
  private floors = new Map<string, Lease>();
  private pttTokens = new Map<string, Map<string, PttPushToken>>();

  async getProfile(userId: string) {
    return this.profiles.get(userId) ?? null;
  }

  async upsertProfile(userId: string, displayName: string) {
    const p = { userId, displayName };
    this.profiles.set(userId, p);
    return p;
  }

  async createChannel(ownerId: string, name: string) {
    const ch: Channel = { id: randomUUID(), name, ownerId, createdAt: Date.now() };
    this.channels.set(ch.id, ch);
    this.members.set(ch.id, new Map([[ownerId, { role: 'owner', joinedAt: ch.createdAt }]]));
    this.blocks.set(ch.id, new Map());
    return ch;
  }

  async getChannel(channelId: string) {
    return this.channels.get(channelId) ?? null;
  }

  async deleteChannel(channelId: string) {
    this.channels.delete(channelId);
    this.members.delete(channelId);
    this.blocks.delete(channelId);
    this.floors.delete(channelId);
    this.pttTokens.delete(channelId);
    for (const [k, inv] of this.invites) if (inv.channelId === channelId) this.invites.delete(k);
  }

  async listChannelsForUser(userId: string) {
    const out: Array<Channel & { role: Role }> = [];
    for (const [cid, m] of this.members) {
      const mine = m.get(userId);
      const ch = this.channels.get(cid);
      if (mine && ch) out.push({ ...ch, role: mine.role });
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  async getRole(channelId: string, userId: string) {
    return this.members.get(channelId)?.get(userId)?.role ?? null;
  }

  async listMembers(channelId: string): Promise<Member[]> {
    const m = this.members.get(channelId);
    if (!m) return [];
    return [...m].map(([userId, v]) => ({
      userId,
      role: v.role,
      joinedAt: v.joinedAt,
      displayName: this.profiles.get(userId)?.displayName ?? null,
    }));
  }

  async removeMember(channelId: string, userId: string) {
    this.pttTokens.get(channelId)?.delete(userId);
    return this.members.get(channelId)?.delete(userId) ?? false;
  }

  async block(channelId: string, userId: string, blockedBy: string) {
    this.blocks.get(channelId)?.set(userId, { blockedBy, blockedAt: Date.now() });
    this.members.get(channelId)?.delete(userId);
    this.pttTokens.get(channelId)?.delete(userId);
  }

  async unblock(channelId: string, userId: string) {
    this.blocks.get(channelId)?.delete(userId);
  }

  async isBlocked(channelId: string, userId: string) {
    return this.blocks.get(channelId)?.has(userId) ?? false;
  }

  async listBlocks(channelId: string) {
    const b = this.blocks.get(channelId);
    if (!b) return [];
    return [...b].map(([userId, v]) => ({ userId, blockedAt: v.blockedAt, displayName: this.profiles.get(userId)?.displayName ?? null }));
  }

  async createInvite(channelId: string, _createdBy: string, codeHash: string, expiresAt: number, maxUses: number) {
    this.invites.set(codeHash, { channelId, expiresAt, maxUses, uses: 0 });
  }

  async redeemInvite(codeHash: string, userId: string, now: number, maxMembers: number): Promise<RedeemResult> {
    const inv = this.invites.get(codeHash);
    if (!inv || !this.channels.has(inv.channelId)) return { ok: false, reason: 'invalid' };
    const members = this.members.get(inv.channelId)!;
    if (members.has(userId)) return { ok: true, channelId: inv.channelId, alreadyMember: true };
    if (now >= inv.expiresAt) return { ok: false, reason: 'expired' };
    if (inv.uses >= inv.maxUses) return { ok: false, reason: 'exhausted' };
    if (this.blocks.get(inv.channelId)?.has(userId)) return { ok: false, reason: 'blocked' };
    if (members.size >= maxMembers) return { ok: false, reason: 'full' };
    inv.uses += 1;
    members.set(userId, { role: 'member', joinedAt: now });
    return { ok: true, channelId: inv.channelId, alreadyMember: false };
  }

  async acquireFloor({ channelId, userId, leaseId, now, renewTtlMs, maxMs }: { channelId: string; userId: string; leaseId: string; now: number; renewTtlMs: number; maxMs: number }): Promise<AcquireResult> {
    const cur = this.floors.get(channelId);
    if (cur && leaseIsLive(cur, now)) {
      if (cur.userId !== userId) return { ok: false, holder: { ...cur } };
      // Same user asking again (e.g. a retried request): hand back the
      // existing turn. The hard deadline is never extended.
      cur.renewDeadline = Math.min(now + renewTtlMs, cur.hardDeadline);
      return { ok: true, lease: { ...cur }, reused: true };
    }
    const lease: Lease = { channelId, leaseId, userId, grantedAt: now, renewDeadline: now + renewTtlMs, hardDeadline: now + maxMs };
    this.floors.set(channelId, lease);
    return { ok: true, lease: { ...lease }, reused: false };
  }

  async renewFloor({ channelId, leaseId, userId, now, renewTtlMs }: { channelId: string; leaseId: string; userId: string; now: number; renewTtlMs: number }) {
    const cur = this.floors.get(channelId);
    if (!cur || cur.leaseId !== leaseId || cur.userId !== userId || !leaseIsLive(cur, now)) return null;
    cur.renewDeadline = Math.min(now + renewTtlMs, cur.hardDeadline);
    return { ...cur };
  }

  async releaseFloor(channelId: string, leaseId: string, userId: string) {
    const cur = this.floors.get(channelId);
    if (!cur || cur.leaseId !== leaseId || cur.userId !== userId) return null;
    this.floors.delete(channelId);
    return cur;
  }

  async releaseFloorForUser(channelId: string, userId: string) {
    const cur = this.floors.get(channelId);
    if (!cur || cur.userId !== userId) return null;
    this.floors.delete(channelId);
    return cur;
  }

  async getFloor(channelId: string, now: number) {
    const cur = this.floors.get(channelId);
    return cur && leaseIsLive(cur, now) ? { ...cur } : null;
  }

  async expireFloors(now: number) {
    const out: Lease[] = [];
    for (const [cid, l] of this.floors) {
      if (!leaseIsLive(l, now)) {
        this.floors.delete(cid);
        out.push(l);
      }
    }
    return out;
  }

  async setPttToken(channelId: string, userId: string, token: string, environment: ApnsEnvironment) {
    if (!this.channels.has(channelId)) return;
    if (!this.pttTokens.has(channelId)) this.pttTokens.set(channelId, new Map());
    this.pttTokens.get(channelId)!.set(userId, { userId, token, environment });
  }

  async deletePttToken(channelId: string, userId: string) {
    this.pttTokens.get(channelId)?.delete(userId);
  }

  async deletePttTokenValue(token: string) {
    for (const m of this.pttTokens.values()) for (const [u, t] of m) if (t.token === token) m.delete(u);
  }

  async listPttTokens(channelId: string) {
    return [...(this.pttTokens.get(channelId)?.values() ?? [])].map((t) => ({ ...t }));
  }

  async deleteUser(userId: string) {
    const ownedChannelIds: string[] = [];
    const memberChannelIds: string[] = [];
    for (const ch of this.channels.values()) if (ch.ownerId === userId) ownedChannelIds.push(ch.id);
    for (const id of ownedChannelIds) await this.deleteChannel(id);
    for (const [cid, m] of this.members) if (m.delete(userId)) memberChannelIds.push(cid);
    for (const [cid, l] of this.floors) if (l.userId === userId) this.floors.delete(cid);
    for (const b of this.blocks.values()) b.delete(userId);
    for (const m of this.pttTokens.values()) m.delete(userId);
    this.profiles.delete(userId);
    return { ownedChannelIds, memberChannelIds };
  }

  async close() {}
}
