<template>
  <div class="wrap verify">
    <h1>{{ t('verify.title') }}</h1>

    <template v-if="result?.valid">
      <p class="ok-line">✓ {{ t('verify.valid') }}</p>
      <dl>
        <dt>{{ t('report.name') }}</dt>
        <dd>{{ result.name }}</dd>
        <dt>{{ t('cert.course') }}</dt>
        <dd>{{ result.courseTitle }}</dd>
        <dt>{{ t('cert.date') }}</dt>
        <dd>{{ formattedDate }}</dd>
        <dt>{{ t('cert.score') }}</dt>
        <dd>{{ result.score }} / {{ result.total }}</dd>
        <dt>{{ t('cert.id') }}</dt>
        <dd class="mono">{{ result.serial }}</dd>
        <dt>{{ t('verify.signature') }}</dt>
        <dd :class="result.signatureOk ? 'ok-line' : 'bad-line'">
          {{ result.signatureOk ? t('verify.signatureOk') : t('verify.signatureBad') }}
        </dd>
      </dl>
      <p v-if="result.revoked" class="bad-line">✗ {{ t('verify.revoked') }}</p>
      <p class="muted hint">{{ t('verify.holderHint') }}</p>
    </template>

    <p v-else-if="result" class="bad-line">✗ {{ t('verify.invalid') }}</p>
    <p v-else class="muted">{{ t('verify.loading') }}</p>

    <p class="back"><NuxtLinkLocale to="/">{{ t('nav.home') }}</NuxtLinkLocale></p>
  </div>
</template>

<script setup lang="ts">
const { t, locale } = useI18n()
const route = useRoute()
const id = String(route.params.id).replace(/\.pdf$/i, '').toUpperCase()

const { data } = await useFetch(`/api/verify/${id}`, {
  query: { locale },
  default: () => null,
})

const result = computed(() => data.value as {
  valid: boolean
  signatureOk?: boolean
  revoked?: boolean
  name?: string
  courseTitle?: string
  finishedAt?: string
  score?: number
  total?: number
  serial?: string
} | null)

const formattedDate = computed(() => {
  if (!result.value?.finishedAt) return ''
  try {
    return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' })
      .format(new Date(result.value.finishedAt))
  } catch {
    return result.value.finishedAt.slice(0, 16).replace('T', ' ')
  }
})
</script>

<style scoped>
.verify { padding: 2.5rem 1.25rem 4rem; max-width: 34rem; }
h1 { font-size: 1.4rem; margin: 0 0 1rem; }
.ok-line { color: var(--good); font-weight: 600; }
.bad-line { color: var(--bad); font-weight: 600; }
dl { display: grid; grid-template-columns: 9rem 1fr; gap: 0.45rem 1rem; margin: 1rem 0 1.5rem; font-size: 0.95rem; }
dt { color: var(--muted); }
dd { margin: 0; }
.mono { font-family: ui-monospace, monospace; }
.btn { display: inline-block; padding: 0.5rem 0.9rem; border-radius: var(--radius); text-decoration: none; }
.back { margin-top: 2rem; }
.hint { font-size: 0.85rem; }
</style>
