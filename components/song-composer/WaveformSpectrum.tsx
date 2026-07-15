import React, { useRef, useEffect, useCallback } from 'react';

interface Props {
  analyserNode: AnalyserNode | null;
  recording: boolean;
  playing: boolean;
  color?: string;
}

export default function WaveformSpectrum({ analyserNode, recording, playing, color = '#6366f1' }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  const drawSpectrum = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    if (!analyserNode || (!recording && !playing)) {
      // Idle flat line
      ctx.beginPath();
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = 1;
      ctx.moveTo(0, H / 2);
      ctx.lineTo(W, H / 2);
      ctx.stroke();

      // Idle label
      ctx.fillStyle = '#4b5563';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Waiting for audio…', W / 2, H / 2 - 10);
      return;
    }

    const bufferLen = analyserNode.frequencyBinCount;
    const dataArr = new Uint8Array(bufferLen);

    if (recording) {
      // Waveform mode while recording
      analyserNode.getByteTimeDomainData(dataArr);

      ctx.fillStyle = '#030712';
      ctx.fillRect(0, 0, W, H);

      ctx.lineWidth = 2;
      ctx.strokeStyle = recording ? '#f43f5e' : color;
      ctx.beginPath();

      const sliceW = W / bufferLen;
      let x = 0;
      for (let i = 0; i < bufferLen; i++) {
        const v = dataArr[i] / 128.0;
        const y = (v * H) / 2;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        x += sliceW;
      }
      ctx.lineTo(W, H / 2);
      ctx.stroke();
    } else {
      // Frequency spectrum while playing
      analyserNode.getByteFrequencyData(dataArr);

      ctx.fillStyle = '#030712';
      ctx.fillRect(0, 0, W, H);

      const barCount = Math.min(bufferLen, 128);
      const barW = W / barCount;

      for (let i = 0; i < barCount; i++) {
        const barH = (dataArr[i] / 255) * H;
        const hue = 260 + (i / barCount) * 80; // indigo → purple → pink
        ctx.fillStyle = `hsl(${hue}, 80%, 60%)`;
        ctx.fillRect(i * barW, H - barH, barW - 1, barH);
      }
    }

    rafRef.current = requestAnimationFrame(drawSpectrum);
  }, [analyserNode, recording, playing, color]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(drawSpectrum);
    return () => cancelAnimationFrame(rafRef.current);
  }, [drawSpectrum]);

  // Resize canvas to actual pixel size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  return (
    <div className="bg-gray-950 rounded-xl border border-gray-800 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          {recording ? 'Waveform · Recording' : 'Frequency Spectrum'}
        </span>
        {recording && (
          <span className="flex items-center gap-1.5 text-xs text-red-400">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            LIVE
          </span>
        )}
      </div>
      <canvas
        ref={canvasRef}
        className="w-full"
        style={{ height: 120, display: 'block' }}
      />
    </div>
  );
}
