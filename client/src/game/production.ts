// Build & production pipelines: construction sites for buildings plus a
// lane-limited production queue. Every producer (barracks, upgraded building)
// owns an independent lane group, so several barracks build in parallel;
// upgrade jobs join the same queue and share a building's capacity. Pure
// logic, no DOM.

import { credit, spend, type Economy, type QueueItem } from './economy.js';
import {
  BUILDING_DEFS,
  canPlace,
  place,
  type Building,
  type BuildingKind,
  type PlaceFailReason,
} from './buildings.js';
import { UNIT_STATS, type UnitKind } from './units.js';
import { inBounds, isPassable, type GameMap } from './grid.js';
import type { Point } from './selection.js';
import {
  UPGRADE_TABLE,
  canUpgrade,
  type UpgradeEffect,
  type UpgradeFailReason,
  type UpgradeLevel,
} from './upgrades.js';

/** Orders a single producer may run simultaneously; extra orders wait. */
export const PARALLEL_PER_BARRACKS = 1;

/**
 * @deprecated Flat refund kept for API compatibility — cancels now scale the
 * refund by progress instead (0% done refunds everything, 100% nothing).
 */
export const CANCEL_REFUND_RATIO = 0.5;

/** Tunable rule for progress-scaled cancel refunds. */
export interface RefundPolicy {
  /**
   * Fraction of the *unbuilt* share returned on cancel, 0..1 (default 1 —
   * a cancel at 0% progress refunds everything, at 100% nothing). Values
   * outside the range are clamped.
   */
  rate?: number;
}

/**
 * Progress-scaled cancel refund: floor(cost × (1 − progress) × rate),
 * clamped to [0, cost] — the amount credited back never exceeds the price
 * paid up front. Callers can preview the same number via this helper.
 */
export function refundAmount(
  cost: number,
  elapsed: number,
  buildTime: number,
  policy: RefundPolicy = {},
): number {
  const progress = buildTime > 0 ? Math.min(1, Math.max(0, elapsed / buildTime)) : 0;
  const rate = Math.min(1, Math.max(0, policy.rate ?? 1));
  return Math.max(0, Math.min(Math.floor(cost), Math.floor(cost * (1 - progress) * rate)));
}

// ---------------------------------------------------------- construction ----

export interface Construction {
  kind: BuildingKind;
  gx: number; // top-left tile of the footprint
  gy: number;
  cost: number; // paid up front at startConstruction
  buildTime: number; // seconds, copied from BUILDING_DEFS
  elapsed: number;
  progress: number; // 0..1
}

export type StartResult =
  | { ok: true; item: Construction }
  | { ok: false; reason: PlaceFailReason | 'funds' | 'requires'; missing?: BuildingKind[] };

function overlapsPending(c: Construction, kind: BuildingKind, gx: number, gy: number): boolean {
  const a = BUILDING_DEFS[c.kind];
  const b = BUILDING_DEFS[kind];
  return gx < c.gx + a.w && gx + b.w > c.gx && gy < c.gy + a.h && gy + b.h > c.gy;
}

/**
 * Validate the footprint (terrain, bounds, existing buildings and in-progress
 * sites), charge the full cost, and return a new construction entry with
 * progress 0. Nothing is deducted or queued on failure.
 */
export function startConstruction(
  kind: BuildingKind,
  gx: number,
  gy: number,
  e: Economy,
  buildings: readonly Building[],
  map: GameMap,
  pending: readonly Construction[] = [],
  requires?: readonly BuildingKind[],
): StartResult {
  const chk = canPlace(map, buildings, kind, gx, gy);
  if (!chk.ok) return { ok: false, reason: chk.reason ?? 'oob' };
  for (const c of pending) {
    if (overlapsPending(c, kind, gx, gy)) return { ok: false, reason: 'overlap' };
  }
  // Tech prerequisite: every declared kind must exist finished on the field
  // before the site may start (kinds absent from PRODUCTION_REQUIRES are
  // unrestricted; an explicit `requires` overrides the table).
  const missing = missingRequirements({ buildings }, kind, requires);
  if (missing.length > 0) return { ok: false, reason: 'requires', missing };
  const def = BUILDING_DEFS[kind];
  if (!spend(e, def.cost)) return { ok: false, reason: 'funds' };
  return {
    ok: true,
    item: { kind, gx, gy, cost: def.cost, buildTime: def.buildTime, elapsed: 0, progress: 0 },
  };
}

