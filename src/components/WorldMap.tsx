import { useEffect, useMemo, useRef, useState } from "react";
import { Application, Container, Graphics, Text, Sprite, Assets } from "pixi.js";
import { getTileMonthlyYield } from "../world/economy";
import { getLocalizedName, localizeResource, type Language } from "../world/localization";
import { isNationDefeated } from "../world/nationStatus";
import { CapitalIconResolver } from "../world/capitalIcon";
import { ResourceService } from "../world/resourceService";
import { preloadModelIcons, createNationModelSprite } from "../world/modelIconResolver";
import { debug } from "../world/debugLog";
import type { MapEdge, Tile, World } from "../world/types";
import type { ArmyGroup } from "../world/war";
import type { EraState } from "../world/era";
import type { NationModelConfigs } from "../world/modelConfig";
import { applyTolkienFilter, parseTolkienLayersParam } from "../world/tolkienRenderer";

export type MapMode = "political" | "terrain" | "resources";

type WorldMapProps = {
  world: World;
  mapMode: MapMode;
  mapRevision: number;
  armyGroups: ArmyGroup[];
  selectedCityId?: string;
  selectedProvinceId?: string;
  onSelectCity: (cityId: string) => void;
  onSelectProvince: (provinceId: string | undefined) => void;
  language: Language;
  eraState: Record<string, EraState>;
  nationConfigs?: NationModelConfigs;
};

type ResourceTooltip = {
  x: number;
  y: number;
  label: string;
};

const TILE_SIZE = 14;
const MIN_SCALE = 0.35;
const MAX_SCALE = 4.5;

/** Relleno político: naciones conservan su color con presencia marcada. */
const NATION_FILL_ALPHA = 0.58;
/** Tierra libre: gris neutro siempre visible, por encima del tinte nacional. */
const FREE_TERRITORY_FILL = { color: 0x9aa3a8, alpha: 0.7 };

const terrainColors = {
  ocean: 0x315f8f,
  coast: 0x4a89a8,
  plain: 0x88a95f,
  forest: 0x477457,
  hill: 0x9a8d65,
  mountain: 0x7d7f85,
  desert: 0xc9b06b,
  lake: 0x2e7d9e,
};

const resourceColors = {
  grain: 0xe7d66f,
  timber: 0x2f5f3f,
  iron: 0xc6cad1,
  coal: 0x33363d,
  oil: 0x18191d,
  water: 0x3aa0e0,
  gold: 0xffd700,
  silver: 0xc0c0c0,
  copper: 0xb87333,
  steel: 0x808080,
};

