/**
 * Unit tests for workers/InventoryMaterialsWorker.js's low-stock detection
 * and alerting.
 *
 * This worker is registered in WorkerOrchestrator and its `routineCheck()`
 * runs on a 30s poll, but it had no test file at all -- the gap flagged as a
 * follow-up in ISSUES_FOUND.md #74. Writing these tests surfaced three real
 * defects, each covered below:
 *
 *   1. `triggerLowStockAlerts()` split items into critical/warning by reading
 *      `item.quantity`. Low-stock items are raw `inventory_items` rows, which
 *      carry `quantity_count`/`quantity_grams`/`quantity_ml` and no plain
 *      `quantity` column, so both filters compared against `undefined` and
 *      were always empty. Every item fell into neither group, so no inventory
 *      notification was ever enqueued -- not even for stock sitting at zero.
 *   2. `triggerProcurementForLowStock()` had the same missing-column bug, so
 *      out-of-stock items were always procured at 'high' rather than
 *      'critical' urgency (72h expected delivery instead of 24h).
 *   3. `fastener_*` -- one of the five families in the canonical taxonomy
 *      (see OpportunityDetectionWorker.getOptimalLevel) -- matched no branch
 *      in the threshold chain, so fasteners were never evaluated for low
 *      stock and never triggered procurement.
 *
 * Supabase and the queue are mocked; no network or credentials are involved.
 */

'use strict';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

const mockEnqueue = jest.fn();
jest.mock('../../workers/QueueManager', () =>
  jest.fn(() => ({
    enqueue: mockEnqueue,
    registerWorker: jest.fn(),
    updateHeartbeat: jest.fn(),
  })),
);