/**
 * Advance every site in `list` by `dt` seconds (sites build in parallel).
 * Finished sites are removed and their buildings appended to `buildings`
 * with done=true via `nextId`. Returns the buildings placed this tick.
 */
export function tickConstruction(
  list: Construction[],
  dt: number,
  buildings: Building[],
  nextId: () => number,
): Building[] {
  const built: Building[] = [];
  if (!(dt > 0)) return built;
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]!;
    c.elapsed += dt;
    c.progress = Math.min(1, c.elapsed / c.buildTime);
    if (c.elapsed >= c.buildTime) {
      list.splice(i, 1);
      const b = place(buildings, c.kind, c.gx, c.gy, nextId());
      b.done = true;
      built.push(b);
    }
  }
  return built;
}

/**
 * Remove a site and refund what hasn't been built: progress 0 refunds the
 * full cost, progress 1 refunds nothing (site is about to finish anyway).
 * `policy` tunes the refund rate; the payout is floored and never exceeds
 * the price paid.
 */
export function cancelConstruction(
  list: Construction[],
  e: Economy,
  index: number,
  policy: RefundPolicy = {},
): boolean {
  if (index < 0 || index >= list.length) return false;
  const [c] = list.splice(index, 1);
  credit(e, refundAmount(c!.cost, c!.elapsed, c!.buildTime, policy));
  return true;
}

// ------------------------------------------------------------ production ----

export interface UnitOrder extends QueueItem {
  type: 'unit';
  kind: UnitKind;
  /** Producer building id; orders sharing it run in that building's lanes. */
  barracksId?: number;
  /** Where the fresh unit walks after spawning (its barracks' rally point). */
  rally?: Point;
  /**
   * Queue priority — higher values are inserted ahead of lower-priority
   * waiting orders in the same lane. In-progress work is never preempted.
   */
  priority?: number;
  /** Idempotency token stamped by settleOrders; dedups retried requests. */
  requestId?: string;
}

/**
 * A building upgrade queued like a unit order. Its lane group is the target
 * building itself, so upgrading a barracks occupies that barracks' capacity
 * just like training would; cost/time come from UPGRADE_TABLE. When a tick
 * completes it, the caller applies `to`/`effect`/`multiplier` to the building.
 */
export interface UpgradeOrder extends QueueItem {
  type: 'upgrade';
  kind: BuildingKind; // building kind being upgraded
  buildingId: number;
  from: UpgradeLevel;
  to: UpgradeLevel;
  effect: UpgradeEffect;
  multiplier: number;
  /** Queue priority — same lane semantics as UnitOrder.priority. */
  priority?: number;
}

export type ProductionOrder = UnitOrder | UpgradeOrder;

export type UnitQueue = ProductionOrder[];

export function createUnitQueue(): UnitQueue {
  return [];
}

// ---------------------------------------------------------- prerequisites ---

/** Anything the production side can make: a unit kind or a building kind. */
export type ProducibleKind = UnitKind | BuildingKind;

/**
 * Declared tech prerequisites: every listed building kind must exist
 * *finished* (done) before the producible may be queued. The HQ doubles as
 * the radar dish, so "tank needs radar + barracks" reads as barracks + hq;
 * the harvester needs a refinery to unload at. Kinds absent from the table
 * have no prerequisite beyond funds — callers may also pass an explicit
 * `requires` list to any function below to override the table.
 */
export const PRODUCTION_REQUIRES: Partial<
  Record<ProducibleKind, readonly BuildingKind[]>
> = {
  infantry: ['barracks'],
  tank: ['barracks', 'hq'],
  harvester: ['refinery'],
};

/** Minimal state needed to answer prerequisite questions (UI-facing). */
export interface ProduceState {
  buildings: readonly Building[];
}

