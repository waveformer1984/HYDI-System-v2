# Resonate Local-First Audio Architecture

## Principle

Resonate runs without cloud AI credentials. The default audio generation is powered by a locally configured model runtime. Cloud providers may be added later as optional accelerators, not as the foundation.

## Flow

```text
Ursula Studio
      |
      v
ProtoForge Resonate
      |
      v
Local Audio Provider
      |
      v
Local Model Runtime  ────── Music Generation Model
      |                              |
      v                              v
Audio Asset                    Stem Separation
      |                              |
      +------------------------------+
      |
      v
Analysis
      |
      v
Ownership / Marketplace
```

## Components

### `src/providers/audio-provider.js`

Base contract for all audio providers.

```javascript
class AudioProvider {
  async generate(request) {}
  async health() {}
  capabilities() {}
}
```

### `src/providers/local-audio-provider.js`

Default provider. Validates the request and delegates to a `LocalModelRuntime`.

Example output:

```json
{
  "ok": true,
  "audioPath": "C:\\audio\\local-song.mp3",
  "provider": "local",
  "model": "local-audio-model",
  "duration": 120,
  "metadata": {}
}
```

### `src/providers/provider-registry.js`

Registry for multiple providers. Supports future cloud providers as opt-in plugins.

### `src/adapters/local-model-runtime.js`

Abstraction over the actual local model. Configuration via environment:

```env
AUDIO_MODEL_RUNTIME=python
AUDIO_MODEL_PATH=C:\\models\\musicgen\\generate.py
AUDIO_DEVICE=cpu
```

The runtime invokes `[command] [modelPath] [prompt] [duration] [clip] [outputPath]` and parses `Saved: <path>` from stdout.

### `src/adapters/resonate-engine.js`

Remains the boundary. `generateSong()` now calls the `AudioProvider` instead of calling `rezonate/generate.py` directly. Stems and analysis still call the existing local Python scripts.

## Supported local runtimes

The runtime is intentionally unopinionated. Any executable that accepts the above argument order and prints `Saved: <audioPath>` can be used. Example supported stacks:

- Meta AudioCraft / MusicGen (`python musicgen/generate.py`)
- Stable Audio Open
- Custom HYDI local diffusion models
- ONNX / DirectML audio models

## Model installation

1. Install a local audio generation model.
2. Ensure it can be invoked as an executable.
3. Set `AUDIO_MODEL_RUNTIME` and `AUDIO_MODEL_PATH`.
4. Restart Resonate.
5. Verify via `GET /engine/status` or `GET /health`.

## Hardware requirements

- CPU: any modern x86/ARM CPU
- GPU: optional; set `AUDIO_DEVICE=cuda` if the model supports it
- Storage: `generated/` output directory needs several MB per minute of audio

## Fallback behavior

There is **no silent fallback to cloud**. If the local model is not configured:

- `generateSong()` returns `{ ok: false, error: 'AUDIO_MODEL_RUNTIME not configured' }`
- `GET /health` reports `modelAvailable: false`
- The processing job transitions to `failed`

## Diagnostics

`GET /health` now returns:

```json
{
  "engine": {
    "audioProvider": "local",
    "cloudDependency": false,
    "modelAvailable": true,
    "command": "python",
    "modelPath": "...",
    "reason": null
  }
}
```

## Tests

91 tests cover provider selection, runtime adapter, missing model handling, generation success, and diagnostics. No external AI services are required.
