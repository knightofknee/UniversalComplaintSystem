import { Linking } from 'react-native';

import { Screen, T } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';

/** The government records UCS was seeded from; Google Play requires the original sources to be linked. */
const RECORD_SOURCES = [
  {
    name: 'Consumer Financial Protection Bureau (CFPB) complaint database',
    url: 'https://www.consumerfinance.gov/data-research/consumer-complaints/',
  },
  { name: 'NHTSA vehicle safety complaints', url: 'https://www.nhtsa.gov/report-a-safety-problem' },
  {
    name: 'FCC consumer complaints data',
    url: 'https://opendata.fcc.gov/Consumer/CGB-Consumer-Complaints-Data/3xyp-aqkj',
  },
];

const RULES = [
  'Organizations can respond. They can never remove, hide, reorder, or edit what people wrote.',
  'Nothing is sold that changes what is seen or how it ranks.',
  'Only illegal content, personal data, and complaints about private individuals are removed, and every removal is listed in the public removal log.',
  'People who respond for an organization can’t support issues about it.',
  'A fix counts only when the people who raised the issue confirm it.',
];

export default function AboutScreen() {
  const theme = useTheme();
  return (
    <Screen>
      <T variant="title">How UCS works</T>
      <T>
        The Universal Complaint System is an independent public record of what&apos;s wrong, about anything: a company,
        a product, a public service, or something nobody owns. It isn&apos;t run by any of them.
      </T>
      <T>
        UCS is not a government app. It isn&apos;t affiliated with, endorsed by, or acting for any government or
        government agency.
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
        hundred people. Each issue shows the complaints behind it, in their authors&apos; own words. Wherever the model
        named a new issue, it says so.
      </T>
      <T variant="heading">Organizations</T>
      <T>
        Anyone with a verified email at an organization&apos;s domain can respond for it. Each organization&apos;s page
        shows how many issues it has, and what share it has seen, answered, and fixed.
      </T>
      <T variant="heading">Public records</T>
      <T>
        To start with, some complaints come from public government records, labelled with their source. Each one links
        to where it came from. The originals:
      </T>
      {RECORD_SOURCES.map((r) => (
        <T key={r.url} color={theme.primary} onPress={() => Linking.openURL(r.url)}>
          • {r.name}: {r.url}
        </T>
      ))}
      <T>
        To file a complaint with one of these agencies, use its own site. Posting on UCS doesn&apos;t file anything with
        them.
      </T>
      <T variant="heading">The rules</T>
      {RULES.map((r) => (
        <T key={r}>• {r}</T>
      ))}
    </Screen>
  );
}
