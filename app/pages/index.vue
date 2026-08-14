<script lang="ts" setup>
definePageMeta({ title: 'Dashboard' })

const { data: me } = useMe()
const { data: departments } = useFetch('/api/departments')

const moduleCount = computed(() =>
  (departments.value?.departments ?? []).reduce((total, d) => total + d.moduleCount, 0),
)
</script>

<template>
  <div class="space-y-8">
    <div>
      <h1 class="text-2xl font-bold">
        Hello, {{ me?.user.name?.split(' ')[0] || 'there' }}
      </h1>
      <p class="text-muted mt-1">
        Training records for the Nottingham New Theatre.
      </p>
    </div>

    <!-- Phase 1 ships the catalogue; records arrive with session logging in
         Phase 2, so this says so rather than showing an empty state that
         looks like "you have no training". -->
    <UAlert
      icon="i-lucide-hard-hat"
      color="warning"
      variant="subtle"
      title="Your training records aren't here yet"
      description="This is Phase 1: the module catalogue. Logging sessions and holding records arrives in the next phase — until then, nobody's records are in the system."
    />

    <div class="grid gap-4 sm:grid-cols-2">
      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-book-open" />
            <h2 class="font-semibold">
              The catalogue
            </h2>
          </div>
        </template>

        <p class="text-sm text-muted">
          {{ moduleCount }} module{{ moduleCount === 1 ? '' : 's' }} you can see, across
          {{ (departments?.departments ?? []).filter(d => d.moduleCount > 0).length }} departments.
        </p>

        <template #footer>
          <UButton
            to="/modules"
            label="Browse the catalogue"
            trailing-icon="i-lucide-arrow-right"
            variant="link"
            class="px-0"
          />
        </template>
      </UCard>

      <UCard>
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-key-round" />
            <h2 class="font-semibold">
              What you can do
            </h2>
          </div>
        </template>

        <ul class="text-sm space-y-2">
          <li class="flex items-center gap-2">
            <UIcon
              :name="me?.isAdmin ? 'i-lucide-check' : 'i-lucide-minus'"
              :class="me?.isAdmin ? 'text-primary' : 'text-dimmed'"
            />
            <span :class="me?.isAdmin ? '' : 'text-dimmed'">Administer training</span>
          </li>
          <li class="flex items-center gap-2">
            <UIcon
              :name="me?.leadOf.length ? 'i-lucide-check' : 'i-lucide-minus'"
              :class="me?.leadOf.length ? 'text-primary' : 'text-dimmed'"
            />
            <span :class="me?.leadOf.length ? '' : 'text-dimmed'">
              Lead {{ me?.leadOf.length ? me.leadOf.join(', ') : 'a department' }}
            </span>
          </li>
          <li class="flex items-center gap-2">
            <UIcon
              :name="me?.isTrainer ? 'i-lucide-check' : 'i-lucide-minus'"
              :class="me?.isTrainer ? 'text-primary' : 'text-dimmed'"
            />
            <span :class="me?.isTrainer ? '' : 'text-dimmed'">Deliver and log training</span>
          </li>
        </ul>

        <template #footer>
          <p class="text-xs text-muted">
            Trainer standing comes from holding a valid Trainer certification — not
            from a setting someone toggles.
          </p>
        </template>
      </UCard>
    </div>
  </div>
</template>
