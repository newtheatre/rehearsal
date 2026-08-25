<script lang="ts" setup>
/**
 * Create/edit a catalogue entry. The server is the authority on every rule
 * here: this form's job is to make the rules legible, not to enforce them.
 */

interface ModuleFormValue {
  id: string
  department: string
  kind: 'MODULE' | 'CERTIFICATION' | 'BRIEF'
  name: string
  // Empty is '', not null: an input cannot hold null, and save() maps '' back.
  description: string
  notes: string
  materialsUrl: string
  expiryMode: 'NONE' | 'MONTHS' | 'ACADEMIC_YEAR'
  expiryMonths: number | null
  safetyCritical: boolean
  allowsExternal: boolean
  externalEvidence: string
  grantsSupervisor: boolean
  grantsTrainer: boolean
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED'
  prerequisites: string[]
}

const props = defineProps<{
  /** Existing module id, or null to create. */
  moduleId: string | null
  departments: { code: string, name: string }[]
  allModules: { id: string, name: string }[]
}>()

const emit = defineEmits<{ saved: [] }>()

const open = defineModel<boolean>('open', { required: true })

const toast = useToast()
const saving = ref(false)
const error = ref<string | null>(null)

const state = ref<ModuleFormValue>(emptyModule())

function emptyModule(): ModuleFormValue {
  return {
    id: '',
    department: props.departments[0]?.code ?? '',
    kind: 'MODULE',
    name: '',
    description: '',
    notes: '',
    materialsUrl: '',
    expiryMode: 'NONE',
    expiryMonths: null,
    safetyCritical: false,
    allowsExternal: false,
    externalEvidence: '',
    grantsSupervisor: false,
    grantsTrainer: false,
    status: 'DRAFT',
    prerequisites: [],
  }
}

// Load the module being edited whenever the modal opens.
watch(open, async (isOpen) => {
  error.value = null
  if (!isOpen) return

  if (!props.moduleId) {
    state.value = emptyModule()
    return
  }

  const module = await $fetch(`/api/modules/${props.moduleId}`)
  state.value = {
    id: module.id,
    department: module.department,
    kind: module.kind,
    name: module.name,
    description: module.description ?? '',
    notes: module.notes ?? '',
    materialsUrl: module.materialsUrl ?? '',
    expiryMode: module.expiryMode,
    expiryMonths: module.expiryMonths,
    safetyCritical: module.safetyCritical,
    allowsExternal: module.allowsExternal,
    externalEvidence: module.externalEvidence ?? '',
    grantsSupervisor: module.grantsSupervisor,
    grantsTrainer: module.grantsTrainer,
    status: module.status,
    prerequisites: module.prerequisites.map(p => p.id),
  }
})

const isCertification = computed(() => state.value.kind === 'CERTIFICATION')
const isBrief = computed(() => state.value.kind === 'BRIEF')

/**
 * An ordinary module's id carries its department, so follow the prefix as it
 * is typed. Certifications are exempt: `LD-CERT` sits in TECH.
 */
watch(() => state.value.id, (id) => {
  if (props.moduleId) return // editing: the id is fixed
  const prefix = id.trim().toUpperCase().split('-')[0]
  if (!prefix || id.trim().toUpperCase().endsWith('-CERT')) return
  if (props.departments.some(d => d.code === prefix)) {
    state.value.department = prefix
  }
})

const prerequisiteOptions = computed(() =>
  props.allModules
    .filter(m => m.id !== state.value.id)
    .map(m => ({ label: `${m.id} · ${m.name}`, value: m.id })),
)

function cancel() {
  open.value = false
}

