import { drizzle } from "drizzle-orm/bun-sql";
import { loadConfig } from "../config";
import * as schema from "./schema";

export const db = drizzle(loadConfig().databaseUrl, { schema });
export { schema };
