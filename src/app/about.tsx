import { Screen, T } from '@/components/ui';

const RULES = [
  'Organizations can respond. They can never remove, hide, reorder, or edit what people wrote.',
  'Nothing is sold that changes what is seen or how it ranks.',
  'Only illegal content, personal data, and complaints about private individuals are removed, and every removal is listed in the public removal log.',
  'People who respond for an organization can’t support issues about it.',
  'A fix counts only when the people who raised the issue confirm it.',
];

export default function AboutScreen() {
  return (
    <Screen>
      <T variant="title">How UCS works</T>
      <T>
        The Universal Complaint System is an independent public record of what&apos;s wrong, about anything: a
        company, a product, a public service, or something nobody owns. It isn&apos;t run by any of them.
      </T>
      <T variant="heading">What we promise</T>
      <T>
        Your complaint is counted, merged with everyone who shares it, and visible to the people who can fix it. We
        can&apos;t promise they&apos;ll answer. Everyone can see whether they did.
      </T>
      <T variant="heading">Issues, not posts</T>
      <T>
        A model reads each complaint for the issues it raises: the distinct things that are wrong. Each issue is matched
        to the same issue already on the record, so a hundred complaints about one thing become one issue backed by a
        hundred people. Under every issue is what each complaint said about it, pulled out by the model, and each of
        those opens the complaint in its author&apos;s own words. Wherever the model added a new issue, it is marked.
      </T>
      <T variant="heading">Organizations</T>
      <T>
        Anyone with a verified email at an organization&apos;s domain can respond for it. Each organization&apos;s page
        shows how many issues it has, and what share it has seen, answered, and fixed.
      </T>
      <T variant="heading">The rules</T>
      {RULES.map((r) => (
        <T key={r}>• {r}</T>
      ))}
    </Screen>
  );
}
