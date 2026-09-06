import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as Scratch from 'scratch-blocks';
import type { TestingBlockDefinition, TestingBlockInstance, TestingCatalog, TestingScenarioLayout, TestingValue } from '../../shared/testing';
import { createTestingInstance, isTestingParameter, isTestingReference, testingVersionKey } from '../../shared/testing';
import { findDefinition, formatGermanNumber, kindLabels, parseGermanNumber } from './model';

type ScratchState = Scratch.serialization.blocks.State;
type BlockMetadata = { instance: TestingBlockInstance; body?: TestingBlockInstance[]; path: string };
export interface ScratchWorkspaceHandle { zoom: (direction: number) => void; center: () => void; undo: () => void; redo: () => void; select: (path: string) => void }
interface Props { blocks: TestingBlockInstance[]; catalog: TestingCatalog; layout?: TestingScenarioLayout; selected?: string; readOnly?: boolean; onChange: (blocks: TestingBlockInstance[]) => void; onSelect: (path: string | undefined) => void; onLayout: (layout: Partial<TestingScenarioLayout>) => void }
const colours = { action: '#398855', assertion: '#3e80ba', workflow: '#208e86', context: '#bb8328' };
const definitionForType = new Map<string, TestingBlockDefinition>();
function typeFor(definition: { id: string; version: string }) { return `folio_${Array.from(`${definition.id}@${definition.version}`).map(char => char.codePointAt(0)!.toString(16)).join('_')}`; }
function displayValue(value: TestingValue | undefined): string {
  if (isTestingReference(value)) return `↗ ${value.ref}`;
  if (isTestingParameter(value)) return `$${value.param}`;
  if (typeof value === 'number') return formatGermanNumber(value);
  return value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
}
function visibleInputs(definition: TestingBlockDefinition) { return definition.inputs.filter(input => !['object', 'list'].includes(input.type)).slice(0, 3); }

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
        for (const input of visibleInputs(definition)) {
          const row = this.appendDummyInput(`ROW_${input.key}`).appendField(input.label);
          // Parameter and reference expressions remain intact on the canvas.
          // The inspector provides type-specific controls for their resolved values.
          const field = new Scratch.FieldTextInput(displayValue(input.default));
          row.appendField(field, `VALUE_${input.key}`);
        }
        if (definition.kind === 'workflow' || definition.kind === 'context') this.appendStatementInput('BODY');
        this.setInputsInline(false);
        this.setPreviousStatement(true);
        this.setNextStatement(true);
        this.setStyle(definition.kind);
        this.setTooltip(`${definition.description}\n${kindLabels[definition.kind]} · Version ${definition.version}`);
        this.data = JSON.stringify({ instance: createTestingInstance(definition), path: '' } satisfies BlockMetadata);
      },
    };
  }
}

function blockState(block: TestingBlockInstance, catalog: TestingCatalog, parent = '', depth = 0, seen = new Set<string>()): ScratchState {
  const definition = findDefinition(catalog, block);
  const path = parent ? `${parent}/${block.id}` : block.id;
  if (!definition) throw new Error(`Der Block ${block.definition.id} in Version ${block.definition.version} fehlt im Katalog.`);
  const childBlocks = block.children ?? definition.body;
  const hasCycle = seen.has(testingVersionKey(definition));
  const state: ScratchState = {
    type: typeFor(block.definition), id: path,
    data: JSON.stringify({ instance: block, body: !block.children ? definition.body : undefined, path } satisfies BlockMetadata),
    fields: Object.fromEntries(visibleInputs(definition).map(input => [`VALUE_${input.key}`, displayValue(block.inputs[input.key] ?? input.default)])),
    ...(depth > 0 && definition.kind === 'workflow' ? { collapsed: true } : {}),
  };
  if (childBlocks?.length && !hasCycle && depth < 12) {
    state.inputs = { BODY: { block: chainState(childBlocks, catalog, path, depth + 1, new Set([...seen, testingVersionKey(definition)])) } };
  }
  return state;
}
function chainState(blocks: TestingBlockInstance[], catalog: TestingCatalog, parent = '', depth = 0, seen = new Set<string>()): ScratchState {
  const states = blocks.map(block => blockState(block, catalog, parent, depth, seen));
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
    const raw = String(block.getFieldValue(`VALUE_${input.key}`) ?? '');
    const original = instance.inputs[input.key] ?? input.default;
    if (raw === displayValue(original)) continue;
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
      const raw = String(block.getFieldValue(`VALUE_${input.key}`) ?? '');
      if (raw.startsWith('↗ ') && !preservedAliases.has(raw.slice(2)) && aliases.has(raw.slice(2))) block.setFieldValue(`↗ ${aliases.get(raw.slice(2))}`, `VALUE_${input.key}`);
    }
  }
}

