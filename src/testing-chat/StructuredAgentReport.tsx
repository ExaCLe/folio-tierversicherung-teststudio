import type { ComponentType, ReactNode } from 'react';

type RecordValue = Record<string, unknown>;
type Source = { label: string; ref: string; kind: string };
const record = (value: unknown): RecordValue | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : undefined;
const string = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
const unique = (values: (string | undefined)[]) => [...new Set(values.filter((item): item is string => !!item))];

type Props = { value: unknown; Text: ComponentType<{ children: string }>; sources?: Source[]; sourceHref?: (source: Source) => string | undefined };

/** Readable views deliberately select human-facing content. The data tab retains every field. */
export function StructuredAgentReport({ value, Text, sources = [], sourceHref }: Props) {
  const root = record(value);
  if (!root) return <HumanItems items={list(value)} Text={Text}/>;
  const documents = [root, ...['draft', 'plan', 'result'].map(key => record(root[key])).filter((item): item is RecordValue => !!item)];
  const sections: ReactNode[] = [];
  const rendered = new Set<string>();
  for (const [documentIndex, data] of documents.entries()) {
    const narrative = unique([string(data.title), string(data.summary), string(data.explanation), string(data.message)]).filter(text => !rendered.has(text));
    narrative.forEach(text => rendered.add(text));
    if (narrative.length) sections.push(<div className="tc-report-narrative" key={`narrative-${documentIndex}`}>{narrative.map(text => <Text key={text}>{text}</Text>)}</div>);
    const questions = list(data.questions).map(record).filter((item): item is RecordValue => !!item);
    if (questions.length) sections.push(<section key={`questions-${documentIndex}`} className="tc-report-section"><h3>Anforderungen und Klärungen</h3><div className="tc-report-questions">{questions.map((question, index) => {
      const text = string(question.text) ?? string(question.question) ?? string(question.summary);
      if (!text) return null;
      const requirement = question.kind === 'requirement';
      const open = question.status === 'open';
      const answer = string(question.answer);
      const why = string(question.why);
      const references = new Set([...strings(question.knowledgeIds), ...strings(question.evidenceIds)]);
      const linked = sources.filter(source => references.has(source.ref) && sourceHref?.(source));
      return <article className="tc-report-question" key={index}>
        <span className={`tc-report-status ${open && !requirement ? 'is-open' : ''}`}>{requirement ? 'Vorgegebene Anforderung' : open ? question.kind === 'research' ? 'Wird untersucht' : 'Klärung offen' : 'Beantwortet'}</span>
        <div className="tc-report-question-text"><Text>{text}</Text></div>
        {answer && answer !== text && <div className="tc-report-answer"><span>{requirement ? 'Prüfergebnis' : 'Antwort'}</span><Text>{answer}</Text></div>}
        {why && open && !requirement && why !== text && why !== answer && <div className="tc-report-reason"><span>Warum das noch geklärt werden muss</span><Text>{why}</Text></div>}
        {!!linked.length && <ul className="tc-report-links" aria-label="Belege zur Aussage">{linked.map(source => <li key={source.ref}><a href={sourceHref!(source)} target="_blank" rel="noreferrer">{source.label}</a></li>)}</ul>}
      </article>;
    })}</div></section>);
    for (const [key, title] of Object.entries({ facts: 'Feststellungen', assumptions: 'Annahmen', errors: 'Fehler', correction: 'Korrektur', decisions: 'Entscheidungen', duplicateDecisions: 'Bausteinvergleich', changes: 'Änderungen', unsupported: 'Noch nicht prüfbar', suggestions: 'Vorschläge', newDefinitions: 'Neue Bausteine', newKnowledge: 'Ergänztes Fachwissen', assertions: 'Erwartete Nachweise' })) {
      const items = list(data[key]);
      if (items.length) sections.push(<section className="tc-report-section" key={`${documentIndex}-${key}`}><h3>{title}</h3><HumanItems items={items} Text={Text}/></section>);
    }
  }
  return <div className="tc-structured-report">{sections}</div>;
}

function HumanItems({ items, Text }: { items: unknown[]; Text: Props['Text'] }) {
  const entries: { title?: string; body: string[] }[] = items.flatMap<{ title?: string; body: string[] }>(item => {
    if (typeof item === 'string' && item.trim()) return [{ body: [item] }];
    const data = record(item);
    if (!data) return [];
    const title = string(data.label) ?? string(data.name) ?? string(data.title);
    const body = unique(['value', 'text', 'summary', 'description', 'explanation', 'reason', 'answer', 'message', 'correction', 'expectedOutcome', 'suggestedBusinessRevision', 'businessMeaning'].map(key => string(data[key]))).filter(text => text !== title);
    if (!title && !body.length) return [];
    return [{ title, body }];
  });
  return <ul className="tc-report-items">{entries.map((entry, index) => <li key={index}>{entry.title && <div className="tc-report-item-title"><Text>{entry.title}</Text></div>}{entry.body.map((text, position) => <Text key={position}>{text}</Text>)}</li>)}</ul>;
}
