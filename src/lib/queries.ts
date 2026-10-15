import { useQuery } from '@tanstack/react-query';

import { api } from './api';
import { useSession } from './session';

export function useChildren() {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({ queryKey: ['children', uid], queryFn: api.listChildren, enabled: !!uid });
}

export function useMembers() {
  const uid = useSession((s) => s.session?.user.id);
  return useQuery({ queryKey: ['members', uid], queryFn: api.listMembers, enabled: !!uid });
}
