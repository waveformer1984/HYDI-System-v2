import React, { useRef, useEffect, useState, useCallback } from 'react';

interface Section {
  id: string;
  name: string;
  bars: number;
  start_bar: number;
  chords: string[];
  color: string;
  description: string;
}

interface Layer {
  id: string;
  name: string;
  color: string;
  start_bar: number;
  duration_bars: number;
  muted: boolean;
}

interface Props {
  sections: Section[];
  layers: Layer[];
  totalBars: number;
  bpm: number;
  currentBar: number;
  playing: boolean;
  onSeek: (bar: number) => void;
  onSectionClick: (section: Section) => void;
}

const BAR_WIDTH = 28;
const SECTION_TRACK_H = 48;
const LAYER_TRACK_H = 36;
const RULER_H = 24;
const LABEL_W = 96;

export default function ArrangementTimeline({
  sections, layers, totalBars, bpm, currentBar, playing, onSeek, onSectionClick,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoveredSection, setHoveredSection] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  const totalW = LABEL_W + totalBars * BAR_WIDTH;
  const totalH = RULER_H + SECTION_TRACK_H + layers.length * LAYER_TRACK_H + 8;

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left - LABEL_W;
    if (x < 0) return;
    const bar = Math.floor(x / BAR_WIDTH) + 1;
    onSeek(Math.max(1, Math.min(totalBars, bar)));
  }, [onSeek, totalBars]);

  const playheadX = LABEL_W + (currentBar - 1) * BAR_WIDTH;

  return (
    <div className="bg-gray-950 rounded-xl overflow-hidden border border-gray-800">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Arrangement</span>
        <span className="text-xs text-gray-500">{bpm} BPM · {totalBars} bars</span>
      </div>

      <div className="overflow-x-auto">
        <svg
          ref={svgRef}
          width={totalW}
          height={totalH}
          onClick={handleSvgClick}
          className="cursor-crosshair block"
        >
          {/* Background */}
          <rect width={totalW} height={totalH} fill="#030712" />

          {/* Bar grid lines */}
          {Array.from({ length: totalBars }, (_, i) => i + 1).map((bar) => (
            <line
              key={bar}
              x1={LABEL_W + (bar - 1) * BAR_WIDTH}
              y1={RULER_H}
              x2={LABEL_W + (bar - 1) * BAR_WIDTH}
              y2={totalH}
              stroke={bar % 4 === 1 ? '#1f2937' : '#111827'}
              strokeWidth={bar % 4 === 1 ? 1 : 0.5}
            />
          ))}

          {/* Ruler bar numbers */}
          {Array.from({ length: Math.ceil(totalBars / 4) }, (_, i) => i * 4 + 1).map((bar) => (
            <text
              key={bar}
              x={LABEL_W + (bar - 1) * BAR_WIDTH + 2}
              y={RULER_H - 6}
              fontSize={9}
              fill="#6b7280"
              fontFamily="monospace"
            >
              {bar}
            </text>
          ))}

          {/* Track label: Sections */}
          <rect x={0} y={RULER_H} width={LABEL_W} height={SECTION_TRACK_H} fill="#111827" />
          <text x={8} y={RULER_H + SECTION_TRACK_H / 2 + 4} fontSize={10} fill="#9ca3af" fontFamily="sans-serif">Sections</text>

          {/* Section blocks */}
          {sections.map((sec) => {
            const x = LABEL_W + (sec.start_bar - 1) * BAR_WIDTH;
            const w = sec.bars * BAR_WIDTH - 2;
            const isHovered = hoveredSection === sec.id;
            return (
              <g
                key={sec.id}
                onClick={(e) => { e.stopPropagation(); onSectionClick(sec); }}
                onMouseEnter={(e) => {
                  setHoveredSection(sec.id);
                  const rect = svgRef.current?.getBoundingClientRect();
                  if (rect) setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top, text: sec.description });
                }}
                onMouseLeave={() => { setHoveredSection(null); setTooltip(null); }}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={x} y={RULER_H + 4}
                  width={w} height={SECTION_TRACK_H - 8}
                  rx={4} fill={sec.color}
                  opacity={isHovered ? 1 : 0.85}
                />
                {w > 40 && (
                  <text
                    x={x + 6} y={RULER_H + SECTION_TRACK_H / 2 + 4}
                    fontSize={10} fill="white"
                    fontWeight="600" fontFamily="sans-serif"
                    style={{ pointerEvents: 'none' }}
                  >
                    {sec.name}
                  </text>
                )}
                {w > 90 && sec.chords.length > 0 && (
                  <text
                    x={x + 6} y={RULER_H + SECTION_TRACK_H - 10}
                    fontSize={8} fill="rgba(255,255,255,0.7)"
                    fontFamily="monospace"
                    style={{ pointerEvents: 'none' }}
                  >
                    {sec.chords.slice(0, 4).join(' · ')}
                  </text>
                )}
              </g>
            );
          })}

          {/* Layer tracks */}
          {layers.map((layer, li) => {
            const y = RULER_H + SECTION_TRACK_H + li * LAYER_TRACK_H;
            const lx = LABEL_W + (layer.start_bar - 1) * BAR_WIDTH;
            const lw = layer.duration_bars * BAR_WIDTH - 2;
            return (
              <g key={layer.id}>
                <rect x={0} y={y} width={LABEL_W} height={LAYER_TRACK_H} fill="#111827" />
                <text x={8} y={y + LAYER_TRACK_H / 2 + 4} fontSize={9} fill={layer.muted ? '#4b5563' : '#d1d5db'} fontFamily="sans-serif">
                  {layer.muted ? '🔇 ' : ''}{layer.name}
                </text>
                <rect
                  x={lx} y={y + 4}
                  width={Math.max(lw, 4)} height={LAYER_TRACK_H - 8}
                  rx={3} fill={layer.muted ? '#374151' : layer.color}
                  opacity={0.75}
                />
                {lw > 40 && (
                  <text x={lx + 6} y={y + LAYER_TRACK_H / 2 + 4} fontSize={9} fill="white" fontFamily="sans-serif">
                    {layer.name}
                  </text>
                )}
              </g>
            );
          })}

          {/* Playhead */}
          <line
            x1={playheadX} y1={RULER_H}
            x2={playheadX} y2={totalH}
            stroke="#f43f5e" strokeWidth={2}
          />
          <polygon
            points={`${playheadX - 5},${RULER_H} ${playheadX + 5},${RULER_H} ${playheadX},${RULER_H + 8}`}
            fill="#f43f5e"
          />

          {/* Tooltip */}
          {tooltip && (
            <g>
              <rect
                x={Math.min(tooltip.x + 8, totalW - 200)} y={tooltip.y - 30}
                width={190} height={24} rx={4} fill="#1f2937"
              />
              <text
                x={Math.min(tooltip.x + 14, totalW - 194)} y={tooltip.y - 13}
                fontSize={9} fill="#e5e7eb" fontFamily="sans-serif"
              >
                {tooltip.text.slice(0, 36)}{tooltip.text.length > 36 ? '…' : ''}
              </text>
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}
