import { useQueryClient } from '@tanstack/react-query';

import { api, type Child } from '@/lib/api';
import { useSession } from '@/lib/session';
import { t } from '@/strings.ru';
import { Avatar } from './art/Avatar';
import { CodeModal } from './CodeModal';

type Props = { child: Child; onClose: () => void };

/** Code for the child's phone. Mount with key={child.id}. */
export function PairingCodeModal({ child, onClose }: Props) {
  const qc = useQueryClient();
  const uid = useSession((s) => s.session?.user.id);
  return (
    <CodeModal
      title={t.pairing.title(child.name)}
      steps={t.pairing.steps(child.name)}
      icon={<Avatar id={child.avatar} color={child.color} size={56} />}
      doneText={`${t.childPair.hello(child.name)} ✓`}
      request={() => api.createPairingCode(child.id)}
      isDone={async (issued) => {
        const members = await api.listMembers();
        // A phone of this child linked after the code was issued (server clock on both sides).
        return members.some((m) => m.child_id === child.id && new Date(m.created_at).getTime() >= issued);
      }}
      onDone={() => void qc.invalidateQueries({ queryKey: ['members', uid] })}
      onClose={onClose}
    />
  );
}
