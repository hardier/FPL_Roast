import { GoogleGenAI, Type } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const generateRoast = async (
  teamId: number,
  gameweek: number,
  points: number,
  transfersIn: string[],
  transfersOut: string[],
  cost: number,
  gain: number | null,
  mode: 'roast' | 'compliment'
): Promise<{ zh: string, en: string }> => {
  // 1. Check Cache First
  try {
    const cacheRes = await fetch(`/api/cache/roast?teamId=${teamId}&gw=${gameweek}&mode=${mode}`);
    if (cacheRes.ok) {
      return await cacheRes.json();
    }
  } catch (e) {
    console.error('Cache check failed', e);
  }

  const gainText = gain !== null 
    ? `转会收益（买入球员得分 - 卖出球员得分 - 扣分）: ${gain > 0 ? '+' : ''}${gain}`
    : `转会扣分: -${cost}`;

  let prompt = '';

  if (mode === 'compliment') {
    prompt = `
你是一个极其资深、眼光独到的FPL（Fantasy Premier League）专家，也是这位用户的头号粉丝。
你的任务是疯狂赞美、吹捧用户在第 ${gameweek} 轮的转会操作。

以下是该用户本轮的数据：
- 本轮总分: ${points}
- ${gainText}
- 买入球员: ${transfersIn.length > 0 ? transfersIn.join(', ') : '无'}
- 卖出球员: ${transfersOut.length > 0 ? transfersOut.join(', ') : '无'}

请根据以上数据，分别写一段中文赞美和一段英文赞美。

【要求】：
1. 中文版 (zh)：语气必须非常自然、口语化，就像微信群里那个最懂球的群友在疯狂膜拜大佬。绝对不要有任何机械感或AI感。即使转会收益是负数，也要强行解释为“放长线钓大鱼”或“战略性放弃”。
2. 英文版 (en)：使用极其夸张的英式赞美（British praise），充满敬意，仿佛在评价一位战术大师（Tactical Genius）。
3. 绝对不要使用任何引号（""或“”）、书名号（《》）等不必要的标点符号。
`;
  } else {
    prompt = `
你是一个极其毒舌、刻薄且严格的FPL（Fantasy Premier League）老玩家。
你的任务是无情地吐槽用户在第 ${gameweek} 轮的转会操作。

以下是该用户本轮的数据：
- 本轮总分: ${points}
- ${gainText}
- 买入球员: ${transfersIn.length > 0 ? transfersIn.join(', ') : '无'}
- 卖出球员: ${transfersOut.length > 0 ? transfersOut.join(', ') : '无'}

请根据以上数据，分别写一段中文吐槽和一段英文吐槽。

【要求】：
1. 中文版 (zh)：语气必须非常自然、口语化，就像微信群里那个最懂球但也最嘴臭的群友。直接开喷，不要客套。如果转会收益是负数，狠狠地嘲笑他们“一顿操作猛如虎，一看分数负十五”。如果没有做任何转会，嘲笑他们是死鱼、不敢操作的懦夫。
2. 英文版 (en)：使用极其讽刺的英式幽默（Dry British Sarcasm）。表面上可能听起来很礼貌，但实际上充满了对他们智商和决策能力的鄙视。
3. 绝对不要使用任何引号（""或“”）、书名号（《》）等不必要的标点符号。
`;
  }

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
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
    const result = JSON.parse(jsonStr);
    
    // 2. Save to Cache
    try {
      await fetch('/api/cache/roast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, gw: gameweek, mode, zh: result.zh, en: result.en })
      });
    } catch (e) {
      console.error('Cache save failed', e);
    }

    return result;
  } catch (error) {
    console.error('Error generating roast:', error);
    return {
      zh: '生成吐槽失败。连AI都不忍心看你这稀烂的阵容了。',
      en: 'Failed to generate roast. Even the AI refused to look at your terrible team.'
    };
  }
};
