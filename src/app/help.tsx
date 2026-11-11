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
        Type your complaint in the box. Nothing is submitted from that screen: Return adds a new line, and Next
        only takes you to the next step.
      </T>
      <T>
        While you type, a line at the bottom of the box shows how spicy the complaint reads and the one thing
        that would make it easier to fix: who it is about, what happened, when, or what would make it right.
      </T>

      <T variant="heading">Spice</T>
      <T>
        Every complaint gets one to five peppers for how heated its language is, not how bad the problem is.
        Swearing at a company or a situation is spicy and fine. Five peppers is over the line: insults or slurs
        aimed at people, including the people who work there. A five is sent back with a few rewrites that keep
        the heat and the facts but aim them at the problem. At least one of them tries to be funny.
      </T>
      <T>
        The pepper beside the meter is Rudy. His face follows the peppers: he beams when it is mild and cries when
        it turns to name-calling.
      </T>

      <T variant="heading">The next step</T>
      <T>
        &quot;Next&quot; sends your text to a model, which finds the issues it raises: the distinct things that are
        wrong. Each issue is matched to the same issue already on the record, or added as a new one, along with what
        your complaint says about it. You see all of this before anything is posted: which issues will be joined or
        added, what you said about each, which companies and topics it is filed under, and whether personal details
        were found.
      </T>
      <T>You can edit the text, drop an issue, untag a page, or go back. Nothing is public until you tap Post.</T>
      <T>
        If something would help that you left out, such as the make and model of a product, it is listed as
        potentially missing. It is a suggestion, never a requirement. After posting, the same list sits on your own
        complaint, where only you see it, and you can add any of them in a line. When you do, your complaint is read
        again with the new detail: it is filed under what you named, what it says about each issue is updated, and if
        the issue is yours alone its wording is updated too.
      </T>

      <T variant="heading">After posting</T>
      <T>
        Your complaint is public, in your own words. Each issue it raised shows how many people share it, and lists
        what your complaint said about it next to what everyone else said. Companies can respond to an issue; they can
        never edit or remove anything. When a company says an issue is fixed, the people who raised it confirm before
        it counts.
      </T>
      <T>
        You can delete a complaint of yours with the bin icon on it. When more people join an issue you raised, you
        are told.
      </T>

      <T variant="heading">Ways to back a complaint</T>
      <T>
        The up arrow on an issue means you have it too. On a complaint, Best rant means you loved reading it, and Easy
        peasy means that, from what its author says, it looks easy to fix. They are counted separately: the arrow says
        how many people share an issue, Best rants picks the rants worth reading, and Easiest lists the complaints
        people think would be easy to fix. You can&apos;t call your own complaint easy. Until enough rants have votes,
        Best rants also lists ones the model rated highly, each labeled as the model&apos;s pick.
      </T>

      <T variant="heading">Fixes</T>
      <T>
        Anyone can propose a fix for an issue: the organization, or someone who found a way around it. The
        people who have the issue are told, and each says whether it fixed it fully, partly, or not at all. An
        issue shows as Fixed only when the people who had it before the fix was proposed say it worked.
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