export function WorldMap({
  armyGroups,
  mapRevision,
  world,
  mapMode,
  onSelectCity,
  onSelectProvince,
  selectedCityId,
  selectedProvinceId,
  language,
  eraState,
  nationConfigs,
}: WorldMapProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const viewportRef = useRef<Container | null>(null);
  const armyGraphicsRef = useRef<Graphics | null>(null);
  const armyLabelsRef = useRef<Container | null>(null);
  const armyPathsRef = useRef<Graphics | null>(null);
  const selectedLayerRef = useRef<Graphics | null>(null);
  const neonTravelLightRef = useRef<Graphics | null>(null);
  const neonEdgesRef = useRef<Map<string, MapEdge[]>>(new Map());
  const nationLabelsRef = useRef<Container | null>(null);
  const ownershipRef = useRef<Graphics | null>(null);
  const nationGlowRef = useRef<Graphics | null>(null);
  const nationBordersRef = useRef<Graphics | null>(null);
  const citiesRef = useRef<Graphics | null>(null);
  const cityLabelsRef = useRef<Container | null>(null);
  const tileByCoord = useMemo(
    () => new Map(world.tiles.map((tile) => [`${tile.x},${tile.y}`, tile])),
    [world],
  );
  const [zoom, setZoom] = useState(1);
  const [resourceTooltip, setResourceTooltip] = useState<ResourceTooltip | undefined>();

  const zoomIn = () => {
    const app = appRef.current;
    const viewport = viewportRef.current;
    if (!app || !viewport) return;
    const centerX = app.renderer.width / 2;
    const centerY = app.renderer.height / 2;
    const beforeZoom = viewport.toLocal({ x: centerX, y: centerY });
    const nextScale = clamp(viewport.scale.x * 1.2, MIN_SCALE, MAX_SCALE);
    viewport.scale.set(nextScale);
    setZoom(nextScale);
    const afterZoom = viewport.toGlobal(beforeZoom);
    viewport.position.set(
      viewport.x + centerX - afterZoom.x,
      viewport.y + centerY - afterZoom.y,
    );
  };

  const zoomOut = () => {
    const app = appRef.current;
    const viewport = viewportRef.current;
    if (!app || !viewport) return;
    const centerX = app.renderer.width / 2;
    const centerY = app.renderer.height / 2;
    const beforeZoom = viewport.toLocal({ x: centerX, y: centerY });
    const nextScale = clamp(viewport.scale.x / 1.2, MIN_SCALE, MAX_SCALE);
    viewport.scale.set(nextScale);
    setZoom(nextScale);
    const afterZoom = viewport.toGlobal(beforeZoom);
    viewport.position.set(
      viewport.x + centerX - afterZoom.x,
      viewport.y + centerY - afterZoom.y,
    );
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    let disposed = false;
    let resizeFrame = 0;
    let resizeObserver: ResizeObserver | undefined;
    let app: Application | undefined;

    const setup = async () => {
      const pixiApp = new Application();
      await pixiApp.init({
        antialias: true,
        autoDensity: true,
        background: "#132028",
        resolution: window.devicePixelRatio || 1,
      });
// Iconos precargados y esperados: Assets.get ya no falla por carrera.
       await ResourceService.getInstance().preloadAll();
       if (nationConfigs) {
         await preloadModelIcons(nationConfigs);
       }

       if (disposed) {
        pixiApp.destroy(true);
        return;
      }

      const mapPixelW = world.width * TILE_SIZE;
      const mapPixelH = world.height * TILE_SIZE;
      const canvasW = Math.ceil(mapPixelW * MIN_SCALE);
      const canvasH = Math.ceil(mapPixelH * MIN_SCALE);
      pixiApp.renderer.resize(canvasW, canvasH);
      pixiApp.canvas.style.width = canvasW + "px";
      pixiApp.canvas.style.height = canvasH + "px";
      pixiApp.canvas.style.position = "";
      pixiApp.canvas.style.top = "";
      pixiApp.canvas.style.left = "";
      // El canvas DEBE vivir dentro del host: sin esto se dibuja en un canvas
      // invisible (bug del mapa negro). Guarda anti-remontaje de StrictMode.
      if (pixiApp.canvas.parentElement !== host) {
        host.prepend(pixiApp.canvas);
      }
      if (pixiApp.canvas.parentElement !== host || canvasW <= 0 || canvasH <= 0) {
        debug.error("WorldMap: canvas no visible tras montar", { canvasW, canvasH });
      }

      app = pixiApp;
      appRef.current = pixiApp;
      const viewport = new Container();
      viewportRef.current = viewport;
      pixiApp.stage.addChild(viewport);

      const layers = drawWorld(viewport, world, mapMode, tileByCoord, language, eraState, nationConfigs);
      nationLabelsRef.current = layers.nationLabels;
      ownershipRef.current = layers.ownership;
      nationGlowRef.current = layers.nationBorderGlow;
      nationBordersRef.current = layers.nationBorders;
      citiesRef.current = layers.cities;
      cityLabelsRef.current = layers.cityLabels;
      // Bordes por nación precomputados una vez (el neón los recorre cada frame).
      neonEdgesRef.current = groupEdgesByNation(world.nationEdges);
      // Filtro Tolkien SOLO en modo terreno: político y recursos van planos.
      // Diagnóstico por URL: ?tolkien=off (plano puro) o ?tolkien=-coast,-sea, etc.
      if (mapMode === "terrain") {
        applyTolkienFilter(viewport, world, parseTolkienLayersParam());
      }
      const neonTravelLight = new Graphics();
      neonTravelLightRef.current = neonTravelLight;
      viewport.addChild(neonTravelLight);
      const armyPaths = new Graphics();
      const armies = new Graphics();
      const armyLabels = new Container();
      armyPathsRef.current = armyPaths;
      armyGraphicsRef.current = armies;
      armyLabelsRef.current = armyLabels;
      viewport.addChild(armyPaths, armies, armyLabels);
      if (mapMode === "political") {
        drawArmyGroups(armies, armyPaths, armyLabels, world, armyGroups);
      }
      const selectedLayer = new Graphics();
      selectedLayerRef.current = selectedLayer;
      viewport.addChild(selectedLayer);
      drawSelectedProvince(selectedLayer, selectedProvinceId, tileByCoord);
      drawSelectedCity(selectedLayer, selectedCityId, world);
      setZoom(centerWorld(pixiApp, viewport, world));

      let dragging = false;
      let lastPointer = { x: 0, y: 0 };
      let dragStart = { x: 0, y: 0 };

      pixiApp.stage.eventMode = "static";
      pixiApp.stage.hitArea = pixiApp.screen;

      pixiApp.stage.on("pointerdown", (event) => {
        dragging = true;
        lastPointer = { x: event.global.x, y: event.global.y };
        dragStart = lastPointer;
      });

      pixiApp.stage.on("pointermove", (event) => {
        if (!dragging) {
          const tooltip = getResourceTooltip(event.global, viewport, tileByCoord, mapMode, language);
          setResourceTooltip(tooltip);
          return;
        }

        setResourceTooltip(undefined);
        const dx = event.global.x - lastPointer.x;
        const dy = event.global.y - lastPointer.y;
        viewport.position.set(viewport.x + dx, viewport.y + dy);
        lastPointer = { x: event.global.x, y: event.global.y };
      });

      const endDrag = (event?: { global: { x: number; y: number } }) => {
        if (event && dragging && distance(dragStart.x, dragStart.y, event.global.x, event.global.y) < 4) {
          const local = viewport.toLocal(event.global);
          const cityId = mapMode === "political" ? cityAtPoint(local.x, local.y, world) : undefined;
          if (cityId) {
            onSelectCity(cityId);
            dragging = false;
            return;
          }

          const tileX = Math.floor(local.x / TILE_SIZE);
          const tileY = Math.floor(local.y / TILE_SIZE);
          const tile = tileByCoord.get(`${tileX},${tileY}`);
          onSelectProvince(tile?.provinceId);
        }

        dragging = false;
      };

      pixiApp.stage.on("pointerup", endDrag);
      pixiApp.stage.on("pointerupoutside", endDrag);

      const handleWheel = (event: WheelEvent) => {
        event.preventDefault();
        const bounds = host.getBoundingClientRect();
        const scaleX = app!.renderer.width / Math.max(1, bounds.width);
        const scaleY = app!.renderer.height / Math.max(1, bounds.height);
        const pointer = {
          x: (event.clientX - bounds.left) * scaleX,
          y: (event.clientY - bounds.top) * scaleY,
        };
        const beforeZoom = viewport.toLocal(pointer);
        
        let delta = event.deltaY;
        if (event.deltaMode === 1) delta *= 40;
        else if (event.deltaMode === 2) delta *= 800;

        const factor = Math.abs(delta) > 30 ? (delta > 0 ? 0.9 : 1.1) : (delta > 0 ? 0.97 : 1.03);
        const nextScale = clamp(
          viewport.scale.x * factor,
          MIN_SCALE,
          MAX_SCALE,
        );

        viewport.scale.set(nextScale);
        setZoom(nextScale);
        const afterZoom = viewport.toGlobal(beforeZoom);
        viewport.position.set(
          viewport.x + pointer.x - afterZoom.x,
          viewport.y + pointer.y - afterZoom.y,
        );
      };

      const handleMouseLeave = () => setResourceTooltip(undefined);

      host.addEventListener("wheel", handleWheel, { passive: false });
      host.addEventListener("mouseleave", handleMouseLeave);

      resizeObserver = new ResizeObserver(() => {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = window.requestAnimationFrame(() => {
          syncRendererSize(pixiApp, host, world);
          pixiApp.stage.hitArea = pixiApp.renderer.screen;
        });
      });
      resizeObserver.observe(host);

      return () => {
        host.removeEventListener("wheel", handleWheel);
        host.removeEventListener("mouseleave", handleMouseLeave);
      };
    };

    let animFrameId = 0;
    let animFrame = 0;
    let lastTime = performance.now();
    const animate = () => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;
      animFrame += dt;

      const neonLight = neonTravelLightRef.current;
      if (!neonLight || neonLight.destroyed) {
        animFrameId = requestAnimationFrame(animate);
        return;
      }
      if (mapMode !== "political") {
        neonLight.clear();
        animFrameId = requestAnimationFrame(animate);
        return;
      }
      {
        neonLight.clear();
        for (const nation of world.nations) {
          const nationEdges = neonEdgesRef.current.get(nation.id) ?? [];
          if (nationEdges.length === 0) continue;

          const edgeLengths = nationEdges.map((e) =>
            Math.hypot(e.x2 - e.x1, e.y2 - e.y1),
          );
          const totalLength = edgeLengths.reduce((s, l) => s + l, 0);
          if (totalLength <= 0) continue;

          const speed = 30;
          const pos = (animFrame * speed) % totalLength;
          let accumulated = 0;
          let onEdge = nationEdges[0];
          let edgeStart = 0;
          let t = 0;

          for (let i = 0; i < nationEdges.length; i++) {
            const len = edgeLengths[i];
            if (accumulated + len >= pos) {
              onEdge = nationEdges[i];
              edgeStart = accumulated;
              t = (pos - edgeStart) / Math.max(1, len);
              break;
            }
            accumulated += len;
          }

          const x1 = onEdge.x1 * TILE_SIZE;
          const y1 = onEdge.y1 * TILE_SIZE;
          const x2 = onEdge.x2 * TILE_SIZE;
          const y2 = onEdge.y2 * TILE_SIZE;
          const lightX = x1 + (x2 - x1) * t;
          const lightY = y1 + (y2 - y1) * t;

          const segLen = 10;
          const halfSeg = segLen / 2;
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const sx = lightX - Math.cos(angle) * halfSeg;
          const sy = lightY - Math.sin(angle) * halfSeg;
          const ex = lightX + Math.cos(angle) * halfSeg;
          const ey = lightY + Math.sin(angle) * halfSeg;

          neonLight
            .moveTo(sx, sy)
            .lineTo(ex, ey)
            .stroke({ color: nation.numericColor, width: 5, alpha: 0.95 });
          neonLight
            .moveTo(sx, sy)
            .lineTo(ex, ey)
            .stroke({ color: nation.numericColor, width: 2, alpha: 0.5 });
        }
      }

      animFrameId = requestAnimationFrame(animate);
    };
    animFrameId = requestAnimationFrame(animate);

    let cleanupWheel: (() => void) | undefined;
    setup().then((cleanup) => {
      cleanupWheel = cleanup;
    });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(resizeFrame);
      window.cancelAnimationFrame(animFrameId);
      cleanupWheel?.();
      resizeObserver?.disconnect();
      // Nulea TODAS las capas: sin esto el loop animate y los efectos
      // corren sobre Graphics destruidos → null.clear() en Pixi.
      armyGraphicsRef.current = null;
      armyLabelsRef.current = null;
      armyPathsRef.current = null;
      selectedLayerRef.current = null;
      nationLabelsRef.current = null;
      neonTravelLightRef.current = null;
      neonEdgesRef.current = new Map();
      ownershipRef.current = null;
      nationGlowRef.current = null;
      nationBordersRef.current = null;
      citiesRef.current = null;
      cityLabelsRef.current = null;
      appRef.current = null;
      viewportRef.current = null;
      if (app?.canvas.parentElement === host) {
        host.removeChild(app.canvas);
      }
      app?.destroy(true, { children: true });
    };
  }, [world, mapMode, onSelectCity, onSelectProvince, tileByCoord, language, eraState]);

  useEffect(() => {
    const armies = armyGraphicsRef.current;
    const armyPaths = armyPathsRef.current;
    const armyLabels = armyLabelsRef.current;
    if (!armies || !armyPaths || !armyLabels) {
      return;
    }
    if (armies.destroyed || armyPaths.destroyed || armyLabels.destroyed) {
      return;
    }

    armies.clear();
    armyPaths.clear();
    armyLabels.removeChildren();
    if (mapMode === "political") {
      drawArmyGroups(armies, armyPaths, armyLabels, world, armyGroups);
    }
  }, [armyGroups, mapMode, world]);

  useEffect(() => {
    // Zoom: solo reescala etiquetas (barato). El redibujado pesado va abajo.
    const labels = nationLabelsRef.current;
    if (labels) {
      const inverse = 1 / Math.max(MIN_SCALE, zoom);
      for (const child of labels.children) {
        child.scale.set(inverse);
      }
    }
  }, [zoom]);

  useEffect(() => {
    // Refresco en vivo por turno: solo capas dinámicas (propiedad, bordes,
    // ciudades, etiquetas). El terreno y el filtro Tolkien no se tocan.
    const layers = ownershipRef.current &&
      nationGlowRef.current &&
      nationBordersRef.current &&
      citiesRef.current &&
      cityLabelsRef.current &&
      nationLabelsRef.current
      ? {
        cityLabels: cityLabelsRef.current,
        cities: citiesRef.current,
        nationBorderGlow: nationGlowRef.current,
        nationBorders: nationBordersRef.current,
        nationLabels: nationLabelsRef.current,
        ownership: ownershipRef.current,
      }
      : undefined;
    if (!layers) {
      return;
    }
    if (layers.ownership.destroyed || layers.cities.destroyed || layers.nationBorders.destroyed) {
      return;
    }
    refreshDynamicLayers(layers, world, mapMode, language, eraState, nationConfigs);
    neonEdgesRef.current = groupEdgesByNation(world.nationEdges);
    const inverse = 1 / Math.max(MIN_SCALE, zoom);
    for (const child of layers.nationLabels.children) {
      child.scale.set(inverse);
    }
  }, [mapRevision, world, mapMode, language, eraState, tileByCoord]);

  useEffect(() => {
    const selectedLayer = selectedLayerRef.current;
    if (!selectedLayer || selectedLayer.destroyed) {
      return;
    }

    selectedLayer.clear();
    drawSelectedProvince(selectedLayer, selectedProvinceId, tileByCoord);
    drawSelectedCity(selectedLayer, selectedCityId, world);
  }, [selectedCityId, selectedProvinceId, tileByCoord, world]);

  return (
    <div className="worldMap" ref={hostRef}>
      <div className="mapZoomControls">
        <button type="button" onClick={zoomIn} title="Zoom In">+</button>
        <button type="button" onClick={zoomOut} title="Zoom Out">-</button>
        <span className="zoomPercentage">{Math.round(zoom * 100)}%</span>
      </div>
      <div className="mapHint">
        {language === "zh" ? "拖动平移 / 滚轮缩放" : "Drag to pan / Wheel to zoom"} / {Math.round(zoom * 100)}% / Tiles: {world.tiles.length.toLocaleString()}
      </div>
      {resourceTooltip && (
        <div className="resourceTooltip" style={{ left: resourceTooltip.x, top: resourceTooltip.y }}>
          {resourceTooltip.label}
        </div>
      )}
    </div>
  );
}

