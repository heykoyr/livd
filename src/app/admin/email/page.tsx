import { Badge, Card, EmptyState } from '@/components/ui/primitives';
import { SITE } from '@/config/site';
import { copy } from '@/content/copy';
import { hasRole } from '@/server/auth/guards';
import { getCurrentUser } from '@/server/auth/session';
import { hasMailProvider, senderIdentity } from '@/server/notify/transport';
import { DeliveryTestControls } from './controls';

/**
 * Email delivery.
 *
 * What this deployment will send as, and a way to prove it by sending.
 *
 * The identity panel is read from the running deployment rather than from
 * documentation, because the failure it exists to catch is a difference
 * between the two: a `LIVD_EMAIL_FROM` set on Preview and not Production, a
 * key added without a redeploy, an origin that is still a Vercel hostname.
 * Whether the key is present is shown; the key itself never reaches a page.
 *
 * The page is gated for display only. The action re-checks the tier itself,
 * because a Server Action is reachable by a direct POST whether or not anybody
 * rendered this.
 */

export const dynamic = 'force-dynamic';

export const metadata = {
  title: `${copy.admin.emailDelivery} — ${copy.admin.title}`,
  robots: { index: false, follow: false, nocache: true },
};

export default async function EmailDeliveryPage() {
  const viewer = await getCurrentUser();

  if (!viewer || !hasRole(viewer, 'admin')) {
    return (
      <EmptyState
        title="Not available"
        description="The delivery check sends every message Livd can send, including Trust & Safety escalations, so it is limited to administrators."
      />
    );
  }

  const identity = senderIdentity();
  const configured = hasMailProvider();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="font-display text-title-lg tracking-tightish text-ink">
          {copy.admin.emailDelivery}
        </h2>
        <p className="mt-1 max-w-prose text-label text-ink-muted">
          What this deployment sends as, and a check that sends every message in the catalogue to
          you — through the same provider, identity and links a real notification uses.
        </p>
      </div>

      <Card className="flex flex-col gap-4 p-5">
        <h3 className="text-label font-medium text-ink">This deployment</h3>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-label sm:grid-cols-[max-content_minmax(0,1fr)]">
          <dt className="text-ink-subtle">Provider</dt>
          <dd className="min-w-0">
            {configured ? (
              <Badge tone="positive">Resend — key present</Badge>
            ) : (
              <Badge tone="caution">No key — messages are logged, not sent</Badge>
            )}
          </dd>

          <dt className="text-ink-subtle">From</dt>
          <dd className="min-w-0 break-words font-mono text-ink">{identity.from}</dd>

          <dt className="text-ink-subtle">Reply-To</dt>
          <dd className="min-w-0 break-words font-mono text-ink">
            {identity.replyTo ?? 'none — replies go to the From address'}
          </dd>

          <dt className="text-ink-subtle">Links point at</dt>
          <dd className="min-w-0 break-words font-mono text-ink">{SITE.url}</dd>
        </dl>
        <p className="max-w-prose text-label text-ink-muted">
          Sign-in links are not sent from here. Supabase Auth sends those itself, through the SMTP
          settings in its own dashboard, and nothing on this page can change or test them.
        </p>
      </Card>

      <DeliveryTestControls recipient={viewer.email} />
    </div>
  );
}
