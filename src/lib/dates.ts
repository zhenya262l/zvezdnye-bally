import { t } from '@/strings.ru';

export const FAMILY_TZ = 'Europe/Minsk';

/** Today's date (YYYY-MM-DD) in the family time zone. */
export function todayISO(tz: string = FAMILY_TZ): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    new Date(),
  );
}

export function parseISODate(s: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

/** Full years between birth date and `today` (both YYYY-MM-DD). */
export function ageYears(birthISO: string, today: string = todayISO()): number | null {
  const b = parseISODate(birthISO);
  const n = parseISODate(today);
  if (!b || !n) return null;
  let age = n.y - b.y;
  if (n.m < b.m || (n.m === b.m && n.d < b.d)) age -= 1;
  return age;
}

export function pluralRu(n: number, forms: readonly [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export function formatAge(birthISO: string, today?: string): string {
  const a = ageYears(birthISO, today);
  if (a === null || a < 0) return '';
  return `${a} ${pluralRu(a, t.common.yearsForms)}`;
}

/** "5 октября" */
export function formatDayMonth(iso: string): string {
  const p = parseISODate(iso);
  if (!p) return '';
  return `${p.d} ${t.months[p.m - 1]}`;
}

/** "5 октября 2017" */
export function formatDate(iso: string): string {
  const p = parseISODate(iso);
  if (!p) return '';
  return `${p.d} ${t.months[p.m - 1]} ${p.y}`;
}

/** "15 октября, 19:42" in the family time zone. */
export function formatDateTime(ts: string, tz: string = FAMILY_TZ): string {
  const d = new Date(ts);
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: tz, day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  }).format(d);
  return parts;
}

export function isValidBirthDate(iso: string, today: string = todayISO()): boolean {
  return !!parseISODate(iso) && iso >= '2000-01-01' && iso <= today;
}
