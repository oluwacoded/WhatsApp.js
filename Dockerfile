# Use the official Node.js 18 slim image
FROM node:18-slim

# Install system dependencies (including git and library for WhatsApp)
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

# Create and change to the app directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port the app runs on
EXPOSE 8080

# Start the application
CMD [ "node", "server.js" ]
