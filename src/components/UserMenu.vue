<script setup lang="ts">
// Who is logged in, in the panel's header: a guest gets "Inloggen"; a user their name, the way to their account and
// "Uitloggen".
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { session, toLogin, onLoginHost } from '@/api/session';
import { signOut } from '@/api/auth';
import { LOGIN_HOST } from '@/config';

defineEmits<{ profile: []; password: [] }>();
const open = ref(false);
const root = ref<HTMLElement>();
const failed = ref(false);
const initials = (name: string) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');

// On a name that cannot hold the login (the cookie's site is another one) logging in happens on the login host.
function login() {
  if (onLoginHost()) toLogin();
  else location.assign(`${LOGIN_HOST}/login?redirect=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
}
async function logout() {
  failed.value = !(await signOut());
  // a full load: nothing of the session stays in memory
  if (!failed.value) location.assign(`${location.origin}/`);
}
const outside = (e: Event) => { if (open.value && !root.value?.contains(e.target as Node)) open.value = false; };
const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') open.value = false; };
onMounted(() => { document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape); });
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); });
</script>

<template>
  <div ref="root" class="user">
    <button v-if="!session.user" class="login" :disabled="!session.ready" @click="login">Inloggen</button>
    <template v-else>
      <button class="avatar" aria-haspopup="menu" :aria-expanded="open" :aria-label="`Account van ${session.user.name}`" @click="open = !open">{{ initials(session.user.name) }}</button>
      <div v-if="open" class="menu glass" role="menu">
        <div class="who"><b>{{ session.user.name }}</b><small>{{ session.user.organizations[0]?.name ?? session.user.email }}</small></div>
        <button role="menuitem" @click="open = false; $emit('profile')">Profiel</button>
        <button role="menuitem" @click="open = false; $emit('password')">Wijzig wachtwoord</button>
        <a role="menuitem" href="/account">Passkeys</a>
        <button role="menuitem" @click="logout">Uitloggen</button>
        <p v-if="failed" class="failed" role="alert">Uitloggen is niet gelukt. Probeer het opnieuw.</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.user { position: relative; flex: none; }
.login { border: 1px solid var(--line); background: transparent; border-radius: 99px; padding: 5px 12px; font-size: 12.5px; font-weight: 600; cursor: pointer; color: var(--ink); }
.login:hover:enabled { background: var(--raise); }
.login:disabled { opacity: .5; }
.avatar { width: 32px; height: 32px; border-radius: 50%; border: 0; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 700; cursor: pointer; }
.menu { position: absolute; z-index: 6; top: 38px; right: 0; width: 220px; padding: 6px; display: grid; gap: 1px; background: var(--surface-strong); }
.who { padding: 8px 10px 9px; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
.who b { display: block; font-size: 13.5px; font-weight: 620; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.who small { display: block; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu button, .menu a { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 10px; border-radius: 9px; font-size: 13.5px; color: var(--ink); cursor: pointer; text-decoration: none; }
.menu button:hover, .menu a:hover { background: var(--raise); }
.failed { margin: 4px 10px 6px; font-size: 12.5px; color: #D64545; }
</style>
