<script setup lang="ts">
// A logged-in user whose organisation has no map (and who has no public one to go back to): nothing can be shown, so
// say that, say who to ask, and give the way out. The current map app's "Geen kaarten gevonden".
import { computed, onMounted, ref } from 'vue';
import { session } from '@/api/session';
import { signOut } from '@/api/auth';
import { contactsOf } from '@/api/contacts';

const failed = ref(false);
const button = ref<HTMLButtonElement>();
const contacts = computed(() => (session.user ? contactsOf(session.user) : []));
async function logout() {
  failed.value = !(await signOut());
  if (!failed.value) location.assign(`${location.origin}/login`);
}
onMounted(() => button.value?.focus());
</script>

<template>
  <div class="backdrop">
    <div class="box glass" role="alertdialog" aria-modal="true" aria-labelledby="no-mapsets-title" aria-describedby="no-mapsets-text">
      <h2 id="no-mapsets-title">Geen kaarten gevonden</h2>
      <p id="no-mapsets-text">Er zijn geen kaarten waar je toegang toe hebt. Neem contact op met FunderMaps om een kaart voor je organisatie te laten klaarzetten.</p>
      <ul>
        <li v-for="(c, i) in contacts" :key="i">
          <b>{{ c.name }}</b><span v-if="c.jobTitle">, {{ c.jobTitle }}</span>:
          <a :href="`mailto:${c.email}`">{{ c.email }}</a><template v-if="c.phone"> · <a :href="c.phone.href">{{ c.phone.label }}</a></template>
        </li>
      </ul>
      <p v-if="failed" class="failed" role="alert">Uitloggen is niet gelukt. Probeer het opnieuw.</p>
      <button ref="button" class="out" @click="logout">Uitloggen</button>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 20; display: grid; place-items: center; padding: 16px; background: var(--bg, transparent); }
.box { width: min(440px, 100%); padding: 22px 22px 18px; display: grid; gap: 12px; background: var(--solid); }
h2 { margin: 0; font-size: 19px; font-weight: 650; letter-spacing: -0.015em; }
p { margin: 0; font-size: 14px; line-height: 1.5; color: var(--ink-2); }
ul { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; font-size: 13.5px; color: var(--ink-2); }
ul b { color: var(--ink); font-weight: 620; }
a { color: var(--accent); overflow-wrap: anywhere; }
.out { justify-self: start; margin-top: 4px; border: 0; border-radius: 10px; padding: 9px 18px; background: var(--accent); color: var(--accent-ink); font-weight: 600; font-size: 14px; cursor: pointer; }
.out:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.failed { color: #D64545; font-size: 13px; }
</style>
