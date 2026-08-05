const { KMSKeyCustody, SecureEnvLoader } = require('../../security/kms-key-custody');

describe('KMSKeyCustody production guard', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalKmsSim = process.env.KMS_SIMULATION_ALLOWED;

  beforeEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.KMS_SIMULATION_ALLOWED;
  });

  afterEach(() => {
    if (originalNodeEnv !== undefined) {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    if (originalKmsSim !== undefined) {
      process.env.KMS_SIMULATION_ALLOWED = originalKmsSim;
    } else {
      delete process.env.KMS_SIMULATION_ALLOWED;
    }
  });

  it('allows operations outside production', async () => {
    const kms = new KMSKeyCustody();
    const result = await kms.encrypt(Buffer.from('hello'));
    expect(result.encryptedData).toBeInstanceOf(Buffer);
  });

  it('blocks encrypt in production without KMS_SIMULATION_ALLOWED', async () => {
    process.env.NODE_ENV = 'production';
    const kms = new KMSKeyCustody();
    await expect(kms.encrypt('hello')).rejects.toThrow(/blocked in production/);
  });

  it('allows encrypt in production when KMS_SIMULATION_ALLOWED=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.KMS_SIMULATION_ALLOWED = 'true';
    const kms = new KMSKeyCustody();
    const result = await kms.encrypt(Buffer.from('hello'));
    expect(result.encryptedData).toBeInstanceOf(Buffer);
  });

  it('blocks sign/verify in production', async () => {
    process.env.NODE_ENV = 'production';
    const kms = new KMSKeyCustody();
    await expect(kms.sign('data')).rejects.toThrow(/blocked in production/);
    await expect(kms.verify('data', Buffer.alloc(1))).rejects.toThrow(/blocked in production/);
  });

  it('blocks SecureEnvLoader in production', async () => {
    process.env.NODE_ENV = 'production';
    const kms = new KMSKeyCustody();
    const loader = new SecureEnvLoader(kms);
    await expect(loader.loadSecureEnv('my_secret')).rejects.toThrow(/blocked in production/);
  });
});
