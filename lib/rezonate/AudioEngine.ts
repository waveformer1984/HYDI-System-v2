export class AudioEngine {
  private static _instance: AudioEngine | null = null
  private ctx: AudioContext | null = null

  static getInstance(): AudioEngine {
    if (!AudioEngine._instance) {
      AudioEngine._instance = new AudioEngine()
    }
    return AudioEngine._instance
  }

  getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume()
    }
    return this.ctx
  }

  async decodeBlob(blob: Blob): Promise<AudioBuffer> {
    const ctx = this.getCtx()
    const arrayBuffer = await blob.arrayBuffer()
    return ctx.decodeAudioData(arrayBuffer)
  }

  get sampleRate(): number {
    return this.getCtx().sampleRate
  }

  get currentTime(): number {
    return this.getCtx().currentTime
  }

  close(): void {
    if (this.ctx) {
      void this.ctx.close()
      this.ctx = null
    }
    AudioEngine._instance = null
  }
}

export default AudioEngine
