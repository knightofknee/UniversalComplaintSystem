import { Redirect } from 'expo-router';

/** The "New" tab opens the complaint box over the tabs (see the tabs layout); this is never shown. */
export default function NewComplaint() {
  return <Redirect href="/" />;
}
