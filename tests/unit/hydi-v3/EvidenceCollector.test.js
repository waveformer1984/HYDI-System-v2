'use strict';

const BusinessEventBus = require('../../../src/hydi-v3/BusinessEventBus');
const EvidenceCollector = require('../../../src/hydi-v3/EvidenceCollector');
const { EvidenceProviders } = require('../../../src/hydi-v3/EvidenceProviders');

describe('EvidenceCollector', () => {
  it('collects evidence from the event bus through providers', () => {
    const bus = new BusinessEventBus();
    const providers = new EvidenceProviders().registerDefaults();
    const collector = new EvidenceCollector({ eventBus: bus, evidenceProviders: providers });
    collector.start();
    bus.emit('CommitCreated', { sha: 'abc' }, 'git');
    bus.emit('PrinterCompleted', { id: 'p1' }, 'manufacturing');
    expect(collector.evidence.length).toBe(2);
    expect(collector.evidence.some((e) => e.source === 'git')).toBe(true);
    expect(collector.evidence.some((e) => e.source === 'manufacturing')).toBe(true);
    collector.destroy();
    bus.destroy();
  });

  it('attaches manual evidence to a recommendation', () => {
    const collector = new EvidenceCollector({});
    collector.start();
    const item = collector.addEvidence('rec_1', { source: 'manual', data: { answer: 'yes' } });
    expect(item.attachedTo).toBe('rec_1');
    const forRec = collector.getEvidence('rec_1');
    expect(forRec.length).toBe(1);
    collector.destroy();
  });

  it('finds related evidence for a recommendation by objective and tags', () => {
    const collector = new EvidenceCollector({});
    collector.start();
    collector._add({
      id: 'e1', source: 'git', type: 'CommitCreated', at: Date.now(),
      weight: 1, confidence: 1, relevance: 1, data: { value: 1 }, tags: ['resonate'],
    });
    const rec = { id: 'r1', strategicObjective: 'resonate', supportingSignals: ['signal'], createdAt: Date.now() - 1000 };
    const related = collector.findForRecommendation(rec, { windowMs: 10000 });
    expect(related.length).toBe(1);
    expect(related[0].id).toBe('e1');
    collector.destroy();
  });

  it('returns recommendations awaiting review', () => {
    const collector = new EvidenceCollector({});
    collector.start();
    collector.addEvidence('r1', { source: 'git', data: { value: 1 } });
    const recommendations = [
      { id: 'r1', observedOutcome: null },
      { id: 'r2', observedOutcome: null },
    ];
    const awaiting = collector.getRecommendationsAwaitingReview(recommendations);
    expect(awaiting.length).toBe(1);
    expect(awaiting[0].id).toBe('r1');
    collector.destroy();
  });

  it('cleans up listeners on destroy', () => {
    const bus = new BusinessEventBus();
    const collector = new EvidenceCollector({ eventBus: bus, evidenceProviders: new EvidenceProviders().registerDefaults() });
    collector.start();
    collector.destroy();
    expect(collector._destroyed).toBe(true);
    bus.destroy();
  });
});
