/**
 * SketchPadModule — 2D Sketching & 3D CAD Modeling panel
 * 
 * Placeholder for FreeCAD integration, STL export, and 3D print prep.
 * Will embed a canvas for 2D sketching and a 3D viewport for CAD models.
 * 
 * Config: Set NEXT_PUBLIC_FREECAD_URL when FreeCAD backend is available.
 * Error handling: Shows placeholder state when backend is unavailable.
 */
'use client';

import { Box, Layers, Printer, FileDown, Pencil, Ruler } from 'lucide-react';

export default function SketchPadModule() {
  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      <div className="flex items-center gap-3 mb-6">
        <Box size={20} style={{ color: 'var(--text-accent)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
          SketchPad
        </h1>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: '#d2992215', color: '#d29922' }}>
          Coming Soon
        </span>
      </div>

      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        2D sketching, 3D CAD modeling, FreeCAD integration, STL export, and print prep.
      </p>

      {/* Feature Cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[
          { icon: <Pencil size={16} />, label: '2D Sketch', desc: 'Freehand + precision drawing' },
          { icon: <Box size={16} />, label: '3D Modeling', desc: 'Parametric CAD viewport' },
          { icon: <FileDown size={16} />, label: 'STL Export', desc: 'Print-ready file output' },
          { icon: <Printer size={16} />, label: 'Print Prep', desc: 'Slicer integration + G-code' },
          { icon: <Ruler size={16} />, label: 'Measurements', desc: 'Exact dimensions + tolerances' },
          { icon: <Layers size={16} />, label: 'Layer System', desc: 'Multi-layer sketch organization' },
        ].map((feat) => (
          <div
            key={feat.label}
            className="rounded-md p-4 border"
            style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
          >
            <div className="flex items-center gap-2 mb-2" style={{ color: 'var(--text-accent)' }}>
              {feat.icon}
              <span className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>
                {feat.label}
              </span>
            </div>
            <p className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
              {feat.desc}
            </p>
          </div>
        ))}
      </div>

      {/* Canvas Placeholder */}
      <div
        className="rounded-md border flex flex-col items-center justify-center"
        style={{
          background: 'var(--bg-sidebar)',
          borderColor: 'var(--border-color)',
          height: 300,
          borderStyle: 'dashed',
        }}
      >
        <Box size={48} style={{ color: 'var(--text-secondary)', opacity: 0.3 }} />
        <p className="text-sm font-mono mt-4" style={{ color: 'var(--text-secondary)' }}>
          Canvas will render here
        </p>
        <p className="text-[11px] font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>
          Pending FreeCAD backend integration
        </p>
      </div>
    </div>
  );
}
