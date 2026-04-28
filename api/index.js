const { CosmosClient } = require("@azure/cosmos");

const ALLOWED = new Set([
  "mp_marches", "mp_aos", "mp_cautions", "mp_paiements",
  "mp_bordereau", "mp_avancements", "mp_indices", "mp_banques",
  "mp_avenants"
]);

// Partition key field par container
const PK_PATH = {
  "mp_marches":     "id",
  "mp_aos":         "id",
  "mp_cautions":    "marcheId",
  "mp_paiements":   "marcheId",
  "mp_bordereau":   "marcheId",
  "mp_avancements": "marcheId",
  "mp_indices":     "type",
  "mp_banques":     "id",
  "mp_avenants":    "marcheId"
};

let _db = null;
function getDb() {
  if (_db) return _db;
  _db = new CosmosClient(process.env.COSMOS_CONNECTION_STRING).database(process.env.COSMOS_DATABASE);
  return _db;
}

module.exports = async function (context, req) {
  const fn = context.executionContext.functionName;

  // Route ping
  if (fn === "ping") {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { ok: true, now: new Date().toISOString(), hasCosmos: !!process.env.COSMOS_CONNECTION_STRING }
    };
    return;
  }

  // Route data
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
      const pkField = PK_PATH[container];

      // GET list (avec query optionnelle)
      if (method === "GET" && !id) {
        // Support ?marcheId=xxx pour filtrer
        const marcheIdFilter = req.query.marcheId;
        const typeFilter = req.query.type;
        let query = "SELECT * FROM c";
        const params = [];
        if (marcheIdFilter && (container === "mp_cautions" || container === "mp_paiements" || container === "mp_bordereau" || container === "mp_avancements" || container === "mp_avenants")) {
          query = "SELECT * FROM c WHERE c.marcheId = @marcheId";
          params.push({ name: "@marcheId", value: marcheIdFilter });
        } else if (typeFilter && container === "mp_indices") {
          query = "SELECT * FROM c WHERE c.type = @type ORDER BY c.periode DESC";
          params.push({ name: "@type", value: typeFilter });
        }
        const iterator = params.length ? c.items.query({ query, parameters: params }) : c.items.readAll();
        const { resources } = await iterator.fetchAll();
        context.res = { status: 200, body: resources };
        return;
      }

      // GET single item (?pk=xxx optionnel)
      if (method === "GET" && id) {
        const pk = req.query.pk || id;
        try {
          const { resource } = await c.item(id, pk).read();
          context.res = { status: 200, body: resource };
        } catch (e) {
          context.res = { status: 404, body: { error: "Not found" } };
        }
        return;
      }

      // POST/PUT create/upsert
      if ((method === "POST" || method === "PUT") && req.body) {
        const item = req.body;
        if (!item.id) item.id = String(Date.now());
        if (!item[pkField]) {
          context.res = { status: 400, body: { error: "Missing partition key field '" + pkField + "' in body" } };
          return;
        }
        const { resource } = await c.items.upsert(item);
        context.res = { status: 200, body: resource };
        return;
      }

      // DELETE
      if (method === "DELETE" && id) {
        const pk = req.query.pk || id;
        await c.item(id, pk).delete();
        context.res = { status: 204 };
        return;
      }

      context.res = { status: 405, body: { error: "Method not allowed" } };
    } catch (e) {
      context.log.error("data error:", e.message, e.code);
      context.res = { status: 500, body: { error: e.message, code: e.code } };
    }
    return;
  }

  context.res = { status: 404, body: { error: "Unknown function" } };
};
