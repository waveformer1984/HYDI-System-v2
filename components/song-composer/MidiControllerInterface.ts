/**
 * MidiControllerInterface.ts
 * Web MIDI API substrate for ProtoForge Song Composer.
 *
 * Supports:
 *   - Auto-detection of any MIDI device (incl. Pioneer DDJ-SB3)
 *   - Note → section/action mapping with DDJ-SB3 hot-cue defaults
 *   - CC transport controls (play, pause, seek)
 *   - Learning mode: press a pad to map it live
 *   - Callback surface for React layer (no React dependency here)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MidiDevice {
  id: string;
  name: string;
  type: 'input' | 'output';
  state: 'connected' | 'disconnected';
}

export interface MidiAction {
  type: 'section_jump' | 'play' | 'pause' | 'seek_start' | 'seek_end' | 'record_toggle' | 'mute_toggle' | 'pad_custom';
  value?: number;         // section index, layer id, etc.
  rawNote?: number;
  rawChannel?: number;
}

export type MidiMessageHandler = (action: MidiAction, raw: { status: number; note: number; velocity: number }) => void;
export type DeviceChangeHandler = (devices: MidiDevice[]) => void;

// ─── DDJ-SB3 default pad → action mapping ────────────────────────────────────
// DDJ-SB3 Hot Cues deck A: notes 0x00–0x07 on channel 6 (status 0x95)
// DDJ-SB3 Hot Cues deck B: notes 0x08–0x0F on channel 6
// DDJ-SB3 Pad FX: notes 0x20–0x27 on channel 6
// Play/Pause: Note 0x0B / 0x0C on channel 1 (status 0x90)

interface NoteMapping {
  action: MidiAction['type'];
  value?: number;
  label: string;
}

const DDJ_SB3_DEFAULTS: Record<string, NoteMapping> = {
  // Hot Cue deck A → jump to sections 0-7
  '149:0':  { action: 'section_jump', value: 0, label: 'Cue A1 → Section 1' },
  '149:1':  { action: 'section_jump', value: 1, label: 'Cue A2 → Section 2' },
  '149:2':  { action: 'section_jump', value: 2, label: 'Cue A3 → Section 3' },
  '149:3':  { action: 'section_jump', value: 3, label: 'Cue A4 → Section 4' },
  '149:4':  { action: 'section_jump', value: 4, label: 'Cue A5 → Section 5' },
  '149:5':  { action: 'section_jump', value: 5, label: 'Cue A6 → Section 6' },
  '149:6':  { action: 'section_jump', value: 6, label: 'Cue A7 → Section 7' },
  '149:7':  { action: 'section_jump', value: 7, label: 'Cue A8 → Section 8' },
  // Play / Pause (Deck A)
  '144:11': { action: 'play',         label: 'Play' },
  '144:12': { action: 'pause',        label: 'Pause' },
  // Seek
  '144:13': { action: 'seek_start',   label: 'Seek to start' },
  '144:14': { action: 'seek_end',     label: 'Seek to end' },
  // Record toggle
  '144:15': { action: 'record_toggle', label: 'Record toggle' },
};

// ─── Class ────────────────────────────────────────────────────────────────────

export class MidiControllerInterface {
  private access: MIDIAccess | null = null;
  private mapping: Record<string, NoteMapping> = { ...DDJ_SB3_DEFAULTS };
  private onMessage: MidiMessageHandler | null = null;
  private onDeviceChange: DeviceChangeHandler | null = null;

  // Learning mode state
  private learningKey: string | null = null;           // composite key being learned
  private learnCallback: ((note: number, channel: number) => void) | null = null;

  // ── Public API ──────────────────────────────────────────────────────────────

  public isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  public async initialize(
    onMessage: MidiMessageHandler,
    onDeviceChange: DeviceChangeHandler
  ): Promise<MidiDevice[]> {
    this.onMessage      = onMessage;
    this.onDeviceChange = onDeviceChange;

    if (!this.isSupported()) {
      console.warn('[MIDI] Web MIDI API not available in this browser.');
      return [];
    }

    try {
      this.access = await (navigator as any).requestMIDIAccess({ sysex: false });
      if (this.access) this.access.onstatechange = () => onDeviceChange(this.listDevices());
      this.bindAllInputs();
      const devices = this.listDevices();
      console.log(`[MIDI] ✅ Substrate active. ${devices.filter((d) => d.type === 'input').length} input(s) found.`);
      return devices;
    } catch (err: any) {
      console.error('[MIDI] Access denied:', err.message);
      return [];
    }
  }

  public listDevices(): MidiDevice[] {
    if (!this.access) return [];
    const devices: MidiDevice[] = [];
    this.access.inputs.forEach((i) => devices.push({ id: i.id, name: i.name ?? 'Unknown MIDI input', type: 'input', state: i.state as any }));
    this.access.outputs.forEach((o) => devices.push({ id: o.id, name: o.name ?? 'Unknown MIDI output', type: 'output', state: o.state as any }));
    return devices;
  }

  /** Set a custom note→action mapping entry */
  public setMapping(statusByte: number, note: number, action: MidiAction['type'], value?: number, label?: string) {
    const key = `${statusByte}:${note}`;
    this.mapping[key] = { action, value, label: label ?? key };
  }

  /** Start learning mode. Returns a promise that resolves when the user presses a pad. */
  public async learnNextPad(): Promise<{ note: number; channel: number }> {
    return new Promise((resolve) => {
      this.learnCallback = (note, channel) => {
        this.learnCallback = null;
        resolve({ note, channel });
      };
    });
  }

  /** Map a learned pad to a section jump */
  public mapPadToSection(statusByte: number, note: number, sectionIndex: number, sectionName: string) {
    this.setMapping(statusByte, note, 'section_jump', sectionIndex, `Pad → ${sectionName}`);
  }

  public getMapping(): Record<string, NoteMapping & { key: string }> {
    return Object.fromEntries(
      Object.entries(this.mapping).map(([k, v]) => [k, { ...v, key: k }])
    );
  }

  public dispose() {
    if (this.access) {
      this.access.inputs.forEach((i) => { i.onmidimessage = null; });
    }
    this.access        = null;
    this.onMessage     = null;
    this.onDeviceChange = null;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private bindAllInputs() {
    if (!this.access) return;
    this.access.inputs.forEach((input) => {
      input.onmidimessage = (ev: MIDIMessageEvent) => this.handleMessage(ev);
    });
  }

  private handleMessage(ev: MIDIMessageEvent) {
    if (!ev.data || ev.data.length < 3) return;
    const [status, note, velocity] = Array.from(ev.data);

    // Learning mode intercept — grab any Note On
    const isNoteOn = (status & 0xF0) === 0x90 && velocity > 0;
    if (isNoteOn && this.learnCallback) {
      const channel = status & 0x0F;
      this.learnCallback(note, channel);
      return;
    }

    // Only act on Note On events
    if (!isNoteOn) return;

    const key = `${status}:${note}`;
    const mapped = this.mapping[key];

    const action: MidiAction = mapped
      ? { type: mapped.action, value: mapped.value, rawNote: note, rawChannel: status & 0x0F }
      : { type: 'pad_custom', rawNote: note, rawChannel: status & 0x0F };

    this.onMessage?.(action, { status, note, velocity });
  }
}

// Singleton — one interface per composer instance
export const midiInterface = new MidiControllerInterface();
