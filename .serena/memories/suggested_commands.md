# Useful commands

- `openspec status --change swift-lock-screen-capture-mvp --json`
- `openspec instructions apply --change swift-lock-screen-capture-mvp --json`
- On macOS, inspect Xcode with `xcode-select -p`, `xcodebuild -version`, `xcrun simctl list devices available`, and `xcrun devicectl list devices`.
- Use `xcodebuild` for iOS builds/tests only after selecting a full Xcode developer directory; the current host initially had Command Line Tools only.