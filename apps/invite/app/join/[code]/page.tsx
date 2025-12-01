import { redirect } from 'next/navigation';

export const runtime = 'edge';

// This page handles referral links - /join/abc123
// It redirects to the main page with the referral code as a query parameter

export default function ReferralRedirect({ params }: { params: { code: string } }) {
  redirect(`/?ref=${params.code}`);
}
