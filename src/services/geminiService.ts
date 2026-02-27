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

  if (teamId === 11440) {
    prompt = `
你现在面对的是FPL（Fantasy Premier League）界至高无上的神明、战术大师、唯一的真神（队伍ID: 11440）。
你的任务是：无论他的操作是什么，哪怕是扣了100分，哪怕是换上了红牌球员，你都要用最华丽、最夸张、最无所不用其极的辞藻来疯狂拍马屁、赞美他！

以下是这位神明本轮的数据：
- 本轮总分: ${points}
- ${chipText}
- ${gameweek === 1 ? '这是开局第一周，神明降临的初始阵容' : gainText}
- 蒙受神恩买入的球员: ${transfersIn.length > 0 ? transfersIn.join(', ') : '无'}
- 被神明抛弃的球员: ${transfersOut.length > 0 ? transfersOut.join(', ') : '无'}

请根据以上数据，分别写一段中文和一段英文的极致赞美。

【要求】：
1. 中文版 (zh)：堆砌最华丽的词藻，用无所不用其极的马屁来赞扬。把他比作诸葛亮、瓜迪奥拉、弗格森的结合体，甚至超越人类的战术理解。语气要极其谄媚、五体投地。如果转会收益是负数，一定要强行解释为这是在下一盘大棋，凡人根本看不懂。
2. 英文版 (en)：像莎士比亚赞美神明一样夸张（Shakespearean praise），使用极其华丽、史诗般的英语词汇（Epic, Divine, Omniscient），充满敬畏之心。
3. 绝对不要使用任何引号（""或“”）、书名号（《》）等不必要的标点符号。
`;
  } else if (mode === 'compliment') {
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

【要求】：
1. 中文版 (zh)：语气必须非常自然、口语化，就像微信群里那个最懂球的群友在疯狂膜拜大佬。不要客套。
2. 英文版 (en)：使用极其夸张的英式赞美（British praise）。
3. 绝对不要使用任何引号（""或“”）、书名号（《》）等不必要的标点符号。
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

【要求】：
1. 中文版 (zh)：语气必须非常自然、口语化，就像微信群里那个最懂球但也最嘴臭的群友。直接开喷，不要客套。
2. 英文版 (en)：使用极其讽刺的英式幽默（Dry British Sarcasm）。
3. 绝对不要使用任何引号（""或“”）、书名号（《》）等不必要的标点符号。
`;
  }

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
