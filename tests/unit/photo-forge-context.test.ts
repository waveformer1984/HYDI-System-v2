import { buildPhotoForgeContext, buildPhotoForgeMessage } from '../../lib/photo-forge-context';

describe('Photo Forge context construction', () => {
  it('builds a deterministic context block from state', () => {
    const context = buildPhotoForgeContext({
      image: 'portrait_001.png',
      tool: 'Crop',
      selection: '1024×768',
      lastAction: 'imported image',
    });

    expect(context).toContain('Workspace: Photo Forge');
    expect(context).toContain('Image: portrait_001.png');
    expect(context).toContain('Tool: Crop');
    expect(context).toContain('Selection: 1024×768');
    expect(context).toContain('Last action: imported image');
    expect(context).toContain('[/Photo Forge Context]');
  });

  it('omits undefined fields', () => {
    const context = buildPhotoForgeContext({
      image: 'landscape_002.png',
      tool: 'Resize',
    });

    expect(context).toContain('Image: landscape_002.png');
    expect(context).toContain('Tool: Resize');
    expect(context).not.toContain('Selection:');
    expect(context).not.toContain('Last action:');
  });

  it('wraps the user question with context', () => {
    const message = buildPhotoForgeMessage(
      {
        image: 'portrait_001.png',
        tool: 'Crop',
        selection: '1024×768',
      },
      'How should I crop this for an album cover?'
    );

    expect(message).toContain('[Photo Forge Context]');
    expect(message).toContain('User question: How should I crop this for an album cover?');
    expect(message.indexOf('[/Photo Forge Context]')).toBeLessThan(
      message.indexOf('User question:')
    );
  });
});
