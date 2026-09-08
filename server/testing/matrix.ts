import type { TestingBlockInstance, TestingCatalog, TestingInput, TestingMatrix, TestingMatrixColumn, TestingScenario, TestingValidationIssue, TestingValue } from '../../shared/testing';
import { isTestingParameter, isTestingReference, testingValueTypeLabels, testingVersionKey } from '../../shared/testing';
class MatrixModelError extends Error { constructor(message: string, public status = 400, public code = 'MATRIX_INVALID') { super(message); } }

const MAX_MATRIX_ROWS = 100;
const MAX_MATRIX_COLUMNS = 20;
const safeId = (value: string) => /^[a-zA-Z0-9_.-]+$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);

type Target = { block: TestingBlockInstance; definitionInputs: TestingInput[]; overrideOwner?: TestingBlockInstance; overridePath?: string };
function findTarget(scenario: TestingScenario, catalog: TestingCatalog, wanted: string): Target | undefined {
  const definitions = new Map(catalog.definitions.map(item => [testingVersionKey(item), item]));
  function walk(blocks: TestingBlockInstance[], parent: string, owner?: TestingBlockInstance, relativeParent = ''): Target | undefined {
    for (const block of blocks) {
      const path = parent ? `${parent}/${block.id}` : block.id;
      const relative = relativeParent ? `${relativeParent}/${block.id}` : block.id;
      const definition = definitions.get(testingVersionKey(block.definition));
      if (path === wanted && definition) return { block, definitionInputs: definition.inputs, ...(owner ? { overrideOwner: owner, overridePath: relative } : {}) };
      if (!definition) continue;
      const body = block.children ?? definition.body ?? [];
      const nested = block.children
        ? walk(body, path)
        : walk(body, path, owner ?? block, owner ? relative : '');
      if (nested) return nested;
    }
  }
  return walk(scenario.blocks, '');
}
function inputAt(inputs: TestingInput[], path: string): TestingInput | undefined {
  let current: TestingInput | undefined;
  for (const key of path.split('.')) { current = inputs.find(item => item.key === key); inputs = current?.fields ?? []; }
  return current;
}
function valueError(value: TestingValue, input: TestingInput): string | undefined {
  if (isTestingReference(value) || isTestingParameter(value)) return 'Matrixwerte müssen konkrete Werte sein; Referenzen und Parameter sind nicht zulässig.';
  if ((input.type === 'number' || input.type === 'money') && (typeof value !== 'number' || !Number.isFinite(value))) return 'benötigt eine Zahl.';
  if (input.type === 'boolean' && typeof value !== 'boolean') return 'benötigt Ja oder Nein.';
  if (['text', 'choice', 'date'].includes(input.type) && typeof value !== 'string') return 'benötigt Text.';
  if (input.type === 'date' && typeof value === 'string' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) return 'benötigt ein Datum als JJJJ-MM-TT.';
  if (input.type === 'choice' && !input.options?.some(option => option.value === value)) return 'enthält keinen zulässigen Auswahlwert.';
  if (typeof value === 'number' && (input.minimum !== undefined && value < input.minimum || input.maximum !== undefined && value > input.maximum)) return 'liegt außerhalb des zulässigen Bereichs.';
  if (input.type === 'list' && !Array.isArray(value)) return 'benötigt eine Liste.';
  if (input.type === 'object' && (!value || typeof value !== 'object' || Array.isArray(value))) return 'benötigt benannte Felder.';
}
export function validateTestingMatrix(scenario: TestingScenario, catalog: TestingCatalog): TestingValidationIssue[] {
  const matrix = scenario.matrix; if (!matrix) return [];
  const issues: TestingValidationIssue[] = [], columns = new Map<string, { column: TestingMatrixColumn; target: Target; input: TestingInput }>();
  const add = (code: string, message: string, column?: TestingMatrixColumn) => issues.push({ code, message, severity: 'error', path: column?.target.blockPath, field: column?.target.inputPath });
  if (!Array.isArray(matrix.columns) || !matrix.columns.length) add('MATRIX_COLUMNS', 'Die Testmatrix braucht mindestens eine Spalte.');
  if ((matrix.columns?.length ?? 0) > MAX_MATRIX_COLUMNS) add('MATRIX_COLUMN_LIMIT', `Eine Testmatrix darf höchstens ${MAX_MATRIX_COLUMNS} Spalten enthalten.`);
  if (!Array.isArray(matrix.rows) || !matrix.rows.length) add('MATRIX_ROWS', 'Die Testmatrix braucht mindestens eine Zeile.');
  if ((matrix.rows?.length ?? 0) > MAX_MATRIX_ROWS) add('MATRIX_LIMIT', `Eine Testmatrix darf höchstens ${MAX_MATRIX_ROWS} Zeilen enthalten.`);
  const targets = new Set<string>();
  for (const column of matrix.columns ?? []) {
    if (!column?.id || !safeId(column.id) || columns.has(column.id)) { add('MATRIX_COLUMN_ID', 'Matrixspalten brauchen eindeutige, sichere IDs.', column); continue; }
    const target = findTarget(scenario, catalog, column.target?.blockPath);
    const input = target && inputAt(target.definitionInputs, column.target?.inputPath ?? '');
    if (!target) { add('MATRIX_TARGET', `Die Matrixspalte „${column.label}“ verweist auf den fehlenden Block „${column.target?.blockPath}“.`, column); continue; }
    if (!input) { add('MATRIX_INPUT', `Die Matrixspalte „${column.label}“ verweist auf das unbekannte Eingabefeld „${column.target?.inputPath}“.`, column); continue; }
    if (!['text','number','money','boolean','date','choice'].includes(input.type)) { add('MATRIX_TARGET_UNSUPPORTED', `Die Matrixspalte „${column.label}“ muss auf ein einzelnes Text-, Zahlen-, Datums-, Auswahl- oder Ja/Nein-Feld zeigen. Ganze Objekte, Listen und Laufreferenzen werden noch nicht unterstützt.`, column); continue; }
    const targetKey = `${column.target.blockPath}::${column.target.inputPath}`;
    if (targets.has(targetKey)) { add('MATRIX_TARGET_DUPLICATE', `Das Zielfeld von „${column.label}“ wird bereits durch eine andere Matrixspalte gesetzt.`, column); continue; }
    targets.add(targetKey);
    if (column.type !== input.type) { add('MATRIX_TYPE', `Die Matrixspalte „${column.label}“ ist als „${testingValueTypeLabels[column.type]}“ deklariert, das Zielfeld verlangt aber „${testingValueTypeLabels[input.type]}“.`, column); continue; }
    columns.set(column.id, { column, target, input });
  }
  const rowIds = new Set<string>(); let enabled = 0;
  for (const [index, row] of (matrix.rows ?? []).entries()) {
    const label = row?.label || `Zeile ${index + 1}`;
    if (!row?.id || !safeId(row.id) || rowIds.has(row.id)) add('MATRIX_ROW_ID', `${label} braucht eine eindeutige, sichere ID.`); else rowIds.add(row.id);
    if (row?.enabled) enabled++;
    for (const id of Object.keys(row?.values ?? {})) if (!columns.has(id)) add('MATRIX_VALUE_UNKNOWN', `${label} enthält einen Wert für die unbekannte Spalte „${id}“.`);
    for (const [id, resolved] of columns) {
      if (!Object.hasOwn(row?.values ?? {}, id)) { add('MATRIX_VALUE_MISSING', `${label} enthält keinen Wert für „${resolved.column.label}“.`, resolved.column); continue; }
      const problem = valueError(row.values[id], resolved.input); if (problem) add('MATRIX_VALUE_INVALID', `${label}: „${resolved.column.label}“ ${problem}`, resolved.column);
    }
  }
  if (!enabled && matrix.rows?.length) add('MATRIX_ENABLED', 'Die Testmatrix braucht mindestens eine aktivierte Zeile.');
  return issues;
}
function setNested(base: Record<string, TestingValue>, path: string, value: TestingValue) {
  const keys = path.split('.'), top = keys.shift()!;
  if (!keys.length) { base[top] = structuredClone(value); return; }
  const existing = base[top]; const object = existing && typeof existing === 'object' && !Array.isArray(existing) ? structuredClone(existing) as Record<string, TestingValue> : {};
  let cursor = object; for (const [index, key] of keys.entries()) { if (index === keys.length - 1) cursor[key] = structuredClone(value); else { const next = cursor[key]; cursor = cursor[key] = next && typeof next === 'object' && !Array.isArray(next) ? structuredClone(next) as Record<string, TestingValue> : {}; } }
  base[top] = object;
}
export function scenarioForTestingMatrixRow(scenario: TestingScenario, catalog: TestingCatalog, rowId: string): TestingScenario {
  const copy = structuredClone(scenario), matrix = copy.matrix, row = matrix?.rows.find(item => item.id === rowId);
  if (!matrix || !row || !row.enabled) throw new MatrixModelError('Diese Matrixzeile ist nicht vorhanden oder deaktiviert.', 400, 'MATRIX_ROW_INVALID');
  const errors = validateTestingMatrix(copy, catalog); if (errors.length) throw new MatrixModelError(errors.map(item => item.message).join(' '));
  for (const column of matrix.columns) {
    const target = findTarget(copy, catalog, column.target.blockPath)!;
    if (target.overrideOwner && target.overridePath) {
      const inputs = target.overrideOwner.overrides ??= {}; const override = inputs[target.overridePath] ??= {};
      const [top] = column.target.inputPath.split('.');
      if (column.target.inputPath.includes('.') && override[top] === undefined) {
        const schema = target.definitionInputs.find(input => input.key === top);
        const effective = target.block.inputs[top] ?? schema?.default;
        if (effective !== undefined) override[top] = structuredClone(effective);
      }
      setNested(override, column.target.inputPath, row.values[column.id]);
    } else {
      const [top] = column.target.inputPath.split('.');
      if (column.target.inputPath.includes('.') && target.block.inputs[top] === undefined) {
        const effective=target.definitionInputs.find(input=>input.key===top)?.default;
        if(effective!==undefined)target.block.inputs[top]=structuredClone(effective);
      }
      setNested(target.block.inputs, column.target.inputPath, row.values[column.id]);
    }
  }
  delete copy.matrix;
  return copy;
}
export function generateTestingMatrix(columns: (TestingMatrixColumn & { values: TestingValue[] })[]): TestingMatrix {
  if (!columns.length) throw new MatrixModelError('Für die Erzeugung ist mindestens eine Matrixspalte erforderlich.');
  if (columns.length > MAX_MATRIX_COLUMNS) throw new MatrixModelError(`Eine Testmatrix darf höchstens ${MAX_MATRIX_COLUMNS} Spalten enthalten.`, 400, 'MATRIX_COLUMN_LIMIT');
  if (columns.some(column => !column.values.length)) throw new MatrixModelError('Jede Matrixspalte braucht mindestens einen Wert.');
  const total = columns.reduce((count, column) => count * column.values.length, 1);
  if (total > MAX_MATRIX_ROWS) throw new MatrixModelError(`Die Kombination erzeugt ${total} Zeilen; höchstens ${MAX_MATRIX_ROWS} sind zulässig.`, 400, 'MATRIX_LIMIT');
  let rows: TestingMatrix['rows'] = [{ id: 'fall-001', label: 'Fall 1', enabled: true, values: {} }];
  for (const column of columns) rows = rows.flatMap(row => column.values.map(value => ({ ...row, values: { ...row.values, [column.id]: structuredClone(value) } })));
  rows = rows.map((row, index) => ({ ...row, id: `fall-${String(index + 1).padStart(3, '0')}`, label: `Fall ${index + 1}` }));
  return { columns: columns.map(({ values: _values, ...column }) => column), rows };
}
