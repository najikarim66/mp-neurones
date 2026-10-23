const { CosmosClient } = require("@azure/cosmos");
const { BlobServiceClient } = require("@azure/storage-blob");
// Regle metier PV -> mainlevee. Copie committee de public/pv-mainlevee.js
// (SWA deploie /api et /public separement). Identite garantie par
// test/module-copy.test.js (gate). Une seule regle, testee telle qu'elle sert.
const MPMainlevee = require("./pv-mainlevee.js");
// Relevés banque (lecteurs, contrôles d'intégrité, rapprochement) : copie committée de
// public/releves-banque.js, identité garantie par test/module-copy.test.js.
const MPReleves = require("./releves-banque.js");
// Blob des relevés de cautions des banques (PDF tel que reçu).
const RELEVE_CONTAINER = "mp-releves";

// Blob des PV de reception definitive (compte partage erpneuronesstorage du tenant).
const PV_CONTAINER = "mp-pv-reception";
// Blob des pieces de mainlevee (mainlevee du client, accuse de la banque).
const PIECE_CONTAINER = "mp-preuves";
// Types de PV acceptes -> extension du blob (nom deterministe : un PV par marche).
const PV_TYPES = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
const PV_MAX_BYTES = 20 * 1024 * 1024; // 20 Mo

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
const GH_VEILLE_WORKFLOW = "veille-ao.yml";

let _db = null;
function getDb() {
  if (_db) return _db;
  _db = new CosmosClient(process.env.COSMOS_CONNECTION_STRING).database(process.env.COSMOS_DATABASE);
  return _db;
}

