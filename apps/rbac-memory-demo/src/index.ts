import { createAppContext, handleRequest } from "./http-api.js"

const context = createAppContext()

Bun.serve({
  port: 4321,
  fetch: (request) => handleRequest(request, context),
})
