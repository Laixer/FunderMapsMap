<script setup lang="ts">
// Left panel: brand, address search, subject tabs, layer list, legend with counts, and the display switches.
import { ref, watch } from 'vue';
import type { MapController, UiState } from '@/map/controller';
import SearchBox from './SearchBox.vue';
import UserMenu from './UserMenu.vue';
import AccountDialog from './AccountDialog.vue';

const props = defineProps<{ ui: UiState; ctl: MapController }>();
const collapsed = ref(matchMedia('(max-width: 640px)').matches);
const toggle = () => { collapsed.value = !collapsed.value; };
const dialog = ref<'profile' | 'password' | null>(null);
// on a phone the building's panel needs the room: the layer panel folds when a building opens
watch(() => !!props.ui.info, (open) => { if (open && matchMedia('(max-width: 640px)').matches) collapsed.value = true; });
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
      <UserMenu @profile="dialog = 'profile'" @password="dialog = 'password'" />
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
      <!-- the mapsets as tabs, always in sight: one click goes from one to the other and back, without a new page -->
      <div v-if="ui.mapsets.length > 1" class="picker">
        <span id="maps-label" class="cap">Kaart</span>
        <div class="maps" role="tablist" aria-labelledby="maps-label">
          <button v-for="m in ui.mapsets" :key="m.id" role="tab" :aria-selected="m.id === ui.mapset?.id" @click="ctl.openMapset(m.slug)">{{ m.name }}</button>
        </div>
      </div>
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
          <!-- a row of the layer is a switch: off, its buildings are no longer coloured, so the rows left on stand out -->
          <component :is="r.key === null ? 'div' : 'button'" v-for="r in s.rows" :key="r.name" class="row" :class="{ empty: r.empty, off: r.off }"
            v-bind="r.key === null ? {} : { type: 'button', 'aria-pressed': !r.off, title: r.off ? 'Weer tonen op de kaart' : 'Verbergen op de kaart' }"
            @click="r.key !== null && ctl.toggleRow(r.key)">
            <span class="sw" :style="{ background: r.color }"></span><span class="name">{{ r.name }}</span><span class="count">{{ r.count }}</span>
            <span class="bar"><i :style="{ width: r.width + '%', background: r.color }"></i></span>
          </component>
        </template>
        <button v-if="ui.legend.anyOff" type="button" class="all" @click="ctl.showAllRows()">Alles tonen</button>
        <p v-if="ui.legend.note" class="note">{{ ui.legend.note }}</p>
      </section>
      <section class="settings">
        <div class="switches">
          <label class="switch"><input type="checkbox" :checked="!ui.flat" @change="ctl.setView(!($event.target as HTMLInputElement).checked)"><span class="knob"></span>3D-panden</label>
          <label class="switch" :class="{ off: ui.flat }"><input type="checkbox" :checked="ui.trees" :disabled="ui.flat" @change="ctl.setTrees(($event.target as HTMLInputElement).checked)"><span class="knob"></span>Bomen</label>
          <label class="switch"><input type="checkbox" :checked="ui.clusters" @change="ctl.setClusters(($event.target as HTMLInputElement).checked)"><span class="knob"></span>Bouwkundige eenheid</label>
          <label v-if="ui.owner" class="switch owner"><input type="checkbox" :checked="ui.ownerOnly" @change="ctl.setOwnerOnly(($event.target as HTMLInputElement).checked)"><span class="knob"></span>Filter op eigendom</label>
        </div>
        <p class="hint">Klik op een pand voor de gegevens · rechtermuisknop of Ctrl + slepen om te draaien. Zonder 3D-panden is de kaart plat (2D) en lichter voor telefoon en oudere computers.</p>
      </section>
    </div>
  </aside>
  <AccountDialog v-if="dialog" :key="dialog" :kind="dialog" @close="dialog = null" />
</template>

<style scoped>
.panel { position: absolute; z-index: 3; top: 14px; left: 14px; width: 396px; max-height: calc(100% - 64px); display: flex; flex-direction: column; }
.brand { position: relative; z-index: 2; }
.brand { display: flex; align-items: center; gap: 6px; padding: 14px 10px 10px 14px; }
.brand .mark { margin-right: 4px; }
.mark { width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center; background: var(--accent); color: var(--accent-ink); flex: none; }
.mark svg { width: 22px; height: 22px; }
.titles { flex: 1; min-width: 0; }
h1 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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
button.row { width: 100%; border: 0; background: transparent; color: inherit; font: inherit; font-variant-numeric: tabular-nums; text-align: left; cursor: pointer; border-radius: 6px; }
button.row:hover { background: var(--raise); }
.row.off .name { text-decoration: line-through; color: var(--muted); }
.row.off .sw { background: transparent !important; box-shadow: inset 0 0 0 1.5px var(--muted); }
.row.off .bar i { opacity: .25; }
.all { margin-top: 8px; border: 1px solid var(--line); background: transparent; color: var(--ink-2); font: inherit; font-size: 12.5px; font-weight: 550; padding: 5px 10px; border-radius: 99px; cursor: pointer; min-height: 28px; }
.all:hover { background: var(--raise); color: var(--ink); }
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
.switch.owner { grid-column: 1 / -1; }
.switch.off { opacity: .5; cursor: default; }
.picker { display: grid; gap: 4px; margin: 2px 0 10px; }
.picker .cap { font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
/* tabs that size to their names and wrap: a mapset's name can be long, and there can be a handful */
.maps { display: flex; flex-wrap: wrap; gap: 2px; padding: 3px; border-radius: 12px; background: var(--raise); }
.maps button { flex: 1 1 auto; min-height: 30px; border: 0; padding: 6px 10px; border-radius: 9px; background: transparent; color: var(--ink-2); font: inherit; font-size: 12.5px; font-weight: 550; cursor: pointer; transition: background .15s, color .15s, box-shadow .15s; }
/* the open mapset is marked as the active layer is: in the dark look a raised tab alone hardly differs from the rest */
.maps button[aria-selected="true"] { background: var(--accent-soft); color: var(--accent); font-weight: 650; box-shadow: inset 0 0 0 1px var(--accent-soft); }
.maps button:not([aria-selected="true"]):hover { background: var(--raise); color: var(--ink); }
.notice { margin: 2px 0 10px; padding: 8px 10px; border-radius: 10px; background: var(--raise); font-size: 12.5px; color: var(--ink-2); }
.about { margin: 0 0 10px; border-radius: 10px; background: var(--raise); padding: 7px 10px; font-size: 13px; }
.about summary { cursor: pointer; font-weight: 600; color: var(--ink-2); }
.about .md { margin-top: 6px; color: var(--ink-2); line-height: 1.5; max-height: 40vh; overflow: auto; }
.about .md :deep(p) { margin: 0 0 8px; }
@media (max-width: 640px) {
  .panel { left: 8px; right: 54px; top: 8px; width: auto; max-height: 58%; }
  .brand { padding: 10px 8px 8px 10px; }
  .titles p { display: none; }
  .titles h1 { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .titles { min-height: 1px; }
  /* the layers sit over the map here: nothing of it shows through */
  .panel:not(.collapsed) { background: var(--solid); }
  .layer { padding: 10px; }
  .maps button { min-height: 40px; }
  .switches { grid-template-columns: 1fr; gap: 12px; }
}
</style>
