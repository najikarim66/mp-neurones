/* ============================================================================
 * MIGRATION — référence banque COMPLÈTE sur les 9 cautions BMCE (décision Karim 23/10/2026).
 *
 * Source : « Liste des cautions » BMCE Bank, agence 81001 Centre Affaires Rabat, reçue le
 * 23/10/2026 (10 dossiers ; la provisoire 780002621000790909 de l'AO 21/ANEF/2026 n'a pas
 * de fiche chez nous : elle n'est PAS migrée ici, elle est à créer dans MP Manager).
 *
 * Pour chaque ligne : la fiche mp_cautions de banque BMCE dont l'ALIAS (c.num, normalisé,
 * zéros de tête ignorés) termine la référence banque, du même type et du même montant.
 * Écrit UNIQUEMENT le champ /referenceBanque (patch Cosmos, aucun autre champ touché) ;
 * c.num reste tel quel (alias). Une fiche qui porte déjà une référence différente n'est
 * pas écrasée : elle est SIGNALÉE.
 *
 * DRY-RUN par défaut (liste nominative, rien d'écrit). --apply pour écrire.
 * Aucun secret imprimé : la connection string vient de l'environnement.
 *
 * Lancer (secret en variable d'env, jamais en ligne de commande) :
 *   node api/scripts/mp-reference-banque-bmce.js            (dry-run)
 *   node api/scripts/mp-reference-banque-bmce.js --apply    (écrit, tracé)
 * ========================================================================== */
'use strict';
const { CosmosClient } = require("@azure/cosmos");
const MPM = require("../pv-mainlevee.js");

const APPLY = process.argv.indexOf("--apply") >= 0;
const conn = process.env.COSMOS_CONNECTION_STRING;
const dbName = process.env.COSMOS_DATABASE || "btp-pointage";
if (!conn) { console.error("COSMOS_CONNECTION_STRING absente de l'env — rien fait."); process.exit(1); }

// Lignes de la liste BMCE telles qu'écrites par la banque (référence, nature, montant).
const LISTE_BMCE = [
  { ref: "810012022000191999", type: "bonne_execution",  montant: 168837,   marche: "23/UMVR/2020" },
  { ref: "81001122200450",     type: "bonne_execution",  montant: 13154.04, marche: "27/2012" },
  { ref: "81001122200264",     type: "bonne_execution",  montant: 12683.77, marche: "18/2012" },
  { ref: "810012624000766977", type: "retenue_garantie", montant: 6624,     marche: "04/INDH/2025" },
  { ref: "810012624000694066", type: "retenue_garantie", montant: 13088,    marche: "75/2024" },
  { ref: "810012124000246446", type: "retenue_garantie", montant: 23193,    marche: "26/2019" },
  { ref: "81001132403238",     type: "retenue_garantie", montant: 16587,    marche: "27/2012" },
  { ref: "81001132403237",     type: "retenue_garantie", montant: 3534,     marche: "27/2012" },
  { ref: "81001122400650",     type: "retenue_garantie", montant: 29596,    marche: "18/2012" }
];

function aliasTermine(ref, alias) {
  const r = MPM.normaliserNumCaution(ref), a = MPM.normaliserNumCaution(alias).replace(/^0+/, "");
  return !!a && r.endsWith(a);
}

(async function () {
  const db = new CosmosClient(conn).database(dbName);
  const cont = db.container("mp_cautions");
  const bmce = (await cont.items.query("SELECT c.id, c.marcheId, c.num, c.referenceBanque, c.type, c.montant, c.statut, c.banque FROM c WHERE CONTAINS(UPPER(c.banque), 'BMCE')").fetchAll()).resources;
  const marches = (await db.container("mp_marches").items.query("SELECT c.id, c.ref FROM c").fetchAll()).resources;
  const refM = {}; marches.forEach(function (m) { refM[m.id] = m.ref; });

  const aEcrire = [], dejaOk = [], signales = [], sansFiche = [];
  const pris = {};
  LISTE_BMCE.forEach(function (l) {
    const hits = bmce.filter(function (c) { return !pris[c.id] && c.type === l.type && aliasTermine(l.ref, c.num) && Math.round(+c.montant * 100) === Math.round(l.montant * 100); });
    if (hits.length !== 1) { sansFiche.push({ l: l, n: hits.length }); return; }
    const c = hits[0]; pris[c.id] = true;
    const ligne = { c: c, ref: l.ref, marche: refM[c.marcheId] || "marché inconnu" };
    if (c.referenceBanque && MPM.normaliserNumCaution(c.referenceBanque) === MPM.normaliserNumCaution(l.ref)) dejaOk.push(ligne);
    else if (c.referenceBanque) signales.push(ligne);
    else aEcrire.push(ligne);
  });
  const nonListees = bmce.filter(function (c) { return !pris[c.id]; });

  console.log("=== MIGRATION referenceBanque BMCE (" + (APPLY ? "APPLY" : "DRY-RUN") + ") ===");
  console.log("lignes BMCE : " + LISTE_BMCE.length + " · fiches BMCE lues : " + bmce.length + " · à écrire : " + aEcrire.length + " · déjà conformes : " + dejaOk.length + " · signalées : " + signales.length + " · sans fiche : " + sansFiche.length + "\n");
  aEcrire.forEach(function (x) { console.log("  ECRIRE  alias " + x.c.num + " -> referenceBanque " + x.ref + "  | " + x.marche + " · " + x.c.type + " · " + x.c.montant + " · " + x.c.statut); });
  dejaOk.forEach(function (x) { console.log("  OK      alias " + x.c.num + " porte déjà " + x.ref + "  | " + x.marche); });
  signales.forEach(function (x) { console.log("  SIGNALE alias " + x.c.num + " porte " + x.c.referenceBanque + " ≠ banque " + x.ref + "  | " + x.marche + " — NON écrasé, à trancher"); });
  sansFiche.forEach(function (x) { console.log("  SANS FICHE " + x.l.ref + " (" + x.l.type + ", " + x.l.montant + ", " + x.l.marche + ") : " + x.n + " fiche(s) candidate(s)"); });
  if (nonListees.length) {
    console.log("\n--- fiches BMCE hors liste (motif attendu : libérées, sorties de l'encours) ---");
    nonListees.forEach(function (c) { console.log("  " + c.num + " · " + (refM[c.marcheId] || "marché inconnu") + " · " + c.type + " · " + c.statut); });
  }

  if (APPLY && aEcrire.length) {
    console.log("");
    for (let i = 0; i < aEcrire.length; i++) {
      const x = aEcrire[i];
      await cont.item(x.c.id, x.c.marcheId).patch([{ op: "add", path: "/referenceBanque", value: x.ref }]);
      console.log("  ECRIT   alias " + x.c.num + " -> " + x.ref);
    }
    console.log("\n" + aEcrire.length + " fiche(s) mise(s) à jour (champ referenceBanque seul).");
  } else if (!APPLY) {
    console.log("\nDRY-RUN : rien écrit. Relancer avec --apply pour écrire les " + aEcrire.length + " fiche(s).");
  }
})().catch(function (e) { console.error("ERREUR", e.code || "", String(e.message || e).split("\n")[0].slice(0, 200)); process.exit(1); });
