const { onRequest } = require("firebase-functions/v2/https");
const { GoogleAuth } = require("google-auth-library");

exports.embedBatch = onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).send("");
  if (req.method !== "POST") return res.status(405).send("POST only");

  let { contents } = req.body;
  if (!contents) return res.status(400).json({ error: "Missing contents" });
  if (typeof contents === "string") contents = [contents];
  if (!Array.isArray(contents) || contents.length === 0) {
    return res.status(400).json({ error: "Invalid contents" });
  }

  try {
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/generative-language"],
    });
    const client = await auth.getClient();
    const { token: accessToken } = await client.getAccessToken();
    if (!accessToken) throw new Error("Failed to obtain access token");

    const body = {
      requests: contents.map((text) => ({
        model: "models/text-embedding-004",
        content: { parts: [{ text }] },
        outputDimensionality: 768,
      })),
    };

    const resp = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const data = await resp.json();
    
    if (!resp.ok) {
      return res.status(resp.status).json(data);
    }
    
    // Extract embeddings from the API response
    const all = (data.embeddings || []).map((embedding) => embedding.values || []);
    
    return res.status(200).json({ embeddings: all.map((values) => ({ values })) });
  } catch (err) {
    console.error("embedBatch error:", err);
    return res.status(500).json({ error: err.message || String(err) });
  }
});