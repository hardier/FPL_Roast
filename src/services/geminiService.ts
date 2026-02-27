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
  mode: 'roast' | 'compliment',
  activeChip: string | null = null
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

  const chipText = activeChip ? `使用了芯片: ${activeChip}` : '未使用任何芯片';

  let prompt = '';

  if (mode === 'compliment') {
    prompt = `
你是一个极其资深、眼光独到的FPL（Fantasy Premier League）专家，也是这位用户的头号粉丝。
你的任务是疯狂赞美、吹捧用户在第 ${gameweek} 轮的操作。

以下是该用户本轮的数据：
- 本轮总分: ${points}
- ${chipText}
- ${gameweek === 1 ? '这是开局第一周，阵容是初始选择' : gainText}
- 买入球员: ${transfersIn.length > 0 ? transfersIn.join(', ') : '无'}
- 卖出球员: ${transfersOut.length > 0 ? transfersOut.join(', ') : '无'}

请根据以上数据，分别写一段中文赞美和一段英文赞美。
`;
  } else {
    prompt = `
你是一个极其毒舌、刻刻且严格的FPL（Fantasy Premier League）老玩家。
你的任务是无情地吐槽用户在第 ${gameweek} 轮的操作。

以下是该用户本轮的数据：
- 本轮总分: ${points}
- ${chipText}
- ${gameweek === 1 ? '这是开局第一周，阵容是初始选择' : gainText}
- 买入球员: ${transfersIn.length > 0 ? transfersIn.join(', ') : '无'}
- 卖出球员: ${transfersOut.length > 0 ? transfersOut.join(', ') : '无'}

请根据以上数据，分别写一段中文吐槽和一段英文吐槽。

【特别说明】：
1. 如果是第 1 轮 (Gameweek 1)，不要嘲笑用户没做转会，因为第一周大家都没有转会，重点吐槽他们的初始选人眼光。
2. 如果使用了 Wildcard (外卡) 或 Free Hit (免费换人) 芯片，转会数量可能很多但成本为 0，要针对他们的“大清洗”操作进行评价。
`;
  }

  prompt += `
【要求】：
1. 中文版 (zh)：语气必须非常自然、口语化，就像微信群里那个最懂球但也最嘴臭的群友。直接开喷（吐槽模式）或疯狂膜拜（赞美模式），不要客套。
2. 英文版 (en)：使用极其讽刺的英式幽默（吐槽模式）或夸张的英式赞美（赞美模式）。
3. 绝对不要使用任何引号（""或“”）、书名号（《》）等不必要的标点符号。
`;

  let attempts = 0;
  const maxAttempts = 3;

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
    } catch (error: any) {
      attempts++;
      console.error(`Gemini attempt ${attempts} failed:`, error);
      if (attempts < maxAttempts && (error.message?.includes('429') || error.message?.includes('quota'))) {
        // Wait 2s, 4s before retrying
        await new Promise(resolve => setTimeout(resolve, attempts * 2000));
        continue;
      }
      if (attempts >= maxAttempts) {
        console.error('Error generating roast after max attempts:', error);
        return {
          zh: '生成吐槽失败。连AI都不忍心看你这稀烂的阵容了。',
          en: 'Failed to generate roast. Even the AI refused to look at your terrible team.'
        };
      }
    }
  }

  return { 
    zh: '生成吐槽失败。连AI都不忍心看你这稀烂的阵容了。', 
    en: 'Failed to generate roast. Even the AI refused to look at your terrible team.' 
  };
};
