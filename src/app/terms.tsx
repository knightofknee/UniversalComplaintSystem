import { LegalPage } from '@/components/legal';

export default function TermsScreen() {
  return (
    <LegalPage
      title="Terms of use"
      updated="November 5, 2026"
      sections={[
        {
          heading: 'What UCS is (and isn\'t)',
          body: [
            'The Universal Complaint System is an independent record of what people say is wrong or could be better, built by The Waldgrave. It is not run by, endorsed by, or acting for any organization complained about.',
            'UCS records complaints, groups them, and puts them in front of the organizations that can act on them. We do not promise that any organization will respond or fix anything.',
          ],
        },
        {
          heading: 'Your account',
          body: [
            'You can complain publicly without an account. Private complaints and responding for an organization need a verified email. Keep your password to yourself; you are responsible for what is done with your account.',
          ],
        },
        {
          heading: 'What you can post',
          body: [
            'Complain about organizations, products, services, public bodies, and things. Be honest and specific: say what happened, not what you imagine.',
            'Do not: name or target private individuals (front-line staff included); post anything illegal, threatening, harassing, hateful, or sexual; post someone else\'s personal data; post spam, ads, or deliberately false claims; impersonate a person or organization; or try to inflate or deflate counts, for example with multiple accounts.',
            'Rants are welcome. Abuse is not: UCS has zero tolerance for threats, hate, harassment, sexual content, and posts aimed at private people. They are refused before they are posted, removed when reported, and the accounts behind them are suspended.',
            'Anyone can report anything, and hide an author\'s complaints from themselves. Either side of a private conversation can block the other. We review every report within a day.',
          ],
        },
        {
          heading: 'Your content',
          body: [
            'You agree to these terms before your first post, message or response.',
            'You keep ownership of what you write. By posting publicly you let us host, display, translate, group and process it (including with AI) as part of the public record, and keep showing it as long as it stays on the record. A private complaint is shown only to you and the organization you sent it to.',
            'Before anything is sent you see how it will be filed; you are responsible for what you choose to send.',
          ],
        },
        {
          heading: 'AI',
          body: [
            'A model splits complaints into points, matches them with what others have said, suggests how to file them, and offers clearer wording. It can be wrong. You can leave out points, change how a complaint is filed, and keep your own words. Every place the model added something to the record is labeled.',
          ],
        },
        {
          heading: 'For organizations',
          body: [
            'Respond only for an organization you are authorized to speak for. Responses are public and carry your organization\'s name and email domain.',
            'Use private complaints only to resolve them. Never ask anyone for a password, card number, or one-time code through UCS.',
            'Organizations cannot remove, hide, reorder or edit anything people wrote. A fix counts as fixed only when the people who raised it confirm it.',
          ],
        },
        {
          heading: 'Removals',
          body: [
            'We remove only content that breaks these terms: illegal content, abuse, personal data, and complaints about private individuals. We list every public removal in the public removal log. Paying, complaining, reporting, or being the organization concerned does not get criticism removed.',
          ],
        },
        {
          heading: 'Fair use',
          body: [
            'Actions are rate limited, and the AI that checks complaints has a daily limit; complaints written past it are saved and checked the next day. We suspend accounts that abuse UCS or try to get around its limits.',
          ],
        },
        {
          heading: 'Disclaimers',
          body: [
            'UCS is provided "as is" without warranties of any kind. Complaints are the views of the people who wrote them, not of The Waldgrave. To the fullest extent permitted by law, The Waldgrave is not liable for indirect, incidental, or consequential damages arising from your use of UCS.',
          ],
        },
        {
          heading: 'Changes and termination',
          body: [
            'We may change these terms and will update the date above when we do. You can stop using UCS and delete your account at any time.',
          ],
        },
        { heading: 'Governing law', body: ['These terms are governed by the laws of the State of Illinois.'] },
        { heading: 'Contact', body: ['bricarlis@gmail.com'] },
      ]}
    />
  );
}
