import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as Scratch from 'scratch-blocks';
import type { TestingBlockDefinition, TestingBlockInstance, TestingCatalog, TestingScenarioLayout, TestingValue, TestingInput } from '../../shared/testing';
import { createTestingInstance, isTestingParameter, isTestingReference, testingVersionKey } from '../../shared/testing';
import { buildValueChanges, type ValueChange } from './valueChanges';
import { buildReferenceIndex, describeReference, type ReferenceIndex } from './references';
import { findDefinition, flattenBlocks, formatGermanNumber, kindLabels, parseGermanNumber } from './model';
import './canvas-workspace.css';

type ScratchState = Scratch.serialization.blocks.State;
type CanvasRow = { key: string; label: string; readOnly: boolean };
type CanvasBlock = Scratch.Block & { folioRows?: CanvasRow[] };
type BlockMetadata = { instance: TestingBlockInstance; body?: TestingBlockInstance[]; path: string; displayValues?: Record<string, string> };
export interface ScratchWorkspaceHandle { zoom: (direction: number) => void; center: () => void; undo: () => void; redo: () => void; select: (path: string) => void; showChanges: (paths: string[]) => void; place: (definition: TestingBlockDefinition) => void }
interface Props { blocks: TestingBlockInstance[]; catalog: TestingCatalog; layout?: TestingScenarioLayout; parameters?: Record<string, TestingValue>; selected?: string; readOnly?: boolean; onChange: (blocks: TestingBlockInstance[]) => void; onSelect: (path: string | undefined) => void; onLayout: (layout: Partial<TestingScenarioLayout>) => void }
const colours = { action: '#18794e', assertion: '#2468c6', workflow: '#7952b8', context: '#b45b13' };
const definitionForType = new Map<string, TestingBlockDefinition>();
function typeFor(definition: { id: string; version: string }) { return `folio_${Array.from(`${definition.id}@${definition.version}`).map(char => char.codePointAt(0)!.toString(16)).join('_')}`; }
function displayValue(value: TestingValue | undefined): string {
  if (isTestingReference(value)) return `↗ ${value.ref}`;
  if (isTestingParameter(value)) return `$${value.param}`;
  if (typeof value === 'number') return formatGermanNumber(value);
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nein';
  return value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}
function changedValueLabel(value: TestingValue | undefined, input?: TestingInput, before?: TestingValue): string {
  if (value && typeof value === 'object' && !isTestingReference(value) && !isTestingParameter(value)) {
    const previous = before && typeof before === 'object' ? before : {};
    const entries = Object.entries(value).filter(([key, item]) => JSON.stringify(item) !== JSON.stringify((previous as Record<string, TestingValue>)[key]));
    return entries.map(([key, item]) => {
      const field = input?.fields?.find(field => field.key === key);
      const label = Array.isArray(value) ? `Eintrag ${Number(key) + 1}` : field?.label ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
      return `${label}: ${changedValueLabel(item, field, (previous as Record<string, TestingValue>)[key])}`;
    }).join(' · ') || (Array.isArray(value) ? 'Leere Liste' : 'Keine Werte');
  }
  if (input?.type === 'choice') return input.options?.find(option => option.value === value)?.label ?? displayValue(value);
  return displayValue(value);
}
function visibleInputs(definition: TestingBlockDefinition) { return definition.inputs; }
function canvasRows(definition: TestingBlockDefinition, path: string, changes: ValueChange[]): CanvasRow[] {
  return changes.filter(change => change.path === path).map(change => {
    const input = definition.inputs.find(input => input.key === change.field);
    return { key: change.field, label: change.label, readOnly: !input || ['object', 'list'].includes(input.type) || input.type.endsWith('-ref') };
  });
}
function syncRows(block: CanvasBlock, rows: CanvasRow[]) {
  if (JSON.stringify(block.folioRows) === JSON.stringify(rows)) return;
  for (const row of block.folioRows ?? []) if (block.getInput(`ROW_${row.key}`)) block.removeInput(`ROW_${row.key}`);
  block.folioRows = rows;
  for (const row of rows) {
    const field = new Scratch.FieldTextInput('');
    if (row.readOnly) { field.setEnabled(false); field.setTooltip('In den Blockdetails bearbeiten.'); }
    block.appendDummyInput(`ROW_${row.key}`).appendField(row.label).appendField(field, `VALUE_${row.key}`);
    if (block.getInput('BODY')) block.moveInputBefore(`ROW_${row.key}`, 'BODY');
  }
}

