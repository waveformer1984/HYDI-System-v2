/**
 * Causal correlation over the dependency graph.
 *
 * The difference between an operational intelligence and a notification
 * firehose:
 *
 *   database → api → frontend → mobile
 *
 * When the database goes down, four things fail. Reporting four failures is
 * noise. Reporting "root cause: database; three downstream services degraded
 * as a consequence" is the thing that lets a human act.
 *
 * The constraint is not perception — HYDI can already see all four. It is
 * SUPPRESSION, and suppression requires a dependency graph maintained as
 * data. Contracts already declare `dependencies`, so most of the graph can be
 * derived from the registry rather than hand-maintained; infrastructure edges
 * (a service depending on a database) are declared explicitly.
 */

export interface DependencyEdge {
  /** The dependent component. */
  from: string;
  /** What it depends on. Failure here propagates to `from`. */
  to: string;
  /**
   * `hard` — `from` cannot function without `to`.
   * `soft` — `from` degrades but continues.
   */
  kind: 'hard' | 'soft';
  description: string;
}

export interface ComponentFailure {
  component: string;
  /** When it was first observed failing. Ordering matters for causality. */
  observedAt: string;
  symptom: string;
  severity: 'down' | 'degraded';
}

export interface RootCause {
  component: string;
  symptom: string;
  observedAt: string;
  /** Components whose failure this explains. */
  explains: ExplainedConsequence[];
  confidence: number;
  reasoning: string;
}

export interface ExplainedConsequence {
  component: string;
  /** The dependency path from the consequence back to the root cause. */
  path: string[];
  kind: 'hard' | 'soft';
}

export interface CorrelationResult {
  rootCauses: RootCause[];
  /** Failures that no root cause explains — genuinely independent problems. */
  unexplained: ComponentFailure[];
  /** How many raw alerts collapsed into how many root causes. */
  suppression: { rawFailures: number; reportedCauses: number };
  summary: string;
}

export class CausalCorrelator {
  private readonly edges: DependencyEdge[] = [];

  addEdge(edge: DependencyEdge): void {
    this.edges.push(edge);
  }

  addEdges(edges: DependencyEdge[]): void {
    for (const edge of edges) this.addEdge(edge);
  }

  /**
   * Derive edges from capability contracts: a capability that depends on
   * another inherits its provider's dependency. Coarse, but it keeps the
   * graph honest without a second source of truth to drift.
   */
  addFromContracts(
    contracts: Array<{ identity: { id: string; provider: string }; dependencies: string[] }>,
  ): void {
    const providerOf = new Map<string, string>();
    for (const contract of contracts) {
      providerOf.set(contract.identity.id, contract.identity.provider);
    }
    for (const contract of contracts) {
      for (const dependency of contract.dependencies) {
        const from = contract.identity.provider;
        const to = providerOf.get(dependency);
        if (!to || to === from) continue;
        if (this.edges.some((e) => e.from === from && e.to === to)) continue;
        this.addEdge({
          from,
          to,
          kind: 'hard',
          description: `${contract.identity.id} depends on ${dependency}`,
        });
      }
    }
  }

