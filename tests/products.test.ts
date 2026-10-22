import { expect, it } from 'vitest';
import { productForDevice } from '../src/shared/products';

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