function getResourceTooltip(
  globalPoint: { x: number; y: number },
  viewport: Container,
  tileByCoord: Map<string, Tile>,
  mapMode: MapMode,
  language: Language,
): ResourceTooltip | undefined {
  if (mapMode !== "resources") {
    return undefined;
  }

  const local = viewport.toLocal(globalPoint);
  const tileX = Math.floor(local.x / TILE_SIZE);
  const tileY = Math.floor(local.y / TILE_SIZE);
  const tile = tileByCoord.get(`${tileX},${tileY}`);
  const yieldValue = tile ? getTileMonthlyYield(tile) : undefined;

  if (!tile || !yieldValue) {
    return undefined;
  }

  const resourcePoint = {
    x: tileX * TILE_SIZE + TILE_SIZE * 0.72,
    y: tileY * TILE_SIZE + TILE_SIZE * 0.28,
  };
  const distanceToResource = distance(local.x, local.y, resourcePoint.x, resourcePoint.y);
  const hitRadius = mapMode === "resources" ? 7.5 : 5;

  if (distanceToResource > hitRadius) {
    return undefined;
  }

  return {
    x: globalPoint.x + 12,
    y: Math.max(12, globalPoint.y - 36),
    label: `${localizeResource(yieldValue.resource, language)} +${yieldValue.amount}${language === "zh" ? "/月" : "/month"}`,
  };
}

