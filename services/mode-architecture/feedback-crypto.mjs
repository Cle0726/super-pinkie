// 反馈上报端到端加密（Node 自带 crypto：X25519 一次性密钥交换 + HKDF-SHA256 + AES-256-GCM）。
// 打包端和客户端只拿公钥加密；私钥只在作者电脑上，用来解密聚合报告。
import crypto from 'node:crypto';

export const FEEDBACK_CRYPTO_ALG = 'x25519-hkdf-sha256-aes-256-gcm';
const FEEDBACK_AAD = Buffer.from('super-pinkie-feedback-v1', 'utf8');

export function generateFeedbackKeypair() {
  const {publicKey, privateKey} = crypto.generateKeyPairSync('x25519');
  const publicKeyDerBase64 = publicKey.export({type: 'spki', format: 'der'}).toString('base64');
  const publicKeyPem = publicKey.export({type: 'spki', format: 'pem'});
  const privateKeyPem = privateKey.export({type: 'pkcs8', format: 'pem'});
  const fingerprint = crypto.createHash('sha256').update(Buffer.from(publicKeyDerBase64, 'base64')).digest('hex').slice(0, 16);
  return {publicKeyDerBase64, publicKeyPem, privateKeyPem, fingerprint};
}

export function parseFeedbackPublicKey(input) {
  if (input && typeof input === 'object' && input.type === 'public') {
    if (input.asymmetricKeyType !== 'x25519') throw new Error('反馈加密公钥必须是 X25519');
    return input;
  }
  const raw = String(input || '').trim();
  if (!raw) throw new Error('缺少反馈加密公钥');
  const key = raw.includes('BEGIN PUBLIC KEY')
    ? crypto.createPublicKey(raw)
    : crypto.createPublicKey({key: Buffer.from(raw, 'base64'), format: 'der', type: 'spki'});
  if (key.asymmetricKeyType !== 'x25519') throw new Error('反馈加密公钥必须是 X25519');
  return key;
}

export function parseFeedbackPrivateKey(input) {
  if (input && typeof input === 'object' && input.type === 'private') {
    if (input.asymmetricKeyType !== 'x25519') throw new Error('反馈解密私钥必须是 X25519');
    return input;
  }
  const raw = String(input || '').trim();
  if (!raw) throw new Error('缺少反馈解密私钥');
  const key = raw.includes('BEGIN PRIVATE KEY')
    ? crypto.createPrivateKey(raw)
    : crypto.createPrivateKey({key: Buffer.from(raw, 'base64'), format: 'der', type: 'pkcs8'});
  if (key.asymmetricKeyType !== 'x25519') throw new Error('反馈解密私钥必须是 X25519');
  return key;
}

export function publicKeyFingerprint(publicKeyInput) {
  const key = parseFeedbackPublicKey(publicKeyInput);
  const der = key.export({type: 'spki', format: 'der'});
  return crypto.createHash('sha256').update(der).digest('hex').slice(0, 16);
}

export function encryptFeedbackEnvelope(payload, publicKeyInput) {
  const recipientKey = parseFeedbackPublicKey(publicKeyInput);
  const {publicKey: ephemeralPub, privateKey: ephemeralPriv} = crypto.generateKeyPairSync('x25519');
  const shared = crypto.diffieHellman({privateKey: ephemeralPriv, publicKey: recipientKey});
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const aesKey = Buffer.from(crypto.hkdfSync('sha256', shared, salt, FEEDBACK_AAD, 32));
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  cipher.setAAD(FEEDBACK_AAD);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const epk = ephemeralPub.export({type: 'spki', format: 'der'}).toString('base64');
  return {
    v: 1,
    alg: FEEDBACK_CRYPTO_ALG,
    epk,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  };
}

export function decryptFeedbackEnvelope(envelope, privateKeyInput) {
  if (!envelope || typeof envelope !== 'object') throw new Error('加密信封格式无效');
  if (envelope.v !== 1 || envelope.alg !== FEEDBACK_CRYPTO_ALG) {
    throw new Error(`不支持的加密格式：${String(envelope.alg || envelope.v || 'unknown')}`);
  }
  const recipientPriv = parseFeedbackPrivateKey(privateKeyInput);
  const ephemeralPub = parseFeedbackPublicKey(envelope.epk);
  const shared = crypto.diffieHellman({privateKey: recipientPriv, publicKey: ephemeralPub});
  const salt = Buffer.from(String(envelope.salt || ''), 'base64');
  const iv = Buffer.from(String(envelope.iv || ''), 'base64');
  const tag = Buffer.from(String(envelope.tag || ''), 'base64');
  const ct = Buffer.from(String(envelope.ct || ''), 'base64');
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || !ct.length) {
    throw new Error('加密信封字段不完整');
  }
  const aesKey = Buffer.from(crypto.hkdfSync('sha256', shared, salt, FEEDBACK_AAD, 32));
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, iv);
  decipher.setAAD(FEEDBACK_AAD);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}
