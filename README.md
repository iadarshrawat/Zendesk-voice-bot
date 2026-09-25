# LiveKit RAG Voice Backend

This is the LiveKit replacement for the previous Retell backend. It preserves the existing Azure Cosmos DB, Voyage AI, Claude, brand filtering, query planning, evidence validation, recovery, and latency-budget code.

There is no Retell dependency and no Retell WebSocket URL.

## Runtime flow

1. The browser or later a phone caller joins a LiveKit room.
2. LiveKit converts speech to text with Deepgram Nova 3.
3. `LiveKitRagAgent.onUserTurnCompleted()` receives the final transcript.
4. The existing `generateVoiceRagReply()` function searches the same Cosmos knowledge container using the same Voyage embeddings and generates the grounded reply with Claude.
5. LiveKit converts that exact cleaned RAG reply to audio with Inworld TTS.

The LiveKit session deliberately has no general-purpose LLM. This prevents a second model from changing or inventing information after the grounded RAG answer is produced.

## What was adopted from the Python reference

The Python course and this project use different SDK versions, so the concepts were translated to current Node APIs instead of copied literally.

| Python course component | Node implementation in this project |
|---|---|
| `silero.VAD.load()` in worker prewarm | One shared `inference.VAD({ model: "silero" })` created in `prewarm` |
| `MultilingualModel()` turn detector | Current `inference.TurnDetector()` with cloud-to-local fallback |
| Deepgram Nova 3 | `inference.STT({ model: "deepgram/nova-3" })` |
| BVC noise cancellation | Optional ai-coustics `audioEnhancement({ model: "quailVfL" })`; off for clean microphones |
| STT and TTS fallback adapters | Optional LiveKit Inference fallback models, disabled until configured |
| OpenAI/Gemini LLM | Not used; the existing Cosmos + Voyage + Claude RAG pipeline remains the only answer generator |

The Node agent also adds transcript timeouts, product keyterms, normal-volume VAD tuning, privacy-safe logging, and explicit semantic endpointing.

## 1. Requirements

- Node.js 24
- LiveKit CLI (`lk`)
- A LiveKit Cloud project
- The working RAG backend's Anthropic, Voyage, and Cosmos credentials

You do not need a SIP number for browser testing. SIP is added only when real telephone callers must dial the agent.

## 2. Configure the project

```bash
unzip LiveKit_RAG_Voice_Backend.zip
cd livekit-rag-voice-backend
npm install
cp .env.example .env.local
```

If the CLI is already authenticated and linked to the correct LiveKit project, populate the three LiveKit values with:

```bash
lk app env -w -d .env.local
```

If that command cannot authenticate, copy `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` from LiveKit Cloud project settings into `.env.local` manually.

Then copy the following values from the working RAG backend into `.env.local`:

- `ANTHROPIC_API_KEY`
- `VOYAGE_API_KEY`
- `COSMOS_ENDPOINT`
- `COSMOS_KEY`
- `COSMOS_DATABASE_ID`
- `COSMOS_CONTAINER_ID`
- all existing `RAG_*`, `CLAUDE_*`, and `BOT_*` settings you customized

Keep `VOICE_SUPPORT_BRAND=Mr Brand` for the current data partition. Change it only when deploying a separate agent for another configured brand.

## 3. Choose the speech profile

Start with the values already present in `.env.example`. They are the balanced preset for a browser microphone and mixed English/Hindi or Hinglish calls:

```dotenv
LIVEKIT_STT_MODEL=deepgram/nova-3
LIVEKIT_STT_LANGUAGE=multi
LIVEKIT_VAD_ACTIVATION_THRESHOLD=0.40
LIVEKIT_VAD_DEACTIVATION_THRESHOLD=0.25
LIVEKIT_ENDPOINT_MIN_DELAY_MS=500
LIVEKIT_ENDPOINT_MAX_DELAY_MS=3000
LIVEKIT_NOISE_CANCELLATION_ENABLED=false
LIVEKIT_NOISE_CANCELLATION_MODEL=quailVfL
```

Use only one of these adjustments at a time, then make a test call:

