import { useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { usePalette } from '@/theme';
import { KidsIcon } from './art/Icons';
import { CodeModal } from './CodeModal';

/** Code for the second parent. Mount with a fresh key each time. */
export function ParentInviteModal({ onClose }: { onClose: () => void }) {
  const p = usePalette();
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  return (
    <CodeModal
      title={t.family.inviteTitle}
      steps={t.family.inviteSteps}
      icon={<KidsIcon color={p.primary} size={40} />}
      doneText={t.family.inviteJoined}
      request={api.createParentInvite}
      isDone={async (issued) => {
        const members = await api.listMembers();
        return members.some(
          (m) => m.role === 'parent' && m.user_id !== uid && new Date(m.created_at).getTime() >= issued,
        );
      }}
      onDone={() => void qc.invalidateQueries({ queryKey: ['members', uid] })}
      onClose={onClose}
    />
  );
}