/** Declared prerequisites for `kind` (explicit `requires` wins over the table). */
export function requirementsFor(
  kind: ProducibleKind,
  requires?: readonly BuildingKind[],
): readonly BuildingKind[] {
  return requires ?? PRODUCTION_REQUIRES[kind] ?? [];
}

/**
 * The declared prerequisite kinds not yet satisfied: no finished building
 * of that kind stands on the field. Each missing kind is reported once, in
 * declaration order, so UI can name the blocker instead of failing silently.
 */
export function missingRequirements(
  state: ProduceState,
  kind: ProducibleKind,
  requires?: readonly BuildingKind[],
): BuildingKind[] {
  const missing: BuildingKind[] = [];
  for (const k of requirementsFor(kind, requires)) {
    if (missing.includes(k)) continue;
    if (!state.buildings.some((b) => b.kind === k && b.done)) missing.push(k);
  }
  return missing;
}

/** True when every declared prerequisite for `kind` is satisfied. */
export function canProduce(
  state: ProduceState,
  kind: ProducibleKind,
  requires?: readonly BuildingKind[],
): boolean {
  return missingRequirements(state, kind, requires).length === 0;
}

// ------------------------------------------------------------- tech tree ---

/** Tech-tree tiers in unlock order: 兵营 → 雷达 → 重工 → 高科. */
export type TechTier = 'barracks' | 'radar' | 'factory' | 'tech';

export interface TechStage {
  tier: TechTier;
  /** 文案 key — the UI resolves it to the stage's localized name. */
  labelKey: string;
  /** Building kinds the stage needs — every one must stand finished. */
  requires: readonly BuildingKind[];
}

/**
 * The production tech chain: each stage builds on every earlier one, so
 * reaching 'tech' implies the whole ladder stands. With the current
 * building roster the HQ doubles as the radar dish (buildings.ts
 * convention), the refinery stands in as the 重工 plant, and the power
 * plant as the 高科 lab; a richer roster can pass its own `tree` to the
 * functions below.
 */
export const TECH_TREE: readonly TechStage[] = [
  { tier: 'barracks', labelKey: 'tech.barracks', requires: ['barracks'] },
  { tier: 'radar', labelKey: 'tech.radar', requires: ['hq'] },
  { tier: 'factory', labelKey: 'tech.factory', requires: ['refinery'] },
  { tier: 'tech', labelKey: 'tech.tech', requires: ['power'] },
];

/** One unmet stage on the way to a tech tier — a named `missing` reason. */
export interface TechGap {
  tier: TechTier;
  /** 文案 key naming the gated stage. */
  labelKey: string;
  /** Stage buildings still missing — every listed kind must be finished. */
  missing: BuildingKind[];
}

/**
 * The unmet stages between the field's current tech and `tier`, reported in
 * chain order (a missing early stage gates everything above it). Each gap
 * names its stage via `labelKey` and lists the buildings still required.
 */
export function missingTech(
  state: ProduceState,
  tier: TechTier,
  tree: readonly TechStage[] = TECH_TREE,
): TechGap[] {
  const gaps: TechGap[] = [];
  for (const stage of tree) {
    const missing = missingRequirements(state, stage.requires[0] ?? 'barracks', stage.requires);
    if (missing.length > 0) {
      gaps.push({ tier: stage.tier, labelKey: stage.labelKey, missing });
    }
    if (stage.tier === tier) break;
  }
  return gaps;
}

/** True when every stage up to and including `tier` is satisfied. */
export function canReachTech(
  state: ProduceState,
  tier: TechTier,
  tree: readonly TechStage[] = TECH_TREE,
): boolean {
  return missingTech(state, tier, tree).length === 0;
}

/**
 * The cumulative flat prerequisite list for reaching `tier` (each stage's
 * requires, deduped, in chain order) — suitable as the `requires` argument
 * of the enqueue/construction functions above.
 */
export function requirementsForTier(
  tier: TechTier,
  tree: readonly TechStage[] = TECH_TREE,
): BuildingKind[] {
  const out: BuildingKind[] = [];
  for (const stage of tree) {
    for (const k of stage.requires) {
      if (!out.includes(k)) out.push(k);
    }
    if (stage.tier === tier) break;
  }
  return out;
}

