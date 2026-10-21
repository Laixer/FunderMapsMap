<script setup lang="ts">
// Address search for the whole country (PDOK suggestions near the view; choosing one flies there and selects the pand).
import { ref } from 'vue';
import type { MapController } from '@/map/controller';
import { resolve, suggest, type Suggestion } from '@/search/search';

const props = defineProps<{ ctl: MapController }>();
const query = ref('');
const hits = ref<Suggestion[]>([]);
const active = ref(-1);
const open = ref(false);
const searching = ref(false);
let timer = 0;
let abort: AbortController | null = null;

function onInput() {
  clearTimeout(timer);
  const q = query.value.trim();
  if (q.length < 2) { hits.value = []; open.value = false; return; }
  timer = window.setTimeout(async () => {
    abort?.abort();
    abort = new AbortController();
    searching.value = true;
    try {
      hits.value = await suggest(q, props.ctl.centre, abort.signal);
      active.value = hits.value.length ? 0 : -1;
      open.value = true;
    } catch { /* aborted by the next keystroke */ } finally { searching.value = false; }
  }, 160);
}

async function choose(h: Suggestion) {
  query.value = h.label;
  open.value = false;
  (document.activeElement as HTMLElement | null)?.blur();
  const target = await resolve(h.id);
  if (target) props.ctl.goTo(target);
}

function onKey(e: KeyboardEvent) {
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && hits.value.length) {
    e.preventDefault();
    active.value = (active.value + (e.key === 'ArrowDown' ? 1 : hits.value.length - 1)) % hits.value.length;
    open.value = true;
  } else if (e.key === 'Enter' && hits.value[active.value]) {
    e.preventDefault();
    choose(hits.value[active.value]);
  } else if (e.key === 'Escape') {
    query.value = '';
    hits.value = [];
    open.value = false;
  }
}
const onBlur = () => window.setTimeout(() => { open.value = false; }, 120);
const onFocus = () => { if (hits.value.length) open.value = true; };
</script>

<template>
  <div class="search" role="search">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
    <input v-model="query" type="search" placeholder="Zoek een adres, postcode of plaats" autocomplete="off" spellcheck="false"
      role="combobox" :aria-expanded="open" aria-controls="search-results" aria-autocomplete="list" aria-label="Zoek een adres"
      :aria-activedescendant="open && active >= 0 ? `hit-${active}` : ''"
      @input="onInput" @keydown="onKey" @blur="onBlur" @focus="onFocus">
    <ul v-if="open" id="search-results" class="results glass" role="listbox">
      <li v-for="(h, i) in hits" :id="`hit-${i}`" :key="h.id" role="option" :aria-selected="i === active" @mousedown.prevent="choose(h)">
        <b>{{ h.label }}</b><span>{{ h.sub }}</span>
      </li>
      <li v-if="!hits.length" class="empty" role="option" aria-disabled="true">{{ searching ? 'Zoeken…' : 'Niets gevonden' }}</li>
    </ul>
  </div>
</template>

<style scoped>
.search { position: relative; margin: 0 14px 10px; }
.search svg { position: absolute; left: 11px; top: 50%; width: 16px; height: 16px; transform: translateY(-50%); color: var(--muted); pointer-events: none; }
.search input { width: 100%; font: inherit; font-size: 14px; color: var(--ink); padding: 9px 12px 9px 34px; border-radius: 12px; border: 1px solid var(--line); background: var(--surface-strong); outline: none; transition: border-color .15s, box-shadow .15s; }
.search input::placeholder { color: var(--muted); }
.search input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.results { position: absolute; z-index: 6; left: 0; right: 0; top: calc(100% + 6px); margin: 0; padding: 4px; list-style: none; border-radius: 12px; max-height: 320px; overflow: auto; }
.results li { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 7px 10px; border-radius: 9px; cursor: pointer; }
.results li[aria-selected="true"], .results li:hover { background: var(--accent-soft); }
.results li b { font-weight: 600; }
.results li span { color: var(--muted); font-size: 12px; white-space: nowrap; }
.results .empty { color: var(--muted); cursor: default; }
</style>
