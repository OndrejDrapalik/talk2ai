import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

export interface DeepgramTTSConfig {
	apiKey: string;
	model?: string;
	encoding?: string;
	sampleRate?: number;
}

export interface DeepgramSTTConfig {
	apiKey: string;
	model?: string;
	language?: string;
}

export class DeepgramTTS {
	private client: any;
	private connection: any;
	private apiKey: string;
	private config: DeepgramTTSConfig;
	private isConnected: boolean = false;
	private onAudioCallback?: (audioBase64: string) => void;
	private onErrorCallback?: (error: Error) => void;
	private useRestAPI: boolean = true; // Use REST API instead of WebSocket for now

	constructor(config: DeepgramTTSConfig) {
		this.config = {
			model: 'aura-asteria-en',
			encoding: 'linear16',
			sampleRate: 24000,
			...config,
		};
		this.apiKey = config.apiKey;
		this.client = createClient(this.apiKey);
	}

	async connect(onAudio: (audioBase64: string) => void, onError?: (error: Error) => void): Promise<boolean> {
		try {
			this.onAudioCallback = onAudio;
			this.onErrorCallback = onError;

			if (this.useRestAPI) {
				// For REST API, just verify the connection works
				console.log('Testing Deepgram REST API connection...');
				try {
					await this.client.speak.request(
						{ text: 'test' },
						{
							model: this.config.model,
							encoding: this.config.encoding,
							sample_rate: this.config.sampleRate,
						}
					);
					console.log('Deepgram REST API connection successful');
					this.isConnected = true;
					return true;
				} catch (error) {
					console.error('Deepgram REST API test failed:', error);
					throw error;
				}
			} else {
				// WebSocket implementation (for future use)
				this.connection = this.client.speak.live({
					model: this.config.model,
					encoding: this.config.encoding,
					sample_rate: this.config.sampleRate,
				});

				// Set up event handlers
				this.connection.on('open', () => {
					console.log('Deepgram TTS connection opened');
					this.isConnected = true;
				});

				this.connection.on('binaryData', (data: ArrayBuffer) => {
					const audioBase64 = this.arrayBufferToBase64(data);
					if (this.onAudioCallback) {
						this.onAudioCallback(audioBase64);
					}
				});

				this.connection.on('close', () => {
					console.log('Deepgram TTS connection closed');
					this.isConnected = false;
				});

				this.connection.on('error', (error: any) => {
					console.error('Deepgram TTS error:', error);
					if (this.onErrorCallback) {
						this.onErrorCallback(new Error(`Deepgram TTS error: ${error.message || error}`));
					}
				});

				await new Promise((resolve) => setTimeout(resolve, 100));
				return this.isConnected;
			}
		} catch (error) {
			console.error('Failed to connect to Deepgram TTS:', error);
			if (this.onErrorCallback) {
				this.onErrorCallback(error as Error);
			}
			return false;
		}
	}

