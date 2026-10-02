import bcrypt from 'bcryptjs';
import request from 'supertest';
import { createApp } from '../../src/index.js';
import User from '../../src/models/User.js';
import { connectTestDB } from './db.js';

export const ADMIN_EMAIL = 'admin@example.com';
export const ADMIN_PASSWORD = 'test-admin-password';

export async function setupControl({ login = true, config: overrides = {} } = {}) {
  await connectTestDB();

  const config = {
    PORT: 3199,
    MONGO_URI: 'unused-in-tests',
    JWT_SECRET: 'x'.repeat(32),
    ENCRYPTION_KEY: 'a'.repeat(64),
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    NODE_ENV: 'test',
    ALLOW_INSECURE_SERVER_URLS: false,
    ...overrides,
  };

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 4);
  await User.create({ email: ADMIN_EMAIL, passwordHash });

  const app = createApp(config);
  const agent = request.agent(app);
  if (login) {
    await agent.post('/api/auth/login').send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }).expect(200);
  }
  return { app, agent, config };
}
