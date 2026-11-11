import type { Language } from '@/types';
import { SUPPORTED_LANGUAGES } from '@/utils/constants';

export const isSupportedLanguage = (value: string): value is Language =>
  SUPPORTED_LANGUAGES.includes(value as Language);

export const getInitialLanguage = (): Language => 'en';
