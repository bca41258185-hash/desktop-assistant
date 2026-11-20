// OpenAI 相容 HTTP 供應商。
// 可對接 OpenAI 官方、Azure OpenAI、以及任何相容 /chat/completions 的服務。
// 設定來源：環境變數（OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL）或 app 內設定。

function create(settings) {
  const baseUrl = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = settings.model || 'gpt-4o-mini';
  const apiKey = settings.apiKey || '';

  return {
    name: 'openai-compatible',

    /**
     * @param {Array<{role:string, content:string}>} messages
     * @returns {Promise<string>} 助理回覆文字
     */
    async chat(messages) {
      if (!apiKey) {
        throw new Error('尚未設定 API Key（請在「設定」頁填入，或設定環境變數 OPENAI_API_KEY）');
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7
        })
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`AI 服務回應錯誤 ${res.status}：${text.slice(0, 200)}`);
      }

      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content?.trim();
      if (!reply) throw new Error('AI 沒有回覆任何內容');
      return reply;
    }
  };
}

module.exports = { create };
