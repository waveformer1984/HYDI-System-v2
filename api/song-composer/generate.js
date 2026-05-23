import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SECTION_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f97316', '#eab308', '#22c55e', '#14b8a6',
];

const SYSTEM_PROMPT = `You are Hydi, ProtoForge's music composition AI. When given a song description, respond with ONLY valid JSON — no markdown fences, no prose. Use this exact schema:

{
  "title": "string",
  "bpm": 120,
  "key": "C major",
  "time_signature": "4/4",
  "genre": "string",
  "mood": "string",
  "total_bars": 64,
  "sections": [
    {
      "id": "intro",
      "name": "Intro",
      "bars": 4,
      "start_bar": 1,
      "chords": ["Cmaj7", "Am7", "Fmaj7", "G7"],
      "melody_notes": ["C4", "E4", "G4"],
      "instruments": ["acoustic guitar", "soft pad"],
      "description": "one sentence describing this section's feel",
      "color": "#6366f1"
    }
  ],
  "lyrics": [
    { "bar": 5, "section": "verse_1", "text": "lyric line here" }
  ],
  "production_notes": "overall production approach and key sonic characteristics"
}

Rules:
- sections must be in order with sequential start_bar values
- chords use standard notation (Cmaj7, Am, F#m7b5, etc.)
- total_bars = sum of all section bars
- include 2–4 lyric lines per vocal section
- return ONLY the JSON object, nothing else`;

function buildFallbackSong(description) {
  const bpm = 95 + Math.floor(Math.random() * 45);
  const keys = ['C major', 'G major', 'D major', 'A minor', 'E minor', 'F major'];
  const key = keys[Math.floor(Math.random() * keys.length)];

  return {
    title: 'Untitled Song',
    bpm,
    key,
    time_signature: '4/4',
    genre: 'indie',
    mood: 'reflective',
    total_bars: 64,
    sections: [
      { id: 'intro',    name: 'Intro',    bars: 4,  start_bar: 1,  chords: ['Cmaj7', 'Am7'],                instruments: ['piano', 'pad'],             description: 'Atmospheric opener.', color: SECTION_COLORS[0], melody_notes: ['C4', 'E4', 'G4'] },
      { id: 'verse_1',  name: 'Verse 1',  bars: 16, start_bar: 5,  chords: ['Cmaj7', 'Am7', 'Fmaj7', 'G'],  instruments: ['guitar', 'bass', 'drums'],  description: 'Builds narrative energy.', color: SECTION_COLORS[1], melody_notes: ['E4', 'D4', 'C4'] },
      { id: 'chorus_1', name: 'Chorus',   bars: 8,  start_bar: 21, chords: ['F', 'C', 'G', 'Am'],           instruments: ['full band', 'vocals'],      description: 'Emotional peak, full arrangement.', color: SECTION_COLORS[2], melody_notes: ['G4', 'F4', 'E4'] },
      { id: 'verse_2',  name: 'Verse 2',  bars: 16, start_bar: 29, chords: ['Cmaj7', 'Am7', 'Fmaj7', 'G'],  instruments: ['guitar', 'bass', 'drums'],  description: 'Deeper narrative layer.', color: SECTION_COLORS[3], melody_notes: ['D4', 'C4', 'B3'] },
      { id: 'chorus_2', name: 'Chorus 2', bars: 8,  start_bar: 45, chords: ['F', 'C', 'G', 'Am'],           instruments: ['full band', 'vocals'],      description: 'More intense repeat.', color: SECTION_COLORS[2], melody_notes: ['G4', 'F4', 'E4'] },
      { id: 'bridge',   name: 'Bridge',   bars: 8,  start_bar: 53, chords: ['Dm7', 'G7', 'Em7', 'Am'],      instruments: ['stripped back', 'keys'],   description: 'Contrast and tension.', color: SECTION_COLORS[4], melody_notes: ['A4', 'G4', 'F4'] },
      { id: 'outro',    name: 'Outro',    bars: 4,  start_bar: 61, chords: ['Cmaj7', 'G'],                   instruments: ['fading', 'guitar'],        description: 'Gentle resolution.', color: SECTION_COLORS[5], melody_notes: ['C4'] },
    ],
    lyrics: [
      { bar: 5,  section: 'verse_1',  text: 'Walking through the echoes of a fading light' },
      { bar: 9,  section: 'verse_1',  text: 'Everything you promised slips away at night' },
      { bar: 21, section: 'chorus_1', text: 'I am still here, still calling out your name' },
      { bar: 25, section: 'chorus_1', text: 'Building something beautiful from all this pain' },
      { bar: 29, section: 'verse_2',  text: 'Seasons turn and burn like letters in the fire' },
      { bar: 33, section: 'verse_2',  text: 'Every single word I said became a liar' },
      { bar: 53, section: 'bridge',   text: "Maybe I was wrong to think we'd find a way" },
      { bar: 57, section: 'bridge',   text: 'Maybe some things just aren\'t meant to stay' },
    ],
    production_notes: `Generated from: "${description}". Melodic indie arrangement with layered guitars, warm pads, and dynamic percussion. Focus on emotional arc from introspective verses to cathartic chorus.`,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const { description, style } = req.body || {};
  if (!description?.trim()) return res.status(400).json({ ok: false, error: 'description is required' });

  let song = null;

  try {
    // Try to get structured JSON from the chat route
    const chatRes = await fetch(
      `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/chat/route`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Create a complete song structure for this idea: "${description}"${style ? ` Style: ${style}` : ''}`,
          system: SYSTEM_PROMPT,
        }),
      }
    );

    if (chatRes.ok) {
      const chatData = await chatRes.json();
      const rawText = chatData.response || chatData.content || '';

      // Extract JSON from the response (handle models that add prose)
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Assign colors if missing
        if (parsed.sections) {
          parsed.sections = parsed.sections.map((s, i) => ({
            ...s,
            color: s.color || SECTION_COLORS[i % SECTION_COLORS.length],
          }));
        }
        song = parsed;
      }
    }
  } catch (_) {
    // Fall through to fallback
  }

  if (!song) {
    song = buildFallbackSong(description);
  }

  // Persist to Supabase actions table
  const { data: saved, error: saveErr } = await supabase
    .from('actions')
    .insert({
      session_id: `song-${Date.now()}`,
      task_name: 'song_composition',
      status: 'completed',
      payload: {
        agent_id: 'rezonate',
        source: 'song-composer',
        description,
        song,
      },
    })
    .select()
    .single();

  if (saveErr) console.warn('[song-composer/generate] save error:', saveErr.message);

  return res.status(200).json({
    ok: true,
    song,
    saved_id: saved?.id || null,
    timestamp: new Date().toISOString(),
  });
}
