const defaults = [
  {
    id: "local",
    name: "Local bot",
    url: globalThis.location?.origin || "http://localhost:8888",
    status: "idle",
    notes: "Local preview target for the checked-in frontend.",
  },
];

const state = {
  bots: [],
  apiOnline: true,
};

const list = document.querySelector("#bot-list");
const count = document.querySelector("#bot-count");
const sync = document.querySelector("#sync-state");
const form = document.querySelector("#bot-form");
const message = document.querySelector("#form-message");

function setMessage(text, kind = "warn") {
  message.textContent = text;
  message.style.color = kind === "error" ? "var(--danger)" : "var(--warn)";
}

function localBots() {
  try {
    return JSON.parse(localStorage.getItem("mfg_control_bots") || "[]");
  } catch {
    return [];
  }
}

function saveLocalBots(bots) {
  localStorage.setItem("mfg_control_bots", JSON.stringify(bots));
}

function render() {
  count.textContent = state.bots.length;
  sync.textContent = state.apiOnline ? "Connected to Netlify backend" : "Using local fallback";

  if (!state.bots.length) {
    list.innerHTML = '<div class="empty">No bots saved yet. Add a backend target to start tracking it.</div>';
    return;
  }

  list.innerHTML = state.bots.map((bot) => `
    <article class="bot-card">
      <div>
        <span class="pill ${bot.status}">${bot.status}</span>
        <h2>${escapeHtml(bot.name)}</h2>
        <a href="${escapeAttr(bot.url)}" target="_blank" rel="noreferrer">${escapeHtml(bot.url)}</a>
        ${bot.notes ? `<p>${escapeHtml(bot.notes)}</p>` : ""}
      </div>
      <div class="actions">
        <button class="secondary" data-action="status" data-id="${escapeAttr(bot.id)}" type="button">Toggle</button>
        <button class="secondary delete" data-action="delete" data-id="${escapeAttr(bot.id)}" type="button">Delete</button>
      </div>
    </article>
  `).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

async function api(path, options) {
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
    const data = await api("/api/bots");
    state.apiOnline = true;
    state.bots = data.bots.length ? data.bots : localBots();
  } catch {
    state.apiOnline = false;
    state.bots = localBots();
    if (!state.bots.length) state.bots = defaults;
  }
  render();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = Object.fromEntries(new FormData(form).entries());
  setMessage("Saving bot...");

  try {
    if (state.apiOnline) {
      const data = await api("/api/bots", { method: "POST", body: JSON.stringify(payload) });
      state.bots = [data.bot, ...state.bots];
    } else {
      state.bots = [{ id: crypto.randomUUID(), ...payload }, ...state.bots];
      saveLocalBots(state.bots);
    }
    form.reset();
    setMessage("Bot saved.");
    render();
  } catch (error) {
    setMessage(error.message, "error");
  }
});

list.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const bot = state.bots.find((item) => item.id === button.dataset.id);
  if (!bot) return;

  if (button.dataset.action === "delete") {
    if (state.apiOnline) await api(`/api/bots/${bot.id}`, { method: "DELETE" });
    state.bots = state.bots.filter((item) => item.id !== bot.id);
  }

  if (button.dataset.action === "status") {
    const status = bot.status === "online" ? "maintenance" : bot.status === "maintenance" ? "idle" : "online";
    if (state.apiOnline) {
      const data = await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ ...bot, status }) });
      state.bots = state.bots.map((item) => item.id === bot.id ? data.bot : item);
    } else {
      state.bots = state.bots.map((item) => item.id === bot.id ? { ...item, status } : item);
    }
  }

  if (!state.apiOnline) saveLocalBots(state.bots);
  render();
});

document.querySelector("#refresh").addEventListener("click", loadBots);

loadBots();
