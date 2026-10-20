import type { Consent } from '@/lib/api';
import { formatDate } from '@/lib/dates';
import { t } from '@/strings.ru';
import { brand } from '@/theme';
import { Card } from './Card';
import { CheckRow } from './CheckRow';
import { T } from './T';

type Props = { consent: NonNullable<Consent>; checked: boolean; onChange: (v: boolean) => void };

/**
 * The full consent text and the tick. The law asks to show this information
 * before consent is given, in the same form (here: on screen).
 */
export function ConsentBox({ consent, checked, onChange }: Props) {
  return (
    <Card title={t.consent.title} accent={brand.violet}>
      <T v="small" muted>
        {t.consent.version(consent.id, formatDate(consent.created_at.slice(0, 10)))}
      </T>
      <T v="small" testID="consent-text" selectable>
        {consent.body}
      </T>
      <CheckRow testID="consent-check" checked={checked} onChange={onChange} label={t.consent.agree} />
      {!checked ? (
        <T v="small" muted>
          {t.consent.hint}
        </T>
      ) : null}
    </Card>
  );
}
