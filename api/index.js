const { CosmosClient } = require("@azure/cosmos");

const ALLOWED = new Set([
  "mp_marches", "mp_aos", "mp_cautions", "mp_paiements",
  "mp_bordereau", "mp_avancements", "mp_indices", "mp_banques",
  "mp_avenants",
  "mp_veille_ao"
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
  "mp_avenants":    "marcheId",
  "mp_veille_ao":   "source"
};

// Config GitHub workflow_dispatch pour DL DCE on demand
const GH_OWNER = "najikarim66";
const GH_REPO = "neurones-veille-ao";
const GH_WORKFLOW = "download-dce.yml";

let _db = null;
function getDb() {
  if (_db) return _db;
  _db = new CosmosClient(process.env.COSMOS_CONNECTION_STRING).database(process.env.COSMOS_DATABASE);
  return _db;
}

// Verifie qu'un user est authentifie via Entra ID (en-tete x-ms-client-principal injecte par SWA)
function getAuthenticatedUser(req) {
  const header = req.headers && req.headers["x-ms-client-principal"];
  if (!header) return null;
  try {
    const decoded = Buffer.from(header, "base64").toString("utf8");
    const principal = JSON.parse(decoded);
    return principal && principal.userDetails ? principal : null;
  } catch (e) {
    return null;
  }
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

  // Route dce-trigger : POST /api/dce-trigger
  // Body: { ref_consultation, org_acronyme, cosmos_doc_id }
  // Declenche le workflow GitHub neurones-veille-ao/.github/workflows/download-dce.yml
  if (fn === "dceTrigger") {
    try {
      // Auth check (tous les utilisateurs neurones.ma authentifies)
      const user = getAuthenticatedUser(req);
      if (!user) {
        context.res = { status: 401, body: { error: "Authentification requise" } };
        return;
      }

      if ((req.method || "GET").toUpperCase() !== "POST") {
        context.res = { status: 405, body: { error: "Method not allowed (use POST)" } };
        return;
      }

      const body = req.body || {};
      const ref = String(body.ref_consultation || "").trim();
      const org = String(body.org_acronyme || "").trim();
      const docId = String(body.cosmos_doc_id || "").trim();

      if (!ref || !org || !docId) {
        context.res = { status: 400, body: { error: "Manquant : ref_consultation, org_acronyme, cosmos_doc_id" } };
        return;
      }

      // Validation basique des inputs (eviter injection dans inputs workflow)
      if (!/^[a-zA-Z0-9_\-]+$/.test(ref) || !/^[a-zA-Z0-9_\-]+$/.test(org)) {
        context.res = { status: 400, body: { error: "ref ou org invalide (caracteres autorises : alphanumeriques, _, -)" } };
        return;
      }
      if (!/^veille_[a-zA-Z0-9_\-]+$/.test(docId)) {
        context.res = { status: 400, body: { error: "cosmos_doc_id invalide" } };
        return;
      }

      const ghPat = process.env.GH_PAT;
      if (!ghPat) {
        context.res = { status: 500, body: { error: "GH_PAT non configure cote serveur" } };
        return;
      }

      // Avant de declencher, on marque tout de suite le doc Cosmos en 'queued'
      // pour que l'UI MP Manager voit le changement immediatement (sans attendre le workflow)
      try {
        const veilleC = getDb().container("mp_veille_ao");
        const { resource: doc } = await veilleC.item(docId, "marchespublics_gov_ma").read();
        if (doc) {
          doc.dce_status = "queued";
          doc.dce_started_at = new Date().toISOString();
          doc.dce_error = null;
          doc.dce_triggered_by = user.userDetails || null;
          await veilleC.items.upsert(doc);
        }
      } catch (e) {
        context.log.warn("Pre-mark queued failed (continue): " + e.message);
      }

      // Appel GitHub workflow_dispatch
      const ghUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`;
      const ghBody = {
        ref: "main",
        inputs: {
          ref_consultation: ref,
          org_acronyme: org,
          cosmos_doc_id: docId
        }
      };

      const fetch = (typeof globalThis.fetch === "function")
        ? globalThis.fetch
        : require("node-fetch");

      const ghResp = await fetch(ghUrl, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + ghPat,
          "Accept": "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
          "User-Agent": "mp-neurones-api"
        },
        body: JSON.stringify(ghBody)
      });

      if (ghResp.status === 204) {
        // Workflow_dispatch reussit avec 204 No Content
        context.res = {
          status: 202,
          body: {
            ok: true,
            message: "Workflow declenche - DCE en cours de telechargement",
            ref_consultation: ref,
            org_acronyme: org,
            user: user.userDetails
          }
        };
        return;
      }

      const ghErr = await ghResp.text();
      context.log.error("GitHub workflow_dispatch failed: HTTP " + ghResp.status + " - " + ghErr);
      context.res = {
        status: 502,
        body: { error: "Echec declenchement workflow GitHub", detail: ghErr.substring(0, 500) }
      };
      return;
    } catch (e) {
      context.log.error("dceTrigger error:", e.message, e.stack);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
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
