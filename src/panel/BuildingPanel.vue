<script setup lang="ts">
// The building panel of a logged-in user: everything the current map app shows for a building. A main view with the
// key facts and the ways on, and one view per subject (Pand, Locatie, Fundering, Funderingsrisico, Onderzoek, Herstel,
// Incidenten); the subject is in the address (/map/<mapset>/building/<pand>/<panel>).
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { UiState } from '@/map/controller';
import { parseRoute, writeRoute } from '@/map/route';
import { addressLabel, documentLink, loadPanel, pdfReport, save, type PanelData } from './data';
import { NO_DATA, RECOVERY_SAMPLE_FIELDS, SAMPLE_GROUPS, enumLabel, raw, rows, show, type Row } from './fields';
import StatisticsDialog from './StatisticsDialog.vue';

const props = defineProps<{ pand: string; info: NonNullable<UiState['info']> }>();
const emit = defineEmits<{ close: [] }>();

const VIEWS = ['building', 'location', 'foundation', 'foundation-risk', 'inquiry', 'recovery', 'incidents'] as const;
type View = 'main' | (typeof VIEWS)[number];
const asView = (p: string | null): View => ((VIEWS as readonly string[]).includes(p ?? '') ? (p as View) : 'main');
const view = ref<View>(asView(parseRoute().panel));
const data = ref<PanelData>();
const page = reactive({ inquiry: 0, recovery: 0, incidents: 0 });
const statistics = ref(false);
const sample = ref<null | { kind: 'inquirySample' | 'recoverySample'; row: Row; title: string }>(null);
const sampleDialog = ref<HTMLDialogElement>();
const note = ref<string | null>(null);
const busy = reactive({ pdf: false, document: false });
const failure = ref<string | null>(null);
const addresses = reactive<Record<string, string>>({});
let abort: AbortController | null = null;

watch(() => props.pand, (pand, old) => {
  abort?.abort();
  abort = new AbortController();
  data.value = loadPanel(pand, abort.signal);
  page.inquiry = page.recovery = page.incidents = 0;
  failure.value = null;
  // another building opens on its main view; the first one on what the address asked for
  if (old !== undefined) view.value = 'main';
}, { immediate: true });
onBeforeUnmount(() => abort?.abort());

// keyboard: the panel takes the focus when it opens (a screen reader then reads the address), each view moves it to
// its heading, and Escape goes back a view or closes the panel (not while a dialog is open: that closes itself)
const root = ref<HTMLElement>();
const heading = ref<HTMLElement>();
onMounted(() => heading.value?.focus({ preventScroll: true }));
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('dialog[open]') || note.value) return;
  if (view.value !== 'main') go('main'); else emit('close');
}
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));

function go(v: View) {
  view.value = v;
  failure.value = null;
  writeRoute({ ...parseRoute(), panel: v === 'main' ? null : v }, false);
  void nextTick(() => (root.value?.querySelector<HTMLElement>('.body h3, .body .way') ?? heading.value)?.focus({ preventScroll: true }));
}
// a report view with nothing to show (an old link) falls back to the main view once the reports are in
watch(() => [data.value?.reportsReady, view.value], () => {
  const d = data.value;
  if (!d?.reportsReady) return;
  if ((view.value === 'inquiry' && !d.inquiries.length) || (view.value === 'recovery' && !d.recoveries.length) || (view.value === 'incidents' && !d.incidents.length)) go('main');
});

const place = computed(() => data.value?.place ?? null);
const a = computed(() => data.value?.analysis ?? null);
const title = computed(() => (place.value?.street ? `${place.value.street} ${place.value.building_number ?? ''}`.trim() : props.info.title));
const postal = computed(() => {
  const p = place.value;
  if (!p?.postal_code) return props.info.sub;
  return `${p.postal_code.slice(0, 4)} ${p.postal_code.slice(4)} ${p.city ?? ''}`.trim();
});
watch(title, (t) => { document.title = `${t} — FunderMaps`; }, { immediate: true });
onBeforeUnmount(() => { document.title = 'Funderingskaart'; });

