import Anthropic from '@anthropic-ai/sdk';

// 2026-10-23 Gemini → Claude Haiku 5.5. 유료 크레딧이라 공개 엔드포인트 남용을 막는다:
// 같은 사이트(Origin)에서만 호출, 입력 길이 제한, IP당 분당 호출 제한(서버리스 인스턴스 단위 best-effort).
const MODEL = process.env.LLM_MODEL || 'claude-haiku-5-5';
const RATE_LIMIT = 10;       // IP당 분당 최대 호출
const hits = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 500) for (const [k, v] of hits) if (!v.some(t => now - t < 60_000)) hits.delete(k);
  return recent.length > RATE_LIMIT;
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    let sameSite = false;
    try { sameSite = new URL(origin).host === req.headers.host; } catch { /* ignore */ }
    if (!sameSite) return res.status(403).json({ error: 'forbidden origin' });
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { situation } = req.body || {};
  if (!situation || typeof situation !== 'string') return res.status(400).json({ error: 'situation is required' });
  if (situation.length > 100) return res.status(400).json({ error: 'situation is too long (max 100 chars)' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return res.status(429).json({ error: '요청이 너무 많아요. 잠시 후 다시 시도해주세요.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });

  const prompt = `일본 여행 중 "${situation}" 상황에서 쓸 수 있는 일본어 회화 표현 8개를 JSON 배열로만 출력하세요.\n형식: [{"jp":"일본어","hira":"히라가나","pron":"한국어발음","ko":"한국어뜻"}]\nJSON만 출력. 다른 텍스트 금지.`;

  try {
    const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 50_000 });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 3000,
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: prompt }],
    });
    const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');

    // JSON 배열 추출: [ 부터 마지막 ] 까지
    const start = text.indexOf('[');
    let end = text.lastIndexOf(']');
    if (start === -1) {
      return res.status(500).json({ error: 'JSON 배열 없음: ' + text.slice(0, 150) });
    }
    // ] 가 없으면 (응답 잘림) → 잘린 항목 제거 후 배열 닫기
    let raw;
    if (end <= start) {
      const partial = text.slice(start);
      const lastComplete = partial.lastIndexOf('},');
      raw = lastComplete > 0 ? partial.slice(0, lastComplete + 1) + ']' : partial + ']';
    } else {
      raw = text.slice(start, end + 1);
    }

    const phrases = JSON.parse(raw);
    return res.status(200).json({ phrases });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