/**
 * Where each producible sits on the tech chain; kinds absent here have no
 * tier gate (they may still carry flat PRODUCTION_REQUIRES prerequisites —
 * e.g. the harvester's refinery is a dropoff rule, but its 'factory' tier
 * makes the whole chain barracks → radar → 重工 the canonical gate).
 */
export const PRODUCTION_TIER: Partial<Record<ProducibleKind, TechTier>> = {
  infantry: 'barracks',
  tank: 'radar',
  harvester: 'factory',
};

/**
 * The tech-chain gaps blocking `kind`: the unmet stages up to its declared
 * PRODUCTION_TIER, or [] when the kind has no tier gate.
 */
export function missingTechFor(
  state: ProduceState,
  kind: ProducibleKind,
  tree: readonly TechStage[] = TECH_TREE,
): TechGap[] {
  const tier = PRODUCTION_TIER[kind];
  return tier === undefined ? [] : missingTech(state, tier, tree);
}

export type EnqueueFailReason = 'funds' | 'requires';

export type EnqueueUnitResult =
  | { ok: true; order: UnitOrder }
  | { ok: false; reason: EnqueueFailReason; missing?: BuildingKind[] };

export interface EnqueueUnitOpts {
  /** Field buildings to check prerequisites against; omit to skip the check. */
  buildings?: readonly Building[];
  /** Explicit prerequisite list; defaults to PRODUCTION_REQUIRES[kind]. */
  requires?: readonly BuildingKind[];
  /** Producer building id — the order runs in that building's lane. */
  barracksId?: number;
  /** Rally point store used to stamp the order's spawn destination. */
  rally?: RallyPoints;
  /**
   * Queue priority — higher values land ahead of lower-priority waiting
   * orders in the same lane; work already in progress is never preempted.
   */
  priority?: number;
  /**
   * Idempotency token for shared-fund settlement: when the queue already
   * holds an order with the same token the call returns it unchanged and
   * charges nothing, so a retried enqueue can never double-spend.
   */
  requestId?: string;
}

/**
 * Prerequisite-aware enqueue returning the failure reason ('requires' lists
 * the missing building kinds) instead of a bare boolean. With `barracksId`
 * set the order runs in that building's lane and is stamped with its rally
 * point; `priority` lets it jump waiting siblings. Nothing is charged or
 * queued on failure.
 */
export function enqueueUnitChecked(
  q: UnitQueue,
  e: Economy,
  kind: UnitKind,
  opts: EnqueueUnitOpts = {},
): EnqueueUnitResult {
  if (opts.requestId !== undefined) {
    const dup = q.find((o) => o.type === 'unit' && o.requestId === opts.requestId);
    if (dup) return { ok: true, order: dup as UnitOrder };
  }
  if (opts.buildings !== undefined) {
    const missing = missingRequirements({ buildings: opts.buildings }, kind, opts.requires);
    if (missing.length > 0) return { ok: false, reason: 'requires', missing };
  }
  const s = UNIT_STATS[kind];
  const order: UnitOrder = {
    type: 'unit',
    key: kind,
    kind,
    cost: s.cost,
    buildTime: s.buildTime,
    elapsed: 0,
  };
  if (opts.priority !== undefined) order.priority = opts.priority;
  if (opts.requestId !== undefined) order.requestId = opts.requestId;
  if (opts.barracksId !== undefined) {
    order.barracksId = opts.barracksId;
    const p = opts.rally?.get(opts.barracksId);
    if (p) order.rally = { x: p.x, y: p.y };
  }
  if (!spend(e, order.cost)) return { ok: false, reason: 'funds' };
  q.splice(laneInsertIndex(q, order), 0, order);
  return { ok: true, order };
}

/**
 * Pay the unit's full cost up front (economy.enqueue semantics) and append
 * the order. Returns false without mutating the queue when unaffordable —
 * or, when `buildings` is passed, when a declared prerequisite is missing
 * (use missingRequirements/canProduce for the reason). Orders enqueued this
 * way are unassigned — they share the default lane.
 */
