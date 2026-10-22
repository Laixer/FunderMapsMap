<script setup lang="ts">
// The disclaimer of a mapset (application.mapset_collection.consent), shown over the map until accepted; asked again
// after 7 days, as in the current map app (DisclaimerModal.vue).
import { onMounted, ref } from 'vue';

const props = defineProps<{ mapset: { id: string; name: string; consent: string } }>();
const KEEP = 7 * 24 * 3600 * 1000;
const key = `fm-consent-${props.mapset.id}`;
const open = ref(false);
const button = ref<HTMLButtonElement>();

onMounted(() => {
  let at = 0;
  try { at = Number(localStorage.getItem(key) ?? 0); } catch { /* private mode: ask every visit */ }
  open.value = !(at > Date.now() - KEEP);
  if (open.value) requestAnimationFrame(() => button.value?.focus());
});

function accept() {
  try { localStorage.setItem(key, String(Date.now())); } catch { /* private mode */ }
  open.value = false;
}
</script>

<template>
  <div v-if="open" class="backdrop">
    <section class="dialog glass" role="dialog" aria-modal="true" aria-labelledby="consent-title">
      <h2 id="consent-title">Disclaimer</h2>
      <p class="muted">{{ mapset.name }}</p>
      <div class="md" v-html="mapset.consent"></div>
      <button ref="button" class="accept" @click="accept">Akkoord</button>
    </section>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 16px; background: rgba(10, 14, 20, .45); }
.dialog { width: min(520px, 100%); max-height: calc(100% - 32px); overflow: auto; padding: 20px 22px; }
h2 { margin: 0; font-size: 17px; font-weight: 650; }
.muted { margin: 2px 0 12px; font-size: 13px; }
.md { font-size: 13.5px; line-height: 1.55; color: var(--ink-2); }
.md :deep(p) { margin: 0 0 10px; }
.accept { margin-top: 6px; border: 0; border-radius: 10px; padding: 9px 18px; background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: 14px; cursor: pointer; }
.accept:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
