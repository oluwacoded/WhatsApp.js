const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');

const app = express();

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', (qr) => {
  console.log('QR:', qr);
});

client.on('ready', () => {
  console.log('Bot is ready!');
});

client.initialize();

app.get('/', (req, res) => {
  res.send('Bot running');
});

app.listen(3000, () => console.log('Server started'));