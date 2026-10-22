<script setup lang="ts">
// Left panel: brand, address search, subject tabs, layer list, legend with counts, and the display switches.
import { ref } from 'vue';
import type { MapController, UiState } from '@/map/controller';
import SearchBox from './SearchBox.vue';

const props = defineProps<{ ui: UiState; ctl: MapController }>();
const collapsed = ref(matchMedia('(max-width: 640px)').matches);
const toggle = () => { collapsed.value = !collapsed.value; };
const onPalette = (e: Event) => props.ctl.setPalette((e.target as HTMLInputElement).checked ? '2026' : 'current');
</script>

<template>
  <aside class="panel glass" :class="{ collapsed }" aria-label="Kaartlagen en legenda">
    <header class="brand">
      <div class="mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 5l8 6.5" /><path d="M6.5 10v5.5h11V10" /><path d="M8.5 15.5V20M12 15.5V20M15.5 15.5V20" /></svg>
      </div>
      <div class="titles">
        <h1>Funderingskaart</h1>
        <p>{{ ui.mapset?.name ?? 'De funderingen van Nederland in 3D' }}</p>
      </div>
      <button class="icon" :aria-label="ui.mode === 'dark' ? 'Lichte weergave' : 'Donkere weergave'" @click="ctl.toggleMode()">
        <svg v-if="ui.mode === 'dark'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>
      </button>
      <button class="icon" aria-label="Paneel in- of uitklappen" :aria-expanded="!collapsed" @click="toggle">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
    </header>
    <SearchBox :ctl="ctl" />
    <div v-show="!collapsed" class="body">
      <p v-if="ui.notice" class="notice" role="status">{{ ui.notice }}</p>
      <details v-if="ui.mapset?.note" class="about">
        <summary>Over deze kaart</summary>
        <div class="md" v-html="ui.mapset.note"></div>
      </details>
      <div v-if="ui.groups.length > 1" class="tabs" role="tablist" aria-label="Onderwerp">
        <button v-for="g in ui.groups" :key="g" role="tab" :aria-selected="g === ui.group" @click="ctl.setGroup(g)">{{ g }}</button>
      </div>
      <div class="layers" role="radiogroup" aria-label="Kaartlaag">
        <button v-for="l in ui.layers" :key="l.id" class="layer" role="radio" :aria-checked="l.id === ui.themeId" @click="ctl.setTheme(l.id)">
          <span>{{ l.name }}</span><span class="ramp" :style="{ background: l.ramp }"></span>
        </button>
      </div>
      <section class="legend-card" aria-live="polite">
        <div class="legend-head"><strong>{{ ui.legend.title }}</strong><span class="muted">{{ ui.legend.total }}</span></div>
        <p v-if="ui.legend.message" class="muted">{{ ui.legend.message }}</p>
        <template v-for="(s, i) in ui.legend.sections" :key="i">
          <div v-if="s.title" class="section">{{ s.title }}</div>
          <div v-for="r in s.rows" :key="r.name" class="row" :class="{ empty: r.empty }">
            <span class="sw" :style="{ background: r.color }"></span><span>{{ r.name }}</span><span class="count">{{ r.count }}</span>
            <span class="bar"><i :style="{ width: r.width + '%', background: r.color }"></i></span>
          </div>
        </template>
        <p v-if="ui.legend.note" class="note">{{ ui.legend.note }}</p>
      </section>
      <section class="settings">
        <div class="switches">
          <label class="switch"><input type="checkbox" :checked="ui.shadows" @change="ctl.setShadows(($event.target as HTMLInputElement).checked)"><span class="knob"></span>Schaduwen</label>
          <label class="switch"><input type="checkbox" :checked="ui.context" @change="ctl.setContext(($event.target as HTMLInputElement).checked)"><span class="knob"></span>Omgeving</label>
          <label class="switch"><input type="checkbox" :checked="ui.clusters" @change="ctl.setClusters(($event.target as HTMLInputElement).checked)"><span class="knob"></span>Bouwkundige eenheid</label>
          <label class="switch"><input type="checkbox" :checked="ui.palette === '2026'" @change="onPalette"><span class="knob"></span>Kleuren 2026</label>
        </div>
        <p class="hint">Klik op een pand voor de gegevens · rechtermuisknop of Ctrl + slepen om te draaien.</p>
      </section>
    </div>
  </aside>
