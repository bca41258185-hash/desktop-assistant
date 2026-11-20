// Provider 工廠：依名稱建立對應的 AI 供應商實例。
// 要新增供應商時，在這裡加一個 case，並實作同樣的 { name, chat(messages) } 介面。

const openaiCompatible = require('./openai-compatible');
const stub = require('./stub');

/**
 * @param {string} name 供應商名稱（'openai' | 'stub' | 'ollama' ...）
 * @param {object} settings 有效設定（apiKey/baseUrl/model...）
 */
function createProvider(name, settings) {
  switch (String(name || 'openai').toLowerCase()) {
    case 'openai':
    case 'openai-compatible':
      return openaiCompatible.create(settings);
    case 'stub':
    case 'ollama':
    case 'local':
      return stub.create(settings);
    default:
      return stub.create(settings);
  }
}

module.exports = { createProvider };
