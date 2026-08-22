<script lang="ts" setup>
/**
 * Which modules have a sandbox in a consumer app. Data, not code, so a
 * catalogue renumbering is an edit here and no deploy anywhere (ADR-0014).
 */
definePageMeta({ title: 'Practice targets', middleware: 'admin' })

const toast = useToast()

const requestFetch = useRequestFetch()
const { data, refresh } = await useAsyncData('practice-targets', () =>
  requestFetch('/api/admin/practice-targets'))
const { data: catalogue } = await useFetch('/api/modules')

const targets = computed(() => data.value?.targets ?? [])
const open = computed(() => data.value?.open ?? [])

const moduleOptions = computed(() =>
  (catalogue.value?.modules ?? []).map(m => ({ label: `${m.id} · ${m.name}`, value: m.id })),
)

const editing = ref<{
  key: string
  name: string
  description: string
  consumer: string
  moduleIds: string[]
  graceHours: number | null
  status: 'ACTIVE' | 'RETIRED'
} | null>(null)

const busy = ref(false)
const actionError = ref<string | null>(null)

function edit(target: typeof targets.value[number] | null) {
  editing.value = target
    ? {
        key: target.key,
        name: target.name,
        description: target.description ?? '',
        consumer: target.consumer ?? '',
        moduleIds: [...target.moduleIds],
        graceHours: target.graceHours,
        status: target.status,
      }
    : {
        key: '',
        name: '',
        description: '',
        consumer: '',
        moduleIds: [],
        graceHours: null,
        status: 'ACTIVE',
      }
}

async function save() {
  if (!editing.value) return
  busy.value = true
  actionError.value = null
  try {
    await $fetch('/api/admin/practice-targets', {
      method: 'PUT',
      body: {
        key: editing.value.key,
        name: editing.value.name,
        description: editing.value.description || null,
        consumer: editing.value.consumer || null,
        moduleIds: editing.value.moduleIds,
        graceHours: editing.value.graceHours,
        status: editing.value.status,
      },
    })
    editing.value = null
    await refresh()
    toast.add({ title: 'Saved', icon: 'i-lucide-check', color: 'success' })
  }
  catch (e) {
    actionError.value = errorMessage(e, 'Could not save that target')
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="space-y-6 max-w-3xl">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-bold">
          Practice targets
        </h1>
        <p class="text-muted mt-1">
          Which modules open a sandbox in another app when they are taught.
        </p>
      </div>
      <UButton
        label="New target"
        icon="i-lucide-plus"
        @click="edit(null)"
      />
    </div>

    <UAlert
      icon="i-lucide-info"
      color="neutral"
      variant="subtle"
      title="These are not eligibility rules"
      description="An eligibility rule says what somebody needs before they may do a thing. A target says what teaching a module lets them practise. Sharing them would open the till to everyone taught the general induction."
    />

    <UAlert
      v-if="actionError"
      icon="i-lucide-circle-alert"
      color="error"
      variant="subtle"
      :description="actionError"
    />

    <UAlert
      v-if="!targets.length"
      icon="i-lucide-inbox"
      color="neutral"
      variant="subtle"
      title="No targets yet"
      description="Nothing opens a sandbox until one is created here, which is the safe default."
    />

    <div
      v-else
      class="border border-default rounded-lg divide-y divide-default overflow-hidden"
    >
      <div
        v-for="target in targets"
        :key="target.key"
        class="p-4 space-y-2"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2 flex-wrap">
            <code class="text-sm font-medium">{{ target.key }}</code>
            <span class="text-muted text-sm">{{ target.name }}</span>
            <UBadge
              v-if="target.status === 'RETIRED'"
              color="neutral"
              variant="subtle"
              size="sm"
              label="Retired"
            />
            <UBadge
              v-if="target.openWindows"
              color="success"
              variant="subtle"
              size="sm"
              :label="`${target.openWindows} open now`"
            />
          </div>
          <UButton
            label="Edit"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="edit(target)"
          />
        </div>
        <p class="text-xs text-muted">
          <span v-if="target.moduleIds.length">Opens when teaching {{ target.moduleIds.join(', ') }}</span>
          <span v-else>Names no modules, so it never opens</span>
          <span v-if="target.consumer"> · used by {{ target.consumer }}</span>
        </p>
      </div>
    </div>

    <section
      v-if="open.length"
      class="space-y-3"
    >
      <h2 class="font-semibold">
        Open right now
      </h2>
      <div class="border border-default rounded-lg divide-y divide-default overflow-hidden text-sm">
        <div
          v-for="window in open"
          :key="window.id"
          class="flex items-center justify-between gap-3 p-3"
        >
          <span>{{ window.userName }}</span>
          <code class="text-xs">{{ window.targetKey }}</code>
          <span class="text-xs text-muted">until {{ formatDateTime(window.expiresAt) }}</span>
        </div>
      </div>
    </section>

    <UModal
      :open="editing !== null"
      title="Practice target"
      @update:open="(value: boolean) => { if (!value) editing = null }"
    >
      <template #body>
        <div
          v-if="editing"
          class="space-y-4"
        >
          <UFormField
            label="Key"
            required
            help="The consumer app hardcodes this, so never rename one"
          >
            <UInput
              v-model="editing.key"
              placeholder="bar-till"
              :disabled="targets.some(target => target.key === editing?.key)"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Name"
            required
          >
            <UInput
              v-model="editing.name"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Modules that open it"
            help="Teaching any one of these opens the sandbox for that session's attendees"
          >
            <USelectMenu
              v-model="editing.moduleIds"
              :items="moduleOptions"
              value-key="value"
              multiple
              searchable
              class="w-full"
            />
          </UFormField>
          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField
              label="Consumer"
              help="For this list only"
            >
              <UInput
                v-model="editing.consumer"
                placeholder="proscenium"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Grace hours"
              help="Blank uses the site default"
            >
              <UInput
                v-model.number="editing.graceHours"
                type="number"
                :min="0"
                :max="48"
                class="w-full"
              />
            </UFormField>
          </div>
          <UFormField label="Status">
            <USelect
              v-model="editing.status"
              :items="[
                { label: 'Active', value: 'ACTIVE' },
                { label: 'Retired', value: 'RETIRED' },
              ]"
              value-key="value"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="Cancel"
            color="neutral"
            variant="ghost"
            @click="() => { editing = null }"
          />
          <UButton
            label="Save"
            :loading="busy"
            :disabled="!editing?.key || !editing?.name"
            @click="save"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
