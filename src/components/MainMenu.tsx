import { useState, type FormEvent } from "react";
import pkg from "../../package.json";
import type { Language } from "../world/localization";
import { LanguageSelector } from "./LanguageSelector";

/** 从主菜单创建世界时使用的参数。 */
export type NewGameSettings = {
  cityCount: number;
  nationCount: number;
  seed: string;
  /** Proporción de provincias libres (0–0.5). Siempre activa, no opcional. */
  freeProvinceRatio: number;
};

export const DEFAULT_FREE_PROVINCE_RATIO = 0.2;

type MainMenuProps = {
  language: Language;
  onChangeLanguage: (language: Language) => void;
  onStartGame: (settings: NewGameSettings) => void;
  onConfig: () => void;
};

const DEFAULT_SEED = "observer-world-001";

/** 渲染游戏标题、语言选择和新世界创建流程。 */
export function MainMenu({
  language,
  onChangeLanguage,
  onStartGame,
  onConfig,
}: MainMenuProps) {
  const [isCreatingWorld, setIsCreatingWorld] = useState(false);
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const [nationCount, setNationCount] = useState(6);
  const [cityCount, setCityCount] = useState(36);
  const [freeProvinceRatio, setFreeProvinceRatio] = useState(DEFAULT_FREE_PROVINCE_RATIO);

  const handleNationCountChange = (value: number) => {
    const nextNationCount = clampInteger(value, 2, 12);
    setNationCount(nextNationCount);
    setCityCount((current) => Math.max(current, nextNationCount));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedSeed = seed.trim() || DEFAULT_SEED;
    const normalizedNationCount = clampInteger(nationCount, 2, 12);
    const normalizedCityCount = clampInteger(cityCount, normalizedNationCount, 100);
    const normalizedFreeRatio = Math.min(0.5, Math.max(0, Number.isFinite(freeProvinceRatio) ? freeProvinceRatio : DEFAULT_FREE_PROVINCE_RATIO));
    onStartGame({
      cityCount: normalizedCityCount,
      nationCount: normalizedNationCount,
      seed: normalizedSeed,
      freeProvinceRatio: Math.round(normalizedFreeRatio * 100) / 100,
    });
  };

  return (
    <section className="mainMenu" aria-label="Main Menu">
      <div className="mainMenuBackdrop" aria-hidden="true">
        <span className="mainMenuOrbit orbitOne" />
        <span className="mainMenuOrbit orbitTwo" />
        <span className="mainMenuContinent continentOne" />
        <span className="mainMenuContinent continentTwo" />
      </div>

      <header className="mainMenuBrand">
        <p>AI Civilization Sandbox</p>
        <span>V{pkg.version}</span>
      </header>

      <div className="mainMenuContent">
        <div className="mainMenuTitle">
          <p className="eyebrow">A World Shaped by Autonomous Nations</p>
          <h1>
            <span>AI</span>
            Civilization Sandbox
          </h1>
          <p className="mainMenuIntro">
            Generate a living world, then watch ambitious nations expand, negotiate, build, spy, and wage war one turn at a time.
          </p>
        </div>

        {isCreatingWorld ? (
          <form className="newGamePanel" onSubmit={handleSubmit}>
            <div className="newGamePanelHeader">
              <div>
                <p className="eyebrow">New World</p>
                <h2>Create a Civilization</h2>
              </div>
              <button className="menuTextButton" onClick={() => setIsCreatingWorld(false)} type="button">
                Back
              </button>
            </div>

            <label className="newGameField seedField">
              <span>World Seed</span>
              <input
                maxLength={64}
                onChange={(event) => setSeed(event.target.value)}
                placeholder="Enter any word or number"
                spellCheck={false}
                type="text"
                value={seed}
              />
              <small>The same settings and seed will generate the same starting world.</small>
            </label>

            <div className="newGameNumberGrid">
              <label className="newGameField">
                <span>Nation Count</span>
                <input
                  max={12}
                  min={2}
                  onChange={(event) => handleNationCountChange(Number(event.target.value))}
                  type="number"
                  value={nationCount}
                />
                <small>2–12 nations</small>
              </label>
              <label className="newGameField">
                <span>City Count</span>
                <input
                  max={100}
                  min={nationCount}
                  onChange={(event) => setCityCount(clampInteger(Number(event.target.value), nationCount, 100))}
                  type="number"
                  value={cityCount}
                />
                <small>{nationCount}–100 cities</small>
              </label>
              <label className="newGameField">
                <span>Free Territory</span>
                <input
                  max={50}
                  min={0}
                  onChange={(event) => setFreeProvinceRatio(Number(event.target.value) / 100)}
                  step={5}
                  type="range"
                  value={Math.round(freeProvinceRatio * 100)}
                />
                <small>{Math.round(freeProvinceRatio * 100)}% free provinces (Tierra libre)</small>
              </label>
            </div>

            <div className="newGameSummary">
              <span>World Preview</span>
              <strong>{nationCount} nations · {cityCount} towns · {Math.round(freeProvinceRatio * 100)}% free</strong>
            </div>

            <button className="menuPrimaryButton" type="submit">
              Generate World
              <span aria-hidden="true">→</span>
            </button>
          </form>
        ) : (
          <nav className="mainMenuActions" aria-label="Main Menu Actions">
            <button className="menuPrimaryButton" onClick={() => setIsCreatingWorld(true)} type="button">
              Start Game
              <span aria-hidden="true">→</span>
            </button>
            <button className="menuTextButton" onClick={onConfig} type="button">
              ⚙️ Configuración
            </button>
            <LanguageSelector label="Game Language" language={language} onChangeLanguage={onChangeLanguage} />
          </nav>
        )}
      </div>
    </section>
  );
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
