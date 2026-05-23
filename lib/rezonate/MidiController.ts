export interface PadTriggerEvent {
  padIndex: number
  velocity: number
  midiNote: number
}

const DEFAULT_PAD_START_NOTE = 36
const DEFAULT_PAD_COUNT = 8
const MIDI_NOTE_ON_STATUS = 0x90

export class MidiController {
  private midiAccess: MIDIAccess | null = null
  private padStartNote: number = DEFAULT_PAD_START_NOTE
  private padCount: number = DEFAULT_PAD_COUNT
  private padTriggerCallbacks: Set<(evt: PadTriggerEvent) => void> = new Set()

  isConnected: boolean = false
  deviceName: string | null = null

  static isSupported(): boolean {
    return typeof navigator !== 'undefined' &&
      typeof (navigator as Navigator & { requestMIDIAccess?: unknown }).requestMIDIAccess !== 'undefined'
  }

  async connect(): Promise<void> {
    if (!MidiController.isSupported()) return

    try {
      this.midiAccess = await (navigator as Navigator & { requestMIDIAccess: () => Promise<MIDIAccess> }).requestMIDIAccess()
      this.bindInputs()
      this.midiAccess.onstatechange = () => this.bindInputs()
      this.isConnected = true
    } catch {
      this.isConnected = false
    }
  }

  disconnect(): void {
    if (this.midiAccess) {
      this.midiAccess.inputs.forEach(input => {
        input.onmidimessage = null
      })
      this.midiAccess = null
    }
    this.isConnected = false
    this.deviceName = null
  }

  setPadNoteRange(startNote: number, count: number = DEFAULT_PAD_COUNT): void {
    this.padStartNote = startNote
    this.padCount = count
  }

  onPadTrigger(cb: (evt: PadTriggerEvent) => void): () => void {
    this.padTriggerCallbacks.add(cb)
    return () => this.padTriggerCallbacks.delete(cb)
  }

  private bindInputs(): void {
    if (!this.midiAccess) return

    this.midiAccess.inputs.forEach(input => {
      if (!this.deviceName && input.name) {
        this.deviceName = input.name
      }
      input.onmidimessage = (event: MIDIMessageEvent) => this.handleMessage(event)
    })
  }

  private handleMessage(event: MIDIMessageEvent): void {
    const data = event.data
    if (!data || data.length < 3) return

    const status = data[0] & 0xf0
    const note = data[1]
    const velocity = data[2]

    if (status !== MIDI_NOTE_ON_STATUS || velocity === 0) return

    const offset = note - this.padStartNote
    if (offset < 0 || offset >= this.padCount) return

    const evt: PadTriggerEvent = {
      padIndex: Math.min(Math.max(offset, 0), 7),
      velocity,
      midiNote: note,
    }

    this.padTriggerCallbacks.forEach(cb => cb(evt))
  }
}

export default MidiController
