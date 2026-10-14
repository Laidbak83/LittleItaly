import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { showAlert } from './src/alert';
import { InfoScreen } from './src/InfoScreen';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { initStripe } from './src/stripe';
import { AppConfig, getConfig, getLoyalty, getMenu, getOrder, Loyalty, MenuData, Order } from './src/api';
import { CartProvider, useCart } from './src/cart';
import { CartScreen } from './src/CartScreen';
import { lineFromConfig } from './src/lines';
import { LoyaltyScreen } from './src/LoyaltyScreen';
import { MenuScreen } from './src/MenuScreen';
import { OrderScreen } from './src/OrderScreen';
import { initPush } from './src/push';
import { loadSaved } from './src/storage';
import { colors } from './src/theme';

type Tab = 'menu' | 'cart' | 'loyalty' | 'order';

function Shell() {
  const cart = useCart();
  const [tab, setTab] = useState<Tab>('menu');
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [menu, setMenu] = useState<MenuData | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [loyaltyId, setLoyaltyId] = useState('');
  const [loyalty, setLoyalty] = useState<Loyalty | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const reloadLoyalty = useCallback(() => {
    if (loyaltyId) getLoyalty(loyaltyId).then(setLoyalty).catch(() => setLoyalty(null));
  }, [loyaltyId]);

  const loadMenu = useCallback(async () => {
    try {
      setMenu(await getMenu());
      setMenuError(null);
    } catch (e) {
      setMenuError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    initPush(() => setTab('order'));
    loadMenu();
    loadSaved().then(async (s) => {
      setLoyaltyId(s.loyaltyId);
      setOrderId(s.lastOrderId);
      if (s.lastOrderId) getOrder(s.lastOrderId).then(setLastOrder).catch(() => {});
    });
    getConfig()
      .then(async (c) => {
        if (c.stripePublishableKey && Platform.OS !== 'web') await initStripe({ publishableKey: c.stripePublishableKey });
        setConfig(c);
      })
      .catch(() =>
        setConfig({
          onlinePaymentEnabled: false, stripePublishableKey: null, ordersOpen: true, rewardTarget: 10,
          info: { address: '', phone: '', mapsUrl: '', reviewUrl: '' }, hours: {}, closures: [], maxAdvanceDays: 0,
          referral: null, welcome: null, holdUnpaid: false, prepayOverCents: 0,
        }),
      );
  }, [loadMenu]);

  // Ouvert / fermé et capacité peuvent changer en cours de service : on relit la config à chaque changement d'onglet.
  useEffect(() => {
    getConfig().then(setConfig).catch(() => {});
  }, [tab]);

  // La carte de fidélité se met à jour quand on change d'onglet (après un retrait, par exemple).
  useEffect(reloadLoyalty, [reloadLoyalty, tab, orderId]);

  const reorder = (order: Order) => {
    if (!menu) return showAlert('Un instant', 'La carte est en cours de chargement.');
    const lines = order.items.map((i) => lineFromConfig(menu, i.config));
    const found = lines.filter((l) => l !== null);
    found.forEach(cart.addLine);
    if (found.length === 0) return showAlert('Désolé', 'Ces articles ne sont plus disponibles.');
    if (found.length < lines.length) showAlert('Panier mis à jour', 'Certains articles ne sont plus disponibles et ont été ignorés.');
    setTab('cart');
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'menu', label: 'Carte' },
    { key: 'cart', label: cart.count ? `Panier (${cart.count})` : 'Panier' },
    { key: 'loyalty', label: loyalty?.rewardsAvailable ? 'Fidélité 🎁' : 'Fidélité' },
    { key: 'order', label: 'Commande' },
  ];

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.logo}>🍕 Little Italy</Text>
          <Text style={styles.tag}>Pizzas à emporter · Trans-en-Provence</Text>
        </View>
        <Pressable onPress={() => setShowInfo(true)} accessibilityLabel="Infos pratiques" hitSlop={10} style={styles.infoBtn}>
          <Text style={styles.infoText}>ℹ️</Text>
        </Pressable>
      </View>
      {showInfo && <InfoScreen config={config} onClose={() => setShowInfo(false)} />}
      <View style={{ flex: 1 }}>
        {tab === 'menu' && (
          <MenuScreen menu={menu} error={menuError} config={config} loyalty={loyalty} lastOrder={lastOrder} onReload={loadMenu} onReorder={reorder} onRate={() => setTab('order')} />
        )}
        {tab === 'cart' && (
          <CartScreen
            menu={menu}
            config={config}
            loyalty={loyalty}
            loyaltyId={loyaltyId}
            onOrdered={(id) => {
              setOrderId(id);
              getOrder(id).then(setLastOrder).catch(() => {});
              setTab('order');
            }}
          />
        )}
        {tab === 'loyalty' && <LoyaltyScreen loyalty={loyalty} loyaltyId={loyaltyId} onChanged={reloadLoyalty} />}
        {tab === 'order' && <OrderScreen orderId={orderId} config={config} onReorder={reorder} onOrderChange={setLastOrder} />}
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
  header: { backgroundColor: colors.red, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center' },
  infoBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#ffffff33', alignItems: 'center', justifyContent: 'center' },
  infoText: { fontSize: 18 },
  logo: { color: '#fff', fontSize: 22, fontWeight: '800' },
  tag: { color: '#ffffffcc', fontSize: 13 },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  tab: { flex: 1, paddingVertical: 14, alignItems: 'center' },
  tabText: { color: colors.muted, fontWeight: '600', fontSize: 13 },
  tabOn: { color: colors.red },
});
