import { expect, it } from 'vitest';
import { productForDevice } from '../src/shared/products';
import { airPodsModels } from '../src/shared/models';

it('identifies renamed QC45 hardware and lets an explicit product ID override its name', () => {
  expect(productForDevice({ name: 'Ghost', address: 'a', connected: true, productId: 0x4039 }).shortName).toBe('QC45');
  expect(productForDevice({ name: 'Bose QC45', address: 'b', connected: false, productId: 0x4020 }).image).toBeNull();
});
it('uses explicit QC45 names only when hardware identity is absent', () => {
  for (const name of ['Bose QC45', 'QuietComfort 45', 'Bose QC 45', 'QC-45']) {
    expect(productForDevice({ name, address: 'a', connected: false }).shortName).toBe('QC45');
  }
  for (const name of ['Ghost', 'Bose 700', 'QC450', 'QuietComfort 45th']) {
    expect(productForDevice({ name, address: 'a', connected: false }).image).toBeNull();
  }
  expect(productForDevice(null).image).toBeNull();
});

it('provides bundled artwork for every supported AirPods model on either platform, even with a low-resolution OS icon', () => {
  for (const productId of Object.keys(airPodsModels).map(Number)) {
    const device = { name: 'My headphones', address: 'a', connected: true, productId, vendorId: 0x004c };
    const image = productForDevice(device).image;
    expect(image, `Missing artwork for ${airPodsModels[productId].name}`).toMatch(/\/airpods\/.*\.png$/);
    expect(productForDevice({ ...device, artwork: 'data:image/png;base64,dGlueQ==' }).image).toBe(image);
  }
});

it('keeps unidentified AirPods on the vector fallback instead of enlarging an OS icon or guessing a model', () => {
  expect(productForDevice({ name: 'My AirPods', address: 'a', connected: true, artwork: 'data:image/png;base64,dGlueQ==' }).image).toBeNull();
  expect(productForDevice({ name: 'My AirPods', address: 'a', connected: true, productId: 0xffff, vendorId: 0x004c }).image).toBeNull();
});
