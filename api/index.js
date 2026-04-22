const { CosmosClient } = require("@azure/cosmos");

const ALLOWED = new Set([
  "mp_marches", "mp_aos", "mp_cautions", "mp_paiements"
]);

let _db = null;
function getDb() {
  if (_db) return _db;
  const cs = process.env.COSMOS_CONNECTION_STRING;
  const dbName = process.env.COSMOS_DATABASE;
  _db = new CosmosClient(cs).database(dbName);
  return _db;
}

module.exports = async function (context, req) {
  const fn = context.executionContext.functionName;

  if (fn === "ping") {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { ok: true, now: new Date().toISOString(), hasCosmos: !!process.env.COSMOS_CONNECTION_STRING }
    };
    return;
  }

  if (fn === "data") {
    try {
      const container = context.bindingData.container;
      const id = context.bindingData.id;
      if (!ALLOWED.has(container)) {
        context.res = { status: 400, body: { error: "Container inconnu ou non autorise : " + container } };
        return;
      }
      const c = getDb().container(container);
      const method = (req.method || "GET").toUpperCase();

      if (method === "GET" && !id) {
        const { resources } = await c.items.readAll().fetchAll();
        context.res = { status: 200, body: resources };
        return;
      }
      if (method === "GET" && id) {
        try {
          const { resource } = await c.item(id, id).read();
          context.res = { status: 200, body: resource };
        } catch (e) {
          context.res = { status: 404, body: { error: "Not found" } };
        }
        return;
      }
      if ((method === "POST" || method === "PUT") && req.body) {
        const item = req.body;
        if (!item.id) item.id = String(Date.now());
        const { resource } = await c.items.upsert(item);
        context.res = { status: 200, body: resource };
        return;
      }
      if (method === "DELETE" && id) {
        await c.item(id, id).delete();
        context.res = { status: 204 };
        return;
      }

      context.res = { status: 405, body: { error: "Method not allowed" } };
    } catch (e) {
      context.log.error("data error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
    }
    return;
  }

  context.res = { status: 404, body: { error: "Unknown function" } };
};
