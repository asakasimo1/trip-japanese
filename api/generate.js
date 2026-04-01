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

  const prompt = `일본 여행 중 "${situation}" 상황에서 실제로 쓸 수 있는 자연스러운 일본어 회화 표현 10개를 JSON 배열로만 출력하세요.\n각 항목 형식: {"jp":"일본어문장","hira":"히라가나표기","pron":"한국어발음(띄어쓰기포함)","ko":"한국어뜻"}\n반드시 JSON 배열만 출력. 다른 텍스트 절대 금지.`;

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.85, maxOutputTokens: 1200 }
        })
      }
    );

    if (!geminiRes.ok) {
      const err = await geminiRes.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message || `Gemini error ${geminiRes.status}` });
    }

    const data = await geminiRes.json();
    const raw = data.candidates[0].content.parts[0].text.trim()
      .replace(/```json\n?|\n?```/g, '')
      .replace(/^[^[]*(\[)/, '$1')
      .replace(/\][^\]]*$/, ']');

    const phrases = JSON.parse(raw);
    return res.status(200).json({ phrases });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
