module.exports = async function (context, req) {
  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: { ok: true, now: new Date().toISOString(), hasCosmosEnv: !!process.env.COSMOS_CONNECTION_STRING }
  };
};
