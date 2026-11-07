import { Composer } from '@/components/composer';

/**
 * The main screen: the complaint box, on its own, over the tabs. The app
 * opens here; the menu button goes back to wherever in the tabs they were.
 */
export default function Home() {
  return <Composer home />;
}
