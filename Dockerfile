FROM node:alpine

# Chromium for checkers with FETCH_MODE=browser (puppeteer-core does not download a browser).
# tini reaps the Chromium helper processes and forwards signals to node (graceful shutdown).
# The fonts make text rendered by the browser (and its layout-dependent scripts) realistic.
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ttf-freefont \
      font-noto-emoji \
      ca-certificates \
      tini

# Create app directory
WORKDIR /usr/src/app

# Install production dependencies only (package-lock.json is required by npm ci)
COPY package*.json ./
RUN npm ci --omit=dev

# Bundle app source
COPY index.js ./
COPY src ./src

# Checker state is persisted here, so it survives restarts and image updates.
# Mount a volume on it, e.g.:
#   docker run -v checker-bot-data:/data --env-file .env -p 3000:3000 checker-bot
ENV STATE_FILE=/data/state.json
RUN mkdir -p /data
VOLUME /data

# The container runs as root, where the Chromium sandbox is not available: --no-sandbox
# is required. /dev/shm is only 64MB by default in Docker, hence --disable-dev-shm-usage.
ENV BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    BROWSER_ARGS="--no-sandbox --disable-dev-shm-usage --disable-gpu"
# Fail the build early if the Alpine package moves the binary.
RUN "$BROWSER_EXECUTABLE_PATH" --version

EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD [ "node", "index.js" ]
