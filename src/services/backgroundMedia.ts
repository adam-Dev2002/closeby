import type { SpaceCall } from '../lib/calls';
import type { BackgroundMediaSnapshot } from '../lib/backgroundMedia';
export type { BackgroundMediaSnapshot } from '../lib/backgroundMedia';
// iOS and web retain the visible, foreground-only media screen.
export const backgroundMediaSupported = () => false;
export const getBackgroundMedia = (): BackgroundMediaSnapshot | null => null;
export const backgroundMediaError = (): string | null => null;
export const subscribeBackgroundMedia = (_listener: () => void): (() => void) => () => {};
export async function startBackgroundMedia(_call: SpaceCall, _uid: string): Promise<void> { throw new Error('Background device sharing requires the updated Android app.'); }
export function stopBackgroundMedia(_id?: string): void {}
export function setBackgroundMediaControls(_id: string, _muted: boolean, _cameraOff: boolean): void {}
export async function runBackgroundMediaTask(_data: { id: string }): Promise<void> {}
