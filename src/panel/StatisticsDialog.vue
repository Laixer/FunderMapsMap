<script setup lang="ts">
// "Statistieken" of a building's neighbourhood, the six charts of the current map app: subsidence over time with its
// trend, foundation types, buildings per decade, foundation risk, and incidents and rapportages per year (of the
// neighbourhood, or of the municipality when the neighbourhood has none). Chart.js loads with this dialog.
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Chart, ChartConfiguration } from 'chart.js';
import type { Statistics, Subsidence } from './data';

const props = defineProps<{ statistics: Statistics; subsidence: Subsidence[] }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const charts: Chart[] = [];

const P = { blue: '#17a4ea', green: '#28cc8b', yellow: '#ffcc69', orange: '#ea5d17', red: '#ed1c24', grey: '#7f8fa4', navy: '#191e3c' };
const SOFT = { blue: '#d1edfb', green: '#afecd4' };
const WOOD = ['wood', 'wood_amsterdam', 'wood_rotterdam', 'wood_rotterdam_amsterdam', 'wood_amsterdam_arch', 'wood_rotterdam_arch'];
const TYPE_GROUPS: { name: string; color: string; types: string[] | null }[] = [
  { name: 'Betonnen of stalen palen', color: '#7f8fa4', types: ['concrete', 'weighted_pile', 'combined', 'steel_pile'] },
  { name: 'Houten paal met betonoplanger', color: '#b59e3c', types: ['wood_charger'] },
  { name: 'Houten palen', color: '#8c3a28', types: WOOD },
  { name: 'Ondiepe fundering', color: '#ce0015', types: ['no_pile', 'no_pile_masonry', 'no_pile_strips', 'no_pile_bearing_floor', 'no_pile_concrete_floor', 'no_pile_slit'] },
  { name: 'Overig', color: '#ffec33', types: null },
];
const RISK_LABELS: Record<string, string> = { a: 'A (Geen risico)', b: 'B (Laag risico)', c: 'C (Verhoogd risico)', d: 'D (Hoog risico)', e: 'E (Aanzienlijk hoog risico)' };
const RISK_COLORS: Record<string, string> = { a: P.green, b: SOFT.green, c: P.yellow, d: P.orange, e: P.red };

interface Section { id: string; title: string; height: number; config: ChartConfiguration }
const sections: Section[] = [];
const s = props.statistics;
const pct = (v: number) => `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1 }).format(v)}%`;

