/**
 * Voice-ready seam for Heidi Mobile:
 *
 *   microphone → SpeechInput → chat composer → HYDI → reply → SpeechOutput
 *
 * Voice is optional. Chat never depends on it: when the browser lacks the
 * Web Speech API (or the user denies the microphone) these return
 * null / no-op and the text composer works exactly the same.
 *
 * The interfaces are deliberately small so a native implementation (e.g. a
 * Capacitor speech plugin once capacitor.config.json's Android shell exists)
 * can replace the browser one without touching the chat UI. Recognised text
 * only ever fills the composer — it is never auto-sent — so a misheard
 * command cannot act on its own. Audio never leaves the phone from here;
 * the browser's recogniser produces text and only text is sent to HYDI.
 */

export interface SpeechInput {
  start: () => void;
  stop: () => void;
}

export interface SpeechInputHandlers {
  onPartial: (_text: string) => void;
  onFinal: (_text: string) => void;
  onError: (_message: string) => void;
  onEnd: () => void;
}

export interface SpeechOutput {
  speak: (_text: string) => void;
  cancel: () => void;
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((_e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((_e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isSpeechInputSupported(): boolean {
  return recognitionCtor() !== null;
}

export function isSpeechOutputSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'Microphone permission was denied. You can still type.',
  'service-not-allowed': 'Speech recognition is blocked on this device. You can still type.',
  'no-speech': 'Didn’t catch anything — try again.',
  'audio-capture': 'No microphone was found.',
  network: 'Speech recognition needs a network connection on this browser.',
};

export function createBrowserSpeechInput(handlers: SpeechInputHandlers, lang = 'en-US'): SpeechInput | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  let rec: RecognitionLike | null = null;
  return {
    start() {
      if (rec) return;
      rec = new Ctor();
      rec.lang = lang;
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e) => {
        let interim = '';
        let final = '';
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const r = e.results[i];
          if (r.isFinal) final += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (final) handlers.onFinal(final.trim());
        else if (interim) handlers.onPartial(interim.trim());
      };
      rec.onerror = (e) => {
        if (e.error !== 'aborted') handlers.onError(ERROR_TEXT[e.error] || 'Voice input failed.');
      };
      rec.onend = () => {
        rec = null;
        handlers.onEnd();
      };
      try {
        rec.start();
      } catch {
        rec = null;
        handlers.onError('Voice input could not start.');
        handlers.onEnd();
      }
    },
    stop() {
      if (rec) rec.stop();
    },
  };
}

export function createBrowserSpeechOutput(lang = 'en-US'): SpeechOutput {
  const supported = isSpeechOutputSupported();
  return {
    speak(text: string) {
      if (!supported || !text.trim()) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, 1500));
      u.lang = lang;
      window.speechSynthesis.speak(u);
    },
    cancel() {
      if (supported) window.speechSynthesis.cancel();
    },
  };
}