const named = (name?: string | null, code?: string | null) => (name ? `${name}${code ? ` (${code})` : ''}` : NO_DATA);
const locationRows = computed(() => {
  const p = place.value;
  const full = p?.street ? `${p.street} ${p.building_number ?? ''}, ${postal.value}`.trim() : NO_DATA;
  return [
    ['Adres', full], ['Buurt', named(p?.neighborhood_name, p?.neighborhood_external_id)], ['Wijk', named(p?.district_name, p?.district_external_id)],
    ['Gemeente', named(p?.municipality_name, p?.municipality_external_id)], ['Provincie', named(p?.state_name, p?.state_external_id)],
  ] as [string, string][];
});
const summary = computed(() => rows('analysis', a.value, ['foundationType', 'foundationTypeReliability', 'velocity', 'recoveryType', 'constructionYear', 'surfaceArea'], { foundationType: 'Type fundering', constructionYear: 'Bouwjaar' }).filter((r) => !r.empty));
const buildingRows = computed(() => [
  { field: 'externalId', label: 'BAG Pand ID', value: props.pand, empty: false },
  ...rows('analysis', a.value, ['constructionYear', 'surfaceArea', 'height', 'groundWaterLevel', 'groundLevel', 'soil']),
]);
const foundationRows = computed(() => rows('analysis', a.value, ['foundationTypeReliability', 'restorationCosts', 'velocity', 'recoveryType']));
const RISKS = [
  { title: 'Droogstand', risk: 'drystandRisk', more: ['drystand', 'drystandReliability'] },
  { title: 'Ontwateringsdiepte', risk: 'dewateringDepthRisk', more: ['dewateringDepth', 'dewateringDepthReliability'] },
  { title: 'Bacteriële aantasting', risk: 'bioInfectionRisk', more: ['bioInfectionReliability'] },
  { title: 'Op basis van onderzoek', risk: 'unclassifiedRisk', more: [] },
];
const riskGroups = computed(() => RISKS.map((g) => {
  const letter = raw(a.value, g.risk);
  return { title: g.title, letter: typeof letter === 'string' ? letter : null, risk: rows('analysis', a.value, [g.risk])[0], more: rows('analysis', a.value, g.more) };
}));

// ---- onderzoek / herstel / incidenten ----
const inquiry = computed(() => data.value?.inquiries[page.inquiry] ?? null);
const recovery = computed(() => data.value?.recoveries[page.recovery] ?? null);
const incident = computed(() => data.value?.incidents[page.incidents] ?? null);
const inquiryRows = computed(() => rows('inquiry', inquiry.value, ['documentName', 'id', 'type', 'documentDate', 'contractorName', 'ownerName', 'dataOwnerName', 'auditStatus', 'standardF3o', 'inspection', 'jointMeasurement', 'floorMeasurement'], { dataOwnerName: 'Data-eigenaar' }));
const recoveryRows = computed(() => rows('recovery', recovery.value, ['documentName', 'id', 'type', 'contractorName', 'ownerName', 'auditStatus']));
const samplesOf = (list: Row[] | undefined, key: string, id: unknown) => (list ?? []).filter((s) => s[key] === id);
const inquirySamples = computed(() => samplesOf(data.value?.inquirySamples, 'inquiry_id', inquiry.value?.id));
const recoverySamples = computed(() => samplesOf(data.value?.recoverySamples, 'recovery_id', recovery.value?.id));
const addressOf = (s: Row) => String(s.address_id ?? s.address ?? '');
// the address of each sample, for the buttons of a rapportage with several
watch(inquirySamples, (list) => {
  if (list.length < 2) return;
  for (const s of list) {
    const id = addressOf(s);
    if (id && !(id in addresses)) { addresses[id] = ''; void addressLabel(id).then((l) => { if (l) addresses[id] = l; }); }
  }
}, { immediate: true });
const sampleButtons = computed(() => inquirySamples.value
  .map((s, i) => ({ s, label: addresses[addressOf(s)] || `Meting ${i + 1}` }))
  .sort((x, y) => x.label.localeCompare(y.label, 'nl', { numeric: true })));