	async synthesize(text: string): Promise<void> {
		if (this.useRestAPI) {
			// Use REST API for TTS
			try {
				console.log('Synthesizing text with Deepgram:', text.substring(0, 50));
				const result = await this.client.speak.request(
					{ text },
					{
						model: this.config.model,
						encoding: this.config.encoding,
						sample_rate: this.config.sampleRate,
					}
				);

				console.log('Deepgram TTS result type:', typeof result);
				console.log('Deepgram TTS result keys:', result ? Object.keys(result) : 'null');

				// The Deepgram SDK returns an object with a result property that contains the actual response
				let audioBase64: string | null = null;
				let actualResult = result;

				// Check if the result has a result property (SDK wrapper)
				if (result && result.result) {
					console.log('Found result.result, using that as actual result');
					actualResult = result.result;
				}

				console.log('Actual result type:', typeof actualResult);
				console.log('Actual result keys:', actualResult && typeof actualResult === 'object' ? Object.keys(actualResult) : 'not an object');

				if (actualResult instanceof ArrayBuffer) {
					// Convert ArrayBuffer to base64
					console.log('Processing ArrayBuffer result');
					audioBase64 = this.arrayBufferToBase64(actualResult);
				} else if (actualResult && typeof actualResult === 'object' && actualResult.audio) {
					// If it has an audio property, use that
					console.log('Found audio property in result');
					if (actualResult.audio instanceof ArrayBuffer) {
						audioBase64 = this.arrayBufferToBase64(actualResult.audio);
					} else if (typeof actualResult.audio === 'string') {
						audioBase64 = actualResult.audio;
					}
				} else if (actualResult && actualResult.getReader) {
					// If it's a ReadableStream, read it
					console.log('Processing ReadableStream result');
					const reader = actualResult.getReader();
					const chunks: Uint8Array[] = [];
					let done = false;

					while (!done) {
						const { value, done: streamDone } = await reader.read();
						done = streamDone;
						if (value) {
							chunks.push(value);
						}
					}

					// Combine chunks into a single ArrayBuffer
					const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
					const combinedArray = new Uint8Array(totalLength);
					let offset = 0;
					for (const chunk of chunks) {
						combinedArray.set(chunk, offset);
						offset += chunk.length;
					}

					audioBase64 = this.arrayBufferToBase64(combinedArray.buffer);
				} else if (actualResult && actualResult.arrayBuffer) {
					// If it's a Response object, get the arrayBuffer
					console.log('Processing Response object with arrayBuffer method');
					const buffer = await actualResult.arrayBuffer();
					audioBase64 = this.arrayBufferToBase64(buffer);
				}

				console.log('Processed audio base64 length:', audioBase64?.length || 'no audio processed');

				if (audioBase64 && this.onAudioCallback) {
					console.log('Calling audio callback with base64 audio');
					this.onAudioCallback(audioBase64);
				} else {
					console.error('No audio data processed from Deepgram response or no callback');
				}
			} catch (error) {
				console.error('Error with Deepgram REST TTS:', error);
				if (this.onErrorCallback) {
					this.onErrorCallback(error as Error);
				}
			}
		} else {
			// WebSocket implementation (not working yet)
			if (!this.isConnected || !this.connection) {
				throw new Error('Deepgram TTS connection not established');
			}

			try {
				// Send text to be synthesized
				this.connection.send(text);
			} catch (error) {
				console.error('Error sending text to Deepgram TTS:', error);
				if (this.onErrorCallback) {
					this.onErrorCallback(error as Error);
				}
			}
		}
	}

	disconnect(): void {
		if (this.connection) {
			try {
				this.connection.close();
			} catch (error) {
				console.error('Error closing Deepgram TTS connection:', error);
			}
			this.connection = null;
		}
		this.isConnected = false;
	}

	private arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		let binary = '';
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}
}

export class DeepgramSTT {
	private client: any;
	private config: DeepgramSTTConfig;
	private connection: any;
	private isConnected: boolean = false;
	private isReconnecting: boolean = false;
	private onTranscriptCallback?: (transcript: string, isFinal: boolean) => void;
	private onErrorCallback?: (error: Error) => void;

	constructor(config: DeepgramSTTConfig) {
		this.config = {
			model: 'nova-3-general',
			language: 'en-US',
			...config,
		};
		this.client = createClient(this.config.apiKey);
	}

	async connect(onTranscript: (transcript: string, isFinal: boolean) => void, onError?: (error: Error) => void): Promise<boolean> {
		try {
			this.onTranscriptCallback = onTranscript;
			this.onErrorCallback = onError;

			console.log('Connecting to Deepgram STT WebSocket...');
			
			// Create WebSocket connection using Deepgram SDK
			this.connection = this.client.listen.live({
				model: this.config.model,
				language: this.config.language,
				punctuate: true,
				smart_format: true,
				interim_results: true,
				vad_events: true,
				encoding: 'linear16',
				sample_rate: 16000,
				channels: 1,
			});

			// Create a promise that resolves when connection opens or rejects on error
			const connectionPromise = new Promise<boolean>((resolve, reject) => {
				let resolved = false;
				
				const timeout = setTimeout(() => {
					if (!resolved) {
						resolved = true;
						reject(new Error('Connection timeout'));
					}
				}, 5000);

				this.connection.on(LiveTranscriptionEvents.Open, () => {
					if (!resolved) {
						resolved = true;
						clearTimeout(timeout);
						console.log('Deepgram STT connection opened');
						this.isConnected = true;
						resolve(true);
					}
				});

				this.connection.on(LiveTranscriptionEvents.Error, (error: any) => {
					if (!resolved) {
						resolved = true;
						clearTimeout(timeout);
						console.error('Deepgram STT connection error:', error);
						reject(new Error(`Deepgram STT error: ${error.message || error}`));
					}
				});
			});

			// Set up other event handlers
			this.connection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
				console.log('Deepgram STT transcript received:', data);
				
				// Extract transcript from the response
				const transcript = data?.channel?.alternatives?.[0]?.transcript || '';
				const isFinal = data?.is_final || false;
				
				if (transcript && this.onTranscriptCallback) {
					this.onTranscriptCallback(transcript, isFinal);
				}
			});

