'use strict';

// Paste-code path for the phone key import: Frank's page shows the one-time
// code as text too (Copy code / short code), and the phone dashboard's
// "Scan key QR" sheet accepts it pasted or typed. hydi.py does the real
// validation (tests/hydi_key_import_test.py); this covers the page side.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const html = fs.readFileSync(path.join(ROOT, 'hydi-mobile-protoforge.html'), 'utf8');
const provisionPage = fs.readFileSync(path.join(ROOT, 'pages/phone/provision.tsx'), 'utf8');

function extractFunction(src, name) {
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error('missing function ' + name);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unclosed function ' + name);
}

const { kqLooksLikeCode } = new Function(`${extractFunction(html, 'kqLooksLikeCode')}; return { kqLooksLikeCode };`)();
const CODE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

describe('phone key paste code', () => {
  it('accepts the full payload and the short code in any grouping or case', () => {
    expect(kqLooksLikeCode(`hydi-provision:v1?c=${CODE}&h=100.118.182.126&p=3000`)).toBe(true);
    expect(kqLooksLikeCode(`  ${CODE}\n`)).toBe(true);
    expect(kqLooksLikeCode(CODE.match(/.{4}/g).join('-').toLowerCase())).toBe(true);
    expect(kqLooksLikeCode(CODE.match(/.{8}/g).join(' '))).toBe(true);
  });

  it('rejects anything that is not a Hydi code', () => {
    for (const bad of ['', 'hello', CODE.slice(1), `${CODE}A`, CODE.replace('2', '1'), 'WIFI:S:home;;',
      `https://evil.example/?c=${CODE}`, 'sk-not-a-code']) {
      expect(kqLooksLikeCode(bad)).toBe(false);
    }
  });

  it('wires the paste box to the same import path as the scanner', () => {
    expect(html).toContain('id="kqPaste"');
    expect(html).toContain('id="kqPasteBtn"');
    const importer = extractFunction(html, 'kqImport');
    expect(importer).toContain('kqLooksLikeCode(text)');
    expect(importer).toContain("'/api/keys/provision'");
    expect(extractFunction(html, 'kqPaste')).toContain('kqImport(text)');
    // the paste box works even where the browser cannot read QR codes
    const opener = extractFunction(html, 'openKeyScanner');
    expect(opener.indexOf("addEventListener('click', kqPaste)")).toBeLessThan(opener.indexOf("'BarcodeDetector' in window"));
  });

  it("Frank's page keeps the code up for its whole life and offers it as text", () => {
    expect(provisionPage).not.toMatch(/SHOW_MS/);
    expect(provisionPage).toContain('data.expiresAt');
    expect(provisionPage).toContain('Copy code');
    expect(provisionPage).toContain('issued.payload');
    expect(provisionPage).toContain('grouped(issued.code)');
  });
});
