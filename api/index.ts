import express from "express";
import { Redis } from '@upstash/redis';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Request logger
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Add a simple health check for the API
app.get(["/api/health", "/health"], (req, res) => {
  res.json({ 
    status: "ok", 
    env: process.env.NODE_ENV, 
    vercel: !!process.env.VERCEL,
    timestamp: new Date().toISOString()
  });
});

// --- Upstash Redis Cache ---
// Initialize Redis client if environment variables are present
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
  : null;

// Fallback memory cache for local development if Upstash is not configured
let memoryCache: Record<string, {zh: string, en: string}> = {};

app.get(['/api/cache/roast', '/cache/roast'], async (req, res) => {
  const { teamId, gw, mode } = req.query;
  const key = `fpl_roast:${teamId}_${gw}_${mode}`;
  
  if (redis) {
    try {
      const data = await redis.get(key);
      if (data) {
        return res.json(data);
      }
    } catch (e) {
      console.error("Redis get error:", e);
    }
  } else if (memoryCache[key]) {
    return res.json(memoryCache[key]);
  }
  
  res.status(404).json({ error: 'Not found' });
});

app.post(['/api/cache/roast', '/cache/roast'], async (req, res) => {
  const { teamId, gw, mode, zh, en } = req.body;
  const key = `fpl_roast:${teamId}_${gw}_${mode}`;
  const data = { zh, en };
  
  if (redis) {
    try {
      await redis.set(key, data);
    } catch (e) {
      console.error("Redis set error:", e);
    }
  } else {
    memoryCache[key] = data;
  }
  
  res.json({ success: true });
});
// -------------------------------------------------------

// Helper function to fetch from FPL API
const fetchFPL = async (url: string) => {
  console.log(`Fetching FPL: ${url}`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://fantasy.premierleague.com/'
      }
    });
    
    clearTimeout(timeoutId);
    const text = await response.text();
    
    if (text.includes("The game is being updated.")) {
      throw { status: 503, message: "The FPL game is currently being updated. Please try again later." };
    }
    
    if (!response.ok) {
      console.error(`FPL API error: ${response.status}`, text.slice(0, 200));
      throw { status: response.status, message: `FPL API error: ${response.status}`, details: text.slice(0, 500) };
    }
    
    return JSON.parse(text);
  } catch (e: any) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      throw { status: 504, message: "FPL API request timed out" };
    }
    throw e;
  }
};

// API routes
app.get(["/api/fpl/bootstrap", "/fpl/bootstrap"], async (req, res) => {
  try {
    const data = await fetchFPL("https://fantasy.premierleague.com/api/bootstrap-static/");
    res.json(data);
  } catch (error: any) {
    console.error("Bootstrap error:", error);
    res.status(error.status || 500).json({ 
      error: error.message || "Failed to fetch bootstrap data",
      details: error.details || error.stack || String(error)
    });
  }
});

app.get(["/api/fpl/entry/:id/history", "/fpl/entry/:id/history"], async (req, res) => {
  try {
    const data = await fetchFPL(`https://fantasy.premierleague.com/api/entry/${req.params.id}/history/`);
    res.json(data);
  } catch (error: any) {
    console.error("History error:", error);
    res.status(error.status || 500).json({ 
      error: error.message || "Failed to fetch history data",
      details: error.details || error.stack || String(error)
    });
  }
});

app.get(["/api/fpl/entry/:id/transfers", "/fpl/entry/:id/transfers"], async (req, res) => {
  try {
    const data = await fetchFPL(`https://fantasy.premierleague.com/api/entry/${req.params.id}/transfers/`);
    res.json(data);
  } catch (error: any) {
    console.error("Transfers error:", error);
    res.status(error.status || 500).json({ error: error.message || "Failed to fetch transfers data" });
  }
});

app.get(["/api/fpl/entry/:id/event/:gw/picks", "/fpl/entry/:id/event/:gw/picks"], async (req, res) => {
  try {
    const data = await fetchFPL(`https://fantasy.premierleague.com/api/entry/${req.params.id}/event/${req.params.gw}/picks/`);
    res.json(data);
  } catch (error: any) {
    console.error("Picks error:", error);
    res.status(error.status || 500).json({ error: error.message || "Failed to fetch picks data" });
  }
});

app.get(["/api/fpl/event/:gw/live", "/fpl/event/:gw/live"], async (req, res) => {
  try {
    const data = await fetchFPL(`https://fantasy.premierleague.com/api/event/${req.params.gw}/live/`);
    res.json(data);
  } catch (error: any) {
    console.error("Live error:", error);
    res.status(error.status || 500).json({ error: error.message || "Failed to fetch live data" });
  }
});

// Vite middleware for development
if (process.env.NODE_ENV !== "production") {
  import("vite").then(({ createServer: createViteServer }) => {
    createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    }).then((vite) => {
      app.use(vite.middlewares);
      app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
      });
    });
  });
} else {
  // Only listen if NOT running in Vercel serverless environment
  if (!process.env.VERCEL) {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  }
}

export default app;
