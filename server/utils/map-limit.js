/* ===================================================================
 *  mapLimit - 小型并发池: items 以最多 limit 个并发 worker 处理
 *  --
 *  Cloudflare Worker 单 invocation 同时打开的出站连接上限是 6, 用显式控流
 *  的并发池替代 unbounded Promise.all — 站点(数据源)数量很多时也不会一次性
 *  打爆连接, 即"分批拉取, 但全部拉完". overview / realtime 全站点聚合共用.
 * =================================================================== */
export async function mapLimit(items, limit, worker) {
  const queue = Array.isArray(items) ? items : []
  const size = Math.max(1, Math.min(Number(limit) || 1, queue.length || 1))
  const results = new Array(queue.length)
  let index = 0

  await Promise.all(Array.from({ length: size }, async () => {
    while (index < queue.length) {
      const current = index++
      results[current] = await worker(queue[current], current)
    }
  }))
  return results
}
