'use strict';

const execFileMock = jest.fn();

jest.doMock('child_process', () => ({
  execFile: execFileMock,
}));

jest.doMock('ollama', () => ({
  Ollama: class {
    constructor({ host }) {
      this.host = host;
    }
    async list() {
      return { models: [{ name: 'llama3.2:3b', model: 'llama3.2:3b', size: 2019393189, details: { parameter_size: '3B', quantization_level: 'Q4_0' } }] };
    }
    async generate({ model, prompt }) {
      return { response: `generated:${model}:${prompt}` };
    }
    async chat({ model, messages }) {
      return { message: { content: `chat:${model}:${messages.length}` } };
    }
  },
}));

const CudaPoolManager = require('../../../src/hydi-v3/CudaPoolManager');

describe('CudaPoolManager', () => {
  let pool;

  beforeEach(() => {
    execFileMock.mockReset();
    pool = new CudaPoolManager({
      pollIntervalMs: 1000,
      ollama: { timeoutMs: 1000 },
      hardwareDiscovery: { timeoutMs: 1000 },
    });
  });

  afterEach(async () => {
    await pool.shutdown();
  });

  test('initialize creates a CPU fallback when no CUDA GPUs are detected', async () => {
    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb;
      callback(new Error('nvidia-smi not found'), { stdout: '' }, { stderr: '' });
    });

    await pool.initialize();

    expect(pool.gpus.length).toBe(1);
    expect(pool.gpus[0].isFallback).toBe(true);
    expect(pool.gpus[0].name).toBe('CPU_FALLBACK');
  });

  test('estimateMemory returns a positive byte estimate', () => {
    const bytes = pool.estimateMemory({
      parameterBillions: 3,
      quantizationBits: 4,
      contextSize: 4096,
    });
    expect(bytes).toBeGreaterThan(0);
  });

  test('allocateGPU returns a device and releaseGPU frees it', () => {
    pool.gpus = [{
      index: 0,
      name: 'Mock RTX',
      vramBytes: 8 * 1024 * 1024 * 1024,
      vramFreeBytes: 8 * 1024 * 1024 * 1024,
      allocatedVramBytes: 0,
      allocationIds: new Set(),
      utilizationGpu: 0,
      temperatureC: 50,
      isHealthy: true,
      cudaCapable: true,
    }];

    const alloc = pool.allocateGPU({ vramBytes: 2 * 1024 * 1024 * 1024 });
    expect(alloc).not.toBeNull();
    expect(alloc.gpu.allocatedVramBytes).toBe(2 * 1024 * 1024 * 1024);

    const released = pool.releaseGPU(alloc.allocationId);
    expect(released).toBe(true);
    expect(pool.allocations.has(alloc.allocationId)).toBe(false);
  });

  test('scheduleInference completes a job through the Ollama runtime', async () => {
    execFileMock.mockImplementation((cmd, args, opts, cb) => {
      const callback = typeof opts === 'function' ? opts : cb;
      callback(new Error('nvidia-smi not found'), { stdout: '' }, { stderr: '' });
    });

    await pool.initialize();

    const completed = jest.fn();
    pool.on('job_completed', completed);

    const jobId = pool.scheduleInference({ model: 'llama3.2:3b', prompt: 'hello' });
    expect(jobId).toMatch(/^job_/);

    // Wait for the queue to drain.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(pool.activeJobs.size).toBe(0);
    // Since activeJobs is cleared on completion, we instead check metrics.
    expect(pool.metrics.jobsCompleted).toBeGreaterThanOrEqual(1);
    expect(completed).toHaveBeenCalled();
  }, 10000);

  test('healthStatus reports queue and GPU state', () => {
    const status = pool.healthStatus();
    expect(status).toHaveProperty('healthy');
    expect(status).toHaveProperty('gpus');
    expect(status).toHaveProperty('queueDepth');
    expect(status).toHaveProperty('metrics');
  });
});
