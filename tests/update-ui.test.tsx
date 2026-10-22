// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UpdateStatus } from '../src/UpdateStatus';
import type { UpdateState } from '../src/shared/types';

afterEach(cleanup);
const state: UpdateState = { mode: 'automatic', status: 'idle', version: null, percent: null, message: null };
const api = () => ({ snapshot: vi.fn(), check: vi.fn(async () => {}), install: vi.fn(async () => {}), openRelease: vi.fn(async () => {}), subscribe: vi.fn() });

it('checks from Preferences and shows progress before offering restart', () => {
  const updates = api();
  const { rerender } = render(<UpdateStatus state={state} api={updates} expanded/>);
  fireEvent.click(screen.getByRole('button', { name: 'Check for Updates' }));
  expect(updates.check).toHaveBeenCalledOnce();
  rerender(<UpdateStatus state={{ ...state, status: 'downloading', version: '0.1.14', percent: 42 }} api={updates}/>);
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('42');
  expect(screen.getByRole('button', { name: 'Downloading…' }).hasAttribute('disabled')).toBe(true);
  expect(updates.install).not.toHaveBeenCalled();
  rerender(<UpdateStatus state={{ ...state, status: 'downloaded', version: '0.1.14', percent: 100 }} api={updates}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Restart to Update' }));
  expect(updates.install).toHaveBeenCalledOnce();
});

it('opens the release download page in manual mode and never offers automatic restart', () => {
  const updates = api();
  render(<UpdateStatus state={{ ...state, mode: 'manual', status: 'available', version: '0.1.14' }} api={updates}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Download Update' }));
  expect(updates.openRelease).toHaveBeenCalledOnce();
  expect(screen.queryByRole('button', { name: 'Restart to Update' })).toBeNull();
  expect(updates.install).not.toHaveBeenCalled();
});

it('keeps installation in the macOS software update window and offers a manual fallback', () => {
  const updates = api();
  const { rerender } = render(<UpdateStatus state={{ ...state, mode: 'sparkle', status: 'available', version: '0.1.14' }} api={updates}/>);
  expect(screen.getByRole('status').textContent).toContain('software update window');
  fireEvent.click(screen.getByRole('button', { name: 'Download Manually' }));
  expect(updates.openRelease).toHaveBeenCalledOnce();
  rerender(<UpdateStatus state={{ ...state, mode: 'sparkle', status: 'downloaded', version: '0.1.14' }} api={updates}/>);
  expect(screen.queryByRole('button', { name: 'Restart to Update' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Download Manually' })).toBeDefined();
  expect(updates.install).not.toHaveBeenCalled();
});

it('shows errors and lets the user retry', async () => {
  const updates = api(); updates.check.mockRejectedValueOnce(new Error('IPC failed'));
  render(<UpdateStatus state={{ ...state, status: 'error', message: 'Could not complete the update.' }} api={updates}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
  expect(await screen.findByRole('alert')).toBeDefined();
});

it('hides idle banners and disables update actions in development', () => {
  const updates = api();
  const { rerender } = render(<UpdateStatus state={state} api={updates}/>);
  expect(screen.queryByRole('region', { name: 'App updates' })).toBeNull();
  rerender(<UpdateStatus state={{ ...state, mode: 'disabled', message: 'Update checks are available in the installed app.' }} api={updates} expanded/>);
  expect(screen.getByRole('status').textContent).toContain('installed app');
  expect(screen.queryByRole('button')).toBeNull();
});