function drawWorld(
   container: Container,
   world: World,
   mapMode: MapMode,
   tileByCoord: Map<string, Tile>,
   language: Language,
   eraState: Record<string, EraState>,
   nationConfigs?: NationModelConfigs,
): DynamicMapLayers {
  const terrain = new Graphics();
  const ownership = new Graphics();
  const resources = new Graphics();
  const provinceBorders = new Graphics();
  const nationBorderGlow = new Graphics();
  const nationBorders = new Graphics();
  const cities = new Graphics();
  const cityLabels = new Container();
  const nationLabels = new Container();

  container.addChild(
    terrain,
    ownership,
    resources,
    provinceBorders,
    nationBorderGlow,
    nationBorders,
    cities,
    cityLabels,
    nationLabels,
  );

  const layers: DynamicMapLayers = {
    cityLabels,
    cities,
    nationBorderGlow,
    nationBorders,
    nationLabels,
    ownership,
    provinceBorders,
    resources,
    terrain,
  };
  drawStaticLayers(layers, world, mapMode);
  refreshDynamicLayers(layers, world, mapMode, language, eraState, nationConfigs);
  return layers;
}

type DynamicMapLayers = {
  terrain: Graphics;
  ownership: Graphics;
  resources: Graphics;
  provinceBorders: Graphics;
  nationBorderGlow: Graphics;
  nationBorders: Graphics;
  cities: Graphics;
  cityLabels: Container;
  nationLabels: Container;
};

/** Capas que no cambian entre turnos: terreno, recursos, bordes de provincia. */
function drawStaticLayers(
  layers: DynamicMapLayers,
  world: World,
  mapMode: MapMode,
): void {
  const { terrain, resources, provinceBorders } = layers;
  for (const tile of world.tiles) {
    const x = tile.x * TILE_SIZE;
    const y = tile.y * TILE_SIZE;
    terrain.rect(x, y, TILE_SIZE, TILE_SIZE).fill(terrainColors[tile.terrain]);

    if (tile.resource && mapMode === "resources") {
      const radius = 4.4;
      const strokeWidth = 1.4;
      const strokeAlpha = 0.95;
      resources
        .circle(x + TILE_SIZE * 0.72, y + TILE_SIZE * 0.28, radius)
        .fill(resourceColors[tile.resource])
        .stroke({ color: 0xffffff, width: strokeWidth, alpha: strokeAlpha });
    }
  }

  drawDashedEdges(provinceBorders, world.provinceEdges, 0xe8f2dc, 0.95, 4, 3, 0.58);
}

/** Capas que cambian cada turno: propiedad, bordes de nación, ciudades y etiquetas. */
function refreshDynamicLayers(
   layers: Pick<
     DynamicMapLayers,
     "ownership" | "nationBorderGlow" | "nationBorders" | "cities" | "cityLabels" | "nationLabels"
   >,
   world: World,
   mapMode: MapMode,
   language: Language,
   eraState: Record<string, EraState>,
   nationConfigs?: NationModelConfigs,
 ): void {
  const { ownership, nationBorderGlow, nationBorders, cities, cityLabels, nationLabels } = layers;
  ownership.clear();
  for (const tile of world.tiles) {
    const x = tile.x * TILE_SIZE;
    const y = tile.y * TILE_SIZE;

    if (tile.provinceId) {
      const province = world.provinceById.get(tile.provinceId);
      if (!province) {
        continue;
      }

      if (!province.nationId) {
        // Tierra libre: siempre visible, sin opción para ocultarla.
        // Tinte gris neutro para distinguirla del terreno base y de las naciones.
        if (mapMode === "political") {
          ownership
            .rect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2)
            .fill({ color: FREE_TERRITORY_FILL.color, alpha: FREE_TERRITORY_FILL.alpha });
        }
        continue;
      }
      const nation = world.nationById.get(province.nationId);
      if (nation && mapMode === "political") {
        ownership
          .rect(x + 1, y + 1, TILE_SIZE - 2, TILE_SIZE - 2)
          .fill({ color: nation.numericColor, alpha: NATION_FILL_ALPHA });
      }
    }
  }

  nationBorderGlow.clear();
  drawNationEdges(nationBorderGlow, world.nationEdges, world, 4.4, 0.84);
  nationBorders.clear();
  drawSolidEdges(nationBorders, world.nationEdges, 0xf8fbf1, 1.65, 0.94);
  cities.clear();
  cityLabels.removeChildren();
  if (mapMode === "political") {
    drawCities(cities, cityLabels, world, language, eraState);
  }
  nationLabels.removeChildren();
  drawNationLabels(nationLabels, world, language, mapMode, nationConfigs);
}