function registerDefinitions(catalog: TestingCatalog) {
  Scratch.ScratchMsgs.setLocale('de');
  Object.assign(Scratch.Msg, { WORKSPACE_ARIA_LABEL: 'Fachlicher Testablauf', UNDO: 'Rückgängig', REDO: 'Wiederholen', DELETE_BLOCK: 'Block löschen', DELETE_X_BLOCKS: '%1 Blöcke löschen', CLEAN_UP: 'Blöcke aufräumen', COLLAPSE_BLOCK: 'Block einklappen', EXPAND_BLOCK: 'Block aufklappen', COLLAPSE_ALL: 'Alle einklappen', EXPAND_ALL: 'Alle aufklappen', DUPLICATE_BLOCK: 'Duplizieren', ADD_COMMENT: 'Kommentar hinzufügen', REMOVE_COMMENT: 'Kommentar entfernen' });
  Scratch.Blocks.folio_start = { init(this: Scratch.Block) { this.jsonInit({ message0: 'Wenn dieser Test startet', extensions: ['shape_hat'] }); this.setStyle('context'); this.setDeletable(false); this.setMovable(false); } };
  for (const definition of catalog.definitions) {
    const type = typeFor(definition);
    definitionForType.set(type, definition);
    Scratch.Blocks[type] = {
      init(this: Scratch.Block) {
        this.appendDummyInput('TITLE').appendField(definition.name);
        if (definition.kind === 'workflow' || definition.kind === 'context') this.appendStatementInput('BODY');
        this.setInputsInline(false);
        this.setPreviousStatement(true);
        this.setNextStatement(true);
        this.setStyle(definition.kind);
        this.setTooltip(`${definition.description}\n${kindLabels[definition.kind]} · Version ${definition.version}`);
        this.data = JSON.stringify({ instance: createTestingInstance(definition), path: '' } satisfies BlockMetadata);
      },
      saveExtraState(this: CanvasBlock) { return { rows: this.folioRows ?? [] }; },
      loadExtraState(this: CanvasBlock, state: { rows?: CanvasRow[] }) { syncRows(this, state?.rows ?? []); },
    };
  }
}

