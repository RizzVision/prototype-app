import { SCREENS } from "../utils/constants";

const LANGUAGE_ALIASES = {
  en: ["english", "inglish"],
  hi: ["hindi", "hindee"],
  ta: ["tamil", "thamizh"],
  te: ["telugu", "telgoo"],
  bn: ["bengali", "bangla"],
  mr: ["marathi"],
  gu: ["gujarati", "gujrati"],
  kn: ["kannada"],
  ml: ["malayalam"],
  pa: ["punjabi", "panjabi"],
};

function parseLanguageCommand(text) {
  const wantsLanguageList = [
    "what languages",
    "available languages",
    "which languages",
    "list languages",
    "supported languages",
    "language options",
  ].some((pattern) => text.includes(pattern));

  if (wantsLanguageList) return { type: "LIST_LANGUAGES" };

  const languagePrefixes = [
    "change language to",
    "switch language to",
    "set language to",
    "change to",
    "switch to",
    "speak in",
    "language",
  ];

  const hasLanguageIntent = languagePrefixes.some((prefix) => text.includes(prefix));
  if (!hasLanguageIntent) return null;

  for (const [code, aliases] of Object.entries(LANGUAGE_ALIASES)) {
    if (aliases.some((alias) => text.includes(alias))) {
      return { type: "SET_LANGUAGE", code };
    }
  }

  return { type: "SET_LANGUAGE", code: null };
}

/**
 * Fast-path command parser — covers all obvious, unambiguous intents.
 *
 * Any transcript that matches here is dispatched immediately with zero latency.
 * Transcripts that return null fall through to the LLM assistant fallback in
 * VoiceContext, which handles free-form questions and vague intents.
 *
 * Matching uses .includes() on lowercased, trimmed text. First match wins.
 */
