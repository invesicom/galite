/* ===================================================================
 * robots.txt - 动态生成
 * - 放行官网与公开主页, 屏蔽 API 和管理员面板
 * - 固定营销页使用跨域 Canonical，不发布相互冲突的实例 Sitemap
 * =================================================================== */

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Content-Type', 'text/plain; charset=utf-8')

  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /projects',
    'Disallow: /integrations',
    'Disallow: /realtime',
    'Disallow: /*/projects',
    'Disallow: /*/integrations',
    'Disallow: /*/realtime',
    '',
  ].join('\n')
})
