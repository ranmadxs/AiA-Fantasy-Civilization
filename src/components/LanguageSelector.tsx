import type { Language } from "../world/localization";

type LanguageSelectorProps = {
  language: Language;
  onChangeLanguage: (language: Language) => void;
  /** Variante compacta sin panel (para el header del juego). */
  compact?: boolean;
  /** Etiqueta visible. Si se omite, solo van las banderas (sin título). */
  label?: string;
  /** Muestra el nombre junto a la bandera. Default true. */
  showNames?: boolean;
};

const OPTIONS: Array<{ id: Language; flag: string; name: string }> = [
  { id: "es", flag: "🇪🇸", name: "Español" },
  { id: "zh", flag: "🇨🇳", name: "中文" },
  { id: "en", flag: "🇬🇧", name: "English" },
];

/** Selector de idioma con banderitas (mismo en home y juego, sin combobox). */
export function LanguageSelector({ language, onChangeLanguage, compact = false, label, showNames = true }: LanguageSelectorProps) {
  const groupLabel = label ?? "Game Language";
  return (
    <div className={compact ? "mainMenuLanguage compact" : "mainMenuLanguage"}>
      {label && <span>{label}</span>}
      <div role="group" aria-label={groupLabel}>
        {OPTIONS.map((option) => (
          <button
            aria-pressed={language === option.id}
            aria-label={option.name}
            className={language === option.id ? "active" : ""}
            key={option.id}
            onClick={() => onChangeLanguage(option.id)}
            type="button"
            title={option.name}
          >
            <b aria-hidden="true">{option.flag}</b>
            {showNames && option.name}
          </button>
        ))}
      </div>
    </div>
  );
}
