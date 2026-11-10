import { LegalPage } from '@/components/legal';

/** Keep in step with the code: every promise here is enforced by functions/src or the security rules. */
export default function PrivacyScreen() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="November 10, 2026"
      sections={[
        {
          heading: 'Who we are',
          body: [
            'The Universal Complaint System (UCS) is an independent public record of what is wrong or could be better, about any organization, product, or thing. It is built and run by The Waldgrave. No organization that people complain about owns or controls it.',
            'This policy explains what we collect, who can see it, and what you can do about it.',
          ],
        },
        {
          heading: 'What we collect',
          body: [
            'An account identifier. The first time you open UCS we create an anonymous account so you can complain without signing up. It is not linked to your name, phone number, or device identifier.',
            'Your email address, only if you sign in. You can sign in with an email and password (we keep a hash of the password) or with Google or Apple, which tell us your email address and nothing else; Apple lets you hide your real address. We use the email to sign you in, to let organizations reply to private complaints you send them, and to verify you if you respond for an organization. We never show it publicly.',
            'A display name we assign at random (for example "Steady Heron"). It is the only name shown next to anything you post. You can swap it for another random one, never one you type.',
            'What you submit: the text of each complaint, any photos you attach, whether you sent it publicly or privately, how it was filed (the points, organizations and topics), and, for private complaints, the conversation that follows.',
            'Your support, "Best rant" votes, fix confirmations and how you rated a proposed fix. We store which points you supported, which complaints you voted for and what you said about each fix so we can notify you and so you can withdraw; only the totals are public. A fix you propose for a point is public, under your display name.',
            'Notifications we send you inside the app, and, if you turn on phone notifications, your phone\'s push token (an address Apple or Google uses to deliver them, through Expo\'s push service).',
            'When you agreed to the terms of use.',
            'Reports you send: what you reported and why. Authors you chose to hide (their complaints are folded shut for you); that list is yours alone.',
            'Complaints you write while complaint checking is paused for the day are saved until they can be checked, then deleted after a week if you don\'t post them.',
            'To stop abuse, a one-way hash of your network address with the times of your recent actions. We never store the address itself, and only recent times are kept.',
            'If you respond for an organization: your work email, the organization, and the result of checking your email domain against the organization\'s website.',
            'Photos are resized and their location data and other metadata are removed on your device before they are uploaded.',
          ],
        },
        {
          heading: 'What is public',
          body: [
            'Public complaints: their text, the photos that pass our checks, your display name, and the points they were filed under. Before a public complaint is posted we offer to remove personal details such as order numbers, phone numbers, and the names of private people; that is on by default.',
            'Counts: how many people support each point, how many points each organization and topic has, and how organizations have responded.',
            'Never public: your email, which points you supported, your fix confirmations, your reports, who you hid, and anything about private complaints except as described below.',
            'Some complaints come from public government records (the Consumer Financial Protection Bureau and NHTSA complaint databases). They are labelled with their source and link to it, and contain only what the agency already published.',
          ],
        },
        {
          heading: 'Private complaints',
          body: [
            'A private complaint goes to one organization. Only you and that organization\'s verified responders can read it and its conversation, and they see your display name and email so they can reach you. Private complaints need a verified email for that reason.',
            'Because a private complaint is a support conversation, details the organization needs, such as order numbers, stay in it. Payment card numbers and security codes, bank account numbers, government ID numbers, passwords and one-time codes are removed from everything you send, public or private.',
            'What a private complaint is about is counted for that organization, so it can see how many people raised each problem. Those counts are not public. An organization may choose to publish its private counts; the words of private complaints are never published.',
            'If someone writes publicly about something that has also been raised privately, they may be told that it was raised privately. They are never told by whom, how many times, or what was said.',
            'If the organization has not joined UCS, your private complaint is held until it does.',
          ],
        },
        {
          heading: 'AI processing',
          body: [
            'When you check a complaint before sending it, its text and photos are sent to Anthropic (Claude) to split it into points, match it to what others have said, suggest how to file it, spot personal data, and rate its tone and how heated its language is (a spice level of one to five peppers; five, name-calling at people, is sent back with suggested rewrites; a rant also gets a score for how good a read it is, which sorts "Best rants"). Complaint and point text is also sent to Google (Vertex AI) to compute the search vectors that make matching work across languages. Photos are also checked by Google Cloud Vision (SafeSearch) for sexual or violent content before anyone else can see them. Both process it on our behalf under their commercial API terms, under which API data is not used to train their models by default.',
            'Nothing is sent to the public record or to an organization until you have seen how it will be filed and confirmed it.',
          ],
        },
        {
          heading: 'Service providers',
          body: [
            'UCS runs on Google Firebase (authentication, database, file storage and server functions) in the United States. Anthropic and Google process complaint text as described above. We do not sell your data or share it with advertisers, and UCS has no ads.',
          ],
        },
        {
          heading: 'Organizations',
          body: [
            'People who respond for an organization must prove a verified email at its domain. They can read public complaints, private complaints sent to their organization, and their organization\'s private counts. They can respond and set statuses. They can never edit or remove what anyone wrote.',
          ],
        },
        {
          heading: 'How long we keep things',
          body: [
            'Complaints and their counts stay on the record while your account exists. Drafts you check but never send are deleted within a day (a week for complaints saved while checking was paused). Content removed for breaking the rules is hidden from everyone and listed in the public removal log. Reports are kept so we can act on repeat abuse.',
            'If you report something, the people who run UCS see the reported item (for a private conversation, the reported message or complaint) so we can act on it. Organizations never see who reported what.',
          ],
        },
        {
          heading: 'Deleting your account',
          body: [
            'Delete your account at any time from Me > Delete account. When you do: your private complaints, their conversations and photos are deleted; your public complaints lose their text, photos and display name, while the points they fed stay on the record without your name because other people share them; every support, "Best rant" vote, fix confirmation and fix rating you gave is withdrawn and the counts drop; fixes you proposed are deleted; your organization access, requests, queued complaints, hidden-author list, notifications, phone tokens and sign-in are deleted; reports you sent stay without your account attached. An organization\'s private counts keep the anonymous number, which contains none of your words.',
          ],
        },
        {
          heading: 'Children',
          body: [
            'UCS is not directed to children under 13, and we do not knowingly collect personal data from them. If you believe a child has given us personal data, contact us and we will delete it.',
          ],
        },
        {
          heading: 'Your choices and rights',
          body: [
            'You can choose public or private for every complaint, remove personal details before posting, withdraw any support or vote, and delete your account. To ask for a copy of your data or a correction, contact us.',
          ],
        },
        {
          heading: 'Changes',
          body: ['If this policy changes, we will update it here and change the date above.'],
        },
        { heading: 'Contact', body: ['bricarlis@gmail.com'] },
      ]}
    />
  );
}
