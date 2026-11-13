<script setup lang="ts">
// Who is logged in, in the panel's header: a guest gets "Inloggen"; a user their name, the way to their account,
// "Uitloggen", and who at FunderMaps they can turn to (their organisation's account holder, else the general address).
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { session, toLogin, onLoginHost } from '@/api/session';
import { contactsOf } from '@/api/contacts';
import { signOut } from '@/api/auth';
import { LOGIN_HOST } from '@/config';

defineEmits<{ profile: []; password: [] }>();
const open = ref(false);
const root = ref<HTMLElement>();
const failed = ref(false);
const initials = (name: string) => name.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('');
const contacts = computed(() => (session.user ? contactsOf(session.user) : []));
const people = computed(() => contacts.value.filter((c) => c.person).length);
/** photos that did not load: the initials take their place */
const broken = reactive(new Set<string>());
// The menu hangs from the avatar's right edge. Where the avatar is not at the panel's edge (a phone: icons follow it)
// that would push the menu off the screen's left side: it is moved back in by what sticks out.
const menu = ref<HTMLElement>();
const shift = ref(0);
watch(open, async (isOpen) => {
  shift.value = 0;
  if (!isOpen) return;
  await nextTick();
  const left = menu.value?.getBoundingClientRect().left ?? 8;
  if (left < 8) shift.value = Math.ceil(8 - left);
});

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
      <div v-if="open" ref="menu" class="menu glass" role="menu" :style="shift ? { transform: `translateX(${shift}px)` } : undefined">
        <div class="who"><b>{{ session.user.name }}</b><small>{{ session.user.organizations[0]?.name ?? session.user.email }}</small></div>
        <button role="menuitem" @click="open = false; $emit('profile')">Profiel</button>
        <button role="menuitem" @click="open = false; $emit('password')">Wijzig wachtwoord</button>
        <a role="menuitem" href="/account">Passkeys</a>
        <button role="menuitem" @click="logout">Uitloggen</button>
        <p v-if="failed" class="failed" role="alert">Uitloggen is niet gelukt. Probeer het opnieuw.</p>
        <div class="contacts" role="group" aria-labelledby="contact-title">
          <p id="contact-title" class="label">{{ people > 1 ? 'Uw contactpersonen' : people ? 'Uw contactpersoon' : 'Contact' }}</p>
          <div v-for="(c, i) in contacts" :key="i" class="contact">
            <img v-if="c.picture && !broken.has(c.picture)" class="face" :src="c.picture" alt="" @error="broken.add(c.picture)" />
            <span v-else class="face" aria-hidden="true">{{ initials(c.name) }}</span>
            <div class="details">
              <b>{{ c.name }}</b>
              <small v-if="c.jobTitle">{{ c.jobTitle }}</small>
              <small v-if="c.organizations.length">voor {{ c.organizations.join(', ') }}</small>
              <a role="menuitem" :href="`mailto:${c.email}`">{{ c.email }}</a>
              <a v-if="c.phone" role="menuitem" :href="c.phone.href">{{ c.phone.label }}</a>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.user { position: relative; flex: none; }
.login { border: 1px solid var(--line); background: transparent; border-radius: 99px; padding: 5px 10px; font-size: 12.5px; font-weight: 600; cursor: pointer; color: var(--ink); }
.login:hover:enabled { background: var(--raise); }
.login:disabled { opacity: .5; }
.avatar { width: 32px; height: 32px; border-radius: 50%; border: 0; background: var(--accent-soft); color: var(--accent); font-size: 12px; font-weight: 700; cursor: pointer; }
.menu { position: absolute; z-index: 6; top: 38px; right: 0; width: 248px; padding: 6px; display: grid; gap: 1px; background: var(--surface-strong); }
.who { padding: 8px 10px 9px; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
.who b { display: block; font-size: 13.5px; font-weight: 620; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.who small { display: block; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.menu button, .menu a { display: block; width: 100%; text-align: left; border: 0; background: transparent; padding: 8px 10px; border-radius: 9px; font-size: 13.5px; color: var(--ink); cursor: pointer; text-decoration: none; }
.menu button:hover, .menu a:hover { background: var(--raise); }
.failed { margin: 4px 10px 6px; font-size: 12.5px; color: #D64545; }
.contacts { border-top: 1px solid var(--line); margin-top: 4px; padding: 9px 10px 6px; display: grid; gap: 9px; }
.label { margin: 0; font-size: 11px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.contact { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 9px; align-items: start; }
.face { width: 32px; height: 32px; border-radius: 50%; background: var(--raise); color: var(--ink-2); font-size: 11.5px; font-weight: 700; display: grid; place-items: center; object-fit: cover; }
.details { display: grid; gap: 1px; min-width: 0; }
/* a long name or address wraps: it is there to be read and typed over, not cut */
.details b { font-size: 13px; font-weight: 620; overflow-wrap: anywhere; }
.details small { font-size: 12px; color: var(--muted); }
.menu .details a { padding: 2px 0; border-radius: 4px; font-size: 12.5px; color: var(--accent); overflow-wrap: anywhere; }
.menu .details a:hover { background: transparent; text-decoration: underline; }
</style>
