import 'server-only';

/**
 * Sending an email.
 *
 * One function, two implementations, chosen by whether a provider key is
 * configured — the same pattern as the data layer and the session layer, and
 * for the same reason: a founder who has cloned the repository must be able to
 * exercise every flow, email included, without signing up for anything.
 *
 * **Resend** is the provider. It is an HTTPS POST with a JSON body, so it adds
 * no dependency to a codebase that has deliberately few, it runs unchanged on
 * every Node runtime Vercel offers, and its failure mode is an HTTP status
 * rather than a socket that hangs. The alternatives were considered and lost
 * on one of those three: SMTP needs a client library and long-lived
 * connections that serverless handles badly, and Supabase's own mailer sends
 * authentication mail only.
 *
 * **The console transport** is what runs with no key. It prints the subject,
 * the recipient's domain and the first line, and reports success — because a
 * development environment that cannot send email should not make review
 * submission fail.
 *
 * Nothing here throws. A transport that throws turns "the confirmation email
 * bounced" into "the review was not published", which is the wrong trade in
 * every case.
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** RFC 8058 and friends. Merged over the provider's own. */
  headers?: Record<string, string>;
}

export type SendResult =
  | { ok: true; provider: 'resend' | 'console'; id: string | null }
  | { ok: false; provider: 'resend' | 'console'; error: string };

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** How long to wait on the provider before giving up on this attempt. */
const TIMEOUT_MS = 10_000;

/**
 * Whether a real provider is configured.
 *
 * Read at call time rather than at module scope so a test can set the variable
 * and so a missing key never fails a build.
 */
export function hasMailProvider(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}

/**
 * The From identity.
 *
 * Must be an address on a domain verified with the provider. Livd's own
 * identity, never the provider's — an email that arrives as "Supabase Auth"
 * or "onboarding@resend.dev" tells the reader they are inside somebody's
 * plumbing.
 */
function fromAddress(): string {
  return process.env.LIVD_EMAIL_FROM ?? 'Livd <notifications@livd.app>';
}

function replyTo(): string | null {
  return process.env.LIVD_EMAIL_REPLY_TO ?? null;
}

/** The domain only. What is safe to put in a log — see the note in `notify`. */
export function recipientDomain(address: string): string {
  const at = address.lastIndexOf('@');
  return at === -1 ? 'unknown' : address.slice(at + 1);
}

export async function sendEmail(email: OutgoingEmail): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    console.info(
      `[livd] email (not sent — no RESEND_API_KEY): "${email.subject}" → @${recipientDomain(
        email.to,
      )}`,
    );
    return { ok: true, provider: 'console', id: null };
  }

  const reply = replyTo();

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [email.to],
        subject: email.subject,
        html: email.html,
        text: email.text,
        ...(reply ? { reply_to: reply } : {}),
        ...(email.headers ? { headers: email.headers } : {}),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // The provider's message, truncated. It names the cause — an
      // unverified domain, a suppressed address, a malformed From — and none
      // of those are secrets. The recipient is not included.
      const body = await response.text().catch(() => '');
      return {
        ok: false,
        provider: 'resend',
        error: `HTTP ${response.status}: ${body.slice(0, 240)}`,
      };
    }

    const data = (await response.json().catch(() => null)) as { id?: string } | null;
    return { ok: true, provider: 'resend', id: data?.id ?? null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown transport failure';
    return { ok: false, provider: 'resend', error: reason.slice(0, 240) };
  }
}