const incidentRows = computed(() => {
  const i = incident.value;
  if (!i) return [];
  if (i.kind === 'melding') return rows('incident', i, ['topic']);
  const hidden = { name: 'Afgeschermd', phoneNumber: 'Afgeschermd', email: 'Afgeschermd' } as Record<string, string>;
  return [
    ...rows('incident', i, ['id']),
    { field: 'building', label: 'BAG Pand ID', value: props.pand, empty: false },
    { field: 'clientName', label: 'Meldingsloket', value: 'FunderMaps', empty: false },
    ...rows('incident', i, ['createDate', 'foundationType', 'chainedBuilding', 'owner', 'foundationRecovery', 'neighborRecovery', 'foundationDamageCause', 'note']),
    ...rows('incident', i, ['name', 'phoneNumber', 'email']).map((r) => (r.empty ? { ...r, value: hidden[r.field], empty: false } : r)),
    ...rows('incident', i, ['foundationDamageCharacteristics', 'environmentDamageCharacteristics', 'auditStatus', 'internalNote']),
    { ...rows('incident', i, ['incidentQuestionType'])[0], label: 'Vraagtype' },
  ];
});

function openSample(kind: 'inquirySample' | 'recoverySample', row: Row, label = '') {
  sample.value = { kind, row, title: kind === 'inquirySample' ? `Onderzoeksinformatie${label ? `: ${label}` : ''}` : `Herstelinformatie${label ? `: ${label}` : ''}` };
  requestAnimationFrame(() => sampleDialog.value?.showModal());
}
const sampleGroups = computed(() => {
  const s = sample.value;
  if (!s) return [];
  if (s.kind === 'recoverySample') {
    // the sample row holds numbers for its recovery and its contractor: the recovery's number as it is, the
    // contractor by the name on the recovery
    const parent = data.value?.recoveries.find((r) => r.id === (s.row.recovery_id ?? s.row.recovery));
    const contractor = parent?.attribution_contractor_name ? String(parent.attribution_contractor_name) : null;
    return [{ title: '', rows: rows('recoverySample', s.row, RECOVERY_SAMPLE_FIELDS, { recovery: 'Herstelnummer' }).map((r) =>
      r.field === 'recovery' ? { ...r, value: String(s.row.recovery_id ?? s.row.recovery ?? NO_DATA), empty: false }
      : r.field === 'contractor' ? { ...r, value: contractor ?? NO_DATA, empty: !contractor } : r) }];
  }
  return SAMPLE_GROUPS.map((g) => ({ title: g.title, rows: rows('inquirySample', s.row, g.fields) })).filter((g) => g.rows.some((r) => !r.empty));
});

async function download(kind: 'inquiry' | 'recovery', row: Row) {
  if (busy.document) return;
  busy.document = true; failure.value = null;
  try {
    const link = await documentLink(kind, row.id);
    if (!link) throw new Error('no link');
    const ext = /\.[a-z0-9]{1,5}$/i.exec(String(row.document_file ?? ''))?.[0] ?? '';
    save(link, `${String(row.document_name ?? `document-${row.id}`)}${ext}`);
  } catch { failure.value = 'Het downloaden van het document is niet gelukt. Probeer het later opnieuw.'; }
  finally { busy.document = false; }
}
async function pdf() {
  if (busy.pdf) return;
  busy.pdf = true; failure.value = null;
  try { save(await pdfReport(props.pand), `NL.IMBAG.PAND.${props.pand}.pdf`); }
  catch { failure.value = 'Het maken van de PDF is niet gelukt. Probeer het later opnieuw.'; }
  finally { busy.pdf = false; }
}
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
</script>

