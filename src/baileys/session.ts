import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import type { WASocket, BaileysEventMap, ConnectionState } from '@whiskeysockets/baileys';
import type { Boom } from '@hapi/boom';
import { existsSync, rmSync } from 'node:fs';
import pino from 'pino';
import type { SessionStatusProvider } from '../routes/health.route.js';
import type { MessageSender } from '../routes/messages.route.js';
import type { LidResolver } from './jid-resolver.js';

export interface BaileysSessionConfig {
  authDir: string;
  onInboundMessage: (message: any, lidResolver: LidResolver | null) => void;
  onStatusUpdate: (update: any) => void;
}

const MAX_RECONNECT_ATTEMPTS = 5;

/**
 * Manages the Baileys WhatsApp Web session lifecycle:
 * connect, disconnect, QR code tracking, and automatic reconnection.
 *
 * Decoupled from Express routes via the SessionStatusProvider and MessageSender interfaces,
 * so every consumer can be tested independently.
 */
export class BaileysSession {
  private sock: WASocket | null = null;
  private saveCreds: (() => Promise<void>) | null = null;
  private connected = false;
  private qrCode: string | undefined;
  private phone: string | undefined;
  private reconnectAttempts = 0;
  private isPairing = false;
  private dashboardState: 'idle' | 'pairing_qr' | 'qr_expired' | 'connecting' | 'connected' | 'replaced' | 'error' = 'idle';
  private statusMessage = '';
  private readonly config: BaileysSessionConfig;
  private readonly logger = pino({ level: 'silent' });
  private readonly appLogger = pino({ transport: { target: 'pino-pretty' } });

  constructor(config: BaileysSessionConfig) {
    this.config = config;
  }

