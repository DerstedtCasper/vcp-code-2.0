# Speech-to-text (voice input)

- **What it is**: A streaming STT subsystem for dictation/voice input.

## Suggested migration

- **VCP CLI availability**: Already.
- **Migration recommendation**:
  - Keep speech capture and UX in the webview/UI (microphone permissions and streaming).
  - Use VCP CLI-compatible STT flows where helpful, but avoid making STT a required server capability.
- **Reimplementation required?**: Partial.

## Primary implementation anchors

- [`src/services/stt/`](../../src/services/stt/)

