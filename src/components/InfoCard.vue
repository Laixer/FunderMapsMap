<script setup lang="ts">
// The card of the selected pand: address (our public geocoder), the active layer's value, key figures, every
// FunderMaps field we have for it and the 3D BAG facts. The full building panel of today's map comes in a later step.
import { ref } from 'vue';
import type { UiState } from '@/map/controller';

defineProps<{ info: NonNullable<UiState['info']> }>();
defineEmits<{ close: [] }>();
const copied = ref(false);
const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => { copied.value = true; setTimeout(() => (copied.value = false), 1500); }, () => undefined);
</script>

<template>
  <aside class="info glass" aria-live="polite">
    <header>
      <div>
        <p class="eyebrow">{{ info.eyebrow }}</p>
        <h2>{{ info.title }}</h2>
        <p class="sub">{{ info.sub }}</p>
      </div>
      <button class="icon" aria-label="Sluiten" @click="$emit('close')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>
    <div class="hero"><span class="sw" :style="{ background: info.swatch }"></span><div><small>{{ info.valueTitle }}</small><strong>{{ info.valueLabel }}</strong></div></div>
    <template v-if="info.hasData">
      <div class="stats">
        <div v-for="[k, v] in info.stats" :key="k" class="stat"><small>{{ k }}</small><b>{{ v }}</b></div>
      </div>
      <dl><template v-for="[k, v] in info.rows" :key="k"><dt>{{ k }}</dt><dd>{{ v }}</dd></template></dl>
    </template>
    <p v-else class="notice">Geen FunderMaps-gegevens voor dit pand.</p>
    <details :open="!info.hasData">
      <summary>3D BAG</summary>
      <dl><template v-for="[k, v] in info.bag" :key="k"><dt>{{ k }}</dt><dd>{{ v }}</dd></template></dl>
    </details>
    <div class="idline"><code>{{ info.id }}</code><button class="chip" @click="copy(info.id)">{{ copied ? 'Gekopieerd' : 'Kopiëren' }}</button></div>
  </aside>
</template>

<style scoped>
.info { position: absolute; z-index: 3; top: 14px; right: 60px; width: 340px; max-height: calc(100% - 70px); overflow: auto; padding: 16px; animation: rise .25s ease-out; }
@keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
header { display: flex; align-items: start; gap: 8px; }
header > div { flex: 1; min-width: 0; }
.eyebrow { margin: 0 0 2px; font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); min-height: 1em; }
h2 { margin: 0; font-size: 19px; font-weight: 650; letter-spacing: -0.015em; line-height: 1.25; }
.sub { margin: 2px 0 0; color: var(--muted); font-size: 12.5px; }
.hero { display: flex; align-items: center; gap: 12px; margin: 14px 0 12px; padding: 12px; border-radius: 12px; background: var(--raise); }
.hero .sw { width: 34px; height: 34px; border-radius: 10px; flex: none; }
.hero small { display: block; color: var(--muted); font-size: 11.5px; }
.hero strong { font-size: 14.5px; font-weight: 620; }
.stats { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }
.stat { padding: 9px 11px; border-radius: 12px; border: 1px solid var(--line); }
.stat small { display: block; color: var(--muted); font-size: 11.5px; }
.stat b { font-size: 15px; font-weight: 640; font-variant-numeric: tabular-nums; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 13px; }
dt { color: var(--muted); }
dd { margin: 0; color: var(--ink); }
details { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; }
summary { cursor: pointer; font-size: 12px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; }
.idline { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); }
.idline code { font: 12px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; }
.chip { border: 1px solid var(--line); background: transparent; border-radius: 99px; padding: 3px 10px; font-size: 12px; cursor: pointer; color: var(--ink-2); }
.chip:hover { background: var(--raise); }
.notice { margin: 12px 0 0; font-size: 13px; color: var(--ink-2); }
@media (max-width: 640px) { .info { left: 8px; right: 8px; top: auto; bottom: 8px; width: auto; max-height: 52%; z-index: 5; } }
</style>
