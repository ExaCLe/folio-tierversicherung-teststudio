import type { TestingCatalog, TestingCompiledScenario, TestingVersionRef } from '../../../shared/testing';
import { testingVersionKey } from '../../../shared/testing';

/** Stored human/agent definitions remain review subjects; presence in the
 * catalog is not evidence of a duplicate. Only a different version pair can be one. */
export const duplicateReviewSubjects = (compiled: TestingCompiledScenario) => compiled.definitions.filter(item => item.origin !== 'seed');
export const duplicateComparisonCandidates = (subject: TestingVersionRef, catalog: TestingCatalog) => catalog.definitions.filter(item => testingVersionKey(item) !== testingVersionKey(subject));
export function duplicateReviewContext(compiled: TestingCompiledScenario, catalog: TestingCatalog): Record<string, string> {
  const subjects = duplicateReviewSubjects(compiled);
  return {
    'pruefgegenstaende.json': JSON.stringify(subjects, null, 2),
    'vergleichskandidaten.json': JSON.stringify(subjects.map(subject => ({ proposed: { id: subject.id, version: subject.version }, name: subject.name,
      candidates: duplicateComparisonCandidates(subject, catalog).map(({ id, version, name }) => ({ id, version, name })),
      noMatch: { decision: 'new', chosen: null, meaning: 'Keine passende andere Definition. Die eigene gespeicherte Version wird beibehalten.' },
    })), null, 2),
  };
}
