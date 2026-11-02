export type MailDriver = 'console' | 'smtp';

export type MailMessage = {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
  /** Optional template name for future renderers. */
  template?: string;
  context?: Record<string, unknown>;
};

/**
 * Mail sender abstraction (tech plan §26 names this **MailSender**).
 * Runtime Nest DI token stays `MAIL_PROVIDER`; `MailProvider` === `MailSender`.
 * Default: console sink (no network). SMTP driver is a dry-run skeleton
 * that never opens a socket unless explicitly extended later.
 */
export interface MailProvider {
  readonly driver: MailDriver;
  send(message: MailMessage): Promise<void>;
}

/** Alias for tech-plan §26 naming (`MailSender`). Same contract as MailProvider. */
export type MailSender = MailProvider;

export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');
/** Alias for tech-plan naming; same injection token as MAIL_PROVIDER. */
export const MAIL_SENDER = MAIL_PROVIDER;

/** Redact email for logs: a***@example.com */
export function redactEmail(addr: string): string {
  const s = String(addr ?? '').trim();
  const at = s.indexOf('@');
  if (at <= 0) return '***';
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  const head = local.slice(0, 1) || '*';
  return `${head}***@${domain || '***'}`;
}

export function normalizeRecipients(to: string | string[]): string[] {
  const list = Array.isArray(to) ? to : [to];
  return list.map((x) => String(x).trim()).filter(Boolean);
}
