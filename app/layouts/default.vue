<script lang="ts" setup>
const { user } = useUserSession()
const { data: me } = useMe()
const config = useRuntimeConfig()

/**
 * A same-site form POST, not a fetch: the auth service deliberately has no
 * CORS, and a form POST carries the cookie and bounces back.
 */
function logout() {
  if (import.meta.dev) {
    // No auth service locally; clearing the dev session means starting over
    // at /dev-login.
    window.location.href = '/dev-logout'
    return
  }
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = `${config.public.authBaseURL}/logout?redirect=${encodeURIComponent(window.location.origin)}`
  document.body.appendChild(form)
  form.submit()
}

const links = computed(() => [
  { label: 'Dashboard', to: '/', icon: 'i-lucide-layout-dashboard' },
  { label: 'Catalogue', to: '/modules', icon: 'i-lucide-book-open' },
  { label: 'People', to: '/people', icon: 'i-lucide-users' },
  { label: 'Sessions', to: '/sessions', icon: 'i-lucide-calendar-check' },
])
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <header class="border-b border-default">
      <UContainer class="flex items-center justify-between h-14 gap-4">
        <div class="flex items-center gap-6 min-w-0">
          <NuxtLink
            to="/"
            class="font-bold text-primary shrink-0"
          >
            Rehearsal
          </NuxtLink>

          <nav class="hidden sm:flex items-center gap-1">
            <UButton
              v-for="link in links"
              :key="link.to"
              :to="link.to"
              :icon="link.icon"
              :label="link.label"
              variant="ghost"
              color="neutral"
              size="sm"
            />
          </nav>
        </div>

        <div class="flex items-center gap-1 shrink-0">
          <UButton
            v-if="me?.isAdmin || me?.leadOf.length"
            to="/admin"
            variant="ghost"
            color="neutral"
            size="sm"
            icon="i-lucide-shield"
            label="Admin"
          />
          <UDropdownMenu
            :items="[[
              { label: user?.name || 'Account', type: 'label' },
              { label: 'Manage account', icon: 'i-lucide-circle-user-round', to: `${config.public.authBaseURL}/account`, target: '_blank' },
              { label: 'Sign out', icon: 'i-lucide-log-out', onSelect: logout },
            ]]"
          >
            <UButton
              variant="ghost"
              color="neutral"
              size="sm"
              icon="i-lucide-circle-user-round"
              :label="user?.name || 'Account'"
            />
          </UDropdownMenu>
        </div>
      </UContainer>
    </header>

    <main class="flex-1">
      <UContainer class="py-8">
        <slot />
      </UContainer>
    </main>

    <footer class="border-t border-default py-4">
      <UContainer class="text-xs text-muted flex justify-between">
        <span>Training records for the Nottingham New Theatre.</span>
        <ULink
          to="https://newtheatre.org.uk"
          class="hover:text-primary"
        >
          newtheatre.org.uk
        </ULink>
      </UContainer>
    </footer>
  </div>
</template>
