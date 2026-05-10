export type RipCard = {
  id: string;
  name: string;
  setName: string;
  number: string;
  rarity: "common" | "uncommon" | "rare" | "ultra" | "chase";
  gradeSignal: string;
  estimateUsd: number;
  accent: string;
  foil: "matte" | "holo" | "etched";
};

export type RipPack = {
  id: string;
  title: string;
  series: string;
  priceUsd: number;
  expectedValueUsd: number;
  chase: string;
  accent: string;
  odds: Array<{ label: string; value: string }>;
  cards: RipCard[];
};

export const sampleRipPacks: RipPack[] = [
  {
    id: "neon-vault",
    title: "Neon Vault Rip",
    series: "Original demo pack",
    priceUsd: 24,
    expectedValueUsd: 31,
    chase: "Prism Hydra EX",
    accent: "#59f6c4",
    odds: [
      { label: "Chase", value: "1:24" },
      { label: "Ultra", value: "1:8" },
      { label: "Rare+", value: "1:3" },
    ],
    cards: [
      {
        id: "prism-hydra",
        name: "Prism Hydra EX",
        setName: "Neon Vault",
        number: "NV-091",
        rarity: "chase",
        gradeSignal: "Clean front, inspect lower edge",
        estimateUsd: 118,
        accent: "#59f6c4",
        foil: "etched",
      },
      {
        id: "skyline-manta",
        name: "Skyline Manta",
        setName: "Neon Vault",
        number: "NV-044",
        rarity: "ultra",
        gradeSignal: "Holo surface, glare retake advised",
        estimateUsd: 44,
        accent: "#7c7cff",
        foil: "holo",
      },
      {
        id: "ember-scout",
        name: "Ember Scout",
        setName: "Neon Vault",
        number: "NV-018",
        rarity: "rare",
        gradeSignal: "Minor edge whitening candidate",
        estimateUsd: 14,
        accent: "#ffb05c",
        foil: "matte",
      },
    ],
  },
  {
    id: "arcade-drop",
    title: "Arcade Drop",
    series: "Skill prize test",
    priceUsd: 10,
    expectedValueUsd: 12,
    chase: "Circuit Phoenix",
    accent: "#9b8cff",
    odds: [
      { label: "Chase", value: "1:32" },
      { label: "Ultra", value: "1:10" },
      { label: "Rare+", value: "1:4" },
    ],
    cards: [
      {
        id: "circuit-phoenix",
        name: "Circuit Phoenix",
        setName: "Arcade Drop",
        number: "AD-077",
        rarity: "chase",
        gradeSignal: "Strong centering, no material DINGs",
        estimateUsd: 76,
        accent: "#9b8cff",
        foil: "holo",
      },
      {
        id: "byte-knight",
        name: "Byte Knight",
        setName: "Arcade Drop",
        number: "AD-029",
        rarity: "rare",
        gradeSignal: "Top-left corner needs review",
        estimateUsd: 16,
        accent: "#50d9ff",
        foil: "matte",
      },
      {
        id: "coin-cat",
        name: "Coin Cat",
        setName: "Arcade Drop",
        number: "AD-006",
        rarity: "uncommon",
        gradeSignal: "Clean scan, low value hold",
        estimateUsd: 4,
        accent: "#ffe66d",
        foil: "matte",
      },
    ],
  },
  {
    id: "dealer-mystery",
    title: "Dealer Mystery",
    series: "Vendor inventory mock",
    priceUsd: 39,
    expectedValueUsd: 42,
    chase: "Black Label Nova",
    accent: "#ff6b8a",
    odds: [
      { label: "Chase", value: "1:18" },
      { label: "Ultra", value: "1:7" },
      { label: "Rare+", value: "1:2" },
    ],
    cards: [
      {
        id: "black-label-nova",
        name: "Black Label Nova",
        setName: "Dealer Mystery",
        number: "DM-101",
        rarity: "chase",
        gradeSignal: "Submit candidate, verify surface",
        estimateUsd: 162,
        accent: "#ff6b8a",
        foil: "etched",
      },
      {
        id: "vault-serpent",
        name: "Vault Serpent",
        setName: "Dealer Mystery",
        number: "DM-055",
        rarity: "ultra",
        gradeSignal: "Back-left edge candidate",
        estimateUsd: 58,
        accent: "#6ee7b7",
        foil: "holo",
      },
      {
        id: "invoice-golem",
        name: "Invoice Golem",
        setName: "Dealer Mystery",
        number: "DM-012",
        rarity: "rare",
        gradeSignal: "Sell raw, no grading edge",
        estimateUsd: 18,
        accent: "#f5c86b",
        foil: "matte",
      },
    ],
  },
];

export function pickRipCard(pack: RipPack, nonce: number): RipCard {
  const index = Math.abs(Math.floor(nonce)) % pack.cards.length;
  return pack.cards[index] ?? pack.cards[0];
}
