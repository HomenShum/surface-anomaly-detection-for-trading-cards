"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { sampleItems, vaultStorageKey, type VaultItem } from "../lib/vault";

function readItems() {
  if (typeof window === "undefined") return sampleItems;

  const raw = window.localStorage.getItem(vaultStorageKey);
  if (!raw) {
    window.localStorage.setItem(vaultStorageKey, JSON.stringify(sampleItems));
    return sampleItems;
  }

  try {
    const parsed = JSON.parse(raw) as VaultItem[];
    return Array.isArray(parsed) ? parsed : sampleItems;
  } catch {
    return sampleItems;
  }
}

export function useVault() {
  const [items, setItems] = useState<VaultItem[]>(sampleItems);

  useEffect(() => {
    setItems(readItems());
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(vaultStorageKey, JSON.stringify(items));
    }
  }, [items]);

  const addItem = useCallback((item: VaultItem) => {
    setItems((current) => [item, ...current.filter((entry) => entry.id !== item.id)]);
  }, []);

  const updateItem = useCallback((item: VaultItem) => {
    setItems((current) => current.map((entry) => (entry.id === item.id ? item : entry)));
  }, []);

  const resetSamples = useCallback(() => {
    setItems(sampleItems);
  }, []);

  const stats = useMemo(() => {
    const total = items.length;
    const averageSurface = total
      ? Math.round(items.reduce((sum, item) => sum + item.surfaceScore, 0) / total)
      : 0;
    const flagged = items.filter((item) => item.surfaceScore < 75 || item.edgeScore < 75).length;

    return { total, averageSurface, flagged };
  }, [items]);

  return { items, addItem, updateItem, resetSamples, stats };
}
