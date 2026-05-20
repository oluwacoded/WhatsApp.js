import type { Config } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import { getDatabase } from "@netlify/database";

type BotInput = {
  name?: string;
  url?: string;
  status?: string;
  notes?: string;
};

const json = (body: unknown, init?: ResponseInit) => Response.json(body, init);

function cleanText(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function isAllowedStatus(status: string) {
  return ["idle", "online", "maintenance"].includes(status);
}

function validateBot(input: BotInput, partial = false) {
  const name = cleanText(input.name, 80);
  const url = cleanText(input.url, 500);
  const status = cleanText(input.status || "idle", 40) || "idle";
  const notes = input.notes === undefined ? undefined : cleanText(input.notes, 500);

  if (!partial || input.name !== undefined) {
    if (!name) return { error: "Bot name is required." };
  }

  if (!partial || input.url !== undefined) {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Bad protocol");
    } catch {
      return { error: "Bot URL must be a valid http or https URL." };
    }
  }

  if (input.status !== undefined && !isAllowedStatus(status)) {
    return { error: "Status must be idle, online, or maintenance." };
  }

  return { value: { name, url, status, notes } };
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const id = url.pathname.split("/").filter(Boolean)[2];
  const db = getDatabase();

  try {
    if (req.method === "GET") {
      const bots = await db.sql`
        SELECT id, name, url, status, notes, created_at, updated_at
        FROM bots
        ORDER BY created_at DESC
      `;
      return json({ bots });
    }

    if (req.method === "POST" && !id) {
      const parsed = validateBot(await req.json());
      if ("error" in parsed) return json({ error: parsed.error }, { status: 400 });

      const botId = randomUUID();
      const { name, url, status, notes } = parsed.value;
      const [bot] = await db.sql`
        INSERT INTO bots (id, name, url, status, notes)
        VALUES (${botId}, ${name}, ${url}, ${status}, ${notes})
        RETURNING id, name, url, status, notes, created_at, updated_at
      `;
      return json({ bot }, { status: 201 });
    }

    if (req.method === "PATCH" && id) {
      const parsed = validateBot(await req.json(), true);
      if ("error" in parsed) return json({ error: parsed.error }, { status: 400 });

      const currentRows = await db.sql`SELECT * FROM bots WHERE id = ${id} LIMIT 1`;
      const current = currentRows[0];
      if (!current) return json({ error: "Bot not found." }, { status: 404 });

      const next = {
        name: parsed.value.name || current.name,
        url: parsed.value.url || current.url,
        status: parsed.value.status || current.status,
        notes: parsed.value.notes,
      };

      const [bot] = await db.sql`
        UPDATE bots
        SET name = ${next.name},
            url = ${next.url},
            status = ${next.status},
        notes = ${next.notes ?? current.notes},
            updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, name, url, status, notes, created_at, updated_at
      `;
      return json({ bot });
    }

    if (req.method === "DELETE" && id) {
      await db.sql`DELETE FROM bots WHERE id = ${id}`;
      return new Response(null, { status: 204 });
    }

    return json({ error: "Method not allowed." }, { status: 405 });
  } catch (error) {
    console.error("Bots API failed", error);
    return json({ error: "The bots service is temporarily unavailable." }, { status: 500 });
  }
};

export const config: Config = {
  path: ["/api/bots", "/api/bots/:id"],
};
