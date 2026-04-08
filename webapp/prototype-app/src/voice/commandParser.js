import { SCREENS } from "../utils/constants";

const COMMANDS = [
  // ── Navigation ───────────────────────────────────────────────────────────────
  { patterns: ["go back", "previous page", "back", "previous"], action: { type: "GO_BACK" } },
  { patterns: ["go home", "home screen", "home", "main menu"], action: { type: "NAVIGATE", screen: SCREENS.HOME } },

  // Scan / identify — many natural language variants
  {
    patterns: [
      "identify my outfit", "identify my clothes", "identify my clothing",
      "analyze my outfit", "analyze my clothes", "analyze my clothing",
      "analyze this outfit", "check my clothes", "check my clothing",
      "what am i wearing", "scan my outfit", "scan my clothing",
      "scan clothing", "scan clothes", "scan this",
      "take a photo", "take a picture", "take photo", "take picture",
      "capture photo", "capture image", "capture", "identify", "scan",
    ],
    action: { type: "NAVIGATE", screen: SCREENS.SCAN },
  },

  // Wardrobe
  {
    patterns: [
      "open my wardrobe", "show my wardrobe", "view my wardrobe",
      "open wardrobe", "show wardrobe", "view wardrobe",
      "my wardrobe", "my clothes", "my clothing", "my items",
      "my collection", "wardrobe",
    ],
    action: { type: "NAVIGATE", screen: SCREENS.WARDROBE },
  },

  // Outfit help
  {
    patterns: [
      "what should i wear today", "what should i wear", "what to wear today", "what to wear",
      "help me choose an outfit", "help me pick an outfit", "help me dress",
      "help me choose", "help me pick", "recommend an outfit", "recommend outfit",
      "outfit recommendation", "outfit suggestion", "suggest an outfit",
      "suggest outfit", "get outfit help", "outfit help", "outfit",
    ],
    action: { type: "NAVIGATE", screen: SCREENS.OUTFIT },
  },

  // Shopping mode
  {
    patterns: [
      "start shopping mode", "enter shopping mode",
      "i am shopping", "i'm shopping", "help me shop",
      "start shopping", "shopping mode", "shopping",
    ],
    action: { type: "NAVIGATE", screen: SCREENS.SHOPPING },
  },

  // Mirror / instant feedback
  {
    patterns: [
      "auditory mirror", "open mirror", "start mirror",
      "check today's outfit", "check my look",
      "how do i look today", "how do i look",
      "what do i look like", "how is my outfit", "how's my outfit",
      "mirror",
    ],
    action: { type: "NAVIGATE", screen: SCREENS.MIRROR },
  },

  // ── Voice control ────────────────────────────────────────────────────────────
  { patterns: ["repeat that", "say that again", "say it again", "say again", "what did you say", "repeat"], action: { type: "REPEAT" } },
  { patterns: ["stop talking", "be quiet", "shut up", "silence", "stop"], action: { type: "STOP_SPEAKING" } },

  // ── Wardrobe management ──────────────────────────────────────────────────────
  { patterns: ["read my wardrobe", "read wardrobe", "list my items", "list items", "what do i have"], action: { type: "READ_WARDROBE" } },
  { patterns: ["show shirts", "show tops", "filter tops"], action: { type: "FILTER_WARDROBE", category: "tops" } },
  { patterns: ["show trousers", "show pants", "show bottoms", "show jeans", "filter bottoms"], action: { type: "FILTER_WARDROBE", category: "bottoms" } },
  { patterns: ["show dresses", "filter dresses"], action: { type: "FILTER_WARDROBE", category: "dresses" } },
  { patterns: ["show shoes", "show footwear", "filter footwear"], action: { type: "FILTER_WARDROBE", category: "footwear" } },
  { patterns: ["show jewellery", "show jewelry", "filter jewellery"], action: { type: "FILTER_WARDROBE", category: "jewellery" } },
  { patterns: ["show all items", "show everything", "show all"], action: { type: "FILTER_WARDROBE", category: null } },
  { patterns: ["delete last item", "remove last item", "delete last", "remove last"], action: { type: "DELETE_LAST_ITEM" } },

  // ── Scan result actions ──────────────────────────────────────────────────────
  { patterns: ["save to wardrobe", "add to wardrobe", "save this item", "add this item", "save this", "save item", "add this", "keep this", "save it", "yes"], action: { type: "SAVE_ITEM" } },
  { patterns: ["do not save", "don't save", "discard this", "dismiss", "cancel", "discard", "skip", "no"], action: { type: "DISCARD_ITEM" } },
  { patterns: ["scan again", "retake photo", "try again", "new scan"], action: { type: "SCAN_AGAIN" } },

  // ── Shopping / Mirror ────────────────────────────────────────────────────────
  { patterns: ["pause scanning", "stop scanning", "pause"], action: { type: "PAUSE_SCAN" } },
  { patterns: ["resume scanning", "start scanning", "resume"], action: { type: "RESUME_SCAN" } },
  { patterns: ["what should i change", "any suggestions", "suggestions"], action: { type: "SUGGEST_CHANGES" } },

  // ── Phase navigation & results ───────────────────────────────────────────────
  { patterns: ["next step", "confirm", "next"], action: { type: "CONFIRM" } },
  { patterns: ["read the result", "read result", "read the analysis", "read analysis", "read again", "tell me the result", "what's the result"], action: { type: "READ_RESULT" } },

  // ── Occasion selection ───────────────────────────────────────────────────────
  { patterns: ["casual wear", "casual"],                        action: { type: "SELECT_OCCASION", id: "casual" } },
  { patterns: ["office wear", "work wear", "work", "office"],  action: { type: "SELECT_OCCASION", id: "work" } },
  { patterns: ["date night", "going on a date", "date"],       action: { type: "SELECT_OCCASION", id: "date" } },
  { patterns: ["wedding"],                                      action: { type: "SELECT_OCCASION", id: "wedding" } },
  { patterns: ["festival"],                                     action: { type: "SELECT_OCCASION", id: "festival" } },
  { patterns: ["party"],                                        action: { type: "SELECT_OCCASION", id: "party" } },
  { patterns: ["gym wear", "workout", "active", "gym"],         action: { type: "SELECT_OCCASION", id: "gym" } },
  { patterns: ["travel"],                                       action: { type: "SELECT_OCCASION", id: "travel" } },

  // ── Mood selection ───────────────────────────────────────────────────────────
  { patterns: ["bold look", "bold"],     action: { type: "SELECT_MOOD", id: "bold" } },
  { patterns: ["minimalist", "minimal"], action: { type: "SELECT_MOOD", id: "minimal" } },
  { patterns: ["romantic"],              action: { type: "SELECT_MOOD", id: "romantic" } },
  { patterns: ["edgy"],                  action: { type: "SELECT_MOOD", id: "edgy" } },
  { patterns: ["earthy", "natural"],     action: { type: "SELECT_MOOD", id: "earthy" } },
  { patterns: ["electric", "vibrant"],   action: { type: "SELECT_MOOD", id: "electric" } },
];

