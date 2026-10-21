<script setup lang="ts">
import type { UiState } from '@/map/controller';

defineProps<{ status: UiState['status'] }>();
</script>

<template>
  <div class="status glass" :class="{ busy: status.busy }" role="status">
    <span class="spinner" aria-hidden="true"></span><span>{{ status.text }}</span>
  </div>
</template>

<style scoped>
.status { position: absolute; z-index: 3; left: 14px; bottom: 14px; display: flex; align-items: center; gap: 8px; padding: 6px 12px 6px 10px; border-radius: 99px; font-size: 12px; color: var(--ink-2); }
.spinner { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--line); border-top-color: var(--accent); animation: spin .8s linear infinite; }
.status:not(.busy) .spinner { display: none; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 640px) { .status { left: 8px; bottom: auto; top: 128px; } }
</style>
