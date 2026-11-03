import type { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

/** Mirrors functions/src/categories.ts; keep the keys in sync. */
export const CATEGORIES = [
  { key: 'travel', label: 'Travel', icon: 'airplane' },
  { key: 'money', label: 'Money', icon: 'card' },
  { key: 'tech', label: 'Tech', icon: 'phone-portrait' },
  { key: 'shopping', label: 'Shopping', icon: 'cart' },
  { key: 'food', label: 'Food', icon: 'restaurant' },
  { key: 'health', label: 'Health', icon: 'medkit' },
  { key: 'housing', label: 'Housing', icon: 'home' },
  { key: 'government', label: 'Government', icon: 'business' },
  { key: 'work', label: 'Work', icon: 'briefcase' },
  { key: 'transport', label: 'Transport', icon: 'bus' },
  { key: 'utilities', label: 'Utilities', icon: 'flash' },
  { key: 'media', label: 'Media', icon: 'tv' },
  { key: 'education', label: 'Education', icon: 'school' },
  { key: 'services', label: 'Services', icon: 'construct' },
  { key: 'other', label: 'Other', icon: 'ellipsis-horizontal' },
] as const satisfies readonly { key: string; label: string; icon: ComponentProps<typeof Ionicons>['name'] }[];

export type Category = (typeof CATEGORIES)[number]['key'];

export const categoryLabel = (key: string | null | undefined) =>
  CATEGORIES.find((c) => c.key === key)?.label ?? null;
