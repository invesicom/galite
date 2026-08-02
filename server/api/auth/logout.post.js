export default defineEventHandler((event) => {
  deleteCookie(event, 'ct_token', { path: '/' })
  return reqSuccess(null, 'logout success')
})
