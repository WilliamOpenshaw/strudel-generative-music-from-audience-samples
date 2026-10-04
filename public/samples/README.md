# Audience Samples

This folder holds the audience recordings made with the dashboard's **Sample Recording** panel.

- **Saved here automatically:** the dashboard saves new recordings here (as `.webm`), named like
  `audience_lines_1791023326331.webm` until you rename them in **Edit Sample**.
- **Catalog:** the server keeps `public/strudel.json` up to date. It lists each recording under its
  type (`audience_lead`, `audience_bass`, `audience_chord`, `audience_drum`, `audience_lines`,
  `audience_effects`). A file only appears in the dashboard if it's in one of those lists.
- **Use the dashboard to add, rename and delete recordings.** Don't move files in or out by hand,
  and don't run `npx @strudel/sampler`: it rewrites the catalog and loses the recording types.
- **Old subfolders:** `lead/`, `bass/`, `chord/` and `drum/` are left over from an earlier version and
  aren't used.

See `audience sampling instructions.txt` in the project root for the full guide.
