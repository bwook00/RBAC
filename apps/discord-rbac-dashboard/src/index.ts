import { createAppContext, handleRequest } from "./http-api.js"

const context = await createAppContext()

Bun.serve({
  port: context.config.port,
  fetch: (request) => handleRequest(request, context),
})
