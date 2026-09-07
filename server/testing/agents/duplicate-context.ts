import type { TestingCatalog, TestingCompiledScenario, TestingVersionRef } from '../../../shared/testing';

/** Stored human/agent definitions remain review subjects; presence in the
 * catalog is not evidence of a duplicate. Other versions of the same component are deliberate version updates, not duplicates. */
export const duplicateReviewSubjects = (compiled: TestingCompiledScenario) => compiled.definitions.filter(item => item.origin !== 'seed');
export const duplicateComparisonCandidates = (subject: TestingVersionRef, catalog: TestingCatalog) => catalog.definitions.filter(item => item.id !== subject.id);
export function duplicateReviewContext(compiled: TestingCompiledScenario, catalog: TestingCatalog): Record<string, string> {
  const subjects = duplicateReviewSubjects(compiled);
  return {
    'pruefgegenstaende.json': JSON.stringify(subjects, null, 2),
    'vergleichskandidaten.json': JSON.stringify(subjects.map(subject => ({ proposed: { id: subject.id, version: subject.version }, name: subject.name,
      versions: catalog.definitions.filter(item=>item.id===subject.id&&item.version!==subject.version).map(({id,version,name})=>({id,version,name})),
      candidates: duplicateComparisonCandidates(subject, catalog).map(({ id, version, name }) => ({ id, version, name })),
      noMatch: { decision: 'new', chosen: null, meaning: 'Keine passende andere Definition. Die eigene gespeicherte Version wird beibehalten.' },
    })), null, 2),
  };
}
