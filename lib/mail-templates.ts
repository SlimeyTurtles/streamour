// Transactional email templates. Each returns a subject, a plain-text body and
// a simple HTML body. Anything interpolated into HTML goes through escapeHtml.

export interface MailContent {
  subject: string;
  text: string;
  html: string;
}

const APP_NAME = 'Streamour';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface LayoutParts {
  heading: string;
  /** Paragraphs of already-escaped HTML. */
  paragraphs: string[];
  button?: { label: string; url: string };
  /** Shown large and monospaced, for one-time codes. */
  code?: string;
  footnote?: string;
}

function layout({ heading, paragraphs, button, code, footnote }: LayoutParts): string {
  const body = paragraphs
    .map(p => `<p style="margin:0 0 16px;line-height:1.5;">${p}</p>`)
    .join('');
  const buttonHtml = button
    ? `<p style="margin:24px 0;"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#e50914;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:6px;">${escapeHtml(button.label)}</a></p>` +
      `<p style="margin:0 0 16px;font-size:13px;color:#666666;line-height:1.5;">Or paste this link into your browser:<br>${escapeHtml(button.url)}</p>`
    : '';
  const codeHtml = code
    ? `<p style="margin:24px 0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:6px;">${escapeHtml(code)}</p>`
    : '';
  const footnoteHtml = footnote
    ? `<p style="margin:24px 0 0;font-size:13px;color:#666666;line-height:1.5;">${footnote}</p>`
    : '';

  return (
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">` +
    `<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">` +
    `<p style="margin:0 0 24px;font-weight:700;color:#e50914;">${APP_NAME}</p>` +
    `<h1 style="margin:0 0 16px;font-size:20px;">${escapeHtml(heading)}</h1>` +
    body +
    codeHtml +
    buttonHtml +
    footnoteHtml +
    `</div></body></html>`
  );
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function inviteEmail(params: {
  inviterName: string;
  inviteUrl: string;
  expiresAt: Date;
}): MailContent {
  const { inviterName, inviteUrl, expiresAt } = params;
  const expires = formatDate(expiresAt);
  return {
    subject: `${inviterName} invited you to ${APP_NAME}`,
    text:
      `${inviterName} invited you to join ${APP_NAME}.\n\n` +
      `Accept the invite and create your account:\n${inviteUrl}\n\n` +
      `This invite expires on ${expires}. If you weren't expecting it, you can ignore this email.\n`,
    html: layout({
      heading: `You're invited to ${APP_NAME}`,
      paragraphs: [
        `${escapeHtml(inviterName)} invited you to join ${APP_NAME}.`,
      ],
      button: { label: 'Accept invite', url: inviteUrl },
      footnote: `This invite expires on ${escapeHtml(expires)}. If you weren't expecting it, you can ignore this email.`,
    }),
  };
}

export function verifyEmailEmail(params: { code: string; expiresInMinutes: number }): MailContent {
  const { code, expiresInMinutes } = params;
  return {
    subject: `${code} is your ${APP_NAME} verification code`,
    text:
      `Enter this code to verify your email address:\n\n${code}\n\n` +
      `It expires in ${expiresInMinutes} minutes. If you didn't create a ${APP_NAME} account, you can ignore this email.\n`,
    html: layout({
      heading: 'Verify your email',
      paragraphs: ['Enter this code to verify your email address:'],
      code,
      footnote: `It expires in ${expiresInMinutes} minutes. If you didn't create a ${APP_NAME} account, you can ignore this email.`,
    }),
  };
}

export type CodePurpose = 'sign-in' | 'password-reset' | 'switch-account';

const CODE_PURPOSE_TEXT: Record<CodePurpose, { subject: string; heading: string; intro: string }> = {
  'sign-in': {
    subject: 'sign-in code',
    heading: 'Your sign-in code',
    intro: 'Enter this code to finish signing in:',
  },
  'password-reset': {
    subject: 'password reset code',
    heading: 'Reset your password',
    intro: 'Enter this code to reset your password:',
  },
  'switch-account': {
    subject: 'account switch code',
    heading: 'Someone wants to switch to your account',
    intro: 'Enter this code on the shared device to allow switching to your account:',
  },
};

export function codeEmail(params: {
  code: string;
  purpose: CodePurpose;
  expiresInMinutes: number;
}): MailContent {
  const { code, purpose, expiresInMinutes } = params;
  const copy = CODE_PURPOSE_TEXT[purpose];
  const warning = `It expires in ${expiresInMinutes} minutes. If you didn't ask for this code, someone may be trying to use your account. Don't share it with anyone.`;
  return {
    subject: `${code} is your ${APP_NAME} ${copy.subject}`,
    text: `${copy.intro}\n\n${code}\n\n${warning}\n`,
    html: layout({
      heading: copy.heading,
      paragraphs: [copy.intro],
      code,
      footnote: warning,
    }),
  };
}

export function newSignInEmail(params: {
  when: Date;
  userAgent?: string | null;
  ip?: string | null;
  sessionsUrl: string;
}): MailContent {
  const { when, userAgent, ip, sessionsUrl } = params;
  const whenText = `${when.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  const details = [
    `When: ${whenText}`,
    userAgent ? `Device: ${userAgent}` : null,
    ip ? `IP address: ${ip}` : null,
  ].filter((line): line is string => line !== null);

  return {
    subject: `New sign-in to your ${APP_NAME} account`,
    text:
      `Your ${APP_NAME} account was just signed in to.\n\n` +
      `${details.join('\n')}\n\n` +
      `If this was you, there's nothing to do. If not, sign that device out and change your password:\n${sessionsUrl}\n`,
    html: layout({
      heading: 'New sign-in to your account',
      paragraphs: [
        `Your ${APP_NAME} account was just signed in to.`,
        details.map(escapeHtml).join('<br>'),
        `If this was you, there's nothing to do. If not, sign that device out and change your password.`,
      ],
      button: { label: 'Review sessions', url: sessionsUrl },
    }),
  };
}
