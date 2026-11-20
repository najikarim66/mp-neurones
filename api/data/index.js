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
const MPMainlevee = require("../pv-mainlevee.js");

const ALLOWED_CONTAINERS = new Set([
  "mp_marches",
  "mp_aos",
  "mp_cautions",
  "mp_paiements",
  // Futurs : ouvrir plus tard pour intégration GC
  // "rh_employes",
  // "gc_chantiers",
]);

// GARDE du cycle de mainlevee (regle DG 20/11/2026) sur l'enregistrement GENERIQUE d'une caution
// (mp_cautions) ou d'un AO portant une provisoire (mp_aos.caution_prov) : un formulaire ne pose jamais
// piece_recue / demande_deposee / liberee / restituee (ces etats viennent des depots de pieces), et il
// n'efface jamais les pieces et dates posees par le serveur (anti-clobber, meme liste que le front).
// Renvoie le motif du refus, ou null (et complete alors `body` avec les champs serveur preserves).
async function garderCycleMainlevee(container, body) {
  if (!body || !body.id) return null;
  if (container === "mp_cautions") {
    const avant = await readOne(container, body.id, body.marcheId);
    const refus = MPMainlevee.refusChangementStatutGenerique(avant, body);
    if (refus) return refus;
    if (avant) MPMainlevee.preserverChampsServeur(body, avant, MPMainlevee.CHAMPS_PIECES_CAUTION);
    return null;
  }
  if (container === "mp_aos" && body.caution_prov && typeof body.caution_prov === "object") {
    const avant = await readOne(container, body.id, body.id);
    const cpAvant = avant && avant.caution_prov ? avant.caution_prov : null;
    const refus = MPMainlevee.refusChangementStatutGenerique(cpAvant, body.caution_prov);
    if (refus) return refus;
    if (cpAvant) MPMainlevee.preserverChampsServeur(body.caution_prov, cpAvant, MPMainlevee.CHAMPS_PIECES_CAUTION);
    return null;
  }
  return null;
}

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
        // INVARIANT (Karim) : une caution DOIT porter un marcheId, sinon elle s'ecrit
        // dans une partition vide au lieu de sa fiche. Pas d'exception (cas A comme B).
        if (container === "mp_cautions" && !MPMainlevee.cautionMarcheIdValide(body)) {
          return respond(context, 400, { error: "Caution refusee : marcheId obligatoire (une caution sans marche ne peut pas etre enregistree)." });
        }
        const refusCycle = await garderCycleMainlevee(container, body);
        if (refusCycle) return respond(context, 409, { error: refusCycle });
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
        if (container === "mp_cautions" && !MPMainlevee.cautionMarcheIdValide(body)) {
          return respond(context, 400, { error: "Caution refusee : marcheId obligatoire (une caution sans marche ne peut pas etre enregistree)." });
        }
        body.id = id;
        const refusCyclePut = await garderCycleMainlevee(container, body);
        if (refusCyclePut) return respond(context, 409, { error: refusCyclePut });
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
