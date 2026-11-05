import { Screen, T } from '@/components/ui';

export type LegalSection = { heading: string; body: string[] };

/** A policy page: title, date, then headed sections of plain paragraphs. */
export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: LegalSection[] }) {
  return (
    <Screen>
      <T variant="title">{title}</T>
      <T variant="small">Last updated {updated}</T>
      {sections.map((s) => (
        <LegalBlock key={s.heading} section={s} />
      ))}
    </Screen>
  );
}

function LegalBlock({ section }: { section: LegalSection }) {
  return (
    <>
      <T variant="heading">{section.heading}</T>
      {section.body.map((p, i) => (
        <T key={i}>{p}</T>
      ))}
    </>
  );
}
