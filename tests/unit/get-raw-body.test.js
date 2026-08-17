const { Readable } = require('stream');
const { getRawBody } = require('../../lib/get-raw-body');

describe('getRawBody', () => {
  it('returns req.body unchanged when it is already a Buffer (Express raw() / test harnesses)', async () => {
    const buf = Buffer.from('{"hello":"world"}');
    const result = await getRawBody({ body: buf });
    expect(result).toBe(buf);
  });

  it('wraps req.body in a Buffer when it is a string', async () => {
    const result = await getRawBody({ body: '{"hello":"world"}' });
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toBe('{"hello":"world"}');
  });

  it('reads the raw bytes from a stream when req.body is not pre-populated (Next.js bodyParser: false)', async () => {
    const payload = '{"stripe":"event"}';
    const stream = Readable.from([Buffer.from(payload)]);
    const result = await getRawBody(stream);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result.toString()).toBe(payload);
  });

  it('concatenates multiple chunks in order', async () => {
    const stream = Readable.from([Buffer.from('abc'), Buffer.from('def')]);
    const result = await getRawBody(stream);
    expect(result.toString()).toBe('abcdef');
  });
});
