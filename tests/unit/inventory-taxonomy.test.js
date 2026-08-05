/**
 * Unit tests for workers/inventory-taxonomy.js.
 *
 * The taxonomy was extracted because `InventoryMaterialsWorker` and
 * `OpportunityDetectionWorker` each carried a byte-identical private copy of
 * the optimal-levels table, with nothing forcing them to agree. That
 * duplication is directly implicated in ISSUES_FOUND.md #86: both copies
 * listed the three `fastener_*` types, yet the low-stock threshold chain had
 * no `fastener` branch, so fasteners had restock quantities computed while
 * never being evaluated for low stock.
 *
 * The consistency test below is the point of the file: it asserts that every
 * item type with an optimal level actually resolves to a monitored family, so
 * the same class of gap fails CI instead of going unnoticed in production.
 */

'use strict';

const {
  OPTIMAL_LEVELS,
  DEFAULT_OPTIMAL_LEVEL,
  ITEM_TYPE_FAMILIES,
  getOptimalLevel,
  normalizeQuantity,
} = require('../../workers/inventory-taxonomy');

describe('inventory taxonomy', () => {
  describe('getOptimalLevel', () => {
    it.each([
      ['filament_pla', 1000],
      ['electronic_ic', 50],
      ['pcb_prototype', 20],
      ['material_isopropyl_alcohol', 500],
      ['fastener_screw', 200],
    ])('%s -> %s', (itemType, expected) => {
      expect(getOptimalLevel(itemType)).toBe(expected);
    });

    it('falls back to the default for an unknown item type', () => {
      expect(getOptimalLevel('mystery_widget')).toBe(DEFAULT_OPTIMAL_LEVEL);
    });
  });

  describe('normalizeQuantity', () => {
    it.each([
      [{ quantity_count: 7 }, 7],
      [{ quantity_grams: 250 }, 250],
      [{ quantity_ml: 30 }, 30],
      [{}, 0],
    ])('%o -> %s', (row, expected) => {
      expect(normalizeQuantity(row)).toBe(expected);
    });
  });

  describe('taxonomy consistency', () => {
    /** The family whose `match` substring an item type falls into, if any. */
    function familyFor(itemType) {
      return ITEM_TYPE_FAMILIES.find((f) => itemType.includes(f.match));
    }

    // The fastener regression, generalized: an item type that has an optimal
    // level but matches no family gets restock quantities computed while
    // never being checked for low stock.
    it('maps every item type with an optimal level to a monitored family', () => {
      const unmonitored = Object.keys(OPTIMAL_LEVELS).filter((t) => !familyFor(t));

      expect(unmonitored).toEqual([]);
    });

    it('covers all five item-type family prefixes', () => {
      const prefixes = new Set(Object.keys(OPTIMAL_LEVELS).map((t) => t.split('_')[0]));

      expect([...prefixes].sort()).toEqual(['electronic', 'fastener', 'filament', 'material', 'pcb']);
    });

    it('assigns each family a distinct threshold key', () => {
      const keys = ITEM_TYPE_FAMILIES.map((f) => f.thresholdKey);

      expect(new Set(keys).size).toBe(keys.length);
    });

    it('stores each family in a real inventory_items quantity column', () => {
      const columns = new Set(ITEM_TYPE_FAMILIES.map((f) => f.column));

      // There is no plain `quantity` column -- assuming one is exactly the
      // bug that silenced low-stock alerting (ISSUES_FOUND.md #84).
      expect([...columns].sort()).toEqual(['quantity_count', 'quantity_grams', 'quantity_ml']);
    });

    it('resolves each item type to exactly one family', () => {
      for (const itemType of Object.keys(OPTIMAL_LEVELS)) {
        const matches = ITEM_TYPE_FAMILIES.filter((f) => itemType.includes(f.match));
        expect(matches).toHaveLength(1);
      }
    });

    it('is frozen, so a caller cannot mutate shared state', () => {
      expect(Object.isFrozen(OPTIMAL_LEVELS)).toBe(true);
      expect(Object.isFrozen(ITEM_TYPE_FAMILIES)).toBe(true);
    });
  });

  describe('both workers resolve optimal levels through this module', () => {
    it('agree with each other and with the shared table', () => {
      jest.doMock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
      jest.doMock('../../workers/QueueManager', () =>
        jest.fn(() => ({ registerWorker: jest.fn(), updateHeartbeat: jest.fn(), enqueue: jest.fn() })),
      );
      jest.doMock('../../lib/structured-logger', () => ({
        child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
      }));

      const InventoryMaterialsWorker = require('../../workers/InventoryMaterialsWorker');
      const OpportunityDetectionWorker = require('../../workers/OpportunityDetectionWorker');

      const inventory = new InventoryMaterialsWorker('t1');
      const opportunity = new OpportunityDetectionWorker('t2');

      for (const [itemType, expected] of Object.entries(OPTIMAL_LEVELS)) {
        expect(inventory.getOptimalLevel(itemType)).toBe(expected);
        expect(opportunity.getOptimalLevel(itemType)).toBe(expected);
      }
    });
  });
});
