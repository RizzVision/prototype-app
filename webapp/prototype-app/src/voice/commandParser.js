import { SCREENS } from "../utils/constants";

const COMMANDS = [
  // Navigation
  { patterns: ["go back", "back", "previous"], action: { type: "GO_BACK" } },
  { patterns: ["go home", "home", "main menu"], action: { type: "NAVIGATE", screen: SCREENS.HOME } },
  { patterns: ["scan clothing", "scan this", "scan", "take photo", "capture"], action: { type: "NAVIGATE", screen: SCREENS.SCAN } },
  { patterns: ["open wardrobe", "my wardrobe", "wardrobe", "show wardrobe"], action: { type: "NAVIGATE", screen: SCREENS.WARDROBE } },
  { patterns: ["outfit help", "help me choose", "suggest outfit", "get outfit help", "outfit"], action: { type: "NAVIGATE", screen: SCREENS.OUTFIT } },
  { patterns: ["shopping mode", "shopping", "shop"], action: { type: "NAVIGATE", screen: SCREENS.SHOPPING } },
  { patterns: ["mirror", "auditory mirror", "how do i look"], action: { type: "NAVIGATE", screen: SCREENS.MIRROR } },

  // Voice control
  { patterns: ["repeat", "say again", "what did you say"], action: { type: "REPEAT" } },
  { patterns: ["stop", "quiet", "shut up", "silence"], action: { type: "STOP_SPEAKING" } },

  // Wardrobe commands
  { patterns: ["read my wardrobe", "read wardrobe", "list items", "what do i have"], action: { type: "READ_WARDROBE" } },
  { patterns: ["show shirts", "show tops"], action: { type: "FILTER_WARDROBE", category: "tops" } },
  { patterns: ["show pants", "show bottoms", "show jeans"], action: { type: "FILTER_WARDROBE", category: "bottoms" } },
  { patterns: ["show dresses"], action: { type: "FILTER_WARDROBE", category: "dresses" } },
  { patterns: ["show shoes", "show footwear"], action: { type: "FILTER_WARDROBE", category: "footwear" } },
  { patterns: ["show jewellery", "show jewelry"], action: { type: "FILTER_WARDROBE", category: "jewellery" } },
  { patterns: ["show all", "show everything"], action: { type: "FILTER_WARDROBE", category: null } },
  { patterns: ["delete last", "remove last", "delete last item"], action: { type: "DELETE_LAST_ITEM" } },

  // Scan commands
  { patterns: ["save", "save this", "yes", "add to wardrobe"], action: { type: "SAVE_ITEM" } },
  { patterns: ["no", "discard", "don't save", "skip"], action: { type: "DISCARD_ITEM" } },
  { patterns: ["scan again", "try again", "new scan"], action: { type: "SCAN_AGAIN" } },

  // Shopping / Mirror
  { patterns: ["pause", "stop scanning"], action: { type: "PAUSE_SCAN" } },
  { patterns: ["resume", "continue", "start scanning"], action: { type: "RESUME_SCAN" } },
  { patterns: ["what should i change", "suggestions"], action: { type: "SUGGEST_CHANGES" } },
];

export function parseCommand(transcript) {
  const text = transcript.toLowerCase().trim();
  for (const cmd of COMMANDS) {
    for (const pattern of cmd.patterns) {
      if (text.includes(pattern)) {
        return cmd.action;
      }
    }
  }
  return null;
}
