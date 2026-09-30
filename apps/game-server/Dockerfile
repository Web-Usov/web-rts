FROM node:22-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.8.1 --activate

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm build

ENV NODE_ENV=production
ENV PORT=2567

EXPOSE 2567

CMD ["pnpm", "--filter", "@web-rts/game-server", "start"]
