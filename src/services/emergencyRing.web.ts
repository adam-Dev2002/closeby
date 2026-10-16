import { Asset } from 'expo-asset';
import { EMERGENCY_RING_MS, EMERGENCY_SOUND_ERROR } from '../lib/emergencyRing';

export function startEmergencyRing(onError: (message: string) => void): () => void {
  const audio = new Audio(Asset.fromModule(require('../../assets/sounds/emergency-ring.wav')).uri);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer); audio.onerror = null;
    audio.pause(); audio.removeAttribute('src'); audio.load();
  };
  const fail = () => { if (!stopped) { stop(); onError(EMERGENCY_SOUND_ERROR); } };
  const timer = setTimeout(stop, EMERGENCY_RING_MS);
  audio.loop = true; audio.volume = 1; audio.onerror = fail;
  void audio.play().catch(fail);
  return stop;
}
