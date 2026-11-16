<template>
  <div class="lb-page page-map">
    <div class="page-header">
      <div class="eyebrow">compliance · step 3</div>
      <h1 class="serif page-title">Obligation Map</h1>
      <p class="page-sub mono">Link obligations by dependency, conflict, or enablement. Every relation needs a source citation.</p>
    </div>

    <p v-if="!nodes.length" class="map-empty mono">No obligations yet. Build the register in Step 2 first.</p>

    <template v-else>
      <!-- dependency-free SVG graph -->
      <svg class="map-svg" :viewBox="`0 0 ${W} ${H}`" role="img" aria-label="Obligation dependency map">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted)" />
          </marker>
        </defs>
        <line v-for="(e, i) in edgeLines" :key="i"
              :x1="e.x1" :y1="e.y1" :x2="e.x2" :y2="e.y2"
              :class="'map-edge map-edge--' + e.type" marker-end="url(#arrow)" />
        <g v-for="(n, i) in nodePos" :key="n.id">
          <circle :cx="n.x" :cy="n.y" r="7" class="map-node" />
          <text :x="n.x + 14" :y="n.y + 4" class="map-node-label">{{ n.short }}</text>
        </g>
      </svg>

      <!-- relation editor -->
      <div class="map-editor">
        <span class="eyebrow">add relation</span>
        <div class="map-form">
          <select v-model="draft.source_obligation_id" class="map-sel">
            <option value="">source…</option>
            <option v-for="n in nodes" :key="n.id" :value="n.id">{{ n.id }} · {{ n.agent }}</option>
          </select>
          <select v-model="draft.relation_type" class="map-sel">
            <option v-for="t in RELATION_TYPES" :key="t" :value="t">{{ t }}</option>
          </select>
          <select v-model="draft.target_obligation_id" class="map-sel">
            <option value="">target…</option>
            <option v-for="n in nodes" :key="n.id" :value="n.id">{{ n.id }} · {{ n.agent }}</option>
          </select>
          <select v-model="draft.source_chunk_id" class="map-sel">
            <option value="">cite chunk…</option>
            <option v-for="c in chunkIds" :key="c" :value="c">{{ c }}</option>
          </select>
          <button class="map-add" :disabled="!canAdd" @click="addRelation">add</button>
        </div>
        <p v-if="lastError" class="map-error mono">{{ lastError }}</p>
      </div>

      <!-- relations list -->
      <div v-if="relations.length" class="map-rels">
        <div v-for="(r, i) in relations" :key="i" class="map-rel">
          <span class="map-rel-type" :class="'map-rel-type--' + r.relation_type">{{ r.relation_type }}</span>
          <span class="map-rel-edge mono">{{ r.source_obligation_id }} → {{ r.target_obligation_id }}</span>
          <span class="map-rel-cite mono">cite: {{ r.source_chunk_id }}</span>
          <button class="map-rel-del" @click="relations.splice(i, 1)">✕</button>
        </div>
      </div>

      <div class="map-actions">
        <span class="map-gate mono" :class="{ 'map-gate--ok': passed }">
          {{ passed ? '✓ all relations cited' : 'add at least one cited relation to advance' }}
        </span>
        <NuxtLink to="/memo" class="map-advance" :class="{ 'map-advance--off': !passed }">Advance to Memo →</NuxtLink>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { useArtifact } from '@legalblocks/module-runtime'

const RELATION_TYPES = ['depends_on', 'conflicts_with', 'enables']

// Artifact I/O via the bus: read the obligation_set the classifier persisted and
// write the obligation_map for Step 4. Adapter resolved from config, not hardcoded.
const obligationSet = useArtifact('obligation-set')
const obligationMap = useArtifact('obligation-map')

let nodeSeed = []
try {
  const env = await obligationSet.read()
  nodeSeed = env?.payload?.obligations ?? env?.obligations ?? []
} catch {}
const nodes = ref(nodeSeed.map((o, i) => ({ ...o, id: `obl-${i}`, short: `obl-${i}` })))

const chunkIds = computed(() => [...new Set(nodes.value.map(n => n.source_chunk_id))])
const knownIds = computed(() => new Set(nodes.value.map(n => n.id)))

const relations = ref([])
const draft = ref({ source_obligation_id: '', target_obligation_id: '', relation_type: 'depends_on', source_chunk_id: '' })
const lastError = ref('')

const canAdd = computed(() =>
  draft.value.source_obligation_id && draft.value.target_obligation_id && draft.value.source_chunk_id)