			this.connection.on(LiveTranscriptionEvents.Close, () => {
				console.log('Deepgram STT connection closed, attempting to reconnect...');
				this.isConnected = false;
				// Automatically reconnect after a short delay
				setTimeout(() => {
					if (this.onTranscriptCallback) {
						this.connect(this.onTranscriptCallback, this.onErrorCallback);
					}
				}, 100);
			});

			this.connection.on(LiveTranscriptionEvents.Error, (error: any) => {
				console.error('Deepgram STT error:', error);
				if (this.onErrorCallback) {
					this.onErrorCallback(new Error(`Deepgram STT error: ${error.message || error}`));
				}
			});

			// Add additional event listeners for debugging
			this.connection.on(LiveTranscriptionEvents.Metadata, (metadata: any) => {
				console.log('Deepgram STT metadata:', metadata);
			});

			// Wait for connection to establish
			return await connectionPromise;
		} catch (error) {
			console.error('Failed to connect to Deepgram STT:', error);
			if (this.onErrorCallback) {
				this.onErrorCallback(error as Error);
			}
			return false;
		}
	}

	sendAudio(audioBuffer: ArrayBuffer): void {
		if (!this.isConnected || !this.connection) {
			console.warn('Deepgram STT connection not established, attempting to reconnect and queue audio...');
			// Try to reconnect if we have the callback
			if (this.onTranscriptCallback && !this.isReconnecting) {
				this.isReconnecting = true;
				this.connect(this.onTranscriptCallback, this.onErrorCallback).then((connected) => {
					this.isReconnecting = false;
					if (connected) {
						// Retry sending the audio after successful reconnection
						this.sendAudio(audioBuffer);
					}
				});
			}
			return;
		}

		try {
			console.log('Sending audio to Deepgram STT, buffer size:', audioBuffer.byteLength);
			this.connection.send(audioBuffer);
		} catch (error) {
			console.error('Error sending audio to Deepgram STT:', error);
			if (this.onErrorCallback) {
				this.onErrorCallback(error as Error);
			}
		}
	}

	disconnect(): void {
		if (this.connection) {
			try {
				this.connection.finish();
			} catch (error) {
				console.error('Error closing Deepgram STT connection:', error);
			}
			this.connection = null;
		}
		this.isConnected = false;
	}

	// Keep the old method for backward compatibility, but mark as deprecated
	async transcribe(audioBuffer: ArrayBuffer): Promise<string> {
		console.warn('DeepgramSTT.transcribe() is deprecated. Use WebSocket connection with connect() and sendAudio() instead.');
		
		try {
			console.log('Transcribing audio with Deepgram STT, buffer size:', audioBuffer.byteLength);

			// Build the URL with all the requested parameters
			const params = new URLSearchParams({
				model: 'nova-3-general',
				punctuate: 'true',
				smart_format: 'true',
				dictation: 'false',
				diarize: 'false',
				numerals: 'false',
				no_delay: 'true',
				interim_results: 'true',
				encoding: 'linear16',
				vad_events: 'true',
				sample_rate: '16000',
				channels: '1',
				endpointing: '25',
				filler_words: 'false',
				profanity_filter: 'false',
				language: 'en-US'
			});

			// Use direct REST API instead of SDK to avoid "Unknown transcription source type" error
			const response = await fetch(
				`https://api.deepgram.com/v1/listen?${params.toString()}`,
				{
					method: 'POST',
					headers: {
						Authorization: `Token ${this.config.apiKey}`,
						'Content-Type': 'audio/wav',
					},
					body: audioBuffer,
				}
			);

			if (!response.ok) {
				throw new Error(`Deepgram API error: ${response.status} ${response.statusText}`);
			}

			const result = await response.json();
			console.log('Deepgram STT result:', result);

			// Extract the transcript from the result
			const transcript = (result as any)?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
			console.log('Extracted transcript:', transcript);

			return transcript;
		} catch (error) {
			console.error('Error with Deepgram STT:', error);
			throw error;
		}
	}
}