  /** Everything `component` transitively depends on. */
  dependenciesOf(component: string): string[] {
    const seen = new Set<string>();
    const stack = [component];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const edge of this.edges) {
        if (edge.from !== current || seen.has(edge.to)) continue;
        seen.add(edge.to);
        stack.push(edge.to);
      }
    }
    return Array.from(seen);
  }

  /** The dependency path from `component` down to `target`, if one exists. */
  pathTo(component: string, target: string): string[] | null {
    const queue: string[][] = [[component]];
    const visited = new Set<string>([component]);
    while (queue.length > 0) {
      const path = queue.shift()!;
      const tail = path[path.length - 1];
      if (tail === target) return path;
      for (const edge of this.edges) {
        if (edge.from !== tail || visited.has(edge.to)) continue;
        visited.add(edge.to);
        queue.push(path.concat([edge.to]));
      }
    }
    return null;
  }

  /**
   * Collapse a set of concurrent failures into root causes plus explained
   * consequences.
   */
  correlate(failures: ComponentFailure[]): CorrelationResult {
    const failed = new Map<string, ComponentFailure>();
    for (const failure of failures) {
      const existing = failed.get(failure.component);
      // Keep the earliest observation of each component.
      if (!existing || failure.observedAt < existing.observedAt) {
        failed.set(failure.component, failure);
      }
    }

    const components = Array.from(failed.keys());

    // A failure is a consequence if anything it transitively depends on is
    // also failing. Whatever is left is a root cause.
    const explainedBy = new Map<string, string>();
    for (const component of components) {
      const deps = this.dependenciesOf(component);
      const failingDeps = deps.filter((d) => failed.has(d));
      if (failingDeps.length === 0) continue;

      // Attribute to the DEEPEST failing dependency — the one with no failing
      // dependencies of its own. That is the actual root, not the nearest hop.
      const deepest = failingDeps.filter(
        (d) => this.dependenciesOf(d).filter((x) => failed.has(x)).length === 0,
      );
      const attribution = deepest.length > 0 ? deepest[0] : failingDeps[0];
      explainedBy.set(component, attribution);
    }

    const rootCauses: RootCause[] = [];
    for (const component of components) {
      if (explainedBy.has(component)) continue;
      const failure = failed.get(component)!;

      const explains: ExplainedConsequence[] = [];
      for (const other of components) {
        if (explainedBy.get(other) !== component) continue;
        const path = this.pathTo(other, component);
        if (!path) continue;
        const edge = this.edges.find(
          (e) => e.from === path[0] && e.to === path[1],
        );
        explains.push({ component: other, path, kind: edge ? edge.kind : 'hard' });
      }

      // A root cause that explains downstream failures AND was observed first
      // is a confident attribution. One that explains nothing is just a
      // standalone failure.
      const observedFirst = explains.every(
        (c) => failed.get(c.component)!.observedAt >= failure.observedAt,
      );
      const confidence =
        explains.length === 0 ? 0.5 : observedFirst ? 0.9 : 0.6;

      rootCauses.push({
        component,
        symptom: failure.symptom,
        observedAt: failure.observedAt,
        explains,
        confidence,
        reasoning:
          explains.length === 0
            ? `${component} failed and nothing it depends on is failing.`
            : `${component} failed at ${failure.observedAt}; ` +
              `${explains.length} downstream component(s) depend on it` +
              (observedFirst ? ' and failed after it.' : ' but some failed before it — ordering is inconsistent.'),
      });
    }

    rootCauses.sort((a, b) => b.explains.length - a.explains.length);

    const unexplained = components
      .filter((c) => !explainedBy.has(c) && !rootCauses.some((r) => r.component === c))
      .map((c) => failed.get(c)!);

    return {
      rootCauses,
      unexplained,
      suppression: { rawFailures: components.length, reportedCauses: rootCauses.length },
      summary: buildSummary(rootCauses, components.length),
    };
  }
}

function buildSummary(rootCauses: RootCause[], rawFailures: number): string {
  if (rootCauses.length === 0) return 'No failures.';

  const primary = rootCauses[0];
  if (primary.explains.length === 0) {
    return rootCauses.length === 1
      ? `${primary.component} failed: ${primary.symptom}.`
      : `${rootCauses.length} independent failures, none explaining the others.`;
  }

  const downstream = primary.explains.map((c) => c.component).join(', ');
  const others =
    rootCauses.length > 1
      ? ` ${rootCauses.length - 1} further unrelated failure(s).`
      : '';

  return (
    `Root cause appears to be ${primary.component} (${primary.symptom}). ` +
    `${primary.explains.length} downstream service(s) degraded as a consequence: ${downstream}. ` +
    `${rawFailures} raw alerts collapsed to ${rootCauses.length}.${others}`
  );
}