export function enqueueUnit(
  q: UnitQueue,
  e: Economy,
  kind: UnitKind,
  buildings?: readonly Building[],
  requires?: readonly BuildingKind[],
): boolean {
  return enqueueUnitChecked(q, e, kind, { buildings, requires }).ok;
}

/**
 * Like enqueueUnit, but bound to one barracks: the order runs in that
 * building's own lane (so two barracks produce different kinds in parallel)
 * and is stamped with the barracks' current rally point from `rally`.
 * Passing `buildings` also enforces the unit's declared prerequisites.
 */
export function enqueueUnitTo(
  q: UnitQueue,
  e: Economy,
  kind: UnitKind,
  barracksId: number,
  rally?: RallyPoints,
  buildings?: readonly Building[],
  requires?: readonly BuildingKind[],
): boolean {
  return enqueueUnitChecked(q, e, kind, { buildings, requires, barracksId, rally }).ok;
}

// ------------------------------------------------------------- settlement ---

/** One order in a batch settlement — `requestId` makes retries idempotent. */
export interface SettleSpec {
  kind: UnitKind;
  /**
   * Idempotency token shared across producers: a duplicate inside the batch
   * or an order already queued under the same token is reported as deduped
   * and never charged twice.
   */
  requestId: string;
  /** Producer building id — the order runs in that building's lane. */
  barracksId?: number;
  /** Queue priority — same lane semantics as EnqueueUnitOpts.priority. */
  priority?: number;
}

export interface SettleReject {
  spec: SettleSpec;
  reason: EnqueueFailReason;
  missing?: BuildingKind[];
}

export interface SettleResult {
  /** Orders newly queued and charged this call. */
  queued: UnitOrder[];
  /** Orders already queued under the same requestId — not charged again. */
  deduped: UnitOrder[];
  /** Specs that failed prerequisite or funds checks — nothing charged. */
  rejected: SettleReject[];
}

/**
 * Shared-fund settlement for several producers in one tick: run a batch of
 * unit orders against the same economy, charging each exactly once. Dedup
 * is by `requestId` — retrying the whole batch after a failure returns the
 * first call's orders under `deduped` instead of double-spending. Specs are
 * processed in order; each failure is collected (with its `missing` list
 * for prerequisite rejections) and does not abort the rest of the batch.
 */
export function settleOrders(
  q: UnitQueue,
  e: Economy,
  specs: readonly SettleSpec[],
  opts: Omit<EnqueueUnitOpts, 'barracksId' | 'priority' | 'requestId'> = {},
): SettleResult {
  const res: SettleResult = { queued: [], deduped: [], rejected: [] };
  for (const spec of specs) {
    const existed = q.some((o) => o.type === 'unit' && o.requestId === spec.requestId);
    const r = enqueueUnitChecked(q, e, spec.kind, {
      ...opts,
      barracksId: spec.barracksId,
      priority: spec.priority,
      requestId: spec.requestId,
    });
    if (!r.ok) {
      const rej: SettleReject = { spec, reason: r.reason };
      if (r.missing !== undefined) rej.missing = r.missing;
      res.rejected.push(rej);
    } else if (existed) {
      res.deduped.push(r.order);
    } else {
      res.queued.push(r.order);
    }
  }
  return res;
}

// ---------------------------------------------------------- rally points ---

/** Per-barracks rally targets: building id → world-space destination. */
export type RallyPoints = Map<number, Point>;

export function createRallyPoints(): RallyPoints {
  return new Map();
}

/**
 * Record where units from `barracksId` walk after spawning. Already queued
 * orders for that barracks are re-stamped so completions head for the
 * latest point — the data lives here plus on each order's `rally` field,
 * which is the instruction a caller executes when the unit spawns.
 */
export function setRallyPoint(
  rally: RallyPoints,
  q: UnitQueue,
  barracksId: number,
  to: Point,
): void {
  rally.set(barracksId, { x: to.x, y: to.y });
  for (const o of q) {
    if (o.type === 'unit' && o.barracksId === barracksId) o.rally = { x: to.x, y: to.y };
  }
}

