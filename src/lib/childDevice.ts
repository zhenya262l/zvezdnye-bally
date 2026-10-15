// Remembers on the child's phone that it was paired before, so that after a
// parent unlinks it the pairing screen can explain what happened.
const WAS_PAIRED_KEY = 'zb-was-paired';

export function wasPaired(): boolean {
  try {
    return globalThis.localStorage?.getItem(WAS_PAIRED_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberPaired() {
  try {
    globalThis.localStorage?.setItem(WAS_PAIRED_KEY, '1');
  } catch {}
}