function blockState(block: TestingBlockInstance, catalog: TestingCatalog, parent = '', depth = 0, seen = new Set<string>(), references?: ReferenceIndex, changes: ValueChange[] = []): ScratchState {
  const definition = findDefinition(catalog, block);
  const path = parent ? `${parent}/${block.id}` : block.id;
  if (!definition) throw new Error(`Der Block ${block.definition.id} in Version ${block.definition.version} fehlt im Katalog.`);
  const childBlocks = block.children ?? definition.body;
  const hasCycle = seen.has(testingVersionKey(definition));
  const rows = canvasRows(definition, path, changes);
  const displayValues = Object.fromEntries(rows.map(row => {
    const input = definition.inputs.find(input => input.key === row.key) ?? { key: row.key, type: 'text' as const, default: undefined };
    const value = block.inputs[input.key] ?? input.default;
    const effective = references?.inputs.get(path);
    const resolved = effective && Object.hasOwn(effective, input.key) ? effective[input.key] : value;
    if (references && (input.type.endsWith('-ref') || isTestingReference(resolved))) {
      const description = describeReference(references, path, resolved, input.type);
      return [input.key, description.source ? `${description.source.outputLabel} „${description.source.name}“ · Schritt ${description.source.step}` : description.label];
    }
    return [input.key, changedValueLabel(resolved, definition.inputs.find(field => field.key === row.key), changes.find(change => change.path === path && change.field === row.key)?.before)];
  }));
  const state: ScratchState = {
    type: typeFor(block.definition), id: path,
    data: JSON.stringify({ instance: block, body: !block.children ? definition.body : undefined, path, displayValues } satisfies BlockMetadata),
    extraState: { rows },
    fields: Object.fromEntries(rows.map(row => [`VALUE_${row.key}`, displayValues[row.key]])),
  };
  if (childBlocks?.length && !hasCycle && depth < 12) {
    state.inputs = { BODY: { block: chainState(childBlocks, catalog, path, depth + 1, new Set([...seen, testingVersionKey(definition)]), references, changes) } };
  }
  return state;
}
function chainState(blocks: TestingBlockInstance[], catalog: TestingCatalog, parent = '', depth = 0, seen = new Set<string>(), references?: ReferenceIndex, changes?: ValueChange[]): ScratchState {
  changes ??= buildValueChanges(flattenBlocks(blocks, catalog), catalog).changes;
  references ??= buildReferenceIndex(flattenBlocks(blocks, catalog));
  const states = blocks.map(block => blockState(block, catalog, parent, depth, seen, references, changes));
  for (let index = states.length - 2; index >= 0; index--) states[index].next = { block: states[index + 1] };
  return states[0];
}

function readBlock(block: Scratch.Block): TestingBlockInstance | undefined {
  const definition = definitionForType.get(block.type);
  if (!definition) return;
  const metadata: BlockMetadata = block.data ? JSON.parse(block.data) as BlockMetadata : { instance: createTestingInstance(definition, block.id), path: block.id };
  const instance = structuredClone(metadata.instance);
  // Toolbox duplicates must create their own canonical identity and output names.
  if (!metadata.path) {
    instance.id = `block-${block.id.replace(/[^a-z0-9]/gi, '')}`;
    instance.outputs = Object.fromEntries(definition.outputs.map(output => [output.key, `${instance.id}.${output.key}`]));
  }
  for (const input of visibleInputs(definition)) {
    if (!block.getField(`VALUE_${input.key}`)) continue;
    const raw = String(block.getFieldValue(`VALUE_${input.key}`) ?? '');
    const original = instance.inputs[input.key] ?? input.default;
    if (input.type.endsWith('-ref') || raw === metadata.displayValues?.[input.key] || raw === displayValue(original)) continue;
    if (raw.startsWith('↗ ')) instance.inputs[input.key] = { ref: raw.slice(2), type: input.type };
    else if (raw.startsWith('$')) instance.inputs[input.key] = { param: raw.slice(1) };
    else if (input.type === 'number' || input.type === 'money') instance.inputs[input.key] = parseGermanNumber(raw) ?? raw;
    else if (input.type === 'boolean') instance.inputs[input.key] = ['true', 'ja', 'false', 'nein'].includes(raw.toLowerCase()) ? ['true', 'ja'].includes(raw.toLowerCase()) : raw;
    else instance.inputs[input.key] = raw;
  }
  if (definition.kind === 'workflow' || definition.kind === 'context') {
    const children = readChain(block.getInputTargetBlock('BODY'));
    if (instance.children || JSON.stringify(children) !== JSON.stringify(metadata.body ?? [])) instance.children = children;
  }
  return instance;
}
function readChain(start: Scratch.Block | null): TestingBlockInstance[] {
  const blocks: TestingBlockInstance[] = [];
  for (let block = start; block; block = block.getNextBlock()) { const instance = readBlock(block); if (instance) blocks.push(instance); }
  return blocks;
}

function canonicalPath(block: Scratch.Block): string {
  if (block.id === '__folio_start') return '';
  const instance = readBlock(block);
  const parent = block.getSurroundParent();
  const parentPath = parent ? canonicalPath(parent) : '';
  return `${parentPath ? `${parentPath}/` : ''}${instance?.id ?? block.id}`;
}