function syncRendererSize(app: Application, host: HTMLElement, world: World) {
  const mapPixelW = world.width * TILE_SIZE;
  const mapPixelH = world.height * TILE_SIZE;
  const canvasW = Math.ceil(mapPixelW * MIN_SCALE);
  const canvasH = Math.ceil(mapPixelH * MIN_SCALE);

  if (app.renderer.width !== canvasW || app.renderer.height !== canvasH) {
    app.renderer.resize(canvasW, canvasH);
  }

  app.canvas.style.width = canvasW + "px";
  app.canvas.style.height = canvasH + "px";

  app.stage.hitArea = app.renderer.screen;
}

function cityAtPoint(x: number, y: number, world: World) {
  let nearestCityId: string | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const city of world.cities) {
    const cityX = city.x * TILE_SIZE + TILE_SIZE / 2;
    const cityY = city.y * TILE_SIZE + TILE_SIZE / 2;
    const hitRadius = city.isCapital ? 10 : 7;
    const cityDistance = distance(x, y, cityX, cityY);

    if (cityDistance <= hitRadius && cityDistance < nearestDistance) {
      nearestCityId = city.id;
      nearestDistance = cityDistance;
    }
  }

  return nearestCityId;
}

function drawCities(
  graphics: Graphics,
  labels: Container,
  world: World,
  language: Language,
  eraState: Record<string, EraState>,
) {
  const resolver = CapitalIconResolver.getInstance();
  // Caché de TEXTURAS por era (no de Sprites: un Sprite no puede estar en 2 capitales).
  const textureCache = new Map<string, ReturnType<typeof Assets.get>>();

  for (const city of world.cities) {
    const nation = world.nationById.get(city.nationId);
    const x = city.x * TILE_SIZE + TILE_SIZE / 2;
    const y = city.y * TILE_SIZE + TILE_SIZE / 2;

    if (city.isCapital && nation) {
      const iconOptions = resolver.getCapitalSpriteOptions(nation, eraState);
      let texture = iconOptions ? textureCache.get(iconOptions.era) : undefined;
      if (iconOptions && !texture) {
        const t = Assets.get(iconOptions.path);
        // Assets.get avisa en consola si falta; el fallback vectorial cubre ese caso.
        if (t) {
          texture = t;
          textureCache.set(iconOptions.era, t);
        } else {
          debug.warn(`Capital sin textura en caché (fallback vectorial): ${iconOptions.path}`);
        }
      }
      if (iconOptions && texture) {
        // Un Sprite NUEVO por capital (comparten textura, no instancia).
        const sprite = new Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.tint = iconOptions.tint;
        sprite.scale.set(0.8);
        sprite.x = x;
        sprite.y = y;
        labels.addChild(sprite);
      } else {
        graphics.circle(x, y, 4.5).fill({ color: 0xffd700, alpha: 0.95 });
      }
      labels.addChild(createCityLabel(getLocalizedName(city, language), x + 7, y + 5, 11, 3));
      continue;
    }

    if (nation) {
      graphics
        .circle(x, y, 3.6)
        .fill({ color: 0xf8fbf1, alpha: 0.9 })
        .stroke({ color: nation.numericColor, width: 1.8, alpha: 0.95 });
    } else {
      graphics
        .circle(x, y, 3.6)
        .fill({ color: 0xf8fbf1, alpha: 0.9 });
    }
    labels.addChild(createCityLabel(getLocalizedName(city, language), x + 5, y - 12, 9, 2.4));
  }
}

function drawArmyGroups(
  graphics: Graphics,
  paths: Graphics,
  labels: Container,
  world: World,
  armyGroups: ArmyGroup[],
) {
  const groupsByProvince = new Map<string, ArmyGroup[]>();

  for (const group of armyGroups) {
    if (totalArmyGroupUnits(group) <= 0) {
      continue;
    }
    const provinceGroups = groupsByProvince.get(group.locationProvinceId) ?? [];
    provinceGroups.push(group);
    groupsByProvince.set(group.locationProvinceId, provinceGroups);
  }

  for (const group of armyGroups) {
    const province = world.provinceById.get(group.locationProvinceId);
    const nation = world.nationById.get(group.nationId);
    if (!province || !nation || group.pathProvinceIds.length === 0) {
      continue;
    }

    let lastX = province.centerX * TILE_SIZE;
    let lastY = province.centerY * TILE_SIZE;
    for (const pathProvinceId of group.pathProvinceIds.slice(0, 5)) {
      const pathProvince = world.provinceById.get(pathProvinceId);
      if (!pathProvince) {
        continue;
      }
      const nextX = pathProvince.centerX * TILE_SIZE;
      const nextY = pathProvince.centerY * TILE_SIZE;
      paths
        .moveTo(lastX, lastY)
        .lineTo(nextX, nextY)
        .stroke({ color: nation.numericColor, width: 1.25, alpha: 0.42 });
      lastX = nextX;
      lastY = nextY;
    }
  }

  for (const [provinceId, provinceGroups] of groupsByProvince) {
    const province = world.provinceById.get(provinceId);
    if (!province) {
      continue;
    }

    provinceGroups.forEach((group, index) => {
      const nation = world.nationById.get(group.nationId);
      const x = province.centerX * TILE_SIZE + (index % 3) * 9 - 9;
      const y = province.centerY * TILE_SIZE + Math.floor(index / 3) * 8 - 5;
      const color = nation?.numericColor ?? 0xf8fbf1;
      const radius = group.stance === "attack" ? 5.8 : 5;

      if (group.stance === "attack" || group.stance === "raid") {
        graphics
          .regularPoly(x, y, radius, 3, -Math.PI / 2)
          .fill({ color, alpha: 0.96 })
          .stroke({ color: 0xf8fbf1, width: 1.4, alpha: 0.94 });
      } else {
        graphics
          .circle(x, y, radius)
          .fill({ color, alpha: 0.95 })
          .stroke({ color: 0xf8fbf1, width: 1.4, alpha: 0.94 });
      }

      labels.addChild(createCityLabel(shortArmyLabel(totalArmyGroupUnits(group)), x + 5, y + 4, 8, 2));
    });
  }
}