const DESC_MODE_PATTERNS = [
  { regex: /(short|brief|quick)\s*(description|descriptions|mode)/i, action: { type: "SET_DESC_MODE", mode: "short" } },
  { regex: /(long|full|detail(ed)?)\s*(description|descriptions|mode)/i, action: { type: "SET_DESC_MODE", mode: "long" } },
  { regex: /(toggle|switch)\s*(description|descriptions|mode)/i, action: { type: "TOGGLE_DESC_MODE" } },
];

// Pre-sort all (pattern, action) pairs by pattern length descending so longer,
// more specific phrases always win over shorter ambiguous ones
// (e.g. "scan again" matches before "scan", "stop scanning" before "stop").
const SORTED_CANDIDATES = [];
for (const cmd of COMMANDS) {
  for (const pattern of cmd.patterns) {
    SORTED_CANDIDATES.push({ pattern, action: cmd.action });
  }
}
SORTED_CANDIDATES.sort((a, b) => b.pattern.length - a.pattern.length);

export function parseCommand(transcript) {
  const text = transcript.toLowerCase().trim();

  for (const { regex, action } of DESC_MODE_PATTERNS) {
    if (regex.test(text)) return action;
  }

  for (const { pattern, action } of SORTED_CANDIDATES) {
    if (text.includes(pattern)) return action;
  }

  return null;
}
