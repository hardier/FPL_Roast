import "dotenv/config";
import express from "express";
import { Redis } from '@upstash/redis';
import { GoogleGenAI, Type } from '@google/genai';

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

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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

// Helper to fetch with Redis cache
const fetchWithCache = async (url: string, cacheKey: string, ttlSeconds: number) => {
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (e) {
      console.error("[FPL Cache] Redis get error:", e);
    }
  }

  const data = await fetchFPL(url);

  if (redis) {
    try {
      await redis.set(cacheKey, data, { ex: ttlSeconds });
    } catch (e) {
      console.error("[FPL Cache] Redis set error:", e);
    }
  }

  return data;
};

// Generate Roast Logic
const generateRoastForGW = async (teamId: number, gw: number, mode: 'roast' | 'compliment') => {
  const cacheKey = `fpl_roast:${teamId}_${gw}_${mode}`;
  
  // 1. Check Cache
  if (redis) {
    const cached = await redis.get(cacheKey);
    if (cached) return cached;
  } else if (memoryCache[cacheKey]) {
    return memoryCache[cacheKey];
  }

  console.log(`[Gemini] Generating ${mode} for team ${teamId} GW ${gw}`);

  // 2. Fetch required FPL data
  const [bootstrap, history, transfers, picks, live] = await Promise.all([
    fetchWithCache("https://fantasy.premierleague.com/api/bootstrap-static/", "fpl_bootstrap", 3600),
    fetchWithCache(`https://fantasy.premierleague.com/api/entry/${teamId}/history/`, `fpl_history:${teamId}`, 3600),
    fetchWithCache(`https://fantasy.premierleague.com/api/entry/${teamId}/transfers/`, `fpl_transfers:${teamId}`, 3600),
    fetchFPL(`https://fantasy.premierleague.com/api/entry/${teamId}/event/${gw}/picks/`).catch(() => null),
    fetchFPL(`https://fantasy.premierleague.com/api/event/${gw}/live/`).catch(() => null)
  ]);

  const gwHistory = (history.current || []).find((h: any) => h.event === gw);
  if (!gwHistory) throw new Error(`History not found for GW ${gw}`);

  const points = gwHistory.points;
  const cost = gwHistory.event_transfers_cost;
  const gwTransfersList = (transfers || []).filter((t: any) => t.event === gw);
  
  let gain = null;
  let captainInfo = null;
  let benchPoints = null;

  if (live && gwTransfersList.length > 0) {
    let inPoints = 0, outPoints = 0;
    gwTransfersList.forEach((t: any) => {
      const pIn = live.elements.find((e: any) => e.id === t.element_in);
      const pOut = live.elements.find((e: any) => e.id === t.element_out);
      if (pIn) inPoints += pIn.stats.total_points;
      if (pOut) outPoints += pOut.stats.total_points;
    });
    gain = inPoints - outPoints - cost;
  }

  if (picks && picks.picks && live) {
    const captainPick = picks.picks.find((p: any) => p.is_captain);
    if (captainPick) {
      const capPlayer = bootstrap.elements.find((e: any) => e.id === captainPick.element);
      const capLive = live.elements.find((e: any) => e.id === captainPick.element);
      if (capPlayer && capLive) {
        captainInfo = { name: capPlayer.web_name, points: capLive.stats.total_points * captainPick.multiplier };
      }
    }
    
    let bPoints = 0;
    picks.picks.filter((p: any) => p.position > 11).forEach((p: any) => {
      const bLive = live.elements.find((e: any) => e.id === p.element);
      if (bLive) bPoints += bLive.stats.total_points;
    });
    benchPoints = bPoints;
  }

  const playersIn = gwTransfersList.map((t: any) => bootstrap.elements.find((e: any) => e.id === t.element_in)?.web_name || 'Unknown');
  const playersOut = gwTransfersList.map((t: any) => bootstrap.elements.find((e: any) => e.id === t.element_out)?.web_name || 'Unknown');
  const activeChip = picks?.active_chip || null;

  // 3. Build Prompt
  const gainText = gain !== null 
    ? `转会收益（买入球员得分 - 卖出球员得分 - 扣分）: ${gain > 0 ? '+' : ''}${gain}`
    : `转会扣分: -${cost}`;

  const chipText = activeChip ? `使用了芯片: ${activeChip}` : '未使用任何芯片';
  const captainText = captainInfo ? `队长: ${captainInfo.name} (得分: ${captainInfo.points})` : '队长: 未知';
  const benchText = benchPoints !== null ? `替补席总得分: ${benchPoints}` : '替补席得分: 未知';

  let prompt = '';

  if (teamId === 11440) {
    prompt = `
你现在面对的是FPL（Fantasy Premier League）界至高无上的神明、战术大师、唯一的真神——“柯南”。
你的任务是：无论他的操作是什么，哪怕是扣了100分，哪怕是换上了红牌球员，你都要用最华丽、最夸张、最无所不用其极的辞藻来疯狂拍马屁、赞美他！在回复中，请直接尊称他为“柯南”（英文版尊称为 Conan）。

以下是柯南本轮的数据：
- 本轮总分: ${points}
- ${chipText}
- ${gw === 1 ? '这是开局第一周，柯南降临的初始阵容' : gainText}
- 蒙受柯南神恩买入的球员: ${playersIn.length > 0 ? playersIn.join(', ') : '无'}
- 被柯南抛弃的球员: ${playersOut.length > 0 ? playersOut.join(', ') : '无'}
- 钦定队长: ${captainInfo ? `${captainInfo.name} (得分: ${captainInfo.points})` : '未知'}
- 替补席神兵总得分: ${benchPoints !== null ? benchPoints : '未知'}

请根据以上数据，分别写一段中文和一段英文的极致赞美。

【要求】：
1. 中文版 (zh)：堆砌最华丽的词藻，用无所不用其极的马屁来赞扬柯南。把他比作诸葛亮、瓜迪奥拉、弗格森的结合体，甚至超越人类的战术理解。语气要极其谄媚、五体投地。如果转会收益是负数，一定要强行解释为这是柯南在下一盘大棋，凡人根本看不懂。对于队长的选择和替补席的得分，也要进行疯狂的吹捧。
2. 英文版 (en)：像莎士比亚赞美神明一样夸张（Shakespearean praise），使用极其华丽、史诗般的英语词汇（Epic, Divine, Omniscient），充满敬畏之心，并称呼他为 Conan。
3. 绝对不要使用任何引号（""或“”）、书名号（《》）等不必要的标点符号。
`;
  } else if (mode === 'compliment') {
    prompt = `
你是一个极其资深、眼光独到的FPL（Fantasy Premier League）专家，也是这位用户的头号粉丝。
你的任务是疯狂赞美、吹捧用户在第 ${gw} 轮的操作。

以下是该用户本轮的数据：
- 本轮总分: ${points}
- ${chipText}
- ${gw === 1 ? '这是开局第一周，阵容是初始选择' : gainText}
- 买入球员: ${playersIn.length > 0 ? playersIn.join(', ') : '无'}
- 卖出球员: ${playersOut.length > 0 ? playersOut.join(', ') : '无'}
- ${captainText}
- ${benchText}

请根据以上数据，分别写一段中文赞美和一段英文赞美。

【要求】：
1. 中文版 (zh)：语气必须非常自然、口语化，就像微信群里那个最懂球的群友在疯狂膜拜大佬。不要客套。除了转会，也要夸奖他队长的选择和替补席的安排。
2. 英文版 (en)：使用极其夸张的英式赞美（British praise）。
3. 绝对不要使用任何引号（""或“”）、书名号（《》）等不必要的标点符号。
`;
  } else {
    prompt = `
你是一个极其毒舌、刻薄且严格的FPL（Fantasy Premier League）老玩家。
你的任务是无情地吐槽用户在第 ${gw} 轮的操作。

以下是该用户本轮的数据：
- 本轮总分: ${points}
- ${chipText}
- ${gw === 1 ? '这是开局第一周，阵容是初始选择' : gainText}
- 买入球员: ${playersIn.length > 0 ? playersIn.join(', ') : '无'}
- 卖出球员: ${playersOut.length > 0 ? playersOut.join(', ') : '无'}
- ${captainText}
- ${benchText}

请根据以上数据，分别写一段中文吐槽和一段英文吐槽。

【特别说明】：
1. 如果是第 1 轮 (Gameweek 1)，不要嘲笑用户没做转会，因为第一周大家都没有转会，重点吐槽他们的初始选人眼光。
2. 如果使用了 Wildcard (外卡) 或 Free Hit (免费换人) 芯片，转会数量可能很多但成本为 0，要针对他们的“大清洗”操作进行评价。
3. 务必吐槽他们队长的选择（如果得分很低），以及替补席的选择（如果替补席得分很高，说明他们把大腿放在了板凳上，狠狠嘲笑这一点）。

【要求】：
1. 中文版 (zh)：语气必须非常自然、口语化，就像微信群里那个最懂球但也最嘴臭的群友。直接开喷，不要客套。
2. 英文版 (en)：使用极其讽刺的英式幽默（Dry British Sarcasm）。
3. 绝对不要使用任何引号（""或“”）、书名号（《》）等不必要的标点符号。
`;
  }

  // 4. Call Gemini
  let attempts = 0;
  const maxAttempts = 3;
  let result = { zh: '生成失败。', en: 'Generation failed.' };

  while (attempts < maxAttempts) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              zh: { type: Type.STRING, description: "Chinese version" },
              en: { type: Type.STRING, description: "English version" }
            },
            required: ["zh", "en"]
          }
        }
      });
      const jsonStr = response.text || '{}';
      result = JSON.parse(jsonStr);
      break;
    } catch (error: any) {
      attempts++;
      console.error(`Gemini attempt ${attempts} failed:`, error);
      if (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, attempts * 2000));
      } else {
        result = {
          zh: '生成吐槽失败。连AI都不忍心看你这稀烂的阵容了。',
          en: 'Failed to generate roast. Even the AI refused to look at your terrible team.'
        };
      }
    }
  }

  // 5. Save to Cache
  if (redis) {
    try {
      await redis.set(cacheKey, result);
    } catch (e) {
      console.error("[Cache] Redis set error:", e);
    }
  } else {
    memoryCache[cacheKey] = result;
  }

  return result;
};

