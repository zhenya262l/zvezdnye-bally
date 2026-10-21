import { t } from '@/strings.ru';
import { Banner } from './Banner';

type Props = {
  title: string;
  onPicked: (file: File) => void;
  variant?: 'accent' | 'secondary';
  disabled?: boolean;
  testID?: string;
};

/** Native (non-web) fallback: the camera works in the web version for now. */
export function PhotoPicker(_props: Props) {
  return <Banner kind="info" text={t.child.photoWebOnly} />;
}
