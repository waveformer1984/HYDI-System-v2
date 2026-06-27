#!/usr/bin/env python3
"""
Rezonate - generate.py
Generate a song with Google's Lyria 3 (via the Gemini API), save the mp3,
and optionally split it straight into stems.

Setup (one time):
  1. Get a key:  https://aistudio.google.com/apikey
  2. Set it:     [Environment]::SetEnvironmentVariable("GEMINI_API_KEY","<key>","User")
                 (then open a NEW terminal so it loads)
  3. pip install google-genai

Use:
  python generate.py "warm lo-fi soul beat, dusty Rhodes, 85 BPM, F minor"
  python generate.py --clip  "..."     # fast 30s preview (cheaper, for iterating)
  python generate.py --stems "..."     # generate, then auto-split into stems

Output -> rezonate/generated/<slug>.mp3   (lyrics/structure printed)
"""
import sys, os, re, subprocess, datetime


def main():
    raw = sys.argv[1:]
    clip = '--clip' in raw
    do_stems = '--stems' in raw
    words = [a for a in raw if not a.startswith('--')]
    if not words:
        print('usage: python generate.py [--clip] [--stems] "your song description"')
        return
    prompt = ' '.join(words)

    if not (os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY')):
        print('No GEMINI_API_KEY found. Get one at https://aistudio.google.com/apikey, then:')
        print('  [Environment]::SetEnvironmentVariable("GEMINI_API_KEY","<key>","User")')
        print('  ...and open a NEW terminal so it takes effect.')
        return

    try:
        from google import genai
    except ImportError:
        print('google-genai not installed. Run:  pip install google-genai')
        return

    model = 'lyria-3-clip-preview' if clip else 'lyria-3-pro-preview'
    print('Generating with %s ...' % model)
    print('  prompt: %s\n' % prompt)

    try:
        # Force the GEMINI key; strip env keys so the SDK can't fall back to a stale GOOGLE_API_KEY.
        api_key = os.environ.pop('GEMINI_API_KEY', None) or os.environ.pop('GOOGLE_API_KEY', None)
        os.environ.pop('GOOGLE_API_KEY', None)
        if api_key:
            print('  using key: %s...%s  (length %d, should start with "AIza" and be 39 chars)'
                  % (api_key[:6], api_key[-4:], len(api_key)))
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(model=model, contents=prompt)
    except Exception as e:
        print('Generation failed:', e)
        print('Note: Lyria 3 is a premium preview model - it may require billing enabled on your key.')
        return

    here = os.path.dirname(os.path.abspath(__file__))
    outdir = os.path.join(here, 'generated')
    os.makedirs(outdir, exist_ok=True)
    slug = (re.sub(r'[^a-z0-9]+', '-', prompt.lower())[:40].strip('-')) or 'song'
    out = os.path.join(outdir, '%s-%s.mp3' % (slug, datetime.datetime.now().strftime('%H%M%S')))

    lyrics, audio = [], None
    for part in response.parts:
        if getattr(part, 'text', None):
            lyrics.append(part.text)
        elif getattr(part, 'inline_data', None) is not None:
            audio = part.inline_data.data

    if lyrics:
        print('--- lyrics / structure ---')
        print('\n'.join(lyrics))
        print('---------------------------\n')

    if not audio:
        print('No audio returned. (The prompt may have been blocked by safety filters - '
              'avoid naming real artists or copyrighted lyrics.)')
        return

    with open(out, 'wb') as f:
        f.write(audio)
    print('Saved:', out)

    if do_stems:
        print('\nSplitting into stems...\n')
        subprocess.run([sys.executable, os.path.join(here, 'make-stems.py'), out])
    else:
        print('\nNext:  python make-stems.py "%s"   (or just type "stems" in Heidi)' % out)


if __name__ == '__main__':
    main()
