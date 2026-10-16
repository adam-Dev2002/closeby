import type { AudioPlayer } from 'expo-audio';
import { EMERGENCY_RING_MS, EMERGENCY_SOUND_ERROR } from '../lib/emergencyRing';

/** Returns cleanup immediately, including while the audio module is loading. */
export function startEmergencyRing(onError: (message: string) => void): () => void {
  let stopped = false, player: AudioPlayer | undefined;
  let subscription: { remove(): void } | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer); subscription?.remove();
    try { player?.pause(); } catch { /* The platform may already have stopped it. */ }
    try { player?.remove(); } catch { /* Release can race a native interruption. */ }
  };
  const fail = () => { if (!stopped) { stop(); onError(EMERGENCY_SOUND_ERROR); } };
  const timer = setTimeout(stop, EMERGENCY_RING_MS);
  void (async () => {
    const audio = await import('expo-audio');
    if (stopped) return;
    await audio.setAudioModeAsync({ playsInSilentMode: false, shouldPlayInBackground: false, interruptionMode: 'mixWithOthers' });
    if (stopped) return;
    player = audio.createAudioPlayer(require('../../assets/sounds/emergency-ring.wav'));
    player.loop = true; player.volume = 1;
    subscription = player.addListener('playbackStatusUpdate', status => { if (status.error) fail(); });
    player.play();
  })().catch(fail);
  return stop;
}
