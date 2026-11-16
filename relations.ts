/**
 * bl-obligation-map — BlueLab Step 4. Turns the obligation_set + eventic_graph
 * (from bl-obligation-adapter) into an obligation map the student annotates with
 * dependency / conflict / enabling relations.
 *
 * Guardrail, same spirit as the adapter: a student-asserted relation is only
 * accepted if (a) its type is one of the allowed kinds, (b) both endpoints are
 * real obligations in this scenario, and (c) it carries a source citation that
 * points at a real chunk in the obligation set. Uncited or dangling relations are
 * returned as `unverified` and must not let the student advance.
 *
 * Self-contained (mirrors adapter.ts): the obligation/graph payloads are
 * re-declared here rather than imported, so the module copies cleanly into a
 * generated app.
 */

// ── Upstream payloads (bluelab.obligation_set / bluelab.eventic_graph) ───────
export type DeonticType = 'power' | 'right' | 'obligation' | 'permission' | 'prohibition';
export type DeonticWord = 'shall' | 'shall not' | 'may' | 'must' | 'must not' | 'may not';

export interface SourcedObligation {
  agent: string;
  deontic_word: DeonticWord;
  deontic_type: DeonticType;
  action: string;
  passive_role?: string;
  atomic_statement: string;
  source_chunk_id: string;
  source_text: string;
  confidence?: number;
}

export interface ObligationSetPayload {
  model: string;
  obligations: SourcedObligation[];
}

export interface EventicNode { id: string; label: string; kind: 'agent' | 'action' }
export interface EventicEdge { from: string; to: string; dword: DeonticWord; type: DeonticType; source_chunk_id: string }
export interface EventicGraphPayload { nodes: EventicNode[]; edges: EventicEdge[] }

// ── Student-asserted relations + the map output ──────────────────────────────
export const RELATION_TYPES = ['depends_on', 'conflicts_with', 'enables'] as const;
export type RelationType = typeof RELATION_TYPES[number];

export interface StudentRelation {
  source_obligation_id: string;
  target_obligation_id: string;
  relation_type: RelationType;
  /** Citation: the chunk whose text establishes this dependency. */
  source_chunk_id: string;
  rationale?: string;
}

/** An obligation with the stable id used to wire relations. */
export interface MapNode extends SourcedObligation { id: string }

export interface ObligationMapPayload {
  model: string;
  nodes: MapNode[];
  relations: StudentRelation[];
  eventic_graph: EventicGraphPayload;
}

export interface GuardrailFailure { rule: string; detail: string; relation_index: number }
export interface GuardrailResult { passed: boolean; failures: GuardrailFailure[] }

/** Stable, position-derived obligation id (obligations carry no id of their own). */
export function obligationId(index: number): string {
  return `obl-${index}`;
}

/**
 * Validate student relations against the obligation set.
 * `passed` is true only when every relation is well-typed, connects two distinct
 * real obligations, and cites a real chunk.
 */
export function validateRelations(
  relations: StudentRelation[],
  obligations: SourcedObligation[],
): GuardrailResult {
  const ids = new Set(obligations.map((_, i) => obligationId(i)));
  const knownChunks = new Set(obligations.map(o => o.source_chunk_id));
  const failures: GuardrailFailure[] = [];

  relations.forEach((rel, i) => {
    if (!RELATION_TYPES.includes(rel.relation_type)) {
      failures.push({ rule: 'relation_type', detail: `unknown relation_type "${rel.relation_type}"`, relation_index: i });
    }
    if (!ids.has(rel.source_obligation_id)) {
      failures.push({ rule: 'dangling_source', detail: `source ${rel.source_obligation_id} is not an obligation`, relation_index: i });
    }
    if (!ids.has(rel.target_obligation_id)) {
      failures.push({ rule: 'dangling_target', detail: `target ${rel.target_obligation_id} is not an obligation`, relation_index: i });
    }
    if (rel.source_obligation_id === rel.target_obligation_id) {
      failures.push({ rule: 'self_loop', detail: `${rel.source_obligation_id} relates to itself`, relation_index: i });
    }
    if (!rel.source_chunk_id || !knownChunks.has(rel.source_chunk_id)) {
      failures.push({ rule: 'missing_citation', detail: `relation cites unknown or empty chunk "${rel.source_chunk_id}"`, relation_index: i });
    }
  });

  return { passed: failures.length === 0, failures };
}

/**
 * Assemble the obligation_map artifact. Valid relations land in `relations`;
 * invalid ones are split out as `unverified` so the UI can flag them and the
 * advance gate stays closed until they are fixed.
 */
export function buildObligationMap(
  obligationSet: ObligationSetPayload,
  eventicGraph: EventicGraphPayload,
  relations: StudentRelation[] = [],
): { obligation_map: ObligationMapPayload; unverified: StudentRelation[]; guardrail: GuardrailResult } {
  const nodes: MapNode[] = obligationSet.obligations.map((o, i) => ({ ...o, id: obligationId(i) }));

  const badIndices = new Set<number>();
  const perRelation = relations.map((rel, i) => validateRelations([rel], obligationSet.obligations));
  perRelation.forEach((r, i) => { if (!r.passed) badIndices.add(i); });

  const valid = relations.filter((_, i) => !badIndices.has(i));
  const unverified = relations.filter((_, i) => badIndices.has(i));
  const guardrail = validateRelations(relations, obligationSet.obligations);

  return {
    obligation_map: {
      model: obligationSet.model,
      nodes,
      relations: valid,
      eventic_graph: eventicGraph,
    },
    unverified,
    guardrail,
  };
}

export default buildObligationMap;