  /** Establishes the Baileys WebSocket connection and starts listening for events. */
  async connect(): Promise<void> {
    // Clean up any existing socket before creating a new one
    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners('connection.update');
        this.sock.ev.removeAllListeners('creds.update');
        this.sock.ev.removeAllListeners('messages.upsert');
        await this.sock.end(undefined);
      } catch { /* ignore */ }
      this.sock = null;
    }

    if (this.hasCredentials()) {
      this.isPairing = false;
      this.dashboardState = 'connecting';
    } else {
      this.isPairing = true;
      this.dashboardState = 'pairing_qr';
    }

    const { state, saveCreds } = await useMultiFileAuthState(this.config.authDir);
    this.saveCreds = saveCreds;

    // Fetch the latest WhatsApp Web version to avoid 405 Connection Failure
    const { version } = await fetchLatestBaileysVersion();
    this.appLogger.info('Using WhatsApp Web version: %s', version.join('.'));

    this.sock = makeWASocket({
      auth: state,
      version,
      browser: Browsers.ubuntu('WA API Simulator'),
      logger: this.logger,
    });

    this.sock.ev.on('connection.update', (update: Partial<ConnectionState>) => {
      this.handleConnectionUpdate(update);
    });

    this.sock.ev.on('creds.update', async () => {
      await this.saveCreds?.();
    });

    this.sock.ev.on('messages.upsert', (event: BaileysEventMap['messages.upsert']) => {
      const lidResolver: LidResolver | null =
        (this.sock as any)?.signalRepository?.lidMapping ?? null;
      for (const msg of event.messages) {
        if (msg.key.fromMe) continue;
        this.config.onInboundMessage(msg, lidResolver);
      }
    });
  }

  /** Closes the session. If clearAuth is true, deletes stored credentials. */
  async disconnect(clearAuth = false): Promise<void> {
    if (this.sock) {
      this.sock.ev.removeAllListeners('connection.update');
      this.sock.ev.removeAllListeners('creds.update');
      this.sock.ev.removeAllListeners('messages.upsert');
      if (clearAuth) {
        try { await this.sock.logout(); } catch { /* already disconnected */ }
        // Remove auth folder so next connect() generates a fresh QR
        const { rmSync } = await import('node:fs');
        try { rmSync(this.config.authDir, { recursive: true, force: true }); } catch { /* ignore */ }
      } else {
        try { await this.sock.end(undefined); } catch { /* ignore */ }
      }
    }
    this.sock = null;
    this.connected = false;
    this.qrCode = undefined;
    this.phone = undefined;
    this.reconnectAttempts = 0;
    this.isPairing = false;
    this.dashboardState = 'idle';
    this.statusMessage = '';
  }

  isConnected(): boolean {
    return this.connected;
  }

  currentQR(): string | undefined {
    return this.qrCode;
  }

  phoneNumber(): string | undefined {
    return this.phone;
  }

  hasCredentials(): boolean {
    return existsSync(`${this.config.authDir}/creds.json`);
  }

  getDashboardStatus(): string {
    return this.dashboardState;
  }

  getStatusMessage(): string {
    return this.statusMessage;
  }

  /** Returns the socket for direct use (e.g., sending messages). */
  socket(): WASocket | null {
    return this.sock;
  }

  /** Adapter so Express routes can query session status without coupling to Baileys. */
  asStatusProvider(): SessionStatusProvider {
    return {
      isConnected: () => this.isConnected(),
      phoneNumber: () => this.phoneNumber(),
    };
  }

  /** Adapter so Express routes can send messages without coupling to Baileys. */
  asMessageSender(): MessageSender {
    return {
      sendTextMessage: async (phoneNumber: string, text: string) => {
        if (!this.sock) throw new Error('Session not connected');
        const jid = `${phoneNumber}@s.whatsapp.net`;
        await this.sock.sendMessage(jid, { text });
      },
    };
  }

  /**
   * Exposed for testing — simulates a connection.update event.
   * In production, Baileys emits this automatically.
   */
  /* @internal */
  emitConnectionUpdate(update: Partial<ConnectionState>): void {
    this.handleConnectionUpdate(update);
  }

  // ── Private ──

  private handleConnectionUpdate(update: Partial<ConnectionState>): void {
    const { connection, lastDisconnect, qr } = update as any;

    if (qr) {
      this.qrCode = qr;
      this.connected = false;
      this.dashboardState = 'pairing_qr';
      this.appLogger.info('QR code received — open http://localhost:3001/dashboard to scan');
    }

    if (connection === 'open') {
      this.connected = true;
      this.qrCode = undefined;
      this.reconnectAttempts = 0;
      this.isPairing = false;
      this.dashboardState = 'connected';
      this.statusMessage = '';
      this.phone = this.sock?.user?.id?.replace(/@.*/, '').replace(/:.*/, '');
      this.appLogger.info('WhatsApp connected — phone: %s', this.phone);
    }

    if (connection === 'close') {
      this.connected = false;

      const error = lastDisconnect?.error;
      const statusCode = (error as Boom)?.output?.statusCode;

      this.appLogger.error('Connection closed — statusCode=%d error=%s', statusCode, error?.message ?? 'unknown');

      if (statusCode === 408 && this.isPairing) {
        // QR timeout — user didn't scan in time
        this.dashboardState = 'qr_expired';
        this.statusMessage = 'El código QR expiró';
        this.qrCode = undefined;
      } else if (statusCode === 401 || statusCode === 500) {
        // Terminal — session invalidated by WhatsApp
        rmSync(this.config.authDir, { recursive: true, force: true });
        this.dashboardState = 'idle';
        this.statusMessage = 'Sesión cerrada por WhatsApp';
        this.isPairing = false;
        this.qrCode = undefined;
      } else if (statusCode === 440) {
        // Conflict — another device took over
        this.dashboardState = 'replaced';
        this.statusMessage = 'WhatsApp está abierto en otro dispositivo';
      } else if (statusCode === 428 || statusCode === 503 || (statusCode === 408 && !this.isPairing)) {
        // Transient — recoverable with backoff
        this.dashboardState = 'connecting';
        if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          this.reconnectAttempts++;
          const backoffMs = Math.min(Math.pow(2, this.reconnectAttempts) * 1000, 30_000);
          this.appLogger.info('Reconnecting in %dms (attempt %d/%d)', backoffMs, this.reconnectAttempts, MAX_RECONNECT_ATTEMPTS);
          setTimeout(() => this.connect(), backoffMs);
        }
      } else if (statusCode === 403 || statusCode === 411) {
        // Fatal — unrecoverable
        this.dashboardState = 'error';
        this.statusMessage = statusCode === 403
          ? 'Acceso prohibido por WhatsApp'
          : 'Incompatibilidad de dispositivos';
      } else if (statusCode === 515) {
        // Restart required
        setTimeout(() => this.connect(), 0);
      }
    }
  }
}
