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
      // Production only: localhost has no subdomains. name/password/maxAge repeat
      // the base values: env overrides must be complete SessionConfig objects.
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
        connection: { databaseId: '5c8fa8bf-74b3-4e56-bb01-5c34f45fc600' },
      },
      kv: false,
      blob: false,
    },
  },

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    // NUXT_SESSION_PASSWORD is consumed implicitly by nuxt-auth-utils. It is
    // the shared estate seal secret: same value as every other NNT app.
    session: {
      name: 'nnt-session',
      password: '',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    },
    // Worker secret NUXT_AUTH_SERVICE_TOKEN. The NUXT_ prefix is load-bearing:
    // a secret named AUTH_SERVICE_TOKEN is silently ignored.
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
    experimental: {
      tasks: true,
    },
    scheduledTasks: {
      // The task name comes from the FILE PATH, not `meta.name`. Get it wrong and
      // the cron fires into the void with no error anywhere.
      '0 6 * * *': ['expiry-sweep'],
      // Late morning, so a reminder for tomorrow lands in waking hours.
      '0 9 * * *': ['session-sweep'],
    },
    rollupConfig: {
      plugins: [
        // Resend imports @react-email/render, which doesn't bundle on Workers.
        // Same stub as Proscenium and stage-door.
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

        // ⚠️ Attaching the custom domain here IS the Phase 5 cutover: the next build
        // would repoint it. See docs/migration.md §4 before uncommenting.
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'training',
            database_id: '5c8fa8bf-74b3-4e56-bb01-5c34f45fc600',
          },
        ],
        // Estate secrets come from the Secrets Store (stage-door ADR-0016); the
        // binding name matters: read server/plugins/0.secrets-store.ts first.
        ...({
          secrets_store_secrets: [
            {
              binding: 'SESSION_PASSWORD',
              store_id: 'fdfe08b6b01f498fbddbc08c2891cadb',
              secret_name: 'NUXT_SESSION_PASSWORD',
            },
          ],
        } as object),
        observability: {
          logs: {
            enabled: true,
          },
        },
        // Every expression scheduledTasks uses needs a trigger here too, or
        // the task exists and never fires.
        triggers: {
          crons: ['0 6 * * *', '0 9 * * *'],
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
