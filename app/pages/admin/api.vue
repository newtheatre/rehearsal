<script lang="ts" setup>
definePageMeta({ title: 'API', middleware: 'admin' })

const toast = useToast()

const { data: tokens, refresh: refreshTokens } = await useFetch('/api/admin/service-tokens')
const { data: rules, refresh: refreshRules } = await useFetch('/api/admin/eligibility-rules')
const { data: catalogue } = await useFetch('/api/modules', { query: { status: 'all' } })

const moduleOptions = computed(() =>
  (catalogue.value?.modules ?? [])
    // Briefs never gate anything; the server refuses them in a rule too.
    .filter(m => m.kind !== 'BRIEF')
    .map(m => ({ label: `${m.id} · ${m.name}`, value: m.id })),
)

// ── Tokens ──────────────────────────────────────────────────────────────────

const tokenName = ref('')
const issuing = ref(false)
/** Shown exactly once — it is not stored anywhere we could show it again. */
const issuedToken = ref<{ name: string, token: string } | null>(null)

async function issueToken() {
  issuing.value = true
  try {
    const created = await $fetch('/api/admin/service-tokens', {
      method: 'POST',
      body: { name: tokenName.value },
    })
    issuedToken.value = { name: created.name, token: created.token }
    tokenName.value = ''
    await refreshTokens()
  }
  catch (e) {
    toast.add({ title: errorMessage(e, 'Could not issue a token'), icon: 'i-lucide-circle-alert', color: 'error' })
  }
  finally {
    issuing.value = false
  }
}

async function revokeToken(id: string, name: string) {
  try {
    await $fetch(`/api/admin/service-tokens/${id}`, { method: 'DELETE' })
    toast.add({ title: `Revoked ${name}`, icon: 'i-lucide-check', color: 'success' })
    await refreshTokens()
  }
  catch (e) {
    toast.add({ title: errorMessage(e, 'Could not revoke'), icon: 'i-lucide-circle-alert', color: 'error' })
  }
}

// ── Rules ───────────────────────────────────────────────────────────────────

const ruleOpen = ref(false)
const ruleSaving = ref(false)
const ruleError = ref<string | null>(null)
const editingKey = ref<string | null>(null)
const rule = ref({ key: '', name: '', description: '', allOf: [] as string[], anyOf: [] as string[] })

function newRule() {
  editingKey.value = null
  rule.value = { key: '', name: '', description: '', allOf: [], anyOf: [] }
  ruleError.value = null
  ruleOpen.value = true
}

function editRule(existing: { key: string, name: string, description: string | null, requires: { allOf: string[], anyOf: string[] } | null }) {
  editingKey.value = existing.key
  rule.value = {
    key: existing.key,
    name: existing.name,
    description: existing.description ?? '',
    allOf: [...existing.requires?.allOf ?? []],
    anyOf: [...existing.requires?.anyOf ?? []],
  }
  ruleError.value = null
  ruleOpen.value = true
}

async function saveRule() {
  ruleSaving.value = true
  ruleError.value = null
  try {
    await $fetch('/api/admin/eligibility-rules', {
      method: 'PUT',
      body: {
        key: rule.value.key,
        name: rule.value.name,
        description: rule.value.description || null,
        requires: { allOf: rule.value.allOf, anyOf: rule.value.anyOf },
      },
    })
    toast.add({ title: 'Rule saved', icon: 'i-lucide-check', color: 'success' })
    ruleOpen.value = false
    await refreshRules()
  }
  catch (e) {
    ruleError.value = errorMessage(e, 'Could not save the rule')
  }
  finally {
    ruleSaving.value = false
  }
}

function lastUsed(value: string | Date | null) {
  return value ? formatDateTime(value) : 'never'
}
</script>

