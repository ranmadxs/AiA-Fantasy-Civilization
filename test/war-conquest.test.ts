import { buildDemoWorld } from "../src/world/buildDemoWorld";
import { transferProvince, prisonerOutcome, exodusOutcome } from "../src/world/war";

describe("conquista: botín, bajas civiles y prisioneros", () => {
  test("prisonerOutcome: reparto ejecutados/fuga/muerte/resto", () => {
    const r = prisonerOutcome(100, 10);
    expect(r.executed).toBe(10);
    expect(r.escape + r.die + r.remain).toBe(90);
    expect(r.escape).toBe(18);
    expect(r.die).toBe(9);
    expect(r.remain).toBe(63);
    const zero = prisonerOutcome(100, 0);
    expect(zero.executed).toBe(0);
    expect(zero.escape).toBe(20);
  });

  test("exodusOutcome: deserción 5-45%, de ellos muere el 20%", () => {
    const r = exodusOutcome(1000, 0.30);
    expect(r.deserters).toBe(300);
    expect(r.deaths).toBe(60);
    expect(r.survivors).toBe(240);
  });

  test("transferencia: minas al vencedor, obras abandonadas, botín 80%, éxodo con doctrina", () => {
    const world = buildDemoWorld("conquista-001", { nationCount: 2, cityCount: 4 });
    const nationA = world.nations[0].id;
    const nationB = world.nations[1].id;
    const city = world.cities.find((c) => c.nationId === nationB)!;
    const target = world.provinceById.get(city.provinceId)!;
    city.population = 1000;
    const stockpiles: any = {
      [nationA]: { gold: 100, water: 0, resources: {} },
      [nationB]: { gold: 1000, water: 0, resources: { timber: 500 } },
    };
    const minasDeCarbon: any = [{ id: "m1", nationId: nationB, provinceId: target.id, era: "stone", activa: true, nivel: 1, carts: 2 }];
    const aserraderos: any = [];
    const projects: any = [
      { id: "pb", nationId: nationB, provinceId: target.id, era: "stone", kind: "barracks", cost: {}, totalTurns: 3, remainingTurns: 2, status: "building", startedAt: 0 },
      { id: "pc", nationId: nationB, provinceId: target.id, era: "stone", kind: "stable", cost: {}, totalTurns: 4, remainingTurns: 0, status: "complete", startedAt: 0 },
    ];
    const tile = world.tiles.find((t) => t.provinceId === target.id)!;
    tile.reservedBy = "pb";
    const res = transferProvince(world, target.id, nationA, nationB, 5, {
      minasDeCarbon, minasDeHierro: [], aserraderos, reinos: [], projects,
    }, stockpiles, 0);
    // Provincia y ciudad intacta bajo nuevo dueño.
    expect(world.provinceById.get(target.id)?.nationId).toBe(nationA);
    expect(city.nationId).toBe(nationA);
    expect(city.population).toBeGreaterThan(0);
    // Mina transferida con pool.
    expect(minasDeCarbon[0].nationId).toBe(nationA);
    expect(minasDeCarbon[0].carts).toBe(2);
    // Obra en curso abandonada + tile liberado; completa cambia de dueño.
    expect(projects.find((p: any) => p.id === "pb").status).toBe("abandoned");
    expect(world.tiles.find((t) => t.reservedBy === "pb")).toBeUndefined();
    expect(projects.find((p: any) => p.id === "pc").nationId).toBe(nationA);
    // Botín 80% de la caja.
    expect(stockpiles[nationA].gold).toBe(900);
    expect(stockpiles[nationB].gold).toBe(200);
    expect(stockpiles[nationA].resources.timber).toBe(400);
    // Éxodo 5-45% con doctrina 0: nadie ejecutado, ciudad conserva resto.
    const fled = 1000 - city.population;
    expect(fled).toBeGreaterThanOrEqual(50);
    expect(fled).toBeLessThanOrEqual(450);
    expect(res.events.length).toBeGreaterThan(0);
  });

  test("doctrina ejecuta un porcentaje de los que se quedan", () => {
    const world = buildDemoWorld("conquista-002", { nationCount: 2, cityCount: 4 });
    const nationA = world.nations[0].id;
    const nationB = world.nations[1].id;
    const city = world.cities.find((c) => c.nationId === nationB)!;
    const target = world.provinceById.get(city.provinceId)!;
    city.population = 1000;
    const stockpiles: any = {
      [nationA]: { gold: 0, water: 0, resources: {} },
      [nationB]: { gold: 0, water: 0, resources: {} },
    };
    transferProvince(world, target.id, nationA, nationB, 5, {
      minasDeCarbon: [], minasDeHierro: [], aserraderos: [], reinos: [], projects: [],
    }, stockpiles, 50);
    // Con 50%: la ciudad queda muy por debajo de lo que deja el éxodo solo.
    expect(city.population).toBeLessThan(500);
  });
});