<template>
  <aside ref="root" class="bp glass" aria-label="Pandinformatie">
    <header>
      <div>
        <p class="eyebrow">{{ info.eyebrow }}</p>
        <h2 ref="heading" tabindex="-1">{{ title }}</h2>
        <p class="sub">{{ postal }}</p>
        <p class="pand" title="BAG Pand ID">{{ pand }}</p>
      </div>
      <button class="icon" aria-label="Sluiten" @click="$emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>

    <div v-if="!data?.ready" class="body" aria-busy="true"><div class="skeleton"></div><div class="skeleton short"></div><div class="skeleton"></div></div>
    <div v-else-if="data.failed" class="body">
      <h3>Geen data beschikbaar</h3>
      <p class="muted">De informatie over dit pand kon niet geladen worden. Selecteer een ander pand op de kaart.</p>
    </div>

    <div v-else class="body">
      <button v-if="view !== 'main'" class="back" @click="go('main')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6" /></svg>Terug naar pandinformatie
      </button>
      <p v-if="failure" class="alert" role="alert">{{ failure }}</p>

      <!-- main -->
      <template v-if="view === 'main'">
        <div class="hero"><span class="sw" :style="{ background: info.swatch }"></span><div><small>{{ info.valueTitle }}</small><strong>{{ info.valueLabel }}</strong></div></div>
        <dl v-if="summary.length"><template v-for="r in summary" :key="r.field"><dt>{{ r.label }}</dt><dd>{{ r.value }}</dd></template></dl>
        <nav aria-label="Over het pand">
          <p class="section">Over het pand</p>
          <button class="way" @click="go('building')">Pand</button>
          <button class="way" @click="go('location')">Locatie</button>
          <button class="way" @click="go('foundation')">Fundering</button>
          <button class="way" @click="go('foundation-risk')">Funderingsrisico</button>
          <p class="section">In de buurt</p>
          <button class="way" :disabled="!data.statistics" @click="statistics = true">Bekijk statistieken<small v-if="data.statistics === null">niet beschikbaar</small></button>
          <p class="section">Rapportages</p>
          <button class="way" :disabled="!data.inquiries.length" @click="go('inquiry')">Bekijk onderzoeksinformatie<small>{{ data.reportsReady ? (data.inquiries.length ? count(data.inquiries.length, 'onderzoek', 'onderzoeken') : 'geen') : 'laden…' }}</small></button>
          <button class="way" :disabled="!data.recoveries.length" @click="go('recovery')">Bekijk herstelinformatie<small>{{ data.reportsReady ? (data.recoveries.length ? count(data.recoveries.length, 'herstel', 'herstellen') : 'geen') : 'laden…' }}</small></button>
          <button class="way" :disabled="!data.incidents.length" @click="go('incidents')">Bekijk incidenten<small>{{ data.reportsReady ? (data.incidents.length ? count(data.incidents.length, 'melding', 'meldingen') : 'geen') : 'laden…' }}</small></button>
        </nav>
      </template>

      <template v-else-if="view === 'building'">
        <h3 tabindex="-1">Pandinformatie</h3>
        <dl class="wide"><template v-for="r in buildingRows" :key="r.field"><dt>{{ r.label }}</dt><dd :class="{ none: r.empty }">{{ r.value }}</dd></template></dl>
      </template>

      <template v-else-if="view === 'location'">
        <h3 tabindex="-1">Locatie-informatie</h3>
        <dl class="wide"><template v-for="[k, v] in locationRows" :key="k"><dt>{{ k }}</dt><dd :class="{ none: v === NO_DATA }">{{ v }}</dd></template></dl>
        <a class="out" :href="`https://bagviewer.kadaster.nl/lvbag/bag-viewer/?objectId=${pand}`" target="_blank" rel="noopener">BAG Viewer</a>
      </template>

      <template v-else-if="view === 'foundation'">
        <h3 tabindex="-1">Fundering</h3>
        <div class="hero plain"><div><small>Type fundering</small><strong>{{ show('analysis', 'foundationType', raw(a, 'foundationType')) }}</strong></div></div>
        <dl class="wide"><template v-for="r in foundationRows" :key="r.field"><dt>{{ r.label }}</dt><dd :class="{ none: r.empty }">{{ r.value }}</dd></template></dl>
      </template>

      <template v-else-if="view === 'foundation-risk'">
        <h3 tabindex="-1">Funderingsrisico</h3>
        <section v-for="g in riskGroups" :key="g.title" class="risk">
          <p class="section">{{ g.title }}</p>
          <div class="letter-row"><span class="letter" :class="g.letter ? `r-${g.letter}` : 'r-none'">{{ g.letter ? g.letter.toUpperCase() : '–' }}</span><div><small>{{ g.risk.label }}</small><strong :class="{ none: g.risk.empty }">{{ g.risk.value }}</strong></div></div>
          <dl v-if="g.more.length" class="wide"><template v-for="r in g.more" :key="r.field"><dt>{{ r.label }}</dt><dd :class="{ none: r.empty }">{{ r.value }}</dd></template></dl>
        </section>
      </template>

      <template v-else-if="view === 'inquiry' && inquiry">
        <h3 tabindex="-1">Onderzoeksinformatie</h3>
        <div v-if="data.inquiries.length > 1" class="pager">
          <button class="icon" aria-label="Vorige" :disabled="page.inquiry === 0" @click="page.inquiry--">‹</button><span>{{ page.inquiry + 1 }} van {{ data.inquiries.length }}</span>
          <button class="icon" aria-label="Volgende" :disabled="page.inquiry >= data.inquiries.length - 1" @click="page.inquiry++">›</button>
        </div>
        <h4>{{ inquiry.document_name }}</h4>
        <dl class="wide"><template v-for="r in inquiryRows" :key="r.field"><dt>{{ r.label }}</dt><dd :class="{ none: r.empty }">{{ r.value }}</dd></template></dl>
        <template v-if="inquiry.note"><p class="section">Opmerking</p><p class="note">{{ inquiry.note }}</p><button class="text" @click="note = String(inquiry.note)">Lees de hele opmerking</button></template>
        <template v-if="inquiry.document_file"><p class="section">Onderzoeksbestand</p><button class="primary" :disabled="busy.document" @click="download('inquiry', inquiry)">{{ busy.document ? 'Bezig…' : 'Download document' }}</button></template>
        <template v-if="inquirySamples.length === 1"><button class="way" @click="openSample('inquirySample', inquirySamples[0])">Bekijk onderzoeksinformatie</button></template>
        <template v-else-if="inquirySamples.length > 1">
          <p class="section">Onderzoeksinformatie per adres</p>
          <button v-for="b in sampleButtons" :key="String(b.s.id)" class="way" @click="openSample('inquirySample', b.s, b.label)">{{ b.label }}</button>
        </template>
      </template>

      <template v-else-if="view === 'recovery' && recovery">
        <h3 tabindex="-1">Herstelinformatie</h3>
        <div v-if="data.recoveries.length > 1" class="pager">
          <button class="icon" aria-label="Vorige" :disabled="page.recovery === 0" @click="page.recovery--">‹</button><span>{{ page.recovery + 1 }} van {{ data.recoveries.length }}</span>
          <button class="icon" aria-label="Volgende" :disabled="page.recovery >= data.recoveries.length - 1" @click="page.recovery++">›</button>
        </div>
        <h4>{{ recovery.document_name }}</h4>
        <dl class="wide"><template v-for="r in recoveryRows" :key="r.field"><dt>{{ r.label }}</dt><dd :class="{ none: r.empty }">{{ r.value }}</dd></template></dl>
        <template v-if="recovery.note"><p class="section">Opmerking</p><p class="note">{{ recovery.note }}</p><button class="text" @click="note = String(recovery.note)">Lees de hele opmerking</button></template>
        <template v-if="recovery.document_file"><p class="section">Herstelbestand</p><button class="primary" :disabled="busy.document" @click="download('recovery', recovery)">{{ busy.document ? 'Bezig…' : 'Download document' }}</button></template>
        <template v-if="recoverySamples.length === 1"><button class="way" @click="openSample('recoverySample', recoverySamples[0])">Bekijk herstelinformatie</button></template>
        <template v-else-if="recoverySamples.length > 1">
          <p class="section">Herstelinformatie per onderdeel</p>
          <button v-for="(s, i) in recoverySamples" :key="String(s.id)" class="way" @click="openSample('recoverySample', s, `Herstel ${i + 1}`)">Herstel {{ i + 1 }}: {{ s.type ? enumLabel('RecoveryType', s.type) : 'onbekend' }}</button>
        </template>
      </template>

      <template v-else-if="view === 'incidents' && incident">
        <h3 tabindex="-1">Incidentrapportage</h3>
        <div v-if="data.incidents.length > 1" class="pager">
          <button class="icon" aria-label="Vorige" :disabled="page.incidents === 0" @click="page.incidents--">‹</button><span>{{ page.incidents + 1 }} van {{ data.incidents.length }}</span>
          <button class="icon" aria-label="Volgende" :disabled="page.incidents >= data.incidents.length - 1" @click="page.incidents++">›</button>
        </div>
        <h4>{{ incident.kind === 'melding' ? 'Melding' : incident.id }}</h4>
        <p v-if="incident.kind === 'melding'" class="section">Meldingsinformatie</p>
        <dl class="wide"><template v-for="r in incidentRows" :key="r.field"><dt>{{ r.label }}</dt><dd :class="{ none: r.empty }">{{ r.value }}</dd></template></dl>
      </template>
    </div>

    <footer v-if="data?.ready && !data.failed">
      <button class="secondary" :disabled="busy.pdf" @click="pdf">{{ busy.pdf ? 'PDF wordt aangemaakt...' : 'PDF downloaden' }}</button>
    </footer>

    <dialog ref="sampleDialog" class="glass sheet" @close="sample = null">
      <template v-if="sample">
        <header><h3>{{ sample.title }}</h3><button class="icon" aria-label="Sluiten" @click="sampleDialog?.close()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg></button></header>
        <section v-for="g in sampleGroups" :key="g.title">
          <p v-if="g.title" class="section">{{ g.title }}</p>
          <dl class="wide"><template v-for="r in g.rows" :key="r.field"><dt>{{ r.label }}</dt><dd :class="{ none: r.empty }">{{ r.value }}</dd></template></dl>
        </section>
      </template>
    </dialog>
    <div v-if="note" class="backdrop" @click.self="note = null">
      <section class="glass notebox" role="dialog" aria-modal="true" aria-label="Opmerking"><p>{{ note }}</p><button class="secondary" @click="note = null">Sluiten</button></section>
    </div>
    <StatisticsDialog v-if="statistics && data?.statistics" :statistics="data.statistics" :subsidence="data.subsidence" @close="statistics = false" />
  </aside>
