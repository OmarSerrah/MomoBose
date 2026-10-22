import { useEffect, useState } from 'react';
import type { UpdateAPI, UpdateState } from './shared/types';

export function useUpdates(api?: UpdateAPI) {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    if (!api) return;
    let alive = true, received = false;
    const unsubscribe = api.subscribe(value => { received = true; if (alive) setState(value); });
    void api.snapshot().then(value => { if (alive && !received) setState(value); }).catch(() => {});
    return () => { alive = false; unsubscribe(); };
  }, [api]);
  return state;
}

export function UpdateStatus({ state, api, expanded = false }: { state: UpdateState | null; api?: UpdateAPI; expanded?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  if (!state || !api || (!expanded && !['available', 'downloading', 'downloaded', 'error'].includes(state.status))) return null;
  const pending = ['checking', 'downloading'].includes(state.status);
  const text = state.status === 'checking' ? 'Checking for updates…'
    : state.status === 'available' ? state.mode === 'sparkle' ? `MomoBose ${state.version} is available. Continue in the software update window, or download the release manually.` : `MomoBose ${state.version} is available. Download and install the new version to update.`
    : state.status === 'downloading' ? `Downloading MomoBose ${state.version}… ${state.percent ?? 0}%`
    : state.status === 'downloaded' ? state.mode === 'sparkle' ? `MomoBose ${state.version} is ready. Complete installation in the software update window.` : `MomoBose ${state.version} is ready. Restart to install the update.`
    : state.message ?? (state.mode === 'automatic' ? 'Updates download automatically. You choose when to restart.' : 'New releases are checked automatically. Download and install them to update.');
  const manualSparkle = state.mode === 'sparkle' && ['available', 'downloaded', 'error'].includes(state.status);
  const action = state.status === 'downloaded' && state.mode !== 'sparkle' ? () => api.install() : manualSparkle || state.status === 'available' ? () => api.openRelease() : () => api.check();
  const label = state.status === 'downloaded' && state.mode !== 'sparkle' ? 'Restart to Update' : manualSparkle ? 'Download Manually' : state.status === 'available' ? 'Download Update' : state.status === 'error' ? 'Try Again' : 'Check for Updates';
  return <section className={`update-status ${expanded ? 'update-preference' : 'update-banner'}`} aria-label="App updates">
    <div><strong>{expanded ? 'App updates' : 'Software update'}</strong><p role="status">{text}</p>{error && <p role="alert">{error}</p>}</div>
    {state.status === 'downloading' && <progress aria-label="Update download progress" value={state.percent ?? 0} max={100}/>}
    {state.mode !== 'disabled' && <button className="text-button" disabled={pending} onClick={() => {
      setError(null); void action().catch(() => setError('Could not complete this action. Please try again.'));
    }}>{pending ? state.status === 'checking' ? 'Checking…' : 'Downloading…' : label}</button>}
  </section>;
}
