import { t } from '@/strings.ru';

// Icons a parent can give a task (system emoji, so the child recognises the task without reading).
export const TASK_ICONS = [
  '⏰', '👋', '🛏️', '💧', '🪥', '👕', '🥣', '🏫',
  '🚶', '📚', '📖', '🎒', '✏️', '🎹', '⚽', '🤸',
  '🍲', '🍽️', '🍎', '🥛', '🌙', '🛁', '💊', '😴',
  '🧸', '👗', '🧽', '🧹', '🤝', '🪴', '🐶', '🗑️',
  '💛', '🤗', '⭐', '🎨', '🧩', '🌟', '🚲', '🙏',
];

export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKEND = [6, 7];

const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** "каждый день", "Будни", "Выходные" or "Пн, Ср, Пт". */
export function daysLabel(days: number[]): string {
  const d = [...days].sort((a, b) => a - b);
  if (same(d, ALL_DAYS)) return t.tasks.everyDay;
  if (same(d, WEEKDAYS)) return t.taskEdit.weekdays;
  if (same(d, WEEKEND)) return t.taskEdit.weekend;
  return d.map((x) => t.weekdays[x - 1]).join(', ');
}
