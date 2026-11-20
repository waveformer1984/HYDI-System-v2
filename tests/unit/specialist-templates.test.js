'use strict';

const { validateAllTemplates, cloneMayUseCapability, assertNotCloneForbidden } = require('../../lib/dev-workforce/templates');

describe('specialist templates', () => {
  it('validates config/specialists.json', () => {
    const v = validateAllTemplates();
    expect(v.ok).toBe(true);
    expect(Object.keys(v.config.templates)).toEqual(
      expect.arrayContaining(['scout', 'researcher', 'verifier', 'writer', 'prompter']),
    );
  });

  it('rejects exec capabilities on templates', () => {
    const r = cloneMayUseCapability('scout', 'evolution.execute');
    expect(r.ok).toBe(false);
  });

  it('blocks clone spawn capabilities', () => {
    expect(assertNotCloneForbidden('pool.spawn_clone').ok).toBe(false);
  });
});