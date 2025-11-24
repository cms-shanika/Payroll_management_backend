# Build dependencies
FROM node:20 AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY src ./src

# Runtime
FROM node:20-alpine

WORKDIR /app

# Install runtime dependencies
COPY package*.json ./
RUN npm install --only=production

# Copy source code
COPY --from=build /app/src ./src

# Expose port consistent with docker-compose
EXPOSE 4000

# Run wait-for-mysql before starting server
CMD [ "node", "src/server.js"]
