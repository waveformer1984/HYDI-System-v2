import React, { useState, useRef, useEffect } from 'react';

interface Message {
  role: 'user' | 'hydi';
  content: string;
  timestamp: Date;
}

interface Song {
  title: string;
  bpm: number;
  key: string;
  genre: string;
  sections: any[];
}

interface Props {
  song: Song | null;
  currentBar: number;
}

const QUICK_PROMPTS = [
  'What chord should come next?',
  'Suggest a melody for this section',
  'How can I make the chorus hit harder?',
  'What key changes could work here?',
  'Give me lyric ideas for the bridge',
  'Suggest a bass line pattern',
  'What BPM variations could work?',
  'How do I make this more emotional?',
];

export default function CopilotPanel({ song, currentBar }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'hydi',
      content: song
        ? `I've analyzed "${song.title}" — ${song.bpm} BPM in ${song.key}. I'm watching bar ${currentBar}. Ask me anything about the composition, arrangement, or how to record your parts.`
        : 'Load a song to start getting composition advice. Tell me a song idea and I\'ll help you build it.',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Update context message when song changes
  useEffect(() => {
    if (song) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'hydi',
          content: `Song updated: "${song.title}" · ${song.bpm} BPM · ${song.key} · ${song.sections.length} sections. Ready to help.`,
          timestamp: new Date(),
        },
      ]);
    }
  }, [song?.title]);

  const buildSystemPrompt = () => {
    if (!song) return 'You are Hydi, a music composition AI copilot. Help the user with musical ideas, theory, and production advice.';
    return `You are Hydi, ProtoForge's music composition AI copilot. The user is working on:
Title: "${song.title}"
BPM: ${song.bpm}, Key: ${song.key}, Genre: ${song.genre}
Sections: ${song.sections.map((s: any) => `${s.name} (${s.chords?.join(', ')})`).join(' → ')}
Current bar: ${currentBar}

Give specific, actionable musical advice. Keep responses concise (2-4 sentences). Use music theory terminology when appropriate but explain it clearly.`;
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = { role: 'user', content: text, timestamp: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/chat/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          system: buildSystemPrompt(),
        }),
      });

      const data = await res.json();
      const reply = data.response || data.content || 'I couldn\'t process that — try rephrasing.';

      setMessages((prev) => [
        ...prev,
        { role: 'hydi', content: reply, timestamp: new Date() },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'hydi', content: 'Connection issue — check that Heidi is running.', timestamp: new Date() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-gray-950 rounded-xl border border-gray-800 flex flex-col h-full" style={{ minHeight: 400 }}>
      <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wider">Hydi Copilot</span>
        {song && <span className="text-xs text-gray-600 ml-auto">Bar {currentBar}</span>}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] text-xs px-3 py-2 rounded-xl leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : 'bg-gray-800 text-gray-200 rounded-bl-sm'
              }`}
            >
              {msg.role === 'hydi' && (
                <div className="text-purple-400 text-xs font-semibold mb-1">Hydi</div>
              )}
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-800 px-3 py-2 rounded-xl rounded-bl-sm">
              <div className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="w-1.5 h-1.5 bg-purple-400 rounded-full animate-bounce"
                    style={{ animationDelay: `${i * 0.1}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Quick prompts */}
      <div className="px-3 py-2 border-t border-gray-800">
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p}
              onClick={() => sendMessage(p)}
              disabled={loading}
              className="flex-shrink-0 text-xs px-2.5 py-1 bg-gray-800 text-gray-300 rounded-full hover:bg-gray-700 transition-colors disabled:opacity-50"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="px-3 pb-3">
        <form
          onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Hydi about your song…"
            disabled={loading}
            className="flex-1 bg-gray-800 border border-gray-700 text-white text-xs rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-purple-500 placeholder-gray-500"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="px-3 py-2 bg-purple-600 text-white text-xs rounded-lg hover:bg-purple-500 disabled:opacity-40 transition-colors"
          >
            Ask
          </button>
        </form>
      </div>
    </div>
  );
}
