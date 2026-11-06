import { Colors, type Palette } from '@/constants/theme';
import { useScheme } from '@/lib/appearance';

export function useTheme(): Palette {
  return useScheme() === 'dark' ? Colors.dark : Colors.light;
}
