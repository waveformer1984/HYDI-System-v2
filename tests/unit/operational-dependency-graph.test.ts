/**
 * Phase 3 — Dependency Graph Tests
 *
 * Tests:
 * - Graph is derived from boot.config.json
 * - Infrastructure nodes (database, ollama, bridge) are included
 * - Dependencies and dependents are correctly computed
 * - Critical path is derived
 * - Recovery order respects dependencies
 */

import { DependencyGraphBuilder } from '../../lib/operational/DependencyGraphBuilder';
import path from 'path';

describe('Phase 3 — DependencyGraphBuilder', () => {
  const root = path.resolve(__dirname, '..', '..');
  let builder: DependencyGraphBuilder;
  let graph: ReturnType<DependencyGraphBuilder['build']>;

  beforeEach(() => {
    builder = new DependencyGraphBuilder(root);
    graph = builder.build();
  });

  it('builds a graph from boot.config.json', () => {
    expect(graph.nodes.size).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
  });

  it('includes infrastructure nodes', () => {
    expect(graph.nodes.has('database')).toBe(true);
    expect(graph.nodes.has('ollama')).toBe(true);
    expect(graph.nodes.has('bridge')).toBe(true);
  });

  it('includes boot.config.json modules', () => {
    expect(graph.nodes.has('protoforge-core')).toBe(true);
    expect(graph.nodes.has('heidi-web')).toBe(true);
  });

  it('computes dependents (reverse edges)', () => {
    const dbNode = graph.nodes.get('database');
    expect(dbNode).toBeDefined();
    expect(dbNode!.dependents).toContain('protoforge-core');
  });

  it('derives a critical path', () => {
    expect(graph.criticalPath.length).toBeGreaterThan(0);
    // Critical path should end with heidi-web
    expect(graph.criticalPath[graph.criticalPath.length - 1]).toBe('heidi-web');
    // Critical path should include database and protoforge-core
    expect(graph.criticalPath).toContain('database');
    expect(graph.criticalPath).toContain('protoforge-core');
  });

  it('assigns recovery order (dependencies before dependents)', () => {
    const dbOrder = graph.nodes.get('database')!.recoveryOrder;
    const pfOrder = graph.nodes.get('protoforge-core')!.recoveryOrder;
    const heidiOrder = graph.nodes.get('heidi-web')!.recoveryOrder;

    expect(dbOrder).toBeLessThan(pfOrder);
    expect(pfOrder).toBeLessThan(heidiOrder);
  });

  it('assigns criticality based on required flag', () => {
    const pfNode = graph.nodes.get('protoforge-core');
    expect(pfNode!.criticality).toBe('critical');
  });

  it('assigns recovery policy based on component type', () => {
    const dbNode = graph.nodes.get('database');
    expect(dbNode!.recoveryPolicy).toBe('wait_for_dependency');

    const pfNode = graph.nodes.get('protoforge-core');
    expect(pfNode!.recoveryPolicy).toBe('restart_process');
  });

  it('includes edges for all dependencies', () => {
    const dbEdges = graph.edges.filter((e) => e.from === 'database');
    expect(dbEdges.length).toBeGreaterThan(0);
    expect(dbEdges.some((e) => e.to === 'protoforge-core')).toBe(true);
  });
});