function totalArmyGroupUnits(group: ArmyGroup) {
  return Object.values(group.units).reduce((sum, amount) => sum + amount, 0);
}

function shortArmyLabel(total: number) {
  if (total >= 1000) {
    return `${Math.round(total / 100) / 10}K`;
  }

  return String(total);
}

function createCityLabel(
  name: string,
  x: number,
  y: number,
  fontSize: number,
  strokeWidth: number,
) {
  const label = new Text({
    text: name,
    style: {
      fill: 0xf8fbf1,
      fontFamily: "Arial",
      fontSize,
      fontWeight: "700",
      stroke: { color: 0x10161b, width: strokeWidth },
    },
  });

  label.position.set(x, y);
  return label;
}

function groupEdgesByNation(edges: MapEdge[]): Map<string, MapEdge[]> {
  const byNation = new Map<string, MapEdge[]>();
  for (const edge of edges) {
    if (!edge.nationId) continue;
    const list = byNation.get(edge.nationId) ?? [];
    list.push(edge);
    byNation.set(edge.nationId, list);
  }
  return byNation;
}

function drawNationEdges(
  graphics: Graphics,
  edges: MapEdge[],
  world: World,
  width: number,
  alpha: number,
) {
  for (const edge of edges) {
    const nation = edge.nationId ? world.nationById.get(edge.nationId) : undefined;
    graphics
      .moveTo(edge.x1 * TILE_SIZE, edge.y1 * TILE_SIZE)
      .lineTo(edge.x2 * TILE_SIZE, edge.y2 * TILE_SIZE)
      .stroke({ color: nation?.numericColor ?? 0xf8fbf1, width, alpha });
  }
}

function drawSolidEdges(
  graphics: Graphics,
  edges: MapEdge[],
  color: number,
  width: number,
  alpha: number,
) {
  for (const edge of edges) {
    graphics
      .moveTo(edge.x1 * TILE_SIZE, edge.y1 * TILE_SIZE)
      .lineTo(edge.x2 * TILE_SIZE, edge.y2 * TILE_SIZE)
      .stroke({ color, width, alpha });
  }
}

function drawDashedEdges(
  graphics: Graphics,
  edges: MapEdge[],
  color: number,
  width: number,
  dashLength: number,
  gapLength: number,
  alpha: number,
) {
  for (const edge of edges) {
    const x1 = edge.x1 * TILE_SIZE;
    const y1 = edge.y1 * TILE_SIZE;
    const x2 = edge.x2 * TILE_SIZE;
    const y2 = edge.y2 * TILE_SIZE;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.hypot(dx, dy);
    const stepX = dx / length;
    const stepY = dy / length;

    for (let offset = 0; offset < length; offset += dashLength + gapLength) {
      const segmentEnd = Math.min(offset + dashLength, length);
      graphics
        .moveTo(x1 + stepX * offset, y1 + stepY * offset)
        .lineTo(x1 + stepX * segmentEnd, y1 + stepY * segmentEnd)
        .stroke({ color, width, alpha });
    }
  }
}

function drawSelectedProvince(
  graphics: Graphics,
  provinceId: string | undefined,
  tileByCoord: Map<string, Tile>,
) {
  if (!provinceId) {
    return;
  }

  for (const tile of tileByCoord.values()) {
    if (tile.provinceId !== provinceId) {
      continue;
    }

    const x = tile.x * TILE_SIZE;
    const y = tile.y * TILE_SIZE;
    graphics.rect(x, y, TILE_SIZE, TILE_SIZE).fill({ color: 0xffffff, alpha: 0.2 });

    const neighbors = [
      { dx: 0, dy: -1, edge: { x1: tile.x, y1: tile.y, x2: tile.x + 1, y2: tile.y } },
      { dx: 1, dy: 0, edge: { x1: tile.x + 1, y1: tile.y, x2: tile.x + 1, y2: tile.y + 1 } },
      { dx: 0, dy: 1, edge: { x1: tile.x, y1: tile.y + 1, x2: tile.x + 1, y2: tile.y + 1 } },
      { dx: -1, dy: 0, edge: { x1: tile.x, y1: tile.y, x2: tile.x, y2: tile.y + 1 } },
    ];

    for (const neighbor of neighbors) {
      const adjacent = tileByCoord.get(`${tile.x + neighbor.dx},${tile.y + neighbor.dy}`);
      if (adjacent?.provinceId !== provinceId) {
        graphics
          .moveTo(neighbor.edge.x1 * TILE_SIZE, neighbor.edge.y1 * TILE_SIZE)
          .lineTo(neighbor.edge.x2 * TILE_SIZE, neighbor.edge.y2 * TILE_SIZE)
          .stroke({ color: 0xffffff, width: 2.6, alpha: 0.96 });
      }
    }
  }
}

