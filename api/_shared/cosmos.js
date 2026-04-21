// ═══════════════════════════════════════════════════════════════════════════
// Neurones MP — Helper Cosmos (connection string, Session 1 validated)
// ═══════════════════════════════════════════════════════════════════════════

const { CosmosClient } = require("@azure/cosmos");

const CONNECTION = process.env.COSMOS_CONNECTION_STRING;
const DATABASE = process.env.COSMOS_DATABASE || "btp-pointage";

let _client = null;
let _db = null;

function getClient() {
  if (_client) return { client: _client, db: _db };
  if (!CONNECTION) {
    throw new Error("COSMOS_CONNECTION_STRING not configured");
  }
  _client = new CosmosClient(CONNECTION);
  _db = _client.database(DATABASE);
  return { client: _client, db: _db };
}

function getContainer(name) {
  return getClient().db.container(name);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

function cors(context, req) {
  if (req.method === "OPTIONS") {
    context.res = { status: 204, headers: corsHeaders };
    return true;
  }
  return false;
}

function respond(context, status, body) {
  context.res = {
    status,
    headers: corsHeaders,
    body: body !== undefined ? body : null,
  };
}

function handleError(context, err, operation) {
  if (err.code === 404) {
    respond(context, 200, null);
    return;
  }
  context.log.error("[Cosmos] Error " + (operation || "operation") + ":", err.message);
  respond(context, 500, {
    error: "Erreur " + (operation || "operation"),
    detail: err.message,
  });
}

async function readAll(containerName, options) {
  const opts = options || {};
  const container = getContainer(containerName);
  const query = {
    query: opts.filter ? "SELECT * FROM c WHERE " + opts.filter : "SELECT * FROM c",
    parameters: opts.parameters || [],
  };
  const { resources } = await container.items.query(query).fetchAll();
  return resources;
}

async function readOne(containerName, id, partitionKey) {
  const container = getContainer(containerName);
  try {
    const { resource } = await container.item(id, partitionKey).read();
    return resource;
  } catch (err) {
    if (err.code === 404) return null;
    throw err;
  }
}

async function upsert(containerName, item) {
  const container = getContainer(containerName);
  const { resource } = await container.items.upsert(item);
  return resource;
}

async function remove(containerName, id, partitionKey) {
  const container = getContainer(containerName);
  await container.item(id, partitionKey).delete();
}

function generateId(prefix) {
  const p = prefix || "doc";
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).substring(2, 8);
  return p + "_" + ts + "_" + rnd;
}

module.exports = {
  getClient,
  getContainer,
  cors,
  corsHeaders,
  respond,
  handleError,
  readAll,
  readOne,
  upsert,
  remove,
  generateId,
};
