import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './server/database/schema.js',
  out: './migrations',
  dialect: 'sqlite',
})
