import { detectWithYolo } from "./yoloApi";

const LABEL_MAP = {
  saree:                { name: "Saree",          type: "dress",     category: "dresses",  gender: "feminine"  },
  women_kurta:          { name: "Women's Kurta",  type: "top",       category: "tops",     gender: "feminine"  },
  kurta_men:            { name: "Men's Kurta",    type: "top",       category: "tops",     gender: "masculine" },
  leggings_and_salwars: { name: "Salwar",         type: "bottom",    category: "bottoms",  gender: "feminine"  },
  palazzos:             { name: "Palazzo Pants",  type: "bottom",    category: "bottoms",  gender: "feminine"  },
  lehenga:              { name: "Lehenga",        type: "dress",     category: "dresses",  gender: "feminine"  },
  dupattas:             { name: "Dupatta",        type: "accessory", category: "tops",     gender: "feminine"  },
  blouse:               { name: "Blouse",         type: "top",       category: "tops",     gender: "feminine"  },
  dhoti_pants:          { name: "Dhoti Pants",    type: "bottom",    category: "bottoms",  gender: "masculine" },
  petticoats:           { name: "Petticoat",      type: "bottom",    category: "bottoms",  gender: "feminine"  },
  mojaris_women:        { name: "Women's Mojari", type: "footwear",  category: "footwear", gender: "feminine"  },
  mojaris_men:          { name: "Men's Mojari",   type: "footwear",  category: "footwear", gender: "masculine" },
  nehru_jackets:        { name: "Nehru Jacket",   type: "outerwear", category: "tops",     gender: "masculine" },
  sherwanis:            { name: "Sherwani",       type: "outerwear", category: "tops",     gender: "masculine" },
  gowns:                { name: "Gown",           type: "dress",     category: "dresses",  gender: "feminine"  },
};

export async function detectClothing(base64Image) {
  const detections = await detectWithYolo(base64Image);

  if (!detections || detections.length === 0) {
    throw new Error("NO_DETECTION");
  }

  // Pick highest-confidence detection
  const best = detections.reduce((a, b) => (b.confidence > a.confidence ? b : a));

  const info = LABEL_MAP[best.label] ?? {
    name: best.label,
    type: "top",
    category: "tops",
    gender: "unisex",
  };

  const pct = Math.round(best.confidence * 100);
  const description = `I detected a ${info.name} with ${pct}% confidence.`;

  const [x1, y1, x2, y2] = best.box;

  return {
    name: info.name,
    type: info.type,
    category: info.category,
    color: "unknown",
    colorDescription: "",
    pattern: "solid",
    gender: info.gender,
    description,
    bbox: { x1, y1, x2, y2 },
  };
}