async function save() {
  saving.value = true
  error.value = null

  // Mirror the server's kind rules so the payload can't contradict itself.
  const payload = {
    department: state.value.department,
    kind: state.value.kind,
    name: state.value.name,
    description: state.value.description || null,
    notes: state.value.notes || null,
    materialsUrl: state.value.materialsUrl || null,
    expiryMode: isBrief.value ? 'NONE' : state.value.expiryMode,
    expiryMonths: !isBrief.value && state.value.expiryMode === 'MONTHS' ? state.value.expiryMonths : null,
    safetyCritical: state.value.safetyCritical,
    allowsExternal: !isBrief.value && state.value.allowsExternal,
    externalEvidence: state.value.externalEvidence?.trim() || null,
    grantsSupervisor: isCertification.value && state.value.grantsSupervisor,
    grantsTrainer: isCertification.value && state.value.grantsTrainer,
    status: state.value.status,
    prerequisites: state.value.prerequisites,
  }

  try {
    if (props.moduleId) {
      await $fetch(`/api/modules/${props.moduleId}`, { method: 'PUT', body: payload })
    }
    else {
      await $fetch('/api/modules', { method: 'POST', body: { ...payload, id: state.value.id } })
    }
    toast.add({
      title: props.moduleId ? 'Module updated' : 'Module created',
      icon: 'i-lucide-check',
      color: 'success',
    })
    open.value = false
    emit('saved')
  }
  catch (e) {
    const err = e as { statusMessage?: string, data?: { message?: string, statusMessage?: string } }
    error.value = err.data?.message || err.data?.statusMessage || err.statusMessage || 'Could not save the module'
  }
  finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="moduleId ? `Edit ${moduleId}` : 'New module'"
    :ui="{
      content: 'max-w-2xl',
      // The form is long: on a laptop viewport the body must scroll, or the
      // fields below the fold are simply unreachable.
      body: 'max-h-[65vh] overflow-y-auto',
    }"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="error"
          icon="i-lucide-circle-alert"
          color="error"
          variant="subtle"
          :description="error"
        />

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            label="Module ID"
            :help="moduleId ? 'Published identifier, cannot be changed' : 'e.g. TECH-111, or LD-CERT for a certification'"
            required
          >
            <UInput
              v-model="state.id"
              :disabled="Boolean(moduleId)"
              placeholder="TECH-111"
              class="w-full font-mono"
            />
          </UFormField>

          <UFormField
            label="Department"
            required
          >
            <USelect
              v-model="state.department"
              :items="departments.map(d => ({ label: `${d.code} · ${d.name}`, value: d.code }))"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField
          label="Name"
          required
        >
          <UInput
            v-model="state.name"
            placeholder="Lighting Rigging and Focusing"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Description"
          help="Shown to members in the catalogue"
        >
          <UTextarea
            v-model="state.description"
            :rows="3"
            class="w-full"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            label="Kind"
            :help="moduleId
              ? 'Certifications are signed off; briefs recur per event. Fixed once a record has been awarded'
              : 'Certifications are signed off; briefs recur per event'"
          >
            <USelect
              v-model="state.kind"
              :items="[
                { label: 'Module', value: 'MODULE' },
                { label: 'Certification', value: 'CERTIFICATION' },
                { label: 'Brief', value: 'BRIEF' },
              ]"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Status"
            help="Drafts are hidden from members"
          >
            <USelect
              v-model="state.status"
              :items="[
                { label: 'Draft', value: 'DRAFT' },
                { label: 'Active', value: 'ACTIVE' },
                { label: 'Retired', value: 'RETIRED' },
              ]"
              class="w-full"
            />
          </UFormField>
        </div>

        <div
          v-if="!isBrief"
          class="grid gap-4 sm:grid-cols-2"
        >
          <UFormField
            label="Expiry"
            help="Applies to future awards only"
          >
            <USelect
              v-model="state.expiryMode"
              :items="[
                { label: 'Never expires', value: 'NONE' },
                { label: 'Every academic year', value: 'ACADEMIC_YEAR' },
                { label: 'Every N months', value: 'MONTHS' },
              ]"
              class="w-full"
            />
          </UFormField>

          <UFormField
            v-if="state.expiryMode === 'MONTHS'"
            label="Months"
            required
          >
            <UInput
              v-model.number="state.expiryMonths"
              type="number"
              :min="1"
              :max="120"
              class="w-full"
            />
          </UFormField>
        </div>

        <UAlert
          v-else
          icon="i-lucide-megaphone"
          color="neutral"
          variant="subtle"
          description="Briefs never expire and never gate anything: attendance is recorded per event and shown as 'last received'."
        />

        <UFormField
          label="Prerequisites"
          :help="isCertification
            ? 'All must be currently valid before this certification can be signed off'
            : 'Trainers are warned about gaps, but are not blocked'"
        >
          <USelectMenu
            v-model="state.prerequisites"
            :items="prerequisiteOptions"
            value-key="value"
            multiple
            searchable
            placeholder="None"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Materials link"
          help="A Drive document, presentation or folder"
        >
          <UInput
            v-model="state.materialsUrl"
            placeholder="https://drive.google.com/..."
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Notes"
          help="Visible to department leads and admins only"
        >
          <UTextarea
            v-model="state.notes"
            :rows="2"
            class="w-full"
          />
        </UFormField>

        <div class="space-y-2 pt-2 border-t border-default">
          <UCheckbox
            v-model="state.safetyCritical"
            label="Safety critical"
            description="Unmet prerequisites block a session rather than warning"
          />
          <template v-if="!isBrief">
            <UCheckbox
              v-model="state.allowsExternal"
              label="Allow external certification"
              description="Training done elsewhere may be recorded against this module"
            />
            <UFormField
              v-if="state.allowsExternal"
              label="Accepted external evidence"
              description="Shown to the lead recording it, for example: FAW or EFAW certificate"
            >
              <UInput
                v-model="state.externalEvidence"
                placeholder="FAW or EFAW certificate"
                class="w-full"
              />
            </UFormField>
          </template>
          <template v-if="isCertification">
            <UCheckbox
              v-model="state.grantsSupervisor"
              label="Confers supervisor standing"
              description="Holders may supervise others in this department"
            />
            <UCheckbox
              v-model="state.grantsTrainer"
              label="Confers trainer standing"
              description="Holders may deliver training and log sessions"
            />
          </template>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2 w-full">
        <UButton
          label="Cancel"
          color="neutral"
          variant="ghost"
          @click="cancel"
        />
        <UButton
          :label="moduleId ? 'Save changes' : 'Create module'"
          :loading="saving"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
