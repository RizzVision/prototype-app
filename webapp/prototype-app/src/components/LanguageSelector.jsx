import { useLocale } from "../contexts/LocaleContext";
import { C, FONT } from "../utils/constants";

export default function LanguageSelector() {
  const { language, setLanguage, locales, t } = useLocale();

  return (
    <div style={{ width: "100%", marginBottom: 6 }}>
      <label
        htmlFor="language-selector"
        style={{
          display: "block",
          marginBottom: 8,
          fontFamily: FONT,
          fontSize: 13,
          fontWeight: 700,
          color: C.muted,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {t("language.label")}
      </label>
      <select
        id="language-selector"
        value={language}
        onChange={(event) => setLanguage(event.target.value)}
        aria-label={t("language.selectorAria")}
        style={{
          width: "100%",
          minHeight: 44,
          borderRadius: 12,
          background: C.surface,
          color: C.text,
          border: `1px solid ${C.border}`,
          fontFamily: FONT,
          fontSize: 16,
          fontWeight: 700,
          padding: "0 12px",
        }}
      >
        {locales.map((locale) => (
          <option key={locale.code} value={locale.code}>
            {locale.label} ({locale.nativeLabel})
          </option>
        ))}
      </select>
    </div>
  );
}
