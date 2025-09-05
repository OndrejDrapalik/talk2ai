# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Talk2AI is a real-time voice-based chat application that allows users to have spoken conversations with AI. It's built using Cloudflare Workers with Durable Objects for backend processing and uses Cloudflare AI for Speech-to-Text (STT) and Large Language Model (LLM) inference, with Deepgram for Text-to-Speech (TTS).

## Architecture

- **Frontend**: Vanilla JavaScript client with Voice Activity Detection (VAD) in `public/`
- **Backend**: Cloudflare Worker with Durable Objects in `src/`
- **AI Models**: Uses Cloudflare AI for STT (`@cf/openai/whisper-tiny-en`) and LLM (`@cf/meta/llama-4-scout-17b-16e-instruct`), and Deepgram for TTS (`aura-arcas-en` male voice model)
- **Communication**: WebSocket connection between client and server

## Key Files

- `src/index.ts`: Main Worker with Durable Object handling WebSocket connections, AI processing pipeline
- `src/deepgram-tts.ts`: Deepgram TTS WebSocket handler and audio processing
- `src/utils.ts`: Text buffering utility for streaming LLM responses into sentences
- `public/index.html`: Main UI with conversation interface
- `public/ui.js`: Frontend WebSocket handling, audio playback, and UI management
- `public/utils.js`: Client-side utilities for audio processing
- `public/vad/`: Voice Activity Detection implementation
- `wrangler.jsonc`: Cloudflare Worker configuration with Durable Objects and AI bindings

## Development Commands

- `bun run dev` / `bun start`: Start development server with Wrangler
- `bun run deploy`: Deploy to Cloudflare Workers
- `bun run cf-typegen`: Generate Cloudflare Workers types

## Key Technical Details

### Message Flow

1. Client captures audio via VAD → WebSocket → Durable Object
2. STT converts audio to text → sent back to client for display
3. Text added to conversation history → LLM generates response stream
4. Response buffered into sentences → TTS converts each sentence to audio
5. Audio + text sent back to client for playback and display

### Durable Object State Management

- Each WebSocket connection gets a unique Durable Object instance
- `msgHistory` array maintains conversation context with `role` and `content`
- PQueue ensures TTS requests are processed sequentially to maintain order
- Clear command resets conversation history: `{ type: "cmd", data: "clear" }`

### AI Model Usage

- STT expects audio as `Uint8Array` from `ArrayBuffer`
- LLM uses conversation history with system prompt for voice interaction context
- TTS processes individual sentences to enable streaming audio responses

## Dependencies

- `ai`: AI SDK for LLM streaming
- `workers-ai-provider`: Cloudflare AI provider for the AI SDK
- `p-queue`: Queue management for TTS processing order
- `@deepgram/sdk`: Deepgram SDK for WebSocket TTS integration
- `@cloudflare/workers-types`: TypeScript types for Cloudflare Workers

## Environment Variables

- `DEEPGRAM`: Required API key for Deepgram TTS service
