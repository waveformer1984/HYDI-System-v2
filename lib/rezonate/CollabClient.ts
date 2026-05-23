import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'

export interface CollabEvent {
  type: 'pad_record' | 'pad_clear' | 'pad_loop_toggle' | 'bpm_change' | 'play' | 'stop'
  padIndex?: number
  bpm?: number
  userId: string
  ts: number
}

export interface Peer {
  userId: string
  displayName: string
  joinedAt: number
}

type PresenceState = Record<string, Array<{ userId: string; displayName: string; joinedAt: number }>>

export class CollabClient {
  private supabase: SupabaseClient
  private channel: RealtimeChannel | null = null
  private eventCallbacks: Set<(event: CollabEvent) => void> = new Set()
  private presenceCallbacks: Set<(peers: Peer[]) => void> = new Set()
  private _peers: Map<string, Peer> = new Map()
  private _sessionId: string | null = null
  private _userId: string | null = null

  isConnected: boolean = false

  constructor(supabaseUrl: string, supabaseAnonKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseAnonKey)
  }

  async joinSession(sessionId: string, userId: string, displayName: string): Promise<void> {
    this.leaveSession()

    this._sessionId = sessionId
    this._userId = userId

    this.channel = this.supabase.channel(`rezonate:${sessionId}`, {
      config: { presence: { key: userId } },
    })

    this.channel
      .on('broadcast', { event: 'collab' }, ({ payload }: { payload: CollabEvent }) => {
        if (payload.userId !== this._userId) {
          this.eventCallbacks.forEach(cb => cb(payload))
        }
      })
      .on('presence', { event: 'sync' }, () => {
        const state = this.channel!.presenceState() as PresenceState
        this._peers = new Map()
        Object.values(state).forEach(entries => {
          entries.forEach(entry => {
            if (entry.userId !== this._userId) {
              this._peers.set(entry.userId, {
                userId: entry.userId,
                displayName: entry.displayName,
                joinedAt: entry.joinedAt,
              })
            }
          })
        })
        const peers = Array.from(this._peers.values())
        this.presenceCallbacks.forEach(cb => cb(peers))
      })

    await new Promise<void>((resolve, reject) => {
      this.channel!.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.channel!.track({ userId, displayName, joinedAt: Date.now() })
          this.isConnected = true
          resolve()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(`Channel subscription failed: ${status}`))
        }
      })
    })
  }

  leaveSession(): void {
    if (this.channel) {
      void this.channel.unsubscribe()
      this.channel = null
    }
    this._peers.clear()
    this._sessionId = null
    this._userId = null
    this.isConnected = false
  }

  broadcast(event: Omit<CollabEvent, 'userId' | 'ts'>): void {
    if (!this.channel || !this._userId) return

    const fullEvent: CollabEvent = {
      ...event,
      userId: this._userId,
      ts: Date.now(),
    }

    void this.channel.send({
      type: 'broadcast',
      event: 'collab',
      payload: fullEvent,
    })
  }

  onEvent(cb: (event: CollabEvent) => void): () => void {
    this.eventCallbacks.add(cb)
    return () => this.eventCallbacks.delete(cb)
  }

  onPresenceChange(cb: (peers: Peer[]) => void): () => void {
    this.presenceCallbacks.add(cb)
    return () => this.presenceCallbacks.delete(cb)
  }

  get peers(): Peer[] {
    return Array.from(this._peers.values())
  }

  get sessionId(): string | null {
    return this._sessionId
  }
}

export default CollabClient
