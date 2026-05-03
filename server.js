const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode-terminal');

const app = express();
const port = process.env.PORT || 3000;
const host = '0.0.0.0'; // Essential for Railway to connect to the internet

// Enable CORS so your Netlify site can talk to Railway
app.use(cors());
app.use(express.json());

let lastQr = "";
let isReady = false;

// Initialize the WhatsApp Client
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        handleSIGINT: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ],
        // Points to the Chromium installed by your Dockerfile
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    }
});

// WhatsApp Events
client.on('qr', (qr) => {
    lastQr = qr;
    console.log('QR RECEIVED. Scan this in your dashboard.');
    qrcode.generate(qr, {small: true});
});

client.on('ready', () => {
    isReady = true;
    lastQr = "";
    console.log('WhatsApp Client is ready!');
});

client.on('disconnected', (reason) => {
    isReady = false;
    console.log('Client was logged out', reason);
    client.initialize();
});

// API Endpoints for your Website
app.get('/', (req, res) => {
    res.send('Bot is running');
});

app.get('/status', (req, res) => {
    res.json({ 
        connected: isReady,
        hasQr: lastQr !== "" 
    });
});

app.get('/qr', (req, res) => {
    if (lastQr) {
        res.json({ qr: lastQr });
    } else {
        res.json({ message: "No QR code available. Already logged in or initializing." });
    }
});

app.post('/update-prompt', (req, res) => {
    const { prompt } = req.body;
    console.log("New Personality System Prompt received:", prompt);
    res.json({ success: true, message: "Personality updated!" });
});

// Start the bot and the web server
client.initialize();

app.listen(port, host, () => {
    console.log(`Server is live and listening at http://${host}:${port}`);
});
