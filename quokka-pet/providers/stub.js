// Stub 供應商：作為未來供應商（例如本地 Ollama）的佔位實作。
// 它不會真的呼叫任何模型，只回覆一段說明文字，提醒使用者尚未設定。

function create(/* settings */) {
  return {
    name: 'stub',

    async chat(messages) {
      const last = messages[messages.length - 1]?.content || '';
      const preview = last.slice(0, 40);
      return (
        '（本地／Ollama 供應商尚未設定）\n' +
        `我收到你的訊息了：「${preview}${last.length > 40 ? '…' : ''}」。\n` +
        '請到「設定」頁把供應商改成「openai」並填入 API Key，' +
        '或自行在 providers/ 底下實作這個供應商。'
      );
    }
  };
}

module.exports = { create };
