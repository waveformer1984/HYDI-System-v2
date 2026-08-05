'use strict';

/**
 * The single definition of the inventory item-type taxonomy.
 *
 * `InventoryMaterialsWorker` and `OpportunityDetectionWorker` each carried a
 * byte-identical private copy of `optimalLevels`, and that duplication is
 * directly implicated in ISSUES_FOUND.md #86: both copies listed the three
 * `fastener_*` types, but the low-stock threshold chain — which lived only in
 * the inventory worker, itself in two drifted copies — had no `fastener`
 * branch. Screws, nuts and bolts therefore had optimal levels defined and
 * restock quantities computed, while never being evaluated for low stock at
 * all. Nothing forced the two lists to agree, so nothing surfaced the gap.
 *
 * Adding an item type means adding it here, once. `ITEM_TYPE_FAMILIES` names
 * the five families explicitly so the set is reviewable rather than implied
 * by substring matching scattered across call sites.
 */

/**
 * Target stock level per item type, in that type's own unit
 * (grams for filament, ml for materials, count for everything else).
 */
const OPTIMAL_LEVELS = Object.freeze({
  filament_pla: 1000, // grams
  filament_abs: 1000, // grams
  filament_petg: 1000, // grams
  electronic_resistor: 100, // count
  electronic_capacitor: 100, // count
  electronic_ic: 50, // count
  pcb_prototype: 20, // count
  pcb_production: 50, // count
  material_solder_paste: 200, // ml
  material_isopropyl_alcohol: 500, // ml
  material_thermal_paste: 100, // ml
  fastener_screw: 200, // count
  fastener_nut: 200, // count
  fastener_bolt: 100, // count
});

/** Fallback target for an item type not listed above. */
const DEFAULT_OPTIMAL_LEVEL = 50;

/**
 * The item-type families, in the order the low-stock threshold chain tests
 * them. Each entry maps the substring matched against `item_type` to the
 * quantity column that family is stored in and the threshold key that
 * governs it.
 *
 * `component` is currently unreachable — no item type above contains it —
 * and is kept deliberately: removing it would let a future `component_*`
 * family fall through unmonitored, which is exactly how the fastener gap
 * went unnoticed.
 */
const ITEM_TYPE_FAMILIES = Object.freeze([
  Object.freeze({ match: 'filament', column: 'quantity_grams', thresholdKey: 'filament_grams' }),
  Object.freeze({ match: 'component', column: 'quantity_count', thresholdKey: 'components_count' }),
  Object.freeze({ match: 'material', column: 'quantity_ml', thresholdKey: 'material_ml' }),
  Object.freeze({ match: 'pcb', column: 'quantity_count', thresholdKey: 'pcb_boards' }),
  Object.freeze({ match: 'electronic', column: 'quantity_count', thresholdKey: 'electronic_components' }),
  Object.freeze({ match: 'fastener', column: 'quantity_count', thresholdKey: 'fasteners_count' }),
]);

/**
 * Target stock level for an item type.
 *
 * @param {string} itemType
 * @returns {number}
 */
function getOptimalLevel(itemType) {
  return OPTIMAL_LEVELS[itemType] || DEFAULT_OPTIMAL_LEVEL;
}

/**
 * Collapse an `inventory_items` row's per-unit quantity columns to a single
 * number. Rows carry exactly one of `quantity_count`/`quantity_grams`/
 * `quantity_ml` depending on family; there is no plain `quantity` column.
 *
 * @param {object} item an inventory_items row
 * @returns {number} the item's quantity in its own unit, 0 if unknown
 */
function normalizeQuantity(item) {
  return item.quantity_count || item.quantity_grams || item.quantity_ml || 0;
}

module.exports = {
  OPTIMAL_LEVELS,
  DEFAULT_OPTIMAL_LEVEL,
  ITEM_TYPE_FAMILIES,
  getOptimalLevel,
  normalizeQuantity,
};
