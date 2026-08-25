<script lang="ts" setup>
definePageMeta({ title: 'Modules', middleware: 'steward' })

const { data: me } = useMe()
const {
  data: departmentData,
  status: departmentStatus,
  error: departmentError,
  refresh: refreshDepartments,
} = await useFetch('/api/departments')
const { data, status, error, refresh } = await useFetch('/api/modules', { query: { status: 'all' } })

const modalOpen = ref(false)
const editingId = ref<string | null>(null)
const search = ref('')

const modules = computed(() => data.value?.modules ?? [])
const departments = computed(() => departmentData.value?.departments ?? [])

/** Departments this user may create modules in. */
const stewardableDepartments = computed(() =>
  me.value?.isAdmin
    ? departments.value
    : departments.value.filter(d => me.value?.leadOf.includes(d.code)),
)

function canEdit(department: string): boolean {
  return Boolean(me.value?.isAdmin || me.value?.leadOf.includes(department))
}

const filtered = computed(() => {
  const query = search.value.trim().toLowerCase()
  if (!query) return modules.value
  return modules.value.filter(module =>
    module.id.toLowerCase().includes(query) || module.name.toLowerCase().includes(query),
  )
})

function create() {
  editingId.value = null
  modalOpen.value = true
}

function edit(id: string) {
  editingId.value = id
  modalOpen.value = true
}

async function onSaved() {
  await refresh()
}

const statusColour = { ACTIVE: 'success', DRAFT: 'neutral', RETIRED: 'warning' } as const
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">
          Modules
        </h1>
        <p class="text-muted mt-1">
          {{ me?.isAdmin
            ? 'The whole catalogue.'
            : `You can edit ${me?.leadOf.join(', ')}; everything else is read-only.` }}
        </p>
      </div>

      <div class="flex items-center gap-2">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search"
          class="w-52"
        />
        <UButton
          icon="i-lucide-plus"
          label="New module"
          :disabled="stewardableDepartments.length === 0"
          @click="create"
        />
      </div>
    </div>

    <UAlert
      icon="i-lucide-info"
      color="neutral"
      variant="subtle"
      title="Changing an expiry policy affects future awards only"
      description="Existing records keep the expiry they were stamped with. Retroactive change is a separate, previewed admin action: deliberately not something an edit here can do by accident."
    />

    <!-- Without the departments nothing is stewardable, so "New module" would
         sit disabled with no reason given. -->
    <LoadFailed
      v-if="departmentError"
      :error="departmentError"
      what="the department list"
      :retrying="departmentStatus === 'pending'"
      @retry="refreshDepartments"
    />

    <LoadFailed
      v-if="error"
      :error="error"
      what="the catalogue"
      :retrying="status === 'pending'"
      @retry="refresh"
    />

    <div class="border border-default rounded-lg overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="bg-elevated/50 text-left">
          <tr>
            <th class="p-3 font-medium">
              ID
            </th>
            <th class="p-3 font-medium">
              Name
            </th>
            <th class="p-3 font-medium">
              Dept
            </th>
            <th class="p-3 font-medium">
              Status
            </th>
            <th class="p-3 font-medium">
              Properties
            </th>
            <th class="p-3" />
          </tr>
        </thead>
        <tbody class="divide-y divide-default">
          <tr
            v-for="module in filtered"
            :key="module.id"
            class="hover:bg-elevated/30"
          >
            <td class="p-3 font-mono text-xs whitespace-nowrap">
              <NuxtLink
                :to="`/modules/${module.id}`"
                class="hover:text-primary"
              >
                {{ module.id }}
              </NuxtLink>
            </td>
            <td class="p-3">
              {{ module.name }}
            </td>
            <td class="p-3 text-muted">
              {{ module.department }}
            </td>
            <td class="p-3">
              <UBadge
                :color="statusColour[module.status as keyof typeof statusColour]"
                variant="subtle"
                size="sm"
                :label="module.status"
              />
            </td>
            <td class="p-3">
              <ModuleBadges :module="module" />
            </td>
            <td class="p-3 text-right">
              <UButton
                v-if="canEdit(module.department)"
                icon="i-lucide-pencil"
                variant="ghost"
                color="neutral"
                size="xs"
                aria-label="Edit"
                @click="edit(module.id)"
              />
            </td>
          </tr>

          <tr v-if="!error && filtered.length === 0">
            <td
              colspan="6"
              class="p-8 text-center text-muted"
            >
              No modules match.
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="text-xs text-muted">
      Modules are retired, never deleted: records and history reference them.
    </p>

    <AdminModuleFormModal
      v-model:open="modalOpen"
      :module-id="editingId"
      :departments="stewardableDepartments"
      :all-modules="modules"
      @saved="onSaved"
    />
  </div>
</template>
