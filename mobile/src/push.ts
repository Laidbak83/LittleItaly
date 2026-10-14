import * as Device from 'expo-device';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

type NotificationsModule = typeof import('expo-notifications');

// Depuis Expo SDK 53, les notifications push ne fonctionnent plus dans Expo Go sur Android, et le
// simple fait de CHARGER `expo-notifications` y lève une erreur qui bloque toute l'appli.
// On ne charge donc le module que dans une vraie appli (build) ou sur iOS, et jamais en import statique.
let cached: NotificationsModule | null | undefined;
let onOpen: (() => void) | null = null;
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
    // Toucher une notification (appli ouverte ou en arrière-plan) ouvre le suivi de commande.
    N.addNotificationResponseReceivedListener(() => onOpen?.());
    cached = N;
  } catch {
    cached = null;
  }
  return cached;
}

// À appeler au démarrage : affiche les notifications reçues appli ouverte, et ouvre le suivi quand on en touche une
// (y compris quand c'est la notification qui a lancé l'appli).
export function initPush(openOrder: () => void) {
  onOpen = openOrder;
  const N = notifications();
  try {
    if (N?.getLastNotificationResponse()) {
      openOrder();
      N.clearLastNotificationResponse();
    }
  } catch {
    // jamais bloquant
  }
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