const COMMANDS = [
  // ── Navigation ──────────────────────────────────────────────────────────────
  {
    patterns: ["go back", "back", "previous", "go previous"],
    action: { type: "GO_BACK" },
  },
  {
    patterns: ["go home", "home", "main menu", "home screen", "go to home", "take me home"],
    action: { type: "NAVIGATE", screen: SCREENS.HOME },
  },
  {
    patterns: [
      "scan clothing", "scan this", "take photo", "capture", "photograph",
      "scan my outfit", "scan an item", "add clothing", "scan clothes",
    ],
    action: { type: "NAVIGATE", screen: SCREENS.SCAN },
  },
  {
    patterns: [
      "open wardrobe", "my wardrobe", "wardrobe", "show wardrobe", "view wardrobe",
      "go to wardrobe", "wardrobe screen", "show my clothes", "my clothes",
      "my items", "clothing list",
    ],
    action: { type: "NAVIGATE", screen: SCREENS.WARDROBE },
  },
  {
    patterns: [
      "outfit help", "help me choose", "suggest outfit", "get outfit help",
      "outfit ideas", "what should i wear", "what to wear",
      "recommend outfit", "outfit suggestion", "get dressed",
    ],
    action: { type: "NAVIGATE", screen: SCREENS.OUTFIT },
  },
  {
    patterns: [
      "shopping mode", "shopping", "shop", "i'm shopping", "go shopping",
      "shopping screen", "store mode",
    ],
    action: { type: "NAVIGATE", screen: SCREENS.SHOPPING },
  },
  {
    patterns: [
      "mirror", "auditory mirror", "how do i look", "check my outfit",
      "instant feedback", "quick check", "mirror mode",
    ],
    action: { type: "NAVIGATE", screen: SCREENS.MIRROR },
  },

  // ── Voice control ────────────────────────────────────────────────────────────
  {
    patterns: ["repeat", "say again", "what did you say", "say that again", "pardon", "come again"],
    action: { type: "REPEAT" },
  },
  {
    patterns: ["stop", "quiet", "shut up", "silence", "be quiet", "stop talking", "stop speaking"],
    action: { type: "STOP_SPEAKING" },
  },

  // ── Wardrobe read / filter ────────────────────────────────────────────────
  {
    patterns: [
      "read my wardrobe", "read wardrobe", "list items", "what do i have",
      "read all items", "list wardrobe", "tell me what i have",
    ],
    action: { type: "READ_WARDROBE" },
  },
  {
    patterns: ["show shirts", "show tops", "show my tops", "list tops", "filter tops"],
    action: { type: "FILTER_WARDROBE", category: "tops" },
  },
  {
    patterns: [
      "show pants", "show bottoms", "show jeans", "show my bottoms",
      "list bottoms", "filter bottoms",
    ],
    action: { type: "FILTER_WARDROBE", category: "bottoms" },
  },
  {
    patterns: ["show dresses", "show my dresses", "list dresses", "filter dresses"],
    action: { type: "FILTER_WARDROBE", category: "dresses" },
  },
  {
    patterns: [
      "show shoes", "show footwear", "show my shoes", "list shoes",
      "filter footwear", "filter shoes",
    ],
    action: { type: "FILTER_WARDROBE", category: "footwear" },
  },
  {
    patterns: [
      "show jewellery", "show jewelry", "show accessories",
      "list jewellery", "filter jewellery",
    ],
    action: { type: "FILTER_WARDROBE", category: "jewellery" },
  },
  {
    patterns: ["show all", "show everything", "all items", "no filter", "clear filter"],
    action: { type: "FILTER_WARDROBE", category: null },
  },
  {
    patterns: [
      "delete last", "remove last", "delete last item", "undo last",
      "remove last item", "delete that",
    ],
    action: { type: "DELETE_LAST_ITEM" },
  },

  // ── Scan actions ─────────────────────────────────────────────────────────────
  {
    patterns: [
      "save", "save this", "yes", "add to wardrobe", "save item",
      "save to wardrobe", "add this", "keep it",
    ],
    action: { type: "SAVE_ITEM" },
  },
  {
    patterns: [
      "no", "discard", "don't save", "skip", "don't keep",
      "cancel", "throw away", "not saving",
    ],
    action: { type: "DISCARD_ITEM" },
  },
  {
    patterns: [
      "scan again", "try again", "new scan", "retake", "another photo",
      "take another", "redo scan",
    ],
    action: { type: "SCAN_AGAIN" },
  },

  // ── Shopping / Mirror ─────────────────────────────────────────────────────
  {
    patterns: [
      "pause", "stop scanning", "pause scanning", "freeze", "hold on",
    ],
    action: { type: "PAUSE_SCAN" },
  },
  {
    patterns: [
      "resume", "start scanning", "continue", "continue scanning",
      "start again", "unpause",
    ],
    action: { type: "RESUME_SCAN" },
  },
  {
    patterns: ["what should i change", "suggestions", "give me suggestions", "any suggestions"],
    action: { type: "SUGGEST_CHANGES" },
  },

  // ── Phase navigation & result reading ────────────────────────────────────
  {
    patterns: ["next", "confirm", "proceed", "go ahead", "done"],
    action: { type: "CONFIRM" },
  },
  {
    patterns: [
      "read result", "read again", "read analysis", "read feedback",
      "read it again", "what did it say", "play again",
    ],
    action: { type: "READ_RESULT" },
  },

  // ── Occasion selection ────────────────────────────────────────────────────
  { patterns: ["casual", "casual day"],             action: { type: "SELECT_OCCASION", id: "casual" } },
  { patterns: ["work", "office", "at work"],        action: { type: "SELECT_OCCASION", id: "work" } },
  { patterns: ["date night", "date", "evening out"],action: { type: "SELECT_OCCASION", id: "date" } },
  { patterns: ["wedding", "wedding guest"],         action: { type: "SELECT_OCCASION", id: "wedding" } },
  { patterns: ["festival", "celebration"],          action: { type: "SELECT_OCCASION", id: "festival" } },
  { patterns: ["party", "night out"],               action: { type: "SELECT_OCCASION", id: "party" } },
  { patterns: ["gym", "active", "workout", "sport"],action: { type: "SELECT_OCCASION", id: "gym" } },
  { patterns: ["travel", "trip", "travelling"],     action: { type: "SELECT_OCCASION", id: "travel" } },

  // ── Mood selection ────────────────────────────────────────────────────────
  { patterns: ["bold", "strong", "statement"],             action: { type: "SELECT_MOOD", id: "bold" } },
  { patterns: ["minimal", "minimalist", "clean", "simple"],action: { type: "SELECT_MOOD", id: "minimal" } },
  { patterns: ["romantic", "soft", "feminine"],            action: { type: "SELECT_MOOD", id: "romantic" } },
  { patterns: ["edgy", "dark", "unconventional"],          action: { type: "SELECT_MOOD", id: "edgy" } },
  { patterns: ["earthy", "natural", "warm tones"],         action: { type: "SELECT_MOOD", id: "earthy" } },
  { patterns: ["electric", "vibrant", "bold colour"],      action: { type: "SELECT_MOOD", id: "electric" } },
];

export function parseCommand(transcript) {
  const text = transcript.toLowerCase().trim();

  const languageCommand = parseLanguageCommand(text);
  if (languageCommand) return languageCommand;

  for (const cmd of COMMANDS) {
    for (const pattern of cmd.patterns) {
      if (text.includes(pattern)) {
        return cmd.action;
      }
    }
  }
  return null;
}
