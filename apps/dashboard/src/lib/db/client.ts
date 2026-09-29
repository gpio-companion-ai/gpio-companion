import { type DrizzleD1Database, drizzle } from "drizzle-orm/d1";
import * as schema from "./schema.ts";

export type DashboardDatabase = DrizzleD1Database<typeof schema>;

export function createDashboardDatabase(
	database: D1Database,
): DashboardDatabase {
	return drizzle(database, { schema });
}
