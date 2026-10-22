import { useEffect, useLayoutEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Bluetooth, Check, ChevronDown, CircleHelp, ExternalLink, Headphones, Laptop, Link2, LoaderCircle, Power, RefreshCw, Settings2, Volume2, Waves, X } from 'lucide-react';
import { ListeningMode, type AppState, type Command, type DesktopAPI, type Headset } from './shared/types';
import { createDemoAPI } from './shared/demo';
import { supportedDevice } from './shared/models';
import { productForDevice } from './shared/products';
import { SonyAmbient, SonyEqualizer, SonyFeatures } from './SonyControls';
import { UpdateStatus, useUpdates } from './UpdateStatus';
import './style.css';

declare global { interface Window { momoBose?: DesktopAPI } }
const params = new URLSearchParams(location.search);
const isWidget = params.has('widget');
const api: DesktopAPI | null = window.momoBose ?? (params.get('demo') === '1' ? import.meta.hot?.data.demoAPI ?? createDemoAPI(params.has('airpods') ? parseInt(params.get('airpods')!, 16) : undefined, params.get('sony') === 'xm4' ? 'xm4' : params.get('sony') === 'xm5' ? 'xm5' : undefined) : null);
if (import.meta.hot && !window.momoBose) import.meta.hot.dispose(data => { data.demoAPI = api; });

