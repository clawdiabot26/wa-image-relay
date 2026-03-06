FROM node:22-slim

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy application code
COPY server.mjs ./
COPY public/ ./public/

# Create auth and uploads directories
RUN mkdir -p auth /tmp/wa-relay-uploads

EXPOSE 8087

CMD ["node", "server.mjs"]
