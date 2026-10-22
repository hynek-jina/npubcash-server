FROM node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS base

FROM base AS deps

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json package-lock.json* ./
COPY npubcash-website/package.json npubcash-website/package-lock.json* ./npubcash-website/

RUN npm ci

FROM base AS builder
WORKDIR /app
ARG NPC_ADDRESS_DOMAIN
ENV NPC_ADDRESS_DOMAIN=$NPC_ADDRESS_DOMAIN
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/npubcash-website/node_modules ./npubcash-website/node_modules
COPY . .

RUN npm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 npc

COPY --from=builder --chown=npc:nodejs /app/dist ./dist
COPY --from=builder --chown=npc:nodejs /app/npubcash-website/dist ./npubcash-website/dist
COPY --from=builder --chown=npc:nodejs /app/migrations ./migrations
 
USER npc

EXPOSE 8000

ENV PORT 8000 


CMD node dist/index.js
