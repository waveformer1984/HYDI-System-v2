/**
 * components/rezonate/studio/WaveformDisplay.tsx
 *
 * Canvas-based waveform renderer for a single audio track/blob or a stack of
 * separated stems.
 *
 * Single-buffer mode:
 *   Samples the first channel of the provided AudioBuffer, normalises the
 *   amplitude values, and draws a centre-origin filled waveform path using the
 *   Canvas 2D API.
 *   When no buffer is provided a horizontal placeholder line is shown.
 *
 * Stems mode (when `stems` prop is provided with length > 0):
 *   Divides the canvas height evenly between all stems, draws each stem in its
 *   own horizontal strip with its colour and a name label overlay.
 *
 * Live playhead:
 *   When `clockCurrentTime` and `bufferDuration` are supplied, the component
 *   drives its own requestAnimationFrame loop to update the playhead position
 *   automatically.  Otherwise `playheadPct` (0-100) is used directly.
 *
 * An optional text `label` is rendered over the single-buffer canvas.
 */

import React, { useRef, useEffect, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WaveformDisplayProps {
  audioBuffer?: AudioBuffer | null;
  /** Multi-stem mode: draw each stem as a stacked strip. */
  stems?: Array<{ name: string; buffer: AudioBuffer; color: string }>;
  /** Waveform fill colour — defaults to '#8b5cf6' (violet-500). Single-buffer only. */
  color?: string;
  /** Canvas height in px — defaults to 64. */
  height?: number;
  /** Playhead position 0-100; used when clockCurrentTime/bufferDuration are absent. */
  playheadPct?: number;
  /**
   * Current audio-clock time in seconds.  When provided together with
   * bufferDuration the component computes playheadPct internally via RAF.
   */
  clockCurrentTime?: number;
  /** Duration of the audio buffer in seconds — required for live-playhead mode. */
  bufferDuration?: number;
  /** Optional text label rendered over the single-buffer canvas. */
  label?: string;
}

// ── Drawing helpers ───────────────────────────────────────────────────────────

/**
 * Draws the waveform for `buffer` onto a sub-region of `canvas`.
 *
 * @param canvas  - The full canvas element.
 * @param ctx     - Shared 2D context.
 * @param buffer  - AudioBuffer to render.
 * @param color   - Fill colour.
 * @param yOffset - Top-most pixel row of the strip.
 * @param stripH  - Height of the strip in pixels.
 */
function drawWaveformStrip(
  ctx: CanvasRenderingContext2D,
  buffer: AudioBuffer,
  color: string,
  width: number,
  yOffset: number,
  stripH: number
): void {
  const data = buffer.getChannelData(0);
  const samplesPerPixel = Math.max(1, Math.floor(data.length / width));
  const midY = yOffset + stripH / 2;

  // Find peak for normalisation.
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  const scale = peak > 0 ? 1 / peak : 1;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, midY);

  // Upper half.
  for (let x = 0; x < width; x++) {
    const start = x * samplesPerPixel;
    let max = 0;
    for (let s = 0; s < samplesPerPixel; s++) {
      const v = Math.abs(data[start + s] ?? 0) * scale;
      if (v > max) max = v;
    }
    ctx.lineTo(x, midY - max * (stripH / 2) * 0.9);
  }

  // Lower half (mirror).
  for (let x = width - 1; x >= 0; x--) {
    const start = x * samplesPerPixel;
    let max = 0;
    for (let s = 0; s < samplesPerPixel; s++) {
      const v = Math.abs(data[start + s] ?? 0) * scale;
      if (v > max) max = v;
    }
    ctx.lineTo(x, midY + max * (stripH / 2) * 0.9);
  }

  ctx.closePath();
  ctx.fill();
}

/**
 * Full single-buffer waveform draw (legacy entry-point, delegates to strip helper).
 */
function drawWaveform(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer,
  color: string
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawWaveformStrip(ctx, buffer, color, canvas.width, 0, canvas.height);
}

/**
 * Draws all stems as stacked horizontal strips, each with a label overlay.
 */