/** Drop a barracks' rally point; pending orders for it lose their `rally`. */
export function clearRallyPoint(rally: RallyPoints, q: UnitQueue, barracksId: number): void {
  rally.delete(barracksId);
  for (const o of q) {
    if (o.type === 'unit' && o.barracksId === barracksId) delete o.rally;
  }
}

// -------------------------------------------------------------- upgrades ---

export type EnqueueUpgradeResult =
  | { ok: true; order: UpgradeOrder }
  | { ok: false; reason: UpgradeFailReason };

/**
 * Queue a building upgrade like a unit order: canUpgrade validates the
 * target (finished, below max level, powered when required, affordable),
 * one job per building at a time ('busy' if already queued), and the tier
 * cost is charged up front. `opts.priority` lands the job ahead of
 * lower-priority waiting orders in the building's lane. The job occupies
 * the target
 * building's own lane — upgrading a barracks shares that barracks'
 * production capacity instead of running on the side.
 */
export function enqueueUpgrade(
  q: UnitQueue,
  e: Economy,
  b: Building,
  level: UpgradeLevel,
  powered: boolean,
  opts: { priority?: number } = {},
): EnqueueUpgradeResult {
  if (q.some((o) => o.type === 'upgrade' && o.buildingId === b.id)) {
    return { ok: false, reason: 'busy' };
  }
  const chk = canUpgrade(b, level, e.credits, powered);
  if (!chk.ok) return chk;
  const to: UpgradeLevel = level === 1 ? 2 : 3; // canUpgrade proved level < MAX_LEVEL
  const tier = UPGRADE_TABLE[b.kind][to];
  const order: UpgradeOrder = {
    type: 'upgrade',
    key: `upgrade:${b.id}`,
    kind: b.kind,
    buildingId: b.id,
    from: level,
    to,
    cost: tier.cost,
    buildTime: tier.time,
    elapsed: 0,
    effect: tier.effect,
    multiplier: tier.multiplier,
  };
  if (opts.priority !== undefined) order.priority = opts.priority;
  if (!spend(e, order.cost)) return { ok: false, reason: 'funds' };
  q.splice(laneInsertIndex(q, order), 0, order);
  return { ok: true, order };
}

// ------------------------------------------------------------------ tick ---

/** Lane group an order belongs to: its producer building (default lane if unset). */
function laneKey(o: ProductionOrder): number | undefined {
  return o.type === 'upgrade' ? o.buildingId : o.barracksId;
}

/**
 * Queue position for a new order: behind every same-lane sibling that is
 * already in progress (in-progress work is never preempted) or waiting
 * with priority >= the new order's — a tie keeps FIFO, never jumping a
 * queued sibling — and ahead of same-lane waiting siblings with lower
 * priority. Orders on other lanes keep their positions; tickProduction
 * regroups by lane anyway, so only same-lane relative order matters.
 */
function laneInsertIndex(q: UnitQueue, order: ProductionOrder): number {
  const key = laneKey(order);
  const pri = order.priority ?? 0;
  for (let i = 0; i < q.length; i++) {
    const o = q[i]!;
    if (laneKey(o) !== key || o.elapsed > 0) continue;
    if ((o.priority ?? 0) < pri) return i;
  }
  return q.length;
}

/**
 * Advance one lane group: the first `lanes` orders each get the full `dt`;
 * when one completes, the freed lane's leftover time flows into the next
 * waiting order. Finished orders are spliced out and pushed onto `done`.
 */
function tickLanes(
  list: ProductionOrder[],
  dt: number,
  lanes: number,
  done: ProductionOrder[],
): void {
  let remaining = dt;
  while (remaining > 0) {
    const active = Math.min(lanes, list.length);
    if (active === 0) break;
    let minNeed = Infinity;
    for (let i = 0; i < active; i++) {
      minNeed = Math.min(minNeed, list[i]!.buildTime - list[i]!.elapsed);
    }
    const step = Math.min(remaining, Math.max(0, minNeed));
    for (let i = 0; i < active; i++) list[i]!.elapsed += step;
    remaining -= step;
    let removed = 0;
    for (let i = 0; i < active; i++) {
      const o = list[i - removed];
      if (o!.elapsed >= o!.buildTime) {
        done.push(o!);
        list.splice(i - removed, 1);
        removed++;
      }
    }
  }
}