function normaliseCreatedBlocks(ws: Scratch.WorkspaceSvg, ids: string[]) {
  const aliases = new Map<string, string>();
  const createdIds = new Set(ids);
  const updates: { block: Scratch.Block; metadata: BlockMetadata; preservedAliases: Set<string> }[] = [];
  for (const id of ids) {
    const block = ws.getBlockById(id);
    if (!block || !definitionForType.has(block.type) || !block.data) continue;
    const metadata = JSON.parse(block.data) as BlockMetadata;
    if (metadata.path === block.id) continue;
    const instance = structuredClone(metadata.instance);
    let copiedWorkflow: Scratch.Block | undefined;
    for (let parent = block.getSurroundParent(); parent; parent = parent.getSurroundParent()) {
      if (createdIds.has(parent.id) && definitionForType.get(parent.type)?.kind === 'workflow') { copiedWorkflow = parent; break; }
    }
    const preservedAliases = new Set<string>();
    if (copiedWorkflow) {
      // A copied workflow has a fresh outer identity, so its internal names
      // remain valid. Its versioned exports and override paths rely on them.
      const collect = (blocks: TestingBlockInstance[]) => { for (const item of blocks) { for (const alias of Object.values(item.outputs ?? {})) preservedAliases.add(alias); if (item.children) collect(item.children); } };
      collect(readChain(copiedWorkflow.getInputTargetBlock('BODY')));
    } else {
      instance.id = `block-${block.id.replace(/[^a-z0-9]/gi, '')}`;
      instance.outputs = Object.fromEntries(Object.entries(instance.outputs ?? {}).map(([key, previous]) => { const alias = `${instance.id}.${key}`; aliases.set(previous, alias); return [key, alias]; }));
    }
    updates.push({ block, metadata: { ...metadata, instance, path: block.id }, preservedAliases });
  }
  const remap = (value: TestingValue, preserved: Set<string>): TestingValue => {
    if (isTestingReference(value)) return { ...value, ref: preserved.has(value.ref) ? value.ref : aliases.get(value.ref) ?? value.ref };
    if (Array.isArray(value)) return value.map(item => remap(item, preserved));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remap(item, preserved)]));
    return value;
  };
  for (const { block, metadata, preservedAliases } of updates) {
    metadata.instance.inputs = Object.fromEntries(Object.entries(metadata.instance.inputs).map(([key, value]) => [key, remap(value, preservedAliases)]));
    block.data = JSON.stringify(metadata);
    for (const input of visibleInputs(definitionForType.get(block.type)!)) {
      if (!block.getField(`VALUE_${input.key}`)) continue;
      const raw = String(block.getFieldValue(`VALUE_${input.key}`) ?? '');
      if (raw.startsWith('↗ ') && !preservedAliases.has(raw.slice(2)) && aliases.has(raw.slice(2))) block.setFieldValue(`↗ ${aliases.get(raw.slice(2))}`, `VALUE_${input.key}`);
    }
  }
}

function parkedStates(layout: TestingScenarioLayout | undefined, catalog: TestingCatalog): ScratchState[] {
  const stacks = layout?.parkedStacks ?? (layout?.parkedBlocks ?? []).map(block => [block]);
  return stacks.filter(stack => stack.length).map((stack, index) => ({ ...chainState(stack, catalog), x: layout?.positions?.[stack[0].id]?.x ?? 520, y: layout?.positions?.[stack[0].id]?.y ?? 30 + index * 120 }));
}

function revealPaths(ws: Scratch.WorkspaceSvg, paths: string[]) {
  const targets = paths.map(path => ws.getAllBlocks(false).find(block => canonicalPath(block) === path)).filter((block): block is Scratch.BlockSvg => !!block);
  Scratch.Events.disable();
  try { for (const block of targets) for (let ancestor: Scratch.Block | null = block; ancestor; ancestor = ancestor.getSurroundParent()) ancestor.setCollapsed(false); }
  finally { Scratch.Events.enable(); }
  return targets;
}

