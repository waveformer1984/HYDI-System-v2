import { AudioEngine } from './AudioEngine'

export class SampleStore {
  private engine: AudioEngine
  private buffers: Map<string, AudioBuffer> = new Map()

  constructor(engine: AudioEngine) {
    this.engine = engine
  }

  async loadBlob(id: string, blob: Blob): Promise<void> {
    const buffer = await this.engine.decodeBlob(blob)
    this.buffers.set(id, buffer)
  }

  get(id: string): AudioBuffer | undefined {
    return this.buffers.get(id)
  }

  has(id: string): boolean {
    return this.buffers.has(id)
  }

  delete(id: string): void {
    this.buffers.delete(id)
  }

  clear(): void {
    this.buffers.clear()
  }

  play(id: string, startTime?: number): AudioBufferSourceNode | null {
    const buffer = this.buffers.get(id)
    if (!buffer) return null

    const ctx = this.engine.getCtx()
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.start(startTime ?? ctx.currentTime)
    return src
  }

  get ids(): string[] {
    return Array.from(this.buffers.keys())
  }
}

export default SampleStore