function parkedStates(layout: TestingScenarioLayout | undefined, catalog: TestingCatalog): ScratchState[] {
  const stacks = layout?.parkedStacks ?? (layout?.parkedBlocks ?? []).map(block => [block]);
  return stacks.filter(stack => stack.length).map((stack, index) => ({ ...chainState(stack, catalog), x: layout?.positions?.[stack[0].id]?.x ?? 520, y: layout?.positions?.[stack[0].id]?.y ?? 30 + index * 120 }));
}

export const ScratchWorkspace = forwardRef<ScratchWorkspaceHandle, Props>(function ScratchWorkspace(props, ref) {
  const element = useRef<HTMLDivElement>(null);
  const workspace = useRef<Scratch.WorkspaceSvg | null>(null);
  const current = useRef(props);
  current.current = props;
  const applying = useRef(false);
  const lastBlocks = useRef('');
  const catalogueKey = props.catalog.definitions.map(definition => `${testingVersionKey(definition)}:${JSON.stringify(definition.inputs)}`).join('|');
  useImperativeHandle(ref, () => ({ zoom: direction => workspace.current?.zoomCenter(direction), center: () => workspace.current?.zoomToFit(), undo: () => workspace.current?.undo(false), redo: () => workspace.current?.undo(true), select: path => { const block = workspace.current?.getAllBlocks(false).find(item => canonicalPath(item) === path); block?.select(); if (block) workspace.current?.centerOnBlock(block.id); } }), []);
  useEffect(() => {
    if (!element.current) return;
    registerDefinitions(current.current.catalog);
    const grouped = new Map<string, TestingBlockDefinition[]>();
    for (const definition of current.current.catalog.definitions) {
      const group = definition.kind === 'workflow' ? 'Eigene Bausteine' : definition.kind === 'assertion' ? 'Prüfungen' : definition.kind === 'context' ? 'Rollen' : definition.category;
      grouped.set(group, [...grouped.get(group) ?? [], definition]);
    }
    const toolbox = { kind: 'categoryToolbox', contents: [...grouped].map(([name, definitions]) => ({ kind: 'category', name, colour: colours[definitions[0].kind], contents: definitions.map(definition => ({ kind: 'block', type: typeFor(definition) })) })) };
    // Scratch's renderer expects all three colour slots, unlike Blockly's
    // default classic theme, whose styles omit the tertiary colour.
    const theme = new Scratch.Theme('folio-agriculture', Object.fromEntries(Object.entries(colours).map(([kind, colour]) => [kind, { colourPrimary: colour, colourSecondary: colour, colourTertiary: kind === 'context' ? '#946519' : kind === 'assertion' ? '#296497' : kind === 'workflow' ? '#146b64' : '#28653d' }])), {}, { workspaceBackgroundColour: '#f6f9f2', toolboxBackgroundColour: '#ffffff', flyoutBackgroundColour: '#eef3e8', scrollbarColour: '#b4c6a9', insertionMarkerColour: '#c1ddab', insertionMarkerOpacity: 0.7 });
    const ws = Scratch.inject(element.current, {
      theme,
      toolbox: props.readOnly ? undefined : toolbox,
      readOnly: props.readOnly ?? false,
      media: '/scratch-media/',
      sounds: false,
      trashcan: !props.readOnly,
      grid: { spacing: 24, length: 1.7, colour: '#d2ded4', snap: false },
      zoom: { controls: false, wheel: true, startScale: props.layout?.zoom ?? 0.85, maxScale: 1.35, minScale: 0.3, scaleSpeed: 1.15 },
      move: { scrollbars: true, drag: true, wheel: true },
      comments: false,
      collapse: true,
    });
    workspace.current = ws;
    const resize = new ResizeObserver(() => { Scratch.svgResize(ws); });
    resize.observe(element.current);
    const onChange = (event: Scratch.Events.Abstract) => {
      if (applying.current) return;
      if (event.type === Scratch.Events.SELECTED) {
        const selected = event as Scratch.Events.Selected;
        const block = selected.newElementId ? ws.getBlockById(selected.newElementId) : undefined;
        current.current.onSelect(block ? canonicalPath(block) || undefined : undefined);
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
      const json = JSON.stringify(next);
      if (json !== lastBlocks.current) { lastBlocks.current = json; current.current.onChange(next); }
      const selected = Scratch.getSelected();
      if (selected instanceof Scratch.BlockSvg) current.current.onSelect(canonicalPath(selected) || undefined);
      const parkedStacks = ws.getTopBlocks(false).filter(block => block.id !== '__folio_start').map(readChain);
      current.current.onLayout({ parkedStacks, parkedBlocks: parkedStacks.flat(), positions: Object.fromEntries(ws.getTopBlocks(false).map(block => { const pos = block.getRelativeToSurfaceXY(); return [canonicalPath(block) || block.id, { x: pos.x, y: pos.y }]; })), zoom: ws.scale, collapsed: ws.getAllBlocks(false).filter(block => block.isCollapsed()).map(canonicalPath) });
    };
    ws.addChangeListener(onChange);
    lastBlocks.current = '';
    const render = () => {
      applying.current = true;
      Scratch.Events.disable();
      try {
        const blocks = current.current.blocks;
        const state: ScratchState = { type: 'folio_start', id: '__folio_start', x: 36, y: 30, ...(blocks.length ? { next: { block: chainState(blocks, current.current.catalog) } } : {}) };
        const parked = parkedStates(current.current.layout, current.current.catalog);
        Scratch.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: [state, ...parked] } }, ws);
        for (const id of current.current.layout?.collapsed ?? []) ws.getBlockById(id)?.setCollapsed(true);
        lastBlocks.current = JSON.stringify(blocks);
      } finally { Scratch.Events.enable(); applying.current = false; }
      Scratch.svgResize(ws);
    };
    render();
    return () => { resize.disconnect(); ws.removeChangeListener(onChange); ws.dispose(); workspace.current = null; };
  }, [catalogueKey, props.readOnly]);
  useEffect(() => {
    const ws = workspace.current;
    const json = JSON.stringify(props.blocks);
    if (!ws || json === lastBlocks.current) return;
    applying.current = true;
    Scratch.Events.disable();
    try {
      const oldScroll = { x: ws.scrollX, y: ws.scrollY };
      const state: ScratchState = { type: 'folio_start', id: '__folio_start', x: 36, y: 30, ...(props.blocks.length ? { next: { block: chainState(props.blocks, props.catalog) } } : {}) };
      const parked = parkedStates(props.layout, props.catalog);
      Scratch.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: [state, ...parked] } }, ws);
      for (const id of props.layout?.collapsed ?? []) ws.getBlockById(id)?.setCollapsed(true);
      ws.scroll(oldScroll.x, oldScroll.y);
      lastBlocks.current = json;
    } finally { Scratch.Events.enable(); applying.current = false; }
  }, [props.blocks, props.catalog, props.layout]);
  useEffect(() => { const block = props.selected ? workspace.current?.getAllBlocks(false).find(item => canonicalPath(item) === props.selected) : undefined; if (block && Scratch.getSelected() !== block) block.select(); }, [props.selected]);
  return <div className="t-scratch-workspace" ref={element} aria-label="Scratch-Arbeitsfläche" />;
});
