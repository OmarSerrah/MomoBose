import type { Headset } from './types';
import { modelForDevice } from './models';
import qc45Image from '../assets/bose-qc45-black-cutout.png';
export function productForDevice(device: Headset | null | undefined) {
  const model = modelForDevice(device);
  const artwork = device?.artwork?.startsWith('data:image/png;base64,') ? device.artwork : null;
  return { ...model, image: model.family === 'bose' ? qc45Image : model.family === 'airpods' ? artwork : null };
}
