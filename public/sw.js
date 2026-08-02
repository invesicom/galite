/* ===========================================================
 * 自销毁 Service Worker
 * --
 * 用途: 清除曾在同 origin (localhost:8787 / 部署域名) 注册过的
 *        旧 SW. 触发场景:
 *          - 之前在同端口运行过带 SW 的应用，浏览器仍缓存旧注册，
 *            每次访问都会按
 *            "Service Worker 更新检查" 协议去 /sw.js 拉, 拿到 404
 *            就在服务端日志里刷 [404] /sw.js
 *          - 用户在 prod 域名手动 install 过 PWA 后我们决定不再用
 * --
 * 行为:
 *   install: 跳 waiting 立即激活
 *   activate: 清所有 caches → 自我 unregister → 命所有 client 重新
 *             加载 (摆脱当前 SW 控制, 之后不再触发 fetch /sw.js)
 * --
 * 这是"墓碑"文件, 不需要业务逻辑. 一旦旧 SW 被替换为这个并激活,
 * 用户下次刷新就彻底解绑, 文件之后即使返回 404 也无所谓 (浏览器
 * 已不再有注册).
 * =========================================================== */

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    /* 1. 清光所有 caches (旧 SW precache 的旧版资源) */
    try {
      const names = await caches.keys()
      await Promise.all(names.map((n) => caches.delete(n)))
    } catch {}

    /* 2. 自我注销 — 这个动作让浏览器记录 "此 scope 无 SW" */
    try {
      await self.registration.unregister()
    } catch {}

    /* 3. 让所有打开的窗口/标签页脱离 SW 控制 (强制 reload) */
    try {
      const clients = await self.clients.matchAll({ type: 'window' })
      clients.forEach((c) => {
        try { c.navigate(c.url) } catch {}
      })
    } catch {}
  })())
})