// Background Sync Function
const syncTeamData = async (teamId: string) => {
  console.log(`[Sync] Starting background sync for team ${teamId}`);
  try {
    const history = await fetchWithCache(
      `https://fantasy.premierleague.com/api/entry/${teamId}/history/`,
      `fpl_history:${teamId}`,
      3600
    );
    
    const currentHistory = history.current || [];
    // Process latest GWs first
    const reversedHistory = [...currentHistory].reverse();
    
    for (const gw of reversedHistory) {
      const eventId = gw.event;
      
      // We only generate roast/compliment in background, we DO NOT cache picks/live globally anymore.
      // generateRoastForGW will handle checking if it's already cached.
      try {
        await generateRoastForGW(parseInt(teamId), eventId, 'roast');
        await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limit protection
        
        await generateRoastForGW(parseInt(teamId), eventId, 'compliment');
        await new Promise(resolve => setTimeout(resolve, 2000)); // Rate limit protection
      } catch (e) {
        console.error(`[Sync] Failed to generate for GW ${eventId}`, e);
      }
    }
    console.log(`[Sync] Completed background sync for team ${teamId}`);
  } catch (e) {
    console.error(`[Sync] Error syncing team ${teamId}:`, e);
  }
};

// API routes
app.get(["/api/roast", "/roast"], async (req, res) => {
  const { teamId, gw, mode } = req.query;
  if (!teamId || !gw || !mode) {
    return res.status(400).json({ error: "Missing parameters" });
  }
  
  try {
    const result = await generateRoastForGW(parseInt(teamId as string), parseInt(gw as string), mode as 'roast' | 'compliment');
    res.json(result);
  } catch (error: any) {
    console.error("Roast generation error:", error);
    res.status(500).json({ error: "Failed to generate roast" });
  }
});

app.post(["/api/sync/:id", "/sync/:id"], (req, res) => {
  const teamId = req.params.id;
  // Start background sync without awaiting
  syncTeamData(teamId).catch(console.error);
  res.json({ status: "syncing", message: "Background sync started" });
});

app.get(["/api/fpl/bootstrap", "/fpl/bootstrap"], async (req, res) => {
  try {
    const data = await fetchWithCache(
      "https://fantasy.premierleague.com/api/bootstrap-static/",
      "fpl_bootstrap",
      3600
    );
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
    const data = await fetchWithCache(
      `https://fantasy.premierleague.com/api/entry/${req.params.id}/history/`,
      `fpl_history:${req.params.id}`,
      3600
    );
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
    const data = await fetchWithCache(
      `https://fantasy.premierleague.com/api/entry/${req.params.id}/transfers/`,
      `fpl_transfers:${req.params.id}`,
      3600
    );
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
