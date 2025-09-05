import { smoothStream, streamText } from 'ai';
import { bufferText } from './utils';
import { DurableObject } from 'cloudflare:workers';
import { createWorkersAI } from 'workers-ai-provider';
import PQueue from 'p-queue';
import { DeepgramTTS, DeepgramSTT } from './deepgram-tts';

/* Todo
 * ✅ 1. WS with frontend
 * ✅ 2. Get audio to backend
 * ✅ 3. Convert audio to text
 * ✅ 4. Run inference
 * ✅ 5. Convert result to audio
 * ✅ 6. Send audio to frontend
 */

export class MyDurableObject extends DurableObject {
	env: Env;
	msgHistory: Array<Object>;
	deepgramTTS: DeepgramTTS;
	deepgramSTT: DeepgramSTT;
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.env = env;
		this.msgHistory = [];
		this.deepgramTTS = new DeepgramTTS({
			apiKey: env.DEEPGRAM,
			model: 'aura-arcas-en' // male voice as mentioned in CLAUDE.md
		});
		this.deepgramSTT = new DeepgramSTT({
			apiKey: env.DEEPGRAM,
			model: 'nova-3-general', // Using nova-3-general as specified in parameters
			language: 'en-US'
		});
	}
	async fetch(_request: any) {
		// set up ws pipeline
		const webSocketPair = new WebSocketPair();
		const [socket, ws] = Object.values(webSocketPair);

		ws.accept();
		const workersai = createWorkersAI({ binding: this.env.AI });
		const queue = new PQueue({ concurrency: 1 });

		// Initialize Deepgram TTS connection
		const deepgramTTSConnected = await this.deepgramTTS.connect(
			(audioBase64: string) => {
				// Audio callback - this will be handled in the queue processing
			},
			(error: Error) => {
				console.error('Deepgram TTS error:', error);
			}
		);

		if (!deepgramTTSConnected) {
			console.error('Failed to connect to Deepgram TTS');
		} else {
			console.log('Deepgram TTS connected successfully');
		}

		// Initialize Deepgram STT WebSocket connection
		const deepgramSTTConnected = await this.deepgramSTT.connect(
			async (transcript: string, isFinal: boolean) => {
				console.log('>>', transcript, isFinal ? '(final)' : '(interim)');
				
				// Send interim results to client immediately for better UX
				const message = { 
					type: 'text', 
					text: transcript, 
					interim: !isFinal 
				};
				console.log('Sending text message to client:', message);
				ws.send(JSON.stringify(message));

				// Only process final transcripts for LLM inference
				if (isFinal && transcript.trim()) {
					this.msgHistory.push({ role: 'user', content: transcript });

					// run inference
					const result = streamText({
						model: workersai('@cf/meta/llama-4-scout-17b-16e-instruct' as any),
						system:
							'You are a helpful AI assistant in a voice conversation with the user. Keep your responses conversational and concise. Do not identify yourself as any specific company or brand.',
						messages: this.msgHistory as any,
						// experimental_transform: smoothStream(),
					});
					
					// buffer streamed response into sentences, then convert to audio
					await bufferText(result.textStream, async (sentence: string) => {
						this.msgHistory.push({ role: 'assistant', content: sentence });
						console.log('<<', sentence);
						await queue.add(async () => {
							try {
								// Use the DeepgramTTS class for TTS
								console.log('Synthesizing with DeepgramTTS:', sentence);
								
								// Set up a promise to capture the audio result
								let audioResult: string | null = null;
								let errorResult: Error | null = null;
								
								// Temporarily override the callback to capture this specific result
								const originalCallback = this.deepgramTTS['onAudioCallback'];
								const originalErrorCallback = this.deepgramTTS['onErrorCallback'];
								
								this.deepgramTTS['onAudioCallback'] = (audioBase64: string) => {
									audioResult = audioBase64;
								};
								
								this.deepgramTTS['onErrorCallback'] = (error: Error) => {
									errorResult = error;
								};
								
								// Synthesize the text
								await this.deepgramTTS.synthesize(sentence);
								
								// Wait for the result (with timeout)
								const timeout = 10000; // 10 seconds
								const startTime = Date.now();
								while (!audioResult && !errorResult && (Date.now() - startTime) < timeout) {
									await new Promise(resolve => setTimeout(resolve, 100));
								}
								
								// Restore original callbacks
								this.deepgramTTS['onAudioCallback'] = originalCallback;
								this.deepgramTTS['onErrorCallback'] = originalErrorCallback;
								
								if (errorResult) {
									throw errorResult;
								}
								
								if (!audioResult) {
									throw new Error('TTS timeout - no audio received');
								}
								
								console.log('Deepgram TTS successful, audio length:', (audioResult as string)?.length || 'unknown');
								ws.send(JSON.stringify({ type: 'audio', text: sentence, audio: audioResult }));
								
							} catch (error) {
								console.error('Deepgram TTS failed:', error instanceof Error ? error.message : error);
								// For now, just send the text without audio
								ws.send(JSON.stringify({ type: 'text', text: `[TTS Error] ${sentence}` }));
							}
						});
					});
				}
			},
			(error: Error) => {
				console.error('Deepgram STT error:', error);
			}
		);

		if (!deepgramSTTConnected) {
			console.error('Failed to connect to Deepgram STT');
		} else {
			console.log('Deepgram STT connected successfully');
		}

		ws.addEventListener('message', async (event) => {
			// handle chat commands
			if (typeof event.data === 'string') {
				const { type, data } = JSON.parse(event.data);
				if (type === 'cmd' && data === 'clear') {
					this.msgHistory.length = 0; // clear chat history
				}
				return; // end processing here for this event type
			}

			// Send audio directly to Deepgram STT WebSocket for faster processing
			this.deepgramSTT.sendAudio(event.data as ArrayBuffer);
		});

		ws.addEventListener('close', (cls) => {
			// Clean up Deepgram connections
			this.deepgramTTS.disconnect();
			this.deepgramSTT.disconnect();
			ws.close(cls.code, 'Durable Object is closing WebSocket');
		});

		return new Response(null, { status: 101, webSocket: socket });
	}
}

export default {
	async fetch(request, env, _ctx): Promise<Response> {
		if (request.url.endsWith('/websocket')) {
			const upgradeHeader = request.headers.get('Upgrade');
			if (!upgradeHeader || upgradeHeader !== 'websocket') {
				return new Response('Expected upgrade to websocket', { status: 426 });
			}
			let id: DurableObjectId = env.MY_DURABLE_OBJECT.idFromName(crypto.randomUUID());
			let stub = env.MY_DURABLE_OBJECT.get(id);
			return stub.fetch(request);
		}

		return new Response(null, {
			status: 400,
			statusText: 'Bad Request',
			headers: { 'Content-Type': 'text/plain' },
		});
	},
} satisfies ExportedHandler<Env>;