</template>

<style scoped>
.bp { position: absolute; z-index: 3; top: 14px; right: 60px; width: 372px; max-height: calc(100% - 70px); display: flex; flex-direction: column; overflow: hidden; animation: rise .25s ease-out; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.bp > header { display: flex; align-items: start; gap: 8px; padding: 16px 16px 12px; border-bottom: 1px solid var(--line); }
.bp > header > div { flex: 1; min-width: 0; }
.eyebrow { margin: 0 0 2px; font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); min-height: 1em; }
h2 { margin: 0; font-size: 19px; font-weight: 650; letter-spacing: -0.015em; line-height: 1.25; }
.sub { margin: 2px 0 0; color: var(--muted); font-size: 12.5px; }
.pand { margin: 4px 0 0; font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink-2); }
.body { overflow: auto; padding: 14px 16px 16px; display: grid; gap: 10px; scrollbar-width: thin; }
h3 { margin: 0; font-size: 15px; font-weight: 650; }
h2:focus, h3:focus { outline: none; }
h4 { margin: 0; font-size: 14px; font-weight: 620; overflow-wrap: anywhere; }
p { margin: 0; }
.muted { color: var(--ink-2); font-size: 13.5px; }
.section { font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-top: 6px; }
.hero { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 12px; background: var(--raise); }
.hero .sw { width: 34px; height: 34px; border-radius: 10px; flex: none; }
.hero small, .letter-row small { display: block; color: var(--muted); font-size: 11.5px; }
.hero strong, .letter-row strong { font-size: 14.5px; font-weight: 620; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 13px; }
dl.wide { grid-template-columns: minmax(0, 11fr) minmax(0, 9fr); }
dt { color: var(--muted); }
dd { margin: 0; color: var(--ink); overflow-wrap: anywhere; }
.none { color: var(--muted); font-weight: 400; }
nav { display: grid; gap: 4px; }
.way { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; text-align: left; border: 1px solid var(--line); background: transparent; border-radius: 10px; padding: 9px 12px; font-size: 13.5px; cursor: pointer; color: var(--ink); }
.way::after { content: "›" / ""; color: var(--muted); font-size: 16px; line-height: 1; }
.way small { margin-left: auto; color: var(--muted); font-size: 12px; }
.way:hover:enabled { background: var(--raise); }
.way:disabled { cursor: default; color: var(--muted); }
.way:disabled::after { content: ""; }
.back { display: flex; align-items: center; gap: 4px; border: 0; background: none; padding: 0; font-size: 13px; font-weight: 600; color: var(--accent); cursor: pointer; justify-self: start; }
.back svg { width: 16px; height: 16px; }
.risk { display: grid; gap: 8px; padding-bottom: 8px; }
.risk + .risk { border-top: 1px solid var(--line); padding-top: 4px; }
.letter-row { display: flex; align-items: center; gap: 12px; }
.letter { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; font-weight: 700; color: #1b1f24; flex: none; }
.r-a { background: #42BA6D; } .r-b { background: #A5D66B; } .r-c { background: #F5D451; } .r-d { background: #F39A3B; } .r-e { background: #E5484D; color: #fff; }
.r-none { background: var(--raise); color: var(--muted); }
.pager { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--ink-2); }
.pager .icon { font-size: 20px; }
.pager .icon:disabled { opacity: .35; cursor: default; }
.note { font-size: 13px; color: var(--ink-2); display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-line; }
.text { border: 0; background: none; padding: 0; font-size: 13px; font-weight: 600; color: var(--accent); cursor: pointer; justify-self: start; }
.primary, .secondary { border-radius: 10px; padding: 9px 14px; font-size: 13.5px; font-weight: 600; cursor: pointer; }
.primary { border: 0; background: var(--accent); color: var(--accent-ink); justify-self: start; }
.secondary { border: 1px solid var(--line); background: transparent; color: var(--ink); }
.primary:disabled, .secondary:disabled { opacity: .6; cursor: default; }
.out { font-size: 13.5px; font-weight: 600; color: var(--accent); text-decoration: none; justify-self: start; }
.out::after { content: " ↗" / ""; }
.alert { padding: 9px 12px; border-radius: 10px; border-left: 4px solid #D64545; background: rgba(214, 69, 69, .1); font-size: 13px; }
footer { padding: 10px 16px 14px; border-top: 1px solid var(--line); display: grid; }
.skeleton { height: 54px; border-radius: 12px; background: var(--raise); animation: pulse 1.2s ease-in-out infinite; }
.skeleton.short { height: 22px; width: 60%; }
@keyframes pulse { 50% { opacity: .5; } }
.sheet { width: min(560px, calc(100vw - 24px)); max-height: calc(100vh - 48px); padding: 18px 20px; color: var(--ink); background: var(--solid); }
.sheet::backdrop { background: rgba(10, 14, 20, .45); }
.sheet header { display: flex; align-items: start; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.sheet section { display: grid; gap: 8px; margin-bottom: 12px; }
.backdrop { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 16px; background: rgba(10, 14, 20, .45); }
.notebox { width: min(520px, 100%); max-height: 70vh; overflow: auto; padding: 18px 20px; display: grid; gap: 14px; background: var(--solid); }
.notebox p { font-size: 14px; line-height: 1.55; white-space: pre-line; }
.notebox .secondary { justify-self: end; }
@media (max-width: 640px) {
  .bp { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-height: 68%; z-index: 5; border-radius: var(--radius) var(--radius) 0 0; background: var(--solid); }
  .way { padding: 12px; }
  .back { padding: 6px 0; }
  dl.wide { grid-template-columns: 1fr; gap: 2px; }
  dl.wide dd { margin-bottom: 8px; }
}
</style>
