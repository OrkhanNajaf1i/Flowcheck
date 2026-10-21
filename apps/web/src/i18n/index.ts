import { az } from './az';
import { type Dict, en } from './en';

export const LANGUAGES = { en: 'English', az: 'Azərbaycanca' } as const;
export type Language = keyof typeof LANGUAGES;

const DICTIONARIES: Record<Language, Dict> = { en, az };
const STORAGE_KEY = 'flowcheck.language';

function detectLanguage(): Language {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'az') return stored;
  } catch {
    // Storage can be blocked; fall back to the browser language.
  }
  return globalThis.navigator?.language?.toLowerCase().startsWith('az') ? 'az' : 'en';
}

/** Chosen once at startup; switching languages reloads the page (simple and predictable). */
export const language: Language = detectLanguage();
export const t: Dict = DICTIONARIES[language];

export function setLanguage(next: Language): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Ignore: the choice just won't persist.
  }
  globalThis.location?.reload();
}
