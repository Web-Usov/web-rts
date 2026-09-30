# Production-like game server. Build context is the repository root.
FROM node:22-bookworm-slim

WORKDIR /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0

RUN corepack enable

COPY . .

# packageManager in the root package.json selects the repository pnpm version.
RUN corepack install && pnpm install --frozen-lockfile

ENV TURBO_TELEMETRY_DISABLED=1

RUN pnpm exec turbo run build --filter=@web-rts/game-server

ENV NODE_ENV=production
ENV PORT=2567

EXPOSE 2567

HEALTHCHECK --interval=5s --timeout=5s --start-period=15s --retries=20 \
  CMD node -e "fetch('http://127.0.0.1:2567/health').then((response)=>process.exit(response.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "@web-rts/game-server", "start"]