</template>

<style scoped>
.panel { position: absolute; z-index: 3; top: 14px; left: 14px; width: 348px; max-height: calc(100% - 64px); display: flex; flex-direction: column; overflow: hidden; }
.brand { display: flex; align-items: center; gap: 10px; padding: 14px 12px 10px 14px; }
.mark { width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center; background: var(--accent); color: var(--accent-ink); flex: none; }
.mark svg { width: 22px; height: 22px; }
.titles { flex: 1; min-width: 0; }
h1 { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -0.01em; }
.titles p { margin: 0; font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.body { overflow: auto; padding: 0 14px 14px; scrollbar-width: thin; }
.tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; padding: 3px; border-radius: 12px; background: var(--raise); margin: 2px 0 10px; }
.tabs button { border: 0; padding: 6px 4px; border-radius: 9px; background: transparent; color: var(--ink-2); font-size: 12.5px; font-weight: 550; cursor: pointer; transition: background .15s, color .15s, box-shadow .15s; }
.tabs button[aria-selected="true"] { background: var(--surface-strong); color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
.layers { display: grid; gap: 2px; margin-bottom: 12px; }
.layer { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 10px; width: 100%; text-align: left; border: 0; padding: 7px 10px; border-radius: 10px; background: transparent; cursor: pointer; transition: background .15s; }
.layer:hover { background: var(--raise); }
.layer[aria-checked="true"] { background: var(--accent-soft); color: var(--accent); font-weight: 600; }
.ramp { width: 64px; height: 8px; border-radius: 99px; box-shadow: inset 0 0 0 1px rgba(0,0,0,.08); }
.legend-card { border-top: 1px solid var(--line); padding-top: 12px; }
.legend-card > p.muted { margin: 4px 0; font-size: 13px; }
.legend-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; }
.legend-head strong { font-size: 13px; }
.legend-head span { font-size: 12px; text-align: right; }
.section { font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); margin: 10px 0 4px; min-height: 1px; }
.row { display: grid; grid-template-columns: 14px 1fr auto; column-gap: 9px; align-items: center; padding: 3px 0; font-variant-numeric: tabular-nums; }
.row .sw { width: 14px; height: 14px; border-radius: 5px; }
.row .count { color: var(--ink-2); font-size: 12.5px; }
.row .bar { grid-column: 2 / 4; height: 3px; border-radius: 99px; background: var(--raise); margin-top: 3px; overflow: hidden; }
.row .bar i { display: block; height: 100%; border-radius: 99px; }
.row.empty { opacity: .45; }
.note { font-size: 12px; color: var(--muted); margin: 8px 0 0; }
.settings { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 12px; display: grid; gap: 10px; }
.switches { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; }
.switch { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; color: var(--ink-2); user-select: none; }
.switch input { position: absolute; opacity: 0; pointer-events: none; }
.switch .knob { width: 30px; height: 18px; border-radius: 99px; background: var(--line); position: relative; flex: none; transition: background .2s; }
.switch .knob::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.3); transition: transform .2s; }
.switch input:checked + .knob { background: var(--accent); }
.switch input:checked + .knob::after { transform: translateX(12px); }
.switch input:focus-visible + .knob { outline: 2px solid var(--accent); outline-offset: 2px; }
.hint { font-size: 12px; color: var(--muted); margin: 0; }
.notice { margin: 2px 0 10px; padding: 8px 10px; border-radius: 10px; background: var(--raise); font-size: 12.5px; color: var(--ink-2); }
.about { margin: 0 0 10px; border-radius: 10px; background: var(--raise); padding: 7px 10px; font-size: 13px; }
.about summary { cursor: pointer; font-weight: 600; color: var(--ink-2); }
.about .md { margin-top: 6px; color: var(--ink-2); line-height: 1.5; max-height: 40vh; overflow: auto; }
.about .md :deep(p) { margin: 0 0 8px; }
@media (max-width: 640px) {
  .panel { left: 8px; right: 54px; top: 8px; width: auto; max-height: 58%; }
}
</style>
