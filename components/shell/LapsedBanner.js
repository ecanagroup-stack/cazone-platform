import { formatDate } from '@/lib/format';

// Lapsed billing never blocks selling — only the back office turns read-only, with a single banner
// naming the amount due (platform-ui skill, section 6). There's nothing to sell yet in this core
// layer, so this mostly establishes the rule for packs to inherit rather than gating anything today.
export function isLapsed(org) {
  if (!org || org.freeForever) return false;
  if (org.subscriptionStatus === 'past_due' || org.subscriptionStatus === 'canceled') return true;
  if (org.subscriptionStatus === 'trialing' && org.trialEndsAt && new Date(org.trialEndsAt) < new Date()) return true;
  return false;
}

export default function LapsedBanner({ org }) {
  if (!isLapsed(org)) return null;
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800 text-center">
      Your subscription needs attention — visit <a href="/admin/billing" className="underline font-medium">Billing</a> to sort it out. This won't stop anything you're already doing.
    </div>
  );
}
