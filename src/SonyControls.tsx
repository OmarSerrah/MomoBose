import { useEffect, useState, type CSSProperties } from 'react';
import { ListeningMode, type Command, type SonySettings, type SonySwitch } from './shared/types';

export function SonyEqualizer({ settings, disabled, onCommand }: { settings?: SonySettings; disabled: boolean; onCommand: (command: Command) => Promise<void> }) {
  const equalizer = settings?.equalizer;
  const [draft, setDraft] = useState(equalizer?.values ?? [0, 0, 0, 0, 0, 0]);
  useEffect(() => { setDraft(equalizer?.values ?? [0, 0, 0, 0, 0, 0]); }, [equalizer?.values.join(',')]);
  const manual = equalizer?.presets.some(preset => preset.id === 0xa0);
  const changed = equalizer && draft.some((value, index) => value !== equalizer.values[index]);
  return <section className="control-card sony-eq" aria-label="Sony equalizer">
    <div className="section-label"><h3>Equalizer</h3><select aria-label="Sony EQ preset" value={equalizer?.preset ?? ''} disabled={disabled || !equalizer} onChange={event => void onCommand({ type: 'sonyEq', preset: Number(event.target.value) })}>
      <option value="" disabled>Unavailable</option>{equalizer && !equalizer.presets.some(p => p.id === equalizer.preset) && <option value={equalizer.preset}>Current preset</option>}{equalizer?.presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
    </select></div>
    <div className="eq-controls">{['Clear Bass', '400 Hz', '1 kHz', '2.5 kHz', '6.3 kHz', '16 kHz'].map((label, index) => <label className="eq-band" key={label}>
      <span>{label}</span><output>{equalizer ? `${draft[index] > 0 ? '+' : ''}${draft[index]}` : '—'}</output>
      <input aria-label={label} aria-valuetext={equalizer ? String(draft[index]) : 'Unavailable'} type="range" min="-10" max="10" step="1" value={draft[index]} disabled={disabled || !equalizer || !manual} style={{ '--range-fill': `${(draft[index] + 10) * 5}%` } as CSSProperties} onChange={event => { const next = [...draft]; next[index] = Number(event.target.value); setDraft(next); }}/>
      <span className="range-labels"><span>−10</span><span>0</span><span>+10</span></span>
    </label>)}</div>
    <div className="sony-eq-actions"><button className="text-button" disabled={disabled || !equalizer || !manual} onClick={() => setDraft([0, 0, 0, 0, 0, 0])}>Reset to flat</button>{changed && <button className="small-button" disabled={disabled} onClick={() => void onCommand({ type: 'sonyEq', values: draft })}>Apply EQ</button>}</div>
    {!equalizer && <p className="unavailable-note">The headphones have not provided equalizer settings.</p>}
  </section>;
}

export function SonyAmbient({ settings, mode, disabled, onCommand }: { settings?: SonySettings; mode: number | null; disabled: boolean; onCommand: (command: Command) => Promise<void> }) {
  const [level, setLevel] = useState(settings?.ambientLevel || 20);
  const [voice, setVoice] = useState(settings?.focusOnVoice ?? false);
  useEffect(() => { setLevel(settings?.ambientLevel || 20); setVoice(settings?.focusOnVoice ?? false); }, [settings?.ambientLevel, settings?.focusOnVoice]);
  const unavailable = disabled || mode !== ListeningMode.Aware || settings?.ambientLevel == null || settings?.focusOnVoice == null;
  const changed = level !== settings?.ambientLevel || voice !== settings?.focusOnVoice;
  return <div className="sony-ambient">
    <label className="sony-ambient-level"><span>Ambient sound level <output>{settings?.ambientLevel == null ? '—' : level}</output></span><input aria-label="Ambient sound level" type="range" min="1" max="20" value={level} disabled={unavailable} style={{ '--range-fill': `${(level - 1) / 19 * 100}%` } as CSSProperties} onChange={event => setLevel(Number(event.target.value))}/></label>
    <label className="sony-voice"><input type="checkbox" checked={voice} disabled={unavailable} onChange={event => setVoice(event.target.checked)}/>Focus on voice</label>
    {mode !== ListeningMode.Aware ? <p className="unavailable-note">Select Ambient sound to adjust what you hear.</p> : changed && <button className="small-button" disabled={unavailable} onClick={() => void onCommand({ type: 'sonyAmbient', level, focusOnVoice: voice })}>Apply ambient sound</button>}
  </div>;
}

export function SonyFeatures({ settings, disabled, onCommand }: { settings?: SonySettings; disabled: boolean; onCommand: (command: Command) => Promise<void> }) {
  const features: [SonySwitch, string, string][] = [
    ['speakToChat', 'Speak-to-Chat', 'Pause music when you start speaking.'],
    ['wearingDetection', 'Pause when removed', 'Pause playback when you take off your headphones.'],
    ['touchSensor', 'Touch controls', 'Enable the touch sensor on the right earcup.'],
    ['dsee', 'DSEE Extreme', 'Automatically enhance compressed audio.'],
  ];
  return <section className="control-card sony-features" aria-label="Sony features">{features.map(([setting, title, description]) => <div className="setting-row" key={setting}>
    <div className="setting-copy"><h3>{title}</h3><p>{settings?.[setting] == null ? 'Unavailable from these headphones.' : description}</p></div>
    <button type="button" className={`toggle ${settings?.[setting] ? 'is-on' : ''}`} role="switch" aria-label={title} aria-checked={settings?.[setting] === true} disabled={disabled || settings?.[setting] == null} onClick={() => void onCommand({ type: 'sonySwitch', setting, value: !settings?.[setting] })}><span/></button>
  </div>)}</section>;
}
