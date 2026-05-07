export const C = {
  bg:      "#0D0D0D",
  surface: "#1A1A1A",
  border:  "#2E2E2E",
  focus:   "#FFD600",
  text:    "#F0F0F0",
  muted:   "#888888",
  danger:  "#FF5555",
  success: "#44CC77",
  white:   "#FFFFFF",
};

export const FONT = "'Atkinson Hyperlegible', Georgia, sans-serif";

export const SCREENS = {
  HOME: "home",
  SCAN: "scan",
  WARDROBE: "wardrobe",
  OUTFIT: "outfit",
  SHOPPING: "shopping",
  MIRROR: "mirror",
  EDIT_ITEM: "editItem",
  IDENTIFY: "identify",
  PERSONALIZATION: "personalization",
};

export const PATTERN_OPTIONS = [
  "solid", "stripes", "checks", "floral", "geometric", "animal print", "abstract",
];

export const COLOR_CHIP_OPTIONS = [
  { label: "Black",     hex: "#1A1A1A" },
  { label: "White",     hex: "#F0F0F0" },
  { label: "Navy",      hex: "#1B2A4A" },
  { label: "Grey",      hex: "#808080" },
  { label: "Beige",     hex: "#C9A96E" },
  { label: "Olive",     hex: "#6B7C3A" },
  { label: "Burgundy",  hex: "#722F37" },
  { label: "Mustard",   hex: "#D4A017" },
  { label: "Terracotta",hex: "#C2603A" },
  { label: "Cobalt",    hex: "#0047AB" },
  { label: "Blush",     hex: "#E8A898" },
  { label: "Sage",      hex: "#87AE73" },
];

export const CATEGORIES = [
  { id: "tops",      label: "Tops",      icon: "👕", desc: "Shirts, blouses, jackets, hoodies" },
  { id: "bottoms",   label: "Bottoms",   icon: "👖", desc: "Jeans, trousers, skirts, leggings" },
  { id: "dresses",   label: "Dresses",   icon: "👗", desc: "Dresses, jumpsuits, co-ord sets" },
  { id: "footwear",  label: "Footwear",  icon: "👟", desc: "Shoes, boots, sandals" },
  { id: "jewellery", label: "Jewellery", icon: "💍", desc: "Necklaces, earrings, rings" },
];

export const OCCASIONS = [
  { id: "casual",    label: "Casual Day Out" },
  { id: "work",      label: "Work or Office" },
  { id: "date",      label: "Date Night" },
  { id: "wedding",   label: "Wedding Guest" },
  { id: "festival",  label: "Festival" },
  { id: "party",     label: "Party" },
  { id: "gym",       label: "Gym or Active" },
  { id: "travel",    label: "Travel" },
];

export const MOODS = [
  { id: "bold",     label: "Bold and Strong",       desc: "Statement-making" },
  { id: "minimal",  label: "Clean and Minimal",     desc: "Understated" },
  { id: "romantic", label: "Soft and Romantic",      desc: "Feminine energy" },
  { id: "edgy",     label: "Dark and Edgy",          desc: "Unconventional" },
  { id: "earthy",   label: "Natural and Earthy",     desc: "Warm tones" },
  { id: "electric", label: "Vibrant and Electric",   desc: "High-energy" },
];
