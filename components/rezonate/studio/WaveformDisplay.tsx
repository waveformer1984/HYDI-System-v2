/**
 * components/rezonate/studio/WaveformDisplay.tsx
 *
 * Canvas-based waveform renderer for a single audio track/blob.
 *
 * Samples the first channel of the provided AudioBuffer, normalises the
 * amplitude values, and draws a centre-origin filled waveform path using the
 * Canvas 2D API.
 *
 * When no buffer is provided a horizontal placeholder line is shown.
 * An optional playhead line (0-100%) is overlaid when playheadPct is set.
 */

import React, { useRef, useEffect } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WaveformDisplayProps {
  audioBuffer?: AudioBuffer | null;
  /** Waveform fill colour — defaults to '#8b5cf6' (violet-500). */
  color?: string;
  /** Canvas height in px — defaults to 64. */
  height?: number;
  /** Playhead position 0-100; renders a vertical line when provided. */
  playheadPct?: number;
}

// ── Drawing helpers ───────────────────────────────────────────────────────────

/**
 * Draws the waveform onto the canvas. One pixel column = one slice of samples.
 * Amplitude is normalised to ±1 then mapped to canvas height.
 */
function drawWaveform(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer,
  color: string
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const data = buffer.getChannelData(0);
  const samplesPerPixel = Math.max(1, Math.floor(data.length / width));
  const midY = height / 2;

  // Find peak for normalisation.
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const abs = Math.abs(data[i]);
    if (abs > peak) peak = abs;
  }
  // Avoid division by zero for silent buffers.
  const scale = peak > 0 ? 1 / peak : 1;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, midY);

  // Upper half of the waveform (positive amplitude going up).
  for (let x = 0; x < width; x++) {
    const start = x * samplesPerPixel;
    let max = 0;
    for (let s = 0; s < samplesPerPixel; s++) {
      const v = Math.abs(data[start + s] ?? 0) * scale;
      if (v > max) max = v;
    }
    ctx.lineTo(x, midY - max * midY * 0.9);
  }

  // Lower half (mirror, positive amplitude going down).
  for (let x = width - 1; x >= 0; x--) {
    const start = x * samplesPerPixel;
    let max = 0;
    for (let s = 0; s < samplesPerPixel; s++) {
      const v = Math.abs(data[start + s] ?? 0) * scale;
      if (v > max) max = v;
    }
    ctx.lineTo(x, midY + max * midY * 0.9);
  }

  ctx.closePath();
  ctx.fill();
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
 * Draws a vertical playhead line at the given percentage.
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function WaveformDisplay({
  audioBuffer,
  color = '#8b5cf6',
  height = 64,
  playheadPct,
}: WaveformDisplayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (audioBuffer) {
      drawWaveform(canvas, audioBuffer, color);
    } else {
      drawPlaceholder(canvas);
    }

    // Overlay playhead after the waveform is painted.
    if (typeof playheadPct === 'number') {
      drawPlayhead(canvas, playheadPct);
    }
  }, [audioBuffer, color, playheadPct]);

  return (
    <canvas
      ref={canvasRef}
      // Width is controlled by CSS; the canvas resolution tracks the container.
      width={800}
      height={height}
      className="w-full rounded"
      style={{ height, background: 'transparent' }}
      aria-label={audioBuffer ? 'Audio waveform' : 'No audio loaded'}
    />
  );
}
