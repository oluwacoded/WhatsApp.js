FROM node:18-slim

# Install Chromium and browser dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
    --no-install-recommends

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Tell Puppeteer where Chromium is
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

CMD ["node", "server.js"]
