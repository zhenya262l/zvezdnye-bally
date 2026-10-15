import { BagIcon, ChestIcon, PersonIcon, StarIcon } from '@/components/art/Icons';
import { TabsShell } from '@/components/TabsShell';
import { t } from '@/strings.ru';

export default function ChildTabs() {
  return (
    <TabsShell
      role="child"
      tabs={[
        { name: 'today', title: t.childTabs.today, icon: (c) => <StarIcon color={c} /> },
        { name: 'shop', title: t.childTabs.shop, icon: (c) => <BagIcon color={c} /> },
        { name: 'dreams', title: t.childTabs.dreams, icon: (c) => <ChestIcon color={c} /> },
        { name: 'me', title: t.childTabs.me, icon: (c) => <PersonIcon color={c} /> },
      ]}
    />
  );
}
