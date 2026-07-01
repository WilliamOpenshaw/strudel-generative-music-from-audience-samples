# Audience Samples

Place your audience recordings here, organized by role.

## Folder Structure

```
samples/
  lead/     ← melodic lead recordings
  bass/     ← bass recordings
  chord/    ← chord stab recordings
  drum/     ← percussion recordings (future)
```

## Naming Convention

### Lead & Bass (pitched / numbered variations)

Name files as numbered variations: `0.wav`, `1.wav`, `2.wav`, etc.

Strudel will pitch-shift a single sample across notes using `n()`.
If you have multiple variations, Strudel cycles through them.

### Chord (stab variations)

Name files as numbered variations: `0.wav`, `1.wav`, `2.wav`, etc.

### Drum (named by hit type)

Name files by their drum role:
- `kick.wav` or `bd.wav`
- `snare.wav` or `sd.wav`
- `hihat.wav` or `hh.wav`

## Supported Formats

- `.wav` (recommended — best quality, no decoding overhead)
- `.mp3` (smaller files, slight decoding latency)
- `.ogg` (good compression, not supported in Safari)

## Generating the Catalog

After adding or changing samples, regenerate the catalog from the project root:

```bash
npx @strudel/sampler public/samples --json > public/strudel.json
```

Or simply restart `npm run dev` — the dashboard auto-detects which roles
have samples and falls back to synths for any missing roles.
