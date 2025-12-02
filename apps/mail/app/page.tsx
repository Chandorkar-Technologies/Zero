import { authProxy } from '@/lib/auth-proxy';
import type { Route } from './+types/page';
import { redirect } from 'react-router';

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const session = await authProxy.api.getSession({ headers: request.headers });
  // If logged in, go to inbox; otherwise go to login
  if (session?.user?.id) {
    throw redirect('/mail/inbox');
  }
  throw redirect('/login');
}

export default function Home() {
  // This should never render since we always redirect
  return null;
}
