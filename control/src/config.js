import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });

function boolFromEnv(defaultValue) {
  return z.preprocess((val) => {
    if (val === undefined) return defaultValue;
    if (typeof val === 'boolean') return val;
    const normalized = String(val).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
    return val;
  }, z.boolean());
}

// Presence of non-defaulted fields is enforced per entrypoint via loadConfig({ require }).
const fieldSchemas = {
  PORT: z.coerce.number().int().positive().default(3100),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'ENCRYPTION_KEY must be exactly 64 hex characters'),
  ADMIN_EMAIL: z.string().email('ADMIN_EMAIL must be a valid email address'),
  ADMIN_PASSWORD: z.string().min(12, 'ADMIN_PASSWORD must be at least 12 characters long'),
  NODE_ENV: z.string().min(1).default('development'),
  ALLOW_INSECURE_SERVER_URLS: boolFromEnv(false),
};

export const DEFAULT_REQUIRED = ['MONGO_URI', 'JWT_SECRET', 'ENCRYPTION_KEY'];

export class ConfigError extends Error {
  constructor(issues) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

// Never wrap these in .optional(): zod would skip their defaults when the key is absent.
const ALWAYS_DEFAULTED = new Set(['PORT', 'NODE_ENV', 'ALLOW_INSECURE_SERVER_URLS']);

function buildSchema(require) {
  const shape = {};
  for (const [key, schema] of Object.entries(fieldSchemas)) {
    if (ALWAYS_DEFAULTED.has(key)) {
      shape[key] = schema;
    } else {
      shape[key] = require.includes(key) ? schema : schema.optional();
    }
  }
  return z.object(shape).loose();
}

export function loadConfig({ require = DEFAULT_REQUIRED } = {}) {
  const schema = buildSchema(require);
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(issues);
  }
  return Object.freeze({ ...result.data });
}
