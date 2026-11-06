import { Redirect } from 'expo-router';

/** The tab bar's "Complain" goes back to the complaint box (see the tabs layout). */
export default function NewComplaint() {
  return <Redirect href="/" />;
}
