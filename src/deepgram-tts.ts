import { createClient } from '@deepgram/sdk';

export interface DeepgramTTSConfig {
	apiKey: string;
	model?: string;
	encoding?: string;
	sampleRate?: number;
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

	async connect(
		onAudio: (audioBase64: string) => void,
		onError?: (error: Error) => void,
	): Promise<boolean> {
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
				
				console.log('Deepgram TTS result received, audio length:', result?.audio?.length || 'no audio');
				
				// Convert result to base64 and call callback
				if (result && result.audio && this.onAudioCallback) {
					console.log('Calling audio callback with base64 audio');
					// The result.audio should already be in base64 format
					this.onAudioCallback(result.audio);
				} else {
					console.error('No audio data received from Deepgram or no callback');
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