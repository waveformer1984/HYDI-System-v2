export type Role = 'owner' | 'member';

export interface Profile {
  userId: string;
  displayName: string;
}

export interface Channel {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
}

export interface Member {
  userId: string;
  displayName: string | null;
  role: Role;
  joinedAt: number;
}

export interface Lease {
  channelId: string;
  leaseId: string;
  userId: string;
  grantedAt: number;
  /** The holder must renew before this instant or the lease is reclaimed. */
  renewDeadline: number;
  /** Absolute cap on one speaking turn (TALK_MAX_MS after grant). Never extended. */
  hardDeadline: number;
}

export type AcquireResult =
  | { ok: true; lease: Lease; reused: boolean }
  | { ok: false; holder: Lease };

export type RedeemResult =
  | { ok: true; channelId: string; alreadyMember: boolean }
  | { ok: false; reason: 'invalid' | 'expired' | 'exhausted' | 'blocked' | 'full' };

/** A usable invite: not expired, not used up, channel still exists. */
export interface InvitePreview {
  channelId: string;
  channelName: string;
  ownerName: string | null;
  expiresAt: number;
}

export type ApnsEnvironment = 'sandbox' | 'production';

export interface PttPushToken {
  userId: string;
  token: string;
  environment: ApnsEnvironment;
}

export function leaseIsLive(l: Lease, now: number): boolean {
  return now < l.renewDeadline && now < l.hardDeadline;
}

/**
 * Persistence for walkie. Every method that arbitrates (acquireFloor,
 * renewFloor, releaseFloor*, expireFloors, redeemInvite) must be atomic with
 * respect to concurrent callers — including callers in other server
 * processes when backed by Postgres.
 */
export interface Store {
  getProfile(userId: string): Promise<Profile | null>;
  upsertProfile(userId: string, displayName: string): Promise<Profile>;

  createChannel(ownerId: string, name: string): Promise<Channel>;
  getChannel(channelId: string): Promise<Channel | null>;
  deleteChannel(channelId: string): Promise<void>;
  listChannelsForUser(userId: string): Promise<Array<Channel & { role: Role }>>;

  getRole(channelId: string, userId: string): Promise<Role | null>;
  listMembers(channelId: string): Promise<Member[]>;
  removeMember(channelId: string, userId: string): Promise<boolean>;

  block(channelId: string, userId: string, blockedBy: string): Promise<void>;
  unblock(channelId: string, userId: string): Promise<void>;
  isBlocked(channelId: string, userId: string): Promise<boolean>;
  listBlocks(channelId: string): Promise<Array<{ userId: string; displayName: string | null; blockedAt: number }>>;

  createInvite(channelId: string, createdBy: string, codeHash: string, expiresAt: number, maxUses: number): Promise<void>;
  redeemInvite(codeHash: string, userId: string, now: number, maxMembers: number): Promise<RedeemResult>;
  /** Read-only look at an invite, for the join page. Null unless it could still be redeemed. */
  peekInvite(codeHash: string, now: number): Promise<InvitePreview | null>;

  acquireFloor(args: { channelId: string; userId: string; leaseId: string; now: number; renewTtlMs: number; maxMs: number }): Promise<AcquireResult>;
  renewFloor(args: { channelId: string; leaseId: string; userId: string; now: number; renewTtlMs: number }): Promise<Lease | null>;
  releaseFloor(channelId: string, leaseId: string, userId: string): Promise<Lease | null>;
  releaseFloorForUser(channelId: string, userId: string): Promise<Lease | null>;
  getFloor(channelId: string, now: number): Promise<Lease | null>;
  /** Delete and return every lease that is no longer live. */
  expireFloors(now: number): Promise<Lease[]>;

  /** iOS PushToTalk tokens (Milestone 3). Removing a member or blocking them deletes theirs. */
  setPttToken(channelId: string, userId: string, token: string, environment: ApnsEnvironment): Promise<void>;
  deletePttToken(channelId: string, userId: string): Promise<void>;
  /** Drop a token everywhere (APNs said it is no longer valid). */
  deletePttTokenValue(token: string): Promise<void>;
  listPttTokens(channelId: string): Promise<PttPushToken[]>;

  /** Remove every trace of the user. Returns the channels they owned (now deleted) and the channels they were a member of. */
  deleteUser(userId: string): Promise<{ ownedChannelIds: string[]; memberChannelIds: string[] }>;

  close(): Promise<void>;
}
