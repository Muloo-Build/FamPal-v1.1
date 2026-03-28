// Push Notifications — Capacitor scaffold
// Requires: npm install @capacitor/push-notifications
// This file sets up the infrastructure. Actual plugin install is a separate step.

let pushInitialised = false;

export async function initialisePushNotifications(): Promise<boolean> {
  if (pushInitialised) return true;

  // Check if we're in a native Capacitor context
  const isNative = typeof (window as any).Capacitor !== 'undefined'
    && (window as any).Capacitor.isNativePlatform?.();

  if (!isNative) {
    console.log('[Push] Not a native platform — skipping push init');
    return false;
  }

  try {
    // Dynamic import so web builds don't fail if plugin isn't installed
    const { PushNotifications } = await import('@capacitor/push-notifications').catch(() => ({ PushNotifications: null }));
    if (!PushNotifications) {
      console.warn('[Push] @capacitor/push-notifications not installed');
      return false;
    }

    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== 'granted') {
      console.log('[Push] Permission denied');
      return false;
    }

    await PushNotifications.register();

    PushNotifications.addListener('registration', (token) => {
      console.log('[Push] Token:', token.value);
      // TODO: send token to server POST /api/push/register
    });

    PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('[Push] Received:', notification);
    });

    PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
      console.log('[Push] Action:', action);
      // TODO: navigate to relevant screen based on action.notification.data
    });

    pushInitialised = true;
    return true;
  } catch (err) {
    console.error('[Push] Init error:', err);
    return false;
  }
}
