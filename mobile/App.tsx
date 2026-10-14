import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { initStripe } from '@stripe/stripe-react-native';
import { AppConfig, getConfig } from './src/api';
import { CartProvider, useCart } from './src/cart';
import { CartScreen } from './src/CartScreen';
import { MenuScreen } from './src/MenuScreen';
import { OrderScreen } from './src/OrderScreen';
import { loadSaved } from './src/storage';
import { colors } from './src/theme';

type Tab = 'menu' | 'cart' | 'order';

function Shell() {
  const cart = useCart();
  const [tab, setTab] = useState<Tab>('menu');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    loadSaved().then((s) => setOrderId(s.lastOrderId));
    getConfig()
      .then(async (c) => {
        if (c.stripePublishableKey) await initStripe({ publishableKey: c.stripePublishableKey });
        setConfig(c);
      })
      .catch(() => setConfig({ onlinePaymentEnabled: false, stripePublishableKey: null }));
  }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'menu', label: 'Carte' },
    { key: 'cart', label: cart.count ? `Panier (${cart.count})` : 'Panier' },
    { key: 'order', label: 'Ma commande' },
  ];

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.logo}>🍕 Little Italy</Text>
        <Text style={styles.tag}>Pizzas à emporter · Trans-en-Provence</Text>
      </View>
      <View style={{ flex: 1 }}>
        {tab === 'menu' && <MenuScreen />}
        {tab === 'cart' && (
          <CartScreen
            config={config}
            onOrdered={(id) => {
              setOrderId(id);
              setTab('order');
            }}
          />
        )}
        {tab === 'order' && <OrderScreen orderId={orderId} />}
      </View>
      <View style={styles.tabs}>
        {tabs.map((t) => (
          <Pressable key={t.key} style={styles.tab} onPress={() => setTab(t.key)}>
            <Text style={[styles.tabText, tab === t.key && styles.tabOn]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <CartProvider>
        <Shell />
      </CartProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.red, paddingHorizontal: 16, paddingVertical: 12 },
  logo: { color: '#fff', fontSize: 22, fontWeight: '800' },
  tag: { color: '#ffffffcc', fontSize: 13 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText: { color: colors.muted, fontWeight: '600' },
  tabOn: { color: colors.red },
});