// Recalcule le statut d'un marche apres un changement de caution (regle Karim 08/10) :
// delegue au module pur appliquerStatutMarche (toutes cautions terminales + PV present
// -> termine, trace ; liberation annulee -> en cours). N'ecrit le marche QUE si le
// statut change. Best-effort : une erreur ici ne casse pas le depot/liberation. Renvoie
// le nouveau statut, ou null si aucun changement.
async function recomputeMarcheStatut(marcheId, dateISO) {
  try {
    const marchesC = getDb().container("mp_marches");
    const r = await marchesC.item(marcheId, marcheId).read();
    const m = r.resource;
    if (!m) return null;
    const cs = (await getDb().container("mp_cautions").items.query({
      query: "SELECT * FROM c WHERE c.marcheId = @m",
      parameters: [{ name: "@m", value: marcheId }]
    }).fetchAll()).resources;
    const maj = MPMainlevee.appliquerStatutMarche(m, cs, dateISO);
    if (!maj) return null;
    await marchesC.items.upsert(maj);
    return maj.statut;
  } catch (e) { return null; }
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

// Role de l'utilisateur, MEME source que le RH : conteneur rh_users (DB partagee),
// cle = email en minuscules, champ role (dg/comptable/...). Compte inactif -> null.
async function getRoleFromDb(email) {
  if (!email) return null;
  try {
    const e = String(email).toLowerCase();
    const r = await getDb().container("rh_users").item(e, e).read();
    const u = r.resource;
    return (u && u.actif !== false && u.role) ? String(u.role) : null;
  } catch (e) { return null; }
}

module.exports = async function (context, req) {
  const fn = context.executionContext.functionName;

  // Route version : GET /api/version — identite + CONTRAT de l'API (garde de version,
  // modele ERP/RH 878acef). Sert { apiContract (contrat-api.json du meme commit),
  // build/commit/buildDate (version.json grave par la CI), gardeVersionActive (mp_config,
  // defaut true) }. Le front compare apiContract a l'apiContractMin grave dans SON
  // version.json. Non sensible : pas de garde de principal (doit repondre meme en marge d'auth).
  if (fn === "version") {
    var contrat = {}, vj = {};
    try { contrat = require("./contrat-api.json"); } catch (e) { contrat = {}; }
    try { vj = require("./version.json"); } catch (e) { vj = {}; }
    var apiContract = (contrat && Number.isInteger(contrat.version) && contrat.version > 0) ? contrat.version : null;
    var gardeVersionActive = true;
    try {
      const cont = getDb().container("mp_config");
      let doc = null;
      try { doc = (await cont.item("parametres", "parametres").read()).resource; } catch (e) { doc = null; }
      if (doc && typeof doc.gardeVersionActive === "boolean") gardeVersionActive = doc.gardeVersionActive;
      // Réarmement au déploiement : un build strictement plus récent que celui en vigueur
      // réactive la garde (tracé « réarmée par déploiement »), même si le DG l'avait éteinte
      // pour le build précédent. Idempotent (une seule écriture par nouveau build).
      if (doc && MPMainlevee.doitRearmerGarde(doc.gardeBuild, vj.build)) {
        const avant = (typeof doc.gardeVersionActive === "boolean") ? doc.gardeVersionActive : true;
        doc.gardeVersionActive = true;
        doc.gardeBuild = vj.build;
        doc.gardeVersionActive_trace = (Array.isArray(doc.gardeVersionActive_trace) ? doc.gardeVersionActive_trace : []).concat([{ par: "déploiement", le: new Date().toISOString(), de: avant, vers: true, motif: "réarmée par déploiement", build: vj.build }]);
        await cont.items.upsert(doc);
        gardeVersionActive = true;
      }
    } catch (e) { gardeVersionActive = true; }
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: { app: "mp-neurones-api", apiContract: apiContract, build: vj.build || null, commit: vj.commit || null, buildDate: vj.buildDate || null, gardeVersionActive: gardeVersionActive }
    };
    return;
  }

  // Route role : GET /api/role — l'identite + le role de l'utilisateur (rh_users, DB
  // partagee) pour que le front montre le controle « Garde de version » au DG seul.
  if (fn === "roleGet") {
    const user = getAuthenticatedUser(req);
    if (!MPMainlevee.principalAutorise(user)) { context.res = { status: 401, body: { error: "Authentification requise" } }; return; }
    const email = user.userDetails || null;
    const role = await getRoleFromDb(email);
    context.res = { status: 200, headers: { "Cache-Control": "no-store" }, body: { email: email, role: role, isDg: MPMainlevee.peutBasculerGarde(role) } };
    return;
  }

  // Route garde-version-toggle : POST /api/garde-version-toggle { active } — bascule
  // gardeVersionActive dans mp_config. DG SEUL (meme source de role que RH). Chaque
  // bascule TRACEE (qui, quand, de -> vers). Renvoie l'etat ECRIT (le front relit ensuite
  // /api/version pour afficher l'etat lu du serveur, pas l'etat clique).
  if (fn === "gardeVersionToggle") {
    try {
      const user = getAuthenticatedUser(req);
      if (!MPMainlevee.principalAutorise(user)) { context.res = { status: 401, body: { error: "Authentification requise" } }; return; }
      if ((req.method || "GET").toUpperCase() !== "POST") { context.res = { status: 405, body: { error: "Method not allowed (use POST)" } }; return; }
      const email = user.userDetails || null;
      const role = await getRoleFromDb(email);
      if (!MPMainlevee.peutBasculerGarde(role)) { context.res = { status: 403, body: { error: "Bascule de la garde de version : reservee au DG." } }; return; }
      const active = !!(req.body && req.body.active);
      const cc = (await getDb().containers.createIfNotExists({ id: "mp_config", partitionKey: { paths: ["/id"] } })).container;
      let doc = null;
      try { doc = (await cc.item("parametres", "parametres").read()).resource; } catch (e) { doc = null; }
      if (!doc) doc = { id: "parametres" };
      const avant = (typeof doc.gardeVersionActive === "boolean") ? doc.gardeVersionActive : true;
      doc.gardeVersionActive = active;
      // Estampille le build courant : l'état fixé par le DG « tient » jusqu'au prochain
      // déploiement (sinon /api/version réarmerait aussitôt et « Inactive » serait vain).
      let vjT = {}; try { vjT = require("./version.json"); } catch (e) { vjT = {}; }
      doc.gardeBuild = vjT.build;
      doc.gardeVersionActive_trace = (Array.isArray(doc.gardeVersionActive_trace) ? doc.gardeVersionActive_trace : []).concat([{ par: email, le: new Date().toISOString(), de: avant, vers: active }]);
      await cc.items.upsert(doc);
      context.res = { status: 200, headers: { "Cache-Control": "no-store" }, body: { gardeVersionActive: active } };
      return;
    } catch (e) {
      context.log.error("gardeVersionToggle error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
  }

  // Route ping
  if (fn === "ping") {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { ok: true, now: new Date().toISOString(), hasCosmos: !!process.env.COSMOS_CONNECTION_STRING }
    };
    return;
  }

  // Route health : test reel de connectivite Cosmos (lecture metadata DB).
  // Anonyme (voir exception dans staticwebapp.config.json) -> sert de sonde apres rotation de cle.
  if (fn === "health") {
    try {
      await getDb().read();
      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: { ok: true, cosmos: "ok", now: new Date().toISOString() }
      };
    } catch (e) {
      // On expose seulement le code d'erreur (jamais la cle ni la connection string)
      context.res = {
        status: 503,
        headers: { "Content-Type": "application/json" },
        body: { ok: false, cosmos: "error", code: e.code || null }
      };
    }
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

  // Route scrape-trigger : POST /api/scrape-trigger
  // Declenche le workflow Veille AO (scrape complet) a la demande, sans inputs.
  if (fn === "scrapeTrigger") {
    try {
      const user = getAuthenticatedUser(req);
      if (!user) {
        context.res = { status: 401, body: { error: "Authentification requise" } };
        return;
      }
      if ((req.method || "GET").toUpperCase() !== "POST") {
        context.res = { status: 405, body: { error: "Method not allowed (use POST)" } };
        return;
      }
      const ghPat = process.env.GH_PAT;
      if (!ghPat) {
        context.res = { status: 500, body: { error: "GH_PAT non configure cote serveur" } };
        return;
      }

      const ghUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_VEILLE_WORKFLOW}/dispatches`;
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
        body: JSON.stringify({ ref: "main" })
      });

      if (ghResp.status === 204) {
        context.res = {
          status: 202,
          body: { ok: true, message: "Scrape Veille AO declenche", user: user.userDetails }
        };
        return;
      }

      const ghErr = await ghResp.text();
      context.log.error("GitHub veille dispatch failed: HTTP " + ghResp.status + " - " + ghErr);
      context.res = {
        status: 502,
        body: { error: "Echec declenchement workflow Veille AO", detail: ghErr.substring(0, 500) }
      };
      return;
    } catch (e) {
      context.log.error("scrapeTrigger error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
  }

  // Route pv-reception : POST /api/pv-reception
  // UNE decision = depot du PV de reception definitive + bascule des cautions.
  // Body JSON : { marcheId, date_reception_definitive_reelle (YYYY-MM-DD),
  //               nom_original, content_type, data_base64 }
  // Ordre STRICT (Cosmos ne transacte pas avec le Blob) :
  //   (1) Blob d'abord  -> si echec : RIEN en base, marche inchange.
  //   (2) Marche ensuite (drapeau + date reelle + ref PV) : le drapeau n'est
  //       jamais ecrit sans pièce, car il suit un upload reussi.
  //   (3) Cautions enfin, en UN TransactionalBatch (partition marcheId) : def+RG
  //       actives -> mainlevee_demandee. Derivee et idempotente : un re-POST du
  //       meme PV repare une bascule partielle (statut != active -> ignore).
  // Etats interdits impossibles : drapeau-sans-pièce (2 apres 1) et
  // bascule-sans-drapeau (3 apres 2, et basculerMarche refuse un marche non recevable).
  if (fn === "pvReception") {
    try {
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
      const marcheId = String(body.marcheId || "").trim();
      const dateReelle = String(body.date_reception_definitive_reelle || "").trim();
      const nomOriginal = String(body.nom_original || "").trim();
      const contentType = String(body.content_type || "").trim();
      const dataB64 = String(body.data_base64 || "");

      if (!marcheId || !dateReelle || !dataB64) {
        context.res = { status: 400, body: { error: "Manquant : marcheId, date_reception_definitive_reelle, data_base64" } };
        return;
      }
      if (!MPMainlevee.dateReceptionValide(dateReelle)) {
        context.res = { status: 400, body: { error: "Date du PV requise (AAAA-MM-JJ) — jamais completee par defaut" } };
        return;
      }
      const ext = PV_TYPES[contentType];
      if (!ext) {
        context.res = { status: 400, body: { error: "content_type non autorise (pdf, jpeg ou png)" } };
        return;
      }
      let buf;
      try { buf = Buffer.from(dataB64, "base64"); } catch (e) { buf = null; }
      if (!buf || !buf.length) {
        context.res = { status: 400, body: { error: "Fichier vide ou base64 invalide" } };
        return;
      }
      if (buf.length > PV_MAX_BYTES) {
        context.res = { status: 400, body: { error: "Fichier trop volumineux (max 20 Mo)" } };
        return;
      }
      const conn = process.env.STORAGE_CONNECTION_STRING;
      if (!conn) {
        context.res = { status: 500, body: { error: "STORAGE_CONNECTION_STRING non configure cote serveur" } };
        return;
      }

      // Le marche doit exister (garde d'integrite : pas de drapeau sur un fantome).
      const marchesC = getDb().container("mp_marches");
      let marche = null;
      try {
        const r = await marchesC.item(marcheId, marcheId).read();
        marche = r.resource || null;
      } catch (e) { marche = null; }
      if (!marche) {
        context.res = { status: 404, body: { error: "Marche introuvable" } };
        return;
      }

      // (1) BLOB d'abord. Nom deterministe -> un retry reecrase, pas de doublon orphelin.
      const blobName = marcheId + "/pv-reception-definitive." + ext;
      const svc = BlobServiceClient.fromConnectionString(conn);
      const cont = svc.getContainerClient(PV_CONTAINER);
      await cont.createIfNotExists();
      await cont.getBlockBlobClient(blobName).uploadData(buf, {
        blobHTTPHeaders: { blobContentType: contentType }
      });

      // (2) MARCHE : le drapeau ne s'ecrit qu'apres un blob reussi.
      marche.reception_definitive_prononcee = true;
      marche.date_reception_definitive_reelle = dateReelle;
      marche.pv_reception_definitive = {
        blob: blobName,
        nom_original: nomOriginal || ("pv-reception-definitive." + ext),
        taille: buf.length,
        content_type: contentType,
        depose_le: new Date().toISOString(),
        depose_par: user.userDetails || null
      };
      await marchesC.items.upsert(marche);

      // (3) CAUTIONS : bascule derivee (def + RG actives), UN batch transactionnel.
      // La demande de mainlevee est datee de la RECEPTION (date du PV), pas du jour
      // du depot : l'anciennete (relance) court depuis que la mainlevee est due.
      const dateISO = dateReelle;
      const cautionsC = getDb().container("mp_cautions");
      const q = { query: "SELECT * FROM c WHERE c.marcheId = @m", parameters: [{ name: "@m", value: marcheId }] };
      const { resources: cautions } = await cautionsC.items.query(q).fetchAll();
      const batch = MPMainlevee.basculerMarche(marche, cautions, dateISO);
      if (batch.aMettreAJour.length) {
        // Meme partition (marcheId) -> tout-ou-rien. Un marche n'atteint jamais 100 cautions.
        const ops = batch.aMettreAJour.map(function (c) {
          return { operationType: "Upsert", resourceBody: c };
        });
        await cautionsC.items.batch(ops, marcheId);
      }

      // (4) STATUT MARCHE (regle Karim 08/10) : le depot du PV change une condition de
      // terminaison (reception_definitive_prononcee). Si les cautions sont deja TOUTES
      // liberees (regularisations / marches anciens, ordre inverse du cycle), le marche
      // se termine ICI — meme declencheur qu'une liberation de caution (cas 40/2024).
      const marcheStatutPv = await recomputeMarcheStatut(marcheId, dateISO);

      // Reponse : libelles humains uniquement (jamais l'id ni le chemin blob).
      context.res = {
        status: 200,
        body: {
          ok: true,
          marche: marche.ref,
          date_reception_definitive_reelle: dateReelle,
          cautions_basculees: batch.count,
          montant_bascule: batch.total,
          marche_statut: marcheStatutPv
        }
      };
      return;
    } catch (e) {
      context.log.error("pvReception error:", e.message, e.stack);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
  }

  // Route caution-piece : POST /api/caution-piece
  // Cycle a 3 etats (def/RG) : depot d'UNE piece qui fait avancer UNE caution.
  //   piece_type "mainlevee_client" : mainlevee_demandee -> mainlevee_recue
  //   piece_type "accuse_banque"    : mainlevee_recue    -> liberee
  // Body JSON : { cautionId, marcheId (partition), piece_type, date (YYYY-MM-DD),
  //               nom_original, content_type, data_base64 }
  // Meme ordre strict que le PV : Blob d'abord, puis la caution (statut + ref piece
  // + date). La transition est refusee si le statut de depart ne correspond pas
  // (pas de saut d'etat), via MPMainlevee.pieceRecevable.
  if (fn === "cautionPiece") {
    try {
      const user = getAuthenticatedUser(req);
      if (!user) { context.res = { status: 401, body: { error: "Authentification requise" } }; return; }
      if ((req.method || "GET").toUpperCase() !== "POST") { context.res = { status: 405, body: { error: "Method not allowed (use POST)" } }; return; }

      const body = req.body || {};
      const cautionId = String(body.cautionId || "").trim();
      const marcheId = String(body.marcheId || "").trim();
      const pieceType = String(body.piece_type || "").trim();
      const dateReelle = String(body.date || "").trim();
      const nomOriginal = String(body.nom_original || "").trim();
      const contentType = String(body.content_type || "").trim();
      const dataB64 = String(body.data_base64 || "");

      if (!cautionId || !marcheId || !pieceType || !dateReelle || !dataB64) {
        context.res = { status: 400, body: { error: "Manquant : cautionId, marcheId, piece_type, date, data_base64" } };
        return;
      }
      if (!MPMainlevee.transitionPiece(pieceType)) {
        context.res = { status: 400, body: { error: "piece_type inconnu (mainlevee_client ou accuse_banque)" } };
        return;
      }
      if (!MPMainlevee.dateReceptionValide(dateReelle)) {
        context.res = { status: 400, body: { error: "Date de la piece requise (AAAA-MM-JJ) — jamais completee par defaut" } };
        return;
      }
      const ext = PV_TYPES[contentType];
      if (!ext) { context.res = { status: 400, body: { error: "content_type non autorise (pdf, jpeg ou png)" } }; return; }
      let buf;
      try { buf = Buffer.from(dataB64, "base64"); } catch (e) { buf = null; }
      if (!buf || !buf.length) { context.res = { status: 400, body: { error: "Fichier vide ou base64 invalide" } }; return; }
      if (buf.length > PV_MAX_BYTES) { context.res = { status: 400, body: { error: "Fichier trop volumineux (max 20 Mo)" } }; return; }
      const conn = process.env.STORAGE_CONNECTION_STRING;
      if (!conn) { context.res = { status: 500, body: { error: "STORAGE_CONNECTION_STRING non configure cote serveur" } }; return; }

      // La caution doit exister ET la transition doit etre recevable (pas de saut d'etat).
      const cautionsC = getDb().container("mp_cautions");
      let caution = null;
      try { const r = await cautionsC.item(cautionId, marcheId).read(); caution = r.resource || null; } catch (e) { caution = null; }
      if (!caution) { context.res = { status: 404, body: { error: "Caution introuvable" } }; return; }
      // A POSTERIORI : justificatif (mainlevée/accusé) sur une caution DÉJÀ libérée/
      // restituée (régularisation rétroactive), SANS changer le statut. Sinon : cycle normal.
      const aPosteriori = !!(req.body && req.body.a_posteriori);
      if (aPosteriori) {
        if (!MPMainlevee.pieceJustifRecevable(caution, pieceType)) {
          context.res = { status: 409, body: { error: "Justificatif a posteriori non recevable (statut « " + caution.statut + " », ou pièce déjà jointe)" } };
          return;
        }
      } else if (!MPMainlevee.pieceRecevable(caution, pieceType)) {
        context.res = { status: 409, body: { error: "Transition non recevable pour le statut actuel (" + caution.statut + ")" } };
        return;
      }

      // (1) BLOB d'abord. Nom deterministe -> un retry reecrase, pas d'orphelin.
      const blobName = marcheId + "/caution-" + cautionId + "/" + pieceType + "." + ext;
      const svc = BlobServiceClient.fromConnectionString(conn);
      const cont = svc.getContainerClient(PIECE_CONTAINER);
      await cont.createIfNotExists();
      await cont.getBlockBlobClient(blobName).uploadData(buf, { blobHTTPHeaders: { blobContentType: contentType } });

      // (2) CAUTION : transition pure, puis upsert (doc unique, partition marcheId).
      const pieceRef = {
        blob: blobName,
        nom_original: nomOriginal || (pieceType + "." + ext),
        taille: buf.length,
        content_type: contentType,
        depose_le: new Date().toISOString(),
        depose_par: user.userDetails || null
      };
      const maj = aPosteriori
        ? MPMainlevee.appliquerPieceJustificative(caution, pieceType, pieceRef, dateReelle, user.userDetails || null)
        : MPMainlevee.appliquerPiece(caution, pieceType, pieceRef, dateReelle);
      await cautionsC.items.upsert(maj);
      // A posteriori : statut INCHANGÉ (pas de recalcul marché). Sinon l'accusé peut
      // libérer la caution -> peut terminer le marché (règle Karim).
      const marcheStatutPiece = aPosteriori ? null : await recomputeMarcheStatut(marcheId, dateReelle);

      context.res = {
        status: 200,
        body: { ok: true, caution: maj.num, nouveau_statut: maj.statut, date: dateReelle, marche_statut: marcheStatutPiece, a_posteriori: aPosteriori }
      };
      return;
    } catch (e) {
      context.log.error("cautionPiece error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
  }

  // Route piece : GET /api/piece?type=&marcheId=&cautionId=
  // Proxy AUTHENTIFIE (Entra) qui sert une piece (PV, mainlevee client, accuse
  // banque) par son marche/caution et son TYPE. Le nom du blob est resolu
  // UNIQUEMENT depuis le document stocke (MPMainlevee.resoudreBlobPiece) : aucun
  // chemin fourni par l'appelant n'est jamais servi. Jamais d'URL Blob exposee.
  if (fn === "pieceGet") {
    try {
      const user = getAuthenticatedUser(req);
      if (!MPMainlevee.principalAutorise(user)) {
        context.res = { status: 401, body: { error: "Authentification requise" } };
        return;
      }
      const type = String((req.query && req.query.type) || "").trim();
      const marcheId = String((req.query && req.query.marcheId) || "").trim();
      const cautionId = String((req.query && req.query.cautionId) || "").trim();
      const aoId = String((req.query && req.query.aoId) || "").trim();
      // Acte d'une PROVISOIRE : le blob vit sur l'AO (a.caution_prov.acte), lu UNIQUEMENT
      // depuis le doc AO (jamais un chemin fourni). Conteneur mp-preuves.
      if (type === "acte" && aoId) {
        let ao = null;
        try { ao = (await getDb().container("mp_aos").item(aoId, aoId).read()).resource || null; } catch (e) { ao = null; }
        const bnProv = MPMainlevee.resoudreBlobActeProv(ao);
        if (!bnProv) { context.res = { status: 404, body: { error: "Acte de provisoire introuvable" } }; return; }
        const connP = process.env.STORAGE_CONNECTION_STRING;
        if (!connP) { context.res = { status: 500, body: { error: "STORAGE_CONNECTION_STRING non configure cote serveur" } }; return; }
        const refP = ao.caution_prov.acte || {};
        const bcP = BlobServiceClient.fromConnectionString(connP).getContainerClient(PIECE_CONTAINER).getBlockBlobClient(bnProv);
        let bufP;
        try { bufP = await bcP.downloadToBuffer(); } catch (e) { context.res = { status: 404, body: { error: "Fichier absent du stockage" } }; return; }
        const nomP = String(refP.nom_original || "acte.pdf").replace(/[\r\n"\\]/g, "_");
        context.res = { status: 200, isRaw: true, headers: { "Content-Type": refP.content_type || "application/pdf", "Content-Disposition": 'inline; filename="' + nomP + '"', "Cache-Control": "private, no-store" }, body: bufP };
        return;
      }
      const src = MPMainlevee.PIECE_LECTURE[type];
      if (!src) { context.res = { status: 400, body: { error: "type de piece inconnu" } }; return; }
      if (!marcheId) { context.res = { status: 400, body: { error: "marcheId requis" } }; return; }

      let marche = null, caution = null;
      if (src.sur === "marche") {
        try { marche = (await getDb().container("mp_marches").item(marcheId, marcheId).read()).resource || null; } catch (e) { marche = null; }
      } else {
        if (!cautionId) { context.res = { status: 400, body: { error: "cautionId requis" } }; return; }
        try { caution = (await getDb().container("mp_cautions").item(cautionId, marcheId).read()).resource || null; } catch (e) { caution = null; }
      }

      const blobName = MPMainlevee.resoudreBlobPiece(type, marche, caution);
      if (!blobName) { context.res = { status: 404, body: { error: "Piece introuvable" } }; return; }

      const conn = process.env.STORAGE_CONNECTION_STRING;
      if (!conn) { context.res = { status: 500, body: { error: "STORAGE_CONNECTION_STRING non configure cote serveur" } }; return; }
      const ref = ((src.sur === "marche" ? marche : caution) || {})[src.champ] || {};
      const svc = BlobServiceClient.fromConnectionString(conn);
      const bc = svc.getContainerClient(MPMainlevee.conteneurPiece(type)).getBlockBlobClient(blobName);
      let buf;
      try { buf = await bc.downloadToBuffer(); } catch (e) { context.res = { status: 404, body: { error: "Fichier absent du stockage" } }; return; }

      const ct = ref.content_type || "application/octet-stream";
      const nom = String(ref.nom_original || (type + ".bin")).replace(/[\r\n"\\]/g, "_");
      context.res = {
        status: 200,
        isRaw: true,
        headers: {
          "Content-Type": ct,
          "Content-Disposition": 'inline; filename="' + nom + '"',
          "Cache-Control": "private, no-store"
        },
        body: buf
      };
      return;
    } catch (e) {
      context.log.error("pieceGet error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
  }

  // Route relance-hebdo : GET /api/relance-hebdo
  // Voie A du mail du lundi : la DECISION vit ici (logique unique, gatee), le job
  // timer (dans rh-neurones-api-fc, depot btp-pointage) ne fait qu'appeler puis
  // envoyer. Garde par en-tete a secret partage MP_RELANCE_HEBDO_SECRET, SANS
  // fail-open (enteteRelanceValide refuse si le secret attendu est vide). Route
  // anonyme au niveau SWA (voir staticwebapp.config) : l'en-tete EST la garde.
  if (fn === "relanceHebdo") {
    try {
      var provided = (req.headers && (req.headers["x-mp-relance-secret"] || req.headers["X-MP-Relance-Secret"])) || "";
      if (!MPMainlevee.enteteRelanceValide(provided, process.env.MP_RELANCE_HEBDO_SECRET)) {
        context.res = { status: 401, body: { error: "En-tete de relance invalide" } };
        return;
      }
      const [cautions, marches] = await Promise.all([
        getDb().container("mp_cautions").items.readAll().fetchAll().then(function (r) { return r.resources; }),
        getDb().container("mp_marches").items.readAll().fetchAll().then(function (r) { return r.resources; })
      ]);
      const M = {}; marches.forEach(function (m) { M[String(m.id)] = m; });
      const gm = function (id) { return M[String(id)] || {}; };
      const lignes = MPMainlevee.lignesRelance(cautions, gm, Date.now());
      const mail = MPMainlevee.mailHebdo(lignes);

      // Destinataires : doc de config Cosmos mp_config/mp_mail_to (editable sans
      // redeploiement) ; fallback en dur si le doc/container n'existe pas encore.
      var destinataires = ["naji@neurones.ma", "imane@neurones.ma", "drissia@neurones.ma"];
      try {
        const cfg = (await getDb().container("mp_config").item("mp_mail_to", "mp_mail_to").read()).resource;
        if (cfg && Array.isArray(cfg.destinataires) && cfg.destinataires.length) destinataires = cfg.destinataires;
      } catch (e) { /* doc/container absent -> fallback */ }

      context.res = {
        status: 200,
        body: {
          envoyer: mail.envoyer,
          nb: mail.nb || 0,
          total: mail.total || 0,
          sujet: mail.sujet || null,
          lignes: mail.lignes || [],
          destinataires: destinataires
        }
      };
      return;
    } catch (e) {
      context.log.error("relanceHebdo error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
  }

  // Route caution-mainlevee : POST /api/caution-mainlevee
  // Mainlevee MANUELLE d'une caution (active -> mainlevee_demandee) SANS PV numerique.
  // Chemin volontairement OUVERT (cas legitime : reception prononcee avant le systeme,
  // marche ancien) mais TRACE : motif libre OBLIGATOIRE + utilisateur enregistres.
  // Body JSON : { cautionId, marcheId (partition), motif }.
  if (fn === "cautionMainlevee") {
    try {
      const user = getAuthenticatedUser(req);
      if (!MPMainlevee.principalAutorise(user)) { context.res = { status: 401, body: { error: "Authentification requise" } }; return; }
      if ((req.method || "GET").toUpperCase() !== "POST") { context.res = { status: 405, body: { error: "Method not allowed (use POST)" } }; return; }

      const body = req.body || {};
      const cautionId = String(body.cautionId || "").trim();
      const marcheId = String(body.marcheId || "").trim();
      const motif = typeof body.motif === "string" ? body.motif : "";

      if (!cautionId || !marcheId) { context.res = { status: 400, body: { error: "Manquant : cautionId, marcheId" } }; return; }
      if (!MPMainlevee.motifMainleveeValide(motif)) { context.res = { status: 400, body: { error: "Motif de mainlevee obligatoire (texte libre)" } }; return; }

      const cautionsC = getDb().container("mp_cautions");
      let caution = null;
      try { const r = await cautionsC.item(cautionId, marcheId).read(); caution = r.resource || null; } catch (e) { caution = null; }
      if (!caution) { context.res = { status: 404, body: { error: "Caution introuvable" } }; return; }

      const dateISO = new Date().toISOString().slice(0, 10);
      const maj = MPMainlevee.appliquerMainleveeManuelle(caution, motif, user.userDetails || null, dateISO);
      if (!maj) { context.res = { status: 409, body: { error: "Mainlevee manuelle impossible : la caution n'est pas active (statut " + caution.statut + ")" } }; return; }
      await cautionsC.items.upsert(maj);

      context.res = { status: 200, body: { ok: true, caution: maj.num, statut: maj.statut, mainlevee_par: maj.mainlevee_par, motif: maj.mainlevee_motif } };
      return;
    } catch (e) {
      context.log.error("cautionMainlevee error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
  }

  // Route caution-liberation-directe : POST /api/caution-liberation-directe
  // Liberation DIRECTE d'une caution (active -> liberee) SANS accuse bancaire numerique.
  // Chemin OUVERT pour les cas legitimes anciens (accuse papier, soldee hors systeme)
  // mais TRACE : motif libre OBLIGATOIRE + utilisateur. Body : { cautionId, marcheId, motif }.
  if (fn === "cautionLiberationDirecte") {
    try {
      const user = getAuthenticatedUser(req);
      if (!MPMainlevee.principalAutorise(user)) { context.res = { status: 401, body: { error: "Authentification requise" } }; return; }
      if ((req.method || "GET").toUpperCase() !== "POST") { context.res = { status: 405, body: { error: "Method not allowed (use POST)" } }; return; }

      const body = req.body || {};
      const cautionId = String(body.cautionId || "").trim();
      const marcheId = String(body.marcheId || "").trim();
      const motif = typeof body.motif === "string" ? body.motif : "";

      if (!cautionId || !marcheId) { context.res = { status: 400, body: { error: "Manquant : cautionId, marcheId" } }; return; }
      if (!MPMainlevee.motifMainleveeValide(motif)) { context.res = { status: 400, body: { error: "Motif de liberation obligatoire (texte libre)" } }; return; }

      const cautionsC = getDb().container("mp_cautions");
      let caution = null;
      try { const r = await cautionsC.item(cautionId, marcheId).read(); caution = r.resource || null; } catch (e) { caution = null; }
      if (!caution) { context.res = { status: 404, body: { error: "Caution introuvable" } }; return; }

      const dateISO = new Date().toISOString().slice(0, 10);
      const maj = MPMainlevee.appliquerLiberationDirecte(caution, motif, user.userDetails || null, dateISO);
      if (!maj) { context.res = { status: 409, body: { error: "Liberation directe impossible : la caution n'est pas active (statut " + caution.statut + ")" } }; return; }
      await cautionsC.items.upsert(maj);
      // Liberation directe -> « liberee » -> peut terminer le marche (regle Karim).
      const marcheStatutLib = await recomputeMarcheStatut(marcheId, dateISO);

      context.res = { status: 200, body: { ok: true, caution: maj.num, statut: maj.statut, liberation_par: maj.liberation_par, motif: maj.liberation_motif, marche_statut: marcheStatutLib } };
      return;
    } catch (e) {
      context.log.error("cautionLiberationDirecte error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
  }

  // Route caution-acte-ocr : POST /api/caution-acte-ocr
  // Cas A : depose l'acte + OCR (sonnet, cache hash+modele), renvoie les champs + la
  // confiance par champ SANS RIEN ECRIRE (validation humaine bloquante cote client, la
  // caution est creee ensuite avec les champs valides). FAIL-SOFT : sans ANTHROPIC_API_KEY
  // -> { configure:false } (200), le depot reste possible, l'UI dit "OCR non configure".
  if (fn === "cautionActeOcr") {
    try {
      const user = getAuthenticatedUser(req);
      if (!MPMainlevee.principalAutorise(user)) { context.res = { status: 401, body: { error: "Authentification requise" } }; return; }
      if ((req.method || "GET").toUpperCase() !== "POST") { context.res = { status: 405, body: { error: "Method not allowed (use POST)" } }; return; }

      const body = req.body || {};
      const contentType = String(body.content_type || "").trim();
      const nomOriginal = String(body.nom_original || "").trim();
      const dataB64 = String(body.data_base64 || "");
      const ext = PV_TYPES[contentType];
      if (!ext) { context.res = { status: 400, body: { error: "content_type non autorise (pdf, jpeg ou png)" } }; return; }
      let buf; try { buf = Buffer.from(dataB64, "base64"); } catch (e) { buf = null; }
      if (!buf || !buf.length) { context.res = { status: 400, body: { error: "Fichier vide ou base64 invalide" } }; return; }
      if (buf.length > PV_MAX_BYTES) { context.res = { status: 400, body: { error: "Fichier trop volumineux (max 20 Mo)" } }; return; }

      const ocr = require("./lib/ocr-acte.js");

      // Referentiel banques (best-effort) pour verrouiller la banque lue.
      let referentiel = [];
      try {
        const bs = (await getDb().container("mp_banques").items.readAll().fetchAll()).resources;
        referentiel = bs.map(function (b) { return b.nom || b.name || b.libelle || ""; }).filter(Boolean);
      } catch (e) { referentiel = []; }

      // Cache best-effort (container mp_ocr_cache, cree si absent).
      let cacheC = null;
      try { const cc = await getDb().containers.createIfNotExists({ id: "mp_ocr_cache", partitionKey: { paths: ["/id"] } }); cacheC = cc.container; } catch (e) { cacheC = null; }
      const cacheGet = cacheC ? function (cle) { return cacheC.item(cle, cle).read().then(function (r) { return r.resource; }).catch(function () { return null; }); } : null;
      const cacheSet = cacheC ? function (cle, res) { return cacheC.items.upsert({ id: cle, resultat: res, le: new Date().toISOString() }); } : null;

      const res = await ocr.extraireActe(buf, contentType, referentiel, cacheGet, cacheSet);
      if (!res.configure) { context.res = { status: 200, body: { configure: false, message: "OCR non configure (ANTHROPIC_API_KEY absente) — saisir les champs manuellement" } }; return; }

      // Depose l'acte (blob par hash : re-upload du meme acte = ecrase, pas de doublon).
      var blobName = "actes/" + res.hash + "." + ext;
      const conn = process.env.STORAGE_CONNECTION_STRING;
      var acte = null;
      if (conn) {
        try {
          const svc = BlobServiceClient.fromConnectionString(conn);
          const cont = svc.getContainerClient(PIECE_CONTAINER);
          await cont.createIfNotExists();
          await cont.getBlockBlobClient(blobName).uploadData(buf, { blobHTTPHeaders: { blobContentType: contentType } });
          acte = { blob: blobName, nom_original: nomOriginal || ("acte." + ext), taille: buf.length, content_type: contentType, depose_le: new Date().toISOString(), depose_par: user.userDetails || null };
        } catch (e) { acte = null; }
      }

      context.res = { status: 200, body: { configure: true, cache: !!res.cache, champs: res.champs, confiances: res.confiances, lu_brut: res.lu_brut || null, acte: acte } };
      return;
    } catch (e) {
      context.log.error("cautionActeOcr error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
  }

  // Route caution-acte-compare : POST /api/caution-acte-compare
  // Cas B : compare une caution DEJA saisie a ce que l'OCR lit sur son acte, et renvoie
  // les ECARTS. N'ECRIT RIEN (ni caution, ni blob) — la donnee saisie fait foi ; l'ecart
  // est une alerte pour decision humaine. Sert la MESURE des faux ecarts (10 actes) avant
  // toute generalisation. FAIL-SOFT : sans ANTHROPIC_API_KEY -> { configure:false } (200).
  if (fn === "cautionActeCompare") {
    try {
      const user = getAuthenticatedUser(req);
      if (!MPMainlevee.principalAutorise(user)) { context.res = { status: 401, body: { error: "Authentification requise" } }; return; }
      if ((req.method || "GET").toUpperCase() !== "POST") { context.res = { status: 405, body: { error: "Method not allowed (use POST)" } }; return; }

      const body = req.body || {};
      const cautionId = String(body.cautionId || "").trim();
      const marcheId = String(body.marcheId || "").trim();
      const contentType = String(body.content_type || "").trim();
      const dataB64 = String(body.data_base64 || "");
      if (!cautionId || !marcheId) { context.res = { status: 400, body: { error: "Manquant : cautionId, marcheId" } }; return; }
      const ext = PV_TYPES[contentType];
      if (!ext) { context.res = { status: 400, body: { error: "content_type non autorise (pdf, jpeg ou png)" } }; return; }
      let buf; try { buf = Buffer.from(dataB64, "base64"); } catch (e) { buf = null; }
      if (!buf || !buf.length) { context.res = { status: 400, body: { error: "Fichier vide ou base64 invalide" } }; return; }
      if (buf.length > PV_MAX_BYTES) { context.res = { status: 400, body: { error: "Fichier trop volumineux (max 20 Mo)" } }; return; }

      // Caution STOCKEE (partition marcheId) — fait foi, jamais modifiee ici.
      let caution = null;
      try { const r = await getDb().container("mp_cautions").item(cautionId, marcheId).read(); caution = r.resource || null; } catch (e) { caution = null; }
      if (!caution) { context.res = { status: 404, body: { error: "Caution introuvable" } }; return; }

      const ocr = require("./lib/ocr-acte.js");

      let referentiel = [];
      try {
        const bs = (await getDb().container("mp_banques").items.readAll().fetchAll()).resources;
        referentiel = bs.map(function (b) { return b.nom || b.name || b.libelle || ""; }).filter(Boolean);
      } catch (e) { referentiel = []; }

      let cacheC = null;
      try { const cc = await getDb().containers.createIfNotExists({ id: "mp_ocr_cache", partitionKey: { paths: ["/id"] } }); cacheC = cc.container; } catch (e) { cacheC = null; }
      const cacheGet = cacheC ? function (cle) { return cacheC.item(cle, cle).read().then(function (r) { return r.resource; }).catch(function () { return null; }); } : null;
      const cacheSet = cacheC ? function (cle, res) { return cacheC.items.upsert({ id: cle, resultat: res, le: new Date().toISOString() }); } : null;

      const res = await ocr.extraireActe(buf, contentType, referentiel, cacheGet, cacheSet);
      if (!res.configure) { context.res = { status: 200, body: { configure: false, message: "OCR non configure (ANTHROPIC_API_KEY absente) — comparaison indisponible" } }; return; }

      // ECARTS — module pur gate.
      const ecarts = MPMainlevee.comparerActe(caution, res.champs);

      // CLASSEMENT de l'acte (comme au cas A) : blob prive par hash dans mp-preuves,
      // rattache a la caution (lien de lecture + dashboard « sans acte »). SEUL le champ
      // `acte` (reference blob) est ajoute — les champs metier de la fiche ne sont PAS
      // touches (la fiche fait foi). La valeur LUE sur l'acte ne va PAS sur la caution :
      // elle ne vit que dans le journal mp_ocr_comparaisons.
      var blobName = "actes/" + res.hash + "." + ext;
      const conn = process.env.STORAGE_CONNECTION_STRING;
      var acte = null;
      if (conn) {
        try {
          const svc = BlobServiceClient.fromConnectionString(conn);
          const contc = svc.getContainerClient(PIECE_CONTAINER);
          await contc.createIfNotExists();
          await contc.getBlockBlobClient(blobName).uploadData(buf, { blobHTTPHeaders: { blobContentType: contentType } });
          acte = { blob: blobName, nom_original: String(body.nom_original || "acte." + ext), taille: buf.length, content_type: contentType, depose_le: new Date().toISOString(), depose_par: user.userDetails || null };
          // PATCH CIBLE : ne touche que /acte — aucun autre champ de la caution (anti-clobber).
          await getDb().container("mp_cautions").item(cautionId, marcheId).patch(MPMainlevee.patchActeOps(acte));
        } catch (e) { acte = null; }
      }

      context.res = { status: 200, body: { configure: true, cache: !!res.cache, ecarts: ecarts, champs: res.champs, confiances: res.confiances, lu_brut: res.lu_brut || null, hash: res.hash, acte: acte } };
      return;
    } catch (e) {
      context.log.error("cautionActeCompare error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
  }

  // Route ocr-comparaison : POST /api/ocr-comparaison — JOURNAL du cas B.
  // Ecrit UNE comparaison verdictee dans mp_ocr_comparaisons : caution, date, champs
  // compares, ecarts {champ, valeur_acte, valeur_saisie, confiance, verdict}, qui/quand.
  // La valeur LUE sur l'acte ne vit QUE dans ce journal (jamais sur la caution/dashboard).
  if (fn === "ocrComparaison") {
    try {
      const user = getAuthenticatedUser(req);
      if (!MPMainlevee.principalAutorise(user)) { context.res = { status: 401, body: { error: "Authentification requise" } }; return; }
      if ((req.method || "GET").toUpperCase() !== "POST") { context.res = { status: 405, body: { error: "Method not allowed (use POST)" } }; return; }
      const body = req.body || {};
      const cautionId = String(body.cautionId || "").trim();
      const marcheId = String(body.marcheId || "").trim();
      if (!cautionId || !marcheId) { context.res = { status: 400, body: { error: "Manquant : cautionId, marcheId" } }; return; }
      const now = new Date().toISOString();
      const qui = user.userDetails || null;
      const ecartsIn = Array.isArray(body.ecarts) ? body.ecarts : [];
      const ecarts = ecartsIn.map(function (e) {
        var verdict = MPMainlevee.VERDICTS_ECART.indexOf(e && e.verdict) >= 0 ? e.verdict : null;
        return {
          champ: String((e && e.champ) || ""),
          valeur_acte: (e && e.valeur_acte != null) ? e.valeur_acte : null,
          valeur_saisie: (e && e.valeur_saisie != null) ? e.valeur_saisie : null,
          confiance: (e && e.confiance) || null,
          verdict: verdict,
          verdict_par: verdict ? qui : null,
          verdict_le: verdict ? now : null
        };
      });
      const doc = {
        id: "cmp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        cautionId: cautionId,
        marcheId: marcheId,
        caution_num: String(body.caution_num || ""),
        acte_hash: String(body.acte_hash || ""),
        champs_compares: Array.isArray(body.champs_compares) ? body.champs_compares : [],
        ecarts: ecarts,
        compare_par: qui,
        compare_le: now
      };
      const cc = await getDb().containers.createIfNotExists({ id: "mp_ocr_comparaisons", partitionKey: { paths: ["/id"] } });
      await cc.container.items.upsert(doc);
      context.res = { status: 200, body: { ok: true, id: doc.id } };
      return;
    } catch (e) {
      context.log.error("ocrComparaison error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
  }

  // Route ocr-mesure : GET /api/ocr-mesure — LECTURE automatique de la mesure cas B.
  // Lit tout le journal et renvoie statsMesure (module pur gate) : taux d'ecarts reels,
  // fausses lectures (global + par champ), et la recommandation (en_attente < 10
  // verdictees ; ne_pas_generaliser si fausses > vraies ; peut_generaliser sinon).
  if (fn === "ocrMesure") {
    try {
      const user = getAuthenticatedUser(req);
      if (!MPMainlevee.principalAutorise(user)) { context.res = { status: 401, body: { error: "Authentification requise" } }; return; }
      let comps = [];
      try { comps = (await getDb().container("mp_ocr_comparaisons").items.readAll().fetchAll()).resources; } catch (e) { comps = []; }
      var mesure = MPMainlevee.statsMesure(comps);
      mesure.ecartsATraiter = MPMainlevee.ecartsATraiter(comps);
      context.res = { status: 200, headers: { "Cache-Control": "no-store" }, body: mesure };
      return;
    } catch (e) {
      context.log.error("ocrMesure error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
  }

  // Route actes-match : POST /api/actes/match — « Rapprochement des actes », UN appel PAR
  // fichier. OCR (sonnet) lit N°/banque/montant/type + le marche (ref/objet/MO), cache par
  // hash, depose le blob par hash (content-addressed, PAS d'attache ici : la PATCH se fait
  // a « Attacher »). Regle 1 : PDF seulement ; plusieurs N° distincts -> refus nomme.
  // N'APPARIE PAS : l'appariement (MPMainlevee.apparierActe) tourne cote navigateur sur
  // mp_cautions + provisoires deja en memoire (source unique).
  if (fn === "actesMatch") {
    try {
      const user = getAuthenticatedUser(req);
      if (!MPMainlevee.principalAutorise(user)) { context.res = { status: 401, body: { error: "Authentification requise" } }; return; }
      if ((req.method || "GET").toUpperCase() !== "POST") { context.res = { status: 405, body: { error: "Method not allowed (use POST)" } }; return; }
      const body = req.body || {};
      const contentType = String(body.content_type || "").trim();
      const dataB64 = String(body.data_base64 || "");
      if (contentType !== "application/pdf") { context.res = { status: 400, body: { error: "Format non accepte : scannez en PDF." } }; return; }
      let buf; try { buf = Buffer.from(dataB64, "base64"); } catch (e) { buf = null; }
      if (!buf || !buf.length) { context.res = { status: 400, body: { error: "Fichier vide ou base64 invalide" } }; return; }
      if (buf.length > PV_MAX_BYTES) { context.res = { status: 400, body: { error: "Fichier trop volumineux (max 20 Mo)" } }; return; }

      const ocr = require("./lib/ocr-acte.js");
      let referentiel = [];
      try { const bs = (await getDb().container("mp_banques").items.readAll().fetchAll()).resources; referentiel = bs.map(function (b) { return b.nom || b.name || b.libelle || ""; }).filter(Boolean); } catch (e) { referentiel = []; }
      let cacheC = null;
      try { const cc = await getDb().containers.createIfNotExists({ id: "mp_ocr_cache", partitionKey: { paths: ["/id"] } }); cacheC = cc.container; } catch (e) { cacheC = null; }
      const cacheGet = cacheC ? function (cle) { return cacheC.item(cle, cle).read().then(function (r) { return r.resource; }).catch(function () { return null; }); } : null;
      const cacheSet = cacheC ? function (cle, res) { return cacheC.items.upsert({ id: cle, resultat: res, le: new Date().toISOString() }); } : null;

      const res = await ocr.lireActeRapprochement(buf, contentType, referentiel, cacheGet, cacheSet);
      if (!res.configure) { context.res = { status: 200, body: { configure: false, message: "OCR non configure (ANTHROPIC_API_KEY absente)" } }; return; }

      // Regle 1 : un fichier = un acte. Plusieurs N° distincts -> refus nomme, rien d'ecrit.
      const nums = [];
      (res.actes || []).forEach(function (a) { const n = MPMainlevee.normaliserNumCaution(a.numero); if (n && nums.indexOf(n) < 0) nums.push(n); });
      if (nums.length > 1) { context.res = { status: 200, body: { configure: true, refus: "multi_actes", nb: nums.length, message: "ce fichier contient " + nums.length + " actes — un fichier par acte" } }; return; }

      // Blob par hash (content-addressed). Pas d'attache a une caution ici.
      var blobName = "actes/" + res.hash + ".pdf";
      var acte = null;
      const conn = process.env.STORAGE_CONNECTION_STRING;
      if (conn) {
        try {
          const svc = BlobServiceClient.fromConnectionString(conn);
          const cont = svc.getContainerClient(PIECE_CONTAINER);
          await cont.createIfNotExists();
          await cont.getBlockBlobClient(blobName).uploadData(buf, { blobHTTPHeaders: { blobContentType: contentType } });
          acte = { blob: blobName, nom_original: String(body.nom_original || "acte.pdf"), taille: buf.length, content_type: contentType, depose_le: new Date().toISOString(), depose_par: user.userDetails || null };
        } catch (e) { acte = null; }
      }
      const a0 = (res.actes && res.actes[0]) || { numero: null, banque: null, montant: null, type: null, confiances: {}, lu_brut: {} };
      context.res = { status: 200, body: { configure: true, cache: !!res.cache, hash: res.hash, champs: { num: a0.numero, banque: a0.banque, montant: a0.montant, type: a0.type }, confiances: a0.confiances, lu_brut: a0.lu_brut, marche_lu: res.marche_lu, acte: acte } };
      return;
    } catch (e) {
      context.log.error("actesMatch error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
  }

  // Route caution-prov-acte : POST /api/caution-prov-acte — acte d'une PROVISOIRE (portee
  // par l'AO : a.caution_prov). Miroir de caution-acte-compare : OCR (cache hash), PATCH
  // /caution_prov/acte (patchActeProvOps -> aucun AUTRE champ de l'AO), compare caution_prov
  // vs acte -> ecarts (le client journalise). PDF seulement ; refus « deja un acte ».
  if (fn === "cautionProvActe") {
    try {
      const user = getAuthenticatedUser(req);
      if (!MPMainlevee.principalAutorise(user)) { context.res = { status: 401, body: { error: "Authentification requise" } }; return; }
      if ((req.method || "GET").toUpperCase() !== "POST") { context.res = { status: 405, body: { error: "Method not allowed (use POST)" } }; return; }
      const body = req.body || {};
      const aoId = String(body.aoId || "").trim();
      const contentType = String(body.content_type || "").trim();
      const dataB64 = String(body.data_base64 || "");
      if (!aoId) { context.res = { status: 400, body: { error: "Manquant : aoId" } }; return; }
      if (contentType !== "application/pdf") { context.res = { status: 400, body: { error: "Format non accepte : scannez en PDF." } }; return; }
      let buf; try { buf = Buffer.from(dataB64, "base64"); } catch (e) { buf = null; }
      if (!buf || !buf.length) { context.res = { status: 400, body: { error: "Fichier vide ou base64 invalide" } }; return; }
      if (buf.length > PV_MAX_BYTES) { context.res = { status: 400, body: { error: "Fichier trop volumineux (max 20 Mo)" } }; return; }

      const aosC = getDb().container("mp_aos");
      let ao = null; try { ao = (await aosC.item(aoId, aoId).read()).resource || null; } catch (e) { ao = null; }
      if (!ao || !ao.caution_prov) { context.res = { status: 404, body: { error: "AO ou caution provisoire introuvable" } }; return; }
      if (ao.caution_prov.acte) { context.res = { status: 200, body: { refus: "deja_acte", message: "cette provisoire a deja un acte (remplacement depuis la fiche)" } }; return; }

      const ocr = require("./lib/ocr-acte.js");
      let referentiel = [];
      try { const bs = (await getDb().container("mp_banques").items.readAll().fetchAll()).resources; referentiel = bs.map(function (b) { return b.nom || b.name || b.libelle || ""; }).filter(Boolean); } catch (e) { referentiel = []; }
      let cacheC = null;
      try { const cc = await getDb().containers.createIfNotExists({ id: "mp_ocr_cache", partitionKey: { paths: ["/id"] } }); cacheC = cc.container; } catch (e) { cacheC = null; }
      const cacheGet = cacheC ? function (cle) { return cacheC.item(cle, cle).read().then(function (r) { return r.resource; }).catch(function () { return null; }); } : null;
      const cacheSet = cacheC ? function (cle, res) { return cacheC.items.upsert({ id: cle, resultat: res, le: new Date().toISOString() }); } : null;

      const res = await ocr.extraireActe(buf, contentType, referentiel, cacheGet, cacheSet);
      if (!res.configure) { context.res = { status: 200, body: { configure: false, message: "OCR non configure (ANTHROPIC_API_KEY absente)" } }; return; }
      const ecarts = MPMainlevee.comparerActe(ao.caution_prov, res.champs);

      var blobName = "actes/" + res.hash + ".pdf";
      var acte = null;
      const conn = process.env.STORAGE_CONNECTION_STRING;
      if (conn) {
        try {
          const svc = BlobServiceClient.fromConnectionString(conn);
          const cont = svc.getContainerClient(PIECE_CONTAINER);
          await cont.createIfNotExists();
          await cont.getBlockBlobClient(blobName).uploadData(buf, { blobHTTPHeaders: { blobContentType: contentType } });
          acte = { blob: blobName, nom_original: String(body.nom_original || "acte.pdf"), taille: buf.length, content_type: contentType, depose_le: new Date().toISOString(), depose_par: user.userDetails || null };
          await aosC.item(aoId, aoId).patch(MPMainlevee.patchActeProvOps(acte));
        } catch (e) { acte = null; }
      }
      context.res = { status: 200, body: { configure: true, cache: !!res.cache, ecarts: ecarts, champs: res.champs, confiances: res.confiances, lu_brut: res.lu_brut || null, hash: res.hash, acte: acte } };
      return;
    } catch (e) {
      context.log.error("cautionProvActe error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
  }

  // Route data
  // Route relevés banque : GET /api/releves-banque (historique, ou ?id= pour un relevé
  // complet) ; POST /api/releves-banque { banque, periode?, nom_original, content_type,
  // data_base64, pages, corrections? } = import d'un relevé.
  // Le serveur RELIT les pages positionnées avec le MÊME module pur que l'aperçu du
  // navigateur, applique les corrections humaines (tracées), rejoue les contrôles
  // d'intégrité : un refus nommé = rien d'écrit (ni blob, ni document, ni fiche).
  // Ordre strict : contrôles -> déjà importé -> blob -> document -> « vue en banque » sur
  // chaque fiche appariée (patch du seul champ derniere_vue_banque).
  if (fn === "relevesBanque") {
    try {
      const user = getAuthenticatedUser(req);
      if (!user) { context.res = { status: 401, body: { error: "Authentification requise" } }; return; }
      const db = getDb();
      await db.containers.createIfNotExists({ id: "mp_releves_banque", partitionKey: { paths: ["/banque"] } });
      const relC = db.container("mp_releves_banque");
      const method = (req.method || "GET").toUpperCase();

      if (method === "GET") {
        const id = String((req.query && req.query.id) || "").trim();
        if (id) {
          const r = (await relC.items.query({ query: "SELECT * FROM c WHERE c.id = @id", parameters: [{ name: "@id", value: id }] }).fetchAll()).resources;
          if (!r.length) { context.res = { status: 404, body: { error: "Relevé introuvable" } }; return; }
          context.res = { status: 200, body: r[0] }; return;
        }
        const liste = (await relC.items.query("SELECT c.id, c.banque, c.periode, c.importe_le, c.importe_par, c.totaux, c.fichier, c.lecteur, c.rapprochement.compteurs AS compteurs, c.rapprochement.encours AS encours, ARRAY_LENGTH(c.corrections) AS nb_corrections FROM c").fetchAll()).resources;
        liste.sort(function (a, b) { return (a.banque + a.periode) < (b.banque + b.periode) ? -1 : 1; });
        context.res = { status: 200, body: liste }; return;
      }
      if (method !== "POST") { context.res = { status: 405, body: { error: "Method not allowed (GET ou POST)" } }; return; }

      const body = req.body || {};
      const banque = String(body.banque || "").trim();
      if (MPReleves.BANQUES.indexOf(banque) < 0) { context.res = { status: 400, body: { error: "Banque inconnue : « " + banque + " » (" + MPReleves.BANQUES.join(", ") + ")" } }; return; }
      const pages = Array.isArray(body.pages) ? body.pages : null;
      if (!pages || !pages.length) { context.res = { status: 400, body: { error: "pages (lignes positionnées extraites du PDF) manquantes" } }; return; }

      // (1) Lecture + corrections humaines (tracées) + contrôles. Un refus = rien d'écrit.
      const lecture = MPReleves.lire(banque, pages);
      const corrections = Array.isArray(body.corrections) ? body.corrections : [];
      const trace = MPReleves.appliquerCorrections(lecture, corrections, user.userDetails || null);
      if (!lecture.controle.ok) {
        context.res = { status: 409, body: { refus: lecture.controle.refus, code: lecture.controle.refus[0].code, lecture: { lignes: lecture.lignes, ecartes: lecture.ecartes, totaux: lecture.totaux, periode: lecture.periode } } };
        return;
      }
      const periode = lecture.periode || String(body.periode || "").trim();
      if (!MPReleves.periodeValide(periode)) { context.res = { status: 409, body: { refus: [{ code: "PERIODE_ABSENTE", detail: "période non lue dans le document : saisir le mois (AAAA-MM)" }], code: "PERIODE_ABSENTE", lecture: { lignes: lecture.lignes, ecartes: lecture.ecartes, totaux: lecture.totaux, periode: null } } }; return; }

      // (2) Même banque + même période = refus.
      const deja = (await relC.items.query({ query: "SELECT c.id, c.banque, c.periode FROM c WHERE c.banque = @b AND c.periode = @p", parameters: [{ name: "@b", value: banque }, { name: "@p", value: periode }] }).fetchAll()).resources;
      if (MPReleves.dejaImporte(deja, banque, periode)) { context.res = { status: 409, body: { refus: [{ code: "RELEVE_DEJA_IMPORTE", detail: "un relevé " + banque + " pour " + periode + " est déjà importé" }], code: "RELEVE_DEJA_IMPORTE" } }; return; }

      // (3) Rapprochement avec nos cautions de la banque + provisoires portées par les AO.
      const cautions = (await db.container("mp_cautions").items.query({ query: "SELECT * FROM c WHERE c.banque = @b", parameters: [{ name: "@b", value: banque }] }).fetchAll()).resources;
      const aos = (await db.container("mp_aos").items.query({ query: "SELECT * FROM c WHERE IS_DEFINED(c.caution_prov) AND c.caution_prov.banque = @b", parameters: [{ name: "@b", value: banque }] }).fetchAll()).resources;
      const marches = (await db.container("mp_marches").items.query("SELECT c.id, c.ref, c.maitre_ouvrage FROM c").fetchAll()).resources;
      const parId = {}; marches.forEach(function (m) { parId[m.id] = m; });
      const rapp = MPReleves.rapprocher(lecture, cautions, aos.map(function (a) { return { ao: a }; }), function (id) { return parId[id]; }, periode);

      // (4) Blob du PDF tel que reçu (facultatif si l'appelant n'a envoyé que les pages).
      const releveId = "rel_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
      let fichier = null;
      const dataB64 = String(body.data_base64 || "");
      if (dataB64) {
        const contentType = String(body.content_type || "application/pdf");
        if (contentType !== "application/pdf") { context.res = { status: 400, body: { error: "content_type non autorisé (PDF uniquement)" } }; return; }
        let buf; try { buf = Buffer.from(dataB64, "base64"); } catch (e) { buf = null; }
        if (!buf || !buf.length) { context.res = { status: 400, body: { error: "Fichier vide ou base64 invalide" } }; return; }
        if (buf.length > PV_MAX_BYTES) { context.res = { status: 400, body: { error: "Fichier trop volumineux (max 20 Mo)" } }; return; }
        const conn = process.env.STORAGE_CONNECTION_STRING;
        if (!conn) { context.res = { status: 500, body: { error: "STORAGE_CONNECTION_STRING non configure cote serveur" } }; return; }
        const blobName = banque.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "/" + periode + "/" + releveId + ".pdf";
        const cont = BlobServiceClient.fromConnectionString(conn).getContainerClient(RELEVE_CONTAINER);
        await cont.createIfNotExists();
        await cont.getBlockBlobClient(blobName).uploadData(buf, { blobHTTPHeaders: { blobContentType: contentType } });
        fichier = { blob: blobName, nom_original: String(body.nom_original || "releve.pdf"), taille: buf.length, content_type: contentType };
      }

      // (5) Document du relevé (lignes, totaux, rapprochement avec fiches réduites).
      const fiche = function (f) { return f ? { kind: f.kind, id: f.id, aoId: f.aoId || null, marcheId: f.marcheId || null, num: f.num, referenceBanque: f.referenceBanque, type: f.type, montant: f.montant, statut: f.statut, marche_ref: f.marche_ref, beneficiaire: f.beneficiaire, date_emission: f.date_emission } : null; };
      const reduire = function (x) { return { ligne: x.ligne, fiche: fiche(x.fiche), via: x.via, ecart_montant: x.ecart_montant, date_mainlevee: x.date_mainlevee || null, date_liberation: x.date_liberation || null, mois_depuis_mainlevee: (x.mois_depuis_mainlevee === undefined ? null : x.mois_depuis_mainlevee), commission_relevee: (x.commission_relevee === undefined ? null : x.commission_relevee), motif: x.motif || null }; };
      const doc = {
        id: releveId, banque: banque, periode: periode, lecteur: lecture.lecteur,
        importe_le: new Date().toISOString(), importe_par: user.userDetails || null,
        fichier: fichier, totaux: lecture.totaux, lignes: lecture.lignes, ecartes: lecture.ecartes, corrections: trace,
        rapprochement: { periode: rapp.periode, compteurs: rapp.compteurs, encours: rapp.encours, a: rapp.a.map(reduire), b: rapp.b.map(reduire), c: rapp.c.map(reduire), inconnues: rapp.inconnues.map(reduire) }
      };
      await relC.items.upsert(doc);

      // (6) « Vue en banque <période> » sur chaque fiche appariée (a et b).
      let vues = 0;
      const items = rapp.a.concat(rapp.b);
      for (let i = 0; i < items.length; i++) {
        const f = items[i].fiche;
        try {
          if (f.kind === "caution") {
            const actuelle = (cautions.filter(function (c) { return c.id === f.id; })[0] || {}).derniere_vue_banque || null;
            await db.container("mp_cautions").item(f.id, f.marcheId).patch([{ op: "add", path: "/derniere_vue_banque", value: MPReleves.vueEnBanque(actuelle, periode, releveId) }]);
          } else {
            const ao = aos.filter(function (a) { return a.id === f.aoId; })[0];
            const actuelleP = (ao && ao.caution_prov && ao.caution_prov.derniere_vue_banque) || null;
            await db.container("mp_aos").item(f.aoId, f.aoId).patch([{ op: "add", path: "/caution_prov/derniere_vue_banque", value: MPReleves.vueEnBanque(actuelleP, periode, releveId) }]);
          }
          vues++;
        } catch (e) { context.log.warn("relevesBanque: vue en banque non posée sur " + f.id + " : " + e.message); }
      }
      context.res = { status: 201, body: { ok: true, releve: doc, vues_posees: vues } };
      return;
    } catch (e) {
      context.log.error("relevesBanque error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
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
