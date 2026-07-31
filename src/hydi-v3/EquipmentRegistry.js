'use strict';

const DEFAULT_EQUIPMENT = [
  {
    id: 'creality-k1-se',
    name: 'Creality K1 SE',
    type: '3d-printer',
    manufacturer: 'Creality',
    model: 'K1 SE',
    location: 'ProtoForge Bay 1',
    capabilities: ['fdm', 'pla', 'petg', 'tpu'],
    strategicObjective: 'manufacturing',
    status: 'idle',
    metadata: {
      buildVolume: '220x220x250mm',
      nozzleDiameter: 0.4,
      firmware: 'Klipper-based',
    },
  },
  {
    id: 'roland-synth',
    name: 'Roland Synth',
    type: 'music-synthesizer',
    manufacturer: 'Roland',
    model: 'JUNO-X',
    location: 'Rezonate Studio',
    capabilities: ['audio-synthesis', 'midi', 'waveform'],
    strategicObjective: 'music',
    status: 'idle',
    metadata: { voices: 60, polyphony: true },
  },
  {
    id: 'desktop-cnc',
    name: 'Desktop CNC',
    type: 'cnc',
    manufacturer: 'Bantam Tools',
    model: 'NextDraw',
    location: 'ProtoForge Bay 2',
    capabilities: ['milling', 'pcb', 'engraving'],
    strategicObjective: 'manufacturing',
    status: 'idle',
    metadata: { workArea: '178x127mm', spindle: '15000rpm' },
  },
  {
    id: 'laser-cutter',
    name: 'Laser Cutter',
    type: 'laser-cutter',
    manufacturer: 'xTool',
    model: 'D1 Pro',
    location: 'ProtoForge Bay 3',
    capabilities: ['laser-cutting', 'engraving', 'acrylic', 'wood'],
    strategicObjective: 'manufacturing',
    status: 'idle',
    metadata: { power: '20W', workArea: '430x390mm' },
  },
];

class EquipmentRegistry {
  constructor(equipment = DEFAULT_EQUIPMENT) {
    this._items = new Map();
    for (const item of equipment) {
      this.register(item);
    }
  }

  register(item) {
    if (!item || !item.id) {
      throw new Error('Equipment must have an id');
    }
    this._items.set(item.id, { ...item });
    return item.id;
  }

  get(id) {
    const item = this._items.get(id);
    return item ? { ...item } : null;
  }

  getAll() {
    return Array.from(this._items.values()).map((item) => ({ ...item }));
  }

  getByType(type) {
    return this.getAll().filter((item) => item.type === type);
  }

  getByStatus(status) {
    return this.getAll().filter((item) => item.status === status);
  }

  updateStatus(id, status) {
    const item = this._items.get(id);
    if (!item) return false;
    item.status = status;
    return true;
  }
}

module.exports = EquipmentRegistry;
module.exports.DEFAULT_EQUIPMENT = DEFAULT_EQUIPMENT;
