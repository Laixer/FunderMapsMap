<script setup lang="ts">
// The login pages, as the current map app has them: /login, /forgot-password, /reset-password and /account
// (passkeys, sign-out). Loaded only when one of them is asked for. A full page load brings the visitor back to the
// map, so nothing of a session is left in memory on the way in or out.
import { computed, onMounted, ref } from 'vue';
import {
  addPasskey, deletePasskey, getSession, listPasskeys, login, loginWithPasskey, passkeysSupported, requestPasswordReset,
  resetPassword, safeRedirect, signOut, RESET_LINK_EXPIRED, SessionExpiredError, type Passkey, type SessionUser,
} from '@/api/auth';

const props = defineProps<{ page: 'login' | 'forgot-password' | 'reset-password' | 'account' }>();
const query = new URLSearchParams(location.search);
const redirect = query.get('redirect');
const withRedirect = (path: string) => (redirect ? `${path}?redirect=${encodeURIComponent(redirect)}` : path);
const onward = () => location.assign(safeRedirect(redirect) ?? `${location.origin}/`);

const email = ref('');
const password = ref('');
const repeat = ref('');
const error = ref<string | null>(null);
const done = ref(false);
const busy = ref(false);
const passkeyBusy = ref(false);
const canPasskey = passkeysSupported();
const title = computed(() => ({ login: 'Inloggen', 'forgot-password': 'Wachtwoord vergeten', 'reset-password': 'Nieuw wachtwoord', account: 'Account' })[props.page]);

