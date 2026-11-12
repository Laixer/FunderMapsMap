<script setup lang="ts">
// An address that is no page of the map.
import { onMounted } from 'vue';
onMounted(() => { document.title = 'Pagina niet gevonden — FunderMaps'; });
</script>

<template>
  <main class="nf">
    <section class="glass">
      <p class="code">404</p>
      <h1>Oh nee! Deze pagina is verzakt</h1>
      <p class="muted">Het adres dat je opvroeg bestaat niet (meer).</p>
      <a href="/">Naar de kaart</a>
    </section>
  </main>
</template>

<style scoped>
.nf { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; background: var(--page); }
section { width: min(440px, 100%); padding: 32px 28px; text-align: center; background: var(--surface-strong); }
.code { margin: 0; font-size: 13px; font-weight: 650; letter-spacing: .08em; color: var(--muted); }
h1 { margin: 6px 0 8px; font-size: 22px; font-weight: 700; letter-spacing: -0.015em; }
.muted { margin: 0 0 20px; font-size: 14px; color: var(--ink-2); }
a { display: inline-block; border-radius: 10px; padding: 10px 18px; background: var(--accent); color: var(--accent-ink); font-weight: 600; text-decoration: none; }
</style>
