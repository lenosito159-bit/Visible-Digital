import { Redirect } from 'expo-router';
import { entryRoute, homeFor, useAuth } from '@/lib/auth';

export default function Index() {
  const { user, business } = useAuth();
  return <Redirect href={user ? homeFor(user.role) : entryRoute(business)} />;
}
