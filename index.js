const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode-terminal');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

let lastQr = "";
let isReady = false;

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        handleSIGINT: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    }
});

client.on('qr', (qr) => {
    lastQr = qr;
    qrcode.generate(qr, {small: true});
});

client.on('ready', () => {
    isReady = true;
    lastQr = "";
    console.log('WhatsApp Client is ready!');
});

app.get('/', (req, res) => res.send('Bot is running'));

app.get('/status', (req, res) => {
    res.json({ connected: isReady, hasQr: lastQr !== "" });
});

app.get('/qr', (req, res) => {
    if (lastQr) res.json({ qr: lastQr });
    else res.json({ message: "No QR code available." });
});

app.post('/update-prompt', (req, res) => {
    console.log("New Prompt:", req.body.prompt);
    res.json({ success: true });
});

client.initialize();
app.listen(port, () => console.log(`Server on port ${port}`));
