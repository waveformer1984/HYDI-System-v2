'use client';

import { useState, useRef, useEffect } from 'react';
import { Mic, MicOff, Loader2 } from 'lucide-react';

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  isDisabled?: boolean;
  className?: string;
}

export default function VoiceInput({ onTranscript, isDisabled = false, className = '' }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Check if speech recognition is supported
    if (typeof window !== 'undefined') {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      setIsSupported(!!SpeechRecognition);
      
      if (SpeechRecognition && !recognitionRef.current) {
        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.lang = 'en-US';
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
          setIsListening(true);
          setInterimTranscript('');
        };

        recognition.onresult = (event: any) => {
          let interim = '';
          let final = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              final += result[0].transcript;
            } else {
              interim += result[0].transcript;
            }
          }

          setInterimTranscript(interim);
          
          if (final) {
            onTranscript(final.trim());
            setInterimTranscript('');
          }
        };

        recognition.onerror = (event: any) => {
          console.error('Speech recognition error:', event.error);
          setIsListening(false);
          setInterimTranscript('');
        };

        recognition.onend = () => {
          setIsListening(false);
          setInterimTranscript('');
        };

        recognitionRef.current = recognition;
      }
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, [onTranscript]);

  const toggleListening = () => {
    if (!isSupported || !recognitionRef.current || isDisabled) return;

    if (isListening) {
      recognitionRef.current.stop();
    } else {
      recognitionRef.current.start();
    }
  };

  if (!isSupported) {
    return (
      <div className={`flex items-center space-x-2 text-gray-400 text-xs ${className}`}>
        <MicOff className="w-4 h-4" />
        <span>Voice not supported</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      <button
        onClick={toggleListening}
        disabled={isDisabled}
        className={`p-2 rounded-full transition-colors ${
          isListening
            ? 'bg-red-600 text-white hover:bg-red-700'
            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
        } ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        title={isListening ? "Stop recording" : "Start voice input"}
      >
        {isListening ? (
          <div className="relative">
            <Mic className="w-4 h-4 animate-pulse" />
            <div className="absolute inset-0 w-4 h-4 bg-red-400 rounded-full animate-ping opacity-75"></div>
          </div>
        ) : (
          <Mic className="w-4 h-4" />
        )}
      </button>
      
      {isListening && (
        <div className="flex items-center space-x-2">
          <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
          <span className="text-xs text-gray-400">
            {interimTranscript || 'Listening...'}
          </span>
        </div>
      )}
    </div>
  );
}
