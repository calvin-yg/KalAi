# Build
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Run
FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# The log and photos live on a mounted volume, not in the image.
ENV KALAI_DATA_DIR=/data
# Entries are keyed by local calendar date; a UTC container would roll the day over mid-afternoon.
ENV TZ=Australia/Melbourne

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
