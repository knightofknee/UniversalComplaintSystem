/** The fixed top-level categories every subject belongs to (mirrored in src/lib/categories.ts). */
export const CATEGORIES = [
  'travel',
  'money',
  'tech',
  'shopping',
  'food',
  'health',
  'housing',
  'government',
  'work',
  'transport',
  'utilities',
  'media',
  'education',
  'services',
  'other',
] as const;
export type Category = (typeof CATEGORIES)[number];