/**
 * Advance every producer's lanes by `dt` seconds. Orders are grouped by
 * their producer building (unit orders by `barracksId`, upgrade jobs by
 * `buildingId`, unassigned orders in one shared lane); each group runs
 * `parallel` lanes (default PARALLEL_PER_BARRACKS) and consumes the full
 * `dt` independently, so two barracks finish different units in the same
 * tick. Returns the orders completed this tick (already removed) — unit
 * orders carry `rally` for the caller's spawn move, upgrade orders carry
 * `buildingId`/`to`/`multiplier` to apply. Queue order is rebuilt grouped
 * by producer (first-appearance order), preserving per-producer FIFO.
 */
export function tickProduction(
  q: UnitQueue,
  dt: number,
  parallel = PARALLEL_PER_BARRACKS,
): ProductionOrder[] {
  const done: ProductionOrder[] = [];
  if (!(dt > 0)) return done;
  const lanes = Math.max(1, Math.floor(parallel));
  const groups = new Map<number | undefined, ProductionOrder[]>();
  for (const o of q) {
    const k = laneKey(o);
    const list = groups.get(k);
    if (list) list.push(o);
    else groups.set(k, [o]);
  }
  const rest: ProductionOrder[] = [];
  for (const list of groups.values()) {
    tickLanes(list, dt, lanes, done);
    rest.push(...list);
  }
  q.length = 0;
  q.push(...rest);
  return done;
}

/**
 * Move the order at `index` to the front of its producer's lane so it
 * builds ahead of its lane siblings: it is reinserted before the first
 * order sharing its lane group (unit orders group by `barracksId`, upgrade
 * jobs by `buildingId`, unassigned orders share the default lane). Other
 * lanes keep their relative order untouched. Returns false on a bad index.
 * No money moves — the order stays paid and queued.
 */
export function promoteOrder(q: UnitQueue, index: number): boolean {
  if (index < 0 || index >= q.length) return false;
  const [o] = q.splice(index, 1);
  const key = laneKey(o!);
  let i = 0;
  while (i < q.length && laneKey(q[i]!) !== key) i++;
  q.splice(i, 0, o!);
  return true;
}

/**
 * Remove an order (unit or upgrade) and refund what hasn't been produced:
 * 0% elapsed refunds the full cost, 100% refunds nothing. `policy` tunes
 * the refund rate; the payout is floored and never exceeds the price paid.
 */
export function cancelUnit(
  q: UnitQueue,
  e: Economy,
  index: number,
  policy: RefundPolicy = {},
): boolean {
  if (index < 0 || index >= q.length) return false;
  const [o] = q.splice(index, 1);
  credit(e, refundAmount(o!.cost, o!.elapsed, o!.buildTime, policy));
  return true;
}

// -------------------------------------------------------------- spawning ---

/**
 * The producer a unit order exits from: its stamped barracks, else the
 * first finished barracks, else any finished building — the same fallback
 * chain the in-game spawner uses, so a dead producer's orphan order still
 * surfaces somewhere sensible.
 */
export function producerFor(
  o: UnitOrder,
  buildings: readonly Building[],
): Building | undefined {
  return (
    (o.barracksId !== undefined
      ? buildings.find((b) => b.id === o.barracksId && b.done)
      : undefined) ??
    buildings.find((b) => b.kind === 'barracks' && b.done) ??
    buildings.find((b) => b.done) ??
    buildings[0]
  );
}

/** Spawn tiles are claimed by index so a `taken` set stays allocation-free. */
function tileIndex(map: GameMap, x: number, y: number): number {
  return y * map.w + x;
}

/** A unit may spawn on passable terrain outside every footprint that no sibling claimed. */
function spawnTileFree(
  map: GameMap,
  buildings: readonly Building[],
  taken: ReadonlySet<number>,
  x: number,
  y: number,
): boolean {
  if (!isPassable(map, x, y) || taken.has(tileIndex(map, x, y))) return false;
  for (const b of buildings) {
    const d = BUILDING_DEFS[b.kind];
    if (x >= b.gx && x < b.gx + d.w && y >= b.gy && y < b.gy + d.h) return false;
  }
  return true;
}

