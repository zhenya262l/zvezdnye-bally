import { HouseIcon, KidsIcon, PenIcon, SlidersIcon } from '@/components/art/Icons';
import { TabsShell } from '@/components/TabsShell';
import { t } from '@/strings.ru';

export default function ParentTabs() {
  return (
    <TabsShell
      role="parent"
      tabs={[
        { name: 'approvals', title: t.parentTabs.approvals, icon: (c) => <PenIcon color={c} /> },
        { name: 'kids', title: t.parentTabs.kids, icon: (c) => <KidsIcon color={c} /> },
        { name: 'settings', title: t.parentTabs.settings, icon: (c) => <SlidersIcon color={c} /> },
        { name: 'family', title: t.parentTabs.family, icon: (c) => <HouseIcon color={c} /> },
      ]}
    />
  );
}