| Symptom | First setting to change | Suggested value |
|---|---|---|
| Normal/quiet speech is not detected | `LIVEKIT_VAD_ACTIVATION_THRESHOLD` | `0.35` |
| Background noise starts false turns | `LIVEKIT_VAD_ACTIVATION_THRESHOLD` | `0.48` |
| First syllable is missing | `LIVEKIT_VAD_PREFIX_PADDING_MS` | `800` |
| Sentence is cut at a short pause | `LIVEKIT_ENDPOINT_MIN_DELAY_MS` | `700` |
| Agent feels slow after a completed sentence | `LIVEKIT_ENDPOINT_MIN_DELAY_MS` | `350` |
| Competing voices/noisy room confuse recognition | `LIVEKIT_NOISE_CANCELLATION_ENABLED` | `true` |
| All callers speak Indian English only | `LIVEKIT_STT_LANGUAGE` | `en-IN` |

Do not lower the VAD activation threshold below `0.30` as a first fix. That often changes a missed-speech problem into a background-noise problem. Also do not enable both aggressive browser-side audio enhancement and backend ai-coustics processing. Keep standard browser echo cancellation, automatic gain control, and noise suppression on; avoid a second enhanced noise-removal product in the browser.

Optional fallback providers are for an STT/TTS outage, not for correcting an inaccurate transcript. Configure them only after the main path is stable:

```dotenv
LIVEKIT_STT_FALLBACK_MODEL=assemblyai/universal-streaming-multilingual
LIVEKIT_TTS_FALLBACK_MODEL=cartesia/sonic-3
LIVEKIT_TTS_FALLBACK_VOICE=YOUR_CARTESIA_VOICE_ID
```

## 4. Prove RAG before starting audio

```bash
npm run rag:check -- --brand "Mr Brand" --question "Suggest a fan for a school"
```

Do not continue until this prints a grounded RAG result. This command uses the same database and generation pipeline as the voice call.

## 5. Start the LiveKit worker locally

```bash
npm run dev
```

Successful startup includes logs similar to:

```text
[startup] Cosmos DB vector knowledge store connected
[startup] Default brand catalog warmed
registered worker
```

## 6. Test in the browser

1. Open the LiveKit Agents playground for your project.
2. Select `zendesk-rag-voice-agent` if the playground asks for an agent.
3. Allow microphone permission.
4. Connect and wait for the greeting.
5. Say: `Suggest a fan for a school.`

With `VOICE_LOG_TRANSCRIPTS=true`, the terminal should show:

```text
[livekit:stt] Final transcript received ...
[livekit:rag] Reply completed ...
```

The second log proves the recognized transcript passed through the RAG pipeline. The answer you hear is the cleaned `result.reply` returned by that pipeline.

While tuning, the terminal should also show user state changes and end-of-turn predictions. The most useful diagnostic sequence is:

```text
[livekit:audio] User state changed ... to: speaking
[livekit:stt] Final transcript received ...
[livekit:turn] End-of-turn prediction ...
[livekit:rag] Reply completed ...
```

Interpret a missing stage as follows:

- No `speaking`: microphone permission, input device/level, frontend audio publishing, or VAD sensitivity problem.
- `speaking` but no final transcript: STT language/model, network, or provider problem. The agent will now say that it did not catch the question.
- Transcript exists but is wrong: set one fixed language if possible and add exact product names to `LIVEKIT_STT_KEYTERMS`.
- Transcript is correct but answer is wrong: the issue is in retrieval/generation, not LiveKit audio. Reproduce it with `npm run rag:check`.
- `Reply completed` exists but no audio: TTS or room audio-playback problem.

## 7. Deploy to LiveKit Cloud

The included Dockerfile packages the LiveKit worker and the RAG code together as one deployment.

Create the first deployment from this folder:

```bash
lk agent create --secrets-file=.env.local
```

For later code updates:

```bash
lk agent deploy
```

Check it with:

```bash
lk agent status
lk agent logs
```

Do not commit `.env.local`. For production, make a separate `secrets.production.env` and use it with `--secrets-file`.

## Main files

- `server.js`: LiveKit worker, STT/TTS session, prewarm, and browser entry point
- `src/config/voice.js`: validated speech, VAD, endpointing, fallback, and logging settings
- `src/livekitRagAgent.js`: receives each completed user turn
- `src/services/livekitConversationService.js`: conversation history, cancellation, timeouts, and spoken delivery
- `src/services/voiceRagService.js`: existing grounded RAG generation
- `scripts/checkRagQuestion.js`: database/RAG verification without voice

## Important boundaries

- Browser voice works without SIP.
- A telephone number and LiveKit SIP configuration are a later phase.
- Zendesk SIP-IN escalation is a later phase after browser calls and RAG answers are stable.
- LiveKit Cloud inference usage and Anthropic, Voyage, and Cosmos usage are billed independently according to those services.
