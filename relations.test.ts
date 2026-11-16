/**
 * Tests for the obligation map relations + guardrail.
 * Run: npx tsx modules/obligation-map/relations.test.ts
 */
import assert from 'node:assert';
import {
  buildObligationMap,
  validateRelations,
  obligationId,
  type ObligationSetPayload,
  type EventicGraphPayload,
  type StudentRelation,
} from './relations.ts';

let passed = 0;
const ok = (name: string, fn: () => void) => { fn(); passed++; console.log('  ✓', name); };

const obligationSet: ObligationSetPayload = {
  model: 'dt-tfidf',
  obligations: [
    { agent: 'Member State', deontic_word: 'shall', deontic_type: 'obligation', action: 'establish maritime spatial plans', atomic_statement: 'MS shall establish MSP', source_chunk_id: 'MSP-ART4-P1', source_text: 'Each Member State shall establish maritime spatial plans.' },
    { agent: 'the undertaking', deontic_word: 'shall', deontic_type: 'obligation', action: 'disclose water consumption', atomic_statement: 'undertaking shall disclose', source_chunk_id: 'ESRS-E3-4-P26', source_text: 'The undertaking shall disclose water consumption.' },
  ],
};

const eventicGraph: EventicGraphPayload = { nodes: [], edges: [] };

ok('obligationId is stable and position-derived', () => {
  assert.equal(obligationId(0), 'obl-0');
  assert.equal(obligationId(1), 'obl-1');
});

ok('a fully-cited relation between two real obligations passes', () => {
  const rels: StudentRelation[] = [
    { source_obligation_id: 'obl-0', target_obligation_id: 'obl-1', relation_type: 'enables', source_chunk_id: 'MSP-ART4-P1' },
  ];
  const { obligation_map, unverified, guardrail } = buildObligationMap(obligationSet, eventicGraph, rels);
  assert.equal(guardrail.passed, true);
  assert.equal(unverified.length, 0);
  assert.equal(obligation_map.relations.length, 1);
  assert.equal(obligation_map.nodes.length, 2);
  assert.equal(obligation_map.nodes[0].id, 'obl-0');
});

ok('an uncited relation is rejected and quarantined as unverified', () => {
  const rels: StudentRelation[] = [
    { source_obligation_id: 'obl-0', target_obligation_id: 'obl-1', relation_type: 'depends_on', source_chunk_id: '' },
  ];
  const { obligation_map, unverified, guardrail } = buildObligationMap(obligationSet, eventicGraph, rels);
  assert.equal(guardrail.passed, false);
  assert.equal(obligation_map.relations.length, 0);
  assert.equal(unverified.length, 1);
  assert.ok(guardrail.failures.some(f => f.rule === 'missing_citation'));
});

ok('a relation citing an unknown chunk fails missing_citation', () => {
  const rels: StudentRelation[] = [
    { source_obligation_id: 'obl-0', target_obligation_id: 'obl-1', relation_type: 'depends_on', source_chunk_id: 'NOT-A-CHUNK' },
  ];
  const { guardrail } = buildObligationMap(obligationSet, eventicGraph, rels);
  assert.equal(guardrail.passed, false);
  assert.ok(guardrail.failures.some(f => f.rule === 'missing_citation'));
});

ok('a relation to a non-existent obligation fails dangling_target', () => {
  const rels: StudentRelation[] = [
    { source_obligation_id: 'obl-0', target_obligation_id: 'obl-9', relation_type: 'conflicts_with', source_chunk_id: 'MSP-ART4-P1' },
  ];
  const { guardrail, unverified } = buildObligationMap(obligationSet, eventicGraph, rels);
  assert.equal(guardrail.passed, false);
  assert.equal(unverified.length, 1);
  assert.ok(guardrail.failures.some(f => f.rule === 'dangling_target'));
});

ok('self-loops are flagged', () => {
  const r = validateRelations(
    [{ source_obligation_id: 'obl-0', target_obligation_id: 'obl-0', relation_type: 'enables', source_chunk_id: 'MSP-ART4-P1' }],
    obligationSet.obligations,
  );
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f => f.rule === 'self_loop'));
});

ok('an unknown relation_type is rejected', () => {
  const r = validateRelations(
    [{ source_obligation_id: 'obl-0', target_obligation_id: 'obl-1', relation_type: 'causes' as any, source_chunk_id: 'MSP-ART4-P1' }],
    obligationSet.obligations,
  );
  assert.equal(r.passed, false);
  assert.ok(r.failures.some(f => f.rule === 'relation_type'));
});

console.log(`\nobligation-map: ${passed} passed`);
