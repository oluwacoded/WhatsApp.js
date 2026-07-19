FROM node:20-slim

RUN apt-get update && apt-get install -y \
    git \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --no-audit --no-fund

# Copy everything — client/dist is pre-built locally and committed to the repo
COPY . .

EXPOSE 8080

ENV PORT=8080

CMD ["node", "server.js"]
