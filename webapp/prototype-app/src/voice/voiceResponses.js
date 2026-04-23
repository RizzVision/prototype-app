const EN_RESPONSES = {
  guidance: {
    tooDark:      "Too dark. Move to a brighter area.",
    tooBright:    "Too bright. Avoid direct sunlight or flash.",
    noClothing:   "No clothing detected. Point the camera directly at the garment.",
    tooFar:       "Too far. Move the camera closer to the clothing.",
    tooClose:     "Too close. Move the camera back.",
    moveLeft:     "Move the camera to the left.",
    moveRight:    "Move the camera to the right.",
    moveUp:       "Move the camera up.",
    moveDown:     "Move the camera down.",
    goodPosition: "Good position! Capturing automatically in 3 seconds.",
    countdown2:   "Two.",
    countdown1:   "One.",
    backendOnly:  "Guidance limited. Tap to capture when you are ready.",
    busyBackground: "Place the garment on a plain, contrasting surface for best results.",
  },
  welcome: "What would you like to do?",
  whatsInFocus: {
    noClothing: "No clothing detected. Point the camera at the garment.",
    tooSmall:   "Object too small. Move the camera closer.",
    tooLarge:   "Object too large. Move the camera back a little.",
    ready:      "Clothing in frame. Ready to capture.",
  },
  scanReady: "Camera ready. Point at your outfit, tap Describe to check framing, then tap Capture.",
  analyzing: "Analyzing your outfit. This will take a few seconds.",
  scanning: "Analyzing your outfit.",
  scanComplete: (desc) => `${desc}. Do you want to save this to your wardrobe?`,
  saved: (name) => `${name} saved to your wardrobe.`,
  discarded: "Item discarded.",
  wardrobeEmpty: "Your wardrobe is empty. Scan your first item to get started.",
  wardrobeCount: (n) => `You have ${n} item${n !== 1 ? "s" : ""} in your wardrobe.`,
  itemDeleted: (name) => `${name} deleted from your wardrobe.`,
  itemUpdated: (name) => `${name} updated.`,
  noItemToDelete: "Your wardrobe is empty. Nothing to delete.",
  outfitPrompt: "What occasion are you dressing for?",
  moodPrompt: (occasion) => `${occasion}. What vibe are you going for?`,
  generating: "Let me put together some looks for you.",
  shoppingStart: "Shopping mode active. Point your camera at clothing for real-time feedback.",
  shoppingPaused: "Scanning paused.",
  shoppingResumed: "Scanning resumed.",
  mirrorReady: "Mirror mode. This gives instant feedback on what you are wearing right now. Nothing is saved. Stand back so I can see your full outfit, then tap capture.",
  mirrorAnalyzing: "Analyzing your outfit. Please hold still.",
  authRequired: "Your session expired. Please sign in again and retry.",
  backendUnavailable: "Could not reach the analysis server. Please check your connection and try again.",
  error: "Something went wrong. Please try again.",
  cameraError: "Could not access camera. Please allow camera permission.",
  goBack: "Going back.",
  notSupported: "Voice input is not supported in this browser. Please use Chrome.",
  shortDescOn: "Switched to short descriptions.",
  longDescOn: "Switched to long descriptions.",
};