export const ScratchWorkspace = forwardRef<ScratchWorkspaceHandle, Props>(function ScratchWorkspace(props, ref) {
  const element = useRef<HTMLDivElement>(null);
  const workspace = useRef<Scratch.WorkspaceSvg | null>(null);
  const current = useRef(props);
  current.current = props;
  const applying = useRef(false);
  const lastBlocks = useRef('');
  const lastParked = useRef('');
  const lastParameters = useRef('');
  const catalogueKey = props.catalog.definitions.map(definition => `${testingVersionKey(definition)}:${JSON.stringify(definition.inputs)}`).join('|');
  useImperativeHandle(ref, () => ({
    zoom: direction => workspace.current?.zoomCenter(direction), center: () => workspace.current?.zoomToFit(), undo: () => workspace.current?.undo(false), redo: () => workspace.current?.undo(true),
    select: path => { const ws = workspace.current; if (!ws) return; const [block] = revealPaths(ws, [path]); if (block) { block.select(); ws.centerOnBlock(block.id); current.current.onLayout({ collapsed: ws.getAllBlocks(false).filter(item => item.isCollapsed()).map(canonicalPath) }); } },
    place: definition => {
      const ws = workspace.current; if (!ws || current.current.readOnly) return;
      const instance = createTestingInstance(definition);
      const catalog = { ...current.current.catalog, definitions: [...current.current.catalog.definitions.filter(item => testingVersionKey(item) !== testingVersionKey(definition)), definition] };
      if (!definitionForType.has(typeFor(definition))) registerDefinitions(catalog);
      const state = chainState([instance], catalog);
      const view = ws.getMetricsManager().getViewMetrics(true);
      const block = Scratch.serialization.blocks.append(state, ws) as Scratch.BlockSvg;
      const size = block.getHeightWidth();
      block.moveBy(view.left + (view.width - size.width) / 2, view.top + (view.height - size.height) / 2);
      const parkedStacks = ws.getTopBlocks(false).filter(item => item.id !== '__folio_start').map(readChain);
      lastParked.current = JSON.stringify(parkedStacks);
      current.current.onLayout({ parkedStacks, parkedBlocks: parkedStacks.flat(), positions: Object.fromEntries(ws.getTopBlocks(false).map(item => { const point = item.getRelativeToSurfaceXY(); return [canonicalPath(item) || item.id, { x: point.x, y: point.y }]; })), zoom: ws.scale, collapsed: ws.getAllBlocks(false).filter(item => item.isCollapsed()).map(canonicalPath) });
      block.select(); current.current.onSelect(instance.id);
    },
    showChanges: paths => { const ws = workspace.current; if (!ws) return; const [block] = revealPaths(ws, paths); if (block) { ws.centerOnBlock(block.id); current.current.onLayout({ collapsed: ws.getAllBlocks(false).filter(item => item.isCollapsed()).map(canonicalPath) }); } },
  }), []);
  useEffect(() => {
    if (!element.current) return;
    registerDefinitions(current.current.catalog);
    // Scratch's renderer expects all three colour slots, unlike Blockly's
    // default classic theme, whose styles omit the tertiary colour.
    const theme = new Scratch.Theme('folio-agriculture', Object.fromEntries(Object.entries(colours).map(([kind, colour]) => [kind, { colourPrimary: colour, colourSecondary: colour, colourTertiary: kind === 'context' ? '#873c08' : kind === 'assertion' ? '#174893' : kind === 'workflow' ? '#56328d' : '#105b38' }])), {}, { workspaceBackgroundColour: '#f6f9f2', toolboxBackgroundColour: '#ffffff', flyoutBackgroundColour: '#eef3e8', scrollbarColour: '#b4c6a9', insertionMarkerColour: '#c1ddab', insertionMarkerOpacity: 0.7 });
    const ws = Scratch.inject(element.current, {
      theme,
      toolbox: undefined,
      readOnly: props.readOnly ?? false,
      media: '/scratch-media/',
      sounds: false,
      trashcan: !props.readOnly,
      grid: { spacing: 24, length: 1.7, colour: '#d2ded4', snap: false },
      zoom: { controls: false, wheel: true, startScale: props.layout?.zoom ?? 1, maxScale: 1.35, minScale: 0.3, scaleSpeed: 1.15 },
      move: { scrollbars: true, drag: true, wheel: true },
      comments: false,
      collapse: true,
    });
    // A field that returned to its definition default is no longer rendered.
    // Restore that field before Scratch replays its own undo event; the native
    // event still owns the value and grouping, including keyboard/context-menu undo.
    const nativeUndo = ws.undo.bind(ws);
    ws.undo = redo => {
      const stack = redo ? ws.getRedoStack() : ws.getUndoStack();
      const last = stack.at(-1);
      const events = last ? stack.filter(event => event === last || !!last.group && event.group === last.group) : [];
      Scratch.Events.disable();
      try { for (const event of events) {
        if (event.type !== Scratch.Events.BLOCK_CHANGE) continue;
        const change = event as Scratch.Events.BlockChange;
        if (change.element !== 'field' || !change.name?.startsWith('VALUE_')) continue;
        const block = change.blockId ? ws.getBlockById(change.blockId) as CanvasBlock | null : null;
        if (!block || block.getField(change.name) || !block.data) continue;
        const input = definitionForType.get(block.type)?.inputs.find(input => `VALUE_${input.key}` === change.name);
        if (!input) continue;
        const metadata = JSON.parse(block.data) as BlockMetadata;
        const values = Object.fromEntries((block.folioRows ?? []).map(row => [row.key, block.getFieldValue(`VALUE_${row.key}`)]));
        syncRows(block, [...block.folioRows ?? [], { key: input.key, label: input.label, readOnly: ['object', 'list'].includes(input.type) || input.type.endsWith('-ref') }]);
        const currentValue = changedValueLabel(metadata.instance.inputs[input.key] ?? input.default, input);
        metadata.displayValues = { ...metadata.displayValues, [input.key]: currentValue };
        block.data = JSON.stringify(metadata);
        for (const [key, value] of Object.entries(values)) block.setFieldValue(value, `VALUE_${key}`);
        block.setFieldValue(currentValue, change.name);
      } } finally { Scratch.Events.enable(); }
      nativeUndo(redo);
    };
    workspace.current = ws;
    const resize = new ResizeObserver(() => { Scratch.svgResize(ws); });
    resize.observe(element.current);
    const clearOnCanvas = (event: PointerEvent) => { if (event.button === 0 && event.target instanceof Element && event.target.closest('.blocklyMainBackground')) current.current.onSelect(undefined); };
    element.current.addEventListener('pointerdown', clearOnCanvas, true);
    const onChange = (event: Scratch.Events.Abstract) => {
      if (applying.current) return;
      if (event.type === Scratch.Events.SELECTED) {
        const selected = event as Scratch.Events.Selected;
        const block = selected.newElementId ? ws.getBlockById(selected.newElementId) : undefined;
        // Scratch clears canvas focus on document clicks, including inspector
        // controls. Keep the inspected block until another real block is chosen
        // or that block is removed from the scenario.
        const path = block && canonicalPath(block);
        if (path) {
          revealPaths(ws, [path]);
          current.current.onLayout({ collapsed: ws.getAllBlocks(false).filter(item => item.isCollapsed()).map(canonicalPath) });
          current.current.onSelect(path);
        }
        return;
      }
      if (event.type === Scratch.Events.VIEWPORT_CHANGE) { current.current.onLayout({ zoom: ws.scale }); return; }
      if (event.isUiEvent) return;
      if (!(new Set<string>([Scratch.Events.BLOCK_CHANGE, Scratch.Events.BLOCK_MOVE, Scratch.Events.BLOCK_CREATE, Scratch.Events.BLOCK_DELETE])).has(event.type)) return;
      if (event.type === Scratch.Events.BLOCK_CREATE) {
        Scratch.Events.disable();
        try { normaliseCreatedBlocks(ws, (event as Scratch.Events.BlockCreate).ids ?? []); } finally { Scratch.Events.enable(); }
      }
      const next = readChain(ws.getBlockById('__folio_start')?.getNextBlock() ?? null);
      const nextEntries = flattenBlocks(next, current.current.catalog);
      const valueChanges = buildValueChanges(nextEntries, current.current.catalog, current.current.parameters);
      const parkedStacks = ws.getTopBlocks(false).filter(block => block.id !== '__folio_start').map(readChain);
      const parkedViews = parkedStacks.map(stack => { const entries = flattenBlocks(stack, current.current.catalog); return { entries, values: buildValueChanges(entries, current.current.catalog) }; });
      Scratch.Events.disable();
      try {
        for (const canvasBlock of ws.getAllBlocks(false)) {
          const definition = definitionForType.get(canvasBlock.type);
          if (!definition || !canvasBlock.data) continue;
          const metadata = JSON.parse(canvasBlock.data) as BlockMetadata;
          const path = canonicalPath(canvasBlock);
          const parkedView = parkedViews.find(view => view.entries.some(entry => entry.path === path));
          const updated = nextEntries.find(entry => entry.path === path) ?? parkedView?.entries.find(entry => entry.path === path);
          const values = nextEntries.some(entry => entry.path === path) ? valueChanges : parkedView?.values;
          if (!updated || !values?.current.inputs.has(path)) continue;
          const referenceIndex = values.current;
          metadata.instance = structuredClone(updated.block);
          syncRows(canvasBlock, canvasRows(definition, path, values.changes));
          for (const row of (canvasBlock as CanvasBlock).folioRows ?? []) {
            const input = definition.inputs.find(input => input.key === row.key) ?? { key: row.key, type: 'text' as const };
            const value = referenceIndex.inputs.get(path)?.[input.key];
            if (!input.type.endsWith('-ref') && !isTestingReference(value)) {
              const label = changedValueLabel(value, definition.inputs.find(field => field.key === row.key), values.changes.find(change => change.path === path && change.field === row.key)?.before);
              metadata.displayValues = { ...metadata.displayValues, [input.key]: label };
              canvasBlock.setFieldValue(label, `VALUE_${input.key}`);
              continue;
            }
            const description = describeReference(referenceIndex, path, value, input.type);
            const label = description.source ? `${description.source.outputLabel} „${description.source.name}“ · Schritt ${description.source.step}` : description.label;
            metadata.displayValues = { ...metadata.displayValues, [input.key]: label };
            canvasBlock.setFieldValue(label, `VALUE_${input.key}`);
          }
          canvasBlock.data = JSON.stringify(metadata);
        }
      } finally { Scratch.Events.enable(); }
      const json = JSON.stringify(next);
      if (json !== lastBlocks.current) { lastBlocks.current = json; current.current.onChange(next); }
      const selected = Scratch.getSelected();
      if (selected instanceof Scratch.BlockSvg && selected.workspace === ws) {
        const path = canonicalPath(selected);
        if (path) current.current.onSelect(path);
      }
      lastParked.current = JSON.stringify(parkedStacks);
      current.current.onLayout({ parkedStacks, parkedBlocks: parkedStacks.flat(), positions: Object.fromEntries(ws.getTopBlocks(false).map(block => { const pos = block.getRelativeToSurfaceXY(); return [canonicalPath(block) || block.id, { x: pos.x, y: pos.y }]; })), zoom: ws.scale, collapsed: ws.getAllBlocks(false).filter(block => block.isCollapsed()).map(canonicalPath) });
    };
    ws.addChangeListener(onChange);
    lastBlocks.current = '';
    const render = () => {
      applying.current = true;
      Scratch.Events.disable();
      try {
        const blocks = current.current.blocks;
        const state: ScratchState = { type: 'folio_start', id: '__folio_start', x: 36, y: 30, ...(blocks.length ? { next: { block: chainState(blocks, current.current.catalog, '', 0, new Set(), buildReferenceIndex(flattenBlocks(blocks, current.current.catalog), current.current.parameters), buildValueChanges(flattenBlocks(blocks, current.current.catalog), current.current.catalog, current.current.parameters).changes) } } : {}) };
        const parked = parkedStates(current.current.layout, current.current.catalog);
        Scratch.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: [state, ...parked] } }, ws);
        for (const id of current.current.layout?.collapsed ?? []) ws.getBlockById(id)?.setCollapsed(true);
        lastBlocks.current = JSON.stringify(blocks);
        lastParked.current = JSON.stringify(current.current.layout?.parkedStacks ?? (current.current.layout?.parkedBlocks ?? []).map(block => [block]));
        lastParameters.current = JSON.stringify(current.current.parameters);
      } finally { Scratch.Events.enable(); applying.current = false; }
      Scratch.svgResize(ws);
    };
    render();
    return () => { element.current?.removeEventListener('pointerdown', clearOnCanvas, true); resize.disconnect(); ws.removeChangeListener(onChange); ws.dispose(); workspace.current = null; };
  }, [catalogueKey, props.readOnly]);
  useEffect(() => {
    const ws = workspace.current;
    const json = JSON.stringify(props.blocks);
    const parkedJson = JSON.stringify(props.layout?.parkedStacks ?? (props.layout?.parkedBlocks ?? []).map(block => [block]));
    const parametersJson = JSON.stringify(props.parameters);
    if (!ws || json === lastBlocks.current && parkedJson === lastParked.current && parametersJson === lastParameters.current) return;
    applying.current = true;
    Scratch.Events.disable();
    try {
      const oldScroll = { x: ws.scrollX, y: ws.scrollY };
      const collapsed = ws.getAllBlocks(false).filter(block => block.isCollapsed()).map(canonicalPath);
      const state: ScratchState = { type: 'folio_start', id: '__folio_start', x: 36, y: 30, ...(props.blocks.length ? { next: { block: chainState(props.blocks, props.catalog, '', 0, new Set(), buildReferenceIndex(flattenBlocks(props.blocks, props.catalog), props.parameters), buildValueChanges(flattenBlocks(props.blocks, props.catalog), props.catalog, props.parameters).changes) } } : {}) };
      const parked = parkedStates(props.layout, props.catalog);
      Scratch.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: [state, ...parked] } }, ws);
      for (const id of collapsed) ws.getBlockById(id)?.setCollapsed(true);
      ws.scroll(oldScroll.x, oldScroll.y);
      lastBlocks.current = json; lastParked.current = parkedJson; lastParameters.current = parametersJson;
    } finally { Scratch.Events.enable(); applying.current = false; }
  }, [props.blocks, props.catalog, props.layout, props.parameters]);
  useEffect(() => {
    if (props.selected && !workspace.current?.getAllBlocks(false).some(block => canonicalPath(block) === props.selected)) current.current.onSelect(undefined);
  }, [props.blocks, props.catalog, props.selected]);
  useEffect(() => { const block = props.selected ? workspace.current?.getAllBlocks(false).find(item => canonicalPath(item) === props.selected) : undefined; if (block && Scratch.getSelected() !== block) block.select(); else if (!props.selected) { const selected = Scratch.getSelected(); if (selected instanceof Scratch.BlockSvg && selected.workspace === workspace.current) selected.unselect(); } }, [props.selected]);
  return <div className="t-scratch-workspace" ref={element} aria-label="Scratch-Arbeitsfläche" />;
});
