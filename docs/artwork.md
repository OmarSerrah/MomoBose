# QC45 transparent artwork

Final asset: `src/assets/bose-qc45-black-cutout.png` (640 × 640 RGBA PNG).
The original JPEG is retained at `src/assets/bose-qc45-black.jpg`.

Created using the built-in image generation/editing tool in background-extraction
mode, with the original QC45 product photograph as the edit target. Transparency
was checked both outside the product and inside the headband opening. The output
was inspected against the original for the QC45 shape, angle, earcup details and
logo, then resized for the desktop interface while preserving its alpha channel.

Exact edit prompt:

> Use case: background-extraction. Edit target: the supplied Bose QuietComfort 45 Triple Black product photograph. Remove ONLY the pure white background, including white visible through the headband opening and gaps between earcups. Produce a clean RGBA transparent PNG cutout. Preserve the headphones exactly: same QC45 model, three-quarter angle, shape, proportions, earcups, microphone holes, cushioning, original black materials, photographic lighting and BOSE logo. No redesign, repainting, recoloring, added reflections, new text, white fringe, floor, shadow plate, or background. Keep the whole headphones uncropped with a small transparent margin. This is a product identification image in a macOS desktop app; model fidelity matters.

Image source and ownership are recorded in `THIRD_PARTY_NOTICES.md`.

## AirPods artwork

All recognized AirPods models use bundled transparent PNG photographs from
Apple, selected by the model ID in `src/shared/products.ts`. This replaces the
small macOS Bluetooth icons previously enlarged in the desktop window and also
provides artwork on Windows, in demo mode, and without a network connection.
Unidentified AirPods retain the SVG illustration rather than guessing a model.

The originals were downloaded from the Apple Store image CDN or the Retina
assets on [Apple's comparison page](https://www.apple.com/airpods/compare/).
`src/assets/airpods/sources.json` records each original URL, retrieval date, and
bundled dimensions. PNGs preserve their alpha channel and original product
pixels; transparent outer padding was removed with Sharp's
`trim({ threshold: 0 })`, followed by lossless PNG compression. No upscaling or
generated product details were used.

AirPods 1/2 share their long-stem exterior; ANC and charging-port variants share
their corresponding generation's image. Max Lightning uses Silver artwork;
Max USB-C and Max 2 use Midnight. These are representative colors because the
Bluetooth device metadata does not identify the physical finish.
