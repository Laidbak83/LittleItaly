import { Alert, Platform } from 'react-native';

// Alert.alert ne fait rien sur le web : on utilise la boîte de dialogue du navigateur.
export function showAlert(title: string, message?: string) {
  if (Platform.OS === 'web') window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}
