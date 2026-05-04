FROM node:18-slim

RUN apt-get update && apt-get install -y \
    git \
    ffmpeg \
    libnss3 \
    libatk-bridge2.0-0 \
    libxcomposite1 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Install root dependencies
COPY package*.json ./
RUN npm install

# Install and build the React frontend
COPY client/package*.json ./client/
RUN cd client && npm install
COPY client/ ./client/
RUN cd client && npm run build

# Copy the rest of the backend
COPY . .

EXPOSE 8080

ENV PORT=8080

CMD ["node", "server.js"]
