// ═══════════════════════════════════════════════════════════════════════════
// Neurones MP — Function CRUD /api/data/{container}/{id?}
// ═══════════════════════════════════════════════════════════════════════════
// Route sécurisée : seuls les containers mp_* sont accessibles depuis cette SWA.
// Si on veut lire rh_* ou gc_* plus tard, on l'ajoute à ALLOWED_CONTAINERS.

const {
  cors,
  respond,
  handleError,
  readAll,
  readOne,
  upsert,
  remove,
  generateId,
} = require("../_shared/cosmos");

const ALLOWED_CONTAINERS = new Set([
  "mp_marches",
  "mp_aos",
  "mp_cautions",
  "mp_paiements",
  // Futurs : ouvrir plus tard pour intégration GC
  // "rh_employes",
  // "gc_chantiers",
]);

module.exports = async function (context, req) {
  if (cors(context, req)) return;

  const container = context.bindingData.container;
  const id = context.bindingData.id;
  const pk = req.query.pk;

  if (!ALLOWED_CONTAINERS.has(container)) {
    return respond(context, 400, { error: "Container inconnu ou non autorisé : " + container });
  }

  try {
    switch (req.method) {
      case "GET":
        if (id) {
          if (!pk) {
            return respond(context, 400, { error: "Parametre 'pk' requis" });
          }
          const item = await readOne(container, id, pk);
          return respond(context, 200, item);
        } else {
          const options = {};
          if (req.query.filter) options.filter = req.query.filter;
          const items = await readAll(container, options);
          const limit = parseInt(req.query.limit, 10);
          return respond(context, 200, limit > 0 ? items.slice(0, limit) : items);
        }

      case "POST": {
        const body = req.body;
        if (!body || typeof body !== "object") {
          return respond(context, 400, { error: "Body JSON requis" });
        }
        if (!body.id) body.id = generateId(container.split("_")[1] || "doc");
        body.createdAt = body.createdAt || new Date().toISOString();
        body.updatedAt = new Date().toISOString();
        const created = await upsert(container, body);
        return respond(context, 201, created);
      }

      case "PUT": {
        if (!id) return respond(context, 400, { error: "ID requis" });
        const body = req.body;
        if (!body || typeof body !== "object") {
          return respond(context, 400, { error: "Body JSON requis" });
        }
        body.id = id;
        body.updatedAt = new Date().toISOString();
        const updated = await upsert(container, body);
        return respond(context, 200, updated);
      }

      case "DELETE": {
        if (!id || !pk) return respond(context, 400, { error: "ID et pk requis" });
        await remove(container, id, pk);
        return respond(context, 204);
      }

      default:
        return respond(context, 405, { error: "Methode non supportee" });
    }
  } catch (err) {
    return handleError(context, err, req.method + " " + container + "/" + (id || ""));
  }
};
