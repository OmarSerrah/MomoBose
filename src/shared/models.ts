import type { Headset } from './types';
export interface HeadphoneModel {
  id: string;
  family: 'bose' | 'airpods' | 'unknown';
  name: string;
  shortName: string;
  form: 'earbuds' | 'headphones';
  noiseControl: boolean;
  automaticSwitching: boolean | null;
}
const bose: HeadphoneModel = { id: 'qc45', family: 'bose', name: 'Bose QuietComfort 45', shortName: 'QC45', form: 'headphones', noiseControl: true, automaticSwitching: false };
const unknown: HeadphoneModel = { id: 'unknown', family: 'unknown', name: 'Bluetooth headphones', shortName: 'Headphones', form: 'headphones', noiseControl: false, automaticSwitching: false };
const apple = (id: string, name: string, noiseControl = false, form: 'earbuds' | 'headphones' = 'earbuds'): HeadphoneModel => ({ id, family: 'airpods', name, shortName: name, noiseControl, form, automaticSwitching: id === 'airpods-unknown' ? null : id !== 'airpods-1' });
// Apple Support 109525 names; Bluetooth IDs verified against macOS CoreTypes /
// CoreBluetoothUI asset catalogs. Never infer a generation from a renamed device.
export const airPodsModels: Record<number, HeadphoneModel> = {
  0x2002: apple('airpods-1', 'AirPods (1st generation)'),
  0x200f: apple('airpods-2', 'AirPods (2nd generation)'),
  0x2013: apple('airpods-3', 'AirPods (3rd generation)'),
  0x2019: apple('airpods-4', 'AirPods 4'),
  0x201b: apple('airpods-4-anc', 'AirPods 4 with Active Noise Cancellation', true),
  0x2036: apple('airpods-5', 'AirPods 5', true),
  0x2037: apple('airpods-5', 'AirPods 5', true),
  0x2030: apple('airpods-5-wireless', 'AirPods 5 with Wireless Charging Case', true),
  0x2032: apple('airpods-5-wireless', 'AirPods 5 with Wireless Charging Case', true),
  0x200e: apple('airpods-pro-1', 'AirPods Pro (1st generation)', true),
  0x2014: apple('airpods-pro-2', 'AirPods Pro 2 (Lightning)', true),
  0x2024: apple('airpods-pro-2-usbc', 'AirPods Pro 2 (USB-C)', true),
  0x2027: apple('airpods-pro-3', 'AirPods Pro 3', true),
  0x200a: apple('airpods-max', 'AirPods Max (Lightning)', true, 'headphones'),
  0x201f: apple('airpods-max-usbc', 'AirPods Max (USB-C)', true, 'headphones'),
  0x202d: apple('airpods-max-2', 'AirPods Max 2', true, 'headphones'),
};
export function modelForDevice(device: Headset | null | undefined): HeadphoneModel {
  if (!device) return unknown;
  if (device.productId) {
    if (device.productId === 0x4039 && (device.vendorId === undefined || [0x009e, 0x05a7].includes(device.vendorId))) return bose;
    if ((device.vendorId === undefined || [0x004c, 0x05ac].includes(device.vendorId)) && airPodsModels[device.productId]) return airPodsModels[device.productId];
    if ([0x2003, 0x2005, 0x2006, 0x2009, 0x200b, 0x200c, 0x200d, 0x2010, 0x2011, 0x2012, 0x2015, 0x2016, 0x2017, 0x201a, 0x2025, 0x2026, 0x2031].includes(device.productId)) return unknown;
    // New AirPods stay usable without claiming an unverified generation or features.
    if (device.vendorId !== undefined && [0x004c, 0x05ac].includes(device.vendorId) && /\bairpods\b/i.test(device.name)) return apple('airpods-unknown', 'Apple AirPods');
    return unknown;
  }
  if (device.vendorId !== undefined && ![0x004c, 0x05ac, 0x009e, 0x05a7].includes(device.vendorId)) return unknown;
  if (/\bairpods\b/i.test(device.name) && (device.vendorId === undefined || [0x004c, 0x05ac].includes(device.vendorId))) return apple('airpods-unknown', 'Apple AirPods');
  return /\bqc[\s-]?45\b|quietcomfort\s*45\b/i.test(device.name) ? bose : unknown;
}
export const supportedDevice = (device: Headset) => modelForDevice(device).family !== 'unknown';