// 1. subsidence over time, with a straight trend line
const points = props.subsidence.map((p) => ({ x: Date.parse(p.mark_at), y: Number(p.velocity) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).sort((a, b) => a.x - b.x);
if (points.length) {
  const n = points.length, mx = points.reduce((t, p) => t + p.x, 0) / n, my = points.reduce((t, p) => t + p.y, 0) / n;
  const den = points.reduce((t, p) => t + (p.x - mx) ** 2, 0);
  const slope = den ? points.reduce((t, p) => t + (p.x - mx) * (p.y - my), 0) / den : 0;
  const trend = [points[0], points[n - 1]].map((p) => ({ x: p.x, y: my + slope * (p.x - mx) }));
  const month = (v: number) => new Date(v).toLocaleDateString('nl-NL', { month: 'short', year: 'numeric' });
  sections.push({
    id: 'subsidence', title: 'Pandzakking (mm)', height: 320,
    config: {
      type: 'scatter',
      data: { datasets: [
        { label: 'Meting', data: points, backgroundColor: P.navy, pointRadius: 2 },
        { label: 'Trend', data: trend, type: 'line', borderColor: P.blue, borderWidth: 2, pointRadius: 0 },
      ] },
      options: {
        scales: { x: { type: 'linear', ticks: { callback: (v) => month(Number(v)), maxTicksLimit: 6 } }, y: { title: { display: true, text: 'mm' } } },
        plugins: { tooltip: { callbacks: { label: (c) => `${new Date((c.raw as { x: number }).x).toLocaleDateString('nl-NL')}: ${(c.raw as { y: number }).y} mm` } } },
      },
    } as ChartConfiguration,
  });
}

// 2. foundation types in the neighbourhood, in the five families
const types = s.foundation_type_distribution ?? [];
if (types.length) {
  const named = new Set(TYPE_GROUPS.flatMap((g) => g.types ?? []));
  const groups = TYPE_GROUPS.map((g) => ({ ...g, value: types.filter((t) => (g.types ? g.types.includes(t.foundation_type) : !named.has(t.foundation_type))).reduce((t, x) => t + Number(x.percentage), 0) })).filter((g) => g.value > 0);
  sections.push({ id: 'types', title: 'Verhouding funderingstype in de buurt', height: 320, config: {
    type: 'pie', data: { labels: groups.map((g) => g.name), datasets: [{ data: groups.map((g) => g.value), backgroundColor: groups.map((g) => g.color) }] },
    options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.label}: ${pct(Number(c.raw))}` } } } },
  } });
}

// 3. buildings per decade
const decades = s.construction_year_distribution ?? [];
if (decades.length) sections.push({ id: 'decades', title: 'Aantal panden per bouwdecennium in de buurt', height: 320, config: {
  type: 'bar', data: { labels: decades.map((d) => `${d.year_from}-${d.year_from + 9}`), datasets: [{ label: 'Panden', data: decades.map((d) => d.count), backgroundColor: SOFT.blue, borderColor: P.blue, borderWidth: 1 }] },
  options: { scales: { y: { ticks: { precision: 0 } } }, plugins: { legend: { display: false } } },
} });

// 4. foundation risk
const risks = (s.foundation_risk_distribution ?? []).filter((r) => RISK_LABELS[r.foundation_risk]).sort((a, b) => a.foundation_risk.localeCompare(b.foundation_risk));
if (risks.some((r) => Number(r.percentage) > 0)) sections.push({ id: 'risk', title: 'Verhouding funderingsrisico in de buurt', height: 320, config: {
  type: 'pie', data: { labels: risks.map((r) => RISK_LABELS[r.foundation_risk]), datasets: [{ data: risks.map((r) => Number(r.percentage)), backgroundColor: risks.map((r) => RISK_COLORS[r.foundation_risk]) }] },
  options: { plugins: { tooltip: { callbacks: { label: (c) => `${c.label}: ${pct(Number(c.raw))}` } } } },
} });

// 5 and 6. per year: the neighbourhood's, else the municipality's
function perYear(id: string, what: string, own: { year: number; count: number }[] | undefined, municipality: { year: number; count: number }[] | undefined, color: string, soft: string) {
  const list = own?.length ? own : municipality ?? [];
  if (!list.length) return;
  const sorted = [...list].sort((a, b) => a.year - b.year);
  sections.push({ id, title: `Aantal ${what} per jaar in de ${own?.length ? 'buurt' : 'gemeente'}`, height: Math.max(320, sorted.length * 22), config: {
    type: 'bar', data: { labels: sorted.map((y) => String(y.year)), datasets: [{ label: what, data: sorted.map((y) => y.count), backgroundColor: soft, borderColor: color, borderWidth: 1 }] },
    options: { indexAxis: 'y', scales: { x: { ticks: { precision: 0 } } }, plugins: { legend: { display: false } } },
  } });
}
perYear('incidents', 'incidenten', s.total_incident_count, s.municipality_incident_count, P.orange, '#fbd6c2');
perYear('reports', 'onderzoeken', s.total_report_count, s.municipality_report_count, P.green, SOFT.green);

onMounted(async () => {
  dialog.value?.showModal();
  if (!sections.length) return;
  const { Chart, registerables } = await import('chart.js');
  Chart.register(...registerables);
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink-2').trim() || '#4A525E';
  Chart.defaults.color = ink;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.animation = false;
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.position = 'bottom';
  await nextTick();
  for (const sec of sections) {
    const canvas = dialog.value?.querySelector<HTMLCanvasElement>(`canvas[data-chart="${sec.id}"]`);
    if (canvas) charts.push(new Chart(canvas, sec.config));
  }
});
onBeforeUnmount(() => charts.forEach((c) => c.destroy()));
</script>

<template>
  <dialog ref="dialog" class="glass" aria-labelledby="stats-title" @close="emit('close')">
    <header><h2 id="stats-title">Statistieken</h2><button class="icon" aria-label="Sluiten" @click="dialog?.close()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button></header>
    <p v-if="!sections.length" class="muted">Er zijn geen statistieken beschikbaar voor dit pand.</p>
    <section v-for="sec in sections" :key="sec.id">
      <h3>{{ sec.title }}</h3>
      <div class="chart" :style="{ height: `${sec.height}px` }"><canvas :data-chart="sec.id" role="img" :aria-label="sec.title"></canvas></div>
    </section>
  </dialog>
</template>

<style scoped>
dialog { width: min(720px, calc(100vw - 24px)); max-height: calc(100vh - 48px); padding: 20px 22px; color: var(--ink); background: var(--solid); }
dialog::backdrop { background: rgba(10, 14, 20, .45); }
header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
h2 { margin: 0; font-size: 18px; font-weight: 650; }
h3 { margin: 18px 0 8px; font-size: 14px; font-weight: 620; }
.chart { position: relative; }
.muted { color: var(--ink-2); font-size: 13.5px; }
</style>