/**
 * First free spawn tile spiraling out from (cx,cy) in deterministic scan
 * order, skipping tiles claimed in `taken`. Returns undefined when the
 * search radius is exhausted.
 */
export function spawnTileNear(
  map: GameMap,
  buildings: readonly Building[],
  taken: ReadonlySet<number>,
  cx: number,
  cy: number,
  maxR = 20,
): Point | undefined {
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (spawnTileFree(map, buildings, taken, x, y)) return { x, y };
      }
    }
  }
  return undefined;
}

/**
 * Assign one spawn tile per unit order — when several producers finish in
 * the same tick their fresh units never land on the same tile: every pick
 * joins the claimed set before the next order is placed. `occupied` seeds
 * the claimed set with tiles units already stand on (world→tile callers
 * convert before passing). Returns tiles parallel to `orders`; an entry is
 * undefined when no free tile exists inside `maxR`, leaving the caller to
 * defer that spawn.
 */
export function assignSpawnTiles(
  map: GameMap,
  buildings: readonly Building[],
  orders: readonly UnitOrder[],
  occupied: readonly Point[] = [],
  maxR = 20,
): (Point | undefined)[] {
  const taken = new Set<number>();
  for (const p of occupied) {
    if (inBounds(map, p.x, p.y)) taken.add(tileIndex(map, p.x, p.y));
  }
  return orders.map((o) => {
    const rax = producerFor(o, buildings);
    const ax = rax ? rax.gx + (BUILDING_DEFS[rax.kind].w >> 1) : map.w >> 1;
    const ay = rax ? rax.gy + BUILDING_DEFS[rax.kind].h : map.h >> 1;
    const t = spawnTileNear(map, buildings, taken, ax, ay, maxR);
    if (t) taken.add(tileIndex(map, t.x, t.y));
    return t;
  });
}

// ------------------------------------------------------ AI suggestions ----

/** Pure input for production advice — no game-state mutation, no DOM. */
export interface SuggestProductionInput {
  /** Credits on hand — suggestions never exceed it. */
  credits: number;
  /** Field buildings for prerequisite/tech-chain checks. */
  buildings: readonly Building[];
  /** Unit kinds the caller already fields — steers the economy heuristic. */
  owned?: readonly UnitKind[];
}

export interface ProductionSuggestion {
  kind: UnitKind;
  cost: number;
  buildTime: number;
  /** 文案 key explaining the pick — the caller resolves it for display. */
  reasonKey: string;
}

/**
 * Recommend what to build next given funds and tech (pure — safe for the
 * enemy AI to call with its own wallet). Rules, in rank order:
 *
 * 1. Field a harvester first when the caller owns none — economy pays for
 *    everything else ('ai.suggest.economy').
 * 2. Then the strongest combat unit the tech chain allows — the tank once
 *    兵营+雷达 stand ('ai.suggest.force').
 * 3. The infantry is the always-affordable fallback ('ai.suggest.filler').
 *
 * A kind is skipped when its flat prerequisites or its PRODUCTION_TIER
 * chain is unmet, or when it costs more than `credits`; the result may be
 * empty (broke and tech-locked alike).
 */
export function suggestProduction(input: SuggestProductionInput): ProductionSuggestion[] {
  const out: ProductionSuggestion[] = [];
  const state = { buildings: input.buildings };
  const hasHarvester = (input.owned ?? []).includes('harvester');
  for (const kind of ['harvester', 'tank', 'infantry'] as const) {
    const s = UNIT_STATS[kind];
    if (s.cost > input.credits) continue;
    if (!canProduce(state, kind)) continue;
    if (missingTechFor(state, kind).length > 0) continue;
    let reasonKey = 'ai.suggest.filler';
    if (kind === 'harvester') {
      if (hasHarvester) continue;
      reasonKey = 'ai.suggest.economy';
    } else if (kind === 'tank') {
      reasonKey = 'ai.suggest.force';
    }
    out.push({ kind, cost: s.cost, buildTime: s.buildTime, reasonKey });
  }
  return out;
}
