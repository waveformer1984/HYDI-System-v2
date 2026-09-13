/**
 * Decision records — captured at decision time.
 *
 * The question HYDI is supposed to be able to answer six months later is:
 *
 *   "Why did we abandon that approach?"
 *
 * No retrieval system recovers that from code, git history and STL files,
 * because the rationale was never written down. It existed in someone's head
 * for about four minutes.
 *
 * So the memory layer's real requirement is not a smarter reader. It is a
 * WRITE DISCIPLINE: when a choice with tradeoffs is made, the alternatives
 * and the reason get written down as a side effect of making it.
 *
 * src/hydi-v3/DecisionJournal.js already has the right shape (inputs,
 * selected, rejected, rationale) but holds everything in a process-local
 * array — it dies with the daemon. This recorder is durable, append-only,
 * and indexed by subject so a later question can actually find it.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export type DecisionKind =
  | 'architecture'
  | 'capability_authorization'
  | 'plan_selection'
  | 'repair_strategy'
  | 'abandonment'
  | 'tradeoff'
  | 'escalation';

export interface Alternative {
  /** Short label, e.g. "v3 thermal design". */
  label: string;
  /** Why it was considered. */
  summary: string;
  /** What killed it, or what it cost. Empty for the selected option. */
  rejectedBecause: string;
  /** Measured evidence, where it exists. This is what makes recall credible. */
  evidence: string[];
}

export interface DecisionRecord {
  id: string;
  at: string;
  kind: DecisionKind;
  /** What the decision was about, e.g. "protoforge.bracket-mount" or a capability id. */
  subject: string;
  /** The question being decided, in one sentence. */
  question: string;
  /** Every option that was genuinely on the table. */
  alternatives: Alternative[];
  /** Label of the chosen alternative. */
  selected: string;
  /** Why, in the decider's own terms. */
  rationale: string;
  /** What would have to change for this to be revisited. */
  revisitIf: string;
  decidedBy: string;
  /** 0-1. Low confidence decisions are the ones worth re-reading later. */
  confidence: number;
  /** Related subjects, capability ids, goal ids, file paths. */
  links: string[];
  metadata: Record<string, unknown>;
}

export interface DecisionRecorderOptions {
  /** Directory for the append-only log. Defaults to `<cwd>/.hydi-operational`. */
  directory?: string;
  fileName?: string;
  /** Set false in tests to keep everything in memory. */
  persist?: boolean;
}

export class DecisionRecorder {
  private readonly filePath: string;
  private readonly persist: boolean;
  private readonly records: DecisionRecord[] = [];
  private readonly bySubject = new Map<string, string[]>();
  private loaded = false;

  constructor(options: DecisionRecorderOptions = {}) {
    const dir = options.directory ?? path.join(process.cwd(), '.hydi-operational');
    this.filePath = path.join(dir, options.fileName ?? 'decision-records.jsonl');
    this.persist = options.persist !== false;
  }

  /**
   * Record a decision. Called AT the moment of decision, not afterwards.
   *
   * Throws when the record would be uninformative — a decision record with no
   * alternatives is a log line pretending to be reasoning.
   */
  record(input: Omit<DecisionRecord, 'id' | 'at'> & Partial<Pick<DecisionRecord, 'id' | 'at'>>): DecisionRecord {
    if (input.alternatives.length < 2) {
      throw new Error(
        `Decision record for "${input.subject}" lists ${input.alternatives.length} alternative(s). ` +
          'A decision with one option is not a decision; record it as an event instead.',
      );
    }
    if (!input.alternatives.some((a) => a.label === input.selected)) {
      throw new Error(
        `Selected option "${input.selected}" is not among the alternatives for "${input.subject}".`,
      );
    }
    if (!input.rationale.trim()) {
      throw new Error(
        `Decision record for "${input.subject}" has no rationale. The rationale is the entire point.`,
      );
    }

    const record: DecisionRecord = {
      id: input.id ?? `dr-${randomUUID()}`,
      at: input.at ?? new Date().toISOString(),
      kind: input.kind,
      subject: input.subject,
      question: input.question,
      alternatives: input.alternatives,
      selected: input.selected,
      rationale: input.rationale,
      revisitIf: input.revisitIf,
      decidedBy: input.decidedBy,
      confidence: input.confidence,
      links: input.links,
      metadata: input.metadata,
    };

    this.records.push(record);
    const existing = this.bySubject.get(record.subject) ?? [];
    existing.push(record.id);
    this.bySubject.set(record.subject, existing);

    if (this.persist) {
      this.append(record);
    }
    return record;
  }

  /**
   * Answer "why did we do it this way?" for a subject, newest first.
   */
  recall(subject: string): DecisionRecord[] {
    this.ensureLoaded();
    return this.records
      .filter((r) => r.subject === subject || r.links.indexOf(subject) !== -1)
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  /**
   * Free-text search across question, rationale and rejection reasons.
   */
  search(query: string): DecisionRecord[] {
    this.ensureLoaded();
    const needle = query.toLowerCase();
    return this.records.filter((r) => {
      if (r.question.toLowerCase().indexOf(needle) !== -1) return true;
      if (r.rationale.toLowerCase().indexOf(needle) !== -1) return true;
      if (r.subject.toLowerCase().indexOf(needle) !== -1) return true;
      return r.alternatives.some(
        (a) =>
          a.label.toLowerCase().indexOf(needle) !== -1 ||
          a.rejectedBecause.toLowerCase().indexOf(needle) !== -1,
      );
    });
  }

  /**
   * Decisions worth revisiting: low confidence, or whose revisit condition
   * names something in `changed`.
   */
  needsRevisit(changed: string[], confidenceBelow = 0.5): DecisionRecord[] {
    this.ensureLoaded();
    return this.records.filter((r) => {
      if (r.confidence < confidenceBelow) return true;
      const revisit = r.revisitIf.toLowerCase();
      return changed.some((c) => revisit.indexOf(c.toLowerCase()) !== -1);
    });
  }

  all(): DecisionRecord[] {
    this.ensureLoaded();
    return this.records.slice();
  }

  // -------------------------------------------------------------------------

  private append(record: DecisionRecord): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, JSON.stringify(record) + '\n', 'utf8');
    } catch {
      // A failed write must not take down the decision it was recording, but
      // it must not be silent either — the caller loses durability and should
      // know. stderr is the only channel guaranteed to exist here.
      process.stderr.write(
        `[DecisionRecorder] failed to persist ${record.id} to ${this.filePath}\n`,
      );
    }
  }

  private ensureLoaded(): void {
    if (this.loaded || !this.persist) {
      this.loaded = true;
      return;
    }
    this.loaded = true;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const known = new Set(this.records.map((r) => r.id));
      const lines = fs.readFileSync(this.filePath, 'utf8').split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as DecisionRecord;
          if (known.has(parsed.id)) continue;
          this.records.push(parsed);
          const existing = this.bySubject.get(parsed.subject) ?? [];
          existing.push(parsed.id);
          this.bySubject.set(parsed.subject, existing);
        } catch {
          // Skip a corrupt line rather than losing the whole history.
        }
      }
    } catch {
      // Unreadable log: recall degrades to this process's own records.
    }
  }
}