function addRelation() {
  const d = draft.value
  // same guardrail the backend enforces (relations.ts): cited, distinct, real endpoints
  if (d.source_obligation_id === d.target_obligation_id) { lastError.value = 'an obligation cannot relate to itself'; return }
  if (!knownIds.value.has(d.source_obligation_id) || !knownIds.value.has(d.target_obligation_id)) { lastError.value = 'unknown obligation'; return }
  if (!chunkIds.value.includes(d.source_chunk_id)) { lastError.value = 'citation must be a real source chunk'; return }
  relations.value.push({ ...d })
  draft.value = { source_obligation_id: '', target_obligation_id: '', relation_type: 'depends_on', source_chunk_id: '' }
  lastError.value = ''
  persist()
}

const passed = computed(() => relations.value.length > 0)

function persist() {
  obligationMap.write({
    artifact_type: 'obligation-map',
    schema_version: '0.1.0',
    payload: { nodes: nodes.value, relations: relations.value },
    lineage: { produced_by_package: 'obligation-map', produced_by_module: 'obligationMap' },
  }).catch(() => {})
}

// ── layout: nodes evenly down a column, edges as arcs ────────────────────────
const W = 640
const H = computed(() => Math.max(160, nodes.value.length * 54 + 40))
const nodePos = computed(() => nodes.value.map((n, i) => ({ ...n, x: 40, y: 30 + i * 54 })))
const posById = computed(() => Object.fromEntries(nodePos.value.map(n => [n.id, n])))
const edgeLines = computed(() => relations.value.map(r => {
  const a = posById.value[r.source_obligation_id]; const b = posById.value[r.target_obligation_id]
  if (!a || !b) return null
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, type: r.relation_type }
}).filter(Boolean))
</script>

<style scoped>
.page-map { max-width: 900px; margin: 0 auto; padding: 36px 24px; }
.page-header { margin-bottom: 20px; }
.page-title { font-size: 28px; font-weight: 400; margin: 6px 0 0; color: var(--ink); }
.page-sub { font-size: 11px; color: var(--muted); margin: 8px 0 0; }
.map-empty { font-size: 12px; color: var(--muted); }

.map-svg { width: 100%; background: var(--white); border: 1px solid var(--line); border-radius: var(--radius); margin-bottom: 18px; }
.map-node { fill: var(--vermillion); }
.map-node-label { font-family: monospace; font-size: 11px; fill: var(--ink-2); }
.map-edge { stroke: var(--muted); stroke-width: 1.5; }
.map-edge--conflicts_with { stroke: #B6371A; stroke-dasharray: 4 3; }
.map-edge--enables { stroke: #5F7A3A; }
.map-edge--depends_on { stroke: #2E6E8E; }

.map-editor { margin-bottom: 16px; }
.map-form { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.map-sel { font-size: 12px; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--white); color: var(--ink); }
.map-add { font-size: 12px; font-weight: 600; padding: 7px 16px; border: none; border-radius: 6px; background: var(--vermillion); color: #fff; cursor: pointer; }
.map-add:disabled { opacity: 0.4; cursor: not-allowed; }
.map-error { color: #B6371A; font-size: 11px; margin: 8px 0 0; }

.map-rels { display: flex; flex-direction: column; gap: 6px; margin-bottom: 20px; }
.map-rel { display: grid; grid-template-columns: 130px 1fr auto 28px; gap: 12px; align-items: center; padding: 9px 14px; background: var(--white); border: 1px solid var(--line); border-radius: 8px; font-size: 12px; }
.map-rel-type { font-family: monospace; font-size: 10px; font-weight: 600; text-transform: uppercase; padding: 2px 7px; border-radius: 4px; text-align: center; }
.map-rel-type--depends_on { background: #E8F0F4; color: #2E6E8E; }
.map-rel-type--conflicts_with { background: #FDE8E0; color: #B6371A; }
.map-rel-type--enables { background: #E7EFE2; color: #5F7A3A; }
.map-rel-cite { font-size: 10px; color: var(--muted); }
.map-rel-del { border: none; background: none; color: var(--muted); cursor: pointer; font-size: 13px; }

.map-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; }
.map-gate { font-size: 11px; color: var(--muted); }
.map-gate--ok { color: #5F7A3A; }
.map-advance { background: var(--vermillion); color: #fff; text-decoration: none; font-weight: 600; font-size: 13px; padding: 9px 18px; border-radius: 8px; }
.map-advance--off { pointer-events: none; opacity: 0.4; }
</style>
