# Turbo Lite — Old Photo Corrector

**Super fast** single-pass WebGL shader that restores old photos right in your browser. It caps the working size to **1080 px** and merges tone, scratch attenuation, smoothing, unsharp, and colour restore into **one shader** for speed.

## Use
1. Open `index.html` (or deploy via GitHub Pages).
2. Upload a photo → click **Auto Fix**.
3. Tweak sliders (Scratch, Smooth, Detail, Contrast, etc.).
4. Click **Download** to save a JPG.

## Deploy (GitHub Pages)
- Put these files in your repo (root or `/docs`) → **Settings → Pages → Deploy from branch**.

## Notes
- This is designed for **speed**. For very damaged scans or large prints, use the full restore build or ask me to add an ML inpainting/super‑res layer (WebGPU/ONNX) with automatic fallback.