// ---- login ----
// A tab is sent on at most once a minute: when the map and this page disagree about the session they would otherwise
// send each other round. When storage does not work the form is shown.
const FORWARDED = 'fundermaps-login:forwarded';
function forwardOnce(): boolean {
  try {
    const at = Number(sessionStorage.getItem(FORWARDED) ?? 0);
    if (Date.now() - at < 60_000) return false;
    sessionStorage.setItem(FORWARDED, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}
const showForm = ref(props.page !== 'login' && props.page !== 'account');

async function onLogin() {
  if (busy.value) return;
  busy.value = true;
  try { await login(email.value.trim(), password.value); onward(); }
  catch (e) { error.value = (e as Error).message; busy.value = false; }
}

async function onPasskey(autoFill = false) {
  if (!autoFill) { if (passkeyBusy.value) return; passkeyBusy.value = true; }
  try { if (await loginWithPasskey({ autoFill })) onward(); }
  catch (e) { if (!autoFill) error.value = (e as Error).message; }
  finally { if (!autoFill) passkeyBusy.value = false; }
}

// ---- forgot / reset ----
async function onForgot() {
  if (busy.value) return;
  busy.value = true;
  try { await requestPasswordReset(email.value.trim()); done.value = true; error.value = null; }
  catch (e) { error.value = (e as Error).message; }
  finally { busy.value = false; }
}

const token = query.get('token');
async function onReset() {
  if (busy.value) return;
  if (password.value !== repeat.value) { error.value = 'Wachtwoorden komen niet overeen.'; return; }
  busy.value = true;
  try { await resetPassword(token!, password.value); done.value = true; error.value = null; }
  catch (e) { error.value = (e as Error).message; }
  finally { busy.value = false; }
}

// ---- account ----
const user = ref<SessionUser | null>(null);
const passkeys = ref<Passkey[]>([]);
const passkeysLoaded = ref(false);
const passkeyError = ref<string | null>(null);
const signOutFailed = ref(false);

function toLoginIfExpired(e: unknown): boolean {
  if (!(e instanceof SessionExpiredError)) return false;
  location.assign('/login?expired=1&redirect=%2Faccount');
  return true;
}
async function refreshPasskeys() {
  try { passkeys.value = await listPasskeys(); passkeysLoaded.value = true; }
  catch (e) { passkeysLoaded.value = false; if (!toLoginIfExpired(e)) passkeyError.value = 'Passkeys ophalen mislukt.'; }
}
function defaultPasskeyName(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'iPhone of iPad';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android-toestel';
  if (/Windows/.test(ua)) return 'Windows-pc';
  return 'Dit apparaat';
}
async function onAddPasskey() {
  if (busy.value) return;
  const name = window.prompt('Naam voor deze passkey', defaultPasskeyName());
  if (name === null) return;
  busy.value = true;
  try { await addPasskey(name.trim() || defaultPasskeyName()); passkeyError.value = null; await refreshPasskeys(); }
  catch (e) {
    if (toLoginIfExpired(e)) return;
    const what = e instanceof Error ? `${e.name} ${e.message}` : '';
    // dismissing the browser's prompt is not an error
    passkeyError.value = /abort|cancel|not ?allowed/i.test(what) ? null : 'Passkey toevoegen mislukt.';
  } finally { busy.value = false; }
}
async function onDeletePasskey(pk: Passkey) {
  if (busy.value) return;
  if (!window.confirm(pk.name ? `Passkey "${pk.name}" verwijderen?` : 'Deze passkey verwijderen?')) return;
  busy.value = true;
  try { await deletePasskey(pk.id); passkeyError.value = null; await refreshPasskeys(); }
  catch (e) { if (!toLoginIfExpired(e)) passkeyError.value = 'Passkey verwijderen mislukt.'; }
  finally { busy.value = false; }
}
const formatDate = (d: Passkey['createdAt']) => (d ? new Date(d).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
async function onSignOut() {
  if (busy.value) return;
  busy.value = true;
  const ok = await signOut();
  signOutFailed.value = !ok;
  if (ok) location.assign(`${location.origin}/`);
  else busy.value = false;
}

onMounted(async () => {
  document.title = `${title.value} — FunderMaps`;
  if (props.page === 'login') {
    if (query.get('expired') === '1') error.value = 'Je sessie is verlopen. Log opnieuw in.';
    else {
      // already logged in: straight on (at most 4 s of waiting for the answer)
      const s = await Promise.race([getSession(), new Promise<null>((r) => setTimeout(() => r(null), 4000))]);
      if (s && forwardOnce()) return onward();
    }
    showForm.value = true;
    // the passkey in the browser's autofill of the e-mail field, where the browser can do that
    if (canPasskey && (await window.PublicKeyCredential.isConditionalMediationAvailable?.().catch(() => false))) void onPasskey(true);
  } else if (props.page === 'account') {
    const s = await getSession();
    if (!s) return location.assign('/login?redirect=%2Faccount');
    user.value = s.user;
    if (canPasskey) await Promise.race([refreshPasskeys(), new Promise((r) => setTimeout(r, 3000))]);
    showForm.value = true;
  } else if (props.page === 'reset-password' && !token) error.value = RESET_LINK_EXPIRED;
});
</script>

<template>
  <main class="auth">
    <a class="brand" href="/" aria-label="Naar de kaart">
      <span class="mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5 12 5l8 6.5" /><path d="M6.5 10v5.5h11V10" /><path d="M8.5 15.5V20M12 15.5V20M15.5 15.5V20" /></svg></span>
      Funderingskaart
    </a>
    <section class="card glass">
      <p v-if="!showForm" class="muted">Laden…</p>

      <form v-else-if="page === 'login'" @submit.prevent="onLogin">
        <h1>Inloggen</h1>
        <p class="muted">Welkom terug bij FunderMaps.</p>
        <p v-if="error" class="alert" role="alert">{{ error }}</p>
        <label>E-mailadres<input v-model="email" type="email" autocomplete="username webauthn" required placeholder="naam@bedrijf.nl"></label>
        <label>Wachtwoord<input v-model="password" type="password" autocomplete="current-password" required placeholder="••••••••"></label>
        <button class="primary" type="submit" :disabled="busy">{{ busy ? 'Bezig…' : 'Inloggen' }}</button>
        <button v-if="canPasskey" class="secondary" type="button" :disabled="passkeyBusy" @click="onPasskey()">{{ passkeyBusy ? 'Bezig…' : 'Inloggen met passkey' }}</button>
        <a class="link" :href="withRedirect('/forgot-password')">Wachtwoord vergeten?</a>
      </form>

      <form v-else-if="page === 'forgot-password'" @submit.prevent="onForgot">
        <h1>Wachtwoord vergeten</h1>
        <p v-if="done" class="ok" role="status">Als er een account bestaat voor dit e-mailadres, is er een resetlink verstuurd. Controleer je inbox.</p>
        <template v-else>
          <p class="muted">Vul je e-mailadres in. Je krijgt een link om een nieuw wachtwoord in te stellen.</p>
          <p v-if="error" class="alert" role="alert">{{ error }}</p>
          <label>E-mailadres<input v-model="email" type="email" autocomplete="username" required placeholder="naam@bedrijf.nl"></label>
          <button class="primary" type="submit" :disabled="busy">{{ busy ? 'Bezig…' : 'Stuur resetlink' }}</button>
        </template>
        <a class="link" :href="withRedirect('/login')">Terug naar inloggen</a>
      </form>

      <form v-else-if="page === 'reset-password'" @submit.prevent="onReset">
        <h1>Nieuw wachtwoord</h1>
        <template v-if="done">
          <p class="ok" role="status">Je wachtwoord is gewijzigd. Je kunt nu inloggen.</p>
          <a class="primary" href="/login">Naar inloggen</a>
        </template>
        <template v-else>
          <p v-if="error" class="alert" role="alert">{{ error }} <a v-if="error === RESET_LINK_EXPIRED" href="/forgot-password">Vraag een nieuwe aan</a></p>
          <template v-if="token">
            <label>Nieuw wachtwoord<input v-model="password" type="password" autocomplete="new-password" required minlength="8"></label>
            <label>Herhaal wachtwoord<input v-model="repeat" type="password" autocomplete="new-password" required minlength="8"></label>
            <button class="primary" type="submit" :disabled="busy">{{ busy ? 'Bezig…' : 'Wachtwoord instellen' }}</button>
          </template>
        </template>
      </form>

      <div v-else class="account">
        <h1>Account</h1>
        <p class="muted">Je bent ingelogd bij FunderMaps als <strong>{{ user?.email }}</strong>.</p>
        <section v-if="canPasskey">
          <div class="head"><h2>Passkeys</h2><button class="text" type="button" :disabled="busy" @click="onAddPasskey">+ Passkey toevoegen</button></div>
          <p class="muted">Log in met je vingerafdruk, gezicht of apparaatcode in plaats van een wachtwoord.</p>
          <p v-if="passkeyError" class="alert" role="alert">{{ passkeyError }}</p>
          <ul v-if="passkeys.length">
            <li v-for="pk in passkeys" :key="pk.id">
              <span><b>{{ pk.name || 'Passkey' }}</b><small>{{ pk.deviceType === 'multiDevice' ? 'Gesynchroniseerd' : 'Alleen dit apparaat' }}<template v-if="pk.createdAt"> · toegevoegd {{ formatDate(pk.createdAt) }}</template></small></span>
              <button class="text" type="button" :disabled="busy" @click="onDeletePasskey(pk)">Verwijderen</button>
            </li>
          </ul>
          <p v-else-if="passkeysLoaded" class="muted">Nog geen passkeys.</p>
        </section>
        <p v-if="signOutFailed" class="alert" role="alert">Uitloggen is niet gelukt. Probeer het opnieuw.</p>
        <div class="actions">
          <a class="primary" href="/">Naar de kaart</a>
          <button class="secondary" type="button" :disabled="busy" @click="onSignOut">Uitloggen</button>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.auth { position: absolute; inset: 0; overflow: auto; display: grid; place-content: center; justify-items: center; gap: 18px; padding: 24px 16px; background: var(--page); }
.brand { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 650; color: var(--ink); text-decoration: none; }
.mark { width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center; background: var(--accent); color: var(--accent-ink); }
.mark svg { width: 22px; height: 22px; }
.card { width: min(440px, calc(100vw - 32px)); padding: 28px; background: var(--surface-strong); }
form, .account { display: grid; gap: 14px; }
h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.015em; }
h2 { margin: 0; font-size: 11px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
p { margin: 0; }
.muted { font-size: 13.5px; color: var(--ink-2); }
label { display: grid; gap: 5px; font-size: 13px; font-weight: 550; color: var(--ink-2); }
input { font: inherit; font-size: 14px; font-weight: 400; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface-strong); color: var(--ink); }
input:focus { outline: 2px solid var(--accent); outline-offset: 0; border-color: transparent; }
.primary, .secondary { display: flex; align-items: center; justify-content: center; border-radius: 10px; padding: 10px 16px; font-size: 14px; font-weight: 600; cursor: pointer; text-decoration: none; }
.primary { border: 0; background: var(--accent); color: var(--accent-ink); }
.secondary { border: 1px solid var(--line); background: transparent; color: var(--ink); }
.primary:disabled, .secondary:disabled, .text:disabled { opacity: .55; cursor: not-allowed; }
.link { justify-self: center; font-size: 13.5px; color: var(--accent); text-decoration: none; }
.link:hover, .text:hover:enabled { text-decoration: underline; }
.text { border: 0; background: none; padding: 0; font-size: 13.5px; font-weight: 600; color: var(--accent); cursor: pointer; }
.alert { padding: 10px 12px; border-radius: 10px; border-left: 4px solid #D64545; background: rgba(214, 69, 69, .1); font-size: 13.5px; color: var(--ink); }
.alert a { color: var(--accent); }
.ok { padding: 10px 12px; border-radius: 10px; border-left: 4px solid #2E9E6B; background: rgba(46, 158, 107, .1); font-size: 13.5px; }
.account section { display: grid; gap: 8px; }
.head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
ul { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 10px; }
li { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 10px 12px; font-size: 13.5px; }
li + li { border-top: 1px solid var(--line); }
li b { display: block; font-weight: 600; }
li small { color: var(--ink-2); font-size: 12.5px; }
.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
@media (max-width: 480px) { .actions { grid-template-columns: 1fr; } li { align-items: start; } }
</style>
