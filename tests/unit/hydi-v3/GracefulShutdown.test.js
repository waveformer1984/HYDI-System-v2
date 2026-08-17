const GracefulShutdown = require('../../../src/hydi-v3/GracefulShutdown');

describe('GracefulShutdown', () => {
  let gs;

  beforeEach(() => {
    gs = new GracefulShutdown({ flushTimeoutMs: 100 });
  });

  afterEach(() => {
    gs.destroy();
  });

  test('runs handlers in priority order', async () => {
    const order = [];
    gs.addHandler(async () => { order.push(2); }, 2);
    gs.addHandler(async () => { order.push(1); }, 1);
    await gs.shutdown(0, 'test');
    expect(order).toEqual([1, 2]);
  });

  test('skips duplicate shutdown', async () => {
    let count = 0;
    gs.addHandler(async () => { count++; });
    await gs.shutdown(0, 'test');
    await gs.shutdown(0, 'test');
    expect(count).toBe(1);
  });

  test('emits shutdown_completed', async () => {
    const cb = jest.fn();
    gs.on('shutdown_completed', cb);
    await gs.shutdown(0, 'test');
    expect(cb).toHaveBeenCalled();
  });
});
