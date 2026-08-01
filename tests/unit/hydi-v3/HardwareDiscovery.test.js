'use strict';

const execFileMock = jest.fn();

jest.doMock('child_process', () => ({
  execFile: execFileMock,
}));

// detectOsGpus() branches on the *host* OS at runtime (lspci on linux,
// powershell on win32, system_profiler on darwin). Pin it to win32 so this
// suite's Windows-flavored mock (below) exercises a deterministic branch
// regardless of which OS actually runs the test — without this, the
// fallback test silently exercised the "unexpected command" branch on
// Linux CI runners and asserted on a GPU list that was never populated.
jest.doMock('os', () => ({
  ...jest.requireActual('os'),
  platform: () => 'win32',
}));

const HardwareDiscovery = require('../../../src/hydi-v3/HardwareDiscovery');

function callbackFromArgs(args) {
  // execFile may be called without options; the callback is the last argument.
  return typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
}

describe('HardwareDiscovery', () => {
  let discovery;

  beforeEach(() => {
    execFileMock.mockReset();
    discovery = new HardwareDiscovery({ timeoutMs: 5000 });
  });

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

describe('HardwareDiscovery on Linux', () => {
  // The win32 branch above (via detectOsGpus()'s dispatch) covers
  // detectWindowsGpus(); this covers the separate detectLinuxGpus() (lspci)
  // parsing logic, which had no test coverage at all until this pass
  // despite being the branch every ubuntu-latest CI run and any
  // Linux/container deployment actually exercises. Called directly rather
  // than through detect()/detectOsGpus(), since that dispatcher branches on
  // the real host platform() and this file already pins that to win32
  // above for the sibling suite — detectLinuxGpus() itself doesn't care
  // what the host OS is, so it can be exercised standalone.
  test('detectLinuxGpus parses VGA controllers from lspci output', async () => {
    execFileMock.mockReset();
    const linuxDiscovery = new HardwareDiscovery({ timeoutMs: 5000 });
    const lspciOutput = '00:02.0 VGA compatible controller [0300]: Intel Corporation Iris Xe Graphics [8086:9a49]';

    execFileMock.mockImplementation(function () {
      const cmd = arguments[0];
      const cb = callbackFromArgs(arguments);
      if (!cb) return;
      if (cmd === 'lspci') {
        cb(null, { stdout: lspciOutput }, { stderr: '' });
        return;
      }
      cb(new Error('unexpected'), { stdout: '' }, { stderr: '' });
    });

    const gpus = await linuxDiscovery.detectLinuxGpus();

    expect(gpus.length).toBe(1);
    expect(gpus[0].name).toBe('Intel Corporation Iris Xe Graphics');
    expect(gpus[0].vendor).toBe('Intel');
    expect(gpus[0].cudaCapable).toBe(false);
  });
});
