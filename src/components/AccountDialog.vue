<script setup lang="ts">
// The two dialogs behind the user menu, as in the current map app: "Profielinstellingen" (name, job title, phone;
// the e-mail address is fixed) and "Wachtwoord wijzigen".
import { onMounted, reactive, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import { changePassword } from '@/api/auth';
import { reloadUser, session } from '@/api/session';

const props = defineProps<{ kind: 'profile' | 'password' }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const busy = ref(false);
const error = ref<string | null>(null);
const saved = ref(false);
const u = session.user!;
const profile = reactive({ given_name: u.givenName ?? '', family_name: u.familyName ?? '', job_title: u.jobTitle ?? '', phone_number: u.phoneNumber ?? '' });
const pw = reactive({ current: '', next: '', repeat: '' });

onMounted(() => dialog.value?.showModal());

async function saveProfile() {
  if (busy.value) return;
  busy.value = true; saved.value = false;
  const orNull = (s: string) => s.trim() || null;
  try {
    await api('user/me', { method: 'PUT', body: { given_name: orNull(profile.given_name), family_name: orNull(profile.family_name), job_title: orNull(profile.job_title), phone_number: orNull(profile.phone_number) } });
    await reloadUser();
    profile.phone_number = session.user?.phoneNumber ?? '';
    error.value = null; saved.value = true;
  } catch (e) {
    error.value = e instanceof ApiError && e.status === 400 ? 'Controleer de velden. Een telefoonnummer heeft 8 tot 15 cijfers.' : 'Het opslaan is niet gelukt. Probeer het opnieuw.';
  } finally { busy.value = false; }
}

async function savePassword() {
  if (busy.value) return;
  saved.value = false;
  if (pw.next !== pw.repeat) { error.value = 'Wachtwoorden komen niet overeen.'; return; }
  busy.value = true;
  try { await changePassword(pw.current, pw.next); error.value = null; saved.value = true; pw.current = pw.next = pw.repeat = ''; }
  catch (e) { error.value = (e as Error).message; }
  finally { busy.value = false; }
}
</script>

<template>
  <dialog ref="dialog" class="glass" :aria-labelledby="`${props.kind}-title`" @close="emit('close')">
    <form v-if="kind === 'profile'" @submit.prevent="saveProfile">
      <h2 id="profile-title">Profielinstellingen</h2>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <p v-else-if="saved" class="ok" role="status">Je profiel is opgeslagen.</p>
      <div class="two">
        <label>Voornaam<input v-model="profile.given_name" autocomplete="given-name" minlength="2"></label>
        <label>Achternaam<input v-model="profile.family_name" autocomplete="family-name" minlength="2"></label>
      </div>
      <label>E-mailadres<input :value="u.email" disabled></label>
      <label>Functie<input v-model="profile.job_title" autocomplete="organization-title"></label>
      <label>Telefoon<input v-model="profile.phone_number" type="tel" autocomplete="tel"><small>Spaties en streepjes mogen; +31 wordt 0031.</small></label>
      <div class="actions"><button type="button" class="secondary" @click="dialog?.close()">Sluiten</button><button class="primary" :disabled="busy">{{ busy ? 'Bezig…' : 'Bewaar instellingen' }}</button></div>
    </form>
    <form v-else @submit.prevent="savePassword">
      <h2 id="password-title">Wachtwoord wijzigen</h2>
      <p v-if="error" class="alert" role="alert">{{ error }}</p>
      <p v-else-if="saved" class="ok" role="status">Het wijzigen van je wachtwoord is gelukt.</p>
      <label>Huidig wachtwoord<input v-model="pw.current" type="password" autocomplete="current-password" required></label>
      <label>Nieuw wachtwoord<input v-model="pw.next" type="password" autocomplete="new-password" required minlength="8"></label>
      <label>Herhaal nieuw wachtwoord<input v-model="pw.repeat" type="password" autocomplete="new-password" required minlength="8"></label>
      <div class="actions"><button type="button" class="secondary" @click="dialog?.close()">Sluiten</button><button class="primary" :disabled="busy">{{ busy ? 'Bezig…' : 'Stel een nieuw wachtwoord in' }}</button></div>
    </form>
  </dialog>
</template>

<style scoped>
dialog { width: min(460px, calc(100vw - 24px)); padding: 22px; color: var(--ink); background: var(--surface-strong); }
dialog::backdrop { background: rgba(10, 14, 20, .45); }
form { display: grid; gap: 13px; }
h2 { margin: 0 0 2px; font-size: 18px; font-weight: 650; }
.two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
label { display: grid; gap: 5px; font-size: 13px; font-weight: 550; color: var(--ink-2); min-width: 0; }
label small { font-weight: 400; color: var(--muted); }
input { font: inherit; font-size: 14px; font-weight: 400; padding: 9px 11px; border-radius: 10px; border: 1px solid var(--line); background: transparent; color: var(--ink); min-width: 0; }
input:disabled { color: var(--muted); background: var(--raise); }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.primary, .secondary { border-radius: 10px; padding: 9px 16px; font-size: 14px; font-weight: 600; cursor: pointer; }
.primary { border: 0; background: var(--accent); color: var(--accent-ink); }
.primary:disabled { opacity: .55; }
.secondary { border: 1px solid var(--line); background: transparent; color: var(--ink); }
.alert, .ok { margin: 0; padding: 9px 12px; border-radius: 10px; font-size: 13.5px; }
.alert { border-left: 4px solid #D64545; background: rgba(214, 69, 69, .1); }
.ok { border-left: 4px solid #2E9E6B; background: rgba(46, 158, 107, .1); }
@media (max-width: 480px) { .two { grid-template-columns: 1fr; } }
</style>
