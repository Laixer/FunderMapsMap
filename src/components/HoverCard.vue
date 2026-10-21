<script setup lang="ts">
// The card next to the pointer: the active layer's value and a few facts, straight from the tiles (no request).
import { computed, ref, watchEffect } from 'vue';
import type { UiState } from '@/map/controller';

const props = defineProps<{ tip: UiState['tooltip'] }>();
const el = ref<HTMLElement>();
const pos = ref({ left: '0px', top: '0px' });

// keep the card on screen: flip to the other side of the pointer near an edge
watchEffect(() => {
  const t = props.tip;
  if (!t) return;
  const w = el.value?.offsetWidth ?? 300, h = el.value?.offsetHeight ?? 160;
  pos.value = {
    left: `${t.x + 16 + w > window.innerWidth ? t.x - w - 16 : t.x + 16}px`,
    top: `${t.y + 16 + h > window.innerHeight ? t.y - h - 16 : t.y + 16}px`,
  };
});
const shown = computed(() => !!props.tip);
</script>

<template>
  <div v-show="shown" ref="el" class="tooltip glass" :style="pos">
    <template v-if="tip">
      <div class="head"><b>{{ tip.title }}</b><span>{{ tip.more }}</span></div>
      <div class="value"><span class="sw" :style="{ background: tip.swatch }"></span><span>{{ tip.valueTitle }} · <b>{{ tip.valueLabel }}</b></span></div>
      <div v-if="tip.facts.length" class="facts">
        <template v-for="[k, v] in tip.facts" :key="k"><span>{{ k }}</span><b>{{ v }}</b></template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.tooltip { position: absolute; z-index: 4; pointer-events: none; padding: 10px 12px; border-radius: 12px; font-size: 12.5px; width: 300px; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.head b { font-size: 13.5px; font-weight: 640; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.head span { color: var(--muted); font-size: 11.5px; white-space: nowrap; }
.value { display: flex; align-items: center; gap: 7px; margin: 6px 0 8px; color: var(--ink-2); }
.value b { color: var(--ink); font-weight: 620; }
.sw { width: 11px; height: 11px; border-radius: 3px; flex: none; }
.facts { display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; padding-top: 8px; border-top: 1px solid var(--line); }
.facts span { color: var(--muted); }
.facts b { font-weight: 560; font-variant-numeric: tabular-nums; }
@media (max-width: 640px) { .tooltip { display: none !important; } }
</style>
