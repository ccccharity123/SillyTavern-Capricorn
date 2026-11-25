# v4.5.24 AppleNative
- Fix pending audio scheduling when maintenance is suspended and host is visible; hidden host policy unchanged.
- Preserve the longest active input deferral; normalize invalid duration.
- Add repeatable Node regression suite: `node --experimental-default-type=module tests/regression.mjs` (9 tests).
- No changes to audio engine, UI or storage formats. No device or full host integration tests performed.
