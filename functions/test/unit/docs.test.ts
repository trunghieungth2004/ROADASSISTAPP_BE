import * as fs from "fs";
import * as path from "path";
import {SERVICE_ROLE} from "../../constants/status";

const DOCS_DIR = path.resolve(__dirname, "../../../documentation");
const ROUTES_DIR = path.resolve(__dirname, "../../routes");

const readDoc = (name: string): string =>
  fs.readFileSync(path.join(DOCS_DIR, name), "utf8");

describe("docs drift guard", () => {
  it("contains no retired provider-model tokens", () => {
    const retired = [
      "tow_registrations",
      "`POST /shops`",
      "`PUT /shops`",
      "/vehicleProfiles/tow",
      "hasTow",
      "towVehicleType",
      "towVehicleWidth",
      "unlistedShops",
      "db:seed-places",
      "db:backfill-services",
      "enum: SHOP, MOBILE, TOW",
    ];
    const docs = ["API.md", "SCHEMA.md", "ARCHITECTURE.md", "TESTING.md",
      "DEPLOY.md", "PRICING.md"].map(readDoc).join("\n");
    for (const token of retired) {
      expect(docs).not.toContain(token);
    }
  });

  it("documents every registered route path", () => {
    const api = readDoc("API.md");
    const files = fs.readdirSync(ROUTES_DIR).filter((f) => f.endsWith(".ts"));
    const paths = new Set<string>();
    for (const file of files) {
      const src = fs.readFileSync(path.join(ROUTES_DIR, file), "utf8");
      const re = /"(GET|POST|PUT|DELETE)?\s*(\/[a-zA-Z][a-zA-Z/_-]*)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        paths.add(m[2]);
      }
    }
    expect(paths.size).toBeGreaterThan(0);
    const undocumented = [...paths].filter((p) => !api.includes(p));
    expect(undocumented).toEqual([]);
  });

  it("licence list matches SERVICE_ROLE", () => {
    expect(Object.values(SERVICE_ROLE).sort()).toEqual(
      ["RIDER", "VOLUNTEER"],
    );
    const api = readDoc("API.md");
    for (const role of Object.values(SERVICE_ROLE)) {
      expect(api).toContain(`\`${role}\``);
    }
  });
});
