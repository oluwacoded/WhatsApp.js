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

# Install + build the React frontend
COPY client/package*.json ./client/
RUN cd client && npm install --no-audit --no-fund

COPY . .
RUN cd client && npm run build

EXPOSE 8080

ENV PORT=8080

CMD ["node", "server.js"]
