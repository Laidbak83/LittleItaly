import type { Combo, Kind, LineConfig, MenuData, MenuItem } from './api';

// Une ligne de panier. Les prix affichés ici sont calculés comme sur le serveur,
// mais seul le serveur fait foi au moment de la commande.
export type CartLine = {
  key: string;
  label: string;
  details: string;
  unitCents: number;
  quantity: number;
  pizzas: number;
  rewardEligible: boolean;
  kinds: Kind[];
  config: LineConfig;
};

export type ItemChoice = { sizeIndex: number; halfItem: MenuItem | null; extras: number[]; removed: string[] };
export const defaultChoice: ItemChoice = { sizeIndex: 0, halfItem: null, extras: [], removed: [] };

const keyOf = (config: LineConfig) => JSON.stringify({ ...config, quantity: 0 });

export function buildItemLine(menu: MenuData, item: MenuItem, choice: ItemChoice, quantity: number): CartLine {
  const isPizza = item.kind === 'pizza';
  const details: string[] = [];
  let label = item.name;
  let base = item.price_cents;
  const config: Extract<LineConfig, { itemId: number }> = { itemId: item.id, quantity };

  if (isPizza) {
    if (choice.halfItem) {
      label = `½ ${item.name} · ½ ${choice.halfItem.name}`;
      base = Math.max(item.price_cents, choice.halfItem.price_cents);
      config.halfItemId = choice.halfItem.id;
    }
    if (item.sizes.length) {
      base += item.sizes[choice.sizeIndex].extra_cents;
      details.push(item.sizes[choice.sizeIndex].label);
      config.sizeIndex = choice.sizeIndex;
    }
    if (choice.extras.length) {
      const extras = menu.supplements.filter((s) => choice.extras.includes(s.id));
      base += extras.reduce((n, s) => n + s.price_cents, 0);
      details.push('+ ' + extras.map((s) => s.name).join(', '));
      config.extras = extras.map((s) => s.id);
    }
    if (choice.removed.length) {
      details.push('sans ' + choice.removed.join(', '));
      config.removed = choice.removed;
    }
  }
  return {
    key: keyOf(config),
    label,
    details: details.join(' · '),
    unitCents: base,
    quantity,
    pizzas: isPizza ? quantity : 0,
    rewardEligible: isPizza,
    kinds: choice.halfItem ? [item.kind, choice.halfItem.kind] : [item.kind],
    config,
  };
}

export function buildComboLine(menu: MenuData, combo: Combo, picks: MenuItem[], quantity: number): CartLine {
  const config: LineConfig = { comboId: combo.id, quantity, picks: picks.map((p) => p.id) };
  return {
    key: keyOf(config),
    label: combo.name,
    details: picks.map((p) => p.name).join(' + '),
    unitCents: combo.price_cents,
    quantity,
    pizzas: combo.slots.filter((k) => k === 'pizza').length * quantity,
    rewardEligible: false,
    kinds: combo.slots,
    config,
  };
}

// Reconstruit une ligne depuis une ancienne commande ("Commander à nouveau").
// Renvoie null si un article, un supplément ou une option n'existe plus.
export function lineFromConfig(menu: MenuData, cfg: LineConfig): CartLine | null {
  const byId = (id: number) => menu.items.find((i) => i.id === id);
  if ('comboId' in cfg) {
    const combo = menu.combos.find((c) => c.id === cfg.comboId);
    const picks = cfg.picks.map(byId);
    if (!combo || picks.some((p) => !p) || picks.length !== combo.slots.length) return null;
    return buildComboLine(menu, combo, picks as MenuItem[], cfg.quantity);
  }
  const item = byId(cfg.itemId);
  if (!item) return null;
  const half = cfg.halfItemId ? byId(cfg.halfItemId) : null;
  if (cfg.halfItemId && !half) return null;
  const sizeIndex = cfg.sizeIndex ?? 0;
  if (item.sizes.length && !item.sizes[sizeIndex]) return null;
  const extras = cfg.extras ?? [];
  if (extras.some((id) => !menu.supplements.some((s) => s.id === id))) return null;
  const allowed = [...item.ingredients, ...(half?.ingredients ?? [])];
  const removed = cfg.removed ?? [];
  if (removed.some((r) => !allowed.includes(r))) return null;
  return buildItemLine(menu, item, { sizeIndex, halfItem: half ?? null, extras, removed }, cfg.quantity);
}
