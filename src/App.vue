<script setup lang="ts">
// The page: the map fills the window; the layer panel, the hover card, the info card and the status float over it.
import { onMounted, reactive, ref, shallowRef } from 'vue';
import { MapController, initialUi } from '@/map/controller';
import LayerPanel from '@/components/LayerPanel.vue';
import HoverCard from '@/components/HoverCard.vue';
import InfoCard from '@/components/InfoCard.vue';
import StatusPill from '@/components/StatusPill.vue';

const ui = reactive(initialUi());
const mapEl = ref<HTMLElement>();
const ctl = shallowRef<MapController>();

onMounted(async () => {
  ctl.value = await MapController.create(mapEl.value!, ui);
});
</script>

<template>
  <div ref="mapEl" class="map"></div>
  <LayerPanel v-if="ctl" :ui="ui" :ctl="ctl" />
  <HoverCard :tip="ui.tooltip" />
  <InfoCard v-if="ui.info" :info="ui.info" @close="ctl?.select(null)" />
  <StatusPill :status="ui.status" />
</template>
