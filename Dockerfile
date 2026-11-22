# syntax=docker/dockerfile:1

# Lectern — production image is plain Node: slides are pre-baked to jpg and committed,
# so LibreOffice and poppler are only needed by the `bake` stage (authoring machine / CI).

########## base ##########
FROM node:22-bookworm-slim AS base
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NITRO_PORT=3000 \
    NITRO_HOST=0.0.0.0
WORKDIR /app

########## deps ##########
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

########## build ##########
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

########## runtime ##########
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    NITRO_PORT=3000 \
    NITRO_HOST=0.0.0.0 \
    NUXT_COURSE_ROOT=/app/courses \
    NUXT_DATA_DIR=/data
WORKDIR /app

COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=build --chown=node:node /app/courses ./courses
COPY --from=build --chown=node:node /app/server/assets ./server/assets

RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.NITRO_PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", ".output/server/index.mjs"]

########## bake (tools profile, never shipped) ##########
FROM node:22-bookworm AS bake
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libreoffice-impress poppler-utils \
      fonts-noto-core fonts-noto-cjk fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
COPY package.json ./
COPY scripts ./scripts
COPY courses ./courses
# `npm run bake` only touches node stdlib + soffice/pdftoppm: no node_modules needed.
CMD ["node", "scripts/bake-courses.mjs"]
