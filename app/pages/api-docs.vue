<template>
  <!-- ============================================================
       /api-docs — 极简开放 API 文档
       --
       左侧页内目录, 右侧文档正文; 文案统一走 i18n locale
       ============================================================ -->
  <div class="bg-white">
    <section class="border-b border-gray-100">
      <div class="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 sm:py-20 md:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)] lg:gap-14">
        <div>
          <p class="text-sm font-medium text-primary">{{ copy.eyebrow }}</p>
          <h1 class="mt-4 text-3xl font-semibold tracking-tight text-gray-900 sm:text-5xl">
            {{ copy.title }}
          </h1>
          <p class="mt-5 max-w-2xl text-base leading-relaxed text-gray-700 sm:text-lg">
            {{ copy.subtitle }}
          </p>
        </div>

        <img
          src="/images/landing/api-docs-hero.webp"
          alt=""
          class="hidden w-full max-w-xl justify-self-end rounded-lg border border-gray-200 object-contain shadow-sm md:block"
          decoding="async"
          fetchpriority="high"
        >
      </div>
    </section>

    <section>
      <div class="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-14">
        <aside class="hidden lg:block">
          <nav class="sticky top-24 space-y-1 text-sm">
            <a
              v-for="section in sections"
              :key="section.id"
              :href="`#${section.id}`"
              class="block border-l border-gray-200 px-4 py-2 text-gray-500 transition-colors hover:border-primary hover:text-gray-900"
            >
              {{ section.title }}
            </a>
          </nav>
        </aside>

        <article class="min-w-0 divide-y divide-gray-100">
          <section
            v-for="section in sections"
            :id="section.id"
            :key="section.id"
            class="scroll-mt-24 py-10 first:pt-0"
          >
            <h2 class="text-2xl font-semibold tracking-tight text-gray-900">
              {{ section.title }}
            </h2>
            <div class="mt-5 space-y-4 text-base leading-relaxed text-gray-700">
              <p v-for="paragraph in section.paragraphs" :key="paragraph">
                {{ paragraph }}
              </p>
            </div>

            <ul v-if="section.items?.length" class="mt-6 space-y-3">
              <li
                v-for="item in section.items"
                :key="item"
                class="flex gap-3 text-sm leading-relaxed text-gray-700 sm:text-base"
              >
                <NuxtIcon name="ri:check-line" class="mt-0.5 size-5 shrink-0 text-primary" />
                <span>{{ item }}</span>
              </li>
            </ul>

            <div v-if="section.blocks?.length" class="mt-7 space-y-5">
              <div v-for="block in section.blocks" :key="block.title">
                <p class="mb-2 text-sm font-medium text-gray-900">{{ block.title }}</p>
                <pre class="overflow-x-auto rounded-lg border border-gray-200 bg-gray-950 p-4 text-sm leading-6 text-gray-100"><code>{{ block.code }}</code></pre>
              </div>
            </div>
          </section>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup>
definePageMeta({ layout: 'landing' })

const { t } = useI18n()
const { publicOrigin } = useSiteConfig()

const apiBase = computed(() => `${publicOrigin.value}/api/v1`)
const mcpEndpoint = computed(() => `${publicOrigin.value}/api/mcp`)

const tr = key => t(`api_docs.${key}`)

const copy = computed(() => ({
  metaTitle: tr('meta.title'),
  metaDescription: tr('meta.description'),
  eyebrow: tr('eyebrow'),
  title: tr('title'),
  subtitle: tr('subtitle'),
}))

const labels = computed(() => ({
  base: tr('labels.base'),
  header: tr('labels.header'),
  projects: tr('labels.projects'),
  summary: tr('labels.summary'),
  search: tr('labels.search'),
  funnels: tr('labels.funnels'),
  raw: tr('labels.raw'),
  mcp: tr('labels.mcp'),
}))

const sectionText = key => ({
  title: tr(`sections.${key}.title`),
  paragraphs: [tr(`sections.${key}.p1`)],
})

const sections = computed(() => {
  const l = labels.value
  return [
    {
      id: 'quick-start',
      ...sectionText('start'),
      items: [
        tr('sections.start.items.0'),
        tr('sections.start.items.1'),
        tr('sections.start.items.2'),
      ],
      blocks: [
        { title: l.base, code: apiBase.value },
        { title: l.header, code: 'Authorization: Bearer sk_live_xxxxxxxxxxxxx' },
      ],
    },
    {
      id: 'authentication',
      ...sectionText('auth'),
      blocks: [
        {
          title: l.header,
          code: `curl ${apiBase.value}/projects/list \\
  -H "Authorization: Bearer sk_live_xxxxxxxxxxxxx"`,
        },
      ],
    },
    {
      id: 'projects',
      ...sectionText('projects'),
      blocks: [
        { title: l.projects, code: `GET ${apiBase.value}/projects/list\nGET ${apiBase.value}/projects/{projectKey}` },
      ],
    },
    {
      id: 'site-metrics',
      ...sectionText('metrics'),
      blocks: [
        {
          title: l.summary,
          code: [
            `GET ${apiBase.value}/metrics/{projectKey}/summary?period=28days`,
            `GET ${apiBase.value}/metrics/{projectKey}/timeseries?period=28days&metric=screenPageViews`,
            `GET ${apiBase.value}/metrics/{projectKey}/dimension?dimension=country&period=28days`,
            `GET ${apiBase.value}/metrics/{projectKey}/realtime`,
          ].join('\n'),
        },
      ],
    },
    {
      id: 'search-data',
      ...sectionText('search'),
      blocks: [
        {
          title: l.search,
          code: [
            `GET ${apiBase.value}/metrics/{projectKey}/search/summary?period=28days&sp=all`,
            `GET ${apiBase.value}/metrics/{projectKey}/search/timeseries?period=28days&sp=gsc`,
            `GET ${apiBase.value}/metrics/{projectKey}/search/dimension?dimension=query&period=28days&sp=bing`,
          ].join('\n'),
        },
      ],
    },
    {
      id: 'funnels',
      ...sectionText('funnels'),
      blocks: [
        {
          title: l.funnels,
          code: [
            `GET ${apiBase.value}/projects/{projectKey}/funnels/list`,
            `GET ${apiBase.value}/funnels/{funnelKey}/results?period=28days`,
          ].join('\n'),
        },
      ],
    },
    {
      id: 'raw-provider-proxy',
      ...sectionText('raw'),
      blocks: [
        {
          title: l.raw,
          code: `POST ${apiBase.value}/raw/ga4/proxy\n\n{\n  "project_key": "PROJECT_KEY",\n  "path": "properties/PROPERTY_ID:runReport",\n  "body": {\n    "dateRanges": [{ "startDate": "28daysAgo", "endDate": "today" }],\n    "metrics": [{ "name": "screenPageViews" }]\n  }\n}`,
        },
      ],
    },
    {
      id: 'mcp-endpoint',
      ...sectionText('mcp'),
      blocks: [
        { title: l.mcp, code: `POST ${mcpEndpoint.value}` },
      ],
    },
  ]
})

useHead({
  title: () => copy.value.metaTitle,
  meta: [
    { name: 'description', content: copy.value.metaDescription },
  ],
})
</script>
