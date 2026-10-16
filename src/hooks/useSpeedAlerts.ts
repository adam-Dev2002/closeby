import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { createSpeedAlertEvaluator, type SpeedAlertEvent, type SpeedAlertOptions } from '../lib/speedAlerts';
import type { DeviceProfile } from '../types';

type Options = SpeedAlertOptions & { devices: DeviceProfile[] };

/** Foreground alerts are derived from fresh measured GPS fixes, with no automatic sharing. */
export function useSpeedAlerts({ devices, enabled, limitKmh, scope, ownDeviceId, ownTracking }: Options) {
  const context = JSON.stringify([scope, enabled, limitKmh, ownDeviceId]);
  const evaluator = useRef(createSpeedAlertEvaluator());
  const [queue, setQueue] = useState({ context, events: [] as SpeedAlertEvent[] });
  const [foreground, setForeground] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      evaluator.current.pause();
      setQueue(previous => ({ ...previous, events: [] }));
      setForeground(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    evaluator.current.reset();
    setQueue({ context, events: [] });
  }, [context]);

  useEffect(() => {
    if (!ownTracking) {
      evaluator.current.removeDevice(ownDeviceId);
      setQueue(previous => ({ ...previous, events: previous.events.filter(event => event.deviceId !== ownDeviceId) }));
    }
  }, [ownTracking, ownDeviceId]);

  useEffect(() => {
    if (!foreground || AppState.currentState !== 'active') return;
    evaluator.current.retainDevices(devices.map(device => device.id));
    const options = { enabled, limitKmh, scope, ownDeviceId, ownTracking };
    const events: SpeedAlertEvent[] = [];
    const now = Date.now();
    for (const device of devices) {
      const event = evaluator.current.evaluate(device, options, now);
      if (event) events.push(event);
    }
    if (events.length) setQueue(previous => ({ context, events: [...(previous.context === context ? previous.events : []), ...events].slice(-20) }));
  }, [devices, enabled, limitKmh, scope, ownDeviceId, ownTracking, foreground, context]);

  const dismissAlert = useCallback(() => setQueue(previous => ({ ...previous, events: previous.events.slice(1) })), []);
  return { latestAlert: queue.context === context ? queue.events[0] ?? null : null, dismissAlert };
}