const LOCALIZED_OVERRIDES = {
  hi: {
    welcome: "आप क्या करना चाहेंगे?",
    analyzing: "आपके आउटफिट का विश्लेषण हो रहा है। इसमें कुछ सेकंड लगेंगे।",
    wardrobeEmpty: "आपका वार्डरोब खाली है। शुरू करने के लिए पहला आइटम स्कैन करें।",
    noItemToDelete: "आपका वार्डरोब खाली है। हटाने के लिए कुछ नहीं है।",
    goBack: "वापस जा रहा हूं।",
    error: "कुछ गलत हुआ। कृपया फिर से कोशिश करें।",
    shoppingStart: "शॉपिंग मोड सक्रिय है। रियल-टाइम फीडबैक के लिए कैमरा कपड़ों की ओर रखें।",
    shoppingPaused: "स्कैनिंग रोकी गई।",
    shoppingResumed: "स्कैनिंग फिर शुरू हुई।",
    wardrobeCount: (n) => `आपके वार्डरोब में ${n} आइटम हैं।`,
  },
  ta: {
    welcome: "நீங்கள் என்ன செய்ய விரும்புகிறீர்கள்?",
    analyzing: "உங்கள் உடையை பகுப்பாய்வு செய்கிறேன். சில விநாடிகள் ஆகும்.",
    wardrobeEmpty: "உங்கள் அலமாரி காலியாக உள்ளது. தொடங்க முதல் உருப்படியை ஸ்கேன் செய்யவும்.",
    noItemToDelete: "உங்கள் அலமாரி காலியாக உள்ளது. நீக்க எதுவும் இல்லை.",
    goBack: "பின்செல்கிறேன்.",
    error: "ஏதோ தவறு ஏற்பட்டது. மீண்டும் முயற்சிக்கவும்.",
    shoppingStart: "ஷாப்பிங் மோடு இயக்கப்பட்டது. நேரடி பின்னூட்டத்துக்கு கேமராவை உடைகளுக்கு நோக்கி பிடிக்கவும்.",
    shoppingPaused: "ஸ்கேன் இடைநிறுத்தப்பட்டது.",
    shoppingResumed: "ஸ்கேன் மீண்டும் தொடங்கியது.",
    wardrobeCount: (n) => `உங்கள் அலமாரியில் ${n} உருப்படிகள் உள்ளன.`,
  },
  te: {
    welcome: "మీరు ఏమి చేయాలనుకుంటున్నారు?",
    analyzing: "మీ దుస్తుల విశ్లేషణ జరుగుతోంది. కొన్ని సెకన్లు పడుతుంది.",
    wardrobeEmpty: "మీ వార్డ్‌రోబ్ ఖాళీగా ఉంది. ప్రారంభించడానికి మొదటి ఐటమ్‌ను స్కాన్ చేయండి.",
    noItemToDelete: "మీ వార్డ్‌రోబ్ ఖాళీగా ఉంది. తొలగించడానికి ఏమీ లేదు.",
    goBack: "వెనక్కి వెళ్తున్నాను.",
    error: "ఏదో తప్పు జరిగింది. మళ్లీ ప్రయత్నించండి.",
    shoppingStart: "షాపింగ్ మోడ్ ఆన్ అయింది. రియల్-టైమ్ ఫీడ్‌బ్యాక్ కోసం కెమెరాను దుస్తులపై ఉంచండి.",
    shoppingPaused: "స్కానింగ్ నిలిపివేయబడింది.",
    shoppingResumed: "స్కానింగ్ మళ్లీ ప్రారంభమైంది.",
    wardrobeCount: (n) => `మీ వార్డ్‌రోబ్‌లో ${n} ఐటమ్స్ ఉన్నాయి.`,
  },
  bn: {
    welcome: "আপনি কী করতে চান?",
    analyzing: "আপনার পোশাক বিশ্লেষণ করা হচ্ছে। কয়েক সেকেন্ড লাগবে।",
    wardrobeEmpty: "আপনার ওয়ার্ডরোব খালি। শুরু করতে প্রথম আইটেম স্ক্যান করুন।",
    noItemToDelete: "আপনার ওয়ার্ডরোব খালি। মুছতে কিছু নেই।",
    goBack: "ফিরে যাচ্ছি।",
    error: "কিছু ভুল হয়েছে। আবার চেষ্টা করুন।",
    shoppingStart: "শপিং মোড চালু হয়েছে। রিয়েল-টাইম ফিডব্যাকের জন্য ক্যামেরা পোশাকে ধরুন।",
    shoppingPaused: "স্ক্যানিং থামানো হয়েছে।",
    shoppingResumed: "স্ক্যানিং আবার শুরু হয়েছে।",
    wardrobeCount: (n) => `আপনার ওয়ার্ডরোবে ${n}টি আইটেম আছে।`,
  },
  mr: {
    welcome: "तुम्हाला काय करायचे आहे?",
    analyzing: "तुमच्या आउटफिटचे विश्लेषण सुरू आहे. काही सेकंद लागतील.",
    wardrobeEmpty: "तुमचा वॉर्डरोब रिकामा आहे. सुरुवात करण्यासाठी पहिला आयटम स्कॅन करा.",
    noItemToDelete: "तुमचा वॉर्डरोब रिकामा आहे. हटवण्यासाठी काही नाही.",
    goBack: "मागे जात आहे.",
    error: "काहीतरी चूक झाली. कृपया पुन्हा प्रयत्न करा.",
    shoppingStart: "शॉपिंग मोड सुरू आहे. रिअल-टाइम फीडबॅकसाठी कॅमेरा कपड्यांकडे ठेवा.",
    shoppingPaused: "स्कॅनिंग थांबवले.",
    shoppingResumed: "स्कॅनिंग पुन्हा सुरू झाले.",
    wardrobeCount: (n) => `तुमच्या वॉर्डरोबमध्ये ${n} आयटम आहेत.`,
  },
};

function deepMerge(base, override) {
  if (!override) return base;
  const output = { ...base };

  for (const key of Object.keys(override)) {
    const baseValue = base[key];
    const overrideValue = override[key];

    if (
      baseValue &&
      typeof baseValue === "object" &&
      !Array.isArray(baseValue) &&
      typeof overrideValue === "object" &&
      !Array.isArray(overrideValue)
    ) {
      output[key] = deepMerge(baseValue, overrideValue);
    } else {
      output[key] = overrideValue;
    }
  }

  return output;
}

let currentLanguage = "en";

export function setResponseLanguage(language) {
  const normalized = typeof language === "string" ? language.toLowerCase() : "en";
  currentLanguage = LOCALIZED_OVERRIDES[normalized] ? normalized : "en";
}

function buildResponses(language) {
  return deepMerge(EN_RESPONSES, LOCALIZED_OVERRIDES[language]);
}

export function getResponses(language = currentLanguage) {
  return buildResponses(language);
}

export const RESPONSES = new Proxy({}, {
  get(_, prop) {
    const resolved = buildResponses(currentLanguage);
    return resolved[prop];
  },
});
