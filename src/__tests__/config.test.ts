import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SimulatorConfig } from '../config.js';

/**
 * Verifies that loadConfig reads environment variables correctly
 * and fails fast when required variables are missing.
 */

const REQUIRED_ENV = {
  PHONE_NUMBER: '51999000000',
  PHONE_NUMBER_ID: 'sim_pnid_001',
  WABA_ID: 'sim_waba_001',
  ACCESS_TOKEN: 'sim_access_token',
  CALLBACK_URL: 'http://localhost:8080/webhooks/whatsapp',
  VERIFY_TOKEN: 'help_verify_secret_2024',
  APP_SECRET: 'help_app_secret_2024',
};

describe('loadConfig', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Set all required variables
    Object.entries(REQUIRED_ENV).forEach(([key, value]) => {
      process.env[key] = value;
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads all required variables with correct values', async () => {
    const { loadConfig } = await import('../config.js');
    const config: SimulatorConfig = loadConfig();

    expect(config.phoneNumber).toBe('51999000000');
    expect(config.phoneNumberId).toBe('sim_pnid_001');
    expect(config.wabaId).toBe('sim_waba_001');
    expect(config.accessToken).toBe('sim_access_token');
    expect(config.callbackUrl).toBe('http://localhost:8080/webhooks/whatsapp');
    expect(config.verifyToken).toBe('help_verify_secret_2024');
    expect(config.appSecret).toBe('help_app_secret_2024');
  });

  it('uses default values for optional variables', async () => {
    delete process.env['PORT'];
    delete process.env['MEDIA_DIR'];
    delete process.env['MEDIA_MAX_SIZE_MB'];

    const { loadConfig } = await import('../config.js');
    const config = loadConfig();

    expect(config.port).toBe(3001);
    expect(config.mediaDir).toBe('./media');
    expect(config.mediaMaxSizeMb).toBe(100);
  });

  it('respects custom PORT when set', async () => {
    process.env['PORT'] = '4000';

    const { loadConfig } = await import('../config.js');
    const config = loadConfig();

    expect(config.port).toBe(4000);
  });

  it('throws when a required variable is missing', async () => {
    delete process.env['PHONE_NUMBER'];

    const { loadConfig } = await import('../config.js');

    expect(() => loadConfig()).toThrow('Missing required environment variable: PHONE_NUMBER');
  });

  it('throws for each missing required variable', async () => {
    for (const key of Object.keys(REQUIRED_ENV)) {
      // Reset all
      Object.entries(REQUIRED_ENV).forEach(([k, v]) => {
        process.env[k] = v;
      });
      delete process.env[key];

      // Re-import to get fresh module
      const { loadConfig } = await import('../config.js');

      expect(() => loadConfig()).toThrow(`Missing required environment variable: ${key}`);
    }
  });
});
