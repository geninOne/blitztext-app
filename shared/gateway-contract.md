# Gateway contract (OpenAI-compatible)

Both apps talk to either OpenAI directly or an OpenAI-compatible gateway
(LiteLLM). The wire contract is identical; only the base URL, key and model
names differ. Base URL is stored without the `/v1` suffix; the apps append the
paths below.

## Auth and endpoints

- Header: `Authorization: Bearer <api key>`
- Chat: `POST <baseURL>/v1/chat/completions`
- Transcription: `POST <baseURL>/v1/audio/transcriptions`

## Chat (text improvement / Dampf ablassen / emojis)

Request body (JSON):

```json
{
  "model": "<chat model>",
  "messages": [
    { "role": "system", "content": "<system prompt>" },
    { "role": "user", "content": "<text>" }
  ],
  "temperature": 0.3
}
```

Response: read `choices[0].message.content` (standard OpenAI shape), then trim.

### Gotcha 1: temperature

Do **not** send a custom `temperature` to the gateway. GPT-5 class models
reject any non-default value with HTTP 400
(`Unsupported value: 'temperature' ... Only the default (1) value is
supported`). Omit the field entirely for the gateway provider. For OpenAI
direct (gpt-4o family) a low temperature (0.3 / 0.4) is fine.

## Transcription

`multipart/form-data` fields:

- `file`: the recorded audio (e.g. `audio.webm` / `audio.m4a`)
- `model`: `<transcription model>` (e.g. `whisper-1`, `gpt-4o-transcribe`)
- `response_format`: `text`
- `prompt` (optional): vocabulary hints, see `prompts.json` →
  `transcription.vocabularyPrefixTemplate`
- `language` (optional): e.g. `de`

### Gotcha 2: response format

LiteLLM ignores `response_format=text` and returns JSON anyway
(`{"text": "..."}` or the larger verbose_json with `segments`). Parse
defensively: if the body is JSON with a top-level `text` field, use that;
otherwise fall back to the raw body string. Then trim.

## Model roles

- `fastModel` → text improvement and emojis
- `strongModel` → Dampf ablassen
- `transcriptionModel` → transcription

## Two-phase workflow

Every workflow records audio, then:

1. Transcribe the audio via the transcription endpoint.
2. For improvement / Dampf ablassen / emojis: send the transcript through the
   chat endpoint with the matching system prompt.
3. Paste the final text into the previously focused app.
