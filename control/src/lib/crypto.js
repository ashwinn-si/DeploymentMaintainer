import crypto from 'node:crypto';
import { HttpError } from './httpError.js';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;

export function encryptJSON(config, obj) {
  const key = Buffer.from(config.ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), data: ciphertext.toString('base64') };
}

export function decryptJSON(config, blob) {
  try {
    const key = Buffer.from(config.ENCRYPTION_KEY, 'hex');
    const iv = Buffer.from(blob.iv, 'base64');
    const tag = Buffer.from(blob.tag, 'base64');
    const data = Buffer.from(blob.data, 'base64');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (err) {
    throw new HttpError(500, 'Could not decrypt the stored server secret — was ENCRYPTION_KEY changed?', { cause: err });
  }
}
