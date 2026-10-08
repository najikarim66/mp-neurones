/* ============================================================================
 * OP de mise en coherence — statut « termine » des marches (regle Karim 08/10).
 *
 * Applique la MEME logique pure que la prod (MPMainlevee.appliquerStatutMarche) aux
 * marches existants : toutes cautions terminales (liberee/restituee) + >=1 liberee + PV
 * de reception definitive present -> marche « termine », trace. Reversible : un marche
 * « termine » dont une caution n'est plus terminale redevient « en cours ».
 *
 * DRY-RUN par defaut (ne fait que LISTER). --apply pour ecrire (tracé). Signale a part
 * les marches « toutes cautions liberees MAIS PV absent » (ne terminent pas — anomalie).
 * Aucune valeur de secret imprimee (connection string lue dans l'env).
 *
 * Lancer :
 *   COSMOS_CONNECTION_STRING=... COSMOS_DATABASE=btp-pointage node api/scripts/mp-coherence-marche-termine.js
 *   ... node api/scripts/mp-coherence-marche-termine.js --apply
 * ========================================================================== */
'use strict';
const { CosmosClient } = require("@azure/cosmos");
const MPM = require("../pv-mainlevee.js");

const APPLY = process.argv.indexOf("--apply") >= 0;
const conn = process.env.COSMOS_CONNECTION_STRING;
const dbName = process.env.COSMOS_DATABASE || "btp-pointage";
if (!conn) { console.error("COSMOS_CONNECTION_STRING absent de l'env — rien fait."); process.exit(1); }

(async function () {
  const db = new CosmosClient(conn).database(dbName);
  const ms = (await db.container("mp_marches").items.query("SELECT * FROM c").fetchAll()).resources;
  const cs = (await db.container("mp_cautions").items.query("SELECT c.marcheId,c.num,c.type,c.statut FROM c").fetchAll()).resources;
  const byM = {};
  cs.forEach(function (x) { (byM[x.marcheId] = byM[x.marcheId] || []).push(x); });
  const today = new Date().toISOString().slice(0, 10);

  const aChanger = [], anomalies = [];
  ms.forEach(function (m) {
    const cl = byM[m.id] || [];
    const maj = MPM.appliquerStatutMarche(m, cl, today);
    if (maj) aChanger.push({ m: m, maj: maj, n: cl.length });
    const terminal = cl.length && cl.every(function (c) { return c.statut === "liberee" || c.statut === "restituee"; }) && cl.some(function (c) { return c.statut === "liberee"; });
    if (terminal && m.reception_definitive_prononcee !== true && m.statut !== "termine") anomalies.push(m);
  });

  console.log("=== OP mise en coherence : marche termine auto (" + (APPLY ? "APPLY" : "DRY-RUN") + ") ===");
  console.log("marches: " + ms.length + " | a changer: " + aChanger.length + " | anomalies PV-absent: " + anomalies.length + "\n");
  aChanger.forEach(function (x) {
    console.log("  [" + (x.m.ref || x.m.id) + "] " + x.m.statut + " -> " + x.maj.statut + "  | trace: " + x.maj.termine_trace + "  | " + x.n + " caution(s)");
  });
  if (anomalies.length) {
    console.log("\n--- SIGNALE (toutes cautions liberees MAIS PV reception definitive ABSENT -> NON termine) ---");
    anomalies.forEach(function (m) { console.log("  [" + (m.ref || m.id) + "] statut=" + m.statut + " — verifier pourquoi libere sans PV"); });
  }

  if (APPLY && aChanger.length) {
    const c = db.container("mp_marches");
    for (let i = 0; i < aChanger.length; i++) {
      await c.items.upsert(aChanger[i].maj);
      console.log("  ECRIT [" + (aChanger[i].m.ref || aChanger[i].m.id) + "] -> " + aChanger[i].maj.statut);
    }
    console.log("\n" + aChanger.length + " marche(s) mis a jour (tracé).");
  } else if (!APPLY) {
    console.log("\n(DRY-RUN — rien ecrit. Relancer avec --apply pour appliquer.)");
  }
})().catch(function (e) { console.error("ERREUR:", e.message); process.exit(2); });
