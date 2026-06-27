'use client';

import { useState, useEffect, useRef } from 'react';
import { Volume2, VolumeX, Play, Pause } from 'lucide-react';

interface VoiceOutputProps {
  text: string;
  autoPlay?: boolean;
  isPlaying?: boolean;
  onPlayStateChange?: (playing: boolean) => void;
  className?: string;
}

export default function VoiceOutput({
  text,
  autoPlay = false,
  isPlaying: externalPlaying = false,
  onPlayStateChange,
  className = ''
}: VoiceOutputProps) {
  const [isSupported, setIsSupported] = useState(false);
  const [isInternalPlaying, setIsInternalPlaying] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<string>('');
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [volume, setVolume] = useState(1);
  const synthesisRef = useRef<SpeechSynthesis | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const isPlaying = externalPlaying || isInternalPlaying;

  useEffect(() => {
    // Check if speech synthesis is supported
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setIsSupported(true);
      synthesisRef.current = window.speechSynthesis;

      // Load available voices
      const loadVoices = () => {
        const availableVoices = window.speechSynthesis.getVoices();
        setVoices(availableVoices);

        // Select a default English voice
        const englishVoice = availableVoices.find(voice =>
          voice.lang.startsWith('en') && voice.name.includes('Female')
        ) || availableVoices.find(voice => voice.lang.startsWith('en')) ||
          availableVoices[0];

        if (englishVoice) {
          setSelectedVoice(englishVoice.name);
        }
      };

      loadVoices();

      // Voices might load asynchronously
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      if (synthesisRef.current) {
        synthesisRef.current.cancel();
      }
    };
  }, []);

  useEffect(() => {
    // Auto-play when text changes (if not already playing)
    if (autoPlay && text && isSupported && !isPlaying) {
      speak();
    }
  }, [autoPlay, text, isSupported, isPlaying]);

  const speak = () => {
    if (!synthesisRef.current || !text || isPlaying) return;

    // Cancel any ongoing speech
    synthesisRef.current.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voice = voices.find(v => v.name === selectedVoice);

    if (voice) {
      utterance.voice = voice;
    }

    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;

    utterance.onstart = () => {
      setIsInternalPlaying(true);
      onPlayStateChange?.(true);
    };

    utterance.onend = () => {
      setIsInternalPlaying(false);
      onPlayStateChange?.(false);
    };

    utterance.onerror = (event) => {
      console.error('Speech synthesis error:', event);
      setIsInternalPlaying(false);
      onPlayStateChange?.(false);
    };

    utteranceRef.current = utterance;
    synthesisRef.current.speak(utterance);
  };

  const pause = () => {
    if (synthesisRef.current && isPlaying) {
      synthesisRef.current.pause();
    }
  };

  const resume = () => {
    if (synthesisRef.current && isPlaying) {
      synthesisRef.current.resume();
    }
  };

  const stop = () => {
    if (synthesisRef.current) {
      synthesisRef.current.cancel();
      setIsInternalPlaying(false);
      onPlayStateChange?.(false);
    }
  };

  const togglePlayPause = () => {
    if (!synthesisRef.current) return;

    if (isPlaying) {
      if (synthesisRef.current.paused) {
        resume();
      } else {
        pause();
      }
    } else {
      speak();
    }
  };

  if (!isSupported) {
    return (
      <div className={`flex items-center space-x-2 text-gray-400 text-xs ${className}`}>
        <VolumeX className="w-4 h-4" />
        <span>Voice not supported</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <button
        onClick={togglePlayPause}
        className="p-2 rounded-full bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
        title={isPlaying ? "Pause reading" : "Read response aloud"}
      >
        {isPlaying ? (
          synthesisRef.current?.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />
        ) : (
          <Volume2 className="w-4 h-4" />
        )}
      </button>

      {isPlaying && (
        <button
          onClick={stop}
          className="p-1 rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors"
          title="Stop reading"
        >
          <VolumeX className="w-3 h-3" />
        </button>
      )}

      {/* Voice Settings (collapsed by default) */}
      <div className="flex items-center space-x-2 text-xs">
        <select
          value={selectedVoice}
          onChange={(e) => setSelectedVoice(e.target.value)}
          className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white"
          title="Select voice"
        >
          {voices.map(voice => (
            <option key={voice.name} value={voice.name}>
              {voice.name} ({voice.lang})
            </option>
          ))}
        </select>

        <div className="flex items-center space-x-1">
          <label className="text-gray-400">Speed:</label>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.1"
            value={rate}
            onChange={(e) => setRate(parseFloat(e.target.value))}
            className="w-16"
            title="Speech rate"
          />
        </div>
      </div>
    </div>
  );
}
