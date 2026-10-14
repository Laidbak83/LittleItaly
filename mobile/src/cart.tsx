import React, { createContext, useContext, useMemo, useReducer } from 'react';
import type { MenuItem } from './api';

type Lines = Record<number, { item: MenuItem; quantity: number }>;
type Action = { type: 'add' | 'remove'; item: MenuItem } | { type: 'clear' };

function reducer(state: Lines, action: Action): Lines {
  if (action.type === 'clear') return {};
  const current = state[action.item.id]?.quantity ?? 0;
  const quantity = action.type === 'add' ? Math.min(current + 1, 20) : current - 1;
  const next = { ...state };
  if (quantity <= 0) delete next[action.item.id];
  else next[action.item.id] = { item: action.item, quantity };
  return next;
}

type CartValue = {
  lines: { item: MenuItem; quantity: number }[];
  count: number;
  totalCents: number;
  add: (item: MenuItem) => void;
  remove: (item: MenuItem) => void;
  clear: () => void;
};
const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {});
  const value = useMemo<CartValue>(() => {
    const lines = Object.values(state);
    return {
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      totalCents: lines.reduce((n, l) => n + l.quantity * l.item.price_cents, 0),
      add: (item) => dispatch({ type: 'add', item }),
      remove: (item) => dispatch({ type: 'remove', item }),
      clear: () => dispatch({ type: 'clear' }),
    };
  }, [state]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart doit être utilisé dans CartProvider');
  return ctx;
}
