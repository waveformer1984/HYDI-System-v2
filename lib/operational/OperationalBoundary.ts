/**
 * Operational Boundary
 *
 * Provides the go-live timestamp that separates test/qualification data
 * from real production data. All operational detectors (revenue
 * reconciliation, failed webhook, stuck job) respect this boundary:
 * any record created before the go_live_at timestamp is excluded from
 * detection cycles.
 *
 * This prevents test data from qualification runs from polluting
 * operational detector findings. When the system actually goes live,
 * update the go_live_at timestamp in the operational_boundary table.
 *
 * Until go-live, the boundary defaults to 'now' — meaning all existing
 * data is treated as pre-go-live (test) data.
 */

export interface BoundaryResult {
  /** The go-live timestamp. Records created before this are excluded. */
  goLiveAt: string | null;
  /** Whether a boundary was found. If false, no filtering is applied. */
  hasBoundary: boolean;
}

/**
 * Get the current operational boundary (go-live timestamp).
 * Returns null if no boundary is set (in which case no filtering should
 * be applied — but the table should always have a default row).
 */
export async function getOperationalBoundary(supabase: any): Promise<BoundaryResult> {
  if (!supabase) {
    return { goLiveAt: null, hasBoundary: false };
  }
  try {
    const { data, error } = await supabase
      .from('operational_boundary')
      .select('go_live_at')
      .eq('id', 1)
      .single();
    if (error || !data) {
      return { goLiveAt: null, hasBoundary: false };
    }
    return { goLiveAt: data.go_live_at, hasBoundary: true };
  } catch {
    return { goLiveAt: null, hasBoundary: false };
  }
}

/**
 * Check whether a timestamp is before the go-live boundary.
 * Returns true if the timestamp is before the boundary (i.e., test data
 * that should be excluded). Returns false if the timestamp is at or after
 * the boundary, or if no boundary is set.
 */
export function isBeforeBoundary(
  timestamp: string,
  boundary: BoundaryResult
): boolean {
  if (!boundary.hasBoundary || !boundary.goLiveAt) {
    return false;
  }
  return new Date(timestamp).getTime() < new Date(boundary.goLiveAt).getTime();
}
