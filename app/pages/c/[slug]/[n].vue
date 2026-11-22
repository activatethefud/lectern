<template>
  <div class="player">
    <div class="bar wrap">
      <NuxtLinkLocale :to="`/c/${slug}`" class="back muted">← {{ t('nav.home') }}</NuxtLinkLocale>
      <span class="muted small">{{ t('player.progress', { n, total: slide?.slideCount ?? 0 }) }}</span>
      <div v-if="(slide?.langs?.length ?? 0) > 1" class="langs">
        <button
          v-for="l in slide!.langs"
          :key="l"
          class="lang"
          :class="{ on: slide!.deckLang === l }"
          :title="t('player.slideLang')"
          @click="setSlideLang(l)"
        >{{ langName(l) }}</button>
      </div>
    </div>

    <div v-if="error" class="wrap">
      <p class="muted">{{ t('course.notFound') }}</p>
    </div>

    <template v-else-if="slide">
      <figure class="stage">
        <img :src="slide.image" :alt="`${t('player.progress', { n, total: slide.slideCount })}`">
      </figure>

      <section class="panel">
        <div class="wrap panel-in">
          <template v-if="slide.question">
            <p class="q">{{ slide.question.q }}</p>
            <ul class="opts">
              <li v-for="(opt, i) in slide.question.options" :key="i">
                <button
                  class="opt"
                  :class="{ picked: answered === i }"
                  :aria-pressed="answered === i"
                  :disabled="slide.finished"
                  @click="pick(i)"
                >
                  <span class="key">{{ 'ABCD'[i] }}</span>
                  <span class="txt">{{ opt }}</span>
                </button>
              </li>
            </ul>
          </template>
          <p v-else class="muted no-q">—</p>

          <div class="nav">
            <span v-if="slide.finished" class="muted locked-note">{{ t('player.finishedNote') }}</span>
            <span v-else-if="answered !== null" class="muted locked-note">{{ t('player.answerEditable') }}</span>
            <NuxtLinkLocale v-if="slide.finished" :to="`/c/${slug}/report`" class="btn-primary btn">
              {{ t('report.title') }}
            </NuxtLinkLocale>
            <NuxtLinkLocale v-if="slide.prev" :to="`/c/${slug}/${slide.prev}`" class="ghost btn">
              {{ t('player.prev') }}
            </NuxtLinkLocale>
            <button
              v-if="!slide.finished"
              class="btn-primary btn"
              :disabled="slide.question !== null && answered === null"
              @click="next"
            >
              {{ slide.next ? t('player.next') : t('player.finish') }}
            </button>          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()

const slug = String(route.params.slug)
const n = Number(route.params.n)

// Which deck to show: the requested one, else the course's own language.
const slideLang = computed(() => (route.query.lang as string | undefined) ?? undefined)

const { data: slide, error, refresh } = await useFetch(`/api/c/${slug}/slide/${n}`, {
  query: { locale, lang: slideLang },
})

function langName(code: string): string {
  return ({ sr: 'SR', en: 'EN', 'zh-CN': '中文' } as Record<string, string>)[code] ?? code.toUpperCase()
}

async function setSlideLang(code: string) {
  await router.replace({ query: { ...route.query, lang: code } })
  await refresh()
}

const answered = ref<number | null>(slide.value?.answered ?? null)
watch(slide, (s) => { answered.value = s?.answered ?? null })

/** Answers may be changed as often as you like; the value at "finish" is what counts. */
async function pick(choice: number) {
  if (answered.value === choice) return
  answered.value = choice // optimistic; the server is the authority
  try {
    await $fetch(`/api/c/${slug}/answer`, { method: 'POST', body: { n, choice } })
  } catch {
    answered.value = null
    await refresh()
  }
}

function next() {
  if (!slide.value) return
  // The end of the deck is the report — not the cover page.
  router.push(slide.value.next ? `/c/${slug}/${slide.value.next}` : `/c/${slug}/report`)
}

// 1-4 pick, Enter advances — the whole course is doable from the keyboard.
function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement) return
  if (['1', '2', '3', '4'].includes(e.key)) pick(Number(e.key) - 1)
  if (e.key === 'Enter' && (answered.value !== null || slide.value?.question === null)) next()
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.player { min-height: calc(100vh - 3.25rem); display: flex; flex-direction: column; background: var(--bg); }
.bar { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 1.25rem; font-size: 0.85rem; }
.back { text-decoration: none; }
.small { font-size: 0.8rem; }
.langs { display: flex; gap: 0.25rem; }
.lang { padding: 0.15rem 0.45rem; font-size: 0.72rem; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: var(--muted); }
.lang.on { border-color: var(--accent); color: var(--accent); }
.stage { margin: 0; padding: 0 1.25rem; display: flex; justify-content: center; }
.stage img { max-width: min(100%, 1200px); width: 100%; height: auto; border: 1px solid var(--line); border-radius: 6px; background: #fff; }
.panel { border-top: 1px solid var(--line); background: var(--card); margin-top: 1rem; }
.panel-in { padding: 1rem 1.25rem 1.25rem; display: flex; flex-direction: column; gap: 0.7rem; }
.q { margin: 0; font-weight: 560; }
.opts { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; grid-template-columns: 1fr 1fr; }
@media (max-width: 46rem) { .opts { grid-template-columns: 1fr; } }
.opt { display: flex; gap: 0.6rem; align-items: baseline; width: 100%; text-align: left; padding: 0.55rem 0.7rem; }
.opt .key { font-weight: 700; color: var(--muted); font-size: 0.85rem; }
.opt.picked { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.nav { display: flex; align-items: center; gap: 0.5rem; justify-content: flex-end; }
.locked-note { font-size: 0.8rem; margin-right: auto; }
.btn { padding: 0.5rem 0.9rem; border-radius: var(--radius); text-decoration: none; }
.btn:disabled { opacity: 0.45; cursor: not-allowed; }
.no-q { margin: 0; }
</style>
