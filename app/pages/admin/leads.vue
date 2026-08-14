<script lang="ts" setup>
definePageMeta({ title: 'Department leads', middleware: 'admin' })

const toast = useToast()

const { data, refresh } = await useFetch('/api/admin/leads')
const { data: directory } = await useFetch('/api/people')

const adding = ref<string | null>(null)
const chosenPerson = ref<string | undefined>(undefined)
const busy = ref(false)

const peopleOptions = computed(() =>
  (directory.value?.people ?? []).map(p => ({ label: p.name, value: p.id })),
)

function startAdding(department: string) {
  adding.value = department
  chosenPerson.value = undefined
}

async function addLead() {
  if (!adding.value || !chosenPerson.value) return
  busy.value = true
  try {
    await $fetch('/api/admin/leads', {
      method: 'POST',
      body: { department: adding.value, userId: chosenPerson.value },
    })
    toast.add({ title: 'Lead added', icon: 'i-lucide-check', color: 'success' })
    adding.value = null
    await refresh()
  }
  catch (e) {
    const err = e as { data?: { statusMessage?: string } }
    toast.add({
      title: err.data?.statusMessage || 'Could not add that lead',
      icon: 'i-lucide-circle-alert',
      color: 'error',
    })
  }
  finally {
    busy.value = false
  }
}

async function removeLead(id: string, name: string) {
  try {
    await $fetch(`/api/admin/leads/${id}`, { method: 'DELETE' })
    toast.add({ title: `${name} stood down`, icon: 'i-lucide-check', color: 'success' })
    await refresh()
  }
  catch {
    toast.add({ title: 'Could not remove that lead', icon: 'i-lucide-circle-alert', color: 'error' })
  }
}

const withoutLeads = computed(() =>
  (data.value?.departments ?? []).filter(d => d.leads.length === 0).map(d => d.code),
)
</script>

<template>
  <div class="space-y-6 max-w-3xl">
    <div>
      <h1 class="text-2xl font-bold">
        Department leads
      </h1>
      <p class="text-muted mt-1">
        Who signs off certifications and stewards each department's catalogue.
      </p>
    </div>

    <UAlert
      icon="i-lucide-info"
      color="neutral"
      variant="subtle"
      title="This is the annual handover"
      description="Lead standing is app data, not an auth-service role, so the changeover each committee year is swapping rows here. Authority ends the moment someone is removed."
    />

    <UAlert
      v-if="withoutLeads.length"
      icon="i-lucide-triangle-alert"
      color="warning"
      variant="subtle"
      title="Departments with no lead"
      :description="`${withoutLeads.join(', ')} — nobody can sign off their certifications except an admin.`"
    />

    <div class="space-y-3">
      <UCard
        v-for="department in data?.departments ?? []"
        :key="department.code"
      >
        <template #header>
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <code class="text-xs font-mono text-muted">{{ department.code }}</code>
              <h2 class="font-semibold">
                {{ department.name }}
              </h2>
            </div>
            <UButton
              icon="i-lucide-user-plus"
              variant="ghost"
              color="neutral"
              size="xs"
              label="Add"
              @click="startAdding(department.code)"
            />
          </div>
        </template>

        <div
          v-if="department.leads.length"
          class="flex flex-wrap gap-2"
        >
          <div
            v-for="lead in department.leads"
            :key="lead.id"
            class="flex items-center gap-1 border border-default rounded-full pl-3 pr-1 py-1"
          >
            <NuxtLink
              :to="`/people/${lead.userId}`"
              class="text-sm hover:text-primary"
            >
              {{ lead.name }}
            </NuxtLink>
            <UButton
              icon="i-lucide-x"
              variant="ghost"
              color="neutral"
              size="xs"
              :aria-label="`Remove ${lead.name}`"
              @click="removeLead(lead.id, lead.name)"
            />
          </div>
        </div>
        <p
          v-else
          class="text-sm text-muted"
        >
          No lead.
        </p>

        <template
          v-if="adding === department.code"
          #footer
        >
          <div class="flex items-end gap-2">
            <UFormField
              label="Who"
              help="They must have signed in at least once"
              class="flex-1"
            >
              <USelectMenu
                v-model="chosenPerson"
                :items="peopleOptions"
                value-key="value"
                searchable
                placeholder="Choose a person"
                class="w-full"
              />
            </UFormField>
            <UButton
              label="Add"
              :loading="busy"
              :disabled="!chosenPerson"
              @click="addLead"
            />
            <UButton
              label="Cancel"
              color="neutral"
              variant="ghost"
              @click="() => { adding = null }"
            />
          </div>
        </template>
      </UCard>
    </div>
  </div>
</template>