<template>
  <div class="space-y-8 max-w-4xl">
    <div>
      <h1 class="text-2xl font-bold">
        API
      </h1>
      <p class="text-muted mt-1">
        What other estate apps may ask about training, and who may ask it.
      </p>
    </div>

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Eligibility rules
        </h2>
      </template>

      <p class="text-sm text-muted mb-4">
        A rule is a named question — "is this person duty-manager eligible?". This system
        answers it; the consuming app decides what the answer means. Changing a rule takes
        effect within five minutes with no deploy anywhere, so tell the consuming app's
        owner when you do.
      </p>

      <div
        v-if="rules?.rules.length"
        class="border border-default rounded-lg divide-y divide-default"
      >
        <div
          v-for="entry in rules.rules"
          :key="entry.key"
          class="flex items-start justify-between gap-4 p-3"
        >
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <code class="text-xs font-mono">{{ entry.key }}</code>
              <span class="font-medium">{{ entry.name }}</span>
            </div>
            <p
              v-if="entry.requires"
              class="text-xs text-muted mt-1"
            >
              Needs all of: {{ entry.requires.allOf.join(', ') || '—' }}
              <span v-if="entry.requires.anyOf.length">
                · and any of: {{ entry.requires.anyOf.join(', ') }}
              </span>
            </p>
            <p
              v-else
              class="text-xs text-error mt-1"
            >
              Unreadable: this rule is stored in a form nothing can parse, so the API refuses to answer it. Edit it to repair it.
            </p>
          </div>
          <UButton
            icon="i-lucide-pencil"
            variant="ghost"
            color="neutral"
            size="xs"
            aria-label="Edit rule"
            @click="editRule(entry)"
          />
        </div>
      </div>
      <p
        v-else
        class="text-sm text-muted"
      >
        No rules yet.
      </p>

      <template #footer>
        <UButton
          icon="i-lucide-plus"
          label="New rule"
          size="sm"
          @click="newRule"
        />
      </template>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Consumer tokens
        </h2>
      </template>

      <UAlert
        v-if="issuedToken"
        icon="i-lucide-key-round"
        color="warning"
        variant="subtle"
        class="mb-4"
        :title="`Token for ${issuedToken.name} — copy it now`"
      >
        <template #description>
          <p class="mb-2">
            This is the only time it can be shown. Put it in the committee password manager
            and the consumer's worker secret.
          </p>
          <code class="block text-xs font-mono break-all bg-elevated p-2 rounded">{{ issuedToken.token }}</code>
        </template>
      </UAlert>

      <div
        v-if="tokens?.tokens.length"
        class="border border-default rounded-lg divide-y divide-default text-sm"
      >
        <div
          v-for="token in tokens.tokens"
          :key="token.id"
          class="flex items-center justify-between gap-3 p-3"
        >
          <div>
            <code class="font-mono">{{ token.name }}</code>
            <p class="text-xs text-muted mt-0.5">
              issued {{ formatDateTime(token.createdAt) }} · last used {{ lastUsed(token.lastUsedAt) }}
            </p>
          </div>
          <UButton
            icon="i-lucide-trash-2"
            variant="ghost"
            color="error"
            size="xs"
            aria-label="Revoke token"
            @click="revokeToken(token.id, token.name)"
          />
        </div>
      </div>
      <p
        v-else
        class="text-sm text-muted"
      >
        No tokens issued.
      </p>

      <template #footer>
        <div class="flex items-end gap-2">
          <UFormField
            label="Consumer app"
            help="Lowercase, hyphenated — name it after the app that will call"
            class="flex-1"
          >
            <UInput
              v-model="tokenName"
              placeholder="proscenium-rota"
              class="w-full"
            />
          </UFormField>
          <UButton
            label="Issue token"
            :loading="issuing"
            :disabled="tokenName.trim().length < 2"
            @click="issueToken"
          />
        </div>
      </template>
    </UCard>

    <UModal
      v-model:open="ruleOpen"
      :title="editingKey ? `Edit ${editingKey}` : 'New eligibility rule'"
      :ui="{ body: 'max-h-[65vh] overflow-y-auto' }"
    >
      <template #body>
        <div class="space-y-4">
          <UAlert
            v-if="ruleError"
            icon="i-lucide-circle-alert"
            color="error"
            variant="subtle"
            :description="ruleError"
          />

          <UFormField
            label="Key"
            :help="editingKey ? 'Consumers hardcode this — it is never renamed' : 'Consumers will hardcode this, so choose carefully'"
            required
          >
            <UInput
              v-model="rule.key"
              :disabled="Boolean(editingKey)"
              placeholder="duty-manager"
              class="w-full font-mono"
            />
          </UFormField>

          <UFormField
            label="Name"
            required
          >
            <UInput
              v-model="rule.name"
              placeholder="Duty manager"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Description"
            help="What this rule is for, so the next ITM knows before changing it"
          >
            <UTextarea
              v-model="rule.description"
              :rows="2"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="Requires all of"
            help="Every one of these must be currently valid"
          >
            <USelectMenu
              v-model="rule.allOf"
              :items="moduleOptions"
              value-key="value"
              multiple
              searchable
              placeholder="Choose modules"
              class="w-full"
            />
          </UFormField>

          <UFormField
            label="And any one of"
            help="Optional. Leave empty unless the rule genuinely offers a choice."
          >
            <USelectMenu
              v-model="rule.anyOf"
              :items="moduleOptions"
              value-key="value"
              multiple
              searchable
              placeholder="None"
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
            @click="() => { ruleOpen = false }"
          />
          <UButton
            label="Save rule"
            :loading="ruleSaving"
            :disabled="!rule.key || !rule.name || rule.allOf.length + rule.anyOf.length === 0"
            @click="saveRule"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>
