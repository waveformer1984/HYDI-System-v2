'use strict';

jest.mock('child_process', () => ({ exec: jest.fn() }));

const { exec } = require('child_process');
const ResourceManager = require('../../modules/resource-manager');

describe('ResourceManager GPU sampling', () => {
  let rm;

  afterEach(() => {
    if (rm) rm.stop();
    exec.mockReset();
  });

  test('sampleGPU returns 0 and kicks off a background probe on first call', () => {
    exec.mockImplementation(() => {}); // never calls back within this test
    rm = new ResourceManager();

    const value = rm.sampleGPU();

    expect(value).toBe(0);
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0][0]).toContain('nvidia-smi');
  });

  test('does not spawn a second probe while one is already in flight', () => {
    exec.mockImplementation(() => {});
    rm = new ResourceManager();

    rm.sampleGPU();
    rm.sampleGPU();
    rm.sampleGPU();

    expect(exec).toHaveBeenCalledTimes(1);
  });

  test('averages multi-GPU utilization once nvidia-smi resolves', () => {
    exec.mockImplementation((_cmd, _opts, cb) => cb(null, '40\n60\n'));
    rm = new ResourceManager();

    rm.sampleGPU(); // triggers the (synchronously-resolving, mocked) probe

    expect(rm.sampleGPU()).toBe(50);
  });

  test('permanently degrades to 0 once nvidia-smi is confirmed unavailable', () => {
    exec.mockImplementation((_cmd, _opts, cb) => cb(new Error('command not found'), ''));
    rm = new ResourceManager();

    rm.sampleGPU();
    expect(rm.sampleGPU()).toBe(0);

    exec.mockClear();
    rm.sampleGPU();
    // No further exec calls once gpuAvailable is known false.
    expect(exec).not.toHaveBeenCalled();
  });

  test('getStatus reports gpu usage alongside cpu/ram/agents', () => {
    exec.mockImplementation((_cmd, _opts, cb) => cb(null, '25\n'));
    rm = new ResourceManager();
    rm.sampleGPU();

    const status = rm.getStatus();

    expect(status.resources).toHaveProperty('cpu');
    expect(status.resources).toHaveProperty('ram');
    expect(status.resources).toHaveProperty('gpu');
    expect(status.resources.gpu.threshold).toBe(90);
  });
});
