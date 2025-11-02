# Turbo Old Photo Corrector (WebGL)

Ultra‑fast, **GPU shader** pipeline for restoring old photos in the browser. Enhances tone/contrast, removes thin scratches, smooths noise edge‑aware, sharpens details, and restores color. Privacy‑friendly: no files leave your device.

## Use
1. Open the page → choose a photo.
2. Click **Auto Fix**. Fine‑tune Scratch Removal, Smooth Skin, Detail Boost.
3. **Download** the enhanced JPG.

## Deploy (GitHub Pages)
- Put these files in a repo (root or `/docs`), then enable **Settings → Pages → Deploy from branch**.

## Notes
- The scratch removal shader targets **thin bright/dark lines** typical in old scans. For severe tears or missing regions, ML inpainting works better — I can add an optional ONNX/WebGPU module on request (falls back to this shader if unsupported).
- Works best on desktop Chrome/Edge; Safari/iOS performance varies but generally works.
