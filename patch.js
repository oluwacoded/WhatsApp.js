const fs = require('fs');
let code = fs.readFileSync('server.js', 'utf8');

const newCommands = `
          // ── .new — Show newly added features ──
          if (cmd === "new") {
            const newFeatures = \`🔥 *INSANE NEW FEATURES* 🔥\\n\\n💸 *.pay <amount>* — Generate a Flutterwave payment link to receive funds instantly!\\n\\n🪙 *.btc send <address> <amount>* — Send Bitcoin easily\\n🪙 *.btc receive* — Generate a BTC address to receive funds\\n\\n_These features are currently in beta/setup phase._\`;
            const partUpgraded = \`🆕 *NEW — UPGRADED*\\n_unlocked by latest WhatsApp lib upgrade_\\n\\n✏️ *EDIT MESSAGES*\\n.say <text> — bot sends a tracked message\\n.editlast <new text> — edit the bot's last reply (or .edit)\\n\\n📌 *CHAT PIN*\\n.pin — pin current chat to top\\n.unpin — unpin current chat\\n\\n📰 *CHANNELS / NEWSLETTERS*\\n.channel create <name>\\n.channel info <invite-link>\\n.channel follow <invite-link>\\n.channel post <channel-id> | <text>\\n\\n👁 *VIEW-ONCE OUTGOING*\\n.vvideo — reply to a video/image to RE-SEND it as view-once\\n\\n💚 *STATUS AUTO-REACT*\\n.statusreact <emoji> — auto-react to every status you receive\\n\\n📊 *POLL RESULTS*\\n.pollvotes — reply to a poll to see results\\n\`;
            
            await send(newFeatures + "\\n\\n" + partUpgraded);
            continue;
          }

          // ── .pay — Generate Flutterwave Payment Link ──
          if (cmd === "pay") {
            const amount = args[0];
            if (!amount || isNaN(amount)) {
              await send("usage: .pay <amount>\\nExample: .pay 5000");
              continue;
            }
            await send(\`🔗 Generating payment link for ₦\${amount} via Flutterwave...\\n(Note: Flutterwave API integration is pending owner's API Key configuration.)\`);
            continue;
          }

          // ── .btc — Crypto Transactions via bitcoinjs ──
          if (cmd === "btc") {
            const action = args[0];
            if (action === "send") {
              await send(\`🚀 Preparing to send BTC...\\n(Note: Requires hot wallet setup and bitcoinjs-lib integration!)\`);
            } else if (action === "receive") {
              await send(\`📥 Your BTC receiving address is being generated...\\n(Note: Requires HD wallet integration!)\`);
            } else {
              await send(\`usage: .btc send <address> <amount>\\n       .btc receive\`);
            }
            continue;
          }
`;

code = code.replace('// Unknown command — fall through to AI or error', newCommands + '\\n          // Unknown command — fall through to AI or error');
fs.writeFileSync('server.js', code);
