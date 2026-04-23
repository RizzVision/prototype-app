import { createContext, useContext, useEffect, useMemo, useState, useCallback } from "react";
import { DEFAULT_LOCALE, getLocaleConfig, resolveLocale, SUPPORTED_LOCALES } from "../i18n/locales";
import { translate } from "../i18n/translations";

const LOCALE_STORAGE_KEY = "rizzv_locale";
const LocaleContext = createContext(null);

function safeLocalGet(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeLocalSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore write errors in restricted environments.
  }
}

export function LocaleProvider({ children }) {
  const [language, setLanguageState] = useState(() => {
    const persisted = safeLocalGet(LOCALE_STORAGE_KEY);
    if (persisted) return resolveLocale(persisted);

    return DEFAULT_LOCALE;
  });

  const setLanguage = useCallback((nextLanguage) => {
    const resolved = resolveLocale(nextLanguage);
    setLanguageState(resolved);
    safeLocalSet(LOCALE_STORAGE_KEY, resolved);
  }, []);

  useEffect(() => {
    const locale = getLocaleConfig(language);
    document.documentElement.lang = locale.speechLocale;
    document.documentElement.dir = locale.dir;
  }, [language]);

  const value = useMemo(() => {
    const locale = getLocaleConfig(language);
    return {
      language,
      setLanguage,
      locale,
      locales: SUPPORTED_LOCALES,
      t: (key, vars) => translate(language, key, vars),
    };
  }, [language, setLanguage]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error("useLocale must be used within LocaleProvider");
  }
  return context;
}
