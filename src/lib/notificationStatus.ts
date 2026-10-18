export type NotificationStatus = 'checking' | 'enabled' | 'prompt' | 'blocked' | 'unsupported' | 'unavailable';

export function resolveNotificationStatus(state: {
  supported: boolean;
  nativePermission?: NotificationPermission;
  permission: boolean;
  optedIn: boolean;
  id: string | null;
  token: string | null;
}): NotificationStatus {
  if (state.nativePermission === 'denied') return 'blocked';
  if (!state.supported) return 'unsupported';
  const permitted = state.nativePermission ? state.nativePermission === 'granted' : state.permission;
  return permitted && state.optedIn && Boolean(state.id && state.token) ? 'enabled' : 'prompt';
}