function drawNationLabels(container: Container, world: World, language: Language, mapMode: MapMode, nationConfigs?: NationModelConfigs) {
  for (const nation of world.nations) {
    const isDefeated = isNationDefeated(world, nation.id);
    const hasNoTiles = world.provinces.filter((p) => p.nationId === nation.id).length === 0;
    const isDead = isDefeated || hasNoTiles;

    // En modo político el nombre va al centro del territorio, grande y claro.
    // En terreno/recursos se mantiene la etiqueta chica junto a la capital.
    let x: number | undefined;
    let y: number | undefined;
    if (mapMode === "political" && !isDead) {
      const centroid = nationTerritoryCentroid(world, nation.id);
      x = centroid?.x;
      y = centroid?.y;
    }
    if (x === undefined || y === undefined) {
      const capitalCity = nation.capitalCityId ? world.cityById.get(nation.capitalCityId) : undefined;
      const capitalProvince = world.provinceById.get(nation.capitalProvinceId);
      x = capitalCity?.x ?? capitalProvince?.centerX;
      y = capitalCity?.y ?? capitalProvince?.centerY;
    }
    if (x === undefined || y === undefined) {
      if (isDead) {
        const label = new Text({
          text: "💀",
          style: {
            fill: 0x6b7b72,
            fontFamily: "Arial",
            fontSize: 14,
            fontWeight: "700",
            stroke: { color: 0x10161b, width: 3 },
          },
        });
        const fallbackProvince = world.provinces.find((p) => p.nationId === nation.id);
        if (fallbackProvince) {
          label.position.set(fallbackProvince.centerX * TILE_SIZE + TILE_SIZE * 0.7, fallbackProvince.centerY * TILE_SIZE - TILE_SIZE * 0.9);
          container.addChild(label);
        }
      }
      continue;
    }

    if (isDead) {
      const label = new Text({
        text: "💀",
        style: {
          fill: 0x6b7b72,
          fontFamily: "Arial",
          fontSize: 14,
          fontWeight: "700",
          stroke: { color: 0x10161b, width: 3 },
        },
      });
      label.position.set(x * TILE_SIZE + TILE_SIZE * 0.7, y * TILE_SIZE - TILE_SIZE * 0.9);
      container.addChild(label);
      continue;
    }

    const isCentered = mapMode === "political" && !isDead;
    if (isCentered) {
      const mapamundi = buildMapamundiLabel(world, nation, language);
      if (mapamundi) {
        const icon = createNationModelSprite(nation.id, nationConfigs ?? {});
        if (icon) {
          icon.position.set(-20, -mapamundi.height / 2 - 4);
          mapamundi.addChild(icon);
        }
        container.addChild(mapamundi);
      }
      continue;
    }

    const label = new Text({
      text: getLocalizedName(nation, language),
      style: {
        fill: 0xf8fbf1,
        fontFamily: "Arial",
        fontSize: 15,
        fontWeight: "700",
        stroke: { color: 0x10161b, width: 4 },
      },
    });

    label.position.set(x * TILE_SIZE + TILE_SIZE * 0.7, y * TILE_SIZE - TILE_SIZE * 0.9);
    container.addChild(label);
  }
}

/** Caja del territorio propio en px + centroide. */
function nationTerritoryBox(world: World, nationId: string) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;
  for (const province of world.provinces) {
    if (province.nationId !== nationId) continue;
    count += 1;
    minX = Math.min(minX, province.centerX);
    minY = Math.min(minY, province.centerY);
    maxX = Math.max(maxX, province.centerX);
    maxY = Math.max(maxY, province.centerY);
  }
  if (count === 0) return undefined;
  return {
    // Ancho/alto mínimos de 3 tiles para naciones de una provincia.
    w: Math.max(3, maxX - minX + 1) * TILE_SIZE,
    h: Math.max(3, maxY - minY + 1) * TILE_SIZE,
  };
}

const MAPAMUNDI_BASE_SIZE = 12;
const MAPAMUNDI_MIN_SIZE = 8;
const MAPAMUNDI_LETTER_SPACING = 3;
const MAPAMUNDI_INITIAL_SCALE = 2.4;

/**
 * Rótulo estilo mapamundi: anclado junto a la capital (sin taparla),
 * rotado hacia el interior, tamaño que cabe en el territorio,
 * letras con curva de perspectiva e inicial dorada adornada.
 */
