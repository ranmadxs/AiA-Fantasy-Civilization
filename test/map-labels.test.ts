import {
  cityDotRadius,
  formatCityMapLabel,
  footprintAlphaFor,
  tilesForOwner,
} from "../src/world/mapLabels";

describe("etiquetas y huella en mapa político", () => {
  test("etiqueta lleva nombre + Nv", () => {
    const city: any = { name: "Rivergate", nameEn: "Rivergate", nameZh: "河门", nameEs: "Rivergate", level: 1, tipo: "pueblo" };
    expect(formatCityMapLabel(city, "es")).toBe("Rivergate · Nv1");
    expect(formatCityMapLabel({ ...city, level: 3, tipo: "ciudad" }, "es")).toBe("Rivergate · Nv3");
  });

  test("radio por tipo: pueblo chico, ciudad grande", () => {
    expect(cityDotRadius({ tipo: "pueblo" } as any)).toBeLessThan(cityDotRadius({ tipo: "ciudad" } as any));
    expect(cityDotRadius({} as any)).toBe(2.6);
  });

  test("alfa por tipo: reino > ciudad > pueblo", () => {
    const p = footprintAlphaFor("pueblo");
    const c = footprintAlphaFor("ciudad");
    const r = footprintAlphaFor("reino");
    expect(p).toBeLessThan(c);
    expect(c).toBeLessThan(r);
  });

  test("tilesForOwner filtra por reservedBy", () => {
    const tiles: any[] = [
      { x: 0, y: 0, reservedBy: "c1" },
      { x: 1, y: 0, reservedBy: "c1" },
      { x: 2, y: 0, reservedBy: "mina-1" },
      { x: 3, y: 0 },
    ];
    expect(tilesForOwner(tiles, "c1")).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 - 1 }]);
    expect(tilesForOwner(tiles, "nadie")).toEqual([]);
  });
});
