const { buildPhotoForgeMessage } = require('../../lib/photo-forge-context');
const { HeidiOrchestrator } = require('../../lib/orchestrator');

describe('Heidi semantic grounding', () => {
  const baseEnv = { ...process.env };

  beforeEach(() => {
    process.env.LOCAL_MODEL_PROVIDER = 'mock';
    process.env.LOCAL_MODEL_NAME = 'mock-grounding';
    process.env.ANTHROPIC_API_KEY = '';
    process.env.OPENAI_API_KEY = '';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_local';
  });

  afterEach(() => {
    process.env = { ...baseEnv };
  });

  it('identifies the current tool from Photo Forge state', async () => {
    const message = buildPhotoForgeMessage(
      { image: 'portrait_001.png', tool: 'Crop', selection: '1024x768', lastAction: 'imported image' },
      'What tool am I currently using?'
    );

    const orchestrator = new HeidiOrchestrator();
    const result = await orchestrator.processChat({
      message,
      session_id: 'phase7-tool',
      user_id: 'test-user',
    });

    expect(result.model_used).toBe('local-mock');
    expect(result.response).toContain('Crop');
    expect(result.response).not.toContain('Rotate');
  });

  it('identifies the current image', async () => {
    const message = buildPhotoForgeMessage(
      { image: 'portrait_001.png', tool: 'Crop', selection: '1024x768' },
      'What image am I currently working on?'
    );

    const orchestrator = new HeidiOrchestrator();
    const result = await orchestrator.processChat({
      message,
      session_id: 'phase7-image',
      user_id: 'test-user',
    });

    expect(result.model_used).toBe('local-mock');
    expect(result.response).toContain('portrait_001.png');
  });

  it('identifies the current selection', async () => {
    const message = buildPhotoForgeMessage(
      { image: 'portrait_001.png', tool: 'Crop', selection: '1024x768' },
      'What is the active selection?'
    );

    const orchestrator = new HeidiOrchestrator();
    const result = await orchestrator.processChat({
      message,
      session_id: 'phase7-selection',
      user_id: 'test-user',
    });

    expect(result.model_used).toBe('local-mock');
    expect(result.response).toContain('1024x768');
  });

  it('updates grounding when state mutates', async () => {
    const stateA = buildPhotoForgeMessage(
      { image: 'portrait_001.png', tool: 'Crop', selection: '1024x768' },
      'What tool am I using?'
    );
    const stateB = buildPhotoForgeMessage(
      { image: 'landscape_2048.png', tool: 'Rotate', selection: '2048x1024' },
      'What tool am I using?'
    );

    const orchestrator = new HeidiOrchestrator();

    const resultA = await orchestrator.processChat({
      message: stateA,
      session_id: 'phase7-mutation',
      user_id: 'test-user',
    });
    const resultB = await orchestrator.processChat({
      message: stateB,
      session_id: 'phase7-mutation',
      user_id: 'test-user',
    });

    expect(resultA.response).toContain('Crop');
    expect(resultB.response).toContain('Rotate');
    expect(resultB.response).not.toContain('Crop');
  });

  it('does not invent an unknown image', async () => {
    const message = buildPhotoForgeMessage(
      { tool: 'Crop' },
      'What image am I working on?'
    );

    const orchestrator = new HeidiOrchestrator();
    const result = await orchestrator.processChat({
      message,
      session_id: 'phase7-unknown',
      user_id: 'test-user',
    });

    expect(result.response.toLowerCase()).toContain('no image');
    expect(result.response).not.toContain('portrait');
    expect(result.response).not.toContain('landscape');
  });

  it('does not return a generic safe fallback', async () => {
    const message = buildPhotoForgeMessage(
      { image: 'portrait_001.png', tool: 'Crop', selection: '1024x768' },
      'What tool am I currently using?'
    );

    const orchestrator = new HeidiOrchestrator();
    const result = await orchestrator.processChat({
      message,
      session_id: 'phase7-not-fallback',
      user_id: 'test-user',
    });

    expect(result.response).not.toContain('I apologize, but I\'m having trouble');
  });
});
