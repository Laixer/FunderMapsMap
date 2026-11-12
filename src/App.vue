<script setup lang="ts">
// Which page the address asks for. There is no router: the map is one page that keeps its own address (map/route.ts),
// the login pages are separate full page loads, and anything else is the 404.
import { defineAsyncComponent } from 'vue';
import MapView from '@/pages/MapView.vue';
import { pageOf } from '@/pages/page';
import { LOGIN_HOST } from '@/config';
import { onLoginHost } from '@/api/session';

const AuthPages = defineAsyncComponent(() => import('@/pages/AuthPages.vue'));
const NotFound = defineAsyncComponent(() => import('@/pages/NotFound.vue'));
const page = pageOf(location.pathname);
// the old addresses of the forgot-password page
if (page === 'old-reset') location.replace('/forgot-password');
// the login cookie only works on the login host's site: the same page there
const forwarded = (page === 'login' || page === 'forgot-password' || page === 'reset-password' || page === 'account') && !onLoginHost();
if (forwarded) location.replace(`${LOGIN_HOST}${location.pathname}${location.search}`);
</script>

<template>
  <template v-if="forwarded || page === 'old-reset'"></template>
  <MapView v-else-if="page === 'map'" />
  <NotFound v-else-if="page === 'not-found'" />
  <AuthPages v-else :page="page" />
</template>
