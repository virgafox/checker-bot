FROM node:alpine

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

EXPOSE 3000
CMD [ "node", "index.js" ]
