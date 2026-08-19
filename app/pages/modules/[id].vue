<script lang="ts" setup>
const route = useRoute()
const { data: me } = useMe()

const { data: module } = await useFetch(`/api/modules/${route.params.id}`)

if (!module.value) {
  throw createError({ statusCode: 404, statusMessage: 'Module not found', fatal: true })
}

definePageMeta({ title: 'Module' })
useHead({ title: () => module.value ? `${module.value.id} ${module.value.name}` : 'Module' })

const expiryDescription = computed(() => {
  if (!module.value) return ''
  if (module.value.kind === 'BRIEF') {
    return 'Briefs are given before every get-in or get-out. They never expire and never gate anything: your page simply shows when you last had one.'
  }
  switch (module.value.expiryMode) {
    case 'ACADEMIC_YEAR':
      return 'Expires on 30 September following the date it was awarded, so everyone renews together at the start of the academic year.'
    case 'MONTHS':
      return `Expires ${module.value.expiryMonths} months after the date it was awarded.`
    default:
      return 'Does not expire once awarded.'
  }
})

const canEdit = computed(() =>
  Boolean(me.value?.isAdmin || (module.value && me.value?.leadOf.includes(module.value.department))),
)
</script>

<template>
  <div
    v-if="module"
    class="space-y-8 max-w-3xl"
  >
    <div class="space-y-3">
      <UButton
        to="/modules"
        variant="link"
        color="neutral"
        size="sm"
        icon="i-lucide-arrow-left"
        label="Catalogue"
        class="px-0"
      />

      <div class="flex items-start justify-between gap-4">
        <div class="space-y-2">
          <code class="text-sm font-mono text-muted">{{ module.id }}</code>
          <h1 class="text-2xl font-bold">
            {{ module.name }}
          </h1>
          <ModuleBadges
            :module="module"
            show-status
          />
        </div>

        <UButton
          v-if="canEdit"
          to="/admin/modules"
          variant="outline"
          color="neutral"
          size="sm"
          icon="i-lucide-pencil"
          label="Edit"
        />
      </div>

      <p
        v-if="module.description"
        class="text-muted"
      >
        {{ module.description }}
      </p>
    </div>

    <UAlert
      v-if="module.status === 'DRAFT'"
      icon="i-lucide-pencil-ruler"
      color="warning"
      variant="subtle"
      title="Draft"
      description="This module is not published: ordinary members can't see it."
    />

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Validity
        </h2>
      </template>
      <p class="text-sm">
        {{ expiryDescription }}
      </p>
      <p
        v-if="module.safetyCritical"
        class="text-sm text-muted mt-3"
      >
        This module is safety critical: unmet prerequisites block a session rather than
        merely warning, and supervision expectations are stricter.
      </p>
    </UCard>

    <UCard v-if="module.prerequisites.length">
      <template #header>
        <h2 class="font-semibold">
          Prerequisites
        </h2>
      </template>
      <p class="text-sm text-muted mb-3">
        {{ module.kind === 'CERTIFICATION'
          ? 'All of these must be currently valid before this certification can be signed off.'
          : 'Trainers are warned if you haven\'t done these, but can still train you.' }}
      </p>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="prerequisite in module.prerequisites"
          :key="prerequisite.id"
          :to="`/modules/${prerequisite.id}`"
          variant="outline"
          color="neutral"
          size="sm"
          :label="`${prerequisite.id} · ${prerequisite.name}`"
        />
      </div>
    </UCard>

    <UCard v-if="module.requiredBy.length">
      <template #header>
        <h2 class="font-semibold">
          Leads on to
        </h2>
      </template>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="dependent in module.requiredBy"
          :key="dependent.id"
          :to="`/modules/${dependent.id}`"
          variant="outline"
          color="neutral"
          size="sm"
          :label="`${dependent.id} · ${dependent.name}`"
        />
      </div>
    </UCard>

    <UCard v-if="module.materialsUrl">
      <template #header>
        <h2 class="font-semibold">
          Materials
        </h2>
      </template>
      <UButton
        :to="module.materialsUrl"
        target="_blank"
        external
        variant="outline"
        color="neutral"
        icon="i-lucide-external-link"
        label="Open training materials"
      />
      <p class="text-xs text-muted mt-3">
        Materials live in the theatre's Drive; access is managed there.
      </p>
    </UCard>

    <UCard v-if="module.notes">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-lock" />
          <h2 class="font-semibold">
            Notes (leads and admins only)
          </h2>
        </div>
      </template>
      <p class="text-sm whitespace-pre-wrap">
        {{ module.notes }}
      </p>
    </UCard>
  </div>
</template>
