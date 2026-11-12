<script setup lang="ts">
// The map page: the map fills the window; the layer panel, the hover card, the info card and the status float over it.
import { onMounted, reactive, ref, shallowRef } from 'vue';
import { MapController, initialUi } from '@/map/controller';
import LayerPanel from '@/components/LayerPanel.vue';
import HoverCard from '@/components/HoverCard.vue';
import InfoCard from '@/components/InfoCard.vue';
import StatusPill from '@/components/StatusPill.vue';
import ConsentModal from '@/components/ConsentModal.vue';
import { parseRoute } from '@/map/route';
import { loadSession, session, toLogin } from '@/api/session';
import BuildingPanel from '@/panel/BuildingPanel.vue';

const ui = reactive(initialUi());
const mapEl = ref<HTMLElement>();
const ctl = shallowRef<MapController>();

onMounted(async () => {
  void loadSession();
  ctl.value = await MapController.create(mapEl.value!, ui, parseRoute());
});
</script>

<template>
  <div ref="mapEl" class="map"></div>
  <LayerPanel v-if="ctl" :ui="ui" :ctl="ctl" />
  <HoverCard :tip="ui.tooltip" />
  <!-- a user gets the full building panel; a guest the card with what the map itself knows, and the way to log in -->
  <BuildingPanel v-if="ui.info && session.user" :pand="ui.info.id.slice(-16)" :info="ui.info" @close="ctl?.select(null)" />
  <InfoCard v-else-if="ui.info" :info="ui.info" :guest="session.ready" @close="ctl?.select(null)" @login="toLogin()" />
  <StatusPill :status="ui.status" />
  <ConsentModal v-if="ui.mapset?.consent" :key="ui.mapset.id" :mapset="ui.mapset" />
</template>
