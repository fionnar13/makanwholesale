// تست رمزنگاری و پوشاندن مقادیر حساس — AES-256-GCM
import { test } from 'node:test'
import assert from 'node:assert/strict'

// env قبل از import ماژول — کلید ثابت برای تکرارپذیری
process.env.INTEGRATION_SECRET_KEY = 'test-secret-key-for-integrations-1234567890'

const { encryptValue, decryptValue, isEncrypted, maskSecret } = await import('../../src/lib/integrations/crypto.ts')

test('encrypt/decrypt roundtrip', () => {
  const plain = 'bot123456:AAE-very-secret-token'
  const enc = encryptValue(plain)
  assert.ok(isEncrypted(enc), 'خروجی باید با enc.v1 شروع شود')
  assert.notEqual(enc, plain)
  assert.equal(decryptValue(enc), plain)
})

test('each encryption produces unique ciphertext (random IV)', () => {
  const a = encryptValue('same-value')
  const b = encryptValue('same-value')
  assert.notEqual(a, b)
  assert.equal(decryptValue(a), 'same-value')
  assert.equal(decryptValue(b), 'same-value')
})

test('plain value passes through decrypt (backward compat)', () => {
  assert.equal(decryptValue('plain-token'), 'plain-token')
  assert.equal(isEncrypted('plain-token'), false)
})

test('wrong key fails decryption with clear error', async () => {
  const enc = encryptValue('secret')
  process.env.INTEGRATION_SECRET_KEY = 'a-different-key-now'
  try {
    assert.throws(() => decryptValue(enc), /INTEGRATION_SECRET_KEY/)
  } finally {
    process.env.INTEGRATION_SECRET_KEY = 'test-secret-key-for-integrations-1234567890'
  }
})

test('maskSecret hides sensitive values', () => {
  const token = '123456789:AAE-very-long-token'
  assert.equal(maskSecret(token), '••••••' + token.slice(-4))
  assert.equal(maskSecret(null), null)
  assert.equal(maskSecret(''), null)
  assert.ok(maskSecret('short').startsWith('•'))
  // مقدار رمز شده کاملاً مخفی می‌شود
  assert.ok(maskSecret(encryptValue('abc')).startsWith('••••'))
})
