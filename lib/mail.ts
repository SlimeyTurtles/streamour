// Outbound email. One entry point (sendMail) over a small provider interface:
//
//   MAIL_PROVIDER=log     (default) prints the message to the server log.
//                         For development and staging; nothing leaves the box.
//   MAIL_PROVIDER=resend  sends through Resend's HTTP API.
//                         Needs RESEND_API_KEY and MAIL_FROM.
//
// Templates live in lib/mail-templates.ts:
//
//   await sendMail({ to, ...inviteEmail({ inviterName, inviteUrl, expiresAt }) });

import type { MailContent } from './mail-templates';

export interface MailMessage extends MailContent {
  to: string;
}

export interface OutgoingMail extends MailMessage {
  from: string;
}

export interface MailResult {
  provider: string;
  /** Provider's message id, when it returns one. */
  id?: string;
}

export interface MailProvider {
  readonly name: string;
  send(mail: OutgoingMail): Promise<MailResult>;
}

export class MailError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MailError';
  }
}

const DEFAULT_FROM = 'Streamour <no-reply@streamour.net>';

export const logProvider: MailProvider = {
  name: 'log',
  async send(mail) {
    console.log(
      [
        '--- [mail:log] not sent (MAIL_PROVIDER=log) ---',
        `From: ${mail.from}`,
        `To: ${mail.to}`,
        `Subject: ${mail.subject}`,
        '',
        mail.text.trimEnd(),
        '--- [mail:log] end ---',
      ].join('\n')
    );
    return { provider: 'log' };
  },
};

export function createResendProvider(apiKey: string): MailProvider {
  return {
    name: 'resend',
    async send(mail) {
      let response: Response;
      try {
        response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: mail.from,
            to: [mail.to],
            subject: mail.subject,
            text: mail.text,
            html: mail.html,
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (error) {
        throw new MailError('Could not reach Resend', { cause: error });
      }

      if (!response.ok) {
        // Resend error bodies describe the problem (bad from-domain, invalid
        // key, ...) and contain no secrets; keep a bounded slice for the log.
        const detail = (await response.text().catch(() => '')).slice(0, 500);
        throw new MailError(`Resend rejected the email (HTTP ${response.status}): ${detail}`);
      }

      const data = (await response.json().catch(() => null)) as { id?: string } | null;
      return { provider: 'resend', id: data?.id };
    },
  };
}

/** Picks the provider from the environment. Throws MailError on bad config. */
export function getMailProvider(): MailProvider {
  const name = (process.env.MAIL_PROVIDER || 'log').toLowerCase();
  switch (name) {
    case 'log':
      return logProvider;
    case 'resend': {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey) {
        throw new MailError('MAIL_PROVIDER=resend needs RESEND_API_KEY');
      }
      return createResendProvider(apiKey);
    }
    default:
      throw new MailError(`Unknown MAIL_PROVIDER "${name}" (expected "log" or "resend")`);
  }
}

/**
 * Sends one email. Throws MailError if it could not be handed to the provider,
 * so callers decide whether that fails the request (a verification code) or
 * is only logged (a "new sign-in" notice).
 */
export async function sendMail(message: MailMessage): Promise<MailResult> {
  const provider = getMailProvider();
  const from = process.env.MAIL_FROM || DEFAULT_FROM;
  const result = await provider.send({ ...message, from });
  if (provider.name !== 'log') {
    // Never log the body: it can contain codes and invite links.
    console.log(`[mail:${provider.name}] sent "${message.subject.replace(/\d{6}/g, '######')}" to ${message.to}${result.id ? ` (id ${result.id})` : ''}`);
  }
  return result;
}

/** Absolute URL for links in emails, from APP_URL (e.g. https://streamour.net). */
export function appUrl(path: string): string {
  const base = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
