// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-11-01',
  devtools: { enabled: false },
  modules: ['@nuxtjs/i18n'],

  css: ['~/assets/css/main.css'],

  // Courses are self-contained folders under COURSE_ROOT; the server reads them at request time
  // so adding a course never needs a rebuild of the app.
  runtimeConfig: {
    courseRoot: process.env.COURSE_ROOT || './courses',
    dataDir: process.env.DATA_DIR || './data',
    passThreshold: 0.9,
    public: {
      siteName: 'slide-course',
    },
  },

  i18n: {
    defaultLocale: 'sr',
    strategy: 'prefix_except_default',
    locales: [
      { code: 'sr', language: 'sr-Latn', name: 'Srpski', file: 'sr.json' },
      { code: 'en', language: 'en', name: 'English', file: 'en.json' },
      { code: 'zh-CN', language: 'zh-CN', name: '简体中文', file: 'zh-CN.json' },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'sc_lang',
      redirectOn: 'root',
      fallbackLocale: 'sr',
    },
    // `/verify/<id>` must be locale-free: certificates printed in the past keep working.
    customRoutes: 'config',
    pages: {
      verify: false,
    },
  },

  nitro: {
    // One long-lived node process on a VPS/Docker: reads from disk, keeps SQLite open.
    preset: 'node-server',
  },

  typescript: {
    strict: true,
  },

  app: {
    head: {
      htmlAttrs: { lang: 'sr' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'color-scheme', content: 'light dark' },
      ],
      link: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
    },
  },
})
