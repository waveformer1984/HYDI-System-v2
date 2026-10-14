import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWalkieLink } from '../src/deeplink';

const CODE = 'QJKPH-EBC8F-JFTGM-Q3YFS';
const TICKET = 'eyJhbGciOiJIUzI1NiJ9.eyJraW5kIjoibG9naW4ifQ.c2lnbmF0dXJl';

test('invite links from the QR page and the QR itself', () => {
  assert.deepEqual(parseWalkieLink(`protoforgewalkie://join/${CODE}`), { kind: 'join', code: CODE });
  assert.deepEqual(parseWalkieLink(`protoforgewalkie://join/${CODE.toLowerCase()}/`), { kind: 'join', code: CODE });
  assert.deepEqual(parseWalkieLink(`https://heidi-pc.example.ts.net/j/${CODE}`), { kind: 'join', code: CODE });
  assert.deepEqual(parseWalkieLink(`https://heidi-pc.example.ts.net/j/${CODE}?x=1`), { kind: 'join', code: CODE });
});

test('owner sign-in links', () => {
  assert.deepEqual(parseWalkieLink(`protoforgewalkie://login/${TICKET}`), { kind: 'login', ticket: TICKET });
});

test('anything else is ignored', () => {
  for (const url of [
    null,
    '',
    'protoforgewalkie://join/short',
    'protoforgewalkie://join/<script>',
    'protoforgewalkie://login/not-a-jwt',
    'protoforgewalkie://delete/everything',
    `http://heidi-pc.example.ts.net/j/${CODE}`, // not https
    `https://example.com/x/${CODE}`,
    'https://example.com/j/AAAAA',
  ]) {
    assert.equal(parseWalkieLink(url), null, String(url));
  }
});