function drawStems(
  canvas: HTMLCanvasElement,
  stems: Array<{ name: string; buffer: AudioBuffer; color: string }>
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const stripH = Math.floor(height / stems.length);

  stems.forEach((stem, i) => {
    const yOffset = i * stripH;

    // Subtle dark background per strip for visual separation.
    ctx.fillStyle = i % 2 === 0 ? 'rgba(0,0,0,0.18)' : 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, yOffset, width, stripH);

    // Waveform.
    drawWaveformStrip(ctx, stem.buffer, stem.color, width, yOffset, stripH);

    // Divider line between strips.
    if (i < stems.length - 1) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, yOffset + stripH);
      ctx.lineTo(width, yOffset + stripH);
      ctx.stroke();
    }

    // Label — small text in the top-left of each strip.
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `bold ${Math.max(9, Math.min(11, stripH * 0.22))}px system-ui, sans-serif`;
    ctx.fillText(stem.name.toUpperCase(), 6, yOffset + Math.max(11, stripH * 0.35));
  });
}

/**
 * Draws the placeholder horizontal centre line shown when there is no buffer.
 */
function drawPlaceholder(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = '#4b5563'; // gray-600
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
}

/**
 * Draws a thin vertical white playhead line at the given percentage (0-100).
 */
function drawPlayhead(canvas: HTMLCanvasElement, pct: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const x = (pct / 100) * canvas.width;
  ctx.strokeStyle = '#f8fafc'; // slate-50
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, canvas.height);
  ctx.stroke();
}

/**
 * Draws an optional text label overlay in the top-left of the canvas.
 */
function drawLabel(canvas: HTMLCanvasElement, label: string): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.font = 'bold 10px system-ui, sans-serif';
  ctx.fillText(label, 6, 14);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WaveformDisplay({
  audioBuffer,
  stems,
  color = '#8b5cf6',
  height = 64,
  playheadPct,
  clockCurrentTime,
  bufferDuration,
  label,
}: WaveformDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  // Whether we are in live-playhead mode (RAF-driven).
  const liveMode =
    typeof clockCurrentTime === 'number' && typeof bufferDuration === 'number' && bufferDuration > 0;

  // ── Static paint (waveform body) ──────────────────────────────────────────

  const paintBody = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const useStems = stems && stems.length > 0;

    if (useStems) {
      drawStems(canvas, stems!);
    } else if (audioBuffer) {
      drawWaveform(canvas, audioBuffer, color);
      if (label) drawLabel(canvas, label);
    } else {
      drawPlaceholder(canvas);
      if (label) drawLabel(canvas, label);
    }
  }, [audioBuffer, stems, color, label]);

  // ── Repaint body whenever deps change ─────────────────────────────────────

  useEffect(() => {
    paintBody();
  }, [paintBody]);

  // ── Static playhead (non-live mode) ───────────────────────────────────────

  useEffect(() => {
    if (liveMode) return; // RAF handles it instead.
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (typeof playheadPct === 'number') {
      drawPlayhead(canvas, playheadPct);
    }
  }, [liveMode, playheadPct]);

  // ── Live playhead via requestAnimationFrame ────────────────────────────────

  useEffect(() => {
    if (!liveMode) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;

    const tick = () => {
      if (cancelled || !canvasRef.current) return;

      // Recompute pct from the latest prop values via closure.
      const dur = bufferDuration!;
      const cur = clockCurrentTime!;
      const pct = dur > 0 ? ((cur % dur) / dur) * 100 : 0;

      // Repaint body then overlay playhead.
      paintBody();
      drawPlayhead(canvasRef.current, pct);

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [liveMode, clockCurrentTime, bufferDuration, paintBody]);

  return (
    <canvas
      ref={canvasRef}
      // Width is controlled by CSS; the canvas resolution tracks the container.
      width={800}
      height={height}
      className="w-full rounded"
      style={{ height, background: 'transparent' }}
      aria-label={
        stems && stems.length > 0
          ? `Stem waveforms: ${stems.map(s => s.name).join(', ')}`
          : audioBuffer
          ? 'Audio waveform'
          : 'No audio loaded'
      }
    />
  );
}

// Default export kept for backwards compatibility with existing imports.
export default WaveformDisplay;
