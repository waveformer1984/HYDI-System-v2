'use strict';

const execFileMock = jest.fn();

jest.doMock('child_process', () => ({
  execFile: execFileMock,
}));

// HardwareDiscovery's OS-level fallback branches on the real host platform
// (win32/linux/darwin). Force it to 'win32' here so the Windows-fallback
// test below is deterministic on every CI runner, not just Windows ones.
jest.doMock('os', () => ({
  ...jest.requireActual('os'),
  platform: () => 'win32',
}));

const HardwareDiscovery = require('../../../src/hydi-v3/HardwareDiscovery');

describe('HardwareDiscovery', () => {
  let discovery;

  beforeEach(() => {
    execFileMock.mockReset();
    discovery = new HardwareDiscovery({ timeoutMs: 5000 });
  });

  function callbackFromArgs(args) {
    // execFile may be called without options; the callback is the last argument.
    return typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
  }

  test('detects NVIDIA GPUs from nvidia-smi output', async () => {
    const nvidiaSmiHeader = 'NVIDIA-SMI 535.104.05              Driver Version: 535.104.05   CUDA Version: 12.2';
    const nvidiaSmiQuery = '0, NVIDIA GeForce RTX 4090, 24564, 22000, 2564, 15, 10, 65, 45, P0, 220.5, 450.0, 4, 16, 8.9';

    execFileMock.mockImplementation(function () {
      const cb = callbackFromArgs(arguments);
      // detect() calls detectNvidia (query) first, then getNvidiaSmiHeader (no args).
      const stdout = execFileMock.mock.calls.length === 1 ? nvidiaSmiQuery : nvidiaSmiHeader;
      if (cb) cb(null, { stdout }, { stderr: '' });
    });

    const inventory = await discovery.detect();

    expect(inventory.cudaAvailable).toBe(true);
    expect(inventory.gpus.length).toBeGreaterThan(0);
    const gpu = inventory.gpus[0];
    expect(gpu.name).toBe('NVIDIA GeForce RTX 4090');
    expect(gpu.vendor).toBe('NVIDIA');
    expect(gpu.cudaCapable).toBe(true);
    expect(gpu.vramBytes).toBe(24564 * 1024 * 1024);
    expect(gpu.hasTensorCores).toBe(true);
    expect(gpu.supportsBf16).toBe(true);
    expect(gpu.supportsFp16).toBe(true);
    expect(gpu.computeCapability).toBe('8.9');
  });

  test('falls back to OS enumeration when nvidia-smi is missing', async () => {
    execFileMock.mockImplementation(function () {
      const cmd = arguments[0];
      const cb = callbackFromArgs(arguments);
      if (!cb) return;
      if (String(cmd).includes('nvidia-smi')) {
        cb(new Error('not found'), { stdout: '' }, { stderr: 'not found' });
        return;
      }
      if (cmd === 'powershell') {
        cb(null, { stdout: JSON.stringify({ Name: 'Intel Iris Xe Graphics', AdapterRAM: 2147479552, DriverVersion: '32.0.101.6874', Status: 'OK' }) }, { stderr: '' });
        return;
      }
      cb(new Error('unexpected'), { stdout: '' }, { stderr: '' });
    });

    const inventory = await discovery.detect();
    expect(inventory.cudaAvailable).toBe(false);
    expect(inventory.gpus.length).toBe(1);
    expect(inventory.gpus[0].vendor).toBe('Intel');
    expect(inventory.gpus[0].cudaCapable).toBe(false);
  });

  test('detect returns an object with required fields', async () => {
    execFileMock.mockImplementation(function () {
      const cb = callbackFromArgs(arguments);
      if (cb) cb(new Error('nvidia-smi not found'), { stdout: '' }, { stderr: '' });
    });
    const inventory = await discovery.detect();
    expect(inventory).toHaveProperty('timestamp');
    expect(inventory).toHaveProperty('cudaAvailable');
    expect(inventory).toHaveProperty('driverVersion');
    expect(inventory).toHaveProperty('cudaVersion');
    expect(inventory).toHaveProperty('gpus');
    expect(Array.isArray(inventory.gpus)).toBe(true);
  });
});
