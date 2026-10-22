# Third-party notices

MomoBose is an independent, unofficial Bose QC45 controller. Bose and QuietComfort are trademarks of Bose Corporation.

## bosectl

Protocol knowledge, QC45 register mappings and payload layouts are based on [aaronsb/bosectl](https://github.com/aaronsb/bosectl). The TypeScript protocol implementation and macOS helper were written for MomoBose.

MIT License

Copyright (c) 2026 Aaron Bockelie

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## BT Audio Tray

Windows audio endpoint and Kernel Streaming helpers are adapted from [jeremyleff/BTAudioSysTrayTool](https://github.com/jeremyleff/BTAudioSysTrayTool). Changes include preserving COM HRESULT signatures and selecting only the matched device.

MIT License

Copyright (c) 2026 Jeremy Leff

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Bose QuietComfort 45 product photograph

`src/assets/bose-qc45-black.jpg` is a Bose QuietComfort 45 Triple Black product
photograph (`QC45_TripleBlack_002_RGB`), retrieved from the
[ASK Direct QC45 product listing](https://askdirect.co.uk/products/bose-quietcomfort-45-noise-cancelling-smart-headphones-black)
on 2026-10-22. [Original image](https://askdirect.co.uk/cdn/shop/files/1920_JPG-QC45_TripleBlack_002_RGB__34646.1630510985.1280.1280.jpg?v=1711996632).
Product imagery and Bose trademarks belong to their respective owners and are
not covered by this project's MIT license. The bundled photograph identifies the
QC45 model; the Bluetooth API does not report the headset's physical color.

`src/assets/bose-qc45-black-cutout.png` is a transparent-background derivative of
that photograph, prepared with the built-in image editing tool. The original
JPEG is retained for provenance. See `docs/artwork.md` for the exact edit prompt
and output details.

## Apple AirPods product photographs

`src/assets/airpods/*.png` contains transparent product photographs retrieved
from Apple's website and Apple Store image CDN on 2026-10-22. Exact source
URLs and bundled pixel dimensions are recorded in
`src/assets/airpods/sources.json`. Only transparent outer padding was removed;
the product pixels were not enlarged or synthesized.

Apple product imagery and the Apple and AirPods trademarks belong to Apple Inc.
and are not covered by this project's MIT license. MomoBose is independent and
unofficial. The images identify the product model, not the physical color of a
particular device. AirPods 1/2, charging-case/port variants, and AirPods Max USB-C
and Max 2 share artwork where their exterior design is the same.
