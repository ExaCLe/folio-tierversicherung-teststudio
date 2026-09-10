import { useEffect, useMemo, useRef, useState } from "react";
import { Grid3X3, Plus, Trash2, X } from "lucide-react";
import {
  inferTestingMatrixColumnRole,
  type TestingCatalog,
  type TestingInput,
  type TestingMatrix,
  type TestingMatrixColumn,
  type TestingScenario,
  type TestingValue,
  type TestingValueType,
} from "../../shared/testing";
import { messageOf, testingPost } from "./api";
import {
  flattenBlocks,
  formatGermanNumber,
  parseGermanNumber,
  resolvedBlockInputs,
} from "./model";
import { Notice as BaseNotice, Spinner } from "./ui";
import "./test-matrix.css";
import "./test-matrix-revision.css";

type ColumnRole = "input" | "expectation";
type MatrixColumn = TestingMatrixColumn & { role?: ColumnRole };
interface FieldChoice {
  key: string;
  label: string;
  blockPath: string;
  inputPath: string;
  type: TestingValueType;
  input: TestingInput;
  value: TestingValue;
  assertion: boolean;
}
const scalarTypes = new Set<TestingValueType>([
  "text",
  "number",
  "money",
  "boolean",
  "date",
  "choice",
]);
const uid = (prefix: string) => `${prefix}-${globalThis.crypto.randomUUID()}`;
const roleOf = (column: MatrixColumn): ColumnRole => column.role ?? "input";
const Notice = (
  { tone, children }: {
    tone: "info" | "warning" | "error";
    children: React.ReactNode;
  },
) => (
  <BaseNotice tone={tone === "warning" ? "info" : tone}>{children}</BaseNotice>
);
function nested(value: TestingValue | undefined, path: string[]) {
  let current = value;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return;
    }
    current = (current as Record<string, TestingValue>)[segment];
  }
  return current;
}
export function testingMatrixFieldChoices(
  scenario: TestingScenario,
  catalog: TestingCatalog,
): FieldChoice[] {
  return flattenBlocks(scenario.blocks, catalog).flatMap((entry, index) => {
    const values = resolvedBlockInputs(entry);
    const visit = (
      input: TestingInput,
      prefix: string[] = [],
    ): FieldChoice[] => {
      const path = [...prefix, input.key];
      if (input.type === "object") {
        return (input.fields ?? []).flatMap((child) => visit(child, path));
      }
      if (!scalarTypes.has(input.type)) return [];
      return [{
        key: `${entry.path}::${path.join(".")}`,
        label: `${index + 1}. ${
          entry.block.label || entry.definition?.name || "Schritt"
        } › ${input.label}`,
        blockPath: entry.path,
        inputPath: path.join("."),
        type: input.type,
        input,
        value: nested(values[path[0]], path.slice(1)) ?? input.default ?? "",
        assertion: entry.definition?.kind === "assertion",
      }];
    };
    return entry.definition?.inputs.flatMap((input) => visit(input)) ?? [];
  });
}
function parse(raw: string, type: TestingValueType): TestingValue | undefined {
  if (type === "number" || type === "money") return parseGermanNumber(raw);
  if (type === "boolean") return raw === "true";
  return raw;
}
function display(value: TestingValue, type: TestingValueType) {
  if (type === "boolean") return value === true ? "Ja" : "Nein";
  if (typeof value === "number") return formatGermanNumber(value);
  return String(value ?? "");
}
function NumericCell({
  value,
  field,
  label,
  disabled,
  allowEmpty,
  onChange,
}: {
  value: TestingValue | undefined;
  field: FieldChoice;
  label: string;
  disabled?: boolean;
  allowEmpty: boolean;
  onChange: (value: TestingValue) => void;
}) {
  const [raw, setRaw] = useState(display(value ?? "", field.type));
  useEffect(() => {
    if (typeof value === "number" && parseGermanNumber(raw) !== value) {
      setRaw(formatGermanNumber(value));
    }
    if ((value === undefined || value === "") && raw) setRaw("");
  }, [value]);
  return (
    <div className={field.type === "money" ? "t-matrix-value-unit" : undefined}>
      <input
        aria-label={label}
        aria-invalid={raw !== "" && parseGermanNumber(raw) === undefined}
        disabled={disabled}
        inputMode="decimal"
        placeholder={allowEmpty ? "Noch offen" : undefined}
        value={raw}
        onChange={(event) => {
          const next = event.target.value;
          setRaw(next);
          const parsed = parseGermanNumber(next);
          onChange(parsed ?? next);
        }}
        onBlur={() => {
          const parsed = parseGermanNumber(raw);
          if (parsed !== undefined) {
            setRaw(formatGermanNumber(parsed));
            onChange(parsed);
          }
        }}
      />
      {field.type === "money" && <span>EUR</span>}
    </div>
  );
}
function Cell({
  value,
  field,
  label,
  disabled,
  allowEmpty = false,
  onChange,
}: {
  value: TestingValue | undefined;
  field: FieldChoice;
  label: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  onChange: (value: TestingValue) => void;
}) {
  if (field.type === "boolean") {
    return (
      <select
        aria-label={label}
        disabled={disabled}
        value={value === undefined || value === ""
          ? ""
          : value === true
          ? "true"
          : "false"}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? "" : event.target.value === "true",
          )}
      >
        {(allowEmpty || value === undefined || value === "") && (
          <option value="">
            {allowEmpty ? "Noch offen" : "Bitte auswählen"}
          </option>
        )}
        <option value="true">Ja</option>
        <option value="false">Nein</option>
      </select>
    );
  }
  if (field.input.options?.length) {
    return (
      <select
        aria-label={label}
        disabled={disabled}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
      >
        {(allowEmpty || value === undefined || value === "") && (
          <option value="">
            {allowEmpty ? "Noch offen" : "Bitte auswählen"}
          </option>
        )}
        {field.input.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === "number" || field.type === "money") {
    return (
      <NumericCell
        value={value}
        field={field}
        label={label}
        disabled={disabled}
        allowEmpty={allowEmpty}
        onChange={onChange}
      />
    );
  }
  return (
    <input
      aria-label={label}
      disabled={disabled}
      type={field.type === "date" ? "date" : "text"}
      placeholder={allowEmpty ? "Noch offen" : undefined}
      value={display(value ?? "", field.type)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function TestMatrix(
  { scenario, catalog, disabled, onChange }: {
    scenario: TestingScenario;
    catalog: TestingCatalog;
    disabled?: boolean;
    onChange: (matrix: TestingMatrix | undefined) => void;
  },
) {
  const fields = useMemo(() => testingMatrixFieldChoices(scenario, catalog), [
    scenario.blocks,
    catalog,
  ]);
  const matrix = scenario.matrix;
  const [sources, setSources] = useState<Record<string, TestingValue[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<TestingMatrix>();
  const current = useRef({
    id: scenario.id,
    revision: scenario.revision,
    matrix,
  });
  current.current = { id: scenario.id, revision: scenario.revision, matrix };
  const locked = disabled || busy;
  useEffect(() => setPending(undefined), [
    matrix,
    sources,
    scenario.id,
    scenario.revision,
  ]);
  const columns = ((matrix?.columns ?? []) as MatrixColumn[]).map((column) => {
      const field = fields.find((item) =>
        item.blockPath === column.target.blockPath &&
        item.inputPath === column.target.inputPath
      );
      return {
        ...column,
        role: inferTestingMatrixColumnRole(
          column,
          field?.assertion ? "assertion" : undefined,
          field?.input,
        ),
      };
    }),
    inputColumns = columns.filter((column) => roleOf(column) === "input"),
    expectationColumns = columns.filter((column) =>
      roleOf(column) === "expectation"
    );
  const fieldFor = (column: MatrixColumn) => {
    const field = fields.find((item) =>
      item.blockPath === column.target.blockPath &&
      item.inputPath === column.target.inputPath
    );
    return field && roleOf(column) === "expectation"
      ? { ...field, value: "" }
      : field;
  };
  const uniqueValues = (values: TestingValue[]) =>
    values.filter((value, index) =>
      values.findIndex((item) =>
        JSON.stringify(item) === JSON.stringify(value)
      ) === index
    );
  const sourceList = (column: MatrixColumn) => {
    if (sources[column.id]) return sources[column.id];
    const found = (matrix?.rows ?? []).filter((row) =>
        Object.hasOwn(row.values, column.id)
      ).map((row) => row.values[column.id]),
      unique = uniqueValues(found);
    return unique.length ? unique : [fieldFor(column)?.value ?? ""];
  };
  const count = inputColumns.length
    ? inputColumns.reduce(
      (total, column) => total * sourceList(column).length,
      1,
    )
    : 0;
  const choicesFor = (role: ColumnRole) =>
    role === "expectation" ? fields.filter((field) => field.assertion) : fields;
  const hasExpectationFields = choicesFor("expectation").length > 0;
  function addColumn(role: ColumnRole) {
    if (!matrix || columns.length >= 20) return;
    const used = new Set(
        columns.map((column) =>
          `${column.target.blockPath}::${column.target.inputPath}`
        ),
      ),
      field = choicesFor(role).find((item) => !used.has(item.key));
    if (!field) return;
    const column: MatrixColumn = {
      id: uid(role === "input" ? "eingabe" : "erwartung"),
      label: field.input.label,
      target: { blockPath: field.blockPath, inputPath: field.inputPath },
      type: field.type,
      role,
    };
    if (role === "input") {
      setSources((values) => ({ ...values, [column.id]: [field.value] }));
    }
    onChange({
      ...matrix,
      columns: [...matrix.columns, column],
      rows: matrix.rows.map((row) => ({
        ...row,
        values: {
          ...row.values,
          [column.id]: role === "expectation" ? "" : field.value,
        },
      })),
    });
  }
  function selectColumn(column: MatrixColumn, key: string) {
    if (
      !matrix || columns.some((item) =>
        item.id !== column.id &&
        `${item.target.blockPath}::${item.target.inputPath}` === key
      )
    ) return;
    const field = choicesFor(roleOf(column)).find((item) => item.key === key);
    if (!field) return;
    setSources((values) => ({ ...values, [column.id]: [field.value] }));
    const next = {
      ...column,
      label: field.input.label,
      target: { blockPath: field.blockPath, inputPath: field.inputPath },
      type: field.type,
    };
    onChange({
      ...matrix,
      columns: matrix.columns.map((item) =>
        item.id === column.id ? next : item
      ),
      rows: matrix.rows.map((row) => ({
        ...row,
        values: {
          ...row.values,
          [column.id]: roleOf(column) === "expectation" ? "" : field.value,
        },
      })),
    });
  }
  function removeColumn(column: MatrixColumn) {
    if (!matrix) return;
    setSources((values) => {
      const next = { ...values };
      delete next[column.id];
      return next;
    });
    onChange({
      columns: matrix.columns.filter((item) => item.id !== column.id),
      rows: matrix.rows.map((row) => {
        const values = { ...row.values };
        delete values[column.id];
        return { ...row, values };
      }),
    });
  }
  function addRow() {
    if (!matrix || matrix.rows.length >= 100) return;
    onChange({
      ...matrix,
      rows: [...matrix.rows, {
        id: uid("fall"),
        label: `Fall ${matrix.rows.length + 1}`,
        enabled: true,
        values: Object.fromEntries(
          columns.map((column) => [
            column.id,
            roleOf(column) === "expectation"
              ? ""
              : fieldFor(column)?.value ?? "",
          ]),
        ),
      }],
    });
  }
  function inputTuple(row: TestingMatrix["rows"][number]) {
    return JSON.stringify(
      inputColumns.map(
        (column) => [
          column.target.blockPath,
          column.target.inputPath,
          row.values[column.id],
        ],
      ),
    );
  }
  function mergeExpectations(generated: TestingMatrix) {
    if (!matrix) return generated;
    const previous = new Map(matrix.rows.map((row) => [inputTuple(row), row]));
    return {
      ...generated,
      rows: generated.rows.map((row) => {
        const old = previous.get(inputTuple(row)), values = { ...row.values };
        for (const column of expectationColumns) {
          values[column.id] = old && Object.hasOwn(old.values, column.id)
            ? old.values[column.id]
            : "";
        }
        return {
          ...row,
          label: old?.label ?? row.label,
          enabled: old?.enabled ?? row.enabled,
          values,
        };
      }),
    };
  }
  async function generate() {
    if (!matrix || !inputColumns.length || count > 100) return;
    const snapshot = {
      id: scenario.id,
      revision: scenario.revision,
      matrix: JSON.stringify(matrix),
    };
    setBusy(true);
    setError("");
    try {
      const requestColumns = columns.map((column) =>
        roleOf(column) === "input"
          ? { ...column, values: uniqueValues(sourceList(column)) }
          : { ...column, values: [] }
      );
      const result = await testingPost<{ matrix: TestingMatrix }>(
        `/scenarios/${encodeURIComponent(scenario.id)}/matrix/generate`,
        { revision: scenario.revision, columns: requestColumns },
      );
      const merged = mergeExpectations(result.matrix);
      if (
        current.current.id !== snapshot.id ||
        current.current.revision !== snapshot.revision ||
        JSON.stringify(current.current.matrix) !== snapshot.matrix
      ) return;
      const retained = new Set(merged.rows.map(inputTuple)),
        removes = matrix.rows.some((row) => !retained.has(inputTuple(row)));
      if (removes) setPending(merged);
      else onChange(merged);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }
  function columnEditor(column: MatrixColumn) {
    const field = fieldFor(column),
      role = roleOf(column),
      values = sourceList(column),
      selected = `${column.target.blockPath}::${column.target.inputPath}`;
    return (
      <div key={column.id} className={`t-matrix-column ${role}`}>
        <label>
          {role === "input" ? "Eingabefeld" : "Prüffeld"}
          <select
            aria-label={`Feld für ${column.label}`}
            disabled={locked}
            value={selected}
            onChange={(event) => selectColumn(column, event.target.value)}
          >
            {choicesFor(role).map((choice) => (
              <option
                key={choice.key}
                value={choice.key}
                disabled={choice.key !== selected &&
                  columns.some((item) =>
                    `${item.target.blockPath}::${item.target.inputPath}` ===
                      choice.key
                  )}
              >
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        {role === "input" && field && (
          <div className="t-matrix-source">
            <span>Werte für Kombinationen</span>
            {values.map((value, index) => (
              <div className="t-matrix-source-row" key={index}>
                <Cell
                  disabled={locked}
                  label={`${column.label}, Kombinationswert ${index + 1}`}
                  field={field}
                  value={value}
                  onChange={(next) =>
                    setSources((current) => ({
                      ...current,
                      [column.id]: values.map((item, position) =>
                        position === index ? next : item
                      ),
                    }))}
                />
                <button
                  className="t-icon"
                  aria-label={`Kombinationswert ${index + 1} entfernen`}
                  disabled={locked || values.length === 1}
                  onClick={() =>
                    setSources((current) => ({
                      ...current,
                      [column.id]: values.filter((_, position) =>
                        position !== index
                      ),
                    }))}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <button
              className="t-button quiet small"
              disabled={locked || count >= 100}
              onClick={() =>
                setSources((current) => ({
                  ...current,
                  [column.id]: [...values, field.value],
                }))}
            >
              <Plus size={13} />Weiteren Wert
            </button>
          </div>
        )}
        {role === "expectation" && (
          <p className="t-matrix-column-help">
            Den Sollwert legst du für jeden Testfall in der Tabelle fest.
          </p>
        )}
        <button
          className="t-icon danger"
          aria-label={`Spalte ${column.label} entfernen`}
          disabled={locked}
          onClick={() => removeColumn(column)}
        >
          <Trash2 size={15} />
        </button>
      </div>
    );
  }
  return (
    <section className="t-test-matrix" aria-labelledby="test-matrix-heading">
      <div className="t-matrix-heading">
        <div>
          <span className="t-eyebrow">OPTIONAL</span>
          <h3 id="test-matrix-heading">
            <Grid3X3 size={18} />Mit Testdaten variieren
          </h3>
          <p>
            Führe denselben Ablauf mit verschiedenen Eingaben aus und lege den
            erwarteten Wert für jeden Testfall fest.
          </p>
        </div>
        <label className="t-matrix-switch">
          <input
            type="checkbox"
            checked={!!matrix}
            disabled={locked}
            onChange={(event) =>
              onChange(
                event.target.checked ? { columns: [], rows: [] } : undefined,
              )}
          />
          <span>{matrix ? "Aktiv" : "Aus"}</span>
        </label>
      </div>
      {matrix && (
        <div className="t-matrix-body">
          {!columns.length
            ? (
              <div className="t-matrix-empty">
                <p>
                  Wähle zuerst ein Eingabefeld, das sich zwischen den Testläufen
                  ändern soll.
                </p>
                <button
                  className="t-button small"
                  disabled={locked || !fields.length}
                  onClick={() => addColumn("input")}
                >
                  <Plus size={14} />Erste Eingabe hinzufügen
                </button>
              </div>
            )
            : (
              <>
                <div className="t-matrix-column-groups">
                  {!!inputColumns.length && (
                    <section>
                      <h4>
                        Eingaben <span>bilden die Kombinationen</span>
                      </h4>
                      <div className="t-matrix-columns">
                        {inputColumns.map(columnEditor)}
                      </div>
                    </section>
                  )}
                  {!!expectationColumns.length && (
                    <section>
                      <h4>
                        Erwartete Ergebnisse <span>gelten je Testfall</span>
                      </h4>
                      <div className="t-matrix-columns">
                        {expectationColumns.map(columnEditor)}
                      </div>
                    </section>
                  )}
                </div>
                <div className="t-matrix-tools">
                  <button
                    className="t-button small"
                    disabled={locked || columns.length >= 20 ||
                      inputColumns.length >= fields.length}
                    onClick={() => addColumn("input")}
                  >
                    <Plus size={14} />Eingabe hinzufügen
                  </button>
                  <button
                    className="t-button small"
                    disabled={locked || columns.length >= 20 ||
                      !choicesFor("expectation").some((field) =>
                        !columns.some((column) =>
                          `${column.target.blockPath}::${column.target.inputPath}` ===
                            field.key
                        )
                      )}
                    onClick={() =>
                      addColumn("expectation")}
                  >
                    <Plus size={14} />Erwartetes Ergebnis hinzufügen
                  </button>
                  {!hasExpectationFields && (
                    <small className="t-matrix-expectation-hint">
                      Für ein erwartetes Ergebnis ergänze zuerst einen Prüfblock
                      im Ablauf.
                    </small>
                  )}
                  <span>
                    {!inputColumns.length
                      ? "Mindestens eine Eingabe erforderlich"
                      : count > 100
                      ? "Mehr als 100 Kombinationen. Bitte Werte reduzieren."
                      : `${count} ${
                        count === 1 ? "Kombination" : "Kombinationen"
                      } in der Vorschau`}
                  </span>
                  <button
                    className="t-button small"
                    disabled={locked || !inputColumns.length || count > 100}
                    onClick={() =>
                      void generate()}
                  >
                    {busy
                      ? <Spinner label="Kombinationen werden erstellt" />
                      : matrix.rows.length
                      ? "Kombinationen aktualisieren"
                      : "Kombinationen erzeugen"}
                  </button>
                </div>
                {!!matrix.rows.length && (
                  <div className="t-matrix-table-wrap">
                    <table>
                      <thead>
                        <tr className="t-matrix-group-row">
                          <th rowSpan={2}>Ausführen</th>
                          <th rowSpan={2}>Testfall</th>
                          {!!inputColumns.length && (
                            <th
                              colSpan={inputColumns.length}
                              className="input-group"
                            >
                              Eingaben
                            </th>
                          )}
                          {!!expectationColumns.length && (
                            <th
                              colSpan={expectationColumns.length}
                              className="expectation-group"
                            >
                              Erwartete Ergebnisse
                            </th>
                          )}
                          <th rowSpan={2}>
                            <span className="t-visually-hidden">Aktionen</span>
                          </th>
                        </tr>
                        <tr>
                          {inputColumns.map((column) => (
                            <th key={column.id}>
                              {column.label}
                              <small>{fieldFor(column)?.label}</small>
                            </th>
                          ))}
                          {expectationColumns.map((column) => (
                            <th key={column.id}>
                              {column.label}
                              <small>{fieldFor(column)?.label}</small>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {matrix.rows.map((row, index) => (
                          <tr key={row.id}>
                            <td>
                              <input
                                aria-label={`${row.label} ausführen`}
                                type="checkbox"
                                disabled={locked}
                                checked={row.enabled}
                                onChange={(event) =>
                                  onChange({
                                    ...matrix,
                                    rows: matrix.rows.map((item) =>
                                      item.id === row.id
                                        ? {
                                          ...item,
                                          enabled: event.target.checked,
                                        }
                                        : item
                                    ),
                                  })}
                              />
                            </td>
                            <td>
                              <input
                                aria-label={`Name für Testfall ${index + 1}`}
                                disabled={locked}
                                value={row.label}
                                onChange={(event) =>
                                  onChange({
                                    ...matrix,
                                    rows: matrix.rows.map((item) =>
                                      item.id === row.id
                                        ? { ...item, label: event.target.value }
                                        : item
                                    ),
                                  })}
                              />
                            </td>
                            {[...inputColumns, ...expectationColumns].map(
                              (column) => (
                                <td
                                  key={column.id}
                                  className={roleOf(column) === "expectation"
                                    ? "expectation-cell"
                                    : undefined}
                                >
                                  {fieldFor(column) && (
                                    <Cell
                                      disabled={locked}
                                      allowEmpty={roleOf(column) ===
                                        "expectation"}
                                      label={`${row.label}: ${column.label}`}
                                      field={fieldFor(column)!}
                                      value={Object.hasOwn(
                                          row.values,
                                          column.id,
                                        )
                                        ? row.values[column.id]
                                        : fieldFor(column)!.value}
                                      onChange={(value) =>
                                        onChange({
                                          ...matrix,
                                          rows: matrix.rows.map((item) =>
                                            item.id === row.id
                                              ? {
                                                ...item,
                                                values: {
                                                  ...item.values,
                                                  [column.id]: value,
                                                },
                                              }
                                              : item
                                          ),
                                        })}
                                    />
                                  )}
                                </td>
                              ),
                            )}
                            <td>
                              <button
                                className="t-icon danger"
                                aria-label={`${row.label} entfernen`}
                                disabled={locked}
                                onClick={() =>
                                  onChange({
                                    ...matrix,
                                    rows: matrix.rows.filter((item) =>
                                      item.id !== row.id
                                    ),
                                  })}
                              >
                                <Trash2 size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="t-matrix-footer">
                  <span>
                    {matrix.rows.filter((row) => row.enabled).length} von{" "}
                    {matrix.rows.length}{" "}
                    Testfällen werden ausgeführt, höchstens 100
                  </span>
                  <button
                    className="t-button small"
                    disabled={locked || matrix.rows.length >= 100}
                    onClick={addRow}
                  >
                    <Plus size={14} />Testfall hinzufügen
                  </button>
                </div>
              </>
            )}
          {pending && (
            <Notice tone="warning">
              <div className="t-matrix-confirm">
                <span>
                  Die neuen Eingabewerte entfernen bestehende Testfälle. Dabei
                  gehen deren erwartete Ergebnisse verloren.
                </span>
                <button
                  className="t-button small"
                  onClick={() => setPending(undefined)}
                >
                  Abbrechen
                </button>
                <button
                  className="t-button small danger"
                  onClick={() => {
                    onChange(pending);
                    setPending(undefined);
                  }}
                >
                  Testfälle ersetzen
                </button>
              </div>
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
        </div>
      )}
    </section>
  );
}
