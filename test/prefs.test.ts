import { fetchServerConfigs } from "../src/world/modelConfig";

describe("preferencias IA (servidor manda, local de caché)", () => {
  test("sin servicio responde undefined sin lanzar (usa lo local)", async () => {
    const world: any = { seed: "no-server-seed", nations: [] };
    await expect(fetchServerConfigs(world)).resolves.toBeUndefined();
  });
});
