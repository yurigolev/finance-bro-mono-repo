# Native iOS invariants

- Lock Screen Control starts capture through App Intents; Widget Extension does not own microphone or SwiftData work.
- Never show transaction amount, description, or transcript on the Lock Screen.
- Force on-device recognition and offer manual entry when Russian assets or microphone permission are unavailable; never silently send audio to a server.
- Mark persistence success only after explicit `ModelContext.save()`.
- Target-device behavior must be reported separately from simulator/build results; lock-screen capture is not confirmed without physical-device testing.