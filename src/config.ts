import 'dotenv/config';

/**
 * Validated environment configuration for the WhatsApp API Simulator.
 * Loaded once at startup — fails fast if required variables are missing.
 */
export interface SimulatorConfig {
  port: number;
  phoneNumber: string;
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
  callbackUrl: string;
  verifyToken: string;
  appSecret: string;
  mediaDir: string;
  mediaMaxSizeMb: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Reads and validates all environment variables.
 * Throws immediately if a required variable is absent.
 */
export function loadConfig(): SimulatorConfig {
  return {
    port: parseInt(process.env['PORT'] ?? '3001', 10),
    phoneNumber: requireEnv('PHONE_NUMBER'),
    phoneNumberId: requireEnv('PHONE_NUMBER_ID'),
    wabaId: requireEnv('WABA_ID'),
    accessToken: requireEnv('ACCESS_TOKEN'),
    callbackUrl: requireEnv('CALLBACK_URL'),
    verifyToken: requireEnv('VERIFY_TOKEN'),
    appSecret: requireEnv('APP_SECRET'),
    mediaDir: process.env['MEDIA_DIR'] ?? './media',
    mediaMaxSizeMb: parseInt(process.env['MEDIA_MAX_SIZE_MB'] ?? '100', 10),
  };
}
