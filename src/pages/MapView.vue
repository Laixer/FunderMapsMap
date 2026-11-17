<script setup lang="ts">
// The map page: the map fills the window; the layer panel, the hover card, the building panel and the status float over it.
import { onMounted, reactive, ref, shallowRef } from 'vue';
import { MapController, initialUi } from '@/map/controller';
import LayerPanel from '@/components/LayerPanel.vue';
import HoverCard from '@/components/HoverCard.vue';
import StatusPill from '@/components/StatusPill.vue';
import ConsentModal from '@/components/ConsentModal.vue';
import { parseRoute } from '@/map/route';
import { loadSession, session } from '@/api/session';
import BuildingPanel from '@/panel/BuildingPanel.vue';
import NoMapsets from '@/components/NoMapsets.vue';

const ui = reactive(initialUi());
const mapEl = ref<HTMLElement>();
const ctl = shallowRef<MapController>();

onMounted(async () => {
  void loadSession();
  // null: nothing to show (a user without any mapset); a guest without one is on the way to the login page
  ctl.value = (await MapController.create(mapEl.value!, ui, parseRoute())) ?? undefined;
});
</script>

<template>
  <div ref="mapEl" class="map" role="application" aria-label="Kaart van Nederland met de funderingen per pand"></div>
  <LayerPanel v-if="ctl" :ui="ui" :ctl="ctl" />
  <HoverCard :tip="ui.tooltip" />
  <!-- A user gets the building panel. A guest gets nothing per building (no card, no hover card): the colours and the
       legend of a public map are what is public, and "Inloggen" in the bar leads to the rest. -->
  <BuildingPanel v-if="ui.info && session.user" :pand="ui.info.id.slice(-16)" :info="ui.info" @close="ctl?.select(null)" />
  <StatusPill v-if="!ui.noMapsets" :status="ui.status" />
  <ConsentModal v-if="ui.mapset?.consent" :key="ui.mapset.id" :mapset="ui.mapset" />
  <NoMapsets v-if="ui.noMapsets" />
</template>
