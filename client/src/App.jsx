import { useEffect, useState } from "react";
import "./index.css";

const fallbackBots = [
  {
    id: "local",
    name: "Local bot",
    url: globalThis.location?.origin || "http://localhost:8888",
    status: "idle",
    notes: "Local preview target for the checked-in frontend.",
  },
];

export default function App() {
  const [bots, setBots] = useState([]);
  const [apiOnline, setApiOnline] = useState(true);
  const [message, setMessage] = useState("Syncing with backend");

  async function request(path, options) {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Request failed.");
    }

    if (response.status === 204) return null;
    return response.json();
  }

  async function loadBots() {
    try {
      const data = await request("/api/bots");
      setApiOnline(true);
      setBots(data.bots.length ? data.bots : fallbackBots);
      setMessage("Connected to Netlify backend");
    } catch {
      setApiOnline(false);
      setBots(JSON.parse(localStorage.getItem("mfg_control_bots") || "[]").length ? JSON.parse(localStorage.getItem("mfg_control_bots") || "[]") : fallbackBots);
      setMessage("Using local fallback");
    }
  }

  useEffect(() => {
    loadBots();
  }, []);

  async function saveBot(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    setMessage("Saving bot...");

    try {
      if (apiOnline) {
        const data = await request("/api/bots", { method: "POST", body: JSON.stringify(payload) });
        setBots((current) => [data.bot, ...current]);
      } else {
        const next = [{ id: crypto.randomUUID(), ...payload }, ...bots];
        setBots(next);
        localStorage.setItem("mfg_control_bots", JSON.stringify(next));
      }
      form.reset();
      setMessage("Bot saved");
    } catch (error) {
      setMessage(error.message);
    }
  }

  async function deleteBot(bot) {
    if (apiOnline) await request(`/api/bots/${bot.id}`, { method: "DELETE" });
    const next = bots.filter((item) => item.id !== bot.id);
    setBots(next);
    if (!apiOnline) localStorage.setItem("mfg_control_bots", JSON.stringify(next));
  }

  async function toggleStatus(bot) {
    const status = bot.status === "online" ? "maintenance" : bot.status === "maintenance" ? "idle" : "online";
    if (apiOnline) {
      const data = await request(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ ...bot, status }) });
      setBots((current) => current.map((item) => item.id === bot.id ? data.bot : item));
      return;
    }

    const next = bots.map((item) => item.id === bot.id ? { ...item, status } : item);
    setBots(next);
    localStorage.setItem("mfg_control_bots", JSON.stringify(next));
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Netlify frontend + backend</p>
          <h1>MFG Bot Control</h1>
          <p className="lede">Manage bot endpoints, track operating status, and keep deployment notes in one place.</p>
        </div>
        <div className="hero-panel">
          <span className="metric-label">Saved bots</span>
          <strong>{bots.length}</strong>
          <span>{message}</span>
        </div>
      </section>

      <section className="workspace">
        <form className="editor" onSubmit={saveBot}>
          <div className="section-heading">
            <span>Add backend target</span>
            <button type="submit">Save bot</button>
          </div>
          <label>Name<input name="name" placeholder="Primary WhatsApp bot" required /></label>
          <label>Endpoint URL<input name="url" type="url" placeholder="https://example.netlify.app" required /></label>
          <label>Status<select name="status"><option value="idle">Idle</option><option value="online">Online</option><option value="maintenance">Maintenance</option></select></label>
          <label>Notes<textarea name="notes" rows="4" placeholder="What this bot handles, deploy notes, or owner reminders" /></label>
        </form>

        <section className="list-panel">
          <div className="section-heading">
            <span>Backend records</span>
            <button type="button" onClick={loadBots}>Refresh</button>
          </div>
          <div className="bot-list">
            {bots.length === 0 ? <div className="empty">No bots saved yet. Add a backend target to start tracking it.</div> : bots.map((bot) => (
              <article className="bot-card" key={bot.id}>
                <div>
                  <span className={`pill ${bot.status}`}>{bot.status}</span>
                  <h2>{bot.name}</h2>
                  <a href={bot.url} target="_blank" rel="noreferrer">{bot.url}</a>
                  {bot.notes ? <p>{bot.notes}</p> : null}
                </div>
                <div className="actions">
                  <button className="secondary" type="button" onClick={() => toggleStatus(bot)}>Toggle</button>
                  <button className="secondary delete" type="button" onClick={() => deleteBot(bot)}>Delete</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
