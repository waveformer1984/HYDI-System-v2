import { buildPhotoForgeContext, buildPhotoForgeMessage, PhotoForgeState } from '../../lib/photo-forge-context';

describe('Photo Forge functional capability', () => {
  const stateA: PhotoForgeState = {
    image: 'portrait_001.png',
    tool: 'Crop',
    selection: '1024x768',
    lastAction: 'imported image',
  };

  const stateB: PhotoForgeState = {
    image: 'landscape_2048.png',
    tool: 'Rotate',
    selection: '2048x1024',
    lastAction: 'applied rotate',
  };

  test('buildPhotoForgeContext includes all state fields', () => {
    const context = buildPhotoForgeContext(stateA);
    expect(context).toContain('Image: portrait_001.png');
    expect(context).toContain('Tool: Crop');
    expect(context).toContain('Selection: 1024x768');
    expect(context).toContain('Last action: imported image');
  });

  test('context changes when workspace state changes', () => {
    const contextA = buildPhotoForgeContext(stateA);
    const contextB = buildPhotoForgeContext(stateB);
    expect(contextA).not.toBe(contextB);
    expect(contextA).toContain('portrait_001.png');
    expect(contextB).toContain('landscape_2048.png');
    expect(contextB).toContain('Rotate');
    expect(contextB).toContain('2048x1024');
  });

  test('message wraps the user question with current context', () => {
    const message = buildPhotoForgeMessage(stateB, 'What am I working on?');
    expect(message).toContain('[Photo Forge Context]');
    expect(message).toContain('[/Photo Forge Context]');
    expect(message).toContain('User question: What am I working on?');
    expect(message).toContain('landscape_2048.png');
    expect(message).toContain('Rotate');
  });

  test('boundary state with missing fields omits those lines', () => {
    const context = buildPhotoForgeContext({});
    expect(context).toContain('[Photo Forge Context]');
    expect(context).toContain('Workspace: Photo Forge');
    expect(context).not.toContain('Image:');
    expect(context).not.toContain('Tool:');
    expect(context).not.toContain('Selection:');
    expect(context).not.toContain('Last action:');
  });
});
