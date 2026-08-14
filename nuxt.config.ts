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

        // ⚠️ The custom domain is intentionally NOT attached yet.
        //
        // `training.newtheatre.org.uk` still serves the legacy Heroku app.
        // Attaching it here IS the Phase 5 cutover: the next build would
        // repoint the domain the moment it finished, skipping the legacy
        // import, the smoke test and the two-week grace period that
        // docs/migration.md §4 exists to provide.
        //
        // Uncomment when cutting over, not before. The repo is `rehearsal`
        // and the domain stays `training` because that is what it already
        // means to members (ADR-0001) — same split as stage-door → auth.
        //
        // routes: [
        //   {
        //     pattern: 'training.newtheatre.org.uk',
        //     custom_domain: true,
        //   },
        // ],
        d1_databases: [
          {
            binding: 'DB',
            database_name: 'training',
            database_id: '5c8fa8bf-74b3-4e56-bb01-5c34f45fc600',
          },
        ],
        // Estate-wide secrets live in the account Secrets Store so a rotation
        // is one write rather than four worker secrets updated in lockstep
        // (docs/operations.md#secrets). server/plugins/secrets-store.ts turns
        // the binding into runtimeConfig.session.password — read its header
        // before adding another entry here, the binding name matters.
        //
        // Cast: `secrets_store_secrets` is valid wrangler config but missing
        // from the wrangler types Nitro 2.13 bundles. Drop it once Nitro
        // catches up.
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
