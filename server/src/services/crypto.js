import crypto from 'node:crypto';
import { HttpError } from '../lib/httpError.js';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const SCRYPT_KEYLEN = 32;
const SCRYPT_SALT_LENGTH = 16;

function encryptWithKey(key, obj) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), data: ciphertext.toString('base64') };
}

function decryptWithKey(key, blob) {
  try {
    const iv = Buffer.from(blob.iv, 'base64');
    const tag = Buffer.from(blob.tag, 'base64');
    const data = Buffer.from(blob.data, 'base64');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch (err) {
    throw new HttpError(400, 'Wrong passphrase or corrupted data', { cause: err });
  }
}

export function encryptJSON(config, obj) {
  return encryptWithKey(Buffer.from(config.ENCRYPTION_KEY, 'hex'), obj);
}

export function decryptJSON(config, blob) {
  return decryptWithKey(Buffer.from(config.ENCRYPTION_KEY, 'hex'), blob);
}

// Wraps decryptJSON for an App's envEncrypted blob specifically: null/missing
// means "no env yet" ({}), but a genuine decrypt failure (e.g. ENCRYPTION_KEY
// changed since this app was saved) must surface clearly rather than
// silently deploying with an empty env.
export function decryptAppEnv(config, envEncrypted) {
  if (!envEncrypted) return {};
  try {
    return decryptJSON(config, envEncrypted);
  } catch (err) {
    throw new HttpError(500, "Could not decrypt this app's environment — was ENCRYPTION_KEY changed?", { cause: err });
  }
}

export function encryptWithPassphrase(obj, passphrase) {
  const salt = crypto.randomBytes(SCRYPT_SALT_LENGTH);
  const key = crypto.scryptSync(passphrase, salt, SCRYPT_KEYLEN);
  return { ...encryptWithKey(key, obj), salt: salt.toString('base64') };
}

export function decryptWithPassphrase(blob, passphrase) {
  if (!blob?.salt) {
    throw new HttpError(400, 'Wrong passphrase or corrupted data');
  }
  const salt = Buffer.from(blob.salt, 'base64');
  const key = crypto.scryptSync(passphrase, salt, SCRYPT_KEYLEN);
  return decryptWithKey(key, blob);
}
