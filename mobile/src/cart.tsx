import React, { createContext, useContext, useMemo, useReducer } from 'react';
import type { CartLine } from './lines';

const MAX_QTY = 20;
type Action =
  | { type: 'add'; line: CartLine }
  | { type: 'setQuantity'; key: string; quantity: number }
  | { type: 'clear' };

function reducer(state: CartLine[], action: Action): CartLine[] {
  switch (action.type) {
    case 'clear':
      return [];
    case 'add': {
      const existing = state.find((l) => l.key === action.line.key);
      if (!existing) return [...state, action.line];
      const quantity = Math.min(existing.quantity + action.line.quantity, MAX_QTY);
      return state.map((l) => (l.key === existing.key ? scale(l, quantity) : l));
    }
    case 'setQuantity':
      if (action.quantity <= 0) return state.filter((l) => l.key !== action.key);
      return state.map((l) => (l.key === action.key ? scale(l, Math.min(action.quantity, MAX_QTY)) : l));
  }
}

// Change la quantité d'une ligne en gardant ses compteurs de pizzas cohérents.
function scale(line: CartLine, quantity: number): CartLine {
  const perUnit = line.pizzas / line.quantity;
  return { ...line, quantity, pizzas: perUnit * quantity, config: { ...line.config, quantity } };
}

type CartValue = {
  lines: CartLine[];
  count: number;
  pizzaCount: number;
  subtotalCents: number;
  addLine: (line: CartLine) => void;
  setQuantity: (key: string, quantity: number) => void;
  clear: () => void;
};
const CartContext = createContext<CartValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, dispatch] = useReducer(reducer, []);
  const value = useMemo<CartValue>(
    () => ({
      lines,
      count: lines.reduce((n, l) => n + l.quantity, 0),
      pizzaCount: lines.reduce((n, l) => n + l.pizzas, 0),
      subtotalCents: lines.reduce((n, l) => n + l.quantity * l.unitCents, 0),
      addLine: (line) => dispatch({ type: 'add', line }),
      setQuantity: (key, quantity) => dispatch({ type: 'setQuantity', key, quantity }),
      clear: () => dispatch({ type: 'clear' }),
    }),
    [lines],
  );
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart doit être utilisé dans CartProvider');
  return ctx;
}
