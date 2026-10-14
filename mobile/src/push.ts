import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

// Depuis Expo SDK 53, les notifications push ne fonctionnent plus dans Expo Go sur Android, et le
// simple fait de CHARGER `expo-notifications` y lève une erreur qui bloque toute l'appli.
// On ne charge donc le module que dans une vraie appli (build) ou sur iOS, et jamais en import statique.
let cached: NotificationsModule | null | undefined;
function notifications(): NotificationsModule | null {
  if (cached !== undefined) return cached;
  cached = null;
  const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  if (inExpoGo && Platform.OS === 'android') return cached;
  try {
    const N = require('expo-notifications') as NotificationsModule;
    N.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    cached = N;
  } catch {
    cached = null;
  }
  return cached;
}

// À appeler au démarrage : permet d'afficher une notification reçue pendant que l'appli est ouverte.
export function initPush() {
  notifications();
}

// Renvoie le jeton push, ou null si indisponible (simulateur, refus, Expo Go Android…).
// Ne bloque jamais la commande : la notification est un plus.
export async function getPushToken(): Promise<string | null> {
  try {
    const N = notifications();
    if (!N || !Device.isDevice) return null;
    if (Platform.OS === 'android') {
      await N.setNotificationChannelAsync('default', {
        name: 'Commandes',
        importance: N.AndroidImportance.HIGH,
      });
    }
    let { status } = await N.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await N.requestPermissionsAsync());
    if (status !== 'granted') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) return null;
    return (await N.getExpoPushTokenAsync({ projectId })).data;
  } catch {
    return null;
  }
}
