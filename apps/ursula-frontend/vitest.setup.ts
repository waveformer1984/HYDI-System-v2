import '@testing-library/jest-dom/vitest';

// jsdom has no canvas implementation — HTMLCanvasElement.getContext returns
// null, which makes canvas components bail out of their effects. Return the
// minimal 2D surface they actually call instead of shipping a canvas package.
if (typeof HTMLCanvasElement !== 'undefined') {
  const context2d = {
    fillStyle: '' as unknown,
    globalAlpha: 1,
    fillRect: () => undefined,
    beginPath: () => undefined,
    arc: () => undefined,
    fill: () => undefined,
    createRadialGradient: () => ({ addColorStop: () => undefined }),
  };
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return context2d;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
