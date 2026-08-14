<script lang="ts" setup>
definePageMeta({ title: 'Catalogue' })

const { data: me } = useMe()
const search = ref('')

// A sentinel rather than undefined: USelect renders an empty box for an
// undefined value, so "All departments" would show as blank.
const ALL_DEPARTMENTS = '__all__'
const selectedDepartment = ref<string>(ALL_DEPARTMENTS)

const { data: departmentData } = useFetch('/api/departments')
const { data, status } = await useFetch('/api/modules')

const departments = computed(() => departmentData.value?.departments ?? [])

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  return (data.value?.modules ?? []).filter((module) => {
    if (selectedDepartment.value !== ALL_DEPARTMENTS && module.department !== selectedDepartment.value) return false
    if (!query) return true
    return module.id.toLowerCase().includes(query)
      || module.name.toLowerCase().includes(query)
      || (module.description ?? '').toLowerCase().includes(query)
  })
})

/** Grouped by department, in the departments' own display order. */
const grouped = computed(() => {
  const order = new Map(departments.value.map(d => [d.code, d]))
  const groups = new Map<string, typeof filtered.value>()
  for (const module of filtered.value) {
    groups.set(module.department, [...(groups.get(module.department) ?? []), module])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (order.get(a)?.sort ?? 99) - (order.get(b)?.sort ?? 99))
    .map(([code, modules]) => ({
      code,
      name: order.get(code)?.name ?? code,
      modules,
    }))
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">
          Catalogue
        </h1>
        <p class="text-muted mt-1">
          Every module and certification, by department.
        </p>
      </div>

      <div class="flex items-center gap-2">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search modules"
          class="w-52"
        />
        <USelect
          v-model="selectedDepartment"
          :items="[
            { label: 'All departments', value: ALL_DEPARTMENTS },
            ...departments.filter(d => d.moduleCount > 0).map(d => ({ label: d.name, value: d.code })),
          ]"
          class="w-48"
        />
      </div>
    </div>

    <UAlert
      v-if="me?.canSeeDrafts"
      icon="i-lucide-eye"
      color="neutral"
      variant="subtle"
      title="You can see draft modules"
      description="Drafts are hidden from ordinary members until they're activated."
    />

    <div
      v-if="status === 'pending'"
      class="space-y-3"
    >
      <USkeleton
        v-for="n in 5"
        :key="n"
        class="h-16 w-full"
      />
    </div>

    <UAlert
      v-else-if="filtered.length === 0"
      icon="i-lucide-book-dashed"
      color="neutral"
      variant="subtle"
      title="Nothing to show"
      :description="search || selectedDepartment !== ALL_DEPARTMENTS
        ? 'No modules match that search.'
        : 'The catalogue is empty — or everything in it is still a draft. An admin can seed it from the subcommittee\'s spreadsheet.'"
    />

    <div
      v-for="group in grouped"
      v-else
      :key="group.code"
      class="space-y-3"
    >
      <h2 class="text-sm font-semibold uppercase tracking-wide text-muted">
        {{ group.name }}
      </h2>

      <div class="divide-y divide-default border border-default rounded-lg overflow-hidden">
        <NuxtLink
          v-for="module in group.modules"
          :key="module.id"
          :to="`/modules/${module.id}`"
          class="flex items-start gap-4 p-4 hover:bg-elevated/50 transition-colors"
        >
          <code class="text-xs font-mono text-muted shrink-0 w-20 pt-0.5">{{ module.id }}</code>

          <div class="min-w-0 flex-1 space-y-1">
            <div class="font-medium">
              {{ module.name }}
            </div>
            <p
              v-if="module.description"
              class="text-sm text-muted line-clamp-2"
            >
              {{ module.description }}
            </p>
            <ModuleBadges
              :module="module"
              show-status
            />
          </div>

          <UIcon
            name="i-lucide-chevron-right"
            class="text-dimmed shrink-0 mt-1"
          />
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
