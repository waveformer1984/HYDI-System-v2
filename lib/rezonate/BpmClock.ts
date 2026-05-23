import { AudioEngine } from './AudioEngine'

export interface BeatEvent {
  beatIndex: number
  barTime: number
}

const SCHEDULER_INTERVAL_MS = 25
const LOOKAHEAD_SEC = 0.1
const MAX_TAP_HISTORY = 8
const TAP_RESET_MS = 3000

export class BpmClock {
  private engine: AudioEngine
  private schedulerHandle: ReturnType<typeof setInterval> | null = null
  private nextBarTime: number = 0
  private currentBeatIndex: number = 0
  private beatCallbacks: Set<(evt: BeatEvent) => void> = new Set()
  private barCallbacks: Set<(barTime: number) => void> = new Set()
  private tapTimes: number[] = []

  bpm: number = 120
  beatsPerBar: number = 4
  isRunning: boolean = false

  constructor(engine: AudioEngine) {
    this.engine = engine
  }

  start(): void {
    const ctx = this.engine.getCtx()
    this.nextBarTime = ctx.currentTime + 0.05
    this.currentBeatIndex = 0
    this.isRunning = true
    if (this.schedulerHandle !== null) {
      clearInterval(this.schedulerHandle)
    }
    this.schedulerHandle = setInterval(() => this.tick(), SCHEDULER_INTERVAL_MS)
  }

  stop(): void {
    if (this.schedulerHandle !== null) {
      clearInterval(this.schedulerHandle)
      this.schedulerHandle = null
    }
    this.isRunning = false
  }

  onBeat(cb: (evt: BeatEvent) => void): () => void {
    this.beatCallbacks.add(cb)
    return () => this.beatCallbacks.delete(cb)
  }

  onBar(cb: (barTime: number) => void): () => void {
    this.barCallbacks.add(cb)
    return () => this.barCallbacks.delete(cb)
  }

  tap(): void {
    const now = Date.now()
    if (
      this.tapTimes.length > 0 &&
      now - this.tapTimes[this.tapTimes.length - 1] > TAP_RESET_MS
    ) {
      this.tapTimes = []
    }
    this.tapTimes.push(now)
    if (this.tapTimes.length > MAX_TAP_HISTORY) {
      this.tapTimes.shift()
    }
    if (this.tapTimes.length >= 2) {
      const intervals = this.tapTimes
        .slice(1)
        .map((t, i) => t - this.tapTimes[i])
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
      this.bpm = Math.round(60000 / avg)
    }
  }

  get nextBarTime(): number {
    return this.nextBarTime
  }

  private tick(): void {
    const ctx = this.engine.getCtx()
    const secondsPerBeat = 60 / this.bpm
    const secondsPerBar = secondsPerBeat * this.beatsPerBar

    while (this.nextBarTime < ctx.currentTime + LOOKAHEAD_SEC) {
      const barTime = this.nextBarTime

      this.barCallbacks.forEach(cb => cb(barTime))

      for (let beat = 0; beat < this.beatsPerBar; beat++) {
        const beatTime = barTime + beat * secondsPerBeat
        const evt: BeatEvent = { beatIndex: beat, barTime: beatTime }
        this.beatCallbacks.forEach(cb => cb(evt))
      }

      this.nextBarTime += secondsPerBar
      this.currentBeatIndex = (this.currentBeatIndex + 1) % this.beatsPerBar
    }
  }
}

export default BpmClock
