import { authProxy } from '@/lib/auth-proxy';
import type { Route } from './+types/page';
import { redirect } from 'react-router';
import HomeContent from '@/components/home/HomeContent';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const session = await authProxy.api.getSession({ headers: request.headers });
  // If logged in, go to inbox; otherwise show landing page
  if (session?.user?.id) {
    throw redirect('/mail/inbox');
  }
  return null;
}

export default function Home() {
  // Show landing page for non-logged-in users
  return <HomeContent />;
}
