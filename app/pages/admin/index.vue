<script lang="ts" setup>
definePageMeta({ title: 'Admin', middleware: 'steward' })

const { data: me } = useMe()

/**
 * Sections are listed with what's built and what isn't, so a new IT Manager
 * can see the shape of the system rather than wondering what's missing.
 */
const sections = computed(() => [
  {
    label: 'Modules',
    description: me.value?.isAdmin
      ? 'Create, edit, activate and retire catalogue entries.'
      : `Steward the catalogue for ${me.value?.leadOf.join(', ')}.`,
    icon: 'i-lucide-book-open',
    to: '/admin/modules',
    available: true,
  },
  {
    label: 'Notifications',
    description: 'Expiry warnings and the monthly digest — mode, preview and what has been sent.',
    icon: 'i-lucide-mail',
    to: '/admin/notifications',
    adminOnly: true,
    available: true,
  },
  {
    label: 'Department leads',
    description: 'Who signs off certifications and stewards each department.',
    icon: 'i-lucide-users',
    adminOnly: true,
    available: false,
  },
  {
    label: 'Eligibility rules',
    description: 'What other apps mean by "duty-manager eligible".',
    icon: 'i-lucide-list-checks',
    adminOnly: true,
    available: false,
  },
  {
    label: 'API tokens',
    description: 'Per-consumer tokens for the read API.',
    icon: 'i-lucide-key-round',
    adminOnly: true,
    available: false,
  },
  {
    label: 'Audit log',
    description: 'Every privileged change, who made it and when.',
    icon: 'i-lucide-scroll-text',
    adminOnly: true,
    available: false,
  },
].filter(section => !section.adminOnly || me.value?.isAdmin))
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold">
        Admin
      </h1>
      <p class="text-muted mt-1">
        {{ me?.isAdmin
          ? 'You hold training:ADMIN.'
          : `You lead ${me?.leadOf.join(', ')}.` }}
      </p>
    </div>

    <div class="grid gap-4 sm:grid-cols-2">
      <UCard
        v-for="section in sections"
        :key="section.label"
        :class="section.available ? '' : 'opacity-60'"
      >
        <div class="flex items-start gap-3">
          <UIcon
            :name="section.icon"
            class="text-primary mt-0.5 shrink-0"
          />
          <div class="min-w-0 space-y-1">
            <div class="flex items-center gap-2">
              <h2 class="font-semibold">
                {{ section.label }}
              </h2>
              <UBadge
                v-if="!section.available"
                size="sm"
                color="neutral"
                variant="subtle"
                label="Later phase"
              />
            </div>
            <p class="text-sm text-muted">
              {{ section.description }}
            </p>
            <UButton
              v-if="section.available"
              :to="section.to"
              variant="link"
              size="sm"
              class="px-0"
              trailing-icon="i-lucide-arrow-right"
              label="Open"
            />
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
