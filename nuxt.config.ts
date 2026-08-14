// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({

  modules: [
    '@nuxt/ui',
    '@nuxt/eslint',
    '@nuxthub/core',
    'nuxt-auth-utils',
  ],

  $production: {
    runtimeConfig: {
      // Estate SSO: this app READS the nnt-session cookie sealed by
      // auth.newtheatre.org.uk and never writes it (stage-door
      // docs/session-contract.md). The cookie domain is production-only —
      // localhost has no subdomains, and a domain'd cookie breaks dev.
      // name/password/maxAge repeat the base values: env overrides must be
      // complete SessionConfig objects, they don't deep-merge in types.
      session: {
        name: 'nnt-session',
        password: '',
        maxAge: 60 * 60 * 24 * 30,
        cookie: { domain: '.newtheatre.org.uk', sameSite: 'lax', secure: true },
      },
      public: {
        baseURL: 'https://training.newtheatre.org.uk',
      },
    },

    hub: {
      db: {
        dialect: 'sqlite',
        driver: 'd1', // FIXME: https://github.com/nuxt-hub/core/pull/775 (same as Proscenium/stage-door)
        connection: { databaseId: 'REPLACE_WITH_D1_DATABASE_ID' },
      },
      kv: false,
      blob: false,
    },
  },

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    // NUXT_SESSION_PASSWORD is consumed implicitly by nuxt-auth-utils. It is
    // the shared estate seal secret — same value as every other NNT app.
    session: {
      name: 'nnt-session',
      password: '',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    },
    // Server-to-server calls to the auth service (shadow users, Phase 2) and
    // the inbound GDPR hook bearer. Worker secret AUTH_SERVICE_TOKEN.
    authServiceToken: '',
    resendApiKey: '',
    resendFromEmail: 'training@newtheatre.org.uk',
    public: {
      baseURL: 'http://localhost:3000',
      // The hosted auth service (login / account / refresh). Dev: /dev-login.
      authBaseURL: 'https://auth.newtheatre.org.uk',
    },
  },

  compatibilityDate: '2025-07-15',

  nitro: {
    preset: 'cloudflare_module',
    rollupConfig: {
      plugins: [
        // Resend imports @react-email/render, which doesn't bundle on Workers.
        // Same stub workaround as Proscenium and stage-door. In place from the
        // start so the Phase 3 notification work doesn't rediscover it.
        {
          name: 'stub-react-email',
          resolveId(id: string) {
            if (id === '@react-email/render') return id
          },
          load(id: string) {
            if (id === '@react-email/render') return 'export {}'
          },
        },
      ],
    },
    cloudflare: {
      deployConfig: true,
      nodeCompat: true,
      wrangler: {
        name: 'rehearsal',
        routes: [
          {
            // The repo is `rehearsal`; the domain stays `training` because
            // that is what it already means to members (ADR-0001) — same
            // split as stage-door → auth.newtheatre.org.uk.
            pattern: 'training.newtheatre.org.uk',
            custom_domain: true,
          },
        ],
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'training',
            database_id: 'REPLACE_WITH_D1_DATABASE_ID',
          },
        ],
        observability: {
          logs: {
            enabled: true,
          },
        },
      },
    },
  },

  hub: {
    db: 'sqlite',
    kv: false,
    cache: false,
    blob: false,
  },

  eslint: {
    config: {
      stylistic: true,
    },
  },
})
