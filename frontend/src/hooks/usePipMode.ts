import { useEffect, useState } from 'react';
import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

interface PipModeChangeEvent {
  isPip?: boolean;
}

// Subscribe to the native PiP state so UI can hide itself in compact mode.
export function usePipMode() {
  const [isPip, setIsPip] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    const pipModule = NativeModules.PipModule;
    if (!pipModule) {
      return;
    }

    const emitter = new NativeEventEmitter(pipModule);
    const sub = emitter.addListener(
      'onPictureInPictureModeChanged',
      (event: PipModeChangeEvent) => {
        if (event && typeof event.isPip === 'boolean') {
          setIsPip(event.isPip);
        }
      },
    );

    return () => sub.remove();
  }, []);

  return isPip;
}
