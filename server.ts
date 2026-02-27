import express from "express";
import { createServer as createViteServer } from "vite";
import fs from "fs/promises";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- Simple File-Based Cache for Preview Environment ---
// In production on Vercel, you should replace this with Vercel KV (Redis)
const CACHE_FILE = path.join(process.cwd(), 'roast_cache.json');
let memoryCache: Record<string, {zh: string, en: string}> = {};

// Load cache on startup
fs.readFile(CACHE_FILE, 'utf-8')
  .then(data => { memoryCache = JSON.parse(data); })
  .catch(() => { console.log("No existing cache file found, starting fresh."); });

const saveCache = async () => {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(memoryCache), 'utf-8');
  } catch (e) {
    console.error("Failed to save cache to disk", e);
  }
};

app.get('/api/cache/roast', (req, res) => {
  const { teamId, gw, mode } = req.query;
  const key = `${teamId}_${gw}_${mode}`;
  if (memoryCache[key]) {
    res.json(memoryCache[key]);
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.post('/api/cache/roast', async (req, res) => {
  const { teamId, gw, mode, zh, en } = req.body;
  const key = `${teamId}_${gw}_${mode}`;
  memoryCache[key] = { zh, en };
  await saveCache();
  res.json({ success: true });
});
// -------------------------------------------------------

// Helper function to fetch from FPL API
const fetchFPL = async (url: string) => {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://fantasy.premierleague.com/'
    }
  });
  
  const text = await response.text();
  
  if (text.includes("The game is being updated.")) {
    throw { status: 503, message: "The FPL game is currently being updated. Please try again later." };
  }
  
  if (!response.ok) {
    throw { status: response.status, message: `FPL API error: ${response.status}`, details: text };
  }
  
  try {
    return JSON.parse(text);
  } catch (e) {
    throw { status: 500, message: "Failed to parse FPL API response", details: text };
  }
};

// API routes
app.get("/api/fpl/bootstrap", async (req, res) => {
  try {
    const data = await fetchFPL("https://fantasy.premierleague.com/api/bootstrap-static/");
    res.json(data);
  } catch (error: any) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message || "Failed to fetch bootstrap data" });
  }
});

app.get("/api/fpl/entry/:id/history", async (req, res) => {
  try {
    const data = await fetchFPL(`https://fantasy.premierleague.com/api/entry/${req.params.id}/history/`);
    res.json(data);
  } catch (error: any) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message || "Failed to fetch history data" });
  }
});

app.get("/api/fpl/entry/:id/transfers", async (req, res) => {
  try {
    const data = await fetchFPL(`https://fantasy.premierleague.com/api/entry/${req.params.id}/transfers/`);
    res.json(data);
  } catch (error: any) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message || "Failed to fetch transfers data" });
  }
});

app.get("/api/fpl/entry/:id/event/:gw/picks", async (req, res) => {
  try {
    const data = await fetchFPL(`https://fantasy.premierleague.com/api/entry/${req.params.id}/event/${req.params.gw}/picks/`);
    res.json(data);
  } catch (error: any) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message || "Failed to fetch picks data" });
  }
});

app.get("/api/fpl/event/:gw/live", async (req, res) => {
  try {
    const data = await fetchFPL(`https://fantasy.premierleague.com/api/event/${req.params.gw}/live/`);
    res.json(data);
  } catch (error: any) {
    console.error(error);
    res.status(error.status || 500).json({ error: error.message || "Failed to fetch live data" });
  }
});

// Vite middleware for development or Static serving for production
if (process.env.NODE_ENV !== "production") {
  createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  }).then((vite) => {
    app.use(vite.middlewares);
    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
} else {
  // In production, serve static files from dist
  app.use(express.static("dist"));
  
  // Only listen if NOT running in Vercel serverless environment
  if (!process.env.VERCEL) {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  }
}

export default app;
