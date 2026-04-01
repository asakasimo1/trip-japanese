export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { situation } = req.body || {};
  if (!situation) return res.status(400).json({ error: 'situation is required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured on server' });

  const prompt = `일본 여행 중 "${situation}" 상황에서 쓸 수 있는 일본어 회화 표현 8개를 JSON 배열로만 출력하세요.\n형식: [{"jp":"일본어","hira":"히라가나","pron":"한국어발음","ko":"한국어뜻"}]\nJSON만 출력. 다른 텍스트 금지.`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.85, maxOutputTokens: 2048 }
        })
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || `Gemini error ${geminiRes.status}` });
    }

    const data = await geminiRes.json();
    const parts = data.candidates[0].content.parts;
    const textPart = parts.find(p => p.text && !p.thought) || parts[0];
    const text = textPart.text;

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
