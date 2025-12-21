import test from 'node:test';
import assert from 'node:assert/strict';
import { generateActivationCodePlaintext, hashActivationCode } from './activationCode.js';

test('activation code: hash 稳定且非空', () => {
    const code = generateActivationCodePlaintext();
    const h1 = hashActivationCode(code);
    const h2 = hashActivationCode(code);
    assert.ok(typeof h1 === 'string' && h1.length > 10);
    assert.equal(h1, h2);
});