function AirPodsIllustration({ max, pro }: { max: boolean; pro: boolean }) {
  return <svg className="airpods-illustration" role="img" aria-label="AirPods illustration" viewBox="0 0 240 220" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
    {max ? <><path d="M53 118V91a67 67 0 0 1 134 0v27"/><path d="M64 106V87a56 56 0 0 1 112 0v19" strokeWidth="3"/><rect x="36" y="106" width="42" height="87" rx="20"/><rect x="162" y="106" width="42" height="87" rx="20"/></> : <><path d="M75 55c-23 0-39 17-39 36s14 31 32 31v64c0 10 17 10 17 0V92c0-23-2-37-10-37Z"/><path d="M165 55c23 0 39 17 39 36s-14 31-32 31v64c0 10-17 10-17 0V92c0-23 2-37 10-37Z"/>{pro ? <><path d="M39 87H23c-8 0-8 19 0 19h16"/><path d="M201 87h16c8 0 8 19 0 19h-16"/></> : <><path d="M48 81c8-7 17-6 22-1" strokeWidth="4"/><path d="M192 81c-8-7-17-6-22-1" strokeWidth="4"/></>}</>}
  </svg>;
}
function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (value: boolean) => void }) {
  return <button type="button" className={`toggle ${checked ? 'is-on' : ''}`} role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}><span/></button>;
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const restoreFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
    }
    return () => { restoreFocus.current?.focus(); };
  }, []);
  return <dialog ref={ref} className="modal" aria-label={title} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) { const box = e.currentTarget.getBoundingClientRect(); if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose(); } }}>
    <div className="modal-header"><h2>{title}</h2><button autoFocus className="icon-button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={18}/></button></div>
    <div className="modal-body">{children}</div>
  </dialog>;
}
function DeviceChooser({ devices, selected, name, disabled, connected, onSelect, onRefresh }: { devices: Headset[]; selected: string; name: string; disabled: boolean; connected: boolean; onSelect: (address: string) => void; onRefresh: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const identified = devices.filter(supportedDevice);
  const choices = !showAll && identified.length ? devices.filter(d => identified.includes(d) || d.address === selected) : devices;
  const trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const nativePopover = typeof HTMLElement.prototype.showPopover === 'function';
  const identity = devices.map(d => `${d.address}:${d.name}:${d.productId}`).join('|');
  const supported = (device: Headset) => !device.productId || supportedDevice(device);
  function close(restore = true) {
    if (menu.current?.hidePopover && menu.current.matches(':popover-open')) menu.current.hidePopover();
    setOpen(false); setShowAll(false);
    if (restore) trigger.current?.focus();
  }
  useLayoutEffect(() => {
    if (!open || !menu.current || !trigger.current) return;
    const popup = menu.current, rect = trigger.current.getBoundingClientRect();
    const width = Math.min(280, innerWidth - 32);
    popup.style.left = `${Math.max(16, Math.min(innerWidth - width - 16, rect.left + rect.width / 2 - width / 2))}px`;
    popup.style.top = `${rect.bottom + 8}px`;
    if (popup.showPopover && !popup.matches(':popover-open')) popup.showPopover();
    if (popup.getBoundingClientRect().bottom > innerHeight - 16) popup.style.top = `${Math.max(16, rect.top - popup.offsetHeight - 8)}px`;
    const selectedOption = popup.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]:not(:disabled)');
    (selectedOption ?? popup.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)') ?? popup.querySelector<HTMLButtonElement>('button'))?.focus();
  }, [open, identity, showAll]);
  useEffect(() => {
    if (!open) return;
    const onResize = () => close(false);
    const onScroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) close(false); };
    const onOutside = (event: PointerEvent) => { if (!nativePopover && !menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close(false); };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('pointerdown', onOutside);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('pointerdown', onOutside); }; 
  }, [open]);
  return <>
    <h1 title={name} aria-label={name}><button ref={trigger} className="device-name-button" aria-label="Choose headphones" aria-haspopup="listbox" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={() => open ? close() : setOpen(true)} onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}><span>{name}</span><ChevronDown size={14}/></button></h1>
    <div ref={menu} id={id} popover={nativePopover ? 'auto' : undefined} hidden={!open} className="device-menu" onToggle={e => { if (e.newState === 'closed') { setOpen(false); setShowAll(false); } }} onBlur={e => { if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node) && e.relatedTarget !== trigger.current) close(false); }} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      const options = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')];
      const index = options.indexOf(document.activeElement as HTMLButtonElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key) && options.length) {
        e.preventDefault();
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options[next].focus();
      }
    }}>
      <div className="device-menu-header"><span>{connected ? 'Switch headphones' : 'Headphones'}</span><button className="icon-button" aria-label="Refresh paired devices" disabled={disabled} onClick={() => void onRefresh()}><RefreshCw size={14} className={disabled ? 'spin' : ''}/></button></div>
      <div role="listbox" aria-label="Paired headphones" className="device-options">{choices.length ? choices.map(item => <button key={item.address} type="button" role="option" aria-selected={item.address === selected} disabled={disabled || !supported(item)} tabIndex={item.address === selected ? 0 : -1} onClick={() => { onSelect(item.address); close(); }}>
        <Headphones size={18}/><span><strong>{item.name}</strong><small>{!supported(item) ? 'This model isn’t supported' : supportedDevice(item) ? productForDevice(item).name : 'Model unknown · select only a QC45'}{connected && item.address === selected ? ' · Connected' : ''}</small></span><span className="device-check">{item.address === selected && <Check size={14}/>}</span>
      </button>) : <p className="device-empty">No paired headphones found. Pair your headphones in Bluetooth settings, then refresh.</p>}</div>
      {!showAll && identified.length > 0 && identified.length < devices.length && <button className="device-other-button" onClick={() => setShowAll(true)}>Show other paired devices</button>}
    </div>
  </>;
}
function SourcesContent({ state, onCommand }: { state: AppState; onCommand: (command: Command) => Promise<void> }) {
  const [replacing, setReplacing] = useState<string | null>(null);
  const sources = state.settings.pairedSources;
  const connected = sources?.filter(source => source.connected) ?? [];
  const candidates = sources?.filter(source => !source.connected) ?? [];
  const old = sources?.find(source => source.address === replacing);
  const disabled = Boolean(state.busy) || state.connection !== 'connected';
  return <section className="sources-panel" aria-label="Paired audio sources">
    <div className="sources-summary"><p>{sources ? `${connected.length} of 2 connections in use` : 'Read the devices paired with your headphones.'}</p><button className="text-button" disabled={disabled} onClick={() => { setReplacing(null); void onCommand({ type: 'sources' }); }}><RefreshCw size={13}/>Refresh</button></div>
    {old ? <><button className="text-button" disabled={disabled} onClick={() => setReplacing(null)}>Back to connections</button><p className="source-replace-caption">Disconnect {old.name ?? 'this device'} and connect one of these paired devices. Pairings will be kept.</p><ul className="source-list">{candidates.map(source => <li key={source.address}><Bluetooth size={16}/><div><strong>{source.name ?? 'Bluetooth device'}</strong><small>Paired · not connected</small></div><button className="small-button" disabled={disabled || state.settings.multipoint !== true} aria-label={`Replace with ${source.name ?? 'Bluetooth device'}`} onClick={async () => { await onCommand({ type: 'sourceReplace', oldAddress: old.address, address: source.address }); setReplacing(null); }}>Connect instead</button></li>)}</ul>{!candidates.length && <p>No other paired devices are available. Pair a new device in its Bluetooth settings first.</p>}</> : <>
      {sources ? <ul className="source-list">{[...sources].sort((a, b) => Number(b.connected) - Number(a.connected)).map(source => <li key={source.address}><Bluetooth size={16}/><div><strong>{source.name ?? 'Bluetooth device'}</strong><small>{source.isLocalDevice ? 'This computer · app connection' : source.connected ? 'Connected' : 'Paired · not connected'}</small></div>{!source.isLocalDevice && (source.connected ? <div className="source-actions"><button className="text-button" disabled={disabled || !candidates.length || state.settings.multipoint !== true} aria-label={`Replace ${source.name ?? 'Bluetooth device'}`} onClick={() => setReplacing(source.address)}>Replace…</button><button className="text-button" disabled={disabled} aria-label={`Disconnect ${source.name ?? 'Bluetooth device'}`} onClick={() => void onCommand({ type: 'sourceDisconnect', address: source.address })}>Disconnect</button></div> : <button className="small-button" disabled={disabled || connected.length >= 2 || state.settings.multipoint !== true} aria-label={`Connect ${source.name ?? 'Bluetooth device'}`} onClick={() => void onCommand({ type: 'sourceConnect', address: source.address })}>Connect</button>)}</li>)}</ul> : <p className="unavailable-note">{state.busy ? 'Reading paired devices…' : 'The headphones have not provided a source list. Refresh to try again.'}</p>}
      <div className="source-guidance"><strong>Switching playback</strong><p>Pause audio on the current device, then play on the other connected device. Connection order does not set a primary playback device.</p><p>To replace this computer’s connection, use Bluetooth settings on the other device. Disconnecting this computer also closes app controls.</p></div>
    </>}
  </section>;
}
function VolumeControl({ value, writable, available, muted, busy, onApply }: { value: number | null; writable: boolean; available: boolean; muted: boolean | null; busy: boolean; onApply: (value: number) => Promise<void> }) {
  const [draft, setDraft] = useState(value ?? 0);
  const editing = useRef(false), pending = useRef(false), dirty = useRef(false), latest = useRef(value);
  latest.current = value;
  const disabled = busy || !available || !writable || value === null;
  useEffect(() => { if (!editing.current && !pending.current) setDraft(value ?? 0); }, [value, available]);
  async function commit(next: number) {
    editing.current = false;
    if (disabled || pending.current || !dirty.current || next === latest.current) return;
    dirty.current = false; pending.current = true;
    try { await onApply(next); }
    finally { pending.current = false; setDraft(latest.current ?? 0); }
  }
  const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
  return <section className="volume-section" aria-label="Headphone volume">
    <div className="volume-heading"><label htmlFor="headphone-volume">Volume</label><output htmlFor="headphone-volume">{value === null ? '—' : `${draft}%`}{muted === true && <span> · Muted</span>}</output></div>
    <div className="volume-slider"><Volume2 size={14}/><input id="headphone-volume" aria-label="Headphone volume" aria-valuetext={value === null ? 'Unavailable' : `${draft} percent${muted === true ? ', muted' : ''}`} type="range" min="0" max="100" step="1" value={draft} disabled={disabled} style={{ '--range-fill': `${draft}%` } as CSSProperties}
      onChange={e => { dirty.current = true; setDraft(Number(e.target.value)); }} onPointerDown={() => { editing.current = true; }} onPointerUp={e => void commit(Number(e.currentTarget.value))}
      onPointerCancel={() => { editing.current = false; dirty.current = false; setDraft(latest.current ?? 0); }}
      onKeyDown={e => { if (keys.includes(e.key)) editing.current = true; }} onKeyUp={e => { if (keys.includes(e.key)) void commit(Number(e.currentTarget.value)); }} onBlur={e => void commit(Number(e.currentTarget.value))}/></div>
    {(!available || value === null) && <p>{available ? 'Volume is unavailable for this output.' : 'Connect headphone audio to adjust volume.'}</p>}
  </section>;
}
function EqControl({ values, disabled, onApply }: { values: [number, number, number] | null; disabled: boolean; onApply: (values: [number, number, number]) => Promise<void> }) {
  const [draft, setDraft] = useState<[number, number, number]>(values ?? [0, 0, 0]);
  useEffect(() => { setDraft(values ?? [0, 0, 0]); }, [values?.join(',')]);
  const changed = values !== null && draft.some((v, i) => v !== values[i]);
  return <section className="control-card eq-section" aria-label="Equalizer">
    <div className="section-label"><h3>Equalizer</h3><button className="text-button" disabled={disabled || !values || draft.every(v => v === 0)} onClick={() => setDraft([0, 0, 0])}>Reset to flat</button></div>
    <div className="eq-controls">{['Bass', 'Mid', 'Treble'].map((label, i) => <label className="eq-band" key={label}>
      <span>{label}</span><output>{values ? `${draft[i] > 0 ? '+' : ''}${draft[i]}` : '—'}<small> dB</small></output>
      <input aria-label={label} aria-valuetext={values ? `${draft[i]} decibels` : 'Unavailable'} type="range" style={{ '--range-fill': `${(draft[i] + 10) * 5}%` } as CSSProperties} min="-10" max="10" step="1" value={draft[i]} disabled={disabled || !values} onChange={e => { const next = [...draft] as [number, number, number]; next[i] = Number(e.target.value); setDraft(next); }}/>
      <span className="range-labels"><span>−10</span><span>0</span><span>+10</span></span>
    </label>)}</div>
    {changed && <div className="eq-apply" role="status"><span>Unsaved equalizer changes</span><button disabled={disabled} className="small-button" onClick={() => void onApply(draft)}>Apply EQ</button></div>}
  </section>;
}

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [selected, setSelected] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [preferences, showPreferences] = useState(false);
  const updateState = useUpdates(api?.updates);
  const [diagnostics, showDiagnostics] = useState(false);
  const [sourceManager, showSources] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    if (!api) return;
    let alive = true;
    const unsubscribe = api.subscribe(value => { if (alive) setState(value); });
    void api.snapshot().then(value => { if (alive) setState(value); }).catch(error => { if (alive) setLocalError(error.message); });
    return () => { alive = false; unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!state) return;
    if (state.connection !== 'disconnected' || !selected || !state.devices.some(d => d.address === selected)) setSelected(state.device?.address ?? state.devices[0]?.address ?? '');
  }, [state?.devices, state?.device]);
  const connected = state?.connection === 'connected';
  const device = connected ? state?.device : state?.devices.find(d => d.address === selected) ?? state?.device;
  const product = productForDevice(device);
  const airpods = product.family === 'airpods';
  const sony = product.family === 'sony';
  useEffect(() => { setImageFailed(false); }, [product.image]);
  const appearance = state?.preferences.appearance ?? 'system';
  useEffect(() => { document.documentElement.dataset.appearance = appearance; return () => { delete document.documentElement.dataset.appearance; }; }, [appearance]);
  async function run(command: Command) {
    setLocalError(null);
    try { const result = await api?.command(command); if (result && !result.ok) setLocalError(result.error ?? 'Could not complete this action.'); }
    catch (error) { setLocalError((error as Error).message); }
  }
  if (!api) return <div className="browser-message"><Headphones size={40}/><h1>MomoBose</h1><p>Open the desktop app to connect to your headphones.</p><a href="?demo=1">Explore the interactive demo <ExternalLink size={14}/></a><small>The browser preview cannot access your headphones.</small></div>;
  if (!state) return <div className="loading-screen"><LoaderCircle className="spin"/><span>{localError ?? 'Opening MomoBose…'}</span></div>;
  const working = Boolean(state.busy);
  const disabled = !connected || working;
  const error = localError || state.error;
  const modeLabel = state.settings.mode === ListeningMode.Quiet ? 'Quiet' : state.settings.mode === ListeningMode.Aware ? 'Aware' : sony && state.settings.mode === ListeningMode.Off ? 'Noise control is off.' : state.settings.mode !== null ? 'Custom mode' : 'Unavailable';
  const ready = state.audio.available && state.audio.isDefault;
  const selectedAudio = device?.address === state.device?.address;
  const canConnect = Boolean(selected && (!device?.productId || supportedDevice(device)));
  const feedback = (error || state.notice || state.busy) && <div className={`message-strip ${error ? 'error-message' : ''}`} role={error ? 'alert' : 'status'}>{working ? <LoaderCircle size={15} className="spin"/> : <CircleHelp size={16}/>}<span>{error ?? state.busy ?? state.notice}</span>{error && <button className="icon-button" aria-label="Dismiss error" onClick={() => { setLocalError(null); void run({ type: 'dismissError' }); }}><X size={16}/></button>}</div>;
  return <div className={`app-shell ${isWidget ? 'widget' : ''} ${state.platform === 'darwin' ? 'on-mac' : ''} ${window.momoBose && state.platform === 'darwin' ? 'native-material' : ''}`}>
    <header className="app-header"><div className="wordmark"><span>MomoBose</span></div><div className="header-right">{state.demo && <span className="demo-tag">Demo · no device changes</span>}<button className="preferences-button" title="Preferences" aria-label="Preferences" aria-haspopup="dialog" aria-expanded={preferences} onClick={() => showPreferences(true)}><Settings2 size={16}/><span>Preferences</span></button></div></header>
    <main className="main-content">
      <section className="device-section" aria-label="Your headphones">
        <div className="device-heading"><DeviceChooser devices={state.devices} selected={selected} name={device?.name ?? 'Choose headphones'} disabled={working} connected={connected} onSelect={address => { setSelected(address); if (connected && address !== state.device?.address) void run({ type: 'connect', address, confirmedQc45: true }); }} onRefresh={() => run({ type: 'discover' })}/><div className="device-model"><Bluetooth size={13}/><span>{product.name}</span></div></div>
        <div className={`device-visual ${product.image && !imageFailed ? 'has-product-image' : ''}`}>
          {product.image && !imageFailed ? <img className="product-image" src={product.image} alt={product.name} onError={() => setImageFailed(true)}/> : airpods ? <AirPodsIllustration max={product.form === 'headphones'} pro={product.id.includes('pro')}/> : <div className="device-placeholder"><Headphones size={76} strokeWidth={1}/><span>{sony ? product.shortName : device ? 'Product image unavailable' : 'Choose your headphones'}</span></div>}
        </div>
        <div className={`status-label ${ready ? 'ready' : connected ? 'partial' : ''}`} role="status"><span className="status-dot"/>{ready ? 'Connected to this computer' : state.connection === 'connecting' ? 'Connecting controls…' : connected ? 'Settings connected · audio not selected' : state.audio.available ? 'Audio connected · controls offline' : 'Disconnected'}</div>
        {connected && (!airpods || !isWidget) && <div className="battery-label"><div className="battery-outline"><span style={{ width: `${state.settings.battery ?? 0}%` }}/></div><strong>{state.settings.battery !== null ? `${state.settings.battery}%` : '—'}</strong><span>{state.settings.battery !== null ? 'battery' : 'Battery unavailable'}</span></div>}
        <VolumeControl value={selectedAudio ? state.audio.volume : null} writable={selectedAudio && state.audio.volumeWritable} available={selectedAudio && state.audio.available} muted={state.audio.muted} busy={working} onApply={value => run({ type: 'volume', value })}/>

        <div className="device-actions"><button aria-label={state.connection === 'connecting' ? 'Connecting…' : connected ? 'Disconnect from this computer' : 'Connect to this computer'} className={`connect-button ${connected ? 'connected-button' : ''}`} disabled={working || (!connected && !canConnect)} onClick={() => void run(connected ? { type: 'disconnect' } : { type: 'connect', address: selected, confirmedQc45: true })}>{working && !connected ? <LoaderCircle size={16} className="spin"/> : connected ? <Power size={15}/> : <Bluetooth size={16}/>}<span>{state.connection === 'connecting' ? 'Connecting…' : connected ? 'Disconnect' : state.audio.available && !airpods ? 'Connect controls' : 'Connect'}</span></button><button className="device-settings text-button" onClick={() => void run({ type: 'openSettings', page: 'bluetooth' })}>Bluetooth settings <ExternalLink size={12}/></button></div>
      </section>
      <div className="controls-section">
        <div className="controls-heading"><div><h2>{airpods ? 'Your AirPods' : 'Sound'}</h2><p>{airpods ? 'Audio and battery at a glance.' : connected ? 'Adjust the sound of your headphones.' : 'Connect headphone controls to adjust sound settings.'}</p></div></div>
        {!airpods && <><section className="control-card listening-section"><div className="section-label"><h3>Listening mode</h3></div><div className={`mode-picker ${sony ? 'sony-mode-picker' : ''}`} role="group" aria-label="Listening mode">{[
          { value: ListeningMode.Quiet, title: sony ? 'Noise cancelling' : 'Quiet', description: 'Noise cancellation', Icon: Headphones },
          { value: ListeningMode.Aware, title: sony ? 'Ambient sound' : 'Aware', description: 'Hear your surroundings', Icon: Waves },
          ...(sony ? [{ value: ListeningMode.Off, title: 'Off', description: 'Noise control off', Icon: Power }] : []),
        ].map(({ value, title, description, Icon }) => <button key={value} aria-pressed={connected && state.settings.mode === value} disabled={disabled || state.settings.mode === null} className={connected && state.settings.mode === value ? 'active' : ''} onClick={() => void run({ type: 'mode', value })}><Icon size={16}/><span><strong>{title}</strong><small className="sr-only">{description}</small></span></button>)}</div><p className="mode-description">{!connected ? 'Connect your headphones to select a mode.' : state.settings.mode === ListeningMode.Quiet ? 'Noise cancellation reduces background sound.' : state.settings.mode === ListeningMode.Aware ? 'Hear your surroundings while you listen.' : modeLabel}</p>{connected && state.settings.mode === null && <p className="unavailable-note">Listening mode is unavailable from these headphones. Try refreshing.</p>}</section>
        {sony && !isWidget && <SonyAmbient key={`ambient-${device?.address}`} settings={connected ? state.settings.sony : undefined} mode={connected ? state.settings.mode : null} disabled={disabled} onCommand={run}/>}
        {!isWidget && (sony ? <SonyEqualizer key={`eq-${device?.address}`} settings={connected ? state.settings.sony : undefined} disabled={disabled} onCommand={run}/> : <EqControl key={connected ? device?.address : 'disconnected'} values={connected ? state.settings.eq : null} disabled={disabled} onApply={value => run({ type: 'eq', value })}/>)}
        <section className="control-card connection-settings" aria-label="Connection and calls"><div className="setting-row"><div className="setting-icon"><Link2 size={19}/></div><div className="setting-copy"><h3>Multipoint</h3><p>Connect to two devices at once.</p></div><Toggle label="Multipoint" checked={connected && state.settings.multipoint === true} disabled={disabled || state.settings.multipoint === null} onChange={value => void run({ type: 'multipoint', value })}/></div><p className="multipoint-note">Turning this off disconnects the second device.</p>
        {connected && state.settings.multipoint === true && <div className="multipoint-sources" role="region" aria-label="Other connected devices"><div className="multipoint-sources-heading"><h4>Other connected devices</h4>{(!sony || state.settings.sony?.sourceManagement) && <button className="text-button" disabled={working} aria-haspopup="dialog" onClick={() => { showSources(true); void run({ type: 'sources' }); }}>Manage connections</button>}</div>{state.settings.connectedDevices == null ? <p>Connected-device details are unavailable.{sony && !state.settings.sony?.sourceManagement ? ' Manage connections in Sony Sound Connect.' : ''}</p> : state.settings.connectedDevices.filter(item => !item.isLocalDevice).length ? <ul>{state.settings.connectedDevices.filter(item => !item.isLocalDevice).map(item => <li key={item.address}><Bluetooth size={13}/><span>{item.name ?? `Bluetooth device · ${item.address.slice(-8)}`}</span><small>Connected</small></li>)}</ul> : <p>No other devices connected.</p>}</div>}
        {!isWidget && !sony && <div className="setting-row self-voice"><div className="setting-icon"><Volume2 size={19}/></div><div className="setting-copy"><h3>Self voice</h3><p>Hear your own voice during calls.</p></div><select aria-label="Self voice" disabled={disabled || state.settings.sidetone === null} value={state.settings.sidetone ?? ''} onChange={e => void run({ type: 'sidetone', value: Number(e.target.value) })}><option value="" disabled>Unavailable</option><option value="0">Off</option><option value="3">Low</option><option value="2">Medium</option><option value="1">High</option></select></div>}</section>
        {sony && !isWidget && <SonyFeatures settings={connected ? state.settings.sony : undefined} disabled={disabled} onCommand={run}/>}
        </>}
        {airpods && <>
          <section className="control-card airpods-battery" aria-label="AirPods battery"><h3>Battery</h3>
            {product.form === 'headphones' ? <div className="airpods-battery-values single"><span>Headphones<strong>{connected && state.settings.battery !== null ? `${state.settings.battery}%` : '—'}</strong></span></div> : <div className="airpods-battery-values">{(['left', 'right', 'case'] as const).map(part => <span key={part}>{part === 'left' ? 'Left' : part === 'right' ? 'Right' : 'Case'}<strong>{connected && state.settings.batteries?.[part] !== null && state.settings.batteries?.[part] !== undefined ? `${state.settings.batteries[part]}%` : '—'}</strong></span>)}</div>}
            <p>{!connected ? 'Connect your AirPods to read battery levels.' : state.platform === 'darwin' ? 'Case and earbuds report separately.' : 'Battery levels are not available from Windows for these AirPods.'}</p>
          </section>
          <section className="control-card airpods-settings"><div className="setting-row"><div className="setting-icon"><Settings2 size={19}/></div><div className="setting-copy"><h3>AirPods settings</h3><p>{product.noiseControl ? 'Noise control, switching, and microphone options.' : 'Switching, microphone, and ear detection options.'}</p></div></div><p>{state.platform === 'darwin' ? product.automaticSwitching === true ? 'Automatic switching between Apple devices is managed by macOS. Use the same Apple Account on each device.' : product.automaticSwitching === false ? 'This model uses manual device switching. Choose Connect to use it on this Mac.' : 'Manage available features and device switching in macOS.' : 'Use your AirPods controls for listening modes. Additional options are available on Apple devices.'}</p><button className="text-button" onClick={() => void run({ type: 'openSettings', page: 'airpods' })}>{state.platform === 'darwin' ? 'Open AirPods settings' : 'Open Bluetooth settings'} <ExternalLink size={13}/></button></section>
        </>}
        <div className={`audio-state ${ready ? 'audio-ready' : ''}`}><Laptop size={19}/><div><strong>{ready ? 'Computer audio is ready' : state.audio.available ? 'Select your headphone output' : connected ? 'Waiting for headphone audio' : 'No headphone audio connected'}</strong><span>{ready ? `${state.audio.name ?? device?.name ?? product.shortName} is your default audio output.` : state.audio.available ? 'Choose these headphones as your output in Sound settings.' : connected ? 'Bluetooth controls are connected. Select your headphones in Sound settings.' : 'Turn on your headphones, then connect to this computer.'}</span></div>{state.audio.available && !ready && <button className="text-button" disabled={working} onClick={() => void run({ type: 'selectOutput' })}>Use here</button>}{(connected || state.audio.available) && <button className="icon-button" aria-label="Open Sound settings" title="Sound settings" onClick={() => void run({ type: 'openSettings', page: 'sound' })}><ExternalLink size={15}/></button>}</div>
      </div>
    </main>
    {!preferences && !diagnostics && !sourceManager && feedback}
    {!preferences && <UpdateStatus state={updateState} api={api?.updates}/>}
    <footer className="app-footer"><span className="firmware-label">{state.demo ? 'Demo preview' : `MomoBose ${state.version}`}<span className="footer-separator">·</span>{state.settings.firmware && connected ? `Firmware ${state.settings.firmware.split('-')[0]}` : 'Desktop audio companion'}</span><div>{isWidget ? <button className="text-button" onClick={() => void run({ type: 'showWindow' })}>All controls <ExternalLink size={13}/></button> : <><button className="text-button" disabled={working || !device} onClick={() => void run({ type: 'refresh' })}><RefreshCw size={13} className={working ? 'spin' : ''}/>Refresh</button><button className="text-button" aria-haspopup="dialog" aria-expanded={diagnostics} onClick={() => showDiagnostics(true)}>Connection details <ChevronDown size={13}/></button></>}</div></footer>
    {sourceManager && <Modal title="Connections" onClose={() => showSources(false)}>{feedback}<SourcesContent state={state} onCommand={run}/></Modal>}
    {preferences && <Modal title="Preferences" onClose={() => showPreferences(false)}>{feedback}<div className="preferences-panel"><div className="appearance-setting"><strong>Appearance</strong><div className="appearance-picker" role="group" aria-label="Appearance">{(['system', 'light', 'dark'] as const).map(value => <button key={value} disabled={working} aria-pressed={state.preferences.appearance === value} onClick={() => void run({ type: 'preferences', value: { appearance: value } })}>{value === 'system' ? 'System' : value === 'light' ? 'Light' : 'Dark'}</button>)}</div><p>System follows your computer’s appearance.</p></div>{([
      ['autoReconnect', 'Reconnect automatically', 'Try again after sleep or a lost connection.'], ['launchAtLogin', 'Open at login', 'Keep MomoBose ready in your menu bar or tray.'], ['showBatteryInTray', 'Battery in the menu bar', 'Show battery percentage beside the menu bar icon.'],
    ] as const).filter(([key]) => key !== 'showBatteryInTray' || state.platform === 'darwin').map(([key, title, caption]) => <div className="preference-row" key={key}><div><strong>{title}</strong><p>{caption}</p></div><Toggle label={title} disabled={working} checked={state.preferences[key]} onChange={value => void run({ type: 'preferences', value: { [key]: value } })}/></div>)}<UpdateStatus state={updateState} api={api?.updates} expanded/><div className="modal-actions"><button className="text-button" onClick={() => void run({ type: 'openSettings', page: 'permissions' })}>Bluetooth permissions <ExternalLink size={13}/></button><button className="text-button quit-button" onClick={() => void run({ type: 'quit' })}>Quit MomoBose</button></div></div></Modal>}
    {diagnostics && !isWidget && <Modal title="Connection details" onClose={() => showDiagnostics(false)}>{feedback}<section className="diagnostics"><div className="diagnostic-status"><span>Controls<strong>{connected ? 'Connected' : 'Disconnected'}</strong></span><span>Audio<strong>{state.audio.available ? 'Available' : 'Unavailable'}</strong></span><span>Default output<strong>{state.audio.isDefault ? state.audio.name ?? product.shortName : 'Other / unavailable'}</strong></span></div>{device && <p className="device-address">Bluetooth address <code>{device.address}</code></p>}<p>{airpods ? 'Take your AirPods out of the case and check their connection in Bluetooth settings.' : sony ? 'If connecting fails, turn your headphones on, close Sony Sound Connect on your phone, and check whether two other devices are connected.' : 'If connecting fails, turn your QC45 on, close the Bose app, and check whether two other devices are connected.'}</p><button className="text-button" onClick={() => void run({ type: 'openSettings', page: 'permissions' })}>Check Bluetooth permissions <ExternalLink size={13}/></button><h3>Recent activity</h3>{state.logs.length ? <ol>{state.logs.map((log, i) => <li key={`${log.time}-${i}`} className={log.level === 'error' ? 'log-error' : ''}><time>{new Date(log.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time><span>{log.message}</span></li>)}</ol> : <p>No connection activity yet.</p>}</section></Modal>}
  </div>;
}
