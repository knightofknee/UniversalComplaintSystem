import { Screen, T } from '@/components/ui';

const RULES = [
  'Organizations can respond. They can never remove, hide, reorder, or edit what people wrote.',
  'Nothing is sold that changes what is seen or how it ranks.',
  'Only illegal content, personal data, and complaints about private individuals are removed, and every removal is listed in the public removal log.',
  'People who respond for an organization can’t support points about it.',
  'A fix counts only when the people who raised the point confirm it.',
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
      <T variant="heading">Points, not posts</T>
      <T>
        A model splits each complaint into points, the specific things that are wrong, and matches them to points
        already on the record, so a hundred people saying the same thing become one point with a hundred
        supporters. Wherever the model added a new point, it is marked. Every complaint stays visible in its
        author&apos;s own words.
      </T>
      <T variant="heading">Organizations</T>
      <T>
        Anyone with a verified email at an organization&apos;s domain can respond for it. Each organization&apos;s page
        shows how many points it has, and what share it has seen, answered, and fixed.
      </T>
      <T variant="heading">The rules</T>
      {RULES.map((r) => (
        <T key={r}>• {r}</T>
      ))}
    </Screen>
  );
}
