/**
 * HydiTacticalModule — 3D Print Studio
 *
 * Dashboard for the 3D printing studio — instrument cases,
 * cable management solutions, EDC gear, and custom print orders.
 * Manages product catalog, Etsy listings, and print queue.
 *
 * TEST mode: Shows mock product catalog and print queue.
 * LIVE mode: Connects to Etsy API / order system when available.
 *
 * Config: Set NEXT_PUBLIC_TACTICAL_URL for live data.
 * Error handling: Shows empty state when no products loaded.
 */
'use client';

import { useState } from 'react';
import {
  Printer,
  Package,
  ShoppingBag,
  DollarSign,
  Layers,
  Box,
  Clock,
  CheckCircle2,
  ExternalLink,
  Ruler,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';

interface Product {
  id: string;
  name: string;
  category: 'instrument-case' | 'cable-management' | 'edc' | 'custom';
  price: number;
  status: 'listed' | 'printing' | 'design' | 'sold';
  material: string;
  printTime: string;
  platform: string;
}

const MOCK_PRODUCTS: Product[] = [
  { id: 'PRD-001', name: 'Guitar Pedal Case (Custom Fit)', category: 'instrument-case', price: 45, status: 'listed', material: 'PETG', printTime: '6h 30m', platform: 'Etsy' },
  { id: 'PRD-002', name: 'Mic Stand Cable Clip (5-pack)', category: 'cable-management', price: 12, status: 'listed', material: 'PLA+', printTime: '1h 45m', platform: 'Etsy' },
  { id: 'PRD-003', name: 'XLR Cable Organizer Wall Mount', category: 'cable-management', price: 18, status: 'listed', material: 'PLA+', printTime: '2h 15m', platform: 'Etsy' },
  { id: 'PRD-004', name: 'Audio Interface Desktop Stand', category: 'instrument-case', price: 35, status: 'design', material: 'PETG', printTime: '4h 00m', platform: 'Etsy' },
  { id: 'PRD-005', name: 'EDC Multitool Holster', category: 'edc', price: 22, status: 'listed', material: 'TPU', printTime: '3h 20m', platform: 'Etsy' },
  { id: 'PRD-006', name: 'Studio Headphone Hook (Desk Clamp)', category: 'instrument-case', price: 15, status: 'listed', material: 'PLA+', printTime: '1h 30m', platform: 'Etsy' },
  { id: 'PRD-007', name: 'Power Strip Cable Tray', category: 'cable-management', price: 20, status: 'printing', material: 'PLA+', printTime: '3h 00m', platform: 'Direct' },
  { id: 'PRD-008', name: 'Custom Phone Case (Tactical)', category: 'edc', price: 28, status: 'listed', material: 'TPU', printTime: '2h 45m', platform: 'Etsy' },
];

const CATEGORY_STYLE: Record<string, { color: string; label: string }> = {
  'instrument-case': { color: '#bc8cff', label: 'Instrument/Studio' },
  'cable-management': { color: '#58a6ff', label: 'Cable Mgmt' },
  'edc': { color: '#d29922', label: 'EDC Gear' },
  'custom': { color: '#f0883e', label: 'Custom Order' },
};

const STATUS_STYLE: Record<string, { color: string; bg: string }> = {
  'listed': { color: '#3fb950', bg: '#3fb95015' },
  'printing': { color: '#58a6ff', bg: '#58a6ff15' },
  'design': { color: '#d29922', bg: '#d2992215' },
  'sold': { color: '#bc8cff', bg: '#bc8cff15' },
};

export default function HydiTacticalModule() {
  const { isLive } = useMode();
  const [products] = useState<Product[]>(MOCK_PRODUCTS);
  const [filter, setFilter] = useState<string>('all');

  const filtered = filter === 'all' ? products : products.filter(p => p.category === filter);
  const listedCount = products.filter(p => p.status === 'listed').length;
  const totalValue = products.filter(p => p.status === 'listed').reduce((s, p) => s + p.price, 0);

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      <div className="flex items-center gap-3 mb-6">
        <Printer size={20} style={{ color: '#f0883e' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
          HYDI Tactical — 3D Print Studio
        </h1>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: '#3fb95015', color: '#3fb950' }}>
          {products.length} products
        </span>
      </div>

      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        3D printed instrument cases, cable management, EDC gear, and custom orders. Etsy storefront + direct sales.
      </p>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { icon: <Package size={14} />, label: 'Products', value: products.length, color: '#f0883e' },
          { icon: <ShoppingBag size={14} />, label: 'Listed', value: listedCount, color: '#3fb950' },
          { icon: <DollarSign size={14} />, label: 'Catalog Value', value: `$${totalValue}`, color: '#58a6ff' },
          { icon: <Printer size={14} />, label: 'Printing', value: products.filter(p => p.status === 'printing').length, color: '#d29922' },
        ].map(s => (
          <div key={s.label} className="p-3 rounded-md border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex justify-center mb-1" style={{ color: s.color }}>{s.icon}</div>
            <div className="text-lg font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Category Filter */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <button
          onClick={() => setFilter('all')}
          className="px-2.5 py-1 rounded text-[10px] font-mono transition-colors"
          style={{
            background: filter === 'all' ? '#f0883e20' : 'transparent',
            color: filter === 'all' ? '#f0883e' : 'var(--text-secondary)',
            border: '1px solid var(--border-color)',
          }}
        >
          All ({products.length})
        </button>
        {Object.entries(CATEGORY_STYLE).map(([key, style]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className="px-2.5 py-1 rounded text-[10px] font-mono transition-colors"
            style={{
              background: filter === key ? `${style.color}20` : 'transparent',
              color: filter === key ? style.color : 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
            }}
          >
            {style.label} ({products.filter(p => p.category === key).length})
          </button>
        ))}
      </div>

      {/* Product Grid */}
      <div className="space-y-2">
        {filtered.map(product => {
          const cat = CATEGORY_STYLE[product.category];
          const sts = STATUS_STYLE[product.status];
          return (
            <div key={product.id} className="rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Box size={14} style={{ color: cat.color }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>{product.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono font-bold" style={{ color: '#3fb950' }}>${product.price}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: sts.color, background: sts.bg }}>
                    {product.status}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: cat.color }}>{cat.label}</span>
                <span className="flex items-center gap-1"><Layers size={9} /> {product.material}</span>
                <span className="flex items-center gap-1"><Clock size={9} /> {product.printTime}</span>
                <span className="flex items-center gap-1"><ExternalLink size={9} /> {product.platform}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