jest.mock('../../lib/structured-logger', () => ({
  child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const InventoryMaterialsWorker = require('../../workers/InventoryMaterialsWorker');

/** An `inventory_items` row, shaped the way the real table stores them. */
function item(itemType, quantities) {
  return { item_id: `item_${itemType}`, item_type: itemType, name: itemType, ...quantities };
}

describe('InventoryMaterialsWorker low-stock detection', () => {
  let worker;

  beforeEach(() => {
    jest.clearAllMocks();
    worker = new InventoryMaterialsWorker('test-worker');
  });

  describe('isLowStock across the canonical item-type families', () => {
    it.each([
      ['filament_pla', { quantity_grams: 150 }, true],
      ['filament_pla', { quantity_grams: 500 }, false],
      ['material_isopropyl_alcohol', { quantity_ml: 50 }, true],
      ['material_isopropyl_alcohol', { quantity_ml: 400 }, false],
      ['pcb_prototype', { quantity_count: 2 }, true],
      ['pcb_prototype', { quantity_count: 40 }, false],
      ['electronic_resistor', { quantity_count: 3 }, true],
      ['electronic_resistor', { quantity_count: 80 }, false],
    ])('%s at %o -> low=%s', (type, quantities, expected) => {
      expect(worker.isLowStock(item(type, quantities))).toBe(expected);
    });

    // Defect 3: these previously matched no branch and returned false even at
    // zero stock, so fasteners were invisible to alerting and procurement.
    it.each([
      ['fastener_screw', { quantity_count: 5 }, true],
      ['fastener_nut', { quantity_count: 0 }, true],
      ['fastener_bolt', { quantity_count: 150 }, false],
    ])('%s at %o -> low=%s', (type, quantities, expected) => {
      expect(worker.isLowStock(item(type, quantities))).toBe(expected);
    });

    it('ignores item types outside the taxonomy', () => {
      expect(worker.isLowStock(item('mystery_widget', { quantity_count: 0 }))).toBe(false);
    });

    it('honours caller-supplied threshold overrides', () => {
      const plenty = item('filament_pla', { quantity_grams: 150 });

      expect(worker.isLowStock(plenty)).toBe(true);
      expect(worker.isLowStock(plenty, { filament_grams: 100 })).toBe(false);
    });

    it('treats a zero override as a real threshold, not a missing one', () => {
      // A `||` fallback would discard 0 and silently apply the default of 200.
      expect(worker.isLowStock(item('filament_pla', { quantity_grams: 10 }), { filament_grams: 0 })).toBe(false);
    });
  });

  describe('identifyLowStock', () => {
    it('returns only the items below threshold', () => {
      const inventory = [
        item('filament_pla', { quantity_grams: 10 }),
        item('filament_abs', { quantity_grams: 900 }),
        item('fastener_screw', { quantity_count: 1 }),
        item('pcb_production', { quantity_count: 60 }),
      ];

      expect(worker.identifyLowStock(inventory).map((i) => i.item_type)).toEqual([
        'filament_pla',
        'fastener_screw',
      ]);
    });

    it('returns an empty list when everything is stocked', () => {
      expect(worker.identifyLowStock([item('filament_pla', { quantity_grams: 900 })])).toEqual([]);
    });
  });

  describe('getLowStockItems shares one threshold implementation', () => {
    beforeEach(() => {
      worker.supabase = {
        from: () => ({ select: () => Promise.resolve({ data: [
          item('filament_pla', { quantity_grams: 10 }),
          item('fastener_bolt', { quantity_count: 2 }),
          item('pcb_production', { quantity_count: 60 }),
        ], error: null }) }),
      };
    });

    it('agrees with identifyLowStock rather than keeping its own copy of the rules', async () => {
      const viaQuery = await worker.getLowStockItems();

      expect(viaQuery.map((i) => i.item_type)).toEqual(['filament_pla', 'fastener_bolt']);
    });

    it('restricts results to the requested item types', async () => {
      const viaQuery = await worker.getLowStockItems(['fastener_bolt']);

      expect(viaQuery.map((i) => i.item_type)).toEqual(['fastener_bolt']);
    });
  });

  describe('triggerLowStockAlerts (defect 1: no alert was ever sent)', () => {
    it('enqueues a critical alert for stock at zero', async () => {
      await worker.triggerLowStockAlerts([item('fastener_nut', { quantity_count: 0 })]);

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const [queue, payload, priority] = mockEnqueue.mock.calls[0];
      expect(queue).toBe('notification');
      expect(payload.data.template).toBe('inventory.critical');
      expect(priority).toBe(10);
    });

    it('enqueues a warning alert for stock that is low but not exhausted', async () => {
      await worker.triggerLowStockAlerts([item('filament_pla', { quantity_grams: 20 })]);

      expect(mockEnqueue).toHaveBeenCalledTimes(1);
      const [, payload, priority] = mockEnqueue.mock.calls[0];
      expect(payload.data.template).toBe('inventory.warning');
      expect(priority).toBe(7);
    });

    it('separates critical from warning in one batch', async () => {
      await worker.triggerLowStockAlerts([
        item('fastener_nut', { quantity_count: 0 }),
        item('filament_pla', { quantity_grams: 20 }),
      ]);

      const templates = mockEnqueue.mock.calls.map(([, payload]) => payload.data.template);
      expect(templates).toEqual(['inventory.critical', 'inventory.warning']);
    });

    it('classifies by the item family\'s own unit column', async () => {
      // ml-denominated stock at zero is still critical; the old code read a
      // `quantity` column that does not exist and classified it as neither.
      await worker.triggerLowStockAlerts([item('material_solder_paste', { quantity_ml: 0 })]);

      expect(mockEnqueue.mock.calls[0][1].data.template).toBe('inventory.critical');
    });
  });

  describe('triggerProcurementForLowStock (defect 2: urgency never escalated)', () => {
    beforeEach(() => {
      jest.spyOn(worker, 'triggerProcurement').mockResolvedValue(undefined);
    });

    it('requests critical urgency for stock at zero', async () => {
      await worker.triggerProcurementForLowStock([item('fastener_nut', { quantity_count: 0 })]);

      expect(worker.triggerProcurement).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ urgency: 'critical' }) }),
      );
    });

    it('requests high urgency for stock that is low but not exhausted', async () => {
      await worker.triggerProcurementForLowStock([item('filament_pla', { quantity_grams: 20 })]);

      expect(worker.triggerProcurement).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ urgency: 'high' }) }),
      );
    });
  });

  describe('normalizeQuantity', () => {
    it.each([
      [{ quantity_count: 7 }, 7],
      [{ quantity_grams: 250 }, 250],
      [{ quantity_ml: 30 }, 30],
      [{}, 0],
    ])('%o -> %s', (quantities, expected) => {
      expect(worker.normalizeQuantity(item('filament_pla', quantities))).toBe(expected);
    });
  });
});
