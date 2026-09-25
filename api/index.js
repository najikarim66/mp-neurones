const { CosmosClient } = require("@azure/cosmos");
const { BlobServiceClient } = require("@azure/storage-blob");
// Regle metier PV -> mainlevee. Copie committee de public/pv-mainlevee.js
// (SWA deploie /api et /public separement). Identite garantie par
// test/module-copy.test.js (gate). Une seule regle, testee telle qu'elle sert.
const MPMainlevee = require("./pv-mainlevee.js");

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

      // Reponse : libelles humains uniquement (jamais l'id ni le chemin blob).
      context.res = {
        status: 200,
        body: {
          ok: true,
          marche: marche.ref,
          date_reception_definitive_reelle: dateReelle,
          cautions_basculees: batch.count,
          montant_bascule: batch.total
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
      if (!MPMainlevee.pieceRecevable(caution, pieceType)) {
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
      const maj = MPMainlevee.appliquerPiece(caution, pieceType, pieceRef, dateReelle);
      await cautionsC.items.upsert(maj);

      context.res = {
        status: 200,
        body: { ok: true, caution: maj.num, nouveau_statut: maj.statut, date: dateReelle }
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

      context.res = { status: 200, body: { ok: true, caution: maj.num, statut: maj.statut, liberation_par: maj.liberation_par, motif: maj.liberation_motif } };
      return;
    } catch (e) {
      context.log.error("cautionLiberationDirecte error:", e.message);
      context.res = { status: 500, body: { error: e.message } };
      return;
    }
  }

  // Route marche-autolink : POST /api/marche-autolink
  // Sort l'appel ERP du bundle (le secret quitte le JS livre). Auth Entra obligatoire
  // (comme pv-reception). FAIL-CLOSED : si MP_AUTOLINK_SECRET absent -> 401, jamais
  // d'appel ERP sans secret. L'erreur ERP est RELAYEE (jamais avalee). Le secret vient
  // de process.env, aucune valeur en dur cote client ni ici.
  if (fn === "marcheAutolink") {
    try {
      const user = getAuthenticatedUser(req);
      if (!MPMainlevee.principalAutorise(user)) { context.res = { status: 401, body: { error: "Authentification requise" } }; return; }
      if ((req.method || "GET").toUpperCase() !== "POST") { context.res = { status: 405, body: { error: "Method not allowed (use POST)" } }; return; }

      const secret = process.env.MP_AUTOLINK_SECRET;
      if (!MPMainlevee.autolinkConfigure(secret)) {
        context.res = { status: 401, body: { code: "autolink_non_configure", error: "Rattachement ERP non configure (MP_AUTOLINK_SECRET absent) — fail-closed, aucun appel ERP" } };
        return;
      }

      const body = req.body || {};
      const marche_id = String(body.marche_id || "").trim();
      const maitre_ouvrage = String(body.maitre_ouvrage || "").trim();
      if (!marche_id || !maitre_ouvrage) { context.res = { status: 400, body: { error: "Manquant : marche_id, maitre_ouvrage" } }; return; }

      const doFetch = (typeof globalThis.fetch === "function") ? globalThis.fetch : require("node-fetch");
      let erpResp, erpText;
      try {
        erpResp = await doFetch("https://erp.neurones.ma/api/marches-mp/auto-link-or-create-client", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-MP-Autolink-Secret": secret },
          body: JSON.stringify({ marche_id: marche_id, maitre_ouvrage: maitre_ouvrage, ville: body.ville || null, lieu_chantier: body.lieu_chantier || null })
        });
        erpText = await erpResp.text();
      } catch (e) {
        context.res = { status: 502, body: { error: "ERP injoignable : " + e.message } };
        return;
      }
      if (!erpResp.ok) {
        // Erreur ERP RELAYEE (jamais avalee) — libelle humain cote ecran.
        context.res = { status: 502, body: { error: "L'ERP a refuse l'autolink (HTTP " + erpResp.status + ")", detail: String(erpText || "").slice(0, 300) } };
        return;
      }
      let data = null; try { data = JSON.parse(erpText); } catch (e) { data = null; }
      context.res = { status: 200, body: data || { ok: true } };
      return;
    } catch (e) {
      context.log.error("marcheAutolink error:", e.message);
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
