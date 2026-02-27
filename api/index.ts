import "dotenv/config";
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
    redisConfigured: !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
    geminiConfigured: !!process.env.GEMINI_API_KEY,
    timestamp: new Date().toISOString()
  });
});

// --- Upstash Redis Cache ---
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = redisUrl && redisToken
  ? new Redis({ url: redisUrl, token: redisToken })
  : null;

if (redis) {
  console.log("[Redis] Initialized successfully");
} else {
  console.log("[Redis] Missing credentials, using memory cache fallback");
}

// Fallback memory cache for local development if Upstash is not configured
let memoryCache: Record<string, {zh: string, en: string}> = {};

app.get(['/api/cache/roast', '/cache/roast'], async (req, res) => {
  const { teamId, gw, mode } = req.query;
  const key = `fpl_roast:${String(teamId)}_${String(gw)}_${String(mode)}`;
  
  console.log(`[Cache] GET attempt for key: ${key}`);

  if (redis) {
    try {
      const data = await redis.get(key);
      if (data) {
        console.log(`[Cache] Redis HIT for ${key}`);
        return res.json(data);
      }
      console.log(`[Cache] Redis MISS for ${key}`);
    } catch (e) {
      console.error("[Cache] Redis get error:", e);
    }
  } else if (memoryCache[key]) {
    console.log(`[Cache] Memory HIT for ${key}`);
    return res.json(memoryCache[key]);
  }
  
  console.log(`[Cache] MISS for ${key}`);
  res.status(404).json({ error: 'Not found' });
});

app.post(['/api/cache/roast', '/cache/roast'], async (req, res) => {
  const { teamId, gw, mode, zh, en } = req.body;
  const key = `fpl_roast:${String(teamId)}_${String(gw)}_${String(mode)}`;
  const data = { zh, en };
  
  console.log(`[Cache] POST saving for key: ${key}`);

  if (redis) {
    try {
      await redis.set(key, data);
      console.log(`[Cache] Redis SET success for ${key}`);
    } catch (e) {
      console.error("[Cache] Redis set error:", e);
    }
  } else {
    memoryCache[key] = data;
    console.log(`[Cache] Memory SET success for ${key}`);
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
      console.error(`FPL API error: ${response.status} for ${url}`);
      const errorText = text.slice(0, 200);
      throw { status: response.status, message: `FPL API error: ${response.status}`, details: errorText };
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

// Only listen if NOT running in Vercel serverless environment
if (!process.env.VERCEL && process.env.NODE_ENV === "production") {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

export default app;
