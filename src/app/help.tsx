import { useRouter } from 'expo-router';

import { Screen, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

/** What happens to a complaint, step by step. Opened from the "?" on the complaint screen. */
export default function HelpScreen() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Screen>

      <T variant="heading">Writing a complaint</T>
      <T>
        Type your complaint in the box. Nothing is submitted from that screen: Return adds a new line, and the
        button below the box only takes you to the next step.
      </T>
      <T>
        While you type, the screen shows how heated the complaint reads and whether it includes the four things
        that make a complaint fixable: who it is about, what happened, when, and what would make it right. It also
        lists similar complaints already on the record. If one of them is yours too, tap the arrow next to it.
      </T>

      <T variant="heading">The next step</T>
      <T>
        &quot;See how it posts&quot; sends your text to a model, which splits it into points: the specific things that are
        wrong. Each point is matched to a point already on the record, or added as a new one. You see all of this
        before anything is posted: which points will be added or joined, which companies and topics it is filed
        under, and whether personal details were found.
      </T>
      <T>You can edit the text, drop a point, untag a page, or go back. Nothing is public until you tap Post.</T>

      <T variant="heading">After posting</T>
      <T>
        Your complaint is public, in your own words. Each of its points shows how many people share it. Companies
        can respond to a point; they can never edit or remove anything. When a company says a point is fixed, the
        people who raised it confirm before it counts.
      </T>

      <T variant="heading">Photos</T>
      <T>
        You can attach up to four photos. They are resized and their metadata, including location, is removed
        before upload. Every photo is checked for unsafe content.
      </T>

      <T variant="heading">Personal details</T>
      <T>
        Names, phone numbers, addresses, account numbers and similar details are removed from public posts by
        default. You can keep them in if you choose to. Card numbers, ID numbers and passwords are always removed.
      </T>

      <T variant="heading">Private complaints</T>
      <T>
        With a verified email, a complaint about a company can be sent to that company only. It is a conversation
        between you and them, and nothing of it is public.
      </T>

      <T variant="heading">Rules</T>
      <T>No threats, hate, harassment, sexual content, or complaints aimed at private people.</T>
      <T color={theme.primary} style={{ fontWeight: '700' }} onPress={() => router.push('/about')}>
        How UCS works
      </T>
      <T color={theme.primary} style={{ fontWeight: '700' }} onPress={() => router.push('/terms')}>
        Terms of use
      </T>
      <T color={theme.primary} style={{ fontWeight: '700' }} onPress={() => router.push('/privacy')}>
        Privacy policy
      </T>
    </Screen>
  );
}
