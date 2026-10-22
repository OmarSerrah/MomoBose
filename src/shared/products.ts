import type { Headset } from './types';
import { modelForDevice } from './models';
import qc45Image from '../assets/bose-qc45-black-cutout.png';
import airPods12 from '../assets/airpods/airpods-1-2.png';
import airPods3 from '../assets/airpods/airpods-3.png';
import airPods4 from '../assets/airpods/airpods-4.png';
import airPods5 from '../assets/airpods/airpods-5.png';
import airPodsPro1 from '../assets/airpods/airpods-pro-1.png';
import airPodsPro2 from '../assets/airpods/airpods-pro-2.png';
import airPodsPro3 from '../assets/airpods/airpods-pro-3.png';
import airPodsMaxLightning from '../assets/airpods/airpods-max-lightning.png';
import airPodsMaxUsbc from '../assets/airpods/airpods-max-usbc.png';

// Bundle product photos so desktop and widget artwork stays sharp offline on
// both platforms. Charging-port variants share their model's exterior artwork;
// Bluetooth identity does not report the physical color of AirPods Max.
const airPodsImages: Readonly<Record<string, string>> = {
  'airpods-1': airPods12,
  'airpods-2': airPods12,
  'airpods-3': airPods3,
  'airpods-4': airPods4,
  'airpods-4-anc': airPods4,
  'airpods-5': airPods5,
  'airpods-5-wireless': airPods5,
  'airpods-pro-1': airPodsPro1,
  'airpods-pro-2': airPodsPro2,
  'airpods-pro-2-usbc': airPodsPro2,
  'airpods-pro-3': airPodsPro3,
  'airpods-max': airPodsMaxLightning,
  'airpods-max-usbc': airPodsMaxUsbc,
  'airpods-max-2': airPodsMaxUsbc,
};

export function productForDevice(device: Headset | null | undefined) {
  const model = modelForDevice(device);
  return { ...model, image: model.family === 'bose' ? qc45Image : model.family === 'airpods' ? airPodsImages[model.id] ?? null : null };
}