function buildMapamundiLabel(world: World, nation: World["nations"][number], language: Language) {
  const name = getLocalizedName(nation, language).toUpperCase();
  if (!name) return undefined;
  const box = nationTerritoryBox(world, nation.id);
  const centroid = nationTerritoryCentroid(world, nation.id);
  const capitalCity = nation.capitalCityId ? world.cityById.get(nation.capitalCityId) : undefined;
  const capitalProvince = world.provinceById.get(nation.capitalProvinceId);
  const capX = capitalCity?.x ?? capitalProvince?.centerX;
  const capY = capitalCity?.y ?? capitalProvince?.centerY;
  if (capX === undefined || capY === undefined || !box || !centroid) return undefined;

  // Dirección capital → interior (si coinciden, rumbo fijo suave).
  let dx = centroid.x - capX;
  let dy = centroid.y - capY;
  if (Math.hypot(dx, dy) < 0.01) {
    dx = 1;
    dy = 0.2;
  }
  const len = Math.hypot(dx, dy);
  dx /= len;
  dy /= len;
  // Ángulo con carácter: eje capital→interior, rango ±45°, nunca recto
  // (si sale casi horizontal se inclina ±12° según hash determinista).
  let angle = Math.atan2(dy, dx);
  angle = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, angle));
  if (Math.abs(angle) < (8 * Math.PI) / 180) {
    let hash = 0;
    for (let i = 0; i < nation.id.length; i += 1) hash = (hash * 31 + nation.id.charCodeAt(i)) | 0;
    angle = (hash % 2 === 0 ? 1 : -1) * (12 * Math.PI / 180);
  }

  // Tamaño que cabe en el territorio (diagonal útil al 95%).
  const probe = new Text({
    text: name,
    style: {
      fontFamily: ["Georgia", "Times New Roman", "serif"],
      fontSize: MAPAMUNDI_BASE_SIZE,
      fontWeight: "700",
      letterSpacing: MAPAMUNDI_LETTER_SPACING,
    },
  });
  const maxLen = Math.hypot(box.w, box.h) * 0.95;
  const fontSize = Math.max(MAPAMUNDI_MIN_SIZE, Math.min(MAPAMUNDI_BASE_SIZE, MAPAMUNDI_BASE_SIZE * (maxLen / Math.max(1, probe.width))));
  probe.destroy();
  const spacing = MAPAMUNDI_LETTER_SPACING * (fontSize / MAPAMUNDI_BASE_SIZE);

  // Ancla: sale de la capital hacia adentro, despejando el icono.
  const clearance = 12 + fontSize * 0.8 + 6;
  const anchorX = (capX + dx * (clearance / TILE_SIZE)) * TILE_SIZE;
  const anchorY = (capY + dy * (clearance / TILE_SIZE)) * TILE_SIZE;

  const group = new Container();
  group.position.set(anchorX, anchorY);
  const serif = ["Georgia", "Times New Roman", "serif"] as const;
  // Nombre completo en hasta 2 filas: reparte palabras balanceando largo.
  const words = name.split(" ").filter((w) => w.length > 0);
  const rows: string[][] = (() => {
    if (words.length <= 1) return [[...name]];
    let best = 1;
    let bestDiff = Infinity;
    for (let cut = 1; cut < words.length; cut += 1) {
      const a = words.slice(0, cut).join(" ").length;
      const b = words.slice(cut).join(" ").length;
      const diff = Math.abs(a - b);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = cut;
      }
    }
    return [[...words.slice(0, best).join(" ")], [...words.slice(best).join(" ")]];
  })();
  // Letras con medidas finales antes de posicionar (curva por fila).
  const initialSize = fontSize * MAPAMUNDI_INITIAL_SCALE;
  const rowLetters = rows.map((rowChars, rowIdx) =>
    rowChars.map((ch, i) => {
      const t = rowChars.length <= 1 ? 0.5 : i / (rowChars.length - 1);
      const isInitial = rowIdx === 0 && i === 0;
      const size = (isInitial ? initialSize : fontSize * (0.8 + 0.2 * Math.sin(Math.PI * t)));
      const letter = new Text({
        text: ch === " " ? " " : ch,
        style: {
          fill: isInitial ? 0xe8c66a : 0xf3e9d2,
          fontFamily: [...serif],
          fontSize: size,
          fontWeight: "700",
          fontStyle: "italic",
          stroke: { color: 0x2a1f14, width: Math.max(2, size / 5) },
        },
      });
      return letter;
    }),
  );
  const rowWidth = (letters: Text[]) =>
    letters.reduce((s, l) => s + l.width, 0) + spacing * Math.max(0, letters.length - 1);
  // La 2da fila se sangra tras la inicial grande (mínimo 3 espacios) para no taparla.
  const spaceW = fontSize * 0.32;
  const rowIndent = rowLetters.length > 1 && rowLetters[0].length > 0
    ? Math.max(spaceW * 3, rowLetters[0][0].width + spacing)
    : 0;
  const estLen = Math.max(
    rowLetters.length > 0 ? rowWidth(rowLetters[0]) : 0,
    rowLetters.length > 1 ? rowIndent + rowWidth(rowLetters[1]) : 0,
  );

  // Si en horizontal sale de la pantalla → modo vertical (de arriba hacia abajo).
  const mapW = world.width * TILE_SIZE;
  const mapH = world.height * TILE_SIZE;
  const margin = TILE_SIZE;
  const endX = anchorX + dx * estLen;
  const endY = anchorY + dy * estLen;
  const overflows = endX > mapW - margin || endX < margin || endY > mapH - margin || endY < margin;

  const boxPad = 3;
  if (!overflows) {
    group.rotation = angle;
    // El texto nace en el ancla y fluye hacia adentro (nunca vuelve sobre la capital).
    // Dos filas centradas sobre el ancla.
    const lineH = fontSize * 1.2;
    const y0 = rowLetters.length > 1 ? -lineH / 2 : 0;
    rowLetters.forEach((letters, rowIdx) => {
      // Segunda fila sangrada: no tapa la inicial grande.
      let cursorX = rowIdx > 0 ? rowIndent : 0;
      const baseY = y0 + rowIdx * lineH;
      letters.forEach((letter, idx) => {
        const isInitial = rowIdx === 0 && idx === 0;
        if (isInitial) {
          // Caja iluminada tras la inicial (aire de libro antiguo).
          const illumBox = new Graphics();
          illumBox
            .rect(cursorX - boxPad, baseY - initialSize * 0.62 - boxPad, initialSize * 0.95 + boxPad * 2, initialSize * 1.24 + boxPad * 2)
            .fill({ color: 0x2a1f14, alpha: 0.55 })
            .stroke({ color: 0xe8c66a, width: 1.5, alpha: 0.9 });
          group.addChild(illumBox);
        }
        letter.anchor.set(0, 0.5);
        // Drop-cap: la inicial cuelga por debajo de la línea base.
        letter.position.set(cursorX, baseY + (isInitial ? letter.height * 0.14 : 0));
        group.addChild(letter);
        cursorX += letter.width + spacing;
      });
    });
    return group;
  }

  // Modo vertical: nombre completo en una columna (sin filas).
  const letters = rowLetters.flat();
  const estH = letters.reduce((s, l) => s + l.height, 0) + spacing * Math.max(0, letters.length - 1);
  const upward = anchorY + estH > mapH - margin;
  const dirY = upward ? -1 : 1;
  const first = letters[0];
  if (first) {
    const fw = first.width;
    const fh = first.height;
    const illumBox = new Graphics();
    illumBox
      .rect(-fw / 2 - boxPad, (upward ? -fh : 0) - boxPad, fw + boxPad * 2, fh + boxPad * 2)
      .fill({ color: 0x2a1f14, alpha: 0.55 })
      .stroke({ color: 0xe8c66a, width: 1.5, alpha: 0.9 });
    group.addChild(illumBox);
  }
  let cursorY = 0;
  for (const letter of letters) {
    letter.anchor.set(0.5, upward ? 1 : 0);
    letter.position.set(0, cursorY);
    group.addChild(letter);
    cursorY += dirY * (letter.height + spacing);
  }
  return group;
}

/** Centro del territorio: promedio de centros de provincia ponderado por tiles. */
function nationTerritoryCentroid(world: World, nationId: string): { x: number; y: number } | undefined {
  let sx = 0;
  let sy = 0;
  let weight = 0;
  for (const province of world.provinces) {
    if (province.nationId !== nationId) continue;
    const w = Math.max(1, province.tileCount);
    sx += province.centerX * w;
    sy += province.centerY * w;
    weight += w;
  }
  if (weight <= 0) return undefined;
  return { x: sx / weight, y: sy / weight };
}

function drawSelectedCity(graphics: Graphics, cityId: string | undefined, world: World) {
  if (!cityId) {
    return;
  }

  const city = world.cityById.get(cityId);
  if (!city) {
    return;
  }

  const x = city.x * TILE_SIZE + TILE_SIZE / 2;
  const y = city.y * TILE_SIZE + TILE_SIZE / 2;

  graphics
    .circle(x, y, city.isCapital ? 10.5 : 8)
    .stroke({ color: 0xffffff, width: 2.4, alpha: 0.98 });
}

function centerWorld(app: Application, viewport: Container, world: World) {
  const mapWidth = world.width * TILE_SIZE;
  const mapHeight = world.height * TILE_SIZE;
  const scale = Math.min(
    1.15,
    Math.max(MIN_SCALE, Math.min(app.screen.width / mapWidth, app.screen.height / mapHeight) * 0.92),
  );

  viewport.scale.set(scale);
  viewport.position.set(
    (app.screen.width - mapWidth * scale) / 2,
    (app.screen.height - mapHeight * scale) / 2,
  );

  return scale;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function distance(x1: number, y1: number, x2: number, y2: number) {
  return Math.hypot(x2 - x1, y2 - y1);
}
