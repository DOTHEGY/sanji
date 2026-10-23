# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
COPY local-worker/package.json local-worker/package-lock.json ./local-worker/
RUN --mount=type=secret,id=proxy_ca,required=false if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; cd local-worker && npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY local-worker/worker.cjs ./local-worker/worker.cjs
COPY server-worker/runner.cjs ./server-worker/runner.cjs
USER pwuser
CMD ["node","server-worker/runner.cjs"]
