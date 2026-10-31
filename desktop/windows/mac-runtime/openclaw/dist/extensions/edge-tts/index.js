import { t as definePluginEntry } from "../../plugin-entry-CM_XK0Yw.js";
import { t as createOpenAiCompatibleSpeechProvider } from "../../speech-D89-GX_o.js";

/**
 * Edge TTS provider — 本地免费神经语音（微软 Edge 引擎）
 * 通过本地 HTTP 服务 (127.0.0.1:18888) 转 edge-tts
 */
const provider = createOpenAiCompatibleSpeechProvider({
	id: "edge-tts",
	label: "Edge TTS (免费神经女声)",
	autoSelectOrder: 90,
	models: ["edge-tts"],
	voices: [
		"zh-CN-XiaoyiNeural",
		"zh-CN-XiaoxiaoNeural",
		"zh-CN-XiaomengNeural",
		"en-US-AnaNeural",
		"en-US-EmmaNeural",
		"en-US-JennyNeural"
	],
	defaultModel: "edge-tts",
	defaultVoice: "zh-CN-XiaoyiNeural",
	defaultBaseUrl: "http://127.0.0.1:18888",
	envKey: "EDGE_TTS_KEY",
	responseFormats: ["mp3"],
	defaultResponseFormat: "mp3",
	voiceCompatibleResponseFormats: ["mp3"]
});

export default definePluginEntry({
	id: "edge-tts",
	name: "Edge TTS",
	description: "免费微软神经语音 (edge-tts)",
	register(api) {
		api.registerSpeechProvider(provider);
	}
});
